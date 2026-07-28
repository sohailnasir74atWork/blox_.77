/**
 * Badge System — Centralized definitions & check functions
 * Phase 1: OG, Newbie, First Post, First Trade
 * Phase 2+: Chatty, Star Trader, Reviewer, Loved, On Fire, Diamond, Influencer, 5-Star
 * Extended with: Fruit Parent, Quiz Master, Memory King, Night Owl, Streak Master, etc.
 */

import { getServerTime, getServerTimeQuick } from '../../Helper/serverTime';

export const BADGE_DEFINITIONS = {
  // -- Phase 1 --
  newbie: {
    id: 'newbie',
    name: 'Newbie',
    emoji: '🐣',
    color: '#fbbf24',
    bgLight: 'rgba(251,191,36,0.1)',
    bgDark: 'rgba(251,191,36,0.15)',
    description: 'Welcome to the community!',
    hint: 'Auto-earned in your first 7 days',
    tier: 1,
    phase: 1,
  },
  firstPost: {
    id: 'firstPost',
    name: 'Post',
    emoji: '📸',
    color: '#8b5cf6',
    bgLight: 'rgba(139,92,246,0.1)',
    bgDark: 'rgba(139,92,246,0.15)',
    description: 'Posted for the first time!',
    hint: 'Create your first post in the Feed',
    tier: 1,
    phase: 1,
  },
  firstTrade: {
    id: 'firstTrade',
    name: 'Trade',
    emoji: '🤝',
    color: '#10b981',
    bgLight: 'rgba(16,185,129,0.1)',
    bgDark: 'rgba(16,185,129,0.15)',
    description: 'Completed first trade!',
    hint: 'Complete 5 trades',
    tier: 1,
    phase: 1,
  },
  og: {
    id: 'og',
    name: 'OG',
    emoji: '🦄',
    color: '#ec4899',
    bgLight: 'rgba(236,72,153,0.1)',
    bgDark: 'rgba(236,72,153,0.15)',
    description: 'A true original!',
    hint: 'Be a member for 6+ months',
    tier: 3,
    phase: 1,
  },

  // -- Phase 2 --
  starTrader: {
    id: 'starTrader',
    name: 'Star Trader',
    emoji: '🌟',
    color: '#f59e0b',
    bgLight: 'rgba(245,158,11,0.1)',
    bgDark: 'rgba(245,158,11,0.15)',
    description: 'Trading master in the making!',
    hint: 'Complete 25+ trades',
    tier: 2,
    phase: 2,
  },
  loved: {
    id: 'loved',
    name: 'Loved',
    emoji: '❤️',
    color: '#ec4899',
    bgLight: 'rgba(236,72,153,0.1)',
    bgDark: 'rgba(236,72,153,0.15)',
    description: 'Everyone loves their content!',
    hint: 'Get 100+ reactions on your posts',
    tier: 2,
    phase: 2,
  },
  reviewer: {
    id: 'reviewer',
    name: 'Reviewer',
    emoji: '📝',
    color: '#6366f1',
    bgLight: 'rgba(99,102,241,0.1)',
    bgDark: 'rgba(99,102,241,0.15)',
    description: 'Helpful community reviewer!',
    hint: 'Leave 25+ reviews',
    tier: 2,
    phase: 2,
  },

  // -- Phase 3 --
  onFire: {
    id: 'onFire',
    name: 'On Fire',
    emoji: '🔥',
    color: '#ef4444',
    bgLight: 'rgba(239,68,68,0.1)',
    bgDark: 'rgba(239,68,68,0.15)',
    description: '14-day login streak!',
    hint: 'Log in 14 days in a row',
    tier: 2,
    phase: 3,
  },
  fruitParent: {
    id: 'fruitParent',
    name: 'Fruit Parent',
    emoji: '🍎',
    color: '#f97316',
    bgLight: 'rgba(249,115,22,0.1)',
    bgDark: 'rgba(249,115,22,0.15)',
    description: 'A true fruit collector!',
    hint: 'Add 50+ fruits to your profile',
    tier: 1,
    phase: 3,
  },
  socialBee: {
    id: 'socialBee',
    name: 'Social Bee',
    emoji: '🐝',
    color: '#eab308',
    bgLight: 'rgba(234,179,8,0.1)',
    bgDark: 'rgba(234,179,8,0.15)',
    description: 'Buzzing everywhere!',
    hint: 'Join 10+ group chats',
    tier: 1,
    phase: 3,
  },
  nightOwl: {
    id: 'nightOwl',
    name: 'Night Owl',
    emoji: '🦉',
    color: '#6366f1',
    bgLight: 'rgba(99,102,241,0.1)',
    bgDark: 'rgba(99,102,241,0.15)',
    description: 'Trading in the moonlight!',
    hint: 'Complete 15 trades after midnight',
    tier: 2,
    phase: 3,
  },
  // -- Phase 4 --
  diamondTrader: {
    id: 'diamondTrader',
    name: 'Diamond Trader',
    emoji: '💎',
    color: '#06b6d4',
    bgLight: 'rgba(6,182,212,0.1)',
    bgDark: 'rgba(6,182,212,0.15)',
    description: 'Elite trading legend!',
    hint: 'Complete 100+ trades',
    tier: 3,
    phase: 4,
  },
  influencer: {
    id: 'influencer',
    name: 'Influencer',
    emoji: '👑',
    color: '#a855f7',
    bgLight: 'rgba(168,85,247,0.1)',
    bgDark: 'rgba(168,85,247,0.15)',
    description: 'Community celebrity!',
    hint: 'Reach 200+ followers',
    tier: 3,
    phase: 4,
  },
  fiveStar: {
    id: 'fiveStar',
    name: '5-Star',
    emoji: '⭐',
    color: '#fbbf24',
    bgLight: 'rgba(251,191,36,0.1)',
    bgDark: 'rgba(251,191,36,0.15)',
    description: 'Top-rated community member!',
    hint: 'Maintain 4.5+ rating with 50+ reviews',
    tier: 3,
    phase: 4,
  },
  streakMaster: {
    id: 'streakMaster',
    name: 'Streak Master',
    emoji: '💪',
    color: '#dc2626',
    bgLight: 'rgba(220,38,38,0.1)',
    bgDark: 'rgba(220,38,38,0.15)',
    description: 'Unstoppable dedication!',
    hint: 'Reach a 60-day login streak',
    tier: 3,
    phase: 4,
  },
  centurion: {
    id: 'centurion',
    name: 'Centurion',
    emoji: '🏛️',
    color: '#b45309',
    bgLight: 'rgba(180,83,9,0.1)',
    bgDark: 'rgba(180,83,9,0.15)',
    description: '250 trades and counting!',
    hint: 'Complete 250+ trades',
    tier: 3,
    phase: 4,
  },
  popular: {
    id: 'popular',
    name: 'Popular',
    emoji: '📢',
    color: '#e11d48',
    bgLight: 'rgba(225,29,72,0.1)',
    bgDark: 'rgba(225,29,72,0.15)',
    description: 'Everyone loves your content!',
    hint: 'Get 500+ reactions on posts',
    tier: 3,
    phase: 4,
  },
  collector: {
    id: 'collector',
    name: 'Collector',
    emoji: '🗃️',
    color: '#0891b2',
    bgLight: 'rgba(8,145,178,0.1)',
    bgDark: 'rgba(8,145,178,0.15)',
    description: 'Ultimate fruit collection!',
    hint: 'Own 200+ fruits in your profile',
    tier: 3,
    phase: 4,
  },
};

