/**
 * MysteryEgg.js — Mystery Fruit Screen (Navigation Screen)
 * 📅 2026-03-13: Kid-friendly redesign as full navigation screen
 * 📅 2026-04-01: Rebranded from Mystery Egg to Mystery Fruit (Blox Fruit theme)
 *
 * Full-screen: fruit selection → purchase → spin animation → reward reveal
 * Blox Fruit themed colors, big bouncy UI, lots of emojis ✨
 */

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, Dimensions, Animated, Alert, ActivityIndicator,
  Platform, StatusBar,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import SafeLottieView from '../Helper/SafeLottieView';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGlobalState } from '../GlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useTranslation } from 'react-i18next';
import { getUserXP } from './xpUtils';
import { getStarBalance } from './starUtils';
import { purchaseEgg, formatTimeRemaining, getShopStats, getInventory } from './shopUtils';
import { getMyCosmetics, syncMyCosmetics, getCachedEggData, setCachedEggXP, setCachedEggStats, setCachedEggInventory } from '../Helper/cosmeticsCache';
import { FRUIT_LIST, EGG_LIST, RARITY_CONFIG, COSMETIC_TYPE, ALL_ITEMS } from './shopItems';
import FramedAvatar from '../ChatScreen/GroupChat/FramedAvatar';
import RewardedAdManager from '../Ads/RewardedAdManager';

const { width } = Dimensions.get('window');

// ─── Pastel color palette ───
const PASTELS = {
  pink: '#FFB6C1',
  mint: '#98FB98',
  lavender: '#E6E6FA',
  peach: '#FFDAB9',
  sky: '#87CEEB',
  lemon: '#FFFACD',
  coral: '#FF7F7F',
  lilac: '#C8A2C8',
};

// ── Sparkle decoration component ──
const Sparkles = ({ count = 6, size = 120 }) => {
  const sparkleEmojis = ['✨', '🍎', '💫', '🔥', '⚡', '🍇'];
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const x = Math.cos(angle) * (size / 2.5);
        const y = Math.sin(angle) * (size / 2.5);
        return (
          <Text
            key={i}
            style={{
              position: 'absolute',
              left: '50%', top: '50%',
              marginLeft: x - 6, marginTop: y - 6,
              fontSize: 12, opacity: 0.6,
            }}
          >
            {sparkleEmojis[i % sparkleEmojis.length]}
          </Text>
        );
      })}
    </>
  );
};

