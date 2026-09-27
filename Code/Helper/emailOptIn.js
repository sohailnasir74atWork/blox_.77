// Email "news and updates" opt-in.
//
// Consent lives in RTDB at email_prefs/{uid}:
//   { optIn: boolean, updatedAt: <server ms>, source: 'signin' | 'prompt' | 'settings', dob?: 'YYYY-MM-DD' }
// Owner-only read/write (database.rules.json). It is deliberately NOT under
// users/{uid}: that node is publicly readable and other signed-in users can
// write its non-role fields, so consent kept there could be read by anyone or
// switched on for someone else.
//
// Nothing here sends email. Whatever exports the mailing list must re-check
// optIn === true AND a 13+ date of birth at send time; the age checks in the
// app are UX, not the gate.
//
// Flow (EmailOptInGate, mounted once in App.js):
//   - The sign-in drawer records its checkbox with setPendingSigninChoice()
//     before auth completes; the gate applies it once the user has loaded.
//   - Signed-in users with no decision yet get a one-time prompt.
//   - Settings calls requestEmailOptIn('settings') to turn it on, which goes
//     through the same age check.
import { ref, get, update, serverTimestamp } from '@react-native-firebase/database';
import { getAuth } from '@react-native-firebase/auth';

export const EMAIL_MIN_AGE = 13;

const DOB_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

// 'YYYY-MM-DD' → whole years old today, or null when unparseable. Calendar
// based so a birthday flips exactly on the day (same as adoptme's ageGate.js).
const ageFromDob = (dob) => {
  if (!dob || typeof dob !== 'string') return null;
  const m = DOB_RE.exec(dob.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const now = new Date();
  let age = now.getFullYear() - year;
  const monthDiff = (now.getMonth() + 1) - month;
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < day)) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
};

// Local "already decided" flag so a decided user costs zero RTDB reads per launch.
let storage = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'email-optin' });
} catch (_) {}

const decidedKey = (uid) => `decided:${uid}`;
export const isDecidedLocally = (uid) => {
  try { return !!storage?.getBoolean(decidedKey(uid)); } catch (_) { return false; }
};
const markDecidedLocally = (uid) => {
  try { storage?.set(decidedKey(uid), true); } catch (_) {}
};

// The address we'd write to. Auth is the source (Google, Apple relay, or a
// verified email/password account); anonymous users have none.
export const currentAuthEmail = () => {
  try { return getAuth().currentUser?.email || null; } catch (_) { return null; }
};

export const isOldEnoughForEmail = (dob) => {
  const age = ageFromDob(dob);
  return age != null && age >= EMAIL_MIN_AGE;
};

// ── prefs read/write ─────────────────────────────────────────────────────
const prefsCache = new Map(); // uid → prefs object | null
const listeners = new Set();

export const onEmailPrefsChange = (cb) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const getCachedEmailPrefs = (uid) => (prefsCache.has(uid) ? prefsCache.get(uid) : undefined);

export const readEmailPrefs = async (db, uid) => {
  const snap = await get(ref(db, `email_prefs/${uid}`));
  const val = snap.exists() ? snap.val() : null;
  prefsCache.set(uid, val);
  if (val) markDecidedLocally(uid);
  return val;
};

export const saveEmailPrefs = async (db, uid, { optIn, source, dob }) => {
  const patch = { optIn: !!optIn, source, updatedAt: serverTimestamp() };
  if (dob) patch.dob = dob;
  await update(ref(db, `email_prefs/${uid}`), patch);
  const next = { ...(prefsCache.get(uid) || {}), optIn: !!optIn, source, updatedAt: Date.now(), ...(dob ? { dob } : {}) };
  prefsCache.set(uid, next);
  markDecidedLocally(uid);
  listeners.forEach((cb) => { try { cb(uid, next); } catch (_) {} });
  return next;
};

// ── sign-in checkbox hand-off ────────────────────────────────────────────
// Set just before signInWithCredential so the gate can't miss it when the
// auth listener fires first. true = ticked, false = left unticked.
let pendingSigninChoice = null;
export const setPendingSigninChoice = (checked) => { pendingSigninChoice = !!checked; };
export const clearPendingSigninChoice = () => { pendingSigninChoice = null; };
export const takePendingSigninChoice = () => {
  const v = pendingSigninChoice;
  pendingSigninChoice = null;
  return v;
};

// ── Settings → gate bridge ───────────────────────────────────────────────
// The gate owns the age check UI, so Settings asks it to run the opt-in flow.
// Resolves to the final optIn value.
let optInHandler = null;
export const registerEmailOptInHandler = (fn) => {
  optInHandler = fn;
  return () => { if (optInHandler === fn) optInHandler = null; };
};
export const requestEmailOptIn = (source) =>
  (optInHandler ? optInHandler(source) : Promise.resolve(false));
