/**
 * MemoryMatch.js — Card matching memory game with difficulty levels
 * Blox Fruit themed — Polished, Kid-Friendly, Consistent UI
 *
 * Board state lives in refs (mirrored to state for rendering) so two taps in
 * the same frame can't both read the pre-tap board — that used to drop the
 * first card and leave it stuck face-up.
 */

import React, { useState, useEffect, useRef } from 'react';
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
  AppState,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { getThemeColors } from '../Helper/themeColors';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { loadGameStats, saveGameStats, submitLeaderboardScore } from './gameScores';
import GameRoundActions from './GameRoundActions';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_MARGIN = 6;
const FLIP_BACK_DELAY = 800;
const RANKED_DIFFICULTY = 'medium'; // the only difficulty on the leaderboard

const DIFFICULTIES = {
  easy:   { cols: 3, rows: 2, pairs: 3, labelKey: 'engagement.memory_match.diff_easy',   emoji: '😊', color: '#10B981', descKey: 'engagement.memory_match.diff_easy_desc' },
  medium: { cols: 4, rows: 3, pairs: 6, labelKey: 'engagement.memory_match.diff_medium', emoji: '🧠', color: '#F59E0B', descKey: 'engagement.memory_match.diff_medium_desc' },
  hard:   { cols: 4, rows: 4, pairs: 8, labelKey: 'engagement.memory_match.diff_hard',   emoji: '🔥', color: '#EF4444', descKey: 'engagement.memory_match.diff_hard_desc' },
};

// Blox Fruit themed emoji pool
const EMOJI_POOL = [
  '🍎', '🍊', '🍋', '🍇', '🍉', '🍓', '🫐', '🍑',
  '🥝', '🍍', '🥭', '🍌', '🍒', '🫒', '🥥', '🍈',
  '⭐', '💎', '🔥', '💰', '🗡️', '⚡', '🌊', '🏴‍☠️',
];

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const generateDeck = (pairCount) => {
  const selected = shuffle(EMOJI_POOL).slice(0, pairCount);
  const pairs = [...selected, ...selected];
  return shuffle(pairs).map((emoji, index) => ({
    id: index, emoji, flipped: false, matched: false,
  }));
};

const formatTime = (s) => {
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return mins > 0
    ? i18next.t('engagement.memory_match.time_min_sec', { m: mins, s: secs })
    : i18next.t('engagement.memory_match.time_sec', { s: secs });
};

const getStars = (m, d) => {
  const thresholds = { easy: [4, 6, 8], medium: [8, 12, 16], hard: [10, 15, 20] };
  const t = thresholds[d] || thresholds.medium;
  if (m <= t[0]) return { stars: 3, labelKey: 'engagement.memory_match.rating_perfect', emoji: '🌟', color: '#F59E0B' };
  if (m <= t[1]) return { stars: 2, labelKey: 'engagement.memory_match.rating_great', emoji: '⭐', color: '#10B981' };
  if (m <= t[2]) return { stars: 2, labelKey: 'engagement.memory_match.rating_good', emoji: '👏', color: '#3B82F6' };
  return { stars: 1, labelKey: 'engagement.memory_match.rating_practice', emoji: '🧠', color: '#8B5CF6' };
};

const makeAnims = (n) => Array(n).fill(null).map(() => new Animated.Value(0));

