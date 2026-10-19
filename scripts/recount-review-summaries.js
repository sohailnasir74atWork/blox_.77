// One-off recount (2026-10-19): reviews from people who never chatted with the
// trader stop counting, and the profile rating (user_ratings_summary) becomes
// the server's number. Works from the stored review_scores only: no Supabase,
// no Auth, no device lookups (functions/reviewSignals.js decides everything).
//
// Per reviewed user:
//   1. review_scores: the old SOFT noChat flag becomes HARD when it was set on
//      creation (a real no-chat review), and is dropped when it was set on a
//      later edit (the chat had been purged after 30 days: grandfathered).
//   2. review_verified_summary: rebuilt from the scores, incl. the new profile
//      tallies shownCount / shownSum. leaderboardHold and other fields stay.
//   3. user_ratings_summary: set to the profile tallies (what the app and the
//      website show). A summary with no scored reviews is zeroed only when the
//      user has no reviews at all; otherwise it is listed and left alone.
//
// Each user is recounted in its own transaction, so it is safe while the app
// is live and scoreReviewOnWrite runs. Idempotent: run it again any time
// (e.g. after changing PROFILE_HIDDEN in reviewSignals.js).
//
// Order: deploy functions (scoreReviewOnWrite, guardRatingSummary) and
// firestore.rules first, then:
//   node scripts/recount-review-summaries.js              # dry run: report only
//   node scripts/recount-review-summaries.js --write      # write the changes
//   node scripts/recount-review-summaries.js --uid=<uid>  # one user (with or without --write)
// Run from the repo root; serviceAccount.json must exist there.
//
// Cost (2026-10-19 sizes): ~78k score reads + ~45k summary reads (≈ $0.08);
// --write adds ~23k verified-summary writes (each gets the new fields once),
// the changed scores and profile summaries, and one guardRatingSummary call
// per profile summary written.

const path = require('path');
const admin = require('firebase-admin');
const S = require(path.join(__dirname, '..', 'functions', 'reviewSignals'));

const WRITE = process.argv.includes('--write');
const ONLY = (process.argv.find((a) => a.startsWith('--uid=')) || '').slice(6) || null;
const CONCURRENCY = 25;

if (process.env.FIRESTORE_EMULATOR_HOST) {
  // Tests (functions/test/reviewIntegrity.test.js): emulator only, no credentials.
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-fruiteblocks' });
} else {
  const serviceAccount = require(path.join(__dirname, '..', 'serviceAccount.json'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const fs = admin.firestore();

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
  const tally = Object.fromEntries(Object.keys(S.contribution(null)).map((k) => [k, 0]));
  const stats = { toExcluded: 0, flagDropped: 0 };
  for (const d of scoreDocs) {
    const { fixed, changed, chat } = fixScore(d.data());
    if (changed) {
      scoreUpdates.push({ id: d.id, patch: { hard: fixed.hard, soft: fixed.soft, counted: fixed.counted, scamReport: fixed.scamReport, chat } });
      if (chat === false) stats.toExcluded++;
      else stats.flagDropped++;
    }
    const c = S.contribution(fixed);
    for (const k of Object.keys(c)) tally[k] += c[k];
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

async function main() {
  const t0 = Date.now();
  let uids;
  if (ONLY) uids = [ONLY];
  else {
    const [v, d] = await Promise.all([
      fs.collection('review_verified_summary').select().get(),
      fs.collection('user_ratings_summary').select().get(),
    ]);
    uids = [...new Set([...v.docs.map((x) => x.id), ...d.docs.map((x) => x.id)])];
  }
  console.log(`${uids.length} users to recount${WRITE ? '' : ' (DRY RUN)'}`);

  const totals = { scoresToExcluded: 0, scoresFlagDropped: 0, verifiedWrites: 0, profileCreated: 0, profileChanged: 0, profileZeroed: 0, profileSame: 0 };
  const moves = [];
  const unscored = [];
  let done = 0;

  await pool(uids, async (uid) => {
    const q = fs.collection('review_scores').where('toUserId', '==', uid);
    const vRef = fs.collection('review_verified_summary').doc(uid);
    const dRef = fs.collection('user_ratings_summary').doc(uid);

    const run = async (get, tx) => {
      const [scores, vSnap, dSnap] = await Promise.all([get(q), get(vRef), get(dRef)]);
      const display = dSnap.exists ? dSnap.data() : null;
      if (scores.empty && display && display.count > 0) {
        // No scored reviews. Zero it only if the user really has none.
        const n = (await fs.collection('reviews').where('toUserId', '==', uid).count().get()).data().count;
        if (n > 0) return { unscored: n, display };
      }
      const plan = planFor(uid, scores.docs, vSnap.exists ? vSnap.data() : null, display);
      if (tx) {
        const now = admin.firestore.FieldValue.serverTimestamp();
        for (const u of plan.scoreUpdates) tx.update(fs.collection('review_scores').doc(u.id), u.patch);
        if (plan.verifiedPatch) tx.set(vRef, { ...plan.verifiedPatch, updatedAt: now }, { merge: true });
        if (plan.displayPatch) tx.set(dRef, { ...plan.displayPatch, updatedAt: now }, { merge: true });
      }
      return { plan, display };
    };

    try {
      const r = WRITE
        ? await fs.runTransaction((tx) => run((ref) => tx.get(ref), tx))
        : await run((ref) => ref.get(), null);
      if (r.unscored) {
        unscored.push({ uid, reviews: r.unscored, shown: r.display.count });
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
  if (unscored.length) {
    console.log(`\n${unscored.length} profile summary(ies) have reviews but no scores — left alone; re-score with scoreReviewById:`);
    for (const u of unscored.slice(0, 20)) console.log(`    ${u.uid}  ${u.reviews} review(s), shows ${u.shown}`);
  }
  console.log(WRITE ? '\nWRITTEN.' : '\nDRY RUN — nothing written. Re-run with --write.');
  process.exit(0);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
