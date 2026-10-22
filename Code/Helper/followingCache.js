/**
 * followingCache.js — MMKV-backed cache of "who I follow" ids, keyed by uid.
 *
 * Trades ("Following" filter) and Posts ("Following" tab) each ran the
 * `following where followerId == me` query on every mount / uid change.
 * Same 1 h TTL pattern as StatusFeed's following cache, but shared and keyed
 * per uid, so a signed-in user is served from MMKV and the query only runs
 * once an hour — or right after a follow/unfollow, which clears the entry.
 *
 * Read-only helper: it never touches Firestore. The `following` collection,
 * its fields and the query itself are unchanged.
 */

let store;
try {
  const { createMMKV } = require('react-native-mmkv');
  store = createMMKV({ id: 'following-cache' });
} catch (e) {
  console.warn('[followingCache] MMKV init failed, using fallback:', e?.message);
  store = {
    getString: () => undefined,
    getNumber: () => undefined,
    set: () => {},
    remove: () => {},
  };
}

// 24 h (was 1 h, 2026-10-22 cost fix): every follow/unfollow path updates or
// clears this cache, so the TTL only bounds follows made on another device.
export const FOLLOWING_CACHE_TTL = 24 * 60 * 60 * 1000;

const idsKey = (uid) => `following_ids_${uid}`;
const tsKey = (uid) => `following_ids_${uid}_ts`;

const removeKey = (key) => {
  try {
    if (typeof store.remove === 'function') store.remove(key);
    else if (typeof store.delete === 'function') store.delete(key);
  } catch {}
};

/**
 * Cached id list for `uid`, or null when there is no fresh entry.
 * An empty array is a valid (fresh) result — callers must check `=== null`.
 */
export const getCachedFollowingIds = (uid) => {
  if (!uid) return null;
  try {
    const ts = store.getNumber(tsKey(uid));
    if (!ts || (Date.now() - ts) >= FOLLOWING_CACHE_TTL) return null;
    const raw = store.getString(idsKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const setCachedFollowingIds = (uid, ids) => {
  if (!uid || !Array.isArray(ids)) return;
  try {
    store.set(idsKey(uid), JSON.stringify(ids));
    store.set(tsKey(uid), Date.now());
  } catch {}
};

/** Drop the cached list so the next mount re-queries. Call after follow/unfollow. */
export const clearFollowingCache = (uid) => {
  if (!uid) return;
  removeKey(idsKey(uid));
  removeKey(tsKey(uid));
};
