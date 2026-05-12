import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { doc, getDoc } from '@react-native-firebase/firestore';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../../LocalGlobelStats';
import { mixpanel } from '../../AppHelper/MixPenel';
import config from '../../Helper/Environment';
import { useHaptic } from '../../Helper/HepticFeedBack';
import ProfileBottomDrawer from './BottomDrawer';
import { isUserOnline } from '../utils';
import ThemeHeader from '../../../Code/Design/componenets/ThemeHeader';
import { getUsersByRole } from '../../Supabase/userBackend';

const CACHE_DURATION_MS = 2 * 24 * 60 * 60 * 1000; // 2 days — Top Rated (CF-computed)
const ROSTER_CACHE_MS = 4 * 60 * 60 * 1000;        // 4 hours — tag rosters
const DEFAULT_AVATAR = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';

const TABS = [
  { key: 'topRated', label: 'Top Rated', icon: 'medal',             color: '#F59E0B', roleField: null },
  { key: 'trusted',  label: 'Trusted',   icon: 'checkmark-circle',  color: '#10B981', roleField: 'is_trusted' },
  { key: 'grinder',  label: 'Grinder',   icon: 'barbell',           color: '#06B6D4', roleField: 'is_grinder' },
  { key: 'raider',   label: 'Raider',    icon: 'flash',             color: '#DC2626', roleField: 'is_raider' },
];

const ROSTER_CACHE_KEY = {
  trusted: 'trustedRoster',
  grinder: 'grinderRoster',
  raider:  'raiderRoster',
};

