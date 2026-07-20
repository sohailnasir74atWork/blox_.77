/**
 * TradeJournal.js — My Stuff Hub
 *
 * 2-tab hub:
 * 🍋 My Fruits — owned fruits grid, add new, total value
 * ⭐ Goals  — wishlist with progress bars
 *
 * Active/History trades were removed from here — the Trades feed
 * now has My Trades / Saved filters for instant access.
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
};

const TABS = [
  { key: 'fruits', icon: 'lemon', label: 'My Fruits' },
  { key: 'goals', icon: 'star', label: 'Goals' },
];

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

  // Initial data load
  const initialLoadDoneRef = useRef(false);
  useEffect(() => {
    if (visible && !initialLoadDoneRef.current) {
      setLoading(true);
      fetchFruits().finally(() => {
        setLoading(false);
        initialLoadDoneRef.current = true;
        setTimeout(() => { hasFetchedRef.current = true; }, 200);
      });
    }
  }, [visible, fetchFruits]);

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

});

export default TradeJournal;