// Badge images
export const BADGE_IMAGES = {
  newbie: require('../../Assets/badges/badge_newbie.png'),
  firstPost: require('../../Assets/badges/badge_firstPost.png'),
  firstTrade: require('../../Assets/badges/badge_firstTrade.png'),
  fruitParent: require('../../Assets/badges/badge_petParent.png'),
  socialBee: require('../../Assets/badges/badge_socialBee.png'),
  starTrader: require('../../Assets/badges/badge_starTrader.png'),
  loved: require('../../Assets/badges/badge_loved.png'),
  reviewer: require('../../Assets/badges/badge_reviewer.png'),
  onFire: require('../../Assets/badges/badge_onFire.png'),
  nightOwl: require('../../Assets/badges/badge_nightOwl.png'),
  og: require('../../Assets/badges/badge_og.png'),
  diamondTrader: require('../../Assets/badges/badge_diamondTrader.png'),
  influencer: require('../../Assets/badges/badge_influencer.png'),
  fiveStar: require('../../Assets/badges/badge_fiveStar.png'),
  streakMaster: require('../../Assets/badges/badge_streakMaster.png'),
  centurion: require('../../Assets/badges/badge_centurion.png'),
  popular: require('../../Assets/badges/badge_popular.png'),
  collector: require('../../Assets/badges/badge_collector.png'),
};