const LeaderboardScreen = ({ route }) => {
  const { theme, user, firestoreDB } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';

  const [activeTab, setActiveTab] = useState('topRated');
  const [topRatedData, setTopRatedData] = useState([]);
  const [rosterData, setRosterData] = useState({ trusted: [], grinder: [], raider: [] });
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState({});

  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [isOnline, setIsOnline] = useState(false);
  const [bannedUsers] = useState(Array.isArray(localState.bannedUsers) ? localState.bannedUsers : []);

  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // ── Generic cache validity check ──
  const isCacheValid = useCallback((cachedData, ttlMs) => {
    if (!cachedData || !cachedData.timestamp) return false;
    const timestamp = typeof cachedData.timestamp === 'number'
      ? cachedData.timestamp
      : typeof cachedData.timestamp === 'string'
        ? parseInt(cachedData.timestamp, 10)
        : null;
    if (!timestamp || isNaN(timestamp)) return false;
    const cacheAge = Date.now() - timestamp;
    return cacheAge >= 0 && cacheAge < ttlMs;
  }, []);

  // ── Fetch Top Rated (Firestore pre-computed cache) ──
  const fetchTopRated = useCallback(async () => {
    if (!firestoreDB || !user?.id) return;
    try {
      const cacheDocRef = doc(firestoreDB, 'leaderboard_cache', 'top50');
      const cacheDocSnap = await getDoc(cacheDocRef);

      if (!cacheDocSnap.exists) {
        setTopRatedData([]);
        return;
      }

      const cacheData = cacheDocSnap.data();
      const cachedUsers = cacheData?.users || [];
      if (cachedUsers.length === 0) {
        setTopRatedData([]);
        return;
      }

      const list = cachedUsers.map((u, i) => ({
        userId: u.userId,
        ratingCount: u.ratingCount || 0,
        averageRating: u.averageRating || 0,
        displayName: u.displayName || 'Anonymous',
        avatar: u.avatar || DEFAULT_AVATAR,
        rank: i + 1,
        updatedAt: u.updatedAt || Date.now(),
      }));

      const cacheTimestamp = cacheData.lastUpdated?.toMillis?.() || cacheData.lastUpdated || Date.now();
      updateLocalState('leaderboardTop50', {
        data: list,
        timestamp: cacheTimestamp,
        lastFetched: cacheData.lastUpdated?.toDate?.()?.toISOString() || new Date().toISOString(),
      });

      setTopRatedData(list);
    } catch (error) {
      console.warn('[Leaderboard] topRated fetch error:', error?.message);
      setTopRatedData([]);
    }
  }, [firestoreDB, user?.id, updateLocalState]);

  // ── Fetch a tag-roster from Supabase ──
  const fetchRoster = useCallback(async (tabKey) => {
    const meta = TABS.find(t => t.key === tabKey);
    if (!meta?.roleField) return [];
    const list = await getUsersByRole(meta.roleField, 100);
    const cacheKey = ROSTER_CACHE_KEY[tabKey];
    if (cacheKey) {
      updateLocalState(cacheKey, { data: list, timestamp: Date.now() });
    }
    return list;
  }, [updateLocalState]);

  // ── Switch tab + lazy fetch (cache-first for rosters) ──
  const switchTab = useCallback(async (tabKey) => {
    triggerHapticFeedback('impactLight');
    setActiveTab(tabKey);
    if (loadedTabs[tabKey]) return;

    if (tabKey !== 'topRated') {
      const cacheKey = ROSTER_CACHE_KEY[tabKey];
      const cached = cacheKey ? localState[cacheKey] : null;
      if (cached?.data?.length > 0 && isCacheValid(cached, ROSTER_CACHE_MS)) {
        setRosterData(prev => ({ ...prev, [tabKey]: cached.data }));
        setLoadedTabs(prev => ({ ...prev, [tabKey]: true }));
        return;
      }
    }

    setLoading(true);
    if (tabKey === 'topRated') {
      await fetchTopRated();
    } else {
      const list = await fetchRoster(tabKey);
      setRosterData(prev => ({ ...prev, [tabKey]: list }));
    }
    setLoadedTabs(prev => ({ ...prev, [tabKey]: true }));
    setLoading(false);
  }, [fetchTopRated, fetchRoster, loadedTabs, triggerHapticFeedback, localState, isCacheValid]);

  // ── Pull-to-refresh: bypass cache and re-fetch the active tab ──
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    if (activeTab === 'topRated') {
      await fetchTopRated();
    } else {
      const list = await fetchRoster(activeTab);
      setRosterData(prev => ({ ...prev, [activeTab]: list }));
    }
    setRefreshing(false);
  }, [activeTab, fetchTopRated, fetchRoster]);

  // ── Initial load: prefer local cache for Top Rated, else fetch ──
  useFocusEffect(
    useCallback(() => {
      const cached = localState.leaderboardTop50;
      if (cached?.data?.length > 0 && isCacheValid(cached, CACHE_DURATION_MS)) {
        setTopRatedData(cached.data);
        setLoadedTabs(prev => ({ ...prev, topRated: true }));
        return;
      }
      if (!loadedTabs.topRated) {
        setLoading(true);
        fetchTopRated().finally(() => {
          setLoadedTabs(prev => ({ ...prev, topRated: true }));
          setLoading(false);
        });
      }
    }, [localState.leaderboardTop50, isCacheValid, fetchTopRated, loadedTabs.topRated])
  );

  // ── User row click → open BottomDrawer ──
  const handleUserClick = useCallback(async (item) => {
    triggerHapticFeedback('impactLight');
    setSelectedUser({
      senderId: item.userId,
      sender: item.displayName,
      avatar: item.avatar,
    });
    try {
      const online = await isUserOnline(item.userId);
      setIsOnline(online);
    } catch {
      setIsOnline(false);
    }
    setIsDrawerVisible(true);
    mixpanel.track('Leaderboard User Click', { tab: activeTab });
  }, [triggerHapticFeedback, activeTab]);

  const handleStartChat = useCallback(() => {
    if (!selectedUser) return;
    setIsDrawerVisible(false);
    setTimeout(() => {
      const rootNav = navigation?.getParent?.() || navigation;
      if (!rootNav?.navigate) return;
      rootNav.navigate('PrivateChatRoot', {
        selectedUser: {
          senderId: selectedUser.senderId,
          sender: selectedUser.sender,
          avatar: selectedUser.avatar,
        },
      });
    }, 300);
    mixpanel.track('Leaderboard Start Chat');
  }, [selectedUser, navigation]);

  // ── Renderers ──
  const renderTopRatedItem = useCallback(({ item, index }) => {
    const rank = index + 1;
    const rankColor =
      rank === 1 ? '#FFD700' :
      rank === 2 ? '#C0C0C0' :
      rank === 3 ? '#CD7F32' :
      config.colors.primary;

    return (
      <TouchableOpacity style={styles.userItem} onPress={() => handleUserClick(item)} activeOpacity={0.7}>
        <View style={[styles.rankBadge, { backgroundColor: rankColor }]}>
          <Text style={styles.rankText}>{rank}</Text>
        </View>
        <Image source={{ uri: item.avatar || DEFAULT_AVATAR }} style={styles.avatar} />
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>{item.displayName || 'Anonymous'}</Text>
          <View style={styles.ratingInfo}>
            <Icon name="star" size={12} color="#FFD700" />
            <Text style={styles.ratingText}>
              {item.averageRating.toFixed(1)} ({item.ratingCount} {item.ratingCount === 1 ? 'rating' : 'ratings'})
            </Text>
          </View>
        </View>
        <Icon name="chatbubble-outline" size={20} color={config.colors.primary} />
      </TouchableOpacity>
    );
  }, [styles, handleUserClick]);

  const renderRosterItem = useCallback(({ item }) => {
    const tabMeta = TABS.find(tab => tab.key === activeTab);
    return (
      <TouchableOpacity style={styles.userItem} onPress={() => handleUserClick(item)} activeOpacity={0.7}>
        <Image source={{ uri: item.avatar || DEFAULT_AVATAR }} style={styles.avatar} />
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>{item.displayName || 'Unknown'}</Text>
          <View style={[styles.rolePill, { backgroundColor: tabMeta.color + '20' }]}>
            <Icon name={tabMeta.icon} size={10} color={tabMeta.color} />
            <Text style={[styles.rolePillText, { color: tabMeta.color }]}>{tabMeta.label}</Text>
          </View>
        </View>
        <Icon name="chatbubble-outline" size={20} color={config.colors.primary} />
      </TouchableOpacity>
    );
  }, [styles, handleUserClick, activeTab]);

  // ── Active state ──
  const activeData = activeTab === 'topRated' ? topRatedData : (rosterData[activeTab] || []);
  const activeRenderer = activeTab === 'topRated' ? renderTopRatedItem : renderRosterItem;
  const activeMeta = TABS.find(tab => tab.key === activeTab);

  const emptyText =
    activeTab === 'topRated' ? 'No users found with 3.7+ rating' :
    `No ${activeMeta.label} users yet`;

  return (
    <View style={{ flex: 1, backgroundColor: isDarkMode ? '#111827' : '#f8fafc' }}>
      <ThemeHeader title={t('home_tab.action_leaderboard', { defaultValue: 'Leaderboard' })} showBack={true} />
      <View style={styles.container}>
        {/* Tab bar */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.tabBar, { borderBottomColor: isDarkMode ? '#1e293b' : '#e2e8f0' }]}
          contentContainerStyle={styles.tabBarContent}
        >
          {TABS.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, isActive && { borderBottomColor: tab.color }]}
                onPress={() => switchTab(tab.key)}
                activeOpacity={0.7}
              >
                <Icon name={tab.icon} size={16} color={isActive ? tab.color : (isDarkMode ? '#94a3b8' : '#64748b')} />
                <Text style={[styles.tabLabel, {
                  color: isActive ? tab.color : (isDarkMode ? '#94a3b8' : '#64748b'),
                  fontWeight: isActive ? '700' : '500',
                }]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* List / loading / empty */}
        {loading && activeData.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={config.colors.primary} />
            <Text style={styles.loadingText}>Loading {activeMeta.label}...</Text>
            {activeTab === 'topRated' && (
              <Text style={styles.loadingSubtext}>Showing most reviewed users with 3.7+ rating...</Text>
            )}
          </View>
        ) : activeData.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Icon name={activeMeta.icon} size={48} color={config.colors.primary} />
            <Text style={styles.emptyText}>{emptyText}</Text>
            {activeTab === 'topRated' && (
              <Text style={styles.emptySubtext}>Leaderboard is updated daily</Text>
            )}
          </View>
        ) : (
          <FlatList
            data={activeData}
            renderItem={activeRenderer}
            keyExtractor={(item) => item.userId}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={config.colors.primary}
              />
            }
          />
        )}

        {activeTab === 'topRated' && localState.leaderboardTop50?.lastFetched && !loading && (
          <Text style={styles.cacheInfo}>
            Last updated: {new Date(localState.leaderboardTop50.lastFetched).toLocaleDateString()}
          </Text>
        )}
      </View>

      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={() => setIsDrawerVisible(false)}
        startChat={handleStartChat}
        selectedUser={selectedUser}
        isOnline={isOnline}
        bannedUsers={bannedUsers}
      />
    </View>
  );
};

