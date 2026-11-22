// Remote control for the tab-switch (natural-break) interstitial
// (revenue LOG 2026-11-18 "Gentler tab-switch interstitial"): RTDB
// /natural_break_per_session = how many natural-break interstitials one app
// session may show. 0 turns the placement off; anything above
// NATURAL_BREAK.MAX_PER_SESSION_LIMIT is clamped. Missing, denied (read rule
// not deployed), not a number, or a failed read → NATURAL_BREAK.MAX_PER_SESSION
// (the shipped default). Change it in the Firebase console; no release needed.
//
// Same pattern as collapsibleSwitch.js: one leaf listener per session, last
// value cached in MMKV so the first tab press of the next launch already uses
// it before this session's read returns.
import { getApp, getApps } from '@react-native-firebase/app';
import { getDatabase, ref, onValue } from '@react-native-firebase/database';
import { NATURAL_BREAK } from './adPolicy';

const K_PER_SESSION = 'naturalBreakPerSession';

let storage = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV();
} catch (_) {}

const clamp = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(NATURAL_BREAK.MAX_PER_SESSION_LIMIT, Math.floor(v)));
};

let perSession = NATURAL_BREAK.MAX_PER_SESSION;
try {
  const cached = clamp(storage?.getNumber(K_PER_SESSION));
  if (cached !== null) perSession = cached;
} catch (_) {}

let subscribed = false;

const setPerSession = (raw) => {
  const v = clamp(raw);
  perSession = v === null ? NATURAL_BREAK.MAX_PER_SESSION : v;
  try {
    if (v === null) storage?.remove(K_PER_SESSION);
    else storage?.set(K_PER_SESSION, v);
  } catch (_) {}
};

// One tiny leaf listener for the whole session.
const subscribe = () => {
  if (subscribed) return;
  try {
    if (!getApps().length) return;
    onValue(
      ref(getDatabase(getApp()), 'natural_break_per_session'),
      (snap) => setPerSession(snap.val()),
      () => setPerSession(null),
    );
    subscribed = true;
  } catch (_) {}
};

subscribe();

export const naturalBreakPerSession = () => {
  subscribe();
  return perSession;
};
