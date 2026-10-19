/**
 * Mirrors staff status from RTDB into Firestore staff/{uid}, so Firestore
 * rules can let moderators delete reviews (Firestore rules cannot read RTDB,
 * and the only custom claim users carry is role:'authenticated').
 *
 * Staff = any of users/{uid}/{admin,isAdmin,isSeniorMod,isModerator,isBabyMod}
 * true — the same flags database.rules.json treats as staff. Those flags are
 * write-protected in RTDB, so the mirror is trustworthy. The badges
 * (isTrusted, isGrinder, isRaider, isHelper) and customTitle are cosmetic and
 * never make anyone staff, so they have no trigger here.
 *
 * One trigger per flag (not users/{uid}/{field}) so ordinary profile writes
 * never invoke it. Seed existing staff once with scripts/seed-firestore-staff.js.
 *
 * Deployment:
 *   firebase deploy --only functions:syncStaff_admin,functions:syncStaff_isAdmin,functions:syncStaff_isSeniorMod,functions:syncStaff_isModerator,functions:syncStaff_isBabyMod
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const STAFF_FLAGS = ['admin', 'isAdmin', 'isSeniorMod', 'isModerator', 'isBabyMod'];

async function syncStaff(uid) {
  const snaps = await Promise.all(
    STAFF_FLAGS.map((f) => admin.database().ref(`users/${uid}/${f}`).once('value')),
  );
  const roles = STAFF_FLAGS.filter((f, i) => snaps[i].val() === true);
  const ref = admin.firestore().collection('staff').doc(uid);
  if (roles.length) {
    await ref.set({ roles, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  } else {
    await ref.delete();
  }
}

for (const flag of STAFF_FLAGS) {
  exports[`syncStaff_${flag}`] = functions
    .runWith({ memory: '128MB', timeoutSeconds: 20 })
    .database
    .ref(`users/{uid}/${flag}`)
    .onWrite((change, context) => syncStaff(context.params.uid));
}

exports.STAFF_FLAGS = STAFF_FLAGS;
exports.syncStaff = syncStaff;
