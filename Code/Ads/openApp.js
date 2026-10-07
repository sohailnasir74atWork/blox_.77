import { AppState, Keyboard } from 'react-native';
import { AppOpenAd, AdEventType } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';
import { ensureAdsInitialized, adsInitialized } from './init';
import {
  setFullScreenAdVisible,
  isFullScreenAdVisible,
  whenModalSettled,
  markFullScreenAdShown,
  msSinceOtherFullScreenAd,
} from './adVisibility';
import {
  APP_OPEN_MIN_BACKGROUND_MS,
  APP_OPEN_MIN_INTERVAL_MS,
  COLD_START_MIN_GAP_MS,
  COLD_START_BUDGET_MS,
  LAUNCH_AD_HOME_GRACE_MS,
  LAUNCH_AD_MAX_MS,
  CROSS_FORMAT_GAP_MS,
  POST_SHOW_RELOAD_MS,
  NO_FILL_RETRY_MS,
  isNoFillError,
} from './adPolicy';

const adUnitId = getAdUnitId('openapp');

// App Open ads expire ~4h after load — showing an expired ad is a silent
// no-op / wasted slot, so we reload instead.
const AD_EXPIRY_MS = 4 * 60 * 60 * 1000;
// Don't show more than once per this window, so quick app-switches (e.g.
// flicking to another app for 5s and back) don't spam the user.
const MIN_INTERVAL_MS = APP_OPEN_MIN_INTERVAL_MS;

// ── Launch (cold-start) ad ──
// No longer tied to the splash (owner decision, 2026-10-07). The splash hides
// as soon as the app is ready; the launch ad shows when it finishes loading —
// over the splash or over Home — if BOTH:
//   1. it loaded inside the launch window (_launchDeadline: at least
//      COLD_START_BUDGET_MS from JS start, at least LAUNCH_AD_HOME_GRACE_MS
//      after Home appeared, never past LAUNCH_AD_MAX_MS), and
//   2. the user has not touched the screen since Home appeared.
// Rule 2 is the accidental-click guard: an ad that appears under a finger
// already on its way to a button is the "unexpected ad" AdMob penalises, and
// someone still looking at a Home they have not touched is not in that
// position. A launch ad that misses either rule stays loaded for the next
// return. Every eligible launch logs one `launch_ad` event (see _logLaunch).
const APP_START_AT = Date.now();          // module load ≈ JS start (App.js imports this at the top)
const K_LAST_COLD_AD = 'appOpenLastColdStartAt';
const K_LAUNCHED_BEFORE = 'appOpenHasLaunchedBefore';

// isPro / proGranted are read straight from MMKV so every foreground show
// respects the latest purchase state without any React wiring into this
// singleton. `isPro` is the RevenueCat entitlement; `proGranted` is the
// RTDB-purchase Pro membership GlobelStats.js mirrors into MMKV.
let storage = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV();
} catch (_) {}
// Read ONCE at module load, then flag this launch: a user's first-ever launch
// never gets a cold-start ad (Google's guidance), and that includes the
// session in which they finish onboarding.
let launchedBefore = false;
try {
  // isAppReady: written on every launch by older builds too, so existing
  // users are not mistaken for first-timers the first time this code runs.
  launchedBefore = !!storage && (storage.getBoolean(K_LAUNCHED_BEFORE) === true ||
    storage.getBoolean('isAppReady') === true);
  storage?.set(K_LAUNCHED_BEFORE, true);
} catch (_) {}

const isProUser = () => {
  try {
    if (!storage) return false;
    return storage.getBoolean('isPro') === true || storage.getBoolean('proGranted') === true;
  } catch (_) {
    return false;
  }
};

/**
 * App Open ad manager.
 *
 * Previous version showed exactly ONE ad per app lifetime (`hasShownOnce`) and
 * never reloaded — so the highest-eCPM format fired once and went dark for the
 * rest of the session. This version keeps an ad warm and shows it on every
 * genuine background→foreground return (capped + Pro-gated + de-duped against
 * other full-screen ads), which is where App Open revenue actually lives for a
 * utility app users reopen many times a day.
 */
class AppOpenAdManager {
  static ad = null;
  static isLoaded = false;
  static isLoading = false;
  static loadedAt = 0;
  static lastShownAt = 0;
  static isShowing = false;
  static hasStarted = false;
  static showOnFirstLoad = false;
  static wasBackgrounded = false;
  static backgroundedAt = 0;
  static retryCount = 0;
  static maxRetries = 3;
  static noFillRetried = false;
  static unsubscribeEvents = [];
  static appStateSub = null;
  static showWatchdog = null;
  static foregroundTimer = null;
  static coldStartShowing = false;
  static skipForegroundUntil = 0;
  // Launch-window bookkeeping (see the Launch ad notes at the top).
  static homeVisibleAt = 0;
  static touchedAt = 0;
  static launchLogged = false;

