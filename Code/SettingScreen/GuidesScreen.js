import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { useTranslation } from 'react-i18next';

const GUIDES = [
  {
    id: 'values',
    icon: '💎',
    titleKey: 'guides.values_title',
    titleDefault: 'Fruit Values',
    items: [
      { key: 'guides.values_1', default: 'All fruit values are community-driven and update regularly based on real trading data.' },
      { key: 'guides.values_2', default: 'Values are shown in Normal and Permanent variants.' },
      { key: 'guides.values_3', default: 'Demand scores (🔥) show how popular a fruit currently is in the trading community.' },
      { key: 'guides.values_4', default: 'Use the search and filters to quickly find any fruit by name or category.' },
      { key: 'guides.values_5', default: 'Trending fruits on the home screen show what\'s rising or falling in value.' },
    ],
  },
  {
    id: 'calculator',
    icon: '🧮',
    titleKey: 'guides.calculator_title',
    titleDefault: 'Trade Calculator',
    items: [
      { key: 'guides.calculator_1', default: 'Add fruits to the "You Give" and "You Get" sides to check if a trade is fair.' },
      { key: 'guides.calculator_2', default: 'The calculator shows win/lose/fair result based on current values.' },
      { key: 'guides.calculator_3', default: 'Toggle between Normal and Permanent fruit values.' },
      { key: 'guides.calculator_4', default: 'Share your trade with the community to get opinions from other traders.' },
      { key: 'guides.calculator_5', default: 'Save frequently used trades for quick access later.' },
    ],
  },
  {
    id: 'leaderboard',
    icon: '🏆',
    titleKey: 'guides.leaderboard_title',
    titleDefault: 'Top Traders',
    items: [
      { key: 'guides.leaderboard_1', default: 'Browse the top traders ranked by rating, completed trades, and XP level.' },
      { key: 'guides.leaderboard_2', default: 'See trader stats: rating count, average rating, trading volume, and join date.' },
      { key: 'guides.leaderboard_3', default: 'Tap on any trader to view their public profile and trade history.' },
      { key: 'guides.leaderboard_4', default: 'Send a private message to a top trader to negotiate deals.' },
      { key: 'guides.leaderboard_5', default: 'Follow top traders to get recommendations and learn trading strategies.' },
    ],
  },
  {
    id: 'trading',
    icon: '🔄',
    titleKey: 'guides.trading_title',
    titleDefault: 'Trading',
    items: [
      { key: 'guides.trading_1', default: 'Go to the Trades tab to browse active trade listings from the community.' },
      { key: 'guides.trading_2', default: 'Create your own trade by tapping "+ New Trade" and selecting fruits you want to give & get.' },
      { key: 'guides.trading_3', default: 'Chat privately with traders to negotiate — you\'ll see typing indicators and read receipts.' },
      { key: 'guides.trading_4', default: 'Use the Trade Calculator to check if a trade is fair before accepting!' },
      { key: 'guides.trading_5', default: 'Use the filter icons at the top of the Trades tab — 👤 My Trades, 👥 Following, 🔖 Saved — to instantly find your own, followed, or saved trades.' },
    ],
  },
  {
    id: 'mystuff',
    icon: '🎒',
    titleKey: 'guides.mystuff_title',
    titleDefault: 'My Stuff',
    items: [
      { key: 'guides.mystuff_1', default: '🍇 My Fruits — Add your owned fruits to see your total portfolio value and demand breakdown.' },
      { key: 'guides.mystuff_2', default: '⭐ Goals — Add dream fruits to your wishlist and track progress towards getting them.' },
    ],
  },
  {
    id: 'chat',
    icon: '💬',
    titleKey: 'guides.chat_title',
    titleDefault: 'Chat & Community',
    items: [
      { key: 'guides.chat_1', default: '💬 Private Chat — Tap any user to open a private chat and negotiate trades directly.' },
      { key: 'guides.chat_2', default: '👥 Group Chats — Join or create group chats to discuss trading strategies with the community.' },
      { key: 'guides.chat_3', default: 'See "typing..." in the header when the other person is typing. Grey ✓ = delivered. Blue ✓✓ = seen.' },
      { key: 'guides.chat_4', default: 'Send images, share fruits, and use quick message templates for fast replies.' },
      { key: 'guides.chat_5', default: 'Long-press any message to copy, translate, or report suspicious behavior.' },
    ],
  },
  {
    id: 'rating',
    icon: '⭐',
    titleKey: 'guides.rating_title',
    titleDefault: 'Rating & Reviews',
    items: [
      { key: 'guides.rating_1', default: 'Open a private chat with any user and exchange at least 3 messages each.' },
      { key: 'guides.rating_2', default: 'Once 3 messages are exchanged, the ⭐ Rate button appears at the top of the chat.' },
      { key: 'guides.rating_3', default: 'Tap the stars to set 1–5 rating, optionally add a written review, then submit.' },
      { key: 'guides.rating_4', default: 'You can edit your rating anytime by tapping the ⭐ Edit Rating button.' },
      { key: 'guides.rating_5', default: 'Honest ratings help the community find trustworthy traders and stay safe!' },
    ],
  },
  {
    id: 'games',
    icon: '🎮',
    titleKey: 'guides.games_title',
    titleDefault: 'Mini Games',
    items: [
      { key: 'guides.games_1', default: '🍋 Mystery Fruit — Open mystery fruits to win cosmetic items for your profile!' },
      { key: 'guides.games_2', default: '🚀 Fruit Crash — Place your bet and cash out before it crashes. Test your nerves!' },
      { key: 'guides.games_3', default: '🍎 Smash — Tap quickly to break fruits and score points!' },
      { key: 'guides.games_4', default: '🔐 Chest — Pick the right chest to find treasure!' },
      { key: 'guides.games_5', default: '⚡ Slash — Swipe to slash fruits before time runs out!' },
      { key: 'guides.games_6', default: '🃏 Memory — Match fruit pairs in this classic memory game!' },
      { key: 'guides.games_7', default: '🏅 Game Ranks — Check your ranking on the Game Leaderboard to see how you compare!' },
      { key: 'guides.games_8', default: 'Mini games earn you XP, cosmetics, and help you level up faster.' },
    ],
  },
  {
    id: 'cosmetics',
    icon: '🎨',
    titleKey: 'guides.cosmetics_title',
    titleDefault: 'Cosmetics & Customization',
    items: [
      { key: 'guides.cosmetics_1', default: 'Go to "My Cosmetics" to view your avatar items: frames, backgrounds, badges.' },
      { key: 'guides.cosmetics_2', default: 'Equip cosmetics to customize your profile and show off your style!' },
      { key: 'guides.cosmetics_3', default: 'Win cosmetics by playing mystery games, daily spins, and seasonal events.' },
      { key: 'guides.cosmetics_4', default: 'Your equipped cosmetics are displayed on your profile and in chats.' },
      { key: 'guides.cosmetics_5', default: 'Some cosmetics are limited edition — collect them before they\'re gone!' },
    ],
  },
  {
    id: 'design',
    icon: '🖼️',
    titleKey: 'guides.design_title',
    titleDefault: 'Design & Social Feed',
    items: [
      { key: 'guides.design_1', default: 'Post updates about your trades, wins, and trading stories in the Design tab.' },
      { key: 'guides.design_2', default: 'Like and comment on other traders\' posts to build community connections.' },
      { key: 'guides.design_3', default: 'Share trading tips, market analysis, and fruit predictions with the community!' },
      { key: 'guides.design_4', default: 'Your posts earn you XP and help build your trader reputation.' },
      { key: 'guides.design_5', default: 'Report inappropriate posts by long-pressing and selecting the report option.' },
    ],
  },
  {
    id: 'badges',
    icon: '🏅',
    titleKey: 'guides.badges_title',
    titleDefault: 'Badges & XP',
    items: [
      { key: 'guides.badges_1', default: 'Earn XP by logging in daily, rating traders, completing trades, playing games, and posting.' },
      { key: 'guides.badges_2', default: 'Badges are awarded when you hit milestones — e.g., 5 ratings, 10 trades, etc.' },
      { key: 'guides.badges_3', default: 'Your badges are shown on your profile for everyone to see.' },
      { key: 'guides.badges_4', default: 'Higher-tier badges (Uncommon, Rare) require more activity — keep going!' },
      { key: 'guides.badges_5', default: 'Daily login streaks give bonus XP — don\'t break your streak!' },
    ],
  },
  {
    id: 'profile',
    icon: '👤',
    titleKey: 'guides.profile_title',
    titleDefault: 'Your Profile',
    items: [
      { key: 'guides.profile_1', default: 'Tap your avatar in Settings to edit your display name, bio, and profile picture.' },
      { key: 'guides.profile_2', default: 'Add your owned fruits and wishlist so other traders know what you have & want.' },
      { key: 'guides.profile_3', default: 'Other users can see your profile by tapping your name in any chat.' },
      { key: 'guides.profile_4', default: 'Your rating, badges, XP level, and trade history are all visible on your profile.' },
      { key: 'guides.profile_5', default: 'Equip cosmetics to customize your profile frame, background, and badges!' },
      { key: 'guides.profile_6', default: 'Follow traders you trust to easily find them later in the Friends section.' },
    ],
  },
  {
    id: 'safety',
    icon: '🛡️',
    titleKey: 'guides.safety_title',
    titleDefault: 'Scam Safety',
    items: [
      { key: 'guides.safety_1', default: 'Never share your Roblox password or login info with anyone.' },
      { key: 'guides.safety_2', default: 'If a deal sounds too good to be true, it probably is — be cautious.' },
      { key: 'guides.safety_3', default: 'Use the official Roblox trading system inside the game to complete trades.' },
      { key: 'guides.safety_4', default: 'Check a trader\'s rating and reviews on their profile before trading with them.' },
    ],
  },
  {
    id: 'reporting',
    icon: '🚨',
    titleKey: 'guides.reporting_title',
    titleDefault: 'Reporting in Private Chat',
    items: [
      { key: 'guides.reporting_1', default: 'If someone is scamming or being inappropriate in private chat, tap the "Report Chat" button at the top of the conversation.' },
      { key: 'guides.reporting_2', default: 'The Report Chat button appears after both users have exchanged a few messages (same time as Rate Trader).' },
      { key: 'guides.reporting_3', default: 'Select a reason for reporting (Scam, Inappropriate, Harassment, Spam, or Other) and submit.' },
      { key: 'guides.reporting_4', default: 'By reporting, you give moderators permission to view the conversation so they can investigate fairly.' },
      { key: 'guides.reporting_5', default: 'Moderators can ONLY see chats that have been reported with consent — they cannot browse anyone\'s messages freely.' },
      { key: 'guides.reporting_6', default: 'Your report helps keep the community safe. Moderators will review it and take action if needed.' },
    ],
  },
];