// Display order (hardest badges first)
export const BADGE_DISPLAY_ORDER = [
  'centurion', 'streakMaster', 'collector', 'popular',
  'influencer', 'diamondTrader', 'fiveStar', 'og',
  'nightOwl',
  'onFire', 'starTrader', 'loved', 'reviewer',
  'fruitParent', 'socialBee', 'firstPost', 'firstTrade', 'newbie',
];

// Top prestige badges shown as pills on collapsed profile
export const PILL_BADGES = [
  'centurion', 'streakMaster', 'collector', 'popular',
  'influencer', 'diamondTrader', 'fiveStar', 'og', 'onFire', 'starTrader',
];

/**
 * Check which badges a user has earned
 */
export const computeBadges = (userData = {}, savedBadges = {}) => {
  const now = getServerTimeQuick().getTime();
  const createdAt = userData.createdAt || userData.createdAtMs || 0;
  const accountAgeMs = createdAt > 0 ? now - createdAt : 0;

  const SIX_MONTHS = 180 * 24 * 60 * 60 * 1000;

  return {
    newbie: createdAt > 0,
    og: createdAt > 0 && accountAgeMs >= SIX_MONTHS,
    firstPost: !!savedBadges.firstPost,
    firstTrade: !!savedBadges.firstTrade,
    starTrader: !!savedBadges.starTrader,
    loved: !!savedBadges.loved,
    reviewer: !!savedBadges.reviewer,
    onFire: !!savedBadges.onFire,
    fruitParent: !!savedBadges.fruitParent,
    socialBee: !!savedBadges.socialBee,
    nightOwl: !!savedBadges.nightOwl,
    diamondTrader: !!savedBadges.diamondTrader,
    influencer: !!savedBadges.influencer,
    fiveStar: !!savedBadges.fiveStar,
    streakMaster: !!savedBadges.streakMaster,
    centurion: !!savedBadges.centurion,
    popular: !!savedBadges.popular,
    collector: !!savedBadges.collector,
  };
};

/**
 * Get user's highest-tier earned badge
 */
export const getTopBadge = (savedBadges = {}) => {
  if (!savedBadges || typeof savedBadges !== 'object') return null;
  for (const badgeId of BADGE_DISPLAY_ORDER) {
    if (savedBadges[badgeId]) return badgeId;
  }
  return null;
};

/**
 * Award a badge to a user
 */
export const awardBadge = async (database, userId, badgeId) => {
  if (!database || !userId || !badgeId) return;
  try {
    const { ref, set } = require('@react-native-firebase/database');
    await set(ref(database, `users/${userId}/badges/${badgeId}`), true);
  } catch (e) {
    console.warn('[Badges] Failed to award badge:', badgeId, e);
  }
};

/**
 * Increment a counter and award badge if threshold is met
 */
export const incrementAndCheckBadge = async (database, userId, counterName, thresholds = []) => {
  if (!database || !userId || !counterName) return;
  try {
    let badgeStore;
    try {
      const { createMMKV } = require('react-native-mmkv');
      badgeStore = createMMKV({ id: 'badge-cache' });
    } catch (e) {
      badgeStore = { getBoolean: () => undefined, set: () => {} };
    }

    const allEarned = thresholds.every(({ badgeId }) => {
      return badgeStore.getBoolean(`earned_${userId}_${badgeId}`) === true;
    });
    if (allEarned && thresholds.length > 0) return;

    const { ref, get, set, increment } = require('@react-native-firebase/database');
    const counterRef = ref(database, `users/${userId}/counters/${counterName}`);
    await set(counterRef, increment(1));
    const snap = await get(counterRef);
    const count = snap.exists() ? snap.val() : 0;

    for (const { count: threshold, badgeId } of thresholds) {
      if (badgeStore.getBoolean(`earned_${userId}_${badgeId}`)) continue;
      if (count >= threshold) {
        const badgeSnap = await get(ref(database, `users/${userId}/badges/${badgeId}`));
        if (!badgeSnap.exists() || !badgeSnap.val()) {
          await set(ref(database, `users/${userId}/badges/${badgeId}`), true);
        }
        badgeStore.set(`earned_${userId}_${badgeId}`, true);
      }
    }
  } catch (e) {
    console.warn('[Badges] Counter badge check failed:', counterName, e);
  }
};

