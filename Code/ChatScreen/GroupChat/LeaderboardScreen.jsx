import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { doc, getDoc } from '@react-native-firebase/firestore';
import { useTranslation } from 'react-i18next';
import InterstitialAdManager from '../../Ads/IntAd';
import { useLocalState } from '../../LocalGlobelStats';
import { mixpanel } from '../../AppHelper/MixPenel';
import config from '../../Helper/Environment';
import { useHaptic } from '../../Helper/HepticFeedBack';
import ProfileBottomDrawer from './BottomDrawer';
import { isUserOnline } from '../utils';

const CACHE_DURATION_MS = 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds (local app cache)
// Note: Leaderboard data is pre-computed daily by Cloud Function with rating >= 3.7

const LeaderboardScreen = ({ route }) => {
  const { theme, user, appdatabase, firestoreDB } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [isOnline, setIsOnline] = useState(false);
  const [bannedUsers] = useState(Array.isArray(localState.bannedUsers) ? localState.bannedUsers : []);

  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // ✅ Check if cached data is still valid (less than 2 days old)
  const isCacheValid = useCallback((cachedData) => {
    if (!cachedData || !cachedData.timestamp) return false;
    
    // ✅ Ensure timestamp is a number (handle cases where it might be stored as string)
    const timestamp = typeof cachedData.timestamp === 'number' 
      ? cachedData.timestamp 
      : typeof cachedData.timestamp === 'string' 
        ? parseInt(cachedData.timestamp, 10) 
        : null;
    
    if (!timestamp || isNaN(timestamp)) return false;
    
    const now = Date.now();
    const cacheAge = now - timestamp;
    
    // ✅ Cache is valid only if less than 2 days old
    const isValid = cacheAge >= 0 && cacheAge < CACHE_DURATION_MS;
    
    // ✅ Debug: Log cache status if needed (commented out for production)
    // console.log('📊 [Leaderboard] Cache check:', {
    //   cacheAge: `${Math.floor(cacheAge / (1000 * 60 * 60))}h ${Math.floor((cacheAge % (1000 * 60 * 60)) / (1000 * 60))}m`,
    //   isValid,
    //   timestamp: new Date(timestamp).toISOString(),
    //   now: new Date(now).toISOString(),
    // });
    
    return isValid;
  }, []);

  // ✅ OPTIMIZED: Fetch pre-computed leaderboard from cached collection
  // Uses Cloud Function that runs daily to pre-compute top 50 users
  // Priority #1: NUMBER OF REVIEWS (most reviewed first)
  // Filter: Rating >= 3.7 (applied in Cloud Function)
  // 
  // Strategy: Read from leaderboard_cache/top50 document (pre-computed daily)
  // Cost: ONLY 1 Firestore read (most cost-effective!)
  // 
  // Benefits:
  // - Pre-computed: No querying/filtering on app load
  // - Fast: Single document read (very fast)
  // - Accurate: Shows most reviewed users with >= 3.7 rating
  const fetchLeaderboard = useCallback(async () => {
    if (!firestoreDB || !user?.id) {
      return;
    }

    setLoading(true);
    try {
      // ✅ OPTIMIZED: Read from pre-computed cached leaderboard
      // Cloud Function runs daily to update this document
      // This is a single document read - very fast and cheap!
      const cacheDocRef = doc(firestoreDB, 'leaderboard_cache', 'top50');
      const cacheDocSnap = await getDoc(cacheDocRef);
      
      // ✅ Firestore: exists is a property, not a function
      if (!cacheDocSnap.exists) {
        console.log('⚠️ [Leaderboard] Cache not found - leaderboard may not be initialized yet');
        setLeaderboardData([]);
        setLoading(false);
        return;
      }

      const cacheData = cacheDocSnap.data();
      const cachedUsers = cacheData?.users || [];
      
      if (cachedUsers.length === 0) {
        console.log('⚠️ [Leaderboard] Cache is empty - waiting for Cloud Function to update');
        setLeaderboardData([]);
        setLoading(false);
        return;
      }
      
      // ✅ Users are already sorted by review count (desc), then rating (desc)
      // Users are already filtered for rating >= 3.7
      // Users already have displayName and avatar included
      // Just assign ranks (they should already have ranks, but we ensure consistency)
      const leaderboardWithDetails = cachedUsers.map((user, index) => ({
        userId: user.userId,
        ratingCount: user.ratingCount || 0,
        averageRating: user.averageRating || 0,
        displayName: user.displayName || 'Anonymous',
        avatar: user.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
        rank: index + 1, // Ensure rank is 1-based (though it should already be set)
        updatedAt: user.updatedAt || Date.now(),
      }));

      // ✅ Save to local cache (2-day caching)
      // Cache includes the timestamp from Cloud Function's lastUpdated field
      const cacheTimestamp = cacheData.lastUpdated?.toMillis?.() || cacheData.lastUpdated || Date.now();
      const localCacheData = {
        data: leaderboardWithDetails,
        timestamp: cacheTimestamp, // Use Cloud Function's timestamp, not current time
        lastFetched: cacheData.lastUpdated?.toDate?.()?.toISOString() || new Date().toISOString(),
        cloudFunctionUpdated: cacheData.lastUpdated?.toDate?.()?.toISOString() || null,
      };
      updateLocalState('leaderboardTop50', localCacheData);

      setLeaderboardData(leaderboardWithDetails);
    } catch (error) {
      console.error('❌ [Leaderboard] Error fetching leaderboard from cache:', error);
      
      // ✅ Check if cache document doesn't exist (Cloud Function may not have run yet)
      if (error.code === 'not-found' || error.code === 'permission-denied') {
        console.error('⚠️ [Leaderboard] Cache document not found or access denied');
        console.error('   The Cloud Function "updateLeaderboardCache" should run daily to populate this cache');
        console.error('   Check Firebase Console → Functions → Logs to verify the function is running');
      }
      
      setLeaderboardData([]);
    } finally {
      setLoading(false);
    }
  }, [firestoreDB, user?.id, updateLocalState]);

  // ✅ Load leaderboard data (check cache first) - using useFocusEffect like InboxScreen
  useFocusEffect(
    useCallback(() => {
      const cachedData = localState.leaderboardTop50;

      // ✅ Check if cache is valid (less than 2 days old)
      if (cachedData && cachedData.data && cachedData.data.length > 0 && isCacheValid(cachedData)) {
        // ✅ Use cached data (still fresh, less than 2 days old)
        setLeaderboardData(cachedData.data);
        setLoading(false);
      } else {
        // ✅ Cache expired (older than 2 days) or doesn't exist, fetch fresh data from Firebase
        fetchLeaderboard();
      }
    }, [localState.leaderboardTop50, isCacheValid, fetchLeaderboard])
  );

  // ✅ Handle user click - open BottomDrawer
  const handleUserClick = useCallback(async (item) => {
    triggerHapticFeedback('impactLight');
    
    const selectedUserData = {
      senderId: item.userId,
      sender: item.displayName,
      avatar: item.avatar,
    };

    setSelectedUser(selectedUserData);

    // ✅ Check if user is online
    try {
      const online = await isUserOnline(item.userId);
      setIsOnline(online);
    } catch (error) {
      console.error('Error checking online status:', error);
      setIsOnline(false);
    }

    setIsDrawerVisible(true);
    mixpanel.track("Leaderboard User Click");
  }, [triggerHapticFeedback]);

  // ✅ Handle start chat from BottomDrawer
  const handleStartChat = useCallback(() => {
    if (!selectedUser) return;

    const callbackFunction = () => {
      setIsDrawerVisible(false);
      
      if (navigation && typeof navigation.navigate === 'function') {
        navigation.navigate('PrivateChat', {
          selectedUser: {
            senderId: selectedUser.senderId,
            sender: selectedUser.sender,
            avatar: selectedUser.avatar,
          },
        });
      }
      mixpanel.track("Leaderboard Start Chat");
    };

    // ✅ Show ad for non-pro users
    if (!localState?.isPro) {
      InterstitialAdManager.showAd(callbackFunction);
    } else {
      callbackFunction();
    }
  }, [selectedUser, navigation, localState?.isPro]);

  // ✅ Render leaderboard item
  const renderLeaderboardItem = useCallback(({ item, index }) => {
    const rank = index + 1;
    const rankColor = rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : config.colors.primary;

    return (
      <TouchableOpacity
        style={styles.userItem}
        onPress={() => handleUserClick(item)}
        activeOpacity={0.7}
      >
        {/* Rank Badge */}
        <View style={[styles.rankBadge, { backgroundColor: rankColor }]}>
          <Text style={styles.rankText}>{rank}</Text>
        </View>

        {/* Avatar */}
        <Image
          source={{ uri: item.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
          style={styles.avatar}
        />

        {/* User Info */}
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>
            {item.displayName || 'Anonymous'}
          </Text>
          <View style={styles.ratingInfo}>
            <Icon name="star" size={12} color="#FFD700" />
            <Text style={styles.ratingText}>
              {item.averageRating.toFixed(1)} ({item.ratingCount} {item.ratingCount === 1 ? 'rating' : 'ratings'})
            </Text>
          </View>
        </View>

        {/* Chat Icon */}
        <Icon name="chatbubble-outline" size={20} color={config.colors.primary} />
      </TouchableOpacity>
    );
  }, [styles, handleUserClick]);

  return (
    <>
      <View style={styles.container}>
        {/* Loading Indicator */}
        {loading && leaderboardData.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={config.colors.primary} />
            <Text style={styles.loadingText}>Loading leaderboard...</Text>
            <Text style={styles.loadingSubtext}>Showing most reviewed users with 3.7+ rating...</Text>
          </View>
        ) : leaderboardData.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Icon name="trophy-outline" size={48} color={config.colors.primary} />
            <Text style={styles.emptyText}>No users found with 3.7+ rating</Text>
            <Text style={styles.emptySubtext}>Leaderboard is updated daily</Text>
          </View>
        ) : (
          <FlatList
            data={leaderboardData}
            renderItem={renderLeaderboardItem}
            keyExtractor={(item) => item.userId}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Cache Info */}
        {localState.leaderboardTop50?.lastFetched && !loading && (
          <Text style={styles.cacheInfo}>
            Last updated: {new Date(localState.leaderboardTop50.lastFetched).toLocaleDateString()}
          </Text>
        )}
      </View>

      {/* BottomDrawer for user profile */}
      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={() => setIsDrawerVisible(false)}
        startChat={handleStartChat}
        selectedUser={selectedUser}
        isOnline={isOnline}
        bannedUsers={bannedUsers}
      />
    </>
  );
};

const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
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
    fontFamily: 'Lato-Regular',
  },
  loadingSubtext: {
    marginTop: 4,
    fontSize: 12,
    color: isDarkMode ? '#666' : '#999',
    fontFamily: 'Lato-Regular',
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
    fontFamily: 'Lato-Regular',
  },
  emptySubtext: {
    marginTop: 6,
    fontSize: 12,
    color: isDarkMode ? '#666' : '#999',
    fontFamily: 'Lato-Regular',
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
    fontFamily: 'Lato-Bold',
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
    fontFamily: 'Lato-Bold',
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
    fontFamily: 'Lato-Regular',
    marginLeft: 4,
  },
  cacheInfo: {
    fontSize: 10,
    color: isDarkMode ? '#666' : '#999',
    textAlign: 'center',
    padding: 8,
    fontFamily: 'Lato-Regular',
  },
});

export default LeaderboardScreen;

