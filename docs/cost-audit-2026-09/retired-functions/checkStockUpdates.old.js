/**
 * FUNCTION 1 of 2: checkStockUpdates — CORRECTED VERSION
 * ------------------------------------------------------
 * NOT deployed from this repo — copy into the deployment that owns the
 * stock CFs (same convention as notifyNewMessages.example.js).
 *
 * ROOT-CAUSE FIX (marked ⬅ FIX below): the old `contentChanged` signal
 * compared the scraped candidate against /previousStock (the archive from
 * one rotation ago). At the FIRST tick of every window — before the site
 * had actually rotated — the scrape returns the OLD stock, which always
 * differs from /previousStock, so the function confirmed a "rotation"
 * with stale items, marked the window done, and skipped the real rotation
 * minutes later. Result: app stock ran one rotation behind whenever the
 * site rotated late (the usual case).
 *
 * The baseline is now the CURRENT /calcData stock: "changed" means the
 * site shows something different from what we currently serve. All write
 * shapes (/calcData/test, /calcData/mirage, /previousStock, meta,
 * notifications/*) are UNCHANGED — fully backward compatible with the
 * app's fetchStockData reader.
 *
 * Everything else (scraper, parser, lock, cron, notification writes) is
 * identical to the previously deployed version.
 */

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const crypto = require("crypto");

if (admin.apps.length === 0) admin.initializeApp();

const rtdb = admin.database();

/* =========================
   CONFIG
========================= */

const TZ = "Asia/Karachi";
const STOCK_CHECK_CRON = "0-30/2 1-23/2 * * *";

// Stock storage
const normalRef = rtdb.ref("/calcData/test");
const mirageRef = rtdb.ref("/calcData/mirage");
const previousStockRef = rtdb.ref("/previousStock");

// LIVE (every tick, optional for UI)
const liveNormalRef = rtdb.ref("/calcData/live/test");
const liveMirageRef = rtdb.ref("/calcData/live/mirage");

// Rotation meta
const metaRef = rtdb.ref("/calcData/meta");

// Notification state (written by this function, read by notifier)
const notificationsEnabledRef = rtdb.ref("notifications/enabled");
const lastUpdateAtRef = rtdb.ref("notifications/lastUpdateAt");
const pendingRef = rtdb.ref("notifications/pending");
const windowStateRef = rtdb.ref("notifications/windowState");

// Lock
const extractorLockRef = rtdb.ref("notifications/extractorLock");
const LOCK_TTL_MS = 540_000;

// Monitoring
const fetchFailuresRef = rtdb.ref("/monitor/fetchFailures");
const staleWindowsRef = rtdb.ref("/monitor/staleWindows");

// Rotation detection tuning
const COUNTDOWN_JUMP_TOLERANCE_SEC = 60;
const FRESH_WINDOW_MIN_COUNTDOWN_SEC = 6900; // ~1h55m

/* =========================
   TIME HELPERS
========================= */

function getLocalParts(timeZone) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const map = {};
  for (const p of dtf.formatToParts(new Date())) map[p.type] = p.value;
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
  };
}

function makeWindowId({ year, month, day, hour }) {
  return `${year}-${month}-${day}-${hour}`;
}

function isFinalizeMinute(minuteStr) {
  return Number(minuteStr) >= 28;
}

/* =========================
   STOCK NORMALIZATION
========================= */

function cleanFruitName(name) {
  return name ? String(name).split("-")[0].trim() : null;
}

