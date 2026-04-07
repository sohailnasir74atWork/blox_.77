/**
 * BadgesScreen.js — Visual Badges & Achievements screen
 * Shows: XP progress, all badges, level roadmap, streak status
 */

import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Dimensions, Platform, Image, StatusBar,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import ViewShot from 'react-native-view-shot';
import Share from 'react-native-share';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import {
  BADGE_DEFINITIONS, BADGE_DISPLAY_ORDER, BADGE_IMAGES, computeBadges,
} from '../ChatScreen/GroupChat/badgeUtils';
import {
  LEVELS, XP_ACTIONS, getLevelFromXP, getNextLevel, getXPProgress, getUserXP,
} from '../Engagement/xpUtils';
import { getStarStatus } from '../Engagement/starUtils';
import DailyStarRewards from '../Engagement/DailyStarRewards';
import SafeLottieView from '../Helper/SafeLottieView';

// Lottie files for XP levels
const LEVEL_LOTTIE = {
  1: require('../../assets/lottie/levels/crack_egg.json'),
  2: require('../../assets/lottie/levels/springing_chick.json'),
  3: require('../../assets/lottie/levels/junior.json'),
  5: require('../../assets/lottie/levels/exploral.json'),
  7: require('../../assets/lottie/levels/adventurer.json'),
  10: require('../../assets/lottie/levels/collector.json'),
  12: require('../../assets/lottie/levels/fire.json'),
  15: require('../../assets/lottie/levels/trader_pro.json'),
  18: require('../../assets/lottie/levels/expert.json'),
  20: require('../../assets/lottie/levels/rising_star.json'),
  23: require('../../assets/lottie/levels/master.json'),
  25: require('../../assets/lottie/levels/legend.json'),
  28: require('../../assets/lottie/levels/elite.json'),
  30: require('../../assets/lottie/levels/mythic.json'),
};

const { width } = Dimensions.get('window');
const BADGE_CARD_WIDTH = (width - 64) / 3;

// ── XP Progress Header ──
const XPHeader = ({ xp, isDark }) => {
  const { t } = useTranslation();
  const currentLevel = getLevelFromXP(xp);
  const nextLevel = getNextLevel(xp);
  const progress = getXPProgress(xp);
  const isMax = currentLevel.level === nextLevel.level;

  return (
    <View style={[s.xpCard, { backgroundColor: isDark ? '#1e293b' : '#fff' }]}>
      <View style={s.xpTopRow}>
        {LEVEL_LOTTIE[currentLevel.level] ? (
          <View style={{ width: 34, height: 34, overflow: 'visible' }}>
            <SafeLottieView source={LEVEL_LOTTIE[currentLevel.level]} autoPlay loop resizeMode="contain" style={{ width: '100%', height: '100%' }} />
          </View>
        ) : (
          <Text style={{ fontSize: 28 }}>{currentLevel.emoji}</Text>
        )}
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[s.xpTitle, { color: isDark ? '#f1f5f9' : '#0f172a' }]}>
            {currentLevel.title}
          </Text>
          <Text style={[s.xpSubtitle, { color: isDark ? '#64748b' : '#94a3b8' }]}>
            {t('badges_screen.xp.level_and_xp', { defaultValue: `Level ${currentLevel.level} • ${xp.toLocaleString()} XP`, level: currentLevel.level, xp: xp.toLocaleString() })}
          </Text>
        </View>
        {!isMax && (
          <View style={s.xpNextBadge}>
            <Text style={{ fontSize: 9, color: isDark ? '#475569' : '#94a3b8', fontWeight: '600' }}>{t('badges_screen.xp.next', { defaultValue: 'NEXT' })}</Text>
            {LEVEL_LOTTIE[nextLevel.level] ? (
              <View style={{ width: 20, height: 20, overflow: 'visible' }}>
                <SafeLottieView source={LEVEL_LOTTIE[nextLevel.level]} autoPlay loop resizeMode="contain" style={{ width: '100%', height: '100%' }} />
              </View>
            ) : (
              <Text style={{ fontSize: 14 }}>{nextLevel.emoji}</Text>
            )}
          </View>
        )}
      </View>
      <View style={[s.progressBg, { backgroundColor: isDark ? '#0f172a' : '#e2e8f0' }]}>
        <View style={[s.progressFill, { width: `${Math.max(3, Math.round(progress * 100))}%` }]} />
      </View>
      <Text style={[s.progressLabel, { color: isDark ? '#475569' : '#94a3b8' }]}>
        {isMax
          ? t('badges_screen.xp.max_level', { defaultValue: '🎉 Max Level!' })
          : t('badges_screen.xp.to_next_level', { defaultValue: `${(nextLevel.xp - xp).toLocaleString()} XP to next level`, xp: (nextLevel.xp - xp).toLocaleString() })}
      </Text>
    </View>
  );
};

