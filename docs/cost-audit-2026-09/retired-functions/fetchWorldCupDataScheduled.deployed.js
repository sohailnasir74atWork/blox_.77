/**
 * fetchWorldCupData — populates the World Cup 2026 prediction feed.
 *
 * WHAT IT DOES
 *   1. Fetches the tournament fixtures/results from a public source.
 *   2. Normalizes them into our Match schema (see Code/WorldCup/worldCupHelpers.js).
 *   3. Folds in the community vote tallies from wc2026_predictions/{id}.
 *   4. Writes ONE document: wc2026_meta/feed  → { today, upcoming, recent, generatedAt }.
 *      Clients read that single doc (1 read serves the whole screen).
 *
 * DATA SOURCE
 *   Default: openfootball/worldcup.json — public domain, NO API KEY required, so
 *   this works the moment it's deployed. Results can lag the live match by a few
 *   hours, which is fine: this is a prediction game, not a live-scores product.
 *
 *   Upgrade path: set the env var WC_SOURCE_URL to any endpoint that returns the
 *   same { matches: [...] } shape, or implement an API-Football adapter inside
 *   buildMatches() guarded on process.env.APIFOOTBALL_KEY for true live scores.
 *
 * EXPORTS (wire both into your functions index.js / deploy entry):
 *   • fetchWorldCupDataScheduled — pubsub, every 30 min. The production updater.
 *   • fetchWorldCupDataNow       — HTTPS, call once after deploy to seed the doc
 *                                  immediately instead of waiting for the schedule.
 *
 * SCHEDULE NOTE
 *   30 min is deliberately coarse. We don't sell goal-by-goal scores, so there's
 *   no need to poll the source hard. It keeps us comfortably inside any free API
 *   tier and keeps Firestore writes minimal (one feed-doc write per run).
 */

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const axios = require("axios");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const DEFAULT_SOURCE =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

// How many fixtures to surface for voting / recap.
const UPCOMING_LIMIT = 14;
const RECENT_LIMIT = 8;
const RECENT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // finished matches from the last 2 days

// ── Country name → ISO-3166-1 alpha-2 (drives flag emojis on the client). ──
// Placeholders like "Winner Group A" / "1A" simply won't match and render as text.
const NAME_TO_ISO2 = {
  Argentina: "AR", Australia: "AU", Austria: "AT", Belgium: "BE", Brazil: "BR",
  Cameroon: "CM", Canada: "CA", Colombia: "CO", "Costa Rica": "CR", Croatia: "HR",
  Denmark: "DK", Ecuador: "EC", Egypt: "EG", England: "GB", France: "FR",
  Germany: "DE", Ghana: "GH", Greece: "GR", "Ivory Coast": "CI", Iran: "IR",
  Italy: "IT", Japan: "JP", Mexico: "MX", Morocco: "MA", Netherlands: "NL",
  "New Zealand": "NZ", Nigeria: "NG", Norway: "NO", Panama: "PA", Paraguay: "PY",
  Peru: "PE", Poland: "PL", Portugal: "PT", Qatar: "QA", "Saudi Arabia": "SA",
  Scotland: "GB", Senegal: "SN", Serbia: "RS", "South Africa": "ZA",
  "South Korea": "KR", "Korea Republic": "KR", Spain: "ES", Sweden: "SE",
  Switzerland: "CH", Tunisia: "TN", Turkey: "TR", Ukraine: "UA",
  "United States": "US", USA: "US", Uruguay: "UY", Wales: "GB", Algeria: "DZ",
  Jordan: "JO", Uzbekistan: "UZ", "Cape Verde": "CV", Honduras: "HN",
  Jamaica: "JM", "Curacao": "CW", Haiti: "HT", Bolivia: "BO", "DR Congo": "CD",
};

const iso2 = (name) => NAME_TO_ISO2[String(name || "").trim()] || null;

// Parse openfootball date+time into a UTC ISO instant.
// time looks like "13:00 UTC-6" (offset is the venue's local offset from UTC).
function toKickoffISO(date, time) {
  if (!date) return null;
  const m = String(time || "").match(/(\d{1,2}):(\d{2})\s*UTC([+-]\d{1,2})?/);
  if (!m) {
    // No usable time — anchor at local noon of the date so day-grouping still works.
    return new Date(`${date}T12:00:00Z`).toISOString();
  }
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const offset = m[3] ? parseInt(m[3], 10) : 0;
  // Local time at venue = hh:mm; UTC = local - offset.
  const utcHour = hh - offset;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCHours(utcHour, mm, 0, 0);
  return d.toISOString();
}

