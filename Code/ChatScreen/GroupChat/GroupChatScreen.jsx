import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  ActivityIndicator,
  Alert,
  Text,
  RefreshControl,
  TouchableOpacity,
  Modal,
  FlatList,
  Image,
} from 'react-native';
import { useFocusEffect, useRoute, useNavigation } from '@react-navigation/native';
import { getStyles } from '../Style';
import GroupMessageInput from './GroupMessageInput';
import GroupMessageList from './GroupMessageList';
import { useGlobalState } from '../../GlobelStats';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { setActiveChat, clearActiveChat, setActiveGroupChat, clearActiveGroupChat } from '../utils';
import { get, ref, update, query as dbQuery, orderByKey, limitToLast, orderByValue, equalTo } from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { sendGroupMessage, removeMemberFromGroup, hasGroupPermission, getPendingInviteForGroup, acceptGroupInvite, declineGroupInvite, leaveGroup, makeMemberCreator } from '../utils/groupUtils';
import { doc, getDoc, onSnapshot, collection, query, where, getDocs } from '@react-native-firebase/firestore';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import Icon from 'react-native-vector-icons/Ionicons';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import ProfileBottomDrawer from './BottomDrawer';
import { isUserOnline, handleDeleteLast300Messages } from '../utils';
import { useLocalState } from '../../LocalGlobelStats';
import PetModal from '../PrivateChat/PetsModel';
import config from '../../Helper/Environment';
import BannerAdComponent from '../../Ads/bannerAds';
import InterstitialAdManager from '../../Ads/IntAd';

const INITIAL_PAGE_SIZE = 15; // ✅ Initial load: 15 messages
const PAGE_SIZE = 10; // ✅ Pagination: load 10 messages per batch
const MEMBER_STATUS_BATCH_SIZE = 5; // ✅ Load 5 member statuses at a time

const GroupChatScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { groupId } = route.params || {};

  const { user, theme, appdatabase, firestoreDB, currentUserEmail, strikeInfo, isAdmin } = useGlobalState();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [groupData, setGroupData] = useState(null);
  const [isPaginating, setIsPaginating] = useState(false);
  const [onlineMembers, setOnlineMembers] = useState([]);
  const [loadedMemberStatuses, setLoadedMemberStatuses] = useState(new Set()); // Track which members' status we've checked
  const [loadingMemberStatuses, setLoadingMemberStatuses] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [pendingInvite, setPendingInvite] = useState(null);
  const [pendingInvitations, setPendingInvitations] = useState([]); // All pending invitations for the group
  const [isMember, setIsMember] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedUserForDrawer, setSelectedUserForDrawer] = useState(null);
  const [selectedUserOnline, setSelectedUserOnline] = useState(false);
  const [memberToMakeCreator, setMemberToMakeCreator] = useState(null);
  const [petModalVisible, setPetModalVisible] = useState(false);
  const [selectedFruits, setSelectedFruits] = useState([]);
  const [replyTo, setReplyTo] = useState(null); // Reply to message state
  const [highlightedMessageId, setHighlightedMessageId] = useState(null); // Highlighted message ID
  const flatListRef = useRef(null); // Ref for FlatList in GroupMessageList
  const lastLoadedKeyRef = useRef(null); // Oldest message ID (for pagination)
  const newestMessageIdRef = useRef(null); // Newest message ID (for real-time listener)
  const previousGroupIdRef = useRef(null);
  const hasSentMessageRef = useRef(0); // Track count of messages user sent (for exit ad)
  const chatEnterTimeRef = useRef(null); // Track when user entered chat (for exit ad)
  const { t } = useTranslation();

  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const messagesRef = useMemo(
    () => (groupId ? ref(appdatabase, `group_messages/${groupId}/messages`) : null),
    [groupId, appdatabase],
  );

  // Load group data from Firestore and check access
  // ✅ OPTIMIZED: Fetch invite data once on mount, not inside listener (reduces nested reads)
  useEffect(() => {
    if (!groupId || !firestoreDB || !user?.id) return;

    // Fetch invite data once on mount
    const fetchInviteData = async () => {
      const inviteResult = await getPendingInviteForGroup(firestoreDB, groupId, user.id);
      if (inviteResult.success) {
        setPendingInvite({
          id: inviteResult.inviteId,
          ...inviteResult.inviteData,
        });
      } else {
        setPendingInvite(null);
      }
    };

    fetchInviteData();
  }, [groupId, firestoreDB, user?.id]);

  useEffect(() => {
    if (!groupId || !firestoreDB || !user?.id) return;

    setCheckingAccess(true);
    const groupRef = doc(firestoreDB, 'groups', groupId);
    const unsubscribe = onSnapshot(
      groupRef,
      (snapshot) => {
        if (snapshot.exists) {
          const data = snapshot.data();
          setGroupData(data);

          // Check if user is a member
          const memberIds = data.memberIds || [];
          const userIsMember = memberIds.includes(user.id);
          setIsMember(userIsMember);

          // ✅ OPTIMIZED: Only update invite state if membership status changed
          // Don't fetch invite data here (already fetched on mount)
          if (userIsMember) {
            setPendingInvite(null);
          }
        } else {
          Alert.alert('Error', 'Group not found');
          setGroupData(null);
        }
        setCheckingAccess(false);
      },
      (error) => {
        console.error('Error loading group data:', error);
        showErrorMessage('Error', 'Failed to load group');
        setCheckingAccess(false);
      }
    );

    return () => unsubscribe();
  }, [groupId, firestoreDB, user?.id]);

  // ✅ Function to load a batch of member statuses
  const loadMemberStatusesBatch = useCallback(async (memberIds) => {
    if (!appdatabase || memberIds.length === 0 || loadingMemberStatuses) return;

    // ✅ Filter out already loaded members to prevent duplicate checks
    const unloadedIds = memberIds.filter(id => !loadedMemberStatuses.has(id));
    if (unloadedIds.length === 0) {
      // All members in this batch are already loaded, no need to fetch
      return;
    }

    setLoadingMemberStatuses(true);
    try {
      // ✅ Check each member's presence in parallel (only unloaded ones)
      const presencePromises = unloadedIds.map(async (memberId) => {
        try {
          const memberPresenceRef = ref(appdatabase, `presence/${memberId}`);
          const snapshot = await get(memberPresenceRef);
          const isOnline = snapshot.exists() && snapshot.val() === true;
          return { memberId, isOnline };
        } catch (error) {
          return { memberId, isOnline: false };
        }
      });

      const results = await Promise.all(presencePromises);

      // ✅ Update online members list
      setOnlineMembers((prev) => {
        const newSet = new Set(prev);
        results.forEach(({ memberId, isOnline }) => {
          if (isOnline) {
            newSet.add(memberId);
          } else {
            newSet.delete(memberId);
          }
        });
        return Array.from(newSet);
      });

      // ✅ Track which members we've loaded (only the ones we actually checked)
      setLoadedMemberStatuses((prev) => {
        const newSet = new Set(prev);
        unloadedIds.forEach((id) => newSet.add(id));
        return newSet;
      });
    } catch (error) {
      console.error('Error loading member statuses:', error);
    } finally {
      setLoadingMemberStatuses(false);
    }
  }, [appdatabase, loadingMemberStatuses, loadedMemberStatuses]);

  // ✅ Reset when modal closes
  useEffect(() => {
    if (!showMembersModal) {
      setOnlineMembers([]);
      setLoadedMemberStatuses(new Set());
      return;
    }
  }, [showMembersModal]);

  // ✅ Load first batch of member statuses when modal opens
  useEffect(() => {
    if (!showMembersModal || !groupData || !appdatabase || !user?.id) {
      return;
    }

    const groupMemberIds = groupData.memberIds || [];
    if (groupMemberIds.length === 0) {
      return;
    }

    // ✅ Load first batch of members' status
    const loadFirstBatch = async () => {
      const firstBatch = groupMemberIds.slice(0, MEMBER_STATUS_BATCH_SIZE);
      await loadMemberStatusesBatch(firstBatch);
    };

    loadFirstBatch();
  }, [showMembersModal, groupData, appdatabase, user?.id, loadMemberStatusesBatch]);

  // ✅ OPTIMIZED: Load pending invitations ONLY when members modal opens (lazy loading)
  const fetchPendingInvitations = useCallback(async () => {
    if (!groupId || !firestoreDB || !groupData || !appdatabase) {
      setPendingInvitations([]);
      return;
    }

    try {
      const invitationsQuery = query(
        collection(firestoreDB, 'group_invitations'),
        where('groupId', '==', groupId),
        where('status', '==', 'pending')
      );
      const snapshot = await getDocs(invitationsQuery);

      const invitations = [];
      const memberIds = groupData.memberIds || [];

      // ✅ OPTIMIZED: Use stored invited user data first, only fetch from RTDB users node if needed (lazy loading)
      let onlineUsersMap = null; // Lazy load only if needed

      // ✅ Process invitations - Show the INVITED USER's info (not the creator who sent it)
      for (const docSnapshot of snapshot.docs) {
        const data = docSnapshot.data();
        // Check if invitation is expired and user is not already a member
        if (data.expiresAt && Date.now() < data.expiresAt && !memberIds.includes(data.invitedUserId)) {
          // ✅ Priority: Use stored data first, then fallback to RTDB users node, then "Anonymous"
          const invitedUserId = data.invitedUserId;
          let displayName = 'Anonymous';
          let avatar = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';

          // 1. First priority: Use stored data from invitation document (NO Firestore read needed)
          if (data.invitedUserDisplayName) {
            displayName = data.invitedUserDisplayName;
          }
          if (data.invitedUserAvatar) {
            avatar = data.invitedUserAvatar;
          }

          // 2. Fallback: Lazy load from RTDB users node ONLY if stored data not available
          // ✅ OPTIMIZED: Fetch only displayName and avatar instead of full user object
          if (displayName === 'Anonymous' && invitedUserId && onlineUsersMap === null) {
            try {
              const [displayNameSnap, avatarSnap] = await Promise.all([
                get(ref(appdatabase, `users/${invitedUserId}/displayName`)).catch(() => null),
                get(ref(appdatabase, `users/${invitedUserId}/avatar`)).catch(() => null),
              ]);

              if (displayNameSnap?.exists() || avatarSnap?.exists()) {
                onlineUsersMap = {
                  [invitedUserId]: {
                    displayName: displayNameSnap?.exists() ? displayNameSnap.val() : 'Anonymous',
                    avatar: avatarSnap?.exists() ? avatarSnap.val()
                      : 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                  }
                };
              } else {
                onlineUsersMap = {}; // Mark as loaded (empty) to avoid retrying
              }
            } catch (onlineError) {
              console.warn('Could not fetch user data for pending invites:', onlineError);
              onlineUsersMap = {}; // Mark as loaded (empty) to avoid retrying
            }
          }

          // 3. Use RTDB users node data if available
          if (displayName === 'Anonymous' && invitedUserId && onlineUsersMap) {
            const invitedUserData = onlineUsersMap[invitedUserId];
            if (invitedUserData) {
              displayName = invitedUserData.displayName || 'Anonymous';
              avatar = invitedUserData.avatar || avatar;
            }
          }

          invitations.push({
            id: docSnapshot.id,
            invitedUserId: invitedUserId, // The person who was invited
            displayName: displayName,
            avatar: avatar,
            invitedBy: data.invitedBy, // Store who sent the invitation (for reference)
          });
        }
      }
      setPendingInvitations(invitations);
    } catch (error) {
      console.error('Error fetching pending invitations:', error);
      setPendingInvitations([]);
    }
  }, [groupId, firestoreDB, groupData, appdatabase]);


  // ✅ Load pending invitations only when members modal opens AND user is creator
  useEffect(() => {
    if (!showMembersModal || !groupData || !user?.id) {
      setPendingInvitations([]);
      return;
    }

    // ✅ Only show pending invitations to creator
    const isCreator = groupData.createdBy === user.id;

    if (isCreator) {
      fetchPendingInvitations();
    } else {
      // Regular members don't see pending invitations
      setPendingInvitations([]);
    }
  }, [showMembersModal, fetchPendingInvitations, groupData, user?.id]);

  // ✅ OPTIMIZED: Load messages with pagination (only if user is a member) - matching private chat strategy
  const loadMessages = useCallback(
    async (reset = false) => {
      if (!messagesRef || !isMember) return; // Don't load messages if not a member

      if (reset) {
        setLoading(true);
        setMessages([]);
        lastLoadedKeyRef.current = null;
        newestMessageIdRef.current = null; // Reset newest message ID
      } else {
        setIsPaginating(true);
      }

      try {
        // ✅ Use same query pattern as private chat for consistency
        let query = messagesRef.orderByKey();

        const lastKey = lastLoadedKeyRef.current;
        if (!reset && lastKey) {
          // ✅ Get older messages (messages before lastKey)
          // endAt includes lastKey, but we'll filter it out to avoid duplicates
          query = query.endAt(lastKey);
        }

        // ✅ Apply limit ONLY ONCE, at the end
        // limitToLast gets the last N messages from the query result
        // Use INITIAL_PAGE_SIZE for first load, PAGE_SIZE for pagination
        const limitSize = reset ? INITIAL_PAGE_SIZE : PAGE_SIZE;
        query = query.limitToLast(limitSize);

        const snapshot = await query.once('value');
        const data = snapshot.val() || {};

        let parsedMessages = Object.entries(data)
          .map(([key, value]) => ({ id: key, ...value }))
          .sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0)); // ✅ DESCENDING: newest -> oldest (for inverted FlatList)

        // ✅ Filter out the lastKey itself when loading more (to avoid duplicate)
        if (!reset && lastKey && parsedMessages.length > 0) {
          parsedMessages = parsedMessages.filter(msg => String(msg.id) !== String(lastKey));
        }

        // ✅ If reset and no messages found, return early
        if (parsedMessages.length === 0) {
          if (reset) {
            // Only clear if we explicitly reset
          } else {
            // ✅ No more messages to load - set ref to null to prevent further pagination
            lastLoadedKeyRef.current = null;
          }
          return;
        }

        // ✅ Track new messages for pagination key update
        const newMessagesRef = { value: parsedMessages };

        setMessages((prev) => {
          if (!Array.isArray(prev)) return parsedMessages;
          const existingIds = new Set(prev.map((m) => String(m?.id)));
          newMessagesRef.value = parsedMessages.filter((m) => !existingIds.has(String(m?.id)));

          if (reset) {
            // Initial load: use parsed messages as-is (already sorted descending)
            return parsedMessages;
          } else {
            // Load more (older messages): append and maintain descending order
            const combined = [...prev, ...newMessagesRef.value];
            return combined.sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
          }
        });

        // ✅ Store oldest message ID in this batch (last item in descending array)
        // ✅ Use newMessagesRef.value (actual new messages after duplicate filtering)
        if (newMessagesRef.value.length > 0) {
          // ✅ Use the oldest message from the new batch (last item in descending array)
          lastLoadedKeyRef.current = newMessagesRef.value[newMessagesRef.value.length - 1]?.id;
          // ✅ Store newest message ID (first item in descending array) for real-time listener
          newestMessageIdRef.current = newMessagesRef.value[0]?.id;
        } else if (parsedMessages.length > 0) {
          // ✅ If all were duplicates, still update to oldest from parsed to prevent infinite loop
          // ✅ This handles edge case where all messages in batch are duplicates
          lastLoadedKeyRef.current = parsedMessages[parsedMessages.length - 1]?.id;
          newestMessageIdRef.current = parsedMessages[0]?.id;
        } else {
          // ✅ No messages at all - set to null to stop pagination
          lastLoadedKeyRef.current = null;
          newestMessageIdRef.current = null;
        }
      } catch (err) {
        console.warn('Error loading messages:', err);
      } finally {
        if (reset) setLoading(false);
        setIsPaginating(false);
      }
    },
    [messagesRef, isMember],
  );

  // Load messages when groupId changes (only if user is a member)
  useEffect(() => {
    if (!messagesRef || !isMember) return;

    const currentGroupId = groupId;
    const previousGroupId = previousGroupIdRef.current;

    if (currentGroupId !== previousGroupId) {
      previousGroupIdRef.current = currentGroupId;
      loadMessages(true);
    } else if (previousGroupId === null) {
      previousGroupIdRef.current = currentGroupId;
      loadMessages(true);
    }
  }, [groupId, messagesRef, loadMessages, isMember]);

  // ✅ OPTIMIZED: Listen to ONLY new messages using limitToLast(1) to avoid loading all existing messages
  // This prevents child_added from firing for all existing messages when listener attaches
  useEffect(() => {
    if (!messagesRef || !isMember) {
      // Clear messages if user is not a member
      setMessages([]);
      return;
    }

    let isMounted = true;

    const handleChildAdded = (snapshot) => {
      if (!isMounted || !snapshot || !snapshot.key) return;
      const data = snapshot.val();
      if (!data || typeof data !== 'object') return;

      const newMessage = { id: snapshot.key, ...data };
      if (!newMessage.timestamp) {
        newMessage.timestamp = Date.now();
      }

      // ✅ Skip if this is the newest message we already have (from initial load)
      if (newestMessageIdRef.current && String(newMessage.id) === String(newestMessageIdRef.current)) {
        return;
      }

      setMessages((prev) => {
        if (!Array.isArray(prev)) return [newMessage];
        const exists = prev.some((m) => String(m?.id) === String(newMessage.id));
        if (exists) return prev;

        // ✅ Keep DESCENDING order
        const updated = [newMessage, ...prev].sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));

        if (updated.length > 0) {
          newestMessageIdRef.current = updated[0]?.id;
        }
        return updated;
      });
    };

    // ✅ OPTIMIZED: Use limitToLast(1) to only listen to the latest message
    const query = messagesRef.orderByKey().limitToLast(1);

    try {
      // ✅ Explicitly pass the function standard way
      query.on('child_added', handleChildAdded);
    } catch (e) {
      console.error('Error attaching listener:', e);
    }

    return () => {
      isMounted = false;
      try {
        // ✅ Explicitly remove the SAME function
        query.off('child_added', handleChildAdded);
      } catch (e) {
        console.error('Error removing listener:', e);
      }
    };
  }, [messagesRef, isMember]);

  // Set active chat and reset unread count
  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !groupId) return;

      // Set active chat (both for private chat pattern and group batch checking)
      setActiveChat(user.id, groupId);
      setActiveGroupChat(user.id, groupId);

      // Reset refs when entering chat (for exit ad logic)
      hasSentMessageRef.current = 0;
      chatEnterTimeRef.current = Date.now();

      // Reset unreadCount when entering chat
      const groupMetaRef = ref(appdatabase, `group_meta_data/${user.id}/${groupId}`);
      update(groupMetaRef, { unreadCount: 0 }).catch((error) => {
        console.error('Error resetting unread count:', error);
      });

      return () => {
        clearActiveChat(user.id);
        clearActiveGroupChat(user.id, groupId);
      };
    }, [user?.id, groupId, appdatabase, localState?.isPro])
  );

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMessages(true);
    setRefreshing(false);
  }, [loadMessages]);

  // Handle load more
  const handleLoadMore = useCallback(() => {
    // ✅ Prevent loading if already paginating, no more messages, or not a member
    if (isPaginating || !lastLoadedKeyRef.current || !isMember) {
      return;
    }
    loadMessages(false);
  }, [loadMessages, isPaginating, isMember]);

  // Scroll to message function (for reply navigation)
  const scrollToMessage = useCallback(
    (targetId) => {
      if (!flatListRef?.current || !targetId) return;

      // Filtered messages are sorted descending (newest first) for inverted FlatList
      const filteredMessages = [...messages].sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
      const index = filteredMessages.findIndex((m) => m.id === targetId);
      if (index === -1) return;

      try {
        flatListRef.current.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });

        // Highlight the scrolled-to message
        setHighlightedMessageId(targetId);

        setTimeout(() => {
          setHighlightedMessageId((current) =>
            current === targetId ? null : current,
          );
        }, 1500);
      } catch (e) {
        // console.log('scrollToIndex error:', e);
        // Fallback: try scrolling to offset
        try {
          const offset = index * 100; // Approximate height per message
          flatListRef.current.scrollToOffset({ offset, animated: true });
        } catch (e2) {
          // console.log('scrollToOffset error:', e2);
        }
      }
    },
    [messages],
  );

  // Handle reply to message
  const handleReply = useCallback((message) => {
    setReplyTo({
      id: message.id,
      text: message.text || '',
      sender: message.sender || 'Anonymous',
      hasFruits: Array.isArray(message.fruits) && message.fruits.length > 0,
      fruitsCount: Array.isArray(message.fruits) ? message.fruits.length : 0,
      imageUrl: message.imageUrl || null,
    });
  }, []);

  // Cancel reply
  const handleCancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  // Send message
  const sendMessage = useCallback(
    async (text, image, fruits, replyToMessage) => {
      const trimmedText = (text || '').trim();
      const hasImage = !!image;
      const hasFruits = Array.isArray(fruits) && fruits.length > 0;

      // Validate fruits count - maximum 18 fruits allowed
      if (hasFruits && fruits.length > 18) {
        showErrorMessage(t('home.alert.error'), 'You can only send up to 18 pets in a message.');
        return;
      }

      // Block only if there's no text, no image AND no fruits
      if (!trimmedText && !hasImage && !hasFruits) {
        showErrorMessage(t('home.alert.error'), t('chat.cannot_empty'));
        return;
      }

      // Safety checks
      if (!user?.id || !currentUserEmail || !groupId || !appdatabase || !firestoreDB) {
        showErrorMessage(t('home.alert.error'), 'Missing required data. Please try again.');
        return;
      }

      // ✅ Admins are exempt from blocking
      if (strikeInfo && !isAdmin) {
        const { strikeCount, bannedUntil } = strikeInfo;
        const now = Date.now();

        if (bannedUntil === 'permanent') {
          showErrorMessage(t('home.alert.error'), 'You are permanently banned from sending messages.');
          return;
        }

        if (typeof bannedUntil === 'number' && now < bannedUntil) {
          const totalMinutes = Math.ceil((bannedUntil - now) / 60000);
          const hours = Math.floor(totalMinutes / 60);
          const minutes = totalMinutes % 60;
          const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

          showErrorMessage(
            t('home.alert.error'),
            `You are banned from chatting for ${timeLeftText} more minute(s).`
          );
          return;
        }
      }

      // Check if user is member and not muted
      if (groupData) {
        const isMember = groupData.memberIds?.includes(user.id);
        const isMuted = groupData.members?.[user.id]?.muted;

        if (!isMember) {
          showErrorMessage('Error', 'You are not a member of this group');
          return;
        }

        if (isMuted) {
          showErrorMessage('Error', 'You are muted in this group');
          return;
        }
      }

      // Check if user has recent game win
      const now = Date.now();
      const hasRecentWin =
        typeof user?.lastGameWinAt === 'number' &&
        now - user.lastGameWinAt <= 24 * 60 * 60 * 1000; // last win within 24h

      // Check if user is creator
      const isCreator = groupData?.createdBy === user.id;

      // Build message payload
      const messageData = {
        text: trimmedText,
        senderId: user.id,
        sender: user.displayName || 'Anonymous',
        avatar: user.avatar || null,
        flage: user?.flage || null, // ✅ Include flag/flag emoji
        timestamp: Date.now(),
        isPro: !!localState?.isPro,
        robloxUsernameVerified: user?.robloxUsernameVerified || false,
        hasRecentGameWin: hasRecentWin,
        lastGameWinAt: user?.lastGameWinAt || null,
        isCreator: isCreator,
      };

      if (hasImage) {
        messageData.imageUrl = image;
      }

      if (hasFruits) {
        messageData.fruits = fruits;
      }

      // Add replyTo if replying to a message
      if (replyToMessage && replyToMessage.id) {
        messageData.replyTo = {
          id: replyToMessage.id,
          text: replyToMessage.text || '',
          sender: replyToMessage.sender || 'Anonymous',
          imageUrl: replyToMessage.imageUrl || null,
          hasFruits: replyToMessage.hasFruits || false,
          fruitsCount: replyToMessage.fruitsCount || 0,
        };
      }

      try {
        const result = await sendGroupMessage(
          appdatabase,
          firestoreDB,
          groupId,
          messageData,
          {
            id: user.id,
            displayName: user.displayName || 'Anonymous',
            avatar: user.avatar || null,
          }
        );

        if (!result.success) {
          showErrorMessage('Error', result.error || 'Failed to send message');
        } else {
          // Clear reply after successful send
          setReplyTo(null);
          hasSentMessageRef.current += 1; // Track count of messages sent
        }
      } catch (error) {
        console.error('Error sending message:', error);
        Alert.alert('Error', 'Could not send your message. Please try again.');
      }
    },
    [user, groupId, appdatabase, firestoreDB, groupData, t, localState?.isPro, currentUserEmail, strikeInfo, isAdmin]
  );

  // Handle remove member (admin action)
  const handleRemoveMember = useCallback(async (memberId, memberName) => {
    if (!user?.id || !groupId) return;

    Alert.alert(
      'Remove Member',
      `Are you sure you want to remove ${memberName || 'this member'} from the group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await removeMemberFromGroup(
                firestoreDB,
                appdatabase,
                groupId,
                memberId,
                user.id
              );

              if (result.success) {
                showSuccessMessage('Success', 'Member removed successfully');
              } else {
                showErrorMessage('Error', result.error || 'Failed to remove member');
              }
            } catch (error) {
              console.error('Error removing member:', error);
              showErrorMessage('Error', 'Failed to remove member. Please try again.');
            }
          },
        },
      ]
    );
  }, [user?.id, groupId, firestoreDB, appdatabase]);

  // ✅ Handle making a member creator (with warning)
  // ✅ iOS Fix: Close members modal first, then show Alert (nested modals cause freezing on iOS)
  const handleMakeCreator = useCallback((memberId, memberName) => {
    // Close members modal first to avoid nested modal issues on iOS
    setShowMembersModal(false);

    // Use setTimeout to ensure modal closes before showing alert
    setTimeout(() => {
      Alert.alert(
        '⚠️ Transfer Creator Status',
        `You are about to make ${memberName} the creator of this group.\n\nThis action is IRREVERSIBLE.\n\nYou will lose all creator privileges and become a regular member. You will no longer be able to remove members, add members, or transfer creator status.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => {
              setMemberToMakeCreator(null);
            },
          },
          {
            text: 'Transfer Creator',
            style: 'destructive',
            onPress: async () => {
              if (!groupId || !firestoreDB || !appdatabase || !user?.id) {
                return;
              }

              try {
                const result = await makeMemberCreator(
                  firestoreDB,
                  appdatabase,
                  groupId,
                  memberId,
                  user.id
                );

                if (result.success) {
                  showSuccessMessage('Success', `${memberName} is now the creator.`);
                  setMemberToMakeCreator(null);
                } else {
                  showErrorMessage('Error', result.error || 'Failed to transfer creator status.');
                }
              } catch (error) {
                console.error('Error making member creator:', error);
                showErrorMessage('Error', 'Failed to transfer creator status. Please try again.');
              }
            },
          },
        ],
        { cancelable: true }
      );
    }, 300); // Small delay to ensure modal closes
  }, [groupId, firestoreDB, appdatabase, user?.id]);


  const memberCount = groupData?.memberCount || 0;
  const isCreator = groupData && groupData.createdBy === user?.id;

  // Handle accept invitation
  const handleAcceptInvite = useCallback(async () => {
    if (!pendingInvite || !user?.id) return;

    try {
      const result = await acceptGroupInvite(
        firestoreDB,
        appdatabase,
        pendingInvite.id,
        {
          id: user.id,
          displayName: user.displayName || 'Anonymous',
          avatar: user.avatar || null,
        }
      );

      if (result.success) {
        showSuccessMessage('Success', 'You joined the group!');
        setPendingInvite(null);
        setIsMember(true);
      } else {
        showErrorMessage('Error', result.error || 'Failed to accept invitation');
      }
    } catch (error) {
      console.error('Error accepting invitation:', error);
      showErrorMessage('Error', 'Failed to accept invitation. Please try again.');
    }
  }, [pendingInvite, user, firestoreDB, appdatabase]);

  // Handle decline invitation
  const handleDeclineInvite = useCallback(async () => {
    if (!pendingInvite || !user?.id) return;

    Alert.alert(
      'Decline Invitation',
      'Are you sure you want to decline this invitation?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await declineGroupInvite(firestoreDB, pendingInvite.id, user.id);
              if (result.success) {
                showSuccessMessage('Success', 'Invitation declined');
                setPendingInvite(null);
                navigation.goBack();
              } else {
                showErrorMessage('Error', result.error || 'Failed to decline invitation');
              }
            } catch (error) {
              console.error('Error declining invitation:', error);
              showErrorMessage('Error', 'Failed to decline invitation. Please try again.');
            }
          },
        },
      ]
    );
  }, [pendingInvite, user, firestoreDB, navigation]);

  // Handle leave group
  const handleLeaveGroup = useCallback(() => {
    if (!groupId || !user?.id) return;

    Alert.alert(
      'Leave Group',
      'Are you sure you want to leave this group?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await leaveGroup(firestoreDB, appdatabase, groupId, user.id);
              if (result.success) {
                showSuccessMessage('Success', 'You left the group');
                navigation.goBack();
              } else {
                showErrorMessage('Error', result.error || 'Failed to leave group');
              }
            } catch (error) {
              console.error('Error leaving group:', error);
              showErrorMessage('Error', 'Failed to leave group. Please try again.');
            }
          },
        },
      ]
    );
  }, [groupId, user?.id, firestoreDB, appdatabase, navigation]);

  // Handle user press to open profile drawer
  const handleUserPress = useCallback(async (userData) => {
    if (!userData || !userData.senderId) return;

    setSelectedUserForDrawer({
      senderId: userData.senderId,
      sender: userData.sender || 'Anonymous',
      avatar: userData.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
    });

    // Check if user is online
    try {
      const online = await isUserOnline(userData.senderId);
      setSelectedUserOnline(online);
    } catch (error) {
      setSelectedUserOnline(false);
    }

    setIsDrawerVisible(true);
  }, []);

  // Get banned users from local state
  const { localState } = useLocalState();
  const bannedUsers = useMemo(() => {
    return Array.isArray(localState?.bannedUsers) ? localState.bannedUsers : [];
  }, [localState?.bannedUsers]);

  // Update header with member info and leave button
  useEffect(() => {
    if (!groupData) return;

    const isCreator = groupData?.createdBy === user?.id;

    // Truncate group name for header (max 30 characters)
    const groupName = groupData.name || 'Group Chat';
    const truncatedGroupName = groupName.length > 30 ? groupName.substring(0, 30).trim() + '...' : groupName;

    navigation.setOptions({
      headerBackVisible: true,
      headerTitle: () => (
        <Text
          style={{
            fontSize: 18,
            fontWeight: 'bold',
            color: isDarkMode ? '#fff' : '#000',
            textAlign: 'center',
          }}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {truncatedGroupName}
        </Text>
      ),
      headerTitleAlign: 'center',
      headerRight: () => (
        <TouchableOpacity
          onPress={() => setShowMembersModal(true)}
          style={{ flexDirection: 'row', alignItems: 'center', marginRight: 15 }}
        >
          <Icon name="people" size={20} color={isDarkMode ? '#fff' : '#000'} />
          <Text style={{ marginLeft: 6, color: isDarkMode ? '#fff' : '#000', fontWeight: '600', fontSize: 14 }}>
            {memberCount}
          </Text>
        </TouchableOpacity>
      ),
    });
  }, [groupData, memberCount, isDarkMode, navigation, isMember, handleLeaveGroup, user?.id]);

  if (!groupId) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={styles.text}>Group ID not provided</Text>
      </View>
    );
  }

  if (checkingAccess) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={[styles.text, { marginTop: 16 }]}>Loading...</Text>
      </View>
    );
  }

  // Show invitation acceptance screen if user has pending invitation
  if (pendingInvite && !isMember) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <Icon name="mail-outline" size={64} color={isDarkMode ? '#8B5CF6' : '#8B5CF6'} />
        <Text style={[styles.text, { fontSize: 24, fontWeight: 'bold', marginTop: 20, marginBottom: 10 }]}>
          Group Invitation
        </Text>
        <Text style={[styles.text, { fontSize: 16, textAlign: 'center', marginBottom: 30, opacity: 0.7 }]} numberOfLines={2} ellipsizeMode="tail">
          You've been invited to join "{groupData?.name ? (groupData.name.length > 25 ? groupData.name.substring(0, 25).trim() + '...' : groupData.name) : 'this group'}"
        </Text>
        <View style={{ flexDirection: 'row', gap: 15 }}>
          <TouchableOpacity
            onPress={handleDeclineInvite}
            style={{
              paddingHorizontal: 30,
              paddingVertical: 12,
              borderRadius: 8,
              backgroundColor: isDarkMode ? '#374151' : '#E5E7EB',
            }}
          >
            <Text style={{ color: isDarkMode ? '#fff' : '#000', fontWeight: '600' }}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleAcceptInvite}
            style={{
              paddingHorizontal: 30,
              paddingVertical: 12,
              borderRadius: 8,
              backgroundColor: '#8B5CF6',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>Accept</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Show access denied if not a member and no pending invitation
  if (!isMember && !pendingInvite) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <Icon name="lock-closed-outline" size={64} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
        <Text style={[styles.text, { fontSize: 24, fontWeight: 'bold', marginTop: 20, marginBottom: 10 }]}>
          Access Denied
        </Text>
        <Text style={[styles.text, { fontSize: 16, textAlign: 'center', marginBottom: 30, opacity: 0.7 }]}>
          You are not a member of this group. Please wait for an invitation.
        </Text>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{
            paddingHorizontal: 30,
            paddingVertical: 12,
            borderRadius: 8,
            backgroundColor: '#8B5CF6',
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '600' }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading && messages.length === 0) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={[styles.text, { marginTop: 16 }]}>Loading messages...</Text>
      </View>
    );
  }

  return (
    <>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ConditionalKeyboardWrapper style={{ flex: 1 }} privatechatscreen={true}>
          <View style={[styles.container, { position: 'relative' }]}>
            {messages.length === 0 && !loading ? (
              // No messages yet - show empty state but keep input visible
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No messages yet</Text>
              </View>
            ) : (
              <GroupMessageList
                messages={messages}
                userId={user?.id}
                user={user}
                groupData={groupData}
                handleLoadMore={handleLoadMore}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                loading={loading}
                isPaginating={isPaginating}
                onUserPress={handleUserPress}
                onReply={handleReply}
                onDeleteMessage={(messageId) => {
                  if (!messagesRef) return;
                  messagesRef.child(messageId).remove()
                    .then(() => setMessages(prev => prev.filter(m => m.id !== messageId)))
                    .catch(err => console.error('Delete message error:', err));
                }}
                onDeleteAllMessage={(senderId) => handleDeleteLast300Messages(senderId)}
                scrollToMessage={scrollToMessage}
                highlightedMessageId={highlightedMessageId}
                flatListRef={flatListRef}
              />
            )}

            <GroupMessageInput
              onSend={(text, image, fruits) => sendMessage(text, image, fruits, replyTo)}
              isBanned={false}
              petModalVisible={petModalVisible}
              setPetModalVisible={setPetModalVisible}
              selectedFruits={selectedFruits}
              setSelectedFruits={setSelectedFruits}
              replyTo={replyTo}
              onCancelReply={handleCancelReply}
            />
          </View>
        </ConditionalKeyboardWrapper>

        {/* Members Modal */}
        <Modal
          visible={showMembersModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setShowMembersModal(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: isDarkMode ? '#1F2937' : '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: isDarkMode ? '#374151' : '#E5E7EB' }}>
                <Text style={{ fontSize: 20, fontWeight: 'bold', color: isDarkMode ? '#fff' : '#000' }}>
                  Members ({memberCount})
                </Text>
                <TouchableOpacity onPress={() => setShowMembersModal(false)}>
                  <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
                </TouchableOpacity>
              </View>

              <FlatList
                data={[
                  // Actual members
                  ...Array.from(new Set(groupData?.memberIds || [])).map(id => ({ type: 'member', id })),
                  // Pending invitations
                  ...pendingInvitations.map(inv => ({ type: 'pending', id: inv.invitedUserId, inviteData: inv }))
                ]}
                keyExtractor={(item) => `${item.type}-${item.id}`}
                onEndReached={() => {
                  // ✅ Load next batch of member statuses on scroll
                  // ✅ Prevent loading if already loading or if all members are loaded
                  if (loadingMemberStatuses || !groupData?.memberIds) return;

                  const allMemberIds = groupData.memberIds || [];
                  const unloadedIds = allMemberIds.filter(id => !loadedMemberStatuses.has(id));

                  // ✅ Only load if there are unloaded members
                  if (unloadedIds.length > 0) {
                    const nextBatch = unloadedIds.slice(0, MEMBER_STATUS_BATCH_SIZE);
                    loadMemberStatusesBatch(nextBatch);
                  }
                }}
                onEndReachedThreshold={0.1}
                scrollEnabled={true}
                removeClippedSubviews={false}
                initialNumToRender={10}
                maxToRenderPerBatch={8}
                windowSize={5}
                updateCellsBatchingPeriod={100}
                ListFooterComponent={
                  loadingMemberStatuses ? (
                    <View style={{ padding: 10, alignItems: 'center' }}>
                      <ActivityIndicator size="small" color={isDarkMode ? '#8B5CF6' : '#8B5CF6'} />
                    </View>
                  ) : null
                }
                renderItem={({ item }) => {
                  if (item.type === 'pending') {
                    // ✅ Render pending invitation - Shows the INVITED USER (the person who was invited)
                    const inviteData = item.inviteData;
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: isDarkMode ? '#374151' : '#E5E7EB' }}>
                        <Image
                          source={{ uri: inviteData.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                          style={{ width: 50, height: 50, borderRadius: 25, marginRight: 12, opacity: 0.6 }}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 16, fontWeight: '600', color: isDarkMode ? '#fff' : '#000' }}>
                            {inviteData.displayName || 'Anonymous'}
                          </Text>
                          <Text style={{ fontSize: 12, color: isDarkMode ? '#9CA3AF' : '#6B7280', marginTop: 2 }}>
                            Pending to Join
                          </Text>
                        </View>
                      </View>
                    );
                  }

                  // Render actual member
                  const memberId = item.id;
                  const member = groupData?.members?.[memberId] || {};
                  const isOnline = onlineMembers.includes(memberId);
                  const isCurrentUser = memberId === user?.id;
                  const isMemberCreator = groupData?.createdBy === memberId;
                  const canRemove = isCreator && !isCurrentUser && !isMemberCreator;
                  const canMakeCreator = isCreator && !isCurrentUser && !isMemberCreator;

                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: isDarkMode ? '#374151' : '#E5E7EB' }}>
                      <Image
                        source={{ uri: member.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                        style={{ width: 50, height: 50, borderRadius: 25, marginRight: 12 }}
                      />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={{ fontSize: 16, fontWeight: '600', color: isDarkMode ? '#fff' : '#000' }}>
                            {member.displayName || 'Anonymous'}
                          </Text>
                          {isMemberCreator && (
                            <View style={{
                              backgroundColor: '#8B5CF6',
                              paddingHorizontal: 4,
                              paddingVertical: 1,
                              borderRadius: 3,
                              marginLeft: 6,
                            }}>
                              <Text style={{
                                color: '#FFF',
                                fontSize: 9,
                                fontWeight: '600'
                              }}>Creator</Text>
                            </View>
                          )}
                          {isOnline && (
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981', marginLeft: 8 }} />
                          )}
                        </View>
                        <Text style={{ fontSize: 12, color: isDarkMode ? '#9CA3AF' : '#6B7280', marginTop: 2 }}>
                          {isOnline ? 'Online' : ''}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {canMakeCreator && (
                          <TouchableOpacity
                            onPress={() => handleMakeCreator(memberId, member.displayName)}
                            style={{ padding: 8 }}
                          >
                            <Icon name="star-outline" size={20} color="#F59E0B" />
                          </TouchableOpacity>
                        )}
                        {canRemove && (
                          <TouchableOpacity
                            onPress={() => handleRemoveMember(memberId, member.displayName)}
                            style={{ padding: 8 }}
                          >
                            <Icon name="trash-outline" size={20} color="#EF4444" />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                }}
                ListEmptyComponent={
                  <View style={{ padding: 40, alignItems: 'center' }}>
                    <Text style={{ color: isDarkMode ? '#9CA3AF' : '#6B7280' }}>No members found</Text>
                  </View>
                }
              />
            </View>
          </View>
        </Modal>

        {/* Profile Bottom Drawer */}
        <ProfileBottomDrawer
          isVisible={isDrawerVisible}
          toggleModal={() => setIsDrawerVisible(false)}
          startChat={() => {
            setIsDrawerVisible(false);
            // Navigate to private chat if needed
          }}
          selectedUser={selectedUserForDrawer}
          isOnline={selectedUserOnline}
          bannedUsers={bannedUsers}
          fromPvtChat={true}
        />

        <PetModal
          fromChat={true}
          visible={petModalVisible}
          onClose={() => setPetModalVisible(false)}
          selectedFruits={selectedFruits}
          setSelectedFruits={setSelectedFruits}
        />
      </GestureHandlerRootView>
      {!localState.isPro && <BannerAdComponent />}
    </>
  );
};

export default GroupChatScreen;

