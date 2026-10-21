import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ChatScreen from './GroupChat/Trader';
import PrivateChatScreen from './PrivateChat/PrivateChat';
import InboxScreen from './GroupChat/InboxScreen';
import GroupsScreen from './GroupChat/GroupsScreen';
import GroupChatScreen from './GroupChat/GroupChatScreen';
import { useGlobalState } from '../GlobelStats';
import PrivateChatHeader from './PrivateChat/PrivateChatHeader';
import BlockedUsersScreen from './PrivateChat/BlockUserList';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import ImageViewerScreenChat from './PrivateChat/ImageViewer';
import { ref, update, get, onChildAdded, onChildChanged, onChildRemoved } from '@react-native-firebase/database';
import {
  subscribeToChatMetaShared,
  resetUnreadCount as sbResetUnreadCount,
} from '../Supabase/chatMetaBackend';
import { subscribeToGroupMeta } from '../Supabase/groupMetaBackend';
import { SUPABASE_CHAT_META_ENABLED, SUPABASE_GROUP_META_ENABLED } from '../Supabase/featureFlags';
import CommunityChatHeader from './GroupChat/CommunityChatHeader';
import LeaderboardScreen from './GroupChat/LeaderboardScreen';
import AdminDashboard from '../AppHelper/AdminDashboard';
import SocialDashboard from '../AppHelper/SocialDashboard';
import ThemeHeader from '../Design/componenets/ThemeHeader';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import {
  setDmUnread, removeDmUnread, clearDmUnread,
  setGroupUnread, removeGroupUnread, clearGroupUnread,
} from './chatBadgeStore';

const Stack = createNativeStackNavigator();

// GroupChatScreen sets its own header title and buttons.
const groupChatDetailOptions = {
  headerBackVisible: true,
  headerTitle: () => null,
  headerRight: () => null,
};

// A busy group updates every member's group_meta_data row on every message.
// The groups list is redrawn at most this often while such updates stream in.
const GROUPS_FLUSH_MS = 400;

