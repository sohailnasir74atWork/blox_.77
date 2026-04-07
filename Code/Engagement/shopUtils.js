/**
 * shopUtils.js — XP Shop Purchase & Cosmetic Logic
 * 📅 2026-03-13: Created for Mystery Fruit / XP Shop system
 *
 * Handles: XP spending, fruit purchases, random reward rolling,
 * active cosmetic retrieval, and expiry management.
 * Note: Function names like purchaseEgg kept for backward compatibility with DB.
 */

import { ref, get, update, push, set, increment } from '@react-native-firebase/database';
import { updateMyCosmeticType } from '../Helper/cosmeticsCache';
import { EGGS, ALL_ITEMS, COSMETIC_TYPE, getItemsByRarity } from './shopItems';
import { spendStars } from './starUtils';

// ════════════════════════════════════════════════════════════
//  SPEND XP — Atomic decrement with balance check (UNUSED NOW, but kept for legacy)
// ════════════════════════════════════════════════════════════
export const spendXP = async (db, uid, amount) => {
  if (!db || !uid || !amount || amount <= 0) {
    return { success: false, error: 'Invalid parameters' };
  }

  try {
    const totalRef = ref(db, `users/${uid}/xp/total`);
    const snap = await get(totalRef);
    const currentTotal = snap.val() || 0;

    if (currentTotal < amount) {
      return { success: false, error: 'Insufficient XP', currentTotal };
    }

    // Atomic decrement
    await update(ref(db, `users/${uid}/xp`), {
      total: increment(-amount),
    });

    const newTotal = currentTotal - amount;
    return { success: true, newTotal };
  } catch (err) {
    console.warn('[Shop] spendXP error:', err?.message);
    return { success: false, error: err?.message };
  }
};

// ════════════════════════════════════════════════════════════
//  ROLL REWARD — Weighted random from egg's drop table
// ════════════════════════════════════════════════════════════
export const rollReward = (eggId) => {
  const egg = EGGS[eggId];
  if (!egg) return null;

  const { dropTable } = egg;

  // 1. Pick rarity based on weights
  const totalWeight = Object.values(dropTable).reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * totalWeight;
  let selectedRarity = null;

  for (const [rarity, weight] of Object.entries(dropTable)) {
    roll -= weight;
    if (roll <= 0) {
      selectedRarity = rarity;
      break;
    }
  }

  if (!selectedRarity) {
    // Fallback to first non-zero rarity
    selectedRarity = Object.entries(dropTable).find(([, w]) => w > 0)?.[0] || 'common';
  }

  // 2. Get all items of that rarity
  const items = getItemsByRarity(selectedRarity);
  if (items.length === 0) {
    // Fallback: try one rarity lower
    const rarityOrder = ['common', 'uncommon', 'rare', 'legendary', 'exclusive'];
    const idx = rarityOrder.indexOf(selectedRarity);
    for (let i = idx - 1; i >= 0; i--) {
      const fallbackItems = getItemsByRarity(rarityOrder[i]);
      if (fallbackItems.length > 0) {
        return fallbackItems[Math.floor(Math.random() * fallbackItems.length)];
      }
    }
    return null;
  }

  // 3. Pick random item from that rarity pool
  return items[Math.floor(Math.random() * items.length)];
};

