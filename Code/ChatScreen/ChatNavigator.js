import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ChatScreen from './GroupChat/Trader';
import PrivateChatScreen from './PrivateChat/PrivateChat';
import InboxScreen from './GroupChat/InboxScreen';
import { ref } from '@react-native-firebase/database';
import { useGlobalState } from '../GlobelStats';
import PrivateChatHeader from './PrivateChat/PrivateChatHeader';
import BlockedUsersScreen from './PrivateChat/BlockUserList';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import { developmentMode } from '../Ads/ads';
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
    // const activeChatRef = database().ref(`users/${user.id}/activeChat`);
  
    // 🔹 Listen for real-time changes
    const onValueChange = userChatsRef.on('value', async (snapshot) => {
      try {
        let updatedChats = [];
        let totalUnread = 0;
  
        if (snapshot.exists()) {
          const fetchedData = snapshot.val();
  
          updatedChats = Object.entries(fetchedData)
            .filter(([chatPartnerId, chatData]) => chatPartnerId && !bannedUsers.includes(chatPartnerId))
            .map(([chatPartnerId, chatData]) => {
              const lastMessage = chatData.lastMessage || 'No messages yet';
              const lastMessageTimestamp = chatData.timestamp || null;
              const unreadCount = chatData.unreadCount || 0;
              totalUnread += unreadCount;
  
              return {
                chatId: chatData.chatId,
                otherUserId: chatPartnerId,
                lastMessage,
                lastMessageTimestamp,
                unreadCount,
                otherUserAvatar: chatData.receiverAvatar || 'https://example.com/default-avatar.jpg',
                otherUserName: chatData.receiverName || 'Anonymous',
              };
            });
  
          // 🔹 Sort chats by last message timestamp (newest first)
          updatedChats = updatedChats.sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0));
        } else {
          // console.log("⚠️ No chats found, checking for active chat...");
  
          // // ✅ If no chats exist, check for active chat
          // const activeChatSnapshot = await activeChatRef.once('value');
          // const activeChat = activeChatSnapshot.val();
  
          // if (activeChat) {
          //   console.log("🔥 Found active chat, setting as default:", activeChat);
          //   updatedChats = [{
          //     chatId: activeChat,
          //     otherUserId: "active",
          //     lastMessage: "Active Chat",
          //     lastMessageTimestamp: Date.now(),
          //     unreadCount: 0
          //   }];
          // }
        }
  
        // ✅ Update state with the fetched chats
        setChats(updatedChats);
        setunreadcount(totalUnread);
      } catch (error) {
        console.error("❌ Error fetching chats:", error);
        // Alert.alert("Error", "Unable to fetch chats. Please try again later.");
      } finally {
        // ✅ Ensures `setLoading(false)` is always called
        setLoading(false);
      }
    });
  
    // ✅ Cleanup listener when component unmounts
    return () => userChatsRef.off('value', onValueChange);
  }, [user]);
  
  

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
