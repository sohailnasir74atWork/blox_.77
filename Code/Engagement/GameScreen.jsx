/**
 * GameScreen.jsx
 * Navigation screen wrapper for all mini-games.
 * Receives { gameId } via route.params and renders the matching game.
 *
 * Round tracking:
 *   - 1st round per game per day is FREE
 *   - After 1st round, user can watch 1 rewarded ad to unlock 3 more rounds
 *   - Max 4 rounds per game per day (1 free + 3 ad-unlocked)
 */

import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useLocalState } from '../LocalGlobelStats';
import RewardedAdManager from '../Ads/RewardedAdManager';

import SpotTheFake from './SpotTheFake';
import SafeCracker from './SafeCracker';
import QuickDraw from './QuickDraw';
import MemoryMatch from './MemoryMatch';

const GameScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { gameId } = route.params || {};
  const { localState, updateLocalState } = useLocalState();

  const handleClose = () => navigation.goBack();

  // ── Round tracking helpers ──
  const today = new Date().toISOString().slice(0, 10);

  const roundInfo = useMemo(() => {
    const rounds = localState?.gameRounds || {};
    const info = rounds[gameId];
    const isToday = info?.date === today;
    const played = isToday ? (info.played || 0) : 0;
    const unlocked = isToday ? (info.unlocked || false) : false;
    const maxRounds = unlocked ? 4 : 1;
    const roundsLeft = Math.max(0, maxRounds - played);
    const maxedOut = unlocked && played >= 4;
    const needsUnlock = !unlocked && played >= 1;
    return { played, unlocked, maxRounds, roundsLeft, maxedOut, needsUnlock };
  }, [localState?.gameRounds, gameId, today]);

  const onRoundComplete = useCallback(() => {
    const rounds = localState?.gameRounds || {};
    const info = rounds[gameId];
    const isToday = info?.date === today;
    const currentPlayed = isToday ? (info.played || 0) : 0;
    updateLocalState('gameRounds', {
      ...rounds,
      [gameId]: {
        date: today,
        played: currentPlayed + 1,
        unlocked: isToday ? (info.unlocked || false) : false,
      },
    });
  }, [localState?.gameRounds, gameId, today, updateLocalState]);

  const onWatchAd = useCallback(() => {
    RewardedAdManager.showWithCallback(
      () => {
        // Reward earned — unlock 3 more rounds
        const rounds = localState?.gameRounds || {};
        const info = rounds[gameId] || {};
        updateLocalState('gameRounds', {
          ...rounds,
          [gameId]: { ...info, date: today, unlocked: true },
        });
      },
      () => {
        // Ad closed without earning reward
        Alert.alert('Ad Skipped', 'Watch the full ad to unlock more rounds.');
      },
      () => {
        // No ad available — unlock anyway as a graceful fallback
        const rounds = localState?.gameRounds || {};
        const info = rounds[gameId] || {};
        updateLocalState('gameRounds', {
          ...rounds,
          [gameId]: { ...info, date: today, unlocked: true },
        });
      },
    );
  }, [localState?.gameRounds, gameId, today, updateLocalState]);

  const renderGame = () => {
    const gameProps = {
      onClose: handleClose,
      roundInfo,
      onRoundComplete,
      onWatchAd,
    };

    switch (gameId) {
      case 'spot':
        return <SpotTheFake {...gameProps} />;
      case 'safe':
        return <SafeCracker {...gameProps} />;
      case 'draw':
        return <QuickDraw {...gameProps} />;
      case 'memory':
        return <MemoryMatch {...gameProps} />;
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {renderGame()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default GameScreen;