// ── Single Badge Card ──
const BadgeCard = ({ badgeId, earned, isDark }) => {
  const { t } = useTranslation();
  const badge = BADGE_DEFINITIONS[badgeId];
  if (!badge) return null;

  const earnedBgLight = badge.bgLight?.replace('0.1)', '0.18)') || badge.bgLight;
  const earnedBgDark = badge.bgDark?.replace('0.15)', '0.25)') || badge.bgDark;

  return (
    <View style={[
      s.badgeCard,
      {
        backgroundColor: earned
          ? (isDark ? earnedBgDark : earnedBgLight)
          : (isDark ? '#0f172a' : '#f8fafc'),
        borderColor: earned ? badge.color + '60' : (isDark ? '#1e293b' : '#e9ecef'),
        opacity: earned ? 1 : 0.5,
      },
    ]}>
      <View style={[{
        marginBottom: 4, width: 48, height: 48, borderRadius: 24,
        alignItems: 'center', justifyContent: 'center',
      }, earned && { backgroundColor: badge.color + '20' }]}>
        {earned && BADGE_IMAGES[badgeId] ? (
          <Image source={BADGE_IMAGES[badgeId]} style={[{ width: 36, height: 36 }, isDark && badge.tier === 1 && { tintColor: '#e2e8f0' }]} />
        ) : (
          <Text style={{ fontSize: 28, opacity: 0.3 }}>🔒</Text>
        )}
      </View>
      <Text style={[s.badgeName, { color: earned ? badge.color : (isDark ? '#475569' : '#94a3b8') }]} numberOfLines={1}>
        {badge.name}
      </Text>
      {earned ? (
        <View style={[s.earnedTag, { backgroundColor: badge.color + '25' }]}>
          <Text style={[s.earnedTagText, { color: badge.color }]}>{t('badges_screen.badge.earned', { defaultValue: '✓ Earned' })}</Text>
        </View>
      ) : (
        <Text style={[s.badgeHint, { color: isDark ? '#334155' : '#b0b8c4' }]} numberOfLines={2}>
          {badge.hint}
        </Text>
      )}
    </View>
  );
};

