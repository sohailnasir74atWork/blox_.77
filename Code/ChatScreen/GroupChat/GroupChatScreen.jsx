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
import { useFocusEffect, useRoute, useNavigation, useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getStyles } from '../Style';
import GroupMessageInput from './GroupMessageInput';
import GroupMessageList from './GroupMessageList';
import { useGlobalState } from '../../GlobelStats';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useActiveChatLifecycle } from '../utils';
import { get, ref, update } from '@react-native-firebase/database';
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
import { resetGroupUnreadCount as sbResetGroupUnreadCount } from '../../Supabase/groupMetaBackend';
import {
  loadGroupMessages as sbLoadGroupMessages,
  subscribeToGroupMessages as sbSubscribeToGroupMessages,
  softDeleteGroupMessage as sbSoftDeleteGroupMessage,
  softDeleteGroupMessagesBySender as sbSoftDeleteGroupMessagesBySender,
} from '../../Supabase/groupMessagesBackend';
import PetModal from '../PrivateChat/PetsModel';
import config from '../../Helper/Environment';
import BannerAdComponent from '../../Ads/bannerAds';
import InterstitialAdManager from '../../Ads/IntAd';
import { seedCurrentUser } from '../../Helper/profileCache';

const INITIAL_PAGE_SIZE = 10; // ✅ Initial load: 10 messages
const PAGE_SIZE = 10; // ✅ Pagination: load 10 messages per batch
// Cap the live in-memory list — long sessions re-fetch older pages on scroll.
const MAX_LIVE = 150;
const MEMBER_STATUS_BATCH_SIZE = 5; // ✅ Load 5 member statuses at a time

const GroupChatScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { groupId } = route.params || {};

  const { user, theme, appdatabase, firestoreDB, currentUserEmail, strikeInfo, isAdmin, isUserBlocked } = useGlobalState();
  const insets = useSafeAreaInsets();
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
  // Mirrored ref so the realtime listener (deps: [groupId, isMember]) can
  // read the current user id without forcing a resubscribe on user object
  // identity changes from useGlobalState.
  const userIdRef = useRef(user?.id);
  const isFocused = useIsFocused();
  // Set when another member's message arrives while focused; blur clears the
  // server-side unread count once instead of per message.
  const unreadWhileFocusedRef = useRef(false);
  userIdRef.current = user?.id;
  const { t } = useTranslation();

  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // Group message bodies are Supabase-native — no RTDB ref needed.

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

  // Seed current user's profile + cosmetics into cache on mount
  useEffect(() => {
    if (user?.id) seedCurrentUser(user, localState, appdatabase);
  }, [user?.id]);

  useEffect(() => {
    if (!groupId || !firestoreDB || !user?.id) return;

    setCheckingAccess(true);
    const groupRef = doc(firestoreDB, 'groups', groupId);
    const unsubscribe = onSnapshot(
      groupRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setGroupData(data);

          // Check if user is a member (admin/moderator bypass for monitoring)
          const memberIds = data.memberIds || [];
          const userIsMember = memberIds.includes(user.id) || isAdmin || !!user?.isModerator;
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

  // Paginated load — Supabase. Cursor is { createdAt: ISO, id: uuid }
  // returned by the previous page's oldest row. Same descending-order
  // contract as before so the inverted FlatList renders unchanged.
  const loadMessages = useCallback(
    async (reset = false) => {
      if (!groupId || !isMember) return;

      if (reset) {
        setLoading(true);
        setMessages([]);
        lastLoadedKeyRef.current = null;
        newestMessageIdRef.current = null;
      } else {
        setIsPaginating(true);
      }

      try {
        const limitSize = reset ? INITIAL_PAGE_SIZE : PAGE_SIZE;
        const before = !reset && lastLoadedKeyRef.current
          ? lastLoadedKeyRef.current
          : null;

        const rows = await sbLoadGroupMessages(groupId, { limit: limitSize, before });
        if (!Array.isArray(rows) || rows.length === 0) {
          if (!reset) lastLoadedKeyRef.current = null;
          return;
        }

        // Newest-first already (the backend returns descending).
        let parsedMessages = rows;

        const newMessagesRef = { value: parsedMessages };
        setMessages((prev) => {
          if (!Array.isArray(prev)) return parsedMessages;
          const existingIds = new Set(prev.map((m) => String(m?.id)));
          newMessagesRef.value = parsedMessages.filter((m) => !existingIds.has(String(m?.id)));
          if (reset) return parsedMessages;
          const combined = [...prev, ...newMessagesRef.value];
          return combined.sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
        });

        // Cursor → oldest row of this page (last in descending array).
        const oldest = parsedMessages[parsedMessages.length - 1];
        const newest = parsedMessages[0];
        if (oldest) {
          lastLoadedKeyRef.current = {
            createdAt: new Date(oldest.timestamp).toISOString(),
            id: oldest.id,
          };
        }
        if (newest) newestMessageIdRef.current = newest.id;
      } catch (err) {
        console.warn('Error loading messages:', err);
      } finally {
        if (reset) setLoading(false);
        setIsPaginating(false);
      }
    },
    [groupId, isMember],
  );

  // Load messages when groupId changes (only if user is a member)
  useEffect(() => {
    if (!groupId || !isMember) return;

    const currentGroupId = groupId;
    const previousGroupId = previousGroupIdRef.current;

    if (currentGroupId !== previousGroupId) {
      previousGroupIdRef.current = currentGroupId;
      loadMessages(true);
    } else if (previousGroupId === null) {
      previousGroupIdRef.current = currentGroupId;
      loadMessages(true);
    }
  }, [groupId, loadMessages, isMember]);

  // Realtime — Supabase. INSERT delivers new messages, UPDATE handles
  // soft-delete (removes from view), DELETE handles hard delete.
  useEffect(() => {
    if (!groupId || !isMember) {
      setMessages([]);
      return;
    }
    // Channel only while the screen is focused — the focus effect's unread
    // reset + initial load cover the return path.
    if (!isFocused) return;

    let isMounted = true;

    const handleInsert = (msg) => {
      if (!isMounted || !msg) return;

      // Skip if we already have this message (e.g. from initial load
      // or our own send echo).
      if (newestMessageIdRef.current && String(msg.id) === String(newestMessageIdRef.current)) return;

      // When another member posts while we're in the group, the fanout
      // RPC has already bumped our unread_count on the server. Don't fire
      // an UPDATE per message (each echoes back over the meta channel) —
      // flag it and clear once on blur.
      if (msg.senderId && msg.senderId !== userIdRef.current && userIdRef.current) {
        unreadWhileFocusedRef.current = true;
      }

      setMessages((prev) => {
        if (!Array.isArray(prev)) return [msg];
        // Dedup by Supabase id.
        if (prev.some((m) => String(m?.id) === String(msg.id))) return prev;
        // Also dedup by clientMsgId in case an optimistic placeholder
        // is sitting there (future-proof — current send is non-optimistic).
        if (msg.clientMsgId) {
          const optIdx = prev.findIndex(
            (m) => m?._optimistic && m?.clientMsgId === msg.clientMsgId,
          );
          if (optIdx !== -1) {
            const updated = [...prev];
            updated[optIdx] = { ...updated[optIdx], ...msg, _optimistic: false };
            return updated.sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
          }
        }
        let updated = [msg, ...prev].sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
        if (updated.length > MAX_LIVE) updated = updated.slice(0, MAX_LIVE);
        if (updated.length > 0) newestMessageIdRef.current = updated[0]?.id;
        return updated;
      });
    };

    const handleUpdate = (msg) => {
      if (!isMounted || !msg) return;
      if (msg.deleted) {
        setMessages((prev) => prev.filter((m) => m?.id !== msg.id));
      }
    };

    const handleDelete = (id) => {
      if (!isMounted || !id) return;
      setMessages((prev) => prev.filter((m) => m?.id !== id));
    };

    const unsubscribe = sbSubscribeToGroupMessages(groupId, {
      onInsert: handleInsert,
      onUpdate: handleUpdate,
      onDelete: handleDelete,
    });

    return () => {
      isMounted = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [groupId, isMember, isFocused]);

  // Active-chat lifecycle: focus + AppState aware. Writes both
  // /activeChats/{userId} = groupId AND /activeGroupChats/{groupId}/{userId}
  // so the notification CF skips push for users currently viewing this
  // group, and immediately revokes that skip when the app is backgrounded.
  useActiveChatLifecycle({ userId: user?.id, chatId: groupId, groupId });

  // Reset unread + per-screen refs on focus; clear once more on blur if
  // messages arrived while we were reading (their fan-out bumped the count).
  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !groupId) return;

      hasSentMessageRef.current = 0;
      chatEnterTimeRef.current = Date.now();

      const isActualMember = groupData?.memberIds?.includes(user.id);
      if (isActualMember) {
        sbResetGroupUnreadCount(user.id, groupId);
      }

      return () => {
        if (unreadWhileFocusedRef.current) {
          unreadWhileFocusedRef.current = false;
          if (isActualMember) sbResetGroupUnreadCount(user.id, groupId);
        }
      };
    }, [user?.id, groupId, groupData?.memberIds])
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

      // Block banned users from sending (admins exempt). Defer expiry to
      // server-time-validated `isUserBlocked` so a clock-rolled device
      // can't slip past — strikeInfo is used only for the message text.
      if (isUserBlocked && !isAdmin) {
        const { bannedUntil } = strikeInfo || {};

        if (bannedUntil === 'permanent') {
          showErrorMessage(t('home.alert.error'), 'You are permanently banned from sending messages.');
          return;
        }

        if (typeof bannedUntil === 'number') {
          const remaining = Math.max(0, bannedUntil - Date.now());
          const totalMinutes = Math.ceil(remaining / 60000);
          const hours = Math.floor(totalMinutes / 60);
          const minutes = totalMinutes % 60;
          const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

          showErrorMessage(
            t('home.alert.error'),
            `You are banned from chatting for ${timeLeftText} more minute(s).`
          );
          return;
        }

        showErrorMessage(t('home.alert.error'), 'You are currently banned from sending messages.');
        return;
      }

      // Check if user is member and not muted (admin/moderator bypass for monitoring)
      if (groupData) {
        const isMemberOrAdmin = groupData.memberIds?.includes(user.id) || isAdmin || !!user?.isModerator;
        const isMuted = groupData.members?.[user.id]?.muted;

        if (!isMemberOrAdmin) {
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

      // ✅ Cost opt: Drop fields that are either unused by GroupMessageList
      // (isBabyMod/isTrusted/isGrinder/isRaider/flage) or already resolved
      // from profileCache on render (chatTextColor/chatBubbleBg/profileFrame).
      // Backwards compatible: old messages still have these fields and resolveProfile
      // falls back to cache for cosmetics.
      const messageData = {
        text: trimmedText,
        senderId: user.id,
        sender: user.displayName || 'Anonymous',
        avatar: user.avatar || null,
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

        // 🐝 Track group joins for socialBee badge
        try {
          const { incrementAndCheckBadge, GROUP_CHAT_BADGE_THRESHOLDS } = require('./badgeUtils');
          incrementAndCheckBadge(appdatabase, user.id, 'groupJoinCount', GROUP_CHAT_BADGE_THRESHOLDS);
        } catch (e) {}
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
                onDeleteMessage={async (messageId) => {
                  if (!messageId) return;
                  try {
                    await sbSoftDeleteGroupMessage(messageId, user?.id ?? null);
                    setMessages(prev => prev.filter(m => m.id !== messageId));
                  } catch (err) {
                    console.error('Delete message error:', err);
                  }
                }}
                onDeleteAllMessage={async (senderId) => {
                  if (!senderId || !groupId) return;
                  try {
                    // Soft-delete the last ~60 messages from this
                    // sender in THIS group. Previously this fell back
                    // to the public-chat default — the new helper
                    // takes the groupId explicitly.
                    await sbSoftDeleteGroupMessagesBySender(groupId, senderId, {
                      limit: 60,
                      deletedBy: user?.id ?? null,
                    });
                  } catch (err) {
                    console.error('Bulk delete error:', err);
                  }
                }}
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
            <View style={{ backgroundColor: isDarkMode ? '#1F2937' : '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', paddingBottom: Math.max(insets.bottom, 16) }}>
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

