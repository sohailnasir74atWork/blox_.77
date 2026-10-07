/**
 * reportsApi.js — Values ▸ More ▸ Complaints & ideas (ported from Adopt Me,
 * 2026-10-07): a player sends a complaint (with
 * a category) or a suggestion, with text and up to three images; admins read
 * them in the More hub's Admin inbox. Lives in RTDB /player_feedback (rules in
 * scripts/test-rules/build-database-rules.js; named so because Firestore
 * user_reports is already the content-report queue):
 *
 *   * a signed-in player can only CREATE, as themselves, with status 'open'
 *     and a server timestamp — and at most one a minute: the same write must
 *     stamp /player_feedback_last/{uid}, whose rule refuses a stamp under 60 s old;
 *   * a player can read only their own (query by userId, so "Your reports"
 *     shows whether each was looked at);
 *   * staff read everything; mods and up flip status open/done and delete.
 *
 * Images go to the public Bunny zone under report-images/<uuid>.jpg (see
 * Helper/reportImageUpload.js); the rule only accepts URLs there.
 */

import {
  ref, push, update, remove, get, query, orderByChild, equalTo, limitToLast, endAt, serverTimestamp,
} from '@react-native-firebase/database';
import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { uploadReportImages } from '../Helper/reportImageUpload';

export const REPORT_TEXT_MAX = 2000;
export const MAX_REPORT_IMAGES = 3;
export const COMPLAINT_CATEGORIES = ['false_review', 'moderation', 'scam', 'bug', 'other'];

const appLabel = () => {
  try {
    return `${Platform.OS} ${DeviceInfo.getVersion()} (${DeviceInfo.getBuildNumber()})`.slice(0, 60);
  } catch (e) {
    return Platform.OS;
  }
};

const toList = (val) =>
  Object.entries(val || {})
    .map(([id, v]) => ({ id, ...v, images: Array.isArray(v?.images) ? v.images.filter(Boolean) : Object.values(v?.images || {}) }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

/**
 * Upload the images, then write the report and the rate-limit stamp in one
 * update. Throws { code: 'too_soon' } when the rule refuses it inside a minute
 * of the last one (the only refusal a valid form can hit).
 */
export async function sendReport(db, user, { type, category, text, imageUris = [] }, onProgress) {
  const uid = user?.id;
  if (!uid) throw Object.assign(new Error('sign in'), { code: 'sign_in' });
  const images = await uploadReportImages(imageUris.slice(0, MAX_REPORT_IMAGES), onProgress);
  const key = push(ref(db, 'player_feedback')).key;
  const report = {
    userId: uid,
    userName: String(user.displayName || user.userName || 'Player').slice(0, 60),
    type,
    text: text.trim().slice(0, REPORT_TEXT_MAX),
    app: appLabel(),
    createdAt: serverTimestamp(),
    status: 'open',
  };
  if (type === 'complaint' && category) report.category = category;
  if (user.avatar && String(user.avatar).length <= 500) report.avatar = String(user.avatar);
  if (images.length) report.images = images;
  try {
    await update(ref(db), {
      [`player_feedback/${key}`]: report,
      [`player_feedback_last/${uid}`]: serverTimestamp(),
    });
  } catch (e) {
    // The only rule a well-formed report can trip is the one-a-minute stamp.
    const last = await get(ref(db, `player_feedback_last/${uid}`)).then((s) => s.val()).catch(() => null);
    if (last && Date.now() - last < 120000) throw Object.assign(new Error('too soon'), { code: 'too_soon' });
    throw e;
  }
  return key;
}

export async function fetchMyReports(db, uid) {
  const snap = await get(query(ref(db, 'player_feedback'), orderByChild('userId'), equalTo(uid), limitToLast(20)));
  return toList(snap.val());
}

// ── Admin ────────────────────────────────────────────────────────────────

/**
 * Newest `n` reports, or the `n` before `beforeCreatedAt` for "Load older".
 * endAt is inclusive, so the boundary row comes back again; callers merge by
 * id.
 */
export async function fetchReportsPage(db, n = 40, beforeCreatedAt = null) {
  const base = [ref(db, 'player_feedback'), orderByChild('createdAt')];
  const q = beforeCreatedAt == null
    ? query(...base, limitToLast(n))
    : query(...base, endAt(beforeCreatedAt), limitToLast(n + 1));
  return toList((await get(q)).val());
}

export const setReportStatus = (db, id, status) => update(ref(db, `player_feedback/${id}`), { status });
export const deleteReport = (db, id) => remove(ref(db, `player_feedback/${id}`));

// Feedback that older app builds still send from their News screen. Old poll
// votes share the node and are dropped, so a page can come back with fewer
// rows than asked for; `cursor` (the oldest createdAt fetched) and `end` are
// what paging goes by.
export async function fetchLegacyFeedbackPage(db, n = 40, beforeCreatedAt = null) {
  const base = [ref(db, 'news_feedback'), orderByChild('createdAt')];
  const q = beforeCreatedAt == null
    ? query(...base, limitToLast(n))
    : query(...base, endAt(beforeCreatedAt), limitToLast(n + 1));
  const raw = Object.entries((await get(q)).val() || {}).map(([id, v]) => ({ id, ...v }));
  const times = raw.map((v) => v.createdAt).filter((x) => typeof x === 'number');
  return {
    rows: raw.filter((v) => v.type !== 'poll_vote' && v.text).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    cursor: times.length ? Math.min(...times) : null,
    end: raw.length < (beforeCreatedAt == null ? n : n + 1),
  };
}

export const deleteLegacyFeedback = (db, id) => remove(ref(db, `news_feedback/${id}`));
