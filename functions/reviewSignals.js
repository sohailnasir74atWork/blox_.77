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
 *
 * noChat (2026-10-19, HARD): the two people never had a real private chat
 * (both sides 2+ messages, the app's bar for "Rate trader"). Reviews written
 * from the website profile page or straight to Firestore skipped that gate.
 * The verdict is taken when the review is created and kept on edits, because
 * private messages are purged after 30 days (supabase/026).
 *
 * The profile rating (user_ratings_summary, shown in the app and on the
 * website) is server-kept from the same scores: it leaves out the reviews in
 * PROFILE_HIDDEN and still counts the other HARD flags, as before.
 */

const NEW_ACCOUNT_MS = 3 * 24 * 60 * 60 * 1000; // reviewer younger than 3 days
const SWAP_WINDOW_MS = 10 * 60 * 1000;          // "I rate you, you rate me" inside 10 min
const BURST_WINDOW_MS = 60 * 60 * 1000;         // reviews received in the last hour…
const BURST_MIN = 10;                           // …at or above this count
// A stored noChat verdict from before version 2 is only trusted when the
// review was scored within this long of being written (i.e. on creation).
const CREATE_WINDOW_MS = 60 * 60 * 1000;
const FIVE_STAR = { minCount: 50, minAverage: 4.5 }; // 5-Star badge (badgeUtils)

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
  NO_CHAT: 'noChat',                     // never chatted (both sides 2+ private messages)
};

const SOFT = {
  NEW_ACCOUNT: 'newAccount',
  QUICK_SWAP: 'quickSwap',
  BURST: 'burst',
};

// HARD flags that also keep a review out of the profile rating. The others
// (device, deleted account) only affect Top Rated, as before 2026-10-19.
// Owner decision pending: adding them shows the verified rating on profiles
// (4,148 of 22,407 profiles change; re-run scripts/recount-review-summaries.js).
const PROFILE_HIDDEN = new Set([HARD.SELF, HARD.ID_MISMATCH, HARD.INVALID_RATING, HARD.NO_CHAT]);

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
 * @param {boolean|null} i.hasChat            both sides sent 2+ private messages (null = unknown,
 *                                            e.g. reviews older than the message purge)
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
  if (i.hasChat === false) hard.push(HARD.NO_CHAT);

  if (i.reviewerCreatedAtMs && i.createdAtMs - i.reviewerCreatedAtMs < NEW_ACCOUNT_MS) soft.push(SOFT.NEW_ACCOUNT);
  if (i.reverseCreatedAtMs && Math.abs(i.createdAtMs - i.reverseCreatedAtMs) < SWAP_WINDOW_MS) soft.push(SOFT.QUICK_SWAP);
  if ((i.recentReceivedCount || 0) >= BURST_MIN) soft.push(SOFT.BURST);

  const counted = hard.length === 0;
  const scamReport = counted && rating <= 2 && SCAM_RE.test(i.review.review || '');
  return { counted, hard, soft, scamReport };
}

const toMillis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : null);

/**
 * The chat verdict a stored score carries: true, false or null (unknown).
 * Version 2 stores it as `chat`. Version 1 only has the old SOFT noChat flag,
 * which is trusted when it was set on creation; set on a later edit it mostly
 * means the chat had been purged (158 of 164 on 2026-10-19), so it is unknown.
 * undefined = no stored score.
 */
function storedChat(score) {
  if (!score) return undefined;
  if (score.chat === true || score.chat === false || score.chat === null) return score.chat;
  const flags = [...(score.hard || []), ...(score.soft || [])];
  if (!flags.includes(HARD.NO_CHAT)) return null;
  const scoredAt = toMillis(score.scoredAt);
  const createdAt = toMillis(score.reviewCreatedAt);
  return scoredAt != null && createdAt != null && scoredAt - createdAt <= CREATE_WINDOW_MS ? false : null;
}

/** True when the review counts in the profile rating (user_ratings_summary). */
function shownOnProfile(score) {
  return !!score && typeof score.rating === 'number' && score.rating > 0
    && !(score.hard || []).some((f) => PROFILE_HIDDEN.has(f));
}

/** What one score contributes to review_verified_summary/{toUserId}. */
function contribution(score) {
  if (!score) return { count: 0, sum: 0, scamReports: 0, excludedCount: 0, flaggedCount: 0, shownCount: 0, shownSum: 0 };
  const shown = shownOnProfile(score);
  return {
    count: score.counted ? 1 : 0,
    sum: score.counted ? score.rating : 0,
    scamReports: score.scamReport ? 1 : 0,
    excludedCount: score.counted ? 0 : 1,
    flaggedCount: score.counted && (score.soft || []).length > 0 ? 1 : 0,
    shownCount: shown ? 1 : 0,
    shownSum: shown ? score.rating : 0,
  };
}

/** A summary tally with every contribution key at 0. */
const emptyTally = () => contribution(null);

/** Adds (sign 1) or removes (sign -1) one score's contribution, in place. */
function addScore(tally, score, sign = 1) {
  const c = contribution(score);
  for (const k of Object.keys(c)) tally[k] = (tally[k] || 0) + sign * c[k];
  return tally;
}

/** The summary tally of a list of scores. */
const tallyScores = (scores) => scores.reduce((t, s) => addScore(t, s), emptyTally());

/** A stored summary with usable profile tallies (written since 2026-10-19). */
const hasShownTallies = (s) => !!s && Number.isFinite(s.shownCount) && Number.isFinite(s.shownSum);

const round2 = (x) => Math.round(x * 100) / 100;

/** user_ratings_summary/{uid} fields from a review_verified_summary doc. */
function profileSummary(s) {
  const count = (s && s.shownCount) || 0;
  return { count, averageRating: count ? round2(s.shownSum / count) : 0 };
}

// Stamp the server writes next to the profile rating (serverValue), so the
// guard trigger can tell its own writes from a staff write without reads.
const profileStamp = (p) => `${p && p.count}|${p && p.averageRating}`;

const earnsFiveStar = (p) => p.count >= FIVE_STAR.minCount && p.averageRating >= FIVE_STAR.minAverage;

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
  PROFILE_HIDDEN,
  BURST_WINDOW_MS,
  expectedReviewId,
  evaluateReview,
  storedChat,
  shownOnProfile,
  contribution,
  emptyTally,
  addScore,
  tallyScores,
  hasShownTallies,
  round2,
  profileSummary,
  profileStamp,
  earnsFiveStar,
  isScamHold,
  isScamWatch,
};
