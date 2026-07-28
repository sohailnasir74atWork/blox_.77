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
import {
  getIdentity, getRoles, getCosmetics as getCosmeticsBadge, getRoblox,
  getIdentityBatch, getRolesBatch, getCosmeticsBatch, getRobloxBatch,
} from '../Supabase/userBackend';
import { SUPABASE_USERS_ENABLED } from '../Supabase/featureFlags';

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
//  FETCH — Supabase first (since Phase 4), RTDB fallback.
//
//  Path 1 (Supabase): single round trip pulls identity + roles +
//    roblox + cosmetic badge fields. shop/activeItems (active cosmetic
//    items) stays on RTDB this phase, so we always fetch that one.
//    If Supabase has NO row for the user yet (mirror CF hasn't fired),
//    any of the three calls returns null → we fall back to RTDB.
//
//  Path 2 (RTDB fallback): same per-field reads as before. Used when
//    Supabase reads disabled (kill switch), Supabase has no data yet,
//    or any Supabase call errors out.
// ────────────────────────────────────────────────────────
export const getOrFetchProfile = async (db, uid) => {
  if (!uid || !db) return null;

  // 1. Check cache first
  const cached = getCachedProfile(uid);
  if (cached) return cached;

  // 2. Try Supabase first (parallel) + RTDB shop/activeItems (deferred to a later phase).
  if (SUPABASE_USERS_ENABLED) {
    try {
      const [identity, roles, roblox, cosBadge, shopSnap] = await Promise.all([
        getIdentity(uid),
        getRoles(uid),
        getRoblox(uid),
        getCosmeticsBadge(uid),
        get(ref(db, `users/${uid}/shop/activeItems`)),
      ]);

      // Need at least identity to consider this a hit. Roles/cosmetics
      // can be null (user has no role / no badge) and that's fine —
      // they'll fall through as default false / null in the merged shape.
      if (identity) {
        const cosmetics = extractCosmetics(shopSnap?.exists() ? shopSnap.val() : null);
        const profile = {
          displayName: identity.displayName ?? 'Anonymous',
          avatar: identity.avatar ?? null,
          isPro: !!cosBadge?.isPro,
          robloxUsernameVerified: !!roblox?.robloxUsernameVerified,
          hasRecentGameWin: false,                 // still on RTDB; not migrated this phase
          lastGameWinAt: null,                     // ditto
          isAdmin: !!roles?.isAdmin,
          isSeniorMod: !!roles?.isSeniorMod,
          isModerator: !!roles?.isModerator,
          isBabyMod: !!roles?.isBabyMod,
          isTrusted: !!roles?.isTrusted,
          isGrinder: !!roles?.isGrinder,
          isRaider: !!roles?.isRaider,
          topBadge: cosBadge?.topBadge ?? null,
          ...cosmetics,
        };

        // Best-effort: pull recent-game-win flags from RTDB without
        // blocking the path above (they're tiny). Fire-and-forget;
        // resolveProfile is tolerant of missing values.
        Promise.all([
          get(ref(db, `users/${uid}/hasRecentGameWin`)),
          get(ref(db, `users/${uid}/lastGameWinAt`)),
        ]).then(([recentWinSnap, lastWinSnap]) => {
          const updated = {
            ...profile,
            hasRecentGameWin: !!(recentWinSnap?.exists() && recentWinSnap.val()),
            lastGameWinAt: lastWinSnap?.exists() ? lastWinSnap.val() : null,
          };
          setCachedProfile(uid, updated);
        }).catch(() => { /* keep base profile cached */ });

        setCachedProfile(uid, profile);
        return profile;
      }
    } catch (e) {
      // Supabase path failed; fall through to RTDB. Don't spam — this
      // can be transient (cold-start JWT race, network blip).
    }
  }

  // 3. RTDB fallback — original per-field reads.
  try {
    const [displayNameSnap, avatarSnap, isProSnap, verifiedSnap, recentWinSnap,
      lastWinSnap, adminSnap, seniorModSnap, modSnap, babyModSnap, trustedSnap, grinderSnap,
      raiderSnap, topBadgeSnap, cosmeticsSnap] = await Promise.all([
      get(ref(db, `users/${uid}/displayName`)),
      get(ref(db, `users/${uid}/avatar`)),
      get(ref(db, `users/${uid}/isPro`)),
      get(ref(db, `users/${uid}/robloxUsernameVerified`)),
      get(ref(db, `users/${uid}/hasRecentGameWin`)),
      get(ref(db, `users/${uid}/lastGameWinAt`)),
      get(ref(db, `users/${uid}/admin`)),
      get(ref(db, `users/${uid}/isSeniorMod`)),
      get(ref(db, `users/${uid}/isModerator`)),
      get(ref(db, `users/${uid}/isBabyMod`)),
      get(ref(db, `users/${uid}/isTrusted`)),
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
      isSeniorMod: !!(seniorModSnap?.exists() && seniorModSnap.val()),
      isModerator: !!(modSnap?.exists() && modSnap.val()),
      isBabyMod: !!(babyModSnap?.exists() && babyModSnap.val()),
      isTrusted: !!(trustedSnap?.exists() && trustedSnap.val()),
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
//  Call this when loading messages to cache all senders.
//
//  Batched: 4 Supabase queries for the whole batch (identity/roles/
//  roblox/cosmetics via .in('uid', …)) instead of 4 PER SENDER — a
//  public-chat page with 20 uncached senders used to fire up to 80
//  requests. RTDB extras (shop cosmetics, game-win flags) stay per-uid;
//  they're not part of the Supabase bill.
// ────────────────────────────────────────────────────────
export const warmProfileCache = async (db, uids) => {
  if (!db || !Array.isArray(uids) || uids.length === 0) return;
  const uncached = [...new Set(uids)].filter(uid => !getCachedProfile(uid));
  if (uncached.length === 0) return;
  const batch = uncached.slice(0, 20);

  if (SUPABASE_USERS_ENABLED) {
    try {
      const [identities, roles, robloxes, cosmeticsBadges, rtdbExtras] = await Promise.all([
        getIdentityBatch(batch),
        getRolesBatch(batch),
        getRobloxBatch(batch),
        getCosmeticsBatch(batch),
        Promise.allSettled(batch.map(async (uid) => {
          const [shopSnap, recentWinSnap, lastWinSnap] = await Promise.all([
            get(ref(db, `users/${uid}/shop/activeItems`)),
            get(ref(db, `users/${uid}/hasRecentGameWin`)),
            get(ref(db, `users/${uid}/lastGameWinAt`)),
          ]);
          return { shopSnap, recentWinSnap, lastWinSnap };
        })),
      ]);

      const missing = [];
      batch.forEach((uid, i) => {
        const identity = identities?.get?.(uid);
        if (!identity) { missing.push(uid); return; } // not mirrored yet → per-uid fallback

        const role = roles?.get?.(uid);
        const roblox = robloxes?.get?.(uid);
        const cosBadge = cosmeticsBadges?.get?.(uid);
        const extras = rtdbExtras?.[i]?.status === 'fulfilled' ? rtdbExtras[i].value : null;
        const cosmetics = extractCosmetics(extras?.shopSnap?.exists() ? extras.shopSnap.val() : null);

        setCachedProfile(uid, {
          displayName: identity.displayName ?? 'Anonymous',
          avatar: identity.avatar ?? null,
          isPro: !!cosBadge?.isPro,
          robloxUsernameVerified: !!roblox?.robloxUsernameVerified,
          hasRecentGameWin: !!(extras?.recentWinSnap?.exists() && extras.recentWinSnap.val()),
          lastGameWinAt: extras?.lastWinSnap?.exists() ? extras.lastWinSnap.val() : null,
          isAdmin: !!role?.isAdmin,
          isSeniorMod: !!role?.isSeniorMod,
          isModerator: !!role?.isModerator,
          isBabyMod: !!role?.isBabyMod,
          isTrusted: !!role?.isTrusted,
          isGrinder: !!role?.isGrinder,
          isRaider: !!role?.isRaider,
          topBadge: cosBadge?.topBadge ?? null,
          ...cosmetics,
        });
      });

      // Users with no Supabase identity row yet fall back to the per-uid
      // path (which itself falls back to RTDB per-field reads).
      if (missing.length > 0) {
        await Promise.allSettled(missing.map(uid => getOrFetchProfile(db, uid)));
      }
      return;
    } catch (e) {
      // Batched path failed (network blip, JWT race) → per-uid fallback below.
    }
  }

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
    isSeniorMod: !!msg.isSeniorMod,
    isModerator: !!msg.isModerator,
    isBabyMod: !!msg.isBabyMod,
    isTrusted: !!msg.isTrusted,
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
  isAdmin: false, isSeniorMod: false, isModerator: false, isBabyMod: false, isTrusted: false, isGrinder: false, isRaider: false,
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
    isSeniorMod: msg.isSeniorMod ?? cached?.isSeniorMod ?? false,
    isModerator: msg.isModerator ?? cached?.isModerator ?? false,
    isBabyMod: msg.isBabyMod ?? cached?.isBabyMod ?? false,
    isTrusted: msg.isTrusted ?? cached?.isTrusted ?? false,
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
    isSeniorMod: !!user.isSeniorMod,
    isModerator: !!user.isModerator,
    isBabyMod: !!user.isBabyMod,
    isTrusted: !!user.isTrusted,
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
