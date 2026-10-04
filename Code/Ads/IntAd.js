// InterstitialAdManager.js - single warm instance, Pro-gated, bounded retries
import {
  InterstitialAd,
  AdEventType,
} from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';
import { ensureAdsInitialized } from './init';
import {
  setFullScreenAdVisible,
  isFullScreenAdVisible,
  whenModalSettled,
  markFullScreenAdShown,
  msSinceOtherFullScreenAd,
  msSinceAnyFullScreenAd,
} from './adVisibility';
import {
  NATURAL_BREAK,
  CROSS_FORMAT_GAP_MS,
  NO_FILL_RETRY_MS,
  INTERSTITIAL_EXPIRY_MS,
  POST_SHOW_RELOAD_MS,
  isNoFillError,
} from './adPolicy';

const interstitialAdUnitId = getAdUnitId('interstitial');

// Module load ≈ JS start; App.js imports this at the top. Used for the
// natural-break warm-up window.
const APP_START_AT = Date.now();

// isPro / proGranted read straight from MMKV (same pattern as openApp.js).
// `isPro` is the RevenueCat entitlement (LocalGlobelStats); `proGranted` is
// the RTDB-purchase Pro membership that GlobelStats.js computes and mirrors
// into MMKV for these singletons — before that mirror, Pro-granted users
// still got interstitials and app-open ads. Every showAd() call site already
// checks isPro before calling, so a Pro user can never be shown an
// interstitial — which made the old unconditional preload pure auction waste
// (fills that could not ever become impressions). AdMob show rate for this
// unit was 3-5%; roughly half of that came from preloading two instances for
// everyone on every launch.
let storage = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV();
} catch (_) {}
const isProUser = () => {
  try {
    if (!storage) return false;
    return storage.getBoolean('isPro') === true || storage.getBoolean('proGranted') === true;
  } catch (_) {
    return false;
  }
};

class InterstitialAdManager {
  // Single ad instance. The old A/B dual-instance (primary + game unit)
  // doubled fills per session while only one could ever be shown — halving
  // the unit's show rate for zero measured eCPM difference between the units.
  static ad = null;
  static isLoaded = false;
  static isLoading = false;
  static hasInitialized = false;
  static unsubscribeEvents = [];

  // Guards against two concurrent showAd()/waitForAdAndShow() loops both
  // calling show() in the same tick (~13 independent call sites can fire at
  // once on a cold start) — which would waste an ad slot and mis-fire
  // callbacks.
  static isShowing = false;

  // Transient failures (network, internal) get a short backoff; "no fill"
  // gets exactly one retry a minute later — see adPolicy.js.
  static retryCount = 0;
  static maxRetries = 3;
  static noFillRetried = false;
  static lastNoFillAt = 0;

  // When the warm ad was filled; stale ads are dropped (INTERSTITIAL_EXPIRY_MS).
  static loadedAt = 0;

  // ✅ Wait timeout for ad to load (improves show rate)
  static WAIT_TIMEOUT_MS = 3000;

  // ✅ Global frequency cap. There are ~13 interstitial call sites across the
  // app firing independently (chat send, search, upload, post, save, share,
  // daily rewards, log trade…). Without a shared cooldown, two quick actions
  // serve two back-to-back interstitials — ad fatigue, lower eCPM, and AdMob
  // ad-serving-limit risk. Inside the cooldown we skip the ad and run the
  // caller's callback immediately so content is never blocked. Kept in sync
  // with adoptme-jan7 and mm2values at 30s.
  static lastShownAt = 0;
  static COOLDOWN_MS = 30000;

  // ✅ How long to wait for OPENED before treating the presentation as failed.
  static SHOW_WATCHDOG_MS = 5000;

  // Natural-break placement bookkeeping (see showAtNaturalBreak).
  static naturalBreakShows = 0;

