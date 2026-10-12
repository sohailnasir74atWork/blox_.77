/**
 * GameScreen.jsx
 * Navigation screen wrapper for all mini-games.
 * Receives { gameId } via route.params and renders the matching game.
 *
 * Round tracking (per game, per local calendar day):
 *   - 1st round is FREE
 *   - After it, 1 rewarded ad unlocks 3 more rounds
 *   - Max 4 rounds per game per day (1 free + 3 ad-unlocked)
 * A round is counted when it STARTS, so backing out mid-game can't be used
 * to dodge the limit. GameRoundActions enforces it on every start button.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useLocalState } from '../LocalGlobelStats';
import RewardedAdManager from '../Ads/RewardedAdManager';

import SpotTheFake from './SpotTheFake';
import SafeCracker from './SafeCracker';
import QuickDraw from './QuickDraw';
import MemoryMatch from './MemoryMatch';

const FREE_ROUNDS = 1;
const MAX_ROUNDS = 4;

// Local-day key — toISOString() is UTC, which reset the limit mid-afternoon
// or mid-evening depending on the player's timezone.
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const GameScreen = () => {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const route = useRoute();
  const { gameId } = route.params || {};
  const { localState, updateLocalState } = useLocalState();
  const [adLoading, setAdLoading] = useState(false);

  // Latest rounds map for callbacks that fire later (ad callbacks arrive
  // after the ad closes; a stale closure would drop another game's count).
  const roundsRef = useRef(localState?.gameRounds || {});
  roundsRef.current = localState?.gameRounds || {};
  const mountedRef = useRef(true);
  const adPendingRef = useRef(false);

  // Warm the rewarded ad as soon as a game opens — the "watch ad to unlock
  // rounds" button needs it loaded BEFORE the tap (cold loads used to time
  // out and hand out the unlock for free).
  useEffect(() => {
    try { RewardedAdManager.prepare(); } catch (_) {}
    return () => { mountedRef.current = false; };
  }, []);

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);

  const today = todayKey();

  const roundInfo = useMemo(() => {
    const info = (localState?.gameRounds || {})[gameId];
    const isToday = info?.date === today;
    const played = isToday ? (info.played || 0) : 0;
    const unlocked = isToday ? (info.unlocked || false) : false;
    const maxRounds = unlocked ? MAX_ROUNDS : FREE_ROUNDS;
    const roundsLeft = Math.max(0, maxRounds - played);
    const maxedOut = unlocked && played >= MAX_ROUNDS;
    const needsUnlock = !unlocked && played >= FREE_ROUNDS;
    return { played, unlocked, maxRounds: MAX_ROUNDS, roundsLeft, maxedOut, needsUnlock };
  }, [localState?.gameRounds, gameId, today]);

  const writeRound = useCallback((patch) => {
    const day = todayKey();
    const rounds = roundsRef.current;
    const info = rounds[gameId];
    const isToday = info?.date === day;
    const next = {
      date: day,
      played: isToday ? (info.played || 0) : 0,
      unlocked: isToday ? (info.unlocked || false) : false,
      ...patch(isToday ? info : null),
    };
    const updated = { ...rounds, [gameId]: next };
    roundsRef.current = updated;
    updateLocalState('gameRounds', updated);
  }, [gameId, updateLocalState]);

  const onRoundStart = useCallback(() => {
    writeRound((info) => ({ played: (info?.played || 0) + 1 }));
  }, [writeRound]);

  const unlockRounds = useCallback(() => {
    writeRound(() => ({ unlocked: true }));
  }, [writeRound]);

  const onWatchAd = useCallback(() => {
    if (adPendingRef.current) return; // double taps while the ad loads
    adPendingRef.current = true;
    setAdLoading(true);
    const settle = () => {
      adPendingRef.current = false;
      if (mountedRef.current) setAdLoading(false);
    };
    RewardedAdManager.showWithCallback(
      () => { settle(); unlockRounds(); },
      () => {
        settle();
        Alert.alert(t('engagement.game_screen.ad_skipped_title'), t('engagement.game_screen.ad_skipped_msg'));
      },
      // No ad available — unlock anyway as a graceful fallback
      () => { settle(); unlockRounds(); },
    );
  }, [unlockRounds, t]);

  const renderGame = () => {
    const gameProps = {
      onClose: handleClose,
      roundInfo,
      onRoundStart,
      onWatchAd,
      adLoading,
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
