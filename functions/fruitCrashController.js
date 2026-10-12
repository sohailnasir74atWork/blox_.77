/**
 * Blox Fruit — Cloud Functions
 *
 * fruitCrashController:
 *   Runs every minute via Cloud Scheduler (pub/sub).
 *   Manages the global Fruit Crash round lifecycle:
 *
 *   Round cycle (total ~45s):
 *     0s  — waiting  (10s) — players see "Next round in Xs"
 *     10s — running         — multiplier climbs on client
 *     ??s — crashed         — server writes crashPoint + crashedAt timestamp
 *     5s  — results         — clients show leaderboard
 *
 *   RTDB structure:
 *     fruitCrash/
 *       currentRound/
 *         roundId:      "r_1712051234567"
 *         phase:        "waiting" | "running" | "crashed"
 *         startTime:    1712051244567   (ms — when multiplier started at 1.0)
 *         crashPoint:   8.42            (revealed only after crash)
 *         crashedAt:    1712051264321   (ms — when crash happened)
 *         playerCount:  12
 *       cashouts/
 *         {uid}:
 *           name:       "Node_12"
 *           avatar:     "https://..."
 *           multiplier: 3.24
 *           cashedAt:   1712051251000   (ms)
 *       leaderboard/          ← all-time top 20 best multipliers
 *         {uid}:
 *           name:       "Node_12"
 *           avatar:     "..."
 *           best:       47.3
 *           totalRounds: 312
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.database();

// ─── Crash point generator (server-side = cheat-proof) ───
// Uses crypto-grade randomness + inverse CDF so no pattern is learnable.
// The distribution is intentionally chaotic — mixing multiple random
// sources means even analyzing 10,000 rounds reveals no exploitable pattern.
const crypto = require('crypto');

// No round crashes above this; also the bound the leaderboard is checked against.
const MAX_CRASH_POINT = 150;

const generateCrashPoint = () => {
  // 1. Crypto-random float [0, 1) — not Math.random, unpredictable
  const bytes = crypto.randomBytes(4);
  const r1 = bytes.readUInt32BE(0) / 0xFFFFFFFF;

  // 2. Second independent random for chaos mixing
  const bytes2 = crypto.randomBytes(4);
  const r2 = bytes2.readUInt32BE(0) / 0xFFFFFFFF;

  // 3. House edge: ~3% instant crash (feels random, not "always first")
  if (r1 < 0.03 && r2 < 0.5) return 1.0;
  if (r1 < 0.05 && r2 > 0.8) return parseFloat((1.0 + r2 * 0.3).toFixed(2));

  // 4. Inverse transform — provably fair exponential distribution
  //    E = 1 / (1 - r), then apply chaos multiplier from r2
  //    This makes every crash point equally "surprising"
  const houseEdge = 0.97; // 3% edge
  const base = houseEdge / (1 - r1);

  // 5. Chaos jitter: ±15% random wobble so even same base = different result
  const jitter = 1 + (r2 - 0.5) * 0.3;
  let crash = base * jitter;

  // 6. Soft cap at 150x (prevent absurd outliers eating attention)
  crash = Math.min(crash, MAX_CRASH_POINT);

  // 7. Floor at 1.01 (must always be possible to cash out)
  crash = Math.max(crash, 1.01);

  return parseFloat(crash.toFixed(2));
};

// ─── How long the rocket flies before crashing (ms) ──────
// Growth rate mirrors client: 0.03/tick at low, 0.12/tick at high, 100ms ticks
const estimateCrashDuration = (crashPoint) => {
  let mult = 1.0;
  let ms = 0;
  while (mult < crashPoint) {
    const growth = mult < 2 ? 0.03 : mult < 5 ? 0.05 : mult < 10 ? 0.08 : 0.12;
    mult = parseFloat((mult + growth).toFixed(2));
    ms += 100;
    if (ms > 120000) break; // safety cap at 2 min
  }
  return ms;
};

// ─── Main round controller ────────────────────────────────
// Called by Cloud Scheduler every 1 minute.
// One invocation handles: start new round → schedule crash.
// The next invocation 1 min later starts the next round.
exports.fruitCrashController = onSchedule('every 1 minutes', async () => {
  const roundRef = db.ref('fruitCrash/currentRound');
  const cashoutsRef = db.ref('fruitCrash/cashouts');

  const snap = await roundRef.once('value');
  const current = snap.val();

  const now = Date.now();

  // ── If no round exists or previous round is done → start new ──
  if (!current || current.phase === 'crashed') {
    const crashPoint = generateCrashPoint();
    const roundId = `r_${now}`;
    const waitDuration = 10000; // 10s waiting phase
    const startTime = now + waitDuration;
    const crashDuration = estimateCrashDuration(crashPoint);
    const crashedAt = startTime + crashDuration;

    // Write new round as "waiting"
    await roundRef.set({
      roundId,
      phase: 'waiting',
      startTime,        // when multiplier starts ticking on client
      crashPoint: null, // hidden until crash
      crashedAt: null,
      createdAt: now,
      playerCount: 0,
    });

    // Clear previous cashouts
    await cashoutsRef.remove();

    // Schedule phase transitions using setTimeout
    // waiting → running after waitDuration
    setTimeout(async () => {
      await roundRef.update({ phase: 'running' });
    }, waitDuration);

    // running → crashed after startTime + crashDuration
    setTimeout(async () => {
      await roundRef.update({
        phase: 'crashed',
        crashPoint,
        crashedAt: Date.now(),
      });

      // Update leaderboard for anyone who cashed out
      await updateLeaderboard(crashPoint);

    }, waitDuration + crashDuration);

    console.log(`[FruitCrash] New round ${roundId} — crash at ${crashPoint}x in ${Math.round((waitDuration + crashDuration) / 1000)}s`);
    return;
  }

  // ── Round already running — nothing to do (setTimeout handles it) ──
  console.log(`[FruitCrash] Round ${current.roundId} in phase: ${current.phase}`);
});

// ─── Update all-time leaderboard ─────────────────────────
async function updateLeaderboard(roundCrashPoint) {
  const cashoutsSnap = await db.ref('fruitCrash/cashouts').once('value');
  if (!cashoutsSnap.exists()) return;

  const cashouts = cashoutsSnap.val();
  const updates = {};

  for (const [uid, data] of Object.entries(cashouts)) {
    // Cashouts are written by the app (rules: own uid only, any value). Count
    // only a multiplier the rocket reached this round; anything above the
    // crash point was typed in, not played (2026-10-11 audit).
    const mult = Number(data?.multiplier);
    if (!Number.isFinite(mult) || mult < 1 || mult > roundCrashPoint) {
      console.warn(`[FruitCrash] ignored cashout ${uid}: ${data?.multiplier}x (crashed at ${roundCrashPoint}x)`);
      continue;
    }

    const lbRef = db.ref(`fruitCrash/leaderboard/${uid}`);
    const lbSnap = await lbRef.once('value');
    const existing = lbSnap.val() || {};

    const newBest = Math.max(existing.best || 0, mult);
    updates[`fruitCrash/leaderboard/${uid}`] = {
      name: String(data.name || 'Trader').slice(0, 40),
      avatar: data.avatar || null,
      best: newBest,
      totalRounds: (existing.totalRounds || 0) + 1,
      lastSeen: Date.now(),
    };
  }

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
  }

  // ── Prune: keep only top 30 entries, and drop impossible ones (above the
  // 150x cap generateCrashPoint never exceeds — entries saved before the
  // check above).
  const fullSnap = await db.ref('fruitCrash/leaderboard').once('value');
  if (!fullSnap.exists()) return;
  const pruneUpdates = {};
  const all = Object.entries(fullSnap.val())
    .map(([uid, d]) => ({ uid, best: Number(d?.best) || 0 }))
    .filter(({ uid, best }) => {
      if (best <= MAX_CRASH_POINT) return true;
      pruneUpdates[`fruitCrash/leaderboard/${uid}`] = null;
      return false;
    })
    .sort((a, b) => b.best - a.best);

  all.slice(30).forEach(({ uid }) => {
    pruneUpdates[`fruitCrash/leaderboard/${uid}`] = null;
  });
  if (Object.keys(pruneUpdates).length > 0) {
    await db.ref().update(pruneUpdates);
  }
}

// ─── HTTP trigger: manual round reset (admin use) ─────────
exports.resetFruitCrashRound = onRequest(async (req, res) => {
  // Simple token check — set RESET_TOKEN in Firebase env
  const token = req.query.token;
  if (token !== process.env.RESET_TOKEN) {
    res.status(403).send('Forbidden');
    return;
  }

  await db.ref('fruitCrash/currentRound').remove();
  await db.ref('fruitCrash/cashouts').remove();
  res.send('Round reset. Next scheduler tick will start a new round.');
});

exports._internal = { updateLeaderboard, MAX_CRASH_POINT };