  /**
   * Our own trips out of the app (the Play / App Store purchase sheet) come
   * back through 'active' exactly like a real return, and got an app-open ad:
   * shown to someone who had just tried to BUY ad-free, before the purchase
   * had even confirmed. Call right before leaving; the window only bounds how
   * long an unused skip lingers (iOS's StoreKit sheet never backgrounds the
   * app, so it is never consumed there).
   */
  static skipNextForeground(ms = 5 * 60 * 1000) {
    this.skipForegroundUntil = Date.now() + ms;
  }

  /**
   * Decide, at launch, whether this launch gets a launch ad. Call once, early
   * (App.js does it on mount). Nothing waits on it: the splash hides on its
   * own schedule.
   */
  static prepareColdStart() {
    let lastCold = 0;
    try { lastCold = Number(storage?.getString(K_LAST_COLD_AD)) || 0; } catch (_) {}
    const eligible = launchedBefore && !isProUser() &&
      Date.now() - lastCold >= COLD_START_MIN_GAP_MS;
    if (!eligible) return;

    this.showOnFirstLoad = true;
    // Window closed with nothing loaded: record it. The ad, if it lands later,
    // stays warm for the next return.
    setTimeout(() => {
      if (this.showOnFirstLoad) {
        this.showOnFirstLoad = false;
        this._logLaunch('not_loaded');
      }
    }, Math.max(0, APP_START_AT + LAUNCH_AD_MAX_MS - Date.now()));
  }

  static skipColdStart() {
    this.showOnFirstLoad = false;
  }

  // App.js: the splash has gone, so Home is what the user sees from now on.
  static noteHomeVisible() {
    if (!this.homeVisibleAt) this.homeVisibleAt = Date.now();
  }

  // App.js root onTouchStartCapture. Only the first touch on Home matters.
  static noteUserTouch() {
    if (AppOpenAdManager.homeVisibleAt && !AppOpenAdManager.touchedAt) {
      AppOpenAdManager.touchedAt = Date.now();
    }
  }

  // Latest moment a launch ad may still appear.
  static _launchDeadline() {
    const afterHome = this.homeVisibleAt ? this.homeVisibleAt + LAUNCH_AD_HOME_GRACE_MS : 0;
    return Math.min(
      APP_START_AT + LAUNCH_AD_MAX_MS,
      Math.max(APP_START_AT + COLD_START_BUDGET_MS, afterHome),
    );
  }

  // One `launch_ad` analytics event per eligible launch, so the window can be
  // tuned from real numbers: outcome = shown | late | touched | no_fill |
  // not_loaded | failed | blocked; ms = time from JS start; over = what the
  // user was looking at (splash or home).
  static _logLaunch(outcome, ms = Date.now() - APP_START_AT) {
    if (this.launchLogged) return;
    this.launchLogged = true;
    try {
      require('../Helper/growthAnalytics').trackGrowthEvent('launch_ad', {
        outcome,
        ms: Math.round(ms),
        over: this.homeVisibleAt ? 'home' : 'splash',
      });
    } catch (_) {}
  }

  // Call once after onboarding, for non-Pro users.
  static start() {
    if (this.hasStarted) return;
    this.hasStarted = true;

    // Whether THIS launch shows a cold-start ad was decided by
    // prepareColdStart(); start() only loads and wires the foreground shows.

    ensureAdsInitialized()
      .then(() => this._createAndLoad())
      .catch(() => {});

    this.appStateSub = AppState.addEventListener('change', (next) => {
      // Track real backgrounding. iOS bounces active→inactive→active for
      // system prompts (ATT, consent, permission dialogs) WITHOUT ever hitting
      // 'background', so those never set the flag and never trigger a stray ad.
      if (next === 'background') {
        // On Android a full-screen ad is its own Activity: showing one pauses
        // ours, so RN reports 'background', and closing it reports 'active'.
        // That read as a return to the app and fired this ad straight after
        // every interstitial/rewarded ("i watched ad and after watching i get
        // another ad"). Our own ad being on screen is how we tell them apart.
        if (!isFullScreenAdVisible()) {
          this.wasBackgrounded = true;
          this.backgroundedAt = Date.now();
        }
      } else if (next === 'active') {
        if (this.wasBackgrounded) {
          this.wasBackgrounded = false;
          if (Date.now() < this.skipForegroundUntil) {
            this.skipForegroundUntil = 0;
            return;
          }
          // A quick flick to Roblox and back is not a new session — the user
          // never left. Only a genuine absence earns an app-open ad.
          if (Date.now() - this.backgroundedAt < APP_OPEN_MIN_BACKGROUND_MS) return;
          this._showOnForeground();
        }
      }
    });
  }

