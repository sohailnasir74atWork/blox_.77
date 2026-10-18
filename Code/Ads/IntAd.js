import { Keyboard } from 'react-native';
// InterstitialAdManager — WHEN an interstitial may show (Pro gate, cooldowns,
// cross-format gap, natural-break caps). WHERE the ad comes from — Google's
// preloader on Android Next-Gen, one warm instance elsewhere — is
// fullscreenSource.js (react-native-google-mobile-ads 17.x, 2026-10-12).
import { AdEventType } from 'react-native-google-mobile-ads';
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
  POST_SHOW_RELOAD_MS,
  INTERSTITIAL_COOLDOWN_MS,
} from './adPolicy';
import { createFullscreenSource, takeWithin, safeDestroy } from './fullscreenSource';
import { adLog, logAdRevenue } from './adTelemetry';

const interstitialAdUnitId = getAdUnitId('interstitial');
const source = createFullscreenSource('interstitial', interstitialAdUnitId);

// Module load ≈ JS start; App.js imports this at the top. Used for the
// natural-break warm-up window.
const APP_START_AT = Date.now();

// isPro / proGranted read straight from MMKV (same pattern as openApp.js).
// `isPro` is the RevenueCat entitlement (LocalGlobelStats); `proGranted` is
// the RTDB-purchase Pro membership that GlobelStats.js computes and mirrors
// into MMKV for these singletons — before that mirror, Pro-granted users
// still got interstitials and app-open ads. Pro users are never shown an
// interstitial, so none is preloaded for them either (AdMob show rate for
// this unit was 3-5% when everyone preloaded).
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
const noAdsForUser = () => isProUser();

const run = (fn) => { if (typeof fn === 'function') fn(); };

class InterstitialAdManager {
  static hasInitialized = false;

  // Guards against two concurrent showAd() calls both presenting in the same
  // tick (~13 independent call sites can fire at once on a cold start). Set
  // from the moment a show is decided, through any wait for a fill.
  static isShowing = false;

  // ✅ Wait timeout for ad to load (improves show rate)
  static WAIT_TIMEOUT_MS = 3000;

  // ✅ Global frequency cap. There are ~13 interstitial call sites across the
  // app firing independently (chat send, search, upload, post, save, share,
  // daily rewards, log trade…). Without a shared cooldown, two quick actions
  // serve two back-to-back interstitials — ad fatigue, lower eCPM, and AdMob
  // ad-serving-limit risk. Inside the cooldown we skip the ad and run the
  // caller's callback immediately so content is never blocked.
  static lastShownAt = 0;
  static COOLDOWN_MS = INTERSTITIAL_COOLDOWN_MS;

  // ✅ How long to wait for OPENED before treating the presentation as failed.
  static SHOW_WATCHDOG_MS = 5000;

  // Natural-break placement bookkeeping (see showAtNaturalBreak).
  static naturalBreakShows = 0;

  static init() {
    if (this.hasInitialized) return;
    this.hasInitialized = true;
    // Pro users never see interstitials — skip the warm load entirely. If the
    // user loses Pro later, the first showAd()/prepare() warms one lazily.
    if (noAdsForUser()) return;
    // Config-before-load: the source waits for the shared AdMob init
    // (consent → setRequestConfiguration → initialize) before any request.
    // Re-checked after the wait: Pro may have arrived in the meantime.
    ensureAdsInitialized()
      .then(() => { if (this.hasInitialized && !noAdsForUser()) source.prepare(); })
      .catch(() => {});
  }

  // ✅ Proximity preload: call when a show is likely soon. Idempotent and
  // cheap. Also re-arms a source whose bounded retries ran out — except
  // straight after a no-fill, where asking again only repeats the answer.
  static prepare() {
    if (!this.hasInitialized) {
      this.init();
      return;
    }
    if (noAdsForUser()) return;
    source.prepare(true);
  }

  // Another full-screen format is on screen or was a moment ago.
  static _blockedByOtherFormat() {
    return isFullScreenAdVisible() ||
      msSinceOtherFullScreenAd('interstitial') < CROSS_FORMAT_GAP_MS;
  }