function titleCase(name) {
  return String(name).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function asArray(val) {
  if (Array.isArray(val)) return val;
  if (val && typeof val === "object") return Object.values(val);
  return [];
}

function getItemName(x) {
  return cleanFruitName(x?.Normal || x?.name || "");
}

function toRecords({ stock = [], tsISO }) {
  return stock
    .map((x) => ({
      Normal: cleanFruitName(x.name),
      price: Number(x.price || 0),
      ts: tsISO,
    }))
    .filter((x) => x.Normal);
}

function sameSet(a = [], b = []) {
  if (a.length !== b.length) return false;
  return [...a].sort().join("|") === [...b].sort().join("|");
}

function signatureList(records = []) {
  return asArray(records)
    .map((x) => {
      const nm = String(getItemName(x) || "").toLowerCase().trim();
      if (!nm) return "";
      const pr = Number(x?.price || 0);
      return `${nm}:${pr}`;
    })
    .filter(Boolean);
}

function stocksEqual(prevObj, candidate) {
  const prevN = signatureList(prevObj?.normalStock || []);
  const prevM = signatureList(prevObj?.mirageStock || []);
  const candN = signatureList(candidate?.normal || []);
  const candM = signatureList(candidate?.mirage || []);
  return sameSet(prevN, candN) && sameSet(prevM, candM);
}

function countdownToSec(str) {
  if (!/^\d{2}:\d{2}:\d{2}$/.test(str || "")) return null;
  const [hh, mm, ss] = str.split(":").map(Number);
  return hh * 3600 + mm * 60 + ss;
}

// Compact one-line summary of a candidate's items, for logs.
function summarizeStock(records = []) {
  const list = asArray(records)
    .map((x) => `${getItemName(x)}:${Number(x?.price || 0)}`)
    .filter((s) => s && !s.startsWith(":"));
  return `(${list.length}) [${list.join(", ")}]`;
}

/* =========================
   LOCK (token-safe)
========================= */

async function acquireLock(lockRef, token) {
  const now = Date.now();
  const res = await lockRef.transaction((cur) => {
    const until = cur?.until || 0;
    if (until > now) return;
    return { until: now + LOCK_TTL_MS, token };
  });
  return !!res.committed;
}

async function releaseLock(lockRef, token) {
  await lockRef
    .transaction((cur) => {
      if (!cur || cur.token !== token) return;
      return { until: 0, token: null };
    })
    .catch(() => null);
}

/* =========================
   PARSER (returns items + countdownSec)
========================= */

function parseStockFromText(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const result = [];
  let countdownSec = null;
  let i = 0;

  function captureCountdownAt(idx) {
    if (tokens[idx] === "Next" && tokens[idx + 1] === "reset") {
      const sec = countdownToSec(tokens[idx + 2]);
      if (sec != null && countdownSec == null) countdownSec = sec;
    }
  }

  function parseSection(dealer) {
    while (i < tokens.length && tokens[i] !== "Next") i++;
    captureCountdownAt(i);
    if (tokens[i] === "Next" && tokens[i + 1] === "reset") i += 2;
    if (i < tokens.length && /^\d{2}:\d{2}:\d{2}$/.test(tokens[i])) i++;

    while (i < tokens.length) {
      const t = tokens[i];
      if (t === "Normal" || t === "Mirage" || t === "BloxInformer") break;
      if (!/^[A-Z]+$/.test(t)) {
        i++;
        continue;
      }

      const fruit = t;
      if (i + 1 >= tokens.length) break;

      const priceToken = /^[\d,]+$/.test(tokens[i + 1]) ? tokens[i + 1] : tokens[i + 2];
      const beli = priceToken === "00" ? 0 : Number(String(priceToken).replace(/,/g, ""));

      let robux = null;
      let j = /^[\d,]+$/.test(tokens[i + 1]) ? i + 2 : i + 3;

      if (
        j < tokens.length &&
        tokens[j] === "R" &&
        j + 1 < tokens.length &&
        /^[\d,]+$/.test(tokens[j + 1])
      ) {
        robux = Number(tokens[j + 1].replace(/,/g, ""));
        i = j + 2;
      } else {
        i = i + 2;
      }
      result.push({ dealer, fruit, beli, robux });
    }
  }

  while (i < tokens.length) {
    if (tokens[i] === "Normal") {
      i++;
      parseSection("Normal");
    } else if (tokens[i] === "Mirage") {
      i++;
      parseSection("Mirage");
    } else {
      i++;
    }
  }

  return { items: result, countdownSec };
}

/* =========================
   FETCHER
========================= */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchStockViaPuppeteer() {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
    );
    await page.setDefaultNavigationTimeout(120_000);
    await page.setDefaultTimeout(120_000);

    await page.goto("https://fruityblox.com/stock", {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });

    try {
      await page.waitForSelector(".p-4.border.border-secondary", { timeout: 60_000 });
    } catch {
      console.log("Stock cards selector not found; continuing.");
    }
    await sleep(2000);

    const text = await page.evaluate(() => document.body.innerText);
    const { items, countdownSec } = parseStockFromText(text);

    const normalStock = items
      .filter((f) => f.dealer === "Normal")
      .map((f) => ({ name: titleCase(f.fruit), price: f.beli }));
    const mirageStock = items
      .filter((f) => f.dealer === "Mirage")
      .map((f) => ({ name: titleCase(f.fruit), price: f.beli }));

    return { normalStock, mirageStock, countdownSec, tsISO: new Date().toISOString() };
  } finally {
    await browser.close();
  }
}

