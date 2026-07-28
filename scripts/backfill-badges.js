// One-shot backfill: grant achievement badges to users who already crossed the
// thresholds but never received them (the grant code wasn't wired up until now —
// see badgeUtils.js). Also seeds users/{uid}/counters/reviewCount so the runtime
// Reviewer counter keeps incrementing accurately after this runs.
//
// Badges granted (idempotent — only writes a badge that isn't already `true`):
//   Trades   → firstTrade(5)  starTrader(25)  diamondTrader(100)  centurion(250)
//              source: RTDB tradeStats/{uid}.total  (authoritative running count)
//   NightOwl → nightOwl (15 trades logged 00:00–05:00 UTC)
//              source: RTDB tradeJournal/{uid}/*.completedAt
//   Reviewer → reviewer (25+ reviews GIVEN)
//              source: Firestore reviews where fromUserId == uid
//   5-Star   → fiveStar (50+ reviews received, 4.5+ average)
//              source: Firestore reviews where toUserId == uid
//   Influencer → influencer (200+ followers)
//              source: Firestore following where followingId == uid
//
// Badge storage matches the app: RTDB users/{uid}/badges/{badgeId} = true
// (this is what BadgesScreen reads via computeBadges).
//
// Run:
//   node scripts/backfill-badges.js            # DRY RUN — prints what it would grant
//   APPLY=1 node scripts/backfill-badges.js    # actually writes
//   NIGHTOWL=1 node scripts/backfill-badges.js # also scan tradeJournal for Night Owl
//
// Cost note: the Night Owl scan downloads the ENTIRE tradeJournal tree (all users'
// trade history — billed by bytes), so it's OFF by default. Trades/reviews/follows
// backfill from small per-user nodes and Firestore aggregates and are always run.
//
// Prereqs: serviceAccount.json at project root (same as the other backfill scripts).

