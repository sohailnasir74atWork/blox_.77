/**
 * FruitCrash.jsx — Multiplayer Fruit Crash Mini Game
 *
 * Architecture:
 *   - Cloud Function controls round lifecycle + crash point (cheat-proof)
 *   - All clients listen to fruitCrash/currentRound via RTDB onValue
 *   - Multiplier is computed CLIENT-SIDE from startTime (no server ticks needed)
 *   - Cash out = write to fruitCrash/cashouts/{uid}
 *
 * RTDB paths (read):
 *   fruitCrash/currentRound   — phase, startTime, crashPoint, crashedAt
 *   fruitCrash/cashouts       — live feed of who cashed out
 *   fruitCrash/leaderboard    — all-time top players
 *   users/{uid}/fruitCrash    — personal stats
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions,
  Animated, StatusBar, ScrollView, FlatList, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Ionicons from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useGlobalState } from '../GlobelStats';
import { addXP } from './xpUtils';
import { ref, get, update, onValue, query, orderByChild, limitToLast } from '@react-native-firebase/database';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useThemeColors } from '../Helper/themeColors';

const { width } = Dimensions.get('window');

// ─── XP reward by multiplier ──────────────────────────────
const XP_FOR_MULTIPLIER = (x) => {
  if (x >= 50) return 100;
  if (x >= 20) return 60;
  if (x >= 10) return 35;
  if (x >= 5)  return 20;
  if (x >= 2)  return 10;
  return 5;
};

// ─── Multiplier → color ───────────────────────────────────
const getMultColor = (x) => {
  if (x >= 20) return '#FF6B35';
  if (x >= 10) return '#F59E0B';
  if (x >= 5)  return '#10B981';
  if (x >= 2)  return '#60A5FA';
  return '#A78BFA';
};

// ─── Compute live multiplier from startTime ───────────────
const computeMultiplier = (startTime) => {
  if (!startTime) return 1.0;
  const elapsed = Date.now() - startTime;
  if (elapsed <= 0) return 1.0;
  let mult = 1.0;
  let ms = 0;
  while (ms < elapsed) {
    const growth = mult < 2 ? 0.03 : mult < 5 ? 0.05 : mult < 10 ? 0.08 : 0.12;
    mult = parseFloat((mult + growth).toFixed(2));
    ms += 100;
  }
  return mult;
};

// ─── Crash history pill ───────────────────────────────────
const CrashPill = ({ value }) => {
  const color = getMultColor(value);
  return (
    <View style={[st.pill, { borderColor: color + '55', backgroundColor: color + '18' }]}>
      <Text style={[st.pillText, { color }]}>{value.toFixed(2)}x</Text>
    </View>
  );
};

// ─── Live cashout feed row ────────────────────────────────
const CashoutRow = ({ item, isMe, c }) => {
  const slideAnim = useRef(new Animated.Value(-40)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();
  }, []);

  const color = getMultColor(item.multiplier);

  return (
    <Animated.View style={[
      st.cashoutRow,
      {
        backgroundColor: isMe ? 'rgba(99,102,241,0.2)' : c.cardBg,
        borderColor: isMe ? 'rgba(99,102,241,0.4)' : c.cardBorder,
        transform: [{ translateX: slideAnim }], opacity: opacityAnim,
      },
    ]}>
      {item.avatar ? (
        <Image source={{ uri: item.avatar }} style={st.cashoutAvatar} />
      ) : (
        <View style={[st.cashoutAvatarPlaceholder, { backgroundColor: c.bgElevated }]}>
          <Text style={{ fontSize: 10 }}>👤</Text>
        </View>
      )}
      <Text style={[st.cashoutName, { color: c.text }]} numberOfLines={1}>
        {isMe ? 'You' : item.name}
      </Text>
      <View style={[st.cashoutMultPill, { backgroundColor: color + '25', borderColor: color + '60' }]}>
        <Text style={[st.cashoutMult, { color }]}>{item.multiplier?.toFixed(2)}x</Text>
      </View>
    </Animated.View>
  );
};

// ─── Leaderboard row ──────────────────────────────────────
const LeaderboardRow = ({ item, rank, isMe, c }) => {
  const rankColors = ['#F59E0B', '#94A3B8', '#CD7C2F'];
  const rankEmojis = ['🥇', '🥈', '🥉'];
  const color = getMultColor(item.best);

  return (
    <View style={[st.lbRow, {
      backgroundColor: isMe ? 'rgba(99,102,241,0.15)' : c.cardBg,
      borderWidth: isMe ? 1 : 0,
      borderColor: isMe ? 'rgba(99,102,241,0.35)' : 'transparent',
    }]}>
      <Text style={[st.lbRank, { color: rankColors[rank - 1] || c.textMuted }]}>
        {rank <= 3 ? rankEmojis[rank - 1] : `#${rank}`}
      </Text>
      {item.avatar ? (
        <Image source={{ uri: item.avatar }} style={st.lbAvatar} />
      ) : (
        <View style={[st.lbAvatarPlaceholder, { backgroundColor: c.bgElevated }]}>
          <Text style={{ fontSize: 12 }}>👤</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[st.lbName, { color: c.text }]} numberOfLines={1}>
          {isMe ? `${item.name} (You)` : item.name}
        </Text>
        <Text style={[st.lbRounds, { color: c.textMuted }]}>{item.totalRounds || 0} rounds</Text>
      </View>
      <Text style={[st.lbBest, { color }]}>{item.best?.toFixed(2)}x</Text>
    </View>
  );
};

// ═════════════════════════════════════════════════════════
//  MAIN SCREEN
// ═════════════════════════════════════════════════════════
export default function FruitCrash({ navigation }) {
  const insets = useSafeAreaInsets();
  const { appdatabase, user, theme } = useGlobalState();
  const isDark = theme === 'dark';
  const c = useThemeColors();
  const { triggerHapticFeedback } = useHaptic();

  const [tab, setTab] = useState('game');

  // ── Round state from server ───────────────────────────────
  const [round, setRound] = useState(null);
  const [phase, setPhase] = useState('waiting');
  const [countdown, setCountdown] = useState(10);

  // ── Live multiplier ───────────────────────────────────────
  const [multiplier, setMultiplier] = useState(1.0);
  const tickRef = useRef(null);

  // ── Cashouts feed ─────────────────────────────────────────
  const [cashouts, setCashouts] = useState({});

  // ── Leaderboard ───────────────────────────────────────────
  const [leaderboard, setLeaderboard] = useState([]);

  // ── My state ──────────────────────────────────────────────
  const [hasCashedOut, setHasCashedOut] = useState(false);
  const [myCashout, setMyCashout] = useState(null);
  const [bestMultiplier, setBestMultiplier] = useState(0);
  const [totalRounds, setTotalRounds] = useState(0);

  // ── Crash history ─────────────────────────────────────────
  const [history, setHistory] = useState([]);

  // ── Animated ──────────────────────────────────────────────
  const multScale = useRef(new Animated.Value(1)).current;
  const crashShake = useRef(new Animated.Value(0)).current;
  const resultOpacity = useRef(new Animated.Value(0)).current;

  // ─── Load personal stats ──────────────────────────────────
  useEffect(() => {
    if (!appdatabase || !user?.id) return;
    get(ref(appdatabase, `users/${user.id}/fruitCrash`)).then(snap => {
      if (snap.exists()) {
        const d = snap.val();
        setBestMultiplier(d.bestMultiplier || 0);
        setTotalRounds(d.totalRounds || 0);
      }
    });
  }, [appdatabase, user?.id]);

  // ─── Listen to current round (unsubscriber pattern) ───────
  useEffect(() => {
    if (!appdatabase) return;
    const unsub = onValue(ref(appdatabase, 'fruitCrash/currentRound'), (snap) => {
      const data = snap.val();
      if (!data) { setPhase('waiting'); setCountdown(10); return; }

      setRound(data);
      setPhase(data.phase);

      if (data.phase === 'waiting') {
        const remaining = Math.max(0, Math.ceil((data.startTime - Date.now()) / 1000));
        setCountdown(remaining);
        setMultiplier(1.0);
        setHasCashedOut(false);
        setMyCashout(null);
        resultOpacity.setValue(0);
      }

      if (data.phase === 'crashed' && data.crashPoint) {
        setHistory(prev => [data.crashPoint, ...prev].slice(0, 10));
      }
    });
    return unsub;
  }, [appdatabase]);

  // ─── Countdown ticker (waiting phase) ─────────────────────
  useEffect(() => {
    if (phase !== 'waiting' || !round?.startTime) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((round.startTime - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 250);
    return () => clearInterval(interval);
  }, [phase, round?.startTime]);

  // ─── Multiplier ticker (running phase) ────────────────────
  useEffect(() => {
    if (phase !== 'running' || !round?.startTime) {
      clearInterval(tickRef.current);
      return;
    }
    tickRef.current = setInterval(() => {
      const mult = computeMultiplier(round.startTime);
      setMultiplier(mult);
      const prev = parseFloat((mult - 0.03).toFixed(2));
      if (Math.floor(mult * 2) !== Math.floor(prev * 2)) {
        Animated.sequence([
          Animated.timing(multScale, { toValue: 1.1, duration: 70, useNativeDriver: true }),
          Animated.timing(multScale, { toValue: 1, duration: 70, useNativeDriver: true }),
        ]).start();
      }
    }, 100);
    return () => clearInterval(tickRef.current);
  }, [phase, round?.startTime]);

  // ─── Crash animation ──────────────────────────────────────
  useEffect(() => {
    if (phase !== 'crashed') return;
    clearInterval(tickRef.current);
    if (round?.crashPoint) setMultiplier(round.crashPoint);
    triggerHapticFeedback('heavy');

    Animated.sequence([
      Animated.timing(crashShake, { toValue: 12, duration: 50, useNativeDriver: true }),
      Animated.timing(crashShake, { toValue: -12, duration: 50, useNativeDriver: true }),
      Animated.timing(crashShake, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(crashShake, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(crashShake, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();

    Animated.timing(resultOpacity, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [phase]);

  // ─── Listen to cashouts (unsubscriber pattern) ────────────
  useEffect(() => {
    if (!appdatabase) return;
    // Bound to the 12 most-recent cashouts (the feed renders exactly 12).
    // Previously this pulled the ENTIRE shared cashouts node on every player's
    // cash-out — egress scaled ~O(players²) per round to display 12 rows.
    const unsub = onValue(
      query(ref(appdatabase, 'fruitCrash/cashouts'), orderByChild('cashedAt'), limitToLast(12)),
      (snap) => {
        setCashouts(snap.exists() ? snap.val() : {});
      }
    );
    return unsub;
  }, [appdatabase]);

  // ─── Fetch leaderboard once (no live listener — saves reads) ─
  const fetchLeaderboard = useCallback(() => {
    if (!appdatabase) return;
    get(ref(appdatabase, 'fruitCrash/leaderboard')).then(snap => {
      if (!snap.exists()) { setLeaderboard([]); return; }
      const entries = Object.entries(snap.val())
        .map(([uid, d]) => ({ uid, ...d }))
        .sort((a, b) => (b.best || 0) - (a.best || 0))
        .slice(0, 30);
      setLeaderboard(entries);
    });
  }, [appdatabase]);

  // Fetch on mount + refresh when switching to leaderboard tab
  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);
  useEffect(() => { if (tab === 'leaderboard') fetchLeaderboard(); }, [tab]);

  // ─── Cash out ─────────────────────────────────────────────
  const cashOut = useCallback(() => {
    if (phase !== 'running' || hasCashedOut || !user?.id || !appdatabase) return;

    const mult = computeMultiplier(round?.startTime);
    setHasCashedOut(true);
    setMyCashout(mult);
    triggerHapticFeedback('medium');

    const xp = XP_FOR_MULTIPLIER(mult);
    const isNewBest = mult > bestMultiplier;
    if (isNewBest) setBestMultiplier(mult);
    setTotalRounds(prev => prev + 1);

    const cashoutData = {
      name: user.displayName || 'Trader',
      avatar: user.avatar || null,
      multiplier: mult,
      cashedAt: Date.now(),
    };

    const updates = {
      [`fruitCrash/cashouts/${user.id}`]: cashoutData,
      [`users/${user.id}/fruitCrash/totalRounds`]: (totalRounds + 1),
      [`users/${user.id}/fruitCrash/lastPlayedDate`]: new Date().toISOString().split('T')[0],
    };
    if (isNewBest) updates[`users/${user.id}/fruitCrash/bestMultiplier`] = mult;

    update(ref(appdatabase), updates);
    addXP(appdatabase, user.id, xp, 'FRUIT_CRASH');

    Animated.timing(resultOpacity, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [phase, hasCashedOut, round?.startTime, user, appdatabase, bestMultiplier, totalRounds, triggerHapticFeedback]);

  // ─── Derived ──────────────────────────────────────────────
  const isWaiting  = phase === 'waiting';
  const isRunning  = phase === 'running';
  const hasCrashed = phase === 'crashed';
  const multColor  = getMultColor(multiplier);

  const cashoutsArray = useMemo(() =>
    Object.entries(cashouts)
      .map(([uid, d]) => ({ uid, ...d }))
      .sort((a, b) => (b.cashedAt || 0) - (a.cashedAt || 0)),
    [cashouts]
  );

  const bgColors = isDark
    ? hasCrashed ? ['#1a0505', '#2d0a0a'] : ['#0a0a18', '#0f0d22']
    : hasCrashed ? ['#fef2f2', '#fee2e2'] : [c.bg, c.bgAlt];

  const displayMult = hasCrashed && round?.crashPoint ? round.crashPoint : multiplier;

  // ── Theme-aware helper colors for inline styles ───────────
  const textMain = c.text;
  const textSub  = c.textSecondary;
  const textDim  = c.textMuted;
  const cardBg   = c.cardBg;
  const divColor = c.divider;

  return (
    <View style={{ flex: 1 }}>
      <StatusBar barStyle={c.statusBar} />
      <LinearGradient colors={bgColors} style={{ flex: 1 }}>

        {/* ── Header ── */}
        <View style={[st.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={[st.backBtn, { backgroundColor: c.closeBg }]} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={24} color={textMain} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[st.headerTitle, { color: textMain }]}>Fruit Crash</Text>
            <View style={st.playersBadge}>
              <View style={st.liveIndicator} />
              <Text style={[st.playersText, { color: textDim }]}>
                {cashoutsArray.length > 0 ? `${cashoutsArray.length}${cashoutsArray.length >= 12 ? '+' : ''} cashed out` : 'Live'}
              </Text>
            </View>
          </View>
          <View style={st.headerRight}>
            <FontAwesome name="trophy" size={12} color="#F59E0B" solid />
            <Text style={st.headerBest}>
              {bestMultiplier > 0 ? bestMultiplier.toFixed(2) + 'x' : '—'}
            </Text>
          </View>
        </View>

        {/* ── Tab bar ── */}
        <View style={[st.tabBar, { backgroundColor: cardBg }]}>
          <TouchableOpacity
            style={[st.tabBtn, tab === 'game' && [st.tabBtnActive, { backgroundColor: c.bgElevated }]]}
            onPress={() => setTab('game')}
            activeOpacity={0.7}
          >
            <Text style={[st.tabLabel, { color: textDim }, tab === 'game' && { color: textMain }]}>Game</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[st.tabBtn, tab === 'leaderboard' && [st.tabBtnActive, { backgroundColor: c.bgElevated }]]}
            onPress={() => setTab('leaderboard')}
            activeOpacity={0.7}
          >
            <Text style={[st.tabLabel, { color: textDim }, tab === 'leaderboard' && { color: textMain }]}>All-Time Board</Text>
          </TouchableOpacity>
        </View>

        {tab === 'game' ? (
          <>
            {/* ── Crash history ── */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={st.historyRow}
              style={st.historyScroll}
            >
              {history.length === 0
                ? <Text style={[st.historyEmpty, { color: textDim }]}>Crash history will appear here</Text>
                : history.map((v, i) => <CrashPill key={i} value={v} />)
              }
            </ScrollView>

            {/* ── Arena ── */}
            <Animated.View style={[st.arena, { transform: [{ translateX: crashShake }] }]}>

              <Animated.View style={{ transform: [{ scale: multScale }], alignItems: 'center' }}>
                {isWaiting ? (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={[st.waitingLabel, { color: textDim }]}>Next round in</Text>
                    <Text style={[st.countdownText, { color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)' }]}>
                      {countdown}s
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text style={[st.multValue, { color: hasCrashed ? '#EF4444' : multColor }]}>
                      {displayMult.toFixed(2)}x
                    </Text>
                    {hasCrashed && <Text style={st.crashedLabel}>CRASHED!</Text>}
                  </>
                )}
              </Animated.View>

              <Text style={[st.rocket, isWaiting && { opacity: 0.4 }]}>
                {hasCrashed ? '💥' : '🚀'}
              </Text>

              {/* Result overlay */}
              {(hasCashedOut || hasCrashed) && (
                <Animated.View style={[st.resultOverlay, { opacity: resultOpacity }]}>
                  {hasCashedOut ? (
                    <View style={[st.resultCard, { backgroundColor: isDark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)' }]}>
                      <Text style={st.resultEmoji}>💰</Text>
                      <Text style={st.resultTitle}>Cashed Out!</Text>
                      <Text style={[st.resultMult, { color: textMain }]}>{myCashout?.toFixed(2)}x</Text>
                      <Text style={st.resultXp}>+{XP_FOR_MULTIPLIER(myCashout || 1)} XP</Text>
                      {myCashout > bestMultiplier && (
                        <View style={st.newBestBadge}>
                          <Text style={st.newBestText}>NEW BEST!</Text>
                        </View>
                      )}
                      {hasCrashed && round?.crashPoint && (
                        <Text style={[st.resultSub, { color: textDim }]}>
                          Crashed at {round.crashPoint.toFixed(2)}x — nice timing!
                        </Text>
                      )}
                    </View>
                  ) : (
                    <View style={[st.resultCard, { backgroundColor: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.35)' }]}>
                      <Text style={st.resultEmoji}>💥</Text>
                      <Text style={[st.resultTitle, { color: '#EF4444' }]}>
                        Crashed at {round?.crashPoint?.toFixed(2)}x
                      </Text>
                      <Text style={[st.resultSub, { color: textDim }]}>Cash out faster next time!</Text>
                    </View>
                  )}
                </Animated.View>
              )}
            </Animated.View>

            {/* ── Live cashout feed ── */}
            {cashoutsArray.length > 0 && (
              <View style={st.feedWrap}>
                <Text style={[st.feedTitle, { color: textDim }]}>Live Cashouts</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}
                >
                  {cashoutsArray.slice(0, 12).map(item => (
                    <CashoutRow key={item.uid} item={item} isMe={item.uid === user?.id} c={c} />
                  ))}
                </ScrollView>
              </View>
            )}

            {/* ── Stats row ── */}
            <View style={[st.statsRow, { backgroundColor: cardBg }]}>
              <View style={st.statBox}>
                <Text style={[st.statLabel, { color: textDim }]}>My Best</Text>
                <Text style={[st.statValue, { color: '#F59E0B' }]}>
                  {bestMultiplier > 0 ? bestMultiplier.toFixed(2) + 'x' : '—'}
                </Text>
              </View>
              <View style={[st.statDivider, { backgroundColor: divColor }]} />
              <View style={st.statBox}>
                <Text style={[st.statLabel, { color: textDim }]}>Rounds</Text>
                <Text style={[st.statValue, { color: '#60A5FA' }]}>{totalRounds}</Text>
              </View>
              <View style={[st.statDivider, { backgroundColor: divColor }]} />
              <View style={st.statBox}>
                <Text style={[st.statLabel, { color: textDim }]}>Players</Text>
                <Text style={[st.statValue, { color: '#10B981' }]}>
                  {leaderboard.length > 0 ? leaderboard.length + '+' : '—'}
                </Text>
              </View>
            </View>

            {/* ── Action button ── */}
            <View style={[st.btnWrap, { paddingBottom: insets.bottom + 20 }]}>
              {isWaiting && (
                <View style={[st.mainBtn, { backgroundColor: cardBg }]}>
                  <Text style={[st.mainBtnText, { color: textSub }]}>
                    Waiting for next round... {countdown}s
                  </Text>
                </View>
              )}

              {isRunning && !hasCashedOut && (
                <TouchableOpacity onPress={cashOut} activeOpacity={0.85}>
                  <LinearGradient
                    colors={['#10B981', '#059669']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[st.mainBtn, st.cashBtn]}
                  >
                    <Text style={[st.mainBtnText, { fontSize: 22, color: '#fff' }]}>
                      CASH OUT  {multiplier.toFixed(2)}x
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}

              {isRunning && hasCashedOut && (
                <View style={[st.mainBtn, { backgroundColor: 'rgba(16,185,129,0.15)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)' }]}>
                  <Text style={[st.mainBtnText, { color: '#10B981' }]}>
                    Cashed at {myCashout?.toFixed(2)}x ✓
                  </Text>
                </View>
              )}

              {hasCrashed && (
                <View style={[st.mainBtn, { backgroundColor: cardBg }]}>
                  <Text style={[st.mainBtnText, { color: textSub }]}>Next round starting soon...</Text>
                </View>
              )}
            </View>
          </>
        ) : (
          /* ── LEADERBOARD TAB ── */
          <View style={{ flex: 1 }}>
            <View style={st.lbHeader}>
              <Text style={[st.lbHeaderTitle, { color: textMain }]}>All-Time Best Multipliers</Text>
              <Text style={[st.lbHeaderSub, { color: textDim }]}>Best single cash-out ever</Text>
            </View>
            {leaderboard.length === 0 ? (
              <View style={st.lbEmpty}>
                <Text style={[st.lbEmptyText, { color: textDim }]}>No data yet — play to appear!</Text>
              </View>
            ) : (
              <FlatList
                data={leaderboard}
                keyExtractor={item => item.uid}
                contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingTop: 8 }}
                renderItem={({ item, index }) => (
                  <LeaderboardRow item={item} rank={index + 1} isMe={item.uid === user?.id} c={c} />
                )}
              />
            )}

            {user?.id && leaderboard.findIndex(x => x.uid === user.id) === -1 && bestMultiplier > 0 && (
              <View style={[st.myRankCard, { backgroundColor: cardBg, marginBottom: insets.bottom + 16 }]}>
                <Text style={[st.myRankLabel, { color: textMain }]}>Your best: {bestMultiplier.toFixed(2)}x</Text>
                <Text style={[st.myRankSub, { color: textDim }]}>Keep playing to climb the board!</Text>
              </View>
            )}
          </View>
        )}

      </LinearGradient>
    </View>
  );
}

const st = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  playersBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  liveIndicator: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981' },
  playersText: { fontSize: 11, fontWeight: '600' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 64, justifyContent: 'flex-end' },
  headerBest: { color: '#F59E0B', fontSize: 13, fontWeight: '700' },

  tabBar: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 8, borderRadius: 12, padding: 3 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabBtnActive: {},
  tabLabel: { fontSize: 13, fontWeight: '600' },

  historyScroll: { maxHeight: 34, marginBottom: 2 },
  historyRow: { paddingHorizontal: 16, gap: 6, alignItems: 'center' },
  historyEmpty: { fontSize: 11, fontStyle: 'italic' },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 11, fontWeight: '700' },

  arena: { flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  waitingLabel: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  countdownText: { fontSize: 72, fontWeight: '900', letterSpacing: -2 },
  multValue: {
    fontSize: 68, fontWeight: '900', letterSpacing: -2,
    textShadowColor: 'rgba(0,0,0,0.15)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8,
  },
  crashedLabel: { color: '#EF4444', fontSize: 16, fontWeight: '800', letterSpacing: 2, marginTop: -6 },
  rocket: { fontSize: 48, marginTop: 8 },

  resultOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  resultCard: {
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.4)',
    borderRadius: 24, padding: 24, alignItems: 'center', gap: 4, minWidth: 200,
  },
  resultEmoji: { fontSize: 36, marginBottom: 4 },
  resultTitle: { color: '#10B981', fontSize: 18, fontWeight: '800' },
  resultMult: { fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  resultXp: { color: '#A78BFA', fontSize: 15, fontWeight: '700', marginTop: 2 },
  resultSub: { fontSize: 12, marginTop: 4, textAlign: 'center' },
  newBestBadge: {
    backgroundColor: '#F59E0B', paddingHorizontal: 12, paddingVertical: 3, borderRadius: 20, marginTop: 6,
  },
  newBestText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  feedWrap: { marginBottom: 6 },
  feedTitle: {
    fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.5, paddingHorizontal: 16, marginBottom: 6,
  },
  cashoutRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1,
  },
  cashoutAvatar: { width: 22, height: 22, borderRadius: 11 },
  cashoutAvatarPlaceholder: {
    width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
  },
  cashoutName: { fontSize: 12, fontWeight: '600', maxWidth: 70 },
  cashoutMultPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  cashoutMult: { fontSize: 12, fontWeight: '800' },

  statsRow: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 12,
    borderRadius: 14, paddingVertical: 12, paddingHorizontal: 8,
  },
  statBox: { flex: 1, alignItems: 'center', gap: 2 },
  statLabel: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { fontSize: 17, fontWeight: '800' },
  statDivider: { width: 1, marginVertical: 4 },

  btnWrap: { paddingHorizontal: 16 },
  mainBtn: { borderRadius: 16, paddingVertical: 17, alignItems: 'center', justifyContent: 'center' },
  cashBtn: {
    paddingVertical: 22,
    shadowColor: '#10B981', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  mainBtnText: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },

  lbHeader: { paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  lbHeaderTitle: { fontSize: 16, fontWeight: '800' },
  lbHeaderSub: { fontSize: 12, marginTop: 2 },
  lbEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lbEmptyText: { fontSize: 14 },
  lbRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 8, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
  },
  lbRank: { width: 28, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  lbAvatar: { width: 32, height: 32, borderRadius: 16 },
  lbAvatarPlaceholder: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
  },
  lbName: { fontSize: 14, fontWeight: '700' },
  lbRounds: { fontSize: 11, marginTop: 1 },
  lbBest: { fontSize: 16, fontWeight: '900' },
  myRankCard: { marginHorizontal: 16, borderRadius: 14, padding: 14, alignItems: 'center' },
  myRankLabel: { fontSize: 14, fontWeight: '700' },
  myRankSub: { fontSize: 12, marginTop: 3 },
});
