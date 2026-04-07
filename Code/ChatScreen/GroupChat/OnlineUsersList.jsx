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
  TextInput,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { ref, get, query, orderByValue, equalTo, limitToFirst, startAfter, orderByChild, startAt, endAt } from '@react-native-firebase/database';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import InterstitialAdManager from '../../Ads/IntAd';
import { useLocalState } from '../../LocalGlobelStats';
import { mixpanel } from '../../AppHelper/MixPenel';
import config from '../../Helper/Environment';
import RoleBadges from '../../Design/componenets/RoleBadges';
import CreateGroupModal from './CreateGroupModal';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { getUserAdminGroup, addMembersToGroup } from '../utils/groupUtils';
import { getCachedProfile } from '../../Helper/profileCache';
import FramedAvatar from './FramedAvatar';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import { sendGameInvite, isUserInActiveGame } from '../../ValuesScreen/PetGuessingGame/utils/gameInviteSystem';
import { getUserData, cacheUserData } from '../../Helper/UserDataCache';
const INITIAL_LOAD = 5; // Fetch first 10 online users
const LOAD_MORE = 5; // Load 5 more on scroll
const MAX_GROUP_MEMBERS = 50;

const OnlineUsersList = ({
  visible,
  onClose,
  mode = 'view',
  // Game invitation props (only used when mode === 'gameInvite')
  roomId = null,
  onInviteSent = null,
  // Group creation props (only used when mode === 'select')
  // ... existing props work for this
}) => {
  // mode: 'view' = just view online users and start chats
  // mode: 'select' = select users for group creation/addition
  // mode: 'gameInvite' = select users to invite to game
  const { theme, user, appdatabase, firestoreDB } = useGlobalState();
  const { localState } = useLocalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';

  // ✅ Store online users from RTDB (id, displayName, avatar, etc.)
  const [allOnlineUsers, setAllOnlineUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allOnlineUserIds, setAllOnlineUserIds] = useState([]); // All online user IDs from presence
  const [loadedUserIds, setLoadedUserIds] = useState(new Set()); // Track which user IDs we've loaded

  // ✅ Group creation state (only used in 'select' mode)
  const [isSelectionMode, setIsSelectionMode] = useState(mode === 'select');
  const [selectedUserIds, setSelectedUserIds] = useState(new Set());
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);

  // ✅ User's existing group state (only used in 'select' mode)
  const [userGroup, setUserGroup] = useState(null);
  const [checkingGroup, setCheckingGroup] = useState(false);

  // ✅ Game invitation state (only used in 'gameInvite' mode)
  const [invitingIds, setInvitingIds] = useState(new Set());
  const [invitedIds, setInvitedIds] = useState(new Set());

  // ✅ User search state (for finding offline users to invite)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // ✅ Tab state: 'online' = online users, 'search' = search database
  const [activeTab, setActiveTab] = useState('online');

  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // ✅ Check if user has existing group (only in 'select' mode)
  useEffect(() => {
    if (mode !== 'select' || !visible || !appdatabase || !user?.id) {
      setUserGroup(null);
      return;
    }

    setCheckingGroup(true);
    const checkUserGroup = async () => {
      try {
        const result = await getUserAdminGroup(firestoreDB, user.id);
        if (result.success) {
          setUserGroup({ groupId: result.groupId, groupData: result.groupData });
        } else {
          setUserGroup(null);
        }
      } catch (error) {
        console.error('Error checking user group:', error);
        setUserGroup(null);
      } finally {
        setCheckingGroup(false);
      }
    };

    checkUserGroup();
  }, [mode, visible, appdatabase, firestoreDB, user?.id]);

  // ✅ Reset game invitation state when modal closes
  useEffect(() => {
    if (!visible && mode === 'gameInvite') {
      setInvitingIds(new Set());
      setInvitedIds(new Set());
    }
  }, [visible, mode]);

  // ✅ Fetch user metadata from users node (only relevant fields)
  // ✅ OPTIMIZED: Fetch only specific child paths instead of full user objects + CACHING
  const loadUserBatch = useCallback(async (userIds, alreadyLoaded) => {
    if (!appdatabase || userIds.length === 0) return;

    try {
      // ✅ STEP 1: Check cache first (avoid Firebase downloads for cached users)
      const uncachedIds = [];
      const cachedUsers = [];

      userIds.forEach(userId => {
        if (alreadyLoaded.has(userId)) return; // Skip if already loaded in this session

        const cached = getUserData(userId);
        if (cached) {
          // Remove cachedAt from cached data before using
          const { cachedAt, ...userData } = cached;
          cachedUsers.push(userData);
        } else {
          uncachedIds.push(userId);
        }
      });

      // ✅ STEP 2: Only fetch uncached users from Firebase
      // This reduces data transfer significantly (from ~100KB to ~2-5KB per user)
      const userPromises = uncachedIds.map(async (userId) => {
        try {
          // ✅ Fetch only the fields we need (parallel requests to specific child paths)
          const [displayNameSnap, avatarSnap, isProSnap, robloxUsernameVerifiedSnap,
            lastGameWinAtSnap, isAdminSnap, OSSnap, isPlayingSnap,
            isModeratorSnap, isBabyModSnap, isTrustedSnap, isCMSRSnap, isGrinderSnap, isRaiderSnap] = await Promise.all([
              get(ref(appdatabase, `users/${userId}/displayName`)).catch(() => null),
              get(ref(appdatabase, `users/${userId}/avatar`)).catch(() => null),
              get(ref(appdatabase, `users/${userId}/isPro`)).catch(() => null),
              get(ref(appdatabase, `users/${userId}/robloxUsernameVerified`)).catch(() => null),
              get(ref(appdatabase, `users/${userId}/lastGameWinAt`)).catch(() => null),
              get(ref(appdatabase, `users/${userId}/isAdmin`)).catch(() => null),
              get(ref(appdatabase, `users/${userId}/OS`)).catch(() => null),
              get(ref(appdatabase, `users/${userId}/isPlaying`)).catch(() => null),
              get(ref(appdatabase, `users/${userId}/isModerator`)).catch(() => null),
              get(ref(appdatabase, `users/${userId}/isBabyMod`)).catch(() => null),
              get(ref(appdatabase, `users/${userId}/isTrusted`)).catch(() => null),
              get(ref(appdatabase, `users/${userId}/isCMSR`)).catch(() => null),
              get(ref(appdatabase, `users/${userId}/isGrinder`)).catch(() => null),
              get(ref(appdatabase, `users/${userId}/isRaider`)).catch(() => null),
            ]);

          // ✅ Extract values (only if snapshots exist)
          const displayName = displayNameSnap?.exists() ? displayNameSnap.val() : null;

          // If no displayName found, user might not exist - return null
          if (!displayNameSnap || (!displayNameSnap.exists() && !avatarSnap?.exists())) {
            return null;
          }

          const userData = {
            id: userId,
            displayName: displayName || 'Anonymous',
            avatar: avatarSnap?.exists() ? avatarSnap.val() :
              'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
            isPro: isProSnap?.exists() ? isProSnap.val() : false,
            robloxUsernameVerified: robloxUsernameVerifiedSnap?.exists() ? robloxUsernameVerifiedSnap.val() : false,
            lastGameWinAt: lastGameWinAtSnap?.exists() ? lastGameWinAtSnap.val() : null,
            isAdmin: isAdminSnap?.exists() ? isAdminSnap.val() : false,
            OS: OSSnap?.exists() ? OSSnap.val() : null,
            isPlaying: isPlayingSnap?.exists() ? isPlayingSnap.val() : false,
            isModerator: !!(isModeratorSnap?.exists() && isModeratorSnap.val()),
            isBabyMod: !!(isBabyModSnap?.exists() && isBabyModSnap.val()),
            isTrusted: !!(isTrustedSnap?.exists() && isTrustedSnap.val()),
            isCMSR: !!(isCMSRSnap?.exists() && isCMSRSnap.val()),
            isGrinder: !!(isGrinderSnap?.exists() && isGrinderSnap.val()),
            isRaider: !!(isRaiderSnap?.exists() && isRaiderSnap.val()),
          };

          // ✅ STEP 3: Cache the fetched user data for future use
          cacheUserData(userId, userData);

          return userData;
        } catch (error) {
          console.error(`Error fetching user ${userId}:`, error);
          return null;
        }
      });

      const fetchedUsers = (await Promise.all(userPromises)).filter((u) => u !== null);

      // ✅ STEP 4: Combine cached and fetched users
      const allUsers = [...cachedUsers, ...fetchedUsers];

      // ✅ Add new users to existing list
      setAllOnlineUsers((prev) => {
        const existingIds = new Set(prev.map((u) => u.id));
        const newUsers = allUsers.filter((u) => !existingIds.has(u.id));
        return [...prev, ...newUsers];
      });

      // ✅ Track loaded user IDs
      setLoadedUserIds((prev) => {
        const newSet = new Set(prev);
        userIds.forEach((id) => newSet.add(id));
        return newSet;
      });
    } catch (error) {
      console.error('Error loading user batch:', error);
    }
  }, [appdatabase]);

  // ✅ Fetch online user IDs from RTDB presence node when modal opens
  useEffect(() => {
    if (!visible || !appdatabase) {
      // Reset when modal closes
      setAllOnlineUsers([]);
      setAllOnlineUserIds([]);
      setLoadedUserIds(new Set());
      setLoading(true);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const fetchOnlineUserIds = async () => {
      try {
        // ✅ Query presence node for online users (value === true)
        const presenceRef = ref(appdatabase, 'presence');
        const onlineQuery = query(presenceRef, orderByValue(), equalTo(true));
        const snapshot = await get(onlineQuery);

        if (!isMounted) return;

        if (!snapshot.exists()) {
          setAllOnlineUserIds([]);
          setAllOnlineUsers([]);
          setLoading(false);
          return;
        }

        // ✅ Get all online user IDs (include current user too)
        const presenceData = snapshot.val() || {};
        const onlineIds = Object.keys(presenceData)
          .filter((id) => presenceData[id] === true);

        setAllOnlineUserIds(onlineIds);

        // ✅ Load first batch of users
        await loadUserBatch(onlineIds.slice(0, INITIAL_LOAD), new Set());

        if (isMounted) {
          setLoading(false);
        }
      } catch (error) {
        console.error('Error fetching online user IDs from RTDB:', error);
        if (isMounted) {
          setAllOnlineUserIds([]);
          setAllOnlineUsers([]);
          setLoading(false);
        }
      }
    };

    fetchOnlineUserIds();

    return () => {
      isMounted = false;
    };
  }, [visible, appdatabase, user?.id, loadUserBatch]);

  // ✅ Load more users on scroll (next 5 IDs from presence)
  const handleLoadMore = useCallback(async () => {
    if (loadingMore) return;

    // ✅ Find next batch of user IDs that haven't been loaded
    const unloadedIds = allOnlineUserIds.filter((id) => !loadedUserIds.has(id));
    if (unloadedIds.length === 0) return; // All users loaded

    setLoadingMore(true);

    // ✅ Load next batch (5 users)
    const nextBatch = unloadedIds.slice(0, LOAD_MORE);
    await loadUserBatch(nextBatch, loadedUserIds);

    setLoadingMore(false);
  }, [loadingMore, allOnlineUserIds, loadedUserIds, loadUserBatch]);


  // ✅ Reset selection mode when modal closes or mode changes
  useEffect(() => {
    if (!visible) {
      setIsSelectionMode(mode === 'select');
      setSelectedUserIds(new Set());
      setShowCreateGroupModal(false);
      // Reset search state
      setSearchQuery('');
      setSearchResults([]);
      setSearching(false);
      setActiveTab('online');
    }
  }, [visible, mode]);

  // ✅ Search users by displayName/email/id in RTDB (for inviting offline users)
  const searchUsers = useCallback(async (searchText) => {
    if (!appdatabase || !searchText || searchText.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const usersRef = ref(appdatabase, 'users');
      const raw = searchText.trim();
      const allResults = new Map();

      const buildUserResult = (child) => {
        const userData = child.val();
        if (!userData || child.key === user?.id || allResults.has(child.key)) return;
        allResults.set(child.key, {
          id: child.key,
          displayName: userData.displayName || 'Anonymous',
          avatar: userData.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
          isPro: userData.isPro || false,
          robloxUsernameVerified: userData.robloxUsernameVerified || false,
          isAdmin: userData.isAdmin || false,
          isModerator: userData.isModerator || false,
          isOnline: allOnlineUserIds.includes(child.key),
        });
      };

      const isEmailSearch = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) || raw.includes('(dot)');
      const isIdSearch = raw.length >= 15 && /^[a-zA-Z0-9]+$/.test(raw);

      if (isIdSearch) {
        try {
          const userSnap = await get(ref(appdatabase, `users/${raw}`));
          if (userSnap.exists()) {
            buildUserResult({ key: raw, val: () => userSnap.val() });
          }
        } catch (err) { /* ignore */ }
      } else if (isEmailSearch) {
        const email = raw.toLowerCase().trim();
        const encodedEmail = email.replace(/\./g, '(dot)');
        try {
          const directSnap = await get(ref(appdatabase, `users/${encodedEmail}`));
          if (directSnap.exists()) {
            buildUserResult({ key: encodedEmail, val: () => directSnap.val() });
          }
        } catch (err) { /* ignore */ }

        if (allResults.size === 0) {
          try {
            const emailQ = query(usersRef, orderByChild('email'), startAt(email), endAt(email + '\uf8ff'), limitToFirst(10));
            const emailSnap = await get(emailQ);
            if (emailSnap.exists()) {
              emailSnap.forEach((child) => buildUserResult(child));
            }
          } catch (err) { /* ignore */ }
        }
      } else {
        const lower = raw.toLowerCase();
        const searchVariants = [...new Set([
          raw,
          lower.charAt(0).toUpperCase() + lower.slice(1),
          lower,
          raw.toUpperCase(),
        ])];

        const nameQueries = searchVariants.map(async (variant) => {
          try {
            const searchQ = query(usersRef, orderByChild('displayName'), startAt(variant), endAt(variant + '\uf8ff'), limitToFirst(30));
            const snapshot = await get(searchQ);
            if (snapshot.exists()) {
              snapshot.forEach((child) => buildUserResult(child));
            }
          } catch (err) { /* ignore */ }
        });

        await Promise.all(nameQueries);

        // Fallback: client-side contains match
        if (allResults.size < 10 && lower.length >= 2) {
          try {
            const broadQ = query(usersRef, orderByChild('displayName'), limitToFirst(500));
            const broadSnap = await get(broadQ);
            if (broadSnap.exists()) {
              broadSnap.forEach((child) => {
                if (allResults.size >= 50) return;
                const userData = child.val();
                const name = (userData?.displayName || '').toLowerCase();
                if (name.includes(lower)) {
                  buildUserResult(child);
                }
              });
            }
          } catch (err) { /* ignore */ }
        }
      }

      setSearchResults(Array.from(allResults.values()));
    } catch (error) {
      console.error('Error searching users:', error);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [appdatabase, user?.id, allOnlineUserIds]);

  const handleSearch = useCallback(() => {
    if (!searchQuery || searchQuery.trim().length < 2) return;
    searchUsers(searchQuery);
  }, [searchQuery, searchUsers]);

  // ✅ Handle toggle selection mode (only in 'view' mode, 'select' mode is always in selection)
  const handleToggleSelectionMode = useCallback(() => {
    if (mode === 'select') return; // Can't toggle in select mode
    triggerHapticFeedback('impactLight');
    setIsSelectionMode((prev) => !prev);
    if (isSelectionMode) {
      setSelectedUserIds(new Set());
    }
  }, [mode, isSelectionMode, triggerHapticFeedback]);

  // ✅ Handle user selection for group creation
  const handleToggleUserSelection = useCallback((userId) => {
    triggerHapticFeedback('impactLight');
    setSelectedUserIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        // Check max members limit (creator + selected members <= MAX_GROUP_MEMBERS)
        if (newSet.size >= MAX_GROUP_MEMBERS - 1) {
          return prev; // Don't add if limit reached
        }
        newSet.add(userId);
      }
      return newSet;
    });
  }, [triggerHapticFeedback]);

  // ✅ Handle create group or add members button
  const handleCreateOrAddMembers = useCallback(async () => {
    if (selectedUserIds.size === 0) {
      showErrorMessage('No Selection', 'Please select at least one user');
      return;
    }

    triggerHapticFeedback('impactMedium');

    // If user has existing group, add members to it
    if (userGroup?.groupId) {
      const selectedIds = Array.from(selectedUserIds);
      setLoading(true);

      try {
        // ✅ Build user data map from allOnlineUsers + searchResults to avoid extra Firestore read
        const invitedUsersMap = {};
        [...allOnlineUsers, ...searchResults].forEach((u) => {
          if (u.id && selectedIds.includes(u.id) && !invitedUsersMap[u.id]) {
            invitedUsersMap[u.id] = {
              displayName: u.displayName || 'Anonymous',
              avatar: u.avatar || null,
            };
          }
        });

        const result = await addMembersToGroup(
          firestoreDB,
          appdatabase,
          userGroup.groupId,
          selectedIds,
          {
            id: user.id,
            displayName: user.displayName || 'Anonymous',
            avatar: user.avatar || null,
          },
          invitedUsersMap // ✅ Pass user data to avoid extra reads
        );

        if (result.success) {
          showSuccessMessage('Success', `Invitations sent to ${result.invitedCount || selectedIds.length} user(s)!`);
          setSelectedUserIds(new Set());
          setIsSelectionMode(false);
        } else {
          showErrorMessage('Error', result.error || 'Failed to send invitations');
        }
      } catch (error) {
        console.error('Error adding members:', error);
        showErrorMessage('Error', 'Failed to add members. Please try again.');
      } finally {
        setLoading(false);
      }
    } else {
      // Create new group
      setShowCreateGroupModal(true);
    }
  }, [selectedUserIds, userGroup, user, appdatabase, firestoreDB, allOnlineUsers, searchResults, triggerHapticFeedback]);

  // ✅ Handle group created (navigate to group chat)
  const handleGroupCreated = useCallback((groupId) => {
    if (groupId) {
      onClose();
      if (navigation && typeof navigation.navigate === 'function') {
        navigation.navigate('GroupChatDetail', {
          groupId,
        });
      }
    }
  }, [onClose, navigation]);

  // ✅ Handle game invitation (only in 'gameInvite' mode)
  const handleGameInvite = useCallback(async (selectedUser) => {
    if (mode !== 'gameInvite' || !roomId || !firestoreDB || !appdatabase || !user?.id) {
      if (!firestoreDB) {
        console.error('FirestoreDB is required for game invitations');
        showErrorMessage('Error', 'Unable to send invitation. Please try again.');
      }
      return;
    }
    if (invitingIds.has(selectedUser.id) || invitedIds.has(selectedUser.id) || selectedUser.isPlaying) {
      return;
    }

    setInvitingIds((prev) => new Set([...prev, selectedUser.id]));

    try {
      // Check if user is in active game
      const isInActiveGame = await isUserInActiveGame(firestoreDB, selectedUser.id);
      if (isInActiveGame) {
        showErrorMessage('Error', 'This user is already in a game');
        setInvitingIds((prev) => {
          const next = new Set(prev);
          next.delete(selectedUser.id);
          return next;
        });
        return;
      }

      // Send game invitation
      const success = await sendGameInvite(
        firestoreDB,
        roomId,
        {
          id: user.id,
          displayName: user.displayName || 'Anonymous',
          avatar: user.avatar || null,
        },
        selectedUser.id
      );

      if (success) {
        setInvitedIds((prev) => new Set([...prev, selectedUser.id]));
        showSuccessMessage('Invite Sent', `Invited ${selectedUser.displayName} to play!`);
        // ✅ Notify parent component that invite was sent
        if (onInviteSent && typeof onInviteSent === 'function') {
          onInviteSent(selectedUser);
        }
      } else {
        showErrorMessage('Error', 'Failed to send invite. Please try again.');
      }
    } catch (error) {
      console.error('Error inviting user to game:', error);
      showErrorMessage('Error', 'Failed to send invite.');
    } finally {
      setInvitingIds((prev) => {
        const next = new Set(prev);
        next.delete(selectedUser.id);
        return next;
      });
    }
  }, [mode, roomId, firestoreDB, appdatabase, user, invitingIds, invitedIds, onInviteSent]);

  // ✅ Handle start private chat (only in 'view' mode)
  const handleStartChat = useCallback((selectedUser) => {
    if (mode === 'select') {
      // In select mode, toggle selection instead
      handleToggleUserSelection(selectedUser.id);
      return;
    }

    if (mode === 'gameInvite') {
      // In game invite mode, send invite instead
      handleGameInvite(selectedUser);
      return;
    }

    const callbackFunction = () => {
      onClose();
      if (navigation && typeof navigation.navigate === 'function') {
        navigation.navigate('PrivateChat', {
          selectedUser: {
            senderId: selectedUser.id,
            sender: selectedUser.displayName,
            avatar: selectedUser.avatar,
          },
        });
      }
      mixpanel.track("Online Users Chat");
    };

    callbackFunction();
  }, [mode, onClose, navigation, localState?.isPro, handleToggleUserSelection, handleGameInvite]);

  // ✅ Get selected users for group creation (from both online users AND search results)
  const selectedUsers = useMemo(() => {
    const combined = new Map();
    [...allOnlineUsers, ...searchResults].forEach((u) => {
      if (selectedUserIds.has(u.id) && !combined.has(u.id)) {
        combined.set(u.id, u);
      }
    });
    return Array.from(combined.values());
  }, [allOnlineUsers, searchResults, selectedUserIds]);

  // ✅ Choose which list to display based on activeTab
  const displayUsers = useMemo(() => {
    if (activeTab === 'search') return searchResults;
    return allOnlineUsers;
  }, [activeTab, searchResults, allOnlineUsers]);

  // ✅ Memoize render user item
  const renderUserItem = useCallback(({ item }) => {
    if (!item || !item.id) return null;

    const isSelected = selectedUserIds.has(item.id);
    const isInviting = invitingIds.has(item.id);
    const isInvited = invitedIds.has(item.id);
    const isPlaying = item.isPlaying || false;

    return (
      <TouchableOpacity
        style={[styles.userItem, isSelected && styles.userItemSelected]}
        onPress={() => handleStartChat(item)}
        activeOpacity={0.7}
        disabled={mode === 'gameInvite' && (isInviting || isInvited || isPlaying)}
      >
        {mode === 'select' && (
          <View style={styles.checkboxContainer}>
            <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
              {isSelected && <Icon name="checkmark" size={14} color="#fff" />}
            </View>
          </View>
        )}
        <View style={styles.userItemLeft}>
          <FramedAvatar
            avatarUri={item.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
            frame={getCachedProfile(item.id)?.profileFrame || null}
            isDarkMode={isDarkMode}
            avatarSize={44}
          />
          <View style={styles.onlineIndicator} />
        </View>
        <View style={styles.userInfo}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
            <Text style={styles.userName} numberOfLines={1}>
              {`${item.displayName || 'Anonymous'}`}
            </Text>
            <RoleBadges userItem={item} />

            {/* Pro badge */}
            {item?.isPro && (
              <Image
                source={require('../../../assets/pro.png')}
                style={{ width: 10, height: 10, marginRight: 5 }}
              />
            )}

            {/* Verified badge */}
            {item?.robloxUsernameVerified && (
              <Image
                source={require('../../../assets/verification.png')}
                style={{ width: 10, height: 10, marginRight: 5 }}
              />
            )}

            {/* Trophy badge (recent win) */}
            {(item?.hasRecentGameWin ||
              (typeof item?.lastGameWinAt === 'number' &&
                Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000)) && (
                <Image
                  source={require('../../../assets/trophy.webp')}
                  style={{ width: 10, height: 10, marginLeft: 4 }}
                />
              )}

            {/* Platform badge (for admins) */}
            {item?.isAdmin && item?.OS && (
              <View
                style={{
                  marginLeft: 4,
                  paddingHorizontal: 4,
                  paddingVertical: 1,
                  borderRadius: 3,
                  backgroundColor: isDarkMode ? '#1F2937' : '#F3F4F6',
                }}
              >
                <Icon
                  name={item.OS === 'ios' ? 'logo-apple' : 'logo-android'}
                  size={12}
                  color={item.OS === 'ios' ? '#007AFF' : '#34C759'}
                />
              </View>
            )}
          </View>
          {mode === 'gameInvite' && (
            <Text style={[styles.statusText, { color: isDarkMode ? '#9CA3AF' : '#6B7280' }]}>
              {isPlaying ? 'Currently Playing' : 'Online'}
            </Text>
          )}
        </View>
        {mode === 'view' && (
          <Icon name="chatbubble-outline" size={18} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
        )}
        {mode === 'gameInvite' && (
          <>
            {isInviting ? (
              <ActivityIndicator size="small" color={config.colors.primary || '#8B5CF6'} />
            ) : isInvited ? (
              <View style={styles.invitedBadge}>
                <Icon name="checkmark-circle" size={20} color="#10B981" />
              </View>
            ) : isPlaying ? (
              <View style={styles.playingBadge}>
                <Icon name="game-controller-outline" size={18} color="#F59E0B" />
              </View>
            ) : (
              <TouchableOpacity
                style={styles.inviteButton}
                onPress={() => handleGameInvite(item)}
              >
                <Icon name="person-add-outline" size={18} color="#fff" />
              </TouchableOpacity>
            )}
          </>
        )}
      </TouchableOpacity>
    );
  }, [styles, handleStartChat, isDarkMode, isSelectionMode, selectedUserIds, mode, invitingIds, invitedIds, handleGameInvite]);

  // ✅ Memoize key extractor
  const keyExtractor = useCallback((item) => item?.id || Math.random().toString(), []);

  return (
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
              <Text style={styles.headerTitle}>
                {mode === 'select' ? 'Select Members' : mode === 'gameInvite' ? 'Invite Friends to Play' : 'Online Users'}
              </Text>
              <View style={styles.headerRight}>
                {mode === 'select' ? (
                  // Selection mode header
                  <>
                    <TouchableOpacity
                      onPress={onClose}
                      style={styles.headerButton}
                    >
                      <Text style={styles.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                    {selectedUserIds.size > 0 && (
                      <TouchableOpacity
                        onPress={handleCreateOrAddMembers}
                        style={[styles.headerButton, styles.createGroupButton]}
                        disabled={loading}
                      >
                        <Text style={styles.createGroupText}>
                          {userGroup ? `Add (${selectedUserIds.size})` : `Create (${selectedUserIds.size})`}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                ) : (
                  // View mode or game invite mode header (just close button)
                  <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                    <Icon name="close" size={22} color={isDarkMode ? '#FFFFFF' : '#000000'} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Tab Bar (only in select mode) */}
            {mode === 'select' && (
              <View style={{
                flexDirection: 'row',
                marginHorizontal: 16,
                marginTop: 12,
                marginBottom: 8,
                backgroundColor: isDarkMode ? '#374151' : '#F3F4F6',
                borderRadius: 12,
                padding: 4,
              }}>
                <TouchableOpacity
                  onPress={() => {
                    setActiveTab('online');
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 8,
                    backgroundColor: activeTab === 'online'
                      ? (isDarkMode ? '#1F2937' : '#FFFFFF')
                      : 'transparent',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{
                    fontSize: 13,
                    fontWeight: activeTab === 'online' ? '600' : '400',
                    color: isDarkMode ? '#FFFFFF' : '#111827',
                  }}>
                    Online Users
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setActiveTab('search')}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 8,
                    backgroundColor: activeTab === 'search'
                      ? (isDarkMode ? '#1F2937' : '#FFFFFF')
                      : 'transparent',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{
                    fontSize: 13,
                    fontWeight: activeTab === 'search' ? '600' : '400',
                    color: isDarkMode ? '#FFFFFF' : '#111827',
                  }}>
                    Search & Invite
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Search Input (only in search tab) */}
            {mode === 'select' && activeTab === 'search' && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: isDarkMode ? '#374151' : '#F3F4F6',
                  borderRadius: 12,
                  paddingLeft: 12,
                  height: 44,
                  overflow: 'hidden',
                }}>
                  <Icon name="search-outline" size={20} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search by name, email, or ID"
                    placeholderTextColor={isDarkMode ? '#6B7280' : '#9CA3AF'}
                    style={{
                      flex: 1,
                      marginLeft: 8,
                      fontSize: 14,
                      color: isDarkMode ? '#FFFFFF' : '#111827',
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onSubmitEditing={handleSearch}
                    returnKeyType="search"
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }} style={{ paddingHorizontal: 8 }}>
                      <Icon name="close-circle" size={20} color={isDarkMode ? '#6B7280' : '#9CA3AF'} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={handleSearch}
                    disabled={searchQuery.trim().length < 2 || searching}
                    style={{
                      backgroundColor: searchQuery.trim().length >= 2 ? (config.colors?.primary || '#8B5CF6') : (isDarkMode ? '#4B5563' : '#D1D5DB'),
                      paddingHorizontal: 16,
                      height: 44,
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    {searching ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 13 }}>Search</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Users List */}
            {loading && activeTab === 'online' ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={config.colors.primary} />
              </View>
            ) : displayUsers.length === 0 && activeTab === 'online' ? (
              <View style={styles.emptyContainer}>
                <Icon
                  name="people-outline"
                  size={64}
                  color={isDarkMode ? '#4B5563' : '#D1D5DB'}
                />
                <Text style={styles.emptyText}>
                  No online users
                </Text>
              </View>
            ) : displayUsers.length === 0 && activeTab === 'search' ? (
              <View style={styles.emptyContainer}>
                <Icon
                  name="search-outline"
                  size={64}
                  color={isDarkMode ? '#4B5563' : '#D1D5DB'}
                />
                <Text style={styles.emptyText}>
                  {searchQuery.trim().length === 0 ? 'Search users by name, email, or ID' : 'No users found'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={displayUsers}
                renderItem={renderUserItem}
                keyExtractor={keyExtractor}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                removeClippedSubviews={false}
                maxToRenderPerBatch={5}
                windowSize={5}
                initialNumToRender={5}
                onEndReached={handleLoadMore}
                onEndReachedThreshold={0.5}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                ListFooterComponent={
                  activeTab === 'online' && allOnlineUserIds.length > loadedUserIds.size ? (
                    <View style={styles.loadMoreContainer}>
                      {loadingMore ? (
                        <ActivityIndicator size="small" color={config.colors.primary} />
                      ) : (
                        <Text style={styles.loadMoreText}>
                          {allOnlineUserIds.length - loadedUserIds.size} more users available
                        </Text>
                      )}
                    </View>
                  ) : null
                }
              />
            )}

            {/* Footer Info */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>
                {mode === 'select'
                  ? selectedUserIds.size > 0
                    ? `${selectedUserIds.size} selected (max ${MAX_GROUP_MEMBERS - 1})`
                    : 'Select users to create a group'
                  : `${allOnlineUserIds.length} ${allOnlineUserIds.length === 1 ? 'user' : 'users'} online${allOnlineUsers.length < allOnlineUserIds.length ? ` (loaded ${allOnlineUsers.length})` : ''}`
                }
              </Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </TouchableOpacity>

      {/* Create Group Modal */}
      <CreateGroupModal
        visible={showCreateGroupModal}
        onClose={() => {
          setShowCreateGroupModal(false);
          setIsSelectionMode(false);
          setSelectedUserIds(new Set());
        }}
        selectedUsers={selectedUsers}
      />
    </Modal>
  );
};

const getStyles = (isDark) =>
  StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: 500,
      minHeight: 400,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 12,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: isDark ? '#374151' : '#E5E7EB',
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: isDark ? '#FFFFFF' : '#111827',
      fontWeight: 'bold',
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    headerButton: {
      padding: 4,
    },
    cancelText: {
      fontSize: 14,
      fontWeight: '600',
      color: isDark ? '#FFFFFF' : '#111827',
    },
    createGroupButton: {
      backgroundColor: '#8B5CF6',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 6,
    },
    createGroupText: {
      fontSize: 13,
      fontWeight: 'bold',
      color: '#FFFFFF',
    },
    closeButton: {
      padding: 4,
    },
    checkboxContainer: {
      marginRight: 10,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: isDark ? '#6B7280' : '#9CA3AF',
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxSelected: {
      backgroundColor: '#8B5CF6',
      borderColor: '#8B5CF6',
    },
    userItemSelected: {
      backgroundColor: isDark ? '#4B5563' : '#E0E7FF',
      borderWidth: 2,
      borderColor: '#8B5CF6',
    },
    list: {
      flex: 1,
      maxHeight: '100%',
    },
    listContent: {
      padding: 6,
    },
    userItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 8,
      marginVertical: 3,
      marginHorizontal: 6,
      backgroundColor: isDark ? '#374151' : '#F9FAFB',
      borderRadius: 10,
    },
    userItemLeft: {
      position: 'relative',
      marginRight: 10,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: isDark ? '#4B5563' : '#E5E7EB',
    },
    onlineIndicator: {
      position: 'absolute',
      bottom: 1,
      right: 1,
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: '#10B981',
      borderWidth: 2,
      borderColor: isDark ? '#1F2937' : '#FFFFFF',
    },
    userInfo: {
      flex: 1,
      marginRight: 6,
    },
    userName: {
      fontSize: 14,
      color: isDark ? '#FFFFFF' : '#111827',
      fontWeight: '600'
    },
    statusText: {
      fontSize: 12,

      marginTop: 2,
    },
    inviteButton: {
      backgroundColor: '#8B5CF6',
      width: 36,
      height: 36,
      borderRadius: 18,
      justifyContent: 'center',
      alignItems: 'center',
    },
    invitedBadge: {
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'center',
    },
    playingBadge: {
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(245, 158, 11, 0.1)',
      borderRadius: 18,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 30,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 40,
    },
    emptyText: {
      marginTop: 12,
      fontSize: 14,
      color: isDark ? '#9CA3AF' : '#6B7280',

    },
    footer: {
      padding: 10,
      paddingHorizontal: 16,
      borderTopWidth: 1,
      borderTopColor: isDark ? '#374151' : '#E5E7EB',
      alignItems: 'center',
    },
    footerText: {
      fontSize: 12,
      color: isDark ? '#9CA3AF' : '#6B7280',

    },
    loadMoreContainer: {
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    loadMoreText: {
      fontSize: 12,
      color: isDark ? '#9CA3AF' : '#6B7280',

    },
  });

export default OnlineUsersList;