const path = require('path');
const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json');
let serviceAccount;
try {
  serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (e) {
  console.error(`\n❌ Could not load ${SERVICE_ACCOUNT_PATH}\n`);
  process.exit(1);
}

const RTDB_URL = process.env.RTDB_URL ||
  `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;
const APPLY = process.env.APPLY === '1';
const SCAN_NIGHTOWL = process.env.NIGHTOWL === '1';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: RTDB_URL,
});
const db = admin.database();
const fs = admin.firestore();

// Mirror of badgeUtils.js thresholds (kept literal — that module is RN/ESM).
const TRADE_THRESHOLDS = [
  { count: 5, badgeId: 'firstTrade' },
  { count: 25, badgeId: 'starTrader' },
  { count: 100, badgeId: 'diamondTrader' },
  { count: 250, badgeId: 'centurion' },
];
const REVIEW_THRESHOLD = 25;      // reviewer
const FIVESTAR_MIN_COUNT = 50;    // fiveStar
const FIVESTAR_MIN_AVG = 4.5;     // fiveStar
const NIGHTOWL_THRESHOLD = 15;    // nightOwl
const INFLUENCER_THRESHOLD = 200; // influencer

// grants: Map<uid, Set<badgeId>>
const grants = new Map();
const addGrant = (uid, badgeId) => {
  if (!uid) return;
  if (!grants.has(uid)) grants.set(uid, new Set());
  grants.get(uid).add(badgeId);
};

async function main() {
  console.log(`\n🏅 Badge backfill — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

  // ── 1. Trades: firstTrade / starTrader / diamondTrader / centurion ──
  const statsSnap = await db.ref('tradeStats').get();
  const stats = statsSnap.val() || {};
  for (const [uid, s] of Object.entries(stats)) {
    const total = (s && typeof s.total === 'number') ? s.total : 0;
    for (const { count, badgeId } of TRADE_THRESHOLDS) {
      if (total >= count) addGrant(uid, badgeId);
    }
  }
  console.log(`• tradeStats: scanned ${Object.keys(stats).length} users`);

  // ── 2. Night Owl: 15+ trades logged between 00:00–05:00 UTC ──
  // Off by default — downloads the whole tradeJournal tree (billed by bytes).
  if (SCAN_NIGHTOWL) {
    const journalSnap = await db.ref('tradeJournal').get();
    const journal = journalSnap.val() || {};
    for (const [uid, trades] of Object.entries(journal)) {
      let nightCount = 0;
      for (const t of Object.values(trades || {})) {
        const ts = t && t.completedAt;
        if (typeof ts === 'number') {
          const h = new Date(ts).getUTCHours();
          if (h >= 0 && h < 5) nightCount++;
        }
      }
      if (nightCount >= NIGHTOWL_THRESHOLD) addGrant(uid, 'nightOwl');
    }
    console.log(`• tradeJournal: scanned ${Object.keys(journal).length} users for Night Owl`);
  } else {
    console.log('• tradeJournal: SKIPPED Night Owl scan (set NIGHTOWL=1 to include)');
  }

  // ── 3. Reviews (Firestore): reviewer (given) + fiveStar (received) ──
  const reviewsSnap = await fs.collection('reviews').get();
  const givenCount = new Map();  // fromUserId -> # reviews given
  const recvAgg = new Map();     // toUserId   -> { sum, count } of ratings received
  reviewsSnap.forEach((docSnap) => {
    const d = docSnap.data() || {};
    if (d.fromUserId) givenCount.set(d.fromUserId, (givenCount.get(d.fromUserId) || 0) + 1);
    const r = d.rating;
    if (d.toUserId && typeof r === 'number' && r > 0) {
      const cur = recvAgg.get(d.toUserId) || { sum: 0, count: 0 };
      cur.sum += r; cur.count += 1;
      recvAgg.set(d.toUserId, cur);
    }
  });
  for (const [uid, cnt] of givenCount.entries()) {
    if (cnt >= REVIEW_THRESHOLD) addGrant(uid, 'reviewer');
  }
  for (const [uid, { sum, count }] of recvAgg.entries()) {
    const avg = count > 0 ? sum / count : 0;
    if (count >= FIVESTAR_MIN_COUNT && avg >= FIVESTAR_MIN_AVG) addGrant(uid, 'fiveStar');
  }
  console.log(`• reviews: ${reviewsSnap.size} docs, ${givenCount.size} reviewers, ${recvAgg.size} reviewed users`);

  // ── 4. Following (Firestore): influencer ──
  const followSnap = await fs.collection('following').get();
  const followers = new Map(); // followingId -> follower count
  followSnap.forEach((docSnap) => {
    const d = docSnap.data() || {};
    if (d.followingId) followers.set(d.followingId, (followers.get(d.followingId) || 0) + 1);
  });
  for (const [uid, cnt] of followers.entries()) {
    if (cnt >= INFLUENCER_THRESHOLD) addGrant(uid, 'influencer');
  }
  console.log(`• following: ${followSnap.size} docs, ${followers.size} followed users`);

  // ── Build the write set (skip badges already present) ──
  const updates = {};
  let toGrant = 0, alreadyHad = 0, usersAffected = 0;
  for (const [uid, badgeIds] of grants.entries()) {
    const existingSnap = await db.ref(`users/${uid}/badges`).get();
    const existing = existingSnap.val() || {};
    let wroteForUser = false;
    for (const badgeId of badgeIds) {
      if (existing[badgeId] === true) { alreadyHad++; continue; }
      updates[`users/${uid}/badges/${badgeId}`] = true;
      toGrant++; wroteForUser = true;
      console.log(`   grant ${badgeId.padEnd(14)} → ${uid}`);
    }
    if (wroteForUser) usersAffected++;
  }

  // Seed reviewCount for every reviewer (even below the badge threshold) so the
  // runtime incrementAndCheckBadge counter stays accurate going forward.
  let counters = 0;
  for (const [uid, cnt] of givenCount.entries()) {
    updates[`users/${uid}/counters/reviewCount`] = cnt;
    counters++;
  }

  console.log(`\n📊 ${toGrant} badges to grant across ${usersAffected} users (${alreadyHad} already had theirs).`);
  console.log(`   ${counters} reviewCount counters to seed.`);

  if (!APPLY) {
    console.log('\n(dry run — set APPLY=1 to write)\n');
    process.exit(0);
  }

  const entries = Object.entries(updates);
  if (entries.length === 0) {
    console.log('\nNothing to write.\n');
    process.exit(0);
  }

  const CHUNK = 400;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = Object.fromEntries(entries.slice(i, i + CHUNK));
    await db.ref().update(slice);
    console.log(`   wrote ${Math.min(i + CHUNK, entries.length)}/${entries.length} paths`);
  }
  console.log(`\n✅ Applied ${entries.length} updates.\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌ Backfill failed:', e);
  process.exit(1);
});
