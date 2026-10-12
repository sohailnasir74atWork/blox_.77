/**
 * Value-update push alerts — the FCM topic `value-updates`.
 *
 * A publisher on the owner's Mac sends ONE topic message whenever Blox Fruits
 * trading values change (data.type 'values_update', data.route
 * 'FruitValuesStack'). Every device with the Settings switch on is subscribed,
 * guests included, so there is no per-user server state.
 *
 * The switch is local state (LocalGlobelStats key VALUE_UPDATES_SETTING_KEY,
 * default ON). Topic subscriptions belong to the FCM token, which can rotate,
 * so the saved choice is re-applied once per app start (one idempotent call,
 * see FrontendNotificationHandling.js); Settings applies changes immediately.
 *
 * A subscribed guest on iOS or Android 13+ sees nothing without notification
 * permission, and nothing else asks a guest, so the app asks ONCE per install
 * (owner decision, matches MM2): askPermissionOnce, scheduled by
 * scheduleValueUpdatePermissionAsk after onboarding and the consent prompts.
 *
 * Nothing here throws, and nothing on the startup path waits for it.
 */
import { AppState, Platform } from 'react-native';
import {
  getMessaging,
  getAPNSToken,
  subscribeToTopic,
  unsubscribeFromTopic,
} from '@react-native-firebase/messaging';
import notifee, { AuthorizationStatus } from '@notifee/react-native';
import { whenAdsGateOpen } from '../Ads/init';
import { isFullScreenAdVisible } from '../Ads/adVisibility';
import { LAUNCH_AD_MAX_MS } from '../Ads/adPolicy';

export const VALUE_UPDATES_TOPIC = 'value-updates';
export const VALUE_UPDATES_TYPE = 'values_update';
// MMKV boolean, absent = ON. LocalGlobelStats reads it into
// localState.valueUpdateNotifications for the Settings switch.
export const VALUE_UPDATES_SETTING_KEY = 'valueUpdateNotifications';
// MMKV boolean: the one startup permission ask has happened on this install.
export const PERMISSION_ASKED_KEY = 'valueUpdatesPermissionAsked';

// Same default MMKV instance as LocalGlobelStats.js.
let storage = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV();
} catch (_) {}

const MODULE_LOADED_AT = Date.now(); // ≈ JS start: App.js → Setting.jsx imports this

// iOS: FCM needs the APNs token before a topic call. The app relies on RNFB's
// automatic remote-message registration and, like registerForNotifications in
// Globelhelper.js, waits for the token with a few short retries.
const APNS_RETRIES = 3;
const APNS_RETRY_MS = 1500;
// The iOS SDK can hold a topic call until a token exists; don't let one stuck
// call hold up the queue below forever.
const TOPIC_CALL_TIMEOUT_MS = 20000;

// Permission ask timing: this long after the consent chain, so it doesn't land
// on the splash fade or straight on the last consent prompt...
const PERMISSION_ASK_DELAY_MS = 3000;
// ...then poll until the screen is clear (see waitForClearScreen), giving up
// for this launch after the max wait (the flag stays unset, so the next
// launch tries again).
const CLEAR_SCREEN_POLL_MS = 1000;
const CLEAR_SCREEN_MAX_WAIT_MS = 2 * 60 * 1000;
// Android 13+: how long the app-open ad ignores the next "return to the app"
// (the permission dialog pauses the activity; see askPermissionOnce).
const PERMISSION_DIALOG_AD_SKIP_MS = 2 * 60 * 1000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isValueUpdatesEnabled = () => {
  try {
    return storage?.getBoolean(VALUE_UPDATES_SETTING_KEY) ?? true;
  } catch (_) {
    return true;
  }
};

const waitForApnsToken = async (messaging) => {
  if (Platform.OS !== 'ios') {
    return;
  }
  for (let attempt = 0; attempt <= APNS_RETRIES; attempt += 1) {
    try {
      if (await getAPNSToken(messaging)) {
        return;
      }
    } catch (_) {
      // Not registered yet: retry, then try the topic call anyway.
    }
    if (attempt < APNS_RETRIES) {
      await wait(APNS_RETRY_MS);
    }
  }
};

