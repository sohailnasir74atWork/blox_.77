/**
 * xpUtils.js
 * XP & Level System — Universal progression for the Blox Fruit app.
 *
 * Every action earns XP → XP determines level → levels unlock cosmetics.
 * Uses RTDB increment() for atomic, non-blocking writes.
 *
 * RTDB structure:
 *   users/{uid}/xp/total: 4520
 *   users/{uid}/xp/level: 12
 */

import { ref, increment, update, get } from '@react-native-firebase/database';

// ────────────────────────────────────────────────────────
//  LEVEL TABLE
// ────────────────────────────────────────────────────────
const LEVELS = [
  { level: 1,  xp: 0,       title: 'Rookie',       emoji: '🌊' },
  { level: 2,  xp: 200,     title: 'Apprentice',   emoji: '⚓' },
  { level: 3,  xp: 500,     title: 'Sailor',       emoji: '🚢' },
  { level: 5,  xp: 1200,    title: 'Explorer',     emoji: '🌿',  unlock: 'greenName' },
  { level: 7,  xp: 2500,    title: 'Adventurer',   emoji: '🏴‍☠️' },
  { level: 10, xp: 5000,    title: 'Collector',    emoji: '🌟',  unlock: 'bounty_hunter' },
  { level: 12, xp: 8000,    title: 'Veteran',      emoji: '🔥' },
  { level: 15, xp: 12000,   title: 'Trader Pro',   emoji: '💼',  unlock: 'trade_pirate' },
  { level: 18, xp: 18000,   title: 'Expert',       emoji: '💎' },
  { level: 20, xp: 25000,   title: 'Rising Star',  emoji: '⭐',  unlock: 'sea_legend' },
  { level: 23, xp: 35000,   title: 'Master',       emoji: '🏆' },
  { level: 25, xp: 50000,   title: 'Legend',       emoji: '👑',  unlock: 'rainbowName' },
  { level: 28, xp: 75000,   title: 'Elite',        emoji: '🦅' },
  { level: 30, xp: 100000,  title: 'Mythic',       emoji: '🐉',  unlock: 'mythic_aura' },
];

// ────────────────────────────────────────────────────────
//  XP ACTIONS & AMOUNTS
// ────────────────────────────────────────────────────────
export const XP_ACTIONS = {
  DAILY_LOGIN:       50,
  COMPLETE_TRADE:    25,
  CREATE_POST:       20,
  LEAVE_REVIEW:      30,
  UPDATE_FRUITS:     10,
  STREAK_7_DAY:      200,
  POST_STATUS:       15,
  FRUIT_CRASH:       10, // per cashout, scales by multiplier in-game
};

// ────────────────────────────────────────────────────────
//  GET LEVEL FROM XP
// ────────────────────────────────────────────────────────
export const getLevelFromXP = (xp) => {
  if (!xp || xp < 0) return LEVELS[0];
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (xp >= lvl.xp) current = lvl;
    else break;
  }
  return current;
};

// ────────────────────────────────────────────────────────
//  GET NEXT LEVEL INFO (for progress bar)
// ────────────────────────────────────────────────────────
export const getNextLevel = (xp) => {
  if (!xp || xp < 0) return LEVELS[1] || LEVELS[0];
  for (const lvl of LEVELS) {
    if (xp < lvl.xp) return lvl;
  }
  return LEVELS[LEVELS.length - 1]; // Max level
};

// ────────────────────────────────────────────────────────
//  GET XP PROGRESS (0 to 1) for current level
// ────────────────────────────────────────────────────────
export const getXPProgress = (xp) => {
  const current = getLevelFromXP(xp);
  const next = getNextLevel(xp);
  if (current.level === next.level) return 1; // Max level
  const required = next.xp - current.xp;
  const earned = xp - current.xp;
  return Math.min(1, Math.max(0, earned / required));
};

// ────────────────────────────────────────────────────────
//  GET ALL UNLOCKS for a given level
// ────────────────────────────────────────────────────────
export const getUnlocks = (level) => {
  return LEVELS
    .filter(l => l.level <= level && l.unlock)
    .map(l => l.unlock);
};

// ────────────────────────────────────────────────────────
//  ADD XP — fire-and-forget, non-blocking
//  Uses increment() for atomic writes
// ────────────────────────────────────────────────────────
export const addXP = async (db, uid, amount, action = null) => {
  if (!db || !uid || !amount || amount <= 0) return;

  try {
    const xpRef = ref(db, `users/${uid}/xp`);

    // 1. Atomic increment (always — 1 write only)
    await update(xpRef, {
      total: increment(amount),
    });

    // Skip level recalculation for small XP gains
    if (amount < 10) {
      return null;
    }

    // 2. Read new total & recalculate level
    const snap = await get(ref(db, `users/${uid}/xp/total`));
    const newTotal = snap.val() || 0;
    const newLevel = getLevelFromXP(newTotal);

    // 3. Update level if changed
    await update(xpRef, {
      level: newLevel.level,
    });

    return { total: newTotal, level: newLevel };
  } catch (err) {
    console.warn('[XP] addXP error:', err?.message);
    return null;
  }
};

// ────────────────────────────────────────────────────────
//  GET USER XP DATA
// ────────────────────────────────────────────────────────
export const getUserXP = async (db, uid) => {
  if (!db || !uid) return { total: 0, level: 1 };
  try {
    const snap = await get(ref(db, `users/${uid}/xp`));
    if (!snap.exists()) return { total: 0, level: 1 };
    const data = snap.val();
    return {
      total: data.total || 0,
      level: data.level || getLevelFromXP(data.total || 0).level,
    };
  } catch {
    return { total: 0, level: 1 };
  }
};

// Export LEVELS for UI
export { LEVELS };
