import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ChatScreen from './GroupChat/Trader';
import PrivateChatScreen from './PrivateChat/PrivateChat';
import InboxScreen from './GroupChat/InboxScreen';
import { useGlobalState } from '../GlobelStats';
import PrivateChatHeader from './PrivateChat/PrivateChatHeader';
import BlockedUsersScreen from './PrivateChat/BlockUserList';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import database from '@react-native-firebase/database';

const Stack = createNativeStackNavigator();

export const ChatStack = ({ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo }) => {
  const { user, unreadMessagesCount, appdatabase } = useGlobalState();
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(false);
  const [unreadcount, setunreadcount] = useState(0);
  const { localState, updateLocalState } = useLocalState()


  useEffect(() => {
    if (!user?.id) return;
    setBannedUsers(localState.bannedUsers)

  }, [user?.id, localState.bannedUsers]);


  const headerOptions = useMemo(() => ({
    headerStyle: { backgroundColor: selectedTheme.colors.background },
    headerTintColor: selectedTheme.colors.text,
    headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 24 },
  }), [selectedTheme]);


  const fetchChats = useCallback(() => {
    if (!user?.id) return;
  
    setLoading(true);
    const userChatsRef = database().ref(`chat_meta_data/${user.id}`);
  
    const onValueChange = userChatsRef.on('value', (snapshot) => {
      try {
        if (!snapshot.exists()) {
          setChats([]); 
          setunreadcount(0);
          return;
        }
  
        let updatedChats = [];
        let totalUnread = 0;
        const fetchedData = snapshot.val();
  
        updatedChats = Object.entries(fetchedData)
          .filter(([chatPartnerId]) => chatPartnerId && !bannedUsers.includes(chatPartnerId))
          .map(([chatPartnerId, chatData]) => {
            totalUnread += chatData.unreadCount || 0;
            return {
              chatId: chatData.chatId,
              otherUserId: chatPartnerId,
              lastMessage: chatData.lastMessage || 'No messages yet',
              lastMessageTimestamp: chatData.timestamp || 0,
              unreadCount: chatData.unreadCount || 0,
              otherUserAvatar: chatData.receiverAvatar || 'https://example.com/default-avatar.jpg',
              otherUserName: chatData.receiverName || 'Anonymous',
            };
          });
  
        // ✅ Sort by latest message
        setChats(updatedChats.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp));
        setunreadcount(totalUnread);
      } catch (error) {
        console.error("❌ Error fetching chats:", error);
      } finally {
        setLoading(false);
      }
    });
  
    return () => userChatsRef.off('value', onValueChange); // ✅ Ensures cleanup
  }, [user]); // ✅ Added `bannedUsers` as a dependency
  
  
  

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);


  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen
        name="GroupChat"
        options={{ headerTitleAlign: 'left', headerShown: false }}
      >
        {() => (
          <ChatScreen
            {...{ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo, bannedUsers, setBannedUsers, triggerHapticFeedback, unreadMessagesCount, fetchChats, unreadcount, setunreadcount }}
          />
        )}
      </Stack.Screen>

      {/* ✅ Optimized: Pass `chats` & `setChats` via `screenProps` instead of inline function */}
      <Stack.Screen
        name="Inbox"
        options={{ title: 'Inbox' }}
      >
        {props => <InboxScreen {...props} chats={chats} setChats={setChats} loading={loading} bannedUsers={bannedUsers} />}
      </Stack.Screen>

      <Stack.Screen
        name="BlockedUsers"
        options={{ title: 'Blocked Users' }} >
        {props => <BlockedUsersScreen {...props} bannedUsers={bannedUsers} />}
      </Stack.Screen>

      <Stack.Screen
        name="PrivateChat"
        component={PrivateChatScreen}
        initialParams={{ bannedUsers }}
        options={({ route }) => ({
          headerTitle: () => (
            <PrivateChatHeader
              {...route.params}
              selectedTheme={selectedTheme}
              bannedUsers={bannedUsers}
              setBannedUsers={setBannedUsers}
              triggerHapticFeedback={triggerHapticFeedback}
            />
          ),
        })}
      />
    </Stack.Navigator>

  );
};
