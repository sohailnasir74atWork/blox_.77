// InviteUsersModal.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../../GlobelStats';
import {
  getOnlineUserIdsForInvite,
  fetchUserDetailsForInvite,
  sendGameInvite,
} from '../utils/gameInviteSystem';
import { showSuccessMessage, showErrorMessage } from '../../../Helper/MessageHelper';

const InviteUsersModal = ({ visible, onClose, roomId, currentUser, onInviteSent }) => {
  const { appdatabase, firestoreDB, theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  
  // ✅ OPTIMIZED: Store only user IDs (lightweight)
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  // ✅ Store fetched user details (only for displayed users)
  const [userDetails, setUserDetails] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [displayedCount, setDisplayedCount] = useState(5); // Start with 5 users (same as OnlineUsersList)
  const [loadingMore, setLoadingMore] = useState(false);
  const [invitingIds, setInvitingIds] = useState(new Set());
  const [invitedIds, setInvitedIds] = useState(new Set());

  const userDetailsRef = useRef({}); // ✅ Cache user details (prevents re-renders)

  // ✅ Reset when modal closes
  useEffect(() => {
    if (!visible) {
      setOnlineUserIds([]);
      setUserDetails({});
      setSearchQuery('');
      setDisplayedCount(5);
      setInvitingIds(new Set());
      setInvitedIds(new Set());
      userDetailsRef.current = {};
    }
  }, [visible]);

  // ✅ Fetch ALL user IDs from Firestore ONCE when modal opens (same pattern as OnlineUsersList.jsx)
  const hasFetchedIdsRef = useRef(false);
  
  useEffect(() => {
    if (!visible || !firestoreDB || !currentUser?.id) {
      // Reset when modal closes
      setOnlineUserIds([]);
      setUserDetails({});
      setSearchQuery('');
      setDisplayedCount(5);
      setInvitingIds(new Set());
      setInvitedIds(new Set());
      userDetailsRef.current = {};
      hasFetchedIdsRef.current = false;
      return;
    }

    // ✅ Only fetch once when modal opens
    if (hasFetchedIdsRef.current) return;

    let isMounted = true;
    setLoading(true);
    hasFetchedIdsRef.current = true;

    const fetchOnlineUserIds = async () => {
      try {
        // ✅ Get ALL user IDs from RTDB presence node (same pattern as OnlineUsersList.jsx)
        const allUserIds = await getOnlineUserIdsForInvite(appdatabase, currentUser.id);
        
        if (!isMounted) return;
        
        // Store all IDs
        setOnlineUserIds(allUserIds);
        
        // ✅ Initially fetch details for first 5 users (same as OnlineUsersList.jsx)
        if (allUserIds.length > 0) {
          const initialBatch = allUserIds.slice(0, 5);
          const initialDetails = await fetchUserDetailsForInvite(appdatabase, initialBatch);
          if (isMounted) {
            setUserDetails(prev => ({ ...prev, ...initialDetails }));
            setDisplayedCount(5);
          }
        }
        
        if (isMounted) {
          setLoading(false);
        }
      } catch (error) {
        console.error('Error fetching online users from RTDB:', error);
        if (isMounted) {
          setOnlineUserIds([]);
          setUserDetails({});
          setDisplayedCount(0);
          setLoading(false);
        }
      }
    };

    fetchOnlineUserIds();

    return () => {
      isMounted = false;
    };
  }, [visible, firestoreDB, currentUser?.id]);

  // ✅ Load more user details on scroll (5 by 5) - same pattern as OnlineUsersList.jsx
  const loadedCount = useMemo(() => {
    return Object.keys(userDetails).length;
  }, [userDetails]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || searchQuery.trim() || loadedCount >= onlineUserIds.length) return;
    
    setLoadingMore(true);
    try {
      // ✅ Calculate next batch (5 at a time)
      const nextBatchStart = loadedCount;
      const nextBatchEnd = Math.min(nextBatchStart + 5, onlineUserIds.length);
      const nextBatch = onlineUserIds.slice(nextBatchStart, nextBatchEnd);
      
      if (nextBatch.length > 0) {
        // ✅ Fetch details for next 5 users
        const newDetails = await fetchUserDetailsForInvite(appdatabase, nextBatch);
        userDetailsRef.current = { ...userDetailsRef.current, ...newDetails };
        setUserDetails(prev => ({ ...prev, ...newDetails }));
        setDisplayedCount(nextBatchEnd);
      }
    } catch (error) {
      console.error('Error loading more user details:', error);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, searchQuery, loadedCount, onlineUserIds, appdatabase, firestoreDB]);

  // ✅ Handle search: Fetch details for all users if needed (same pattern as OnlineUsersList.jsx)
  useEffect(() => {
    if (!visible || !searchQuery.trim() || !appdatabase || loadedCount >= onlineUserIds.length) return;

    let isMounted = true;

    const performSearch = async () => {
      try {
        // ✅ If we haven't loaded all user details yet, load them for search
        if (loadedCount < onlineUserIds.length) {
          const remainingIds = onlineUserIds.slice(loadedCount);
          const remainingDetails = await fetchUserDetailsForInvite(appdatabase, remainingIds);
          if (isMounted) {
            userDetailsRef.current = { ...userDetailsRef.current, ...remainingDetails };
            setUserDetails(prev => ({ ...prev, ...remainingDetails }));
            setDisplayedCount(onlineUserIds.length);
          }
        }
      } catch (error) {
        console.error('Error loading user details for search:', error);
      }
    };

    performSearch();

    return () => {
      isMounted = false;
    };
  }, [searchQuery, visible, appdatabase, loadedCount, onlineUserIds.length, firestoreDB]);

  // ✅ Get users with details (only loaded users have details) - same pattern as OnlineUsersList.jsx
  const usersWithDetails = useMemo(() => {
    return onlineUserIds
      .slice(0, loadedCount) // Only show users we've loaded details for
      .map(userId => {
        const details = userDetails[userId] || userDetailsRef.current[userId];
        if (!details) return null; // Not loaded yet
        return { ...details, id: userId };
      })
      .filter(Boolean); // Remove nulls
  }, [onlineUserIds, loadedCount, userDetails]);

  // ✅ Filter users based on search query
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) {
      // No search: Return loaded users
      return usersWithDetails;
    }
    
    // Search active: Filter all loaded users
    const query = searchQuery.toLowerCase();
    return usersWithDetails.filter(user => 
      user?.displayName?.toLowerCase().includes(query)
    );
  }, [usersWithDetails, searchQuery]);


  const handleInvite = async (user) => {
    if (!roomId || invitingIds.has(user.id) || invitedIds.has(user.id) || user.isPlaying) return;

    setInvitingIds((prev) => new Set([...prev, user.id]));

    try {
      const success = await sendGameInvite(firestoreDB, roomId, currentUser, user.id);
      
      if (success) {
        setInvitedIds((prev) => new Set([...prev, user.id]));
        showSuccessMessage('Invite Sent', `Invited ${user.displayName} to play!`);
        // ✅ Notify parent component that invite was sent
        if (onInviteSent && typeof onInviteSent === 'function') {
          onInviteSent(user);
        }
      } else {
        showErrorMessage('Error', 'Failed to send invite. Please try again.');
      }
    } catch (error) {
      console.error('Error inviting user:', error);
      showErrorMessage('Error', 'Failed to send invite.');
    } finally {
      setInvitingIds((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <View style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: isDarkMode ? '#fff' : '#000' }]}>
              Invite Friends to Play
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchContainer}>
            <Icon name="search" size={20} color={isDarkMode ? '#9CA3AF' : '#6B7280'} style={styles.searchIcon} />
          <TextInput
            style={[
              styles.searchInput,
              {
                backgroundColor: isDarkMode ? '#2a2a2a' : '#f5f5f5',
                color: isDarkMode ? '#fff' : '#000',
              },
            ]}
            placeholder="Search online users..."
            placeholderTextColor={isDarkMode ? '#999' : '#666'}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setSearchQuery('');
                  setDisplayedCount(6); // Reset pagination when clearing search
                }}
                style={styles.clearButton}
              >
                <Icon name="close-circle" size={20} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
              </TouchableOpacity>
            )}
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#8B5CF6" />
            </View>
          ) : filteredUsers.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Icon
                name="people-outline"
                size={64}
                color={isDarkMode ? '#666' : '#999'}
              />
              <Text style={[styles.emptyText, { color: isDarkMode ? '#999' : '#666' }]}>
                {searchQuery ? 'No users found' : 'No online users available'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredUsers}
              keyExtractor={(item) => item.id}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.5}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ListFooterComponent={
                !searchQuery.trim() && loadedCount < onlineUserIds.length ? (
                  <View style={styles.loadMoreContainer}>
                    <ActivityIndicator size="small" color="#8B5CF6" />
                  </View>
                ) : null
              }
              removeClippedSubviews={true}
              maxToRenderPerBatch={6}
              windowSize={5}
              initialNumToRender={6}
              renderItem={({ item }) => {
                const isInviting = invitingIds.has(item.id);
                const isInvited = invitedIds.has(item.id);
                const isPlaying = item.isPlaying;

                return (
                  <TouchableOpacity
                    style={[
                      styles.userItem,
                      { backgroundColor: isDarkMode ? '#2a2a2a' : '#f9f9f9' },
                    ]}
                    onPress={() => !isInvited && !isPlaying && handleInvite(item)}
                    disabled={isInviting || isInvited || isPlaying}
                  >
                    <Image
                      source={{
                        uri:
                          item.avatar ||
                          'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                      }}
                      style={styles.avatar}
                    />
                    <View style={styles.userInfo}>
                      <Text
                        style={[styles.userName, { color: isDarkMode ? '#fff' : '#000' }]}
                      >
                        {item.displayName}
                      </Text>
                      <View style={styles.onlineIndicator}>
                        <View style={styles.onlineDot} />
                        <Text style={[styles.onlineText, { color: isDarkMode ? '#999' : '#666' }]}>
                          {isPlaying ? 'Currently Playing' : 'Online'}
                        </Text>
                      </View>
                    </View>
                    {isInviting ? (
                      <ActivityIndicator size="small" color="#8B5CF6" />
                    ) : isInvited ? (
                      <View style={styles.invitedBadge}>
                        <Icon name="checkmark-circle" size={24} color="#10B981" />
                      </View>
                    ) : isPlaying ? (
                      <View style={styles.playingBadge}>
                        <Icon name="game-controller-outline" size={20} color="#F59E0B" />
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.inviteButton}
                        onPress={() => handleInvite(item)}
                      >
                        <Icon name="person-add-outline" size={20} color="#fff" />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const getStyles = (isDark) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Lato-Bold',
  },
  closeButton: {
    padding: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: isDark ? '#2a2a2a' : '#f5f5f5',
    borderRadius: 10,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Lato-Regular',
  },
  clearButton: {
    marginLeft: 8,
    padding: 4,
  },
  loadMoreContainer: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    fontFamily: 'Lato-Regular',
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontFamily: 'Lato-Bold',
    marginBottom: 4,
  },
  onlineIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  onlineText: {
    fontSize: 12,
    fontFamily: 'Lato-Regular',
  },
  inviteButton: {
    backgroundColor: '#8B5CF6',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  invitedBadge: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playingBadge: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 20,
  },
});

export default InviteUsersModal;