  static init() {
    if (this.hasInitialized) return;
    // ✅ Mark initialized synchronously so re-entry / show() before the async
    // init resolves doesn't double-attach listeners or re-load.
    this.hasInitialized = true;

    // Pro users never see interstitials — skip the warm load entirely. If the
    // user loses Pro later, the first showAd()/prepare() lazily creates the ad.
    if (isProUser()) return;

    // ✅ Config-before-load: await the shared AdMob init (consent →
    // setRequestConfiguration → initialize) so the first ad request already
    // respects maxAdContentRating 'T' and the user's consent choices.
    ensureAdsInitialized()
      .then(() => this._createAndLoad())
      .catch(() => {
        // If init somehow rejects, still attempt to load so ads aren't dead.
        this._createAndLoad();
      });
  }

  static _createAndLoad() {
    if (this.ad) {
      this._load();
      return;
    }
    this.ad = InterstitialAd.createForAdRequest(interstitialAdUnitId);

    const onLoaded = this.ad.addAdEventListener(AdEventType.LOADED, () => {
      this.isLoaded = true;
      this.isLoading = false;
      this.loadedAt = Date.now();
      this.retryCount = 0;
      this.noFillRetried = false;
    });

    const onError = this.ad.addAdEventListener(AdEventType.ERROR, (error) => {
      const noFill = isNoFillError(error);
      if (noFill) this.lastNoFillAt = Date.now();
      this.isLoaded = false;
      this.isLoading = false;
      this._retryLoad(noFill);
    });

    this.unsubscribeEvents = [onLoaded, onError];
    this._load();
  }

  static _load() {
    if (this.isLoaded || this.isLoading || !this.ad) return;
    this.isLoading = true;
    try {
      this.ad.load();
    } catch (_) {
      this.isLoading = false;
      this._retryLoad(false);
    }
  }

  // ✅ Bounded retry, then STOP. The old infinite 15s loop burned no-fill
  // requests all session in zero-fill geos, dragging match rate down and
  // inviting ad-serving limits. Loading resumes naturally on the next user
  // signal: prepare(), showAd(), or a show-completion reload.
  //
  // Two cases: a transient error (network, internal) backs off 1s → 2s → 4s;
  // "no fill" is the auction saying "nothing for this user right now", which
  // the 1→16s backoff used to answer with five more identical requests
  // (AdMob: 2.9M requests for 185K interstitial impressions in one app).
  // That gets one retry a minute later and then waits for a real signal.
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

  // The last request came back empty very recently; asking again now would
  // get the same answer.
  static _recentNoFill() {
    return Date.now() - this.lastNoFillAt < NO_FILL_RETRY_MS;
  }

  // Google expires a loaded interstitial after an hour. A warm ad from a
  // launch two hours ago shows nothing — drop it and warm a fresh one.
  static _dropIfExpired() {
    if (this.isLoaded && Date.now() - this.loadedAt > INTERSTITIAL_EXPIRY_MS) {
      this.isLoaded = false;
      this._load();
    }
  }

  // ✅ Proximity preload: call when a show is likely soon. Idempotent and
  // cheap — no-ops when an ad is already loaded/loading. Also un-sticks a
  // manager whose bounded retries ran out — except straight after a no-fill,
  // where re-arming only repeats the empty request.
  static prepare() {
    if (!this.hasInitialized) {
      this.init();
      return;
    }
    if (isProUser() || this.isLoading) return;
    this._dropIfExpired();
    if (this.isLoaded || this._recentNoFill()) return;
    this.retryCount = 0;
    if (this.ad) this._load();
    else this._createAndLoad();
  }

  // Another full-screen format is on screen or was a moment ago.
  static _blockedByOtherFormat() {
    return isFullScreenAdVisible() ||
      msSinceOtherFullScreenAd('interstitial') < CROSS_FORMAT_GAP_MS;
  }

