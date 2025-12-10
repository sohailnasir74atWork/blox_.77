import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  ActivityIndicator,
  Alert,
  Text,
  Image,
  TouchableOpacity,  TextInput,
  TouchableWithoutFeedback,  

} from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { getStyles } from '../Style';
import PrivateMessageInput from './PrivateMessageInput';
import PrivateMessageList from './PrivateMessageList';
import { useGlobalState } from '../../GlobelStats';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { clearActiveChat, isUserOnline, setActiveChat } from '../utils';
import { useLocalState } from '../../LocalGlobelStats';
import  { get, increment, ref, update } from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import BannerAdComponent from '../../Ads/bannerAds';
import config from '../../Helper/Environment';
import PetModal from './PetsModel';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from '@react-native-firebase/firestore';
import { Keyboard } from 'react-native';
import ProfileBottomDrawer from '../GroupChat/BottomDrawer';


const PAGE_SIZE = 15;

const PrivateChatScreen = ({route, bannedUsers, isDrawerVisible, setIsDrawerVisible }) => {
  const { selectedUser, selectedTheme, item } = route.params || {};

  const { user, theme, appdatabase, updateLocalStateAndDatabase, firestoreDB } = useGlobalState();

  
    const [trade, setTrade] = useState(null)
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const lastLoadedKeyRef = useRef(null);
  const [lastLoadedKey, setLastLoadedKey] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [input, setInput] = useState('');
  const [isAdVisible, setIsAdVisible] = useState(true);
  const { localState } = useLocalState()
  const selectedUserId = selectedUser?.senderId;
  const myUserId = user?.id;
  const { t } = useTranslation();
  const [canRate, setCanRate] = useState(false);
const [hasRated, setHasRated] = useState(false);
const [showRatingModal, setShowRatingModal] = useState(false);
const [rating, setRating] = useState(0);
const [petModalVisible, setPetModalVisible] = useState(false);
const [selectedFruits, setSelectedFruits] = useState([]); 
const [reviewText, setReviewText] = useState('');   // 👈 new
const [startRating,setStartRating] = useState(false);
const [isOnline, setIsOnline] = useState(false); 




  // console.log(item)
  
  useEffect(()=>{setTrade(item)}, [])


  useEffect(() => {
    if (selectedUserId) {
      isUserOnline(selectedUserId).then(setIsOnline).catch(() => setIsOnline(false));
    }
  }, [selectedUserId]);

  useEffect(() => {
    if (messages.length === 0) return;
  
    const myMsgs = messages.filter(m => m.senderId === myUserId);
    const theirMsgs = messages.filter(m => m.senderId === selectedUserId);
  
    if (myMsgs.length > 1 && theirMsgs.length > 1) {
      setCanRate(true);
    }
  }, [messages]);
  
  useEffect(() => {
    if (!selectedUserId || !myUserId) return;
  
    const ratingRef = ref(appdatabase, `ratings/${selectedUserId}/${myUserId}`);
    ratingRef.once('value').then(snapshot => {
      if (snapshot.exists()) {
        setHasRated(true);
      }
    }).catch(error => {
      console.error("Error checking existing rating:", error);
    });
  }, [selectedUserId, myUserId]);


  const closeProfileDrawer = () => {
    setIsDrawerVisible(false);
  };
  
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

  const getUserPoints = async (userId) => {
    if (!userId) return 0;
    try {
      const snapshot = await get(ref(appdatabase, `/users/${userId}/rewardPoints`));
      return snapshot.exists() ? snapshot.val() : 0;
    } catch (error) {
      return error;
    }
  };

  const updateUserPoints = async (userId, pointsToAdd) => {
    if (!userId) return;
    try {
      const latestPoints = await getUserPoints(userId);
      // console.log(latestPoints)

      const newPoints = latestPoints + pointsToAdd;
      await update(ref(appdatabase, `/users/${userId}`), { rewardPoints: newPoints });
      updateLocalStateAndDatabase('rewardPoints', newPoints);
    } catch (error) {}
  };
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

const handleRating = async () => {
  if (!rating) {
    showErrorMessage("Error", "Please select a rating first.");
    return;
  }

  try {
    // 🔹 Realtime Database part (same as before)
    setStartRating(true)
    const ratingRef = ref(appdatabase, `ratings/${selectedUserId}/${myUserId}`);
    const avgRef = ref(appdatabase, `averageRatings/${selectedUserId}`);


    const [oldRatingSnap, avgSnap] = await Promise.all([
      ratingRef.once('value'),
      avgRef.once('value'),
    ]);

    const oldRating = oldRatingSnap.val()?.rating;
    const avgData = avgSnap.val();
    const oldAverage = avgData?.value || 0;
    const oldCount = avgData?.count || 0;

    let newAverage = 0;
    let newCount = oldCount;

    if (oldRating !== undefined) {
      // Updating existing rating
      newAverage = ((oldAverage * oldCount) - oldRating + rating) / oldCount;
    } else {
      // New rating
      newCount = oldCount + 1;
      newAverage = ((oldAverage * oldCount) + rating) / newCount;
    }

    // ✅ Save rating
    await ratingRef.set({
      rating,
      timestamp: Date.now(),
    });

    // ✅ Update average
    await avgRef.set({
      value: parseFloat(newAverage.toFixed(2)),
      count: newCount,
      updatedAt: Date.now(),
    });
    const trimmedReview = (reviewText || "").trim();

    let reviewWasSaved = false;
    let reviewWasUpdated = false;
    
    if (trimmedReview) {
      // one doc per (fromUser, toUser)
      const reviewDocId = `${selectedUserId}_${myUserId}`; // toUser_fromUser
      const reviewRef = doc(firestoreDB, "reviews", reviewDocId);
    
      const now = serverTimestamp();
    
      // 🔍 check if this user already reviewed this trader
      const existingSnap = await getDoc(reviewRef);
const isUpdate = existingSnap.exists;   // 👈 property, NOT function
    
      await setDoc(
        reviewRef,
        {
          fromUserId: myUserId,
          toUserId: selectedUserId,
          rating,
          userName: user?.displayName || user?.displayname || null,
          review: trimmedReview, // guaranteed non-empty here
          createdAt: isUpdate ? existingSnap.data()?.createdAt ?? now : now,
          updatedAt: now,
          edited: isUpdate,
        },
        { merge: true }
      );
    
      reviewWasSaved = true;
      reviewWasUpdated = isUpdate;
    }
    
    // 🎉 feedback based on whether we actually saved a text review
    showSuccessMessage(
      "Success",
      reviewWasSaved
        ? reviewWasUpdated
          ? "Your review was updated."
          : "Thanks for your review!"
        : "Thanks for your rating!"
    );
    
    setShowRatingModal(false);
    setHasRated(true);
      setReviewText('');
      await updateUserPoints(user?.id, 100);
    setStartRating(false)
    showSuccessMessage("Success", "Thanks for your feedback!");

  } catch (error) {
    console.error("Rating error:", error);
    showErrorMessage("Error", "Error submitting rating. Try again!");
  }
}



const messagesRef = useMemo(
  () => (chatKey ? ref(appdatabase, `private_messages/${chatKey}/messages`) : null),
  [chatKey, appdatabase],
);  // console.log(selecte÷dUser)

  // Load messages with pagination
  const loadMessages = useCallback(
    async (reset = false) => {
      if (!messagesRef) return;
  
      if (reset) {
        setLoading(true);
        setMessages([]);
        lastLoadedKeyRef.current = null;
      }
      try {
        let query = messagesRef.orderByKey();
  
        const lastKey = lastLoadedKeyRef.current;
        if (!reset && lastKey) {
          // get older messages including lastKey – we’ll filter overlap
          query = query.endAt(lastKey);
        }
  
        // ✅ apply limit ONLY ONCE, at the end
        query = query.limitToLast(PAGE_SIZE);

        const snapshot = await query.once('value');
        const data = snapshot.val() || {};

        let parsedMessages = Object.entries(data)
          .map(([key, value]) => ({ id: key, ...value }))
          .sort((a, b) => b.timestamp - a.timestamp);
          if (parsedMessages.length === 0) return;

          setMessages(prev => {
            const existingIds = new Set(prev.map(m => String(m.id)));
            const onlyNew = parsedMessages.filter(m => !existingIds.has(String(m.id)));
            return reset ? parsedMessages : [...onlyNew, ...prev];
          });
    
          lastLoadedKeyRef.current = parsedMessages[0].id; // oldest in this batch
    
      } catch (error) {
        console.error('Error loading messages:', error);
      } finally {
        if (reset) setLoading(false);      }
    },
    [messagesRef]
  );
  useEffect(() => {
    if (!messagesRef) return;
    loadMessages(true);
  }, [messagesRef, loadMessages]);
  
  const handleLoadMore = useCallback(() => {
    // explicitly say "this is NOT a reset"
    loadMessages(false);
  }, [loadMessages]);
  
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
    const tradeRef = ref(appdatabase, `private_messages/${chatId}/trade`);

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

  const containsLink = (text = "") => {
    const t = String(text);
  
    // obvious links
    if (/(https?:\/\/|www\.)\S+/i.test(t)) return true;
  
    // simple domain patterns (covers many scam attempts)
    const domainRegex =
      /\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|net|org|io|gg|co|uk|ru|pk|xyz|app|me|tv|info|biz|site|store)\b/i;
  
    return domainRegex.test(t);
  };
  
  // Send message

  const sendMessage = async (text, image, fruits) => {
    const trimmedText = (text || '').trim(); // safe guard
    const hasImage = !!image;
    const hasFruits = Array.isArray(fruits) && fruits.length > 0;
    if (trimmedText && containsLink(trimmedText)) {
      showErrorMessage(t("home.alert.error"), "Links are not allowed in chat.");
      return;
    }
    // Block only if there's no text, no image AND no fruits
    if (!trimmedText && !hasImage && !hasFruits) {
      // Alert.alert("Error", "Message cannot be empty!");
      showErrorMessage(t("home.alert.error"), t("chat.cannot_empty"));
      return;
    }
    setInput('');

    const timestamp = Date.now();
    const chatId = [myUserId, selectedUserId].sort().join('_');
    // const tradeRef = database().ref(`private_messages/${chatId}/trade`);


    // References
    const messageRef       = ref(appdatabase, `private_messages/${chatId}/messages/${timestamp}`);
    const senderChatRef    = ref(appdatabase, `chat_meta_data/${myUserId}/${selectedUserId}`);
    const receiverChatRef  = ref(appdatabase, `chat_meta_data/${selectedUserId}/${myUserId}`);
    const receiverStatusRef = ref(appdatabase, `users/${selectedUserId}/activeChat`);
    const messageData = {
      text: trimmedText,
      senderId: myUserId,
      timestamp,
    };
  
    if (hasImage) {
      messageData.imageUrl = image;      // 👈 used in PrivateMessageList
    }
  
    if (hasFruits) {
      messageData.fruits = fruits;       // 👈 your array of selected fruits
    }
  
    // What to show as last message in chat list
    const lastMessagePreview =
      trimmedText ||
      (hasImage ? '📷 Photo' : hasFruits ? `🐾 ${fruits.length} pet(s)` : '');
  
    try {
      // Save the message
      await messageRef.set(messageData);
  

      // Check if receiver is currently in the chat
      const snapshot = await receiverStatusRef.once('value');
      const isReceiverInChat = snapshot.val() === chatId;
      // console.log(selectedUser)


      // Update sender's chat metadata (unread count always 0 for sender)
      await senderChatRef.update({
        chatId,
        receiverId: selectedUserId,
        // flage:user?.flage,
        receiverName: selectedUser?.sender || "Anonymous",
        receiverAvatar: selectedUser?.avatar || "https://example.com/default-avatar.jpg",
        lastMessage: lastMessagePreview,
        timestamp,
        unreadCount: 0
      });

      // Update receiver's chat metadata (increase unread count if not in chat)
      await receiverChatRef.update({
        chatId,
        receiverId: myUserId,
        receiverName: user?.displayName || "Anonymous",
        receiverAvatar: user?.avatar || "https://example.com/default-avatar.jpg",
        lastMessage: lastMessagePreview,
        timestamp,
        unreadCount: isReceiverInChat ? 0 : increment(1),
      });

      // setInput('');
      setReplyTo(null);
    } catch (error) {
      console.error("Error sending message:", error);
      Alert.alert("Error", "Could not send your message. Please try again.");
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !selectedUserId) return;

      const chatMetaRef = ref(appdatabase, `chat_meta_data/${user.id}/${selectedUserId}`);

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
    if (!messagesRef) return;
  
    const handleChildAdded = snapshot => {
      const newMessage = { id: snapshot.key, ...snapshot.val() };
  
      setMessages(prev => {
        const exists = prev.some(m => String(m.id) === String(newMessage.id));
        if (exists) return prev;
  

     return [newMessage, ...prev];
      });
    };
  
    messagesRef.on('child_added', handleChildAdded);
  
    return () => {
      messagesRef.off('child_added', handleChildAdded);
    };
  }, [messagesRef]);
  
  





  return (
    <>

      <GestureHandlerRootView>


        <View style={styles.container}>

          <ConditionalKeyboardWrapper style={{ flex: 1 }} privatechatscreen={true}>
          <TouchableWithoutFeedback
    onPress={Keyboard.dismiss}
    accessible={false}
  >
            <View style={{ flex: 1 }}>
              {trade && (
                <View>
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
                {/* {canRate && !hasRated && (
  <View style={{ alignItems: 'center', marginTop: 5, }}>
    <TouchableOpacity
      style={{
        backgroundColor: config.colors.primary,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 6,
      }}
      onPress={() => {setShowRatingModal(true)
      }}
    >
      <Text style={{ color: 'white', fontSize: 12 }}>
        Rate Trader and Get 100 points
      </Text>
    </TouchableOpacity>
  </View>
)} */}


                </View>

              )}

{messages.length === 0 ? (
  // No messages yet
  loading ? (
    // Still checking / loading
    <ActivityIndicator
      size="large"
      color="#1E88E5"
      style={{ flex: 1, justifyContent: 'center' }}
    />
  ) : (
    // Finished loading, still empty
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>{t('chat.no_messages_yet')}</Text>
    </View>
  )
) : (
                <PrivateMessageList
                  messages={messages}
                  userId={myUserId}
                  handleLoadMore={handleLoadMore}
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  isBanned={isBanned}
                  selectedUser={selectedUser}
                  user={user}
                  onReply={(message) => setReplyTo(message)}
                  canRate={canRate}
    hasRated={hasRated}
    setShowRatingModal={setShowRatingModal}
                />
              )}
                         

                          {!localState.isPro && <BannerAdComponent/>}

              <PrivateMessageInput
                onSend={sendMessage}
                isBanned={isBanned}
                bannedUsers={bannedUsers}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                input={input}
                setInput={setInput}
                selectedTheme={selectedTheme}
                petModalVisible={petModalVisible}
                setPetModalVisible={setPetModalVisible}
                selectedFruits={selectedFruits}
                setSelectedFruits={setSelectedFruits}
              />
               <PetModal
               fromChat={true}
      visible={petModalVisible}
      onClose={() => setPetModalVisible(false)}
        selectedFruits={selectedFruits}
        setSelectedFruits={setSelectedFruits}



      
    />
                </View> 

    </TouchableWithoutFeedback>
                   </ConditionalKeyboardWrapper>
        </View>
      </GestureHandlerRootView>
      {showRatingModal && (
  <View
    style={{
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 9999,
    }}
  >
    <View
      style={{
        backgroundColor: 'white',
        padding: 20,
        borderRadius: 10,
        width: '80%',
        alignItems: 'center',
        position: 'relative',
      }}
    >
      {/* ❌ Close Button */}
      <TouchableOpacity
        onPress={() => setShowRatingModal(false)}
        style={{
          position: 'absolute',
          top: -5,
          right: 1,
          zIndex: 100,
          padding: 5,
        }}
      >
        <Text style={{ fontSize: 18, color: '#888' }}>✖</Text>
      </TouchableOpacity>

      {/* Title */}
      <Text style={{ fontSize: 16, marginBottom: 10, textAlign: 'center', fontWeight:'600' }}>
        Rate this Trader
      </Text>

      {/* Stars */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 15 }}>
        {[1, 2, 3, 4, 5].map((num) => (
          <TouchableOpacity key={num} onPress={() => setRating(num)}>
            <Text style={{ fontSize: 32, color: num <= rating ? '#FFD700' : '#ccc', marginHorizontal: 4 }}>
              ★
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
  style={{
    width: '100%',
    minHeight: 60,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
    textAlignVertical: 'top',
    fontSize: 14,
  }}
  placeholder="Write an optional review..."
  placeholderTextColor="#999"
  multiline
  value={reviewText}
  onChangeText={setReviewText}
/>

      {/* Submit Button */}
      <TouchableOpacity
        style={{
          backgroundColor: config.colors.primary,
          paddingVertical: 10,
          paddingHorizontal: 20,
          borderRadius: 8,
          width: '100%',
        }}
        onPress={handleRating}
      >
        <Text style={{ color: 'white', fontSize: 14, textAlign: 'center' }}>
        { !startRating ?'Submit Rating' : 'Submitting'}
        </Text>
      </TouchableOpacity>
    </View>
  </View>
)}

<ProfileBottomDrawer
          isVisible={isDrawerVisible}
          toggleModal={closeProfileDrawer}  
          startChat={()=>{}}
          selectedUser={selectedUser}
          isOnline={isOnline}
          bannedUsers={bannedUsers}
          fromPvtChat={true}
        />
      {/* {!localState.isPro && <View style={{ alignSelf: 'center' }}>
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
      </View>} */}
    </>
  );
};

export default PrivateChatScreen;
