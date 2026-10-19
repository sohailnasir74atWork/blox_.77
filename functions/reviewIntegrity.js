/**
 * Review integrity: scores every review and keeps a verified rating per user.
 *
 * scoreReviewOnWrite   Firestore trigger on reviews/{reviewId}. Collects the
 *                      signals in reviewSignals.js, writes the verdict to
 *                      review_scores/{reviewId} and adjusts
 *                      review_verified_summary/{toUserId} and the profile
 *                      rating user_ratings_summary/{toUserId} in one transaction.
 * voidReviewsOfDeletedUser
 *                      Auth onDelete. Re-scores everything the deleted account
 *                      wrote, so create → review → delete stops counting.
 * guardRatingSummary   Firestore trigger on user_ratings_summary/{uid}. Puts
 *                      the server value back after a staff write (old builds'
 *                      review-delete path still recounts it on the phone).
 *
 * Chat check (2026-10-19): a review counts only when both people sent 2+
 * private messages (Supabase private_messages), the app's bar for "Rate
 * trader". Checked once when the review is created and kept on edits:
 * messages are purged after 30 days, so a later check would drop real
 * reviews. A no-chat review is re-checked on each edit and counts once they
 * have chatted.
 *
 * Old builds (4.0.22+, iOS 8.5) still recount user_ratings_summary on the
 * phone after a review; firestore.rules refuses that write and they ignore
 * the error. They read the summary as before.
 *
 * Collections written (Cloud Functions only):
 *   review_scores/{reviewId}
 *     { fromUserId, toUserId, rating, counted, hard[], soft[], scamReport,
 *       chat, reviewerDevice, reviewCreatedAt, scoredAt, version }
 *   review_verified_summary/{uid}
 *     { count, sum, averageRating, scamReports, excludedCount, flaggedCount,
 *       shownCount, shownSum, updatedAt }
 *   user_ratings_summary/{uid}
 *     { count, averageRating, updatedAt }   = shownCount / shownSum
 *   RTDB users/{uid}/badges/fiveStar        50+ reviews at 4.5+ on the profile
 *
 * Deployment:
 *   firebase deploy --only functions:scoreReviewOnWrite,functions:voidReviewsOfDeletedUser,functions:guardRatingSummary
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');
const {
  BURST_WINDOW_MS, evaluateReview, storedChat, contribution, round2, profileSummary, earnsFiveStar,
} = require('./reviewSignals');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const SCORE_VERSION = 2; // 2: chat verdict stored in `chat`, noChat is HARD

const toMillis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : null);
const scoreRef = (reviewId) => db.collection('review_scores').doc(reviewId);
const summaryRef = (uid) => db.collection('review_verified_summary').doc(uid);
const displayRef = (uid) => db.collection('user_ratings_summary').doc(uid);

let supabaseOverride; // tests only
const supabase = () => (supabaseOverride !== undefined ? supabaseOverride : getSupabaseAdmin());

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

// Both sides sent 2+ private messages (the in-app gate for rating). Counts
// soft-deleted rows too, so it is never stricter than the app. null when
// Supabase is unreachable: an unknown chat never flags a review.
async function hasPrivateChat(a, b) {
  try {
    const sb = supabase();
    if (!sb) throw new Error('no Supabase client');
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

// One Supabase lookup when the review is created; edits keep the stored
// verdict, except a no-chat review, which is checked again.
async function chatVerdict(reviewId, { fromUserId, toUserId }, isNew) {
  if (fromUserId === toUserId) return null;
  if (isNew) return hasPrivateChat(fromUserId, toUserId);
  const prev = storedChat((await scoreRef(reviewId).get()).data());
  if (prev !== false) return prev === undefined ? null : prev; // no score yet: unknown, as the backfill
  const now = await hasPrivateChat(fromUserId, toUserId);
  return now === null ? false : now;
}

async function buildScore(reviewId, review, { isNew = false } = {}) {
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
    chatVerdict(reviewId, review, isNew),
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
    chat: hasChat,
    reviewerDevice,
    reviewCreatedAt: admin.firestore.Timestamp.fromMillis(createdAtMs),
    scoredAt: admin.firestore.FieldValue.serverTimestamp(),
    version: SCORE_VERSION,
  };
}

// Summaries written before 2026-10-19 have no profile tallies: derive them
// once from every score of that user (inside the caller's transaction).
async function withShownTallies(tx, uid, data) {
  if (data.shownCount !== undefined) return data;
  const all = await tx.get(db.collection('review_scores').where('toUserId', '==', uid));
  let shownCount = 0;
  let shownSum = 0;
  all.docs.forEach((d) => {
    const c = contribution(d.data());
    shownCount += c.shownCount;
    shownSum += c.shownSum;
  });
  return { ...data, shownCount, shownSum };
}

// Replace a review's score and move its contribution between summaries
// atomically. score === null removes it (review deleted). Returns the
// profile rating written per user.
async function writeScore(reviewId, score) {
  return db.runTransaction(async (tx) => {
    const oldSnap = await tx.get(scoreRef(reviewId));
    const old = oldSnap.exists ? oldSnap.data() : null;

    const uids = [...new Set([old?.toUserId, score?.toUserId].filter(Boolean))];
    const sums = {};
    for (const uid of uids) {
      const s = await tx.get(summaryRef(uid));
      sums[uid] = s.exists ? await withShownTallies(tx, uid, s.data()) : {};
    }

    const apply = (uid, c, sign) => {
      const s = sums[uid];
      for (const k of Object.keys(c)) s[k] = Math.max(0, (s[k] || 0) + sign * c[k]);
    };
    if (old) apply(old.toUserId, contribution(old), -1);
    if (score) apply(score.toUserId, contribution(score), +1);

    const profiles = {};
    for (const uid of uids) {
      const s = sums[uid];
      const now = admin.firestore.FieldValue.serverTimestamp();
      tx.set(summaryRef(uid), {
        count: s.count || 0,
        sum: s.sum || 0,
        averageRating: s.count ? round2(s.sum / s.count) : 0,
        scamReports: s.scamReports || 0,
        excludedCount: s.excludedCount || 0,
        flaggedCount: s.flaggedCount || 0,
        shownCount: s.shownCount || 0,
        shownSum: s.shownSum || 0,
        updatedAt: now,
      }, { merge: true });
      profiles[uid] = profileSummary(s);
      tx.set(displayRef(uid), { ...profiles[uid], updatedAt: now }, { merge: true });
    }

    if (score) tx.set(scoreRef(reviewId), score);
    else if (old) tx.delete(scoreRef(reviewId));
    return profiles;
  });
}

// 5-Star badge (50+ reviews at 4.5+). Old builds awarded it from the phone
// after their own recount, which the rules now refuse. Best effort.
async function awardFiveStars(profiles) {
  for (const [uid, p] of Object.entries(profiles || {})) {
    if (!earnsFiveStar(p)) continue;
    try {
      const [badge, name] = await Promise.all([
        admin.database().ref(`users/${uid}/badges/fiveStar`).once('value'),
        admin.database().ref(`users/${uid}/displayName`).once('value'),
      ]);
      // No displayName: deleted account — don't recreate its users/{uid} node.
      if (badge.val() !== true && name.exists()) await admin.database().ref(`users/${uid}/badges/fiveStar`).set(true);
    } catch (e) {
      console.warn(`[reviewIntegrity] fiveStar for ${uid} skipped:`, e?.message);
    }
  }
}

async function scoreReviewById(reviewId) {
  const snap = await db.collection('reviews').doc(reviewId).get();
  if (!snap.exists) return writeScore(reviewId, null);
  const review = snap.data();
  if (!review.fromUserId || !review.toUserId) return writeScore(reviewId, null);
  return writeScore(reviewId, await buildScore(reviewId, review));
}

const SCORED_FIELDS = ['fromUserId', 'toUserId', 'rating', 'review'];

// reviews/{uid} also holds profile bios ({ bio, updatedAt }) — not reviews.
const isReview = (d) => !!(d && d.fromUserId && d.toUserId);

async function onReviewWrite(reviewId, before, after) {
  if (!isReview(before) && !isReview(after)) return null;

  if (!after) {
    await writeScore(reviewId, null);
    return null;
  }

  // Edits that only touch updatedAt/edited (the client's merge-set) need no re-score.
  if (before && SCORED_FIELDS.every((f) => before[f] === after[f])) return null;

  if (!after.fromUserId || !after.toUserId) {
    await writeScore(reviewId, null);
    return null;
  }

  const score = await buildScore(reviewId, after, { isNew: !isReview(before) });
  await awardFiveStars(await writeScore(reviewId, score));
  if (!score.counted) {
    console.log(`[reviewIntegrity] ${reviewId} excluded: ${score.hard.join(',')}`);
  }
  return score;
}

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
    // Retried events older than 10 minutes are dropped rather than looping.
    if (Date.now() - Date.parse(context.timestamp) > 10 * 60 * 1000) return null;

    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;
    await onReviewWrite(context.params.reviewId, before, after);
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

// The profile rating must equal the server tallies. Rewrites it when a
// staff write (or anything else) left a different value; a no-op for the
// server's own writes. Users not yet migrated (no shownCount) are left alone.
async function guardSummary(uid) {
  return db.runTransaction(async (tx) => {
    const [v, d] = await Promise.all([tx.get(summaryRef(uid)), tx.get(displayRef(uid))]);
    if (!v.exists || v.data().shownCount === undefined || !d.exists) return false;
    const want = profileSummary(v.data());
    const have = d.data();
    if (have.count === want.count && Math.abs((have.averageRating || 0) - want.averageRating) < 0.005) return false;
    tx.set(displayRef(uid), { ...want, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}

exports.guardRatingSummary = functions
  .runWith({ memory: '128MB', timeoutSeconds: 30 })
  .firestore
  .document('user_ratings_summary/{uid}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null;
    if (await guardSummary(context.params.uid)) {
      console.log(`[reviewIntegrity] user_ratings_summary/${context.params.uid} restored`);
    }
    return null;
  });

exports._internal = {
  onReviewWrite,
  scoreReviewById,
  guardSummary,
  hasPrivateChat,
  setSupabaseForTest: (client) => { supabaseOverride = client; },
};
