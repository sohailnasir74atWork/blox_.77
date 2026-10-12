/**
 * SafeCracker.js — "Crack the Chest"
 * Stop the spinning dial on the right number to unlock treasure chests!
 * Blox Fruit themed — Polished, Kid-Friendly, Consistent UI
 *
 * The dial's Animated value is in ROTATIONS and is never reset: each spin
 * continues from where the last one stopped, so the angle used to judge a
 * stop is always the angle the player actually sees. (It used to snap back
 * to 0° on every lock while the hit test kept the old angle, so locks 2 and
 * 3 were judged against a dial position nobody could see.)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { loadGameStats, saveGameStats, submitLeaderboardScore } from './gameScores';
import GameRoundActions from './GameRoundActions';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DIAL_SIZE = Math.min(SCREEN_WIDTH - 80, 280);
const NUM_SEGMENTS = 8;
const SEGMENT_ANGLE = 360 / NUM_SEGMENTS;
const LOCKS_PER_SAFE = 3;
const BASE_SPIN_DURATION = 2400;
const MIN_SPIN_DURATION = 800;
const LOCK_POINTS = 50;
const CHEST_BONUS = 100;
const ACCENT = '#F59E0B';
const GOLD = '#F59E0B';

// No amber/orange here — gold is reserved for the target number.
const SEGMENT_COLORS = [
  '#EF4444', '#0EA5E9', '#10B981', '#3B82F6',
  '#8B5CF6', '#EC4899', '#14B8A6', '#6366F1',
];

// Like a real combination lock, the direction alternates every lock.
const lockDirection = (lock) => (lock % 2 === 0 ? 1 : -1);

const SafeCracker = ({ onClose, roundInfo, onRoundStart, onWatchAd, adLoading }) => {
  const insets = useSafeAreaInsets();
  const { firestoreDB, appdatabase, user, theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  const uid = user?.id;
  const { t } = useTranslation();

  const [phase, setPhase] = useState('loading'); // loading | rules | spinning | checking | failed | cracked | gameover
  const [bestScore, setBestScore] = useState(0);
  const [score, setScore] = useState(0);
  const [safesOpened, setSafesOpened] = useState(0);
  const [currentLock, setCurrentLock] = useState(0);
  const [targetNum, setTargetNum] = useState(1);
  const [lockResults, setLockResults] = useState([null, null, null]);
  const [stoppedSegment, setStoppedSegment] = useState(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [prevBest, setPrevBest] = useState(0);

  const spinAnim = useRef(new Animated.Value(0)).current;   // in rotations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const spinRef = useRef(null);
  const pulseRef = useRef(null);
  const spinningRef = useRef(false);
  const rotationRef = useRef(0);       // dial position (rotations) where the last spin stopped
  const scoreRef = useRef(0);
  const safesOpenedRef = useRef(0);
  const currentLockRef = useRef(0);
  const targetRef = useRef(1);
  const bestScoreRef = useRef(0);
  const statsLoadedRef = useRef(false);
  const timersRef = useRef([]);
  const mountedRef = useRef(true);

  const c = getThemeColors(isDarkMode);
  const surface = isDarkMode ? config.colors.surfaceDark : '#fff';
  const border = isDarkMode ? '#334155' : '#e2e8f0';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = uid ? await loadGameStats(firestoreDB, uid) : null;
      if (cancelled) return;
      statsLoadedRef.current = !!data;
      bestScoreRef.current = data?.safeCrackBestScore || 0;
      setBestScore(bestScoreRef.current);
      setPhase('rules');
    })();
    return () => { cancelled = true; };
  }, [firestoreDB, uid]);

  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timersRef.current = timersRef.current.filter(x => x !== t);
      if (mountedRef.current) fn();
    }, ms);
    timersRef.current.push(t);
  };

  const stopMotion = useCallback(() => {
    spinningRef.current = false;
    if (spinRef.current) spinRef.current.stop();
    if (pulseRef.current) pulseRef.current.stop();
    pulseAnim.setValue(1);
  }, [pulseAnim]);

  // ── Stop the dial + pending timers on unmount (hardware back mid-spin) ──
  useEffect(() => () => {
    mountedRef.current = false;
    stopMotion();
    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current = [];
  }, [stopMotion]);

  const endGame = () => {
    stopMotion();
    setPhase('gameover');
    if (Platform.OS === 'android') Vibration.vibrate([0, 100, 50, 100, 50, 100]);

    const finalScore = scoreRef.current;
    const oldBest = bestScoreRef.current;
    const improved = finalScore > oldBest;
    setPrevBest(oldBest);
    setIsNewBest(improved && finalScore > 0);
    if (improved) {
      bestScoreRef.current = finalScore;
      setBestScore(finalScore);
    }

    if (!statsLoadedRef.current) return;
    saveGameStats(firestoreDB, uid, {
      lastSafeCrackAt: new Date(),
      lastSafeCrackScore: finalScore,
      safeCrackBestScore: Math.max(finalScore, oldBest),
    });
    if (improved && finalScore > 0) {
      submitLeaderboardScore({ firestoreDB, appdatabase, uid, user, gameKey: 'safe', score: finalScore });
    }
  };

  const startSpin = () => {
    // New target, never the same number twice in a row.
    let target = targetRef.current;
    while (target === targetRef.current) target = Math.floor(Math.random() * NUM_SEGMENTS) + 1;
    targetRef.current = target;
    setTargetNum(target);
    setStoppedSegment(null);
    setPhase('spinning');
    spinningRef.current = true;

    const dir = lockDirection(currentLockRef.current);
    const duration = Math.max(MIN_SPIN_DURATION, BASE_SPIN_DURATION - safesOpenedRef.current * 200);
    const run = (from) => {
      if (!spinningRef.current) return;
      const base = ((from % 1) + 1) % 1; // same visual angle, kept in [0, 1)
      spinAnim.setValue(base);
      spinRef.current = Animated.timing(spinAnim, {
        toValue: base + dir, duration, easing: Easing.linear, useNativeDriver: true,
      });
      spinRef.current.start(({ finished }) => {
        if (finished && spinningRef.current) run(base + dir);
      });
    };
    run(rotationRef.current);
    triggerHapticFeedback('impactLight');

    pulseRef.current = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.15, duration: 500, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]));
    pulseRef.current.start();
  };

  const handleStop = () => {
    if (!spinningRef.current) return;
    stopMotion();

    spinAnim.stopAnimation((value) => {
      if (!mountedRef.current) return;
      rotationRef.current = value;
      const currentAngle = (((value * 360) % 360) + 360) % 360;
      const adjustedAngle = (360 - currentAngle + SEGMENT_ANGLE / 2) % 360;
      const segmentIndex = Math.floor(adjustedAngle / SEGMENT_ANGLE);
      const hitNum = (segmentIndex % NUM_SEGMENTS) + 1;
      const lock = currentLockRef.current;

      setStoppedSegment(hitNum);

      if (hitNum === targetRef.current) {
        triggerHapticFeedback('notificationSuccess');
        if (Platform.OS === 'android') Vibration.vibrate([0, 50, 30, 50]);

        setLockResults(prev => { const n = [...prev]; n[lock] = 'success'; return n; });
        scoreRef.current += LOCK_POINTS;

        if (lock + 1 >= LOCKS_PER_SAFE) {
          scoreRef.current += CHEST_BONUS;
          safesOpenedRef.current += 1;
          setSafesOpened(safesOpenedRef.current);
          setScore(scoreRef.current);
          setPhase('cracked');
          later(() => triggerHapticFeedback('impactHeavy'), 200);
        } else {
          setScore(scoreRef.current);
          setPhase('checking');
          later(() => {
            currentLockRef.current = lock + 1;
            setCurrentLock(lock + 1);
            startSpin();
          }, 900);
        }
      } else {
        triggerHapticFeedback('notificationError');
        setLockResults(prev => { const n = [...prev]; n[lock] = 'fail'; return n; });
        setPhase('failed');

        Animated.sequence([
          Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
        ]).start();

        later(endGame, 1600);
      }
    });
  };

  const startNewSafe = () => {
    currentLockRef.current = 0;
    setCurrentLock(0);
    setLockResults([null, null, null]);
    setStoppedSegment(null);
    startSpin();
  };

  const startGame = () => {
    onRoundStart?.();
    scoreRef.current = 0;
    safesOpenedRef.current = 0;
    currentLockRef.current = 0;
    setScore(0);
    setSafesOpened(0);
    setCurrentLock(0);
    setLockResults([null, null, null]);
    setStoppedSegment(null);
    setIsNewBest(false);
    triggerHapticFeedback('impactHeavy');
    startSpin();
  };

  const spinInterpolate = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  // Counter-rotation keeps every number upright while the dial turns.
  const counterSpin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });

  const renderSegments = () => {
    return Array.from({ length: NUM_SEGMENTS }).map((_, i) => {
      const num = i + 1;
      const angle = i * SEGMENT_ANGLE;
      const rad = (angle - 90) * (Math.PI / 180);
      const radius = DIAL_SIZE / 2 - 32;
      const x = Math.cos(rad) * radius;
      const y = Math.sin(rad) * radius;
      const isTarget = num === targetNum && (phase === 'spinning' || phase === 'checking' || phase === 'failed');
      const isHit = num === stoppedSegment;
      const bg = isHit ? (num === targetNum ? '#10B981' : '#EF4444') : (isTarget ? GOLD : SEGMENT_COLORS[i]);

      return (
        <Animated.View
          key={i}
          style={[styles.segmentNum, {
            transform: [{ translateX: x }, { translateY: y }, { rotate: counterSpin }, { scale: isTarget && phase === 'spinning' ? pulseAnim : 1 }],
            backgroundColor: bg,
            borderWidth: isTarget ? 3 : 0,
            borderColor: '#fff',
            shadowColor: isTarget ? GOLD : 'transparent',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: isTarget ? 0.8 : 0,
            shadowRadius: isTarget ? 12 : 0,
            elevation: isTarget ? 8 : 2,
          }]}
        >
          <Text style={[styles.segmentText, { fontSize: isTarget ? 20 : 16 }]}>{num}</Text>
        </Animated.View>
      );
    });
  };

  const renderLocks = () => (
    <View style={styles.locksRow}>
      {Array.from({ length: LOCKS_PER_SAFE }).map((_, i) => (
        <View key={i} style={[styles.lockIcon, {
          backgroundColor: lockResults[i] === 'success' ? '#10B981' : lockResults[i] === 'fail' ? '#EF4444' : i === currentLock ? GOLD : (isDarkMode ? '#334155' : '#e2e8f0'),
        }]}>
          <Text style={{ fontSize: 18 }}>{lockResults[i] === 'success' ? '🔓' : lockResults[i] === 'fail' ? '💥' : '🔒'}</Text>
        </View>
      ))}
    </View>
  );

  const inDialPhase = phase === 'spinning' || phase === 'checking' || phase === 'failed';
  const dirLabel = lockDirection(currentLock) === 1 ? t('engagement.safe_cracker.dir_cw') : t('engagement.safe_cracker.dir_ccw');

  return (
    <View style={[styles.screen, { backgroundColor: isDarkMode ? config.colors.backgroundDark : '#f8fafc', paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={onClose} style={styles.backBtn} hitSlop={8}>
          <Icon name="chevron-back" size={24} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.text }]}>🔐 {t('engagement.game_hub.safe_name')}</Text>
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
          <Text style={[styles.bigTitle, { color: c.text, textAlign: 'center' }]}>{t('engagement.game_hub.safe_name')}</Text>
          <Text style={[styles.subText, { color: c.textSecondary, textAlign: 'center', marginBottom: 20 }]}>
            {t('engagement.safe_cracker.tagline')}
          </Text>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEF3C7' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>🎯</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>{t('engagement.safe_cracker.rule1_title')}</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>{t('engagement.safe_cracker.rule1_desc')}</Text>
              </View>
            </View>
          </View>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#DBEAFE' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>🔒</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>{t('engagement.safe_cracker.rule2_title')}</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>{t('engagement.safe_cracker.rule2_desc')}</Text>
              </View>
            </View>
          </View>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEE2E2' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>💥</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>{t('engagement.safe_cracker.rule3_title')}</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>{t('engagement.safe_cracker.rule3_desc')}</Text>
              </View>
            </View>
          </View>

          {bestScore > 0 && (
            <Text style={[styles.bestScoreLabel, { color: ACCENT }]}>
              {t('engagement.games.high_score', { score: bestScore })}
            </Text>
          )}

          <GameRoundActions
            roundInfo={roundInfo}
            onPlay={startGame}
            onWatchAd={onWatchAd}
            adLoading={adLoading}
            color={ACCENT}
            playLabel={t('engagement.games.lets_go')}
            playIcon="play"
            textColor={c.textSecondary}
            style={{ marginTop: 16 }}
          />
        </ScrollView>
      )}

      {inDialPhase && (
        <View style={{ flex: 1, alignItems: 'center' }}>
          <View style={[styles.hud, { backgroundColor: surface, borderColor: border }]}>
            <View style={styles.hudItem}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>{t('engagement.games.score')}</Text>
              <Text style={[styles.hudVal, { color: ACCENT }]}>{score}</Text>
            </View>
            <View style={styles.hudItem}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>{t('engagement.safe_cracker.chest')}</Text>
              <Text style={[styles.hudVal, { color: c.text }]}>#{safesOpened + 1}</Text>
            </View>
            <View style={[styles.hudItem, { alignItems: 'flex-end' }]}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>{t('engagement.safe_cracker.speed')}</Text>
              <Text style={[styles.hudVal, { color: safesOpened >= 3 ? '#EF4444' : '#10B981' }]}>{t('engagement.xp_bar.lv_short', { level: safesOpened + 1 })}</Text>
            </View>
          </View>

          {renderLocks()}

          <View style={[styles.targetBox, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEF3C7', borderColor: GOLD }]}>
            <Text style={{ fontSize: 14, color: c.textSecondary, fontWeight: '800', textTransform: 'uppercase' }}>
              {t('engagement.safe_cracker.stop_at')}{' '}<Text style={{ fontSize: 24, fontWeight: '900', color: GOLD }}>{targetNum}</Text>
            </Text>
          </View>
          <Text style={[styles.lockHint, { color: c.textSecondary }]}>
            {t('engagement.safe_cracker.lock_progress', { current: currentLock + 1, total: LOCKS_PER_SAFE, dir: dirLabel })}
          </Text>

          <Animated.View style={[styles.dialContainer, { transform: [{ translateX: shakeAnim }] }]}>
            <View style={styles.pointer}><Text style={styles.pointerText}>▼</Text></View>
            <Animated.View style={[styles.dial, {
              backgroundColor: surface, borderColor: isDarkMode ? '#334155' : '#d1d5db', transform: [{ rotate: spinInterpolate }],
            }]}>
              <Animated.View style={[styles.dialCenter, { backgroundColor: isDarkMode ? config.colors.backgroundDark : '#f1f5f9', transform: [{ rotate: counterSpin }] }]}>
                <Text style={{ fontSize: 24 }}>🔐</Text>
              </Animated.View>
              {renderSegments()}
            </Animated.View>
          </Animated.View>

          {phase === 'spinning' && (
            // onPressIn: the stop lands on touch-down. onPress waited for the
            // finger to lift, which at top speed is most of a segment late.
            <Pressable
              style={({ pressed }) => [styles.stopBtn, pressed && { transform: [{ scale: 0.96 }] }]}
              onPressIn={handleStop}
            >
              <Text style={styles.stopBtnText}>{t('engagement.safe_cracker.stop')}</Text>
            </Pressable>
          )}

          {phase === 'checking' && (
            <Text style={[styles.bigTitle, { color: '#10B981', marginTop: 16 }]}>{t('engagement.safe_cracker.locked_in')}</Text>
          )}

          {phase === 'failed' && (
            <View style={{ alignItems: 'center', marginTop: 12 }}>
              <Text style={[styles.bigTitle, { color: '#EF4444', marginTop: 0 }]}>{t('engagement.safe_cracker.jammed')}</Text>
              <Text style={[styles.subText, { color: c.textSecondary }]}>
                {t('engagement.safe_cracker.landed_on', { landed: stoppedSegment, target: targetNum })}
              </Text>
            </View>
          )}
        </View>
      )}

      {phase === 'cracked' && (
        <View style={styles.centerContent}>
          <Text style={{ fontSize: 80 }}>💰</Text>
          <Text style={[styles.bigTitle, { color: '#10B981' }]}>{t('engagement.safe_cracker.chest_open', { n: safesOpened })}</Text>
          <Text style={[styles.subText, { color: c.textSecondary, fontSize: 16 }]}>{t('engagement.safe_cracker.points_gain', { points: LOCK_POINTS + CHEST_BONUS })}</Text>
          <Text style={[styles.hudVal, { color: ACCENT, marginTop: 12 }]}>{t('engagement.safe_cracker.total_pts', { score })}</Text>
          <Text style={[styles.subText, { color: '#EF4444', fontWeight: '800', marginTop: 12 }]}>{t('engagement.safe_cracker.next_faster')}</Text>

          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: ACCENT, marginTop: 28 }]} onPress={startNewSafe}>
            <Icon name="lock-closed-outline" size={22} color="#fff" />
            <Text style={styles.actionBtnText}>{t('engagement.safe_cracker.next_chest')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {phase === 'gameover' && (
        <ScrollView contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 80 }}>{isNewBest ? '🏆' : safesOpened >= 3 ? '💰' : safesOpened >= 1 ? '🔓' : '💥'}</Text>
          <Text style={[styles.bigTitle, { color: ACCENT, textAlign: 'center' }]}>
            {safesOpened >= 5 ? t('engagement.safe_cracker.result_master') : safesOpened >= 3 ? t('engagement.safe_cracker.result_hunter') : safesOpened >= 1 ? t('engagement.safe_cracker.result_nice_try') : t('engagement.safe_cracker.result_jammed')}
          </Text>

          <View style={[styles.statsCard, { backgroundColor: surface, borderColor: border }]}>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>{t('engagement.games.score')}</Text>
              <Text style={[styles.statVal, { color: ACCENT }]}>{score}</Text>
            </View>
            <View style={[styles.statRow, { borderBottomWidth: 0 }]}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>{t('engagement.safe_cracker.cracked')}</Text>
              <Text style={[styles.statVal, { color: c.text }]}>{t('engagement.safe_cracker.chests_count', { count: safesOpened })}</Text>
            </View>
          </View>

          {isNewBest ? (
            <Text style={[styles.bestScoreLabel, { color: ACCENT, marginTop: 16 }]}>
              {t('engagement.games.new_high_score_banner')}{prevBest > 0 ? `\n${t('engagement.games.previous_best', { score: prevBest })}` : ''}
            </Text>
          ) : bestScore > 0 ? (
            <Text style={[styles.bestScoreLabel, { color: ACCENT, marginTop: 16 }]}>{t('engagement.games.best_score', { score: bestScore })}</Text>
          ) : null}

          <GameRoundActions
            roundInfo={roundInfo}
            onPlay={startGame}
            onWatchAd={onWatchAd}
            adLoading={adLoading}
            color={ACCENT}
            playLabel={t('engagement.games.play_again')}
            textColor={c.textSecondary}
          />
          <TouchableOpacity style={[styles.actionBtn, styles.doneBtn]} onPress={onClose}>
            <Text style={styles.actionBtnText}>{t('engagement.games.done')}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, paddingTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '800', flex: 1, textAlign: 'center' },
  backBtn: { padding: 8, width: 40 },

  centerContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20, paddingHorizontal: 16 },
  rulesContent: { paddingVertical: 10, paddingHorizontal: 12 },
  bigTitle: { fontSize: 28, fontWeight: '900', marginTop: 8, textAlign: 'center' },
  subText: { fontSize: 14, marginTop: 4, textAlign: 'center' },

  ruleCard: { borderRadius: 16, padding: 16, marginBottom: 10 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ruleEmoji: { fontSize: 36 },
  ruleTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  ruleDesc: { fontSize: 13, lineHeight: 18 },

  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: 32, borderRadius: 100, alignSelf: 'center' },
  actionBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  doneBtn: { backgroundColor: '#64748b', marginTop: 10, width: '100%', justifyContent: 'center' },

  bestScoreLabel: { fontSize: 16, fontWeight: '800', textAlign: 'center', marginTop: 10, lineHeight: 24 },

  hud: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  hudItem: { alignItems: 'flex-start' },
  hudLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  hudVal: { fontSize: 24, fontWeight: '900' },

  locksRow: { flexDirection: 'row', gap: 16, alignItems: 'center', marginBottom: 16 },
  lockIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },

  targetBox: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 100, borderWidth: 2 },
  lockHint: { fontSize: 12, fontWeight: '700', marginTop: 6, marginBottom: 10 },

  dialContainer: { alignItems: 'center', justifyContent: 'center', width: DIAL_SIZE + 20, height: DIAL_SIZE + 40 },
  pointer: { position: 'absolute', top: 0, zIndex: 10, alignItems: 'center' },
  pointerText: { fontSize: 22, color: GOLD, fontWeight: '900' },
  dial: { width: DIAL_SIZE, height: DIAL_SIZE, borderRadius: DIAL_SIZE / 2, borderWidth: 3, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  dialCenter: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', position: 'absolute' },
  segmentNum: { position: 'absolute', width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontWeight: '900', color: '#fff' },

  stopBtn: { backgroundColor: '#EF4444', paddingVertical: 18, paddingHorizontal: 48, borderRadius: 100, marginTop: 16, shadowColor: '#EF4444', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 6 },
  stopBtnText: { color: '#fff', fontSize: 22, fontWeight: '900' },

  statsCard: { width: '100%', borderRadius: 20, borderWidth: 1, padding: 20, marginTop: 24 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(128,128,128,0.1)' },
  statLabel: { fontSize: 16, fontWeight: '600' },
  statVal: { fontSize: 24, fontWeight: '900' },
});

export default SafeCracker;