export default function GuidesScreen({ navigation }) {
  const { theme } = useGlobalState();
  const isDark = theme === 'dark';
  const { t } = useTranslation();
  const styles = useMemo(() => getStyles(isDark), [isDark]);
  const [expanded, setExpanded] = useState({});

  const toggleSection = useCallback((id) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}>
          <Icon name="arrow-back" size={22} color={isDark ? '#E2E8F0' : '#1E293B'} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('guides.title', { defaultValue: 'How It Works' })}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Subtitle */}
      <Text style={styles.subtitle}>
        {t('guides.subtitle', { defaultValue: 'Everything you need to know about using the app.' })}
      </Text>

      {/* Guide sections */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {GUIDES.map((guide) => {
          const isOpen = expanded[guide.id] || false;
          return (
            <View key={guide.id} style={styles.card}>
              <TouchableOpacity
                style={styles.cardHeader}
                onPress={() => toggleSection(guide.id)}
                activeOpacity={0.7}
              >
                <Text style={styles.cardIcon}>{guide.icon}</Text>
                <Text style={styles.cardTitle}>
                  {t(guide.titleKey, { defaultValue: guide.titleDefault })}
                </Text>
                <Icon
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={isDark ? '#94A3B8' : '#64748B'}
                />
              </TouchableOpacity>

              {isOpen && (
                <View style={styles.cardBody}>
                  {guide.items.map((item, idx) => (
                    <View key={idx} style={styles.stepRow}>
                      <View style={styles.stepNumber}>
                        <Text style={styles.stepNumberText}>{idx + 1}</Text>
                      </View>
                      <Text style={styles.stepText}>
                        {t(item.key, { defaultValue: item.default })}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (isDark) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDark ? '#0F172A' : '#F8FAFC',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: isDark ? '#1E293B' : '#E2E8F0',
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: isDark ? '#1E293B' : '#F1F5F9',
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: isDark ? '#F1F5F9' : '#0F172A',
    },
    subtitle: {
      fontSize: 13,
      color: isDark ? '#94A3B8' : '#64748B',
      textAlign: 'center',
      paddingHorizontal: 24,
      paddingVertical: 10,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 4,
    },

    /* Card */
    card: {
      marginBottom: 10,
      borderRadius: 14,
      backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
      borderWidth: 1,
      borderColor: isDark ? '#334155' : '#E2E8F0',
      overflow: 'hidden',
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    cardIcon: {
      fontSize: 20,
      marginRight: 10,
    },
    cardTitle: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: isDark ? '#E2E8F0' : '#1E293B',
    },
    cardBody: {
      paddingHorizontal: 14,
      paddingBottom: 14,
      borderTopWidth: 1,
      borderTopColor: isDark ? '#334155' : '#F1F5F9',
      paddingTop: 10,
    },

    /* Steps */
    stepRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 8,
    },
    stepNumber: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: isDark ? '#334155' : '#E2E8F0',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
      marginTop: 1,
    },
    stepNumberText: {
      fontSize: 11,
      fontWeight: '700',
      color: isDark ? '#94A3B8' : '#64748B',
    },
    stepText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 19,
      color: isDark ? '#CBD5E1' : '#475569',
    },
  });
