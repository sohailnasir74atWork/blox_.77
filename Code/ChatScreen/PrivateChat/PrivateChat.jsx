import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  ActivityIndicator,
  Alert,
  Text,
  Image,
  TouchableOpacity, TextInput,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getStyles } from '../Style';
import PrivateMessageInput from './PrivateMessageInput';
import PrivateMessageList from './PrivateMessageList';
import { useGlobalState } from '../../GlobelStats';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { clearActiveChat, isUserOnline, setActiveChat, updateLastRead, useOtherLastRead } from '../utils';
import { useLocalState } from '../../LocalGlobelStats';
import { get, set, increment, ref, update, remove, query as dbQuery, orderByKey, limitToLast, endAt, onChildAdded, serverTimestamp as rtdbServerTimestamp } from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import BannerAdComponent from '../../Ads/bannerAds';
import { seedCurrentUser } from '../../Helper/profileCache';
import InterstitialAdManager from '../../Ads/IntAd';
import config from '../../Helper/Environment';
import PetModal from './PetsModel';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from '@react-native-firebase/firestore';
import { updateUserRatingSummary } from '../utils/ratingSummaryHelper';
import ProfileBottomDrawer from '../GroupChat/BottomDrawer';


const PAGE_SIZE = 15;

const PrivateChatScreen = ({ route, bannedUsers, isDrawerVisible, setIsDrawerVisible }) => {
  const { selectedUser: initialSelectedUser, selectedTheme, item } = route.params || {};
  const [currentSelectedUser, setCurrentSelectedUser] = useState(initialSelectedUser);

  const { user, theme, appdatabase, updateLocalStateAndDatabase, firestoreDB, currentUserEmail, strikeInfo, isAdmin } = useGlobalState();


  const [trade, setTrade] = useState(null)
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const lastLoadedKeyRef = useRef(null);
  const [lastLoadedKey, setLastLoadedKey] = useState(null);
  const previousChatKeyRef = useRef(null);
  const [replyTo, setReplyTo] = useState(null);
  const [input, setInput] = useState('');
  const [isAdVisible, setIsAdVisible] = useState(true);
  const { localState } = useLocalState()
  const selectedUserId = currentSelectedUser?.senderId;
  const myUserId = user?.id;
  const { t } = useTranslation();
  const [canRate, setCanRate] = useState(false);
  const [hasRated, setHasRated] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [rating, setRating] = useState(0);
  const [petModalVisible, setPetModalVisible] = useState(false);
  const [selectedFruits, setSelectedFruits] = useState([]);
  const [reviewText, setReviewText] = useState('');
  const [startRating, setStartRating] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const hasSentMessageRef = useRef(0); // ✅ Track count of messages user sent (for exit ad)
  const chatEnterTimeRef = useRef(null); // ✅ Track when user entered chat
  // ✅ Cost opt: write receiverName/receiverAvatar into chat_meta_data only once per session
  const metaIdentityWrittenRef = useRef(new Set());
  const myUserIdRef = useRef(myUserId);
  const chatKeyRef = useRef(null);
  myUserIdRef.current = myUserId;

  useEffect(() => {
    if (item) {
      setTrade(item);
    }
  }, [item]);



  useEffect(() => {
    if (selectedUserId) {
      isUserOnline(selectedUserId).then(setIsOnline).catch(() => setIsOnline(false));

      // ✅ Fetch latest role data (Moderator/Admin) for tag consistency
      if (appdatabase) {
        const fetchLatestRole = async () => {
          try {
            const userRef = ref(appdatabase, `users/${selectedUserId}`);
            const snapshot = await get(userRef);
            if (snapshot.exists()) {
              const data = snapshot.val();
              setCurrentSelectedUser(prev => ({
                ...prev,
                isAdmin: data.admin || false,
                isModerator: data.isModerator || false,
                avatar: data.avatar || prev?.avatar, // Also update avatar if changed
                sender: data.displayName || data.robloxUsername || prev?.sender
              }));
            }
          } catch (err) {
            console.error("Error fetching latest user role:", err);
          }
        };
        fetchLatestRole();
      }
    }
  }, [selectedUserId, appdatabase]);

  useEffect(() => {
    if (!Array.isArray(messages) || messages.length === 0) return;
    if (!myUserId || !selectedUserId) return;

    const myMsgs = messages.filter(m => m?.senderId === myUserId);
    const theirMsgs = messages.filter(m => m?.senderId === selectedUserId);

    if (myMsgs.length > 1 && theirMsgs.length > 1) {
      setCanRate(true);
    } else {
      setCanRate(false);
    }
  }, [messages, myUserId, selectedUserId]);

  useEffect(() => {
    if (!selectedUserId || !myUserId || !firestoreDB) return;

    // ✅ MIGRATED: Check rating from Firestore instead of RTDB
    const reviewDocId = `${selectedUserId}_${myUserId}`;
    const reviewRef = doc(firestoreDB, "reviews", reviewDocId);

    getDoc(reviewRef)
      .then(snapshot => {
        if (snapshot.exists()) {
          setHasRated(true);
        } else {
          setHasRated(false);
        }
      })
      .catch(error => {
        console.error("Error checking existing rating:", error);
        setHasRated(false);
      });
  }, [selectedUserId, myUserId, firestoreDB]);


  const closeProfileDrawer = () => {
    setIsDrawerVisible(false);
  };

  const isBanned = useMemo(() => {
    if (!selectedUserId) return false;
    const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
    return banned.includes(selectedUserId);
  }, [bannedUsers, selectedUserId]);
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // ✅ Ensure chatKey matches the format used when storing messages (sorted IDs)
  const chatKey = useMemo(
    () => {
      if (!myUserId || !selectedUserId) return null;
      return [myUserId, selectedUserId].sort().join('_');
    },
    [myUserId, selectedUserId]
  );
  chatKeyRef.current = chatKey;

  // ✅ Read receipts: listen to other user's lastRead timestamp
  const otherLastRead = useOtherLastRead(chatKey, selectedUserId);

  const getUserPoints = useCallback(async (userId) => {
    if (!userId || !appdatabase) return 0;
    try {
      const snapshot = await get(ref(appdatabase, `/users/${userId}/rewardPoints`));
      return snapshot.exists() ? Number(snapshot.val()) || 0 : 0;
    } catch (error) {
      console.error('Error getting user points:', error);
      return 0;
    }
  }, [appdatabase]);

  const updateUserPoints = useCallback(async (userId, pointsToAdd) => {
    if (!userId || !appdatabase) return;
    if (typeof pointsToAdd !== 'number' || isNaN(pointsToAdd)) {
      console.error('Invalid pointsToAdd value');
      return;
    }
    try {
      const latestPoints = await getUserPoints(userId);
      const newPoints = Number(latestPoints) + Number(pointsToAdd);
      await update(ref(appdatabase, `/users/${userId}`), { rewardPoints: newPoints });
      if (updateLocalStateAndDatabase && typeof updateLocalStateAndDatabase === 'function') {
        updateLocalStateAndDatabase('rewardPoints', newPoints);
      }
    } catch (error) {
      console.error('Error updating user points:', error);
    }
  }, [getUserPoints, appdatabase, updateLocalStateAndDatabase]);
  useFocusEffect(
    useCallback(() => {
      if (user?.id) seedCurrentUser(user, localState, appdatabase);
      return () => {
        if (user?.id) {
          clearActiveChat(user.id);
        }
      };
    }, [user?.id])
  );

  const handleRating = useCallback(async () => {
    // ✅ Block globally banned users from submitting reviews
    if (strikeInfo && !isAdmin) {
      const { bannedUntil } = strikeInfo;
      if (bannedUntil === 'permanent' || (typeof bannedUntil === 'number' && Date.now() < bannedUntil)) {
        showErrorMessage(t("home.alert.error"), "You are banned and cannot submit reviews.");
        return;
      }
    }

    if (!rating || rating < 1 || rating > 5) {
      showErrorMessage("Error", "Please select a rating first.");
      return;
    }

    if (!selectedUserId || !myUserId || !appdatabase || !firestoreDB) {
      showErrorMessage("Error", "Missing required data. Please try again.");
      return;
    }

    try {
      setStartRating(true)

      // ✅ MIGRATED: Get old rating from Firestore instead of RTDB
      const reviewDocId = `${selectedUserId}_${myUserId}`;
      const reviewRef = doc(firestoreDB, "reviews", reviewDocId);
      const existingSnap = await getDoc(reviewRef);
      const oldRating = existingSnap.exists() ? existingSnap.data()?.rating : undefined;

      // ✅ Get current summary from Firestore to calculate new average
      const summaryRef = doc(firestoreDB, 'user_ratings_summary', selectedUserId);
      const summarySnap = await getDoc(summaryRef);
      const summaryData = summarySnap.exists() ? summarySnap.data() : null;
      const oldAverage = summaryData?.averageRating || 0;
      const oldCount = summaryData?.count || 0;

      let newAverage = 0;
      let newCount = oldCount;

      if (oldRating !== undefined) {
        newAverage = ((oldAverage * oldCount) - oldRating + rating) / oldCount;
      } else {
        newCount = oldCount + 1;
        newAverage = ((oldAverage * oldCount) + rating) / newCount;
      }

      const trimmedReview = (reviewText || "").trim();

      let reviewWasSaved = false;
      let reviewWasUpdated = false;

      // ✅ MIGRATED: Save ALL ratings to Firestore only (removed RTDB writes)
      // Note: reviewRef and existingSnap already fetched above, reuse them
      const now = serverTimestamp();
      const isUpdate = existingSnap.exists();

      await setDoc(
        reviewRef,
        {
          fromUserId: myUserId,
          toUserId: selectedUserId,
          rating,
          userName: user?.displayName || user?.displayname || null,
          review: trimmedReview || null, // Can be null if no review text
          createdAt: isUpdate ? existingSnap.data()?.createdAt ?? now : now,
          updatedAt: now,
          edited: isUpdate,
        },
        { merge: true }
      );

      reviewWasSaved = true;
      reviewWasUpdated = isUpdate;

      // ✅ OPTIMIZED: Update user_ratings_summary collection (background update, doesn't block UI)
      // This maintains aggregated data for efficient leaderboard queries
      updateUserRatingSummary(firestoreDB, selectedUserId).catch((err) => {
        console.error('Error updating rating summary:', err);
        // Don't show error to user - this is a background operation
      });

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
      if (user?.id) {
        await updateUserPoints(user.id, 100);
      }
      setStartRating(false);

      // ✅ Show interstitial ad after review submit/edit (non-Pro only)
      if (!localState?.isPro) {
        InterstitialAdManager.showAd(() => { });
      }

    } catch (error) {
      console.error("Rating error:", error);
      showErrorMessage("Error", "Error submitting rating. Try again!");
      setStartRating(false);
    }
  }, [rating, selectedUserId, myUserId, appdatabase, firestoreDB, reviewText, user?.id, user?.displayName, updateUserPoints, strikeInfo, isAdmin, t]);



  const messagesRef = useMemo(
    () => (chatKey ? ref(appdatabase, `private_messages/${chatKey}/messages`) : null),
    [chatKey, appdatabase],
  );

  const loadMessages = useCallback(
    async (reset = false) => {
      if (!messagesRef) return;

      if (reset) {
        setLoading(true);
        setMessages([]);
        lastLoadedKeyRef.current = null;
      }
      try {
        const lastKey = lastLoadedKeyRef.current;

        const msgQuery = (!reset && lastKey)
          ? dbQuery(messagesRef, orderByKey(), endAt(lastKey), limitToLast(PAGE_SIZE))
          : dbQuery(messagesRef, orderByKey(), limitToLast(PAGE_SIZE));

        const snapshot = await get(msgQuery);
        const data = snapshot.val() || {};

        let parsedMessages = Object.entries(data)
          .map(([key, value]) => ({ id: key, ...value }))
          .sort((a, b) => (b?.serverTime || b?.timestamp || 0) - (a?.serverTime || a?.timestamp || 0));

        if (parsedMessages.length === 0) {
          if (reset) {
          }
          return;
        }

        setMessages(prev => {
          if (!Array.isArray(prev)) return parsedMessages;
          const existingIds = new Set(prev.map(m => String(m?.id)));
          const onlyNew = parsedMessages.filter(m => !existingIds.has(String(m?.id)));

          if (reset) {
            return parsedMessages;
          } else {
            const combined = [...prev, ...onlyNew];
            return combined.sort((a, b) => (b?.serverTime || b?.timestamp || 0) - (a?.serverTime || a?.timestamp || 0));
          }
        });

        lastLoadedKeyRef.current = parsedMessages[parsedMessages.length - 1]?.id;

      } catch (error) {
        console.error('Error loading messages:', error);
      } finally {
        if (reset) setLoading(false);
      }
    },
    [messagesRef]
  );
  // ✅ OPTIMIZED: Initial load with pagination, then use child_added for new messages only
  useEffect(() => {
    if (!messagesRef) return;

    const currentChatKey = chatKey;
    const previousChatKey = previousChatKeyRef.current;

    if (currentChatKey !== previousChatKey) {
      previousChatKeyRef.current = currentChatKey;
      loadMessages(true);
    } else if (previousChatKey === null) {
      previousChatKeyRef.current = currentChatKey;
      loadMessages(true);
    }
  }, [chatKey, messagesRef, loadMessages]);

  const handleLoadMore = useCallback(() => {
    loadMessages(false);
  }, [loadMessages]);

  const groupItems = useCallback((items) => {
    if (!Array.isArray(items)) return [];
    const grouped = {};
    items.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const key = `${item.name || ''}-${item.type || ''}`;
      if (grouped[key]) {
        grouped[key].count = (grouped[key].count || 0) + 1;
      } else {
        grouped[key] = {
          ...item,
          count: 1
        };
      }
    });
    return Object.values(grouped);
  }, []);

  const formatName = useCallback((name) => {
    if (!name || typeof name !== 'string') return '';
    let formattedName = name.replace(/^\+/, '');
    formattedName = formattedName.replace(/\s+/g, '-');
    return formattedName;
  }, []);

  useEffect(() => {
    if (!myUserId || !selectedUserId || !appdatabase) return;

    const chatId = [myUserId, selectedUserId].sort().join('_');
    const tradeRef = ref(appdatabase, `private_messages/${chatId}/trade`);

    if (item && typeof item === 'object') {
      setTrade(item);
      set(tradeRef, item).catch((error) => {
        console.error("Error updating trade in Firebase:", error);
      });
    } else {
      get(tradeRef)
        .then((snapshot) => {
          if (snapshot.exists()) {
            const tradeData = snapshot.val();
            if (tradeData && typeof tradeData === 'object') {
              setTrade(tradeData);
            }
          }
        })
        .catch((error) => {
          console.error("Error fetching trade from Firebase:", error);
        });
    }
  }, [item, myUserId, selectedUserId, appdatabase]);


  const groupedHasItems = useMemo(() => {
    if (!trade || !trade.hasItems || !Array.isArray(trade.hasItems)) return [];
    return groupItems(trade.hasItems);
  }, [trade?.hasItems, groupItems]);

  const groupedWantsItems = useMemo(() => {
    if (!trade || !trade.wantsItems || !Array.isArray(trade.wantsItems)) return [];
    return groupItems(trade.wantsItems);
  }, [trade?.wantsItems, groupItems]);



  const sendMessage = useCallback(async (text, image, fruits, replyToMsg) => {
    const trimmedText = (text || '').trim();
    const hasImage = !!image;
    const hasFruits = Array.isArray(fruits) && fruits.length > 0;

    if (!myUserId || !currentUserEmail) {
      showErrorMessage(t("home.alert.error"), "You must be logged in to send messages.");
      return;
    }
    // ✅ Admins are exempt from blocking
    if (strikeInfo && !isAdmin) {
      const { strikeCount, bannedUntil } = strikeInfo;
      const now = Date.now();

      if (bannedUntil === 'permanent') {
        showErrorMessage(t("home.alert.error"), "You are permanently banned from sending messages.");
        return;
      }

      if (typeof bannedUntil === 'number' && now < bannedUntil) {
        const totalMinutes = Math.ceil((bannedUntil - now) / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        showErrorMessage(
          t("home.alert.error"),
          `You are banned from chatting for ${timeLeftText} more minute(s).`
        );
        return;
      }
    }

    if (hasFruits && fruits.length > 18) {
      showErrorMessage(t("home.alert.error"), "You can only send up to 18 pets in a message.");
      return;
    }

    if (!trimmedText && !hasImage && !hasFruits) {
      showErrorMessage(t("home.alert.error"), t("chat.cannot_empty"));
      return;
    }

    if (!myUserId || !selectedUserId || !appdatabase) {
      showErrorMessage(t("home.alert.error"), "Missing required data. Please try again.");
      return;
    }

    setInput('');

    const timestamp = Date.now();
    const chatId = [myUserId, selectedUserId].sort().join('_');


    const messageRef = ref(appdatabase, `private_messages/${chatId}/messages/${timestamp}`);
    const senderChatRef = ref(appdatabase, `chat_meta_data/${myUserId}/${selectedUserId}`);
    const receiverChatRef = ref(appdatabase, `chat_meta_data/${selectedUserId}/${myUserId}`);

    // ✅ Cost opt #1: Cosmetics are sender-level and live in profileCache / users/{uid}/shop/activeItems.
    // resolveProfile falls back to cache, so we no longer need to duplicate them per message.
    const messageData = {
      text: trimmedText,
      senderId: myUserId,
      timestamp,
      serverTime: rtdbServerTimestamp(), // ✅ Server-authoritative timestamp for correct ordering
    };

    if (hasImage) {
      messageData.imageUrl = image;
    }

    if (hasFruits) {
      messageData.fruits = fruits;
    }

    if (replyToMsg) {
      messageData.replyTo = {
        id: replyToMsg.id,
        text: replyToMsg.text || '',
        senderId: replyToMsg.senderId,
        imageUrl: replyToMsg.imageUrl || null,
        hasFruits: replyToMsg.fruits && replyToMsg.fruits.length > 0,
        fruitsCount: replyToMsg.fruits ? replyToMsg.fruits.length : 0,
      };
    }

    const lastMessagePreview =
      trimmedText ||
      (hasImage ? '📷 Photo' : hasFruits ? `🐾 ${fruits.length} pet(s)` : '');

    // ✅ Optimistic: add message to local state immediately (no waiting for Firebase)
    const optimisticMsg = {
      id: String(timestamp),
      ...messageData,
      serverTime: timestamp, // ✅ Use local estimate until server data arrives via child_added
      _optimistic: true, // ✅ Mark so child_added can update with real serverTime
      sender: user?.displayName || 'You',
      avatar: user?.avatar || null,
      ...(replyToMsg ? { replyTo: messageData.replyTo } : {}),
    };
    setMessages(prev => {
      if (!Array.isArray(prev)) return [optimisticMsg];
      return [optimisticMsg, ...prev].sort((a, b) => (b?.serverTime || b?.timestamp || 0) - (a?.serverTime || a?.timestamp || 0));
    });

    try {
      await set(messageRef, messageData);

      // ✅ Cost opt #2(a): Only write receiverName/receiverAvatar once per session.
      // They rarely change, and the receiver's useFocusEffect clears unreadCount on open.
      // ✅ Cost opt #5: Drop the pre-send get(receiverStatusRef); always increment(1).
      //   Receiver's useFocusEffect already resets unreadCount to 0 when they open the chat.
      const senderKey = `${myUserId}_${selectedUserId}`;
      const receiverKey = `${selectedUserId}_${myUserId}`;

      const senderUpdate = {
        chatId,
        receiverId: selectedUserId,
        lastMessage: lastMessagePreview,
        timestamp,
        unreadCount: 0,
      };
      const receiverUpdate = {
        chatId,
        receiverId: myUserId,
        lastMessage: lastMessagePreview,
        timestamp,
        unreadCount: increment(1),
      };

      if (!metaIdentityWrittenRef.current.has(senderKey)) {
        senderUpdate.receiverName = currentSelectedUser?.sender || "Anonymous";
        senderUpdate.receiverAvatar = currentSelectedUser?.avatar || "https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png";
        metaIdentityWrittenRef.current.add(senderKey);
      }
      if (!metaIdentityWrittenRef.current.has(receiverKey)) {
        receiverUpdate.receiverName = user?.displayName || "Anonymous";
        receiverUpdate.receiverAvatar = user?.avatar || "https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png";
        metaIdentityWrittenRef.current.add(receiverKey);
      }

      await update(senderChatRef, senderUpdate);
      await update(receiverChatRef, receiverUpdate);

      setReplyTo(null);
      hasSentMessageRef.current += 1; // ✅ Increment message count
    } catch (error) {
      console.error("Error sending message:", error);
      Alert.alert("Error", "Could not send your message. Please try again.");
    }
  }, [myUserId, selectedUserId, appdatabase, currentSelectedUser, user, t, currentUserEmail, strikeInfo, isAdmin]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !selectedUserId) return;

      const chatMetaRef = ref(appdatabase, `chat_meta_data/${user.id}/${selectedUserId}`);

      update(chatMetaRef, { unreadCount: 0 });

      setActiveChat(user.id, chatKey);

      // ✅ Mark messages as read
      updateLastRead(chatKey, user.id);

      // ✅ Reset refs when entering chat
      hasSentMessageRef.current = 0;
      chatEnterTimeRef.current = Date.now();

      return () => {
        clearActiveChat(user.id);
      };
    }, [user?.id, selectedUserId, chatKey, localState?.isPro])
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMessages(true);
    setRefreshing(false);
  }, [loadMessages]);

  // ── Admin: delete a single message ──
  const handleDeleteMessage = useCallback(async (messageId) => {
    if (!messageId || !chatKey || !appdatabase) return;
    try {
      await remove(ref(appdatabase, `private_messages/${chatKey}/messages/${messageId}`));
      setMessages(prev => prev.filter(m => m.id !== messageId));
    } catch (e) {
      Alert.alert('Error', 'Failed to delete message.');
    }
  }, [chatKey, appdatabase]);

  // ── Admin: delete ALL messages in this chat ──
  const handleDeleteAllChat = useCallback(() => {
    if (!chatKey || !appdatabase || !isAdmin) return;
    Alert.alert(
      'Delete All Messages',
      'Are you sure you want to delete ALL messages in this chat? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            try {
              await remove(ref(appdatabase, `private_messages/${chatKey}/messages`));
              setMessages([]);
              showSuccessMessage('Success', 'All messages deleted.');
            } catch (e) {
              Alert.alert('Error', 'Failed to delete messages.');
            }
          },
        },
      ]
    );
  }, [chatKey, appdatabase, isAdmin]);

  useEffect(() => {
    if (user?.id && chatKey) {
      setActiveChat(user.id, chatKey);
    }
  }, [user?.id, chatKey]);


  useEffect(() => {
    if (!messagesRef) return;

    // ✅ OPTIMIZED: Use limitToLast(1) on child_added to only listen for NEW messages
    // This prevents downloading all historical messages when listener is attached
    // Initial load is handled by loadMessages() with pagination
    const newMessagesQuery = dbQuery(messagesRef, orderByKey(), limitToLast(1));

    const handleChildAdded = snapshot => {
      if (!snapshot || !snapshot.key) return;
      const data = snapshot.val();
      if (!data || typeof data !== 'object') return;

      const newMessage = { id: snapshot.key, ...data };
      if (!newMessage.timestamp) {
        newMessage.timestamp = Date.now();
      }

      // ✅ Update lastRead when a message from the other user arrives while we're viewing
      if (newMessage.senderId && newMessage.senderId !== myUserIdRef.current && chatKeyRef.current) {
        updateLastRead(chatKeyRef.current, myUserIdRef.current);
      }

      setMessages(prev => {
        if (!Array.isArray(prev)) return [newMessage];
        const existingIndex = prev.findIndex(m => String(m?.id) === String(newMessage.id));
        if (existingIndex !== -1) {
          // ✅ Update optimistic message with real server data (corrects serverTime)
          if (prev[existingIndex]._optimistic) {
            const updated = [...prev];
            updated[existingIndex] = { ...updated[existingIndex], ...newMessage, _optimistic: false };
            return updated.sort((a, b) => (b?.serverTime || b?.timestamp || 0) - (a?.serverTime || a?.timestamp || 0));
          }
          return prev; // Already have real data, skip
        }

        return [newMessage, ...prev].sort((a, b) => (b?.serverTime || b?.timestamp || 0) - (a?.serverTime || a?.timestamp || 0));
      });
    };

    // ✅ Only listen for the latest message (new messages only)
    const unsubscribe = onChildAdded(newMessagesQuery, handleChildAdded);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [messagesRef]);







  return (
    <>
      <GestureHandlerRootView>
        <View style={styles.container}>
          <ConditionalKeyboardWrapper style={{ flex: 1 }} privatechatscreen={true}>
            {trade && (
              <View>
                <View style={styles.tradeDetails}>
                  <View style={styles.itemList}>
                    {groupedHasItems?.map((hasItem, index) => (
                      <View key={`${hasItem.name}-${hasItem.type}`} style={{ justifyContent: 'center', alignItems: 'center' }}>
                        <Image
                          source={{
                            uri: hasItem.type === 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(hasItem.name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(hasItem.name)}_Icon.webp`,
                          }}
                          style={[styles.itemImage, { backgroundColor: hasItem.type === 'p' ? '#FFCC00' : '' }]}
                        />
                        <Text style={styles.names}>
                          {hasItem.name || ''}{hasItem.type === 'p' ? ' (P)' : ''}
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
                      <View key={`${wantitem.name}-${wantitem.type}`} style={{ justifyContent: 'center', alignItems: 'center' }}>
                        <Image
                          source={{
                            uri: wantitem.type === 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(wantitem.name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(wantitem.name)}_Icon.webp`,
                          }}
                          style={[styles.itemImage, { backgroundColor: wantitem.type === 'p' ? '#FFCC00' : '' }]}
                        />
                        <Text style={styles.names}>
                          {wantitem.name || ''}{wantitem.type === 'p' ? ' (P)' : ''}
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
              </View>
            )}

            {messages.length === 0 ? (
              loading ? (
                <ActivityIndicator
                  size="large"
                  color="#1E88E5"
                  style={{ flex: 1, justifyContent: 'center' }}
                />
              ) : (
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
                selectedUser={currentSelectedUser}
                user={user}
                isAdmin={isAdmin}
                onReply={(message) => setReplyTo(message)}
                onDeleteMessage={handleDeleteMessage}
                onDeleteAllChat={handleDeleteAllChat}
                canRate={canRate}
                hasRated={hasRated}
                setShowRatingModal={setShowRatingModal}
                chatKey={chatKey}
                otherLastRead={otherLastRead}
              />
            )}

            {!localState.isPro && <BannerAdComponent />}

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

            <Text style={{ fontSize: 16, marginBottom: 10, textAlign: 'center', fontWeight: '600' }}>
              Rate this Trader
            </Text>

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
                {!startRating ? 'Submit Rating' : 'Submitting'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={closeProfileDrawer}
        startChat={() => { }}
        selectedUser={currentSelectedUser}
        isOnline={isOnline}
        bannedUsers={bannedUsers}
        fromPvtChat={true}
      />
    </>
  );
};

export default PrivateChatScreen;