// ════════════════════════════════════════════════════════════
//  PURCHASE EGG — Full flow: validate → spend stars → roll → save
// ════════════════════════════════════════════════════════════
export const purchaseEgg = async (db, uid, eggId) => {
  if (!db || !uid || !eggId) {
    return { success: false, error: 'Invalid parameters' };
  }

  const egg = EGGS[eggId];
  if (!egg) {
    return { success: false, error: 'Unknown egg type' };
  }

  // 1. Spend Stars
  const spendResult = await spendStars(db, uid, egg.cost);
  if (!spendResult.success) {
    return { success: false, error: spendResult.error, currentBalance: spendResult.currentBalance };
  }

  // 2. Roll reward
  const reward = rollReward(eggId);
  if (!reward) {
    // Refund stars if roll fails (shouldn't happen)
    await update(ref(db, `users/${uid}/dailyStars`), {
      starBalance: increment(egg.cost),
    });
    return { success: false, error: 'Failed to generate reward' };
  }

  // 3. Calculate expiry
  const now = Date.now();
  const expiresAt = reward.duration === -1
    ? -1 // permanent
    : now + (reward.duration * 24 * 60 * 60 * 1000);

  // 4. Check if user already has this cosmetic active → extend duration
  const existingRef = ref(db, `users/${uid}/shop/activeItems/${reward.type}`);
  const existingSnap = await get(existingRef);
  let finalExpiresAt = expiresAt;

  if (existingSnap.exists()) {
    const existing = existingSnap.val();
    if (existing.id === reward.id && existing.expiresAt !== -1 && expiresAt !== -1) {
      // Extend: add remaining time + new duration
      const remainingMs = Math.max(0, existing.expiresAt - now);
      finalExpiresAt = now + remainingMs + (reward.duration * 24 * 60 * 60 * 1000);
    }
  }

  // 5. Save as active item
  const activeItemData = {
    id: reward.id,
    name: reward.name,
    rarity: reward.rarity,
    activatedAt: now,
    expiresAt: finalExpiresAt,
  };

  // Add type-specific data
  if (reward.type === COSMETIC_TYPE.TEXT_COLOR) {
    activeItemData.color = reward.color;
  }
  if (reward.type === COSMETIC_TYPE.FRAME) {
    activeItemData.borderColors = reward.borderColors;
    activeItemData.borderWidth = reward.borderWidth;
    activeItemData.glowColor = reward.glowColor || null;
  }
  if (reward.type === COSMETIC_TYPE.TRADE_BG) {
    activeItemData.color = reward.color;
    activeItemData.darkColor = reward.darkColor;
  }
  if (reward.type === COSMETIC_TYPE.BANNER) {
    activeItemData.gradient = reward.gradient;
  }
  if (reward.type === COSMETIC_TYPE.CHAT_BG) {
    activeItemData.color = reward.color;
    activeItemData.darkColor = reward.darkColor;
  }

  await set(existingRef, activeItemData);
  // ✅ Update MMKV cache instantly after purchase
  updateMyCosmeticType(reward.type, activeItemData);

  // 6. Save to inventory history
  const inventoryRef = push(ref(db, `users/${uid}/shop/inventory`));
  await set(inventoryRef, {
    itemId: reward.id,
    itemName: reward.name,
    type: reward.type,
    rarity: reward.rarity,
    eggSource: eggId,
    purchasedAt: now,
    expiresAt: finalExpiresAt,
    xpCost: 0, // legacy field
    starCost: egg.cost,
  });

  // 7b. Save to ownedItems per-type list (for inventory UI)
  const ownedData = { ...activeItemData, type: reward.type };
  // Add type-specific props not in activeItemData
  if (reward.type === COSMETIC_TYPE.TEXT_COLOR) ownedData.color = reward.color;
  if (reward.type === COSMETIC_TYPE.TRADE_BG) { ownedData.color = reward.color; ownedData.darkColor = reward.darkColor; }
  if (reward.type === COSMETIC_TYPE.BANNER) ownedData.gradient = reward.gradient;
  if (reward.type === COSMETIC_TYPE.CHAT_BG) { ownedData.color = reward.color; ownedData.darkColor = reward.darkColor; }
  const ownedRef = push(ref(db, `users/${uid}/shop/ownedItems/${reward.type}`));
  await set(ownedRef, ownedData);

  // 7. Update stats
  await update(ref(db, `users/${uid}/shop/stats`), {
    totalEggsOpened: increment(1),
    totalStarsSpent: increment(egg.cost),
  });

  return {
    success: true,
    reward: { ...reward, expiresAt: finalExpiresAt },
    newBalance: spendResult.newBalance,
    eggUsed: egg,
  };
};