  // ✅ Show ad. Same contract as before: caller's callback always runs, and
  // content is never gated on ad availability.
  static showAd(onAdClosedCallback, onAdUnavailableCallback) {
    if (!this.hasInitialized) {
      this.init();
    }

    // ✅ Another show is in flight — never double-show; let the caller proceed.
    if (this.isShowing) {
      if (typeof onAdClosedCallback === 'function') onAdClosedCallback();
      return;
    }

    // ✅ Global frequency cap: inside the cooldown window, skip the ad and let
    // the caller proceed immediately (content is never gated on the ad). The
    // same applies right after an app-open or rewarded ad.
    if (Date.now() - this.lastShownAt < Math.max(this.COOLDOWN_MS, POST_SHOW_RELOAD_MS) ||
        this._blockedByOtherFormat()) {
      if (typeof onAdClosedCallback === 'function') onAdClosedCallback();
      return;
    }

    this._dropIfExpired();
    if (this.isLoaded && this.ad) {
      this._show(onAdClosedCallback);
      return;
    }

    // Nothing warm, and the auction said "no fill" within the last minute: a
    // wait would hold the user's action for 3s and then give up anyway. Let
    // them through now.
    if (this._recentNoFill()) {
      if (typeof onAdUnavailableCallback === 'function') onAdUnavailableCallback();
      else if (typeof onAdClosedCallback === 'function') onAdClosedCallback();
      return;
    }

    // ✅ Ad not ready - wait for one to load (up to WAIT_TIMEOUT_MS). This
    // converts near-miss triggers into shows instead of instantly giving up.
    this.waitForAdAndShow(onAdClosedCallback, onAdUnavailableCallback);
  }