// ── Fruit Card ──
const FruitCard = ({ egg: fruit, starBalance, isDark, onPress, index }) => {
  const { t } = useTranslation();
  const canAfford = starBalance >= fruit.cost;
  const bounceAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(bounceAnim, {
      toValue: 1,
      tension: 50,
      friction: 7,
      delay: index * 100,
      useNativeDriver: true,
    }).start();
  }, [bounceAnim, index]);

  const fruitGradients = [
    ['#BBF7D0', '#4ADE80'], // green (common)
    ['#E9D5FF', '#A855F7'], // purple (rare)
    ['#FEF3C7', '#F59E0B'], // gold (legendary)
    ['#FCE7F3', '#EC4899'], // pink (mythical)
  ];
  const colors = fruitGradients[index] || fruitGradients[0];

  return (
    <Animated.View style={{ transform: [{ scale: bounceAnim }] }}>
      <TouchableOpacity
        activeOpacity={canAfford ? 0.8 : 1}
        onPress={() => canAfford ? onPress(fruit) : null}
        style={[
          s.eggCard,
          {
            backgroundColor: canAfford ? colors[0] : (isDark ? '#1e293b' : '#f1f5f9'),
            borderWidth: 3,
            borderColor: canAfford ? colors[1] : (isDark ? '#334155' : '#e2e8f0'),
          },
        ]}
      >
        {/* Glossy shine overlay */}
        {canAfford && <View style={s.glossOverlay} />}

        {/* Left: Fruit emoji */}
        <Text style={[s.eggEmoji, { marginRight: 14, opacity: canAfford ? 1 : 0.4 }]}>{fruit.emoji}</Text>

        {/* Center: Info */}
        <View style={{ flex: 1, zIndex: 1 }}>
          <Text style={[s.eggName, { color: canAfford ? '#1a2744' : (isDark ? '#cbd5e1' : '#475569'), textAlign: 'left' }]}>
            {fruit.name}
          </Text>
          <View style={[s.dropRatesRow, { justifyContent: 'flex-start', marginTop: 4 }]}>
            {Object.entries(fruit.dropTable)
              .filter(([, weight]) => weight > 0)
              .map(([rarity, weight]) => (
                <View key={rarity} style={s.dropRateItem}>
                  <View style={[s.dropDot, { backgroundColor: RARITY_CONFIG[rarity]?.color || '#94a3b8' }]} />
                  <Text style={[s.dropText, { color: canAfford ? '#6b4c4a' : (isDark ? '#94a3b8' : '#64748b') }]}>
                    {RARITY_CONFIG[rarity]?.label || rarity} {weight}%
                  </Text>
                </View>
              ))}
          </View>
        </View>

        {/* Right: Cost badge or Lock badge */}
        {canAfford ? (
          <View style={[s.costBadge, { backgroundColor: 'rgba(0,0,0,0.12)' }]}>
            <Text style={[s.costText, { color: '#1a2744' }]}>⭐ {fruit.cost.toLocaleString()}</Text>
          </View>
        ) : (
          <View style={{ alignItems: 'flex-end', gap: 4, zIndex: 1 }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)',
              paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
              borderWidth: 1, borderColor: isDark ? 'rgba(239,68,68,0.25)' : 'rgba(239,68,68,0.15)',
            }}>
              <Icon name="lock-closed" size={11} color={isDark ? '#f87171' : '#ef4444'} />
              <Text style={{ fontSize: 9, fontWeight: '700', color: isDark ? '#f87171' : '#ef4444' }}>{t('mystery_fruit.alerts.locked_label', { defaultValue: 'Locked' })}</Text>
            </View>
            <Text style={{ fontSize: 9, fontWeight: '600', color: isDark ? '#64748b' : '#94a3b8' }}>
              {t('mystery_fruit.alerts.need_more_stars', { defaultValue: `Need ${(fruit.cost - starBalance).toLocaleString()} more ⭐`, count: (fruit.cost - starBalance).toLocaleString() })}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

// ── Reward Reveal Card ──
const RewardReveal = ({ reward, isDark }) => {
  const { t } = useTranslation();
  const rarityConfig = RARITY_CONFIG[reward.rarity] || RARITY_CONFIG.common;
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 30,
        friction: 4,
        useNativeDriver: true,
      }),
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, [rotateAnim, scaleAnim]);

  const isFrame = reward.type === COSMETIC_TYPE.FRAME;
  const isTextColor = reward.type === COSMETIC_TYPE.TEXT_COLOR;
  const isTradeBg = reward.type === COSMETIC_TYPE.TRADE_BG;
  const isBanner = reward.type === COSMETIC_TYPE.BANNER;
  const isChatBg = reward.type === COSMETIC_TYPE.CHAT_BG;

  const spin = rotateAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['0deg', '-3deg', '0deg'],
  });

  return (
    <Animated.View style={[
      s.revealCard,
      {
        backgroundColor: isDark ? '#1e293b' : '#fff',
        borderWidth: 3,
        borderColor: rarityConfig.color + '60',
        transform: [{ scale: scaleAnim }, { rotate: spin }],
        shadowColor: rarityConfig.color,
        shadowOpacity: 0.4,
        shadowRadius: 20,
        elevation: 10,
      },
    ]}>
      {/* 🎊 Sparkle Lottie behind the card */}
      <SafeLottieView
        source={require('../../assets/lottie/sparkle.json')}
        autoPlay
        loop
        style={s.revealSparkle}
        imageAssetsFolder=""
        renderMode={Platform.OS === 'android' ? 'SOFTWARE' : 'HARDWARE'}
        cacheComposition={false}
      />

      {/* Rarity badge */}
      <View style={[s.rarityBadge, { backgroundColor: rarityConfig.color }]}>
        <Text style={s.rarityText}>{rarityConfig.emoji} {rarityConfig.label}</Text>
      </View>

      {/* Large Preview — with glow behind */}
      <View style={s.previewContainer}>
        {/* ✨ Glow Lottie behind the preview */}
        <SafeLottieView
          source={require('../../assets/lottie/glow.json')}
          autoPlay
          loop
          style={s.revealGlow}
          imageAssetsFolder=""
          renderMode={Platform.OS === 'android' ? 'SOFTWARE' : 'HARDWARE'}
          cacheComposition={false}
        />
        {isFrame && (
          <FramedAvatar
            avatarUri={null}
            frame={{
              id: reward.id,
              borderColors: reward.borderColors,
              borderWidth: reward.borderWidth,
              glowColor: reward.glowColor,
            }}
            isDarkMode={isDark}
            avatarSize={64}
            isOnline={false}
          />
        )}
        {isTextColor && (
          <View style={s.textColorPreview}>
            <Text style={[s.textColorSample, { color: reward.color === 'rainbow' ? '#A855F7' : reward.color, fontSize: 22 }]}>
              {t('mystery_fruit.rewards.text_color_sample')}
            </Text>
            {reward.color === 'rainbow' && (
              <Text style={[s.textColorSample, { fontSize: 10, color: '#64748b' }]}>{t('mystery_fruit.rewards.text_color_rainbow')}</Text>
            )}
          </View>
        )}
        {isTradeBg && (
          <View style={{
            width: 100, height: 70, borderRadius: 16,
            backgroundColor: isDark ? (reward.darkColor || reward.color) : reward.color,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 2, borderColor: 'rgba(0,0,0,0.08)',
          }}>
            <Text style={{ fontSize: 10, color: isDark ? '#e2e8f0' : '#334155', fontWeight: '700' }}>{t('mystery_fruit.rewards.trade_bg_text')}</Text>
            <Text style={{ fontSize: 8, color: isDark ? '#94a3b8' : '#64748b' }}>{t('mystery_fruit.rewards.trade_bg_sub')}</Text>
          </View>
        )}
        {isBanner && (
          <View style={{
            width: 110, height: 40, borderRadius: 12,
            backgroundColor: reward.gradient?.[0] || '#7c3aed',
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', overflow: 'hidden',
          }}>
            <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 35, borderTopRightRadius: 12, borderBottomRightRadius: 12, backgroundColor: reward.gradient?.[2] || '#ec4899', opacity: 0.6 }} />
            <Text style={{ fontSize: 9, color: '#fff', fontWeight: '800' }}>{t('mystery_fruit.rewards.banner_text')}</Text>
          </View>
        )}
        {isChatBg && (
          <View style={{
            width: 100, height: 50, borderRadius: 18,
            backgroundColor: isDark ? (reward.darkColor || reward.color) : reward.color,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
          }}>
            <Text style={{ fontSize: 9, color: isDark ? '#e2e8f0' : '#334155', fontWeight: '700' }}>{t('mystery_fruit.rewards.chat_bg_text')}</Text>
          </View>
        )}
      </View>

      {/* Item name */}
      <Text style={[s.rewardName, { color: rarityConfig.color }]}>{reward.name}</Text>
      <Text style={[s.rewardType, { color: isDark ? '#94a3b8' : '#64748b' }]}>
        {isFrame ? t('mystery_fruit.rewards.reward_type_frame') : isTextColor ? t('mystery_fruit.rewards.reward_type_text_color') : isTradeBg ? t('mystery_fruit.rewards.reward_type_trade_bg') : isBanner ? t('mystery_fruit.rewards.reward_type_banner') : isChatBg ? t('mystery_fruit.rewards.reward_type_chat_bg') : t('mystery_fruit.rewards.reward_type_cosmetic')}
      </Text>

      {/* Duration */}
      <View style={[s.durationBadge, { backgroundColor: isDark ? '#0f172a' : '#f8fafc' }]}>
        <Icon name="time-outline" size={14} color={isDark ? '#94a3b8' : '#64748b'} />
        <Text style={[s.durationText, { color: isDark ? '#94a3b8' : '#64748b' }]}>
          {reward.duration === -1 ? t('mystery_fruit.rewards.permanent') : t(reward.duration > 1 ? 'mystery_fruit.rewards.active_for_days_plural' : 'mystery_fruit.rewards.active_for_days', { count: reward.duration })}
        </Text>
      </View>
    </Animated.View>
  );
};



