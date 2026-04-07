/**
 * profileCache.js
 * MMKV-based profile cache for user display data + cosmetics.
 *
 * Purpose: Reduce RTDB bandwidth by caching sender profiles locally.
 * When rendering chat messages, avatar/cosmetics are fetched from cache
 * instead of being embedded in every message payload.
 *
 * Cache TTL: 30 minutes
 * Storage: react-native-mmkv (already a dependency)
 *
 * ⚠️ BACKWARDS COMPATIBLE:
 *   - Old messages still have avatar/isPro/sender fields → used first
 *   - New slim messages miss these fields → cache fills in
 *   - If cache misses too → sensible defaults (no crash)
 */

import { ref, get } from '@react-native-firebase/database';

let cache;
try {
  const { createMMKV } = require('react-native-mmkv');
  cache = createMMKV({ id: 'profile-cache' });
} catch (e) {
  console.warn('[profileCache] MMKV not available:', e.message);
  cache = {
    getString: () => undefined,
    set: () => {},
    delete: () => {},
  };
}
const TTL = 30 * 60 * 1000; // 30 minutes

// ────────────────────────────────────────────────────────
//  READ from cache (synchronous — safe in render)
// ────────────────────────────────────────────────────────
export const getCachedProfile = (uid) => {
  if (!uid) return null;
  try {
    const raw = cache.getString(`p_${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t > TTL) {
      cache.delete(`p_${uid}`);
      return null;
    }
    return parsed.d;
  } catch {
    return null;
  }
};

// ────────────────────────────────────────────────────────
//  WRITE to cache
// ────────────────────────────────────────────────────────
export const setCachedProfile = (uid, data) => {
  if (!uid || !data) return;
  try {
    cache.set(`p_${uid}`, JSON.stringify({ d: data, t: Date.now() }));
  } catch {
    // Silently fail — cache is optional
  }
};

// ────────────────────────────────────────────────────────
//  EXTRACT ACTIVE COSMETICS from shop/activeItems snapshot
//  Shared logic used by both getOrFetchProfile and seedCurrentUser
// ────────────────────────────────────────────────────────
const extractCosmetics = (shopItems) => {
  const result = { chatTextColor: null, profileFrame: null, tradeCardBg: null, chatBubbleBg: null, profileBanner: null };
  if (!shopItems) return result;
  const now = Date.now();

  if (shopItems.chatTextColor && (shopItems.chatTextColor.expiresAt === -1 || shopItems.chatTextColor.expiresAt > now)) {
    result.chatTextColor = shopItems.chatTextColor.color || null;
  }
  if (shopItems.profileFrame && (shopItems.profileFrame.expiresAt === -1 || shopItems.profileFrame.expiresAt > now)) {
    result.profileFrame = shopItems.profileFrame;
  }
  if (shopItems.tradeCardBg && (shopItems.tradeCardBg.expiresAt === -1 || shopItems.tradeCardBg.expiresAt > now)) {
    result.tradeCardBg = shopItems.tradeCardBg;
  }
  if (shopItems.chatBubbleBg && (shopItems.chatBubbleBg.expiresAt === -1 || shopItems.chatBubbleBg.expiresAt > now)) {
    result.chatBubbleBg = shopItems.chatBubbleBg;
  }
  if (shopItems.profileBanner && (shopItems.profileBanner.expiresAt === -1 || shopItems.profileBanner.expiresAt > now)) {
    result.profileBanner = shopItems.profileBanner;
  }

  return result;
};

// ────────────────────────────────────────────────────────
//  FETCH from RTDB only if not cached (async)
//  Call this in useEffect or outside render loop
// ────────────────────────────────────────────────────────
export const getOrFetchProfile = async (db, uid) => {
  if (!uid || !db) return null;

  // 1. Check cache first
  const cached = getCachedProfile(uid);
  if (cached) return cached;

  // 2. Fetch only needed fields from RTDB (not the full user node)
  try {
    const [displayNameSnap, avatarSnap, isProSnap, verifiedSnap, recentWinSnap,
      lastWinSnap, adminSnap, modSnap, babyModSnap, trustedSnap, cmsrSnap, grinderSnap,
      raiderSnap, topBadgeSnap, cosmeticsSnap] = await Promise.all([
      get(ref(db, `users/${uid}/displayName`)),
      get(ref(db, `users/${uid}/avatar`)),
      get(ref(db, `users/${uid}/isPro`)),
      get(ref(db, `users/${uid}/robloxUsernameVerified`)),
      get(ref(db, `users/${uid}/hasRecentGameWin`)),
      get(ref(db, `users/${uid}/lastGameWinAt`)),
      get(ref(db, `users/${uid}/admin`)),
      get(ref(db, `users/${uid}/isModerator`)),
      get(ref(db, `users/${uid}/isBabyMod`)),
      get(ref(db, `users/${uid}/isTrusted`)),
      get(ref(db, `users/${uid}/isCMSR`)),
      get(ref(db, `users/${uid}/isGrinder`)),
      get(ref(db, `users/${uid}/isRaider`)),
      get(ref(db, `users/${uid}/topBadge`)),
      get(ref(db, `users/${uid}/shop/activeItems`)),
    ]);

    const cosmetics = extractCosmetics(cosmeticsSnap?.exists() ? cosmeticsSnap.val() : null);

    const profile = {
      displayName: displayNameSnap?.exists() ? displayNameSnap.val() : 'Anonymous',
      avatar: avatarSnap?.exists() ? avatarSnap.val() : null,
      isPro: !!(isProSnap?.exists() && isProSnap.val()),
      robloxUsernameVerified: !!(verifiedSnap?.exists() && verifiedSnap.val()),
      hasRecentGameWin: !!(recentWinSnap?.exists() && recentWinSnap.val()),
      lastGameWinAt: lastWinSnap?.exists() ? lastWinSnap.val() : null,
      isAdmin: !!(adminSnap?.exists() && adminSnap.val()),
      isModerator: !!(modSnap?.exists() && modSnap.val()),
      isBabyMod: !!(babyModSnap?.exists() && babyModSnap.val()),
      isTrusted: !!(trustedSnap?.exists() && trustedSnap.val()),
      isCMSR: !!(cmsrSnap?.exists() && cmsrSnap.val()),
      isGrinder: !!(grinderSnap?.exists() && grinderSnap.val()),
      isRaider: !!(raiderSnap?.exists() && raiderSnap.val()),
      topBadge: topBadgeSnap?.exists() ? topBadgeSnap.val() : null,
      ...cosmetics,
    };
    setCachedProfile(uid, profile);
    return profile;
  } catch (err) {
    console.warn('[profileCache] Fetch error:', err?.message);
    return null;
  }
};

// ────────────────────────────────────────────────────────
//  WARM CACHE — pre-fetch profiles for a batch of UIDs
//  Call this when loading messages to cache all senders
// ────────────────────────────────────────────────────────
export const warmProfileCache = async (db, uids) => {
  if (!db || !Array.isArray(uids) || uids.length === 0) return;
  const uncached = [...new Set(uids)].filter(uid => !getCachedProfile(uid));
  if (uncached.length === 0) return;
  const batch = uncached.slice(0, 20);
  await Promise.allSettled(batch.map(uid => getOrFetchProfile(db, uid)));
};

// ────────────────────────────────────────────────────────
//  SEED CACHE — populate from a message that already has
//  the data (old format messages). Zero RTDB cost.
// ────────────────────────────────────────────────────────
export const seedFromMessage = (msg) => {
  if (!msg?.senderId) return;

  // Only seed if we don't already have a cached version
  const existing = getCachedProfile(msg.senderId);
  if (existing) return;

  // Only seed if message actually has the data (old format)
  if (!msg.avatar && !msg.sender) return;

  setCachedProfile(msg.senderId, {
    displayName: msg.sender || 'Anonymous',
    avatar: msg.avatar || null,
    isPro: !!msg.isPro,
    robloxUsernameVerified: !!msg.robloxUsernameVerified,
    hasRecentGameWin: !!msg.hasRecentGameWin,
    lastGameWinAt: msg.lastGameWinAt || null,
    isAdmin: !!msg.isAdmin,
    isModerator: !!msg.isModerator,
    isBabyMod: !!msg.isBabyMod,
    isTrusted: !!msg.isTrusted,
    isCMSR: !!msg.isCMSR,
    isGrinder: !!msg.isGrinder,
    isRaider: !!msg.isRaider,
    topBadge: msg.topBadge || null,
    profileFrame: msg.profileFrame || null,
    chatTextColor: msg.chatTextColor || null,
    chatBubbleBg: msg.chatBubbleBg || null,
    tradeCardBg: null,
    profileBanner: null,
  });
};

// ────────────────────────────────────────────────────────
//  RESOLVE — get value from message first, then cache, then default
//  This is the key "backwards compatible" resolver.
//  SYNCHRONOUS — safe to call inside render/renderItem.
// ────────────────────────────────────────────────────────
const DEFAULT_PROFILE = {
  displayName: 'Anonymous', avatar: null, isPro: false,
  robloxUsernameVerified: false, hasRecentGameWin: false,
  chatTextColor: null, profileFrame: null, tradeCardBg: null,
  chatBubbleBg: null, profileBanner: null, topBadge: null,
  isAdmin: false, isModerator: false, isBabyMod: false, isTrusted: false, isCMSR: false, isGrinder: false, isRaider: false,
};

export const resolveProfile = (msg) => {
  if (!msg) return { ...DEFAULT_PROFILE };

  const cached = getCachedProfile(msg.senderId);

  return {
    displayName: msg.sender || cached?.displayName || 'Anonymous',
    avatar: msg.avatar || cached?.avatar || null,
    isPro: msg.isPro ?? cached?.isPro ?? false,
    robloxUsernameVerified: msg.robloxUsernameVerified ?? cached?.robloxUsernameVerified ?? false,
    hasRecentGameWin: msg.hasRecentGameWin ?? cached?.hasRecentGameWin ?? (
      typeof (msg.lastGameWinAt || cached?.lastGameWinAt) === 'number' &&
      Date.now() - (msg.lastGameWinAt || cached?.lastGameWinAt) <= 24 * 60 * 60 * 1000
    ),
    isAdmin: msg.isAdmin ?? cached?.isAdmin ?? false,
    isModerator: msg.isModerator ?? cached?.isModerator ?? false,
    isBabyMod: msg.isBabyMod ?? cached?.isBabyMod ?? false,
    isTrusted: msg.isTrusted ?? cached?.isTrusted ?? false,
    isCMSR: msg.isCMSR ?? cached?.isCMSR ?? false,
    isGrinder: msg.isGrinder ?? cached?.isGrinder ?? false,
    isRaider: msg.isRaider ?? cached?.isRaider ?? false,
    chatTextColor: msg.chatTextColor ?? cached?.chatTextColor ?? null,
    profileFrame: msg.profileFrame ?? cached?.profileFrame ?? null,
    tradeCardBg: cached?.tradeCardBg ?? null,
    chatBubbleBg: msg.chatBubbleBg ?? cached?.chatBubbleBg ?? null,
    profileBanner: cached?.profileBanner ?? null,
    topBadge: msg.topBadge ?? cached?.topBadge ?? null,
  };
};

// ────────────────────────────────────────────────────────
//  SEED CURRENT USER — call once on mount in chat screens
//  Ensures the user's OWN slim messages resolve correctly
// ────────────────────────────────────────────────────────
export const seedCurrentUser = async (user, localState, db) => {
  if (!user?.id) return;

  const profile = {
    displayName: user.displayName || 'Anonymous',
    avatar: user.avatar || null,
    isPro: !!localState?.isPro,
    robloxUsernameVerified: !!user.robloxUsernameVerified,
    hasRecentGameWin: !!user.hasRecentGameWin || (user.lastGameWinAt && Date.now() - user.lastGameWinAt <= 24 * 60 * 60 * 1000) || false,
    lastGameWinAt: user.lastGameWinAt || null,
    isAdmin: !!user.isAdmin || !!user.admin,
    isModerator: !!user.isModerator,
    isBabyMod: !!user.isBabyMod,
    isTrusted: !!user.isTrusted,
    isCMSR: !!user.isCMSR,
    isGrinder: !!user.isGrinder,
    isRaider: !!user.isRaider,
    topBadge: user.topBadge || null,
    chatTextColor: null,
    profileFrame: null,
    tradeCardBg: null,
    chatBubbleBg: null,
    profileBanner: null,
  };

  // Seed immediately with base data
  setCachedProfile(user.id, profile);

  // Then fetch cosmetics async (fire-and-forget)
  if (db) {
    try {
      if (!profile.avatar) {
        const avatarSnap = await get(ref(db, `users/${user.id}/avatar`));
        if (avatarSnap.exists()) {
          profile.avatar = avatarSnap.val();
          setCachedProfile(user.id, profile);
        }
      }

      const snap = await get(ref(db, `users/${user.id}/shop/activeItems`));
      if (snap.exists()) {
        const cosmetics = extractCosmetics(snap.val());
        Object.assign(profile, cosmetics);
        setCachedProfile(user.id, profile);
      }
    } catch {
      // Silently fail — cosmetics are non-essential
    }
  }
};
