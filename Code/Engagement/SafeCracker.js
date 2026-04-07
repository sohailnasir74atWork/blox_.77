/**
 * SafeCracker.js — "Crack the Chest"
 * Stop the spinning dial on the right number to unlock treasure chests!
 * Blox Fruit themed — Polished, Kid-Friendly, Consistent UI
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DIAL_SIZE = Math.min(SCREEN_WIDTH - 80, 280);
const NUM_SEGMENTS = 8;
const SEGMENT_ANGLE = 360 / NUM_SEGMENTS;
const LOCKS_PER_SAFE = 3;
const BASE_SPIN_DURATION = 2400;
const MIN_SPIN_DURATION = 800;

const SEGMENT_COLORS = [
  '#EF4444', '#F59E0B', '#10B981', '#3B82F6',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
];

const SafeCracker = ({ onClose, roundInfo, onRoundComplete, onWatchAd }) => {
  const visible = true;
  const insets = useSafeAreaInsets();
  const { firestoreDB, appdatabase, user, theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  const uid = user?.id;

  const [phase, setPhase] = useState('loading');
  const [bestScore, setBestScore] = useState(0);
  const [score, setScore] = useState(0);
  const [safesOpened, setSafesOpened] = useState(0);
  const [currentLock, setCurrentLock] = useState(0);
  const [targetNum, setTargetNum] = useState(1);
  const [lockResults, setLockResults] = useState([null, null, null]);
  const [stoppedSegment, setStoppedSegment] = useState(null);

  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const spinRef = useRef(null);
  const spinningRef = useRef(false);
  const angleRef = useRef(0);

  const c = getThemeColors(isDarkMode);

  useEffect(() => {
    if (!visible || !firestoreDB || !uid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(firestoreDB, 'games', uid));
        const data = snap.exists ? snap.data() : {};
        setBestScore(data.safeCrackBestScore || 0);
        setPhase('rules');
      } catch {
        setPhase('rules');
      }
    })();
  }, [visible, firestoreDB, uid]);

  useEffect(() => {
    if (!visible) {
      spinningRef.current = false;
      if (spinRef.current) spinRef.current.stop();
    }
  }, [visible]);

  const getSpinDuration = useCallback(() => {
    return Math.max(MIN_SPIN_DURATION, BASE_SPIN_DURATION - safesOpened * 200);
  }, [safesOpened]);

  const pickTarget = useCallback(() => {
    return Math.floor(Math.random() * NUM_SEGMENTS) + 1;
  }, []);

  const endGame = useCallback(async () => {
    setPhase('gameover');
    if (onRoundComplete) onRoundComplete();
    if (Platform.OS === 'android') Vibration.vibrate([0, 100, 50, 100, 50, 100]);

    const finalScore = score;
    try {
      const newBest = Math.max(finalScore, bestScore);
      setBestScore(newBest);
      await setDoc(doc(firestoreDB, 'games', uid), {
        lastSafeCrackAt: new Date(),
        lastSafeCrackScore: finalScore,
        safeCrackBestScore: newBest,
      }, { merge: true });

      if (newBest > 0) {
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
        await setDoc(doc(firestoreDB, 'game_scores', 'safe', 'scores', uid), {
          score: newBest,
          username,
          avatar,
          updatedAt: new Date(),
        }, { merge: true });

        await updateLeaderboardCacheRealtime(firestoreDB, 'safe', uid, newBest, username, avatar);
      }
    } catch (err) {
      console.warn('[CrackChest] save error:', err?.message);
    }
  }, [score, bestScore, firestoreDB, appdatabase, uid, user]);

  const startSpin = useCallback(() => {
    const target = pickTarget();
    setTargetNum(target);
    setStoppedSegment(null);
    setPhase('spinning');
    spinningRef.current = true;

    const duration = getSpinDuration();
    const doSpin = () => {
      if (!spinningRef.current) return;
      spinAnim.setValue(0);
      spinRef.current = Animated.timing(spinAnim, {
        toValue: 1, duration: duration, easing: Easing.linear, useNativeDriver: true,
      });
      spinRef.current.start(({ finished }) => {
        if (finished && spinningRef.current) {
          angleRef.current = (angleRef.current + 360) % 360;
          doSpin();
        }
      });
    };
    doSpin();
    triggerHapticFeedback('impactLight');

    const doPulse = () => {
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]).start(() => { if (spinningRef.current) doPulse(); });
    };
    doPulse();
  }, [pickTarget, getSpinDuration, triggerHapticFeedback, spinAnim, pulseAnim]);

  const handleStop = useCallback(() => {
    if (!spinningRef.current) return;
    spinningRef.current = false;
    if (spinRef.current) spinRef.current.stop();

    spinAnim.stopAnimation((value) => {
      const currentAngle = (angleRef.current + value * 360) % 360;
      const adjustedAngle = (360 - currentAngle + SEGMENT_ANGLE / 2) % 360;
      const segmentIndex = Math.floor(adjustedAngle / SEGMENT_ANGLE);
      const hitNum = (segmentIndex % NUM_SEGMENTS) + 1;

      setStoppedSegment(hitNum);
      angleRef.current = currentAngle;

      if (hitNum === targetNum) {
        triggerHapticFeedback('notificationSuccess');
        if (Platform.OS === 'android') Vibration.vibrate([0, 50, 30, 50]);

        const newResults = [...lockResults];
        newResults[currentLock] = 'success';
        setLockResults(newResults);
        setScore(prev => prev + 50);

        if (currentLock + 1 >= LOCKS_PER_SAFE) {
          setPhase('cracked');
          setSafesOpened(prev => prev + 1);
          setScore(prev => prev + 100);
          triggerHapticFeedback('notificationSuccess');
          setTimeout(() => triggerHapticFeedback('impactHeavy'), 200);
        } else {
          setPhase('checking');
          setTimeout(() => {
            setCurrentLock(prev => prev + 1);
            startSpin();
          }, 1200);
        }
      } else {
        triggerHapticFeedback('notificationError');
        const newResults = [...lockResults];
        newResults[currentLock] = 'fail';
        setLockResults(newResults);

        Animated.sequence([
          Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
        ]).start();

        setTimeout(() => endGame(), 1500);
      }
    });
  }, [targetNum, currentLock, lockResults, startSpin, triggerHapticFeedback, endGame, spinAnim, shakeAnim]);

  const startNewSafe = useCallback(() => {
    setCurrentLock(0);
    setLockResults([null, null, null]);
    setStoppedSegment(null);
    startSpin();
  }, [startSpin]);

  const startGame = useCallback(() => {
    setScore(0);
    setSafesOpened(0);
    setCurrentLock(0);
    setLockResults([null, null, null]);
    setStoppedSegment(null);
    angleRef.current = 0;
    spinAnim.setValue(0);
    triggerHapticFeedback('impactHeavy');
    startSpin();
  }, [startSpin, triggerHapticFeedback, spinAnim]);

  const renderSegments = () => {
    return Array.from({ length: NUM_SEGMENTS }).map((_, i) => {
      const num = i + 1;
      const angle = i * SEGMENT_ANGLE;
      const rad = (angle - 90) * (Math.PI / 180);
      const radius = DIAL_SIZE / 2 - 32;
      const x = Math.cos(rad) * radius;
      const y = Math.sin(rad) * radius;
      const isTarget = num === targetNum && (phase === 'spinning' || phase === 'checking');
      const isHit = num === stoppedSegment;

      return (
        <Animated.View
          key={i}
          style={[styles.segmentNum, {
            transform: [{ translateX: x }, { translateY: y }, { scale: isTarget ? pulseAnim : 1 }],
            backgroundColor: isHit ? (isHit && num === targetNum ? '#10B981' : '#EF4444') : (isTarget ? '#F59E0B' : SEGMENT_COLORS[i]),
            shadowColor: isTarget ? '#F59E0B' : 'transparent',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: isTarget ? 0.8 : 0,
            shadowRadius: isTarget ? 12 : 0,
            elevation: isTarget ? 8 : 2,
          }]}
        >
          <Text style={[styles.segmentText, { fontSize: isTarget ? 20 : 16, color: '#fff' }]}>{num}</Text>
        </Animated.View>
      );
    });
  };

  const renderLocks = () => (
    <View style={styles.locksRow}>
      {Array.from({ length: LOCKS_PER_SAFE }).map((_, i) => (
        <View key={i} style={[styles.lockIcon, {
          backgroundColor: lockResults[i] === 'success' ? '#10B981' : lockResults[i] === 'fail' ? '#EF4444' : i === currentLock ? '#F59E0B' : (isDarkMode ? '#334155' : '#e2e8f0'),
        }]}>
          <Text style={{ fontSize: 18 }}>{lockResults[i] === 'success' ? '🔓' : lockResults[i] === 'fail' ? '💥' : '🔒'}</Text>
        </View>
      ))}
    </View>
  );

  const spinInterpolate = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const innerContent = (
    <>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => { spinningRef.current = false; if (spinRef.current) spinRef.current.stop(); onClose(); }} style={styles.backBtn}>
          <Icon name="chevron-back" size={24} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.text }]}>🔐 Crack the Chest</Text>
        <View style={{ width: 40 }} />
      </View>

      {phase === 'loading' && (
        <View style={styles.centerContent}>
          <Text style={{ fontSize: 48 }}>🔐</Text>
        </View>
      )}

      {phase === 'rules' && (
        <ScrollView contentContainerStyle={styles.rulesContent} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 64, textAlign: 'center' }}>🔐</Text>
          <Text style={[styles.bigTitle, { color: c.text, textAlign: 'center' }]}>Crack the Chest</Text>
          <Text style={[styles.subText, { color: c.textSecondary, textAlign: 'center', marginBottom: 20 }]}>
            Can you unlock the treasure chest? 💰
          </Text>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEF3C7' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>🎯</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>Stop on Gold!</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>The dial spins continuously. Tap STOP when it hits the GOLDEN number!</Text>
              </View>
            </View>
          </View>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#DBEAFE' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>🔒</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>3 Locks per Chest</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Nail it 3 times to crack a chest. Each chest you crack makes the dial spin faster!</Text>
              </View>
            </View>
          </View>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEE2E2' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>💥</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>One Mistake = BOOM</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Stop on the wrong number and the chest jams. Game Over!</Text>
              </View>
            </View>
          </View>

          {bestScore > 0 && (
            <Text style={[styles.bestScoreLabel, { color: '#F59E0B' }]}>
              🏆 High Score: {bestScore}
            </Text>
          )}

          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#F59E0B', marginTop: 16 }]} onPress={startGame}>
            <Icon name="play" size={22} color="#fff" />
            <Text style={styles.actionBtnText}>LET'S GO! 🎮</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {(phase === 'spinning' || phase === 'checking') && (
        <View style={{ flex: 1, alignItems: 'center' }}>
          <View style={[styles.hud, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0' }]}>
            <View style={styles.hudItem}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>Score</Text>
              <Text style={[styles.hudVal, { color: '#F59E0B' }]}>{score}</Text>
            </View>
            <View style={styles.hudItem}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>Chest</Text>
              <Text style={[styles.hudVal, { color: c.text }]}>#{safesOpened + 1}</Text>
            </View>
            <View style={[styles.hudItem, { alignItems: 'flex-end' }]}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>Speed</Text>
              <Text style={[styles.hudVal, { color: safesOpened >= 3 ? '#EF4444' : '#10B981' }]}>Lv.{safesOpened + 1}</Text>
            </View>
          </View>

          {renderLocks()}

          <View style={[styles.targetBox, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEF3C7', borderColor: '#F59E0B' }]}>
            <Text style={{ fontSize: 14, color: c.textSecondary, fontWeight: '800', textTransform: 'uppercase' }}>
              🎯 Stop at: <Text style={{ fontSize: 24, fontWeight: '900', color: '#F59E0B' }}>{targetNum}</Text>
            </Text>
          </View>

          <Animated.View style={[styles.dialContainer, { transform: [{ translateX: shakeAnim }] }]}>
            <View style={styles.pointer}><Text style={{ fontSize: 20 }}>▼</Text></View>
            <Animated.View style={[styles.dial, {
              backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', borderColor: isDarkMode ? '#334155' : '#d1d5db', transform: [{ rotate: spinInterpolate }],
            }]}>
              <View style={[styles.dialCenter, { backgroundColor: isDarkMode ? config.colors.backgroundDark : '#f1f5f9' }]}>
                <Text style={{ fontSize: 24 }}>🔐</Text>
              </View>
              {renderSegments()}
            </Animated.View>
          </Animated.View>

          {phase === 'spinning' && (
            <TouchableOpacity style={styles.stopBtn} onPress={handleStop} activeOpacity={0.7}>
              <Text style={styles.stopBtnText}>🛑 STOP!</Text>
            </TouchableOpacity>
          )}

          {phase === 'checking' && (
            <Text style={[styles.bigTitle, { color: '#10B981', marginTop: 16 }]}>✅ Locked In!</Text>
          )}
        </View>
      )}

      {phase === 'cracked' && (
        <View style={styles.centerContent}>
          <Text style={{ fontSize: 80 }}>💰</Text>
          <Text style={[styles.bigTitle, { color: '#10B981' }]}>Chest #{safesOpened} Open!</Text>
          <Text style={[styles.subText, { color: c.textSecondary, fontSize: 16 }]}>+150 points bonus!</Text>
          <Text style={[styles.hudVal, { color: '#F59E0B', marginTop: 12 }]}>Total: {score} pts</Text>

          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#F59E0B', marginTop: 32 }]} onPress={startNewSafe}>
            <Icon name="lock-closed-outline" size={22} color="#fff" />
            <Text style={styles.actionBtnText}>Next Chest! 🔐</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'gameover' && (
        <ScrollView contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 80 }}>{safesOpened >= 5 ? '🏆' : safesOpened >= 3 ? '💰' : safesOpened >= 1 ? '🔓' : '💥'}</Text>
          <Text style={[styles.bigTitle, { color: '#F59E0B', textAlign: 'center' }]}>
            {safesOpened >= 5 ? 'Master Pirate!' : safesOpened >= 3 ? 'Treasure Hunter!' : safesOpened >= 1 ? 'Nice Try!' : 'Chest Jammed!'}
          </Text>

          <View style={[styles.statsCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0' }]}>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Score</Text>
              <Text style={[styles.statVal, { color: '#F59E0B' }]}>{score}</Text>
            </View>
            <View style={[styles.statRow, { borderBottomWidth: 0 }]}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Cracked</Text>
              <Text style={[styles.statVal, { color: c.text }]}>{safesOpened} {safesOpened === 1 ? 'chest' : 'chests'}</Text>
            </View>
          </View>

          {bestScore > 0 && (
            <Text style={[styles.bestScoreLabel, { color: '#F59E0B', marginTop: 16 }]}>
              {score >= bestScore && score > 0 ? '🎉 NEW HIGH SCORE! 🎉' : `Best Score: ${bestScore}`}
            </Text>
          )}

          {roundInfo?.maxedOut ? (
            <Text style={{ color: '#94a3b8', fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>
              Come back tomorrow for more rounds!
            </Text>
          ) : roundInfo?.needsUnlock ? (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#10B981', marginTop: 24, width: '100%', justifyContent: 'center' }]} onPress={onWatchAd}>
              <Icon name="play-circle" size={22} color="#fff" />
              <Text style={styles.actionBtnText}>Unlock 3 More Rounds — Watch Ad</Text>
            </TouchableOpacity>
          ) : roundInfo?.roundsLeft > 0 ? (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#F59E0B', marginTop: 24, width: '100%', justifyContent: 'center' }]} onPress={startGame}>
              <Icon name="refresh" size={22} color="#fff" />
              <Text style={styles.actionBtnText}>Play Again ({roundInfo.roundsLeft} left)</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#64748b', marginTop: 10, width: '100%', justifyContent: 'center' }]} onPress={() => { spinningRef.current = false; onClose(); }}>
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
  screen: { flex: 1, padding: 16, paddingTop: 8, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '800', flex: 1, textAlign: 'center' },
  backBtn: { padding: 8, width: 40 },

  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20, paddingHorizontal: 16 },
  rulesContent: { paddingVertical: 10, paddingHorizontal: 12 },
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

  hud: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  hudItem: { alignItems: 'flex-start' },
  hudLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  hudVal: { fontSize: 24, fontWeight: '900' },

  locksRow: { flexDirection: 'row', gap: 16, alignItems: 'center', marginBottom: 16 },
  lockIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },

  targetBox: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 100, borderWidth: 2, marginBottom: 20 },

  dialContainer: { alignItems: 'center', justifyContent: 'center', width: DIAL_SIZE + 20, height: DIAL_SIZE + 40 },
  pointer: { position: 'absolute', top: 0, zIndex: 10, alignItems: 'center' },
  dial: { width: DIAL_SIZE, height: DIAL_SIZE, borderRadius: DIAL_SIZE / 2, borderWidth: 3, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  dialCenter: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', position: 'absolute' },
  segmentNum: { position: 'absolute', width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontWeight: '900' },

  stopBtn: { backgroundColor: '#EF4444', paddingVertical: 18, paddingHorizontal: 48, borderRadius: 100, marginTop: 24, shadowColor: '#EF4444', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 6 },
  stopBtnText: { color: '#fff', fontSize: 22, fontWeight: '900' },

  statsCard: { width: '100%', borderRadius: 20, borderWidth: 1, padding: 20, marginTop: 24 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(128,128,128,0.1)' },
  statLabel: { fontSize: 16, fontWeight: '600' },
  statVal: { fontSize: 24, fontWeight: '900' },
});

export default SafeCracker;
