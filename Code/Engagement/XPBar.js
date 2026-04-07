/**
 * XPBar.js
 * Animated XP progress bar with level display.
 *
 * Shows: [emoji] Level X . Title ---- XP/NextXP
 *
 * Usage:
 *   <XPBar xp={4520} isDarkMode={true} />
 */

import React, { useMemo, useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { getLevelFromXP, getNextLevel, getXPProgress } from './xpUtils';
import { getThemeColors } from '../Helper/themeColors';
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

const XPBar = ({ xp = 0, isDarkMode = false, compact = false }) => {
  const currentLevel = useMemo(() => getLevelFromXP(xp), [xp]);
  const nextLevel = useMemo(() => getNextLevel(xp), [xp]);
  const progress = useMemo(() => getXPProgress(xp), [xp]);
  const isMaxLevel = currentLevel.level === nextLevel.level;

  const animatedWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animatedWidth, {
      toValue: progress,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const c = getThemeColors(isDarkMode);
  const barBg = c.border;
  const barFill = getBarColor(currentLevel.level);
  const textColor = c.text;
  const subtextColor = c.textSecondary;

  if (compact) {
    return (
      <View style={styles.compactContainer}>
        {LEVEL_LOTTIE[currentLevel.level] ? (
          <View style={{ width: 14, height: 14, overflow: 'visible' }}>
            <SafeLottieView source={LEVEL_LOTTIE[currentLevel.level]} autoPlay loop resizeMode="contain" style={{ width: '100%', height: '100%' }} />
          </View>
        ) : (
          <Text>{currentLevel.emoji}</Text>
        )}
        <Text style={[styles.compactLevel, { color: textColor }]}>
          {' '}Lv.{currentLevel.level}
        </Text>
        <View style={[styles.compactBar, { backgroundColor: barBg }]}>
          <Animated.View
            style={[
              styles.compactFill,
              {
                backgroundColor: barFill,
                width: animatedWidth.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, {
      backgroundColor: isDarkMode ? '#0f172a88' : '#f8fafc',
      borderColor: isDarkMode ? '#334155' : '#e2e8f0',
    }]}>
      {/* Header: Level + Title */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {LEVEL_LOTTIE[currentLevel.level] ? (
            <View style={{ width: 20, height: 20, overflow: 'visible' }}>
              <SafeLottieView source={LEVEL_LOTTIE[currentLevel.level]} autoPlay loop resizeMode="contain" style={{ width: '100%', height: '100%' }} />
            </View>
          ) : (
            <Text style={{ fontSize: 16 }}>{currentLevel.emoji}</Text>
          )}
          <Text style={[styles.levelText, { color: textColor }]}>
            Level {currentLevel.level}
          </Text>
        </View>
        <Text style={[styles.titleText, { color: barFill }]}>
          {currentLevel.title}
        </Text>
      </View>

      {/* Progress Bar */}
      <View style={[styles.barContainer, { backgroundColor: barBg }]}>
        <Animated.View
          style={[
            styles.barFill,
            {
              backgroundColor: barFill,
              width: animatedWidth.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>

      {/* XP count */}
      <View style={styles.xpRow}>
        <Text style={[styles.xpText, { color: subtextColor }]}>
          {formatXP(xp)} XP
        </Text>
        {!isMaxLevel && (
          <Text style={[styles.xpText, { color: subtextColor }]}>
            {formatXP(nextLevel.xp)} XP
          </Text>
        )}
        {isMaxLevel && (
          <Text style={[styles.xpText, { color: barFill }]}>
            MAX
          </Text>
        )}
      </View>
    </View>
  );
};

const formatXP = (xp) => {
  if (xp >= 10000) return `${(xp / 1000).toFixed(0)}K`;
  if (xp >= 1000) return `${(xp / 1000).toFixed(1)}K`;
  return String(xp);
};

const getBarColor = (level) => {
  if (level >= 25) return '#F59E0B';
  if (level >= 20) return '#8B5CF6';
  if (level >= 15) return '#3B82F6';
  if (level >= 10) return '#10B981';
  if (level >= 5)  return '#06B6D4';
  return '#6B7280';
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  levelText: {
    fontSize: 14,
    fontWeight: '700',
  },
  titleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  barContainer: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  xpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  xpText: {
    fontSize: 11,
    fontWeight: '500',
  },
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compactLevel: {
    fontSize: 11,
    fontWeight: '600',
  },
  compactBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  compactFill: {
    height: '100%',
    borderRadius: 2,
  },
});

export default React.memo(XPBar);