/**
 * Award badges from an externally-maintained running count.
 *
 * Unlike incrementAndCheckBadge, this keeps NO counter of its own — pass the
 * authoritative total (e.g. tradeStats/{uid}.total, which the trade flow already
 * maintains) and it awards every threshold that's been crossed. Idempotent: only
 * writes a badge that isn't already set, so it's safe to call on every event.
 */
export const checkThresholdBadges = async (database, userId, count, thresholds = []) => {
  if (!database || !userId || typeof count !== 'number') return;
  try {
    // Same MMKV short-circuit as incrementAndCheckBadge: once a badge is earned,
    // later calls cost ZERO Firebase reads/writes (just a local flag check). This
    // is what keeps a 250+ trade veteran from re-reading badge nodes every trade.
    let badgeStore;
    try {
      const { createMMKV } = require('react-native-mmkv');
      badgeStore = createMMKV({ id: 'badge-cache' });
    } catch (e) {
      badgeStore = { getBoolean: () => undefined, set: () => {} };
    }

    const { ref, get, set } = require('@react-native-firebase/database');
    for (const { count: threshold, badgeId } of thresholds) {
      if (count < threshold) continue;                                    // not reached yet — no read
      if (badgeStore.getBoolean(`earned_${userId}_${badgeId}`)) continue; // already earned — no read
      const badgeSnap = await get(ref(database, `users/${userId}/badges/${badgeId}`));
      if (!badgeSnap.exists() || !badgeSnap.val()) {
        await set(ref(database, `users/${userId}/badges/${badgeId}`), true);
      }
      badgeStore.set(`earned_${userId}_${badgeId}`, true);
    }
  } catch (e) {
    console.warn('[Badges] Threshold badge check failed:', e);
  }
};

// Pre-defined threshold configs
export const TRADE_BADGE_THRESHOLDS = [
  { count: 5, badgeId: 'firstTrade' },
  { count: 25, badgeId: 'starTrader' },
  { count: 100, badgeId: 'diamondTrader' },
  { count: 250, badgeId: 'centurion' },
];

export const REVIEW_BADGE_THRESHOLDS = [
  { count: 25, badgeId: 'reviewer' },
];

export const REACTION_BADGE_THRESHOLDS = [
  { count: 100, badgeId: 'loved' },
  { count: 500, badgeId: 'popular' },
];


export const NIGHT_TRADE_BADGE_THRESHOLDS = [
  { count: 15, badgeId: 'nightOwl' },
];

export const GROUP_CHAT_BADGE_THRESHOLDS = [
  { count: 10, badgeId: 'socialBee' },
];

/**
 * Check and update daily login streak
 */
