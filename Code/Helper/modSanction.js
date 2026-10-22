// Server-side moderation by UID (functions/banEnforcement.js → modSanction).
//
// Every sanction (strike, mute, ban) and every lift (unban, unmute) goes
// through the server, which resolves email, devices and linked accounts
// itself, so a ban always lands — also for deleted accounts and phone
// sign-ins. It enforces the staff hierarchy (caller must strictly outrank the
// target, never self, staff targets Senior Mod+ only, JMD limits, permanent
// bans admin-only, original-banner rank on lifts); the app only mirrors
// those rules to hide buttons that would fail.
import { getAuth, getIdToken } from '@react-native-firebase/auth';
import RNFS from 'react-native-fs';
import { safeCompressImage } from './safeCompressImage';

const MOD_SANCTION_URL =
  'https://us-central1-fruiteblocks.cloudfunctions.net/modSanction';
// Evidence screenshots go through the server (functions/modEvidenceUpload.js),
// which holds the storage key; the app never sees it.
const MOD_EVIDENCE_URL =
  'https://us-central1-fruiteblocks.cloudfunctions.net/modEvidenceUpload';

export const EVIDENCE_MAX = 3;

// ── Strike ladder ───────────────────────────────────────────────────────
// ONE copy for the app. Must match STRIKE_DURATION_MS / PENDING_PERM_MS in
// functions/banEnforcement.js (the server picks the actual expiry).
const HOUR_MS = 60 * 60 * 1000;
export const STRIKE_LADDER = {
  1: { durationMs: 6 * HOUR_MS, label: '6 hours', short: '6h' },
  2: { durationMs: 24 * HOUR_MS, label: '24 hours', short: '24h' },
  3: { durationMs: null, label: 'permanent', short: 'Perm' }, // null = permanent
};
export const MAX_STRIKE = 3;

// Permanent bans need a Senior Mod+ (Admin-only 2026-10-19..21). A Mod's
// strike 3 is a 3-day ban plus a request a Senior Mod or Admin confirms (→ permanent) or
// rejects in the dashboard.
export const PENDING_PERM_DAYS = 3;
export const PENDING_STRIKE_3 = { label: `${PENDING_PERM_DAYS} days, permanent if a Senior Mod or Admin confirms`, short: `${PENDING_PERM_DAYS}d+` };

/** Next strike level after `current` (0 when there is none), capped at 3. */
export const nextStrikeCount = (current) =>
  Math.min(MAX_STRIKE, Math.max(0, Number(current) || 0) + 1);

/** `bannedUntil` value for a strike level: a ms timestamp or 'permanent'. */
export const strikeBannedUntil = (strikeCount, now = Date.now()) => {
  const step = STRIKE_LADDER[strikeCount] || STRIKE_LADDER[MAX_STRIKE];
  return step.durationMs == null ? 'permanent' : now + step.durationMs;
};

/**
 * Ladder step as the caller will get it: strike 3 from below Senior Mod is the
 * 30-day pending ban. `permanentAllowed` = getModPermissions().canPermaban.
 */
export const strikeStep = (strikeCount, { permanentAllowed = true } = {}) => {
  const n = STRIKE_LADDER[strikeCount] ? strikeCount : MAX_STRIKE;
  return n === MAX_STRIKE && !permanentAllowed ? PENDING_STRIKE_3 : STRIKE_LADDER[n];
};

export const strikeDurationLabel = (strikeCount, opts) => strikeStep(strikeCount, opts).label;

// Junior Mods may only mute, and only for up to one day (server: rank_limit).
export const JMD_MAX_MUTE_MINUTES = 24 * 60;

// Mute chips. JMDs get exactly these five; Mod and up the full list (the
// dashboard adds a custom-minutes box).
export const JMD_MUTE_PRESETS = [5, 30, 120, 360, 1440];
export const MUTE_PRESETS = [5, 10, 20, 30, 60, 120, 360, 1440];
export const mutePresetsFor = (perms) => (perms?.isJmd ? JMD_MUTE_PRESETS : MUTE_PRESETS)
  .filter((m) => !perms?.maxMuteMinutes || m <= perms.maxMuteMinutes);

// One-tap reasons in the reason prompt (staff-only UI, English like the rest
// of the mod tools). "Other" means "type your own".
export const MOD_QUICK_REASONS = [
  'Scamming',
  'Spam',
  'Harassment',
  'Inappropriate content',
  'Links',
  'Ban evasion',
  'Other',
];
export const MOD_REASON_MAX = 500;

