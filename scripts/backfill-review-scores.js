// One-shot backfill (2026-09): score every existing review with the same rules
// the scoreReviewOnWrite trigger uses (functions/reviewSignals.js), and build
// review_verified_summary for every reviewed user. Until this has run, the
// Top Rated job keeps using the old client-maintained user_ratings_summary.
//
// Everything is computed in memory from one pass over `reviews` (~113k docs),
// Firebase Auth (account exists / created) and RTDB users/{uid}/deviceId.
// The private-chat check is skipped here (historic chats may be gone): a
// review keeps the chat verdict already stored in review_scores (taken by
// scoreReviewOnWrite when it was created), otherwise it is unknown.
// After a --write run, run scripts/recount-review-summaries.js --write so
// the profile ratings (user_ratings_summary) follow (2026-10-19).
//
// Idempotent: a full recompute that overwrites review_scores and
// review_verified_summary. Run it once before deploying scoreReviewOnWrite and
// once right after, so reviews written in between are included.
//
// Run from the repo root (serviceAccount.json must exist there):
//   node scripts/backfill-review-scores.js            # dry run: report only
//   node scripts/backfill-review-scores.js --write    # write the results
//
// Cost: ~113k Firestore reads per run; --write adds ~135k writes (≈ $0.35).

const path = require('path');
const admin = require('firebase-admin');
const { evaluateReview, storedChat, emptyTally, addScore, isScamHold, isScamWatch, BURST_WINDOW_MS } =
  require(path.join(__dirname, '..', 'functions', 'reviewSignals'));