const MemoryMatch = ({ onClose, roundInfo, onRoundStart, onWatchAd, adLoading }) => {
  const insets = useSafeAreaInsets();
  const { firestoreDB, appdatabase, user, theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  const uid = user?.id;
  const { t } = useTranslation();

  const [phase, setPhase] = useState('loading'); // loading | rules | playing | complete
  const [difficulty, setDifficulty] = useState('medium');
  const [bestMoves, setBestMoves] = useState({});
  const [bestTime, setBestTime] = useState({});
  const [cards, setCards] = useState([]);
  const [matchedPairs, setMatchedPairs] = useState(0);
  const [moves, setMoves] = useState(0);
  const [timer, setTimer] = useState(0);
  const [result, setResult] = useState({ newBestMoves: false, newBestTime: false });

  const timerRef = useRef(null);
  const flipAnims = useRef(makeAnims(DIFFICULTIES.medium.cols * DIFFICULTIES.medium.rows));
  const startTimeRef = useRef(0);
  const pausedAtRef = useRef(0);
  const cardsRef = useRef([]);
  const flippedRef = useRef([]);
  const checkingRef = useRef(false);
  const matchedRef = useRef(0);
  const movesRef = useRef(0);
  const bestMovesRef = useRef({});
  const bestTimeRef = useRef({});
  const statsLoadedRef = useRef(false);
  const timersRef = useRef([]);
  const mountedRef = useRef(true);
  const phaseRef = useRef('loading');
  phaseRef.current = phase;

  const c = getThemeColors(isDarkMode);
  const surface = isDarkMode ? config.colors.surfaceDark : '#fff';
  const border = isDarkMode ? '#334155' : '#e2e8f0';
  const diff = DIFFICULTIES[difficulty];
  const cardSize = (SCREEN_WIDTH - 48 - CARD_MARGIN * diff.cols * 2) / diff.cols;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = uid ? await loadGameStats(firestoreDB, uid) : null;
      if (cancelled) return;
      statsLoadedRef.current = !!data;
      bestMovesRef.current = {
        easy:   data?.memoryBestMoves_easy || 0,
        medium: data?.memoryBestMoves_medium || 0,
        hard:   data?.memoryBestMoves_hard || 0,
      };
      bestTimeRef.current = {
        easy:   data?.memoryBestTime_easy || 0,
        medium: data?.memoryBestTime_medium || 0,
        hard:   data?.memoryBestTime_hard || 0,
      };
      setBestMoves(bestMovesRef.current);
      setBestTime(bestTimeRef.current);
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

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => {
    mountedRef.current = false;
    stopTimer();
    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current = [];
  }, []);

  useEffect(() => {
    if (phase === 'playing') {
      startTimeRef.current = Date.now();
      pausedAtRef.current = 0;
      timerRef.current = setInterval(() => {
        if (pausedAtRef.current) return;
        setTimer(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      stopTimer();
    }
    return stopTimer;
  }, [phase]);

  // The clock doesn't run while the app is in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (phaseRef.current !== 'playing') return;
      if (state !== 'active') {
        if (!pausedAtRef.current) pausedAtRef.current = Date.now();
      } else if (pausedAtRef.current) {
        startTimeRef.current += Date.now() - pausedAtRef.current;
        pausedAtRef.current = 0;
      }
    });
    return () => sub.remove();
  }, []);

  const commitCards = (next) => {
    cardsRef.current = next;
    setCards(next);
  };

  const startGame = () => {
    onRoundStart?.();
    stopTimer();
    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current = [];
    flipAnims.current = makeAnims(diff.cols * diff.rows);
    commitCards(generateDeck(diff.pairs));
    flippedRef.current = [];
    checkingRef.current = false;
    matchedRef.current = 0;
    movesRef.current = 0;
    setMatchedPairs(0);
    setMoves(0);
    setTimer(0);
    setResult({ newBestMoves: false, newBestTime: false });
    setPhase('playing');
    triggerHapticFeedback('impactHeavy');
  };

  const completeGame = (finalMoves, finalTime) => {
    setPhase('complete');
    const d = difficulty;
    const oldMoves = bestMovesRef.current[d] || 0;
    const oldTime = bestTimeRef.current[d] || 0;
    const newBestMoves = oldMoves === 0 || finalMoves < oldMoves;
    const newBestTime = oldTime === 0 || finalTime < oldTime;
    const bm = newBestMoves ? finalMoves : oldMoves;
    const bt = newBestTime ? finalTime : oldTime;
    bestMovesRef.current = { ...bestMovesRef.current, [d]: bm };
    bestTimeRef.current = { ...bestTimeRef.current, [d]: bt };
    setBestMoves(bestMovesRef.current);
    setBestTime(bestTimeRef.current);
    // "New best" only means something when there was a best to beat.
    setResult({ newBestMoves: newBestMoves && oldMoves > 0, newBestTime: newBestTime && oldTime > 0, firstClear: oldMoves === 0 });

    if (!statsLoadedRef.current) return;
    saveGameStats(firestoreDB, uid, {
      lastMemoryAt: new Date(),
      [`memoryBestMoves_${d}`]: bm,
      [`memoryBestTime_${d}`]: bt,
      [`memoryLastMoves_${d}`]: finalMoves,
      [`memoryLastTime_${d}`]: finalTime,
    });
    if (d === RANKED_DIFFICULTY && newBestMoves) {
      submitLeaderboardScore({ firestoreDB, appdatabase, uid, user, gameKey: 'memory', score: bm });
    }
  };

  const flipCard = (cardId) => {
    if (checkingRef.current) return;
    const board = cardsRef.current;
    const card = board[cardId];
    if (!card || card.flipped || card.matched) return;
    if (flippedRef.current.length >= 2) return;

    triggerHapticFeedback('impactLight');
    Animated.spring(flipAnims.current[cardId], {
      toValue: 1, tension: 250, friction: 8, useNativeDriver: true,
    }).start();

    const flippedBoard = [...board];
    flippedBoard[cardId] = { ...card, flipped: true };
    commitCards(flippedBoard);

    const pair = [...flippedRef.current, cardId];
    flippedRef.current = pair;
    if (pair.length < 2) return;

    movesRef.current += 1;
    setMoves(movesRef.current);
    checkingRef.current = true;
    const [first, second] = pair;
    const totalPairs = diff.pairs;

    if (flippedBoard[first].emoji === flippedBoard[second].emoji) {
      later(() => {
        triggerHapticFeedback('notificationSuccess');
        if (Platform.OS === 'android') Vibration.vibrate([0, 40, 20, 40]);

        const matched = [...cardsRef.current];
        matched[first] = { ...matched[first], matched: true };
        matched[second] = { ...matched[second], matched: true };
        commitCards(matched);
        flippedRef.current = [];
        checkingRef.current = false;
        matchedRef.current += 1;
        setMatchedPairs(matchedRef.current);

        if (matchedRef.current >= totalPairs) {
          checkingRef.current = true; // board is done — ignore stray taps
          stopTimer();
          const finalTime = Math.max(1, Math.floor((Date.now() - startTimeRef.current) / 1000));
          setTimer(finalTime);
          const finalMoves = movesRef.current;
          later(() => {
            triggerHapticFeedback('impactHeavy');
            completeGame(finalMoves, finalTime);
          }, 500);
        }
      }, 300);
    } else {
      later(() => {
        triggerHapticFeedback('impactMedium');
        Animated.parallel([
          Animated.timing(flipAnims.current[first], { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.timing(flipAnims.current[second], { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start();

        const reset = [...cardsRef.current];
        reset[first] = { ...reset[first], flipped: false };
        reset[second] = { ...reset[second], flipped: false };
        commitCards(reset);
        flippedRef.current = [];
        checkingRef.current = false;
      }, FLIP_BACK_DELAY);
    }
  };

  const renderCard = (card, index) => {
    const isFlipped = card.flipped || card.matched;
    const anim = flipAnims.current[index] || new Animated.Value(isFlipped ? 1 : 0);
    const backRotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
    const frontRotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });
    // Opacity cross-fade at the halfway point: backfaceVisibility alone isn't
    // reliable on Android, where the back face could show through mirrored.
    const backOpacity = anim.interpolate({ inputRange: [0, 0.49, 0.51, 1], outputRange: [1, 1, 0, 0], extrapolate: 'clamp' });
    const frontOpacity = anim.interpolate({ inputRange: [0, 0.49, 0.51, 1], outputRange: [0, 0, 1, 1], extrapolate: 'clamp' });

    return (
      <TouchableOpacity
        key={card.id}
        style={[styles.card, { width: cardSize, height: cardSize, margin: CARD_MARGIN }]}
        onPress={() => flipCard(card.id)}
        activeOpacity={0.8}
        disabled={isFlipped}
      >
        <Animated.View style={[styles.cardFace, styles.cardBack, {
          backgroundColor: isDarkMode ? '#3B82F6' : '#6366F1',
          opacity: backOpacity,
          transform: [{ perspective: 800 }, { rotateY: backRotate }],
          width: cardSize - 4, height: cardSize - 4,
        }]}>
          <Text style={[styles.cardBackText, { fontSize: cardSize > 70 ? 24 : 18 }]}>?</Text>
        </Animated.View>

        <Animated.View style={[styles.cardFace, styles.cardFront, {
          backgroundColor: card.matched ? (isDarkMode ? '#065F46' : '#D1FAE5') : surface,
          opacity: frontOpacity,
          transform: [{ perspective: 800 }, { rotateY: frontRotate }],
          width: cardSize - 4, height: cardSize - 4,
          borderColor: card.matched ? '#10B981' : border,
        }]}>
          <Text style={{ fontSize: cardSize > 70 ? 28 : 22 }}>{card.emoji}</Text>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  const rating = getStars(moves, difficulty);
  const curBest = bestMoves[difficulty] || 0;

  return (
    <View style={[styles.screen, { backgroundColor: isDarkMode ? config.colors.backgroundDark : '#f8fafc', paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={onClose} style={styles.backBtn} hitSlop={8}>
          <Icon name="chevron-back" size={24} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.text }]}>🃏 {t('engagement.game_hub.memory_name')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {phase === 'loading' && (
        <View style={styles.centerContent}>
          <Text style={{ fontSize: 48 }}>🃏</Text>
        </View>
      )}

      {phase === 'rules' && (
        <ScrollView contentContainerStyle={styles.rulesContent} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 64, textAlign: 'center' }}>🃏</Text>
          <Text style={[styles.bigTitle, { color: c.text, textAlign: 'center' }]}>{t('engagement.game_hub.memory_name')}</Text>
          <Text style={[styles.subText, { color: c.textSecondary, textAlign: 'center', marginBottom: 20 }]}>
            {t('engagement.memory_match.tagline')}
          </Text>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEF3C7' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>👆</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>{t('engagement.memory_match.rule1_title')}</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>{t('engagement.memory_match.rule1_desc')}</Text>
              </View>
            </View>
          </View>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#DBEAFE' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>🔍</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>{t('engagement.memory_match.rule2_title')}</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>{t('engagement.memory_match.rule2_desc')}</Text>
              </View>
            </View>
          </View>

          <Text style={[styles.bigTitle, { fontSize: 22, color: c.text, marginTop: 12, marginBottom: 12 }]}>{t('engagement.memory_match.difficulty')}</Text>

          {Object.entries(DIFFICULTIES).map(([key, d]) => {
            const best = bestMoves[key];
            const selected = difficulty === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.diffCard, {
                  backgroundColor: surface,
                  borderColor: selected ? d.color : border,
                  borderWidth: selected ? 2 : 1,
                }]}
                onPress={() => { setDifficulty(key); triggerHapticFeedback('impactLight'); }}
                activeOpacity={0.7}
              >
                <View style={styles.diffLeft}>
                  <Text style={{ fontSize: 28 }}>{d.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[styles.diffLabel, { color: d.color }]}>{t(d.labelKey)}</Text>
                    {key === RANKED_DIFFICULTY && (
                      <View style={styles.rankedTag}><Text style={styles.rankedTagText}>{t('engagement.memory_match.ranked')}</Text></View>
                    )}
                  </View>
                  <Text style={[styles.diffDesc, { color: c.textSecondary }]}>{t(d.descKey)}</Text>
                  {best > 0 && (
                    <Text style={[styles.diffBest, { color: c.textSecondary }]}>{t('engagement.memory_match.best_moves_time', { moves: best, time: formatTime(bestTime[key] || 0) })}</Text>
                  )}
                </View>
                <View style={[styles.diffRadio, { borderColor: d.color, backgroundColor: selected ? d.color : 'transparent' }]}>
                  {selected && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>✓</Text>}
                </View>
              </TouchableOpacity>
            );
          })}

          <GameRoundActions
            roundInfo={roundInfo}
            onPlay={startGame}
            onWatchAd={onWatchAd}
            adLoading={adLoading}
            color={diff.color}
            playLabel={t('engagement.games.lets_go')}
            playIcon="play"
            textColor={c.textSecondary}
            style={{ marginTop: 16 }}
          />
        </ScrollView>
      )}

      {phase === 'playing' && (
        <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 16 }}>
          <View style={[styles.hud, { backgroundColor: surface, borderColor: border }]}>
            <View style={styles.hudItem}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>{t('engagement.memory_match.pairs')}</Text>
              <Text style={[styles.hudVal, { color: '#10B981' }]}>{matchedPairs}/{diff.pairs}</Text>
            </View>
            <View style={styles.hudItem}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>{t('engagement.memory_match.moves')}</Text>
              <Text style={[styles.hudVal, { color: '#F59E0B' }]}>{moves}</Text>
            </View>
            <View style={styles.hudItem}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>{t('engagement.memory_match.time')}</Text>
              <Text style={[styles.hudVal, { color: c.text }]}>{formatTime(timer)}</Text>
            </View>
          </View>

          <View style={[styles.diffBadge, { backgroundColor: diff.color, marginBottom: 12 }]}>
            <Text style={styles.diffBadgeText}>{t(diff.labelKey)}{curBest > 0 ? ` · ${t('engagement.memory_match.best_moves_short', { moves: curBest })}` : ''}</Text>
          </View>

          <View style={styles.gridContainer}>
            <View style={[styles.grid, { width: (cardSize + CARD_MARGIN * 2) * diff.cols }]}>
              {cards.map((card, i) => renderCard(card, i))}
            </View>
          </View>
        </View>
      )}

      {phase === 'complete' && (
        <ScrollView contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 80 }}>{rating.emoji}</Text>
          <Text style={[styles.bigTitle, { color: rating.color }]}>{t(rating.labelKey)}</Text>
          <Text style={styles.starsRow}>
            {'★'.repeat(rating.stars)}<Text style={{ color: isDarkMode ? '#334155' : '#e2e8f0' }}>{'★'.repeat(3 - rating.stars)}</Text>
          </Text>

          <View style={[styles.statsCard, { backgroundColor: surface, borderColor: border }]}>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>{t('engagement.memory_match.moves')}</Text>
              <Text style={[styles.statVal, { color: '#F59E0B' }]}>{moves}{result.newBestMoves ? ' 🎉' : ''}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>{t('engagement.memory_match.time')}</Text>
              <Text style={[styles.statVal, { color: c.text }]}>{formatTime(timer)}{result.newBestTime ? ' 🎉' : ''}</Text>
            </View>
            <View style={[styles.statRow, { borderBottomWidth: 0 }]}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>{t('engagement.memory_match.difficulty')}</Text>
              <Text style={[styles.statVal, { color: diff.color }]}>{t(diff.labelKey)}</Text>
            </View>
          </View>

          {result.newBestMoves ? (
            <Text style={[styles.bestScoreLabel, { color: diff.color }]}>{t('engagement.memory_match.new_best')}</Text>
          ) : curBest > 0 && !result.firstClear ? (
            <Text style={[styles.bestScoreLabel, { color: diff.color }]}>{t('engagement.memory_match.best_moves', { moves: curBest })}</Text>
          ) : null}

          <GameRoundActions
            roundInfo={roundInfo}
            onPlay={startGame}
            onWatchAd={onWatchAd}
            adLoading={adLoading}
            color={diff.color}
            playLabel={t('engagement.games.play_again')}
            textColor={c.textSecondary}
          />
          {!roundInfo?.maxedOut && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#6366F1', marginTop: 10, width: '100%', justifyContent: 'center' }]} onPress={() => setPhase('rules')}>
              <Icon name="options-outline" size={22} color="#fff" />
              <Text style={styles.actionBtnText}>{t('engagement.memory_match.change_difficulty')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.actionBtn, styles.doneBtn]} onPress={onClose}>
            <Text style={styles.actionBtnText}>{t('engagement.games.done')}</Text>
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

  bestScoreLabel: { fontSize: 16, fontWeight: '800', textAlign: 'center', marginTop: 16 },
  starsRow: { fontSize: 32, color: '#F59E0B', marginTop: 6, letterSpacing: 4 },

  diffCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, marginBottom: 10, width: '100%' },
  diffLeft: { marginRight: 16 },
  diffLabel: { fontSize: 18, fontWeight: '900' },
  diffDesc: { fontSize: 12, marginTop: 4 },
  diffBest: { fontSize: 11, marginTop: 4, fontWeight: '700' },
  diffRadio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  rankedTag: { backgroundColor: 'rgba(245,158,11,0.15)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  rankedTagText: { color: '#D97706', fontSize: 10, fontWeight: '800' },

  diffBadge: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 12 },
  diffBadgeText: { color: '#fff', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },

  hud: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', width: '100%', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1, marginTop: 6, marginBottom: 10 },
  hudItem: { alignItems: 'center' },
  hudLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  hudVal: { fontSize: 24, fontWeight: '900' },

  gridContainer: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },

  card: { alignItems: 'center', justifyContent: 'center' },
  cardFace: { position: 'absolute', borderRadius: 12, alignItems: 'center', justifyContent: 'center', backfaceVisibility: 'hidden' },
  cardBack: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 3 },
  cardBackText: { fontWeight: '900', color: '#fff', opacity: 0.6 },
  cardFront: { borderWidth: 2 },

  statsCard: { width: '100%', borderRadius: 20, borderWidth: 1, padding: 20, marginTop: 24 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(128,128,128,0.1)' },
  statLabel: { fontSize: 16, fontWeight: '600' },
  statVal: { fontSize: 24, fontWeight: '900' },
});

export default MemoryMatch;