/* =========================
   CONFIRM + ROTATE
========================= */

async function confirmNewStock({ windowId, candidate, reason, countdownSec, confirmSeq = 1 }) {
  // Re-confirms within the same window need a distinct pending.windowId,
  // otherwise the notifier's lastSentWindowId dedupe would swallow the
  // second (real) rotation's notifications.
  const notifyWindowId = confirmSeq > 1 ? `${windowId}-r${confirmSeq}` : windowId;
  const [curN, curM, curLast] = await Promise.all([
    normalRef.once("value"),
    mirageRef.once("value"),
    lastUpdateAtRef.once("value"),
  ]);

  const currentNormal = asArray(curN.val());
  const currentMirage = asArray(curM.val());
  const currentLastUpdateAt = curLast.val() || null;

  const inStockNames = [
    ...(candidate.normal || []).map((x) => String(x?.Normal || "").trim()),
    ...(candidate.mirage || []).map((x) => String(x?.Normal || "").trim()),
  ].filter(Boolean);

  const updates = {};

  updates["/previousStock"] = {
    normalStock: currentNormal,
    mirageStock: currentMirage,
    lastUpdateAt: currentLastUpdateAt,
    rotatedAt: candidate.tsISO,
    rotatedForWindowId: windowId,
  };

  updates["/calcData/test"] = candidate.normal || [];
  updates["/calcData/mirage"] = candidate.mirage || [];

  updates["/calcData/meta"] = {
    lastCountdownSec: countdownSec ?? 0,
    committedWindowId: windowId,
    lastCommittedAt: candidate.tsISO,
  };

  updates["/notifications/lastUpdateAt"] = candidate.tsISO;
  updates["/notifications/enabled"] = true;
  updates["/notifications/pending"] = {
    windowId: notifyWindowId,
    tsISO: candidate.tsISO,
    inStockNames,
    reason,
  };

  updates["/notifications/windowState"] = {
    windowId,
    done: true,
    confirmCount: confirmSeq,
    confirmedAt: Date.now(),
    confirmReason: reason,
    lastCandidate: null,
  };

  updates["/monitor/fetchFailures"] = 0;

  await rtdb.ref().update(updates);

  console.log(
    `CONFIRMED window=${windowId} seq=${confirmSeq} reason=${reason} countdown=${countdownSec}\n` +
    `  normal=${summarizeStock(candidate.normal)}\n` +
    `  mirage=${summarizeStock(candidate.mirage)}`
  );
}

/* =========================
   MAIN
========================= */

