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

const adUnitId = getAdUnitId('rewarded');

class RewardedAdManager {
  static ad = null;
  static isLoaded = false;
  static isLoading = false;
  static hasInitialized = false;
  static retryCount = 0;
  static maxRetries = 5;
  static unsubscribeEvents = [];

  // Cooldown to prevent ad spam (minimum 30s between ads)
  static lastShownAt = 0;
  static COOLDOWN_MS = 30000;

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

    this.ad = RewardedAd.createForAdRequest(adUnitId, {
      keywords: ['games', 'pets', 'kids'],
    });

    const onLoaded = this.ad.addAdEventListener(
      RewardedAdEventType.LOADED,
      () => {
        this.isLoaded = true;
        this.isLoading = false;
        this.retryCount = 0;
      },
    );

    const onError = this.ad.addAdEventListener(
      AdEventType.ERROR,
      () => {
        this.isLoaded = false;
        this.isLoading = false;
        this._retryLoad();
      },
    );

    this.unsubscribeEvents = [onLoaded, onError];
    this._load();
  }

  // ── Safe load (prevents duplicate loads) ──
  static _load() {
    if (this.isLoaded || this.isLoading || !this.ad) return;
    this.isLoading = true;
    try {
      this.ad.load();
    } catch {
      this.isLoading = false;
      this._retryLoad();
    }
  }

  // ── Retry with exponential backoff (1s, 2s, 4s, 8s, 16s), then STOP ──
  // The old 15s-forever loop kept filling rewarded ads in the background that
  // no one would ever tap to see (fills with ~1% show rate are worse than no
  // fills — they depress bids and invite ad-serving limits). Loading resumes
  // on the next user signal: prepare() from a rewarded-surface mount, or a
  // show attempt.
  static _retryLoad() {
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

    this.isLoaded = false;
    this.lastShownAt = Date.now();
    let didEarnReward = false;

    // Listen for EARNED_REWARD (user completed the action)
    const unsubReward = this.ad.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      () => {
        didEarnReward = true;
      },
    );

    // Listen for CLOSED (ad dismissed)
    const unsubClose = this.ad.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        unsubReward();
        unsubClose();

        // Create new ad instance for next show (ads can only be shown once)
        this._createAndLoad();

        if (didEarnReward) {
          if (typeof onRewardEarned === 'function') onRewardEarned();
        } else {
          if (typeof onAdClosed === 'function') onAdClosed();
        }
      },
    );

    try {
      this.ad.show();
    } catch {
      unsubReward();
      unsubClose();
      this._createAndLoad();
      if (typeof onAdClosed === 'function') onAdClosed();
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
