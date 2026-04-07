/**
 * QuickDraw.js — "Fruit Slash" reaction time game
 * How fast can you slash the fruit? 3 rounds!
 * Blox Fruit themed — Polished, Kid-Friendly, Consistent UI
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  Platform,
  Vibration,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { getThemeColors } from '../Helper/themeColors';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';
import { useHaptic } from '../Helper/HepticFeedBack';
import { doc, getDoc, setDoc } from '@react-native-firebase/firestore';
import { ref, get } from '@react-native-firebase/database';
import { updateLeaderboardCacheRealtime } from './updateLeaderboardCache';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TOTAL_ROUNDS = 3;
const MIN_WAIT = 1500;
const MAX_WAIT = 4000;

const getRank = (avgMs) => {
  if (avgMs <= 200) return { label: 'Lightning! ⚡', emoji: '⚡', color: '#F59E0B', tier: 4 };
  if (avgMs <= 300) return { label: 'Fruit Master! 🎯', emoji: '🎯', color: '#10B981', tier: 3 };
  if (avgMs <= 450) return { label: 'Quick Slash! 🗡️', emoji: '🗡️', color: '#3B82F6', tier: 2 };
  if (avgMs <= 600) return { label: 'Steady Hand', emoji: '🍊', color: '#8B5CF6', tier: 1 };
  return { label: 'Keep Practicing', emoji: '🐢', color: '#6B7280', tier: 0 };
};

const QuickDraw = ({ onClose, roundInfo, onRoundComplete, onWatchAd }) => {
  const visible = true;
  const insets = useSafeAreaInsets();
  const { firestoreDB, appdatabase, user, theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  const uid = user?.id;

  const [phase, setPhase] = useState('loading');
  const [bestTime, setBestTime] = useState(0);
  const [currentRound, setCurrentRound] = useState(0);
  const [roundTimes, setRoundTimes] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [tappedEarly, setTappedEarly] = useState(false);

  const drawTimeRef = useRef(0);
  const waitTimerRef = useRef(null);
  const flashAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const countAnim = useRef(new Animated.Value(0)).current;

  const c = getThemeColors(isDarkMode);

  useEffect(() => {
    if (!visible || !firestoreDB || !uid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(firestoreDB, 'games', uid));
        const data = snap.exists ? snap.data() : {};
        setBestTime(data.drawBestTime || 0);
        setPhase('rules');
        setRoundTimes([]);
        setCurrentRound(0);
      } catch {
        setPhase('rules');
      }
    })();
  }, [visible, firestoreDB, uid]);

  const startRound = useCallback(() => {
    setTappedEarly(false);
    setCurrentTime(0);
    setPhase('waiting');
    flashAnim.setValue(0);
    scaleAnim.setValue(0.8);
    triggerHapticFeedback('impactLight');

    const waitTime = MIN_WAIT + Math.random() * (MAX_WAIT - MIN_WAIT);

    waitTimerRef.current = setTimeout(() => {
      drawTimeRef.current = Date.now();
      setPhase('draw');
      triggerHapticFeedback('impactHeavy');
      if (Platform.OS === 'android') Vibration.vibrate(100);

      Animated.parallel([
        Animated.timing(flashAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1.1, tension: 300, friction: 5, useNativeDriver: true }),
      ]).start();
    }, waitTime);
  }, [triggerHapticFeedback, flashAnim, scaleAnim]);

  const handleTap = useCallback(() => {
    if (phase === 'waiting') {
      clearTimeout(waitTimerRef.current);
      setTappedEarly(true);
      setPhase('early');
      triggerHapticFeedback('notificationError');
      if (Platform.OS === 'android') Vibration.vibrate([0, 80, 40, 80]);

      const newTimes = [...roundTimes, 999];
      setRoundTimes(newTimes);
      setCurrentTime(999);
    } else if (phase === 'draw') {
      const reactionTime = Date.now() - drawTimeRef.current;
      setCurrentTime(reactionTime);
      setPhase('roundResult');
      triggerHapticFeedback('notificationSuccess');

      const newTimes = [...roundTimes, reactionTime];
      setRoundTimes(newTimes);

      countAnim.setValue(0);
      Animated.spring(countAnim, {
        toValue: 1, tension: 200, friction: 8, useNativeDriver: true,
      }).start();
    }
  }, [phase, roundTimes, triggerHapticFeedback, countAnim]);

  const nextRound = useCallback(() => {
    const next = currentRound + 1;
    if (next >= TOTAL_ROUNDS) {
      finishGame();
    } else {
      setCurrentRound(next);
      startRound();
    }
  }, [currentRound, startRound]);

  const startGame = useCallback(() => {
    setRoundTimes([]);
    setCurrentRound(0);
    setCurrentTime(0);
    setTappedEarly(false);
    triggerHapticFeedback('impactHeavy');
    startRound();
  }, [startRound, triggerHapticFeedback]);

  const finishGame = useCallback(async () => {
    setPhase('gameResult');
    if (onRoundComplete) onRoundComplete();

    const validTimes = roundTimes.filter(t => t < 999);
    const avgTime = validTimes.length > 0 ? Math.round(validTimes.reduce((a, b) => a + b, 0) / validTimes.length) : 999;
    const bestRound = validTimes.length > 0 ? Math.min(...validTimes) : 999;

    try {
      const newBest = (bestTime > 0 && bestTime !== 999) ? Math.min(bestRound, bestTime) : bestRound;
      setBestTime(newBest);

      await setDoc(doc(firestoreDB, 'games', uid), {
        lastDrawAt: new Date(),
        drawBestTime: newBest,
        drawLastAvg: avgTime,
      }, { merge: true });

      if (newBest > 0 && newBest < 999) {
        let username = 'Unknown';
        let avatar = null;
        try {
          const [nameSnap, avatarSnap] = await Promise.all([
            get(ref(appdatabase, `users/${uid}/displayName`)),
            get(ref(appdatabase, `users/${uid}/avatar`)),
          ]);
          username = nameSnap.exists() ? nameSnap.val() : (user?.displayName || 'Unknown');
          avatar = avatarSnap.exists() ? avatarSnap.val() : null;
        } catch (_) {}
        await setDoc(doc(firestoreDB, 'game_scores', 'draw', 'scores', uid), {
          score: newBest,
          username,
          avatar,
          updatedAt: new Date(),
        }, { merge: true });

        await updateLeaderboardCacheRealtime(firestoreDB, 'draw', uid, newBest, username, avatar);
      }
    } catch (err) {
      console.warn('[FruitSlash] save error:', err?.message);
    }
  }, [roundTimes, bestTime, firestoreDB, appdatabase, uid, user]);

  useEffect(() => {
    return () => { if (waitTimerRef.current) clearTimeout(waitTimerRef.current); };
  }, []);

  const getTimeColor = (ms) => {
    if (ms >= 999) return '#EF4444';
    if (ms <= 200) return '#F59E0B';
    if (ms <= 300) return '#10B981';
    if (ms <= 450) return '#3B82F6';
    return '#8B5CF6';
  };

  const renderDots = () => (
    <View style={styles.dotsRow}>
      {Array.from({ length: TOTAL_ROUNDS }).map((_, i) => {
        let bg = isDarkMode ? '#334155' : '#e2e8f0';
        if (i < roundTimes.length) bg = roundTimes[i] >= 999 ? '#EF4444' : '#10B981';
        else if (i === currentRound) bg = '#F59E0B';
        return <View key={i} style={[styles.dot, { backgroundColor: bg }]} />;
      })}
    </View>
  );

  const validTimes = roundTimes.filter(t => t < 999);
  const avgTime = validTimes.length > 0 ? Math.round(validTimes.reduce((a, b) => a + b, 0) / validTimes.length) : 999;
  const bestRound = validTimes.length > 0 ? Math.min(...validTimes) : 999;
  const rank = getRank(avgTime);
  const earlyCount = roundTimes.filter(t => t >= 999).length;

  const innerContent = (
    <>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => { if (waitTimerRef.current) clearTimeout(waitTimerRef.current); onClose(); }} style={styles.backBtn}>
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
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Tap too soon and you get a penalty for that round.</Text>
              </View>
            </View>
          </View>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#F0FDF4' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>🏆</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>3 Rounds!</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Best average time wins. Under 200ms = LIGHTNING! ⚡</Text>
              </View>
            </View>
          </View>

          {bestTime > 0 && bestTime < 999 && (
            <Text style={[styles.bestScoreLabel, { color: '#F59E0B' }]}>
              ⚡ Best Time: {bestTime}ms
            </Text>
          )}

          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#DC2626', marginTop: 16 }]} onPress={startGame}>
            <Icon name="play" size={22} color="#fff" />
            <Text style={styles.actionBtnText}>LET'S GO! 🎮</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {phase === 'waiting' && (
        <TouchableOpacity style={[styles.fullZone, { backgroundColor: '#7F1D1D' }]} onPress={handleTap} activeOpacity={1}>
          {renderDots()}
          <Text style={styles.waitTitle}>WAIT...</Text>
          <Text style={styles.waitSub}>Don't tap yet! 🤫</Text>
          <View style={styles.waitPulse}><Text style={{ fontSize: 56 }}>🎯</Text></View>
          <Text style={styles.roundInfo}>Round {currentRound + 1}/{TOTAL_ROUNDS}</Text>
        </TouchableOpacity>
      )}

      {phase === 'draw' && (
        <Animated.View style={{ flex: 1, opacity: flashAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }}>
          <TouchableOpacity style={[styles.fullZone, { backgroundColor: '#15803D' }]} onPress={handleTap} activeOpacity={1}>
            {renderDots()}
            <Animated.Text style={[styles.drawTitle, { transform: [{ scale: scaleAnim }] }]}>SLASH! 🗡️</Animated.Text>
            <Text style={styles.drawSub}>TAP NOW!</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {phase === 'early' && (
        <View style={[styles.fullZone, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff' }]}>
          {renderDots()}
          <Text style={{ fontSize: 64 }}>🚫</Text>
          <Text style={styles.earlyTitle}>TOO EARLY!</Text>
          <Text style={styles.earlySub}>You slashed before the signal! 😤</Text>
          <Text style={styles.penaltyText}>+999ms penalty</Text>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#F59E0B', marginTop: 32 }]} onPress={nextRound}>
            <Text style={styles.actionBtnText}>{currentRound + 1 >= TOTAL_ROUNDS ? 'See Results 🏆' : 'Next Round →'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'roundResult' && (
        <View style={[styles.fullZone, { backgroundColor: isDarkMode ? config.colors.backgroundDark : '#f0fdf4' }]}>
          {renderDots()}
          <Text style={{ fontSize: 64 }}>{currentTime <= 200 ? '⚡' : currentTime <= 300 ? '🎯' : currentTime <= 450 ? '🗡️' : '🍊'}</Text>
          <Animated.Text style={[styles.timeDisplay, { color: getTimeColor(currentTime), transform: [{ scale: countAnim }] }]}>
            {currentTime}ms
          </Animated.Text>
          <Text style={[styles.timeLabel, { color: getTimeColor(currentTime) }]}>
            {currentTime <= 200 ? 'INCREDIBLE! ⚡' : currentTime <= 300 ? 'Super fast! 🎯' : currentTime <= 450 ? 'Nice reflexes! 🗡️' : currentTime <= 600 ? 'Not bad! 🍊' : 'A bit slow... 🐢'}
          </Text>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#10B981', marginTop: 32 }]} onPress={nextRound}>
            <Text style={styles.actionBtnText}>{currentRound + 1 >= TOTAL_ROUNDS ? 'See Results 🏆' : `Next Round →`}</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'gameResult' && (
        <ScrollView contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 80 }}>{rank.emoji}</Text>
          <Text style={[styles.bigTitle, { color: rank.color }]}>{rank.label}</Text>

          <View style={[styles.statsCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0' }]}>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Average</Text>
              <Text style={[styles.statVal, { color: getTimeColor(avgTime) }]}>{avgTime}ms</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Best Round</Text>
              <Text style={[styles.statVal, { color: getTimeColor(bestRound) }]}>{bestRound < 999 ? `${bestRound}ms` : '—'}</Text>
            </View>
            <View style={[styles.statRow, { borderBottomWidth: 0 }]}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Early Slashes</Text>
              <Text style={[styles.statVal, { color: earlyCount > 0 ? '#EF4444' : '#10B981' }]}>{earlyCount}</Text>
            </View>
          </View>

          <View style={styles.roundTimesRow}>
            {roundTimes.map((t, i) => (
              <View key={i} style={[styles.roundChip, { backgroundColor: t >= 999 ? '#EF4444' : getTimeColor(t) }]}>
                <Text style={styles.roundChipText}>{t >= 999 ? 'EARLY' : `${t}ms`}</Text>
              </View>
            ))}
          </View>

          {bestTime > 0 && bestTime < 999 && (
            <Text style={[styles.bestScoreLabel, { color: '#F59E0B', marginTop: 16 }]}>
              {bestRound <= bestTime ? '🎉 New Best Time!' : `⚡ All-time Best: ${bestTime}ms`}
            </Text>
          )}

          {roundInfo?.maxedOut ? (
            <Text style={{ color: '#94a3b8', fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>
              Come back tomorrow for more rounds!
            </Text>
          ) : roundInfo?.needsUnlock ? (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#F59E0B', marginTop: 24, width: '100%', justifyContent: 'center' }]} onPress={onWatchAd}>
              <Icon name="play-circle" size={22} color="#fff" />
              <Text style={styles.actionBtnText}>Unlock 3 More Rounds — Watch Ad</Text>
            </TouchableOpacity>
          ) : roundInfo?.roundsLeft > 0 ? (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#DC2626', marginTop: 24, width: '100%', justifyContent: 'center' }]} onPress={startGame}>
              <Icon name="refresh" size={22} color="#fff" />
              <Text style={styles.actionBtnText}>Play Again ({roundInfo.roundsLeft} left)</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#64748b', marginTop: 10, width: '100%', justifyContent: 'center' }]} onPress={onClose}>
            <Text style={styles.actionBtnText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </>
  );

  return (
    <View style={[styles.screen, { backgroundColor: isDarkMode ? config.colors.backgroundDark : '#f8fafc' }]}>
      {innerContent}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 8, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '800', flex: 1, textAlign: 'center' },
  backBtn: { padding: 8, width: 40 },

  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20, paddingHorizontal: 16 },
  rulesContent: { paddingVertical: 10, paddingHorizontal: 20 },
  bigTitle: { fontSize: 28, fontWeight: '900', marginTop: 8 },
  subText: { fontSize: 14, marginTop: 4 },

  ruleCard: { borderRadius: 16, padding: 16, marginBottom: 10 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ruleEmoji: { fontSize: 36 },
  ruleTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  ruleDesc: { fontSize: 13, lineHeight: 18 },

  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: 32, borderRadius: 100, alignSelf: 'center' },
  actionBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },

  bestScoreLabel: { fontSize: 16, fontWeight: '800', textAlign: 'center', marginTop: 10 },

  fullZone: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 24, margin: 12, paddingHorizontal: 20 },

  waitTitle: { fontSize: 48, fontWeight: '900', color: '#FCA5A5', letterSpacing: 4, marginBottom: 12 },
  waitSub: { fontSize: 20, color: '#FCA5A5', fontWeight: '800', opacity: 0.8 },
  waitPulse: { marginTop: 32, opacity: 0.8 },
  roundInfo: { fontSize: 16, color: '#FCA5A5', fontWeight: '800', marginTop: 32, opacity: 0.6 },

  drawTitle: { fontSize: 56, fontWeight: '900', color: '#fff', letterSpacing: 6 },
  drawSub: { fontSize: 28, color: '#BBF7D0', fontWeight: '900', marginTop: 12 },

  earlyTitle: { fontSize: 36, fontWeight: '900', color: '#EF4444', marginTop: 16 },
  earlySub: { fontSize: 18, color: '#94a3b8', fontWeight: '700', marginTop: 8 },
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
