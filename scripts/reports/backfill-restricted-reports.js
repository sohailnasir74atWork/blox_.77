// One-off backfill: move EXISTING reports about staff out of user_reports /
// chat_reports into user_reports_restricted / chat_reports_restricted, which
// only the staff above the target can read (never the target). New reports
// are moved by functions/reportRouting.js as they are created; this does the
// ones filed before it was deployed. Same code path (routeReport), so a doc
// moves exactly as the trigger would move it.
//
// Run (from the Blox_Fruit directory, after deploying the functions):
//   node scripts/reports/backfill-restricted-reports.js           # DRY RUN — lists what would move
//   APPLY=1 node scripts/reports/backfill-restricted-reports.js   # moves them
//
// Reads every doc of both collections once (a few hundred to a few thousand
// reads) plus a rank lookup per distinct target. Safe to run again: moved
// docs are gone from the public collections, reports about players stay.
//
// Prereqs: serviceAccount.json at project root (same as the other backfill
// scripts).

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FUNCTIONS_DIR = path.join(ROOT, 'functions');
// The functions' own firebase-admin, so reportRouting.js / banEnforcement.js
// see the app initialised here.
const admin = require(require.resolve('firebase-admin', { paths: [FUNCTIONS_DIR] }));

const SERVICE_ACCOUNT_PATH = path.join(ROOT, 'serviceAccount.json');
let serviceAccount;
try {
  serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (e) {
  console.error(`\n❌ Could not load ${SERVICE_ACCOUNT_PATH}\n`);
  process.exit(1);
}
const RTDB_URL = process.env.RTDB_URL || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: RTDB_URL });

const { RESTRICTED, routeReport, cachedDeps, loadStaffRanks, rankOfUid } = require(path.join(FUNCTIONS_DIR, 'reportRouting'))._internal;

const APPLY = process.env.APPLY === '1';
const PAGE = 300;
const RANK_NAME = { 3: 'Senior Mod+', 4: 'Admin+' };

(async () => {
  const firestore = admin.firestore();
  const deps = cachedDeps(rankOfUid, () => loadStaffRanks(firestore, admin.auth()));
  const totals = {};
  console.log(APPLY ? '⚠️  APPLY=1: moving reports about staff' : 'DRY RUN (set APPLY=1 to move)');

  for (const collection of Object.keys(RESTRICTED)) {
    totals[collection] = { scanned: 0, moved: 0, failed: 0 };
    let last = null;
    for (;;) {
      let q = firestore.collection(collection).orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) {
        totals[collection].scanned++;
        try {
          const plan = await routeReport(firestore, collection, doc.id, doc.data() || {}, deps, { dryRun: !APPLY });
          if (plan.moved) {
            totals[collection].moved++;
            console.log(`${APPLY ? 'moved' : 'would move'} ${collection}/${doc.id} → ${plan.to}`
              + ` (${RANK_NAME[plan.minRank]}, targets ${plan.targetUids.join(',')}, ${plan.viewers.length} viewers)`);
          }
        } catch (e) {
          totals[collection].failed++;
          console.error(`failed ${collection}/${doc.id}: ${e?.message || e}`);
        }
      }
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < PAGE) break;
    }
  }

  console.log('\nSummary:', JSON.stringify(totals));
  if (!APPLY) console.log('Nothing was written. Re-run with APPLY=1 to move.');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
