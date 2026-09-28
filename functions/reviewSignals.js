/**
 * Pure review-integrity rules, shared by the Cloud Functions
 * (reviewIntegrity.js) and the one-time backfill
 * (scripts/backfill-review-scores.js). No Firebase imports here, so both
 * callers score a review exactly the same way.
 *
 * Thresholds come from the 2026-09-28 audit of the top 50 traders:
 *   - reviews from the reviewee's own phone (SLAX, SOUBARNO, Younis…)
 *   - several accounts on ONE other phone all reviewing the same trader
 *     (KAKAROT 8, ÖG_GÕKÜ 13, GAMER_OG 6)
 *   - reviewers that delete their account right after (Animax: 72% vs a
 *     9% median)
 *
 * HARD flags stop a review counting toward the verified rating and the
 * Top Rated leaderboard. SOFT flags are recorded for moderators only.
 */

const NEW_ACCOUNT_MS = 3 * 24 * 60 * 60 * 1000; // reviewer younger than 3 days
const SWAP_WINDOW_MS = 10 * 60 * 1000;          // "I rate you, you rate me" inside 10 min
const BURST_WINDOW_MS = 60 * 60 * 1000;         // reviews received in the last hour…
const BURST_MIN = 10;                           // …at or above this count

// 1–2★ reviews that accuse the trader of scamming. Counted only when the
// review itself counts, so throwaway accounts cannot bury a trader either.
const SCAM_RE = /scam|skam|fake|\blied\b|\blie\b|stole|steal|not trust|dont trust|don't trust|do not trust/i;

const HARD = {
  SELF: 'self',                          // reviewed themselves
  ID_MISMATCH: 'idMismatch',             // doc id is not {toUserId}_{fromUserId} (forged write)
  INVALID_RATING: 'invalidRating',       // rating not an integer 1–5
  REVIEWER_MISSING: 'reviewerMissing',   // reviewer account deleted / never existed
  SAME_DEVICE: 'sameDeviceAsReviewee',   // reviewer is on the reviewee's phone
  DUPLICATE_DEVICE: 'duplicateDevice',   // another account on this phone already reviewed them
};

const SOFT = {
  NEW_ACCOUNT: 'newAccount',
  QUICK_SWAP: 'quickSwap',
  BURST: 'burst',
  NO_CHAT: 'noChat',
};

const expectedReviewId = (toUserId, fromUserId) => `${toUserId}_${fromUserId}`;

/**
 * @param {object} i
 * @param {string} i.reviewId
 * @param {{fromUserId, toUserId, rating, review}} i.review
 * @param {number} i.createdAtMs              review creation time
 * @param {boolean} i.reviewerExists          Firebase Auth account exists
 * @param {number|null} i.reviewerCreatedAtMs Auth account creation time
 * @param {string|null} i.reviewerDevice      RTDB users/{from}/deviceId
 * @param {string|null} i.revieweeDevice      RTDB users/{to}/deviceId
 * @param {boolean} i.earlierSameDevice       another account on reviewerDevice reviewed toUserId earlier
 * @param {number|null} i.reverseCreatedAtMs  when the reviewee reviewed the reviewer back, if ever
 * @param {number|null} i.recentReceivedCount reviews toUserId received in the hour before this one
 * @param {boolean|null} i.hasChat            both sides sent 2+ private messages (null = unknown)
 */
function evaluateReview(i) {
  const { fromUserId, toUserId, rating } = i.review;
  const hard = [];
  const soft = [];

  if (fromUserId === toUserId) hard.push(HARD.SELF);
  if (i.reviewId !== expectedReviewId(toUserId, fromUserId)) hard.push(HARD.ID_MISMATCH);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) hard.push(HARD.INVALID_RATING);
  if (!i.reviewerExists) hard.push(HARD.REVIEWER_MISSING);
  if (i.reviewerDevice && i.reviewerDevice === i.revieweeDevice) hard.push(HARD.SAME_DEVICE);
  else if (i.reviewerDevice && i.earlierSameDevice) hard.push(HARD.DUPLICATE_DEVICE);

  if (i.reviewerCreatedAtMs && i.createdAtMs - i.reviewerCreatedAtMs < NEW_ACCOUNT_MS) soft.push(SOFT.NEW_ACCOUNT);
  if (i.reverseCreatedAtMs && Math.abs(i.createdAtMs - i.reverseCreatedAtMs) < SWAP_WINDOW_MS) soft.push(SOFT.QUICK_SWAP);
  if ((i.recentReceivedCount || 0) >= BURST_MIN) soft.push(SOFT.BURST);
  if (i.hasChat === false) soft.push(SOFT.NO_CHAT);

  const counted = hard.length === 0;
  const scamReport = counted && rating <= 2 && SCAM_RE.test(i.review.review || '');
  return { counted, hard, soft, scamReport };
}

/** What one score contributes to review_verified_summary/{toUserId}. */
function contribution(score) {
  if (!score) return { count: 0, sum: 0, scamReports: 0, excludedCount: 0, flaggedCount: 0 };
  return {
    count: score.counted ? 1 : 0,
    sum: score.counted ? score.rating : 0,
    scamReports: score.scamReport ? 1 : 0,
    excludedCount: score.counted ? 0 : 1,
    flaggedCount: score.counted && (score.soft || []).length > 0 ? 1 : 0,
  };
}

/**
 * Scam reports from counted reviews, as a share of counted reviews. Top-50
 * median is ~1.5%; Mythic_store*, LUCIFER and Cute girl sit at 15–20%.
 *   hold  → dropped from Top Rated automatically
 *   watch → still ranked, listed for moderators (SLAX: 15 of 307 = 4.9%)
 * Some 1★ "scammer" reviews are revenge from the other side of a dispute,
 * so only the clear cases are automatic.
 */
const scamShare = (s) => (s.scamReports || 0) / Math.max(1, s.count || 0);
const isScamHold = (s) => (s.scamReports || 0) >= 5 && scamShare(s) >= 0.10;
const isScamWatch = (s) => !isScamHold(s) && (s.scamReports || 0) >= 3 && scamShare(s) >= 0.04;

module.exports = {
  HARD,
  SOFT,
  BURST_WINDOW_MS,
  expectedReviewId,
  evaluateReview,
  contribution,
  isScamHold,
  isScamWatch,
};
