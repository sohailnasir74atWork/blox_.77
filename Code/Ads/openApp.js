import { AppState } from 'react-native';
import { AppOpenAd, AdEventType } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';
import { ensureAdsInitialized } from './init';
import { setFullScreenAdVisible, isFullScreenAdVisible } from './adVisibility';

const adUnitId = getAdUnitId('openapp');

// App Open ads expire ~4h after load — showing an expired ad is a silent
// no-op / wasted slot, so we reload instead.
const AD_EXPIRY_MS = 4 * 60 * 60 * 1000;
// Don't show more than once per this window, so quick app-switches (e.g.
// flicking to another app for 5s and back) don't spam the user.
const MIN_INTERVAL_MS = 2 * 60 * 1000;

// isPro is read straight from MMKV so every foreground show respects the
// latest purchase state without any React wiring into this singleton.
let storage = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV();
} catch (_) {}
const isProUser = () => {
  try {
    return storage ? storage.getBoolean('isPro') === true : false;
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
  static retryCount = 0;
  static maxRetries = 5;
  static unsubscribeEvents = [];
  static appStateSub = null;
  static showWatchdog = null;

  // Call once after onboarding, for non-Pro users.
  static start() {
    if (this.hasStarted) return;
    this.hasStarted = true;

    // Preserve the old behaviour of showing one ad on cold start, but now via
    // the same guarded path (Pro / cap / expiry all respected).
    this.showOnFirstLoad = true;

    ensureAdsInitialized()
      .then(() => this._createAndLoad())
      .catch(() => {});

    this.appStateSub = AppState.addEventListener('change', (next) => {
      // Track real backgrounding. iOS bounces active→inactive→active for
      // system prompts (ATT, consent, permission dialogs) WITHOUT ever hitting
      // 'background', so those never set the flag and never trigger a stray ad.
      if (next === 'background') {
        this.wasBackgrounded = true;
      } else if (next === 'active') {
        if (this.wasBackgrounded) {
          this.wasBackgrounded = false;
          this.showAdIfAvailable();
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
      if (this.showOnFirstLoad) {
        this.showOnFirstLoad = false;
        this.showAdIfAvailable();
      }
    });

    const onError = this.ad.addAdEventListener(AdEventType.ERROR, () => {
      this.isLoaded = false;
      this.isLoading = false;
      this._retryLoad();
    });

    // OPENED confirms the ad actually presented — cancel the show watchdog so
    // a legitimately-open ad isn't force-reset out from under the user.
    const onOpened = this.ad.addAdEventListener(AdEventType.OPENED, () => {
      this._clearShowWatchdog();
    });

    const onClosed = this.ad.addAdEventListener(AdEventType.CLOSED, () => {
      this._clearShowWatchdog();
      setFullScreenAdVisible(false);
      this.isShowing = false;
      this.isLoaded = false;
      // Warm up the next one for the next foreground return.
      this._load();
    });

    this.unsubscribeEvents = [onLoaded, onError, onOpened, onClosed];
    this._load();
  }

  static _load() {
    if (this.isLoaded || this.isLoading || !this.ad) return;
    this.isLoading = true;
    try {
      this.ad.load();
    } catch (_) {
      this.isLoading = false;
      this._retryLoad();
    }
  }

  // Exponential backoff (1s,2s,4s,8s,16s), then STOP. The old 30s-forever
  // loop burned no-fill requests all session in zero-fill geos. Every
  // background→foreground return calls showAdIfAvailable(), which calls
  // _load() when nothing is loaded — that natural signal (with retryCount
  // reset) replaces the blind timer.
  static _retryLoad() {
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

  static showAdIfAvailable() {
    if (isProUser()) return;
    // Never stack on top of an interstitial/rewarded, or on ourselves.
    if (this.isShowing || isFullScreenAdVisible()) return;
    // Frequency cap.
    if (Date.now() - this.lastShownAt < MIN_INTERVAL_MS) return;

    if (!this.isLoaded || !this.ad) {
      this._load();
      return;
    }
    if (this._isExpired()) {
      this.isLoaded = false;
      this._createAndLoad();
      return;
    }

    this.isShowing = true;
    this.lastShownAt = Date.now();
    setFullScreenAdVisible(true);
    // Watchdog: App Open ads are frequently dismissed by re-backgrounding the
    // app rather than a clean close, and in those cases CLOSED can fail to
    // fire — which would leave isShowing + the shared full-screen flag stuck
    // true forever and silently block every future App Open ad. If neither
    // OPENED nor CLOSED has resolved this within 10s, force a clean reset so
    // the next foreground return can show again.
    this._clearShowWatchdog();
    this.showWatchdog = setTimeout(() => {
      this.showWatchdog = null;
      if (this.isShowing) {
        setFullScreenAdVisible(false);
        this.isShowing = false;
        this._createAndLoad();
      }
    }, 10000);
    try {
      this.ad.show();
      this.isLoaded = false;
    } catch (_) {
      this._clearShowWatchdog();
      setFullScreenAdVisible(false);
      this.isShowing = false;
      this._createAndLoad();
    }
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