  // ✅ Show ad. Same contract as before: the caller's callback always runs,
  // and content is never gated on ad availability. `placement` only labels
  // the revenue event.
  static showAd(onAdClosedCallback, onAdUnavailableCallback, placement = 'action') {
    // ✅ Pro gate, here rather than trusting callers: most call sites only
    // check localState.isPro, so RTDB-purchase Pro members (proGranted) got
    // through and sat out the full wait before their action ran.
    if (noAdsForUser()) {
      run(onAdClosedCallback);
      return;
    }
    if (!this.hasInitialized) this.init();

    // ✅ Another show is in flight (or waiting for a fill) — never double-show.
    if (this.isShowing) {
      run(onAdClosedCallback);
      return;
    }

    // ✅ Global frequency cap, and never right after an app-open or rewarded.
    if (Date.now() - this.lastShownAt < Math.max(this.COOLDOWN_MS, POST_SHOW_RELOAD_MS) ||
        this._blockedByOtherFormat()) {
      run(onAdClosedCallback);
      return;
    }

    const unavailable = () => run(onAdUnavailableCallback || onAdClosedCallback);

    // Nothing warm, and the auction said "no fill" within the last minute: a
    // wait would hold the user's action and then give up anyway.
    if (!source.isReady() && source.recentNoFill()) {
      unavailable();
      return;
    }

    // Ready now, or wait up to WAIT_TIMEOUT_MS for one — that converts
    // near-miss triggers into shows instead of instantly giving up.
    this.isShowing = true;
    // Two-argument then: a callback that throws must not run a second time
    // through a catch handler.
    takeWithin(source, this.WAIT_TIMEOUT_MS).then((ad) => {
      if (!ad) {
        this.isShowing = false;
        unavailable();
        return;
      }
      this._show(ad, onAdClosedCallback, placement);
    }, () => {
      this.isShowing = false;
      unavailable();
    });
  }

  /**
   * Natural-break placement: the user is moving between screens (a tab
   * switch), which is the standard interstitial moment. Unlike showAd() this
   * NEVER waits for a fill — a transition must stay instant — and it runs
   * under the stricter NATURAL_BREAK caps on top of the usual cooldown, Pro
   * gate and cross-format rules. Returns true when an ad will be presented.
   */
  static showAtNaturalBreak(placement = 'natural_break') {
    if (!NATURAL_BREAK.ENABLED) return false;
    if (!this.hasInitialized) this.init();
    if (noAdsForUser()) return false;

    const now = Date.now();
    if (now - APP_START_AT < NATURAL_BREAK.SESSION_WARMUP_MS) return false;
    if (this.naturalBreakShows >= NATURAL_BREAK.MAX_PER_SESSION) return false;
    if (now - this.lastShownAt < NATURAL_BREAK.MIN_GAP_MS) return false;
    // Android: 3 min after ANY full-screen ad. iOS: only the line above (last
    // interstitial) plus the cross-format gap after an app-open/rewarded.
    if (NATURAL_BREAK.GAP_FROM_ANY_FULLSCREEN
      ? msSinceAnyFullScreenAd() < NATURAL_BREAK.MIN_GAP_MS
      : this._blockedByOtherFormat()) return false;
    if (this.isShowing || isFullScreenAdVisible()) return false;

    if (!source.isReady()) {
      // Not ready: warm one for the next break rather than stall this one.
      source.prepare(true);
      return false;
    }

    this.isShowing = true;
    this.naturalBreakShows += 1;
    source.take().then((ad) => {
      if (!ad) {
        this.isShowing = false;
        this.naturalBreakShows -= 1;
        return;
      }
      this._show(ad, () => {}, placement);
    }, () => { this.isShowing = false; });
    return true;
  }

