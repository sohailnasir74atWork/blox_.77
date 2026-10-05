// Server-side moderation by UID (functions/banEnforcement.js → modSanction).
//
// The email-keyed ban helpers in ChatScreen/utils.js stop at "email not
// found" for deleted accounts and phone sign-ins. This calls the server,
// which resolves email, devices and linked accounts itself, so a ban always
// lands. It enforces the same hierarchy as utils.js (caller must strictly
// outrank the target, never self).
import { getAuth, getIdToken } from '@react-native-firebase/auth';

const MOD_SANCTION_URL =
  'https://us-central1-fruiteblocks.cloudfunctions.net/modSanction';

// Server error codes → short English messages (staff-only UI).
const ERROR_TEXT = {
  unauthenticated: 'Please sign in again.',
  not_staff: 'Only staff can do this.',
  self_target: 'You cannot do this to yourself.',
  outranked: 'You cannot act on this user.',
  stricter_ban_active: 'A stricter ban is already active on this user.',
  bad_target: 'Invalid user ID.',
  bad_strike: 'Invalid strike level.',
  bad_minutes: 'Invalid mute duration.',
  internal: 'Server error. Try again.',
};

export const sanctionErrorText = (code) => ERROR_TEXT[code] || 'Something went wrong.';

/**
 * @param {'strike'|'mute'|'unban'|'linked'} action
 * @param {string} targetUid
 * @param {{strikeCount?: number, minutes?: number, reason?: string, includeLinked?: boolean}} [opts]
 * @returns {Promise<{ok: boolean, error?: string, [k: string]: any}>} never throws
 */
export async function callModSanction(action, targetUid, opts = {}) {
  const user = getAuth().currentUser;
  if (!user) return { ok: false, error: 'unauthenticated' };
  try {
    const token = await getIdToken(user);
    const res = await fetch(MOD_SANCTION_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, targetUid, ...opts }),
    });
    let body = null;
    try { body = await res.json(); } catch (_) {}
    if (!res.ok) return { ok: false, error: body?.error || 'internal', ...body };
    return { ok: true, ...body };
  } catch (e) {
    console.warn('[modSanction] failed:', e?.message);
    return { ok: false, error: 'internal' };
  }
}

// One-line summary of a successful strike/mute for the confirmation alert.
export const describeSanctionResult = (r) => {
  const parts = [];
  if (r.accountDeleted || r.accountExists === false) parts.push('Account is deleted.');
  if (!r.hasEmail) parts.push('No email on file.');
  parts.push(r.devices > 0 ? `${r.devices} device(s) banned.` : 'No device on record.');
  if (r.linkedBanned > 0) parts.push(`${r.linkedBanned} linked account(s) banned.`);
  return parts.join(' ');
};