// ════════════════════════════════════════════════════════════
//  GET ACTIVE COSMETICS — Returns non-expired active items
// ════════════════════════════════════════════════════════════
export const getActiveCosmetics = async (db, uid) => {
  if (!db || !uid) return { profileFrame: null, chatTextColor: null, tradeCardBg: null, profileBanner: null, chatBubbleBg: null };

  try {
    const snap = await get(ref(db, `users/${uid}/shop/activeItems`));
    if (!snap.exists()) return { profileFrame: null, chatTextColor: null, tradeCardBg: null, profileBanner: null, chatBubbleBg: null };

    const items = snap.val();
    const now = Date.now();
    const result = { profileFrame: null, chatTextColor: null, tradeCardBg: null, profileBanner: null, chatBubbleBg: null };

    // Check profile frame
    if (items.profileFrame) {
      if (items.profileFrame.expiresAt === -1 || items.profileFrame.expiresAt > now) {
        result.profileFrame = items.profileFrame;
      } else {
        await set(ref(db, `users/${uid}/shop/activeItems/profileFrame`), null);
      }
    }

    // Check chat text color
    if (items.chatTextColor) {
      if (items.chatTextColor.expiresAt === -1 || items.chatTextColor.expiresAt > now) {
        result.chatTextColor = items.chatTextColor;
      } else {
        await set(ref(db, `users/${uid}/shop/activeItems/chatTextColor`), null);
      }
    }

    // Check trade card bg
    if (items.tradeCardBg) {
      if (items.tradeCardBg.expiresAt === -1 || items.tradeCardBg.expiresAt > now) {
        result.tradeCardBg = items.tradeCardBg;
      } else {
        await set(ref(db, `users/${uid}/shop/activeItems/tradeCardBg`), null);
      }
    }

    // Check profile banner
    if (items.profileBanner) {
      if (items.profileBanner.expiresAt === -1 || items.profileBanner.expiresAt > now) {
        result.profileBanner = items.profileBanner;
      } else {
        await set(ref(db, `users/${uid}/shop/activeItems/profileBanner`), null);
      }
    }

    // Check chat bubble bg
    if (items.chatBubbleBg) {
      if (items.chatBubbleBg.expiresAt === -1 || items.chatBubbleBg.expiresAt > now) {
        result.chatBubbleBg = items.chatBubbleBg;
      } else {
        await set(ref(db, `users/${uid}/shop/activeItems/chatBubbleBg`), null);
      }
    }

    return result;
  } catch (err) {
    console.warn('[Shop] getActiveCosmetics error:', err?.message);
    return { profileFrame: null, chatTextColor: null, tradeCardBg: null, profileBanner: null, chatBubbleBg: null };
  }
};

// ════════════════════════════════════════════════════════════
//  GET SHOP STATS — Total eggs opened, XP spent
// ════════════════════════════════════════════════════════════
export const getShopStats = async (db, uid) => {
  if (!db || !uid) return { totalEggsOpened: 0, totalXPSpent: 0, totalStarsSpent: 0 };

  try {
    const snap = await get(ref(db, `users/${uid}/shop/stats`));
    if (!snap.exists()) return { totalEggsOpened: 0, totalXPSpent: 0, totalStarsSpent: 0 };
    const data = snap.val();
    return {
      totalEggsOpened: data.totalEggsOpened || 0,
      totalXPSpent: data.totalXPSpent || 0,
      totalStarsSpent: data.totalStarsSpent || 0,
    };
  } catch {
    return { totalEggsOpened: 0, totalXPSpent: 0, totalStarsSpent: 0 };
  }
};

// ════════════════════════════════════════════════════════════
//  HELPER: Check if item is expired
// ════════════════════════════════════════════════════════════
export const isItemExpired = (item) => {
  if (!item) return true;
  if (item.expiresAt === -1) return false; // permanent
  return Date.now() > item.expiresAt;
};

// ════════════════════════════════════════════════════════════
//  HELPER: Format remaining time for UI
// ════════════════════════════════════════════════════════════
export const formatTimeRemaining = (expiresAt) => {
  if (expiresAt === -1) return 'Permanent ✨';

  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return 'Expired';

  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  if (days > 0) return `${days}d ${remainingHours}h`;
  if (hours > 0) return `${hours}h`;
  const minutes = Math.floor(remaining / (1000 * 60));
  return `${minutes}m`;
};

