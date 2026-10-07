import { Keyboard } from 'react-native';
/**
 * RewardedAdManager.js
 * Singleton manager for rewarded ads.
 * Pattern mirrors IntAd.js (proven in production) but for rewarded format.
 *
 * Usage:
 *   import RewardedAdManager from './RewardedAdManager';
 *
 *   // Init once at app start (done in index.js or App.js)
 *   RewardedAdManager.init();
 *
 *   // Show ad (returns promise — resolves true if reward earned, false otherwise)
 *   const earned = await RewardedAdManager.show();
 *   if (earned) { grantReward(); }
 *
 *   // Or callback style:
 *   RewardedAdManager.showWithCallback(
 *     () => { // onRewardEarned — user watched full ad },
 *     () => { // onAdClosed — user closed without earning reward },
 *     () => { // onAdUnavailable — no ad to show },
 *   );
 */
import {
  RewardedAd,
  RewardedAdEventType,
  AdEventType,
} from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';
import { ensureAdsInitialized, adsInitialized } from './init';
import { setFullScreenAdVisible, markFullScreenAdShown, whenModalSettled } from './adVisibility';
import { NO_FILL_RETRY_MS, isNoFillError } from './adPolicy';

const adUnitId = getAdUnitId('rewarded');

class RewardedAdManager {
  static ad = null;
  static isLoaded = false;
  static isLoading = false;
  static hasInitialized = false;
  static retryCount = 0;
  static maxRetries = 3;
  static noFillRetried = false;
  static unsubscribeEvents = [];

  // Cooldown to prevent ad spam (minimum 30s between ads)
  static lastShownAt = 0;
  static COOLDOWN_MS = 30000;

  // How long to wait for OPENED before treating the presentation as failed.
  // A present UIKit refuses fires neither OPENED nor CLOSED; before this
  // watchdog that left the shared full-screen flag stuck true, which silently
  // blocked every interstitial and app-open ad for the rest of the session.
  static SHOW_WATCHDOG_MS = 5000;

  // Wait timeout when no ad is preloaded (try to load one on-the-fly).
  // Was 5s — rewarded creatives (video) routinely take longer than that to
  // load cold, so the user's FIRST tap nearly always ended in "unavailable"
  // and taught them the button is broken (AdMob showed 50% fill but 1.4%
  // show). 12s behind the caller's own spinner gives a cold load a real
  // chance; screens that call prepare() on mount won't hit the wait at all.
  static WAIT_TIMEOUT_MS = 12000;

  // ── Init (call once at app start) ──
  static init() {
    if (this.hasInitialized) return;
    this._createAndLoad();
    this.hasInitialized = true;
  }

  // ── Create ad instance and wire up events ──
  static _createAndLoad() {
    // Clean up previous instance
    this._cleanup();

    // 'pets' was an Adopt Me leftover; 'kids' contradicts our 'T' content
    // rating + tagForChildDirectedTreatment:false and pulls lower-value /
    // policy-sensitive inventory.
    this.ad = RewardedAd.createForAdRequest(adUnitId, {
      keywords: ['games', 'roblox'],
    });

    const onLoaded = this.ad.addAdEventListener(
      RewardedAdEventType.LOADED,
      () => {
        this.isLoaded = true;
        this.isLoading = false;
        this.retryCount = 0;
        this.noFillRetried = false;
      },
    );

    const onError = this.ad.addAdEventListener(
      AdEventType.ERROR,
      (error) => {
        this.isLoaded = false;
        this.isLoading = false;
        this._retryLoad(isNoFillError(error));
      },
    );

    this.unsubscribeEvents = [onLoaded, onError];
    // Config-before-load: don't request until the request config is applied.
    ensureAdsInitialized().then(() => this._load()).catch(() => {});
  }

