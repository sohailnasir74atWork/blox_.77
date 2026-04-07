/**
 * analyticsDataHelper.js
 * Shared helper for analytics + value-changes data from MMKV cache.
 * Fetches from CDN if cache is empty/stale.
 */

let analyticsCache;
try {
  const { createMMKV } = require('react-native-mmkv');
  analyticsCache = createMMKV({ id: 'analytics-cache' });
} catch (e) {
  console.warn('[analyticsDataHelper] MMKV not available:', e.message);
  analyticsCache = {
    getString: () => undefined,
    getNumber: () => undefined,
    set: () => {},
    delete: () => {},
  };
}

const CHANGES_CACHE_KEY = 'value_changes';
const CHANGES_TS_KEY = 'value_changes_ts';
const VALUE_CHANGES_CDN_URL = 'https://blox-api.b-cdn.net/diff.json';
const CACHE_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

let _inflight = null;

const isCacheFresh = (tsKey) => {
  const ts = analyticsCache.getNumber(tsKey);
  if (!ts) return false;
  return Date.now() - ts < CACHE_DURATION_MS;
};

export const fetchAnalyticsData = async () => {
  if (_inflight) return _inflight;

  const cached = analyticsCache.getString(CHANGES_CACHE_KEY);
  if (cached && isCacheFresh(CHANGES_TS_KEY)) return;

  _inflight = (async () => {
    try {
      const res = await fetch(VALUE_CHANGES_CDN_URL);
      if (res.ok) {
        const text = await res.text();
        analyticsCache.set(CHANGES_CACHE_KEY, text);
        analyticsCache.set(CHANGES_TS_KEY, Date.now());
      }
    } catch (e) {
      console.warn('[analyticsDataHelper] Fetch failed:', e.message);
    }
  })();

  try {
    await _inflight;
  } finally {
    _inflight = null;
  }
};

export { analyticsCache, CHANGES_CACHE_KEY };
