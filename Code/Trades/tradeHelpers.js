import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../Helper/Environment';
import { useTranslation } from 'react-i18next';
import { ref, set, remove, get, serverTimestamp as rtdbTimestamp } from '@react-native-firebase/database';
import { collection, addDoc, serverTimestamp as fsTimestamp } from '@react-native-firebase/firestore';

export const FilterMenu = ({ selectedFilters, setSelectedFilters, analytics, platform }) => {
  const { t } = useTranslation();

  const toggleFilter = (filterKey) => {
    setSelectedFilters((prevFilters) =>
      prevFilters.includes(filterKey)
        ? prevFilters.filter((f) => f !== filterKey)
        : [...prevFilters, filterKey]
    );
  };

  const filterOptions = [
    { key: "myTrades", label: t("trade.filter_my_trades") },
    { key: "win", label: "Win" },
    { key: "lose", label: "Lose" },
    { key: "fair", label: "Fair" },
  ];

  return (
    <View style={styles.container}>
      <Menu>
        <MenuTrigger>
          <Icon name="filter" size={24} color={styles.icon.color} />
        </MenuTrigger>
        <MenuOptions customStyles={{ optionsContainer: styles.menuOptions }}>
          {filterOptions.map(({ key, label }) => (
            <MenuOption key={key} onSelect={() => toggleFilter(key)} closeOnSelect={false}>
              <View style={styles.menuRow}>
                <Text style={[styles.menuOptionText, selectedFilters.includes(key) && styles.selectedText]}>
                  {label}
                </Text>
                {selectedFilters.includes(key) && (
                  <Icon name="checkmark" size={16} color={config.colors.hasBlockGreen} />
                )}
              </View>
            </MenuOption>
          ))}
        </MenuOptions>
      </Menu>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'flex-end', margin: 10 },
  icon: { color: 'grey' },
  menuOptions: {
    paddingHorizontal: 10,
    backgroundColor: 'white',
    borderRadius: 8,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  menuRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  menuOptionText: { fontSize: 16, color: 'black', paddingVertical: 10, },
  selectedText: { color: config.colors.hasBlockGreen, fontWeight: 'bold' },
});

// ═══════════════════════════════════════════════════
// TRADE ACCEPT / SAVE / PING UTILITIES
// ═══════════════════════════════════════════════════

const MAX_ACCEPTED = 10;
const MAX_SAVED = 10;

const _countByType = async (appdatabase, myUid, type) => {
  try {
    const snap = await get(ref(appdatabase, `savedTrades/${myUid}`));
    if (!snap.exists()) return 0;
    const all = snap.val();
    return Object.values(all).filter(v => v.type === type).length;
  } catch {
    return 0;
  }
};

/**
 * Accept a trade — saves lightweight ref to RTDB + creates Firestore notification for poster
 */
export const acceptTrade = async (appdatabase, firestoreDB, myUid, myName, trade, myExtras = {}) => {
  const count = await _countByType(appdatabase, myUid, 'accepted');
  if (count >= MAX_ACCEPTED) {
    throw new Error(`You can only have ${MAX_ACCEPTED} accepted trades at a time. Complete or remove some first.`);
  }

  const tradeId = trade.id;
  const tradeRef = ref(appdatabase, `savedTrades/${myUid}/${tradeId}`);

  await set(tradeRef, {
    type: 'accepted',
    traderId: trade.userId,
    traderName: trade.traderName || 'Unknown',
    traderRobloxUsername: trade.robloxUsername || '',
    savedAt: rtdbTimestamp(),
  });

  // Record this acceptance under the trade itself so the poster can see who accepted
  try {
    await set(ref(appdatabase, `tradeAcceptors/${tradeId}/${myUid}`), {
      name: myName,
      robloxUsername: myExtras.robloxUsername || '',
      avatar: myExtras.avatar || '',
      acceptedAt: rtdbTimestamp(),
    });
  } catch (e) {
    console.warn('[tradeHelpers] Failed to write tradeAcceptors:', e?.message);
  }

  const tradeSummary = _buildTradeSummary(trade);

  // Write notification to Firestore
  try {
    await addDoc(collection(firestoreDB, 'notifications'), {
      toUid: trade.userId,
      fromUid: myUid,
      fromName: myName,
      type: 'trade_accepted',
      tradeId: tradeId,
      message: `${myName} accepted your trade! ${tradeSummary}`,
      read: false,
      createdAt: fsTimestamp(),
    });
  } catch (e) {
    console.warn('[tradeHelpers] Failed to write accept notification:', e?.message);
  }
};

