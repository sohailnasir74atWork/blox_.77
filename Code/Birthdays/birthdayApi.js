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
 *   - list_birthdays_page (037; names, photos, wish counts) only when the
 *     Birthdays screen opens: today and tomorrow only, PAGE_SIZE players at a
 *     time, more on "Load more" (owner, 2026-10-08). The pages loaded so far
 *     are kept on the phone for LIST_TTL_MS and shown instantly from there.
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
const PAGE_SIZE = 20;
const LIST_DAYS = 1;               // today and tomorrow

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
let listCache = null;              // { at, uid, day, rows, next, counts }  pages loaded so far
let listGen = 0;                   // bumped when the list restarts, so a late page is dropped
let moreLoad = null;               // the "Load more" in flight
let pagedMissing = false;          // server without 037: the old list, paged on the phone
let legacyRows = null;
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
const pad2 = (n) => String(n).padStart(2, '0');
const localISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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
const listKey = () => `page:${currentUid}`;
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

// These fall back to older server calls themselves, so a missing one never
// switches the session to the mock.
const OWN_FALLBACK = new Set(['birthday_home', 'list_birthdays_page']);

async function call(fn, args) {
  if (mock) return mock[fn](args);
  // Signed out (or the account not loaded yet): answer from the mock for this
  // call only, so the real server takes over as soon as the user is known.
  if (__DEV__ && !currentUid) return require('./birthdayMock').default[fn](args);
  const { data, error } = await supabase.rpc(fn, args || {});
  if (error) {
    if (__DEV__) console.log(`[Birthdays] ${fn} failed: ${error.code} ${error.message}`);
    if (__DEV__ && isMissingFunction(error) && !OWN_FALLBACK.has(fn)) return switchToMock('not deployed')[fn](args);
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
  resetList();
  publicCache.clear();
  emit();
};

const resetList = () => {
  listCache = null;
  legacyRows = null;
  moreLoad = null;
  listGen++;
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
  resetList();
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
    if (l && l.day === localDay() && Array.isArray(l.rows)) listCache = { ...l, uid: currentUid };
    forget(`list:${currentUid}`); // the old 7-day list (up to 200 rows)
  }
  emit();
};

/** Drop every cache (the dev preview switch). */
export const invalidateBirthdays = () => {
  homeCache = null;
  resetList();
  publicCache.clear();
  if (currentUid) { forget(homeKey()); forget(listKey()); }
  emit();
};

/** Map a server error to an i18n key under birthdays.err.* */
export const birthdayErrorKey = (e) => {
  const m = String(e?.message || e || '');
  if (/already wished/.test(m)) return 'already_wished';
  if (/wish limit/.test(m)) return 'limit';
  if (/not their birthday/.test(m)) return 'not_today';
  if (/cannot wish/.test(m)) return 'cannot_wish';
  if (/gift not available/.test(m)) return 'gift_unavailable';
  if (/sign in required/.test(m) || m === 'sign_in') return 'sign_in';
  // updateBirthday answers with a bare code. Compare whole codes: matching a
  // word anywhere turned unrelated errors (anything containing "same") into
  // "That date isn't valid".
  if (m === 'age_change') return 'age_change';
  if (m === 'already_edited') return 'already_edited';
  if (m === 'bad_date' || m === 'bad_request') return 'bad_date';
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
  // Your own row joins or leaves the list when your birthday is today or tomorrow.
  const me = homeCache?.data;
  if (me?.month && daysUntilBirthday(me.month, me.day) <= LIST_DAYS) {
    resetList();
    if (currentUid) forget(listKey());
  }
  homeCache = homeCache ? { ...homeCache, at: 0 } : null;
  emit();
  return data;
}

// 037 counts days from the phone's date, or from the UTC date when no real
// time zone is on the phone's date (clock set wrong). Its `until` is used as
// is, so a row shown under "today" is always one send_birthday_wish accepts
// (UTC yesterday..tomorrow); recounting on the phone's clock turned a wrong
// clock into "not their birthday" errors. The old list (036) sends no `until`
// and counts from UTC with a day of slack each side: counted here instead.
const inWindow = (rows) => (rows || [])
  .map((b) => ({ ...b, daysUntil: Number.isInteger(b.until) ? b.until : daysUntilBirthday(b.month, b.day) }))
  .filter((b) => b.daysUntil != null && b.daysUntil <= LIST_DAYS);

