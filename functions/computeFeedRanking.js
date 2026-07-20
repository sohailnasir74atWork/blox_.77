const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();
const rtdb = admin.database();
/**
 * computeFeedRanking
 *
 * SCHEDULED Cloud Function — runs every 30 minutes.
 * Reads recent posts from Firestore `designPosts_upgrade` (server-side =
 * zero user cost). Computes Hot & Trending scores, writes ranked post IDs
 * to RTDB `/feedRanking`.
 *
 * The Feed screen's Hot / Trending sort tabs read this pre-computed list
 * from RTDB (cheap), then fetch the individual post docs by ID. Without
 * this function those tabs are permanently empty — the client reads
 * `feedRanking/{hot|trending}` but nothing writes it.
 *
 * Scoring (ported from adoptme-jan7):
 *   Hot      = (reactions + comments×2) / (hoursAge + 2)^1.5
 *   Trending = (reactions + comments×2) / (hoursAge + 0.5)^2
 *
 * Deployment:
 *   firebase deploy --only functions:computeFeedRanking
 */
// ── Helper: count total reactions on a post ──
const countReactions = (post) => {
  let count = 0;
  if (post.reactions && typeof post.reactions === 'object') {
    count += Object.keys(post.reactions).length;
  }
  if (post.likes && typeof post.likes === 'object') {
    // Don't double-count users who also have a reaction
    const reactionUsers = post.reactions ? new Set(Object.keys(post.reactions)) : new Set();
    Object.keys(post.likes).forEach(uid => {
      if (!reactionUsers.has(uid)) count++;
    });
  }
  return count;
};
// ── Helper: get hours since post creation ──
const getHoursAge = (post, now) => {
  const createdAt = post.createdAt?.toDate ? post.createdAt.toDate() : new Date(post.createdAt);
  return Math.max(0, (now - createdAt.getTime()) / (1000 * 60 * 60));
};
// ── Scheduled function: runs every 30 minutes ──
exports.computeFeedRanking = functions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .pubsub.schedule('every 30 minutes')
  .onRun(async (context) => {
    try {
      const now = Date.now();
      const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000);
      // ── Fetch posts from last 48 hours ──
      const snapshot = await firestore
        .collection('designPosts_upgrade')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(twoDaysAgo))
        .orderBy('createdAt', 'desc')
        .limit(200)
        .get();
      if (snapshot.empty) {
        console.log('ℹ️ No recent posts found. Writing empty rankings.');
        await rtdb.ref('feedRanking').set({
          hot: [],
          trending: [],
          updatedAt: admin.database.ServerValue.TIMESTAMP,
        });
        return null;
      }
      const posts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      console.log(`📦 Fetched ${posts.length} posts from last 48h`);
      // ── Compute scores ──
      const scored = posts.map(post => {
        const reactions = countReactions(post);
        const comments = post.commentCount || 0;
        const hoursAge = getHoursAge(post, now);
        const engagement = reactions + (comments * 2);
        // Hot: engagement decays slowly (rewards sustained popularity)
        const hotScore = engagement / Math.pow(hoursAge + 2, 1.5);
        // Trending: steeper decay (rewards recent bursts)
        const trendingScore = engagement / Math.pow(hoursAge + 0.5, 2);
        return {
          postId: post.id,
          hotScore,
          trendingScore,
          engagement,
          reactions,
          comments,
        };
      });
      // ── Rank: Hot (top 10) — filter out zero-engagement posts ──
      const hot = scored
        .filter(p => p.engagement > 0)
        .sort((a, b) => b.hotScore - a.hotScore)
        .slice(0, 10)
        .map(({ postId, hotScore, engagement, reactions, comments }) => ({
          postId,
          score: Math.round(hotScore * 1000) / 1000,
          engagement,
          reactions,
          comments,
        }));
      // ── Rank: Trending (top 10) — filter out zero-engagement posts ──
      const trending = scored
        .filter(p => p.engagement > 0)
        .sort((a, b) => b.trendingScore - a.trendingScore)
        .slice(0, 10)
        .map(({ postId, trendingScore, engagement, reactions, comments }) => ({
          postId,
          score: Math.round(trendingScore * 1000) / 1000,
          engagement,
          reactions,
          comments,
        }));
      // ── Write to RTDB ──
      await rtdb.ref('feedRanking').set({
        hot,
        trending,
        totalPostsScanned: posts.length,
        updatedAt: admin.database.ServerValue.TIMESTAMP,
        computedAt: new Date().toISOString(),
      });
      console.log(`✅ Feed ranking done: ${hot.length} hot, ${trending.length} trending from ${posts.length} posts`);
      return null;
    } catch (error) {
      console.error('❌ Error computing feed ranking:', error);
      return null;
    }
  });
