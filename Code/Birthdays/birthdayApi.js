/**
 * birthdayApi.js — Birthdays server calls (supabase/036_birthdays.sql) + caches.
 * Ported from Adopt Me (adoptme-jan7/Code/Birthdays, 2026-10-07).
 *
 * The server only ever returns month and day, never a year or an age, and
 * only for players who show their birthday (on by default) and are 13 or
 * older. Your own birthday comes back to you whatever the setting.
 *
 * Built to cost almost nothing (owner, 2026-10-07):
 *   - birthday_home is the ONE call behind Home, Settings and the chat 🎂:
 *     your birthday plus [uid, month, day] for today's birthdays — a few KB,
 *     no names or photos. Kept on the phone (MMKV) for the local day and
 *     refreshed at most every HOME_TTL_MS, so a cold start reads nothing.
 *   - list_birthdays (names, photos, wish counts; up to 200 rows) only when
 *     the Birthdays screen opens. Kept on the phone for LIST_TTL_MS and shown
 *     instantly from there while it refreshes.
 *   - Neither cache crosses midnight: each day's birthdays are different.
 *     New players or a changed birthday appear within one refresh window.
 *   - Your own actions (a wish, Show/Hide, a correction, the gift) update
 *     the caches at once, without waiting for a refresh.
 *   - No realtime listeners anywhere.
 *
 * The gift (Blox has no Pet Cards): BIRTHDAY_GIFT_STARS stars, once a year.
 * claim_birthday_gift() records the year on the server and returns
 * { stars }; the app then adds them to users/{uid}/dailyStars in RTDB, the
 * same fields the daily stars use (Code/Engagement/starUtils.js).
 *
 * Development: when the server functions are missing, or nobody is signed
 * in, __DEV__ builds fall back to birthdayMock.js so every screen can be
 * previewed. Release builds never switch to the mock.
 */

import { getAuth, getIdToken } from '@react-native-firebase/auth';
import { ref, get, update, increment } from '@react-native-firebase/database';
import { supabase } from '../Supabase/client';
import config from '../Helper/Environment';
import { getStarBalance } from '../Engagement/starUtils';
import { daysUntilBirthday } from './birthdayDate';

const HOME_TTL_MS = 2 * 60 * 60 * 1000;
const LIST_TTL_MS = 30 * 60 * 1000;
const PUBLIC_TTL_MS = 12 * 60 * 60 * 1000;
const RETRY_AFTER_FAIL_MS = 10 * 60 * 1000;

// Blox has no `cloudFunctionsUrl` in Helper/Environment.js (other callers
// hardcode the fruiteblocks base too, e.g. Helper/modSanction.js).
const FUNCTIONS_URL = config.cloudFunctionsUrl || 'https://us-central1-fruiteblocks.cloudfunctions.net';

/** What claim_birthday_gift() gives (036); the label before claiming. */
export const BIRTHDAY_GIFT_STARS = 15;

export const WISH_TEMPLATES = ['hbd', 'party', 'pets', 'cake'];
// 'pets' is the server's template id (036 check constraint); in Blox it reads
// as the dream-fruit wish, under its own text key.
export const WISH_EMOJI = { hbd: '🎂', party: '🎉', pets: '🍎', cake: '🎁' };
export const WISH_TEXT_KEY = { hbd: 'hbd', party: 'party', pets: 'fruit', cake: 'cake' };

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'birthdays' });
} catch (e) {
  const mem = new Map();
  storage = { getString: (k) => mem.get(k), set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
}

// The full date of birth (year included) is needed only by the one-time edit
// sheet and the under-13 check. Code/AppHelper/useDobGate.js keeps it in its
// own MMKV store as dob:<uid>; read that rather than RTDB.
let dobStore = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  dobStore = createMMKV({ id: 'dob-gate' });
} catch (_) { /* no MMKV: fall back to one RTDB read per session */ }

let currentUid = null;
let homeCache = null;              // { at, uid, day, data }   data = my birthday + today
let listCache = null;              // { at, uid, day, days, data }
const publicCache = new Map();     // uid -> { at, data }
const dobMemory = new Map();       // uid -> 'YYYY-MM-DD' | null (read this session)
let mock = null;

// uids whose (shown) birthday is today on this phone: drives the chat 🎂.
let todaySet = new Set();
const listeners = new Set();
const emit = () => listeners.forEach((l) => { try { l(); } catch (_) {} });
export const onBirthdaysChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const fresh = (c, ttl) => !!c && c.uid === currentUid && c.day === localDay() && Date.now() - c.at < ttl;

