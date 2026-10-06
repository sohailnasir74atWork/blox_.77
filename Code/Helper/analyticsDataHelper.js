/**
 * analyticsDataHelper.js
 * Shared helper for analytics + value-changes data from MMKV cache.
 * Fetches from CDN if cache is empty/stale, then builds lookup maps for the
 * calculator and the trade feed.
 *
 * Blox Fruit items come in two kinds, normal ('n') and permanent ('p'), with
 * different values and demand, so every map is keyed by name AND type:
 * itemKey('Kitsune', 'p') -> 'kitsune_p'.
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

// Same keys AnalyticsScreen uses for the analytics file ('analytics' plus a
// string '<key>_time' stamp), so the two screens share one download.
const ANALYTICS_CACHE_KEY = 'analytics';
const ANALYTICS_TIME_KEY = 'analytics_time';
const ANALYTICS_CDN_URL = 'https://analytics-blox.b-cdn.net';
const ANALYTICS_CACHE_MS = 3 * 60 * 60 * 1000; // 3 hours, as AnalyticsScreen

const CHANGES_CACHE_KEY = 'value_changes';
const CHANGES_TS_KEY = 'value_changes_ts';
const VALUE_CHANGES_CDN_URL = 'https://blox-api.b-cdn.net/diff.json';
const CACHE_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

// A diff older than this is not news any more: no "+X%" badges.
const DIFF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let _inflight = null;

const isCacheFresh = (tsKey) => {
  const ts = analyticsCache.getNumber(tsKey);
  if (!ts) return false;
  return Date.now() - ts < CACHE_DURATION_MS;
};

const isAnalyticsFresh = () => {
  const ts = parseInt(analyticsCache.getString(ANALYTICS_TIME_KEY) || '', 10);
  return Number.isFinite(ts) && Date.now() - ts < ANALYTICS_CACHE_MS;
};

export const itemKey = (name, type) =>
  `${String(name || '').toLowerCase().trim()}_${type === 'p' ? 'p' : 'n'}`;

const asChange = (v) => {
  if (!v || typeof v !== 'object') return null;
  const oldVal = Number(v.oldVal);
  const newVal = Number(v.newVal);
  if (!Number.isFinite(oldVal) || !Number.isFinite(newVal) || oldVal <= 0) return null;
  return Math.round(((newVal - oldVal) / oldVal) * 100);
};

// ── Build maps from raw data ──
//   demandMap: 1-10 rank score from topWanted (most asked-for in trades, 24 h)
//   marketMap: { wanted, offered } trade posts asking for / offering it (24 h)
//   hotMap / dropMap: { pct } value risers / fallers from the latest diff
// The analytics file lists only the top 20 per side, so anything missing
// from it means "not in the top 20", not "nobody wants it".
const buildMaps = (analyticsRaw, changesRaw) => {
  const result = { demandMap: {}, marketMap: {}, hotMap: {}, dropMap: {} };

  try {
    if (analyticsRaw) {
      const analytics = typeof analyticsRaw === 'string' ? JSON.parse(analyticsRaw) : analyticsRaw;
      const topWanted = Array.isArray(analytics?.topWanted) ? analytics.topWanted : [];
      const total = topWanted.length;
      topWanted.forEach((item, index) => {
        if (!item?.name) return;
        const score = Math.max(1, Math.round(10 - (index / total) * 9));
        result.demandMap[itemKey(item.name, item.type)] = { score };
      });

      const add = (list, field) => (Array.isArray(list) ? list : []).forEach((item) => {
        if (!item?.name) return;
        const key = itemKey(item.name, item.type);
        result.marketMap[key] = result.marketMap[key] || { wanted: 0, offered: 0 };
        result.marketMap[key][field] = Number(item.count) || 0;
      });
      add(analytics?.topWanted, 'wanted');
      add(analytics?.topOffered, 'offered');
    }

    if (changesRaw) {
      const changes = typeof changesRaw === 'string' ? JSON.parse(changesRaw) : changesRaw;
      const generatedAt = Date.parse(changes?.meta?.generatedAt || '');
      const fresh = !Number.isFinite(generatedAt) || Date.now() - generatedAt <= DIFF_MAX_AGE_MS;
      (fresh && Array.isArray(changes?.changed) ? changes.changed : []).forEach((item) => {
        if (!item?.name) return;
        [['value', 'n'], ['permValue', 'p']].forEach(([field, type]) => {
          const pct = asChange(item[field]);
          if (pct == null) return;
          if (pct >= 1) result.hotMap[itemKey(item.name, type)] = { pct };
          else if (pct <= -1) result.dropMap[itemKey(item.name, type)] = { pct };
        });
      });
    }
  } catch (error) {
    console.warn('[analyticsDataHelper] Error building maps:', error.message);
  }

  return result;
};

/**
 * Fetches whatever is stale, then returns the maps. Concurrent callers share
 * one request.
 */
export const fetchAnalyticsData = async () => {
  if (_inflight) return _inflight;

  const cachedAnalytics = analyticsCache.getString(ANALYTICS_CACHE_KEY);
  const cachedChanges = analyticsCache.getString(CHANGES_CACHE_KEY);
  if (cachedAnalytics && isAnalyticsFresh() && cachedChanges && isCacheFresh(CHANGES_TS_KEY)) {
    return buildMaps(cachedAnalytics, cachedChanges);
  }

  _inflight = (async () => {
    let analyticsRaw = cachedAnalytics;
    let changesRaw = cachedChanges;

    if (!analyticsRaw || !isAnalyticsFresh()) {
      try {
        const res = await fetch(`${ANALYTICS_CDN_URL}?cb=${Date.now()}`);
        if (res.ok) {
          const text = await res.text();
          analyticsCache.set(ANALYTICS_CACHE_KEY, text);
          analyticsCache.set(ANALYTICS_TIME_KEY, Date.now().toString());
          analyticsRaw = text;
        }
      } catch (e) {
        console.warn('[analyticsDataHelper] Analytics fetch failed:', e.message);
      }
    }

    if (!changesRaw || !isCacheFresh(CHANGES_TS_KEY)) {
      try {
        const res = await fetch(VALUE_CHANGES_CDN_URL);
        if (res.ok) {
          const text = await res.text();
          analyticsCache.set(CHANGES_CACHE_KEY, text);
          analyticsCache.set(CHANGES_TS_KEY, Date.now());
          changesRaw = text;
        }
      } catch (e) {
        console.warn('[analyticsDataHelper] Fetch failed:', e.message);
      }
    }

    return buildMaps(analyticsRaw, changesRaw);
  })();

  try {
    return await _inflight;
  } finally {
    _inflight = null;
  }
};

export const getHotStatus = (name, type, hotMap) => (hotMap && hotMap[itemKey(name, type)]) || null;

export { analyticsCache, CHANGES_CACHE_KEY };