  static _createAndLoad() {
    this._cleanupAd();
    this.ad = AppOpenAd.createForAdRequest(adUnitId);

    const onLoaded = this.ad.addAdEventListener(AdEventType.LOADED, () => {
      this.isLoaded = true;
      this.isLoading = false;
      this.loadedAt = Date.now();
      this.retryCount = 0;
      this.noFillRetried = false;
      if (this.showOnFirstLoad) {
        this.showOnFirstLoad = false;
        // Outside the launch window, or the user is already tapping around:
        // keep it for the next return instead of dropping it onto them.
        if (this.touchedAt) {
          this._logLaunch('touched');
        } else if (Date.now() > this._launchDeadline()) {
          this._logLaunch('late');
        } else {
          this.coldStartShowing = true;
          this.showAdIfAvailable();
          if (!this.isShowing) {
            this.coldStartShowing = false;
            this._logLaunch('blocked');
          }
        }
      }
    });

    const onError = this.ad.addAdEventListener(AdEventType.ERROR, (error) => {
      const noFill = isNoFillError(error);
      this.isLoaded = false;
      this.isLoading = false;
      // No launch ad this launch. (A transient error keeps the window open —
      // its quick retry can still land in time.)
      if (noFill && this.showOnFirstLoad) {
        this.showOnFirstLoad = false;
        this._logLaunch('no_fill');
      }
      this._retryLoad(noFill);
    });

    // OPENED confirms the ad actually presented — cancel the show watchdog so
    // a legitimately-open ad isn't force-reset out from under the user.
    const onOpened = this.ad.addAdEventListener(AdEventType.OPENED, () => {
      markFullScreenAdShown('app_open');
      this._clearShowWatchdog();
      if (this.coldStartShowing) {
        this.coldStartShowing = false;
        try { storage?.set(K_LAST_COLD_AD, String(Date.now())); } catch (_) {}
        this._logLaunch('shown');
      }
    });

    const onClosed = this.ad.addAdEventListener(AdEventType.CLOSED, () => {
      this._clearShowWatchdog();
      setFullScreenAdVisible(false);
      this.isShowing = false;
      this.isLoaded = false;
      // Warm up the next one for the next foreground return — after the
      // AdMob cap window, or the request fails with "frequency cap reached"
      // and nothing is ready for that return (see POST_SHOW_RELOAD_MS).
      setTimeout(() => this._load(), POST_SHOW_RELOAD_MS);
    });

    this.unsubscribeEvents = [onLoaded, onError, onOpened, onClosed];
    this._load();
  }

  static _load() {
    if (this.isLoaded || this.isLoading || !this.ad) return;
    // Consent + config first: a load before the SDK is initialised would go
    // out ahead of the UMP answer. Deferred, not dropped.
    if (!adsInitialized()) {
      ensureAdsInitialized().then(() => this._load()).catch(() => {});
      return;
    }
    this.isLoading = true;
    try {
      this.ad.load();
    } catch (_) {
      this.isLoading = false;
      this._retryLoad();
    }
  }

  // Exponential backoff (1s,2s,4s), then STOP. The old 30s-forever loop
  // burned no-fill requests all session in zero-fill geos. Every
  // background→foreground return calls showAdIfAvailable(), which calls
  // _load() when nothing is loaded — that natural signal replaces the
  // blind timer. A "no fill" gets ONE retry after NO_FILL_RETRY_MS (the
  // 1→16s backoff used to answer it with five more identical requests per
  // launch — AdMob: 2.8M requests for 812K app-open impressions in one app).
  // It used to get none, which left nothing loaded for the next return: that
  // return only started a load, so one no-fill cost a whole ad opportunity.
  static _retryLoad(noFill) {
    if (noFill) {
      if (this.noFillRetried) return;
      this.noFillRetried = true;
      setTimeout(() => this._load(), NO_FILL_RETRY_MS);
      return;
    }
    if (this.retryCount >= this.maxRetries) return;
    const delay = Math.pow(2, this.retryCount) * 1000;
    setTimeout(() => {
      this.retryCount += 1;
      this._load();
    }, delay);
  }

  static _isExpired() {
    return Date.now() - this.loadedAt > AD_EXPIRY_MS;
  }

