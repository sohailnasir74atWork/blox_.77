/**
 * Scheduled Cloud Function: pre-computes the Top Rated leaderboard (top 50).
 *
 * Runs daily at 00:00 UTC and writes leaderboard_cache/top50, which the app
 * reads as a single document (LeaderboardScreen.jsx / LeaderboardModal.jsx).
 *
 * Source of truth (2026-09): review_verified_summary, kept by
 * reviewIntegrity.js. Only reviews that pass the integrity checks count, so
 * alt accounts, same-phone reviews, self-reviews and deleted-account reviews
 * no longer move anyone up. Traders with a high share of scam reports from
 * genuine accounts are held off the list (reviewSignals.isScamHold); a lower
 * share only puts them on a watch list. Both go to leaderboard_cache/holds
 * for moderators. A moderator can also set leaderboardHold: true on
 * review_verified_summary/{uid}. Since 2026-10-19 a review from someone who
 * never chatted with the trader (noChat) is one of the excluded ones.
 *
 * Until the backfill has populated review_verified_summary, it falls back to
 * user_ratings_summary (the profile rating; server-kept since 2026-10-19).
 *
 * Ranking: most reviews first, average rating breaks ties; average >= 3.7.
 * The top50 document keeps its original shape so every app build renders it.
 */

const functions = require("firebase-functions/v1");
const admin = require('firebase-admin');
const { isScamHold, isScamWatch } = require('./reviewSignals');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const MIN_RATING_THRESHOLD = 3.7;
const TOP_USERS_LIMIT = 50;
const CANDIDATE_LIMIT = 300;          // top verified counts read per run
const MIN_VERIFIED_DOCS = 1000;       // below this the backfill hasn't run yet
const DEFAULT_AVATAR = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';

async function loadCandidates() {
  const verifiedCount = (await db.collection('review_verified_summary').count().get()).data().count;
  if (verifiedCount >= MIN_VERIFIED_DOCS) {
    const snap = await db.collection('review_verified_summary')
      .orderBy('count', 'desc')
      .limit(CANDIDATE_LIMIT)
      .get();
    return {
      source: 'verified',
      users: snap.docs.map((d) => ({ userId: d.id, ...d.data() })),
    };
  }

  // Legacy path: every user_ratings_summary doc, as before.
  const snap = await db.collection('user_ratings_summary').get();
  return {
    source: 'legacy',
    users: snap.docs.map((d) => ({ userId: d.id, ...d.data() })),
  };
}

async function buildLeaderboard() {
  const { source, users } = await loadCandidates();

  const holds = [];
  const watch = [];
  const eligible = [];
  for (const u of users) {
    const ratingCount = u.count || 0;
    const averageRating = u.averageRating || 0;
    if (ratingCount <= 0 || averageRating < MIN_RATING_THRESHOLD) continue;
    if (u.leaderboardHold === true) {
      holds.push({ userId: u.userId, reason: 'manual', ratingCount, scamReports: u.scamReports || 0 });
      continue;
    }
    if (source === 'verified' && isScamHold(u)) {
      holds.push({ userId: u.userId, reason: 'scamReports', ratingCount, scamReports: u.scamReports });
      continue;
    }
    if (source === 'verified' && isScamWatch(u)) {
      watch.push({ userId: u.userId, ratingCount, scamReports: u.scamReports });
    }
    eligible.push({
      userId: u.userId,
      ratingCount,
      averageRating,
      updatedAt: u.updatedAt ? u.updatedAt.toMillis() : Date.now(),
    });
  }

  eligible.sort((a, b) =>
    b.ratingCount !== a.ratingCount ? b.ratingCount - a.ratingCount : b.averageRating - a.averageRating);
  const topUsers = eligible.slice(0, TOP_USERS_LIMIT);

  const rtdb = admin.database();
  const withDetails = await Promise.all(topUsers.map(async (user, i) => {
    let userData = null;
    try {
      const [name, avatar] = await Promise.all([
        rtdb.ref(`users/${user.userId}/displayName`).once('value'),
        rtdb.ref(`users/${user.userId}/avatar`).once('value'),
      ]);
      userData = { displayName: name.val(), avatar: avatar.val() };
    } catch (error) {
      console.error(`❌ [Leaderboard] Error fetching details for user ${user.userId}:`, error);
    }
    return {
      userId: user.userId,
      ratingCount: user.ratingCount,
      averageRating: user.averageRating,
      displayName: userData?.displayName || 'Anonymous',
      avatar: userData?.avatar || DEFAULT_AVATAR,
      rank: i + 1,
      updatedAt: user.updatedAt,
    };
  }));

  await db.collection('leaderboard_cache').doc('top50').set({
    users: withDetails,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    version: source === 'verified' ? '2.0-verified' : '1.0',
    minRatingThreshold: MIN_RATING_THRESHOLD,
    totalUsers: withDetails.length,
  }, { merge: false });

  await db.collection('leaderboard_cache').doc('holds').set({
    users: holds.sort((a, b) => b.ratingCount - a.ratingCount).slice(0, 200),
    watch: watch.sort((a, b) => b.ratingCount - a.ratingCount).slice(0, 200),
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    source,
  }, { merge: false });

  console.log(`✅ [Leaderboard] ${source}: ${withDetails.length} ranked, ${holds.length} held, ${watch.length} on watch`);
  withDetails.slice(0, 3).forEach((u, i) => {
    console.log(`   ${i + 1}. ${u.displayName} - ${u.ratingCount} reviews, ${u.averageRating.toFixed(2)} rating`);
  });
  return { success: true, source, userCount: withDetails.length, held: holds.length };
}

exports.updateLeaderboardCache = functions
  .runWith({ memory: '256MB', timeoutSeconds: 120 })
  .pubsub
  .schedule('0 0 * * *') // Run daily at 12:00 AM UTC
  .timeZone('UTC')
  .onRun(async () => {
    try {
      return await buildLeaderboard();
    } catch (error) {
      console.error('❌ [Leaderboard] Error updating leaderboard cache:', error);
      throw error;
    }
  });

exports.buildLeaderboard = buildLeaderboard;