  // ✅ Wait for the ad to load before giving up (improves show rate)
  static waitForAdAndShow(onAdClosedCallback, onAdUnavailableCallback) {
    const startTime = Date.now();

    // ✅ Trigger a load if not already loading (also resets exhausted retries)
    this.prepare();

    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;

      if (this.isShowing) {
        // Another call site won the race — don't stack a second show.
        clearInterval(checkInterval);
        if (typeof onAdClosedCallback === 'function') onAdClosedCallback();
        return;
      }

      if (this.isLoaded && this.ad) {
        clearInterval(checkInterval);
        this._show(onAdClosedCallback);
        return;
      }

      // ✅ Timeout reached - give up
      if (elapsed >= this.WAIT_TIMEOUT_MS) {
        clearInterval(checkInterval);

        if (typeof onAdUnavailableCallback === 'function') {
          onAdUnavailableCallback();
        } else if (typeof onAdClosedCallback === 'function') {
          onAdClosedCallback();
        }
      }
    }, 100); // Check every 100ms
  }

  /**
   * Natural-break placement: the user is moving between screens (a tab
   * switch), which is the standard interstitial moment and the one the app
   * never used. Unlike showAd() this NEVER waits for a fill — a transition
   * must stay instant — and it runs under the stricter NATURAL_BREAK caps on
   * top of the usual cooldown, Pro gate and cross-format rules. Returns true
   * when an ad was presented.
   */
  static showAtNaturalBreak(source) {
    if (!NATURAL_BREAK.ENABLED) return false;
    if (!this.hasInitialized) this.init();
    if (isProUser()) return false;

    const now = Date.now();
    if (now - APP_START_AT < NATURAL_BREAK.SESSION_WARMUP_MS) return false;
    if (this.naturalBreakShows >= NATURAL_BREAK.MAX_PER_SESSION) return false;
    if (now - this.lastShownAt < NATURAL_BREAK.MIN_GAP_MS) return false;
    if (msSinceAnyFullScreenAd() < NATURAL_BREAK.MIN_GAP_MS) return false;
    if (this.isShowing || isFullScreenAdVisible()) return false;

    this._dropIfExpired();
    if (!this.isLoaded || !this.ad) {
      // Not ready: warm one for the next break rather than stall this one.
      this.prepare();
      return false;
    }

    this.naturalBreakShows += 1;
    this._show(() => {});
    return true;
  }

  static _show(onAdClosedCallback) {
    // ✅ Mark as not loaded BEFORE showing to prevent double-show. This stays
    // synchronous even though the present itself may be deferred below, so a
    // second trigger inside that gap cannot show the same ad twice.
    this.isLoaded = false;

    // ✅ Never present while a modal is mid-transition. On iOS the ad is
    // presented from the topmost view controller, and UIKit refuses to
    // present from a controller that is itself animating — the ad silently
    // fails while we have already consumed it. Synchronous when nothing is
    // animating, so the common path is unchanged.
    // Pin the instance: cleanup() / forceReload() can swap or drop it inside
    // the deferral gap, and listeners must never be attached to a stale ad.
    const ad = this.ad;
    whenModalSettled(() => this._present(ad, onAdClosedCallback));
  }

  static _present(ad, onAdClosedCallback) {
    if (!ad || ad !== this.ad) {
      // The ad we reserved is gone. Nothing was shown, so hand control back
      // to the caller rather than leaving its content blocked.
      this._load();
      if (typeof onAdClosedCallback === 'function') {
        onAdClosedCallback();
      }
      return;
    }

    this.isShowing = true;
    this.lastShownAt = Date.now();
    setFullScreenAdVisible(true);

    let settled = false;
    let watchdog = null;
    let unsubscribeOpened = null;
    let unsubscribeClosed = null;

    const cleanup = () => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
      try { if (unsubscribeOpened) unsubscribeOpened(); } catch (_) {}
      try { if (unsubscribeClosed) unsubscribeClosed(); } catch (_) {}
    };

    const finish = (didShow) => {
      if (settled) return;
      settled = true;
      cleanup();
      setFullScreenAdVisible(false);
      this.isShowing = false;
      if (!didShow) {
        // Nothing reached the screen, so nothing was consumed: don't burn the
        // 30s frequency cap on an impression the user never saw.
        this.lastShownAt = 0;
      }
      // Preload the next one: the user just proved they hit ad triggers,
      // so a warm follow-up is justified (unlike blind preloading) — but
      // only once the AdMob cap window has passed (see POST_SHOW_RELOAD_MS).
      if (didShow) setTimeout(() => this._load(), POST_SHOW_RELOAD_MS);
      else this._load();

      if (typeof onAdClosedCallback === 'function') {
        onAdClosedCallback();
      }
    };

    // OPENED confirms the ad actually reached the screen; from there CLOSED is
    // the real completion signal, so stand the watchdog down. It is also the
    // moment the other formats start their cross-format gap from.
    unsubscribeOpened = ad.addAdEventListener(AdEventType.OPENED, () => {
      markFullScreenAdShown('interstitial');
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    });

    unsubscribeClosed = ad.addAdEventListener(AdEventType.CLOSED, () => finish(true));

    // A presentation UIKit refuses fires neither OPENED nor CLOSED. Before
    // this watchdog that meant the caller's callback never ran at all — the
    // user's submit or search silently did nothing — and the loaded ad was
    // thrown away. Recover both.
    watchdog = setTimeout(() => {
      watchdog = null;
      finish(false);
    }, this.SHOW_WATCHDOG_MS);

    try {
      // show() returns a promise; a refused present rejects it rather than
      // throwing, and an unhandled rejection would otherwise leave the
      // watchdog to notice 5s later.
      const shown = ad.show();
      if (shown && typeof shown.catch === 'function') {
        shown.catch(() => finish(false));
      }
    } catch (error) {
      finish(false);
    }
  }

  // ✅ Check if the ad is available
  static isReady() {
    return this.isLoaded;
  }

  // ✅ Force reload (useful after network recovery)
  static forceReload() {
    this.retryCount = 0;
    this.noFillRetried = false;
    this.lastNoFillAt = 0;
    if (this.ad) this._load();
    else if (this.hasInitialized && !isProUser()) this._createAndLoad();
  }

  static cleanup() {
    this.unsubscribeEvents.forEach((unsubscribe) => {
      try { unsubscribe(); } catch (_) {}
    });
    this.unsubscribeEvents = [];
    this.hasInitialized = false;
    this.isLoaded = false;
    this.isLoading = false;
    this.isShowing = false;
    this.ad = null;
  }
}

export default InterstitialAdManager;