  // ── Safe load (prevents duplicate loads) ──
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
    } catch {
      this.isLoading = false;
      this._retryLoad();
    }
  }

  // ── Retry with exponential backoff (1s, 2s, 4s), then STOP ──
  // The old 15s-forever loop kept filling rewarded ads in the background that
  // no one would ever tap to see (fills with ~1% show rate are worse than no
  // fills — they depress bids and invite ad-serving limits). Loading resumes
  // on the next user signal: prepare() from a rewarded-surface mount, or a
  // show attempt. "No fill" is not transient, so it gets a single retry a
  // minute later instead of the backoff (see adPolicy.js).
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

  // ── Proximity preload: call from screens that render a rewarded button ──
  // (GameScreen, MysteryEgg, reward centers) so the ad is warm BEFORE the
  // user taps. Idempotent; also un-sticks a manager whose bounded retries
  // ran out.
  static prepare() {
    if (!this.hasInitialized) {
      this.init();
      return;
    }
    if (this.isLoaded || this.isLoading) return;
    this.retryCount = 0;
    if (this.ad) this._load();
    else this._createAndLoad();
  }

  // ══════════════════════════════════════════════
  //  PUBLIC API: Promise-based show
  // ══════════════════════════════════════════════
  /**
   * Show a rewarded ad.
   * @returns {Promise<boolean>} true if user earned reward, false if closed early or unavailable.
   */
  static show() {
    return new Promise((resolve) => {
      this.showWithCallback(
        () => resolve(true),   // earned
        () => resolve(false),  // closed without reward
        () => resolve(false),  // unavailable
      );
    });
  }

  // ══════════════════════════════════════════════
  //  PUBLIC API: Callback-based show
  // ══════════════════════════════════════════════
  /**
   * @param {Function} onRewardEarned - Called when user completes the ad and earns the reward.
   * @param {Function} onAdClosed - Called when ad is closed without earning reward.
   * @param {Function} onAdUnavailable - Called when no ad is available after waiting.
   */
  static showWithCallback(onRewardEarned, onAdClosed, onAdUnavailable) {
    if (!this.hasInitialized) this.init();

    // Cooldown check
    const now = Date.now();
    if (now - this.lastShownAt < this.COOLDOWN_MS) {
      if (typeof onAdUnavailable === 'function') onAdUnavailable();
      return;
    }

    if (this.isLoaded) {
      this._showAd(onRewardEarned, onAdClosed);
    } else {
      // Wait for ad to load (up to WAIT_TIMEOUT_MS)
      this._waitAndShow(onRewardEarned, onAdClosed, onAdUnavailable);
    }
  }

  // ── Internal: show the loaded ad ──
  static _showAd(onRewardEarned, onAdClosed) {
    if (!this.ad || !this.isLoaded) {
      if (typeof onAdClosed === 'function') onAdClosed();
      return;
    }

    // Reserve synchronously: the present below may be deferred, and a second
    // trigger in that gap must not show the same ad twice.
    this.isLoaded = false;

    // Never present while a modal is mid-transition — on iOS the ad is
    // presented from the topmost view controller, and UIKit refuses to
    // present from one that is itself animating. Synchronous when nothing is
    // animating, so the common path is unchanged.
    // Pin the instance: _createAndLoad() replaces this.ad outright, and a
    // deferred present must never attach listeners to a stale ad.
    const ad = this.ad;
    whenModalSettled(() => this._presentAd(ad, onRewardEarned, onAdClosed));
  }

  static _presentAd(ad, onRewardEarned, onAdClosed) {
    if (!ad || ad !== this.ad) {
      // The ad we reserved is gone. Nothing was shown, so no reward.
      this._createAndLoad();
      if (typeof onAdClosed === 'function') onAdClosed();
      return;
    }

    this.lastShownAt = Date.now();
    setFullScreenAdVisible(true);

    let didEarnReward = false;
    let settled = false;
    let watchdog = null;
    let unsubReward = null;
    let unsubOpened = null;
    let unsubClose = null;

    const finish = (didShow) => {
      if (settled) return;
      settled = true;
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
      try { if (unsubReward) unsubReward(); } catch (_) {}
      try { if (unsubOpened) unsubOpened(); } catch (_) {}
      try { if (unsubClose) unsubClose(); } catch (_) {}
      setFullScreenAdVisible(false);
      if (!didShow) {
        // Nothing reached the screen, so nothing was consumed: don't burn the
        // cooldown on an impression the user never saw.
        this.lastShownAt = 0;
      }

      // Create new ad instance for next show (ads can only be shown once)
      this._createAndLoad();

      // A reward is only ever granted off a real EARNED_REWARD event, so a
      // failed presentation can never pay out.
      if (didShow && didEarnReward) {
        if (typeof onRewardEarned === 'function') onRewardEarned();
      } else {
        if (typeof onAdClosed === 'function') onAdClosed();
      }
    };

    // Listen for EARNED_REWARD (user completed the action)
    unsubReward = ad.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      () => {
        didEarnReward = true;
      },
    );

    // OPENED confirms the ad actually reached the screen; CLOSED is then the
    // real completion signal, so stand the watchdog down. It is also the
    // moment the other formats start their cross-format gap from.
    unsubOpened = ad.addAdEventListener(AdEventType.OPENED, () => {
      markFullScreenAdShown('rewarded');
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    });

    // Listen for CLOSED (ad dismissed)
    unsubClose = ad.addAdEventListener(AdEventType.CLOSED, () => finish(true));

    // A presentation UIKit refuses fires neither OPENED nor CLOSED. Before
    // this watchdog that left the caller waiting forever — the rewarded flow
    // simply never resolved — and threw the loaded ad away.
    watchdog = setTimeout(() => {
      watchdog = null;
      finish(false);
    }, this.SHOW_WATCHDOG_MS);

    try {
      // Drop keyboard focus first: a focused TextInput that list clipping
      // detaches while the ad covers the app crashed ScrollView.onSizeChanged
      // on return ("parameter must be a descendant of this view").
      Keyboard.dismiss();
      const shown = ad.show();
      if (shown && typeof shown.catch === 'function') {
        shown.catch(() => finish(false));
      }
    } catch {
      finish(false);
    }
  }

  // ── Internal: wait for ad to load then show ──
  static _waitAndShow(onRewardEarned, onAdClosed, onAdUnavailable) {
    const startTime = Date.now();
    this._load(); // trigger a load

    const checkInterval = setInterval(() => {
      if (this.isLoaded) {
        clearInterval(checkInterval);
        this._showAd(onRewardEarned, onAdClosed);
        return;
      }
      if (Date.now() - startTime >= this.WAIT_TIMEOUT_MS) {
        clearInterval(checkInterval);
        if (typeof onAdUnavailable === 'function') onAdUnavailable();
      }
    }, 100);
  }

  // ── Check if ad is ready right now ──
  static isReady() {
    return this.isLoaded;
  }

  // ── Check if cooldown has passed ──
  static canShow() {
    return Date.now() - this.lastShownAt >= this.COOLDOWN_MS;
  }

  // ── Force reload ──
  static forceReload() {
    this._createAndLoad();
  }

  // ── Cleanup ──
  static _cleanup() {
    this.unsubscribeEvents.forEach(unsub => {
      try { unsub(); } catch {}
    });
    this.unsubscribeEvents = [];
    this.isLoaded = false;
    this.isLoading = false;
  }

  static destroy() {
    this._cleanup();
    this.hasInitialized = false;
    this.ad = null;
  }
}

export default RewardedAdManager;
