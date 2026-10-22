/**
 * TradeJournal.js — My Stuff Hub
 *
 * 3-tab hub:
 * 🍋 My Fruits — owned fruits grid, add new, total value
 * ⭐ Goals  — wishlist with progress bars
 * 📈 Done Trades — logged trade history + win/loss stats
 *
 * Active trades were removed from here — the Trades feed now has
 * My Trades / Saved filters for instant access. Done Trades is fed by
 * the "Log Trade" button on the Calculator (TradeCompletion.js →
 * RTDB tradeJournal/{uid} + tradeStats/{uid}).
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, Image,
  StyleSheet, Dimensions, ActivityIndicator, Alert, ScrollView, Modal, TextInput, StatusBar,
} from 'react-native';
import { useNavigation, useIsFocused, useRoute, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  doc, getDoc, setDoc, serverTimestamp as fsServerTimestamp,
} from '@react-native-firebase/firestore';
import { ref, get, set, remove, query as rtdbQuery, orderByChild, limitToLast, endBefore } from '@react-native-firebase/database';
import LinearGradient from 'react-native-linear-gradient';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../LocalGlobelStats';
import { maybeAskForReview } from '../AppHelper/reviewPrompt';
import { getThemeColors } from '../Helper/themeColors';
import config from '../Helper/Environment';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const FRUIT_CARD_SIZE = (SCREEN_WIDTH - 64) / 3;

const formatValue = (v) => {
  if (!v || typeof v !== 'number') return '0';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  if (v < 1) return v.toFixed(2);
  return v % 1 === 0 ? v.toString() : v.toFixed(2);
};

const TAB_COLORS = {
  fruits: '#3B82F6',
  goals: '#F59E0B',
  timeline: '#8B5CF6',
};

const TABS = [
  { key: 'fruits', icon: 'lemon', labelKey: 'engagement.trade_journal.tab_fruits' },
  { key: 'goals', icon: 'star', labelKey: 'engagement.trade_journal.tab_goals' },
  { key: 'timeline', icon: 'clock-rotate-left', labelKey: 'engagement.trade_journal.tab_timeline' },
];

const RESULT_META = {
  win:  { emoji: '🏆', labelKey: 'engagement.trade_journal.result_win', color: '#10B981' },
  fair: { emoji: '🤝', labelKey: 'engagement.trade_journal.result_fair', color: '#F59E0B' },
  loss: { emoji: '📉', labelKey: 'engagement.trade_journal.result_loss', color: '#EF4444' },
};

// Trade history pages 5 at a time (server-side, RTDB)
const PAGE_SIZE = 5;

// ── My Fruits select mode ──
// Catalogue `rarity` values (blox-api data.json): Mythical, Legendary, Rare,
// Uncommon, Common, Limited, gamepass. Chips go highest tier first; any other
// rarity follows alphabetically, then "Other" (owned item not in the catalogue).
const SELECT_ACCENT = '#F59E0B';
const RARITY_ORDER = ['mythical', 'legendary', 'rare', 'uncommon', 'common', 'limited', 'gamepass'];
const RARITY_ALIASES = { premium: 'gamepass', 'game pass': 'gamepass' };
const OTHER_RARITY = 'other';
const normaliseRarity = (r) => {
  const key = typeof r === 'string' ? r.trim().toLowerCase() : '';
  return RARITY_ALIASES[key] || key;
};
const rarityLabel = (key) => {
  if (key === 'gamepass') return 'Game Pass';
  if (key === OTHER_RARITY) return 'Other';
  return key.charAt(0).toUpperCase() + key.slice(1);
};
const rarityRank = (key) => {
  const i = RARITY_ORDER.indexOf(key);
  return i === -1 ? RARITY_ORDER.length : i;
};
const compareRarityKeys = (a, b) => {
  if (a === OTHER_RARITY) return 1;
  if (b === OTHER_RARITY) return -1;
  return rarityRank(a) - rarityRank(b) || a.localeCompare(b);
};
const RARITY_COLORS = {
  mythical: '#EF4444', legendary: '#F59E0B', rare: '#3B82F6', uncommon: '#10B981',
  common: '#64748B', limited: '#EC4899', gamepass: '#8B5CF6', [OTHER_RARITY]: '#94A3B8',
};

// ── My Fruits filters ──
// Owned entries are catalogue objects with `type` 'f' (normal), 'p'
// (permanent) or 'gamepass'. Anything else (old builds) counts as a fruit.
// Within a group an entry needs ANY chosen option; across groups, ALL.
const TYPE_ORDER = ['f', 'p', 'gamepass'];
const TYPE_COLORS = { f: '#3B82F6', p: '#D97706', gamepass: '#8B5CF6' };
const fruitTypeKey = (item) => (
  item?.type === 'p' ? 'p' : item?.type === 'gamepass' ? 'gamepass' : 'f'
);
const emptyFilters = () => ({ type: new Set(), rarity: new Set() });
const matchesFilters = (entry, f) => (
  (f.type.size === 0 || f.type.has(entry.type))
  && (f.rarity.size === 0 || f.rarity.has(entry.rarity))
);
// Removals skip the confirm dialog; "Removed N · Undo" stays this long.
const UNDO_MS = 8000;
const nameKey = (name) => String(name || '').toLowerCase().trim();

// One fruit in the My Fruits grid. Memoized, so tapping a card in select mode
// re-renders that card only, not the whole inventory. Long-press starts select
// mode with this fruit picked; outside select mode the ✕ is its own button.
const OwnedFruitCard = React.memo(({
  entry, imageUri, selectMode, isSelected, cardBg, borderColor, textColor, subtextColor, mutedColor,
  onPress, onLongPress, onRemove,
}) => {
  const { item, originalIndex, value } = entry;
  const isPerm = item.type === 'p';
  return (
    <TouchableOpacity
      accessible={selectMode}
      accessibilityRole={selectMode ? 'checkbox' : undefined}
      accessibilityState={selectMode ? { checked: isSelected } : undefined}
      accessibilityLabel={selectMode ? item.name : undefined}
      activeOpacity={selectMode ? 0.7 : 0.9}
      delayLongPress={350}
      onPress={selectMode ? () => onPress(originalIndex) : undefined}
      onLongPress={() => onLongPress(originalIndex)}
      style={[s.fruitCard, { backgroundColor: cardBg, borderColor }, isSelected && s.fruitCardSelected]}
    >
      {!selectMode && (
        <TouchableOpacity
          style={s.fruitRemoveBtn}
          onPress={() => onRemove(originalIndex)}
          activeOpacity={0.7}
          hitSlop={15}
        >
          <Icon name="close" size={16} color="#FFF" />
        </TouchableOpacity>
      )}
      <Image resizeMethod="resize"
        source={{ uri: imageUri }}
        style={[s.fruitImg, isPerm && s.fruitImgPerm]}
        resizeMode="contain"
      />
      <Text style={[s.fruitName, { color: textColor }]} numberOfLines={1}>{item.name}</Text>
      <Text style={[s.fruitValue, { color: subtextColor }]}>{formatValue(value)}</Text>
      {isPerm && <View style={[s.permBadge, s.permBadgeLeft]}><Text style={s.permBadgeText}>P</Text></View>}
      {selectMode && (
        <View pointerEvents="none" style={[s.selectOverlay, isSelected && s.selectOverlayActive]}>
          <Icon
            name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
            size={20}
            color={isSelected ? SELECT_ACCENT : mutedColor}
            style={s.selectCheck}
          />
        </View>
      )}
    </TouchableOpacity>
  );
});
OwnedFruitCard.displayName = 'OwnedFruitCard';

const TradeJournal = ({
  firestoreDB, db, uid, isDarkMode,
}) => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute();
  const visible = useIsFocused();
  const { localState, updateLocalState } = useLocalState();
  const initialTabParam = route.params?.initialTab;
  const [tab, setTab] = useState(TABS.some(t => t.key === initialTabParam) ? initialTabParam : 'fruits');
  const [ownedFruits, setOwnedFruits] = useState(localState.ownedFruits || []);
  const [wishlistFruits, setWishlistFruits] = useState(localState.wishlistFruits || []);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [tradeStats, setTradeStats] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [showFruitPicker, setShowFruitPicker] = useState(false);
  const [fruitPickerMode, setFruitPickerMode] = useState('owned');
  const [fruitSearchQ, setFruitSearchQ] = useState('');
  // My Fruits select mode: a Set of ORIGINAL indices into ownedFruits (entries
  // have no id) — not display positions, so it survives search/sort/filters.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(() => new Set());
  // My Fruits search / sort / filters and the "Removed · Undo" bar
  const [ownedSearch, setOwnedSearch] = useState('');
  const [ownedSort, setOwnedSort] = useState('recent'); // 'recent' | 'value-desc' | 'value-asc' | 'name'
  const [filters, setFilters] = useState(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [undo, setUndo] = useState(null); // { owned: list before the first removal, count }
  const undoTimerRef = useRef(null);
  const ownedFruitsRef = useRef(ownedFruits);
  const wishlistFruitsRef = useRef(wishlistFruits);
  useEffect(() => { ownedFruitsRef.current = ownedFruits; }, [ownedFruits]);
  useEffect(() => { wishlistFruitsRef.current = wishlistFruits; }, [wishlistFruits]);

  const c = getThemeColors(isDarkMode);
  const insets = useSafeAreaInsets();

  const heroGradient = isDarkMode
    ? ['#1a1035', '#2d1b69', '#1a1035']
    : [config.colors.primary, '#4f46e5', '#6366f1'];

  // Ensure status bar is light since we have a dark vibrant header gradient
  useFocusEffect(
    useCallback(() => {
      StatusBar.setBarStyle('light-content', true);
      return () => {
        StatusBar.setBarStyle(isDarkMode ? 'light-content' : 'dark-content', true);
      };
    }, [isDarkMode])
  );

  // Sync tab when navigating from notification
  useEffect(() => {
    const paramTab = route.params?.initialTab;
    if (paramTab && TABS.some(t => t.key === paramTab)) {
      setTab(paramTab);
      navigation.setParams({ initialTab: undefined, highlightTradeId: undefined });
    }
  }, [route.params?.initialTab]);

  // Image URL helper
  const getImgUrl = useCallback((name, type) => {
    const formatName = (n) => n.replace(/^\+/, '').replace(/\s+/g, '-');
    if (type === 'p') {
      return `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(name)}_Icon.webp`;
    }
    return `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(name)}_Icon.webp`;
  }, []);

  // ── Fetch owned + wishlist fruits ──
  const fetchFruits = useCallback(async () => {
    if (!firestoreDB || !uid) return;
    try {
      const snap = await getDoc(doc(firestoreDB, 'user_profiles', uid));
      if (snap.exists()) {
        const data = snap.data();
        const owned = Array.isArray(data?.ownedFruits) ? data.ownedFruits : [];
        const wishlist = Array.isArray(data?.wishlistFruits) ? data.wishlistFruits : [];
        setOwnedFruits(owned);
        setWishlistFruits(wishlist);
        updateLocalState('ownedFruits', owned);
        updateLocalState('wishlistFruits', wishlist);
      }
    } catch (err) {
      console.warn('[MyStuff] fetch fruits error:', err?.message);
    }
  }, [firestoreDB, uid, updateLocalState]);

  // ── Trade stats (lightweight separate node) ──
  const fetchTradeStats = useCallback(async () => {
    if (!db || !uid) return;
    try {
      const snap = await get(ref(db, `tradeStats/${uid}`));
      setTradeStats(snap.exists() ? snap.val() : null);
    } catch (err) {
      console.warn('[MyStuff] fetch stats error:', err?.message);
    }
  }, [db, uid]);

  const updateTradeStats = useCallback(async (result, gaveValue, gotValue, delta = 1) => {
    if (!db || !uid) return;
    try {
      const snap = await get(ref(db, `tradeStats/${uid}`));
      const current = snap.exists() ? snap.val() : { total: 0, wins: 0, fairs: 0, losses: 0, totalGave: 0, totalGot: 0 };
      const updated = {
        total: (current.total || 0) + delta,
        wins: (current.wins || 0) + (result === 'win' ? delta : 0),
        fairs: (current.fairs || 0) + (result === 'fair' ? delta : 0),
        losses: (current.losses || 0) + (result === 'loss' ? delta : 0),
        totalGave: (current.totalGave || 0) + (gaveValue * delta),
        totalGot: (current.totalGot || 0) + (gotValue * delta),
      };
      await set(ref(db, `tradeStats/${uid}`), updated);
      setTradeStats(updated);
    } catch (err) {
      console.warn('[MyStuff] update stats error:', err?.message);
    }
  }, [db, uid]);

  // ── Fetch trade history (server-side paginated — 5 at a time) ──
  const historyLastTimestampRef = useRef(null);
  const fetchHistory = useCallback(async (loadMore = false) => {
    if (!db || !uid) return;
    try {
      let q;
      const histRef = ref(db, `tradeJournal/${uid}`);
      if (loadMore && historyLastTimestampRef.current !== null) {
        q = rtdbQuery(histRef, orderByChild('completedAt'), endBefore(historyLastTimestampRef.current), limitToLast(PAGE_SIZE));
      } else {
        q = rtdbQuery(histRef, orderByChild('completedAt'), limitToLast(PAGE_SIZE));
      }
      const snap = await get(q);
      if (!snap.exists()) {
        if (!loadMore) setHistory([]);
        setHasMoreHistory(false);
        return;
      }
      const arr = Object.entries(snap.val()).map(([id, val]) => ({ id, ...val }));
      arr.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      setHasMoreHistory(arr.length >= PAGE_SIZE);
      if (loadMore) {
        if (arr.length > 0) historyLastTimestampRef.current = arr[arr.length - 1].completedAt || 0;
        setHistory(prev => [...prev, ...arr]);
      } else {
        historyLastTimestampRef.current = arr.length > 0 ? arr[arr.length - 1].completedAt || 0 : null;
        setHistory(arr);
      }
    } catch (err) {
      console.warn('[MyStuff] fetch history error:', err?.message);
    }
  }, [db, uid]);

  // ── Clear trade history ──
  const clearHistory = useCallback(() => {
    Alert.alert(t('engagement.trade_journal.clear_title'), t('engagement.trade_journal.clear_msg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('engagement.trade_journal.clear_all'), style: 'destructive',
        onPress: async () => {
          try {
            if (db && uid) {
              await remove(ref(db, `tradeJournal/${uid}`));
              await remove(ref(db, `tradeStats/${uid}`));
            }
            setHistory([]);
            setTradeStats(null);
            historyLastTimestampRef.current = null;
            setHasMoreHistory(false);
            Alert.alert(t('engagement.trade_journal.done'), t('engagement.trade_journal.cleared'));
          } catch (err) {
            Alert.alert(t('home.alert.error'), t('engagement.trade_journal.clear_error'));
          }
        },
      },
    ]);
  }, [db, uid, t]);

  // ── Delete single history item ──
  const deleteHistoryItem = useCallback((item) => {
    Alert.alert(t('engagement.trade_journal.delete_title'), t('engagement.trade_journal.delete_msg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive',
        onPress: async () => {
          try {
            if (db && uid && item.id) {
              await remove(ref(db, `tradeJournal/${uid}/${item.id}`));
            }
            setHistory(prev => prev.filter(h => h.id !== item.id));
            const gv = Number(item.gaveValue) || (item.gave || []).reduce((s, f) => s + (Number(f.value) || 0), 0);
            const gtv = Number(item.gotValue) || (item.got || []).reduce((s, f) => s + (Number(f.value) || 0), 0);
            updateTradeStats(item.result, gv, gtv, -1);
          } catch {
            Alert.alert(t('home.alert.error'), t('engagement.trade_journal.delete_error'));
          }
        },
      },
    ]);
  }, [db, uid, updateTradeStats, t]);

  // Initial data load
  const initialLoadDoneRef = useRef(false);
  useEffect(() => {
    if (!visible) return;
    if (!initialLoadDoneRef.current) {
      setLoading(true);
      setHasMoreHistory(true);
      Promise.all([fetchFruits(), fetchHistory(), fetchTradeStats()]).finally(() => {
        setLoading(false);
        initialLoadDoneRef.current = true;
        setTimeout(() => { hasFetchedRef.current = true; }, 200);
      });
    } else {
      // On re-focus, refresh history/stats — a trade may have just been logged
      // from the Calculator. One 5-row RTDB get, no listener.
      historyLastTimestampRef.current = null;
      setHasMoreHistory(true);
      Promise.all([fetchHistory(), fetchTradeStats()]);

      // Logging a trade rewrites the inventory and mirrors it to MMKV. Pull that
      // in rather than re-reading Firestore. hasFetchedRef is parked so the
      // auto-save effect doesn't echo the same list straight back.
      const cachedOwned = localState.ownedFruits;
      if (Array.isArray(cachedOwned) && JSON.stringify(cachedOwned) !== JSON.stringify(ownedFruitsRef.current)) {
        hasFetchedRef.current = false;
        setOwnedFruits(cachedOwned);
        setTimeout(() => { hasFetchedRef.current = true; }, 200);
      }
    }
    // localState.ownedFruits is read, not depended on: adding it would re-run this
    // effect (and re-fetch history) on every fruit add/remove made on this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, fetchFruits, fetchHistory, fetchTradeStats]);

  // Save fruits to Firestore
  const saveFruits = useCallback(async (newOwned, newWishlist) => {
    if (!firestoreDB || !uid) return;
    try {
      const payload = {
        ownedFruits: newOwned,
        wishlistFruits: newWishlist,
        updatedAt: fsServerTimestamp(),
      };
      await setDoc(doc(firestoreDB, 'user_profiles', uid), payload, { merge: true });
      updateLocalState('ownedFruits', newOwned);
      updateLocalState('wishlistFruits', newWishlist);

      // 🏅 Check fruitParent (50+) and collector (200+) badges
      if (db && uid && newOwned.length >= 50) {
        try {
          const { checkFruitParentBadge, checkCollectorBadge } = require('../ChatScreen/GroupChat/badgeUtils');
          checkFruitParentBadge(db, uid, newOwned.length);
          if (newOwned.length >= 200) checkCollectorBadge(db, uid, newOwned.length);
        } catch (e) {}
      }
    } catch (err) {
      console.warn('[MyStuff] save error:', err?.message);
    }
  }, [firestoreDB, uid, db, updateLocalState]);

  // Auto-save fruits when they change (debounced)
  const hasFetchedRef = useRef(false);
  const saveTimerRef = useRef(null);
  const fruitCountRef = useRef(0);
  useEffect(() => {
    const fruitCount = (ownedFruits?.length || 0) + (wishlistFruits?.length || 0);
    const grew = fruitCount > fruitCountRef.current;
    fruitCountRef.current = fruitCount;
    if (!hasFetchedRef.current) return;
    if (grew) maybeAskForReview('collection');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveFruits(ownedFruits, wishlistFruits);
    }, 300);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [ownedFruits, wishlistFruits, saveFruits]);

  // ── Removing fruits: instant, with "Removed · Undo" for a few seconds ──
  // (no "are you sure?" per fruit). Removals inside the window add up, and
  // Undo restores the list as it was before the first of them.
  const showUndo = useCallback((before, count) => {
    clearTimeout(undoTimerRef.current);
    setUndo(prev => ({ owned: prev ? prev.owned : before, count: (prev?.count || 0) + count }));
    undoTimerRef.current = setTimeout(() => setUndo(null), UNDO_MS);
  }, []);
  const dismissUndo = useCallback(() => {
    clearTimeout(undoTimerRef.current);
    setUndo(null);
  }, []);
  useEffect(() => () => clearTimeout(undoTimerRef.current), []);
  // On return the list may have been rewritten (a trade logged from the
  // Calculator), so an Undo snapshot from before would put that back.
  useEffect(() => { if (!visible) dismissUndo(); }, [visible, dismissUndo]);

  const doUndo = useCallback(() => {
    if (!undo) return;
    clearTimeout(undoTimerRef.current);
    ownedFruitsRef.current = undo.owned;
    setOwnedFruits(undo.owned);
    saveFruits(undo.owned, wishlistFruitsRef.current);
    setUndo(null);
  }, [undo, saveFruits]);

  // Remove fruit from owned
  const removeFruit = useCallback((index) => {
    const before = ownedFruitsRef.current;
    const newOwned = before.filter((_, i) => i !== index);
    ownedFruitsRef.current = newOwned; // two quick ✕ taps must not both start from `before`
    setOwnedFruits(newOwned);
    saveFruits(newOwned, wishlistFruitsRef.current);
    showUndo(before, 1);
  }, [saveFruits, showUndo]);

  const removeWishlistFruit = useCallback((index) => {
    const newWishlist = wishlistFruits.filter((_, i) => i !== index);
    setWishlistFruits(newWishlist);
    saveFruits(ownedFruits, newWishlist);
  }, [ownedFruits, wishlistFruits, saveFruits]);

  // Value lookup helper & list data
  const parsedData = useMemo(() => {
    try {
      const raw = localState?.data;
      if (!raw) return [];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
    } catch { return []; }
  }, [localState?.data]);

  const filteredFruitsList = useMemo(() => {
    const q = fruitSearchQ.trim().toLowerCase();
    
    const expandedList = [];
    parsedData.forEach(f => {
      const name = (f?.name || '').toLowerCase();
      if (q && !name.includes(q)) return;
      
      const isGamepass = f.type === 'gamepass' || f.type === 'scroll' || f.type === 'bundle' || name.includes('gamepass') || name.includes('scroll') || name.includes('storage') || name.includes('blade') || name.includes('boat');

      if (isGamepass) {
        expandedList.push({ ...f, type: 'gamepass' }); 
      } else {
        expandedList.push({ ...f, type: 'f' }); 
        expandedList.push({ ...f, type: 'p' }); 
      }
    });

    return expandedList;
  }, [parsedData, fruitSearchQ]);

  // lowercased name → catalogue item, built once per feed (first match wins,
  // as find() did) — replaces a find() over the catalogue for every lookup.
  const valueIndex = useMemo(() => {
    const m = new Map();
    parsedData.forEach(d => {
      const n = nameKey(d?.name);
      if (n && !m.has(n)) m.set(n, d);
    });
    return m;
  }, [parsedData]);

  const lookupFruitValue = useCallback((fruit) => {
    if (!fruit?.name || valueIndex.size === 0) return Number(fruit?.value) || 0;
    const item = valueIndex.get(nameKey(fruit.name));
    if (!item) return Number(fruit?.value) || 0;
    if (fruit.type === 'p') return Number(item.permValue || item.value) || 0;
    return Number(item.rvalue || item.value) || 0;
  }, [valueIndex]);

  const portfolioValue = useMemo(() =>
    ownedFruits.reduce((s, f) => s + lookupFruitValue(f), 0)
  , [ownedFruits, lookupFruitValue]);

  // Net value is recomputed from the loaded history at CURRENT catalog values,
  // so it tracks the market rather than the values frozen at trade time.
  const netValue = useMemo(() => {
    if (history.length === 0) return 0;
    let gaveSum = 0, gotSum = 0;
    history.forEach(h => {
      (h.gave || []).forEach(f => { gaveSum += lookupFruitValue(f); });
      (h.got || []).forEach(f => { gotSum += lookupFruitValue(f); });
    });
    return gotSum - gaveSum;
  }, [history, lookupFruitValue]);

  const stats = useMemo(() => {
    if (!tradeStats) return null;
    const total = tradeStats.total || 0;
    return {
      total,
      wins: tradeStats.wins || 0,
      fairs: tradeStats.fairs || 0,
      losses: tradeStats.losses || 0,
      winRate: total > 0 ? Math.round(((tradeStats.wins || 0) / total) * 100) : 0,
      netValue,
    };
  }, [tradeStats, netValue]);

  // ── My Fruits select mode (bulk remove) ──
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIdx(prev => (prev.size === 0 ? prev : new Set()));
  }, []);

  // Leave select mode on tab switch or when the screen loses focus.
  useEffect(() => { exitSelectMode(); }, [tab, visible, exitSelectMode]);

  // Selected indices only mean something for the list they were picked from.
  // Keyed on the array (not just its length): a re-focus after logging a trade
  // can swap items without changing the count.
  useEffect(() => {
    setSelectedIdx(prev => (prev.size === 0 ? prev : new Set()));
    if (ownedFruits.length === 0) setSelectMode(false);
  }, [ownedFruits]);

  // Every owned fruit with what the grid, sort and filters need, worked out
  // once. originalIndex keeps removal and selection on the canonical
  // ownedFruits array whatever the display order.
  const ownedEntries = useMemo(() => ownedFruits.map((item, originalIndex) => ({
    item,
    originalIndex,
    value: lookupFruitValue(item),
    type: fruitTypeKey(item),
    rarity: normaliseRarity(valueIndex.get(nameKey(item?.name))?.rarity)
      || normaliseRarity(item?.rarity)
      || OTHER_RARITY,
  })), [ownedFruits, lookupFruitValue, valueIndex]);

  const typeLabel = useCallback((key) => (
    key === 'p' ? t('value.permanent_value', { defaultValue: 'Permanent' })
      : key === 'gamepass' ? t('trade_journal.my_fruits.type_gamepass', { defaultValue: 'Game Pass' })
        : t('trade_journal.my_fruits.type_fruit', { defaultValue: 'Fruit' })
  ), [t]);

  const rarityText = useCallback((key) => {
    if (key === 'gamepass') return typeLabel('gamepass');
    if (key === OTHER_RARITY || RARITY_ORDER.includes(key)) {
      return t(`trade_journal.my_fruits.rarity_${key}`, { defaultValue: rarityLabel(key) });
    }
    return rarityLabel(key); // a rarity the catalogue added later
  }, [t, typeLabel]);

  // Filter options: only what this inventory has, each with its count.
  const filterOptions = useMemo(() => {
    const counts = { type: new Map(), rarity: new Map() };
    ownedEntries.forEach(e => {
      counts.type.set(e.type, (counts.type.get(e.type) || 0) + 1);
      counts.rarity.set(e.rarity, (counts.rarity.get(e.rarity) || 0) + 1);
    });
    return [
      {
        key: 'type',
        title: t('trade_journal.my_fruits.filter_type', { defaultValue: 'Type' }),
        options: TYPE_ORDER.filter(k => counts.type.has(k)).map(k => ({
          key: k, label: typeLabel(k), color: TYPE_COLORS[k], count: counts.type.get(k),
        })),
      },
      {
        key: 'rarity',
        title: t('trade_journal.my_fruits.filter_rarity', { defaultValue: 'Rarity' }),
        options: [...counts.rarity.keys()].sort(compareRarityKeys).map(k => ({
          key: k, label: rarityText(k), color: RARITY_COLORS[k] || RARITY_COLORS[OTHER_RARITY], count: counts.rarity.get(k),
        })),
      },
    ].filter(g => g.options.length > 0);
  }, [ownedEntries, t, typeLabel, rarityText]);

  // A chosen option whose last fruit was removed no longer has a chip to turn
  // it off, so only options still on offer count.
  const activeFilters = useMemo(() => {
    const present = { type: new Set(), rarity: new Set() };
    filterOptions.forEach(g => g.options.forEach(o => present[g.key].add(o.key)));
    return {
      type: new Set([...filters.type].filter(k => present.type.has(k))),
      rarity: new Set([...filters.rarity].filter(k => present.rarity.has(k))),
    };
  }, [filters, filterOptions]);
  const activeFilterCount = activeFilters.type.size + activeFilters.rarity.size;

  const toggleFilter = useCallback((group, key) => {
    setFilters(prev => {
      const next = new Set(prev[group]);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...prev, [group]: next };
    });
  }, []);
  const clearFilters = useCallback(() => setFilters(emptyFilters()), []);

  // The list as the user sees it: search, then filters, then the chosen sort.
  // 'recent' keeps the stored order (the order fruits were added).
  const displayedFruits = useMemo(() => {
    const q = ownedSearch.trim().toLowerCase();
    const shown = ownedEntries.filter(e =>
      (!q || String(e.item?.name || '').toLowerCase().includes(q))
      && (activeFilterCount === 0 || matchesFilters(e, activeFilters)));
    if (ownedSort === 'recent') return shown;
    const sorted = [...shown];
    if (ownedSort === 'value-desc') sorted.sort((a, b) => b.value - a.value);
    else if (ownedSort === 'value-asc') sorted.sort((a, b) => a.value - b.value);
    else if (ownedSort === 'name') sorted.sort((a, b) => String(a.item?.name || '').localeCompare(String(b.item?.name || '')));
    return sorted;
  }, [ownedEntries, ownedSearch, ownedSort, activeFilters, activeFilterCount]);

  const displayedIndices = useMemo(() => displayedFruits.map(e => e.originalIndex), [displayedFruits]);

  const toggleSelected = useCallback((index) => {
    setSelectedIdx(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }, []);

  // Long-press a fruit: start selecting, with that fruit already picked.
  const startSelectWith = useCallback((index) => {
    setSelectMode(true);
    setSelectedIdx(prev => {
      if (prev.has(index)) return prev;
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, []);

  // Adds the whole group to the selection, or clears it if it is all selected already.
  const toggleGroup = useCallback((indices) => {
    setSelectedIdx(prev => {
      const allIn = indices.length > 0 && indices.every(i => prev.has(i));
      const next = new Set(prev);
      indices.forEach(i => { if (allIn) next.delete(i); else next.add(i); });
      return next;
    });
  }, []);

  const removeSelectedFruits = useCallback(() => {
    const count = selectedIdx.size;
    if (count === 0) return;
    const before = ownedFruitsRef.current;
    const newOwned = before.filter((_, i) => !selectedIdx.has(i));
    ownedFruitsRef.current = newOwned;
    setOwnedFruits(newOwned);
    saveFruits(newOwned, wishlistFruitsRef.current);
    exitSelectMode();
    showUndo(before, count);
  }, [selectedIdx, saveFruits, exitSelectMode, showUndo]);

  const selectBtnBg = isDarkMode ? '#1e293b' : '#fefce8'; // same fill as the Add Fruit button

  const renderSelectChip = (key, label, active, onPress) => (
    <TouchableOpacity
      key={key}
      style={[s.selectChip, active ? s.selectChipActive : { backgroundColor: c.bgAlt, borderColor: c.border }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
    >
      <Text style={[s.selectChipText, { color: active ? SELECT_ACCENT : c.text }]}>{label}</Text>
    </TouchableOpacity>
  );

  // Portfolio hero card. Memoized: as the grid's list header it would
  // otherwise re-render on every selection tap.
  const fruitsHeroCard = useMemo(() => (
    <View style={[s.heroCard, { backgroundColor: isDarkMode ? '#1e293b' : '#fffbeb' }]}>
      <Text style={[s.heroLabel, { color: '#F59E0B' }]}>{t('engagement.trade_journal.inventory_worth')}</Text>
      <Text style={[s.heroValue, { color: '#F59E0B' }]}>🍋 {formatValue(portfolioValue)}</Text>
      <Text style={[s.heroSub, { color: c.textSecondary }]}>{t('engagement.trade_journal.fruits_collected', { count: ownedFruits.length })}</Text>
    </View>
  ), [isDarkMode, portfolioValue, ownedFruits.length, c.textSecondary, t]);

  const renderOwnedItem = useCallback(({ item: entry }) => (
    <OwnedFruitCard
      entry={entry}
      imageUri={getImgUrl(entry.item.name, entry.item.type)}
      selectMode={selectMode}
      isSelected={selectMode && selectedIdx.has(entry.originalIndex)}
      cardBg={c.bgAlt}
      borderColor={c.border}
      textColor={c.text}
      subtextColor={c.textSecondary}
      mutedColor={c.textMuted}
      onPress={toggleSelected}
      onLongPress={startSelectWith}
      onRemove={removeFruit}
    />
  ), [getImgUrl, selectMode, selectedIdx, c.bgAlt, c.border, c.text, c.textSecondary, c.textMuted,
    toggleSelected, startSelectWith, removeFruit]);

  // ═══════════════════════════════════════════════════
  // RENDER: My Fruits Tab
  // ═══════════════════════════════════════════════════
  const renderFruitsTab = () => {
    const sortOptions = [
      { key: 'recent', label: t('trade_journal.my_fruits.sort_recent', { defaultValue: 'Recent' }) },
      { key: 'value-desc', label: t('trade_journal.my_fruits.sort_value_desc', { defaultValue: 'Value ↓' }) },
      { key: 'value-asc', label: t('trade_journal.my_fruits.sort_value_asc', { defaultValue: 'Value ↑' }) },
      { key: 'name', label: t('trade_journal.my_fruits.sort_name', { defaultValue: 'A–Z' }) },
    ];
    const allShownSelected = displayedIndices.length > 0 && displayedIndices.every(i => selectedIdx.has(i));
    const filtersOn = showFilters || activeFilterCount > 0;

    const header = (
      <View style={s.ownedHeader}>
        {fruitsHeroCard}

        {/* Add Fruit + Select Buttons */}
        <View style={s.inventoryActionsRow}>
          <TouchableOpacity
            style={[s.addFruitBtn, s.flex1, { backgroundColor: selectBtnBg }]}
            onPress={() => { setFruitPickerMode('owned'); setShowFruitPicker(true); }}
          >
            <Text style={[s.addFruitText, { color: '#F59E0B' }]}>{t('engagement.trade_journal.add_fruit')}</Text>
          </TouchableOpacity>
          {ownedFruits.length > 0 && (
            <TouchableOpacity
              style={[s.selectBtn, { backgroundColor: selectBtnBg }, selectMode && s.selectBtnActive]}
              onPress={selectMode ? exitSelectMode : () => setSelectMode(true)}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Icon name={selectMode ? 'checkmark-done' : 'checkbox-outline'} size={16} color={SELECT_ACCENT} />
              <Text style={[s.addFruitText, { color: SELECT_ACCENT }]}>{selectMode ? t('engagement.trade_journal.done') : t('engagement.trade_journal.select')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Search, sort, filters */}
        {ownedFruits.length > 0 && (
          <View style={s.ownedTools}>
            <View style={[s.ownedSearchBox, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
              <FontAwesome name="magnifying-glass" size={12} color={c.textSecondary} />
              <TextInput
                value={ownedSearch}
                onChangeText={setOwnedSearch}
                placeholder={t('trade_journal.my_fruits.search_placeholder', { defaultValue: 'Search fruits...' })}
                placeholderTextColor={c.textMuted}
                style={[s.ownedSearchInput, { color: c.text }]}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {ownedSearch.length > 0 && (
                <TouchableOpacity onPress={() => setOwnedSearch('')} hitSlop={8}>
                  <FontAwesome name="circle-xmark" size={14} color={c.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            <View style={s.sortRow}>
              {sortOptions.map(opt => {
                const active = ownedSort === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    onPress={() => setOwnedSort(opt.key)}
                    style={[s.sortChip, active ? s.sortChipActive : { backgroundColor: c.bgAlt, borderColor: c.border }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[s.sortChipText, { color: active ? '#FFF' : c.textSecondary }]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
              {/* Outlined so it doesn't read as a sort option */}
              <TouchableOpacity
                onPress={() => setShowFilters(v => !v)}
                style={[s.filterToggle, filtersOn && s.filterToggleActive]}
                accessibilityRole="button"
                accessibilityState={{ expanded: showFilters }}
              >
                <FontAwesome name="filter" size={10} color={filtersOn ? '#FFF' : SELECT_ACCENT} />
                <Text style={[s.filterToggleText, filtersOn && s.filterToggleTextActive]}>
                  {activeFilterCount > 0
                    ? t('trade_journal.my_fruits.filters_count', { count: activeFilterCount, defaultValue: 'Filters · {{count}}' })
                    : t('trade_journal.my_fruits.filters', { defaultValue: 'Filters' })}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Filter panel: any mix, e.g. Permanent + Mythical */}
            {showFilters && (
              <View style={[s.filterPanel, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
                {filterOptions.map(group => (
                  <View key={group.key} style={s.filterGroup}>
                    <Text style={[s.filterGroupTitle, { color: c.textSecondary }]}>{group.title}</Text>
                    <View style={s.filterChips}>
                      {group.options.map(o => {
                        const active = activeFilters[group.key].has(o.key);
                        return (
                          <TouchableOpacity
                            key={o.key}
                            onPress={() => toggleFilter(group.key, o.key)}
                            style={[s.filterChip, { borderColor: o.color, backgroundColor: active ? o.color : o.color + '14' }]}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: active }}
                          >
                            {active && <FontAwesome name="check" size={9} color="#FFF" />}
                            <Text style={[s.filterChipText, { color: active ? '#FFF' : o.color }]}>
                              {o.label} · {o.count}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {activeFilterCount > 0 && (
              <View style={s.filterSummary}>
                <Text style={[s.filterSummaryText, { color: c.textSecondary }]}>
                  {t('trade_journal.my_fruits.showing', {
                    shown: displayedFruits.length,
                    total: ownedFruits.length,
                    defaultValue: 'Showing {{shown}} of {{total}}',
                  })}
                </Text>
                <TouchableOpacity onPress={clearFilters} hitSlop={8}>
                  <Text style={s.filterClearText}>
                    {t('trade_journal.my_fruits.clear_filters', { defaultValue: 'Clear filters' })}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Select mode: everything shown (after search and filters) at once */}
        {selectMode && displayedFruits.length > 0 && (
          <View style={s.chipRow}>
            {renderSelectChip(
              'all',
              t('trade_journal.my_fruits.select_all', { count: displayedIndices.length, defaultValue: 'All ({{count}})' }),
              allShownSelected,
              () => toggleGroup(displayedIndices),
            )}
            {selectedIdx.size > 0 && (
              <TouchableOpacity
                style={[s.selectChip, { borderColor: c.border }]}
                onPress={() => setSelectedIdx(new Set())}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Text style={[s.selectChipText, { color: c.textSecondary }]}>
                  {t('trade_journal.my_fruits.select_none', { defaultValue: 'Select none' })}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );

    return (
      <View style={s.flex1}>
        <FlatList
          data={displayedFruits}
          numColumns={3}
          keyExtractor={(e) => `owned-${e.originalIndex}`}
          renderItem={renderOwnedItem}
          ListHeaderComponent={header}
          contentContainerStyle={s.ownedListContent}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={18}
          maxToRenderPerBatch={18}
          windowSize={7}
          // RN 0.87 Fabric: view clipping crashes in addViewAt.
          removeClippedSubviews={false}
          ListEmptyComponent={ownedFruits.length === 0 ? (
            <View style={s.emptyState}>
              <Text style={s.emptyEmoji}>🍋</Text>
              <Text style={[s.emptyText, s.emptyTextGap, { color: c.textSecondary }]}>{t('engagement.trade_journal.no_fruits')}</Text>
              <Text style={[s.emptySubtext, { color: c.textMuted }]}>{t('engagement.trade_journal.no_fruits_sub')}</Text>
            </View>
          ) : (
            <View style={s.emptyState}>
              <Text style={s.emptyEmoji}>🔍</Text>
              <Text style={[s.emptyText, s.emptyTextGap, { color: c.textSecondary }]}>
                {t('trade_journal.my_fruits.no_match_title', { defaultValue: 'No fruits match' })}
              </Text>
              <Text style={[s.emptySubtext, { color: c.textMuted }]}>
                {activeFilterCount > 0
                  ? t('trade_journal.my_fruits.no_match_filters', { defaultValue: 'Try a different search, or clear the filters.' })
                  : t('trade_journal.my_fruits.no_match_sub', { defaultValue: 'Try a different search.' })}
              </Text>
            </View>
          )}
        />

        {/* "Removed N · Undo" for a few seconds after a removal */}
        {undo && (
          <View style={s.undoBar}>
            <Text style={s.undoText} numberOfLines={1}>
              {t('trade_journal.my_fruits.removed', { count: undo.count, defaultValue: 'Removed {{count}}' })}
            </Text>
            <TouchableOpacity onPress={doUndo} hitSlop={10} accessibilityRole="button">
              <Text style={s.undoBtn}>{t('trade_journal.my_fruits.undo', { defaultValue: 'Undo' })}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Select mode: sticky action bar */}
        {selectMode && (
          <View style={[s.selectBar, { backgroundColor: c.bgAlt, borderTopColor: c.border }]}>
            <Text style={[s.selectBarCount, { color: c.text }]}>{t('engagement.trade_journal.selected_count', { count: selectedIdx.size })}</Text>
            <TouchableOpacity
              style={[s.selectBarRemove, selectedIdx.size === 0 && s.selectBarRemoveDisabled]}
              onPress={removeSelectedFruits}
              disabled={selectedIdx.size === 0}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ disabled: selectedIdx.size === 0 }}
            >
              <FontAwesome name="trash-can" size={13} color="#FFF" />
              <Text style={s.selectBarRemoveText}>{t('engagement.trade_journal.remove')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  // ═══════════════════════════════════════════════════
  // RENDER: Goals Tab
  // ═══════════════════════════════════════════════════
  const renderGoalsTab = () => (
    <View style={{ flex: 1 }}>
      <FlatList
        data={wishlistFruits}
        keyExtractor={(_, i) => `wish-${i}`}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 16 }}>
            <TouchableOpacity
              style={[s.addFruitBtn, { backgroundColor: isDarkMode ? '#1e293b' : '#fefce8' }]}
              onPress={() => { setFruitPickerMode('wishlist'); setShowFruitPicker(true); }}
            >
              <Text style={[s.addFruitText, { color: '#F59E0B' }]}>{t('engagement.trade_journal.add_dream')}</Text>
            </TouchableOpacity>
          </View>
        }
        ListEmptyComponent={
          <View style={s.emptyState}>
            <Text style={{ fontSize: 40, marginBottom: 8 }}>✨</Text>
            <Text style={[s.emptyText, { color: c.textSecondary }]}>{t('engagement.trade_journal.no_goals')}</Text>
            <Text style={[s.emptySubtext, { color: c.textMuted }]}>{t('engagement.trade_journal.no_goals_sub')}</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const val = lookupFruitValue(item);
          const hasIt = ownedFruits.some(o => o.name === item.name && o.type === item.type);
          return (
            <View style={[s.goalRow, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
              <Image resizeMethod="resize" source={{ uri: getImgUrl(item.name, item.type) }} style={s.goalImg} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <Text style={[s.goalName, { color: c.text }]}>{item.name}</Text>
                <Text style={[s.goalValue, { color: c.textSecondary }]}>{formatValue(val)}</Text>
              </View>
              {hasIt ? (
                <View style={s.goalDone}><Icon name="checkmark-circle" size={20} color="#10B981" /></View>
              ) : (
                <TouchableOpacity onPress={() => removeWishlistFruit(index)} style={s.goalRemove}>
                  <Icon name="close" size={16} color="#EF4444" />
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />

    </View>
  );

  // ═══════════════════════════════════════════════════
  // RENDER: Done Trades Tab
  // ═══════════════════════════════════════════════════
  const renderTimelineItem = ({ item }) => {
    const meta = RESULT_META[item.result] || RESULT_META.fair;
    const gaveItems = item.gave || [];
    const gotItems = item.got || [];
    const gaveVal = Number(item.gaveValue) || gaveItems.reduce((s, f) => s + (Number(f.value) || 0), 0);
    const gotVal = Number(item.gotValue) || gotItems.reduce((s, f) => s + (Number(f.value) || 0), 0);
    const netVal = gotVal - gaveVal;

    let dateStr = '';
    if (item.completedAt) {
      try {
        const d = new Date(item.completedAt);
        if (!isNaN(d.getTime())) {
          const diffDays = Math.floor((Date.now() - d) / 86400000);
          if (diffDays === 0) dateStr = t('engagement.trade_journal.today');
          else if (diffDays === 1) dateStr = t('engagement.trade_journal.yesterday');
          else if (diffDays < 7) dateStr = t('engagement.trade_journal.days_ago', { count: diffDays });
          else dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
      } catch {}
    }

    const renderSide = (items, label, color, alignEnd) => (
      <View style={[s.tlSide, alignEnd && { alignItems: 'flex-end' }]}>
        <Text style={[s.tlSideLabel, { color }]}>{label}</Text>
        <View style={[s.tlBubbles, alignEnd && { justifyContent: 'flex-end' }]}>
          {items.map((f, i) => (
            <Image resizeMethod="resize"
              key={`${label}-${i}`}
              source={{ uri: getImgUrl(f.name, f.type) }}
              style={[s.tlImg, f.type === 'p' && { backgroundColor: '#FFCC0020' }]}
              resizeMode="contain"
            />
          ))}
        </View>
      </View>
    );

    return (
      <View style={[s.tlCard, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
        <View style={s.tlHeadRow}>
          <View style={[s.tlResultBadge, { backgroundColor: meta.color + '20' }]}>
            <Text style={[s.tlResultText, { color: meta.color }]}>{meta.emoji} {t(meta.labelKey)}</Text>
          </View>
          {netVal !== 0 && (
            <View style={[s.tlNetBadge, { backgroundColor: netVal >= 0 ? '#10B98115' : '#EF444415' }]}>
              <FontAwesome
                name={netVal >= 0 ? 'arrow-trend-up' : 'arrow-trend-down'}
                size={10}
                color={netVal >= 0 ? '#10B981' : '#EF4444'}
              />
              <Text style={[s.tlNetText, { color: netVal >= 0 ? '#10B981' : '#EF4444' }]}>
                {netVal >= 0 ? '+' : ''}{formatValue(netVal)}
              </Text>
            </View>
          )}
          {item.didScam && (
            <View style={[s.tlNetBadge, { backgroundColor: '#FEE2E2' }]}>
              <Text style={{ fontSize: 10, color: '#EF4444', fontWeight: '700' }}>{t('engagement.trade_journal.scam')}</Text>
            </View>
          )}
          {dateStr ? <Text style={[s.tlDate, { color: c.textSecondary }]}>{dateStr}</Text> : null}
        </View>

        <View style={s.tlTradeRow}>
          {renderSide(gaveItems, t('engagement.trade_journal.i_gave'), '#EF4444', false)}
          <FontAwesome name="arrow-right" size={12} color={c.textSecondary} />
          {renderSide(gotItems, t('engagement.trade_journal.i_got'), '#10B981', true)}
        </View>

        <View style={s.tlValRow}>
          <Text style={[s.tlValText, { color: '#EF4444' }]}>{formatValue(gaveVal)}</Text>
          <Text style={[s.tlValText, { color: '#10B981' }]}>{formatValue(gotVal)}</Text>
        </View>

        {item.notes ? (
          <Text style={[s.tlNotes, { color: c.textSecondary }]} numberOfLines={2}>“{item.notes}”</Text>
        ) : null}

        <TouchableOpacity style={s.tlDeleteBtn} onPress={() => deleteHistoryItem(item)} activeOpacity={0.7}>
          <FontAwesome name="trash-can" size={11} color="#EF4444" />
          <Text style={s.tlDeleteText}>{t('common.delete')}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderTimelineTab = () => (
    <View style={{ flex: 1 }}>
      <FlatList
        data={history}
        keyExtractor={(item, i) => item.id || `t-${i}`}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, paddingTop: 16 }}
        renderItem={renderTimelineItem}
        ListHeaderComponent={stats ? (
          <View style={{ marginBottom: 12 }}>
            {/* Win / Fair / Loss distribution */}
            <View style={[s.statsCard, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
              <Text style={[s.statsCardTitle, { color: c.text }]}>{t('engagement.trade_journal.trade_results')}</Text>
              <View style={s.barChartWrap}>
                {stats.wins > 0 && (
                  <View style={[s.barSegment, { flex: stats.wins, backgroundColor: '#10B981' }]}>
                    <Text style={s.barSegmentText}>{stats.wins}</Text>
                  </View>
                )}
                {stats.fairs > 0 && (
                  <View style={[s.barSegment, { flex: stats.fairs, backgroundColor: '#F59E0B' }]}>
                    <Text style={s.barSegmentText}>{stats.fairs}</Text>
                  </View>
                )}
                {stats.losses > 0 && (
                  <View style={[s.barSegment, { flex: stats.losses, backgroundColor: '#EF4444' }]}>
                    <Text style={s.barSegmentText}>{stats.losses}</Text>
                  </View>
                )}
              </View>
              <View style={s.barLegend}>
                {[['engagement.trade_completion.rating_win', '#10B981'], ['engagement.trade_completion.rating_fair', '#F59E0B'], ['engagement.trade_completion.rating_loss', '#EF4444']].map(([labelKey, color]) => (
                  <View key={labelKey} style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: color }]} />
                    <Text style={[s.legendText, { color: c.textSecondary }]}>{t(labelKey)}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Quick stats grid */}
            <View style={s.statsGridRow}>
              <View style={[s.statsGridItem, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
                <Text style={{ fontSize: 20 }}>📦</Text>
                <Text style={[s.statsGridValue, { color: c.text }]}>{stats.total}</Text>
                <Text style={[s.statsGridLabel, { color: c.textSecondary }]}>{t('engagement.trade_journal.total_trades')}</Text>
              </View>
              <View style={[s.statsGridItem, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
                <Text style={{ fontSize: 20 }}>🏆</Text>
                <Text style={[s.statsGridValue, { color: '#10B981' }]}>{stats.winRate}%</Text>
                <Text style={[s.statsGridLabel, { color: c.textSecondary }]}>{t('engagement.trade_journal.win_rate')}</Text>
              </View>
              <View style={[s.statsGridItem, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
                <Text style={{ fontSize: 20 }}>{stats.netValue >= 0 ? '📈' : '📉'}</Text>
                <Text style={[s.statsGridValue, { color: stats.netValue >= 0 ? '#10B981' : '#EF4444' }]}>
                  {stats.netValue >= 0 ? '+' : ''}{formatValue(stats.netValue)}
                </Text>
                <Text style={[s.statsGridLabel, { color: c.textSecondary }]}>{t('engagement.trade_journal.net_value')}</Text>
              </View>
            </View>

            <TouchableOpacity style={s.clearHistoryBtn} onPress={clearHistory} activeOpacity={0.7}>
              <FontAwesome name="trash-can" size={12} color="#EF4444" />
              <Text style={s.clearHistoryText}>{t('engagement.trade_journal.clear_history')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        ListFooterComponent={
          hasMoreHistory && history.length > 0 ? (
            <TouchableOpacity
              style={[s.loadMoreBtn, { backgroundColor: c.bgAlt, borderColor: c.border }]}
              onPress={async () => {
                setLoadingMore(true);
                await fetchHistory(true);
                setLoadingMore(false);
              }}
              activeOpacity={0.7}
              disabled={loadingMore}
            >
              {loadingMore
                ? <ActivityIndicator size="small" color={c.text} />
                : <Text style={[s.loadMoreText, { color: c.text }]}>{t('engagement.trade_journal.load_more')}</Text>}
            </TouchableOpacity>
          ) : null
        }
        ListEmptyComponent={
          <View style={s.emptyState}>
            <Text style={{ fontSize: 40 }}>📈</Text>
            <Text style={[s.emptyText, { color: c.textSecondary, marginTop: 8 }]}>{t('engagement.trade_journal.no_trades')}</Text>
            <Text style={[s.emptySubtext, { color: c.textMuted, textAlign: 'center' }]}>
              {t('engagement.trade_journal.no_trades_sub')}
            </Text>
          </View>
        }
      />
    </View>
  );

  // ═══════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════


  return (
    <View style={[s.root, { backgroundColor: c.bg }]}>
      
      {/* Hero Welcome Banner / Header */}
      <LinearGradient
        colors={heroGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ paddingTop: insets.top, paddingBottom: 16 }}
      >
        {/* Custom Header Nav */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginTop: 8, marginBottom: 16 }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ paddingRight: 16 }} activeOpacity={0.7}>
            <FontAwesome name="chevron-left" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={{ fontSize: 20, fontWeight: '800', color: '#fff' }}>{t('engagement.trade_journal.title')}</Text>
        </View>

        {/* Tab bar wrapped in the hero gradient */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={{ flexDirection: 'row', paddingHorizontal: 12, gap: 8, alignItems: 'center' }}
        >
          {TABS.map(tabDef => {
            const isActive = tab === tabDef.key;
            // On dark hero bg, active=white filled, inactive=frosted glass transparent
            return (
              <TouchableOpacity
                key={tabDef.key}
                style={[
                  s.tabPill, 
                  isActive ? { backgroundColor: '#fff', borderColor: 'transparent' } : { backgroundColor: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.25)' }
                ]}
                onPress={() => setTab(tabDef.key)}
                activeOpacity={0.8}
              >
                <FontAwesome name={tabDef.icon} size={12} color={isActive ? (isDarkMode ? '#2d1b69' : config.colors.primary) : '#ffffff'} solid={isActive} />
                <Text style={[s.tabPillText, { color: isActive ? (isDarkMode ? '#2d1b69' : config.colors.primary) : '#ffffff' }]}>{t(tabDef.labelKey)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </LinearGradient>

      {/* Loading & Active tab content */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={config.colors.primary} />
        </View>
      ) : (
        <>
          {tab === 'fruits' && renderFruitsTab()}
          {tab === 'goals' && renderGoalsTab()}
          {tab === 'timeline' && renderTimelineTab()}
        </>
      )}

      <ScreenBottomBanner background={c.bg} collapsible />

      {/* Minimal Fruit Picker Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={showFruitPicker}
        onRequestClose={() => {
          setShowFruitPicker(false);
          setFruitSearchQ('');
        }}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          {/* Backdrop */}
          <TouchableOpacity
            style={{ ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' }}
            activeOpacity={1}
            onPress={() => {
              setShowFruitPicker(false);
              setFruitSearchQ('');
            }}
          />

          {/* Drawer content */}
          <View style={{
            backgroundColor: isDarkMode ? '#1e293b' : '#fff',
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            height: '80%', padding: 20, paddingBottom: Math.max(insets.bottom, 20),
            shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 10,
          }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: c.text }}>
                {fruitPickerMode === 'owned' ? t('engagement.trade_journal.picker_add_inventory') : t('engagement.trade_journal.picker_add_dream')}
              </Text>
              <TouchableOpacity onPress={() => { setShowFruitPicker(false); setFruitSearchQ(''); }}>
                <FontAwesome name="xmark" size={20} color={c.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Search */}
            <View style={{
              flexDirection: 'row', alignItems: 'center', backgroundColor: isDarkMode ? '#0f172a' : '#f1f5f9',
              borderRadius: 12, paddingHorizontal: 16, marginBottom: 16, height: 48,
            }}>
              <FontAwesome name="magnifying-glass" size={16} color={c.textSecondary} style={{ marginRight: 10 }} />
              <TextInput
                style={{ flex: 1, fontSize: 15, color: c.text, height: '100%' }}
                placeholder={t('trade_journal.my_fruits.search_placeholder', { defaultValue: 'Search fruits...' })}
                placeholderTextColor={c.textMuted}
                value={fruitSearchQ}
                onChangeText={setFruitSearchQ}
                autoCorrect={false}
              />
              {fruitSearchQ.length > 0 && (
                <TouchableOpacity onPress={() => setFruitSearchQ('')}>
                  <FontAwesome name="circle-xmark" size={16} color={c.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {/* Fruit List */}
            <FlatList
              data={filteredFruitsList}
              keyExtractor={(item, idx) => `picker-${item.name}-${idx}`}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 40 }}
              numColumns={3}
              initialNumToRender={15}
              maxToRenderPerBatch={10}
              windowSize={5}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={{
                    flex: 1, margin: 6, alignItems: 'center',
                    backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc',
                    padding: 12, borderRadius: 16,
                  }}
                  activeOpacity={0.7}
                  onPress={() => {
                    // Instantly add and close
                    if (fruitPickerMode === 'owned') {
                      const newOwned = [...ownedFruitsRef.current, item];
                      setOwnedFruits(newOwned);
                      dismissUndo(); // Undo restores a snapshot; it would drop this add
                    } else {
                      const newWishlist = [...wishlistFruitsRef.current, item];
                      setWishlistFruits(newWishlist);
                    }
                    setShowFruitPicker(false);
                    setFruitSearchQ('');
                  }}
                >
                  <Image resizeMethod="resize"
                    source={{ uri: getImgUrl(item.name, item.type) }}
                    style={{ width: 48, height: 48, borderRadius: 12, marginBottom: 8, backgroundColor: item.type === 'p' ? '#FFCC0020' : (isDarkMode ? '#1e293b' : '#fff') }}
                    resizeMode="contain"
                  />
                  {item.type === 'p' && (
                    <View style={[s.permBadge, { top: 8, right: 8, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6 }]}>
                      <Text style={[s.permBadgeText, { fontSize: 8 }]}>P</Text>
                    </View>
                  )}
                  <Text style={{ fontSize: 11, fontWeight: '700', color: c.text, textAlign: 'center' }} numberOfLines={1}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingTop: 60 }}>
                  <Text style={{ fontSize: 40 }}>🔍</Text>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: c.textSecondary, marginTop: 12 }}>{t('engagement.trade_journal.no_fruits_found')}</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ═══════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════
const s = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Tab bar
  tabBar: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 8, alignItems: 'center' },
  tabPill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  tabPillText: { fontSize: 13, fontWeight: '700' },

  // Value card
  heroCard: {
    borderRadius: 16, padding: 24, alignItems: 'center',
    marginBottom: 12, marginTop: 16,
  },
  heroLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 },
  heroValue: { fontSize: 38, fontWeight: '900', letterSpacing: -1 },
  heroSub: { fontSize: 13, marginTop: 6, fontWeight: '500' },
  
  // Add Fruit Row Button
  addFruitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12, marginBottom: 14,
    borderWidth: 1.5, borderColor: 'rgba(245, 158, 11, 0.2)', borderStyle: 'dashed',
  },
  addFruitText: { fontSize: 14, fontWeight: '700' },

  // Fruit grid
  fruitCard: {
    width: FRUIT_CARD_SIZE, margin: 4, padding: 8,
    borderRadius: 12, borderWidth: 1, alignItems: 'center',
  },
  fruitImg: { width: 44, height: 44, borderRadius: 8, marginBottom: 4 },
  fruitName: { fontSize: 10, fontWeight: '700', textAlign: 'center' },
  fruitValue: { fontSize: 9, marginTop: 1 },
  permBadge: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: '#FFCC00', borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1,
  },
  permBadgeText: { fontSize: 7, fontWeight: '800', color: '#000' },

  // FAB
  fab: {
    position: 'absolute', bottom: 20, right: 20,
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '700' },
  emptySubtext: { fontSize: 12 },

  // Goal row
  goalRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, marginBottom: 8, borderRadius: 12, borderWidth: 1,
  },
  goalImg: { width: 40, height: 40, borderRadius: 8 },
  goalName: { fontSize: 13, fontWeight: '700' },
  goalValue: { fontSize: 11, marginTop: 2 },
  goalDone: { padding: 4 },
  goalRemove: { padding: 4 },

  // ── Done Trades: stats header ──
  statsCard: { borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1 },
  statsCardTitle: { fontSize: 14, fontWeight: '700', marginBottom: 10 },
  barChartWrap: { flexDirection: 'row', height: 28, borderRadius: 8, overflow: 'hidden', gap: 2 },
  barSegment: { justifyContent: 'center', alignItems: 'center' },
  barSegmentText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  barLegend: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, fontWeight: '600' },
  statsGridRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  statsGridItem: { flex: 1, alignItems: 'center', borderRadius: 12, paddingVertical: 12, borderWidth: 1 },
  statsGridValue: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  statsGridLabel: { fontSize: 10, marginTop: 2, textAlign: 'center' },
  clearHistoryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10, marginTop: 4,
  },
  clearHistoryText: { color: '#EF4444', fontSize: 12, fontWeight: '700' },
  loadMoreBtn: {
    paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 8, borderWidth: 1,
  },
  loadMoreText: { fontSize: 13, fontWeight: '700' },

  // ── Done Trades: trade card ──
  tlCard: { borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1 },
  tlHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 },
  tlResultBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  tlResultText: { fontSize: 11, fontWeight: '800' },
  tlNetBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8 },
  tlNetText: { fontSize: 10, fontWeight: '800' },
  tlDate: { fontSize: 10, marginLeft: 'auto' },
  tlTradeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  tlSide: { flex: 1 },
  tlSideLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, marginBottom: 4 },
  tlBubbles: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tlImg: { width: 32, height: 32, borderRadius: 6 },
  tlValRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  tlValText: { fontSize: 11, fontWeight: '700' },
  tlNotes: { fontSize: 11, fontStyle: 'italic', marginTop: 8 },
  tlDeleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end', marginTop: 8, padding: 4 },
  tlDeleteText: { color: '#EF4444', fontSize: 11, fontWeight: '700' },

  // ── My Fruits: select mode ──
  inventoryActionsRow: { flexDirection: 'row', gap: 8 },
  flex1: { flex: 1 },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 16, borderRadius: 12, marginBottom: 14,
    borderWidth: 1.5, borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  selectBtnActive: { borderColor: SELECT_ACCENT, backgroundColor: 'rgba(245, 158, 11, 0.15)' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 10 },
  selectChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  selectChipActive: { backgroundColor: 'rgba(245, 158, 11, 0.15)', borderColor: SELECT_ACCENT },
  selectChipText: { fontSize: 12, fontWeight: '700' },
  // border 1→2 with padding 8→7 keeps the card the same size
  fruitCardSelected: { borderWidth: 2, padding: 7, borderColor: SELECT_ACCENT },
  selectOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 10, zIndex: 10 },
  selectOverlayActive: { backgroundColor: 'rgba(245, 158, 11, 0.12)' },
  selectCheck: { position: 'absolute', top: 3, right: 3 },
  selectBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderTopWidth: 1,
  },
  selectBarCount: { fontSize: 14, fontWeight: '700' },
  selectBarRemove: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#EF4444', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10,
  },
  selectBarRemoveDisabled: { opacity: 0.4 },
  selectBarRemoveText: { color: '#FFF', fontSize: 14, fontWeight: '800' },

  // ── My Fruits: list, card, search / sort / filters, undo ──
  // The list pads 16; header rows sit 4 further in, level with the cards.
  ownedListContent: { paddingHorizontal: 16, paddingBottom: 100 },
  ownedHeader: { marginHorizontal: 4 },
  fruitRemoveBtn: {
    position: 'absolute', top: -6, right: -6, zIndex: 10,
    backgroundColor: '#EF4444', borderRadius: 12, padding: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 3,
  },
  fruitImgPerm: { backgroundColor: '#FFCC0020' },
  permBadgeLeft: { left: 4, right: undefined },
  emptyEmoji: { fontSize: 40 },
  emptyTextGap: { marginTop: 8 },
  ownedTools: { marginBottom: 10 },
  ownedSearchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, height: 38, marginBottom: 8,
  },
  ownedSearchInput: { flex: 1, fontSize: 13, padding: 0 },
  sortRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  sortChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
  sortChipActive: { backgroundColor: SELECT_ACCENT, borderColor: SELECT_ACCENT },
  sortChipText: { fontSize: 11, fontWeight: '700' },
  filterToggle: {
    marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: SELECT_ACCENT,
  },
  filterToggleActive: { backgroundColor: SELECT_ACCENT },
  filterToggleText: { fontSize: 11, fontWeight: '700', color: SELECT_ACCENT },
  filterToggleTextActive: { color: '#FFF' },
  filterPanel: { marginTop: 8, borderRadius: 12, borderWidth: 1, padding: 10, gap: 10 },
  filterGroup: { gap: 6 },
  filterGroupTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  filterChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1,
  },
  filterChipText: { fontSize: 11, fontWeight: '700' },
  filterSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  filterSummaryText: { fontSize: 11, fontWeight: '600' },
  filterClearText: { fontSize: 11, fontWeight: '800', color: SELECT_ACCENT },
  undoBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 12, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, backgroundColor: '#1F2937',
  },
  undoText: { flex: 1, color: '#F9FAFB', fontSize: 13, fontWeight: '600' },
  undoBtn: { color: '#FBBF24', fontSize: 13, fontWeight: '900', textTransform: 'uppercase' },
});

export default TradeJournal;
