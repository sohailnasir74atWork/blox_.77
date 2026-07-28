// One-shot cleanup: the old hardcoded Senior Mod bootstrap in GlobelStats.js
// auto-wrote users/{uid}/isSeniorMod = true for these UIDs on login. The
// bootstrap code is now removed, but the flag persists in RTDB, so the user
// still shows the "Sr Mod" badge in chat. This clears it.
//
// Run:
//   node scripts/clear-hardcoded-seniormod.js          # DRY RUN — prints current flag
//   APPLY=1 node scripts/clear-hardcoded-seniormod.js  # actually clears it
//
// Prereqs: serviceAccount.json at project root (same as backfill-badges.js).

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

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: RTDB_URL,
});

// Former hardcoded SENIOR_MOD_UIDS from GlobelStats.js.
const UIDS = (process.env.UIDS || 'nS3XuFcjwnNaGLoCCZcGrzvNMhY2')
  .split(',').map((s) => s.trim()).filter(Boolean);

const APPLY = process.env.APPLY === '1';

(async () => {
  const db = admin.database();
  console.log(`\n${APPLY ? '✍️  APPLY' : '🔍 DRY RUN'} — clearing hardcoded Senior Mod on ${UIDS.length} UID(s)\n`);
  for (const uid of UIDS) {
    const snap = await db.ref(`users/${uid}/isSeniorMod`).get();
    const val = snap.exists() ? snap.val() : undefined;
    const nameSnap = await db.ref(`users/${uid}/displayName`).get();
    const name = nameSnap.exists() ? nameSnap.val() : '(unknown)';
    console.log(`  ${uid}  displayName="${name}"  isSeniorMod=${val}`);
    if (APPLY && val === true) {
      await db.ref(`users/${uid}`).update({ isSeniorMod: false });
      console.log(`    → set isSeniorMod=false`);
    }
  }
  console.log(APPLY ? '\n✅ Done.\n' : '\nDRY RUN only — re-run with APPLY=1 to write.\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
