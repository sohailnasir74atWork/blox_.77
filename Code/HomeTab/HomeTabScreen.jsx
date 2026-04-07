import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  Image, Platform, Dimensions, Share, StatusBar, Modal, Animated, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import config from '../Helper/Environment';
import { useTranslation } from 'react-i18next';
import { setAppLanguage } from '../../i18n';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { doc, getDoc, collection, query, where, limit, getDocs } from '@react-native-firebase/firestore';
import { ref as dbRef, onValue } from '@react-native-firebase/database';

import { getStarStatus } from '../Engagement/starUtils';
import { getLevelFromXP, getXPProgress } from '../Engagement/xpUtils';

import LinearGradient from 'react-native-linear-gradient';
import SignInDrawer from '../Firebase/SigninDrawer';
import TrendingFruits from './TrendingFruits';
import StatusFeed from '../Design/StatusFeed';
import FramedAvatar from '../ChatScreen/GroupChat/FramedAvatar';
import { getCachedAvatar } from '../Helper/cosmeticsCache';
import { getActiveCosmetics } from '../Engagement/shopUtils';
import GameLeaderboard from '../Engagement/GameLeaderboard';


const { width } = Dimensions.get('window');
const TILE_MARGIN = 4;
const TILE = (width - 32 - TILE_MARGIN * 10) / 5; // 5 per row

const formatValue = (v) => {
  if (!v || typeof v !== 'number') return '0';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  if (v < 1) return v.toFixed(2);
  return v % 1 === 0 ? v.toString() : v.toFixed(2);
};

const AVAILABLE_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'pt', name: 'Português', flag: '🇧🇷' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'fil', name: 'Filipino', flag: '🇵🇭' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'id', name: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
];