// ── Level Roadmap Item ──
const LevelItem = ({ level, currentLevel, isDark }) => {
  const reached = currentLevel >= level.level;
  const isCurrent = currentLevel === level.level;

  return (
    <View style={[
      s.levelRow,
      isCurrent && { backgroundColor: isDark ? '#1e3a5f' : '#eff6ff', borderRadius: 10 },
    ]}>
      <View style={[
        s.levelDot,
        {
          backgroundColor: reached ? '#6366f1' : (isDark ? '#1e293b' : '#e2e8f0'),
          borderColor: isCurrent ? '#818cf8' : 'transparent',
          borderWidth: isCurrent ? 2 : 0,
        },
      ]}>
        {reached && <Icon name="checkmark" size={10} color="#fff" />}
      </View>
      {LEVEL_LOTTIE[level.level] ? (
        <View style={{ width: 22, height: 22, marginHorizontal: 6, overflow: 'visible' }}>
          <SafeLottieView source={LEVEL_LOTTIE[level.level]} autoPlay loop resizeMode="contain" style={{ width: '100%', height: '100%' }} />
        </View>
      ) : (
        <Text style={{ fontSize: 16, marginHorizontal: 6 }}>{level.emoji}</Text>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[s.levelName, {
          color: reached ? (isDark ? '#e2e8f0' : '#1e293b') : (isDark ? '#475569' : '#94a3b8'),
          fontWeight: isCurrent ? '800' : '600',
        }]}>
          Lv.{level.level} — {level.title}
        </Text>
        <Text style={[s.levelXp, { color: isDark ? '#475569' : '#94a3b8' }]}>
          {level.xp.toLocaleString()} XP
        </Text>
      </View>
      {isCurrent && (
        <View style={s.currentTag}>
          <Text style={s.currentTagText}>YOU</Text>
        </View>
      )}
    </View>
  );
};

// ── XP Actions Guide ──
const XPActionsSection = ({ isDark }) => {
  const { t } = useTranslation();
  const actionLabels = {
    DAILY_LOGIN: t('badges_screen.actions.daily_login', { defaultValue: '📅 Daily Login' }),
    COMPLETE_TRADE: t('badges_screen.actions.complete_trade', { defaultValue: '🤝 Complete Trade' }),
    CREATE_POST: t('badges_screen.actions.create_post', { defaultValue: '📸 Create Post' }),
    LEAVE_REVIEW: t('badges_screen.actions.leave_review', { defaultValue: '📝 Leave Review' }),
    UPDATE_PETS: t('badges_screen.actions.update_fruits', { defaultValue: '🍋 Update Fruits' }),
    STREAK_7_DAY: t('badges_screen.actions.streak_7_day', { defaultValue: '🔥 7-Day Streak' }),
    POST_STATUS: t('badges_screen.actions.post_status', { defaultValue: '📣 Post Status' }),
  };

  return (
    <View style={[s.section, { backgroundColor: isDark ? '#1e293b' : '#fff' }]}>
      <Text style={[s.sectionTitle, { color: isDark ? '#e2e8f0' : '#0f172a' }]}>
        {t('badges_screen.actions.title', { defaultValue: '⚡ How to Earn XP' })}
      </Text>
      {Object.entries(XP_ACTIONS).map(([key, xp]) => (
        <View key={key} style={s.xpActionRow}>
          <Text style={[s.xpActionName, { color: isDark ? '#94a3b8' : '#64748b' }]}>
            {actionLabels[key] || key}
          </Text>
          <View style={[s.xpActionBadge, { backgroundColor: isDark ? '#0f172a' : '#f1f5f9' }]}>
            <Text style={s.xpActionValue}>+{xp}</Text>
          </View>
        </View>
      ))}
    </View>
  );
};

// ── Streak Status ──
const StreakSection = ({ streak, isDark, onClaimPress }) => {
  const { t } = useTranslation();
  const days = [1, 2, 3, 4, 5, 6, 7];
  const currentDay = streak?.currentDay || 0;
  const canClaim = streak?.canClaim || false;

  return (
    <View style={[s.section, { backgroundColor: isDark ? '#1e293b' : '#fff' }]}>
      <Text style={[s.sectionTitle, { color: isDark ? '#e2e8f0' : '#0f172a' }]}>
        {t('badges_screen.streak.title', { defaultValue: '🔥 Daily Streak' })}
      </Text>
      <View style={s.streakRow}>
        {days.map(day => {
          const completed = day < currentDay || (day === currentDay && !canClaim);
          const isNext = day === currentDay && canClaim;
          return (
            <View key={day} style={[
              s.streakDay,
              completed && s.streakDayDone,
              isNext && s.streakDayNext,
            ]}>
              <Text style={[
                s.streakDayText,
                completed && { color: '#fff' },
                isNext && { color: '#6366f1' },
              ]}>
                {completed ? '✓' : day}
              </Text>
            </View>
          );
        })}
      </View>
      <TouchableOpacity
        onPress={onClaimPress}
        activeOpacity={0.7}
        style={[s.claimButton, {
          backgroundColor: canClaim ? '#F59E0B' : (isDark ? '#6366f1' : '#3B82F6'),
        }]}
      >
        <Text style={s.claimButtonText}>
          {canClaim
            ? t('badges_screen.streak.claim', { defaultValue: '⭐ Claim Stars!' })
            : t('badges_screen.streak.view', { defaultValue: '⭐ View Stars' })}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

// ── Main Component ──
const BadgesScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme, user, appdatabase } = useGlobalState();
  const isDark = theme === 'dark';

  const [xp, setXp] = useState(0);
  const [badges, setBadges] = useState({});
  const [streak, setStreak] = useState(null);
  const [showStarClaim, setShowStarClaim] = useState(false);
  const shareRef = useRef();

  useEffect(() => {
    if (!user?.id || !appdatabase) return;

    getUserXP(appdatabase, user.id).then(data => setXp(data.total || 0));
    getStarStatus(appdatabase, user.id).then(setStreak);

    const { ref, get } = require('@react-native-firebase/database');
    get(ref(appdatabase, `users/${user.id}`)).then(snap => {
      const data = snap.exists() ? snap.val() : {};
      const computed = computeBadges(data, data.badges || {});
      setBadges(computed);
    }).catch(() => { });
  }, [user?.id, appdatabase]);

  const earnedCount = useMemo(() =>
    BADGE_DISPLAY_ORDER.filter(id => badges[id]).length,
    [badges]
  );

  const currentLevel = getLevelFromXP(xp);

  const tiers = [
    { tier: 3, label: t('badges_screen.tiers.elite_label', { defaultValue: '✨ Elite' }), desc: t('badges_screen.tiers.elite_desc', { defaultValue: 'The hardest to earn' }) },
    { tier: 2, label: t('badges_screen.tiers.pro_label', { defaultValue: '🔥 Pro' }), desc: t('badges_screen.tiers.pro_desc', { defaultValue: 'Show your dedication' }) },
    { tier: 1, label: t('badges_screen.tiers.starter_label', { defaultValue: '🌱 Starter' }), desc: t('badges_screen.tiers.starter_desc', { defaultValue: 'Start your journey' }) },
  ];

  return (
    <View style={[s.container, { backgroundColor: isDark ? '#0f172a' : '#f1f5f9' }]}>
      {/* Header */}
      <View style={[s.header, { backgroundColor: isDark ? '#1e293b' : '#fff' }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="arrow-back" size={22} color={isDark ? '#e2e8f0' : '#1e293b'} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: isDark ? '#f1f5f9' : '#0f172a' }]}>
          {t('badges_screen.main.header_title', { defaultValue: 'Badges & Achievements' })}
        </Text>
        <View style={s.headerCount}>
          <Text style={s.headerCountText}>{earnedCount}/{BADGE_DISPLAY_ORDER.length}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* XP Progress */}
        <XPHeader xp={xp} isDark={isDark} />

        {/* Daily Streak */}
        <StreakSection streak={streak} isDark={isDark} onClaimPress={() => setShowStarClaim(true)} />

        {/* All Badges by Tier */}
        {tiers.map(({ tier, label, desc }) => {
          const tierBadges = BADGE_DISPLAY_ORDER.filter(
            id => BADGE_DEFINITIONS[id]?.tier === tier
          );
          if (tierBadges.length === 0) return null;

          const tierEarned = tierBadges.filter(id => badges[id]).length;

          return (
            <View key={tier} style={{ marginTop: 20 }}>
              <View style={s.tierHeader}>
                <View>
                  <Text style={[s.tierTitle, { color: isDark ? '#e2e8f0' : '#1e293b' }]}>
                    {label}
                  </Text>
                  <Text style={[s.tierDesc, { color: isDark ? '#475569' : '#94a3b8' }]}>
                    {desc}
                  </Text>
                </View>
                <View style={[s.tierCount, { backgroundColor: isDark ? '#334155' : '#e2e8f0' }]}>
                  <Text style={[s.tierCountText, { color: isDark ? '#94a3b8' : '#64748b' }]}>
                    {tierEarned}/{tierBadges.length}
                  </Text>
                </View>
              </View>
              <View style={s.badgeGrid}>
                {tierBadges.map(id => (
                  <BadgeCard
                    key={id}
                    badgeId={id}
                    earned={!!badges[id]}
                    isDark={isDark}
                  />
                ))}
              </View>
            </View>
          );
        })}

        {/* Level Roadmap */}
        <View style={[s.section, { backgroundColor: isDark ? '#1e293b' : '#fff', marginTop: 20 }]}>
          <Text style={[s.sectionTitle, { color: isDark ? '#e2e8f0' : '#0f172a' }]}>
            {t('badges_screen.roadmap.title', { defaultValue: '📈 Level Roadmap' })}
          </Text>
          {LEVELS.map(level => (
            <LevelItem
              key={level.level}
              level={level}
              currentLevel={currentLevel.level}
              isDark={isDark}
            />
          ))}
        </View>

        {/* XP Actions */}
        <XPActionsSection isDark={isDark} />

        {/* Share Button */}
        <TouchableOpacity
          style={s.shareBtn}
          activeOpacity={0.8}
          onPress={async () => {
            try {
              if (!shareRef.current) return;
              await new Promise(r => setTimeout(r, 100));
              const uri = await shareRef.current.capture();
              await Share.open({
                url: uri,
                type: 'image/png',
                failOnCancel: false,
              });
            } catch (e) {
              if (e?.message !== 'User did not share') {
                console.warn('[BadgesScreen] Share error:', e);
              }
            }
          }}
        >
          <Icon name="share-social" size={16} color="#fff" />
          <Text style={s.shareBtnText}>{t('badges_screen.share.btn_text', { defaultValue: 'Share My Badges' })}</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Hidden shareable card — captured by ViewShot */}
      <View style={{ position: 'absolute', left: -9999 }}>
        <ViewShot ref={shareRef} options={{ format: 'png', quality: 0.9 }}>
          <View style={s.shareCard}>
            <View style={{ position: 'absolute', top: -15, right: -10, width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(236,72,153,0.15)' }} />
            <View style={{ position: 'absolute', top: 20, left: -15, width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(168,85,247,0.12)' }} />
            <View style={{ position: 'absolute', bottom: 30, right: 20, width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(59,130,246,0.1)' }} />
            <View style={{ position: 'absolute', bottom: -10, left: 40, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(251,191,36,0.12)' }} />

            <View style={s.shareCardHeader}>
              <Text style={{ fontSize: 36 }}>🍋</Text>
              <Text style={s.shareCardTitle}>My Blox Fruit Badges!</Text>
              <Text style={s.shareCardLevel}>
                {currentLevel.emoji} {user?.displayName || 'Fruit Trader'} • Lv.{currentLevel.level}
              </Text>
            </View>

            <View style={s.shareCardBadges}>
              {earnedCount > 0 ? (
                <>
                  {BADGE_DISPLAY_ORDER.filter(id => badges[id])
                    .sort((a, b) => (BADGE_DEFINITIONS[b]?.tier || 0) - (BADGE_DEFINITIONS[a]?.tier || 0))
                    .slice(0, 6)
                    .map(id => {
                      const badge = BADGE_DEFINITIONS[id];
                      return (
                        <View key={id} style={[s.shareCardBadge, { backgroundColor: badge.bgLight, borderColor: badge.color + '40' }]}>
                          {BADGE_IMAGES[id] ? (
                            <Image source={BADGE_IMAGES[id]} style={{ width: 28, height: 28 }} />
                          ) : (
                            <Text style={{ fontSize: 22 }}>{badge.emoji}</Text>
                          )}
                          <Text style={[s.shareCardBadgeName, { color: badge.color }]}>{badge.name}</Text>
                        </View>
                      );
                    })}
                  {earnedCount > 6 && (
                    <View style={[s.shareCardBadge, { backgroundColor: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.3)' }]}>
                      <Text style={{ fontSize: 18, color: '#818cf8' }}>+{earnedCount - 6}</Text>
                      <Text style={[s.shareCardBadgeName, { color: '#818cf8' }]}>more</Text>
                    </View>
                  )}
                </>
              ) : (
                <Text style={s.shareCardEmpty}>Just getting started! 🌱</Text>
              )}
            </View>

            <View style={s.shareCardProgress}>
              <Text style={s.shareCardProgressText}>
                🏆 {earnedCount}/{BADGE_DISPLAY_ORDER.length} badges collected!
              </Text>
              <View style={s.shareCardProgressBar}>
                <View style={[s.shareCardProgressFill, { width: `${Math.round((earnedCount / BADGE_DISPLAY_ORDER.length) * 100)}%` }]} />
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Text style={{ fontSize: 14 }}>🍋</Text>
              <Text style={s.shareCardFooter}>bloxfruitscalc.com</Text>
              <Text style={{ fontSize: 14 }}>🍋</Text>
            </View>
          </View>
        </ViewShot>
      </View>

      {/* Daily Star Claim sub-modal */}
      <DailyStarRewards
        visible={showStarClaim}
        onClose={() => {
          setShowStarClaim(false);
          if (user?.id && appdatabase) {
            getStarStatus(appdatabase, user.id).then(setStreak);
            getUserXP(appdatabase, user.id).then(data => setXp(data.total || 0));
          }
        }}
        db={appdatabase}
        uid={user?.id}
        isDarkMode={isDark}
      />
    </View>
  );
};

// ── Styles ──
const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 58 : (StatusBar.currentHeight || 24) + 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  closeBtn: { padding: 4, marginRight: 10 },
  headerTitle: { fontSize: 17, fontWeight: '800', flex: 1 },
  headerCount: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999,
  },
  headerCountText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  scrollContent: { padding: 16, paddingTop: 12 },

  // ── XP Card ──
  xpCard: {
    borderRadius: 16, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  xpTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  xpTitle: { fontSize: 18, fontWeight: '800' },
  xpSubtitle: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  xpNextBadge: { alignItems: 'center', gap: 2 },
  progressBg: { height: 6, borderRadius: 99, overflow: 'hidden' },
  progressFill: {
    height: '100%', borderRadius: 99,
    backgroundColor: '#6366f1',
  },
  progressLabel: { fontSize: 10, fontWeight: '500', marginTop: 6, textAlign: 'center' },

  // ── Badge Grid ──
  tierHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10, paddingHorizontal: 2,
  },
  tierTitle: { fontSize: 15, fontWeight: '700' },
  tierDesc: { fontSize: 10, fontWeight: '500', marginTop: 1 },
  tierCount: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  tierCountText: { fontSize: 10, fontWeight: '700' },
  badgeGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 8,
  },
  badgeCard: {
    width: BADGE_CARD_WIDTH,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  badgeName: { fontSize: 10, fontWeight: '700', textAlign: 'center', marginBottom: 2 },
  badgeHint: { fontSize: 8, textAlign: 'center', lineHeight: 10, marginTop: 2 },
  earnedTag: {
    marginTop: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999,
  },
  earnedTagText: { fontSize: 7, fontWeight: '700' },

  // ── Sections ──
  section: {
    borderRadius: 16, padding: 14, marginTop: 10,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 10 },

  // ── Level Roadmap ──
  levelRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 7, paddingHorizontal: 6, marginBottom: 1,
  },
  levelDot: {
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  levelName: { fontSize: 12 },
  levelXp: { fontSize: 9, marginTop: 1 },
  currentTag: {
    backgroundColor: '#6366f1', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999,
  },
  currentTagText: { color: '#fff', fontSize: 8, fontWeight: '800' },

  // ── XP Actions ──
  xpActionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.04)',
  },
  xpActionName: { fontSize: 12, fontWeight: '500' },
  xpActionBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  xpActionValue: { fontSize: 11, fontWeight: '700', color: '#6366f1' },

  // ── Streak ──
  streakRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  streakDay: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(99,102,241,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  streakDayDone: { backgroundColor: '#6366f1' },
  streakDayNext: { borderWidth: 2, borderColor: '#6366f1', backgroundColor: 'transparent' },
  streakDayText: { fontSize: 12, fontWeight: '700', color: '#94a3b8' },
  claimButton: {
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 14,
    alignSelf: 'center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  claimButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
  },

  // ── Share Button ──
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#6366f1', borderRadius: 14, padding: 13, marginTop: 16, gap: 6,
  },
  shareBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // ── Shareable Card ──
  shareCard: {
    width: 360, backgroundColor: '#1a1040', borderRadius: 24, padding: 24,
    overflow: 'hidden',
  },
  shareCardHeader: { alignItems: 'center', marginBottom: 20, gap: 4 },
  shareCardTitle: { fontSize: 22, fontWeight: '900', color: '#f1f5f9', letterSpacing: -0.3 },
  shareCardLevel: { fontSize: 13, fontWeight: '700', color: '#a78bfa' },
  shareCardBadges: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center',
    marginBottom: 20,
  },
  shareCardBadge: {
    alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6,
    borderRadius: 14, borderWidth: 1.5, width: 95,
  },
  shareCardBadgeName: { fontSize: 9, fontWeight: '800', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.3 },
  shareCardEmpty: { fontSize: 16, color: '#64748b', textAlign: 'center', paddingVertical: 20 },
  shareCardProgress: { marginBottom: 16 },
  shareCardProgressText: { fontSize: 13, color: '#e2e8f0', textAlign: 'center', marginBottom: 8, fontWeight: '700' },
  shareCardProgressBar: {
    height: 8, borderRadius: 99, backgroundColor: '#1e293b', overflow: 'hidden',
  },
  shareCardProgressFill: {
    height: '100%', borderRadius: 99, backgroundColor: '#a855f7',
  },
  shareCardFooter: {
    fontSize: 12, color: '#a78bfa', textAlign: 'center', fontWeight: '800', letterSpacing: 0.5,
  },
});

export default React.memo(BadgesScreen);
