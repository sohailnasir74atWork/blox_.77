// Where a full-screen ad comes from. The managers (IntAd.js, openApp.js,
// RewardedAdManager.js) decide WHEN an ad may show — caps, cooldowns, launch
// window, Pro — and ask a source for a ready ad at that moment. The source
// decides HOW one is kept ready:
//
//   'pool'     Android on the GMA Next-Gen SDK (app.json android_sdk
//              "nextgen"): react-native-google-mobile-ads AdPools, i.e.
//              Google's own preloader. The SDK fills the buffer, retries,
//              refills after every poll and refreshes ads before they expire,
//              so none of that is our code any more. Used only where the
//              library reports the format's preloading as 'supported'.
//   'instance' iOS and classic Android, where the library marks SDK
//              preloading 'experimental' (Google's iOS preloader is still
//              beta): one ad instance kept warm, as before 17.x.
//
// Both modes hand the caller an ad that is loaded and fresh, and ownership
// goes with it: the caller attaches its listeners, shows it and calls
// destroy() when done (or when the show fails). A shown or failed ad is never
// reloaded in place. The 16.5 managers did that, and the library ignores
// load() on an ad it still counts as loaded, which left the interstitial
// manager waiting for a load that never came for the rest of the session
// (audit B1, 2026-10-12).
//
// The 16.5-era warm/retry/expiry code from the three managers now lives here
// once, in instance mode: transient errors back off 1 s → 2 s → 4 s, a no-fill
// gets one retry after NO_FILL_RETRY_MS, and an ad past its expiry is dropped
// rather than shown.
import { Platform } from 'react-native';
import {
  AdEventType,
  AdFormat,
  AdPools,
  AppOpenAd,
  InterstitialAd,
  RewardedAd,
  RewardedAdEventType,
  getAdCapabilities,
} from 'react-native-google-mobile-ads';
import { ensureAdsInitialized, adsInitialized } from './init';
import {
  INTERSTITIAL_EXPIRY_MS,
  APP_OPEN_EXPIRY_MS,
  NO_FILL_RETRY_MS,
  USE_SDK_PRELOADER,
  isNoFillError,
} from './adPolicy';
import { adLog } from './adTelemetry';

const FORMATS = {
  interstitial: {
    adFormat: AdFormat.INTERSTITIAL,
    create: (unit, opts) => InterstitialAd.createForAdRequest(unit, opts),
    loadedEvent: AdEventType.LOADED,
    expiryMs: INTERSTITIAL_EXPIRY_MS,
  },
  app_open: {
    adFormat: AdFormat.APP_OPEN,
    create: (unit, opts) => AppOpenAd.createForAdRequest(unit, opts),
    loadedEvent: AdEventType.LOADED,
    expiryMs: APP_OPEN_EXPIRY_MS,
  },
  rewarded: {
    adFormat: AdFormat.REWARDED,
    create: (unit, opts) => RewardedAd.createForAdRequest(unit, opts),
    loadedEvent: RewardedAdEventType.LOADED,
    expiryMs: INTERSTITIAL_EXPIRY_MS,
  },
};

// Pool mode only where Google's preloader is the supported path. Read once:
// the backend is fixed at build time.
function sdkPreloadSupported(adFormat) {
  if (!USE_SDK_PRELOADER || Platform.OS !== 'android') return false;
  try {
    const caps = getAdCapabilities();
    return caps.backend === 'android-next-gen' &&
      caps.fullscreenPreloadFormats?.[adFormat] === 'supported';
  } catch (_) {
    return false;
  }
}

const safeDestroy = (ad) => {
  try { ad?.destroy?.(); } catch (_) {}
};

const sources = new Set();

class FullscreenSource {
  // `key` names the source in logs and its SDK pool; it defaults to the
  // format. Two sources of one format (the post placements in PostAd.js)
  // need distinct keys, or they would share one Google preload pool.
  constructor(format, adUnitId, requestOptions, key = format) {
    this.format = format;
    this.key = key;
    this.spec = FORMATS[format];
    this.adUnitId = adUnitId;
    this.requestOptions = requestOptions;
    this.mode = sdkPreloadSupported(this.spec.adFormat) ? 'pool' : 'instance';

    this.ready = false;
    this.loading = false;
    this.lastNoFillAt = 0;
    this.availableListeners = new Set();
    this.timers = new Set();
    // Bumped by reset(): work started before a reset (a deferred prepare, a
    // pool still being created) must not come back to life after it.
    this.epoch = 0;

    // instance mode
    this.ad = null;
    this.loadedAt = 0;
    this.unsubs = [];
    this.retryCount = 0;
    this.noFillRetried = false;

    // pool mode
    this.poolPromise = null;
    this.pool = null;
    this.poolUnsub = null;

    sources.add(this);
  }

  // ── public ──────────────────────────────────────────────────────────────

