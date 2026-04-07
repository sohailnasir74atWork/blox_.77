/**
 * DailyStarRewards.js
 * 7-day login reward modal with animated star claiming.
 *
 * Shows a calendar grid of 7 days with escalating rewards.
 * Tap to claim today's star → XP animation → close.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { DAILY_REWARDS, getStarStatus, claimDailyStar } from './starUtils';
import { getThemeColors } from '../Helper/themeColors';
import SwipeableBottomDrawer from '../Helper/SwipeableBottomDrawer';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const DailyStarRewards = ({ visible, onClose, db, uid, isDarkMode = false }) => {
  const [status, setStatus] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [claimedReward, setClaimedReward] = useState(null);
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const bounceAnim = useRef(new Animated.Value(1)).current;

  // Fetch status when modal opens
  useEffect(() => {
    if (visible && db && uid) {
      getStarStatus(db, uid).then(setStatus);
    }
  }, [visible, db, uid]);

  // Claim star
  const handleClaim = useCallback(async () => {
    if (!status?.canClaim || claiming) return;
    setClaiming(true);

    const reward = await claimDailyStar(db, uid);
    if (reward) {
      setClaimedReward(reward);
      setStatus(prev => ({ ...prev, canClaim: false, currentDay: reward.currentDay }));

      // Bounce animation
      Animated.sequence([
        Animated.spring(bounceAnim, { toValue: 1.3, friction: 3, useNativeDriver: true }),
        Animated.spring(bounceAnim, { toValue: 1, friction: 3, useNativeDriver: true }),
      ]).start();

      // XP pop animation
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    }
    setClaiming(false);
  }, [status, db, uid, claiming]);

  const handleClose = useCallback(() => {
    setClaimedReward(null);
    scaleAnim.setValue(0);
    bounceAnim.setValue(1);
    onClose();
  }, [onClose]);

  if (!visible) return null;

  const c = getThemeColors(isDarkMode);
  const bg = c.bg;
  const cardBg = c.bgAlt;
  const textColor = c.text;
  const subtextColor = c.textSecondary;
  const accentColor = '#F59E0B';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <SwipeableBottomDrawer onClose={handleClose} isDarkMode={isDarkMode} style={[styles.container, { backgroundColor: bg }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: textColor }]}>⭐ Daily Stars</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Text style={{ fontSize: 20, color: subtextColor }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Streak info */}
          {status?.streakBroken && (
            <View style={[styles.streakAlert, { backgroundColor: '#FEF2F2' }]}>
              <Text style={{ color: '#DC2626', fontSize: 12, fontWeight: '600' }}>
                😢 Streak broken! Starting over from Day 1
              </Text>
            </View>
          )}

          {/* Already claimed banner */}
          {status && !status.canClaim && !claimedReward && (
            <View style={[styles.streakAlert, { backgroundColor: isDarkMode ? '#064e3b' : '#ECFDF5' }]}>
              <Text style={{ color: '#10B981', fontSize: 13, fontWeight: '700' }}>
                ✅ Already claimed today! Come back tomorrow
              </Text>
            </View>
          )}

          {/* 7-day grid */}
          <View style={styles.grid}>
            {DAILY_REWARDS.map((reward) => {
              const isToday = status?.currentDay === reward.day;
              const alreadyClaimed = status && !status.canClaim;
              const isPast = reward.day < (status?.currentDay || 1);
              const isFuture = reward.day > (status?.currentDay || 1);

              return (
                <TouchableOpacity
                  key={reward.day}
                  disabled={!isToday || !status?.canClaim || claiming}
                  onPress={isToday && status?.canClaim ? handleClaim : undefined}
                  activeOpacity={0.7}
                  style={[
                    styles.dayCard,
                    { backgroundColor: cardBg },
                    isToday && status?.canClaim && {
                      borderColor: accentColor,
                      borderWidth: 2,
                      backgroundColor: isDarkMode ? '#1a1a2e' : '#FFFBEB',
                    },
                    isToday && alreadyClaimed && {
                      borderColor: '#10B981',
                      borderWidth: 2,
                      backgroundColor: isDarkMode ? '#064e3b' : '#ECFDF5',
                    },
                    isPast && { opacity: 0.5 },
                    isFuture && { opacity: 0.4 },
                  ]}
                >
                  {/* Day number */}
                  <Text style={[styles.dayNumber, { color: subtextColor }]}>
                    Day {reward.day}
                  </Text>

                  {/* Emoji */}
                  <Animated.Text
                    style={[
                      styles.dayEmoji,
                      isToday && claimedReward && {
                        transform: [{ scale: bounceAnim }],
                      },
                    ]}
                  >
                    {isPast ? '✅' : (isToday && alreadyClaimed) ? '✅' : reward.emoji}
                  </Animated.Text>

                  {/* Reward */}
                  <Text style={[styles.rewardLabel, { color: textColor }]}>
                    {reward.label}
                  </Text>

                  {/* Today indicator */}
                  {isToday && status?.canClaim && (
                    <View style={[styles.claimBadge, { backgroundColor: accentColor }]}>
                      <Text style={styles.claimText}>TAP!</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Claimed reward popup */}
          {claimedReward && (
            <Animated.View
              style={[
                styles.rewardPopup,
                {
                  backgroundColor: isDarkMode ? '#1e293b' : '#FFFBEB',
                  borderColor: accentColor,
                  opacity: scaleAnim,
                  transform: [{
                    scale: scaleAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.5, 1],
                    }),
                  }],
                },
              ]}
            >
              <Text style={{ fontSize: 28 }}>🎉</Text>
              <Text style={[styles.rewardTitle, { color: textColor }]}>
                {claimedReward.description}
              </Text>
              <Text style={[styles.rewardXP, { color: accentColor }]}>
                {claimedReward.label}
              </Text>
            </Animated.View>
          )}

          {/* Cycle info */}
          <Text style={[styles.cycleText, { color: subtextColor }]}>
            Cycle #{status?.cycleNumber || 1} · {status?.totalStarsEarned || 0} stars earned
          </Text>
        </SwipeableBottomDrawer>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    width: '100%',
    padding: 20,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
  },
  closeBtn: {
    padding: 4,
  },
  streakAlert: {
    padding: 8,
    borderRadius: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  dayCard: {
    width: (SCREEN_WIDTH - 80) / 4,
    aspectRatio: 0.85,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dayNumber: {
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 2,
  },
  dayEmoji: {
    fontSize: 24,
    marginBottom: 4,
  },
  rewardLabel: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  claimBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  claimText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  rewardPopup: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
  },
  rewardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  rewardXP: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },
  cycleText: {
    textAlign: 'center',
    marginTop: 12,
    fontSize: 11,
    fontWeight: '500',
  },
});

export default React.memo(DailyStarRewards);
