/**
 * GameLeaderboard.js
 * Optimized Leaderboard — reads from pre-computed cache (1 Firestore read)
 * Shows top 20 with premium top-3 cards, paginated list, and 2-day local cache
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Image,
  Dimensions,
  Platform,
  Animated,
} from 'react-native';
import ViewShot from 'react-native-view-shot';
import Share from 'react-native-share';
import Icon from 'react-native-vector-icons/Ionicons';
import { getThemeColors } from '../Helper/themeColors';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { doc, getDoc, collection, query, orderBy, limit, getDocs } from '@react-native-firebase/firestore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CACHE_DURATION_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
const INITIAL_LIST_SIZE = 7;

const GAMES_CONFIG = [
  { id: 'whack',  name: 'Fruit Smash',     emoji: '🍎', color: '#EF4444', gradient: ['#EF4444', '#B91C1C'], order: 'desc', label: 'pts' },
  { id: 'safe',   name: 'Crack the Chest',  emoji: '🔐', color: '#F59E0B', gradient: ['#F59E0B', '#D97706'], order: 'desc', label: 'pts' },
  { id: 'draw',   name: 'Fruit Slash',      emoji: '⚡', color: '#8B5CF6', gradient: ['#8B5CF6', '#6D28D9'], order: 'asc',  label: 'ms' },
  { id: 'memory', name: 'Memory Match',     emoji: '🃏', color: '#3B82F6', gradient: ['#3B82F6', '#1D4ED8'], order: 'asc',  label: 'moves' },
];

const RANK_CONFIG = {
  1: { emoji: '👑', medal: '🥇', bg: ['#FFD700', '#FFA000'], badgeColor: '#FFD700', size: 82 },
  2: { emoji: '🥈', medal: '🥈', bg: ['#C0C0C0', '#8C8C8C'], badgeColor: '#C0C0C0', size: 70 },
  3: { emoji: '🥉', medal: '🥉', bg: ['#CD7F32', '#8B4513'], badgeColor: '#CD7F32', size: 70 },
};

const GameLeaderboard = ({ visible, onClose }) => {
  const { firestoreDB, user, theme } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);

  const [activeTab, setActiveTab] = useState(GAMES_CONFIG[0]);
  const [loading, setLoading] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const shareCardRef = useRef();

  const scaleAnim1 = useRef(new Animated.Value(0)).current;
  const scaleAnim2 = useRef(new Animated.Value(0)).current;
  const scaleAnim3 = useRef(new Animated.Value(0)).current;

  const isCacheValid = useCallback((cachedData) => {
    if (!cachedData?.timestamp) return false;
    const ts = typeof cachedData.timestamp === 'number' ? cachedData.timestamp : parseInt(cachedData.timestamp, 10);
    if (!ts || isNaN(ts)) return false;
    return (Date.now() - ts) < CACHE_DURATION_MS;
  }, []);

  const animateTop3 = useCallback(() => {
    scaleAnim1.setValue(0);
    scaleAnim2.setValue(0);
    scaleAnim3.setValue(0);
    Animated.stagger(120, [
      Animated.spring(scaleAnim2, { toValue: 1, tension: 200, friction: 12, useNativeDriver: true }),
      Animated.spring(scaleAnim1, { toValue: 1, tension: 200, friction: 12, useNativeDriver: true }),
      Animated.spring(scaleAnim3, { toValue: 1, tension: 200, friction: 12, useNativeDriver: true }),
    ]).start();
  }, [scaleAnim1, scaleAnim2, scaleAnim3]);

  const fetchLeaderboard = useCallback(async (gameConfig) => {
    if (!firestoreDB) return;
    setLoading(true);
    setShowAll(false);
    try {
      let users = [];

      // 1. Try pre-computed cache first (1 Firestore read!)
      try {
        const cacheDocRef = doc(firestoreDB, 'game_leaderboard_cache', gameConfig.id);
        const cacheSnap = await getDoc(cacheDocRef);
        if (cacheSnap.exists()) {
          const cacheData = cacheSnap.data();
          users = cacheData?.users || [];
        }
      } catch (cacheErr) {
        // silent fallback
      }

      // 2. Fallback: query game_scores directly
      if (users.length === 0) {
        try {
          const scoresRef = collection(firestoreDB, 'game_scores', gameConfig.id, 'scores');
          const q = query(
            scoresRef,
            orderBy('score', gameConfig.order),
            limit(20)
          );
          const snap = await getDocs(q);
          users = snap.docs.map(d => {
            const data = d.data();
            return {
              uid: d.id,
              score: data.score || 0,
              username: data.username || 'Unknown',
              avatar: data.avatar || null,
            };
          }).filter(item => item.score > 0);

          if (gameConfig.order === 'asc') {
            users = users.filter(item => item.score < 999);
          }
        } catch (fallbackErr) {
          // silent
        }
      }

      // 3. Last resort: legacy query from games collection
      if (users.length === 0) {
        try {
          const LEGACY_FIELDS = {
            whack: 'whackBestScore',
            safe: 'safeCrackBestScore',
            draw: 'drawBestTime',
            memory: 'memoryBestMoves_medium',
          };
          const field = LEGACY_FIELDS[gameConfig.id];
          if (field) {
            const q = query(
              collection(firestoreDB, 'games'),
              orderBy(field, gameConfig.order),
              limit(20)
            );
            const snap = await getDocs(q);
            users = snap.docs.map(d => ({
              uid: d.id,
              score: d.data()[field] || 0,
              username: d.id.substring(0, 8) + '...',
              avatar: null,
            })).filter(item => item.score > 0);
            if (gameConfig.order === 'asc') {
              users = users.filter(item => item.score < 999);
            }
          }
        } catch (legacyErr) {
          // silent
        }
      }

      users.sort((a, b) => gameConfig.order === 'asc' ? a.score - b.score : b.score - a.score);
      users = users.slice(0, 20);

      setLeaderboardData(users);
      animateTop3();

      const cacheData = {
        data: users,
        timestamp: Date.now(),
        lastFetched: new Date().toISOString(),
      };
      updateLocalState(`gameLeaderboard_${gameConfig.id}`, cacheData);

    } catch (error) {
      setLeaderboardData([]);
    } finally {
      setLoading(false);
    }
  }, [firestoreDB, animateTop3, updateLocalState]);

  useEffect(() => {
    if (!visible) return;

    const cachedData = localState[`gameLeaderboard_${activeTab.id}`];
    if (cachedData?.data?.length > 0 && isCacheValid(cachedData)) {
      setLeaderboardData(cachedData.data);
      setShowAll(false);
      setLoading(false);
      animateTop3();
    } else {
      fetchLeaderboard(activeTab);
    }
  }, [visible, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderPremiumCard = (player, rank, scaleAnim) => {
    const rankCfg = RANK_CONFIG[rank];
    const isFirst = rank === 1;

    return (
      <Animated.View key={`rank-${rank}`} style={[
        styles.premiumCard,
        {
          transform: [{ scale: scaleAnim }],
          width: isFirst ? '36%' : '29%',
          marginTop: isFirst ? 0 : 20,
        },
      ]}>
        <View
          style={[
            styles.premiumCardInner,
            {
              borderColor: rankCfg.badgeColor + '50',
              backgroundColor: isDarkMode ? config.colors.surfaceDark : '#fff',
            },
          ]}
        >
          <Text style={[styles.premiumMedal, { fontSize: isFirst ? 28 : 22 }]}>
            {rankCfg.emoji}
          </Text>

          <View style={[styles.premiumAvatarWrap, {
            borderColor: rankCfg.badgeColor,
            width: rankCfg.size,
            height: rankCfg.size,
            borderRadius: rankCfg.size / 2,
          }]}>
            {player.avatar ? (
              <Image
                source={{ uri: player.avatar }}
                style={[styles.premiumAvatar, {
                  width: rankCfg.size - 6,
                  height: rankCfg.size - 6,
                  borderRadius: (rankCfg.size - 6) / 2,
                }]}
              />
            ) : (
              <View style={[styles.premiumAvatar, {
                width: rankCfg.size - 6,
                height: rankCfg.size - 6,
                borderRadius: (rankCfg.size - 6) / 2,
                backgroundColor: isDarkMode ? '#334155' : '#e2e8f0',
                justifyContent: 'center',
                alignItems: 'center',
              }]}>
                <Icon name="person" size={isFirst ? 28 : 22} color={isDarkMode ? '#64748b' : '#94a3b8'} />
              </View>
            )}
          </View>

          <View style={[styles.premiumRankBadge, { backgroundColor: rankCfg.badgeColor }]}>
            <Text style={styles.premiumRankText}>{rank}</Text>
          </View>

          <Text
            style={[styles.premiumName, { color: c.text, fontSize: isFirst ? 14 : 12 }]}
            numberOfLines={1}
          >
            {player.username}
          </Text>

          <View style={[styles.premiumScoreBadge, { backgroundColor: activeTab.color + '20' }]}>
            <Text style={[styles.premiumScore, { color: activeTab.color, fontSize: isFirst ? 16 : 14 }]}>
              {player.score}
            </Text>
            <Text style={[styles.premiumScoreLabel, { color: activeTab.color + '90' }]}>
              {activeTab.label}
            </Text>
          </View>
        </View>
      </Animated.View>
    );
  };

  const userRankInfo = useMemo(() => {
    if (!user?.id || leaderboardData.length === 0) return null;
    const idx = leaderboardData.findIndex(p => p.uid === user.id);
    if (idx === -1) return null;
    return { rank: idx + 1, score: leaderboardData[idx].score, username: leaderboardData[idx].username, avatar: leaderboardData[idx].avatar };
  }, [user?.id, leaderboardData]);

  const getRankSuffix = (rank) => {
    if (rank === 1) return 'st';
    if (rank === 2) return 'nd';
    if (rank === 3) return 'rd';
    return 'th';
  };

  const handleShareAchievement = useCallback(async () => {
    if (!shareCardRef.current || !userRankInfo || isSharing) return;
    setIsSharing(true);
    try {
      const uri = await shareCardRef.current.capture();
      onClose();
      setTimeout(async () => {
        try {
          await Share.open({
            url: uri,
            type: 'image/png',
            failOnCancel: false,
            title: `My ${activeTab.name} Rank on Blox Fruit Values!`,
          });
        } catch (shareErr) {
          // silent
        } finally {
          setIsSharing(false);
        }
      }, Platform.OS === 'ios' ? 600 : 200);
    } catch (err) {
      setIsSharing(false);
    }
  }, [activeTab, userRankInfo, isSharing, onClose]);

  const renderOffScreenShareCard = () => {
    const info = userRankInfo;
    if (!info) return null;

    const gameName = activeTab.name;
    const gameEmoji = activeTab.emoji;
    const gameColor = activeTab.color;
    const rankNum = info.rank;
    const scoreNum = info.score;
    const isTop3 = rankNum <= 3;
    const rankMedal = isTop3 ? RANK_CONFIG[rankNum]?.medal : '';

    return (
      <View style={{ position: 'absolute', left: -9999, top: -9999, width: SCREEN_WIDTH * 0.88 }}>
        <ViewShot ref={shareCardRef} options={{ format: 'png', quality: 1.0 }}>
          <View style={{
            borderRadius: 28,
            overflow: 'hidden',
            backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
          }}>
            <View style={{
              backgroundColor: gameColor,
              paddingTop: 32,
              paddingBottom: 40,
              alignItems: 'center',
              position: 'relative',
            }}>
              <View style={{ position: 'absolute', top: -20, left: -20, width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.1)' }} />
              <View style={{ position: 'absolute', bottom: -30, right: -10, width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.08)' }} />

              <Text style={{ fontSize: 48, marginBottom: 4 }}>{gameEmoji}</Text>
              <Text style={{ fontSize: 20, fontWeight: '900', color: '#fff', textAlign: 'center', letterSpacing: 0.5 }}>
                {gameName}
              </Text>
              <Text style={{ fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
                🏆 GAME LEADERBOARD
              </Text>
            </View>

            <View style={{ alignItems: 'center', marginTop: -30 }}>
              <View style={{
                width: 76, height: 76, borderRadius: 38,
                borderWidth: 4, borderColor: isDarkMode ? '#0f172a' : '#ffffff',
                backgroundColor: isDarkMode ? '#1e293b' : '#e2e8f0',
                alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
              }}>
                {info.avatar ? (
                  <Image source={{ uri: info.avatar }} style={{ width: 68, height: 68, borderRadius: 34 }} />
                ) : (
                  <Icon name="person" size={32} color={isDarkMode ? '#64748b' : '#94a3b8'} />
                )}
              </View>
            </View>

            <View style={{ alignItems: 'center', paddingTop: 14, paddingHorizontal: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: isDarkMode ? '#f1f5f9' : '#1e293b', textAlign: 'center' }} numberOfLines={1}>
                {info.username || 'Player'}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 16 }}>
              <View style={{
                flex: 1, borderRadius: 16, padding: 14,
                backgroundColor: isDarkMode ? '#1e293b' : '#f8fafc',
                borderWidth: 1, borderColor: isDarkMode ? '#334155' : '#e2e8f0',
                alignItems: 'center',
              }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: isDarkMode ? '#94a3b8' : '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Rank
                </Text>
                <Text style={{ fontSize: 32, fontWeight: '900', color: gameColor }}>
                  {rankMedal || ''} {rankNum}{getRankSuffix(rankNum)}
                </Text>
              </View>
              <View style={{
                flex: 1, borderRadius: 16, padding: 14,
                backgroundColor: isDarkMode ? '#1e293b' : '#f8fafc',
                borderWidth: 1, borderColor: isDarkMode ? '#334155' : '#e2e8f0',
                alignItems: 'center',
              }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: isDarkMode ? '#94a3b8' : '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Score
                </Text>
                <Text style={{ fontSize: 32, fontWeight: '900', color: isDarkMode ? '#f1f5f9' : '#1e293b' }}>
                  {scoreNum}
                </Text>
                <Text style={{ fontSize: 11, fontWeight: '600', color: isDarkMode ? '#64748b' : '#94a3b8', marginTop: 2 }}>
                  {activeTab.label}
                </Text>
              </View>
            </View>

            <View style={{ alignItems: 'center', paddingVertical: 14 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: isDarkMode ? '#64748b' : '#94a3b8' }}>
                {isTop3 ? '🔥 Top 3 Player!' : rankNum <= 10 ? '⭐ Top 10!' : '💪 Keep Climbing!'}
              </Text>
            </View>

            <View style={{
              backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
              paddingVertical: 10, paddingHorizontal: 16,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
              borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
            }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: isDarkMode ? '#475569' : '#94a3b8' }}>
                🍎 Blox Fruit Values App
              </Text>
            </View>
          </View>
        </ViewShot>
      </View>
    );
  };

  const renderTop3 = () => {
    if (!leaderboardData || leaderboardData.length < 1) return null;
    const [first, second, third] = leaderboardData.slice(0, 3);

    return (
      <View style={styles.podiumSection}>
        <View style={styles.podiumRow}>
          {second && renderPremiumCard(second, 2, scaleAnim2)}
          {first && renderPremiumCard(first, 1, scaleAnim1)}
          {third && renderPremiumCard(third, 3, scaleAnim3)}
        </View>
        <View style={[styles.sectionDivider, { backgroundColor: isDarkMode ? config.colors.surfaceDark : '#e2e8f0' }]} />
      </View>
    );
  };

  const renderListItem = ({ item, index }) => {
    const rank = index + 1;
    if (rank <= 3) return null;
    if (!showAll && rank > 3 + INITIAL_LIST_SIZE) return null;

    const isCurrentUser = item.uid === user?.id;

    return (
      <View style={[
        styles.listItem,
        {
          backgroundColor: isCurrentUser
            ? (isDarkMode ? '#1e3a5f' : '#FEF3C7')
            : (isDarkMode ? `${config.colors.surfaceDark}22` : 'transparent'),
        },
      ]}>
        <View style={[styles.listRankBadge, {
          backgroundColor: isDarkMode ? '#334155' : '#f1f5f9',
        }]}>
          <Text style={[styles.listRankText, { color: c.textSecondary }]}>{rank}</Text>
        </View>

        {item.avatar ? (
          <Image source={{ uri: item.avatar }} style={styles.listAvatar} />
        ) : (
          <View style={[styles.listAvatar, {
            backgroundColor: isDarkMode ? '#334155' : '#e2e8f0',
            justifyContent: 'center',
            alignItems: 'center',
          }]}>
            <Icon name="person" size={16} color={isDarkMode ? '#64748b' : '#94a3b8'} />
          </View>
        )}

        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <Text style={[styles.listName, { color: c.text }]} numberOfLines={1}>
            {item.username}
          </Text>
          {isCurrentUser && (
            <Text style={[styles.youBadge, { color: activeTab.color }]}>You ⭐</Text>
          )}
        </View>

        <View style={[styles.listScoreBadge, { backgroundColor: activeTab.color + '15' }]}>
          <Text style={[styles.listScore, { color: activeTab.color }]}>
            {item.score} {activeTab.label}
          </Text>
        </View>
      </View>
    );
  };

  const renderFooter = () => {
    if (leaderboardData.length <= 3 + INITIAL_LIST_SIZE) return null;
    if (showAll) return null;

    const remaining = leaderboardData.length - 3 - INITIAL_LIST_SIZE;
    if (remaining <= 0) return null;

    return (
      <TouchableOpacity
        style={[styles.loadMoreBtn, { borderColor: activeTab.color + '40' }]}
        onPress={() => setShowAll(true)}
        activeOpacity={0.7}
      >
        <Icon name="chevron-down" size={18} color={activeTab.color} />
        <Text style={[styles.loadMoreText, { color: activeTab.color }]}>
          Show {remaining} more
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <>
    {renderOffScreenShareCard()}
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[styles.overlay, { backgroundColor: isDarkMode ? 'rgba(0,0,0,0.92)' : 'rgba(0,0,0,0.7)' }]}>
        <View style={[styles.modal, { backgroundColor: isDarkMode ? config.colors.backgroundDark : '#f8fafc' }]}>

          <View style={styles.handleBar}>
            <View style={[styles.handle, { backgroundColor: c.border }]} />
          </View>

          <View style={styles.header}>
            <Text style={[styles.title, { color: c.text }]}>Game Leaders 🏆</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Icon name="close" size={22} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={styles.tabsWrapper}>
            <FlatList
              data={GAMES_CONFIG}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.tabsContainer}
              renderItem={({ item }) => {
                const isActive = activeTab.id === item.id;
                return (
                  <TouchableOpacity
                    style={[styles.tabBtn, {
                      backgroundColor: isActive ? item.color : (isDarkMode ? config.colors.surfaceDark : '#e2e8f0'),
                      borderColor: isActive ? item.color : (isDarkMode ? '#334155' : '#cbd5e1'),
                    }]}
                    onPress={() => setActiveTab(item)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 16 }}>{item.emoji}</Text>
                    <Text style={[styles.tabText, { color: isActive ? '#fff' : c.textSecondary }]}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>

          <View style={styles.subHeader}>
            <Text style={[styles.subHeaderText, { color: c.textSecondary }]}>
              Top 20 — Updated daily
            </Text>
          </View>

          {/* Content */}
          {loading ? (
            <View style={styles.centerContent}>
              <ActivityIndicator size="large" color={activeTab.color} />
              <Text style={[styles.loadingText, { color: c.textSecondary }]}>Loading ranks...</Text>
            </View>
          ) : leaderboardData.length === 0 ? (
            <View style={styles.centerContent}>
              <Text style={{ fontSize: 48, opacity: 0.5 }}>🤷‍♂️</Text>
              <Text style={[styles.emptyText, { color: c.textSecondary }]}>No scores yet</Text>
              <Text style={[styles.emptySub, { color: c.textSecondary }]}>
                Play a game to get ranked!
              </Text>
            </View>
          ) : (
            <FlatList
              data={leaderboardData}
              keyExtractor={(item, i) => item.uid || `item-${i}`}
              ListHeaderComponent={renderTop3}
              renderItem={renderListItem}
              ListFooterComponent={renderFooter}
              contentContainerStyle={{ paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
            />
          )}

          {/* Footer Share */}
          <View style={[styles.footer, { borderTopColor: isDarkMode ? config.colors.surfaceDark : '#e2e8f0' }]}>
            <TouchableOpacity
              style={[styles.shareBtn, { backgroundColor: activeTab.color, opacity: (userRankInfo && !isSharing) ? 1 : 0.5 }]}
              onPress={handleShareAchievement}
              disabled={!userRankInfo || isSharing}
            >
              <Icon name="share-outline" size={20} color="#fff" />
              <Text style={styles.shareBtnText}>
                {isSharing ? 'Sharing...' : userRankInfo ? 'Share Achievement' : 'Not Ranked Yet'}
              </Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  modal: { width: '100%', borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '85%', overflow: 'hidden' },
  handleBar: { alignItems: 'center', paddingTop: 8, marginBottom: 4 },
  handle: { width: 40, height: 4, borderRadius: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800' },
  closeBtn: { padding: 8 },

  tabsWrapper: { marginBottom: 12 },
  tabsContainer: { paddingHorizontal: 16, gap: 8 },
  tabBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 100, borderWidth: 1,
  },
  tabText: { fontSize: 13, fontWeight: '800' },

  subHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(128,128,128,0.1)',
  },
  subHeaderText: { fontSize: 12, fontWeight: '600' },

  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, fontWeight: '600' },
  emptyText: { fontSize: 18, fontWeight: '800', marginTop: 12 },
  emptySub: { fontSize: 13, marginTop: 4 },

  podiumSection: { paddingTop: 16, paddingBottom: 4 },
  podiumRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end',
    paddingHorizontal: 12, gap: 8,
  },
  premiumCard: { alignItems: 'center' },
  premiumCardInner: {
    borderRadius: 20, borderWidth: 1.5, padding: 14,
    alignItems: 'center', width: '100%',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12 },
      android: { elevation: 6 },
    }),
  },
  premiumMedal: { marginBottom: 6 },
  premiumAvatarWrap: {
    borderWidth: 3, alignItems: 'center', justifyContent: 'center', marginBottom: 8,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6 },
      android: { elevation: 4 },
    }),
  },
  premiumAvatar: {},
  premiumRankBadge: {
    position: 'absolute', bottom: 60, alignSelf: 'center',
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
      android: { elevation: 5 },
    }),
  },
  premiumRankText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  premiumName: { fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  premiumScoreBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, alignItems: 'center' },
  premiumScore: { fontWeight: '900' },
  premiumScoreLabel: { fontSize: 9, fontWeight: '700', marginTop: 1 },

  sectionDivider: { height: 1, marginHorizontal: 16, marginTop: 16, marginBottom: 4 },

  listItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(128,128,128,0.08)',
  },
  listRankBadge: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  listRankText: { fontSize: 13, fontWeight: '800' },
  listAvatar: { width: 40, height: 40, borderRadius: 20, marginLeft: 10 },
  listName: { fontSize: 15, fontWeight: '700' },
  youBadge: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  listScoreBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  listScore: { fontSize: 13, fontWeight: '900' },

  loadMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginHorizontal: 16, marginTop: 8, paddingVertical: 14,
    borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed',
  },
  loadMoreText: { fontSize: 14, fontWeight: '700' },

  footer: { padding: 16, paddingBottom: 36, borderTopWidth: 1, backgroundColor: 'transparent' },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16, borderRadius: 100,
  },
  shareBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});

export default GameLeaderboard;
