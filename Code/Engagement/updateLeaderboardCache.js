/**
 * updateLeaderboardCache.js
 * Shared utility — updates the game_leaderboard_cache document in real-time
 * Called after each game ends so the leaderboard reflects scores immediately.
 *
 * Cost: 1 Firestore read + 1 write per game end (only if score qualifies for top 20)
 */

import { doc, getDoc, setDoc } from '@react-native-firebase/firestore';

const GAMES_ORDER = {
  whack:  'desc',
  safe:   'desc',
  draw:   'asc',   // Lower ms = better
  memory: 'asc',   // Fewer moves = better
};

const MAX_ENTRIES = 20;

/**
 * After a game ends, update the leaderboard cache document if the user's score
 * qualifies for the top 20.
 *
 * @param {object} firestoreDB - Firestore database instance
 * @param {string} gameId      - 'whack' | 'safe' | 'draw' | 'memory'
 * @param {string} uid         - User ID
 * @param {number} score       - The user's best score
 * @param {string} username    - Display name
 * @param {string|null} avatar - Avatar URL
 */
export const updateLeaderboardCacheRealtime = async (
  firestoreDB,
  gameId,
  uid,
  score,
  username,
  avatar,
) => {
  if (!firestoreDB || !gameId || !uid || score == null) return;

  const order = GAMES_ORDER[gameId];
  if (!order) return;

  // Skip invalid scores
  if (score <= 0) return;
  if (order === 'asc' && score >= 999) return;

  try {
    const cacheRef = doc(firestoreDB, 'game_leaderboard_cache', gameId);
    const cacheSnap = await getDoc(cacheRef);

    let users = [];
    if (cacheSnap.exists()) {
      const data = cacheSnap.data();
      users = Array.isArray(data?.users) ? [...data.users] : [];
    }

    // Remove existing entry for this user (if any)
    users = users.filter(u => u.uid !== uid);

    // Add the new entry
    users.push({
      uid,
      score,
      username: username || 'Unknown',
      avatar: avatar || null,
    });

    // Sort by order
    users.sort((a, b) =>
      order === 'asc' ? a.score - b.score : b.score - a.score
    );

    // Keep only top 20
    users = users.slice(0, MAX_ENTRIES);

    // Check if user is in the top 20 — if not, no need to write
    const userInTop = users.some(u => u.uid === uid);
    if (!userInTop && cacheSnap.exists()) {
      return;
    }

    // Write updated cache
    await setDoc(cacheRef, {
      users,
      gameId,
      lastUpdated: new Date(),
      userCount: users.length,
    });
  } catch (err) {
    // Non-critical — don't block game flow
    console.warn(`[LeaderboardCache] Update failed for ${gameId}:`, err?.message);
  }
};