const HomeTabScreen = ({ selectedTheme }) => {
  const { theme, user, appdatabase, firestoreDB, strikeInfo, isUserBlocked } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const isDarkMode = theme === 'dark';
  const insets = useSafeAreaInsets();

  const [canClaimStar, setCanClaimStar] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [userXP, setUserXP] = useState({ total: 0, level: 1 });
  const starPulse = useRef(new Animated.Value(1)).current;
  const [isSigninDrawerVisible, setSigninDrawerVisible] = useState(false);
  const [signinMessage, setSigninMessage] = useState('');
  const [ownedFruits, setOwnedFruits] = useState([]);
  const [myCosmetics, setMyCosmetics] = useState(null);
  const [showGameLeaderboard, setShowGameLeaderboard] = useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

  // Helper: require sign-in before performing action
  const requireSignIn = (action, message) => {
    const finalMessage = message || t('home_tab.sign_in_default', { defaultValue: 'Sign in to continue' });
    if (!user?.id) {
      setSigninMessage(finalMessage);
      setSigninDrawerVisible(true);
      return;
    }
    action();
  };

  const currentLang = AVAILABLE_LANGUAGES.find(l => l.code === i18n.language) || AVAILABLE_LANGUAGES[0];

  const changeLanguage = async (langCode) => {
    setAppLanguage(langCode);
    setShowLangPicker(false);
  };

  const heroGradient = isDarkMode
    ? ['#1a1035', '#2d1b69', '#1a1035']
    : [config.colors.primary, '#4f46e5', '#6366f1'];

  // Set status bar light text when Home screen is focused
  useFocusEffect(
    useCallback(() => {
      StatusBar.setBarStyle('light-content', true);
      return () => {
        StatusBar.setBarStyle(isDarkMode ? 'light-content' : 'dark-content', true);
      };
    }, [isDarkMode])
  );

  // Fetch/refresh owned fruits on focus for portfolio value
  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !firestoreDB) return;
      (async () => {
        try {
          let snap = await getDoc(doc(firestoreDB, 'user_profiles', user.id));
          if (!snap.exists()) snap = await getDoc(doc(firestoreDB, 'reviews', user.id));
          if (snap.exists()) {
            setOwnedFruits(Array.isArray(snap.data()?.ownedFruits) ? snap.data().ownedFruits : []);
          }
        } catch (e) { console.warn('[Home] fetch fruits:', e?.message); }
      })();
    }, [user?.id, firestoreDB])
  );

  // Fetch active cosmetics on focus
  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !appdatabase) return;
      getActiveCosmetics(appdatabase, user.id).then(setMyCosmetics).catch(() => {});
    }, [user?.id, appdatabase])
  );

  // Check unread notifications count on focus
  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !firestoreDB) return;
      (async () => {
        try {
          const q = query(
            collection(firestoreDB, 'notifications'),
            where('toUid', '==', user.id),
            where('read', '==', false),
            limit(10),
          );
          const snap = await getDocs(q);
          setUnreadNotifCount(snap.docs.length);
        } catch (e) {
          // Silently fail
        }
      })();
    }, [user?.id, firestoreDB])
  );

  // Live XP listener
  useEffect(() => {
    if (!user?.id || !appdatabase) return;

    const xpRef = dbRef(appdatabase, `users/${user.id}/xp`);

    const unsubscribe = onValue(xpRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        setUserXP({
          total: data.total || 0,
          level: data.level || 1,
        });
      }
    });

    return () => unsubscribe();
  }, [user?.id, appdatabase]);

  // Star badge pulse animation
  useEffect(() => {
    if (canClaimStar) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(starPulse, { toValue: 1.4, duration: 500, useNativeDriver: true }),
          Animated.timing(starPulse, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [canClaimStar]);

  // Check if daily star is claimable
  useEffect(() => {
    if (!user?.id || !appdatabase) return;
    getStarStatus(appdatabase, user.id).then(s => setCanClaimStar(!!s?.canClaim));
  }, [user?.id, appdatabase]);

  // Parse fruit data for value lookup
  const parsedData = useMemo(() => {
    try {
      const raw = localState?.data;
      if (!raw) return [];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
    } catch { return []; }
  }, [localState?.data]);

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

  // Quick Action Items
  const quickActions = useMemo(() => [
    { key: 'values', icon: 'lemon', label: t('home_tab.action_values', { defaultValue: 'Values' }), color: '#2563EB', onPress: () => navigation.navigate('FruitValuesStack') },
    { key: 'top_traders', icon: 'trophy', label: t('home_tab.action_top_traders', { defaultValue: 'Top Traders' }), color: '#10B981', onPress: () => navigation.navigate('LeaderboardStack') },
    { key: 'stars', icon: 'star', label: t('home_tab.action_stars', { defaultValue: 'Stars' }), color: '#FB923C', onPress: () => requireSignIn(() => navigation.navigate('BadgesScreen'), t('home_tab.signin_claim_stars', { defaultValue: 'Sign in to claim stars' })), hasBadge: canClaimStar },
    { key: 'cosmetics', icon: 'shirt', label: t('home_tab.action_cosmetics', { defaultValue: 'My Cosmetics' }), color: '#EC4899', onPress: () => requireSignIn(() => navigation.navigate('CosmeticsScreen'), t('home_tab.signin_cosmetics', { defaultValue: 'Sign in to access cosmetics' })) },
    { key: 'following', icon: 'heart', label: t('home_tab.action_friends', { defaultValue: 'Friends' }), color: '#A855F7', onPress: () => requireSignIn(() => navigation.navigate('SocialDashboardScreen'), t('home_tab.signin_friends', { defaultValue: 'Sign in to see friends' })) },
    { key: 'mods', icon: 'shield-halved', label: t('home_tab.action_mods', { defaultValue: 'Mods' }), color: '#0EA5E9', onPress: () => navigation.navigate('ModsScreen') },
  ], [t, i18n.language, navigation, canClaimStar, user?.id]);

  // XP computed values
  const currentLevel = useMemo(() => getLevelFromXP(userXP.total), [userXP.total]);
  const xpProgress = useMemo(() => getXPProgress(userXP.total), [userXP.total]);

  // Greeting based on time of day
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return t('home_tab.good_morning', { defaultValue: 'Good Morning' });
    if (hour < 17) return t('home_tab.good_afternoon', { defaultValue: 'Good Afternoon' });
    return t('home_tab.good_evening', { defaultValue: 'Good Evening' });
  }, [t, i18n.language]);

  // ── Game navigation — ads are handled at end of round inside GameScreen ──
  const handleGamePress = useCallback((game) => {
    requireSignIn(() => {
      if (game.gameId) {
        navigation.navigate('GameScreen', { gameId: game.gameId, title: `${game.emoji} ${game.label}`, color: game.color });
      } else {
        navigation.navigate(game.screen);
      }
    }, 'Sign in to play');
  }, [navigation, user?.id]);

  const handleShare = async () => {
    const link = Platform.OS === 'ios' ? config.IOsShareLink : config.andriodShareLink;
    try {
      await Share.share({
        message: t('home_tab.share_message', { defaultValue: `Check out Blox Fruit Values Calculator! ${link}`, link }),
      });
    } catch (_) { }
  };

  return (
    <View style={{ flex: 1, backgroundColor: selectedTheme.colors.background }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={true}
        overScrollMode="never"
      >
        {/* Extends the dark top gradient infinitely upwards for smooth iOS rubber-banding */}
        <View style={{ position: 'absolute', top: -1000, left: 0, right: 0, height: 1000, backgroundColor: heroGradient[0] }} />

        {/* HERO WELCOME BANNER */}
        <LinearGradient
          colors={heroGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroBanner, { paddingTop: insets.top + 12 }]}
        >

          <View style={styles.heroContent}>
            <View style={styles.heroTextWrap}>
              <Text style={styles.heroGreeting}>{greeting}</Text>
              <Text style={styles.heroName} numberOfLines={1}>
                {user?.displayName || t('home_tab.fruit_trader_default', { defaultValue: 'Fruit Trader' })}
              </Text>
            </View>
            {/* Notification Bell + Settings */}
            <View style={styles.heroRightGroup}>
              <TouchableOpacity
                onPress={() => navigation.navigate('NotificationFeedScreen')}
                activeOpacity={0.7}
                style={styles.langIcon}
              >
                <Ionicons name="notifications-outline" size={20} color="rgba(255,255,255,0.85)" />
                {unreadNotifCount > 0 && (
                  <View style={{
                    position: 'absolute', top: 1, right: 1,
                    width: 10, height: 10, borderRadius: 5,
                    backgroundColor: '#FACC15',
                    borderWidth: 1.5,
                    borderColor: '#fff',
                  }} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => navigation.navigate('Setting')}
                activeOpacity={0.8}
              >
                {user?.avatar || getCachedAvatar() ? (
                  <FramedAvatar
                    avatarUri={user?.avatar || getCachedAvatar()}
                    frame={myCosmetics?.profileFrame || null}
                    isDarkMode={isDarkMode}
                    avatarSize={45}
                  />
                ) : (
                  <View style={{ width: 45, height: 45, borderRadius: 22.5, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                    <FontAwesome name="user" size={20} color="rgba(255,255,255,0.7)" solid />
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* XP Card */}
          <View style={[styles.xpCard]}>
            <View style={styles.xpCardRow}>
              <View style={styles.xpCardLeft}>
                <Text style={[styles.xpLevelEmoji]}>{currentLevel.emoji}</Text>
                <View>
                  <Text style={[styles.xpCardTitle, { color: isDarkMode ? config.darkColors.textPrimary : '#fff' }]}>{currentLevel.title}</Text>
                  <Text style={[styles.xpCardSub, { color: isDarkMode ? config.darkColors.textSecondary : 'rgba(255,255,255,0.7)' }]}>
                    {t('home_tab.xp_level_sub', { defaultValue: `Level ${currentLevel.level} • ${userXP.total.toLocaleString()} XP`, level: currentLevel.level, xp: userXP.total.toLocaleString() })}
                  </Text>
                </View>
              </View>
            </View>
            <View style={[styles.xpBarBg, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <LinearGradient
                colors={['#FFC107', '#FF9800', '#FF5722']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.xpBarFill, { width: `${Math.max(5, xpProgress * 100)}%` }]}
              />
            </View>
          </View>

          {/* ── My Stuff ── */}
          <TouchableOpacity
            onPress={() => requireSignIn(() => navigation.navigate('MyStuffScreen'), t('home_tab.signin_my_stuff', { defaultValue: 'Sign in to see your stuff' }))}
            activeOpacity={0.8}
            style={[styles.stuffWorthCard, { backgroundColor: 'rgba(0,0,0,0.15)' }]}
          >
            <View style={styles.stuffWorthHeader}>
              <View style={styles.stuffWorthTitleRow}>
                <FontAwesome name="lemon" size={14} color="#fff" solid />
                <Text style={styles.stuffWorthTitle}>{t('home_tab.my_stuff_worth', { defaultValue: 'My Stuff' })}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={styles.stuffWorthTotalPill}>
                  <FontAwesome name="tags" size={10} color="#FFC107" solid />
                  <Text style={styles.stuffWorthTotalText}>{formatValue(portfolioValue)}</Text>
                </View>
                <FontAwesome name="chevron-right" size={10} color="rgba(255,255,255,0.5)" />
              </View>
            </View>
          </TouchableOpacity>

        </LinearGradient>

        {/* Page content with background */}
        <View style={{ backgroundColor: selectedTheme.colors.background }}>

          {/* ═══ BAN STATUS CARD (only visible when actively banned) ═══ */}
          {isUserBlocked && strikeInfo && (
            <View style={{
              marginHorizontal: 16,
              marginTop: 14,
              marginBottom: 4,
              borderRadius: 16,
              overflow: 'hidden',
              borderWidth: 1.5,
              borderColor: isDarkMode ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.2)',
            }}>
              {/* Red header */}
              <View style={{
                backgroundColor: isDarkMode ? 'rgba(239,68,68,0.15)' : '#FEF2F2',
                paddingVertical: 12,
                paddingHorizontal: 16,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
              }}>
                <View style={{
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: isDarkMode ? 'rgba(239,68,68,0.25)' : '#FEE2E2',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Ionicons name="ban" size={18} color="#EF4444" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#EF4444' }}>
                    {strikeInfo.bannedUntil === 'permanent'
                      ? t('home_tab.ban_permanent', { defaultValue: 'Account Permanently Banned' })
                      : t('home_tab.ban_temporary', { defaultValue: 'Account Temporarily Restricted' })}
                  </Text>
                  <Text style={{ fontSize: 11, color: isDarkMode ? '#f87171' : '#DC2626', marginTop: 2 }}>
                    {t('home_tab.ban_strike', { defaultValue: `Strike ${strikeInfo.strikeCount || 1}`, count: strikeInfo.strikeCount || 1 })}
                    {' • '}
                    {strikeInfo.bannedUntil === 'permanent'
                      ? t('home_tab.ban_permanent_label', { defaultValue: 'Permanent' })
                      : (() => {
                          const diff = (strikeInfo.bannedUntil || 0) - Date.now();
                          if (diff <= 0) return t('home_tab.ban_expired', { defaultValue: 'Expired' });
                          const hrs = Math.floor(diff / (1000 * 60 * 60));
                          const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                          if (hrs > 24) return t('home_tab.ban_time_days', { defaultValue: `${Math.floor(hrs / 24)}d ${hrs % 24}h remaining`, days: Math.floor(hrs / 24), hours: hrs % 24 });
                          if (hrs > 0) return t('home_tab.ban_time_hours', { defaultValue: `${hrs}h ${mins}m remaining`, hours: hrs, minutes: mins });
                          return t('home_tab.ban_time_minutes', { defaultValue: `${mins}m remaining`, minutes: mins });
                        })()
                    }
                  </Text>
                </View>
              </View>
              {/* Reason body */}
              {strikeInfo.reason && (
                <View style={{
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  backgroundColor: isDarkMode ? 'rgba(239,68,68,0.06)' : '#FFFBFB',
                }}>
                  <Text style={{ fontSize: 10, fontWeight: '600', color: isDarkMode ? '#888' : '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
                    {t('home_tab.ban_reason_label', { defaultValue: 'Reason' })}
                  </Text>
                  <Text style={{ fontSize: 13, color: isDarkMode ? '#e5e5e5' : '#374151', lineHeight: 18 }}>
                    {strikeInfo.reason}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* QUICK ACTIONS */}
          <View style={styles.quickActionsRow}>
            {quickActions.map((action) => (
              <TouchableOpacity
                key={action.key}
                style={styles.quickActionBtn}
                onPress={action.onPress}
                activeOpacity={0.7}
              >
                <View style={{ position: 'relative' }}>
                  <View style={[styles.quickActionIcon, { backgroundColor: action.color + '14' }]}>
                    <FontAwesome name={action.icon} size={18} color={action.color} solid />
                  </View>
                  {action.hasBadge && (
                    <Animated.View style={[styles.starBadge, { transform: [{ scale: starPulse }] }]} />
                  )}
                </View>
                <Text style={[styles.quickActionLabel, { color: isDarkMode ? config.darkColors.textSecondary : '#64748b' }]} numberOfLines={1}>
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* STATUS FEED (Stories) */}
          <StatusFeed
            user={user}
            firestoreDB={firestoreDB}
            appdatabase={appdatabase}
            isDarkMode={isDarkMode}
            onRequireSignIn={() => {
              setSigninMessage(t('home_tab.signin_status', { defaultValue: 'Sign in to post a status' }));
              setSigninDrawerVisible(true);
            }}
          />

          {/* TRENDING FRUITS */}
          <TrendingFruits isDarkMode={isDarkMode} navigation={navigation} />

          {/* MINI GAMES */}
          <View style={styles.section}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="game-controller" size={22} color={selectedTheme.colors.text} />
                <Text style={[styles.sectionTitle, { color: selectedTheme.colors.text, marginBottom: 0 }]}>
                  {t('home_tab.mini_games_title', { defaultValue: 'Mini Games' })}
                </Text>
              </View>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', borderWidth: 1, borderColor: '#F59E0B' }}
                onPress={() => requireSignIn(() => setShowGameLeaderboard(true), 'Sign in to see ranks')}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 14 }}>🏆</Text>
                <Text style={{ fontSize: 12, fontWeight: '800', color: selectedTheme.colors.text }}>Ranks</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.gamesGrid}>
              {[
                { id: 'mystery', emoji: '🍋', label: 'Mystery',  color: '#16A34A', screen: 'MysteryEggScreen', tag: 'HOT' },
                { id: 'crash',   emoji: '🚀', label: 'Crash',    color: '#F59E0B', screen: 'FruitCrashScreen' },
                { id: 'spot',    emoji: '🍎', label: 'Smash',    color: '#B91C1C', screen: 'GameScreen', gameId: 'spot' },
                { id: 'safe',    emoji: '🔐', label: 'Chest',    color: '#D97706', screen: 'GameScreen', gameId: 'safe' },
                { id: 'draw',    emoji: '⚡', label: 'Slash',    color: '#DC2626', screen: 'GameScreen', gameId: 'draw' },
                { id: 'memory',  emoji: '🃏', label: 'Memory',   color: '#6366F1', screen: 'GameScreen', gameId: 'memory' },
              ].map((game) => (
                <TouchableOpacity
                  key={game.id}
                  style={[styles.gameTile, { backgroundColor: game.color }]}
                  onPress={() => {
                    if (game.premium && !localState?.isPro) {
                      Alert.alert('Pro Feature', 'Mystery Fruit unlocks cosmetics! Upgrade to Pro to play.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Go to Store', onPress: () => navigation.navigate('Store') },
                      ]);
                      return;
                    }
                    handleGamePress(game);
                  }}
                  activeOpacity={0.8}
                >
                  {game.tag && (
                    <View style={styles.gameTag}>
                      <Text style={styles.gameTagText}>{game.tag}</Text>
                    </View>
                  )}
                  <Text style={styles.gameEmoji}>{game.emoji}</Text>
                  <Text style={styles.gameTileLabel}>{game.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <GameLeaderboard visible={showGameLeaderboard} onClose={() => setShowGameLeaderboard(false)} />

          {/* SHARE BUTTON */}
          <View style={styles.section}>
            <TouchableOpacity
              onPress={handleShare}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#6366F1', '#4F46E5', '#4338CA']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.shareButton}
              >
                <FontAwesome name="lemon" size={18} color="#fff" solid />
                <Text style={styles.shareButtonText}>
                  {t('home_tab.invite_friends_play', { defaultValue: 'Invite Friends to Play' })}
                </Text>
                <FontAwesome name="paper-plane" size={14} color="#fff" solid />
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* OTHER APPS PROMO - commented out */}
          {/* <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              Linking.openURL(config.otherapplink);
            }}
          >
            <LinearGradient
              colors={isDarkMode ? ['#1a1033', '#2d1b54', '#1a1033'] : ['#1E1040', '#2d1b69', '#1E1040']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.promoCard}
            >
              <View style={styles.promoContent}>
                <Image
                  source={require('../../assets/adoptme.png')}
                  style={styles.promoLogo}
                  resizeMode="cover"
                />
                <View style={styles.promoTextWrap}>
                  <View style={styles.promoNewBadge}>
                    <Text style={styles.promoNewBadgeText}>{t('home_tab.check_it_out', { defaultValue: 'CHECK IT OUT' })}</Text>
                  </View>
                  <Text style={styles.promoTitle}>{t('home_tab.adoptme_title', { defaultValue: 'AdoptMe Values' })}</Text>
                  <Text style={styles.promoSubtitle}>{t('home_tab.adoptme_desc', { defaultValue: 'Trade calculator for Adopt Me' })}</Text>
                </View>
              </View>
              <LinearGradient
                colors={['#8B5CF6', '#7C3AED']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.promoBtn}
              >
                <FontAwesome name="download" size={14} color="#fff" />
                <Text style={styles.promoBtnText}>{t('home_tab.download_now', { defaultValue: 'Download Now' })}</Text>
                <FontAwesome name="arrow-right" size={11} color="#fff" />
              </LinearGradient>
            </LinearGradient>
          </TouchableOpacity> */}

          {/* MM2 VALUES PROMO - commented out */}
          {/* <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              Linking.openURL(config.otherapplink2);
            }}
          >
            <LinearGradient
              colors={isDarkMode ? ['#1a0a0a', '#3b1010', '#1a0a0a'] : ['#2a0a0a', '#4b1515', '#2a0a0a']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.promoCard}
            >
              <View style={styles.promoContent}>
                <Image
                  source={require('../../assets/MM2logo.webp')}
                  style={styles.promoLogo}
                  resizeMode="cover"
                />
                <View style={styles.promoTextWrap}>
                  <View style={[styles.promoNewBadge, { backgroundColor: '#EF4444' }]}>
                    <Text style={styles.promoNewBadgeText}>{t('home_tab.check_it_out', { defaultValue: 'CHECK IT OUT' })}</Text>
                  </View>
                  <Text style={styles.promoTitle}>{t('home_tab.mm2_title', { defaultValue: 'MM2 Values' })}</Text>
                  <Text style={styles.promoSubtitle}>{t('home_tab.mm2_desc', { defaultValue: 'Trade calculator for Murder Mystery 2' })}</Text>
                </View>
              </View>
              <LinearGradient
                colors={['#EF4444', '#DC2626']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.promoBtn}
              >
                <FontAwesome name="download" size={14} color="#fff" />
                <Text style={styles.promoBtnText}>{t('home_tab.download_now', { defaultValue: 'Download Now' })}</Text>
                <FontAwesome name="arrow-right" size={11} color="#fff" />
              </LinearGradient>
            </LinearGradient>
          </TouchableOpacity> */}

          {/* HOW IT WORKS */}
          <TouchableOpacity
            onPress={() => navigation.navigate('GuidesScreen')}
            activeOpacity={0.7}
            style={styles.howItWorksBtn}
          >
            <Ionicons name="help-circle-outline" size={18} color={isDarkMode ? '#94A3B8' : '#64748B'} />
            <Text style={[styles.howItWorksText, { color: isDarkMode ? '#94A3B8' : '#64748B' }]}>
              {t('guides.link_text', { defaultValue: 'How It Works' })}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={isDarkMode ? '#64748B' : '#94A3B8'} />
          </TouchableOpacity>

          {/* FOOTER */}
          <View style={styles.footer}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.footerLogo}
              resizeMode="contain"
            />
            <Text style={[styles.footerText, { color: isDarkMode ? config.darkColors.textMuted : '#BBB' }]}>
              {t('home_tab.made_with_love', { defaultValue: 'Made with love for Blox Fruit traders' })}
            </Text>
          </View>

        </View>
      </ScrollView>

      {/* Sign In Drawer */}
      <SignInDrawer
        visible={isSigninDrawerVisible}
        onClose={() => setSigninDrawerVisible(false)}
        selectedTheme={selectedTheme}
        screen="Home"
        message={signinMessage}
      />

      {/* Language Picker Modal */}
      <Modal visible={showLangPicker} animationType="fade" transparent>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
          activeOpacity={1}
          onPress={() => setShowLangPicker(false)}
        >
          <TouchableOpacity activeOpacity={1} style={{
            backgroundColor: isDarkMode ? '#1e293b' : '#fff',
            borderRadius: 20, padding: 20, width: '100%', maxWidth: 340,
          }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: isDarkMode ? '#f1f5f9' : '#111', marginBottom: 16, textAlign: 'center' }}>
              {t('home_tab.choose_language', { defaultValue: 'Choose Language' })}
            </Text>
            {AVAILABLE_LANGUAGES.map(lang => {
              const isActive = i18n.language === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={{
                    flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14,
                    borderRadius: 12, marginBottom: 4,
                    backgroundColor: isActive ? (isDarkMode ? '#3B82F620' : '#EFF6FF') : 'transparent',
                  }}
                  onPress={() => changeLanguage(lang.code)}
                >
                  <Text style={{ fontSize: 22, marginRight: 12 }}>{lang.flag}</Text>
                  <Text style={{ fontSize: 14, fontWeight: isActive ? '800' : '500', color: isDarkMode ? '#f1f5f9' : '#111', flex: 1 }}>
                    {lang.name}
                  </Text>
                  {isActive && <Text style={{ fontSize: 14, color: '#3B82F6' }}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },

  // Game Tiles
  gamesGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 0,
  },
  gameTile: {
    width: TILE,
    aspectRatio: 1,
    borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginHorizontal: TILE_MARGIN,
    marginBottom: TILE_MARGIN * 2,
  },
  gameEmoji: { fontSize: 24, marginBottom: 4 },
  gameTileLabel: { color: '#fff', fontSize: 9, fontWeight: '800', textAlign: 'center', paddingHorizontal: 2 },
  gameTag: {
    position: 'absolute', top: 3, right: 3,
    backgroundColor: '#FF3B30', borderRadius: 6,
    paddingHorizontal: 4, paddingVertical: 1,
  },
  gameTagText: { color: '#fff', fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },

  // Hero Banner
  heroBanner: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  heroContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 2,
    marginBottom: 14,
  },
  heroTextWrap: {
    flex: 1,
    marginRight: 16,
  },
  heroGreeting: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  heroName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: -0.3,
  },
  heroRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  langIcon: {
    backgroundColor: 'transparent',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langIconText: {
    fontSize: 15,
  },

  // XP Card
  xpCard: {
    marginHorizontal: 0,
    borderRadius: 14,
  },
  xpCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  xpCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  xpLevelEmoji: {
    fontSize: 20,
  },
  xpCardTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  xpCardSub: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: 1,
  },
  xpBarBg: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
  },
  xpBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#FFC107',
  },

  // My Stuff Worth card
  stuffWorthCard: {
    marginTop: 10,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  stuffWorthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stuffWorthTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stuffWorthTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  stuffWorthTotalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  stuffWorthTotalText: {
    color: '#FFC107',
    fontSize: 13,
    fontWeight: '800',
  },

  // Quick Actions
  quickActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    paddingVertical: 20,
  },
  quickActionBtn: {
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  quickActionIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  starBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#EF4444',
    borderWidth: 2,
    borderColor: '#fff',
  },
  quickActionLabel: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },

  // Share button
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#6366F1',
    paddingVertical: 14,
    borderRadius: 16,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },

  // Sections
  section: {
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 14,
  },

  // How It Works
  howItWorksBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginTop: 12,
  },
  howItWorksText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Footer
  footer: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  footerLogo: {
    width: 40,
    height: 40,
    marginBottom: 8,
    opacity: 0.5,
  },
  footerText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },

  // Promo Card
  promoCard: {
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
    borderRadius: 20,
    padding: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  promoContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    zIndex: 2,
  },
  promoLogo: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  promoTextWrap: {
    flex: 1,
  },
  promoNewBadge: {
    backgroundColor: '#8B5CF6',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 4,
  },
  promoNewBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  promoTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  promoSubtitle: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  promoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#8B5CF6',
    paddingVertical: 11,
    borderRadius: 12,
    marginTop: 14,
    zIndex: 2,
  },
  promoBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});

export default HomeTabScreen;