const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? '#0f172a' : '#f2f2f7',
  },
  tabBar: {
    maxHeight: 48,
    flexGrow: 0,
    borderBottomWidth: 1,
    backgroundColor: isDarkMode ? '#0f172a' : '#fff',
  },
  tabBarContent: {
    paddingHorizontal: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize: 13,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: isDarkMode ? '#999' : '#666',
  },
  loadingSubtext: {
    marginTop: 4,
    fontSize: 12,
    color: isDarkMode ? '#666' : '#999',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
    color: isDarkMode ? '#999' : '#666',
  },
  emptySubtext: {
    marginTop: 6,
    fontSize: 12,
    color: isDarkMode ? '#666' : '#999',
  },
  listContent: {
    padding: 8,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginVertical: 4,
    backgroundColor: isDarkMode ? '#2a2a2a' : '#f5f5f5',
    borderRadius: 12,
    marginHorizontal: 8,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rankText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
    backgroundColor: isDarkMode ? '#333' : '#e0e0e0',
  },
  userInfo: {
    flex: 1,
    marginRight: 8,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: isDarkMode ? '#fff' : '#000',
    marginBottom: 4,
  },
  ratingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    fontSize: 12,
    color: isDarkMode ? '#999' : '#666',
    marginLeft: 4,
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  cacheInfo: {
    fontSize: 10,
    color: isDarkMode ? '#666' : '#999',
    textAlign: 'center',
    padding: 8,
  },
});

export default LeaderboardScreen;
