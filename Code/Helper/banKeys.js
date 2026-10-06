// One encoding for ban records keyed by email, shared by every reader and
// writer (banned_users_by_email/{key}). Matches functions/banEnforcement.js
// encodeEmailKey: trimmed, lowercased, every '.' as '(dot)'.
export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export const encodeEmailKey = (email) => normalizeEmail(email).replace(/\./g, '(dot)');

// A ban record is a mute when it says so. Records written before `type`
// existed (old app builds) are mutes when any of these hold: the reason has
// the mute prefix, `bannedBy` is a plain uid string or `bannerAvatar` is set
// (both only written by the old mute path), or there's no strike count
// (every old strike/ban writer set one). Mirrors recordType() in
// functions/banEnforcement.js — keep the two identical.
// Server-written banned_uids records from before `type` carry `source`;
// these sources are always bans.
const AUTO_BAN_SOURCES = new Set(['device', 'email_hash', 'phone_hash', 'linked', 'server']);

export const isMuteRecord = (rec) => {
  if (!rec || typeof rec !== 'object') return false;
  if (rec.type === 'mute' || rec.type === 'ban') return rec.type === 'mute';
  if (/^Muted for/i.test(rec.reason || '')) return true;
  if ('source' in rec && !('bannedBy' in rec)) {
    if (AUTO_BAN_SOURCES.has(rec.source)) return false;
    return !(Number(rec.strikeCount) >= 1);
  }
  if (typeof rec.bannedBy === 'string' || 'bannerAvatar' in rec) return true;
  return !(Number(rec.strikeCount) >= 1);
};