  static _clearShowWatchdog() {
    if (this.showWatchdog) {
      clearTimeout(this.showWatchdog);
      this.showWatchdog = null;
    }
  }

  // Returning to the foreground is the one moment the app is guaranteed to be
  // mid-reflow: screens re-render and their AppState effects fire, which is
  // exactly when a drawer can be re-presenting. Presenting an ad into that is
  // what UIKit refuses, and the user is left looking at a frozen screen. One
  // short beat lets the view-controller stack settle first.
  static _showOnForeground() {
    if (this.foregroundTimer) clearTimeout(this.foregroundTimer);
    this.foregroundTimer = setTimeout(() => {
      this.foregroundTimer = null;
      // The user may have backgrounded again inside the delay — never present
      // into an app that is no longer on screen.
      if (AppState.currentState !== 'active') return;
      this.showAdIfAvailable();
    }, 350);
  }

  static showAdIfAvailable() {
    if (isProUser()) return;
    // Never stack on top of an interstitial/rewarded, or on ourselves.
    if (this.isShowing || isFullScreenAdVisible()) return;

    // Make sure one is warming BEFORE the caps below decide this return gets
    // nothing: a return too soon to show an ad is still the right moment to
    // fetch one for the next return. (The caps used to return first, so a
    // return inside the window left the manager empty for the following one.)
    // Not inside the AdMob cap window right after a show, though — that
    // request would only come back "frequency cap reached", and the post-show
    // reload is already scheduled for the end of it.
    if (!this.isLoaded || !this.ad) {
      if (Date.now() - this.lastShownAt >= POST_SHOW_RELOAD_MS) this._load();
      return;
    }
    if (this._isExpired()) {
      this.isLoaded = false;
      this._createAndLoad();
      return;
    }

    // Never follow another full-screen format within the cross-format gap.
    if (msSinceOtherFullScreenAd('app_open') < CROSS_FORMAT_GAP_MS) return;
    // Frequency cap.
    if (Date.now() - this.lastShownAt < MIN_INTERVAL_MS) return;

    this.isShowing = true;
    this.lastShownAt = Date.now();
    setFullScreenAdVisible(true);
    // Hold the present until no modal is animating: on iOS the ad is shown
    // from the topmost view controller, and UIKit refuses to present from one
    // that is itself mid-transition. Synchronous when nothing is animating.
    whenModalSettled(() => this._present());
  }

  static _present() {
    // Watchdog: App Open ads are frequently dismissed by re-backgrounding the
    // app rather than a clean close, and in those cases CLOSED can fail to
    // fire — which would leave isShowing + the shared full-screen flag stuck
    // true forever and silently block every future App Open ad. If neither
    // OPENED nor CLOSED has resolved this within 10s, force a clean reset so
    // the next foreground return can show again.
    this._clearShowWatchdog();
    this.showWatchdog = setTimeout(() => {
      this.showWatchdog = null;
      if (this.isShowing) this._resetFailedShow();
    }, 10000);
    try {
      // show() returns a promise; a refused present rejects it rather than
      // throwing. Only reset if this attempt is still the live one.
      // Drop keyboard focus first: a focused TextInput that list clipping
      // detaches while the ad covers the app crashed ScrollView.onSizeChanged
      // on return ("parameter must be a descendant of this view").
      Keyboard.dismiss();
      const shown = this.ad.show();
      this.isLoaded = false;
      if (shown && typeof shown.catch === 'function') {
        shown.catch(() => { if (this.isShowing) this._resetFailedShow(); });
      }
    } catch (_) {
      this._resetFailedShow();
    }
  }

  // A present that never reached the screen: nothing was displayed, so don't
  // burn the interval on an impression the user never saw.
  static _resetFailedShow() {
    this._clearShowWatchdog();
    setFullScreenAdVisible(false);
    this.isShowing = false;
    this.lastShownAt = 0;
    if (this.coldStartShowing) {
      this.coldStartShowing = false;
      this._logLaunch('failed');
    }
    this._createAndLoad();
  }

  static _cleanupAd() {
    this.unsubscribeEvents.forEach((u) => {
      try {
        u();
      } catch (_) {}
    });
    this.unsubscribeEvents = [];
    this.isLoaded = false;
    this.isLoading = false;
  }

  static stop() {
    this._clearShowWatchdog();
    if (this.foregroundTimer) {
      clearTimeout(this.foregroundTimer);
      this.foregroundTimer = null;
    }
    if (this.appStateSub) {
      this.appStateSub.remove();
      this.appStateSub = null;
    }
    this._cleanupAd();
    this.hasStarted = false;
    this.ad = null;
  }
}

export default AppOpenAdManager;
