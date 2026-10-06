/**
 * gameScores.js
 * Shared persistence for the mini games (Fruit Smash, Crack the Chest,
 * Fruit Slash, Memory Match).
 *
 *   loadGameStats  — read the user's games/{uid} doc ({} when it doesn't
 *                    exist, null for guests or when the read FAILED —
 *                    callers must not write a "best" they couldn't read)
 *   saveGameStats  — merge fields into games/{uid}
 *   submitLeaderboardScore — game_scores/{game}/scores/{uid} + the top-20 cache
 *
 * The leaderboard write costs 2 RTDB reads + 2 Firestore writes + 1 read, so
 * callers only submit when the personal best actually improved.
 */

import { doc, getDoc, setDoc } from '@react-native-firebase/firestore';
import { ref, get } from '@react-native-firebase/database';
import { updateLeaderboardCacheRealtime } from './updateLeaderboardCache';

export const loadGameStats = async (firestoreDB, uid) => {
  if (!firestoreDB || !uid) return null;
  try {
    const snap = await getDoc(doc(firestoreDB, 'games', uid));
    return snap.exists() ? (snap.data() || {}) : {};
  } catch (err) {
    console.warn('[Games] load error:', err?.message);
    return null;
  }
};

export const saveGameStats = async (firestoreDB, uid, fields) => {
  if (!firestoreDB || !uid) return;
  try {
    await setDoc(doc(firestoreDB, 'games', uid), fields, { merge: true });
  } catch (err) {
    console.warn('[Games] save error:', err?.message);
  }
};

export const submitLeaderboardScore = async ({ firestoreDB, appdatabase, uid, user, gameKey, score }) => {
  if (!firestoreDB || !uid || !gameKey || !(score > 0)) return;
  try {
    let username = user?.displayName || 'Unknown';
    let avatar = null;
    if (appdatabase) {
      try {
        const [nameSnap, avatarSnap] = await Promise.all([
          get(ref(appdatabase, `users/${uid}/displayName`)),
          get(ref(appdatabase, `users/${uid}/avatar`)),
        ]);
        if (nameSnap.exists()) username = nameSnap.val();
        avatar = avatarSnap.exists() ? avatarSnap.val() : null;
      } catch (_) {}
    }

    await setDoc(doc(firestoreDB, 'game_scores', gameKey, 'scores', uid), {
      score,
      username,
      avatar,
      updatedAt: new Date(),
    }, { merge: true });

    await updateLeaderboardCacheRealtime(firestoreDB, gameKey, uid, score, username, avatar);
  } catch (err) {
    console.warn(`[Games] leaderboard error (${gameKey}):`, err?.message);
  }
};
