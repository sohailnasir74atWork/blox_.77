/**
 * proGrant.js — Pro an admin gives by hand (Admin Dashboard → user → Pro access).
 *
 * Server: RTDB pro_grants/{uid} = { until, by, at }. Only admins write it
 * (database.rules.json); a player reads only their own. `until` is ms since
 * epoch; LIFETIME_UNTIL means "no end". Removing the node takes Pro away.
 *
 * This file follows the signed-in Firebase user, keeps their grant in MMKV
 * (so Pro holds on a cold start before RTDB answers) and tells
 * LocalGlobelStats when it changes; LocalGlobelStats merges it into isPro.
 * A grant never touches RevenueCat or the store subscription.
 */

import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { getDatabase, ref, onValue, set, remove } from '@react-native-firebase/database';

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'pro_grant' });
} catch (e) {
  const mem = new Map();
  storage = {
    getString: (k) => mem.get(k),
    getNumber: (k) => mem.get(k),
    set: (k, v) => mem.set(k, v),
    remove: (k) => mem.delete(k),
  };
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const LIFETIME_UNTIL = Date.UTC(2100, 0, 1);
// setTimeout overflows past ~24.8 days; a longer grant re-checks on the next launch.
const MAX_TIMER_MS = 2 ** 31 - 1;

// Remembered across launches so Pro holds before Firebase Auth restores the user.
let currentUid = storage.getString('lastUid') || null;
let stopValue = null;
let expiryTimer = null;
let started = false;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });

export const onProGrantChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getProGrantUntil = (uid = currentUid) => (uid ? storage.getNumber(`until_${uid}`) || 0 : 0);

export const isProGrantActive = (uid = currentUid) => getProGrantUntil(uid) > Date.now();

const armExpiry = () => {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  const left = getProGrantUntil() - Date.now();
  if (left > 0 && left < MAX_TIMER_MS) expiryTimer = setTimeout(emit, left + 1000);
};

const follow = (uid) => {
  const next = uid || null;
  if (next) storage.set('lastUid', next);
  else storage.remove('lastUid');
  if (stopValue && next === currentUid) return;
  if (stopValue) { stopValue(); stopValue = null; }
  currentUid = next;
  if (next) {
    stopValue = onValue(
      ref(getDatabase(), `pro_grants/${next}`),
      (snap) => {
        const until = Number(snap.val()?.until) || 0;
        if (until === getProGrantUntil(next)) return;
        storage.set(`until_${next}`, until);
        if (next === currentUid) { armExpiry(); emit(); }
      },
      () => { /* rules not deployed yet / offline: keep the last known grant */ },
    );
  }
  armExpiry();
  emit();
};

/** Called once by LocalGlobelStats. Safe to call again. */
export const startProGrants = () => {
  if (started) return;
  started = true;
  try {
    const auth = getAuth();
    if (auth.currentUser?.uid) follow(auth.currentUser.uid);
    onAuthStateChanged(auth, (u) => follow(u?.uid || null));
  } catch (e) {
    started = false;
  }
};

// ── Admin side (AdminDashboard → ProGrantPanel) ────────────────────────────

/** Pro for `days` more days from the later of now and the grant running now; days = 0 is lifetime. */
export const grantPro = (uid, days, currentUntil, byUid) => {
  const until = days > 0
    ? Math.max(Date.now(), Number(currentUntil) || 0) + days * DAY_MS
    : LIFETIME_UNTIL;
  return set(ref(getDatabase(), `pro_grants/${uid}`), { until, by: byUid || null, at: Date.now() });
};

export const revokePro = (uid) => remove(ref(getDatabase(), `pro_grants/${uid}`));
