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


  // ✅ OPTIMIZED: Use child listeners instead of full value listener to reduce data download
  // Listen to individual chat unreadCount changes instead of downloading entire chat_meta_data
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setunreadcount(0);
      return;
    }

    const userChatsRef = ref(appdatabase, `chat_meta_data/${user.id}`);
    let totalUnread = 0;
    const unreadCounts = new Map(); // Track unread counts per chat

    // ✅ OPTIMIZED: Use child_added and child_changed to listen to individual chats
    // This only downloads data when a specific chat changes, not the entire metadata
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

      // Recalculate total
      totalUnread = Array.from(unreadCounts.values()).reduce((sum, count) => sum + count, 0);
      setunreadcount(totalUnread);
    };

    const handleChildRemoved = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      unreadCounts.delete(snapshot.key);
      totalUnread = Array.from(unreadCounts.values()).reduce((sum, count) => sum + count, 0);
      setunreadcount(totalUnread);
    };

    // ✅ OPTIMIZED: Use incremental loading with child listeners only
    // Instead of downloading all metadata at once, let child_added fire for each chat
    // This way we only download data as it's needed, reducing wildcard downloads

    // Set initial count to 0 (will be updated as child_added fires for existing chats)
    setunreadcount(0);

    // ✅ Listen to individual chat changes - child_added will fire for existing chats
    // This is more efficient than downloading all data at once
    const unsubAdded = onChildAdded(userChatsRef, handleChildChange);
    const unsubChanged = onChildChanged(userChatsRef, handleChildChange);
    const unsubRemoved = onChildRemoved(userChatsRef, handleChildRemoved);

    // ✅ Proper cleanup
    return () => {
      unsubAdded();
      unsubChanged();
      unsubRemoved();
    };
  }, [user?.id, appdatabase, bannedUsers]);

  // ✅ OPTIMIZED: Load groups from group_meta_data using get() + child listeners
  // This prevents re-downloading ALL group metadata on every single change
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setGroups([]);
      return;
    }

    setGroupsLoading(true);
    const userGroupsRef = ref(appdatabase, `group_meta_data/${user.id}`);
    const groupsMap = new Map(); // Track groups locally

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

    const updateGroupsList = () => {
      const updatedGroups = Array.from(groupsMap.values())
        .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
      setGroups(updatedGroups);

      const totalGroupUnread = updatedGroups.reduce((sum, group) => sum + (group.unreadCount || 0), 0);
      setGroupUnreadCount(totalGroupUnread);
    };

    // ✅ Initial load with get() (one-time read)
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

    // ✅ Child listeners for real-time updates (only downloads changed data)
    const handleChildAdded = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      if (groupsMap.has(snapshot.key)) return; // Skip already-loaded groups
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