const readSaved = (key) => {
  try {
    const raw = storage.getString(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
};
const save = (key, value) => {
  if (mock || !currentUid) return; // never persist the sample data
  try { storage.set(key, JSON.stringify(value)); } catch (_) {}
};
const forget = (key) => { try { storage.remove(key); } catch (_) {} };
const homeKey = () => `home:${currentUid}`;
const listKey = () => `list:${currentUid}`;
const pendingStarsKey = (uid) => `gift_stars:${uid}`;

const isMissingFunction = (error) =>
  !!error && (error.code === 'PGRST202' || /Could not find the function|does not exist/i.test(error.message || ''));

const switchToMock = (why) => {
  if (!mock) {
    mock = require('./birthdayMock').default;
    console.log(`[Birthdays] ${why}: using the local mock`);
  }
  return mock;
};

async function call(fn, args) {
  if (mock) return mock[fn](args);
  // Signed out (or the account not loaded yet): answer from the mock for this
  // call only, so the real server takes over as soon as the user is known.
  if (__DEV__ && !currentUid) return require('./birthdayMock').default[fn](args);
  const { data, error } = await supabase.rpc(fn, args || {});
  if (error) {
    if (__DEV__) console.log(`[Birthdays] ${fn} failed: ${error.code} ${error.message}`);
    if (__DEV__ && isMissingFunction(error) && fn !== 'birthday_home') return switchToMock('not deployed')[fn](args);
    throw error;
  }
  return data;
}

export const isBirthdayMockActive = () => !!mock;
export const getBirthdayMock = () => mock;

/** __DEV__ only: switch this session to the sample data (long-press the 🎂 on the Birthdays screen). */
export const enableBirthdayPreview = () => {
  if (!__DEV__) return;
  switchToMock('preview');
  homeCache = null;
  listCache = null;
  publicCache.clear();
  emit();
};

const applyToday = (today) => {
  todaySet = new Set((today || [])
    .filter((r) => Array.isArray(r) && daysUntilBirthday(r[1], r[2]) === 0)
    .map((r) => r[0]));
};

/** Scope caches to the signed-in player (null after sign-out). */
export const setBirthdayUser = (uid) => {
  if ((uid || null) === currentUid) return;
  currentUid = uid || null;
  homeCache = null;
  listCache = null;
  publicCache.clear();
  todaySet = new Set();
  todayLoad = null;
  todayLoadFailedAt = 0;
  // A cold start reads the saved copy instead of the network.
  if (currentUid) {
    const h = readSaved(homeKey());
    if (h && h.day === localDay()) {
      homeCache = { ...h, uid: currentUid };
      applyToday(h.data?.today);
    }
    const l = readSaved(listKey());
    if (l && l.day === localDay()) listCache = { ...l, uid: currentUid };
  }
  emit();
};

/** Drop every cache (the dev preview switch). */
export const invalidateBirthdays = () => {
  homeCache = null;
  listCache = null;
  publicCache.clear();
  if (currentUid) { forget(homeKey()); forget(listKey()); }
  emit();
};

/** Map a server error to an i18n key under birthdays.err.* */
export const birthdayErrorKey = (e) => {
  const m = String(e?.message || e || '');
  if (/already wished/.test(m)) return 'already_wished';
  if (/not their birthday/.test(m)) return 'not_today';
  if (/cannot wish/.test(m)) return 'cannot_wish';
  if (/gift not available/.test(m)) return 'gift_unavailable';
  if (/sign in required|sign_in/.test(m)) return 'sign_in';
  if (/age_change/.test(m)) return 'age_change';
  if (/already_edited/.test(m)) return 'already_edited';
  if (/bad_date|bad_request|same/.test(m)) return 'bad_date';
  return 'generic';
};

// birthday_home, or — on a server without it — the two older calls.
async function fetchHome() {
  try {
    return await call('birthday_home');
  } catch (e) {
    if (!isMissingFunction(e)) throw e;
    const [me, rows] = await Promise.all([call('get_my_birthday'), call('list_birthdays', { p_days: 0 })]);
    return { ...me, today: (rows || []).map((r) => [r.uid, r.month, r.day]) };
  }
}

/**
 * Your birthday + today's birthdays, one small call:
 * { month, day, show, asked, minor, giftReady, giftOpened, wishCount, wishes, canEdit,
 *   today: [[uid, month, day], ...] }
 */
export async function getBirthdayHome({ force = false } = {}) {
  if (!force && fresh(homeCache, HOME_TTL_MS)) return homeCache.data;
  const data = await fetchHome();
  homeCache = { at: Date.now(), uid: currentUid, day: localDay(), data };
  save(homeKey(), homeCache);
  applyToday(data?.today);
  emit();
  return data;
}

/** Your own birthday (the same small call as Home). */
export const getMyBirthday = (opts) => getBirthdayHome(opts);

export const peekMyBirthday = () => (homeCache && homeCache.uid === currentUid ? homeCache.data : null);

/** How many shown players (not you) have a birthday today on this phone. */
export const todayBirthdayCount = (selfUid) => [...todaySet].filter((u) => u !== selfUid).length;

const patchHome = (patch) => {
  if (!homeCache?.data) return;
  homeCache = { ...homeCache, data: { ...homeCache.data, ...patch } };
  save(homeKey(), homeCache);
};

/** Turn "Show my birthday" on or off. */
export async function setBirthdayVisibility(show) {
  const data = await call('set_birthday_visibility', { p_show: !!show });
  patchHome({ show: !!data?.show, asked: true });
  // Your own row may appear in or leave today's list.
  listCache = null;
  if (currentUid) forget(listKey());
  homeCache = homeCache ? { ...homeCache, at: 0 } : null;
  emit();
  return data;
}

/**
 * Shown players with a birthday within `days` days (today included), soonest
 * first: [{ uid, name, avatar, month, day, daysUntil, wishes, wished }].
 * For the Birthdays screen only.
 */
export async function listBirthdays({ days = 7, force = false } = {}) {
  if (!force && fresh(listCache, LIST_TTL_MS) && listCache.days >= days) {
    return listCache.data.filter((b) => b.daysUntil <= days);
  }
  const rows = await call('list_birthdays', { p_days: days });
  // Days are counted on the phone's calendar, not the server's UTC one.
  const data = (rows || [])
    .map((b) => ({ ...b, daysUntil: daysUntilBirthday(b.month, b.day) }))
    .filter((b) => b.daysUntil != null && b.daysUntil <= days)
    .sort((a, b) => a.daysUntil - b.daysUntil || String(a.name).localeCompare(String(b.name)));
  listCache = { at: Date.now(), uid: currentUid, day: localDay(), days, data };
  save(listKey(), listCache);
  emit();
  return data;
}

/** The saved list for an instant first paint (may be up to LIST_TTL_MS old), or null. */
export const peekBirthdayList = () =>
  (listCache && listCache.uid === currentUid && listCache.day === localDay() ? listCache.data : null);

/** { month, day } for a profile, or null (hidden / under 13 / unknown). */
export async function getPublicBirthday(uid) {
  if (!uid) return null;
  const hit = publicCache.get(uid);
  if (hit && Date.now() - hit.at < PUBLIC_TTL_MS) return hit.data;
  const data = (await call('get_public_birthday', { p_uid: uid })) || null;
  publicCache.set(uid, { at: Date.now(), data });
  return data;
}

/** One templated wish per player per birthday. Returns { wishes }. */
export async function sendBirthdayWish(toUid, template) {
  const data = await call('send_birthday_wish', { p_to: toUid, p_template: template });
  if (listCache) {
    listCache = {
      ...listCache,
      data: listCache.data.map((b) => (b.uid === toUid ? { ...b, wished: true, wishes: data?.wishes ?? b.wishes + 1 } : b)),
    };
    save(listKey(), listCache);
  }
  emit();
  return data;
}

// ─── Full date of birth (edit sheet + under-13 check only) ─────────────────

const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;
const rememberDob = (uid, dob) => {
  dobMemory.set(uid, dob);
  if (dob) { try { dobStore?.set(`dob:${uid}`, dob); } catch (_) {} }
};

/** The signed-in player's 'YYYY-MM-DD' from the phone, or null. No network. */
export const getKnownDob = (uid) => {
  if (!uid) return null;
  if (dobMemory.has(uid)) return dobMemory.get(uid);
  try {
    const v = dobStore?.getString(`dob:${uid}`);
    return typeof v === 'string' && DOB_RE.test(v) ? v : null;
  } catch (_) {
    return null;
  }
};

/**
 * getKnownDob, or — when the phone doesn't have it (the date-of-birth gate
 * hasn't run on this install) — ONE read of users_private/{uid}/dateOfBirth
 * per session. Callers only ask while the one-time edit is still unused.
 */
export async function loadKnownDob(db, uid) {
  const known = getKnownDob(uid);
  if (known || !db || !uid || dobMemory.has(uid)) return known;
  try {
    const v = (await get(ref(db, `users_private/${uid}/dateOfBirth`))).val();
    const dob = typeof v === 'string' && DOB_RE.test(v) ? v : null;
    rememberDob(uid, dob);
    return dob;
  } catch (_) {
    return null;
  }
}

/**
 * Correct your birthday (day, month and year), once. functions/updateBirthday.js
 * does it: the RTDB rules keep the date write-once for the app. It refuses a
 * change into an older age group. Resolves { dateOfBirth }.
 */
export async function updateMyBirthday(year, month, day) {
  let data;
  const usedMock = __DEV__ && (mock || !currentUid);
  if (usedMock) {
    data = await require('./birthdayMock').default.update_my_birthday({ year, month, day });
  } else {
    const user = getAuth().currentUser;
    if (!user) throw new Error('sign in required');
    const token = await getIdToken(user);
    const res = await fetch(`${FUNCTIONS_URL}/updateBirthday`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, month, day }),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `http ${res.status}`);
    // The sample data never touches the signed-in profile.
    if (currentUid && data?.dateOfBirth) rememberDob(currentUid, data.dateOfBirth);
  }
  homeCache = null;
  listCache = null;
  publicCache.clear();
  if (currentUid) { forget(homeKey()); forget(listKey()); }
  emit();
  return data;
}

