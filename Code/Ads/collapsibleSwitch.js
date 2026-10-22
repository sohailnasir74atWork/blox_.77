// Remote on/off switch for Android collapsible banners (bugs LOG 2026-10-22:
// on some phones the expanded ad would not collapse and could not be closed).
// RTDB /collapsible_banners_enabled; only an explicit `true` turns collapsible
// on. Missing, denied (no read rule deployed yet) or a failed read → plain
// banners. Flip it in the Firebase console; no release needed.
//
// The last value is kept in MMKV, so a banner that mounts before this
// session's RTDB read returns already uses it. bannerAds.js reads the switch
// once when a banner mounts: a change never re-requests a banner that is
// already on screen (no loaded impression is thrown away) and applies to the
// next banner that mounts.
import { getApp, getApps } from '@react-native-firebase/app';
import { getDatabase, ref, onValue } from '@react-native-firebase/database';

const K_ENABLED = 'collapsibleBannersEnabled';

let storage = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV();
} catch (_) {}

let enabled = false;
try {
  enabled = storage?.getBoolean(K_ENABLED) === true;
} catch (_) {}

let subscribed = false;

const setEnabled = (on) => {
  enabled = on;
  try { storage?.set(K_ENABLED, on); } catch (_) {}
};

// One tiny leaf listener for the whole session.
const subscribe = () => {
  if (subscribed) return;
  try {
    if (!getApps().length) return;
    onValue(
      ref(getDatabase(getApp()), 'collapsible_banners_enabled'),
      (snap) => setEnabled(snap.val() === true),
      () => setEnabled(false),
    );
    subscribed = true;
  } catch (_) {}
};

subscribe();

export const collapsibleBannersEnabled = () => {
  subscribe();
  return enabled;
};