  static _show(ad, onAdClosedCallback, placement) {
    // ✅ Never present while a modal is mid-transition. On iOS the ad is
    // presented from the topmost view controller, and UIKit refuses to
    // present from a controller that is itself animating. Synchronous when
    // nothing is animating, so the common path is unchanged.
    whenModalSettled(() => this._present(ad, onAdClosedCallback, placement));
  }

  static _present(ad, onAdClosedCallback, placement) {
    this.isShowing = true;
    this.lastShownAt = Date.now();
    setFullScreenAdVisible(true);

    let settled = false;
    let watchdog = null;
    const unsubs = [];

    const finish = (didShow, why) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearTimeout(watchdog);
      unsubs.forEach((u) => { try { u(); } catch (_) {} });
      setFullScreenAdVisible(false);
      this.isShowing = false;
      // An ad is shown once; 17.x frees it with destroy(). Not after the
      // watchdog, though: on a slow device the ad may still be opening, and
      // destroying it then would pull it out from under the user.
      if (why !== 'watchdog') safeDestroy(ad);
      adLog(`interstitial ${didShow ? 'closed' : `failed ${why || ''}`}`);
      if (!didShow) {
        // Nothing reached the screen, so nothing was consumed: don't burn the
        // cooldown on an impression the user never saw.
        this.lastShownAt = 0;
        source.prepare();
      } else {
        // The user just proved they hit ad triggers, so a warm follow-up is
        // justified — once the AdMob 1-per-minute cap window has passed
        // (POST_SHOW_RELOAD_MS). On the Next-Gen preloader the buffer refills
        // by itself and this is a no-op.
        setTimeout(() => { if (!noAdsForUser()) source.prepare(); }, POST_SHOW_RELOAD_MS);
      }
      run(onAdClosedCallback);
    };

    // OPENED confirms the ad actually reached the screen; from there CLOSED is
    // the real completion signal, so stand the watchdog down. It is also the
    // moment the other formats start their cross-format gap from.
    unsubs.push(ad.addAdEventListener(AdEventType.OPENED, () => {
      markFullScreenAdShown('interstitial');
      adLog(`interstitial opened ${placement}`);
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    }));
    unsubs.push(ad.addAdEventListener(AdEventType.CLOSED, () => finish(true)));
    // 17.x: Android now reports a refused present as ERROR (phase 'show').
    unsubs.push(ad.addAdEventListener(AdEventType.ERROR, (e) => finish(false, e?.reason)));
    unsubs.push(ad.addAdEventListener(AdEventType.PAID, (paid) =>
      logAdRevenue('interstitial', placement, paid, interstitialAdUnitId)));

    // A presentation UIKit refuses fires neither OPENED nor CLOSED. Before
    // this watchdog that meant the caller's callback never ran at all.
    watchdog = setTimeout(() => {
      watchdog = null;
      finish(false, 'watchdog');
    }, this.SHOW_WATCHDOG_MS);

    try {
      // Drop keyboard focus first: a focused TextInput that list clipping
      // detaches while the ad covers the app crashed ScrollView.onSizeChanged
      // on return ("parameter must be a descendant of this view").
      Keyboard.dismiss();
      // 17.2: "already showing" and a refused present REJECT the promise.
      Promise.resolve(ad.show()).catch((e) => finish(false, e?.reason || 'show-rejected'));
    } catch (error) {
      finish(false, 'show-threw');
    }
  }

  // ✅ Check if the ad is available
  static isReady() {
    return source.isReady();
  }

  // ✅ Force reload (useful after network recovery)
  static forceReload() {
    if (noAdsForUser()) return;
    source.prepare(true);
  }

  // The Pro gate, shared with PostAd.js (the post placements).
  static isAdFree() {
    return noAdsForUser();
  }

  // Pro bought / ads turned off: drop the warm ad and its timers.
  static cleanup() {
    source.reset('cleanup');
    // The post placements keep their own warm ads (lazy require: PostAd.js
    // imports this module).
    try { require('./PostAd').default.cleanup(); } catch (_) {}
    this.hasInitialized = false;
    this.isShowing = false;
  }
}

export default InterstitialAdManager;