// ─── The birthday gift: stars ───────────────────────────────────────────────

// Adds stars to the RTDB balance exactly as claimDailyStar does. getStarBalance
// first: it seeds starBalance from totalStarsEarned on old accounts that never
// had one (an increment alone would start them from zero).
const creditStars = async (db, uid, stars) => {
  await getStarBalance(db, uid);
  await update(ref(db, `users/${uid}/dailyStars`), {
    starBalance: increment(stars),
    totalStarsEarned: increment(stars),
  });
};

// The server has granted the stars once claim_birthday_gift() returns, so
// they are written down as owed (MMKV) until RTDB confirms the write. RTDB
// has no offline persistence here: a write still queued when the app closes
// would otherwise be lost. One credit at a time, so a flush can't double it.
let crediting = null;
const readOwed = (uid) => {
  try { return Math.max(0, Number(storage.getString(pendingStarsKey(uid))) || 0); } catch (_) { return 0; }
};
const writeOwed = (uid, n) => {
  if (n > 0) { try { storage.set(pendingStarsKey(uid), String(n)); } catch (_) {} }
  else forget(pendingStarsKey(uid));
};
const creditOwed = (db, uid) => {
  if (crediting) return crediting;
  const owed = readOwed(uid);
  if (!db || owed <= 0) return Promise.resolve(0);
  crediting = creditStars(db, uid, owed)
    .then(() => { writeOwed(uid, readOwed(uid) - owed); return owed; })
    .catch((e) => {
      if (__DEV__) console.log(`[Birthdays] star credit failed, will retry: ${e?.message}`);
      return 0;
    })
    .finally(() => { crediting = null; });
  return crediting;
};

