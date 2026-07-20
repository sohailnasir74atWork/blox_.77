/**
 * FUNCTION 2 of 2: sendStockNotifications — CORRECTED VERSION
 * -----------------------------------------------------------
 * NOT deployed from this repo — copy into the deployment that owns the
 * stock CFs (pair of checkStockUpdates.example.js).
 *
 * FIXES (marked ⬅ FIX below):
 *  1. MAX_FRUITS_PER_CONDITION 25 → 5. FCM rejects conditions with more
 *     than five topics; with 6+ unique in-stock fruits the send threw
 *     invalid-argument forever, and the retry loop re-sent the GENERAL
 *     notification every 2 minutes for the rest of the window.
 *  2. NOTIFY_CRON "0-30/2 1-23/2" → "*+/2 * * * *" (every 2 min, all day).
 *     A rotation confirmed on the checker's :28/:30 finalize tick — or a
 *     late/self-heal commit — used to sit with enabled=true until the next
 *     odd hour (up to ~90 min late, then double-sent). The function
 *     early-exits on enabled=false, so the extra ticks cost one RTDB read.
 *  3. General send is now recorded separately (generalSentWindowId) the
 *     moment it succeeds, so a transient fruit-send failure retries ONLY
 *     the fruit groups instead of re-blasting the general topic.
 *
 * All existing keys/shapes unchanged; generalSentWindowId is additive.
 */

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const crypto = require("crypto");

if (admin.apps.length === 0) admin.initializeApp();

const rtdb = admin.database();

/* =========================
   CONFIG
========================= */

const TZ = "Asia/Karachi";
// ⬅ FIX 2: every 2 minutes all day — enabled=false ticks are a single
// RTDB read, and no confirmed rotation can strand until the next window.
const NOTIFY_CRON = "*/2 * * * *";

const notificationsEnabledRef = rtdb.ref("notifications/enabled");
const pendingRef = rtdb.ref("notifications/pending");
const lastSentWindowIdRef = rtdb.ref("notifications/lastSentWindowId");
// ⬅ FIX 3: phase marker — general topic already sent for this windowId.
const generalSentWindowIdRef = rtdb.ref("notifications/generalSentWindowId");
const notifyLockRef = rtdb.ref("notifications/notifyLock");
const LOCK_TTL_MS = 300_000;

/* =========================
   TOPICS
========================= */

const GENERAL_TOPIC = "stock_updates";
const FRUIT_TOPIC_PREFIX = "fruit-";
// ⬅ FIX 1: FCM allows at most FIVE topics per condition expression.
// 25 produced invalid-argument rejections whenever a rotation carried
// more than 5 unique fruit names.
const MAX_FRUITS_PER_CONDITION = 5;

function slugTopicName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/^\+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_.~%]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildConditionFromTopics(topicNames) {
  return topicNames.map((t) => `'${t}' in topics`).join(" || ");
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
   MAIN
========================= */

exports.sendStockNotifications = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .pubsub.schedule(NOTIFY_CRON)
  .timeZone(TZ)
  .onRun(async () => {
    console.log("RUN sendStockNotifications", new Date().toISOString());

    const enabled = (await notificationsEnabledRef.once("value")).val();
    if (!enabled) {
      console.log("enabled=false — skip.");
      return null;
    }

    const token = crypto.randomBytes(8).toString("hex");
    const gotLock = await acquireLock(notifyLockRef, token);
    if (!gotLock) {
      console.log("Notify lock held — skip.");
      return null;
    }

    try {
      const [pendingSnap, lastSentSnap, generalSentSnap] = await Promise.all([
        pendingRef.once("value"),
        lastSentWindowIdRef.once("value"),
        generalSentWindowIdRef.once("value"),     // ⬅ FIX 3
      ]);

      const pending = pendingSnap.val() || null;
      const lastSentWindowId = lastSentSnap.val() || null;
      const generalSentWindowId = generalSentSnap.val() || null;  // ⬅ FIX 3

      if (!pending?.windowId) {
        console.log("Missing pending — disabling.");
        await notificationsEnabledRef.set(false);
        return null;
      }

      if (lastSentWindowId && lastSentWindowId === pending.windowId) {
        console.log("Already sent this windowId — disabling.");
        await notificationsEnabledRef.set(false);
        return null;
      }

      const inStockNames = Array.isArray(pending.inStockNames) ? pending.inStockNames : [];
      const fruitTopics = [
        ...new Set(
          inStockNames
            .map((n) => FRUIT_TOPIC_PREFIX + slugTopicName(n))
            .filter((t) => t && t !== FRUIT_TOPIC_PREFIX)
        ),
      ];

      // (A) General — skipped on retry if it already went out for this
      // window (⬅ FIX 3: a fruit-send failure must not re-blast everyone).
      if (generalSentWindowId !== pending.windowId) {
        await admin.messaging().send({
          topic: GENERAL_TOPIC,
          notification: {
            title: "Stock Update!",
            body: "Stocks have been updated!",
          },
          data: {
            type: "stock_update",
            windowId: String(pending.windowId),
            tsISO: String(pending.tsISO || ""),
            reason: String(pending.reason || ""),
          },
          android: { collapseKey: "stock_update" },
          apns: { headers: { "apns-collapse-id": "stock_update" } },
        });
        await generalSentWindowIdRef.set(pending.windowId);   // ⬅ FIX 3
        console.log("Sent general topic:", GENERAL_TOPIC);
      } else {
        console.log("General already sent for this window — retrying fruit groups only.");
      }

      // (B) Selected fruits (chunked to FCM's 5-topic condition limit)
      if (fruitTopics.length > 0) {
        for (const group of chunkArray(fruitTopics, MAX_FRUITS_PER_CONDITION)) {
          const condition = buildConditionFromTopics(group);
          await admin.messaging().send({
            condition,
            notification: {
              title: "Selected Fruit Stock Update!",
              body: "One of your selected fruits is now in stock.",
            },
            data: {
              type: "selected_fruit_update",
              windowId: String(pending.windowId),
              tsISO: String(pending.tsISO || ""),
              inStock: JSON.stringify(inStockNames),
            },
            android: { collapseKey: "selected_fruit_update" },
            apns: { headers: { "apns-collapse-id": "selected_fruit_update" } },
          });
          console.log("Sent selected-fruit group size:", group.length);
        }
      } else {
        console.log("No fruit topics.");
      }

      await Promise.all([
        lastSentWindowIdRef.set(pending.windowId),
        notificationsEnabledRef.set(false),
      ]);
      console.log("enabled=false, windowId=", pending.windowId);
      return null;
    } catch (e) {
      console.error("Notifier failed:", e?.code, e?.message || e);
      return null;
    } finally {
      await releaseLock(notifyLockRef, token);
    }
  });
