/**
 * Emulator suite for functions/reviewIntegrity.js + scripts/recount-review-summaries.js
 * (2026-10-19: no-chat reviews stop counting; the profile rating is server-kept).
 *
 * From the Blox_Fruit directory:
 *   firebase emulators:exec --config functions/firebase.test.json --only auth,database,firestore \
 *     --project demo-fruiteblocks 'node functions/test/reviewIntegrity.test.js'
 *
 * Runs the trigger code in-process against the emulators with a fake Supabase
 * client (counts private messages per sender). The Admin SDK bypasses rules,
 * so this tests the server logic; firestore.rules is covered by
 * scripts/test-rules/run.js. Reviews use the exact shapes old app builds and
 * the old website write.
 */
const assert = require('assert');
const path = require('path');
const { execFile } = require('child_process');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-fruiteblocks';
const DB_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT, databaseURL: `http://${DB_HOST}?ns=${PROJECT}` });
process.env.GCLOUD_PROJECT = PROJECT;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = require('firebase-admin');
const RI = require('../reviewIntegrity')._internal;

const DAY = 24 * 60 * 60 * 1000;
const fs = () => admin.firestore();
const { Timestamp } = admin.firestore;

// ── fake Supabase: chats[chatId][senderId] = message count ──
const chats = {};
const lookups = { n: 0 };
const pairId = (a, b) => [a, b].sort().join('_');
const chat = (a, b, na = 2, nb = 2) => { chats[pairId(a, b)] = { [a]: na, [b]: nb }; };
const purge = (a, b) => { delete chats[pairId(a, b)]; };
function fakeSupabase({ down = false } = {}) {
  return {
    from() {
      const f = {};
      const q = {
        select() { return q; },
        eq(k, v) { f[k] = v; return q; },
        then(resolve, reject) {
          lookups.n += 1;
          const res = down ? { count: null, error: { message: 'down' } } : { count: (chats[f.chat_id] || {})[f.sender_id] || 0, error: null };
          return Promise.resolve(res).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

// Old app (PrivateChat handleRating) / website (submitReview) review shape.
const reviewDoc = (from, to, rating, extra = {}) => ({
  fromUserId: from, toUserId: to, rating, userName: 'n', review: extra.review ?? null,
  createdAt: extra.createdAt || Timestamp.now(), updatedAt: Timestamp.now(), edited: !!extra.edited,
});
const rid = (from, to) => `${to}_${from}`;
async function write(from, to, rating, extra = {}) {
  const ref = fs().collection('reviews').doc(rid(from, to));
  const beforeSnap = await ref.get();
  const before = beforeSnap.exists ? beforeSnap.data() : null;
  const after = { ...(before || {}), ...reviewDoc(from, to, rating, { ...extra, createdAt: before?.createdAt || extra.createdAt }) };
  await ref.set(after);
  return RI.onReviewWrite(rid(from, to), before, after);
}
async function remove(from, to) {
  const ref = fs().collection('reviews').doc(rid(from, to));
  const before = (await ref.get()).data();
  await ref.delete();
  return RI.onReviewWrite(rid(from, to), before, null);
}
const get = async (coll, id) => (await fs().collection(coll).doc(id).get()).data();
const profile = async (uid) => { const d = (await get('user_ratings_summary', uid)) || {}; return { count: d.count, averageRating: d.averageRating }; };
const score = (from, to) => get('review_scores', rid(from, to));

let pass = 0;
async function test(name, fn) {
  try { await fn(); pass += 1; console.log(`ok   ${name}`); } catch (e) { console.error(`FAIL ${name}\n     ${e.stack || e.message}`); process.exitCode = 1; }
}

const T = 'traderAAAA001';        // reviewee
const OLDT = 'traderBBBB001';     // reviewee with pre-2026-10-19 data (v1 scores, no profile tallies)
const FIVE = 'traderFIVE001';     // reviewee close to the 5-Star badge
const GONE = 'traderGONE001';     // deleted account (no users/{uid})
const RC = 'traderRCNT001';       // reviewee for the recount script
const MISS = 'traderMISS001';     // scores but no review_verified_summary doc
const NANU = 'traderNANU001';     // summary with damaged (NaN) profile tallies
const GAPU = 'traderGAPU001';     // a review that was never scored
const R = Array.from({ length: 12 }, (_, i) => `reviewer${String(i).padStart(5, '0')}`);

async function seed() {
  const created = new Date(Date.now() - 60 * DAY).toUTCString();
  const uids = [T, OLDT, FIVE, GONE, RC, MISS, NANU, GAPU, ...R];
  const res = await admin.auth().importUsers(uids.map((uid) => ({ uid, email: `${uid.toLowerCase()}@example.com`, metadata: { creationTime: created, lastSignInTime: created } })));
  assert.strictEqual(res.failureCount, 0, JSON.stringify(res.errors));
  const users = {};
  for (const [i, uid] of uids.entries()) users[uid] = { displayName: uid, deviceId: `device-${i}` };
  delete users[GONE];
  await admin.database().ref('users').set(users);
}

// A v1 score as the live trigger/backfill wrote it before 2026-10-19.
function v1Score(from, to, rating, { soft = [], scoredAgoMs = 0, createdAgoMs = 90 * DAY } = {}) {
  const now = Date.now();
  return {
    fromUserId: from, toUserId: to, rating, counted: true, hard: [], soft, scamReport: false,
    reviewerDevice: null, reviewCreatedAt: Timestamp.fromMillis(now - createdAgoMs),
    scoredAt: Timestamp.fromMillis(now - scoredAgoMs), version: 1,
  };
}

async function main() {
  await seed();
  RI.setSupabaseForTest(fakeSupabase());

  await test('profile bio doc (reviews/{uid}) is not a review', async () => {
    assert.strictEqual(await RI.onReviewWrite(T, null, { bio: 'hi', updatedAt: Timestamp.now() }), null);
    assert.strictEqual(await get('review_scores', T), undefined);
  });

  await test('review after a real chat counts everywhere; one lookup', async () => {
    chat(R[0], T);
    lookups.n = 0;
    const s = await write(R[0], T, 5);
    assert.strictEqual(s.counted, true);
    assert.strictEqual(s.chat, true);
    assert.strictEqual(lookups.n, 2); // one chat check = two head counts (one per sender)
    assert.deepStrictEqual(await profile(T), { count: 1, averageRating: 5 });
    const v = await get('review_verified_summary', T);
    assert.strictEqual(v.count, 1);
    assert.strictEqual(v.shownCount, 1);
  });

  await test('review without a chat (website / direct write) counts nowhere', async () => {
    const s = await write(R[1], T, 1, { review: 'scammer' });
    assert.strictEqual(s.counted, false);
    assert.deepStrictEqual(s.hard, ['noChat']);
    assert.strictEqual(s.chat, false);
    assert.strictEqual(s.scamReport, false);
    assert.deepStrictEqual(await profile(T), { count: 1, averageRating: 5 });
    const v = await get('review_verified_summary', T);
    assert.strictEqual(v.count, 1);
    assert.strictEqual(v.excludedCount, 1);
  });

  await test('one-sided chat (reviewer 5 msgs, trader 1) is not a chat', async () => {
    chat(R[2], T, 5, 1);
    const s = await write(R[2], T, 5);
    assert.strictEqual(s.counted, false);
    assert.deepStrictEqual(await profile(T), { count: 1, averageRating: 5 });
  });

  await test('edit of a chatted review after the 30-day purge keeps counting, no lookup', async () => {
    purge(R[0], T);
    lookups.n = 0;
    const s = await write(R[0], T, 4, { edited: true });
    assert.strictEqual(s.counted, true);
    assert.strictEqual(lookups.n, 0);
    assert.deepStrictEqual(await profile(T), { count: 1, averageRating: 4 });
  });

  await test('edit touching only updatedAt/edited is not re-scored', async () => {
    const ref = fs().collection('reviews').doc(rid(R[0], T));
    const before = (await ref.get()).data();
    const after = { ...before, updatedAt: Timestamp.now(), edited: true };
    assert.strictEqual(await RI.onReviewWrite(rid(R[0], T), before, after), null);
  });

  await test('no-chat review edited without chatting stays out (re-checked)', async () => {
    lookups.n = 0;
    const s = await write(R[1], T, 2, { edited: true });
    assert.strictEqual(s.counted, false);
    assert.strictEqual(lookups.n, 2);
    assert.deepStrictEqual(await profile(T), { count: 1, averageRating: 4 });
  });

  await test('no-chat review counts once they have chatted and it is edited', async () => {
    chat(R[1], T);
    const s = await write(R[1], T, 2, { edited: true, review: 'ok now' });
    assert.strictEqual(s.counted, true);
    assert.strictEqual(s.chat, true);
    assert.deepStrictEqual(await profile(T), { count: 2, averageRating: 3 });
  });

  await test('Supabase down on create: counted, chat unknown (never flags)', async () => {
    RI.setSupabaseForTest(fakeSupabase({ down: true }));
    try {
      const s = await write(R[3], T, 5);
      assert.strictEqual(s.counted, true);
      assert.strictEqual(s.chat, null);
      assert.deepStrictEqual(await profile(T), { count: 3, averageRating: 3.67 });
    } finally {
      RI.setSupabaseForTest(fakeSupabase());
    }
  });

  await test('re-check of a no-chat review while Supabase is down keeps it out', async () => {
    await write(R[4], T, 5);                             // no chat → out
    RI.setSupabaseForTest(fakeSupabase({ down: true }));
    try {
      const s = await write(R[4], T, 4, { edited: true });
      assert.strictEqual(s.counted, false);
      assert.strictEqual(s.chat, false);
    } finally {
      RI.setSupabaseForTest(fakeSupabase());
    }
  });

  await test('deleting a review updates the profile rating', async () => {
    await remove(R[3], T);
    assert.deepStrictEqual(await profile(T), { count: 2, averageRating: 3 });
    assert.strictEqual(await score(R[3], T), undefined);
    await remove(R[4], T);                              // an excluded one: profile unchanged
    assert.deepStrictEqual(await profile(T), { count: 2, averageRating: 3 });
  });

  await test('pre-2026-10-19 summary: profile tallies derived once from all scores', async () => {
    // Two v1 scores: one plain, one with noChat set on an EDIT long after creation (purged chat).
    const f = fs();
    await f.collection('reviews').doc(rid(R[0], OLDT)).set(reviewDoc(R[0], OLDT, 5, { createdAt: Timestamp.fromMillis(Date.now() - 90 * DAY) }));
    await f.collection('reviews').doc(rid(R[1], OLDT)).set(reviewDoc(R[1], OLDT, 4, { createdAt: Timestamp.fromMillis(Date.now() - 90 * DAY), edited: true }));
    await f.collection('review_scores').doc(rid(R[0], OLDT)).set(v1Score(R[0], OLDT, 5));
    await f.collection('review_scores').doc(rid(R[1], OLDT)).set(v1Score(R[1], OLDT, 4, { soft: ['noChat'], scoredAgoMs: 5 * DAY }));
    await f.collection('review_verified_summary').doc(OLDT).set({ count: 2, sum: 9, averageRating: 4.5, scamReports: 0, excludedCount: 0, flaggedCount: 1, leaderboardHold: true });
    await f.collection('user_ratings_summary').doc(OLDT).set({ count: 2, averageRating: 4.5 }); // old client recount

    lookups.n = 0;
    const s = await write(R[1], OLDT, 3, { edited: true }); // edit of the purged-chat review
    assert.strictEqual(lookups.n, 0, 'edit-time v1 noChat is grandfathered: no lookup');
    assert.strictEqual(s.counted, true);
    assert.strictEqual(s.chat, null);
    assert.deepStrictEqual(await profile(OLDT), { count: 2, averageRating: 4 });
    const v = await get('review_verified_summary', OLDT);
    assert.strictEqual(v.shownCount, 2);
    assert.strictEqual(v.shownSum, 8);
    assert.strictEqual(v.leaderboardHold, true, 'moderator hold kept');
  });

  await test('v1 noChat set on creation stays out when the review is edited', async () => {
    const f = fs();
    await f.collection('reviews').doc(rid(R[2], OLDT)).set(reviewDoc(R[2], OLDT, 1, { createdAt: Timestamp.fromMillis(Date.now() - 3 * DAY) }));
    await f.collection('review_scores').doc(rid(R[2], OLDT)).set(v1Score(R[2], OLDT, 1, { soft: ['noChat'], createdAgoMs: 3 * DAY, scoredAgoMs: 3 * DAY - 5000 }));
    // The live summary counted it (SOFT) — fold it in the way the old trigger did.
    await f.collection('review_verified_summary').doc(OLDT).update({ count: 3, sum: 9, shownCount: 3, shownSum: 9 });
    const s = await write(R[2], OLDT, 1, { edited: true, review: 'scam' });
    assert.strictEqual(s.counted, false);
    assert.deepStrictEqual(s.hard, ['noChat']);
    assert.deepStrictEqual(await profile(OLDT), { count: 2, averageRating: 4 });
  });

  await test('summary doc missing: rebuilt from every score, not reset to the new review', async () => {
    const f = fs();
    for (const [from, rating] of [[R[8], 5], [R[9], 3]]) {
      await f.collection('reviews').doc(rid(from, MISS)).set(reviewDoc(from, MISS, rating));
      await f.collection('review_scores').doc(rid(from, MISS)).set({ ...v1Score(from, MISS, rating), chat: true, version: 2 });
    }
    chat(R[10], MISS);
    await write(R[10], MISS, 4);
    assert.deepStrictEqual(await profile(MISS), { count: 3, averageRating: 4 });
    const v = await get('review_verified_summary', MISS);
    assert.deepStrictEqual([v.count, v.sum, v.shownCount, v.shownSum], [3, 12, 3, 12]);
  });

  await test('summary with NaN profile tallies is rebuilt, not trusted', async () => {
    const f = fs();
    await f.collection('reviews').doc(rid(R[8], NANU)).set(reviewDoc(R[8], NANU, 5));
    await f.collection('review_scores').doc(rid(R[8], NANU)).set({ ...v1Score(R[8], NANU, 5), chat: true, version: 2 });
    await f.collection('review_verified_summary').doc(NANU).set({ count: 1, sum: 5, averageRating: 5, shownCount: NaN, shownSum: NaN });
    chat(R[9], NANU);
    await write(R[9], NANU, 3);
    assert.deepStrictEqual(await profile(NANU), { count: 2, averageRating: 4 });
    const v = await get('review_verified_summary', NANU);
    assert.deepStrictEqual([v.shownCount, v.shownSum], [2, 8]);
  });

  await test('guard: the server\'s own write ends without reads; a staff write is put back', async () => {
    const d = await get('user_ratings_summary', T);
    assert.strictEqual(d.serverValue, '2|3', 'server writes are stamped');
    assert.strictEqual(await RI.onSummaryWrite(T, d), 'server');
    await fs().collection('user_ratings_summary').doc(T).set({ count: 99, averageRating: 1 }, { merge: true });
    assert.strictEqual(await RI.onSummaryWrite(T, await get('user_ratings_summary', T)), 'restored');
    assert.deepStrictEqual(await profile(T), { count: 2, averageRating: 3 });
    assert.strictEqual(await RI.onSummaryWrite(T, await get('user_ratings_summary', T)), 'server');
    assert.strictEqual(await RI.guardSummary(T), false, 'no-op for the server value');
  });

  await test('guard leaves users without profile tallies alone', async () => {
    await fs().collection('review_verified_summary').doc('legacyUser001').set({ count: 3, sum: 12, averageRating: 4 });
    await fs().collection('user_ratings_summary').doc('legacyUser001').set({ count: 4, averageRating: 4.2 });
    assert.strictEqual(await RI.guardSummary('legacyUser001'), false);
    assert.deepStrictEqual(await profile('legacyUser001'), { count: 4, averageRating: 4.2 });
  });

  await test('5-Star badge awarded by the server at 50 reviews / 4.5', async () => {
    await fs().collection('review_verified_summary').doc(FIVE).set({ count: 49, sum: 245, averageRating: 5, shownCount: 49, shownSum: 245 });
    chat(R[5], FIVE);
    await write(R[5], FIVE, 5);
    assert.deepStrictEqual(await profile(FIVE), { count: 50, averageRating: 5 });
    assert.strictEqual((await admin.database().ref(`users/${FIVE}/badges/fiveStar`).get()).val(), true);
  });

  await test('no badge (and no ghost users/{uid}) for a deleted account', async () => {
    await fs().collection('review_verified_summary').doc(GONE).set({ count: 60, sum: 300, averageRating: 5, shownCount: 60, shownSum: 300 });
    chat(R[6], GONE);
    await write(R[6], GONE, 5);
    assert.strictEqual((await admin.database().ref(`users/${GONE}`).get()).val(), null);
  });

  await test('no badge below 4.5', async () => {
    await fs().collection('review_verified_summary').doc(T).update({ shownCount: 49, shownSum: 200 });
    chat(R[7], T);
    await write(R[7], T, 5);
    assert.strictEqual((await admin.database().ref(`users/${T}/badges/fiveStar`).get()).val(), null);
  });

  // ── scripts/recount-review-summaries.js ──
  const runRecount = (args) => new Promise((resolve, reject) => {
    execFile(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'recount-review-summaries.js'), ...args], {
      env: { ...process.env, NODE_PATH: path.join(__dirname, '..', 'node_modules') },
      timeout: 60000,
    }, (err, stdout, stderr) => (err ? reject(new Error(`${err.message}\n${stdout}\n${stderr}`)) : resolve(stdout)));
  });

  await test('recount: creation-time noChat out, edit-time noChat grandfathered, profile = server tallies', async () => {
    const f = fs();
    const old = (from, rating, opts) => Promise.all([
      f.collection('reviews').doc(rid(from, RC)).set(reviewDoc(from, RC, rating)),
      f.collection('review_scores').doc(rid(from, RC)).set(v1Score(from, RC, rating, opts)),
    ]);
    await old(R[8], 5);                                                              // normal
    await old(R[9], 1, { soft: ['noChat'], createdAgoMs: 2 * DAY, scoredAgoMs: 2 * DAY - 3000 }); // no chat at creation
    await old(R[10], 4, { soft: ['noChat', 'newAccount'], scoredAgoMs: 1 * DAY });   // flagged on a late edit
    await f.collection('review_verified_summary').doc(RC).set({ count: 3, sum: 10, averageRating: 3.33, flaggedCount: 2, excludedCount: 0, scamReports: 0, leaderboardHold: false });
    await f.collection('user_ratings_summary').doc(RC).set({ count: 3, averageRating: 3.33 });

    const dry = await runRecount([`--uid=${RC}`]);
    assert.match(dry, /1 no-chat review\(s\) stop counting/);
    assert.match(dry, /DRY RUN/);
    assert.deepStrictEqual(await profile(RC), { count: 3, averageRating: 3.33 }, 'dry run writes nothing');

    await runRecount([`--uid=${RC}`, '--write']);
    const s9 = await score(R[9], RC);
    assert.deepStrictEqual([s9.counted, s9.hard, s9.soft, s9.chat], [false, ['noChat'], [], false]);
    const s10 = await score(R[10], RC);
    assert.deepStrictEqual([s10.counted, s10.hard, s10.soft, s10.chat], [true, [], ['newAccount'], null]);
    assert.deepStrictEqual(await profile(RC), { count: 2, averageRating: 4.5 });
    const v = await get('review_verified_summary', RC);
    assert.deepStrictEqual([v.count, v.sum, v.excludedCount, v.flaggedCount, v.shownCount, v.leaderboardHold], [2, 9, 1, 1, 2, false]);

    const again = await runRecount([`--uid=${RC}`]);
    assert.match(again, /0 no-chat review\(s\) stop counting/);
    assert.match(again, /unchanged 1, changed 0/);
  });

  await test('recount: a never-scored review is listed, then scored and counted by --write', async () => {
    await fs().collection('reviews').doc(rid(R[11], GAPU)).set(reviewDoc(R[11], GAPU, 4));
    const dry = await runRecount([`--uid=${GAPU}`]);
    assert.match(dry, /unscored reviews: 1 across 1 user/);
    assert.strictEqual(await profile(GAPU).then((p) => p.count), undefined, 'dry run writes nothing');

    const out = await runRecount([`--uid=${GAPU}`, '--write']);
    assert.match(out, /unscored reviews: 1 scored/);
    const sc = await score(R[11], GAPU);
    assert.strictEqual(sc.counted, true);
    assert.strictEqual(sc.chat, null, 'scored without a chat lookup (unknown, as the backfill)');
    assert.deepStrictEqual(await profile(GAPU), { count: 1, averageRating: 4 });
    assert.strictEqual((await get('user_ratings_summary', GAPU)).serverValue, '1|4');

    assert.match(await runRecount([`--uid=${GAPU}`]), /unscored reviews: 0 across 0 user/);
  });

  await test('recount: whole-database dry run completes', async () => {
    const out = await runRecount([]);
    assert.match(out, /users to recount \(DRY RUN\)/);
    assert.match(out, /DRY RUN — nothing written/);
  });

  console.log(`\n${pass} passed${process.exitCode ? ', some FAILED' : ''}`);
  await admin.app().delete();
}

main().catch((e) => { console.error(e); process.exit(1); });
