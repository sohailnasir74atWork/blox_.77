/**
 * Cloud Function: Mod/JMod roster sync
 *
 * syncModRoster:
 *   RTDB trigger on users/{uid}. Only fires when isSeniorMod, isModerator,
 *   isBabyMod, displayName, or avatar changes. Lightweight — reads nothing extra.
 *
 * No seed function needed — the listener catches all changes going forward.
 * To populate existing mods, just toggle isModerator off/on once per mod
 * in the Firebase console, or call seedModsFromApp() client-side.
 *
 * RTDB structure:
 *   mods/{uid}/ { displayName, avatar, role, updatedAt }
 *
 * Deployment:
 * firebase deploy --only functions:syncModRoster
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.database();

// ─── Listener: fires on write to users/{uid} ───
exports.syncModRoster = functions
  .runWith({ memory: '128MB', timeoutSeconds: 10 })
  .database
  .ref('users/{uid}')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const after = change.after.val();
    const before = change.before.val();

    if (!after) {
      await db.ref(`mods/${uid}`).remove();
      return null;
    }

    const relevantFields = ['isSeniorMod', 'isModerator', 'isBabyMod', 'displayName', 'avatar'];
    const changed = !before || relevantFields.some(f => before[f] !== after[f]);
    if (!changed) return null;

    const isSenior = after.isSeniorMod === true;
    const isMod = after.isModerator === true;
    const isJmod = after.isBabyMod === true;

    if (isSenior || isMod || isJmod) {
      await db.ref(`mods/${uid}`).set({
        displayName: after.displayName || 'Unknown',
        avatar: after.avatar || '',
        // Senior Mod outranks Mod outranks JMD — pick the highest held role.
        role: isSenior ? 'srmod' : isMod ? 'mod' : 'jmod',
        updatedAt: Date.now(),
      });
    } else {
      await db.ref(`mods/${uid}`).remove();
    }

    return null;
  });