  // Make sure an ad is ready or on its way. Cheap and idempotent. `fresh`
  // (a real user signal: a rewarded screen opened, a show was asked for)
  // re-arms a retry budget that ran out — except straight after a no-fill,
  // where asking again would only repeat the empty answer.
  prepare(fresh = false, fromRetry = false) {
    if (this.mode === 'pool') {
      this._ensurePool();
      return;
    }
    if (fresh && !this.recentNoFill()) {
      this.retryCount = 0;
      this.noFillRetried = false;
    }
    if (this.ready && this._expired()) this._dropInstance('expired');
    if (this.ready || this.loading) return;
    // Straight after a no-fill, asking again only repeats the empty answer:
    // the one scheduled retry (_retry) is the only request until it passes.
    if (!fromRetry && this.recentNoFill()) return;
    if (!adsInitialized()) {
      const epoch = this.epoch;
      ensureAdsInitialized()
        .then(() => { if (epoch === this.epoch) this.prepare(false, fromRetry); })
        .catch(() => {});
      return;
    }
    this._createInstance();
  }

  // A ready ad can probably be taken right now. A hint for "wait or not"
  // decisions — take() is the authority.
  isReady() {
    if (this.mode === 'instance' && this.ready && this._expired()) return false;
    return this.ready;
  }

  recentNoFill() {
    return Date.now() - this.lastNoFillAt < NO_FILL_RETRY_MS;
  }

  // Resolves to a loaded, fresh ad owned by the caller, or null.
  async take() {
    if (this.mode === 'pool') return this._pollPool();
    if (!this.ready || !this.ad) return null;
    if (this._expired()) {
      this._dropInstance('expired');
      this.prepare();
      return null;
    }
    const ad = this.ad;
    this._unsubAll();
    this.ad = null;
    this.ready = false;
    adLog(`${this.key} take instance`);
    return ad;
  }

  // Called once each time an ad becomes ready. Returns an unsubscribe.
  onAvailable(listener) {
    this.availableListeners.add(listener);
    return () => this.availableListeners.delete(listener);
  }

  // Drop everything (Pro bought, audience changed). The next prepare() starts
  // over under the current request configuration.
  reset(reason = 'reset') {
    adLog(`${this.key} reset ${reason}`);
    this.epoch += 1;
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this._dropInstance(reason);
    if (this.poolUnsub) { try { this.poolUnsub(); } catch (_) {} this.poolUnsub = null; }
    if (this.pool) { try { this.pool.destroy(); } catch (_) {} }
    this.pool = null;
    this.poolPromise = null;
    this.ready = false;
    this.loading = false;
    this.retryCount = 0;
    this.noFillRetried = false;
  }

  // ── pool mode ───────────────────────────────────────────────────────────

  _ensurePool() {
    if (this.poolPromise) return this.poolPromise;
    const epoch = this.epoch;
    const stale = () => epoch !== this.epoch;
    const promise = ensureAdsInitialized()
      .then(() => (stale() ? null : AdPools.create({
        poolId: `blox-${this.key}`,
        formats: [this.spec.adFormat],
        adUnitId: this.adUnitId,
        requestOptions: this.requestOptions,
        // One per format: these placements show at most one ad every few
        // minutes, and every buffered ad that is never shown still counts
        // against match rate. (Google's app-wide cap is 6.)
        bufferSize: 1,
      })))
      .then((pool) => {
        if (!pool) return null;
        if (stale()) {
          // reset() ran while the pool was being created (Pro bought, the
          // audience changed): never let it start preloading.
          try { pool.destroy(); } catch (_) {}
          return null;
        }
        this.pool = pool;
        adLog(`${this.key} pool created`);
        this.poolUnsub = pool.addListener((e) => this._onPoolEvent(e));
        pool.getAvailability()
          .then(({ available }) => { if (available) this._markReady(); })
          .catch(() => {});
        return pool;
      })
      .catch((err) => {
        // Consent not ready yet: try again on the next signal. Anything else
        // (preloading unsupported after all, a native error) falls back to
        // the instance path for the rest of the session.
        if (this.poolPromise === promise) this.poolPromise = null;
        if (stale() || String(err?.message || '').includes('ads-consent-not-ready')) return null;
        adLog(`${this.key} pool failed ${err?.reason || err?.message || err}; instance mode`);
        this.mode = 'instance';
        this.prepare();
        return null;
      });
    this.poolPromise = promise;
    return promise;
  }

  _onPoolEvent(e) {
    if (!e) return;
    if (__DEV__) console.log(`[ads] ${this.key} pool ${e.type} ${e.error ? `${e.error.reason || ''} ${e.error.message || ''}` : ''}`);
    if (e.type === 'available') {
      this._markReady();
    } else if (e.type === 'exhausted') {
      this.ready = false;
    } else if (e.type === 'error') {
      if (isNoFillError(e.error) || /no-fill/.test(String(e.error?.reason || ''))) {
        this.lastNoFillAt = Date.now();
      }
      adLog(`${this.key} pool error ${e.error?.reason || e.error?.code || ''}`);
    }
  }

