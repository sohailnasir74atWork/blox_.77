/**
 * reviewModeration.js — staff removal of a trader review: Firestore
 * reviews/{toUserId_fromUserId} is deleted and its stars come out of the rated
 * player's user_ratings_summary. Shared by the Admin Dashboard's review list
 * and More ▸ Admin's "Remove review" on a reported review (2026-10-18), so
 * both keep the same rule: staff may only remove a review left by someone
 * strictly below them (outranksUser, fresh RTDB roles). Callers log the
 * removal with logModAction('review_delete', …) (Helper/modSanction).
 */

import { doc, getDoc, deleteDoc, setDoc } from '@react-native-firebase/firestore';
import { outranksUser, getStaffRank, STAFF_RANK } from '../ChatScreen/utils';

const toRating = (r) => {
  const n = typeof r === 'number' ? r : Number(r);
  return Number.isNaN(n) ? 0 : n;
};

/** True when the caller may remove a review written by `fromUserId`. */
// Reviews can be deleted by admins only (owner decision, 2026-10-18).
// Moderators used to remove reviews written by regular players.
// Blox also keeps its rank rule: an admin cannot remove a review left by
// staff at or above their rank (only the owner outranks admins).
export const canDeleteReviews = (callerRoles) => getStaffRank(callerRoles || {}) >= STAFF_RANK.admin;

export async function canRemoveReview(fromUserId, callerRoles, selfId) {
  if (!canDeleteReviews(callerRoles)) return false;
  if (!fromUserId || fromUserId === selfId) return true;
  return outranksUser(fromUserId, callerRoles);
}

/**
 * Delete the review and recount the summary of the player it was about.
 * `toUserId` and `rating` come from the review itself when the caller has it.
 */
export async function deleteReviewAndSummary(firestoreDB, { id, toUserId, rating }) {
  await deleteDoc(doc(firestoreDB, 'reviews', id));
  if (!toUserId) return;
  const summaryRef = doc(firestoreDB, 'user_ratings_summary', toUserId);
  const summarySnap = await getDoc(summaryRef);
  if (!summarySnap.exists()) return;
  const s = summarySnap.data();
  const oldAvg = s?.averageRating || 0;
  const oldCount = s?.count || 0;
  if (oldCount <= 1) {
    // Last review — reset summary
    await setDoc(summaryRef, { averageRating: 0, count: 0 }, { merge: true });
  } else {
    const newCount = oldCount - 1;
    const newAvg = ((oldAvg * oldCount) - toRating(rating)) / newCount;
    await setDoc(summaryRef, {
      averageRating: parseFloat(newAvg.toFixed(2)),
      count: newCount,
    }, { merge: true });
  }
}

/** The review as stored now, or null when it has already been removed. */
export async function fetchReview(firestoreDB, reviewId) {
  const snap = await getDoc(doc(firestoreDB, 'reviews', reviewId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
