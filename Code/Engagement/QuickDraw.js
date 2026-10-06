/**
 * QuickDraw.js — "Fruit Slash" reaction time game
 * How fast can you slash the fruit? 3 rounds!
 * Blox Fruit themed — Polished, Kid-Friendly, Consistent UI
 *
 * Timing notes:
 *   - Taps register on touch-DOWN (onPressIn). onPress waits for the finger
 *     to lift, which added 50–150 ms to every reaction time.
 *   - Under ANTICIPATION_MS no human is reacting to the signal, they guessed —
 *     that counts as a false start, same as tapping during WAIT.
 *   - Leaving the app mid-round restarts that round; a signal that fired
 *     while the app was hidden can't be reacted to.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Animated,
  Platform,
  Vibration,
  ScrollView,
  AppState,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { getThemeColors } from '../Helper/themeColors';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadGameStats, saveGameStats, submitLeaderboardScore } from './gameScores';
import GameRoundActions from './GameRoundActions';

const TOTAL_ROUNDS = 3;
const MIN_WAIT = 1500;
const MAX_WAIT = 4000;
const ANTICIPATION_MS = 100;
const PENALTY_MS = 999;
const ACCENT = '#DC2626';

const getRank = (avgMs) => {
  if (avgMs <= 200) return { label: 'Lightning! ⚡', emoji: '⚡', color: '#F59E0B', tier: 4 };
  if (avgMs <= 300) return { label: 'Fruit Master! 🎯', emoji: '🎯', color: '#10B981', tier: 3 };
  if (avgMs <= 450) return { label: 'Quick Slash! 🗡️', emoji: '🗡️', color: '#3B82F6', tier: 2 };
  if (avgMs <= 600) return { label: 'Steady Hand', emoji: '🍊', color: '#8B5CF6', tier: 1 };
  return { label: 'Keep Practicing', emoji: '🐢', color: '#6B7280', tier: 0 };
};

const isPenalty = (t) => t >= PENALTY_MS;

// Average INCLUDES false-start penalties — that's what "+999ms penalty" promises.
const summarize = (times) => {
  const valid = times.filter(t => !isPenalty(t));
  return {
    avg: times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : PENALTY_MS,
    best: valid.length > 0 ? Math.min(...valid) : PENALTY_MS,
    early: times.length - valid.length,
  };
};

const QuickDraw = ({ onClose, roundInfo, onRoundStart, onWatchAd, adLoading }) => {
  const insets = useSafeAreaInsets();
  const { firestoreDB, appdatabase, user, theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  const uid = user?.id;

  const [phase, setPhase] = useState('loading'); // loading | rules | waiting | draw | early | roundResult | gameResult
  const [bestTime, setBestTime] = useState(0);
  const [currentRound, setCurrentRound] = useState(0);
  const [roundTimes, setRoundTimes] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [earlyReason, setEarlyReason] = useState('wait'); // wait | guess
  const [isNewBest, setIsNewBest] = useState(false);

  const drawTimeRef = useRef(0);
  const waitTimerRef = useRef(null);
  const phaseRef = useRef('loading');
  const roundTimesRef = useRef([]);
  const currentRoundRef = useRef(0);
  const bestTimeRef = useRef(0);
  const statsLoadedRef = useRef(false);
  const flashAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const countAnim = useRef(new Animated.Value(0)).current;

  const c = getThemeColors(isDarkMode);
  const surface = isDarkMode ? config.colors.surfaceDark : '#fff';
  const border = isDarkMode ? '#334155' : '#e2e8f0';

  const goPhase = (p) => {
    phaseRef.current = p;
    setPhase(p);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = uid ? await loadGameStats(firestoreDB, uid) : null;
      if (cancelled) return;
      statsLoadedRef.current = !!data;
      const best = data?.drawBestTime || 0;
      bestTimeRef.current = best > 0 && !isPenalty(best) ? best : 0;
      setBestTime(bestTimeRef.current);
      goPhase('rules');
    })();
    return () => { cancelled = true; };
  }, [firestoreDB, uid]);

  const clearWait = () => {
    if (waitTimerRef.current) clearTimeout(waitTimerRef.current);
    waitTimerRef.current = null;
  };

  useEffect(() => clearWait, []);

  const startRound = useCallback(() => {
    clearWait();
    setCurrentTime(0);
    goPhase('waiting');
    flashAnim.setValue(0);
    scaleAnim.setValue(0.8);
    triggerHapticFeedback('impactLight');

    const waitTime = MIN_WAIT + Math.random() * (MAX_WAIT - MIN_WAIT);
    waitTimerRef.current = setTimeout(() => {
      waitTimerRef.current = null;
      drawTimeRef.current = Date.now();
      goPhase('draw');
      triggerHapticFeedback('impactHeavy');
      if (Platform.OS === 'android') Vibration.vibrate(100);

      Animated.parallel([
        Animated.timing(flashAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1.1, tension: 300, friction: 5, useNativeDriver: true }),
      ]).start();
    }, waitTime);
  }, [triggerHapticFeedback, flashAnim, scaleAnim]);

  // Leaving the app during WAIT or SLASH replays that round from the start.
  const startRoundRef = useRef(startRound);
  startRoundRef.current = startRound;
  const wasAwayRef = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const live = phaseRef.current === 'waiting' || phaseRef.current === 'draw';
      if (state !== 'active') {
        if (live) { clearWait(); wasAwayRef.current = true; }
      } else if (wasAwayRef.current) {
        wasAwayRef.current = false;
        startRoundRef.current();
      }
    });
    return () => sub.remove();
  }, []);

  const recordTime = (ms) => {
    const next = [...roundTimesRef.current, ms];
    roundTimesRef.current = next;
    setRoundTimes(next);
    setCurrentTime(ms);
  };

  const falseStart = (reason) => {
    clearWait();
    setEarlyReason(reason);
    goPhase('early');
    recordTime(PENALTY_MS);
    triggerHapticFeedback('notificationError');
    if (Platform.OS === 'android') Vibration.vibrate([0, 80, 40, 80]);
  };

  const handleTap = () => {
    const p = phaseRef.current; // ref, not state — two taps can land in one frame
    if (p === 'waiting') {
      falseStart('wait');
    } else if (p === 'draw') {
      const reactionTime = Date.now() - drawTimeRef.current;
      if (reactionTime < ANTICIPATION_MS) {
        falseStart('guess');
        return;
      }
      goPhase('roundResult');
      recordTime(reactionTime);
      triggerHapticFeedback('notificationSuccess');

      countAnim.setValue(0);
      Animated.spring(countAnim, {
        toValue: 1, tension: 200, friction: 8, useNativeDriver: true,
      }).start();
    }
  };

  const finishGame = () => {
    goPhase('gameResult');

    const times = roundTimesRef.current;
    const { avg, best } = summarize(times);
    const oldBest = bestTimeRef.current;
    const improved = !isPenalty(best) && (oldBest === 0 || best < oldBest);
    setIsNewBest(improved);
    if (improved) {
      bestTimeRef.current = best;
      setBestTime(best);
      triggerHapticFeedback('notificationSuccess');
    }

    if (!statsLoadedRef.current) return;
    saveGameStats(firestoreDB, uid, {
      lastDrawAt: new Date(),
      drawLastAvg: avg,
      // Never store the 999 penalty as a "best time".
      ...(bestTimeRef.current > 0 ? { drawBestTime: bestTimeRef.current } : {}),
    });
    if (improved) {
      submitLeaderboardScore({ firestoreDB, appdatabase, uid, user, gameKey: 'draw', score: best });
    }
  };

  const nextRound = () => {
    const next = currentRoundRef.current + 1;
    if (next >= TOTAL_ROUNDS) {
      finishGame();
    } else {
      currentRoundRef.current = next;
      setCurrentRound(next);
      startRound();
    }
  };

  const startGame = () => {
    onRoundStart?.();
    roundTimesRef.current = [];
    currentRoundRef.current = 0;
    setRoundTimes([]);
    setCurrentRound(0);
    setCurrentTime(0);
    setIsNewBest(false);
    triggerHapticFeedback('impactHeavy');
    startRound();
  };

  const getTimeColor = (ms) => {
    if (isPenalty(ms)) return '#EF4444';
    if (ms <= 200) return '#F59E0B';
    if (ms <= 300) return '#10B981';
    if (ms <= 450) return '#3B82F6';
    return '#8B5CF6';
  };

  const renderDots = () => (
    <View style={styles.dotsRow}>
      {Array.from({ length: TOTAL_ROUNDS }).map((_, i) => {
        let bg = phase === 'waiting' || phase === 'draw' ? 'rgba(255,255,255,0.25)' : (isDarkMode ? '#334155' : '#e2e8f0');
        if (i < roundTimes.length) bg = isPenalty(roundTimes[i]) ? '#EF4444' : '#10B981';
        else if (i === currentRound) bg = '#F59E0B';
        return <View key={i} style={[styles.dot, { backgroundColor: bg }]} />;
      })}
    </View>
  );

  const { avg: avgTime, best: bestRound, early: earlyCount } = summarize(roundTimes);
  const rank = getRank(avgTime);
  const isLastRound = currentRound + 1 >= TOTAL_ROUNDS;

  return (
    <View style={[styles.screen, { backgroundColor: isDarkMode ? config.colors.backgroundDark : '#f8fafc', paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={onClose} style={styles.backBtn} hitSlop={8}>
          <Icon name="chevron-back" size={24} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.text }]}>⚡ Fruit Slash</Text>
        <View style={{ width: 40 }} />
      </View>

      {phase === 'loading' && (
        <View style={styles.centerContent}>
          <Text style={{ fontSize: 48 }}>⚡</Text>
        </View>
      )}

      {phase === 'rules' && (
        <ScrollView contentContainerStyle={styles.rulesContent} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 64, textAlign: 'center' }}>🗡️</Text>
          <Text style={[styles.bigTitle, { color: c.text, textAlign: 'center' }]}>Fruit Slash!</Text>
          <Text style={[styles.subText, { color: c.textSecondary, textAlign: 'center', marginBottom: 20 }]}>
            How fast are your reflexes, pirate?
          </Text>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEF3C7' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>⏳</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>Wait for It...</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>The screen turns dark red. WAIT patiently. Don't tap yet!</Text>
              </View>
            </View>
          </View>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEE2E2' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>🗡️</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>SLASH!</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>When it turns GREEN and says "SLASH!" — TAP fast!</Text>
              </View>
            </View>
          </View>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#EFF6FF' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>🚫</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>Don't Slash Early!</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Tapping before the signal (or guessing it) adds a 999ms penalty to your average.</Text>
              </View>
            </View>
          </View>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#F0FDF4' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>🏆</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>3 Rounds!</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Your fastest slash goes on the leaderboard. Under 200ms = LIGHTNING! ⚡</Text>
              </View>
            </View>
          </View>

          {bestTime > 0 && (
            <Text style={[styles.bestScoreLabel, { color: '#F59E0B' }]}>
              ⚡ Best Time: {bestTime}ms
            </Text>
          )}

          <GameRoundActions
            roundInfo={roundInfo}
            onPlay={startGame}
            onWatchAd={onWatchAd}
            adLoading={adLoading}
            color={ACCENT}
            playLabel="LET'S GO! 🎮"
            playIcon="play"
            textColor={c.textSecondary}
            style={{ marginTop: 16 }}
          />
        </ScrollView>
      )}

      {phase === 'waiting' && (
        <Pressable style={[styles.fullZone, { backgroundColor: '#7F1D1D' }]} onPressIn={handleTap}>
          {renderDots()}
          <Text style={styles.waitTitle}>WAIT...</Text>
          <Text style={styles.waitSub}>Don't tap yet! 🤫</Text>
          <View style={styles.waitPulse}><Text style={{ fontSize: 56 }}>🎯</Text></View>
          <Text style={styles.roundInfo}>Round {currentRound + 1}/{TOTAL_ROUNDS}</Text>
        </Pressable>
      )}

      {phase === 'draw' && (
        <Animated.View style={{ flex: 1, opacity: flashAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }}>
          <Pressable style={[styles.fullZone, { backgroundColor: '#15803D' }]} onPressIn={handleTap}>
            {renderDots()}
            <Animated.Text style={[styles.drawTitle, { transform: [{ scale: scaleAnim }] }]}>SLASH! 🗡️</Animated.Text>
            <Text style={styles.drawSub}>TAP NOW!</Text>
          </Pressable>
        </Animated.View>
      )}

      {phase === 'early' && (
        <View style={[styles.fullZone, { backgroundColor: surface }]}>
          {renderDots()}
          <Text style={{ fontSize: 64 }}>🚫</Text>
          <Text style={styles.earlyTitle}>TOO EARLY!</Text>
          <Text style={styles.earlySub}>
            {earlyReason === 'guess' ? 'Faster than humanly possible — that was a guess! 😜' : 'You slashed before the signal! 😤'}
          </Text>
          <Text style={styles.penaltyText}>+{PENALTY_MS}ms penalty</Text>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#F59E0B', marginTop: 32 }]} onPress={nextRound}>
            <Text style={styles.actionBtnText}>{isLastRound ? 'See Results 🏆' : 'Next Round →'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'roundResult' && (
        <View style={[styles.fullZone, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#f0fdf4' }]}>
          {renderDots()}
          <Text style={{ fontSize: 64 }}>{currentTime <= 200 ? '⚡' : currentTime <= 300 ? '🎯' : currentTime <= 450 ? '🗡️' : '🍊'}</Text>
          <Animated.Text style={[styles.timeDisplay, { color: getTimeColor(currentTime), transform: [{ scale: countAnim }] }]}>
            {currentTime}ms
          </Animated.Text>
          <Text style={[styles.timeLabel, { color: getTimeColor(currentTime) }]}>
            {currentTime <= 200 ? 'INCREDIBLE! ⚡' : currentTime <= 300 ? 'Super fast! 🎯' : currentTime <= 450 ? 'Nice reflexes! 🗡️' : currentTime <= 600 ? 'Not bad! 🍊' : 'A bit slow... 🐢'}
          </Text>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#10B981', marginTop: 32 }]} onPress={nextRound}>
            <Text style={styles.actionBtnText}>{isLastRound ? 'See Results 🏆' : 'Next Round →'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'gameResult' && (
        <ScrollView contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 80 }}>{rank.emoji}</Text>
          <Text style={[styles.bigTitle, { color: rank.color }]}>{rank.label}</Text>

          <View style={[styles.statsCard, { backgroundColor: surface, borderColor: border }]}>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Average</Text>
              <Text style={[styles.statVal, { color: getTimeColor(avgTime) }]}>{avgTime}ms</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Best Round</Text>
              <Text style={[styles.statVal, { color: getTimeColor(bestRound) }]}>{!isPenalty(bestRound) ? `${bestRound}ms` : '—'}</Text>
            </View>
            <View style={[styles.statRow, { borderBottomWidth: 0 }]}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Early Slashes</Text>
              <Text style={[styles.statVal, { color: earlyCount > 0 ? '#EF4444' : '#10B981' }]}>{earlyCount}</Text>
            </View>
          </View>

          <View style={styles.roundTimesRow}>
            {roundTimes.map((t, i) => (
              <View key={i} style={[styles.roundChip, { backgroundColor: getTimeColor(t) }]}>
                <Text style={styles.roundChipText}>{isPenalty(t) ? 'EARLY' : `${t}ms`}</Text>
              </View>
            ))}
          </View>

          {isNewBest ? (
            <Text style={[styles.bestScoreLabel, { color: '#F59E0B', marginTop: 16 }]}>🎉 New Best Time: {bestTime}ms!</Text>
          ) : bestTime > 0 ? (
            <Text style={[styles.bestScoreLabel, { color: '#F59E0B', marginTop: 16 }]}>⚡ All-time Best: {bestTime}ms</Text>
          ) : null}

          <GameRoundActions
            roundInfo={roundInfo}
            onPlay={startGame}
            onWatchAd={onWatchAd}
            adLoading={adLoading}
            color={ACCENT}
            playLabel="Play Again"
            textColor={c.textSecondary}
          />
          <TouchableOpacity style={[styles.actionBtn, styles.doneBtn]} onPress={onClose}>
            <Text style={styles.actionBtnText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '800', flex: 1, textAlign: 'center' },
  backBtn: { padding: 8, width: 40 },

  centerContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20, paddingHorizontal: 16 },
  rulesContent: { paddingVertical: 10, paddingHorizontal: 20 },
  bigTitle: { fontSize: 28, fontWeight: '900', marginTop: 8, textAlign: 'center' },
  subText: { fontSize: 14, marginTop: 4 },

  ruleCard: { borderRadius: 16, padding: 16, marginBottom: 10 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ruleEmoji: { fontSize: 36 },
  ruleTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  ruleDesc: { fontSize: 13, lineHeight: 18 },

  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: 32, borderRadius: 100, alignSelf: 'center' },
  actionBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  doneBtn: { backgroundColor: '#64748b', marginTop: 10, width: '100%', justifyContent: 'center' },

  bestScoreLabel: { fontSize: 16, fontWeight: '800', textAlign: 'center', marginTop: 10 },

  fullZone: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 24, margin: 12, paddingHorizontal: 20 },

  waitTitle: { fontSize: 48, fontWeight: '900', color: '#FCA5A5', letterSpacing: 4, marginBottom: 12 },
  waitSub: { fontSize: 20, color: '#FCA5A5', fontWeight: '800', opacity: 0.8 },
  waitPulse: { marginTop: 32, opacity: 0.8 },
  roundInfo: { fontSize: 16, color: '#FCA5A5', fontWeight: '800', marginTop: 32, opacity: 0.6 },

  drawTitle: { fontSize: 56, fontWeight: '900', color: '#fff', letterSpacing: 6 },
  drawSub: { fontSize: 28, color: '#BBF7D0', fontWeight: '900', marginTop: 12 },

  earlyTitle: { fontSize: 36, fontWeight: '900', color: '#EF4444', marginTop: 16 },
  earlySub: { fontSize: 18, color: '#94a3b8', fontWeight: '700', marginTop: 8, textAlign: 'center' },
  penaltyText: { fontSize: 22, color: '#EF4444', fontWeight: '900', marginTop: 12 },

  timeDisplay: { fontSize: 72, fontWeight: '900', marginTop: 12 },
  timeLabel: { fontSize: 20, fontWeight: '800', marginTop: 8 },

  dotsRow: { flexDirection: 'row', gap: 10, position: 'absolute', top: 30 },
  dot: { width: 12, height: 12, borderRadius: 6 },

  statsCard: { width: '100%', borderRadius: 20, borderWidth: 1, padding: 20, marginTop: 24 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(128,128,128,0.1)' },
  statLabel: { fontSize: 16, fontWeight: '600' },
  statVal: { fontSize: 24, fontWeight: '900' },

  roundTimesRow: { flexDirection: 'row', gap: 8, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' },
  roundChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  roundChipText: { color: '#fff', fontSize: 14, fontWeight: '900' },
});

export default QuickDraw;