  async _pollPool() {
    const pool = await this._ensurePool();
    if (!pool) return this.mode === 'instance' ? this.take() : null;
    let result;
    try {
      result = await pool.poll();
    } catch (_) {
      result = { status: 'error' };
    }
    // The buffer refills on its own; until it says 'available' again, treat
    // it as empty.
    this.ready = false;
    pool.getAvailability()
      .then(({ available }) => { if (available) this._markReady(); })
      .catch(() => {});
    if (result?.status !== 'filled' || !result.ad) {
      adLog(`${this.key} poll ${result?.status}`);
      return null;
    }
    const ad = result.ad;
    if (typeof ad.isStaleByPolicy === 'function' && ad.isStaleByPolicy()) {
      safeDestroy(ad);
      adLog(`${this.key} poll stale`);
      return null;
    }
    adLog(`${this.key} take pooled`);
    return ad;
  }

  // ── instance mode ───────────────────────────────────────────────────────

  _createInstance() {
    this._dropInstance();
    let ad;
    try {
      ad = this.spec.create(this.adUnitId, this.requestOptions);
    } catch (err) {
      adLog(`${this.key} create failed ${err?.message || err}`);
      return;
    }
    this.ad = ad;
    this.unsubs = [
      ad.addAdEventListener(this.spec.loadedEvent, () => {
        if (ad !== this.ad) return;
        this.loading = false;
        this.loadedAt = Date.now();
        this.retryCount = 0;
        this.noFillRetried = false;
        adLog(`${this.key} loaded`);
        if (__DEV__) console.log(`[ads] ${this.key} instance loaded`);
        this._markReady();
      }),
      ad.addAdEventListener(AdEventType.ERROR, (error) => {
        if (ad !== this.ad) return;
        const noFill = isNoFillError(error) || /no-fill/.test(String(error?.reason || ''));
        if (noFill) this.lastNoFillAt = Date.now();
        adLog(`${this.key} load error ${error?.reason || error?.code || ''}`);
        if (__DEV__) console.log(`[ads] ${this.key} instance error ${error?.reason || ''} ${error?.message || ''}`);
        this._dropInstance();
        this._retry(noFill);
      }),
    ];
    this.loading = true;
    adLog(`${this.key} load`);
    try {
      ad.load();
    } catch (_) {
      this._dropInstance();
      this._retry(false);
    }
  }

  _retry(noFill) {
    let delay;
    if (noFill) {
      if (this.noFillRetried) return;
      this.noFillRetried = true;
      delay = NO_FILL_RETRY_MS;
    } else {
      if (this.retryCount >= 3) return;
      delay = Math.pow(2, this.retryCount) * 1000;
      this.retryCount += 1;
    }
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.prepare(false, true);
    }, delay);
    this.timers.add(t);
  }

  _expired() {
    return this.loadedAt > 0 && Date.now() - this.loadedAt > this.spec.expiryMs;
  }

  _unsubAll() {
    this.unsubs.forEach((u) => { try { u(); } catch (_) {} });
    this.unsubs = [];
  }

  _dropInstance(why) {
    this._unsubAll();
    if (this.ad) {
      if (why) adLog(`${this.key} drop ${why}`);
      safeDestroy(this.ad);
    }
    this.ad = null;
    this.ready = false;
    this.loading = false;
    this.loadedAt = 0;
  }

  _markReady() {
    this.ready = true;
    this.availableListeners.forEach((l) => { try { l(); } catch (_) {} });
  }
}

export function createFullscreenSource(format, adUnitId, requestOptions, key) {
  return new FullscreenSource(format, adUnitId, requestOptions, key);
}

export function resetAllFullscreenSources(reason) {
  sources.forEach((s) => s.reset(reason));
}

// Poll for a ready ad for up to `timeoutMs`, for show paths that may wait a
// moment. Resolves to the ad (owned by the caller) or null. A stale "ready"
// hint (the preloader's buffer turned out empty) just keeps waiting. `force`:
// the user explicitly asked for this ad (rewarded), so a fresh request goes
// out even inside the no-fill hold.
export function takeWithin(source, timeoutMs, { force = false, isCancelled = () => false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let unsub = null;
    let timer = null;
    const finish = (ad) => {
      if (done) { safeDestroy(ad); return; }
      done = true;
      if (unsub) unsub();
      if (timer) clearTimeout(timer);
      resolve(ad);
    };
    const attempt = () => {
      if (done) return;
      if (isCancelled()) { finish(null); return; }
      source.take().then((ad) => {
        if (ad) finish(ad);
      }).catch(() => {});
    };
    source.prepare(true, force);
    unsub = source.onAvailable(attempt);
    if (source.isReady()) attempt();
    timer = setTimeout(() => finish(null), timeoutMs);
  });
}

export { safeDestroy };
