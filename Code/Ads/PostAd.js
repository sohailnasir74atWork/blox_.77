// PostAdManager — the two "you just posted" interstitials: one after a trade
// is posted, one after a feed post (design post or status). Owner decision,
// 2026-10-13: these always show for non-Pro users and sit OUTSIDE the
// interstitial policy in adPolicy.js — no cooldown, no per-session cap, no
// cross-format gap. Each placement has its own AdMob unit, so AdMob reports
// them apart, and no AdMob frequency cap is set on those units.
//
// What still applies, and why:
// - Pro users never see them, and none is preloaded for them.
// - Never on top of another full-screen ad that is on screen right now.
// - The ad shows AFTER the post succeeded, never before or on failure: the
//   caller invokes show() from its success path.
// - "Post ad wins" over the other placements: a post ad counts as the last
//   full-screen ad (markFullScreenAdShown), which pushes the next tab-switch
//   ad back by NATURAL_BREAK.MIN_GAP_MS and keeps app-open and the action
//   interstitials CROSS_FORMAT_GAP_MS away, so two ads never stack.
//
// Each placement keeps its own warm ad (fullscreenSource.js), loaded when the
// composer opens (prepare), so it is normally ready the moment the post lands.
import { Keyboard } from 'react-native';
import { AdEventType } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';
import { ensureAdsInitialized } from './init';
import {
  setFullScreenAdVisible,
  isFullScreenAdVisible,
  whenModalSettled,
  markFullScreenAdShown,
} from './adVisibility';
import { createFullscreenSource, takeWithin, safeDestroy } from './fullscreenSource';
import { adLog, logAdRevenue } from './adTelemetry';
import InterstitialAdManager from './IntAd';

const PLACEMENTS = {
  trade: { key: 'trade_post', unitType: 'tradePost' },
  feed: { key: 'feed_post', unitType: 'feedPost' },
};

const sources = {};
const sourceFor = (kind) => {
  const p = PLACEMENTS[kind];
  if (!p) return null;
  if (!sources[kind]) {
    sources[kind] = createFullscreenSource('interstitial', getAdUnitId(p.unitType), undefined, p.key);
  }
  return sources[kind];
};

const run = (fn) => { if (typeof fn === 'function') fn(); };

class PostAdManager {
  // One post ad at a time; a double-tapped submit must not present twice.
  static isShowing = false;

  // How long show() waits for a fill that is still on its way. The post is
  // already saved, so this only delays the success toast, never the post.
  static WAIT_TIMEOUT_MS = 3000;

  static SHOW_WATCHDOG_MS = 5000;

  // Call when the user opens the trade / post composer.
  static prepare(kind) {
    if (InterstitialAdManager.isAdFree()) return;
    const source = sourceFor(kind);
    if (!source) return;
    ensureAdsInitialized()
      .then(() => { if (!InterstitialAdManager.isAdFree()) source.prepare(true); })
      .catch(() => {});
  }

  // Call from the post's success path. `onDone` always runs exactly once:
  // after the ad closes, or at once when no ad is shown.
  static show(kind, onDone) {
    const source = sourceFor(kind);
    if (!source || InterstitialAdManager.isAdFree()) {
      run(onDone);
      return;
    }
    if (this.isShowing || isFullScreenAdVisible() || InterstitialAdManager.isShowing) {
      run(onDone);
      return;
    }
    this.isShowing = true;
    const placement = PLACEMENTS[kind].key;
    takeWithin(source, this.WAIT_TIMEOUT_MS, { force: true }).then((ad) => {
      // Another full-screen ad may have opened during the wait.
      if (!ad || isFullScreenAdVisible() || InterstitialAdManager.isShowing) {
        if (ad) safeDestroy(ad);
        this.isShowing = false;
        adLog(`${placement} ${ad ? 'skipped other ad on screen' : 'no ad ready'}`);
        source.prepare();
        run(onDone);
        return;
      }
      whenModalSettled(() => this._present(kind, source, ad, onDone));
    }, () => {
      this.isShowing = false;
      run(onDone);
    });
  }

  static _present(kind, source, ad, onDone) {
    const placement = PLACEMENTS[kind].key;
    const unitId = getAdUnitId(PLACEMENTS[kind].unitType);
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
      if (why !== 'watchdog') safeDestroy(ad);
      adLog(`${placement} ${didShow ? 'closed' : `failed ${why || ''}`}`);
      // No AdMob cap on these units, so the next one can load right away.
      if (!InterstitialAdManager.isAdFree()) source.prepare();
      run(onDone);
    };

    unsubs.push(ad.addAdEventListener(AdEventType.OPENED, () => {
      markFullScreenAdShown(placement);
      adLog(`${placement} opened`);
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    }));
    unsubs.push(ad.addAdEventListener(AdEventType.CLOSED, () => finish(true)));
    unsubs.push(ad.addAdEventListener(AdEventType.ERROR, (e) => finish(false, e?.reason)));
    unsubs.push(ad.addAdEventListener(AdEventType.PAID, (paid) =>
      logAdRevenue('interstitial', placement, paid, unitId)));

    watchdog = setTimeout(() => {
      watchdog = null;
      finish(false, 'watchdog');
    }, this.SHOW_WATCHDOG_MS);

    try {
      Keyboard.dismiss();
      Promise.resolve(ad.show()).catch((e) => finish(false, e?.reason || 'show-rejected'));
    } catch (_) {
      finish(false, 'show-threw');
    }
  }

  // Pro bought / ads turned off: drop both warm ads.
  static cleanup() {
    Object.values(sources).forEach((s) => s.reset('cleanup'));
    this.isShowing = false;
  }
}

export default PostAdManager;
