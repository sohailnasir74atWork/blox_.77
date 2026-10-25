// iOS "update available" popup (bugs LOG + features LOG 2026-10-25).
//
// iOS has no in-app update: only the App Store installs a new version, so the
// most an app can do is tell the user and open its store page. The version to
// compare against is set by hand in RTDB /ios_version (e.g. "12.7") once the
// release is LIVE on the App Store — not Apple's lookup API, which lags a
// release by hours to a day. A build in App Review is newer than that value,
// so the reviewer never sees the popup. Anything that is not a version number
// ("underreview", missing, a failed read) shows nothing.
//
// Checked at launch and when the app returns to the foreground (iOS keeps apps
// suspended for days, so launch alone misses most users). One popup per store
// version per day, whichever button was pressed.
import { Alert, AppState, Linking } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import i18n from 'i18next';
import { getApp } from '@react-native-firebase/app';
import { getDatabase, ref, get } from '@react-native-firebase/database';

const IOS_APP_ID = '6737775801';
const IOS_STORE_DEEPLINK = `itms-apps://apps.apple.com/app/id${IOS_APP_ID}`;
const IOS_STORE_HTTP = `https://apps.apple.com/app/id${IOS_APP_ID}`;

const texts = (storeVersion, currentVersion) => ({
  title: i18n.t('app.in_app_update.title', { defaultValue: 'Update Available' }),
  message: i18n.t('app.in_app_update.message', {
    storeVersion,
    currentVersion,
    defaultValue: "A new version ({{storeVersion}}) is available. You're on {{currentVersion}}.",
  }),
  later: i18n.t('app.in_app_update.later', { defaultValue: 'Later' }),
  update: i18n.t('app.in_app_update.update_now', { defaultValue: 'Update Now' }),
});

const PROMPT_MIN_GAP_MS = 24 * 60 * 60 * 1000;
// RTDB is read at most this often; foregrounding the app does not cost a read.
const READ_MIN_GAP_MS = 60 * 60 * 1000;
const K_PROMPT_AT = 'iosUpdatePromptAt';
const K_PROMPT_VERSION = 'iosUpdatePromptVersion';

let storage = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV();
} catch (_) {}

const VERSION_RE = /^\d+(\.\d+){0,3}$/;

// > 0 when a is newer than b. Both must already match VERSION_RE.
const compareVersions = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
};

const promptedRecently = (version) => {
  try {
    return (
      storage?.getString(K_PROMPT_VERSION) === version &&
      Date.now() - (storage?.getNumber(K_PROMPT_AT) || 0) < PROMPT_MIN_GAP_MS
    );
  } catch (_) {
    return false;
  }
};

const markPrompted = (version) => {
  try {
    storage?.set(K_PROMPT_VERSION, version);
    storage?.set(K_PROMPT_AT, Date.now());
  } catch (_) {}
};

const openStore = async () => {
  try {
    await Linking.openURL(IOS_STORE_DEEPLINK);
  } catch (_) {
    try { await Linking.openURL(IOS_STORE_HTTP); } catch (__) {}
  }
};

let lastReadAt = 0;
let checking = false;

const check = async () => {
  if (checking || Date.now() - lastReadAt < READ_MIN_GAP_MS) return;
  checking = true;
  try {
    const snap = await get(ref(getDatabase(getApp()), 'ios_version'));
    lastReadAt = Date.now();
    const latest = String(snap.val() ?? '').trim();
    const current = String(DeviceInfo.getVersion() || '').trim();
    if (!VERSION_RE.test(latest) || !VERSION_RE.test(current)) return;
    if (compareVersions(latest, current) <= 0 || promptedRecently(latest)) return;
    markPrompted(latest);

    const t = texts(latest, current);
    Alert.alert(t.title, t.message, [
      { text: t.later, style: 'cancel' },
      { text: t.update, onPress: openStore },
    ]);
  } catch (err) {
    console.warn('iOS update check failed:', err?.message || err);
  } finally {
    checking = false;
  }
};

let started = false;

export const startIosUpdatePrompt = () => {
  if (started) return;
  started = true;
  check();
  AppState.addEventListener('change', (state) => {
    if (state === 'active') check();
  });
};