const serviceAccount = require(path.join(__dirname, '..', 'serviceAccount.json'));
const WRITE = process.argv.includes('--write');
const PAGE = 5000;
const CONCURRENCY = 50;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`,
});
const fs = admin.firestore();
const rtdb = admin.database();

const toMillis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : null);

async function loadReviews() {
  const out = [];
  let last = null;
  for (;;) {
    let q = fs.collection('reviews')
      .select('fromUserId', 'toUserId', 'rating', 'review', 'createdAt', 'updatedAt')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) {
      const r = d.data();
      if (!r.fromUserId || !r.toUserId) continue;
      out.push({ id: d.id, ...r, createdAtMs: toMillis(r.createdAt) || toMillis(r.updatedAt) || 0 });
    }
    process.stdout.write(`\rreviews: ${out.length}`);
    if (snap.size < PAGE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  console.log();
  return out;
}

// Chat verdicts taken when each review was created (see storedChat).
async function loadChatVerdicts() {
  const out = new Map();
  let last = null;
  for (;;) {
    let q = fs.collection('review_scores')
      .select('chat', 'hard', 'soft', 'scoredAt', 'reviewCreatedAt')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) {
      const chat = storedChat(d.data());
      if (chat !== null && chat !== undefined) out.set(d.id, chat);
    }
    if (snap.size < PAGE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  console.log(`stored chat verdicts: ${out.size}`);
  return out;
}

async function pool(items, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  }));
}

async function loadAccounts(uids) {
  const accounts = new Map();
  const batches = [];
  for (let i = 0; i < uids.length; i += 100) batches.push(uids.slice(i, i + 100));
  let done = 0;
  await pool(batches, async (batch) => {
    const res = await admin.auth().getUsers(batch.map((uid) => ({ uid })));
    for (const u of res.users) accounts.set(u.uid, Date.parse(u.metadata.creationTime) || null);
    done += batch.length;
    process.stdout.write(`\rauth: ${done}/${uids.length}`);
  });
  console.log();
  return accounts;
}

async function loadDevices(uids) {
  const devices = new Map();
  let done = 0;
  await pool(uids, async (uid) => {
    const v = (await rtdb.ref(`users/${uid}/deviceId`).once('value')).val();
    if (typeof v === 'string' && v) devices.set(uid, v);
    if (++done % 1000 === 0) process.stdout.write(`\rdevices: ${done}/${uids.length}`);
  });
  console.log(`\rdevices: ${uids.length}/${uids.length} (${devices.size} known)`);
  return devices;
}

async function main() {
  const t0 = Date.now();
  const reviews = await loadReviews();
  const chats = await loadChatVerdicts();
  const uids = [...new Set(reviews.flatMap((r) => [r.fromUserId, r.toUserId]))];
  const accounts = await loadAccounts(uids);
  const devices = await loadDevices(uids);

  // Reverse reviews, per-reviewee timelines, and first review per (reviewee, device).
  const byId = new Map(reviews.map((r) => [r.id, r]));
  const timeline = new Map();
  const deviceGroups = new Map();
  for (const r of reviews) {
    if (!timeline.has(r.toUserId)) timeline.set(r.toUserId, []);
    timeline.get(r.toUserId).push(r.createdAtMs);
    const dev = devices.get(r.fromUserId);
    if (dev && r.fromUserId !== r.toUserId) {
      const k = `${r.toUserId}|${dev}`;
      if (!deviceGroups.has(k)) deviceGroups.set(k, []);
      deviceGroups.get(k).push(r);
    }
  }
  for (const t of timeline.values()) t.sort((a, b) => a - b);
  const duplicateDevice = new Set();
  for (const group of deviceGroups.values()) {
    group.sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
    group.slice(1).forEach((r) => duplicateDevice.add(r.id));
  }
  const countBefore = (arr, lo, hi) => {
    // number of values in [lo, hi) of a sorted array
    const lb = (x) => { let a = 0, b = arr.length; while (a < b) { const m = (a + b) >> 1; if (arr[m] < x) a = m + 1; else b = m; } return a; };
    return lb(hi) - lb(lo);
  };

  const scores = new Map();
  const summaries = new Map();
  const flagCounts = {};
  for (const r of reviews) {
    const reverse = byId.get(`${r.fromUserId}_${r.toUserId}`);
    const verdict = evaluateReview({
      reviewId: r.id,
      review: r,
      createdAtMs: r.createdAtMs,
      reviewerExists: accounts.has(r.fromUserId),
      reviewerCreatedAtMs: accounts.get(r.fromUserId) || null,
      reviewerDevice: devices.get(r.fromUserId) || null,
      revieweeDevice: devices.get(r.toUserId) || null,
      earlierSameDevice: duplicateDevice.has(r.id),
      reverseCreatedAtMs: reverse ? reverse.createdAtMs : null,
      recentReceivedCount: countBefore(timeline.get(r.toUserId), r.createdAtMs - BURST_WINDOW_MS, r.createdAtMs),
      hasChat: chats.has(r.id) ? chats.get(r.id) : null,
    });
    const score = { fromUserId: r.fromUserId, toUserId: r.toUserId, rating: r.rating, ...verdict,
      chat: chats.has(r.id) ? chats.get(r.id) : null,
      reviewerDevice: devices.get(r.fromUserId) || null, reviewCreatedAtMs: r.createdAtMs };
    scores.set(r.id, score);
    for (const f of [...verdict.hard, ...verdict.soft]) flagCounts[f] = (flagCounts[f] || 0) + 1;

    // emptyTally has every key contribution() returns (incl. the profile
    // tallies), so no field starts undefined and turns into NaN.
    summaries.set(r.toUserId, addScore(summaries.get(r.toUserId) || emptyTally(), score));
  }

  // Report
  const counted = [...scores.values()].filter((s) => s.counted).length;
  console.log(`\n${reviews.length} reviews: ${counted} count, ${reviews.length - counted} excluded`);
  console.log('flags:', flagCounts);
  const rank = [...summaries.entries()]
    .map(([uid, s]) => ({ uid, ...s, avg: s.count ? s.sum / s.count : 0 }))
    .filter((u) => u.count > 0 && u.avg >= 3.7);
  const held = rank.filter(isScamHold);
  const board = rank.filter((u) => !isScamHold(u)).sort((a, b) => b.count - a.count || b.avg - a.avg).slice(0, 50);
  const nameOf = async (uid) => String((await rtdb.ref(`users/${uid}/displayName`).once('value')).val()).slice(0, 24);
  console.log(`\nverified top 50 (${held.length} held for scam reports; W = on watch list):`);
  for (const [i, u] of board.entries()) {
    console.log(`  ${String(i + 1).padStart(2)}. ${(await nameOf(u.uid)).padEnd(24)} ${u.count} verified (${u.excludedCount} excluded, ${u.flaggedCount} flagged) avg ${u.avg.toFixed(2)} scam ${u.scamReports}${isScamWatch(u) ? ' W' : ''}`);
  }
  console.log('\nheld (would have ranked in the top 50):');
  const cutoff = board.length ? board[board.length - 1].count : 0;
  for (const u of held.filter((h) => h.count >= cutoff).sort((a, b) => b.count - a.count)) {
    console.log(`  ${(await nameOf(u.uid)).padEnd(24)} ${u.count} verified, ${u.scamReports} scam reports (${(100 * u.scamReports / u.count).toFixed(1)}%)`);
  }

  if (!WRITE) {
    console.log(`\nDRY RUN — nothing written (${((Date.now() - t0) / 1000).toFixed(0)}s). Re-run with --write.`);
    process.exit(0);
  }

  const writer = fs.bulkWriter();
  writer.onWriteError((err) => err.failedAttempts < 5);
  const now = admin.firestore.FieldValue.serverTimestamp();
  for (const [id, s] of scores) {
    const { reviewCreatedAtMs, ...rest } = s;
    writer.set(fs.collection('review_scores').doc(id), {
      ...rest,
      reviewCreatedAt: admin.firestore.Timestamp.fromMillis(reviewCreatedAtMs || 0),
      scoredAt: now,
      version: 2,
    });
  }
  for (const [uid, s] of summaries) {
    writer.set(fs.collection('review_verified_summary').doc(uid), {
      ...s,
      averageRating: s.count ? Math.round((s.sum / s.count) * 100) / 100 : 0,
      updatedAt: now,
    }, { merge: true });
  }
  await writer.close();
  console.log(`\nWROTE ${scores.size} scores + ${summaries.size} summaries in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  process.exit(0);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
