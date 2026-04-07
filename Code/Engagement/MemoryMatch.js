/**
 * MemoryMatch.js — Card matching memory game with difficulty levels
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_MARGIN = 6;
const FLIP_BACK_DELAY = 800;

const DIFFICULTIES = {
  easy:   { cols: 3, rows: 2, pairs: 3, label: 'Easy',   emoji: '😊', color: '#10B981', desc: '3x2 grid . 3 pairs' },
  medium: { cols: 4, rows: 3, pairs: 6, label: 'Medium', emoji: '🧠', color: '#F59E0B', desc: '4x3 grid . 6 pairs' },
  hard:   { cols: 4, rows: 4, pairs: 8, label: 'Hard',   emoji: '🔥', color: '#EF4444', desc: '4x4 grid . 8 pairs' },
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

const MemoryMatch = ({ onClose, roundInfo, onRoundComplete, onWatchAd }) => {
  const visible = true;
  const insets = useSafeAreaInsets();
  const { firestoreDB, appdatabase, user, theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  const uid = user?.id;

  const [phase, setPhase] = useState('loading');
  const [difficulty, setDifficulty] = useState('medium');
  const [bestMoves, setBestMoves] = useState({});
  const [bestTime, setBestTime] = useState({});
  const [cards, setCards] = useState([]);
  const [flippedIds, setFlippedIds] = useState([]);
  const [matchedPairs, setMatchedPairs] = useState(0);
  const [moves, setMoves] = useState(0);
  const [timer, setTimer] = useState(0);
  const [isChecking, setIsChecking] = useState(false);

  const timerRef = useRef(null);
  const flipAnims = useRef([]);
  const startTimeRef = useRef(0);

  const c = getThemeColors(isDarkMode);
  const diff = DIFFICULTIES[difficulty];
  const totalCards = diff.cols * diff.rows;
  const cardSize = (SCREEN_WIDTH - 48 - CARD_MARGIN * diff.cols * 2) / diff.cols;

  useEffect(() => {
    flipAnims.current = Array(totalCards).fill(null).map(() => new Animated.Value(0));
  }, [totalCards]);

  useEffect(() => {
    if (!visible || !firestoreDB || !uid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(firestoreDB, 'games', uid));
        const data = snap.exists ? snap.data() : {};
        setBestMoves({
          easy:   data.memoryBestMoves_easy || 0,
          medium: data.memoryBestMoves_medium || 0,
          hard:   data.memoryBestMoves_hard || 0,
        });
        setBestTime({
          easy:   data.memoryBestTime_easy || 0,
          medium: data.memoryBestTime_medium || 0,
          hard:   data.memoryBestTime_hard || 0,
        });
        setPhase('rules');
      } catch {
        setPhase('rules');
      }
    })();
  }, [visible, firestoreDB, uid]);

  useEffect(() => {
    if (phase === 'playing') {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setTimer(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase]);

  const startGame = useCallback(() => {
    const deck = generateDeck(diff.pairs);
    setCards(deck);
    setFlippedIds([]);
    setMatchedPairs(0);
    setMoves(0);
    setTimer(0);
    setIsChecking(false);
    flipAnims.current = Array(diff.cols * diff.rows).fill(null).map(() => new Animated.Value(0));
    setPhase('playing');
    triggerHapticFeedback('impactHeavy');
  }, [diff, triggerHapticFeedback]);

  const flipCard = useCallback((cardId) => {
    if (isChecking) return;
    const card = cards[cardId];
    if (!card || card.flipped || card.matched) return;
    if (flippedIds.length >= 2) return;

    triggerHapticFeedback('impactLight');

    Animated.spring(flipAnims.current[cardId], {
      toValue: 1, tension: 250, friction: 8, useNativeDriver: true,
    }).start();

    const newCards = [...cards];
    newCards[cardId] = { ...newCards[cardId], flipped: true };
    setCards(newCards);

    const newFlipped = [...flippedIds, cardId];
    setFlippedIds(newFlipped);

    if (newFlipped.length === 2) {
      setMoves(prev => prev + 1);
      setIsChecking(true);

      const [first, second] = newFlipped;
      if (newCards[first].emoji === newCards[second].emoji) {
        setTimeout(() => {
          triggerHapticFeedback('notificationSuccess');
          if (Platform.OS === 'android') Vibration.vibrate([0, 40, 20, 40]);

          const matched = [...newCards];
          matched[first] = { ...matched[first], matched: true };
          matched[second] = { ...matched[second], matched: true };
          setCards(matched);
          setFlippedIds([]);
          setIsChecking(false);

          const newPairs = matchedPairs + 1;
          setMatchedPairs(newPairs);

          if (newPairs >= diff.pairs) {
            if (timerRef.current) clearInterval(timerRef.current);
            const finalTime = Math.floor((Date.now() - startTimeRef.current) / 1000);
            setTimer(finalTime);
            setTimeout(() => {
              triggerHapticFeedback('notificationSuccess');
              setTimeout(() => triggerHapticFeedback('impactHeavy'), 200);
              completeGame(moves + 1, finalTime);
            }, 500);
          }
        }, 300);
      } else {
        setTimeout(() => {
          triggerHapticFeedback('impactMedium');
          Animated.parallel([
            Animated.timing(flipAnims.current[first], { toValue: 0, duration: 200, useNativeDriver: true }),
            Animated.timing(flipAnims.current[second], { toValue: 0, duration: 200, useNativeDriver: true }),
          ]).start();

          const reset = [...newCards];
          reset[first] = { ...reset[first], flipped: false };
          reset[second] = { ...reset[second], flipped: false };
          setCards(reset);
          setFlippedIds([]);
          setIsChecking(false);
        }, FLIP_BACK_DELAY);
      }
    }
  }, [cards, flippedIds, isChecking, matchedPairs, moves, diff, triggerHapticFeedback]); // eslint-disable-line react-hooks/exhaustive-deps

  const completeGame = useCallback(async (finalMoves, finalTime) => {
    setPhase('complete');
    if (onRoundComplete) onRoundComplete();
    try {
      const curBestMoves = bestMoves[difficulty] || 0;
      const curBestTime = bestTime[difficulty] || 0;
      const newBM = curBestMoves > 0 ? Math.min(finalMoves, curBestMoves) : finalMoves;
      const newBT = curBestTime > 0 ? Math.min(finalTime, curBestTime) : finalTime;
      setBestMoves(prev => ({ ...prev, [difficulty]: newBM }));
      setBestTime(prev => ({ ...prev, [difficulty]: newBT }));

      await setDoc(doc(firestoreDB, 'games', uid), {
        lastMemoryAt: new Date(),
        [`memoryBestMoves_${difficulty}`]: newBM,
        [`memoryBestTime_${difficulty}`]: newBT,
        [`memoryLastMoves_${difficulty}`]: finalMoves,
        [`memoryLastTime_${difficulty}`]: finalTime,
      }, { merge: true });

      // Leaderboard dual-write (medium difficulty only)
      if (difficulty === 'medium' && newBM > 0) {
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
        await setDoc(doc(firestoreDB, 'game_scores', 'memory', 'scores', uid), {
          score: newBM,
          username,
          avatar,
          updatedAt: new Date(),
        }, { merge: true });

        await updateLeaderboardCacheRealtime(firestoreDB, 'memory', uid, newBM, username, avatar);
      }
    } catch (err) {
      console.warn('[MemoryMatch] save error:', err?.message);
    }
  }, [bestMoves, bestTime, difficulty, firestoreDB, appdatabase, uid, user]);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const formatTime = (s) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getStars = (m, d) => {
    const thresholds = { easy: [4, 6, 8], medium: [8, 12, 16], hard: [10, 15, 20] };
    const t = thresholds[d] || thresholds.medium;
    if (m <= t[0]) return { stars: 3, label: 'Perfect! 🌟', emoji: '🌟', color: '#F59E0B' };
    if (m <= t[1]) return { stars: 2, label: 'Great Memory!', emoji: '⭐', color: '#10B981' };
    if (m <= t[2]) return { stars: 2, label: 'Good Job!', emoji: '👏', color: '#3B82F6' };
    return { stars: 1, label: 'Keep Practicing!', emoji: '🧠', color: '#8B5CF6' };
  };

  const renderCard = (card, index) => {
    const isFlipped = card.flipped || card.matched;
    const flipRotate = flipAnims.current[index]?.interpolate({
      inputRange: [0, 1], outputRange: ['0deg', '180deg'],
    }) || '0deg';
    const backRotate = flipAnims.current[index]?.interpolate({
      inputRange: [0, 1], outputRange: ['180deg', '360deg'],
    }) || '180deg';

    return (
      <TouchableOpacity
        key={card.id}
        style={[styles.card, { width: cardSize, height: cardSize, margin: CARD_MARGIN }]}
        onPress={() => flipCard(card.id)}
        activeOpacity={0.7}
        disabled={isFlipped || isChecking}
      >
        <Animated.View style={[styles.cardFace, styles.cardBack, {
          backgroundColor: card.matched ? '#10B981' : (isDarkMode ? '#3B82F6' : '#6366F1'),
          transform: [{ rotateY: flipRotate }],
          width: cardSize - 4, height: cardSize - 4,
        }]}>
          <Text style={[styles.cardBackText, { fontSize: cardSize > 70 ? 24 : 18 }]}>?</Text>
        </Animated.View>

        <Animated.View style={[styles.cardFace, styles.cardFront, {
          backgroundColor: card.matched ? (isDarkMode ? '#065F46' : '#D1FAE5') : (isDarkMode ? config.colors.surfaceDark : '#fff'),
          transform: [{ rotateY: backRotate }],
          width: cardSize - 4, height: cardSize - 4,
          borderColor: card.matched ? '#10B981' : (isDarkMode ? '#334155' : '#e2e8f0'),
        }]}>
          <Text style={{ fontSize: cardSize > 70 ? 28 : 22 }}>{card.emoji}</Text>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  const rating = getStars(moves, difficulty);
  const curBest = bestMoves[difficulty] || 0;

  const innerContent = (
    <>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => { if (timerRef.current) clearInterval(timerRef.current); onClose(); }} style={styles.backBtn}>
          <Icon name="chevron-back" size={24} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.text }]}>🃏 Memory Match</Text>
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
          <Text style={[styles.bigTitle, { color: c.text, textAlign: 'center' }]}>Memory Match</Text>
          <Text style={[styles.subText, { color: c.textSecondary, textAlign: 'center', marginBottom: 20 }]}>
            Find all the matching fruit pairs! 🧠
          </Text>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#FEF3C7' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>👆</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>Tap to Flip</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Tap any card to reveal the fruit hidden underneath!</Text>
              </View>
            </View>
          </View>

          <View style={[styles.ruleCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#DBEAFE' }]}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleEmoji}>🔍</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ruleTitle, { color: c.text }]}>Find the Match</Text>
                <Text style={[styles.ruleDesc, { color: c.textSecondary }]}>Flip 2 cards — if they match, they stay! If not, they flip back.</Text>
              </View>
            </View>
          </View>

          <Text style={[styles.bigTitle, { fontSize: 22, color: c.text, marginTop: 12, marginBottom: 12 }]}>Difficulty</Text>

          {Object.entries(DIFFICULTIES).map(([key, d]) => {
            const best = bestMoves[key];
            return (
              <TouchableOpacity
                key={key}
                style={[styles.diffCard, {
                  backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff',
                  borderColor: difficulty === key ? d.color : (isDarkMode ? '#334155' : '#e2e8f0'),
                  borderWidth: difficulty === key ? 2 : 1,
                }]}
                onPress={() => { setDifficulty(key); triggerHapticFeedback('impactLight'); }}
                activeOpacity={0.7}
              >
                <View style={styles.diffLeft}>
                  <Text style={{ fontSize: 28 }}>{d.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.diffLabel, { color: d.color }]}>{d.label}</Text>
                  <Text style={[styles.diffDesc, { color: c.textSecondary }]}>{d.desc}</Text>
                  {best > 0 && (
                    <Text style={[styles.diffBest, { color: c.textSecondary }]}>🏆 Best: {best} moves</Text>
                  )}
                </View>
                <View style={[styles.diffRadio, { borderColor: d.color, backgroundColor: difficulty === key ? d.color : 'transparent' }]}>
                  {difficulty === key && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>✓</Text>}
                </View>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: diff.color, marginTop: 16 }]} onPress={startGame}>
            <Icon name="play" size={22} color="#fff" />
            <Text style={styles.actionBtnText}>LET'S GO! 🎮</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {phase === 'playing' && (
        <View style={{ flex: 1, alignItems: 'center' }}>
          <View style={[styles.hud, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0' }]}>
            <View style={styles.hudItem}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>Pairs</Text>
              <Text style={[styles.hudVal, { color: '#10B981' }]}>{matchedPairs}/{diff.pairs}</Text>
            </View>
            <View style={styles.hudItem}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>Moves</Text>
              <Text style={[styles.hudVal, { color: '#F59E0B' }]}>{moves}</Text>
            </View>
            <View style={styles.hudItem}>
              <Text style={[styles.hudLabel, { color: c.textSecondary }]}>Time</Text>
              <Text style={[styles.hudVal, { color: c.text }]}>{formatTime(timer)}</Text>
            </View>
          </View>

          <View style={[styles.diffBadge, { backgroundColor: diff.color, marginBottom: 12 }]}>
            <Text style={styles.diffBadgeText}>{diff.label}</Text>
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
          <Text style={[styles.bigTitle, { color: rating.color }]}>{rating.label}</Text>

          <View style={[styles.statsCard, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff', borderColor: isDarkMode ? '#334155' : '#e2e8f0' }]}>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Moves</Text>
              <Text style={[styles.statVal, { color: '#F59E0B' }]}>{moves}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Time</Text>
              <Text style={[styles.statVal, { color: c.text }]}>{formatTime(timer)}</Text>
            </View>
            <View style={[styles.statRow, { borderBottomWidth: 0 }]}>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Pairs</Text>
              <Text style={[styles.statVal, { color: '#10B981' }]}>{diff.pairs}/{diff.pairs}</Text>
            </View>
          </View>

          {curBest > 0 && (
            <Text style={[styles.bestScoreLabel, { color: diff.color }]}>
              {moves <= curBest && moves > 0 ? '🎉 NEW BEST! 🎉' : `🏆 Best: ${curBest} moves`}
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
            <>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: diff.color, marginTop: 24, width: '100%', justifyContent: 'center' }]} onPress={startGame}>
                <Icon name="refresh" size={22} color="#fff" />
                <Text style={styles.actionBtnText}>Play Again ({roundInfo.roundsLeft} left)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#6366F1', marginTop: 10, width: '100%', justifyContent: 'center' }]} onPress={() => setPhase('rules')}>
                <Icon name="options-outline" size={22} color="#fff" />
                <Text style={styles.actionBtnText}>Change Difficulty</Text>
              </TouchableOpacity>
            </>
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

  bestScoreLabel: { fontSize: 16, fontWeight: '800', textAlign: 'center', marginTop: 16 },

  diffCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, marginBottom: 10, width: '100%' },
  diffLeft: { marginRight: 16 },
  diffLabel: { fontSize: 18, fontWeight: '900' },
  diffDesc: { fontSize: 12, marginTop: 4 },
  diffBest: { fontSize: 11, marginTop: 4, fontWeight: '700' },
  diffRadio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },

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
