/**
 * NativeAdManager — keyed loader/cache for Native (advanced) ads.
 *
 * Native ads can't be shared across two <NativeAdView>s at once, so the usual
 * "one pool, many views" idea is fragile (it's why the old NativeAdPool showed
 * "only the first native renders"). Instead we cache ONE NativeAd per stable
 * slot key (e.g. the feed's `ad-15` interleave id). A card asks for its key on
 * mount; FlatList recycling re-mounts the same key and gets the same ad back
 * instantly — no reload, no flicker — while a brand-new slot triggers a fresh
 * load. Everything is torn down with releaseAll() when the list unmounts.
 *
 * Gating mirrors the rest of the ad stack: never loads for Pro users, awaits
 * ensureAdsInitialized() (config-before-load), and respects consent (NPA via
 * the shared ./consent helper). PAID events are surfaced via setOnPaid() for
 * impression-level revenue reporting.
 */
import {
  NativeAd,
  NativeAdEventType,
  NativeMediaAspectRatio,
  NativeAdChoicesPlacement,
} from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';
import { ensureAdsInitialized } from './init';
import { npaRequired } from './consent';

const adUnitId = getAdUnitId('native');

// Native ads expire ~1h after load; refresh a little before that so we never
// hand a card a stale (un-renderable) ad.
const MAX_AGE_MS = 50 * 60 * 1000;
// Safety cap on cached ads so a very long scroll session can't grow unbounded.
// FlatList windowing means evicted (oldest) slots are far off-screen.
const MAX_CACHE = 12;

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

const cache = new Map(); // key -> { ad, createdAt, paidSub }
const inflight = new Map(); // key -> Promise<NativeAd|null>

let onPaid = null;
export function setOnPaid(fn) {
  onPaid = typeof fn === 'function' ? fn : null;
}

function buildRequestOptions() {
  return {
    requestNonPersonalizedAdsOnly: npaRequired(),
    // Prefer landscape media — matches a feed-card layout and avoids tall
    // creatives that blow up row height.
    aspectRatio: NativeMediaAspectRatio.LANDSCAPE,
    // Keep the top-right corner reserved in the card UI for this.
    adChoicesPlacement: NativeAdChoicesPlacement.TOP_RIGHT,
    startVideoMuted: true,
    keywords: ['games', 'roblox'],
  };
}

function evictIfNeeded() {
  if (cache.size <= MAX_CACHE) return;
  // Evict the oldest entry.
  let oldestKey = null;
  let oldestAt = Infinity;
  for (const [key, entry] of cache) {
    if (entry.createdAt < oldestAt) {
      oldestAt = entry.createdAt;
      oldestKey = key;
    }
  }
  if (oldestKey != null) releaseKey(oldestKey);
}

// Global request throttle. AdMob rate-limits rapid same-unit native requests,
// so when several feed slots mount at once (or the user scrolls fast) the 2nd+
// requests get throttled and return no-fill — exactly the "only the first ad
// shows" symptom. We serialize every createForAdRequest through a single chain
// and keep them at least MIN_REQUEST_GAP_MS apart, so each request is spread
// out and has a real chance to fill.
const MIN_REQUEST_GAP_MS = 1500;
let requestChain = Promise.resolve();
let lastRequestAt = 0;

function throttledCreate() {
  const run = requestChain.then(async () => {
    const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return NativeAd.createForAdRequest(adUnitId, buildRequestOptions());
  });
  // Keep the chain alive even if this particular request rejects.
  requestChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

async function loadFresh(key) {
  await ensureAdsInitialized();
  const ad = await throttledCreate();

  // Impression-level revenue: forward PAID events for analytics so fill rate
  // and eCPM per placement become measurable instead of guessed.
  let paidSub = null;
  try {
    paidSub = ad.addAdEventListener(NativeAdEventType.PAID, (payload) => {
      if (onPaid) {
        try {
          onPaid({ placement: 'native', key, ...payload });
        } catch (_) {}
      }
    });
  } catch (_) {}

  cache.set(key, { ad, createdAt: Date.now(), paidSub });
  evictIfNeeded();
  return ad;
}

/**
 * Get (or load) the native ad for a stable slot key.
 * @returns {Promise<NativeAd|null>} null for Pro users or on load failure.
 */
export async function getNativeAd(key) {
  if (isProUser()) return null;

  const entry = cache.get(key);
  if (entry) {
    if (Date.now() - entry.createdAt < MAX_AGE_MS) return entry.ad;
    releaseKey(key); // stale — reload below
  }

  if (inflight.has(key)) return inflight.get(key);

  const p = loadFresh(key)
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function releaseKey(key) {
  const entry = cache.get(key);
  if (!entry) return;
  try {
    entry.paidSub && entry.paidSub.remove();
  } catch (_) {}
  try {
    entry.ad.destroy();
  } catch (_) {}
  cache.delete(key);
}

// Release only the keys owned by one screen (e.g. 'ad-' for the feed).
// Prevents one list's unmount from destroying ads still on screen in another
// list that shares this cache.
export function releaseByPrefix(prefix) {
  for (const key of Array.from(cache.keys())) {
    if (typeof key === 'string' && key.startsWith(prefix)) releaseKey(key);
  }
  for (const key of Array.from(inflight.keys())) {
    if (typeof key === 'string' && key.startsWith(prefix)) inflight.delete(key);
  }
}

// Call on feed/list unmount to free all native ad handles.
export function releaseAll() {
  for (const key of Array.from(cache.keys())) releaseKey(key);
  inflight.clear();
}

export default { getNativeAd, releaseKey, releaseByPrefix, releaseAll, setOnPaid };