// ── "What's Inside" reward catalog ──
const RewardCatalog = ({ isDark }) => {
  const { t } = useTranslation();
  const renderTypeSection = (typeFilter, title, subtitle, previewFn) => {
    const items = Object.values(ALL_ITEMS).filter(item => item.type === typeFilter);
    if (items.length === 0) return null;

    return (
      <View key={typeFilter}>
        <View style={s.rewardGroupHeader}>
          <Text style={[s.rewardGroupLabel, { color: isDark ? '#e2e8f0' : '#0f172a' }]}>{title}</Text>
          <Text style={[s.rewardGroupSub, { color: isDark ? '#64748b' : '#94a3b8' }]}>{subtitle}</Text>
        </View>
        {items.map(item => {
          const rc = RARITY_CONFIG[item.rarity];
          const isHidden = item.rarity === 'legendary' || item.rarity === 'exclusive';
          return (
            <View key={item.id} style={[s.rewardRow, { backgroundColor: isDark ? '#0f172a40' : '#f8fafc' }]}>
              {previewFn(item, rc, isHidden, isDark)}
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[s.rewardItemName, { color: isHidden ? rc?.color : (isDark ? '#e2e8f0' : '#334155') }]}>
                  {isHidden ? t('mystery_fruit.catalog.hidden_reward', { rarity: rc?.label }) : item.name}
                </Text>
                {item.duration && !isHidden && (
                  <Text style={{ fontSize: 9, color: isDark ? '#64748b' : '#94a3b8', marginTop: 1 }}>
                    {item.duration === -1 ? t('mystery_fruit.rewards.permanent') : t(item.duration > 1 ? 'mystery_fruit.rewards.active_for_days_plural' : 'mystery_fruit.rewards.active_for_days', { count: item.duration })}
                  </Text>
                )}
              </View>
              <View style={[s.rewardRarityPill, { backgroundColor: rc?.color + '20' }]}>
                <Text style={[s.rewardRarityText, { color: rc?.color }]}>
                  {isHidden ? '🔒 ' : ''}{rc?.label}
                </Text>
              </View>
            </View>
          );
        })}
        <View style={{ height: 1, backgroundColor: isDark ? '#334155' : '#e2e8f0', marginVertical: 12 }} />
      </View>
    );
  };

  return (
    <View style={[s.rewardsSection, { backgroundColor: isDark ? '#1e293b' : '#fff' }]}>
      <Text style={[s.rewardsTitle, { color: isDark ? '#e2e8f0' : '#0f172a' }]}>
        {t('mystery_fruit.catalog.whats_inside')}
      </Text>

      {renderTypeSection(COSMETIC_TYPE.FRAME, t('mystery_fruit.catalog.frames_title'), t('mystery_fruit.catalog.frames_sub'), (item, rc, isHidden, dk) => {
        if (isHidden) return (
          <View style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 2.5, borderColor: rc?.color + '40', alignItems: 'center', justifyContent: 'center', backgroundColor: dk ? '#0f172a20' : '#f8fafc' }}>
            <Text style={{ fontSize: 12 }}>?</Text>
          </View>
        );
        return (
          <FramedAvatar avatarUri={null} frame={{ id: item.id, borderColors: item.borderColors, borderWidth: item.borderWidth, glowColor: item.glowColor }} isDarkMode={dk} avatarSize={24} isOnline={false} />
        );
      })}

      {renderTypeSection(COSMETIC_TYPE.TEXT_COLOR, t('mystery_fruit.catalog.text_colors_title'), t('mystery_fruit.catalog.text_colors_sub'), (item, rc, isHidden) => (
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: isHidden ? (rc?.color + '30') : (item.color === 'rainbow' ? '#A855F7' : item.color), alignItems: 'center', justifyContent: 'center' }}>
          {isHidden && <Text style={{ fontSize: 10 }}>?</Text>}
        </View>
      ))}

      {renderTypeSection(COSMETIC_TYPE.TRADE_BG, t('mystery_fruit.catalog.trade_bgs_title'), t('mystery_fruit.catalog.trade_bgs_sub'), (item, rc, isHidden) => (
        <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: isHidden ? (rc?.color + '30') : item.color, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', alignItems: 'center', justifyContent: 'center' }}>
          {isHidden && <Text style={{ fontSize: 10 }}>?</Text>}
        </View>
      ))}

      {renderTypeSection(COSMETIC_TYPE.BANNER, t('mystery_fruit.catalog.banners_title'), t('mystery_fruit.catalog.banners_sub'), (item, rc, isHidden) => (
        <View style={{ width: 24, height: 16, borderRadius: 5, backgroundColor: isHidden ? (rc?.color + '30') : (item.gradient?.[0] || '#7c3aed'), alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {isHidden ? <Text style={{ fontSize: 8 }}>?</Text> : (
            <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 10, backgroundColor: item.gradient?.[2] || '#ec4899', opacity: 0.7 }} />
          )}
        </View>
      ))}

      {renderTypeSection(COSMETIC_TYPE.CHAT_BG, t('mystery_fruit.catalog.chat_bgs_title'), t('mystery_fruit.catalog.chat_bgs_sub'), (item, rc, isHidden) => (
        <View style={{ width: 24, height: 16, borderRadius: 8, backgroundColor: isHidden ? (rc?.color + '30') : item.color, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' }}>
          {isHidden && <Text style={{ fontSize: 8 }}>?</Text>}
        </View>
      ))}

      {/* Mystery tease */}
      <View style={{ alignItems: 'center', paddingTop: 6 }}>
        <Text style={{ fontSize: 12, color: isDark ? '#64748b' : '#94a3b8', textAlign: 'center', fontStyle: 'italic' }}>
          {t('mystery_fruit.catalog.hidden_tease')}
        </Text>
      </View>
    </View>
  );
};

