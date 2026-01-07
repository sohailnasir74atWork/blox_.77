import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { ref, get } from '@react-native-firebase/database';
import { collection, getDocs, query, orderBy, limit, doc, getDoc } from '@react-native-firebase/firestore';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import InterstitialAdManager from '../../Ads/IntAd';
import { useLocalState } from '../../LocalGlobelStats';
import { mixpanel } from '../../AppHelper/MixPenel';
import config from '../../Helper/Environment';
import { useHaptic } from '../../Helper/HepticFeedBack';
import ProfileBottomDrawer from './BottomDrawer';
import { isUserOnline } from '../utils';

const CACHE_DURATION_MS = 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds

const LeaderboardModal = ({ 
  visible, 
  onClose,
}) => {
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
    const now = Date.now();
    const cacheAge = now - cachedData.timestamp;
    return cacheAge < CACHE_DURATION_MS;
  }, []);

  // ✅ MIGRATED: Fetch leaderboard from Firestore user_ratings_summary
  const fetchLeaderboard = useCallback(async () => {
    if (!firestoreDB || !appdatabase || !user?.id) return;

    setLoading(true);
    try {
      // ✅ Query Firestore user_ratings_summary ordered by count, limit to top 50
      const summaryQuery = query(
        collection(firestoreDB, 'user_ratings_summary'),
        orderBy('count', 'desc'), // Order by review count (highest first)
        limit(50) // ✅ ONLY fetch top 50 = 50 Firestore reads (optimized!)
      );

      const summarySnapshot = await getDocs(summaryQuery);
      
      if (summarySnapshot.empty) {
        setLeaderboardData([]);
        setLoading(false);
        return;
      }

      // ✅ Extract and sort users: First by review count (desc), then by average rating (desc)
      const allUsers = summarySnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          userId: doc.id,
          ratingCount: data.count || 0,
          averageRating: data.averageRating || 0,
          updatedAt: data.updatedAt?.toMillis?.() || data.updatedAt || Date.now(),
        };
      }).filter(item => item.ratingCount > 0);

      // ✅ Sort: First by review count (desc), then by average rating (desc)
      const ratingsArray = allUsers.sort((a, b) => {
        if (b.ratingCount !== a.ratingCount) {
          return b.ratingCount - a.ratingCount;
        }
        return b.averageRating - a.averageRating;
      });

      // ✅ Fetch user details (displayName, avatar) for each user in parallel
      const userDetailsPromises = ratingsArray.map(async (item) => {
        try {
          const [displayNameSnap, avatarSnap] = await Promise.all([
            get(ref(appdatabase, `users/${item.userId}/displayName`)).catch(() => null),
            get(ref(appdatabase, `users/${item.userId}/avatar`)).catch(() => null),
          ]);

          return {
            ...item,
            displayName: displayNameSnap?.exists() ? displayNameSnap.val() : 'Anonymous',
            avatar: avatarSnap?.exists() ? avatarSnap.val() : 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
            rank: ratingsArray.indexOf(item) + 1,
          };
        } catch (error) {
          console.error(`Error fetching user ${item.userId}:`, error);
          return {
            ...item,
            displayName: 'Anonymous',
            avatar: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
            rank: ratingsArray.indexOf(item) + 1,
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
      console.error('Error fetching leaderboard:', error);
      setLeaderboardData([]);
    } finally {
      setLoading(false);
    }
  }, [appdatabase, user?.id, updateLocalState]);

  // ✅ Load leaderboard data (check cache first)
  useEffect(() => {
    if (!visible) return;

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
  }, [visible, localState.leaderboardTop50, isCacheValid, fetchLeaderboard]);

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
      onClose();
      
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
  }, [selectedUser, navigation, onClose, localState?.isPro]);

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
      <Modal
        visible={visible}
        animationType="slide"
        transparent={true}
        onRequestClose={onClose}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1}
          onPress={onClose}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1, justifyContent: 'flex-end' }}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
          >
            <View 
              style={styles.modalContent}
              onStartShouldSetResponder={() => true}
            >
              {/* Header */}
              <View style={styles.header}>
                <Text style={styles.headerTitle}>Top Rated Users</Text>
                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                  <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
                </TouchableOpacity>
              </View>

              {/* Loading Indicator */}
              {loading && leaderboardData.length === 0 ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={config.colors.primary} />
                  <Text style={styles.loadingText}>Loading leaderboard...</Text>
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
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: isDarkMode ? '#1e1e1e' : '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: Platform.OS === 'ios' ? 20 : 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: isDarkMode ? '#333' : '#e0e0e0',
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: 'Lato-Bold',
    color: isDarkMode ? '#fff' : '#000',
  },
  closeButton: {
    padding: 4,
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

export default LeaderboardModal;

