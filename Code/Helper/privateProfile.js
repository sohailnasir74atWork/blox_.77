// Private profile fields (round 2, 2026-09): account email, and dateOfBirth on
// Adopt Me only (this app keeps its DOB in email_prefs/{uid}.dob).
//
// These used to sit on users/{uid}, which anyone can read (and any signed-in
// user can list), so every account's email was public. They now live in RTDB
// users_private/{uid} (see database.rules.json):
//   - the owner reads and writes their own record; `email` must equal their
//     lowercased auth email,
//   - staff (admin, senior mod, mod, JMD, jmd_granters, founders) read every
//     record, which is what moderation needs,
//   - nobody else can read it.
// Bans stay keyed by email (banned_users_by_email/{encoded}); only the place
// staff look the email up changed. Supabase mirrors this node into
// user_identity_base and masks it for non-staff (supabase/029).
//
// Legacy: until scripts/migrate-user-pii.js has run, most emails are still on
// users/{uid}/email (raw from the app, '.'→',' from the website), so
// getUserEmail falls back to that leaf. Old builds keep writing it after the
// migration; the privatizeUserPII function moves it here and removes it.
import { ref, get, update, query, orderByChild, startAt, endAt, limitToFirst } from '@react-native-firebase/database';

// Local "already saved" flag so a signed-in user costs one write per install,
// not one per launch (same approach as emailOptIn.js).
let storage = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'private-profile' });
} catch (_) {}

const savedKey = (uid) => `email:${uid}`;

// 'a(dot)b@x,com' / 'A.B@X.COM' → 'a.b@x.com'. RTDB keys can't hold '.', so the
// ban list encodes it as '(dot)' and the website stored ','; users_private
// always holds the plain lowercased address.
export const normalizeEmail = (value) => {
  if (!value || typeof value !== 'string') return null;
  const email = value.replace(/\(dot\)/g, '.').replace(/,/g, '.').trim().toLowerCase();
  return email || null;
};

// Another user's email — staff moderation only. Reads users_private/{uid}/email
// (rules deny everyone but the owner and staff), then the legacy
// users/{uid}/email leaf. Pass { legacy: false } when the caller already has
// the users/{uid} record in hand. Resolves null when nothing is readable.
export const getUserEmail = async (db, uid, { legacy = true } = {}) => {
  if (!db || !uid) return null;
  try {
    const snap = await get(ref(db, `users_private/${uid}/email`));
    const email = snap.exists() ? normalizeEmail(snap.val()) : null;
    if (email) return email;
  } catch (_) {
    // Permission denied (not staff) or offline — try the legacy leaf.
  }
  if (!legacy) return null;
  try {
    const snap = await get(ref(db, `users/${uid}/email`));
    return snap.exists() ? normalizeEmail(snap.val()) : null;
  } catch (_) {
    return null;
  }
};

// Staff email search: prefix match on users_private/*/email (indexed, so only
// the matches are downloaded — the old orderByChild('email') on /users had no
// index and pulled the whole node). Returns [{ uid, email }]; [] for
// non-staff callers (permission denied) or no match.
export const findUsersByEmail = async (db, text, max = 10) => {
  const email = normalizeEmail(text);
  if (!db || !email) return [];
  try {
    const snap = await get(query(
      ref(db, 'users_private'),
      orderByChild('email'),
      startAt(email),
      endAt(email + ''),
      limitToFirst(max),
    ));
    const out = [];
    if (snap.exists()) {
      snap.forEach((child) => {
        const value = normalizeEmail(child.val()?.email);
        if (value) out.push({ uid: child.key, email: value });
      });
    }
    return out;
  } catch (_) {
    return [];
  }
};

// Owner write: users_private/{uid} ← { email, dateOfBirth }. Rules accept only
// the caller's own lowercased auth email, so pass the Firebase Auth email.
export const saveOwnPrivateProfile = async (db, uid, { email, dateOfBirth } = {}) => {
  const patch = {};
  if (typeof email === 'string' && email.trim()) patch.email = email.trim().toLowerCase();
  if (typeof dateOfBirth === 'string' && dateOfBirth) patch.dateOfBirth = dateOfBirth;
  if (!db || !uid || Object.keys(patch).length === 0) return false;
  await update(ref(db, `users_private/${uid}`), patch);
  return true;
};

// Sign-in hook: store the signed-in user's auth email once per install (or
// again when it changed). `force` re-sends it, e.g. for a brand-new users/{uid}
// record. Never throws — sign-in must not wait on or fail because of this.
export const saveOwnEmailOnce = async (db, uid, authEmail, { force = false } = {}) => {
  const email = typeof authEmail === 'string' ? authEmail.trim().toLowerCase() : '';
  if (!db || !uid || !email) return false;
  try {
    if (!force && storage?.getString(savedKey(uid)) === email) return true;
  } catch (_) {}
  try {
    await saveOwnPrivateProfile(db, uid, { email });
    try { storage?.set(savedKey(uid), email); } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
};
