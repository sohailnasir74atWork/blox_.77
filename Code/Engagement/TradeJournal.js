/**
 * TradeJournal.js — My Stuff Hub
 *
 * 4-tab hub:
 * 🍋 My Fruits — owned fruits grid, add new, total value
 * ⭐ Goals  — wishlist with progress bars
 * ⚡ Active Trades — my posted trades + saved/accepted trades from others
 * 📈 Timeline — trade history feed
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, Image,
  StyleSheet, Dimensions, ActivityIndicator, Alert, ScrollView, Modal, TextInput, StatusBar, RefreshControl,
} from 'react-native';
import { useNavigation, useIsFocused, useRoute, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection, query, where, orderBy, limit, getDocs, startAfter,
  doc, updateDoc, getDoc, setDoc, deleteDoc, serverTimestamp as fsServerTimestamp,
} from '@react-native-firebase/firestore';
import LinearGradient from 'react-native-linear-gradient';
import { ref, get, set, push, remove, serverTimestamp, query as rtdbQuery, orderByChild, limitToLast, endBefore, onValue } from '@react-native-firebase/database';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../LocalGlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import { unsaveTrade, pingTrader, fetchTradeAcceptors, removeAllTradeAcceptors } from '../Trades/tradeHelpers';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';
import { useGlobalState } from '../GlobelStats';
import Clipboard from '@react-native-clipboard/clipboard';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import config from '../Helper/Environment';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const FRUIT_CARD_SIZE = (SCREEN_WIDTH - 64) / 3;

const RESULT_META = {
  win:  { emoji: '🏆', label: 'I Won',  color: '#10B981' },
  fair: { emoji: '🤝', label: 'Even', color: '#F59E0B' },
  loss: { emoji: '📉', label: 'I Lost', color: '#EF4444' },
};

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
  active: '#10B981',
  timeline: '#8B5CF6',
};

const TABS = [
  { key: 'fruits', icon: 'lemon', label: 'My Fruits' },
  { key: 'goals', icon: 'star', label: 'Goals' },
  { key: 'active', icon: 'bolt', label: 'Active Trades' },
  { key: 'timeline', icon: 'clock-rotate-left', label: 'History' },
];

const TradeJournal = ({
  firestoreDB, db, uid, isDarkMode,
}) => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute();
  const visible = useIsFocused();
  const { localState, updateLocalState } = useLocalState();
  const [tab, setTab] = useState(route.params?.initialTab || 'fruits');
  const [ownedFruits, setOwnedFruits] = useState(localState.ownedFruits || []);
  const [wishlistFruits, setWishlistFruits] = useState(localState.wishlistFruits || []);
  const [activeTrades, setActiveTrades] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const activeLastDocRef = useRef(null);
  const [hasMoreActive, setHasMoreActive] = useState(true);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const PAGE_SIZE = 5;
  const [completing, setCompleting] = useState(null);
  const [selectedRating, setSelectedRating] = useState('fair');
  const [showFruitPicker, setShowFruitPicker] = useState(false);
  const [fruitPickerMode, setFruitPickerMode] = useState('owned');
  const [fruitSearchQ, setFruitSearchQ] = useState('');
  const { user } = useGlobalState();
  const [savedTrades, setSavedTrades] = useState([]);
  const [savedDrawerTrade, setSavedDrawerTrade] = useState(null);
  const [savedDrawerVisible, setSavedDrawerVisible] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('mine');
  const [acceptorCounts, setAcceptorCounts] = useState({});
  const [acceptorListTradeId, setAcceptorListTradeId] = useState(null);
  const [acceptorList, setAcceptorList] = useState([]);
  const [acceptorListLoading, setAcceptorListLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const highlightTradeId = route.params?.highlightTradeId || null;
  const highlightHandledRef = useRef(false);

  // Edit Mode State
  const [editingTrade, setEditingTrade] = useState(null);
  const [editGave, setEditGave] = useState([]);
  const [editGot, setEditGot] = useState([]);
  const [editPickerSide, setEditPickerSide] = useState(null); // 'gave' | 'got'
  const editPickerSideRef = useRef(editPickerSide);
  useEffect(() => { editPickerSideRef.current = editPickerSide; }, [editPickerSide]);
  const ownedFruitsRef = useRef(ownedFruits);
  const wishlistFruitsRef = useRef(wishlistFruits);
  useEffect(() => { ownedFruitsRef.current = ownedFruits; }, [ownedFruits]);
  useEffect(() => { wishlistFruitsRef.current = wishlistFruits; }, [wishlistFruits]);

  const c = getThemeColors(isDarkMode);
  const insets = useSafeAreaInsets();
  const listMomentumRef = useRef(true);
  
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

  // When arriving from a notification with highlightTradeId, fetch that trade and open acceptors
  useEffect(() => {
    if (!highlightTradeId || !firestoreDB) return;
    highlightHandledRef.current = false;
    setTab('active');
    setActiveSubTab('mine');
    setHasMoreActive(false);
    setLoading(true);
    (async () => {
      try {
        const [snap] = await Promise.all([
          getDoc(doc(firestoreDB, 'trades_new_upgrade', highlightTradeId)),
          fetchFruits(),
          fetchHistory(),
          fetchTradeStats(),
          fetchSavedTrades(),
        ]);
        if (snap.exists()) {
          const trade = { id: snap.id, ...snap.data() };
          setActiveTrades([trade]);
          fetchAcceptorCounts([trade]);
          openAcceptorList(highlightTradeId);
        }
      } catch (e) {
        console.warn('[TradeJournal] fetch highlighted trade error:', e?.message);
      } finally {
        setLoading(false);
        highlightHandledRef.current = true;
        navigation.setParams({ highlightTradeId: undefined, initialTab: undefined });
      }
    })();
  }, [highlightTradeId, firestoreDB]);

  // Sync tab when navigating from notification without highlightTradeId
  useEffect(() => {
    const paramTab = route.params?.initialTab;
    if (paramTab && !highlightTradeId && TABS.some(t => t.key === paramTab)) {
      setTab(paramTab);
      navigation.setParams({ initialTab: undefined });
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

  // ── Fetch active trades (paginated) ──
  const fetchActiveTrades = useCallback(async (loadMore = false, passedLastDoc = null, isRecursiveRootRefresh = false) => {
    if (!firestoreDB || !uid) return;
    try {
      let q;
      const lastDoc = passedLastDoc || (loadMore ? activeLastDocRef.current : null);
      if (lastDoc) {
        q = query(
          collection(firestoreDB, 'trades_new_upgrade'),
          where('userId', '==', uid),
          orderBy('timestamp', 'desc'),
          startAfter(lastDoc),
          limit(PAGE_SIZE),
        );
      } else {
        q = query(
          collection(firestoreDB, 'trades_new_upgrade'),
          where('userId', '==', uid),
          orderBy('timestamp', 'desc'),
          limit(PAGE_SIZE),
        );
      }
      const snap = await getDocs(q);
      const newTrades = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => !t.completed);
      
      let nextLastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : lastDoc;
      const rootRefresh = (!loadMore && !passedLastDoc) || isRecursiveRootRefresh;

      // Handle the case where all loaded trades were marked completed and filtered out
      if (newTrades.length === 0 && snap.docs.length >= PAGE_SIZE) {
        // Recursively fetch the next batch without flickering the UI loader
        return fetchActiveTrades(true, nextLastDoc, rootRefresh);
      }

      if (snap.docs.length > 0) {
        activeLastDocRef.current = nextLastDoc;
      }
      setHasMoreActive(snap.docs.length >= PAGE_SIZE);
      
      if (rootRefresh) {
        setActiveTrades(newTrades);
      } else {
        if (newTrades.length === 0) return;
        setActiveTrades(prev => {
          const map = new Map(prev.map(t => [t.id, t]));
          newTrades.forEach(t => map.set(t.id, t));
          return Array.from(map.values());
        });
      }
    } catch (err) {
      console.warn('[MyStuff] fetch trades error:', err?.message);
      setHasMoreActive(false); // Stop loop if error
    }
  }, [firestoreDB, uid]);

  // ── Fetch saved/accepted trades (RTDB refs → Firestore docs) ──
  const fetchSavedTrades = useCallback(async () => {
    if (!db || !uid || !firestoreDB) return;
    try {
      const snap = await get(ref(db, `savedTrades/${uid}`));
      if (!snap.exists()) { setSavedTrades([]); return; }
      const refs = snap.val();
      const entries = Object.entries(refs);
      const results = await Promise.all(
        entries.map(async ([tradeId, refData]) => {
          try {
            const tSnap = await getDoc(doc(firestoreDB, 'trades_new_upgrade', tradeId));
            if (tSnap.exists()) return { id: tradeId, ...tSnap.data(), _savedRef: refData };
            return { id: tradeId, _deleted: true, _savedRef: refData };
          } catch {
            return { id: tradeId, _deleted: true, _savedRef: refData };
          }
        })
      );
      setSavedTrades(results);
    } catch (e) {
      console.warn('[MyStuff] fetch saved trades error:', e?.message);
    }
  }, [db, uid, firestoreDB]);

  // Real-time listener — keeps saved/accepted tabs in sync after initial load
  useEffect(() => {
    if (!db || !uid || !firestoreDB) return;
    const savedRef = ref(db, `savedTrades/${uid}`);
    let initialFired = false;
    const unsubscribe = onValue(savedRef, async (snapshot) => {
      // Skip the first fire — initial load is handled by fetchSavedTrades in Promise.all
      if (!initialFired) { initialFired = true; return; }
      if (!snapshot.exists()) { setSavedTrades([]); return; }
      const refs = snapshot.val();
      const entries = Object.entries(refs);
      try {
        const results = await Promise.all(
          entries.map(async ([tradeId, refData]) => {
            try {
              const tSnap = await getDoc(doc(firestoreDB, 'trades_new_upgrade', tradeId));
              if (tSnap.exists()) return { id: tradeId, ...tSnap.data(), _savedRef: refData };
              return { id: tradeId, _deleted: true, _savedRef: refData };
            } catch {
              return { id: tradeId, _deleted: true, _savedRef: refData };
            }
          })
        );
        setSavedTrades(results);
      } catch (e) {
        console.warn('[MyStuff] onValue saved trades error:', e?.message);
      }
    });
    return () => unsubscribe();
  }, [db, uid, firestoreDB]);

  // Fetch acceptor counts for all active trades
  const fetchAcceptorCounts = useCallback(async (trades) => {
    if (!db || !trades || trades.length === 0) return;
    const counts = {};
    await Promise.all(
      trades.map(async (trade) => {
        const acceptors = await fetchTradeAcceptors(db, trade.id);
        const count = Object.keys(acceptors).length;
        if (count > 0) counts[trade.id] = count;
      })
    );
    setAcceptorCounts(counts);
  }, [db]);

  // Open acceptors list
  const openAcceptorList = useCallback(async (tradeId) => {
    if (!db) return;
    setAcceptorListTradeId(tradeId);
    setAcceptorListLoading(true);
    const acceptors = await fetchTradeAcceptors(db, tradeId);
    const list = Object.entries(acceptors).map(([uid, data]) => ({
      uid,
      name: data.name || 'Unknown',
      robloxUsername: data.robloxUsername || '',
      avatar: data.avatar || '',
      acceptedAt: data.acceptedAt || 0,
    })).sort((a, b) => (b.acceptedAt || 0) - (a.acceptedAt || 0));
    setAcceptorList(list);
    setAcceptorListLoading(false);
  }, [db]);

  // Trade stats
  const [tradeStats, setTradeStats] = useState(null);
  const fetchTradeStats = useCallback(async () => {
    if (!db || !uid) return;
    try {
      const snap = await get(ref(db, `tradeStats/${uid}`));
      if (snap.exists()) setTradeStats(snap.val());
      else setTradeStats(null);
    } catch (err) {
      console.warn('[MyStuff] fetch stats error:', err?.message);
    }
  }, [db, uid]);

  const updateTradeStats = useCallback(async (rating, gaveValue, gotValue, delta = 1) => {
    if (!db || !uid) return;
    try {
      const snap = await get(ref(db, `tradeStats/${uid}`));
      const current = snap.exists() ? snap.val() : { total: 0, wins: 0, fairs: 0, losses: 0, totalGave: 0, totalGot: 0 };
      const updated = {
        total: (current.total || 0) + delta,
        wins: (current.wins || 0) + (rating === 'win' ? delta : 0),
        fairs: (current.fairs || 0) + (rating === 'fair' ? delta : 0),
        losses: (current.losses || 0) + (rating === 'loss' ? delta : 0),
        totalGave: (current.totalGave || 0) + (gaveValue * delta),
        totalGot: (current.totalGot || 0) + (gotValue * delta),
      };
      await set(ref(db, `tradeStats/${uid}`), updated);
      setTradeStats(updated);
    } catch (err) {
      console.warn('[MyStuff] update stats error:', err?.message);
    }
  }, [db, uid]);

  // Fetch trade history
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
        if (!loadMore) { setHistory([]); setHasMoreHistory(false); }
        else { setHasMoreHistory(false); }
        return;
      }
      const data = snap.val();
      const arr = Object.entries(data).map(([id, val]) => ({ id, ...val }));
      arr.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      if (arr.length > 0) {
        historyLastTimestampRef.current = arr[arr.length - 1].completedAt || 0;
      }
      setHasMoreHistory(arr.length >= PAGE_SIZE);
      if (loadMore) {
        setHistory(prev => {
          const map = new Map(prev.map(t => [t.id, t]));
          arr.forEach(t => map.set(t.id, t));
          // Re-sort descending just in case
          return Array.from(map.values()).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
        });
      } else {
        historyLastTimestampRef.current = arr.length > 0 ? arr[arr.length - 1].completedAt || 0 : null;
        setHistory(arr);
      }
    } catch (err) {
      console.warn('[MyStuff] fetch history error:', err?.message);
    }
  }, [db, uid]);

  // Delete active trade
  const deleteActiveTrade = useCallback((item) => {
    Alert.alert('Delete Trade', 'Are you sure you want to delete this trade?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            if (firestoreDB && item.id) await deleteDoc(doc(firestoreDB, 'trades_new_upgrade', item.id));
            if (db && item.id) await removeAllTradeAcceptors(db, item.id);
            setActiveTrades(prev => prev.filter(t => t.id !== item.id));
            setAcceptorCounts(prev => { const next = { ...prev }; delete next[item.id]; return next; });
          } catch {
            Alert.alert('Error', 'Could not delete trade.');
          }
        },
      },
    ]);
  }, [firestoreDB, db]);

  // Initial data load
  const initialLoadDoneRef = useRef(false);
  useEffect(() => {
    if (highlightTradeId) return; // handled by highlight effect
    if (visible) {
      if (!initialLoadDoneRef.current) {
        activeLastDocRef.current = null;
        setHasMoreActive(true);
        setHasMoreHistory(true);
        setLoading(true);
        Promise.all([fetchFruits(), fetchActiveTrades(), fetchHistory(), fetchTradeStats(), fetchSavedTrades()])
          .finally(() => {
            setLoading(false);
            initialLoadDoneRef.current = true;
            setTimeout(() => { hasFetchedRef.current = true; }, 200);
          });
      } else {
        activeLastDocRef.current = null;
        setHasMoreActive(true);
        Promise.all([fetchActiveTrades()]);
      }
    }
  }, [visible, fetchFruits, fetchActiveTrades, fetchHistory, fetchTradeStats, fetchSavedTrades]);

  useEffect(() => {
    if (activeTrades.length > 0) fetchAcceptorCounts(activeTrades);
  }, [activeTrades, fetchAcceptorCounts]);

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

  // ── Map raw trade items to clean objects ──
  const mapItems = useCallback((items) => (items || []).map(i => ({
    name: i.name || i.Name || i.itemName || 'Unknown',
    image: i.image || i.Image || i.imageUrl || null,
    value: Number(i.value) || 0,
    type: i.type || i.category || 'f',
  })), []);

  // ── Start "Complete As Is" flow ──
  const startCompleteAsIs = useCallback((trade) => {
    setEditingTrade(trade);
    setEditGave(mapItems(trade.hasItems));
    setEditGot(mapItems(trade.wantsItems));
    setCompleting(trade.id);
    setSelectedRating('fair');
  }, [mapItems]);

  // ── Start "Edit Items" flow ──
  const startEditItems = useCallback((trade) => {
    setEditingTrade(trade);
    setEditGave(mapItems(trade.hasItems));
    setEditGot(mapItems(trade.wantsItems));
    setCompleting(trade.id + '_edit');
    setSelectedRating('fair');
  }, [mapItems]);

  // ── Remove item from editing list ──
  const removeEditItem = useCallback((side, index) => {
    if (side === 'gave') setEditGave(prev => prev.filter((_, i) => i !== index));
    else setEditGot(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ── Handle Final Completion (with Edited Items) ──
  const handleComplete = useCallback(async (trade, rating) => {
    if (!db || !uid || !firestoreDB) return;
    if (editGave.length === 0 || editGot.length === 0) {
      Alert.alert('Add Items', 'You must have at least one item on both sides of the trade to complete it.');
      return;
    }
    setCompleting('saving');
    try {
      const gave = editGave;
      const got = editGot;
      const gaveValue = gave.reduce((s, p) => s + (p.value || 0), 0);
      const gotValue = got.reduce((s, p) => s + (p.value || 0), 0);

      // 1. Save trade record to RTDB
      const recordPayload = {
        tradeId: trade.id || Date.now().toString(),
        gave,
        got,
        gaveTotal: gaveValue,
        gotTotal: gotValue,
        rating,
        completedAt: serverTimestamp(),
      };
      await push(ref(db, `tradeJournal/${uid}`), recordPayload);
      
      // Update global trade stats logic
      if (typeof updateTradeStats === 'function') {
        await updateTradeStats(rating, gaveValue, gotValue);
      }

      // Cleanup active trade flags
      if (trade.id && !trade.id.startsWith('manual_')) {
        await updateDoc(doc(firestoreDB, 'trades_new_upgrade', trade.id), { completed: true });
        await removeAllTradeAcceptors(db, trade.id);
        setActiveTrades(prev => prev.filter(t => t.id !== trade.id));
        setAcceptorCounts(prev => { const next = { ...prev }; delete next[trade.id]; return next; });
      }

      setHistory(prev => [{
        id: Date.now().toString(),
        ...recordPayload,
        recordId: Date.now().toString(),
        completedAt: Date.now(),
      }, ...prev]);

      // 2. Auto-Update Inventory
      let updatedOwned = [...ownedFruits];
      let removedNames = [];
      let notOwnedNames = [];
      let addedNames = [];

      gave.forEach(g => {
        const idx = updatedOwned.findIndex(p =>
          (p.name || '').toLowerCase() === (g.name || '').toLowerCase()
        );
        if (idx !== -1) {
          updatedOwned.splice(idx, 1);
          removedNames.push(g.name);
        } else {
          notOwnedNames.push(g.name);
        }
      });

      got.forEach(g => {
        if (g.name) {
          updatedOwned.push({ name: g.name, type: g.type || 'f', value: g.value || 0 });
          addedNames.push(g.name);
        }
      });
      
      setOwnedFruits(updatedOwned);
      saveFruits(updatedOwned, wishlistFruits);

      // 3. Dynamic Success Action Message
      let msg = `Recorded as: ${rating}\n\n`;
      if (addedNames.length > 0) msg += `✅ Added: ${addedNames.join(', ')}\n`;
      if (removedNames.length > 0) msg += `🔄 Removed: ${removedNames.join(', ')}\n`;
      if (notOwnedNames.length > 0) msg += `⚠️ Note: You gave ${notOwnedNames.join(', ')} but didn't have it in your inventory.\n`;

      if (typeof showSuccessMessage === 'function') {
        showSuccessMessage('Trade Completed!', msg.trim());
      } else {
        Alert.alert('Trade Completed!', msg.trim());
      }
    } catch (err) {
      console.warn('[handleComplete Error]', err);
      if (typeof showErrorMessage === 'function') {
        showErrorMessage('Error', 'Could not complete trade.');
      } else {
        Alert.alert('Error', 'Could not complete trade.');
      }
    }
    setCompleting(null);
    setEditingTrade(null);
  }, [db, uid, firestoreDB, updateTradeStats, ownedFruits, wishlistFruits, saveFruits, editGave, editGot]);

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
  // RENDER: Active Trades Tab
  // ═══════════════════════════════════════════════════
  const formatName = (name) => name.replace(/^\+/, '').replace(/\s+/g, '-');

  const renderActiveTab = () => {
    const filteredSaved = savedTrades.filter(t => {
      if (activeSubTab === 'saved') return t._savedRef?.type === 'saved';
      if (activeSubTab === 'accepted') return t._savedRef?.type === 'accepted';
      return false;
    });

    const showMine = activeSubTab === 'mine';
    const dataToShow = showMine ? activeTrades : filteredSaved;

    return (
      <View style={{ flex: 1 }}>
        {/* Sub-tab pills */}
        <View style={s.subTabRow}>
          {['mine', 'saved', 'accepted'].map(sub => {
            const isActive = activeSubTab === sub;
            const labels = { mine: 'My Trades', saved: 'Saved', accepted: 'Accepted' };
            return (
              <TouchableOpacity
                key={sub}
                style={[s.subTab, isActive && { backgroundColor: TAB_COLORS.active, borderColor: TAB_COLORS.active }]}
                onPress={() => setActiveSubTab(sub)}
              >
                <Text style={[s.subTabText, isActive && { color: '#fff' }]}>{labels[sub]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <FlatList
          data={dataToShow}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                activeLastDocRef.current = null;
                setHasMoreActive(true);
                fetchActiveTrades().finally(() => setRefreshing(false));
              }}
              tintColor={TAB_COLORS.active}
            />
          }
          onMomentumScrollBegin={() => { listMomentumRef.current = false; }}
          onEndReached={() => {
            if (showMine && hasMoreActive && !loadingMore && activeLastDocRef.current && !listMomentumRef.current) {
              listMomentumRef.current = true;
              setLoadingMore(true);
              fetchActiveTrades(true).finally(() => setLoadingMore(false));
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
          ListEmptyComponent={
            <View style={s.emptyState}>
              <Icon name="swap-horizontal" size={40} color={c.textMuted} />
              <Text style={[s.emptyText, { color: c.textSecondary }]}>
                {showMine ? 'No active trades' : `No ${activeSubTab} trades`}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            if (item._deleted) {
              return (
                <View style={[s.tradeCard, { backgroundColor: c.bgAlt, borderColor: c.border, opacity: 0.5 }]}>
                  <Text style={[s.tradeCardTitle, { color: c.textSecondary }]}>Trade no longer available</Text>
                  <TouchableOpacity
                    onPress={async () => {
                      await unsaveTrade(db, uid, item.id);
                      setSavedTrades(prev => prev.filter(t => t.id !== item.id));
                    }}
                    style={s.removeBtn}
                  >
                    <Text style={s.removeBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              );
            }

            const hasItems = item.hasItems || [];
            const wantsItems = item.wantsItems || [];
            const acceptorCount = acceptorCounts[item.id] || 0;
            const isEditing = completing === item.id + '_edit';
            const isCompleting = completing === item.id || isEditing;

            return (
              <View style={[s.tradeCard, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
                {/* Trade items */}
                <View style={[s.tradeItemsRow, isCompleting && { opacity: 0.6 }]}>
                  <View style={s.tradeItemsSide}>
                    <Text style={[s.tradeSideLabel, { color: '#10B981' }]}>HAS</Text>
                    <View style={s.tradeItemsGrid}>
                      {(isEditing ? editGave : hasItems).slice(0, 4).map((hi, i) => (
                        <View key={i} style={s.editItemBubble}>
                          <Image source={{ uri: getImgUrl(hi.name, hi.type) }} style={s.tradeItemImgSm} resizeMode="contain" />
                          {isEditing && (
                            <TouchableOpacity style={s.editRemoveBadge} onPress={() => removeEditItem('gave', i)}>
                              <Icon name="close" size={10} color="#fff" />
                            </TouchableOpacity>
                          )}
                        </View>
                      ))}
                      {isEditing && (
                        <TouchableOpacity
                          style={s.addEditItemBtn}
                          onPress={() => {
                            setEditPickerSide('gave');
                            setFruitPickerMode('owned');
                            setShowFruitPicker(true);
                          }}
                        >
                          <FontAwesome name="plus" size={12} color="#10B981" />
                        </TouchableOpacity>
                      )}
                    </View>
                    {!isEditing && item.hasTotal?.value > 0 && <Text style={[s.tradeSideValue, { color: c.textSecondary }]}>{formatValue(item.hasTotal.value)}</Text>}
                  </View>

                  <FontAwesome name="arrow-right-arrow-left" size={14} color={c.textMuted} style={{ marginHorizontal: 6 }} />

                  <View style={s.tradeItemsSide}>
                    <Text style={[s.tradeSideLabel, { color: '#3B82F6' }]}>WANTS</Text>
                    <View style={s.tradeItemsGrid}>
                      {(isEditing ? editGot : wantsItems).slice(0, 4).map((wi, i) => (
                        <View key={i} style={s.editItemBubble}>
                          <Image source={{ uri: getImgUrl(wi.name, wi.type) }} style={s.tradeItemImgSm} resizeMode="contain" />
                          {isEditing && (
                            <TouchableOpacity style={s.editRemoveBadge} onPress={() => removeEditItem('got', i)}>
                              <Icon name="close" size={10} color="#fff" />
                            </TouchableOpacity>
                          )}
                        </View>
                      ))}
                      {isEditing && (
                        <TouchableOpacity
                          style={s.addEditItemBtn}
                          onPress={() => {
                            setEditPickerSide('got');
                            setFruitPickerMode('owned');
                            setShowFruitPicker(true);
                          }}
                        >
                          <FontAwesome name="plus" size={12} color="#3B82F6" />
                        </TouchableOpacity>
                      )}
                    </View>
                    {!isEditing && item.wantsTotal?.value > 0 && <Text style={[s.tradeSideValue, { color: c.textSecondary }]}>{formatValue(item.wantsTotal.value)}</Text>}
                  </View>
                </View>

                {/* Edit Flow Details */}
                {isCompleting && (
                  <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12 }}>
                    {/* Rating selector */}
                    <Text style={{ fontSize: 11, fontWeight: '700', color: c.textSecondary, marginBottom: 8, textAlign: 'center' }}>
                      How did this trade go?
                    </Text>
                    <View style={s.ratingRow}>
                      {Object.entries(RESULT_META).map(([key, meta]) => (
                        <TouchableOpacity
                          key={key}
                          style={[s.ratingPillSelector, selectedRating === key && { backgroundColor: meta.color + '22', borderColor: meta.color }]}
                          onPress={() => setSelectedRating(key)}
                        >
                          <Text style={{ fontSize: 16 }}>{meta.emoji}</Text>
                          <Text style={[s.ratingLabel, { color: c.text }]}>{t(meta.label)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {/* Save / Cancel */}
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                      <TouchableOpacity style={s.cancelEditBtn} onPress={() => { setCompleting(null); setEditingTrade(null); }}>
                        <Text style={{ color: c.textSecondary, fontWeight: '600', fontSize: 13 }}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.saveEditBtn, { backgroundColor: RESULT_META[selectedRating].color }]}
                        onPress={() => handleComplete(item, selectedRating)}
                      >
                        <Text style={s.saveEditBtnText}>Save to History</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* Actions for my trades */}
                {showMine && !isCompleting && (
                  <View style={s.tradeCardActions}>
                    {acceptorCount > 0 && (
                      <TouchableOpacity style={s.acceptorBadge} onPress={() => openAcceptorList(item.id)}>
                        <Icon name="people" size={14} color="#fff" />
                        <Text style={s.acceptorBadgeText}>{acceptorCount} accepted</Text>
                      </TouchableOpacity>
                    )}
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity style={s.completeAsIsBtn} onPress={() => startCompleteAsIs(item)}>
                      <Icon name="checkmark-done" size={12} color="#fff" />
                      <Text style={s.completeAsIsText}>Complete As Is</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.adjustItemsBtn} onPress={() => startEditItems(item)}>
                      <Icon name="create-outline" size={12} color={c.textSecondary} />
                      <Text style={[s.adjustItemsText, { color: c.textSecondary }]}>Edit</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={s.deleteBtn} onPress={() => deleteActiveTrade(item)}>
                      <Icon name="trash-outline" size={14} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                )}

                {/* Actions for saved/accepted trades */}
                {!showMine && (
                  <View style={s.tradeCardActions}>
                    <Text style={[s.traderName, { color: c.textSecondary }]}>by {item.traderName || 'Unknown'}</Text>
                    {item._savedRef?.traderRobloxUsername ? (
                      <TouchableOpacity
                        onPress={() => {
                          Clipboard.setString(item._savedRef.traderRobloxUsername);
                          showSuccessMessage('Copied!', item._savedRef.traderRobloxUsername);
                        }}
                        style={s.copyBtn}
                      >
                        <Icon name="copy-outline" size={12} color={config.colors.primary} />
                        <Text style={[s.copyBtnText, { color: config.colors.primary }]}>{item._savedRef.traderRobloxUsername}</Text>
                      </TouchableOpacity>
                    ) : null}
                    <View style={{ flex: 1 }} />
                    {/* Ping */}
                    {item._savedRef?.type === 'accepted' && (
                      <TouchableOpacity
                        style={s.pingBtn}
                        onPress={async () => {
                          try {
                            await pingTrader(db, firestoreDB, uid, user?.displayName || 'Someone', item);
                            showSuccessMessage('Pinged!', 'The trader has been notified.');
                          } catch (e) {
                            showErrorMessage('Error', e?.message || 'Could not ping.');
                          }
                        }}
                      >
                        <Icon name="notifications-outline" size={14} color="#F59E0B" />
                      </TouchableOpacity>
                    )}
                    {/* Chat */}
                    <TouchableOpacity
                      style={s.chatBtn}
                      onPress={() => {
                        navigation.navigate('PrivateChatTrade', {
                          selectedUser: {
                            senderId: item.userId,
                            sender: item.traderName,
                            avatar: item.avatar,
                          },
                          item,
                        });
                      }}
                    >
                      <Icon name="chatbubble" size={12} color="#fff" />
                    </TouchableOpacity>
                    {/* Remove */}
                    <TouchableOpacity
                      style={s.deleteBtn}
                      onPress={async () => {
                        await unsaveTrade(db, uid, item.id);
                        setSavedTrades(prev => prev.filter(t => t.id !== item.id));
                        showSuccessMessage('Removed', '');
                      }}
                    >
                      <Icon name="close" size={14} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
        />

        {/* Acceptors modal */}
        {acceptorListTradeId && (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
            <View style={[s.acceptorModal, { backgroundColor: c.bgElevated }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={[s.acceptorModalTitle, { color: c.text }]}>People who accepted</Text>
                <TouchableOpacity onPress={() => { setAcceptorListTradeId(null); setAcceptorList([]); }}>
                  <Icon name="close" size={22} color={c.textSecondary} />
                </TouchableOpacity>
              </View>
              {acceptorListLoading ? (
                <ActivityIndicator />
              ) : acceptorList.length === 0 ? (
                <Text style={{ color: c.textSecondary, textAlign: 'center', paddingVertical: 20 }}>No one has accepted yet</Text>
              ) : (
                <FlatList
                  data={acceptorList}
                  keyExtractor={(item) => item.uid}
                  renderItem={({ item: acc }) => (
                    <View style={[s.acceptorRow, { borderColor: c.border }]}>
                      <Image source={{ uri: acc.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }} style={s.acceptorAvatar} />
                      <View style={{ flex: 1 }}>
                        <Text style={[s.acceptorName, { color: c.text }]}>{acc.name}</Text>
                        {acc.robloxUsername ? (
                          <TouchableOpacity onPress={() => { Clipboard.setString(acc.robloxUsername); showSuccessMessage('Copied!', acc.robloxUsername); }}>
                            <Text style={{ color: config.colors.primary, fontSize: 11 }}>{acc.robloxUsername} (tap to copy)</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                      <TouchableOpacity
                        style={s.chatBtn}
                        onPress={() => {
                          setAcceptorListTradeId(null);
                          navigation.navigate('PrivateChatTrade', {
                            selectedUser: { senderId: acc.uid, sender: acc.name, avatar: acc.avatar },
                          });
                        }}
                      >
                        <Icon name="chatbubble" size={12} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  )}
                />
              )}
            </View>
          </View>
        )}
      </View>
    );
  };

  // ═══════════════════════════════════════════════════
  // RENDER: Timeline Tab
  // ═══════════════════════════════════════════════════
  const renderTimelineTab = () => (
    <View style={{ flex: 1 }}>
      {/* Stats summary */}
      {tradeStats && (
        <View style={[s.statsRow, { borderColor: c.border }]}>
          <View style={s.statItem}>
            <Text style={[s.statNumber, { color: c.text }]}>{tradeStats.total || 0}</Text>
            <Text style={[s.statLabel, { color: c.textSecondary }]}>Total</Text>
          </View>
          <View style={s.statItem}>
            <Text style={[s.statNumber, { color: '#10B981' }]}>{tradeStats.wins || 0}</Text>
            <Text style={[s.statLabel, { color: c.textSecondary }]}>Wins</Text>
          </View>
          <View style={s.statItem}>
            <Text style={[s.statNumber, { color: '#F59E0B' }]}>{tradeStats.fairs || 0}</Text>
            <Text style={[s.statLabel, { color: c.textSecondary }]}>Fair</Text>
          </View>
          <View style={s.statItem}>
            <Text style={[s.statNumber, { color: '#EF4444' }]}>{tradeStats.losses || 0}</Text>
            <Text style={[s.statLabel, { color: c.textSecondary }]}>Losses</Text>
          </View>
        </View>
      )}

      <FlatList
        data={history}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        onEndReached={() => {
          if (hasMoreHistory && !loadingMore && historyLastTimestampRef.current !== null) {
            setLoadingMore(true);
            fetchHistory(true).finally(() => setLoadingMore(false));
          }
        }}
        onEndReachedThreshold={0.3}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
        ListEmptyComponent={
          <View style={s.emptyState}>
            <Text style={{ fontSize: 40 }}>📈</Text>
            <Text style={[s.emptyText, { color: c.textSecondary, marginTop: 8 }]}>No trade history</Text>
            <Text style={[s.emptySubtext, { color: c.textMuted }]}>Complete trades to see them here</Text>
          </View>
        }
        renderItem={({ item }) => {
          const meta = RESULT_META[item.rating] || RESULT_META.fair;
          const gave = item.gave || [];
          const got = item.got || [];
          return (
            <View style={[s.historyCard, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <View style={[s.ratingPill, { backgroundColor: meta.color + '20' }]}>
                  <Text style={{ fontSize: 12 }}>{meta.emoji}</Text>
                  <Text style={[s.ratingText, { color: meta.color }]}>{meta.label}</Text>
                </View>
                <Text style={[s.historyTime, { color: c.textMuted }]}>
                  {item.completedAt ? dayjs(item.completedAt).fromNow() : ''}
                </Text>
              </View>
              <View style={s.tradeItemsRow}>
                <View style={s.tradeItemsSide}>
                  <Text style={[s.tradeSideLabel, { color: '#EF4444', fontSize: 9 }]}>GAVE</Text>
                  <View style={s.tradeItemsGrid}>
                    {gave.slice(0, 4).map((gi, i) => (
                      <Image key={i} source={{ uri: getImgUrl(gi.name, gi.type) }} style={s.tradeItemImgSm} resizeMode="contain" />
                    ))}
                  </View>
                </View>
                <FontAwesome name="arrow-right" size={10} color={c.textMuted} />
                <View style={s.tradeItemsSide}>
                  <Text style={[s.tradeSideLabel, { color: '#10B981', fontSize: 9 }]}>GOT</Text>
                  <View style={s.tradeItemsGrid}>
                    {got.slice(0, 4).map((gi, i) => (
                      <Image key={i} source={{ uri: getImgUrl(gi.name, gi.type) }} style={s.tradeItemImgSm} resizeMode="contain" />
                    ))}
                  </View>
                </View>
              </View>
            </View>
          );
        }}
      />

      {/* Clear history button */}
      {history.length > 0 && (
        <TouchableOpacity
          style={s.clearHistoryBtn}
          onPress={() => {
            Alert.alert('Clear History', 'Delete all trade history?', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Clear All', style: 'destructive',
                onPress: async () => {
                  try {
                    if (db && uid) await remove(ref(db, `tradeJournal/${uid}`));
                    if (db && uid) await remove(ref(db, `tradeStats/${uid}`));
                    setHistory([]);
                    setTradeStats(null);
                  } catch {
                    Alert.alert('Error', 'Could not clear history.');
                  }
                },
              },
            ]);
          }}
        >
          <Icon name="trash-outline" size={14} color="#EF4444" />
          <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '600' }}>Clear History</Text>
        </TouchableOpacity>
      )}
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
          {tab === 'active' && renderActiveTab()}
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
          setEditPickerSide(null);
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
              setEditPickerSide(null);
            }}
          />

          {/* Drawer content */}
          <View style={{
            backgroundColor: isDarkMode ? '#1e293b' : '#fff',
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            height: '80%', padding: 20,
            shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 10,
          }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: c.text }}>
                {editPickerSideRef.current ? 'Select a Fruit' : (fruitPickerMode === 'owned' ? 'Add to Inventory' : 'Add Dream Fruit')}
              </Text>
              <TouchableOpacity onPress={() => { setShowFruitPicker(false); setFruitSearchQ(''); setEditPickerSide(null); }}>
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
                    if (editPickerSideRef.current) {
                      const itemToAdd = { name: item.name, image: getImgUrl(item.name, item.type), value: item.value, type: item.type };
                      if (editPickerSideRef.current === 'gave') {
                        setEditGave(prev => [...prev, itemToAdd]);
                      } else {
                        setEditGot(prev => [...prev, itemToAdd]);
                      }
                      setEditPickerSide(null);
                    } else if (fruitPickerMode === 'owned') {
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

  // Sub-tabs (active trades)
  subTabRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginTop: 16, marginBottom: 12 },
  subTab: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  subTabText: { fontSize: 11, fontWeight: '700', color: '#64748b' },

  // Trade card
  tradeCard: {
    padding: 14, marginBottom: 10, borderRadius: 14, borderWidth: 1,
  },
  tradeCardTitle: { fontSize: 13, fontWeight: '600' },
  tradeItemsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  tradeItemsSide: { flex: 1, alignItems: 'center' },
  tradeSideLabel: { fontSize: 10, fontWeight: '800', marginBottom: 4, letterSpacing: 0.5 },
  tradeSideValue: { fontSize: 10, marginTop: 4 },
  tradeItemsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4 },
  tradeItemImg: { width: 36, height: 36, borderRadius: 8 },
  tradeItemImgSm: { width: 28, height: 28, borderRadius: 6 },
  tradeCardActions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  traderName: { fontSize: 11, fontWeight: '600' },

  // Acceptor badge
  acceptorBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#10B981', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
  },
  acceptorBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  // Buttons
  completeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#10B981', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
  },
  completeBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  deleteBtn: { padding: 6, borderRadius: 8, backgroundColor: '#FEE2E2' },
  removeBtn: { marginTop: 8, alignSelf: 'flex-start' },
  removeBtnText: { color: '#EF4444', fontSize: 12, fontWeight: '600' },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  copyBtnText: { fontSize: 11, fontWeight: '600' },
  pingBtn: { padding: 6, borderRadius: 8, backgroundColor: '#FEF3C7' },
  chatBtn: {
    padding: 6, borderRadius: 8, backgroundColor: config.colors.primary,
  },
  clearHistoryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: 10, marginHorizontal: 16, marginBottom: 20,
    borderRadius: 10, borderWidth: 1, borderColor: '#FCA5A5',
  },

  // Stats
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    marginHorizontal: 16, marginBottom: 12,
    paddingVertical: 12, borderRadius: 14, borderWidth: 1,
  },
  statItem: { alignItems: 'center' },
  statNumber: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 10, fontWeight: '600', marginTop: 2 },

  // History card
  historyCard: {
    padding: 12, marginBottom: 8, borderRadius: 12, borderWidth: 1,
  },
  ratingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  ratingText: { fontSize: 11, fontWeight: '700' },
  historyTime: { fontSize: 10 },

  // Acceptor modal
  acceptorModal: {
    width: '100%', maxHeight: '70%',
    borderRadius: 20, padding: 20,
  },
  acceptorModalTitle: { fontSize: 16, fontWeight: '800' },
  acceptorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1,
  },
  acceptorAvatar: { width: 36, height: 36, borderRadius: 18 },
  acceptorName: { fontSize: 13, fontWeight: '700' },

  // Edit Mode Styles
  editItemBubble: { position: 'relative', margin: 4 },
  editRemoveBadge: {
    position: 'absolute', top: -6, right: -6,
    backgroundColor: '#EF4444', width: 16, height: 16, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#fff'
  },
  addEditItemBtn: {
    width: 28, height: 28, borderRadius: 6, margin: 4,
    borderWidth: 1.5, borderColor: '#e2e8f0', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.02)'
  },
  completeAsIsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#10B981', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
  },
  completeAsIsText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  adjustItemsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.05)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
  },
  adjustItemsText: { fontSize: 11, fontWeight: '700' },
  ratingRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  ratingPillSelector: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1.5, borderColor: 'transparent', backgroundColor: 'rgba(0,0,0,0.03)'
  },
  ratingLabel: { fontSize: 12, fontWeight: '800' },
  cancelEditBtn: {
    flex: 0.3, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.05)'
  },
  saveEditBtn: {
    flex: 0.7, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 12
  },
  saveEditBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});

export default TradeJournal;