export const formatMuteMinutes = (m) => {
  const n = Number(m) || 0;
  if (n >= 1440 && n % 1440 === 0) return n === 1440 ? '1 day' : `${n / 1440} days`;
  if (n >= 60 && n % 60 === 0) return `${n / 60}h`;
  return `${n}m`;
};

// Server error codes → short English messages (staff-only UI).
const ERROR_TEXT = {
  unauthenticated: 'Please sign in again.',
  not_staff: 'Only staff can do this.',
  self_target: 'You cannot do this to yourself.',
  outranked: 'You cannot act on this user.',
  staff_immune: 'Staff members can only be sanctioned by a Senior Mod or higher.',
  rank_limit: 'Your rank does not allow this action (Junior Mods can only mute for up to 1 day).',
  admin_only: 'Only an Admin can do this.',
  not_pending: 'This ban is no longer waiting for a decision (lifted, expired or already decided).',
  actor_banned: 'You are banned, so your staff tools are paused until the ban ends.',
  banner_outranks: 'This was placed by a higher-ranked staff member. Ask them or an admin to lift it.',
  stricter_ban_active: 'A stricter ban is already active on this user.',
  bad_action: 'This action is not supported by the server yet.',
  bad_target: 'Invalid user ID.',
  bad_strike: 'Invalid strike level.',
  bad_minutes: 'Invalid mute duration.',
  bad_reason: 'Please give a reason (up to 500 characters).',
  bad_evidence: 'Screenshots could not be attached (up to 3 image links).',
  bad_log: 'Could not write the audit log entry.',
  not_muted: 'This user is not muted.',
  not_banned: 'This user is not banned.',
  internal: 'Server error. Try again.',
};

export const sanctionErrorText = (code) => ERROR_TEXT[code] || 'Something went wrong.';

/**
 * Call the modSanction function. Never throws.
 *
 * Actions:
 *   'strike'  { strikeCount: 1|2|3, reason, evidence?, includeLinked?, linkedUids? }
 *   'mute'    { minutes, reason, evidence? }
 *   'unban'   { reason? }   lifts a ban or a mute (server removes the email
 *                           record, the uid ban, device bans and Supabase)
 *   'unmute'  { reason? }   lifts a mute only
 *   'linked'  {}            other accounts on the same device(s):
 *                           linked: [{ uid, displayName, isStaff, banned, … }]
 *   'log'     { logAction, details }  audit row (use logModAction below)
 *   'perm_requests' / 'perm_confirm' / 'perm_reject'  admin only (below)
 *
 * A strike 3 from below Senior Mod answers { pendingPermanent: true, bannedUntil: ms }.
 *
 * `reason` ≤ 500 chars (required by the server for strike/mute),
 * `evidence` ≤ 3 https image URLs (see AppHelper/modEvidenceUpload.js),
 * `linkedUids` limits includeLinked to the accounts the mod ticked.
 *
 * @param {'strike'|'mute'|'unban'|'unmute'|'linked'|'log'} action
 * @param {string|null} targetUid
 * @param {{strikeCount?: number, minutes?: number, reason?: string, evidence?: string[],
 *   includeLinked?: boolean, linkedUids?: string[], logAction?: string, details?: object}} [opts]
 * @returns {Promise<{ok: boolean, error?: string, [k: string]: any}>} never throws
 */
