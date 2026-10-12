// navigationService.js — root navigation ref for code that runs outside a
// screen (push-notification taps). Same shape as adoptme-jan7's helper.
import { createNavigationContainerRef } from '@react-navigation/native';
import { getCrashlytics, setAttribute, log as crashlyticsLog } from '@react-native-firebase/crashlytics';
import { getAnalytics, logEvent } from '@react-native-firebase/analytics';

export const navigationRef = createNavigationContainerRef();

// Screen names for crash reports (same as adoptme-jan7, 2026-10-12). Before
// this every Android crash breadcrumb said only "MainActivity", so the Fabric
// addViewAt crash (Crashlytics c907906e) could not be tied to a screen. The
// screen_view event becomes a Crashlytics breadcrumb, the log line lands in
// the crash's logs, and the `screen` key shows where the app was at the
// moment it crashed.
let _lastScreen = null;
export function trackCurrentScreen() {
  const name = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : null;
  if (!name || name === _lastScreen) return;
  _lastScreen = name;
  try {
    const c = getCrashlytics();
    crashlyticsLog(c, `screen ${name}`);
    setAttribute(c, 'screen', name).catch(() => {});
  } catch (_) {}
  try {
    logEvent(getAnalytics(), 'screen_view', { screen_name: name, screen_class: name }).catch(() => {});
  } catch (_) {}
}

/** Navigate from outside a screen. No-op until the navigator is ready. */
export function navigate(name, params) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
}

// Routes a tapped push may open (its data.route), with the params each gets.
// Anything not listed is ignored.
//
// FruitValuesStack lands on the values list (ValuesHome) even when that stack
// is already open on another page. `pop` goes back to an existing entry rather
// than stacking a second copy: React Navigation 7's navigate no longer does
// that by itself.
const PUSH_ROUTES = {
  FruitValuesStack: { screen: 'ValuesHome', pop: true },
};

// A cold-start tap can arrive before the NavigationContainer exists (or while
// onboarding is still on screen); it waits here until onNavigationReady.
let pendingPushRoute = null;

/** Open the screen a tapped notification points to, if it is allowlisted. */
export function openPushRoute(route) {
  if (typeof route !== 'string' || !Object.prototype.hasOwnProperty.call(PUSH_ROUTES, route)) {
    return;
  }
  if (!navigationRef.isReady()) {
    pendingPushRoute = route;
    return;
  }
  pendingPushRoute = null;
  try {
    navigationRef.navigate(route, PUSH_ROUTES[route], { pop: true });
  } catch (_) {
    // Never let a notification tap crash the app.
  }
}

/** NavigationContainer onReady: open a route a tap asked for before then. */
export function onNavigationReady() {
  trackCurrentScreen();
  const route = pendingPushRoute;
  pendingPushRoute = null;
  if (route) {
    openPushRoute(route);
  }
}
