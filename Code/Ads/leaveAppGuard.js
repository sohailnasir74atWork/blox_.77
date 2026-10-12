// Our own trips out of the app must not come back to an app-open ad.
//
// Google: app-open ads appear "when the user opens or switches back to an
// app". Picking a photo, the share sheet, Google/Apple sign-in, the Play
// update screen and links we open all leave the app (Android reports
// 'background'), and a return after 10 s or more got an app-open ad — shown
// to someone who had just tapped a button in the app (2026-10-12 ads audit).
// Only the store purchase and the notification-permission prompt opted out.
//
// About 50 call sites use these APIs, so instead of touching each one, the
// functions themselves are wrapped once at startup: every call first tells
// AppOpenAdManager to skip the next return. A wrap that fails (a library
// changed shape) only logs; the call itself is never affected.
import { Linking, Share as RNShare } from 'react-native';
import AppOpenAdManager from './openApp';
import { adLog } from './adTelemetry';

// Long enough for a photo pick, a sign-in or a share; short enough that an
// unused skip (iOS pickers and sheets never background the app) does not
// swallow a real return much later.
const LEAVE_SKIP_MS = 2 * 60 * 1000;

const noteLeaving = () => {
  try { AppOpenAdManager.skipNextForeground(LEAVE_SKIP_MS); } catch (_) {}
};

const wrappedLabels = [];

function wrap(target, key, label) {
  try {
    const original = target?.[key];
    if (typeof original !== 'function' || original.__leaveAppWrapped) return;
    wrappedLabels.push(label);
    const wrapped = function (...args) {
      noteLeaving();
      return original.apply(this, args);
    };
    wrapped.__leaveAppWrapped = true;
    target[key] = wrapped;
  } catch (e) {
    adLog(`leave-app guard: ${label} not wrapped (${e?.message || e})`);
  }
}

function wrapModule(name, getter, keys) {
  let mod;
  try { mod = getter(); } catch (_) { return; }
  keys.forEach((k) => wrap(mod, k, `${name}.${k}`));
}

let installed = false;
export function installLeaveAppGuard() {
  if (installed) return;
  installed = true;
  wrap(Linking, 'openURL', 'Linking.openURL');
  wrap(RNShare, 'share', 'Share.share');
  wrapModule('image-picker', () => require('react-native-image-picker'), ['launchImageLibrary', 'launchCamera']);
  wrapModule('react-native-share', () => require('react-native-share').default, ['open', 'shareSingle']);
  wrapModule('google-signin', () => require('@react-native-google-signin/google-signin').GoogleSignin, ['signIn']);
  wrapModule('apple-auth', () => require('@invertase/react-native-apple-authentication').default, ['performRequest']);
  // The Play in-app update screen is an instance method; InAppUpdateCheck.js
  // calls AppOpenAdManager.skipNextForeground() itself.
  if (__DEV__) console.log(`[ads] leave-app guard wrapped: ${wrappedLabels.join(', ')}`);
}
