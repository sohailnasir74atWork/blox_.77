/**
 * Cloud Functions: Mod/JMod roster sync
 *
 * syncModRole_Moderator / syncModRole_BabyMod:
 *   Deep-path RTDB triggers that only fire when isModerator or isBabyMod
 *   changes — not on every user write. Handles promotions and demotions.
 *
 * refreshModProfiles:
 *   Scheduled function that updates displayName/avatar for existing mods
 *   every 6 hours. Only touches the ~10 mod entries, not all users.
 *
 * seedModRoster:
 *   One-time seed that runs on schedule but only works if mods node is
 *   empty. Uses indexed queries (not full user dump).
 *
 * RTDB structure:
 *   mods/{uid}/ { displayName, avatar, role, updatedAt }
 *
 * Deployment:
 * firebase deploy --only functions:syncModRole_Moderator,functions:syncModRole_BabyMod,functions:refreshModProfiles,functions:seedModRoster
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.database();

// ─── Trigger: fires ONLY when users/{uid}/isModerator changes ───
exports.syncModRole_Moderator = functions
  .runWith({ memory: '128MB', timeoutSeconds: 10 })
  .database
  .ref('users/{uid}/isModerator')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const isMod = change.after.val() === true;

    if (isMod) {
      // Promoted to mod — fetch profile and write entry
      const userSnap = await db.ref(`users/${uid}`).once('value');
      const data = userSnap.val() || {};
      await db.ref(`mods/${uid}`).set({
        displayName: data.displayName || 'Unknown',
        avatar: data.avatar || '',
        role: 'mod',
        updatedAt: Date.now(),
      });
    } else {
      // Demoted — check if they're still a jmod before removing
      const jmodSnap = await db.ref(`users/${uid}/isBabyMod`).once('value');
      if (jmodSnap.val() === true) {
        await db.ref(`mods/${uid}/role`).set('jmod');
        await db.ref(`mods/${uid}/updatedAt`).set(Date.now());
      } else {
        await db.ref(`mods/${uid}`).remove();
      }
    }

    return null;
  });

// ─── Trigger: fires ONLY when users/{uid}/isBabyMod changes ───
exports.syncModRole_BabyMod = functions
  .runWith({ memory: '128MB', timeoutSeconds: 10 })
  .database
  .ref('users/{uid}/isBabyMod')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const isJmod = change.after.val() === true;

    if (isJmod) {
      // Promoted to jmod — only write if not already a full mod
      const modSnap = await db.ref(`users/${uid}/isModerator`).once('value');
      if (modSnap.val() === true) return null; // already a mod, mod rank wins

      const userSnap = await db.ref(`users/${uid}`).once('value');
      const data = userSnap.val() || {};
      await db.ref(`mods/${uid}`).set({
        displayName: data.displayName || 'Unknown',
        avatar: data.avatar || '',
        role: 'jmod',
        updatedAt: Date.now(),
      });
    } else {
      // Demoted — check if they're still a full mod before removing
      const modSnap = await db.ref(`users/${uid}/isModerator`).once('value');
      if (modSnap.val() === true) return null; // still a mod, keep entry
      await db.ref(`mods/${uid}`).remove();
    }

    return null;
  });

// ─── Scheduled: refresh displayName/avatar for existing mods ───
// Only reads the ~10 mod entries, not all 100K+ users
exports.refreshModProfiles = functions
  .runWith({ memory: '128MB', timeoutSeconds: 30 })
  .pubsub
  .schedule('every 6 hours')
  .onRun(async () => {
    const modsSnap = await db.ref('mods').once('value');
    if (!modsSnap.exists()) return null;

    const updates = {};
    const uids = Object.keys(modsSnap.val());

    // Fetch only the mods' profiles (parallel reads for ~10 users)
    const userSnaps = await Promise.all(
      uids.map(uid => db.ref(`users/${uid}`).once('value'))
    );

    userSnaps.forEach((snap, i) => {
      const uid = uids[i];
      const data = snap.val();
      if (!data) {
        // User deleted, remove from mods
        updates[`mods/${uid}`] = null;
        return;
      }
      const currentMod = modsSnap.val()[uid];
      if (data.displayName !== currentMod.displayName || data.avatar !== currentMod.avatar) {
        updates[`mods/${uid}/displayName`] = data.displayName || 'Unknown';
        updates[`mods/${uid}/avatar`] = data.avatar || '';
        updates[`mods/${uid}/updatedAt`] = Date.now();
      }
    });

    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
      console.log(`[ModSync] Refreshed profiles for ${Object.keys(updates).length / 3 | 0} mods`);
    } else {
      console.log('[ModSync] All mod profiles up to date');
    }

    return null;
  });

// ─── One-time seed: finds existing mods via indexed queries ───
exports.seedModRoster = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .pubsub
  .schedule('every 24 hours')
  .onRun(async () => {
    const modsSnap = await db.ref('mods').limitToFirst(1).once('value');
    if (modsSnap.exists()) {
      console.log('[ModSync] mods node already exists, skipping seed');
      return null;
    }

    console.log('[ModSync] Seeding mods node...');
    const updates = {};
    let count = 0;

    const modSnap = await db.ref('users')
      .orderByChild('isModerator')
      .equalTo(true)
      .once('value');

    if (modSnap.exists()) {
      modSnap.forEach(child => {
        const data = child.val();
        updates[`mods/${child.key}`] = {
          displayName: data.displayName || 'Unknown',
          avatar: data.avatar || '',
          role: 'mod',
          updatedAt: Date.now(),
        };
        count++;
      });
    }

    const jmodSnap = await db.ref('users')
      .orderByChild('isBabyMod')
      .equalTo(true)
      .once('value');

    if (jmodSnap.exists()) {
      jmodSnap.forEach(child => {
        if (!updates[`mods/${child.key}`]) {
          const data = child.val();
          updates[`mods/${child.key}`] = {
            displayName: data.displayName || 'Unknown',
            avatar: data.avatar || '',
            role: 'jmod',
            updatedAt: Date.now(),
          };
          count++;
        }
      });
    }

    if (count > 0) {
      await db.ref().update(updates);
    }

    console.log(`[ModSync] Seeded ${count} mods/jmods`);
    return null;
  });
