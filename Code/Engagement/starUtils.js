/**
 * starUtils.js
 * Daily Star Rewards — streak-based login reward system.
 *
 * RTDB structure:
 *   users/{uid}/dailyStars/
 *     ├── currentDay: 4          (1-7)
 *     ├── cycleNumber: 2         (resets to 1 after Day 7)
 *     ├── lastClaimDate: "2026-03-11"
 *     └── totalStarsEarned: 25
 */

import { ref, get, update, increment } from '@react-native-firebase/database';
import { addXP } from './xpUtils';

// ────────────────────────────────────────────────────────
//  DAILY REWARDS TABLE
// ────────────────────────────────────────────────────────
export const DAILY_REWARDS = [
  { day: 1, xp: 50,  stars: 1, label: '1 ⭐',  emoji: '⭐', description: 'Welcome back!' },
  { day: 2, xp: 75,  stars: 1, label: '1 ⭐',  emoji: '⭐', description: 'Keep going!' },
  { day: 3, xp: 100, stars: 2, label: '2 ⭐',  emoji: '🌟', description: 'Hat trick!' },
  { day: 4, xp: 150, stars: 2, label: '2 ⭐',  emoji: '🌟', description: 'On fire!' },
  { day: 5, xp: 200, stars: 3, label: '3 ⭐',  emoji: '💫', description: 'Halfway hero!' },
  { day: 6, xp: 300, stars: 3, label: '3 ⭐',  emoji: '💫', description: 'Almost there!' },
  { day: 7, xp: 500, stars: 5, label: '5 ⭐',  emoji: '🎁', description: 'Jackpot Day!' },
];

// ────────────────────────────────────────────────────────
//  GET TODAY'S DATE STRING (YYYY-MM-DD)
// ────────────────────────────────────────────────────────
const getToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getYesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ────────────────────────────────────────────────────────
//  CHECK STAR STATUS — returns current state without claiming
// ────────────────────────────────────────────────────────
export const getStarStatus = async (db, uid) => {
  if (!db || !uid) return { canClaim: false, currentDay: 1, cycleNumber: 1 };

  try {
    const snap = await get(ref(db, `users/${uid}/dailyStars`));
    const data = snap.exists() ? snap.val() : null;

    if (!data) {
      return { canClaim: true, currentDay: 1, cycleNumber: 1, totalStarsEarned: 0, isNew: true };
    }

    const today = getToday();
    const yesterday = getYesterday();

    if (data.lastClaimDate === today) {
      return {
        canClaim: false,
        currentDay: data.currentDay || 1,
        cycleNumber: data.cycleNumber || 1,
        totalStarsEarned: data.totalStarsEarned || 0,
      };
    }

    if (data.lastClaimDate === yesterday) {
      const nextDay = ((data.currentDay || 0) % 7) + 1;
      const nextCycle = nextDay === 1 ? (data.cycleNumber || 1) + 1 : (data.cycleNumber || 1);
      return {
        canClaim: true,
        currentDay: nextDay,
        cycleNumber: nextCycle,
        totalStarsEarned: data.totalStarsEarned || 0,
      };
    }

    // Streak broken — reset to Day 1
    return {
      canClaim: true,
      currentDay: 1,
      cycleNumber: data.cycleNumber || 1,
      totalStarsEarned: data.totalStarsEarned || 0,
      streakBroken: true,
    };
  } catch (err) {
    console.warn('[starUtils] getStarStatus error:', err?.message);
    return { canClaim: false, currentDay: 1, cycleNumber: 1 };
  }
};

// ────────────────────────────────────────────────────────
//  CLAIM TODAY'S STAR — awards XP and returns reward info
// ────────────────────────────────────────────────────────
export const claimDailyStar = async (db, uid) => {
  if (!db || !uid) return null;

  try {
    const status = await getStarStatus(db, uid);
    if (!status.canClaim) return null;

    const reward = DAILY_REWARDS.find(r => r.day === status.currentDay) || DAILY_REWARDS[0];

    // Update RTDB
    await update(ref(db, `users/${uid}/dailyStars`), {
      currentDay: status.currentDay,
      cycleNumber: status.cycleNumber,
      lastClaimDate: getToday(),
      totalStarsEarned: increment(reward.stars || 1),
      starBalance: increment(reward.stars || 1),
    });

    // Award XP
    await addXP(db, uid, reward.xp);

    return {
      ...reward,
      currentDay: status.currentDay,
      cycleNumber: status.cycleNumber,
    };
  } catch (err) {
    console.warn('[starUtils] claimDailyStar error:', err?.message);
    return null;
  }
};

// ────────────────────────────────────────────────────────
//  STAR BALANCE & SPENDING
// ────────────────────────────────────────────────────────
export const getStarBalance = async (db, uid) => {
  if (!db || !uid) return 0;
  try {
    const snap = await get(ref(db, `users/${uid}/dailyStars`));
    if (!snap.exists()) return 0;
    const data = snap.val();

    if (data.starBalance === undefined && data.totalStarsEarned > 0) {
      const seeded = data.totalStarsEarned;
      await update(ref(db, `users/${uid}/dailyStars`), { starBalance: seeded });
      return seeded;
    }

    return data.starBalance || 0;
  } catch (err) {
    console.warn('[starUtils] getStarBalance error:', err?.message);
    return 0;
  }
};

export const spendStars = async (db, uid, amount) => {
  if (!db || !uid || !amount || amount <= 0) {
    return { success: false, error: 'Invalid parameters' };
  }

  try {
    const balanceRef = ref(db, `users/${uid}/dailyStars/starBalance`);
    const snap = await get(balanceRef);
    const currentBalance = snap.val() || 0;

    if (currentBalance < amount) {
      return { success: false, error: 'Not enough Stars', currentBalance };
    }

    await update(ref(db, `users/${uid}/dailyStars`), {
      starBalance: increment(-amount),
    });

    return { success: true, newBalance: currentBalance - amount };
  } catch (err) {
    console.warn('[starUtils] spendStars error:', err?.message);
    return { success: false, error: err?.message };
  }
};