exports.checkStockUpdates = functions
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .pubsub.schedule(STOCK_CHECK_CRON)
  .timeZone(TZ)
  .onRun(async () => {
    const parts = getLocalParts(TZ);
    const windowId = makeWindowId(parts);
    const finalize = isFinalizeMinute(parts.minute);

    console.log(
      "RUN checkStockUpdates",
      new Date().toISOString(),
      "local=",
      parts,
      "windowId=",
      windowId
    );

    const token = crypto.randomBytes(8).toString("hex");
    const gotLock = await acquireLock(extractorLockRef, token);
    if (!gotLock) {
      console.log("Extractor lock held — skip.");
      return null;
    }

    try {
      const state = (await windowStateRef.once("value")).val() || {};
      // ⬅ FIX 2: a confirm no longer ends the window. The dealer reset can
      // land seconds AFTER our first-tick scrape (observed live: mirage
      // rotated at 19:01:35 while the 19:00:30 scrape was in flight, so we
      // committed the dying batch and the real one was skipped until the
      // next window). After a commit we KEEP scraping through minute 30 and
      // re-confirm if the site's content changes again — idempotent
      // otherwise, since content-vs-current fires only on a real diff.
      let alreadyCommitted = false;
      let confirmCount = 0;
      if (state.windowId !== windowId) {
        await windowStateRef.set({
          windowId,
          done: false,
          confirmCount: 0,
          startedAt: Date.now(),
          lastCandidate: null,
        });
        console.log("New window — state reset:", windowId);
      } else if (state.done) {
        alreadyCommitted = true;
        confirmCount = Number(state.confirmCount || 1);
        console.log(`Window committed ${confirmCount}x — still watching for a late/second rotation.`);
      }

      // Snapshot meta BEFORE this tick overwrites it, so we can compare
      // the current countdown against the PREVIOUS tick's countdown.
      const metaBefore = (await metaRef.once("value")).val() || {};
      const prevTickCountdown = Number(metaBefore.lastCountdownSec || 0);
      const lastCommittedWindowId = metaBefore.committedWindowId || null;

      // Scrape
      let fetched = null;
      try {
        fetched = await fetchStockViaPuppeteer();
      } catch (e) {
        console.error("Fetch failed:", e?.message || e);
        const fails = Number((await fetchFailuresRef.once("value")).val() || 0) + 1;
        await fetchFailuresRef.set(fails);
      }

      // Build candidate if fetch ok
      let candidate = null;
      let countdownSec = null;

      if (fetched) {
        countdownSec = fetched.countdownSec;
        const normal = toRecords({ stock: fetched.normalStock, tsISO: fetched.tsISO });
        const mirage = toRecords({ stock: fetched.mirageStock, tsISO: fetched.tsISO });

        console.log(
          `FETCHED countdown=${countdownSec}\n` +
          `  normal=${summarizeStock(normal)}\n` +
          `  mirage=${summarizeStock(mirage)}`
        );

        if (normal.length === 0 && mirage.length === 0) {
          console.log("Parsed empty — skip.");
        } else {
          candidate = { normal, mirage, tsISO: fetched.tsISO, countdownSec };
          await Promise.all([liveNormalRef.set(normal), liveMirageRef.set(mirage)]);
          await windowStateRef.child("lastCandidate").set(candidate);
          // Persist this tick's countdown for the NEXT tick to compare.
          await metaRef.update({
            lastCountdownSec: countdownSec ?? 0,
            lastSeenAt: fetched.tsISO,
          });
        }
      }

      const st2 = (await windowStateRef.once("value")).val() || {};
      const lastCandidate = st2.lastCandidate || null;

      if (!candidate) {
        if (finalize && lastCandidate) {
          console.log("Finalize tick with no fresh candidate — using lastCandidate.");
          candidate = lastCandidate;
          countdownSec = lastCandidate.countdownSec ?? null;
        } else {
          console.log("No candidate — retry next tick.");
          return null;
        }
      }

      // ⬅ FIX: read the CURRENT live stock alongside /previousStock. The
      // content-change baseline must be what we currently serve, not the
      // one-rotation-old archive.
      const [prevSnap, curNSnap, curMSnap] = await Promise.all([   // ⬅ FIX
        previousStockRef.once("value"),                            // ⬅ FIX
        normalRef.once("value"),                                   // ⬅ FIX
        mirageRef.once("value"),                                   // ⬅ FIX
      ]);                                                          // ⬅ FIX
      const prev = prevSnap.val() || null;
      const hasPrev =
        !!prev &&
        ((prev.normalStock || []).length > 0 || (prev.mirageStock || []).length > 0);

      const current = {                                            // ⬅ FIX
        normalStock: asArray(curNSnap.val()),                      // ⬅ FIX
        mirageStock: asArray(curMSnap.val()),                      // ⬅ FIX
      };                                                           // ⬅ FIX
      const hasCurrent =                                           // ⬅ FIX
        current.normalStock.length > 0 || current.mirageStock.length > 0; // ⬅ FIX

      // Rotation signals
      const countdownJumped =
        countdownSec != null &&
        prevTickCountdown > 0 &&
        countdownSec > prevTickCountdown + COUNTDOWN_JUMP_TOLERANCE_SEC;

      const freshWindow =
        lastCommittedWindowId !== windowId &&
        countdownSec != null &&
        countdownSec >= FRESH_WINDOW_MIN_COUNTDOWN_SEC;

      // ⬅ FIX: "changed" = differs from the CURRENT stock we serve.
      // The old code compared against /previousStock, which made this true
      // at the first tick of every window BEFORE the site rotated (the
      // still-current stock always differs from the archive) → it confirmed
      // stale stock, marked the window done, and skipped the real rotation.
      const contentChanged = hasCurrent ? !stocksEqual(current, candidate) : true; // ⬅ FIX

      // ⬅ FIX 2: post-commit ticks only re-confirm on a REAL content change
      // (the late/second rotation case). Countdown/fresh-window/stale paths
      // are first-commit signals and are skipped once committed.
      if (alreadyCommitted) {
        if (contentChanged) {
          await confirmNewStock({
            windowId,
            candidate,
            reason: "post_commit_rotation",
            countdownSec,
            confirmSeq: confirmCount + 1,
          });
        } else {
          console.log("Committed and site unchanged — nothing to do.");
        }
        return null;
      }

      // First run
      if (!hasPrev) {
        await confirmNewStock({ windowId, candidate, reason: "init_no_previous", countdownSec });
        return null;
      }

      // PRIMARY: countdown jumped
      if (countdownJumped) {
        await confirmNewStock({ windowId, candidate, reason: "countdown_jump", countdownSec });
        return null;
      }

      // SECONDARY: site content differs from what we currently serve
      if (contentChanged) {
        await confirmNewStock({ windowId, candidate, reason: "content_changed", countdownSec });
        return null;
      }

      // TERTIARY: fresh window high countdown, identical items
      if (freshWindow) {
        await confirmNewStock({
          windowId,
          candidate,
          reason: "fresh_window_same_items",
          countdownSec,
        });
        return null;
      }

      // Finalize without rotation signal — stale site
      if (finalize) {
        const stale = Number((await staleWindowsRef.once("value")).val() || 0) + 1;
        await staleWindowsRef.set(stale);
        await windowStateRef.update({
          windowId,
          done: true,
          confirmedAt: Date.now(),
          confirmReason: "stale_no_rotation",
          lastCandidate: null,
        });
        console.log(`Finalize with no rotation — window marked stale (#${stale}). No notification.`);
        return null;
      }

      console.log(
        `No rotation yet. countdown=${countdownSec} prevTick=${prevTickCountdown} contentChanged=${contentChanged} — keep checking.`
      );
      return null;
    } finally {
      await releaseLock(extractorLockRef, token);
    }
  });
