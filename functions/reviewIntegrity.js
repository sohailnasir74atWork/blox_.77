/**
 * Review integrity: scores every review and keeps a verified rating per user.
 *
 * scoreReviewOnWrite   Firestore trigger on reviews/{reviewId}. Collects the
 *                      signals in reviewSignals.js, writes the verdict to
 *                      review_scores/{reviewId} and adjusts
 *                      review_verified_summary/{toUserId} in one transaction.
 * voidReviewsOfDeletedUser
 *                      Auth onDelete. Re-scores everything the deleted account
 *                      wrote, so create → review → delete stops counting.
 *
 * Backward compatible: nothing a client reads or writes changes. Clients keep
 * writing reviews + user_ratings_summary exactly as before; only the Top
 * Rated leaderboard (updateLeaderboardCache) reads the verified numbers.
 *
 * Collections written (Cloud Functions only):
 *   review_scores/{reviewId}
 *     { fromUserId, toUserId, rating, counted, hard[], soft[], scamReport,
 *       reviewerDevice, reviewCreatedAt, scoredAt, version }
 *   review_verified_summary/{uid}
 *     { count, sum, averageRating, scamReports, excludedCount, flaggedCount, updatedAt }
 *
 * Deployment:
 *   firebase deploy --only functions:scoreReviewOnWrite,functions:voidReviewsOfDeletedUser
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');
const { BURST_WINDOW_MS, evaluateReview, contribution } = require('./reviewSignals');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const SCORE_VERSION = 1;

const toMillis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : null);

async function getDeviceId(uid) {
  try {
    // users_private since the ban-enforcement change; users/{uid} for old builds.
    const [priv, legacy] = await Promise.all([
      admin.database().ref(`users_private/${uid}/deviceId`).once('value'),
      admin.database().ref(`users/${uid}/deviceId`).once('value'),
    ]);
    const v = priv.val() || legacy.val();
    return typeof v === 'string' && v ? v : null;
  } catch (_) {
    return null;
  }
}

async function getReviewer(uid) {
  try {
    const u = await admin.auth().getUser(uid);
    return { exists: true, createdAtMs: Date.parse(u.metadata.creationTime) || null };
  } catch (e) {
    if (e?.code === 'auth/user-not-found' || e?.code === 'auth/invalid-uid') return { exists: false, createdAtMs: null };
    throw e; // transient — let the trigger retry rather than void a real review
  }
}

// Both sides sent 2+ private messages (the in-app gate for rating). null when
// Supabase is unreachable: an unknown chat never flags a review.
async function hasPrivateChat(a, b) {
  try {
    const sb = getSupabaseAdmin();
    const chatId = [a, b].sort().join('_');
    const counts = await Promise.all([a, b].map(async (sender) => {
      const { count, error } = await sb
        .from('private_messages')
        .select('id', { count: 'exact', head: true })
        .eq('chat_id', chatId)
        .eq('sender_id', sender);
      if (error) throw error;
      return count || 0;
    }));
    return counts.every((c) => c >= 2);
  } catch (e) {
    console.warn('[reviewIntegrity] chat check skipped:', e?.message);
    return null;
  }
}

async function buildScore(reviewId, review) {
  const { fromUserId, toUserId } = review;
  const createdAtMs = toMillis(review.createdAt) || Date.now();

  const [reviewer, reviewerDevice, revieweeDevice, reverseSnap, recent, hasChat] = await Promise.all([
    getReviewer(fromUserId),
    getDeviceId(fromUserId),
    getDeviceId(toUserId),
    db.collection('reviews').doc(`${fromUserId}_${toUserId}`).get(),
    db.collection('reviews')
      .where('toUserId', '==', toUserId)
      .where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(createdAtMs - BURST_WINDOW_MS))
      .where('createdAt', '<', admin.firestore.Timestamp.fromMillis(createdAtMs))
      .orderBy('createdAt', 'desc') // uses the live (toUserId ASC, createdAt DESC) index
      .count()
      .get(),
    fromUserId === toUserId ? Promise.resolve(null) : hasPrivateChat(fromUserId, toUserId),
  ]);

  let earlierSameDevice = false;
  if (reviewerDevice) {
    const same = await db.collection('review_scores')
      .where('toUserId', '==', toUserId)
      .where('reviewerDevice', '==', reviewerDevice)
      .get();
    earlierSameDevice = same.docs.some((d) => {
      const s = d.data();
      return d.id !== reviewId && s.fromUserId !== fromUserId && (toMillis(s.reviewCreatedAt) || 0) < createdAtMs;
    });
  }

  const verdict = evaluateReview({
    reviewId,
    review,
    createdAtMs,
    reviewerExists: reviewer.exists,
    reviewerCreatedAtMs: reviewer.createdAtMs,
    reviewerDevice,
    revieweeDevice,
    earlierSameDevice,
    reverseCreatedAtMs: reverseSnap.exists ? toMillis(reverseSnap.data().createdAt) : null,
    recentReceivedCount: recent.data().count,
    hasChat,
  });

  return {
    fromUserId,
    toUserId,
    rating: review.rating,
    ...verdict,
    reviewerDevice,
    reviewCreatedAt: admin.firestore.Timestamp.fromMillis(createdAtMs),
    scoredAt: admin.firestore.FieldValue.serverTimestamp(),
    version: SCORE_VERSION,
  };
}

// Replace a review's score and move its contribution between summaries
// atomically. score === null removes it (review deleted).
async function writeScore(reviewId, score) {
  const scoreRef = db.collection('review_scores').doc(reviewId);
  const summaryRef = (uid) => db.collection('review_verified_summary').doc(uid);

  await db.runTransaction(async (tx) => {
    const oldSnap = await tx.get(scoreRef);
    const old = oldSnap.exists ? oldSnap.data() : null;

    const uids = [...new Set([old?.toUserId, score?.toUserId].filter(Boolean))];
    const sums = {};
    for (const uid of uids) {
      const s = await tx.get(summaryRef(uid));
      sums[uid] = s.exists ? s.data() : {};
    }

    const apply = (uid, c, sign) => {
      const s = sums[uid];
      for (const k of Object.keys(c)) s[k] = Math.max(0, (s[k] || 0) + sign * c[k]);
    };
    if (old) apply(old.toUserId, contribution(old), -1);
    if (score) apply(score.toUserId, contribution(score), +1);

    for (const uid of uids) {
      const s = sums[uid];
      tx.set(summaryRef(uid), {
        count: s.count || 0,
        sum: s.sum || 0,
        averageRating: s.count ? Math.round((s.sum / s.count) * 100) / 100 : 0,
        scamReports: s.scamReports || 0,
        excludedCount: s.excludedCount || 0,
        flaggedCount: s.flaggedCount || 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    if (score) tx.set(scoreRef, score);
    else if (old) tx.delete(scoreRef);
  });
}

async function scoreReviewById(reviewId) {
  const snap = await db.collection('reviews').doc(reviewId).get();
  if (!snap.exists) return writeScore(reviewId, null);
  const review = snap.data();
  if (!review.fromUserId || !review.toUserId) return writeScore(reviewId, null);
  return writeScore(reviewId, await buildScore(reviewId, review));
}

const SCORED_FIELDS = ['fromUserId', 'toUserId', 'rating', 'review'];

exports.scoreReviewOnWrite = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '256MB',
    timeoutSeconds: 60,
    failurePolicy: true, // retry transient Auth/RTDB errors
  })
  .firestore
  .document('reviews/{reviewId}')
  .onWrite(async (change, context) => {
    const { reviewId } = context.params;

    // Retried events older than 10 minutes are dropped rather than looping.
    if (Date.now() - Date.parse(context.timestamp) > 10 * 60 * 1000) return null;

    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;
    // reviews/{uid} also holds profile bios ({ bio, updatedAt }) — not reviews.
    const isReview = (d) => !!(d && d.fromUserId && d.toUserId);
    if (!isReview(before) && !isReview(after)) return null;

    if (!change.after.exists) {
      await writeScore(reviewId, null);
      return null;
    }

    // Edits that only touch updatedAt/edited (the client's merge-set) need no re-score.
    if (before && SCORED_FIELDS.every((f) => before[f] === after[f])) return null;

    if (!after.fromUserId || !after.toUserId) {
      await writeScore(reviewId, null);
      return null;
    }

    const score = await buildScore(reviewId, after);
    await writeScore(reviewId, score);
    if (!score.counted) {
      console.log(`[reviewIntegrity] ${reviewId} excluded: ${score.hard.join(',')}`);
    }
    return null;
  });

exports.scoreReviewById = scoreReviewById; // backfill fixes / tests

exports.voidReviewsOfDeletedUser = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '256MB',
    timeoutSeconds: 120,
  })
  .auth
  .user()
  .onDelete(async (user) => {
    const written = await db.collection('reviews').where('fromUserId', '==', user.uid).select().get();
    for (const doc of written.docs) {
      try {
        await scoreReviewById(doc.id);
      } catch (e) {
        console.error(`[reviewIntegrity] re-score ${doc.id} after delete failed:`, e?.message);
      }
    }
    if (written.size) console.log(`[reviewIntegrity] voided ${written.size} review(s) by deleted ${user.uid}`);
    return null;
  });