export const checkDailyStreak = async (database, userId) => {
  if (!database || !userId) return;
  try {
    const { ref, get, set } = require('@react-native-firebase/database');
    const streakRef = ref(database, `users/${userId}/streak`);
    const snap = await get(streakRef);
    const data = snap.exists() ? snap.val() : null;

    // Use probe-verified server time (immune to device clock changes)
    const now = await getServerTime(database, userId, true);
    const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

    if (data?.lastDate === todayStr) return;

    let newStreak = 1;
    if (data?.lastDate) {
      const yesterday = new Date(now);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterday.getUTCDate()).padStart(2, '0')}`;
      if (data.lastDate === yesterdayStr) {
        newStreak = (data.count || 0) + 1;
      }
    }

    await set(streakRef, { count: newStreak, lastDate: todayStr });

    if (newStreak >= 14) {
      const badgeSnap = await get(ref(database, `users/${userId}/badges/onFire`));
      if (!badgeSnap.exists() || !badgeSnap.val()) {
        await set(ref(database, `users/${userId}/badges/onFire`), true);
      }
    }

    if (newStreak >= 60) {
      const masterSnap = await get(ref(database, `users/${userId}/badges/streakMaster`));
      if (!masterSnap.exists() || !masterSnap.val()) {
        await set(ref(database, `users/${userId}/badges/streakMaster`), true);
      }
    }
  } catch (e) {
    console.warn('[Badges] Streak check failed:', e);
  }
};

/**
 * Check and award Influencer badge (200+ followers)
 */
export const checkInfluencerBadge = async (database, firestoreDB, followedUserId) => {
  if (!database || !firestoreDB || !followedUserId) return;
  try {
    // Earned-flag cache (same store as the other badges). Once this device has
    // seen followedUserId hit influencer, later follows skip BOTH the RTDB read
    // and the Firestore count query — zero ops on the common already-earned path.
    let badgeStore;
    try {
      const { createMMKV } = require('react-native-mmkv');
      badgeStore = createMMKV({ id: 'badge-cache' });
    } catch (e) {
      badgeStore = { getBoolean: () => undefined, set: () => {} };
    }
    if (badgeStore.getBoolean(`earned_${followedUserId}_influencer`)) return;

    const { ref, get, set } = require('@react-native-firebase/database');
    const { collection, query, where, getCountFromServer } = require('@react-native-firebase/firestore');

    const badgeSnap = await get(ref(database, `users/${followedUserId}/badges/influencer`));
    if (badgeSnap.exists() && badgeSnap.val()) {
      badgeStore.set(`earned_${followedUserId}_influencer`, true); // cache so next follow skips the read
      return;
    }

    const followersQuery = query(
      collection(firestoreDB, 'following'),
      where('followingId', '==', followedUserId)
    );
    const countSnap = await getCountFromServer(followersQuery);
    const followerCount = countSnap.data().count;

    if (followerCount >= 200) {
      await set(ref(database, `users/${followedUserId}/badges/influencer`), true);
      badgeStore.set(`earned_${followedUserId}_influencer`, true);
    }
  } catch (e) {
    console.warn('[Badges] Influencer check failed:', e);
  }
};

/**
 * Check Night Owl trade (logged 00:00–05:00 UTC).
 *
 * Cost note: this runs on EVERY trade, so it must not hit Firebase on the common
 * daytime path. It (1) short-circuits for free once the badge is earned, and
 * (2) reads the hour from the session-cached server offset (getServerTimeQuick,
 * zero DB ops) instead of forcing a write+read probe per trade. A cosmetic badge
 * doesn't warrant a probe on every trade; the offset is already warmed by the
 * daily-streak probe on app open, and worst case it falls back to device time.
 */
export const checkNightOwlTrade = async (database, userId) => {
  if (!database || !userId) return;
  try {
    let badgeStore;
    try {
      const { createMMKV } = require('react-native-mmkv');
      badgeStore = createMMKV({ id: 'badge-cache' });
    } catch (e) {
      badgeStore = { getBoolean: () => undefined };
    }
    if (badgeStore.getBoolean(`earned_${userId}_nightOwl`)) return; // already earned — no DB work

    const hour = getServerTimeQuick().getUTCHours();
    if (hour >= 0 && hour < 5) {
      await incrementAndCheckBadge(database, userId, 'nightTradeCount', NIGHT_TRADE_BADGE_THRESHOLDS);
    }
  } catch (e) {
    console.warn('[Badges] Night Owl check failed:', e);
  }
};

/**
 * Check Fruit Parent badge (50+ fruits)
 */
export const checkFruitParentBadge = async (database, userId, fruitCount) => {
  if (!database || !userId) return;
  try {
    if (fruitCount >= 50) {
      const { ref, get, set } = require('@react-native-firebase/database');
      const badgeSnap = await get(ref(database, `users/${userId}/badges/fruitParent`));
      if (!badgeSnap.exists() || !badgeSnap.val()) {
        await set(ref(database, `users/${userId}/badges/fruitParent`), true);
      }
    }
  } catch (e) {
    console.warn('[Badges] FruitParent check failed:', e);
  }
};

/**
 * Check Collector badge (200+ fruits)
 */
export const checkCollectorBadge = async (database, userId, fruitCount) => {
  if (!database || !userId) return;
  try {
    if (fruitCount >= 200) {
      const { ref, get, set } = require('@react-native-firebase/database');
      const badgeSnap = await get(ref(database, `users/${userId}/badges/collector`));
      if (!badgeSnap.exists() || !badgeSnap.val()) {
        await set(ref(database, `users/${userId}/badges/collector`), true);
      }
    }
  } catch (e) {
    console.warn('[Badges] Collector check failed:', e);
  }
};