// ══════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════
const MysteryEggScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme, user, appdatabase } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();

  // Init ALL from MMKV cache — instant render, no blank screen
  const cachedEgg = useMemo(() => getCachedEggData(), []);
  const [starBalance, setStarBalance] = useState(0);
  const [phase, setPhase] = useState('select'); // 'select' | 'spinning' | 'reveal'
  const [selectedFruit, setSelectedFruit] = useState(null);
  const [reward, setReward] = useState(null);
  const [loading, setLoading] = useState(false);
  const [adLoading, setAdLoading] = useState(false);
  const [usedFreeSpin, setUsedFreeSpin] = useState(false);
  const [cosmetics, setCosmetics] = useState(() => getMyCosmetics());
  const [stats, setStats] = useState(cachedEgg.stats);
  const [inventory, setInventory] = useState(cachedEgg.inventory);

  // Animations
  const wobbleAnim = useRef(new Animated.Value(0)).current;
  const crackAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const bgPulse = useRef(new Animated.Value(0)).current;

  // Subtle bg pulse animation
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(bgPulse, { toValue: 1, duration: 3000, useNativeDriver: false }),
        Animated.timing(bgPulse, { toValue: 0, duration: 3000, useNativeDriver: false }),
      ])
    ).start();
  }, [bgPulse]);

  // Load user data
  useEffect(() => {
    if (!user?.id || !appdatabase) return;

    const loadData = async () => {
      const balance = await getStarBalance(appdatabase, user.id);
      setStarBalance(balance);

      // Cosmetics — sync from DB, update state
      const synced = await syncMyCosmetics(appdatabase, user.id);
      setCosmetics(synced);

      const shopStats = await getShopStats(appdatabase, user.id);
      setStats(shopStats);
      setCachedEggStats(shopStats); // save to MMKV

      // Check if ad hatch already used today
      try {
        const { ref: dbRef, get: dbGet } = require('@react-native-firebase/database');
        const adSnap = await dbGet(dbRef(appdatabase, `users/${user.id}/shop/stats/lastEggAdAt`));
        if (adSnap.exists()) {
          const lastAd = adSnap.val();
          const d = new Date(lastAd);
          const now = new Date();
          if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
            setUsedFreeSpin(true);
          }
        }
      } catch {}

      const inv = await getInventory(appdatabase, user.id);
      setInventory(inv);
      setCachedEggInventory(inv); // save to MMKV
    };

    loadData();
  }, [user?.id, appdatabase]);

  // Handle fruit purchase
  const handlePurchase = useCallback(async (fruit) => {
    if (loading) return;

    Alert.alert(
      `${fruit.emoji} ${fruit.name}`,
      t('mystery_fruit.alerts.buy_prompt_msg', { defaultValue: `Open this fruit for ${fruit.cost.toLocaleString()} ⭐?\nYour balance: ${starBalance.toLocaleString()} ⭐`, cost: fruit.cost.toLocaleString(), balance: starBalance.toLocaleString() }),
      [
        { text: t('mystery_fruit.alerts.nope', { defaultValue: 'Nope' }), style: 'cancel' },
        {
          text: t('mystery_fruit.alerts.open_it', { defaultValue: 'Open It!' }),
          onPress: async () => {
            setSelectedFruit(fruit);
            setPhase('spinning');
            setLoading(true);
            triggerHapticFeedback('impactMedium');

            // Start spin animation
            Animated.loop(
              Animated.sequence([
                Animated.timing(wobbleAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
                Animated.timing(wobbleAnim, { toValue: -1, duration: 80, useNativeDriver: true }),
                Animated.timing(wobbleAnim, { toValue: 0.5, duration: 60, useNativeDriver: true }),
                Animated.timing(wobbleAnim, { toValue: -0.5, duration: 60, useNativeDriver: true }),
                Animated.timing(wobbleAnim, { toValue: 0, duration: 100, useNativeDriver: true }),
              ]),
              { iterations: 6 }
            ).start();

            // Wait for animation then purchase
            setTimeout(async () => {
              try {
                const result = await purchaseEgg(appdatabase, user.id, fruit.id);

                if (result.success) {
                  setReward(result.reward);
                  setStarBalance(result.newBalance);

                  // Reveal animation
                  Animated.parallel([
                    Animated.timing(crackAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
                    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
                  ]).start(() => {
                    setPhase('reveal');
                    setLoading(false);
                    triggerHapticFeedback('notificationSuccess');
                  });

                  // Refresh from MMKV (already updated by shopUtils)
                  setCosmetics(getMyCosmetics());
                  const shopStats = await getShopStats(appdatabase, user.id);
                  setStats(shopStats);
                  setCachedEggStats(shopStats);
                  const inv = await getInventory(appdatabase, user.id);
                  setInventory(inv);
                  setCachedEggInventory(inv);
                } else {
                  Alert.alert(t('mystery_fruit.alerts.oops', { defaultValue: 'Oops!' }), result.error || t('mystery_fruit.alerts.failed_open', { defaultValue: 'Failed to open fruit' }));
                  setPhase('select');
                  setLoading(false);
                }
              } catch (err) {
                Alert.alert(t('mystery_fruit.alerts.error_title', { defaultValue: 'Error' }), t('mystery_fruit.alerts.error_msg', { defaultValue: 'Something went wrong' }));
                setPhase('select');
                setLoading(false);
              }
            }, 2000);
          },
        },
      ]
    );
  }, [loading, appdatabase, user?.id, wobbleAnim, crackAnim, fadeAnim, starBalance, t]);

  const resetToSelect = useCallback(() => {
    setPhase('select');
    setReward(null);
    setSelectedFruit(null);
    wobbleAnim.setValue(0);
    crackAnim.setValue(1);
    fadeAnim.setValue(0);
  }, [wobbleAnim, crackAnim, fadeAnim]);

  const wobbleInterpolation = wobbleAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-15deg', '0deg', '15deg'],
  });

  const bgColor = isDark ? '#0f172a' : '#F0FDF4';

  return (
    <View style={[s.container, { backgroundColor: bgColor }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* ═══ HEADER ═══ */}
      <View style={[s.header, { paddingTop: insets.top + 4, backgroundColor: isDark ? '#1e1040' : '#166834' }]}>
        {/* Decorative bubbles */}
        <View style={[s.headerBubble, { top: insets.top - 20, right: -10, width: 90, height: 90, backgroundColor: isDark ? 'rgba(168,85,247,0.1)' : 'rgba(255,255,255,0.08)' }]} />
        <View style={[s.headerBubble, { top: insets.top + 10, right: 60, width: 60, height: 60, backgroundColor: isDark ? 'rgba(236,72,153,0.08)' : 'rgba(255,255,255,0.05)' }]} />
        <View style={[s.headerBubble, { top: insets.top - 15, left: -15, width: 80, height: 80, backgroundColor: isDark ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.06)' }]} />

        <TouchableOpacity onPress={() => navigation.goBack()} style={[s.backBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.2)' }]} activeOpacity={0.7}>
          <Icon name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>

        <View style={s.headerCenter}>
          <Text style={s.headerEmoji}>🍈</Text>
          <View>
            <Text style={[s.headerTitle, { color: '#fff' }]}>{t('mystery_fruit.screen.header_title', { defaultValue: 'Mystery Fruit' })}</Text>
            <Text style={[s.headerSub, { color: isDark ? '#a78bfa' : 'rgba(255,255,255,0.7)' }]}>{t('mystery_fruit.screen.header_sub', { defaultValue: 'Spin to win cosmetics!' })}</Text>
          </View>
        </View>

        <View style={[s.xpBadge, { backgroundColor: isDark ? '#a855f7' : '#F59E0B' }]}>
          <Text style={s.xpBadgeText}>⭐ {starBalance.toLocaleString()}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ── SELECT PHASE ── */}
        {phase === 'select' && (
          <>
            {/* Stats strip */}
            {stats.totalEggsOpened > 0 && (
              <View style={[s.statsStrip, { backgroundColor: isDark ? '#1e293b' : '#fff' }]}>
                <View style={s.stat}>
                  <Text style={s.statEmoji}>🍎</Text>
                  <Text style={[s.statNum, { color: isDark ? '#f1f5f9' : '#0f172a' }]}>{stats.totalEggsOpened}</Text>
                  <Text style={[s.statLabel, { color: isDark ? '#64748b' : '#94a3b8' }]}>{t('mystery_fruit.screen.hatched_label')}</Text>
                </View>
                <View style={[s.statDivider, { backgroundColor: isDark ? '#334155' : '#e2e8f0' }]} />
                <View style={s.stat}>
                  <Text style={s.statEmoji}>⭐</Text>
                  <Text style={[s.statNum, { color: isDark ? '#f1f5f9' : '#0f172a' }]}>{(stats.totalStarsSpent || 0).toLocaleString()}</Text>
                  <Text style={[s.statLabel, { color: isDark ? '#64748b' : '#94a3b8' }]}>{t('mystery_fruit.screen.stars_spent_label')}</Text>
                </View>
              </View>
            )}



            {/* Pick a fruit title */}
            <View style={s.pickSection}>
              <Text style={[s.pickTitle, { color: isDark ? '#e2e8f0' : '#1a2744' }]}>
                {t('mystery_fruit.screen.pick_title', { defaultValue: 'Pick a Fruit' })}
              </Text>
              <Text style={[s.pickSub, { color: isDark ? '#64748b' : '#64748b' }]}>
                {t('mystery_fruit.screen.pick_sub', { defaultValue: 'Each fruit has different drop rates!' })}
              </Text>
            </View>

            {/* Fruit list — vertical, full width for readability */}
            <View style={s.eggList}>
              {FRUIT_LIST.map((fruit, i) => (
                <FruitCard
                  key={fruit.id}
                  egg={fruit}
                  starBalance={starBalance}
                  isDark={isDark}
                  onPress={handlePurchase}
                  index={i}
                />
              ))}
            </View>

            {/* Watch Ad for Free Hatch — once per day for everyone */}
            {!usedFreeSpin && (
              <TouchableOpacity
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  backgroundColor: '#F59E0B', paddingVertical: 16, borderRadius: 18, marginBottom: 16,
                  shadowColor: '#F59E0B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
                }}
                onPress={async () => {
                  if (adLoading) return;
                  setAdLoading(true);
                  const earned = await RewardedAdManager.show();
                  setAdLoading(false);
                  if (earned) {
                    setUsedFreeSpin(true);
                    // Persist to RTDB
                    const { ref: adRef, set: adSet } = require('@react-native-firebase/database');
                    adSet(adRef(appdatabase, `users/${user.id}/shop/stats/lastEggAdAt`), Date.now()).catch(() => {});
                    const cheapestFruit = FRUIT_LIST[0];
                    setSelectedFruit(cheapestFruit);
                    setPhase('spinning');
                    setLoading(true);
                    setReward(null);
                    Animated.loop(
                      Animated.sequence([
                        Animated.timing(wobbleAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
                        Animated.timing(wobbleAnim, { toValue: -1, duration: 80, useNativeDriver: true }),
                        Animated.timing(wobbleAnim, { toValue: 0, duration: 100, useNativeDriver: true }),
                      ]),
                      { iterations: 6 }
                    ).start();
                    setTimeout(async () => {
                      try {
                        // Grant temporary stars so purchaseEgg balance check passes
                        const { ref: dbRef, update: dbUpdate, increment: dbIncrement } = require('@react-native-firebase/database');
                        await dbUpdate(dbRef(appdatabase, `users/${user.id}/dailyStars`), {
                          starBalance: dbIncrement(cheapestFruit.cost),
                        });
                        const result = await purchaseEgg(appdatabase, user.id, cheapestFruit.id);
                        if (result.success) {
                          // Stars net zero: we added cost, purchaseEgg deducted cost
                          setStarBalance(result.newBalance);
                          setReward(result.reward);
                          Animated.parallel([
                            Animated.timing(crackAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
                            Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
                          ]).start(() => { setPhase('reveal'); setLoading(false); });
                          setCosmetics(getMyCosmetics());
                          const shopStats = await getShopStats(appdatabase, user.id);
                          setStats(shopStats); setCachedEggStats(shopStats);
                          const inv = await getInventory(appdatabase, user.id);
                          setInventory(inv); setCachedEggInventory(inv);
                        } else {
                          // Refund the temporary stars if purchase failed
                          await dbUpdate(dbRef(appdatabase, `users/${user.id}/dailyStars`), {
                            starBalance: dbIncrement(-cheapestFruit.cost),
                          });
                          Alert.alert(t('mystery_fruit.alerts.oops'), result.error || t('mystery_fruit.alerts.failed_hatch'));
                          setPhase('select'); setLoading(false);
                        }
                      } catch { setPhase('select'); setLoading(false); }
                    }, 2000);
                  }
                }}
                disabled={adLoading}
                activeOpacity={0.85}
              >
                <Icon name={adLoading ? 'hourglass' : 'videocam'} size={20} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>
                  {adLoading ? t('mystery_fruit.screen.watch_ad_loading', { defaultValue: 'Loading...' }) : t('mystery_fruit.screen.watch_ad_btn', { defaultValue: '🎬 Free Spin (Watch Ad)' })}
                </Text>
              </TouchableOpacity>
            )}

            {/* Reward catalog */}
            <RewardCatalog isDark={isDark} />
          </>
        )}

        {/* ── SPINNING PHASE ── */}
        {phase === 'spinning' && selectedFruit && (
          <View style={s.hatchingContainer}>
            {/* Floating sparkles */}
            <Sparkles count={8} size={200} />

            {/* Lottie Spin Animation */}
            <SafeLottieView
              source={require('../../assets/lottie/hatch_egg.json')}
              autoPlay
              loop
              style={s.hatchingLottie}
            />

            <Animated.View style={{ opacity: fadeAnim }}>
              <Text style={s.hatchingText}>{t('mystery_fruit.screen.spinning_text', { defaultValue: 'Opening...' })}</Text>
            </Animated.View>

            <Text style={[s.hatchingSub, { color: isDark ? '#64748b' : '#64748b' }]}>
              {t('mystery_fruit.screen.spinning_sub', { defaultValue: 'What will you get?' })}
            </Text>

            {loading && <ActivityIndicator style={{ marginTop: 24 }} color="#4ADE80" size="small" />}
          </View>
        )}

        {/* ── REVEAL PHASE ── */}
        {phase === 'reveal' && reward && (
          <View style={s.revealContainer}>
            {/* 🎊 Confetti Lottie Celebration Overlay */}
            <SafeLottieView
              source={require('../../assets/lottie/confetti.json')}
              autoPlay
              loop={false}
              style={s.confettiOverlay}
            />

            {/* Party header */}
            <View style={s.partyHeader}>
              <Text style={s.partyEmoji}>🔥</Text>
              <Text style={[s.revealTitle, { color: isDark ? '#e2e8f0' : '#1a2744' }]}>
                {t('mystery_fruit.screen.reveal_title', { defaultValue: 'You Got It!' })}
              </Text>
              <Text style={s.partyEmoji}>🔥</Text>
            </View>

            <RewardReveal reward={reward} isDark={isDark} />

            <View style={s.revealActions}>
              <TouchableOpacity
                style={s.hatchAnother}
                onPress={resetToSelect}
                activeOpacity={0.85}
              >
                <Text style={s.hatchAnotherText}>{t('mystery_fruit.screen.open_another', { defaultValue: 'Open Another' })}</Text>
              </TouchableOpacity>

              {/* Watch Ad for Free Hatch */}
              {!usedFreeSpin && (
                <TouchableOpacity
                  style={[s.hatchAnother, { backgroundColor: '#F59E0B' }]}
                  onPress={async () => {
                    if (adLoading) return;
                    setAdLoading(true);
                    const earned = await RewardedAdManager.show();
                    setAdLoading(false);
                    if (earned) {
                      setUsedFreeSpin(true);
                      // Persist to RTDB
                      const { ref: adRef, set: adSet } = require('@react-native-firebase/database');
                      adSet(adRef(appdatabase, `users/${user.id}/shop/stats/lastEggAdAt`), Date.now()).catch(() => {});
                      // Free hatch — use cheapest egg
                      const cheapestFruit = FRUIT_LIST[0];
                      setSelectedFruit(cheapestFruit);
                      setPhase('spinning');
                      setLoading(true);
                      setReward(null);

                      Animated.loop(
                        Animated.sequence([
                          Animated.timing(wobbleAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
                          Animated.timing(wobbleAnim, { toValue: -1, duration: 80, useNativeDriver: true }),
                          Animated.timing(wobbleAnim, { toValue: 0, duration: 100, useNativeDriver: true }),
                        ]),
                        { iterations: 6 }
                      ).start();

                      setTimeout(async () => {
                        try {
                          // Grant temporary stars so purchaseEgg balance check passes
                          const { ref: dbRef, update: dbUpdate, increment: dbIncrement } = require('@react-native-firebase/database');
                          await dbUpdate(dbRef(appdatabase, `users/${user.id}/dailyStars`), {
                            starBalance: dbIncrement(cheapestFruit.cost),
                          });
                          const result = await purchaseEgg(appdatabase, user.id, cheapestFruit.id);
                          if (result.success) {
                            // Stars net zero: we added cost, purchaseEgg deducted cost
                            setStarBalance(result.newBalance);
                            setReward(result.reward);
                            Animated.parallel([
                              Animated.timing(crackAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
                              Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
                            ]).start(() => {
                              setPhase('reveal');
                              setLoading(false);
                            });
                            setCosmetics(getMyCosmetics());
                            const shopStats = await getShopStats(appdatabase, user.id);
                            setStats(shopStats);
                            setCachedEggStats(shopStats);
                            const inv = await getInventory(appdatabase, user.id);
                            setInventory(inv);
                            setCachedEggInventory(inv);
                          } else {
                            // Refund the temporary stars if purchase failed
                            await dbUpdate(dbRef(appdatabase, `users/${user.id}/dailyStars`), {
                              starBalance: dbIncrement(-cheapestFruit.cost),
                            });
                            Alert.alert(t('mystery_fruit.alerts.oops'), result.error || t('mystery_fruit.alerts.failed_hatch'));
                            setPhase('select');
                            setLoading(false);
                          }
                        } catch {
                          setPhase('select');
                          setLoading(false);
                        }
                      }, 2000);
                    }
                  }}
                  disabled={adLoading}
                  activeOpacity={0.85}
                >
                  <Text style={s.hatchAnotherText}>
                    {adLoading ? t('mystery_fruit.screen.watch_ad_loading', { defaultValue: 'Loading...' }) : t('mystery_fruit.screen.watch_ad_btn', { defaultValue: '🎬 Free Spin (Watch Ad)' })}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[s.doneBtn, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9' }]}
                onPress={() => navigation.goBack()}
                activeOpacity={0.85}
              >
                <Text style={[s.doneBtnText, { color: isDark ? '#e2e8f0' : '#1a2744' }]}>{t('mystery_fruit.screen.done_btn', { defaultValue: 'Done' })}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
};

// ── Styles ──
const s = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  headerBubble: {
    position: 'absolute',
    borderRadius: 999,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
    gap: 10,
  },
  headerEmoji: { fontSize: 32 },
  headerTitle: { fontSize: 20, fontWeight: '800' },
  headerSub: { fontSize: 11, marginTop: 1 },
  xpBadge: {
    backgroundColor: '#FF6B9D',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  xpBadgeText: { color: '#fff', fontSize: 13, fontWeight: '800' },

  scrollContent: { padding: 16, paddingBottom: 40 },

  // Stats strip
  statsStrip: {
    flexDirection: 'row',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  stat: { flex: 1, alignItems: 'center' },
  statEmoji: { fontSize: 20, marginBottom: 4 },
  statNum: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 10, marginTop: 2 },
  statDivider: { width: 1, height: 40, marginHorizontal: 16 },

  // Pick section
  pickSection: { marginBottom: 14, alignItems: 'center' },
  pickTitle: { fontSize: 22, fontWeight: '800' },
  pickSub: { fontSize: 13, marginTop: 4 },

  // Egg list — vertical layout
  eggList: {
    gap: 12,
    marginBottom: 20,
  },
  eggCard: {
    width: '100%',
    borderRadius: 24,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 5,
  },
  glossOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: '45%',
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  eggEmoji: { fontSize: 44, marginBottom: 6, zIndex: 1 },
  eggName: { fontSize: 15, fontWeight: '800', textAlign: 'center', zIndex: 1 },
  dropRatesRow: { flexDirection: 'row', gap: 6, marginTop: 8, zIndex: 1, flexWrap: 'wrap', justifyContent: 'center' },
  dropRateItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dropDot: { width: 6, height: 6, borderRadius: 3 },
  dropText: { fontSize: 9, fontWeight: '600' },
  costBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginTop: 10, zIndex: 1 },
  costText: { fontSize: 12, fontWeight: '800' },
  lockedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  lockedText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  // Hatching
  hatchingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    minHeight: 400,
    position: 'relative',
  },
  hatchingEgg: { marginBottom: 24 },
  hatchingEmoji: { fontSize: 100 },
  hatchingLottie: { width: 220, height: 220, marginBottom: 16 },
  hatchingText: { fontSize: 22, fontWeight: '800', color: '#16A34A', textAlign: 'center' },
  hatchingSub: { fontSize: 14, marginTop: 8, textAlign: 'center' },

  // Lottie overlays
  confettiOverlay: {
    position: 'absolute',
    top: -40,
    left: 0,
    right: 0,
    height: 400,
    zIndex: 10,
    pointerEvents: 'none',
  },
  revealSparkle: {
    position: 'absolute',
    top: -20,
    left: -20,
    right: -20,
    bottom: -20,
    zIndex: 0,
    opacity: 0.6,
  },
  revealGlow: {
    position: 'absolute',
    width: 180,
    height: 180,
    zIndex: 0,
    opacity: 0.5,
  },

  // Reveal
  revealContainer: { alignItems: 'center', paddingTop: 30, minHeight: 400 },
  partyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24 },
  partyEmoji: { fontSize: 28 },
  revealTitle: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  revealCard: {
    borderRadius: 28,
    padding: 28,
    width: '90%',
    alignItems: 'center',
    position: 'relative',
  },
  rarityBadge: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 5, marginBottom: 16 },
  rarityText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  previewContainer: { marginVertical: 16, alignItems: 'center' },
  textColorPreview: { alignItems: 'center' },
  textColorSample: { fontWeight: '800' },
  rewardName: { fontSize: 20, fontWeight: '800', marginTop: 4, textAlign: 'center' },
  rewardType: { fontSize: 12, marginTop: 4, fontWeight: '600' },
  durationBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 14, marginTop: 16,
  },
  durationText: { fontSize: 13, fontWeight: '600' },

  revealActions: { gap: 10, marginTop: 24, width: '80%' },
  hatchAnother: {
    backgroundColor: '#16A34A',
    paddingVertical: 16,
    borderRadius: 20,
    alignItems: 'center',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  hatchAnotherText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  doneBtn: {
    paddingVertical: 14,
    borderRadius: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  doneBtnText: { fontSize: 15, fontWeight: '700' },

  // Rewards catalog
  rewardsSection: {
    borderRadius: 24,
    padding: 18,
    marginTop: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  rewardsTitle: { fontSize: 18, fontWeight: '800', marginBottom: 14 },
  rewardGroupHeader: { marginBottom: 8 },
  rewardGroupLabel: { fontSize: 14, fontWeight: '700' },
  rewardGroupSub: { fontSize: 10, marginTop: 1 },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    marginBottom: 4,
  },
  rewardItemName: { fontSize: 12, fontWeight: '700' },
  rewardRarityPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  rewardRarityText: { fontSize: 9, fontWeight: '700' },
});

// ── Inventory Styles ──

export default MysteryEggScreen;