function statusFor(kickoffISO, hasScore, nowMs) {
  if (hasScore) return "finished";
  if (!kickoffISO) return "scheduled";
  const k = new Date(kickoffISO).getTime();
  if (nowMs >= k && nowMs < k + 2.5 * 60 * 60 * 1000) return "live"; // best-effort window
  return "scheduled";
}

function slugId(date, t1, t2) {
  const s = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${date}_${s(t1)}_vs_${s(t2)}`;
}

// Normalize the raw source into our Match[] (source-specific parsing lives here).
function buildMatches(raw, nowMs) {
  const rawMatches = Array.isArray(raw?.matches) ? raw.matches : [];
  return rawMatches
    .filter((m) => m && m.team1 && m.team2 && m.date)
    .map((m) => {
      const ft = m.score && Array.isArray(m.score.ft) ? m.score.ft : null;
      const hasScore = ft && ft.length === 2 && ft[0] != null && ft[1] != null;
      const kickoffISO = toKickoffISO(m.date, m.time);
      return {
        id: slugId(m.date, m.team1, m.team2),
        date: m.date,
        kickoffISO,
        group: m.group || null,
        round: m.round || null,
        ground: m.ground || null,
        team1: m.team1,
        team2: m.team2,
        code1: iso2(m.team1),
        code2: iso2(m.team2),
        score1: hasScore ? Number(ft[0]) : null,
        score2: hasScore ? Number(ft[1]) : null,
        status: statusFor(kickoffISO, hasScore, nowMs),
        votes: { home: 0, draw: 0, away: 0 },
      };
    });
}

// Fold community tallies into the matches that will be shown (bounded reads).
async function attachVotes(matches) {
  await Promise.all(
    matches.map(async (m) => {
      try {
        const snap = await db.collection("wc2026_predictions").doc(m.id).get();
        if (snap.exists) {
          const v = snap.data() || {};
          m.votes = {
            home: Number(v.home) || 0,
            draw: Number(v.draw) || 0,
            away: Number(v.away) || 0,
          };
        }
      } catch (e) {
        // Non-fatal: a missing tally just shows 0%.
        console.warn(`vote fold failed for ${m.id}: ${e.message}`);
      }
    }),
  );
}

// Core routine shared by the scheduled + on-demand exports.
async function runSync() {
  const url = process.env.WC_SOURCE_URL || DEFAULT_SOURCE;
  const nowMs = Date.now();

  const res = await axios.get(url, { timeout: 15000 });
  const all = buildMatches(res.data, nowMs);
  if (all.length === 0) {
    console.warn("⚠️ No matches parsed from source — leaving feed untouched.");
    return { wrote: false, count: 0 };
  }

  const byKickoff = (a, b) =>
    new Date(a.kickoffISO || a.date).getTime() - new Date(b.kickoffISO || b.date).getTime();

  const todayStr = new Date(nowMs).toISOString().slice(0, 10);
  const today = all.filter((m) => m.date === todayStr).sort(byKickoff);

  const upcoming = all
    .filter((m) => m.status === "scheduled" && new Date(m.kickoffISO || m.date).getTime() >= nowMs)
    .sort(byKickoff)
    .slice(0, UPCOMING_LIMIT);

  const recent = all
    .filter(
      (m) =>
        m.status === "finished" &&
        nowMs - new Date(m.kickoffISO || m.date).getTime() <= RECENT_WINDOW_MS,
    )
    .sort((a, b) => byKickoff(b, a))
    .slice(0, RECENT_LIMIT);

  // Only the surfaced matches need vote tallies.
  await attachVotes([...today, ...upcoming]);

  await db.collection("wc2026_meta").doc("feed").set({
    today,
    upcoming,
    recent,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    source: url,
  });

  console.log(
    `✅ WC feed updated — today:${today.length} upcoming:${upcoming.length} recent:${recent.length}`,
  );
  return { wrote: true, today: today.length, upcoming: upcoming.length, recent: recent.length };
}

// Production updater: every 30 minutes.
exports.fetchWorldCupDataScheduled = functions.pubsub
  .schedule("every 30 minutes")
  .onRun(async () => {
    try {
      await runSync();
    } catch (err) {
      console.error("❌ fetchWorldCupDataScheduled error:", err.message);
    }
    return null;
  });

// On-demand seed/refresh: GET this URL once after deploy to populate the feed now.
exports.fetchWorldCupDataNow = functions.https.onRequest(async (req, res) => {
  try {
    const result = await runSync();
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("❌ fetchWorldCupDataNow error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