/**
 * Stars granted by the server that never reached RTDB (see creditOwed). An
 * MMKV read; a network write only when something is owed. The Birthdays
 * screen calls it on open.
 */
export const flushBirthdayStars = (db, uid) => (uid ? creditOwed(db, uid) : Promise.resolve(0));

/**
 * Claim this year's birthday gift: claim_birthday_gift() (raises 'birthday
 * gift not available' when not allowed), then the stars into RTDB. Patches
 * the cached home so every card flips at once. Resolves { stars } as soon as
 * the server grants them; the RTDB write finishes in the background (it
 * waits for a connection rather than failing).
 */
export async function claimBirthdayGift(db, uid) {
  const sample = !!mock || (__DEV__ && !currentUid);
  if (!uid && !sample) throw new Error('sign in required');
  const data = await call('claim_birthday_gift');
  const stars = Number(data?.stars) || 0;
  // Sample data (debug preview, or a not-deployed fallback): no real stars.
  if (!sample && !mock && uid && stars > 0) {
    writeOwed(uid, readOwed(uid) + stars);
    if (crediting) crediting.then(() => creditOwed(db, uid));
    else creditOwed(db, uid);
  }
  patchHome({ giftReady: false, giftOpened: true });
  emit();
  return { stars };
}

/** True when this player has a (shown) birthday today. */
export const isBirthdayTodayUid = (uid) => !!uid && todaySet.has(uid);

// For the chat 🎂 badges: the Home call, at most once per app session (it is
// usually cached already). Every chat row asks, so a failure waits 10 min.
let todayLoad = null;
let todayLoadFailedAt = 0;
export const ensureBirthdaysTodayLoaded = () => {
  if (!currentUid && !__DEV__) return Promise.resolve();
  if (!todayLoad && Date.now() - todayLoadFailedAt > RETRY_AFTER_FAIL_MS) {
    todayLoad = getBirthdayHome().catch(() => {
      todayLoad = null;
      todayLoadFailedAt = Date.now();
    });
  }
  return todayLoad || Promise.resolve();
};