async function fetchPage(cursor) {
  if (!pagedMissing) {
    try {
      const res = await call('list_birthdays_page', {
        p_local_date: localISO(), p_days: LIST_DAYS, p_limit: PAGE_SIZE, p_cursor: cursor,
      });
      return { rows: inWindow(res?.rows), next: res?.next || null, counts: res?.counts || null };
    } catch (e) {
      if (!isMissingFunction(e)) throw e;
      pagedMissing = true;
    }
  }
  // Server without 037: the old list once, handed out PAGE_SIZE at a time.
  if (cursor == null || !legacyRows) {
    legacyRows = inWindow(await call('list_birthdays', { p_days: LIST_DAYS }))
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }
  const start = typeof cursor === 'number' ? cursor : 0;
  const end = start + PAGE_SIZE;
  return {
    rows: legacyRows.slice(start, end),
    next: end < legacyRows.length ? end : null,
    counts: start ? null : [0, 1].map((d) => legacyRows.filter((b) => b.daysUntil === d).length),
  };
}

/**
 * The Birthdays screen: shown players with a birthday today or tomorrow,
 * today first, then the most recently active. Resolves the pages loaded so
 * far: { rows: [{ uid, name, avatar, month, day, daysUntil, wishes, wished }],
 *        next (null = no more), counts: [today, tomorrow] }.
 * Starts over from the first page when the saved copy is stale or `force`.
 */
export async function listBirthdays({ force = false } = {}) {
  if (!force && fresh(listCache, LIST_TTL_MS)) return listCache;
  const gen = ++listGen;
  moreLoad = null;
  const page = await fetchPage(null);
  if (gen !== listGen) return listCache; // started over again meanwhile
  listCache = { at: Date.now(), uid: currentUid, day: localDay(), ...page };
  save(listKey(), listCache);
  return listCache;
}

/** "Load more": the next PAGE_SIZE players. Resolves the whole list so far. */
export function loadMoreBirthdays() {
  if (!listCache?.next) return Promise.resolve(listCache);
  if (moreLoad) return moreLoad;
  const gen = listGen;
  const load = fetchPage(listCache.next)
    .then((page) => {
      if (gen !== listGen || !listCache) return listCache;
      const have = new Set(listCache.rows.map((b) => b.uid));
      listCache = { ...listCache, rows: [...listCache.rows, ...page.rows.filter((b) => !have.has(b.uid))], next: page.next };
      save(listKey(), listCache);
      return listCache;
    })
    .finally(() => { if (moreLoad === load) moreLoad = null; });
  moreLoad = load;
  return load;
}

/** The saved pages for an instant first paint (may be up to LIST_TTL_MS old), or null. */
export const peekBirthdayList = () =>
  (listCache && listCache.uid === currentUid && listCache.day === localDay() ? listCache : null);

/** { month, day } for a profile, or null (hidden / under 13 / unknown). */
export async function getPublicBirthday(uid) {
  if (!uid) return null;
  const hit = publicCache.get(uid);
  if (hit && Date.now() - hit.at < PUBLIC_TTL_MS) return hit.data;
  const data = (await call('get_public_birthday', { p_uid: uid })) || null;
  publicCache.set(uid, { at: Date.now(), data });
  return data;
}

/** Record a wish on the saved list (also for "already wished" answers). */
export const markWished = (toUid, wishes) => {
  const patch = (b) => (b.uid === toUid ? { ...b, wished: true, wishes: wishes ?? (b.wished ? b.wishes : (b.wishes || 0) + 1) } : b);
  if (legacyRows) legacyRows = legacyRows.map(patch);
  if (listCache) {
    listCache = { ...listCache, rows: listCache.rows.map(patch) };
    save(listKey(), listCache);
  }
};

/** One templated wish per player per birthday. Returns { wishes }. */
export async function sendBirthdayWish(toUid, template) {
  const data = await call('send_birthday_wish', { p_to: toUid, p_template: template });
  markWished(toUid, data?.wishes);
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
    // 'same': the server already holds this date (this phone's copy was
    // stale; the sheet never sends an unchanged date). That is the result
    // the player asked for, so it counts as saved.
    if (!res.ok && data?.error === 'same') {
      data = { dateOfBirth: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
    } else if (!res.ok) {
      throw new Error(data?.error || `http ${res.status}`);
    }
    // The sample data never touches the signed-in profile.
    if (currentUid && data?.dateOfBirth) rememberDob(currentUid, data.dateOfBirth);
  }
  homeCache = null;
  resetList();
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