const applyNow = async (enabled) => {
  try {
    const messaging = getMessaging();
    await waitForApnsToken(messaging);
    const call = enabled
      ? subscribeToTopic(messaging, VALUE_UPDATES_TOPIC)
      : unsubscribeFromTopic(messaging, VALUE_UPDATES_TOPIC);
    return await Promise.race([
      call.then(() => true),
      wait(TOPIC_CALL_TIMEOUT_MS).then(() => false),
    ]);
  } catch (_) {
    return false;
  }
};

// One call at a time, so a quick on/off/on in Settings (or the start-up sync
// racing a toggle) always ends in the state asked for last.
let queue = Promise.resolve(true);

/**
 * Subscribe (true) or unsubscribe (false) this device. Resolves to whether the
 * call succeeded; never rejects.
 */
export function setValueUpdateSubscription(enabled) {
  const run = () => applyNow(enabled !== false);
  queue = queue.then(run, run);
  return queue;
}

/**
 * The one startup notification-permission ask. Does nothing if the Settings
 * switch is off or this install was already asked. The flag is written BEFORE
 * anything else, so even a crash mid-ask can't lead to a second ask. Already
 * allowed → no prompt (flag still set). notifee, not
 * messaging().requestPermission(), which never prompts on Android.
 * Never throws.
 */
export async function askPermissionOnce() {
  try {
    // No storage, no way to remember the ask: don't risk asking every launch.
    if (!storage || !isValueUpdatesEnabled() || storage.getBoolean(PERMISSION_ASKED_KEY) === true) {
      return;
    }
    storage.set(PERMISSION_ASKED_KEY, true);

    const { authorizationStatus } = await notifee.getNotificationSettings();
    if (
      authorizationStatus === AuthorizationStatus.AUTHORIZED ||
      authorizationStatus === AuthorizationStatus.PROVISIONAL
    ) {
      return;
    }

    // Android 13+ shows the system dialog in its own activity, which pauses
    // ours: the app-open ad reads that as leaving the app, and answering the
    // dialog after 10 s would bring an ad straight after it. iOS's alert never
    // backgrounds the app. Required lazily so this module never changes when
    // openApp.js (and its launch clock) is first evaluated.
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      try {
        require('../Ads/openApp').default.skipNextForeground(PERMISSION_DIALOG_AD_SKIP_MS);
      } catch (_) {}
    }

    await notifee.requestPermission();
  } catch (_) {
    // Never let the ask break startup.
  }
}

// True once nothing else can be on screen with the ask: the launch app-open
// ad's window has closed (no launch ad can appear after it), no full-screen
// ad is showing, and the app is in the foreground. False after the max wait.
const waitForClearScreen = async () => {
  const launchAdWindowEnd = MODULE_LOADED_AT + LAUNCH_AD_MAX_MS;
  const giveUpAt = Date.now() + CLEAR_SCREEN_MAX_WAIT_MS;
  while (Date.now() < giveUpAt) {
    if (
      Date.now() >= launchAdWindowEnd &&
      !isFullScreenAdVisible() &&
      AppState.currentState === 'active'
    ) {
      return true;
    }
    await wait(CLEAR_SCREEN_POLL_MS);
  }
  return false;
};

let permissionAskScheduled = false;

/**
 * Call once at app start (FrontendNotificationHandling.js). Waits for the ads
 * gate — App.js opens it after onboarding AND the UMP → iOS ATT consent chain
 * (Code/Ads/init.js whenAdsGateOpen) — then PERMISSION_ASK_DELAY_MS, then a
 * clear screen, then askPermissionOnce. Someone still in onboarding is asked
 * once they finish, not skipped. Fire-and-forget; never throws.
 */
export function scheduleValueUpdatePermissionAsk() {
  if (permissionAskScheduled) {
    return;
  }
  permissionAskScheduled = true;
  try {
    if (!storage || storage.getBoolean(PERMISSION_ASKED_KEY) === true) {
      return;
    }
    whenAdsGateOpen()
      .then(() => wait(PERMISSION_ASK_DELAY_MS))
      .then(waitForClearScreen)
      .then((clear) => (clear ? askPermissionOnce() : undefined))
      .catch(() => {});
  } catch (_) {}
}
