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
// import { isUserOnline } from './utils';

const Stack = createNativeStackNavigator();

export const ChatStack = ({ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo }) => {
  const { user, unreadMessagesCount, appdatabase } = useGlobalState();
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(false);
  const [unreadcount, setunreadcount] = useState(0);
  const {localState, updateLocalState} = useLocalState()


useEffect(() => {
    if (!user?.id) return;
setBannedUsers(localState.bannedUsers)
    
  }, [user?.id, localState.bannedUsers]);


  // useEffect(() => {
  //   if (!user?.id) return;

  //   const bannedRef = ref(appdatabase, `bannedUsers/${user.id}`);
  //   const unsubscribe = onValue(
  //     bannedRef,
  //     (snapshot) => {
  //       if (!snapshot.exists()) {
  //         setBannedUsers([]);
  //         return;
  //       }
        
  //       setBannedUsers(Object.entries(snapshot.val()).map(([id, details]) => ({
  //         id,
  //         displayName: details.displayName || 'Unknown',
  //         avatar: details.avatar || '',
  //       })));
  //     },
  //     (error) => console.error('Error in banned users listener:', error)
  //   );

  //   return () => {
  //     // console.log('Cleaning up banned users listener');
  //     unsubscribe();
  //   };
  // }, [user?.id]);

  const headerOptions = useMemo(() => ({
    headerStyle: { backgroundColor: selectedTheme.colors.background },
    headerTintColor: selectedTheme.colors.text,
    headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 24 },
  }), [selectedTheme]);

  
  
  const fetchChats = useCallback(async () => {
    if (!user?.id) return;
  
    setLoading(true);
  
    try {
      const privateChatsRef = ref(appdatabase, 'private_chat_new');
      const queryRef = privateChatsRef.orderByChild(`participants/${user.id}`).equalTo(true);
  
      // 🔍 Fetch data from Firebase
      const snapshot = await queryRef.once('value');
  
      if (!snapshot.exists()) {
        setChats([]);
        return;
      }
  
      // 🔹 Calculate the size of downloaded data in KB
      const fetchedData = snapshot.val();
      if (developmentMode) {
        const dataSize = JSON.stringify(fetchedData).length / 1024; 
        console.log(`Downloaded private chat data: ${dataSize.toFixed(2)} KB`);
      }
  
      let totalUnread = 0;
  
      // 🔍 Process only necessary fields
      const userChats = Object.entries(fetchedData)
        .filter(([chatId, chatData]) => {
          const otherUserId = Object.keys(chatData.participants).find((id) => id !== user.id);
          return otherUserId && !bannedUsers.includes(otherUserId);
        })
        .map(([chatId, chatData]) => {
          const otherUserId = Object.keys(chatData.participants).find((id) => id !== user.id);
          const lastMessage = chatData.lastMessage || null;
          const metadata = chatData.metadata || {};
          const unreadCount = chatData.unread?.[user.id] || 0;
          totalUnread += unreadCount;
  
          return {
            chatId,
            otherUserId,
            lastMessage: lastMessage?.text || 'No messages yet',
            lastMessageTimestamp: lastMessage?.timestamp || null,
            unreadCount,
            otherUserAvatar:
              otherUserId === metadata.senderId
                ? metadata.senderAvatar
                : metadata.receiverAvatar,
            otherUserName:
              otherUserId === metadata.senderId
                ? metadata.senderName
                : metadata.receiverName,
          };
        });
  
      const sortedChats = userChats.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
  
      // ✅ Update state with the fetched chats
      setChats(sortedChats);
      setunreadcount(totalUnread);
    } catch (error) {
      console.error('❌ Error fetching chats:', error);
      Alert.alert('Error', 'Unable to fetch chats. Please try again later.');
    } finally {
      setLoading(false);
    }
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
    {props => <InboxScreen {...props} chats={chats} setChats={setChats} loading={loading}  bannedUsers={bannedUsers}/>} 
  </Stack.Screen>

  <Stack.Screen 
    name="BlockedUsers" 
    options={{ title: 'Blocked Users' }} >
    {props => <BlockedUsersScreen {...props}  bannedUsers={bannedUsers}/>} 
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
