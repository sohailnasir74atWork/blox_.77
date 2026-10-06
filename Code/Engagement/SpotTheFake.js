/**
 * SpotTheFake.js — "Fruit Smash"
 * Tap the rotten fruit! Avoid the fresh ones!
 * Blox Fruit themed — Polished, Kid-Friendly, Consistent UI
 *
 * The game loop runs on timers that read refs, and the timers call the
 * latest spawn/end functions through refs — so nothing in the loop ever
 * sees a stale closure, and unmounting stops it outright.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Animated,
  Dimensions,
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_SIZE = 3;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const CELL_SIZE = Math.min((SCREEN_WIDTH - 80) / GRID_SIZE, 130);
const INITIAL_SPAWN_MS = 1200;
const MIN_SPAWN_MS = 500;
const SPAWN_INTERVAL_MS = 900;
const MIN_INTERVAL_MS = 450;
const SPEED_UP_EVERY = 5;
const START_LIVES = 3;
const FEEDBACK_MS = 450;
const ACCENT = '#B91C1C';

const CHAR_NONE = 0;
const CHAR_ROTTEN = 1;    // Rotten fruit — smash it!
const CHAR_FRESH = 2;     // Fresh fruit — don't tap!
const CHAR_GOLDEN = 3;    // Golden fruit — bonus!

const CHAR_EMOJIS = {
  [CHAR_ROTTEN]: '🍎',
  [CHAR_FRESH]: '🍏',
  [CHAR_GOLDEN]: '⭐',
};

const emptyGrid = () => Array(CELL_COUNT).fill(CHAR_NONE);

// ── Main Component ──
const SpotTheFake = ({ onClose, roundInfo, onRoundStart, onWatchAd, adLoading }) => {
  const insets = useSafeAreaInsets();
  const { firestoreDB, appdatabase, user, theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  const uid = user?.id;

  const [phase, setPhase] = useState('loading'); // loading | rules | playing | paused | gameover
  const [bestScore, setBestScore] = useState(0);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [catches, setCatches] = useState(0);
  const [grid, setGrid] = useState(emptyGrid);
  const [feedback, setFeedback] = useState({}); // { [cellIndex]: { type, points } }
  const [comboCount, setComboCount] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const [prevBest, setPrevBest] = useState(0);

  const spawnTimerRef = useRef(null);
  const despawnTimersRef = useRef({});
  const feedbackTimersRef = useRef({});
  const gridRef = useRef(emptyGrid());
  const livesRef = useRef(START_LIVES);
  const catchesRef = useRef(0);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const bestComboRef = useRef(0);
  const bestScoreRef = useRef(0);
  const statsLoadedRef = useRef(false);
  const gameActiveRef = useRef(false);
  const phaseRef = useRef('loading');
  const spawnRef = useRef(null);
  const endGameRef = useRef(null);
  const scaleAnims = useRef(Array(CELL_COUNT).fill(null).map(() => new Animated.Value(0))).current;

  phaseRef.current = phase;
  const c = getThemeColors(isDarkMode);
  const surface = isDarkMode ? config.colors.surfaceDark : '#fff';
  const border = isDarkMode ? '#334155' : '#e2e8f0';

  // ── Load best score ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = uid ? await loadGameStats(firestoreDB, uid) : null;
      if (cancelled) return;
      statsLoadedRef.current = !!data;
      bestScoreRef.current = data?.whackBestScore || 0;
      setBestScore(bestScoreRef.current);
      setPhase('rules');
    })();
    return () => { cancelled = true; };
  }, [firestoreDB, uid]);

  const clearAllTimers = useCallback(() => {
    if (spawnTimerRef.current) clearTimeout(spawnTimerRef.current);
    spawnTimerRef.current = null;
    Object.values(despawnTimersRef.current).forEach(t => clearTimeout(t));
    despawnTimersRef.current = {};
    Object.values(feedbackTimersRef.current).forEach(t => clearTimeout(t));
    feedbackTimersRef.current = {};
  }, []);

  // ── Stop everything on unmount (hardware back / swipe back mid-game) ──
  useEffect(() => () => {
    gameActiveRef.current = false;
    clearAllTimers();
  }, [clearAllTimers]);

  const setCell = (index, value) => {
    const next = [...gridRef.current];
    next[index] = value;
    gridRef.current = next;
    setGrid(next);
  };

  const showFeedback = (index, data) => {
    if (feedbackTimersRef.current[index]) clearTimeout(feedbackTimersRef.current[index]);
    setFeedback(prev => ({ ...prev, [index]: data }));
    feedbackTimersRef.current[index] = setTimeout(() => {
      delete feedbackTimersRef.current[index];
      setFeedback(prev => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
    }, FEEDBACK_MS);
  };

  const getSpeed = () => {
    const speedLevel = Math.floor(catchesRef.current / SPEED_UP_EVERY);
    return {
      visibleTime: Math.max(MIN_SPAWN_MS, INITIAL_SPAWN_MS - speedLevel * 80),
      interval: Math.max(MIN_INTERVAL_MS, SPAWN_INTERVAL_MS - speedLevel * 50),
    };
  };

  const loseLife = () => {
    livesRef.current -= 1;
    setLives(livesRef.current);
    comboRef.current = 0;
    setComboCount(0);
    triggerHapticFeedback('notificationError');
    if (livesRef.current <= 0) {
      endGameRef.current?.();
      return true;
    }
    return false;
  };

  endGameRef.current = () => {
    if (!gameActiveRef.current) return;
    gameActiveRef.current = false;
    clearAllTimers();
    gridRef.current = emptyGrid();
    setGrid(emptyGrid());
    setFeedback({});
    setBestCombo(bestComboRef.current);
    setPhase('gameover');

    if (Platform.OS === 'android') Vibration.vibrate([0, 100, 50, 100]);

    const finalScore = scoreRef.current;
    const oldBest = bestScoreRef.current;
    const improved = finalScore > oldBest;
    setPrevBest(oldBest);
    setIsNewBest(improved && finalScore > 0);
    if (improved) {
      bestScoreRef.current = finalScore;
      setBestScore(finalScore);
      triggerHapticFeedback('notificationSuccess');
    }

    if (!statsLoadedRef.current) return; // guest, or best unknown — never overwrite a real record
    saveGameStats(firestoreDB, uid, {
      lastWhackAt: new Date(),
      lastWhackScore: finalScore,
      whackBestScore: Math.max(finalScore, oldBest),
    });
    if (improved && finalScore > 0) {
      submitLeaderboardScore({ firestoreDB, appdatabase, uid, user, gameKey: 'whack', score: finalScore });
    }
  };

  spawnRef.current = () => {
    if (!gameActiveRef.current) return;
    const { visibleTime, interval } = getSpeed();

    const emptyCells = [];
    for (let i = 0; i < CELL_COUNT; i++) {
      if (gridRef.current[i] === CHAR_NONE) emptyCells.push(i);
    }

    if (emptyCells.length > 0) {
      const cellIndex = emptyCells[Math.floor(Math.random() * emptyCells.length)];
      const roll = Math.random();
      let charType = CHAR_GOLDEN;
      if (roll < 0.60) charType = CHAR_ROTTEN;
      else if (roll < 0.85) charType = CHAR_FRESH;

      setCell(cellIndex, charType);
      scaleAnims[cellIndex].setValue(0);
      Animated.spring(scaleAnims[cellIndex], {
        toValue: 1, tension: 200, friction: 8, useNativeDriver: true,
      }).start();

      despawnTimersRef.current[cellIndex] = setTimeout(() => {
        delete despawnTimersRef.current[cellIndex];
        if (!gameActiveRef.current) return;
        if (gridRef.current[cellIndex] === CHAR_ROTTEN) {
          showFeedback(cellIndex, { type: 'miss' });
          if (loseLife()) return;
        }
        setCell(cellIndex, CHAR_NONE);
      }, visibleTime);
    }

    // Always reschedule — the loop used to die for good if the board filled up.
    spawnTimerRef.current = setTimeout(() => spawnRef.current?.(), interval);
  };

  const handleTap = (index) => {
    if (!gameActiveRef.current) return;
    const charType = gridRef.current[index];
    if (charType === CHAR_NONE) return;

    if (despawnTimersRef.current[index]) {
      clearTimeout(despawnTimersRef.current[index]);
      delete despawnTimersRef.current[index];
    }

    if (charType === CHAR_ROTTEN || charType === CHAR_GOLDEN) {
      const newCombo = comboRef.current + 1;
      let points = 25;
      if (charType === CHAR_ROTTEN) {
        const comboBonus = newCombo >= 3 ? Math.min(newCombo * 2, 20) : 0;
        points = 10 + comboBonus;
      }
      comboRef.current = newCombo;
      bestComboRef.current = Math.max(bestComboRef.current, newCombo);
      scoreRef.current += points;
      catchesRef.current += 1;
      setScore(scoreRef.current);
      setCatches(catchesRef.current);
      setComboCount(newCombo);
      showFeedback(index, { type: charType === CHAR_GOLDEN ? 'golden' : 'hit', points });
      if (charType === CHAR_GOLDEN) {
        triggerHapticFeedback('notificationSuccess');
      } else {
        triggerHapticFeedback('impactMedium');
        if (newCombo >= 3) setTimeout(() => triggerHapticFeedback('impactLight'), 80);
      }
    } else if (charType === CHAR_FRESH) {
      showFeedback(index, { type: 'wrong' });
      if (Platform.OS === 'android') Vibration.vibrate([0, 60, 40, 60]);
      if (loseLife()) return;
    }

    setCell(index, CHAR_NONE);
  };

  const startGame = useCallback(() => {
    clearAllTimers();
    onRoundStart?.();
    setScore(0);
    setLives(START_LIVES);
    setCatches(0);
    setComboCount(0);
    setBestCombo(0);
    setFeedback({});
    setIsNewBest(false);
    scoreRef.current = 0;
    livesRef.current = START_LIVES;
    catchesRef.current = 0;
    comboRef.current = 0;
    bestComboRef.current = 0;
    gridRef.current = emptyGrid();
    setGrid(emptyGrid());
    scaleAnims.forEach(a => a.setValue(0));
    gameActiveRef.current = true;
    setPhase('playing');
    triggerHapticFeedback('impactHeavy');
    spawnTimerRef.current = setTimeout(() => spawnRef.current?.(), 700);
  }, [clearAllTimers, onRoundStart, scaleAnims, triggerHapticFeedback]);

  // ── Pause / resume ──
  // Fruit left on the board is removed without a penalty, so leaving the app
  // (or pausing) never costs lives.
  const pauseGame = useCallback(() => {
    if (phaseRef.current !== 'playing' || !gameActiveRef.current) return;
    gameActiveRef.current = false;
    clearAllTimers();
    gridRef.current = emptyGrid();
    setGrid(emptyGrid());
    setFeedback({});
    setPhase('paused');
  }, [clearAllTimers]);

  const resumeGame = useCallback(() => {
    if (phaseRef.current !== 'paused') return;
    gameActiveRef.current = true;
    setPhase('playing');
    triggerHapticFeedback('impactLight');
    spawnTimerRef.current = setTimeout(() => spawnRef.current?.(), 600);
  }, [triggerHapticFeedback]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') pauseGame();
    });
    return () => sub.remove();
  }, [pauseGame]);

  const feedbackBg = isDarkMode ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.85)';

  return (
    <View style={[styles.screen, { backgroundColor: isDarkMode ? config.colors.backgroundDark : '#f8fafc', paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={onClose} style={styles.backBtn} hitSlop={8}>
          <Icon name="chevron-back" size={24} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.text }]}>🍎 Fruit Smash</Text>
        {phase === 'playing' ? (
          <TouchableOpacity onPress={pauseGame} style={styles.backBtn} hitSlop={8}>
            <Icon name="pause" size={22} color={c.text} />
          </TouchableOpacity>
        ) : <View style={{ width: 40 }} />}
      </View>

      {phase === 'loading' && (
        <View style={styles.centerContent}>
          <Text style={{ fontSize: 48 }}>🍎</Text>
        </View>
      )}

      {phase === 'rules' && (
        <ScrollView contentContainerStyle={styles.rulesContent} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 64, textAlign: 'center' }}>🍎</Text>
          <Text style={[styles.bigTitle, { color: c.text, textAlign: 'center' }]}>Fruit Smash</Text>
          <Text style={[styles.subText, { color: c.textSecondary, textAlign: 'center', marginBottom: 20 }]}>
            Smash the rotten fruits before they escape!
          </Text>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEE2E2' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>🍎</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>Smash Rotten Fruits!</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Tap the red rotten fruits quickly! Letting one escape costs 1 life.</Text>
              </View>
            </View>
          </View>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#EFF6FF' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>🍏</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>Don't Tap Fresh Fruits!</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Tapping a green fresh fruit costs 1 life. You only have 3!</Text>
              </View>
            </View>
          </View>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEF3C7' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>⭐</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>Golden Star & Combos</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Stars are worth +25. Smash 3+ in a row for combo bonus points!</Text>
              </View>
            </View>
          </View>

          {bestScore > 0 && (
            <Text style={[styles.bestScoreLabel, { color: ACCENT }]}>
              🏆 High Score: {bestScore}
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

      {(phase === 'playing' || phase === 'paused') && (
        <View style={{ flex: 1, alignItems: 'center' }}>
          <View style={[styles.hud, { backgroundColor: surface, borderColor: border }]}>
            <View style={styles.hudItem}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>Score</Text>
              <Text style={[styles.hudVal, { color: c.text }]}>{score}</Text>
            </View>
            <View style={styles.hudItem}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>Combo</Text>
              <Text style={[styles.hudVal, { color: comboCount >= 3 ? '#F59E0B' : c.textSecondary }]}>x{comboCount}</Text>
            </View>
            <View style={[styles.hudItem, { alignItems: 'flex-end' }]}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>Lives</Text>
              <View style={{ flexDirection: 'row' }}>
                {Array.from({ length: START_LIVES }).map((_, i) => (
                  <Icon key={i} name="heart" size={18} color={i < lives ? '#DC2626' : (isDarkMode ? '#334155' : '#cbd5e1')} style={{ marginLeft: 2 }} />
                ))}
              </View>
            </View>
          </View>

          <View style={styles.gridContainer}>
            <View style={styles.grid}>
              {grid.map((cellChar, i) => {
                const fb = feedback[i];
                return (
                  <Pressable
                    key={i}
                    style={[styles.cell, { backgroundColor: surface, borderColor: border }]}
                    // onPressIn: register the smash on touch-down, not release —
                    // fruit can vanish between the two.
                    onPressIn={() => handleTap(i)}
                  >
                    {cellChar !== CHAR_NONE && (
                      <Animated.View style={[styles.character, { transform: [{ scale: scaleAnims[i] }] }]}>
                        <Text style={styles.charEmoji}>{CHAR_EMOJIS[cellChar]}</Text>
                      </Animated.View>
                    )}
                    {fb && (
                      <View pointerEvents="none" style={[styles.feedbackOverlay, { backgroundColor: feedbackBg }]}>
                        {fb.type === 'hit' && <Text style={[styles.feedbackText, { color: '#10B981' }]}>+{fb.points}</Text>}
                        {fb.type === 'golden' && <Text style={[styles.feedbackText, { color: '#F59E0B' }]}>+{fb.points}</Text>}
                        {fb.type === 'wrong' && <Text style={[styles.feedbackText, { color: '#EF4444' }]}>❌</Text>}
                        {fb.type === 'miss' && <Text style={[styles.feedbackText, { color: '#EF4444', fontSize: 16 }]}>Missed!</Text>}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {phase === 'paused' && (
              <View style={[styles.pauseOverlay, { backgroundColor: isDarkMode ? 'rgba(15,23,42,0.92)' : 'rgba(248,250,252,0.92)' }]}>
                <Text style={{ fontSize: 48 }}>⏸️</Text>
                <Text style={[styles.bigTitle, { color: c.text }]}>Paused</Text>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: ACCENT, marginTop: 20 }]} onPress={resumeGame}>
                  <Icon name="play" size={22} color="#fff" />
                  <Text style={styles.actionBtnText}>Resume</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      )}

      {phase === 'gameover' && (
        <ScrollView contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 64 }}>{isNewBest ? '🏆' : '💥'}</Text>
          <Text style={[styles.bigTitle, { color: ACCENT }]}>{isNewBest ? 'New High Score!' : 'Game Over!'}</Text>

          <View style={[styles.statsCard, { backgroundColor: surface, borderColor: border }]}>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Score</Text>
              <Text style={[styles.statVal, { color: ACCENT }]}>{score}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Smashed</Text>
              <Text style={[styles.statVal, { color: c.text }]}>{catches}</Text>
            </View>
            <View style={[styles.statRow, { borderBottomWidth: 0 }]}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Best Combo</Text>
              <Text style={[styles.statVal, { color: '#F59E0B' }]}>x{bestCombo}</Text>
            </View>
          </View>

          {isNewBest ? (
            <Text style={[styles.bestScoreLabel, { color: ACCENT, marginTop: 16 }]}>
              🎉 NEW HIGH SCORE! 🎉{prevBest > 0 ? `\nPrevious best: ${prevBest}` : ''}
            </Text>
          ) : bestScore > 0 ? (
            <Text style={[styles.bestScoreLabel, { color: ACCENT, marginTop: 16 }]}>
              Best Score: {bestScore}
            </Text>
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
  screen: { flex: 1, padding: 16, paddingTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '800', flex: 1, textAlign: 'center' },
  backBtn: { padding: 8, width: 40 },

  centerContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20, paddingHorizontal: 16 },
  rulesContent: { paddingVertical: 10, paddingHorizontal: 12 },
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

  bestScoreLabel: { fontSize: 16, fontWeight: '800', textAlign: 'center', marginTop: 10, lineHeight: 24 },

  hud: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 16, borderWidth: 1, marginBottom: 24 },
  hudItem: { alignItems: 'flex-start' },
  hudLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  hudVal: { fontSize: 24, fontWeight: '900' },

  gridContainer: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: CELL_SIZE * GRID_SIZE + 24, gap: 12 },
  cell: { width: CELL_SIZE, height: CELL_SIZE, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  character: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  charEmoji: { fontSize: CELL_SIZE * 0.55 },

  feedbackOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  feedbackText: { fontSize: 24, fontWeight: '900' },

  pauseOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },

  statsCard: { width: '100%', borderRadius: 20, borderWidth: 1, padding: 20, marginTop: 24 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(128,128,128,0.1)' },
  statLabel: { fontSize: 16, fontWeight: '600' },
  statVal: { fontSize: 24, fontWeight: '900' },
});

export default SpotTheFake;