/**
 * Save/bookmark a trade
 */
export const saveTrade = async (appdatabase, myUid, trade) => {
  const count = await _countByType(appdatabase, myUid, 'saved');
  if (count >= MAX_SAVED) {
    throw new Error(`You can only save ${MAX_SAVED} trades at a time. Remove some first.`);
  }

  const tradeId = trade.id;
  const tradeRef = ref(appdatabase, `savedTrades/${myUid}/${tradeId}`);

  await set(tradeRef, {
    type: 'saved',
    traderId: trade.userId,
    traderName: trade.traderName || 'Unknown',
    traderRobloxUsername: trade.robloxUsername || '',
    savedAt: rtdbTimestamp(),
  });
};

/**
 * Remove a saved/accepted trade
 */
export const unsaveTrade = async (appdatabase, myUid, tradeId) => {
  const tradeRef = ref(appdatabase, `savedTrades/${myUid}/${tradeId}`);
  await remove(tradeRef);
  try {
    await remove(ref(appdatabase, `tradeAcceptors/${tradeId}/${myUid}`));
  } catch {}
};

const PING_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Ping a trader — "Are you available to trade?" notification
 */
export const pingTrader = async (appdatabase, firestoreDB, myUid, myName, trade) => {
  const tradeId = trade.id || trade.tradeId;
  const traderId = trade.userId || trade.traderId;

  if (appdatabase && tradeId) {
    try {
      const savedRef = ref(appdatabase, `savedTrades/${myUid}/${tradeId}/lastPingAt`);
      const snap = await get(savedRef);
      if (snap.exists()) {
        const lastPing = snap.val();
        const elapsed = Date.now() - lastPing;
        if (elapsed < PING_COOLDOWN_MS) {
          const remainingMins = Math.ceil((PING_COOLDOWN_MS - elapsed) / 60000);
          throw new Error(`Please wait ${remainingMins} more minute${remainingMins > 1 ? 's' : ''} before pinging again.`);
        }
      }
    } catch (e) {
      if (e.message?.includes('Please wait')) throw e;
    }
  }

  const tradeSummary = _buildTradeSummary(trade);

  await addDoc(collection(firestoreDB, 'notifications'), {
    toUid: traderId,
    fromUid: myUid,
    fromName: myName,
    type: 'trade_ping',
    tradeId: tradeId,
    message: `${myName} wants to trade with you! ${tradeSummary}`,
    read: false,
    createdAt: fsTimestamp(),
  });

  if (appdatabase && tradeId) {
    try {
      await set(ref(appdatabase, `savedTrades/${myUid}/${tradeId}/lastPingAt`), Date.now());
    } catch (e) {
      // Non-critical
    }
  }
};

const _buildTradeSummary = (trade) => {
  try {
    const hasNames = (trade.hasItems || []).filter(i => i).map(i => i.name || i.Name || '').filter(Boolean).slice(0, 3);
    const wantsNames = (trade.wantsItems || []).filter(i => i).map(i => i.name || i.Name || '').filter(Boolean).slice(0, 3);
    if (hasNames.length === 0 && wantsNames.length === 0) return '';
    const has = hasNames.join(', ') || '?';
    const wants = wantsNames.join(', ') || '?';
    return `(${has} → ${wants})`;
  } catch {
    return '';
  }
};

/**
 * Fetch all acceptors for a single trade
 */
export const fetchTradeAcceptors = async (appdatabase, tradeId) => {
  try {
    const snap = await get(ref(appdatabase, `tradeAcceptors/${tradeId}`));
    if (snap.exists()) return snap.val();
    return {};
  } catch {
    return {};
  }
};

/**
 * Remove all acceptors for a trade
 */
export const removeAllTradeAcceptors = async (appdatabase, tradeId) => {
  try {
    await remove(ref(appdatabase, `tradeAcceptors/${tradeId}`));
  } catch {}
};

/**
 * Fetch all saved/accepted trade refs from RTDB
 */
export const fetchSavedTradeRefs = async (appdatabase, myUid) => {
  try {
    const snap = await get(ref(appdatabase, `savedTrades/${myUid}`));
    if (snap.exists()) {
      return snap.val();
    }
    return {};
  } catch (e) {
    console.warn('[tradeHelpers] Failed to fetch saved trades:', e?.message);
    return {};
  }
};
