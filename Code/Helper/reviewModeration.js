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

/**
 * Senior Mods, Admins and the owner may delete reviews (owner decision
 * 2026-10-19). Plain Mods and JMDs can't (admins only from 2026-10-18,
 * moderators before that).
 */
export const canDeleteReviews = (callerRoles) => getStaffRank(withOwner(callerRoles)) >= STAFF_RANK.seniorMod;

/**
 * True when the caller may remove a review written by `fromUserId` about
 * `toUserId`: only one left by someone strictly below them (a Senior Mod
 * can't remove a Senior Mod's or Admin's review, an Admin can't remove an
 * Admin's; only the owner outranks admins), and a Senior Mod never one
 * about themselves. Fails closed when the reviewer's roles can't be read.
 * firestore.rules checks the same for Senior Mods.
 */
export async function canRemoveReview(fromUserId, callerRoles, selfId, toUserId = null) {
  if (!canDeleteReviews(callerRoles)) return false;
  if (toUserId && toUserId === selfId && getStaffRank(withOwner(callerRoles)) < STAFF_RANK.admin) return false;
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