export const ChatStack = ({ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo }) => {
  const { user, unreadMessagesCount, appdatabase, onlineMembersCount } = useGlobalState();
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();
  const { localState, updateLocalState } = useLocalState()
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);


  // useEffect(() => {
  //   if (selectedUser?.senderId) {
  //     isUserOnline(selectedUser.senderId).then(setIsOnline).catch(() => setIsOnline(false));
  //   }
  // }, [selectedUser?.id]);

  useEffect(() => {
    if (!user?.id) return;
    // ✅ Safety check: ensure bannedUsers is an array
    const banned = Array.isArray(localState.bannedUsers) ? localState.bannedUsers : [];
    setBannedUsers(banned);
  }, [user?.id, localState.bannedUsers]);


  const headerOptions = useMemo(() => ({
    headerStyle: { backgroundColor: selectedTheme.colors.background },
    headerTintColor: selectedTheme.colors.text,
    headerTitleStyle: { fontWeight: 'bold', fontSize: 24 },
    headerBackTitleVisible: false,
    animation: 'fade',
    animationDuration: 200,
  }), [selectedTheme]);


  // Chat-list unread badge.
  //
  // Supabase path: subscribeToChatMeta opens a single Postgres realtime
  // channel filtered by owner_uid; emits one event per row insert/update/
  // delete instead of N RTDB listeners. Big bandwidth cut on this hot
  // path.
  //
  // RTDB path: original child listener flow, intact when the kill
  // switch is off (or while we're still rolling Supabase out).
  //
  // Counts go to chatBadgeStore, not ChatStack state: a state update here
  // re-rendered the whole stack on every incoming message.
  //
  // Read the banned list through a ref inside the subscription handlers so a
  // change to `bannedUsers` (array identity changes on every localState
  // update) does NOT tear down and re-create the realtime channel. Each
  // re-create is a new server-side subscription + full initial load; this was
  // a major source of the ~890k subscription churn/day measured in 2026-09.
  const bannedUsersRef = useRef(bannedUsers);
  bannedUsersRef.current = bannedUsers;

  useEffect(() => {
    clearDmUnread();
    if (!user?.id || !appdatabase) return;

    // ── Supabase path ────────────────────────────────────────────────
    if (SUPABASE_CHAT_META_ENABLED) {
      const handleSupaUpsert = (row) => {
        if (!row || !row.partnerId) return;
        const chatPartnerId = row.partnerId;
        const bannedNow = bannedUsersRef.current;
        const isBlocked = Array.isArray(bannedNow) && bannedNow.includes(chatPartnerId);
        const rawUnread = row.unreadCount || 0;
        if (isBlocked && rawUnread > 0) {
          // Reset directly on Supabase (now the source of truth).
          sbResetUnreadCount(user.id, chatPartnerId);
        }
        setDmUnread(chatPartnerId, isBlocked ? 0 : rawUnread);
      };

      const handleSupaRemove = (partnerId) => {
        if (!partnerId) return;
        removeDmUnread(partnerId);
      };

      const unsub = subscribeToChatMetaShared(user.id, {
        onUpsert: handleSupaUpsert,
        onRemove: handleSupaRemove,
      });
      return () => { unsub(); clearDmUnread(); };
    }

    // ── RTDB fallback (original code) ────────────────────────────────
    const userChatsRef = ref(appdatabase, `chat_meta_data/${user.id}`);

    const handleChildChange = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      const chatData = snapshot.val();
      if (!chatData || typeof chatData !== 'object') return;

      const chatPartnerId = snapshot.key;
      const bannedNow = bannedUsersRef.current;
      const isBlocked = Array.isArray(bannedNow) && bannedNow.includes(chatPartnerId);
      const rawUnread = chatData?.unreadCount || 0;

      if (isBlocked && rawUnread > 0) {
        update(
          ref(appdatabase, `chat_meta_data/${user.id}/${chatPartnerId}`),
          { unreadCount: 0 }
        ).catch((error) => {
          console.error("Error resetting unread count:", error);
        });
      }
      setDmUnread(chatPartnerId, isBlocked ? 0 : rawUnread);
    };

    const handleChildRemoved = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      removeDmUnread(snapshot.key);
    };

    const unsubAdded = onChildAdded(userChatsRef, handleChildChange);
    const unsubChanged = onChildChanged(userChatsRef, handleChildChange);
    const unsubRemoved = onChildRemoved(userChatsRef, handleChildRemoved);

    return () => {
      unsubAdded();
      unsubChanged();
      unsubRemoved();
      clearDmUnread();
    };
    // bannedUsers intentionally omitted: read via bannedUsersRef (see above).
  }, [user?.id, appdatabase]);

  // Group list + unread badge.
  //
  // Same pattern as chat_meta above: subscribeToGroupMeta on the
  // Supabase path, original RTDB child-listener flow as fallback.
  useEffect(() => {
    clearGroupUnread();
    if (!user?.id || !appdatabase) {
      setGroups([]);
      return;
    }

    setGroupsLoading(true);
    const groupsMap = new Map(); // Track groups locally
    let flushTimer = null;
    let listShown = false; // the first load has been painted

    const flushGroupsList = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      listShown = true;
      setGroups(Array.from(groupsMap.values())
        .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp));
    };

    // The badge updates per row (chatBadgeStore, cheap); the list is redrawn
    // at most every GROUPS_FLUSH_MS. Rows that arrive before the first load is
    // ready wait for it.
    const scheduleGroupsFlush = () => {
      if (!listShown || flushTimer) return;
      flushTimer = setTimeout(flushGroupsList, GROUPS_FLUSH_MS);
    };
    const putGroup = (group) => {
      groupsMap.set(group.groupId, group);
      setGroupUnread(group.groupId, group.unreadCount);
      scheduleGroupsFlush();
    };
    const dropGroup = (groupId) => {
      groupsMap.delete(groupId);
      removeGroupUnread(groupId);
      scheduleGroupsFlush();
    };

    // ── Supabase path ────────────────────────────────────────────────
    if (SUPABASE_GROUP_META_ENABLED) {
      const handleSupaUpsert = (row) => {
        if (!row || !row.groupId) return;
        putGroup({
          groupId: row.groupId,
          groupName: row.groupName || i18next.t('chat.chat_navigator.group_fallback'),
          groupAvatar: row.groupAvatar || null,
          lastMessage: row.lastMessage || i18next.t('chat.message_common.no_messages'),
          lastMessageTimestamp: row.lastMessageTimestamp || 0,
          unreadCount: row.unreadCount || 0,
          memberCount: row.memberCount || 0,
          createdBy: row.createdBy || null,
          // Carried so GroupsScreen can build its mute map from these rows
          // instead of re-fetching all group_meta_data.
          muted: !!row.muted,
        });
      };

      const handleSupaRemove = (groupId) => {
        if (!groupId) return;
        dropGroup(groupId);
      };

      // Backstop: the initial load waits on a Firebase token + one Supabase
      // request, and nothing may hold the spinner forever (Adopt Me b369893,
      // 2026-10-14 reports). Rows already in hand stay on screen.
      const loadingFallback = setTimeout(() => {
        flushGroupsList();
        setGroupsLoading(false);
      }, 5000);

      const unsub = subscribeToGroupMeta(user.id, {
        onUpsert: handleSupaUpsert,
        onRemove: handleSupaRemove,
        onReady: () => {
          clearTimeout(loadingFallback);
          flushGroupsList();
          setGroupsLoading(false);
        },
      });
      return () => {
        unsub();
        clearTimeout(loadingFallback);
        if (flushTimer) clearTimeout(flushTimer);
        clearGroupUnread();
      };
    }

    // ── RTDB fallback (original code) ────────────────────────────────
    const userGroupsRef = ref(appdatabase, `group_meta_data/${user.id}`);

    const parseGroupData = (groupId, groupData) => {
      if (!groupData || typeof groupData !== 'object') return null;
      return {
        groupId,
        groupName: groupData.groupName || i18next.t('chat.chat_navigator.group_fallback'),
        groupAvatar: groupData.groupAvatar || null,
        lastMessage: groupData.lastMessage || i18next.t('chat.message_common.no_messages'),
        lastMessageTimestamp: groupData.lastMessageTimestamp || 0,
        unreadCount: groupData.unreadCount || 0,
        memberCount: groupData.memberCount || 0,
        createdBy: groupData.createdBy || null,
        muted: !!groupData.muted,
      };
    };

    const loadInitialGroups = async () => {
      try {
        const snapshot = await get(userGroupsRef);
        const fetchedData = snapshot.exists() ? snapshot.val() : null;
        if (fetchedData && typeof fetchedData === 'object') {
          Object.entries(fetchedData).forEach(([groupId, groupData]) => {
            const parsed = parseGroupData(groupId, groupData);
            if (parsed) {
              groupsMap.set(groupId, parsed);
              setGroupUnread(groupId, parsed.unreadCount);
            }
          });
        }
      } catch (error) {
        console.error('Error loading initial groups:', error);
      }
      flushGroupsList();
      setGroupsLoading(false);
    };

    const handleChildAdded = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      if (groupsMap.has(snapshot.key)) return;
      const parsed = parseGroupData(snapshot.key, snapshot.val());
      if (parsed) putGroup(parsed);
    };

    const handleChildChanged = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      const parsed = parseGroupData(snapshot.key, snapshot.val());
      if (parsed) putGroup(parsed);
    };

    const handleChildRemoved = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      dropGroup(snapshot.key);
    };

    loadInitialGroups();

    const unsubAdded = onChildAdded(userGroupsRef, handleChildAdded);
    const unsubChanged = onChildChanged(userGroupsRef, handleChildChanged);
    const unsubRemoved = onChildRemoved(userGroupsRef, handleChildRemoved);

    return () => {
      unsubAdded();
      unsubChanged();
      unsubRemoved();
      if (flushTimer) clearTimeout(flushTimer);
      clearGroupUnread();
    };
  }, [user?.id, appdatabase]);

  const [onlineUsersVisible, setOnlineUsersVisible] = useState(false);

  const getGroupChatOptions = useCallback(({ navigation }) => ({
    header: () => (
      <ThemeHeader
        title={user?.id ? '' : 'Community Chat'}
        rightContent={
          <CommunityChatHeader
            selectedTheme={selectedTheme}
            triggerHapticFeedback={triggerHapticFeedback}
            onOnlineUsersPress={() => setOnlineUsersVisible(true)}
            onLeaderboardPress={() => {
              if (navigation && typeof navigation.navigate === 'function') {
                navigation.navigate('Leaderboard');
              }
            }}
          />
        }
      />
    ),
  }), [selectedTheme, triggerHapticFeedback, user?.id]);

  // Screen render functions are memoized on purpose. React Navigation skips
  // re-rendering a screen only when its render function is the same one as
  // last time; inline arrows here were new on every ChatStack render, so the
  // screen on top and the one under it (not frozen on Fabric) re-rendered
  // with it — the public chat under the Inbox, the DM screen itself.
  const renderGroupChat = useCallback(() => (
    <ChatScreen
      {...{ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo, bannedUsers, setBannedUsers, triggerHapticFeedback, unreadMessagesCount, onlineUsersVisible, setOnlineUsersVisible }}
    />
  ), [selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo, bannedUsers, triggerHapticFeedback, unreadMessagesCount, onlineUsersVisible]);

  const renderInbox = useCallback(
    (props) => <InboxScreen {...props} bannedUsers={bannedUsers} />,
    [bannedUsers]
  );

  const renderGroups = useCallback(
    (props) => <GroupsScreen {...props} groups={groups} setGroups={setGroups} groupsLoading={groupsLoading} />,
    [groups, groupsLoading]
  );

  const renderGroupChatDetail = useCallback((props) => <GroupChatScreen {...props} />, []);

  const renderBlockedUsers = useCallback(
    (props) => <BlockedUsersScreen {...props} bannedUsers={bannedUsers} />,
    [bannedUsers]
  );

  const getPrivateChatOptions = useCallback(({ route }) => ({
    headerTitle: () => (
      <PrivateChatHeader
        // New header per player, so nothing from the previous chat carries over.
        key={route.params?.selectedUser?.senderId || 'none'}
        selectedUser={route.params?.selectedUser}
        selectedTheme={selectedTheme}
        bannedUsers={bannedUsers}
        isDrawerVisible={isDrawerVisible}
        setIsDrawerVisible={setIsDrawerVisible}
      />
    ),
  }), [selectedTheme, bannedUsers, isDrawerVisible]);

  const renderPrivateChat = useCallback((props) => (
    <PrivateChatScreen
      // New screen per player: params changing in place (a quick second tap)
      // left the previous player's state behind.
      key={props.route?.params?.selectedUser?.senderId || 'none'}
      {...props}
      bannedUsers={bannedUsers}
      isDrawerVisible={isDrawerVisible}
      setIsDrawerVisible={setIsDrawerVisible}
    />
  ), [bannedUsers, isDrawerVisible]);

  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen
        name="GroupChat"
        options={getGroupChatOptions}
      >
        {renderGroupChat}
      </Stack.Screen>

      {/* ✅ Optimized: InboxScreen manages its own state — only needs bannedUsers */}
      <Stack.Screen
        name="Inbox"
        options={{ title: t('misc.inbox') }}
      >
        {renderInbox}
      </Stack.Screen>

      <Stack.Screen
        name="Groups"
        options={{ title: t('chat.chat_navigator.title_groups') }}
      >
        {renderGroups}
      </Stack.Screen>

      <Stack.Screen
        name="GroupChatDetail"
        options={groupChatDetailOptions}
      >
        {renderGroupChatDetail}
      </Stack.Screen>

      <Stack.Screen
        name="BlockedUsers"
        options={{ title: t('chat.blocked_users') }} >
        {renderBlockedUsers}
      </Stack.Screen>

      <Stack.Screen
        name="PrivateChat"
        options={getPrivateChatOptions}
      >
        {renderPrivateChat}
      </Stack.Screen>

      <Stack.Screen
        name="ImageViewerScreenChat"
        component={ImageViewerScreenChat}
        options={{ title: t('chat.chat_navigator.title_image') }}
      />

      <Stack.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={{ title: t('chat.chat_navigator.title_top_rated') }}
      />

      <Stack.Screen
        name="AdminDashboard"
        component={AdminDashboard}
        options={{ title: '', headerShown: false }} // AdminDashboard has its own header
      />

      <Stack.Screen
        name="SocialDashboard"
        component={SocialDashboard}
        options={{ title: t('chat.chat_navigator.title_friends') }}
      />
    </Stack.Navigator>

  );
};