export async function callModSanction(action, targetUid, opts = {}) {
  const user = getAuth().currentUser;
  if (!user) return { ok: false, error: 'unauthenticated' };
  const body = { action, targetUid, ...opts };
  if (typeof body.reason === 'string') {
    body.reason = body.reason.trim().slice(0, MOD_REASON_MAX);
    if (!body.reason) delete body.reason;
  }
  if (Array.isArray(body.evidence)) {
    body.evidence = body.evidence.filter((u) => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 3);
    if (body.evidence.length === 0) delete body.evidence;
  }
  try {
    const token = await getIdToken(user);
    const res = await fetch(MOD_SANCTION_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    let resBody = null;
    try { resBody = await res.json(); } catch (_) {}
    if (!res.ok) return { ok: false, error: resBody?.error || 'internal', ...resBody };
    return { ok: true, ...resBody };
  } catch (e) {
    console.warn('[modSanction] failed:', e?.message);
    return { ok: false, error: 'internal' };
  }
}

// One-line summary of a successful strike/mute for the confirmation alert.
export const describeSanctionResult = (r) => {
  const parts = [];
  if (r.accountDeleted || r.accountExists === false) parts.push('Account is deleted.');
  if (r.hasEmail === false) parts.push('No email on file.');
  if (typeof r.devices === 'number') {
    parts.push(r.devices > 0 ? `${r.devices} device(s) on record.` : 'No device on record.');
  }
  if (r.linkedBanned > 0) parts.push(`${r.linkedBanned} linked account(s) banned.`);
  if (r.pendingPermanent) parts.push(`Banned for ${PENDING_PERM_DAYS} days. A Senior Mod or Admin will review the permanent ban.`);
  return parts.join(' ');
};

/**
 * Admin/owner: open permanent-ban requests (non-admin 3rd strikes).
 * `uid` is null for an email-only strike (no account yet): then `emailKey` / `email`.
 * @returns {Promise<{ok: boolean, error?: string, requests?: Array<{key: string, uid: string|null,
 *   emailKey: string|null, email: string|null,
 *   targetName: string|null, requestedByUid: string|null, requestedByName: string|null,
 *   requestedByRole: string|null, requestedAt: number|null, reason: string|null,
 *   evidence: string[], strikeCount: number, bannedUntil: number, includeLinked: boolean}>}>}
 */
export const fetchPermRequests = () => callModSanction('perm_requests', null);

/** Senior Mod / Admin / owner: answer one request from fetchPermRequests — 'confirm' (→ permanent) or 'reject' (stays as is). */
export const decidePermRequest = (request, decision, reason) =>
  callModSanction(
    decision === 'confirm' ? 'perm_confirm' : 'perm_reject',
    request?.uid || null,
    request?.uid ? { reason } : { reason, emailKey: request?.emailKey },
  );

/**
 * Audit-log a staff action that isn't a sanction (message delete, pin, role
 * change…). The server checks the caller is staff and writes mod_actions.
 * Fire-and-forget: never throws, never blocks the action itself.
 * @param {'message_delete'|'delete_all'|'pin'|'unpin'|'role_change'|'review_delete'|'profile_delete'|'post_delete'} logAction
 * @param {string|null} targetUid
 * @param {object} [details] small JSON (ids, role names, room) — no message bodies
 */
export function logModAction(logAction, targetUid, details = {}) {
  return callModSanction('log', targetUid || null, { logAction, details })
    .catch(() => ({ ok: false, error: 'internal' }));
}

const EVIDENCE_ERROR_TEXT = {
  unauthenticated: 'Please sign in again.',
  not_staff: 'Only staff can upload evidence.',
  bad_image: 'That file is not a supported image.',
  too_large: 'That image is too large.',
  rate_limited: 'Too many uploads. Try again later.',
};
export const evidenceErrorText = (code) => EVIDENCE_ERROR_TEXT[code] || 'Could not upload the screenshot. Try again.';

/**
 * Upload one evidence screenshot (local file URI from the image picker).
 * Compressed to JPEG first so it stays well under the server's 1.5 MB cap.
 * @returns {Promise<{ok: true, url: string} | {ok: false, error: string}>} never throws
 */
export async function uploadEvidence(localUri) {
  const user = getAuth().currentUser;
  if (!user) return { ok: false, error: 'unauthenticated' };
  try {
    const { uri } = await safeCompressImage(localUri, {
      compressionMethod: 'manual', maxWidth: 1280, quality: 0.7, output: 'jpg',
    });
    const data = await RNFS.readFile(uri.replace('file://', ''), 'base64');
    const token = await getIdToken(user);
    const res = await fetch(MOD_EVIDENCE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // If compression fell back to the original, say what it really is.
      body: JSON.stringify({
        data,
        contentType: /\.png$/i.test(uri) ? 'image/png' : /\.webp$/i.test(uri) ? 'image/webp' : 'image/jpeg',
      }),
    });
    let body = null;
    try { body = await res.json(); } catch (_) {}
    if (!res.ok || !body?.url) return { ok: false, error: body?.error || 'internal' };
    return { ok: true, url: body.url };
  } catch (e) {
    console.warn('[modSanction] evidence upload failed:', e?.message);
    return { ok: false, error: 'internal' };
  }
}
