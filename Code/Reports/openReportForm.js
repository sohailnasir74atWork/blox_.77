/**
 * openReportForm — open More ▸ Complaints & ideas from anywhere (the ban card,
 * a review's flag inside the profile drawer, Settings) with a complaint
 * category picked and, for "Report review", the review attached. Goes through
 * the global navigation ref because the profile drawer is a modal with no
 * navigator of its own. `initial: false` keeps the More hub under the form.
 *
 *   openReportForm({ category: 'ban_appeal' })
 *   openReportForm({ category: 'false_review', review: { id, toUserId, fromUserId, userName, rating, review } })
 */

import { navigate } from '../Helper/navigationService';

export const openReportForm = ({ category, review = null }) => {
  navigate('Home', {
    screen: 'More',
    params: {
      screen: 'MoreReport',
      initial: false,
      // `at` makes every open a new params object, so the form re-applies it
      // even when it is already on screen.
      params: { category, review, at: Date.now() },
    },
  });
};

/** The review fields the form shows and sends; nothing else leaves the list. */
export const reviewForReport = (rev, fallbackToUserId) => ({
  id: rev.id,
  toUserId: rev.toUserId || fallbackToUserId || null,
  fromUserId: rev.fromUserId || null,
  userName: rev.userName || rev.reviewerName || null,
  rating: Number(rev.rating) || 0,
  review: typeof rev.review === 'string' ? rev.review.slice(0, 300) : '',
});
