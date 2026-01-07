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
import { ref, get } from '@react-native-firebase/database';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { collection, getDocs, query, where, orderBy, limit, doc, getDoc, setDoc, serverTimestamp } from '@react-native-firebase/firestore';
import { useTranslation } from 'react-i18next';
import InterstitialAdManager from '../../Ads/IntAd';
import { useLocalState } from '../../LocalGlobelStats';
import { mixpanel } from '../../AppHelper/MixPenel';
import config from '../../Helper/Environment';
import { useHaptic } from '../../Helper/HepticFeedBack';
import ProfileBottomDrawer from './BottomDrawer';
import { isUserOnline } from '../utils';
import { backfillUserRatingsSummary, diagnoseReviewCounts } from '../utils/ratingSummaryHelper';

const CACHE_DURATION_MS = 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds

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
  const [backfillAttempted, setBackfillAttempted] = useState(false);

  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // ✅ Check if cached data is still valid (less than 2 days old)
  const isCacheValid = useCallback((cachedData) => {
    if (!cachedData || !cachedData.timestamp) return false;
    const now = Date.now();
    const cacheAge = now - cachedData.timestamp;
    return cacheAge < CACHE_DURATION_MS;
  }, []);

  // ✅ OPTIMIZED: Fetch ONLY top 50 users by review count
  // Uses pre-aggregated user_ratings_summary collection for efficiency
  // Cost: Only 50 Firestore reads (not thousands of reviews)
  const fetchLeaderboard = useCallback(async () => {
    if (!firestoreDB || !appdatabase || !user?.id) {
      return;
    }

    setLoading(true);
    try {
      // ✅ OPTIMIZED: Fetch exactly 50 records sorted by review count
      // Cost: Only 50 Firestore reads (not 100+)
      // We'll do secondary sort (by rating) client-side on these 50 records
      const summaryQuery = query(
        collection(firestoreDB, 'user_ratings_summary'),
        orderBy('count', 'desc'), // Primary sort: review count (highest first) - server-side
        limit(50) // ✅ ONLY fetch 50 records = 50 reads (optimized!)
      );
      
      const summarySnapshot = await getDocs(summaryQuery);
      
      if (summarySnapshot.empty) {
        // ✅ If summary collection is empty, try to check if there are any reviews at all
        // Try to check if reviews exist (but don't fetch all - just check)
        try {
          const reviewsCheckQuery = query(
            collection(firestoreDB, 'reviews'),
            limit(1)
          );
          const reviewsCheck = await getDocs(reviewsCheckQuery);
          if (!reviewsCheck.empty && !backfillAttempted) {
            // ✅ Mark that we've attempted backfill to prevent infinite loops
            setBackfillAttempted(true);
            
            // ✅ Automatically backfill the summary collection
            try {
              const result = await backfillUserRatingsSummary(firestoreDB);
              
              if (result.success && result.processed > 0) {
                // ✅ Retry fetching after backfill
                setTimeout(() => {
                  fetchLeaderboard();
                }, 500);
                return; // Exit early, will retry
              }
            } catch (backfillError) {
              console.error('❌ [Leaderboard] Error during backfill:', backfillError);
            }
          }
        } catch (checkError) {
          console.error('❌ [Leaderboard] Error checking reviews:', checkError);
        }
        
        setLeaderboardData([]);
        setLoading(false);
        return;
      }

      // ✅ Extract and sort users (client-side sorting on the 50 fetched records)
      // 1. Primary: Review count (descending) - users with more reviews first
      // 2. Secondary: Average rating (descending) - within same review count, higher rating first
      // This creates groups: 4 reviews (sorted by rating), 3 reviews (sorted by rating), etc.
      // 
      // ✅ OPTIMIZED: Only working with 50 records (already fetched from Firestore)
      // Client-side sort is fast and free (no additional Firestore reads)
      const allUsers = summarySnapshot.docs
        .map((doc) => {
          const data = doc.data();
          return {
            userId: doc.id,
            ratingCount: data.count || 0, // Number of reviews received
            averageRating: data.averageRating || 0,
            updatedAt: data.updatedAt?.toMillis?.() || data.updatedAt || Date.now(),
          };
        })
        .filter(item => item.ratingCount > 0); // Only include users with at least 1 review
      
      // ✅ Client-side sort: First by review count (desc), then by average rating (desc)
      // This groups users by review count, with top-rated users first within each group
      // Cost: 0 Firestore reads (just JavaScript sorting)
      const sortedUsers = allUsers.sort((a, b) => {
        // Primary sort: Review count (descending)
        if (b.ratingCount !== a.ratingCount) {
          return b.ratingCount - a.ratingCount;
        }
        // Secondary sort: Average rating (descending) - within same review count
        return b.averageRating - a.averageRating;
      });
      
      // ✅ Use all sorted users (already limited to 50 from Firestore query)
      const topRatings = sortedUsers.map((item, index) => ({
        ...item,
        rank: index + 1, // Assign rank after sorting
      }));

      // ✅ Fetch user details (displayName, avatar) for ONLY these top 50 users in parallel
      // This is the only additional data fetch needed - we already have the top 50 user IDs
      const userDetailsPromises = topRatings.map(async (item) => {
        try {
          const [displayNameSnap, avatarSnap] = await Promise.all([
            get(ref(appdatabase, `users/${item.userId}/displayName`)).catch(() => null),
            get(ref(appdatabase, `users/${item.userId}/avatar`)).catch(() => null),
          ]);

          return {
            ...item,
            displayName: displayNameSnap?.exists() ? displayNameSnap.val() : 'Anonymous',
            avatar: avatarSnap?.exists() ? avatarSnap.val() : 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
            rank: topRatings.indexOf(item) + 1,
          };
        } catch (error) {
          console.error(`Error fetching user ${item.userId}:`, error);
          return {
            ...item,
            displayName: 'Anonymous',
            avatar: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
            rank: topRatings.indexOf(item) + 1,
          };
        }
      });

      const leaderboardWithDetails = await Promise.all(userDetailsPromises);

      // ✅ Save to cache
      const cacheData = {
        data: leaderboardWithDetails,
        timestamp: Date.now(),
        lastFetched: new Date().toISOString(),
      };
      updateLocalState('leaderboardTop50', cacheData);

      setLeaderboardData(leaderboardWithDetails);
    } catch (error) {
      console.error('❌ [Leaderboard] Error fetching leaderboard:', error);
      
      // ✅ Check if it's a missing index error
      if (error.code === 'failed-precondition') {
        console.error('⚠️ [Leaderboard] Firestore index required for collection: user_ratings_summary, fields: count (Descending)');
      }
      
      setLeaderboardData([]);
    } finally {
      setLoading(false);
    }
  }, [firestoreDB, appdatabase, user?.id, updateLocalState]);

  // ✅ Load leaderboard data (check cache first) - using useFocusEffect like InboxScreen
  useFocusEffect(
    useCallback(() => {
      const cachedData = localState.leaderboardTop50;

      // ✅ Check if cache is valid (less than 2 days old)
      if (cachedData && cachedData.data && cachedData.data.length > 0 && isCacheValid(cachedData)) {
        // ✅ Use cached data
        setLeaderboardData(cachedData.data);
        setLoading(false);
      } else {
        // ✅ Cache expired or doesn't exist, fetch from Firebase
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
            <Text style={styles.loadingSubtext}>Sorting by review count and rating...</Text>
          </View>
        ) : leaderboardData.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Icon name="trophy-outline" size={48} color={config.colors.primary} />
            <Text style={styles.emptyText}>No ratings yet</Text>
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

