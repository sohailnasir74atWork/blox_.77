import { Keyboard } from 'react-native';
/**
 * RewardedAdManager.js
 * WHEN a rewarded ad may show (cooldown, one at a time) and how the reward is
 * granted. WHERE the ad comes from — Google's preloader on Android Next-Gen,
 * one warm instance elsewhere — is fullscreenSource.js (17.x, 2026-10-12).
 *
 * Usage:
 *   RewardedAdManager.prepare();            // on mount of a screen with a "Watch ad" button
 *   const earned = await RewardedAdManager.show();
 *   RewardedAdManager.showWithCallback(onRewardEarned, onAdClosed, onAdUnavailable);
 *   const r = await RewardedAdManager.showForResult(); // 'earned' | 'closed' | 'unavailable'
 */
import { RewardedAdEventType, AdEventType } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';
import { setFullScreenAdVisible, markFullScreenAdShown, whenModalSettled } from './adVisibility';
import { createFullscreenSource, takeWithin, safeDestroy } from './fullscreenSource';
import { adLog, logAdRevenue } from './adTelemetry';

const adUnitId = getAdUnitId('rewarded');
// 'pets' was an Adopt Me leftover; 'kids' contradicts our 'T' content rating
// and pulls lower-value / policy-sensitive inventory.
const source = createFullscreenSource('rewarded', adUnitId, { keywords: ['games', 'roblox'] });

const run = (fn) => { if (typeof fn === 'function') fn(); };

class RewardedAdManager {
  static hasInitialized = false;
  static isShowing = false;

  // Cooldown to prevent ad spam (minimum 30s between ads)
  static lastShownAt = 0;
  static COOLDOWN_MS = 30000;

  // How long to wait for OPENED before treating the presentation as failed.
  // A present UIKit refuses fires neither OPENED nor CLOSED; before this
  // watchdog that left the shared full-screen flag stuck true, which silently
  // blocked every interstitial and app-open ad for the rest of the session.
  static SHOW_WATCHDOG_MS = 5000;

  // Wait timeout when no ad is preloaded. Rewarded creatives (video) routinely
  // take longer than 5 s to load cold, so a short wait taught users the button
  // is broken (AdMob: 50% fill but 1.4% show). Screens that call prepare() on
  // mount rarely hit the wait at all.
  static WAIT_TIMEOUT_MS = 12000;

  // iOS can deliver EARNED_REWARD just after CLOSED (fixed on the library's
  // main branch after 17.2.0). Settling this long after CLOSED still pays a
  // reward the user did earn.
  static REWARD_GRACE_MS = 400;

  static init() {
    if (this.hasInitialized) return;
    this.hasInitialized = true;
    source.prepare();
  }

  // ── Proximity preload: call from screens that render a rewarded button ──
  // (GameScreen, MysteryEgg, Trades) so the ad is warm BEFORE the user taps.
  static prepare() {
    if (!this.hasInitialized) {
      this.init();
      return;
    }
    source.prepare(true);
  }

  /** @returns {Promise<boolean>} true if the user earned the reward. */
  static show() {
    return new Promise((resolve) => {
      this.showWithCallback(() => resolve(true), () => resolve(false), () => resolve(false));
    });
  }

  /** @returns {Promise<'earned'|'closed'|'unavailable'>} */
  static showForResult() {
    return new Promise((resolve) => {
      this.showWithCallback(
        () => resolve('earned'),
        () => resolve('closed'),
        () => resolve('unavailable'),
      );
    });
  }

  /**
   * @param {Function} onRewardEarned - the user completed the ad and earned the reward.
   * @param {Function} onAdClosed - the ad was shown and closed without earning it.
   * @param {Function} onAdUnavailable - no ad could be shown (none filled, cooldown, a failed present).
   * @param {string} placement - labels the revenue event.
   */
  static showWithCallback(onRewardEarned, onAdClosed, onAdUnavailable, placement = 'reward') {
    if (!this.hasInitialized) this.init();
    const unavailable = () => run(onAdUnavailable || onAdClosed);

    if (this.isShowing ||
        Date.now() - this.lastShownAt < this.COOLDOWN_MS) {
      unavailable();
      return;
    }

    this.isShowing = true;
    // The user asked for this ad: a fresh request goes out even right after
    // a no-fill (force). Two-argument then: a throwing callback must not run
    // twice through a catch handler.
    takeWithin(source, this.WAIT_TIMEOUT_MS, { force: true }).then((ad) => {
      if (!ad) {
        this.isShowing = false;
        unavailable();
        return;
      }
      // Never present while a modal is mid-transition — on iOS the ad is
      // presented from the topmost view controller, and UIKit refuses to
      // present from one that is itself animating.
      whenModalSettled(() => this._present(ad, onRewardEarned, onAdClosed, unavailable, placement));
    }, () => {
      this.isShowing = false;
      unavailable();
    });
  }

  static _present(ad, onRewardEarned, onAdClosed, onUnavailable, placement) {
    this.lastShownAt = Date.now();
    setFullScreenAdVisible(true);

    let didEarnReward = false;
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
      // Not after the watchdog: on a slow device the ad may still be opening.
      if (why !== 'watchdog') safeDestroy(ad);
      adLog(`rewarded ${didShow ? (didEarnReward ? 'earned' : 'closed') : `failed ${why || ''}`}`);
      if (!didShow) {
        // Nothing reached the screen, so nothing was consumed: don't burn the
        // cooldown on an impression the user never saw.
        this.lastShownAt = 0;
      }
      // Warm the next one: rewarded users often watch again (games, spins).
      source.prepare();

      // A reward is only ever granted off a real EARNED_REWARD event, so a
      // failed presentation can never pay out — and is reported as
      // "unavailable", not as the user closing it early.
      if (didShow && didEarnReward) run(onRewardEarned);
      else if (didShow) run(onAdClosed);
      else run(onUnavailable);
    };

    unsubs.push(ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
      didEarnReward = true;
    }));
    // OPENED confirms the ad actually reached the screen; CLOSED is then the
    // real completion signal, so stand the watchdog down. It is also the
    // moment the other formats start their cross-format gap from.
    unsubs.push(ad.addAdEventListener(AdEventType.OPENED, () => {
      markFullScreenAdShown('rewarded');
      adLog(`rewarded opened ${placement}`);
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    }));
    unsubs.push(ad.addAdEventListener(AdEventType.CLOSED, () => {
      setTimeout(() => finish(true), this.REWARD_GRACE_MS);
    }));
    // 17.x: Android reports a refused present as ERROR (phase 'show').
    unsubs.push(ad.addAdEventListener(AdEventType.ERROR, (e) => finish(false, e?.reason)));
    unsubs.push(ad.addAdEventListener(AdEventType.PAID, (paid) =>
      logAdRevenue('rewarded', placement, paid, adUnitId)));

    // A presentation UIKit refuses fires neither OPENED nor CLOSED. Before
    // this watchdog the rewarded flow simply never resolved.
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
    } catch {
      finish(false, 'show-threw');
    }
  }

  static isReady() {
    return source.isReady();
  }

  static canShow() {
    return Date.now() - this.lastShownAt >= this.COOLDOWN_MS;
  }

  static forceReload() {
    source.prepare(true);
  }

  static destroy() {
    source.reset('destroy');
    this.hasInitialized = false;
    this.isShowing = false;
  }
}

export default RewardedAdManager;
