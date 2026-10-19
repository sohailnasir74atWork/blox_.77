// One-off recount (2026-10-19): reviews from people who never chatted with the
// trader stop counting, and the profile rating (user_ratings_summary) becomes
// the server's number. Works from the stored review_scores (no Supabase);
// only reviews that were never scored go through scoreReviewById (Auth + RTDB
// device lookups, the trigger's own code).
//
// Per reviewed user:
//   0. Gaps: reviews with no review_scores doc (e.g. a trigger event dropped
//      after 10 minutes). The dry run lists them; --write scores them first.
//   1. review_scores: the old SOFT noChat flag becomes HARD when it was set on
//      creation (a real no-chat review), and is dropped when it was set on a
//      later edit (the chat had been purged after 30 days: grandfathered).
//   2. review_verified_summary: rebuilt from the scores, incl. the new profile
//      tallies shownCount / shownSum. leaderboardHold and other fields stay.
//   3. user_ratings_summary: set to the profile tallies (what the app and the
//      website show), zeroed when the user has no reviews left.
//
// Each user is recounted in its own transaction, so it is safe while the app
// is live and scoreReviewOnWrite runs. Idempotent: run it again any time
// (e.g. after changing PROFILE_HIDDEN in reviewSignals.js).
//
// Order: deploy functions (scoreReviewOnWrite, guardRatingSummary) and
// firestore.rules first, then:
//   node scripts/recount-review-summaries.js              # 1. dry run: report only
//     → check the "unscored reviews" and "profile rating" lines
//   node scripts/recount-review-summaries.js --write      # 2. score the gaps, write
//   node scripts/recount-review-summaries.js              # 3. dry run again: expect 0 changes
//   node scripts/recount-review-summaries.js --uid=<uid>  # one user (with or without --write)
// Run from the repo root; serviceAccount.json must exist there.
//
// Cost (2026-10-19 sizes): ~121k review reads (one pass, ids only) + ~78k
// score reads + ~45k summary reads (≈ $0.15); --write adds ~23k
// verified-summary writes (each gets the new fields once), the changed scores
// and profile summaries, and one guardRatingSummary call per profile summary
// written (stamped, so it ends without reads).

const path = require('path');
const FUNCTIONS = path.join(__dirname, '..', 'functions');
// The functions' own firebase-admin, so scoreReviewById shares this app.
const admin = require(require.resolve('firebase-admin', { paths: [FUNCTIONS] }));
const S = require(path.join(FUNCTIONS, 'reviewSignals'));

const WRITE = process.argv.includes('--write');
const ONLY = (process.argv.find((a) => a.startsWith('--uid=')) || '').slice(6) || null;
const CONCURRENCY = 25;
const PAGE = 5000;

