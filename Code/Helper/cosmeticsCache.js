/**
 * cosmeticsCache.js — MMKV-backed cache for current user's own cosmetics
 *
 * ✅ Reads are SYNCHRONOUS (MMKV) — no flicker, instant on every screen
 * ✅ Writes update MMKV first, then sync to DB (optimistic)
 * ✅ DB sync happens once on app start, then only when user changes cosmetics
 * ✅ Other screens just call getMyCosmetics() — zero DB reads
 */


import { ref, get } from '@react-native-firebase/database';

let store;
try {
  const { createMMKV } = require('react-native-mmkv');
  store = createMMKV({ id: 'my-cosmetics' });
} catch (e) {
  console.warn('[cosmeticsCache] MMKV not available:', e.message);
  store = {
    getString: () => undefined,
    getNumber: () => undefined,
    set: () => {},
    delete: () => {},
  };
}
const KEY = 'active';
const SYNC_KEY = 'lastSync';
const SYNC_TTL = 10 * 60 * 1000; // 10 min — only re-fetch if stale

const EMPTY = {
  profileFrame: null,
  chatTextColor: null,
  tradeCardBg: null,
  profileBanner: null,
  chatBubbleBg: null,
};

// ────────────────────────────────────────────────────────
//  READ — synchronous, safe in render
// ────────────────────────────────────────────────────────
export const getMyCosmetics = () => {
  try {
    const raw = store.getString(KEY);
    if (!raw) return { ...EMPTY };
    return JSON.parse(raw);
  } catch {
    return { ...EMPTY };
  }
};

// ────────────────────────────────────────────────────────
//  WRITE — update MMKV immediately (optimistic)
// ────────────────────────────────────────────────────────
export const setMyCosmetics = (cosmetics) => {
  try {
    store.set(KEY, JSON.stringify(cosmetics || EMPTY));
    store.set(SYNC_KEY, Date.now());
  } catch {
    // Silently fail
  }
};

// ────────────────────────────────────────────────────────
//  UPDATE SINGLE TYPE — e.g. after activate/deactivate
// ────────────────────────────────────────────────────────
export const updateMyCosmeticType = (type, value) => {
  const current = getMyCosmetics();
  current[type] = value;
  setMyCosmetics(current);
};

// ────────────────────────────────────────────────────────
//  SYNC FROM DB — called once on app start, or after
//  purchase/activate/deactivate to ensure consistency.
//  Skips if recently synced (within TTL).
// ────────────────────────────────────────────────────────
export const syncMyCosmetics = async (db, uid, force = false) => {
  if (!db || !uid) return getMyCosmetics();

  // Skip if recently synced (unless forced)
  if (!force) {
    try {
      const lastSync = store.getNumber(SYNC_KEY) || 0;
      if (Date.now() - lastSync < SYNC_TTL) {
        return getMyCosmetics();
      }
    } catch {}
  }

  try {
    const snap = await get(ref(db, `users/${uid}/shop/activeItems`));
    const result = { ...EMPTY };

    if (snap.exists()) {
      const items = snap.val();
      const now = Date.now();

      if (items.profileFrame) {
        if (items.profileFrame.expiresAt === -1 || items.profileFrame.expiresAt > now) {
          result.profileFrame = items.profileFrame;
        }
      }
      if (items.chatTextColor) {
        if (items.chatTextColor.expiresAt === -1 || items.chatTextColor.expiresAt > now) {
          result.chatTextColor = items.chatTextColor;
        }
      }
      if (items.tradeCardBg) {
        if (items.tradeCardBg.expiresAt === -1 || items.tradeCardBg.expiresAt > now) {
          result.tradeCardBg = items.tradeCardBg;
        }
      }
      if (items.profileBanner) {
        if (items.profileBanner.expiresAt === -1 || items.profileBanner.expiresAt > now) {
          result.profileBanner = items.profileBanner;
        }
      }
      if (items.chatBubbleBg) {
        if (items.chatBubbleBg.expiresAt === -1 || items.chatBubbleBg.expiresAt > now) {
          result.chatBubbleBg = items.chatBubbleBg;
        }
      }
    }

    setMyCosmetics(result);
    return result;
  } catch (err) {
    console.warn('[cosmeticsCache] sync error:', err?.message);
    return getMyCosmetics(); // Fall back to whatever's cached
  }
};

// ────────────────────────────────────────────────────────
//  CLEAR — call on logout
// ────────────────────────────────────────────────────────
export const clearMyCosmetics = () => {
  try {
    store.delete(KEY);
    store.delete(SYNC_KEY);
    store.delete('egg_xp');
    store.delete('egg_stats');
    store.delete('egg_inventory');
    store.delete('username');
    store.delete('avatar');
  } catch {}
};

// ────────────────────────────────────────────────────────
//  EGG SCREEN CACHE — persist XP, stats, inventory for
//  instant render of MysteryEgg screen
// ────────────────────────────────────────────────────────
export const getCachedEggData = () => {
  try {
    const xp = store.getNumber('egg_xp');
    const statsRaw = store.getString('egg_stats');
    const invRaw = store.getString('egg_inventory');
    return {
      xp: xp || 0,
      stats: statsRaw ? JSON.parse(statsRaw) : { totalEggsOpened: 0, totalXPSpent: 0 },
      inventory: invRaw ? JSON.parse(invRaw) : {},
    };
  } catch {
    return { xp: 0, stats: { totalEggsOpened: 0, totalXPSpent: 0 }, inventory: {} };
  }
};

export const setCachedEggXP = (xp) => {
  try { store.set('egg_xp', xp || 0); } catch {}
};

export const setCachedEggStats = (stats) => {
  try { store.set('egg_stats', JSON.stringify(stats)); } catch {}
};

export const setCachedEggInventory = (inventory) => {
  try { store.set('egg_inventory', JSON.stringify(inventory)); } catch {}
};

// ────────────────────────────────────────────────────────
//  USER IDENTITY CACHE — instant display name + avatar
// ────────────────────────────────────────────────────────
export const getCachedUsername = () => {
  try { return store.getString('username') || ''; } catch { return ''; }
};

export const setCachedUsername = (name) => {
  try { if (name) store.set('username', name); } catch {}
};

export const getCachedAvatar = () => {
  try { return store.getString('avatar') || ''; } catch { return ''; }
};

export const setCachedAvatar = (uri) => {
  try { if (uri) store.set('avatar', uri); } catch {}
};
