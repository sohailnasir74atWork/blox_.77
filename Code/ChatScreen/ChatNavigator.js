import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  subscribeToChatMeta,
  resetUnreadCount as sbResetUnreadCount,
} from '../Supabase/chatMetaBackend';
import { subscribeToGroupMeta } from '../Supabase/groupMetaBackend';
import { SUPABASE_CHAT_META_ENABLED, SUPABASE_GROUP_META_ENABLED } from '../Supabase/featureFlags';
import CommunityChatHeader from './GroupChat/CommunityChatHeader';
import LeaderboardScreen from './GroupChat/LeaderboardScreen';
import AdminDashboard from '../AppHelper/AdminDashboard';
import SocialDashboard from '../AppHelper/SocialDashboard';
import ThemeHeader from '../Design/componenets/ThemeHeader';

const Stack = createNativeStackNavigator();

export const ChatStack = ({ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo }) => {
  const { user, unreadMessagesCount, appdatabase, onlineMembersCount } = useGlobalState();
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const [unreadcount, setunreadcount] = useState(0);
  const { localState, updateLocalState } = useLocalState()
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupUnreadCount, setGroupUnreadCount] = useState(0); // Total unread count for groups


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
  // Writes (resetting unread on blocked partners) STILL go to RTDB —
  // mirror CF tails them and updates Supabase. We don't dual-write.
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setunreadcount(0);
      return;
    }

    let totalUnread = 0;
    const unreadCounts = new Map(); // Track unread counts per chat

    const recomputeTotal = () => {
      totalUnread = Array.from(unreadCounts.values()).reduce((sum, count) => sum + count, 0);
      setunreadcount(totalUnread);
    };

    // ── Supabase path ────────────────────────────────────────────────
    if (SUPABASE_CHAT_META_ENABLED) {
      setunreadcount(0);

      const handleSupaUpsert = (row) => {
        if (!row || !row.partnerId) return;
        const chatPartnerId = row.partnerId;
        const isBlocked = Array.isArray(bannedUsers) && bannedUsers.includes(chatPartnerId);
        const rawUnread = row.unreadCount || 0;
        if (isBlocked && rawUnread > 0) {
          // Reset directly on Supabase (now the source of truth).
          sbResetUnreadCount(user.id, chatPartnerId);
          unreadCounts.set(chatPartnerId, 0);
        } else {
          unreadCounts.set(chatPartnerId, isBlocked ? 0 : rawUnread);
        }
        recomputeTotal();
      };

      const handleSupaRemove = (partnerId) => {
        if (!partnerId) return;
        unreadCounts.delete(partnerId);
        recomputeTotal();
      };

      const unsub = subscribeToChatMeta(user.id, {
        onUpsert: handleSupaUpsert,
        onRemove: handleSupaRemove,
      });
      return () => { unsub(); };
    }

    // ── RTDB fallback (original code) ────────────────────────────────
    const userChatsRef = ref(appdatabase, `chat_meta_data/${user.id}`);

    const handleChildChange = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      const chatData = snapshot.val();
      if (!chatData || typeof chatData !== 'object') return;

      const chatPartnerId = snapshot.key;
      const isBlocked = Array.isArray(bannedUsers) && bannedUsers.includes(chatPartnerId);
      const rawUnread = chatData?.unreadCount || 0;

      if (isBlocked && rawUnread > 0) {
        update(
          ref(appdatabase, `chat_meta_data/${user.id}/${chatPartnerId}`),
          { unreadCount: 0 }
        ).catch((error) => {
          console.error("Error resetting unread count:", error);
        });
        unreadCounts.set(chatPartnerId, 0);
      } else {
        unreadCounts.set(chatPartnerId, isBlocked ? 0 : rawUnread);
      }
      recomputeTotal();
    };

    const handleChildRemoved = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      unreadCounts.delete(snapshot.key);
      recomputeTotal();
    };

    setunreadcount(0);

    const unsubAdded = onChildAdded(userChatsRef, handleChildChange);
    const unsubChanged = onChildChanged(userChatsRef, handleChildChange);
    const unsubRemoved = onChildRemoved(userChatsRef, handleChildRemoved);

    return () => {
      unsubAdded();
      unsubChanged();
      unsubRemoved();
    };
  }, [user?.id, appdatabase, bannedUsers]);

  // Group list + unread badge.
  //
  // Same pattern as chat_meta above: subscribeToGroupMeta on the
  // Supabase path, original RTDB child-listener flow as fallback.
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setGroups([]);
      return;
    }

    setGroupsLoading(true);
    const groupsMap = new Map(); // Track groups locally

    const updateGroupsList = () => {
      const updatedGroups = Array.from(groupsMap.values())
        .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
      setGroups(updatedGroups);

      const totalGroupUnread = updatedGroups.reduce((sum, group) => sum + (group.unreadCount || 0), 0);
      setGroupUnreadCount(totalGroupUnread);
    };

    // ── Supabase path ────────────────────────────────────────────────
    if (SUPABASE_GROUP_META_ENABLED) {
      const handleSupaUpsert = (row) => {
        if (!row || !row.groupId) return;
        groupsMap.set(row.groupId, {
          groupId: row.groupId,
          groupName: row.groupName || 'Group',
          groupAvatar: row.groupAvatar || null,
          lastMessage: row.lastMessage || 'No messages yet',
          lastMessageTimestamp: row.lastMessageTimestamp || 0,
          unreadCount: row.unreadCount || 0,
          memberCount: row.memberCount || 0,
          createdBy: row.createdBy || null,
        });
        updateGroupsList();
      };

      const handleSupaRemove = (groupId) => {
        if (!groupId) return;
        groupsMap.delete(groupId);
        updateGroupsList();
      };

      const unsub = subscribeToGroupMeta(user.id, {
        onUpsert: handleSupaUpsert,
        onRemove: handleSupaRemove,
        onReady: () => setGroupsLoading(false),
      });
      return () => { unsub(); };
    }

    // ── RTDB fallback (original code) ────────────────────────────────
    const userGroupsRef = ref(appdatabase, `group_meta_data/${user.id}`);

    const parseGroupData = (groupId, groupData) => {
      if (!groupData || typeof groupData !== 'object') return null;
      return {
        groupId,
        groupName: groupData.groupName || 'Group',
        groupAvatar: groupData.groupAvatar || null,
        lastMessage: groupData.lastMessage || 'No messages yet',
        lastMessageTimestamp: groupData.lastMessageTimestamp || 0,
        unreadCount: groupData.unreadCount || 0,
        memberCount: groupData.memberCount || 0,
        createdBy: groupData.createdBy || null,
      };
    };

    const loadInitialGroups = async () => {
      try {
        const snapshot = await get(userGroupsRef);
        if (!snapshot.exists()) {
          setGroups([]);
          setGroupUnreadCount(0);
          setGroupsLoading(false);
          return;
        }

        const fetchedData = snapshot.val();
        if (!fetchedData || typeof fetchedData !== 'object') {
          setGroups([]);
          setGroupUnreadCount(0);
          setGroupsLoading(false);
          return;
        }

        Object.entries(fetchedData).forEach(([groupId, groupData]) => {
          const parsed = parseGroupData(groupId, groupData);
          if (parsed) groupsMap.set(groupId, parsed);
        });

        updateGroupsList();
        setGroupsLoading(false);
      } catch (error) {
        console.error('Error loading initial groups:', error);
        setGroupsLoading(false);
      }
    };

    const handleChildAdded = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      if (groupsMap.has(snapshot.key)) return;
      const parsed = parseGroupData(snapshot.key, snapshot.val());
      if (parsed) {
        groupsMap.set(snapshot.key, parsed);
        updateGroupsList();
      }
    };

    const handleChildChanged = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      const parsed = parseGroupData(snapshot.key, snapshot.val());
      if (parsed) {
        groupsMap.set(snapshot.key, parsed);
        updateGroupsList();
      }
    };

    const handleChildRemoved = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      groupsMap.delete(snapshot.key);
      updateGroupsList();
    };

    loadInitialGroups();

    const unsubAdded = onChildAdded(userGroupsRef, handleChildAdded);
    const unsubChanged = onChildChanged(userGroupsRef, handleChildChanged);
    const unsubRemoved = onChildRemoved(userGroupsRef, handleChildRemoved);

    return () => {
      unsubAdded();
      unsubChanged();
      unsubRemoved();
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
            unreadcount={unreadcount}
            setunreadcount={setunreadcount}
            groupUnreadCount={groupUnreadCount}
            setGroupUnreadCount={setGroupUnreadCount}
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
  }), [selectedTheme, unreadcount, setunreadcount, groupUnreadCount, setGroupUnreadCount, triggerHapticFeedback, user?.id]);

  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen
        name="GroupChat"
        options={getGroupChatOptions}
      >
        {() => (
          <ChatScreen
            {...{ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo, bannedUsers, setBannedUsers, triggerHapticFeedback, unreadMessagesCount, unreadcount, setunreadcount, onlineUsersVisible, setOnlineUsersVisible }}
          />
        )}
      </Stack.Screen>

      {/* ✅ Optimized: InboxScreen manages its own state — only needs bannedUsers */}
      <Stack.Screen
        name="Inbox"
        options={{ title: 'Inbox' }}
      >
        {props => <InboxScreen {...props} bannedUsers={bannedUsers} />}
      </Stack.Screen>

      <Stack.Screen
        name="Groups"
        options={{ title: 'Groups' }}
      >
        {props => <GroupsScreen {...props} groups={groups} setGroups={setGroups} groupsLoading={groupsLoading} />}
      </Stack.Screen>

      <Stack.Screen
        name="GroupChatDetail"
        options={({ route, navigation }) => ({
          headerBackVisible: true,
          headerTitle: () => {
            // This will be set dynamically by GroupChatScreen
            return null;
          },
          headerRight: () => {
            // This will be set dynamically by GroupChatScreen
            return null;
          },
        })}
      >
        {(props) => <GroupChatScreen {...props} />}
      </Stack.Screen>

      <Stack.Screen
        name="BlockedUsers"
        options={{ title: 'Blocked Users' }} >
        {props => <BlockedUsersScreen {...props} bannedUsers={bannedUsers} />}
      </Stack.Screen>

      <Stack.Screen
        name="PrivateChat"
        options={({ route }) => ({
          headerTitle: () => (
            <PrivateChatHeader
              selectedUser={route.params?.selectedUser}
              selectedTheme={selectedTheme}
              bannedUsers={bannedUsers}
              isDrawerVisible={isDrawerVisible}
              setIsDrawerVisible={setIsDrawerVisible}
            />
          ),
        })}
      >
        {(props) => (
          <PrivateChatScreen
            {...props}
            bannedUsers={bannedUsers}
            isDrawerVisible={isDrawerVisible}
            setIsDrawerVisible={setIsDrawerVisible}
          />
        )}
      </Stack.Screen>

      <Stack.Screen
        name="ImageViewerScreenChat"
        component={ImageViewerScreenChat}
        options={{ title: 'Image' }}
      />

      <Stack.Screen
        name="Leaderboard"
        options={{ title: 'Top Rated Users' }}
      >
        {props => <LeaderboardScreen {...props} />}
      </Stack.Screen>

      <Stack.Screen
        name="AdminDashboard"
        component={AdminDashboard}
        options={{ title: '', headerShown: false }} // AdminDashboard has its own header
      />

      <Stack.Screen
        name="SocialDashboard"
        component={SocialDashboard}
        options={{ title: 'Friends' }}
      />
    </Stack.Navigator>

  );
};
