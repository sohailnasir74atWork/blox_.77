import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  Text,
  Platform,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useGlobalState } from '../../GlobelStats';
import SignInDrawer from '../../Firebase/SigninDrawer';
import ChatHeaderContent from './ChatHeaderContent';
import MessagesList from './MessagesList';
import MessageInput from './MessageInput';
import { getStyles } from '../Style';
import getAdUnitId from '../../Ads/ads';
import { banUser, handleDeleteLast300Messages, isUserOnline,  unbanUser } from '../utils';
import { useIsFocused, useNavigation, useFocusEffect } from '@react-navigation/native';
import ProfileBottomDrawer from './BottomDrawer';
import leoProfanity from 'leo-profanity';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useLocalState } from '../../LocalGlobelStats';
import database, { onValue, ref, remove } from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';
import { mixpanel } from '../../AppHelper/MixPenel';
import InterstitialAdManager from '../../Ads/IntAd';
import BannerAdComponent from '../../Ads/bannerAds';
import { logoutUser } from '../../Firebase/UserLogics';
import { showMessage } from 'react-native-flash-message';
import PetModal from '../PrivateChat/PetsModel';

leoProfanity.add(['hell', 'shit']);
leoProfanity.loadDictionary('en');


const bannerAdUnitId = getAdUnitId('banner');
const ChatScreen = ({ selectedTheme, bannedUsers, modalVisibleChatinfo, setChatFocused,
  setModalVisibleChatinfo, unreadMessagesCount, unreadcount, setunreadcount, onlineUsersVisible, setOnlineUsersVisible }) => {
    const { user, theme, onlineMembersCount, appdatabase, setUser, isAdmin, proTagBought, currentUserEmail, proGranted, strikeInfo } = useGlobalState();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [lastLoadedKey, setLastLoadedKey] = useState(null);
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null); // Store the selected user's details
  const [isOnline, setIsOnline] = useState(false);
  const [isAdVisible, setIsAdVisible] = useState(true);
  const [isCooldown, setIsCooldown] = useState(false);
  const [signinMessage, setSigninMessage] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const { localState } = useLocalState()
  const { t } = useTranslation();
  const platform = Platform.OS.toLowerCase();
  const [pendingMessages, setPendingMessages] = useState([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isFocused = useIsFocused();
  const [selectedEmoji, setSelectedEmoji] = useState(null);
  const [petModalVisible, setPetModalVisible] = useState(false);
  const [selectedFruits, setSelectedFruits] = useState([]); 
  const [device, setDevice] = useState(null);

  // ✅ Track last sent message to prevent duplicates (session-based, no Firebase cost)
  const lastSentMessageRef = useRef(null);
  // ✅ OPTIMIZED: Track newest message to skip initial download in listener
  const newestMessageIdRef = useRef(null);
  const hasInitializedRef = useRef(false);

  const flatListRef = useRef();
  const gifAllowed = true; // Always allow GIFs/emojis

  const chatRef = useMemo(() => ref(appdatabase, 'chat_new'), []);
  const pinnedMessagesRef = useMemo(() => ref(appdatabase, 'pin_messages'), []);

  useEffect(() => {
    if (!pinnedMessagesRef) return;

    const fetchPinnedMessages = async () => {
      try {
        const snapshot = await pinnedMessagesRef.once('value');
        const pinnedMessagesData = snapshot.val() || {};
  
        // ✅ Safety check and transform data into an array
        const pinnedMessagesArray = Object.entries(pinnedMessagesData)
          .map(([key, value]) => {
            if (!key || !value || typeof value !== 'object') return null;
            return {
              firebaseKey: key,
              ...value,
            };
          })
          .filter(Boolean);
  
        setPinnedMessages(pinnedMessagesArray);
      } catch (error) {
        console.error('Error loading pinned messages:', error);
      }
    };
  
    fetchPinnedMessages();  // Fetch pinned messages initially
  
    // Listen to real-time updates on pinned messages
    const listener = pinnedMessagesRef.on('child_added', (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      const data = snapshot.val();
      if (!data || typeof data !== 'object') return;
      const newPinnedMessage = { firebaseKey: snapshot.key, ...data };
      setPinnedMessages((prev) => {
        // ✅ Prevent duplicates
        const exists = prev.some(msg => msg.firebaseKey === snapshot.key);
        return exists ? prev : [...prev, newPinnedMessage];
      });
    });
  
    return () => {
      if (pinnedMessagesRef) {
        pinnedMessagesRef.off('child_added', listener);
      }
    };
  }, []);
// ✅ Memoize openProfileDrawer
const openProfileDrawer = useCallback(async (userData) => {
  if (!userData || !userData.senderId) return;

  setSelectedUser(userData);
  setIsDrawerVisible(true);

  try {
    const online = await isUserOnline(userData.senderId);
    setIsOnline(online);
  } catch (error) {
    console.error('🔥 Error checking online status:', error);
    setIsOnline(false);
  }
}, []);

// ✅ Memoize closeProfileDrawer
const closeProfileDrawer = useCallback(() => {
  setIsDrawerVisible(false);
}, []);

  useEffect(() => {
    if (isAtBottom && pendingMessages.length > 0) {
      // console.log("✅ User scrolled to bottom. Releasing held messages...");
      setMessages((prev) => [...pendingMessages, ...prev]);
      setPendingMessages([]); // Clear the queue
    }
  }, [isAtBottom, pendingMessages]);


  const PAGE_SIZE = 20;

  const navigation = useNavigation()


// ✅ Memoize toggleDrawer
const toggleDrawer = useCallback(async (userData = null) => {
  setSelectedUser(userData);
  setIsDrawerVisible((prev) => !prev);

  if (userData?.senderId) {
    try {
      const online = await isUserOnline(userData.senderId);
      setIsOnline(online);
    } catch (error) {
      console.error("🔥 Error checking online status:", error);
      setIsOnline(false);
    }
  } else {
    setIsOnline(false);
  }
}, []);

// ✅ Memoize startPrivateChat
const startPrivateChat = useCallback(() => {
  const callbackfunction = () => {
    closeProfileDrawer();
    if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate('PrivateChat', { selectedUser, selectedTheme });
    }
    mixpanel.track("Inbox Chat");
  };
  callbackfunction();
}, [selectedUser, selectedTheme,  closeProfileDrawer]);


  // const isAdmin = user?.admin || false;
  // const isOwner = user?.owner || false;
  const styles = useMemo(() => getStyles(theme === 'dark'), [theme]);

  const validateMessage = useCallback((message) => {
    const text = (message?.text ?? "").toString();
    const trimmed = text.trim();
  
    const hasFruits = Array.isArray(message?.fruits) && message.fruits.length > 0;
    const hasGif = !!message?.gif;
  
    const hasContent = trimmed.length > 0 || hasFruits || hasGif;
  
    return {
      ...message,
      sender: (message?.sender ?? "Anonymous").toString().trim() || "Anonymous",
      text: trimmed, // keep trimmed text, but don't force empty for fruits-only
      // ✅ do NOT invent fake timestamps
      timestamp:
        typeof message?.timestamp === "number"
          ? message.timestamp
          : Date.now(), // fallback only if missing
      // Optional: if message is truly empty (shouldn't exist), mark it
      _invalid: !hasContent,
    };
  }, []);
  
  

  const loadMessages = useCallback(
    async (reset = false) => {
      try {
        if (reset) {
          // console.log('[loadMessages] Resetting messages...');
          setLoading(true);
          setLastLoadedKey(null);
        }
  
        // console.log(`[loadMessages] Fetching messages... reset: ${reset}, lastLoadedKey: ${lastLoadedKey}`);
  
        const messageQuery = reset
          ? chatRef.orderByKey().limitToLast(PAGE_SIZE)
          : chatRef.orderByKey().endAt(lastLoadedKey).limitToLast(PAGE_SIZE);
  
        const snapshot = await messageQuery.once('value');
        const data = snapshot.val() || {};
  
        // ✅ Safety check for bannedUsers array
        const bannedIds = Array.isArray(bannedUsers)
        ? bannedUsers.map(u => (typeof u === "string" ? u : u?.id)).filter(Boolean)
        : [];
                const parsedMessages = Object.entries(data)
          .map(([key, value]) => {
            if (!key || !value || typeof value !== 'object') return null;
            return validateMessage({ id: key, ...value });
          })
          .filter(Boolean)
          .filter(msg => msg?.senderId && !bannedIds.includes(msg.senderId)).sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
  
        if (!reset && parsedMessages[parsedMessages.length - 1]?.id === lastLoadedKey) {
          // console.log(`[loadMessages] Removing duplicate key: ${lastLoadedKey}`);
          parsedMessages.pop();
        }
  
        if (parsedMessages.length === 0) {
          // console.log('[loadMessages] Reached end of messages, not loading more.');
          return;
        }
  
        if (reset) {
          setMessages(parsedMessages);
          // console.log(`[loadMessages] Loaded ${parsedMessages.length} messages (reset)`);
        } else {
          setMessages((prev) => [...prev, ...parsedMessages]);
          // console.log(`[loadMessages] Appending ${parsedMessages.length} messages`);
        }
  
        const newLastKey = parsedMessages[parsedMessages.length - 1]?.id;
  
        if (newLastKey === lastLoadedKey) {
          // console.log(`[loadMessages] Reached end of list or same key: ${lastLoadedKey}`);
          return;
        }
  
        setLastLoadedKey(newLastKey);
        // console.log(`[loadMessages] New lastLoadedKey: ${newLastKey}`);
      } catch (error) {
        console.error('[loadMessages] Error loading messages:', error);
      } finally {
        if (reset) setLoading(false);
      }
    },
    [chatRef, lastLoadedKey, validateMessage, bannedUsers, appdatabase]
  );
  

  useEffect(() => {
    const platform = Platform.OS; // "ios" or "android"
  
    // console.log('Initial loading of messages.');
    loadMessages(true); // Reset and load the latest messages
    if (setChatFocused && typeof setChatFocused === 'function') {
      setChatFocused(false);
    }
    setDevice(platform);
  }, [ setChatFocused]);

  // const bannedUserIds = bannedUsers.map((user) => user.id); // Extract IDs from bannedUsers

  // ✅ OPTIMIZED: Skip initial data download in listener to reduce wildcard downloads
  useEffect(() => {
    if (!isFocused || !chatRef) return;

    let listener = null;
    let initialLoadQuery = null;

    const initializeListener = async () => {
      try {
        // Step 1: Get only the latest message KEY (minimal download)
        initialLoadQuery = chatRef.orderByKey().limitToLast(1);
        const initialSnapshot = await initialLoadQuery.once('value');
        
        if (initialSnapshot.exists()) {
          const data = initialSnapshot.val();
          const keys = Object.keys(data);
          if (keys.length > 0) {
            newestMessageIdRef.current = keys[0];
          }
        }
        
        hasInitializedRef.current = true;

        // Step 2: Listen for NEW messages only (skips initial data)
        const newMessagesQuery = chatRef.orderByKey().limitToLast(1);
        
        listener = newMessagesQuery.on('child_added', (snapshot) => {
          if (!snapshot || !snapshot.key) return;
          
          // ✅ Skip if this is the message we already loaded during initialization
          if (hasInitializedRef.current && snapshot.key === newestMessageIdRef.current) {
            return; // Skip initial message
          }
          
          // Update newest message ID for future skips
          newestMessageIdRef.current = snapshot.key;

          const data = snapshot.val();
          if (!data || typeof data !== 'object') return;

          const newMessage = validateMessage({ id: snapshot.key, ...data });
          if (!newMessage || !newMessage.id) return;

          // ✅ Check if message is from banned user
          const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
          if (banned.includes(newMessage.senderId)) return;

          setMessages((prev) => {
            if (!Array.isArray(prev)) return [newMessage];
            const seenKeys = new Set(prev.map((msg) => msg?.id).filter(Boolean));
            if (seenKeys.has(newMessage.id)) return prev;

            if (isAtBottom) {
              // Insert immediately
              // console.log("📥 User is at bottom, adding message now");
              return [newMessage, ...prev];
            } else {
              // Hold in pending
              // console.log("⏳ Holding new message, user not at bottom");
              setPendingMessages((prevPending) => {
                const pendingIds = new Set(prevPending.map((msg) => msg?.id).filter(Boolean));
                if (pendingIds.has(newMessage.id)) return prevPending;
                return [newMessage, ...prevPending];
              });
              return prev;
            }
          });
        });
      } catch (error) {
        console.error('Error initializing chat listener:', error);
        // Fallback to original listener if initialization fails
        listener = chatRef.limitToLast(1).on('child_added', (snapshot) => {
          if (!snapshot || !snapshot.key) return;
          const data = snapshot.val();
          if (!data || typeof data !== 'object') return;
          const newMessage = validateMessage({ id: snapshot.key, ...data });
          if (!newMessage || !newMessage.id) return;
          const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
          if (banned.includes(newMessage.senderId)) return;
          setMessages((prev) => {
            if (!Array.isArray(prev)) return [newMessage];
            const seenKeys = new Set(prev.map((msg) => msg?.id).filter(Boolean));
            if (seenKeys.has(newMessage.id)) return prev;
            if (isAtBottom) {
              return [newMessage, ...prev];
            } else {
              setPendingMessages((prevPending) => {
                const pendingIds = new Set(prevPending.map((msg) => msg?.id).filter(Boolean));
                if (pendingIds.has(newMessage.id)) return prevPending;
                return [newMessage, ...prevPending];
              });
              return prev;
            }
          });
        });
      }
    };

    initializeListener();

    return () => {
      if (listener && chatRef) {
        chatRef.off('child_added', listener);
      }
      if (initialLoadQuery) {
        initialLoadQuery.off('value');
      }
      hasInitializedRef.current = false;
    };
  }, [chatRef, validateMessage, isAtBottom, isFocused, bannedUsers]);
  





  const handleLoadMore = useCallback(async () => {
    // ✅ Fixed: use && instead of &
    if (!user?.id && !signinMessage) {
      Alert.alert(
        t('misc.loginToStartChat'),
        t('misc.loginRequired'),
        [{ text: 'OK', onPress: () => setIsSigninDrawerVisible(true) }]
      );
      setSigninMessage(true);
      return;
    }

    if (!loading && lastLoadedKey) {
      await loadMessages(false);
    } else {
      // console.log('No more messages to load or currently loading.');
    }
  }, [user?.id, signinMessage, loading, lastLoadedKey, loadMessages, t]);





  const handlePinMessage = async (message) => {
    try {
      const pinnedMessage = { ...message, pinnedAt: Date.now() };
      const newRef = await pinnedMessagesRef.push(pinnedMessage);

      // Use the Firebase key for tracking the message
      setPinnedMessages((prev) => [
        ...prev,
        { firebaseKey: newRef.key, ...pinnedMessage },
      ]);
      // console.log('Pinned message added with firebaseKey:', newRef.key);
    } catch (error) {
      console.error('Error pinning message:', error);
      Alert.alert(t('home.alert.error'), 'Could not pin the message. Please try again.');
    }
  };



  const unpinSingleMessage = async (firebaseKey) => {
    try {
      // console.log(`Received firebaseKey for unpinning: ${firebaseKey}`);

      // Remove the message from Firebase
      const messageRef = pinnedMessagesRef.child(firebaseKey);
      // console.log(`Firebase reference for removal: ${messageRef.toString()}`);
      await messageRef.remove();
      // console.log(`Message with Firebase key: ${firebaseKey} successfully removed from Firebase.`);

      // Update the local state by filtering out the removed message
      setPinnedMessages((prev) => {
        const updatedMessages = prev.filter((msg) => msg.firebaseKey !== firebaseKey);
        // console.log('Updated pinned messages after removal:', updatedMessages);
        return updatedMessages;
      });
    } catch (error) {
      console.error('Error unpinning message:', error);
      Alert.alert(t('home.alert.error'), 'Could not unpin the message. Please try again.');
    }
  };




  const clearAllPinnedMessages = async () => {
    try {
      await pinnedMessagesRef.remove();
      setPinnedMessages([]);
    } catch (error) {
      console.error('Error clearing pinned messages:', error);
      Alert.alert(t('home.alert.error'), 'Could not clear pinned messages. Please try again.');
    }
  };

  const handleLoginSuccess = () => {
    setIsSigninDrawerVisible(false);
  };


  useEffect(() => {
    if (!user?.id) return;

    const userRef = ref(appdatabase, `users/${user.id}/isBlock`);

    const unsubscribe = userRef.on('value', (snapshot) => {
      const isBlocked = snapshot.val();
      if (isBlocked === true) {
        Alert.alert(
          '🚫 Blocked',
          'You have been blocked by the admin. Logging you out.',
          [{
            text: 'OK', onPress: () => {
              logoutUser(setUser)
            }
          }]
        );
      }
    });

    return () => {
      userRef.off('value', unsubscribe);
    };
  }, [user?.id]);


  const handleRefresh = async () => {
    setRefreshing(true);
    await loadMessages(true);
    setRefreshing(false);
    // fetchChats()
  };

const handleSendMessage = async (replyToArg, trimmedInputArg, fruits, emojiUrl) => {
  const hasEmoji  = !!emojiUrl;

  // console.log(emojiUrl)
  const hasFruits = Array.isArray(fruits) && fruits.length > 0;

  const MAX_CHARACTERS = 250;
  const MESSAGE_COOLDOWN = 100; // ms
  const LINK_REGEX = /(https?:\/\/[^\s]+)/i; // no "g" flag
    if (!user?.id || !currentUserEmail) {
      showMessage({
        message: 'You are not loggedin',
        description: 'You must be logged in to send Messages',
        type: 'danger',
      });
      return;

    }

    // ✅ Admins are exempt from blocking
    if (strikeInfo && !isAdmin) {
      const { strikeCount, bannedUntil } = strikeInfo;
      const now = Date.now();

      if (bannedUntil === 'permanent') {
        showMessage({
          message: '⛔ Permanently Banned',
          description: 'You are permanently banned from sending messages.',
          type: 'danger',
        });
        return;
      }

      if (typeof bannedUntil === 'number' && now < bannedUntil) {
        const totalMinutes = Math.ceil((bannedUntil - now) / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        showMessage({
          message: `⚠️ Strike ${strikeCount}`,
          description: `You are banned from chatting for ${timeLeftText} more minute(s).`,
          type: 'warning',
          duration: 5000,

        });
        return;
      }
    }
  // Use the argument, not external state
  const trimmedInput = (trimmedInputArg || '').trim();

  // ✅ Validate fruits count - maximum 18 fruits allowed
  if (hasFruits && fruits.length > 18) {
    Alert.alert(t('home.alert.error'), 'You can only send up to 18 pets in a message.');
    return;
  }

  // Disallow empty text + no fruits
  if (!trimmedInput && !hasFruits && !emojiUrl) {
    Alert.alert(t('home.alert.error'), 'Message cannot be empty.');
    return;
  }

  // Profanity check
  if (trimmedInput && leoProfanity.check(trimmedInput)) {
    Alert.alert(t('home.alert.error'), t('misc.inappropriateLanguage'));
    return;
  }

  // Length check
  if (trimmedInput.length > MAX_CHARACTERS) {
    Alert.alert(t('home.alert.error'), t('misc.messageTooLong'));
    return;
  }

  // Cooldown check
  if (isCooldown) {
    Alert.alert(t('home.alert.error'), t('misc.sendingTooQuickly'));
    return;
  }

  // ✅ Duplicate message check - prevent copy-paste spam (no Firebase cost, client-side only)
  const currentMessage = {
    text: trimmedInput,
    fruits: hasFruits ? JSON.stringify(fruits.sort((a, b) => (a?.id || '').localeCompare(b?.id || ''))) : null,
    emoji: emojiUrl || null,
  };
  
  if (lastSentMessageRef.current) {
    const lastMessage = lastSentMessageRef.current;
    const isDuplicate = 
      lastMessage.text === currentMessage.text &&
      lastMessage.fruits === currentMessage.fruits &&
      lastMessage.emoji === currentMessage.emoji;
    
    if (isDuplicate) {
      Alert.alert(
        t('home.alert.error'),
        'You cannot send the same message twice. Please modify your message.',
      );
      return;
    }
  }

  // Link check - disallow links for all users
  const containsLink = trimmedInput ? LINK_REGEX.test(trimmedInput) : false;
  if (containsLink) {
    Alert.alert(t('home.alert.error'), 'Links are not allowed in messages.');
    return;
  }

  try {
    // ✅ Use chatRef instead of creating new ref
    if (!chatRef) {
      console.error('❌ Chat ref not available');
      return;
    }

    // Push to Firebase Realtime Database
    const now = Date.now();
    const hasRecentWin =
      typeof user?.lastGameWinAt === 'number' &&
      now - user.lastGameWinAt <= 24 * 60 * 60 * 1000; // last win within 24h

    await chatRef.push({
      text: trimmedInput || null, // allow fruits-only messages
      timestamp: database.ServerValue.TIMESTAMP,
      sender: user.displayName || 'Anonymous',
      senderId: user.id,
      avatar:
        user.avatar ||
        'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
      flage: user?.flage || null, // ✅ Include flag/flag emoji
      replyTo: replyToArg
        ? { id: replyToArg.id, text: replyToArg.text }
        : null,
      reportCount: 0,
      isPro: !!localState?.isPro,
      isAdmin: !!isAdmin,
      strikeCount: strikeInfo?.strikeCount ?? null,
      fruits: hasFruits ? fruits : [],
      gif: hasEmoji ? emojiUrl : null,
      OS: Platform.OS, // ✅ Store platform (Android/iOS) - only visible to admins
      robloxUsernameVerified: user?.robloxUsernameVerified || false,
      hasRecentGameWin: hasRecentWin,
      lastGameWinAt: user?.lastGameWinAt || null,
    });

    // ✅ Store last sent message to prevent duplicates (session-based, no Firebase cost)
    lastSentMessageRef.current = currentMessage;

    // Reset local input state
    setInput('');
    setReplyTo(null);

    // Start cooldown
    setIsCooldown(true);
    setTimeout(() => setIsCooldown(false), MESSAGE_COOLDOWN);
  } catch (error) {
    console.error('Error sending message:', error);
    Alert.alert(
      t('home.alert.error'),
      'Could not send your message. Please try again.',
    );
  }
};

  // console.log(user.flage)
  return (
    <>
      <GestureHandlerRootView>

        <View style={styles.container}>
          <ChatHeaderContent
            pinnedMessages={pinnedMessages}
            onUnpinMessage={unpinSingleMessage}
            selectedTheme={selectedTheme}
            modalVisibleChatinfo={modalVisibleChatinfo}
            setModalVisibleChatinfo={setModalVisibleChatinfo}
            triggerHapticFeedback={triggerHapticFeedback}
            onlineUsersVisible={onlineUsersVisible}
            setOnlineUsersVisible={setOnlineUsersVisible}
          />

          <ConditionalKeyboardWrapper style={{ flex: 1 }} chatscreen={true}>
            {loading ? (
              <ActivityIndicator size="large" color="#1E88E5" style={{ flex: 1 }} />
            ) : (
              <MessagesList
                messages={messages}
                user={user}
                flatListRef={flatListRef}
                isDarkMode={theme === 'dark'}
                onPinMessage={handlePinMessage}
                onDeleteMessage={(messageId) => chatRef.child(messageId.replace('chat_new-', '')).remove()}
                // isAdmin={isAdmin}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                handleLoadMore={handleLoadMore}
                onReply={(message) => { setReplyTo(message); triggerHapticFeedback('impactLight'); }} // Pass selected message to MessageInput
                onDeleteAllMessage={(senderId) => handleDeleteLast300Messages(senderId)}
                banUser={banUser}
                // makeadmin={makeAdmin}
                // onReport={onReport}
                // removeAdmin={removeAdmin}
                unbanUser={unbanUser}
                // isOwner={isOwner}
                isAtBottom={isAtBottom}
                setIsAtBottom={setIsAtBottom}
                // toggleDrawer={toggleDrawer}
                setMessages={setMessages}
                isAdmin={isAdmin}
                toggleDrawer={openProfileDrawer}
                
              />
            )}
                 

            {user.id ? (
              <MessageInput
                input={input}
                setInput={setInput}
                handleSendMessage={handleSendMessage}
                selectedTheme={selectedTheme}
                replyTo={replyTo} // Pass reply context to MessageInput
                onCancelReply={() => setReplyTo(null)} // Clear reply context
                petModalVisible={petModalVisible}
                setPetModalVisible={setPetModalVisible}
                selectedFruits={selectedFruits}
                setSelectedFruits={setSelectedFruits}
                gifAllowed={gifAllowed}
                selectedEmoji={selectedEmoji}
                setSelectedEmoji={setSelectedEmoji}
              />
            ) : (
              <TouchableOpacity
                style={styles.login}
                onPress={() => {
                  setIsSigninDrawerVisible(true); triggerHapticFeedback('impactLight');
                }}
              >
                <Text style={styles.loginText}>{t('misc.loginToStartChat')}</Text>
              </TouchableOpacity>
            )}
             {(!localState.isPro && !proGranted) && <BannerAdComponent />}
             <PetModal
               fromChat={true}
      visible={petModalVisible}
      onClose={() => setPetModalVisible(false)}
        selectedFruits={selectedFruits}
        setSelectedFruits={setSelectedFruits}



      
    />
          </ConditionalKeyboardWrapper>

          <SignInDrawer
            visible={isSigninDrawerVisible}
            onClose={handleLoginSuccess}
            selectedTheme={selectedTheme}
            message={t('misc.loginRequired')}
            screen='Chat'

          />
        </View>
        <ProfileBottomDrawer
          isVisible={isDrawerVisible}
          toggleModal={closeProfileDrawer}  
          startChat={startPrivateChat}
          selectedUser={selectedUser}
          isOnline={isOnline}
          bannedUsers={bannedUsers}
        />
      </GestureHandlerRootView>

      {/* {(!localState.isPro || !proGranted) && <View style={{ alignSelf: 'center' }}>
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

export default ChatScreen;
