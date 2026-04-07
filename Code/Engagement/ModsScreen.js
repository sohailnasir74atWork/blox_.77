/**
 * ModsScreen.js — Moderator & Junior Mod roster with reputation voting
 *
 * Users upvote/downvote mods. Score = ups - downs.
 * Each user gets one vote per mod (can switch).
 *
 * RTDB (bandwidth-optimized — no large fan-out nodes):
 *   mods/{uid}                          — synced by cloud fn (~60 bytes per mod)
 *   mod_votes_by_user/{voterUid}/{modUid} — 1 or -1 (~5 entries per user, ~20 bytes)
 *   mod_votes_summary/{modUid}          — { ups, downs } (~15 bytes per mod)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, Image, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ref, get, update } from '@react-native-firebase/database';
import Icon from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useGlobalState } from '../GlobelStats';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';

const ROLE_META = {
  mod: { label: 'Moderator', color: '#3B82F6', icon: 'shield-halved' },
  jmod: { label: 'Junior Mod', color: '#8B5CF6', icon: 'shield' },
};

// ─── Mod Card ───
const ModCard = React.memo(({ mod, myVote, onVote, onChat, isDarkMode }) => {
  const roleMeta = ROLE_META[mod.role] || ROLE_META.mod;
  const cardBg = isDarkMode ? '#1e293b' : '#ffffff';
  const textColor = isDarkMode ? '#f1f5f9' : '#1a1a2e';
  const subColor = isDarkMode ? '#94a3b8' : '#64748b';
  const totalVotes = mod.ups + mod.downs;

  return (
    <View style={[styles.card, { backgroundColor: cardBg }]}>
      {/* Avatar */}
      <View style={styles.avatarWrap}>
        {mod.avatar ? (
          <Image source={{ uri: mod.avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: roleMeta.color + '20', alignItems: 'center', justifyContent: 'center' }]}>
            <FontAwesome name="user" size={18} color={roleMeta.color} solid />
          </View>
        )}
        <View style={[styles.roleDot, { backgroundColor: roleMeta.color }]}>
          <FontAwesome name={roleMeta.icon} size={8} color="#fff" solid />
        </View>
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={[styles.name, { color: textColor }]} numberOfLines={1}>
          {mod.displayName}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.rolePill, { backgroundColor: roleMeta.color + '18' }]}>
            <Text style={[styles.roleText, { color: roleMeta.color }]}>{roleMeta.label}</Text>
          </View>
          {totalVotes > 0 && (
            <View style={[styles.rankPill, {
              backgroundColor: mod.ups / totalVotes >= 0.7 ? '#10B98118' : mod.ups / totalVotes >= 0.4 ? '#F59E0B18' : '#EF444418',
            }]}>
              <Text style={[styles.rankText, {
                color: mod.ups / totalVotes >= 0.7 ? '#10B981' : mod.ups / totalVotes >= 0.4 ? '#F59E0B' : '#EF4444',
              }]}>
                {Math.round((mod.ups / totalVotes) * 100)}% positive
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Chat button */}
      <TouchableOpacity onPress={() => onChat(mod)} style={styles.chatBtn} activeOpacity={0.6}>
        <FontAwesome name="comment" size={14} color={roleMeta.color} solid />
      </TouchableOpacity>

      {/* Vote buttons */}
      <View style={styles.voteCol}>
        <TouchableOpacity
          onPress={() => onVote(mod.uid, 1)}
          style={[styles.voteBtn, myVote === 1 && { backgroundColor: '#10B98120' }]}
          activeOpacity={0.6}
        >
          <FontAwesome name="thumbs-up" size={14} color={myVote === 1 ? '#10B981' : subColor} solid={myVote === 1} />
        </TouchableOpacity>

        <Text style={[styles.scoreNum, {
          color: mod.score > 0 ? '#10B981' : mod.score < 0 ? '#EF4444' : subColor,
        }]}>
          {mod.score > 0 ? `+${mod.score}` : mod.score}
        </Text>

        <TouchableOpacity
          onPress={() => onVote(mod.uid, -1)}
          style={[styles.voteBtn, myVote === -1 && { backgroundColor: '#EF444420' }]}
          activeOpacity={0.6}
        >
          <FontAwesome name="thumbs-down" size={14} color={myVote === -1 ? '#EF4444' : subColor} solid={myVote === -1} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ─── Main Screen ───
const ModsScreen = () => {
  const { theme, appdatabase, user } = useGlobalState();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const isDarkMode = theme === 'dark';

  const [mods, setMods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myVotes, setMyVotes] = useState({}); // { modUid: 1 or -1 }

  const bgColor = isDarkMode ? '#0f172a' : '#f8fafc';
  const textColor = isDarkMode ? '#f1f5f9' : '#1a1a2e';
  const subColor = isDarkMode ? '#94a3b8' : '#64748b';

  const fetchMods = useCallback(async (isRefresh = false) => {
    if (!appdatabase) return;
    if (isRefresh) setRefreshing(true);

    try {
      const fetches = [
        get(ref(appdatabase, 'mods')),
        get(ref(appdatabase, 'mod_votes_summary')),
      ];
      if (user?.id) {
        fetches.push(get(ref(appdatabase, `mod_votes_by_user/${user.id}`)));
      }

      const [modsSnap, summarySnap, myVotesSnap] = await Promise.all(fetches);

      if (!modsSnap.exists()) {
        setMods([]);
        return;
      }

      const modsData = modsSnap.val();
      const summaryData = summarySnap?.exists() ? summarySnap.val() : {};
      const myData = myVotesSnap?.exists() ? myVotesSnap.val() : {};
      setMyVotes(myData);

      const list = Object.entries(modsData).map(([uid, data]) => {
        const s = summaryData[uid] || {};
        return {
          uid,
          displayName: data.displayName || 'Unknown',
          avatar: data.avatar || '',
          role: data.role || 'mod',
          ups: s.ups || 0,
          downs: s.downs || 0,
          score: (s.ups || 0) - (s.downs || 0),
        };
      });

      // Sort: mods first, then by score desc
      list.sort((a, b) => {
        if (a.role !== b.role) return a.role === 'mod' ? -1 : 1;
        return b.score - a.score;
      });

      setMods(list);
    } catch (e) {
      console.warn('[ModsScreen] fetch error:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [appdatabase, user?.id]);

  useEffect(() => {
    fetchMods();
  }, [fetchMods]);

  // Handle vote — optimized: 1 multi-path update (single write) + no extra reads
  // Uses local summary from already-fetched mods state instead of re-reading
  const handleVote = useCallback(async (modUid, vote) => {
    if (!appdatabase || !user?.id) {
      Alert.alert('Sign In', 'Sign in to vote on moderators.');
      return;
    }
    if (modUid === user.id) {
      Alert.alert('Oops', "You can't vote for yourself!");
      return;
    }

    const oldVote = myVotes[modUid] || 0;
    const newVote = oldVote === vote ? 0 : vote; // toggle off if same, switch if different

    const currentMod = mods.find(m => m.uid === modUid);
    if (!currentMod) return;
    let ups = currentMod.ups;
    let downs = currentMod.downs;

    // Remove old vote
    if (oldVote === 1) ups = Math.max(0, ups - 1);
    if (oldVote === -1) downs = Math.max(0, downs - 1);
    // Add new vote
    if (newVote === 1) ups += 1;
    if (newVote === -1) downs += 1;

    // Optimistic UI update
    setMyVotes(prev => {
      const next = { ...prev };
      if (newVote === 0) delete next[modUid];
      else next[modUid] = newVote;
      return next;
    });
    setMods(prev => prev.map(m =>
      m.uid === modUid ? { ...m, ups, downs, score: ups - downs } : m
    ));

    // Single multi-path update — 2 tiny nodes only
    // mod_votes_by_user/{uid}: ~20 bytes (user's votes on ~5 mods)
    // mod_votes_summary/{modUid}: ~15 bytes (just ups/downs counts)
    // No bloated fan-out node
    try {
      const updates = {};
      updates[`mod_votes_by_user/${user.id}/${modUid}`] = newVote === 0 ? null : newVote;
      updates[`mod_votes_summary/${modUid}`] = { ups, downs };

      await update(ref(appdatabase), updates);
    } catch (e) {
      // Revert optimistic update on failure
      setMyVotes(prev => {
        const next = { ...prev };
        if (oldVote === 0) delete next[modUid];
        else next[modUid] = oldVote;
        return next;
      });
      setMods(prev => prev.map(m =>
        m.uid === modUid ? { ...m, ups: currentMod.ups, downs: currentMod.downs, score: currentMod.score } : m
      ));
      console.warn('[ModsScreen] vote error:', e?.message);
    }
  }, [appdatabase, user?.id, myVotes, mods]);

  // Bottom drawer state
  const [drawerUser, setDrawerUser] = useState(null);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);

  // Tap mod → open profile drawer
  const handleModPress = useCallback((mod) => {
    if (!user?.id) {
      Alert.alert('Sign In', 'Sign in to view moderator profiles.');
      return;
    }
    setDrawerUser({
      senderId: mod.uid,
      sender: mod.displayName,
      avatar: mod.avatar,
    });
    setIsDrawerVisible(true);
  }, [user?.id]);

  // Chat from drawer — close drawer first, then navigate (iOS modal fix)
  const handleStartChatFromDrawer = useCallback(() => {
    if (!drawerUser) return;
    setIsDrawerVisible(false);
    setTimeout(() => {
      try {
        navigation.navigate('PrivateChatRoot', {
          selectedUser: {
            senderId: drawerUser.senderId,
            sender: drawerUser.sender,
            avatar: drawerUser.avatar,
          },
        });
      } catch (e) {
        console.warn('[ModsScreen] Chat navigation failed:', e?.message);
      }
    }, 300);
  }, [drawerUser, navigation]);

  // Stats
  const stats = useMemo(() => {
    const modCount = mods.filter(m => m.role === 'mod').length;
    const jmodCount = mods.filter(m => m.role === 'jmod').length;
    const best = mods.length > 0 ? mods.reduce((a, b) => a.score >= b.score ? a : b) : null;
    return { modCount, jmodCount, best };
  }, [mods]);

  const renderItem = useCallback(({ item, index }) => (
    <View>
      {/* Best mod badge on #1 */}
      {index === 0 && item.score > 0 && (
        <View style={styles.bestBadge}>
          <Text style={styles.bestBadgeText}>👑 Top Rated</Text>
        </View>
      )}
      <ModCard
        mod={item}
        myVote={myVotes[item.uid] || 0}
        onVote={handleVote}
        onChat={handleModPress}
        isDarkMode={isDarkMode}
      />
    </View>
  ), [isDarkMode, handleVote, handleModPress, myVotes]);

  return (
    <View style={[styles.container, { backgroundColor: bgColor, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: isDarkMode ? '#1e293b' : '#e2e8f0' }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-back" size={22} color={textColor} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textColor }]}>
          {t('mods.title', { defaultValue: 'Moderators' })}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Stats bar */}
      <View style={[styles.statsBar, { borderBottomColor: isDarkMode ? '#1e293b' : '#e2e8f0' }]}>
        <View style={styles.statItem}>
          <FontAwesome name="shield-halved" size={12} color="#3B82F6" solid />
          <Text style={[styles.statNum, { color: textColor }]}>{stats.modCount}</Text>
          <Text style={[styles.statLabel, { color: subColor }]}>Mods</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: isDarkMode ? '#334155' : '#e2e8f0' }]} />
        <View style={styles.statItem}>
          <FontAwesome name="shield" size={12} color="#8B5CF6" solid />
          <Text style={[styles.statNum, { color: textColor }]}>{stats.jmodCount}</Text>
          <Text style={[styles.statLabel, { color: subColor }]}>JMods</Text>
        </View>
        {stats.best && stats.best.score > 0 && (
          <>
            <View style={[styles.statDivider, { backgroundColor: isDarkMode ? '#334155' : '#e2e8f0' }]} />
            <View style={styles.statItem}>
              <Text style={{ fontSize: 12 }}>👑</Text>
              <Text style={[styles.statNum, { color: '#F59E0B' }]} numberOfLines={1}>
                {stats.best.displayName}
              </Text>
            </View>
          </>
        )}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={config.colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={mods}
          keyExtractor={item => item.uid}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 30 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchMods(true)}
              tintColor={config.colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={{ fontSize: 40 }}>🛡️</Text>
              <Text style={[styles.emptyTitle, { color: textColor }]}>
                {t('mods.empty', { defaultValue: 'No moderators yet' })}
              </Text>
            </View>
          }
        />
      )}

      {/* Profile BottomDrawer */}
      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={() => setIsDrawerVisible(false)}
        startChat={handleStartChatFromDrawer}
        selectedUser={drawerUser}
        bannedUsers={[]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700' },

  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    gap: 16,
  },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statNum: { fontSize: 14, fontWeight: '700' },
  statLabel: { fontSize: 11, fontWeight: '500' },
  statDivider: { width: 1, height: 16 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    marginBottom: 8,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  avatarWrap: { position: 'relative' },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  roleDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  info: { flex: 1, gap: 3 },
  name: { fontSize: 14, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rolePill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  roleText: { fontSize: 10, fontWeight: '700' },
  rankPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  rankText: { fontSize: 10, fontWeight: '700' },

  chatBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59,130,246,0.08)',
  },
  // Vote column
  voteCol: {
    alignItems: 'center',
    gap: 2,
  },
  voteBtn: {
    width: 32,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreNum: {
    fontSize: 14,
    fontWeight: '800',
  },

  // Best mod badge
  bestBadge: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#F59E0B18',
    marginBottom: 4,
  },
  bestBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F59E0B',
  },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
});

export default React.memo(ModsScreen);
