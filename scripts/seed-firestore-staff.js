// One-shot seed (2026-09): write Firestore staff/{uid} for every current staff
// member, so the review rules let moderators delete reviews from day one.
// After this, functions/staffMirror.js keeps it in sync.
//
// Uses the indexed RTDB queries users.orderByChild(<flag>).equalTo(true), one
// per flag — never a full /users read. Idempotent.
//
// Run from the repo root (serviceAccount.json must exist there):
//   node scripts/seed-firestore-staff.js            # dry run: list staff
//   node scripts/seed-firestore-staff.js --write    # write staff/{uid}

const path = require('path');
const admin = require('firebase-admin');

const serviceAccount = require(path.join(__dirname, '..', 'serviceAccount.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`,
});
// Required after initializeApp so the module reuses this app.
const { STAFF_FLAGS } = require(path.join(__dirname, '..', 'functions', 'staffMirror'));
const WRITE = process.argv.includes('--write');

async function main() {
  const staff = new Map();
  for (const flag of STAFF_FLAGS) {
    const snap = await admin.database().ref('users').orderByChild(flag).equalTo(true).once('value');
    snap.forEach((child) => {
      if (!staff.has(child.key)) staff.set(child.key, []);
      staff.get(child.key).push(flag);
    });
  }
  for (const [uid, roles] of staff) console.log(`  ${uid}  ${roles.join(',')}`);
  console.log(`${staff.size} staff`);

  if (!WRITE) {
    console.log('DRY RUN — re-run with --write.');
    process.exit(0);
  }
  const batch = admin.firestore().batch();
  for (const [uid, roles] of staff) {
    batch.set(admin.firestore().collection('staff').doc(uid), {
      roles,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  console.log(`WROTE ${staff.size} staff docs`);
  process.exit(0);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