// ════════════════════════════════════════════════════════════
//  GET INVENTORY — All non-expired owned items, grouped by type
// ════════════════════════════════════════════════════════════
export const getInventory = async (db, uid) => {
  if (!db || !uid) return {};

  try {
    const now = Date.now();
    const result = {};

    // Helper to add item to result, avoiding duplicates by id
    const addItem = (type, item, key) => {
      if (!item || !type) return;
      if (item.expiresAt !== -1 && item.expiresAt <= now) return; // expired
      if (!result[type]) result[type] = [];
      // Avoid duplicates
      const exists = result[type].some(i => i.id === item.id);
      if (!exists) {
        result[type].push({ ...item, _key: key, type });
      }
    };

    // 1. Pull from ownedItems (new system)
    const ownedSnap = await get(ref(db, `users/${uid}/shop/ownedItems`));
    if (ownedSnap.exists()) {
      const items = ownedSnap.val();
      Object.entries(items).forEach(([type, typeItems]) => {
        if (!typeItems || typeof typeItems !== 'object') return;
        Object.entries(typeItems).forEach(([key, item]) => {
          addItem(type, item, key);
        });
      });
    }

    // 2. Also pull from activeItems (legacy — items won before ownedItems existed)
    const activeSnap = await get(ref(db, `users/${uid}/shop/activeItems`));
    if (activeSnap.exists()) {
      const activeItems = activeSnap.val();
      const typeMap = {
        profileFrame: 'profileFrame',
        chatTextColor: 'chatTextColor',
        tradeCardBg: 'tradeCardBg',
        profileBanner: 'profileBanner',
        chatBubbleBg: 'chatBubbleBg',
      };
      Object.entries(activeItems).forEach(([type, item]) => {
        if (item && typeMap[type]) {
          addItem(type, item, `active_${type}`);
        }
      });
    }

    return result;
  } catch (err) {
    console.warn('[Shop] getInventory error:', err?.message);
    return {};
  }
};

// ════════════════════════════════════════════════════════════
//  ACTIVATE ITEM — Switch active cosmetic to a specific owned item
// ════════════════════════════════════════════════════════════
export const activateItem = async (db, uid, type, itemData) => {
  if (!db || !uid || !type || !itemData) return false;

  try {
    const activeRef = ref(db, `users/${uid}/shop/activeItems/${type}`);

    // Look up full item definition to ensure all properties are included
    const fullDef = ALL_ITEMS[itemData.id] || {};

    const data = {
      id: itemData.id,
      name: itemData.name || fullDef.name,
      rarity: itemData.rarity || fullDef.rarity,
      activatedAt: Date.now(),
      expiresAt: itemData.expiresAt,
    };

    // Merge type-specific properties from both itemData AND full definition
    if (itemData.color !== undefined || fullDef.color !== undefined) data.color = itemData.color || fullDef.color;
    if (itemData.darkColor !== undefined || fullDef.darkColor !== undefined) data.darkColor = itemData.darkColor || fullDef.darkColor;
    if (itemData.borderColors || fullDef.borderColors) data.borderColors = itemData.borderColors || fullDef.borderColors;
    if (itemData.borderWidth || fullDef.borderWidth) data.borderWidth = itemData.borderWidth || fullDef.borderWidth;
    if (itemData.glowColor !== undefined || fullDef.glowColor !== undefined) data.glowColor = itemData.glowColor ?? fullDef.glowColor ?? null;
    if (itemData.gradient || fullDef.gradient) data.gradient = itemData.gradient || fullDef.gradient;

    await set(activeRef, data);
    // ✅ Update MMKV cache instantly — no need for DB round-trip
    updateMyCosmeticType(type, data);
    return true;
  } catch (err) {
    console.warn('[Shop] activateItem error:', err?.message);
    return false;
  }
};

// ════════════════════════════════════════════════════════════
//  DEACTIVATE ITEM — Remove active cosmetic (back to default)
// ════════════════════════════════════════════════════════════
export const deactivateItem = async (db, uid, type) => {
  if (!db || !uid || !type) return false;

  try {
    await set(ref(db, `users/${uid}/shop/activeItems/${type}`), null);
    // ✅ Update MMKV cache instantly
    updateMyCosmeticType(type, null);
    return true;
  } catch (err) {
    console.warn('[Shop] deactivateItem error:', err?.message);
    return false;
  }
};
