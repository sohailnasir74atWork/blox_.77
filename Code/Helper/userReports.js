// Trade / feed-post / status / scam-database / user reports go to Firestore
// `user_reports/{autoId}`, which the Admin Dashboard reads (staff-only).
// The rules accept exactly these fields, with reporterUid == auth.uid and
// status 'open', from signed-in users who aren't banned
// (MODERATION_CONTRACT §9) — don't add fields here without the rules.
// Never send `audience`: functions/reportAudience.js stamps it from the
// target's server-side rank, which decides which staff tier may read the
// report (about a Senior Mod or an Admin → Admins + owner only).
// targetUid is a hint only; for trades / posts / statuses the server also
// checks the reported doc's owner.
import { collection, addDoc, serverTimestamp } from '@react-native-firebase/firestore';

export const REPORT_REASON_MAX = 200;
export const REPORT_TEXT_MAX = 1000;

/**
 * @param {object} db Firestore instance
 * @param {{type: 'trade'|'post'|'status'|'scam'|'user', targetId: string,
 *          targetUid?: string|null, reporterUid: string, reason: string,
 *          text?: string}} report
 */
export const submitUserReport = (db, { type, targetId, targetUid, reporterUid, reason, text }) => {
  if (!db || !type || !targetId || !reporterUid) {
    return Promise.reject(new Error('submitUserReport: missing required fields'));
  }
  return addDoc(collection(db, 'user_reports'), {
    type,
    targetId: String(targetId),
    targetUid: targetUid ? String(targetUid) : null,
    reporterUid: String(reporterUid),
    reason: String(reason || 'Other').trim().slice(0, REPORT_REASON_MAX),
    text: String(text || '').trim().slice(0, REPORT_TEXT_MAX),
    createdAt: serverTimestamp(),
    status: 'open',
  });
};
