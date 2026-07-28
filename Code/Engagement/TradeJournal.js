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
import { getThemeColors } from '../Helper/themeColors';
import config from '../Helper/Environment';

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
  { key: 'fruits', icon: 'lemon', label: 'My Fruits' },
  { key: 'goals', icon: 'star', label: 'Goals' },
  { key: 'timeline', icon: 'clock-rotate-left', label: 'Done Trades' },
];

const RESULT_META = {
  win:  { emoji: '🏆', label: 'I Won!', color: '#10B981' },
  fair: { emoji: '🤝', label: 'Even',   color: '#F59E0B' },
  loss: { emoji: '📉', label: 'I Lost', color: '#EF4444' },
};

// Trade history pages 5 at a time (server-side, RTDB)
const PAGE_SIZE = 5;

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
    Alert.alert('Clear trade history?', 'This deletes every logged trade and resets your stats. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear All', style: 'destructive',
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
            Alert.alert('Done', 'Trade history cleared.');
          } catch (err) {
            Alert.alert('Error', 'Could not clear history.');
          }
        },
      },
    ]);
  }, [db, uid]);

  // ── Delete single history item ──
  const deleteHistoryItem = useCallback((item) => {
    Alert.alert('Delete this trade?', 'This will remove this trade record.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
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
            Alert.alert('Error', 'Could not delete trade.');
          }
        },
      },
    ]);
  }, [db, uid, updateTradeStats]);

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
  useEffect(() => {
    if (!hasFetchedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveFruits(ownedFruits, wishlistFruits);
    }, 300);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [ownedFruits, wishlistFruits, saveFruits]);

  // Remove fruit from owned
  const removeFruit = useCallback((index) => {
    Alert.alert('Remove Fruit', 'Remove this fruit from your inventory?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => {
          const newOwned = ownedFruits.filter((_, i) => i !== index);
          setOwnedFruits(newOwned);
          saveFruits(newOwned, wishlistFruits);
        },
      },
    ]);
  }, [ownedFruits, wishlistFruits, saveFruits]);

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

  const lookupFruitValue = useCallback((fruit) => {
    if (!fruit?.name || parsedData.length === 0) return Number(fruit?.value) || 0;
    const fruitName = (fruit.name || '').toLowerCase().trim();
    const item = parsedData.find(d => (d?.name || '').toLowerCase().trim() === fruitName);
    if (!item) return Number(fruit?.value) || 0;
    if (fruit.type === 'p') return Number(item.permValue || item.value) || 0;
    return Number(item.rvalue || item.value) || 0;
  }, [parsedData]);

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

  // ═══════════════════════════════════════════════════
  // RENDER: My Fruits Tab
  // ═══════════════════════════════════════════════════
  const renderFruitsTab = () => (
    <View style={{ flex: 1 }}>
      {/* Portfolio hero card */}
      <View style={[s.heroCard, { backgroundColor: isDarkMode ? '#1e293b' : '#fffbeb' }]}>
        <Text style={[s.heroLabel, { color: '#F59E0B' }]}>MY INVENTORY WORTH</Text>
        <Text style={[s.heroValue, { color: '#F59E0B' }]}>🍋 {formatValue(portfolioValue)}</Text>
        <Text style={[s.heroSub, { color: c.textSecondary }]}>{ownedFruits.length} fruits collected</Text>
      </View>
      
      {/* Add Fruit Button */}
      <View style={{ paddingHorizontal: 16 }}>
        <TouchableOpacity
          style={[s.addFruitBtn, { backgroundColor: isDarkMode ? '#1e293b' : '#fefce8' }]}
          onPress={() => { setFruitPickerMode('owned'); setShowFruitPicker(true); }}
        >
          <Text style={[s.addFruitText, { color: '#F59E0B' }]}>+ Add Fruit to Inventory</Text>
        </TouchableOpacity>
      </View>

      {/* Fruits grid */}
      <FlatList
        data={ownedFruits}
        numColumns={3}
        keyExtractor={(_, i) => `owned-${i}`}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        ListEmptyComponent={
          <View style={s.emptyState}>
            <Text style={{ fontSize: 40 }}>🍋</Text>
            <Text style={[s.emptyText, { color: c.textSecondary, marginTop: 8 }]}>No fruits yet</Text>
            <Text style={[s.emptySubtext, { color: c.textMuted }]}>Tap + to add your first fruit</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <View style={[s.fruitCard, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
            <TouchableOpacity 
              style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#EF4444', borderRadius: 12, padding: 2, zIndex: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 3 }}
              onPress={() => removeFruit(index)}
              activeOpacity={0.7}
              hitSlop={{ top: 15, right: 15, bottom: 15, left: 15 }}
            >
              <Icon name="close" size={16} color="#FFF" />
            </TouchableOpacity>

            <Image
              source={{ uri: getImgUrl(item.name, item.type) }}
              style={[s.fruitImg, item.type === 'p' && { backgroundColor: '#FFCC0020' }]}
              resizeMode="contain"
            />
            <Text style={[s.fruitName, { color: c.text }]} numberOfLines={1}>{item.name}</Text>
            <Text style={[s.fruitValue, { color: c.textSecondary }]}>{formatValue(lookupFruitValue(item))}</Text>
            {item.type === 'p' && <View style={[s.permBadge, { left: 4, right: undefined }]}><Text style={s.permBadgeText}>P</Text></View>}
          </View>
        )}
      />


    </View>
  );

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
              <Text style={[s.addFruitText, { color: '#F59E0B' }]}>+ Add Dream Fruit</Text>
            </TouchableOpacity>
          </View>
        }
        ListEmptyComponent={
          <View style={s.emptyState}>
            <Text style={{ fontSize: 40, marginBottom: 8 }}>✨</Text>
            <Text style={[s.emptyText, { color: c.textSecondary }]}>No goals yet</Text>
            <Text style={[s.emptySubtext, { color: c.textMuted }]}>Add fruits you want to get!</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const val = lookupFruitValue(item);
          const hasIt = ownedFruits.some(o => o.name === item.name && o.type === item.type);
          return (
            <View style={[s.goalRow, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
              <Image source={{ uri: getImgUrl(item.name, item.type) }} style={s.goalImg} resizeMode="contain" />
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
          if (diffDays === 0) dateStr = 'Today';
          else if (diffDays === 1) dateStr = 'Yesterday';
          else if (diffDays < 7) dateStr = `${diffDays} days ago`;
          else dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
      } catch {}
    }

    const renderSide = (items, label, color, alignEnd) => (
      <View style={[s.tlSide, alignEnd && { alignItems: 'flex-end' }]}>
        <Text style={[s.tlSideLabel, { color }]}>{label}</Text>
        <View style={[s.tlBubbles, alignEnd && { justifyContent: 'flex-end' }]}>
          {items.map((f, i) => (
            <Image
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
            <Text style={[s.tlResultText, { color: meta.color }]}>{meta.emoji} {meta.label}</Text>
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
              <Text style={{ fontSize: 10, color: '#EF4444', fontWeight: '700' }}>⚠️ Scam</Text>
            </View>
          )}
          {dateStr ? <Text style={[s.tlDate, { color: c.textSecondary }]}>{dateStr}</Text> : null}
        </View>

        <View style={s.tlTradeRow}>
          {renderSide(gaveItems, 'I GAVE', '#EF4444', false)}
          <FontAwesome name="arrow-right" size={12} color={c.textSecondary} />
          {renderSide(gotItems, 'I GOT', '#10B981', true)}
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
          <Text style={s.tlDeleteText}>Delete</Text>
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
              <Text style={[s.statsCardTitle, { color: c.text }]}>📊 Trade Results</Text>
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
                {[['Win', '#10B981'], ['Fair', '#F59E0B'], ['Loss', '#EF4444']].map(([label, color]) => (
                  <View key={label} style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: color }]} />
                    <Text style={[s.legendText, { color: c.textSecondary }]}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Quick stats grid */}
            <View style={s.statsGridRow}>
              <View style={[s.statsGridItem, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
                <Text style={{ fontSize: 20 }}>📦</Text>
                <Text style={[s.statsGridValue, { color: c.text }]}>{stats.total}</Text>
                <Text style={[s.statsGridLabel, { color: c.textSecondary }]}>Total Trades</Text>
              </View>
              <View style={[s.statsGridItem, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
                <Text style={{ fontSize: 20 }}>🏆</Text>
                <Text style={[s.statsGridValue, { color: '#10B981' }]}>{stats.winRate}%</Text>
                <Text style={[s.statsGridLabel, { color: c.textSecondary }]}>Win Rate</Text>
              </View>
              <View style={[s.statsGridItem, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
                <Text style={{ fontSize: 20 }}>{stats.netValue >= 0 ? '📈' : '📉'}</Text>
                <Text style={[s.statsGridValue, { color: stats.netValue >= 0 ? '#10B981' : '#EF4444' }]}>
                  {stats.netValue >= 0 ? '+' : ''}{formatValue(stats.netValue)}
                </Text>
                <Text style={[s.statsGridLabel, { color: c.textSecondary }]}>Net Value</Text>
              </View>
            </View>

            <TouchableOpacity style={s.clearHistoryBtn} onPress={clearHistory} activeOpacity={0.7}>
              <FontAwesome name="trash-can" size={12} color="#EF4444" />
              <Text style={s.clearHistoryText}>Clear History</Text>
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
                : <Text style={[s.loadMoreText, { color: c.text }]}>Load More ⬇️</Text>}
            </TouchableOpacity>
          ) : null
        }
        ListEmptyComponent={
          <View style={s.emptyState}>
            <Text style={{ fontSize: 40 }}>📈</Text>
            <Text style={[s.emptyText, { color: c.textSecondary, marginTop: 8 }]}>No trades yet!</Text>
            <Text style={[s.emptySubtext, { color: c.textMuted, textAlign: 'center' }]}>
              Calculate a trade, then tap “Log Trade” to save it here 🍋
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
          <Text style={{ fontSize: 20, fontWeight: '800', color: '#fff' }}>My Stuff</Text>
        </View>

        {/* Tab bar wrapped in the hero gradient */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={{ flexDirection: 'row', paddingHorizontal: 12, gap: 8, alignItems: 'center' }}
        >
          {TABS.map(t => {
            const isActive = tab === t.key;
            // On dark hero bg, active=white filled, inactive=frosted glass transparent
            return (
              <TouchableOpacity
                key={t.key}
                style={[
                  s.tabPill, 
                  isActive ? { backgroundColor: '#fff', borderColor: 'transparent' } : { backgroundColor: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.25)' }
                ]}
                onPress={() => setTab(t.key)}
                activeOpacity={0.8}
              >
                <FontAwesome name={t.icon} size={12} color={isActive ? (isDarkMode ? '#2d1b69' : config.colors.primary) : '#ffffff'} solid={isActive} />
                <Text style={[s.tabPillText, { color: isActive ? (isDarkMode ? '#2d1b69' : config.colors.primary) : '#ffffff' }]}>{t.label}</Text>
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
            style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' }}
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
                {fruitPickerMode === 'owned' ? 'Add to Inventory' : 'Add Dream Fruit'}
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
                placeholder="Search fruits..."
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
                    } else {
                      const newWishlist = [...wishlistFruitsRef.current, item];
                      setWishlistFruits(newWishlist);
                    }
                    setShowFruitPicker(false);
                    setFruitSearchQ('');
                  }}
                >
                  <Image
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
                  <Text style={{ fontSize: 16, fontWeight: '700', color: c.textSecondary, marginTop: 12 }}>No fruits found</Text>
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
    marginHorizontal: 16, marginBottom: 12, marginTop: 16,
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
});

export default TradeJournal;