if (process.env.FIRESTORE_EMULATOR_HOST) {
  // Tests (functions/test/reviewIntegrity.test.js): emulator only, no credentials.
  const project = process.env.GCLOUD_PROJECT || 'demo-fruiteblocks';
  const rtdb = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  admin.initializeApp({ projectId: project, ...(rtdb ? { databaseURL: `http://${rtdb}?ns=${project}` } : {}) });
} else {
  const serviceAccount = require(path.join(__dirname, '..', 'serviceAccount.json'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`,
  });
}
const fs = admin.firestore();
// Loaded only to score gaps; needs the app initialised above.
const RI = WRITE ? require(path.join(FUNCTIONS, 'reviewIntegrity')) : null;

const VERIFIED_KEYS = ['count', 'sum', 'averageRating', 'scamReports', 'excludedCount', 'flaggedCount', 'shownCount', 'shownSum'];
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const near = (a, b) => Math.abs((a || 0) - (b || 0)) < 0.005;

// The score with its chat verdict applied as a HARD flag (or not at all).
function fixScore(score) {
  const chat = S.storedChat(score);
  const hard = (score.hard || []).filter((f) => f !== S.HARD.NO_CHAT);
  const soft = (score.soft || []).filter((f) => f !== S.HARD.NO_CHAT);
  if (chat === false) hard.push(S.HARD.NO_CHAT);
  const counted = hard.length === 0;
  const fixed = { ...score, hard, soft, counted, scamReport: !!score.scamReport && counted, chat };
  const changed = !same(hard, score.hard || []) || !same(soft, score.soft || []) || counted !== score.counted
    || fixed.scamReport !== !!score.scamReport;
  return { fixed, changed, chat };
}

// What has to change for one user, from their scores and two summary docs.
function planFor(uid, scoreDocs, verified, display) {
  const scoreUpdates = [];
  const tally = S.emptyTally();
  const stats = { toExcluded: 0, flagDropped: 0 };
  for (const d of scoreDocs) {
    const { fixed, changed, chat } = fixScore(d.data());
    if (changed) {
      scoreUpdates.push({ id: d.id, patch: { hard: fixed.hard, soft: fixed.soft, counted: fixed.counted, scamReport: fixed.scamReport, chat } });
      if (chat === false) stats.toExcluded++;
      else stats.flagDropped++;
    }
    S.addScore(tally, fixed);
  }

  const wantV = { ...tally, averageRating: tally.count ? S.round2(tally.sum / tally.count) : 0 };
  const v = verified || {};
  const verifiedPatch = (verified || scoreDocs.length) && VERIFIED_KEYS.some((k) => (k === 'averageRating' ? !near(v[k], wantV[k]) : v[k] !== wantV[k]))
    ? wantV : null;

  const wantD = S.profileSummary(tally);
  let displayPatch = null;
  if (display ? (display.count !== wantD.count || !near(display.averageRating, wantD.averageRating)) : wantD.count > 0) {
    displayPatch = wantD;
  }
  return { scoreUpdates, verifiedPatch, displayPatch, wantD, stats };
}

async function pool(items, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

// Review ids per reviewee, from one pass over `reviews` (profile docs have no toUserId).
async function loadReviewIds() {
  const byUser = new Map();
  const add = (d) => {
    const r = d.data();
    if (!r.fromUserId || !r.toUserId) return;
    if (!byUser.has(r.toUserId)) byUser.set(r.toUserId, []);
    byUser.get(r.toUserId).push(d.id);
  };
  if (ONLY) {
    (await fs.collection('reviews').where('toUserId', '==', ONLY).select('fromUserId', 'toUserId').get()).docs.forEach(add);
    return byUser;
  }
  let last = null;
  for (;;) {
    let q = fs.collection('reviews').select('fromUserId', 'toUserId')
      .orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    snap.docs.forEach(add);
    if (snap.size < PAGE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return byUser;
}

async function main() {
  const t0 = Date.now();
  const reviewIds = await loadReviewIds();
  let uids;
  if (ONLY) uids = [ONLY];
  else {
    const [v, d] = await Promise.all([
      fs.collection('review_verified_summary').select().get(),
      fs.collection('user_ratings_summary').select().get(),
    ]);
    uids = [...new Set([...v.docs.map((x) => x.id), ...d.docs.map((x) => x.id), ...reviewIds.keys()])];
  }
  console.log(`${uids.length} users to recount${WRITE ? '' : ' (DRY RUN)'}`);

  const totals = { scoresToExcluded: 0, scoresFlagDropped: 0, verifiedWrites: 0, profileCreated: 0, profileChanged: 0, profileZeroed: 0, profileSame: 0, gapsScored: 0, gapsGone: 0 };
  const moves = [];
  const gaps = [];
  let done = 0;

  await pool(uids, async (uid) => {
    const q = fs.collection('review_scores').where('toUserId', '==', uid);
    const vRef = fs.collection('review_verified_summary').doc(uid);
    const dRef = fs.collection('user_ratings_summary').doc(uid);

    const run = async (get, tx) => {
      const [scores, vSnap, dSnap] = await Promise.all([get(q), get(vRef), get(dRef)]);
      const scored = new Set(scores.docs.map((d) => d.id));
      const unscored = (reviewIds.get(uid) || []).filter((id) => !scored.has(id));
      // Without its unscored reviews the profile would drop them: never write then.
      if (unscored.length) return { unscored };
      const display = dSnap.exists ? dSnap.data() : null;
      const plan = planFor(uid, scores.docs, vSnap.exists ? vSnap.data() : null, display);
      if (tx) {
        const now = admin.firestore.FieldValue.serverTimestamp();
        for (const u of plan.scoreUpdates) tx.update(fs.collection('review_scores').doc(u.id), u.patch);
        if (plan.verifiedPatch) tx.set(vRef, { ...plan.verifiedPatch, updatedAt: now }, { merge: true });
        if (plan.displayPatch) {
          tx.set(dRef, { ...plan.displayPatch, serverValue: S.profileStamp(plan.displayPatch), updatedAt: now }, { merge: true });
        }
      }
      return { plan, display };
    };
    const attempt = () => (WRITE
      ? fs.runTransaction((tx) => run((ref) => tx.get(ref), tx))
      : run((ref) => ref.get(), null));

    try {
      let r = await attempt();
      if (r.unscored && WRITE) {
        // Score them with the trigger's own code, then recount this user.
        // A review deleted since the scan is just dropped from the list.
        let failed = 0;
        for (const id of r.unscored) {
          try {
            if (!(await fs.collection('reviews').doc(id).get()).exists) {
              reviewIds.set(uid, (reviewIds.get(uid) || []).filter((x) => x !== id));
              totals.gapsGone++;
              continue;
            }
            await RI.scoreReviewById(id);
            totals.gapsScored++;
          } catch (e) {
            failed++;
            console.error(`\n${id}: scoring failed: ${e.message}`);
          }
        }
        r = failed ? { unscored: r.unscored, failed } : await attempt();
      }
      if (r.unscored) {
        gaps.push({ uid, unscored: r.unscored.length, failed: r.failed || 0 });
      } else {
        const { plan, display } = r;
        totals.scoresToExcluded += plan.stats.toExcluded;
        totals.scoresFlagDropped += plan.stats.flagDropped;
        if (plan.verifiedPatch) totals.verifiedWrites++;
        if (!plan.displayPatch) totals.profileSame++;
        else if (!display) totals.profileCreated++;
        else if (plan.displayPatch.count === 0) totals.profileZeroed++;
        else totals.profileChanged++;
        if (plan.displayPatch && display) {
          moves.push({ uid, from: display.count || 0, to: plan.wantD.count, avgFrom: display.averageRating || 0, avgTo: plan.wantD.averageRating });
        }
      }
    } catch (e) {
      console.error(`\n${uid}: ${e.message}`);
    }
    if (++done % 1000 === 0) process.stdout.write(`\r${done}/${uids.length}`);
  });

  console.log(`\r${done}/${uids.length} users in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  const gapReviews = gaps.reduce((n, g) => n + g.unscored, 0);
  if (WRITE) {
    const failedUsers = gaps.filter((g) => g.failed).length;
    console.log(`unscored reviews: ${totals.gapsScored} scored (scoreReviewById), ${totals.gapsGone} deleted since the scan (skipped); `
      + `${failedUsers} user(s) left unchanged because scoring failed, ${gaps.length - failedUsers} still unscored (re-run)`);
  } else {
    console.log(`unscored reviews: ${gapReviews} across ${gaps.length} user(s) — --write scores them first, then recounts those users (not in the numbers below)`);
  }
  for (const g of gaps.slice(0, 20)) console.log(`    ${g.uid}  ${g.unscored} unscored${g.failed ? `, ${g.failed} failed` : ''}`);
  console.log('review_scores:');
  console.log(`  ${totals.scoresToExcluded} no-chat review(s) stop counting (noChat set on creation → HARD)`);
  console.log(`  ${totals.scoresFlagDropped} noChat flag(s) dropped (set on a later edit after the 30-day purge → grandfathered)`);
  console.log(`review_verified_summary: ${totals.verifiedWrites} doc(s) ${WRITE ? 'written' : 'to write'} (new shownCount/shownSum fields once, plus count changes)`);
  console.log('user_ratings_summary (profile rating):');
  console.log(`  unchanged ${totals.profileSame}, changed ${totals.profileChanged}, created ${totals.profileCreated}, zeroed ${totals.profileZeroed}`);

  const down = moves.filter((m) => m.to < m.from);
  const up = moves.filter((m) => m.to > m.from);
  const hist = { '1': 0, '2-5': 0, '6-20': 0, '21+': 0 };
  for (const m of down) {
    const k = m.from - m.to;
    hist[k === 1 ? '1' : k <= 5 ? '2-5' : k <= 20 ? '6-20' : '21+']++;
  }
  console.log(`  count down ${down.length} ${JSON.stringify(hist)}, count up ${up.length}, average only ${moves.length - down.length - up.length}`);
  moves.sort((a, b) => Math.abs(b.from - b.to) - Math.abs(a.from - a.to));
  for (const m of moves.slice(0, 15)) {
    console.log(`    ${m.uid}  ${m.from} → ${m.to} reviews, ${m.avgFrom} → ${m.avgTo}★`);
  }
  console.log(WRITE ? '\nWRITTEN.' : '\nDRY RUN — nothing written. Re-run with --write.');
  process.exit(0);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
