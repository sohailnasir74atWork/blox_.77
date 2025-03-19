import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  ActivityIndicator,
  Alert,
  Text,
  Image,
} from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { getStyles } from '../Style';
import PrivateMessageInput from './PrivateMessageInput';
import PrivateMessageList from './PrivateMessageList';
import { useGlobalState } from '../../GlobelStats';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import getAdUnitId, { developmentMode } from '../../Ads/ads';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { clearActiveChat, setActiveChat } from '../utils';
import { useLocalState } from '../../LocalGlobelStats';
import { ref } from '@react-native-firebase/database';
import database from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';
import FlashMessage, { showMessage } from 'react-native-flash-message';


const PAGE_SIZE = 30;
const bannerAdUnitId = getAdUnitId('banner');

const PrivateChatScreen = () => {
  const route = useRoute();
  const { selectedUser, selectedTheme, bannedUsers, item } = route.params || {};
  const { user, theme, appdatabase } = useGlobalState();
  const [trade, setTrade] = useState(null)
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedKey, setLastLoadedKey] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [input, setInput] = useState('');
  const [isAdVisible, setIsAdVisible] = useState(true);
  const { localState } = useLocalState()
  const selectedUserId = selectedUser?.senderId;
  const myUserId = user?.id;
  const { t } = useTranslation();
  // console.log(item)
  
  useEffect(()=>{setTrade(item)}, [])



  const isBanned = useMemo(() => {
    // const bannedUserIds = bannedUsers?.map((user) => user.id) || [];
    return bannedUsers.includes(selectedUserId);
  }, [bannedUsers, selectedUserId]);
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // Generate a unique chat key
  const chatKey = useMemo(
    () =>
      myUserId < selectedUserId
        ? `${myUserId}_${selectedUserId}`
        : `${selectedUserId}_${myUserId}`,
    [myUserId, selectedUserId]
  );


  // const navigation = useNavigation();
  useFocusEffect(
    useCallback(() => {
      // Screen is focused
      // console.log('Screen is focused');

      return () => {
        // Screen is unfocused
        if (user?.id) {
          clearActiveChat(user.id);
          // console.log('Triggered clearActiveChat for user:', user.id);
        }
      };
    }, [user?.id])
  );



  // const messageRef = useMemo(() => ref(appdatabase, `private_chat_new/${chatKey}/messages`), [chatKey]);

  const messagesRef = useMemo(() => database().ref(`private_messages/${chatKey}/messages`), [chatKey]);
  // console.log(selecte÷dUser)

  // Load messages with pagination
  const loadMessages = useCallback(
    async (reset = false) => {
      setLoading(reset);

      try {
        let query = messagesRef.orderByKey().limitToLast(PAGE_SIZE);
        if (!reset && lastLoadedKey) {
          query = query.endAt(lastLoadedKey);
        }

        const snapshot = await query.once('value');
        const data = snapshot.val() || {};

        const parsedMessages = Object.entries(data)
          .map(([key, value]) => ({ id: key, ...value }))
          .sort((a, b) => b.timestamp - a.timestamp);

        if (parsedMessages.length > 0) {
          setMessages((prev) => (reset ? parsedMessages : [...parsedMessages, ...prev]));
          setLastLoadedKey(Object.keys(data)[0]);
        } else if (reset) {
          setMessages([]); // Clear messages if reset and no data
        }
      } catch (error) {
        console.error('Error loading messages:', error);
      } finally {
        setLoading(false);
      }
    },
    [messagesRef, lastLoadedKey]
  );

  // console.log(selectedUser.sender)
  const groupItems = (items) => {
    const grouped = {};
    items.forEach(({ name, type }) => {
      const key = `${name}-${type}`;
      if (grouped[key]) {
        grouped[key].count += 1;
      } else {
        grouped[key] = { name, type, count: 1 };
      }
    });
    return Object.values(grouped);
  };
  const formatName = (name) => {
    let formattedName = name.replace(/^\+/, '');
    formattedName = formattedName.replace(/\s+/g, '-');
    return formattedName;
  };

  useEffect(() => {
    const chatId = [myUserId, selectedUserId].sort().join('_');
    const tradeRef = database().ref(`private_messages/${chatId}/trade`);
  
    if (item) {
      // ✅ If trade comes from props, set it and update Firebase
      setTrade(item);
      tradeRef.set(item).catch((error) => console.error("Error updating trade in Firebase:", error));
    } else {
      // ✅ If no trade in props, check Firebase
      tradeRef.once('value')
        .then((snapshot) => {
          const tradeData = snapshot.val();
          if (tradeData) {
            setTrade(tradeData);
          }
        })
        .catch((error) => console.error("Error fetching trade from Firebase:", error));
    }
  }, []);
  

  const groupedHasItems = groupItems(trade?.hasItems || []);
  const groupedWantsItems = groupItems(trade?.wantsItems || []);


  // Send message

  const sendMessage = async (text) => {
    const trimmedText = text.trim();
    if (!trimmedText) {
      // Alert.alert("Error", "Message cannot be empty!");
      showMessage({
        message: t("home.alert.error"),
        description: t("chat.cannot_empty"),
        type: "success",
      });
      return;
    }

    const timestamp = Date.now();
    const chatId = [myUserId, selectedUserId].sort().join('_');
    const tradeRef = database().ref(`private_messages/${chatId}/trade`);


    // References
    const messageRef = database().ref(`private_messages/${chatId}/messages/${timestamp}`);
    const senderChatRef = database().ref(`chat_meta_data/${myUserId}/${selectedUserId}`);
    const receiverChatRef = database().ref(`chat_meta_data/${selectedUserId}/${myUserId}`);
    const receiverStatusRef = database().ref(`users/${selectedUserId}/activeChat`);

    try {
      // Send the message
      await messageRef.set({ text: trimmedText, senderId: myUserId, timestamp });

      // Check if receiver is currently in the chat
      const snapshot = await receiverStatusRef.once('value');
      const isReceiverInChat = snapshot.val() === chatId;
      // console.log(selectedUser)


      // Update sender's chat metadata (unread count always 0 for sender)
      await senderChatRef.update({
        chatId,
        receiverId: selectedUserId,
        receiverName: selectedUser?.sender || "Anonymous",
        receiverAvatar: selectedUser?.avatar || "https://example.com/default-avatar.jpg",
        lastMessage: trimmedText,
        timestamp,
        unreadCount: 0
      });

      // Update receiver's chat metadata (increase unread count if not in chat)
      await receiverChatRef.update({
        chatId,
        receiverId: myUserId,
        receiverName: user?.displayName || "Anonymous",
        receiverAvatar: user?.avatar || "https://example.com/default-avatar.jpg",
        lastMessage: trimmedText,
        timestamp,
        unreadCount: isReceiverInChat ? 0 : database.ServerValue.increment(1)
      });

      setInput('');
      setReplyTo(null);
    } catch (error) {
      console.error("Error sending message:", error);
      Alert.alert("Error", "Could not send your message. Please try again.");
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !selectedUserId) return;

      const chatMetaRef = database().ref(`chat_meta_data/${user.id}/${selectedUserId}`);

      // ✅ Reset unreadCount when entering chat
      chatMetaRef.update({ unreadCount: 0 });

      setActiveChat(user.id, chatKey);

      return () => {
        clearActiveChat(user.id);
      };
    }, [user?.id, selectedUserId, chatKey])
  );
  // console.log(selectedUser.senderId)

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMessages(true);
    setRefreshing(false);
  }, [loadMessages]);

  useEffect(() => {
    setActiveChat(user.id, chatKey)
  }, [user.id, chatKey]);
  useEffect(() => {
    const listener = messagesRef.on('child_added', (snapshot) => {
      const newMessage = { id: snapshot.key, ...snapshot.val() };
      // if (developmentMode) {
      //   const privatechat_new_message = JSON.stringify(newMessage).length / 1024;
      //   console.log(`🚀 Downloaded data: ${privatechat_new_message.toFixed(2)} KB from private chat new messages node`);
      // }
      setMessages((prevMessages) =>
        prevMessages.some((msg) => msg.id === newMessage.id)
          ? prevMessages
          : [newMessage, ...prevMessages]
      );
    });

    return () => {
      messagesRef.off('child_added'); // ✅ Correct cleanup
    };
  }, [messagesRef]);




  return (
    <>

      <GestureHandlerRootView>


        <View style={styles.container}>

          <ConditionalKeyboardWrapper style={{ flex: 1 }} chatscreen={true}>
            {/* <View style={{ flex: 1 }}> */}
              {trade && (
                <View style={styles.tradeDetails}>
                  <View style={styles.itemList}>
                    {groupedHasItems?.map((hasItem, index) => (
                      <View key={`${hasItem.name}-${hasItem.type}`} style={{ justifyContent: 'center', alignItems: 'center'}}>
                        <Image
                          source={{
                            uri: hasItem.type === 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(hasItem.name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(hasItem.name)}_Icon.webp`,
                          }}
                          style={[styles.itemImage, { backgroundColor: hasItem.type === 'p' ? '#FFCC00' : '' }]}
                        />
                        <Text style={styles.names}>
                          {hasItem.name}{hasItem.type === 'p' && " (P)"}
                        </Text>
                        {hasItem.count > 1 && (
                          <View style={styles.tagcount}>
                            <Text style={styles.tagcounttext}>{hasItem.count}</Text>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                  <View style={styles.transfer}>
                    <Image source={require('../../../assets/transfer.png')} style={styles.transferImage} />
                  </View>
                  <View style={styles.itemList}>
                  {groupedWantsItems?.map((wantitem, index) => (
                    <View key={`${wantitem.name}-${wantitem.type}`} style={{ justifyContent: 'center', alignItems: 'center'}}>
                      <Image
                        source={{
                          uri: wantitem.type === 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(wantitem.name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(wantitem.name)}_Icon.webp`,
                        }}
                        style={[styles.itemImage, { backgroundColor: wantitem.type === 'p' ? '#FFCC00' : '' }]}
                      />
                      <Text style={styles.names}>
                        {wantitem.name}{wantitem.type === 'p' && " (P)"}
                      </Text>
                      {wantitem.count > 1 && (
                        <View style={styles.tagcount}>
                          <Text style={styles.tagcounttext}>{wantitem.count}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                  </View>
                </View>
              )}

              {!loading && messages.length === 0 ? (
                <ActivityIndicator size="large" color="#1E88E5" style={{ flex: 1, justifyContent: 'center' }} />
              ) : messages.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>{t("chat.no_messages_yet")}</Text>
                </View>
              ) : (
                <PrivateMessageList
                  messages={messages}
                  userId={myUserId}
                  handleLoadMore={loadMessages}
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  isBanned={isBanned}
                  selectedUser={selectedUser}
                  user={user}
                  onReply={(message) => setReplyTo(message)}
                />
              )}

              <PrivateMessageInput
                onSend={sendMessage}
                isBanned={isBanned}
                bannedUsers={bannedUsers}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                input={input}
                setInput={setInput}
                selectedTheme={selectedTheme}
              />
            {/* </View>  */}
            </ConditionalKeyboardWrapper>
        </View>
      </GestureHandlerRootView>

      {!localState.isPro && <View style={{ alignSelf: 'center' }}>
        {isAdVisible && (
          <BannerAd
            unitId={bannerAdUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            onAdLoaded={() => setIsAdVisible(true)}
            onAdFailedToLoad={() => setIsAdVisible(false)}
            requestOptions={{
              requestNonPersonalizedAdsOnly: true,
            }}
          />
        )}
      </View>}
    </>
  );
};

export default PrivateChatScreen;
