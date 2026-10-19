/**
 * reviewModeration.js — staff removal of a trader review: Firestore
 * reviews/{toUserId_fromUserId} is deleted; the rated player's
 * user_ratings_summary follows on the server (functions/reviewIntegrity.js,
 * since 2026-10-19). Shared by the Admin Dashboard's review list, the profile
 * drawer, the Reviews tab and More ▸ Admin's "Remove review" on a reported
 * review, so all keep the same rule: staff may only remove a review left by
 * someone strictly below them (fresh RTDB roles). Callers log the removal
 * with logModAction('review_delete', …) (Helper/modSanction).
 */

import { doc, getDoc, deleteDoc } from '@react-native-firebase/firestore';
import { fetchUserRoles, canModerate, getStaffRank, STAFF_RANK, isCurrentUserOwner } from '../ChatScreen/utils';

// Callers pass role flags from useGlobalState, which has no owner flag.
const withOwner = (roles) => ({ ...(roles || {}), isOwner: !!roles?.isOwner || isCurrentUserOwner() });

/** True when the caller may remove a review written by `fromUserId`. */
// Reviews can be deleted by admins only (owner decision, 2026-10-18).
// Moderators used to remove reviews written by regular players.
// Blox also keeps its rank rule: an admin cannot remove a review left by
// staff at or above their rank (only the owner outranks admins).
export const canDeleteReviews = (callerRoles) => getStaffRank(withOwner(callerRoles)) >= STAFF_RANK.admin;

// Fails closed: when the reviewer's roles can't be read, the review stays.
export async function canRemoveReview(fromUserId, callerRoles, selfId) {
  if (!canDeleteReviews(callerRoles)) return false;
  if (!fromUserId || fromUserId === selfId) return true;
  const reviewerRoles = await fetchUserRoles(fromUserId);
  return !!reviewerRoles && canModerate(withOwner(callerRoles), reviewerRoles);
}

/**
 * Delete the review. scoreReviewOnWrite recounts the rated player's rating
 * summary when the review goes, so nothing else is written here; toUserId /
 * rating stay in the callers' calls for their logs.
 */
export async function deleteReviewAndSummary(firestoreDB, { id }) {
  await deleteDoc(doc(firestoreDB, 'reviews', id));
}

/** The review as stored now, or null when it has already been removed. */
export async function fetchReview(firestoreDB, reviewId) {
  const snap = await getDoc(doc(firestoreDB, 'reviews', reviewId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
