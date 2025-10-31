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
import AdminHeader from './AdminHeader';
import MessagesList from './MessagesList';
import MessageInput from './MessageInput';
import { getStyles } from '../Style';
import getAdUnitId from '../../Ads/ads';
import { banUser, handleDeleteLast300Messages, isUserOnline,  unbanUser } from '../utils';import { useIsFocused, useNavigation } from '@react-navigation/native';
import ProfileBottomDrawer from './BottomDrawer';
import leoProfanity from 'leo-profanity';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useLocalState } from '../../LocalGlobelStats';
import database, { onValue, ref } from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';
import { mixpanel } from '../../AppHelper/MixPenel';
import InterstitialAdManager from '../../Ads/IntAd';
import BannerAdComponent from '../../Ads/bannerAds';
import { logoutUser } from '../../Firebase/UserLogics';
import { showMessage } from 'react-native-flash-message';
leoProfanity.add(['hell', 'shit']);
leoProfanity.loadDictionary('en');


const bannerAdUnitId = getAdUnitId('banner');
const ChatScreen = ({ selectedTheme, bannedUsers, modalVisibleChatinfo, setChatFocused,
  setModalVisibleChatinfo, unreadMessagesCount, fetchChats, unreadcount, setunreadcount }) => {
    const { user, theme, onlineMembersCount, appdatabase, setUser, isAdmin, proTagBought, currentUserEmail, proGranted } = useGlobalState();
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
  const [strikeInfo, setStrikeInfo] = useState(null);



  const flatListRef = useRef();
  const gifAllowed = user?.purchases?.[11]?.title === "Chat Emoji";
  useEffect(() => {
    const fetchPinnedMessages = async () => {
      try {
        const snapshot = await pinnedMessagesRef.once('value');
        const pinnedMessagesData = snapshot.val() || {};
  
        // Transform data into an array and update pinned messages state
        const pinnedMessagesArray = Object.entries(pinnedMessagesData).map(([key, value]) => ({
          firebaseKey: key,
          ...value,
        }));
  
        setPinnedMessages(pinnedMessagesArray);
      } catch (error) {
        console.error('Error loading pinned messages:', error);
      }
    };
  
    fetchPinnedMessages();  // Fetch pinned messages initially
  
    // Listen to real-time updates on pinned messages
    const listener = pinnedMessagesRef.on('child_added', (snapshot) => {
      const newPinnedMessage = { firebaseKey: snapshot.key, ...snapshot.val() };
      setPinnedMessages((prev) => [...prev, newPinnedMessage]);
    });
  
    return () => pinnedMessagesRef.off('child_added', listener); // Cleanup listener
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


  const toggleDrawer = async (userData = null) => {
    setSelectedUser(userData);
    setIsDrawerVisible(!isDrawerVisible);

    if (userData?.id) {  // ✅ Ensure userData exists before checking
      try {
        const online = await isUserOnline(userData.senderId); // ✅ Await the async function
        // console.log('isUserOnline', online)
        setIsOnline(online);
      } catch (error) {
        console.error("🔥 Error checking online status:", error);
      }
    } else {
      setIsOnline(false); // ✅ Default to offline if no user data
    }
  };

  const startPrivateChat = () => {
    // console.log('clikcked')

    const callbackfunction = () => {
      toggleDrawer();
      navigation.navigate('PrivateChat', { selectedUser, selectedTheme });
      mixpanel.track("Inbox Chat");
    };
    if (!localState.isPro && !proGranted) { InterstitialAdManager.showAd(callbackfunction); }
    else { callbackfunction() }
  };

  const chatRef = useMemo(() => ref(appdatabase, 'chat_new'), []);
  const pinnedMessagesRef = useMemo(() => ref(appdatabase, 'pin_messages'), []);

  // const isAdmin = user?.admin || false;
  // const isOwner = user?.owner || false;
  const styles = useMemo(() => getStyles(theme === 'dark'), [theme]);


  useEffect(() => {
    if (!currentUserEmail) return;

    const encodedEmail = currentUserEmail.replace(/\./g, '(dot)');
    const banRef = ref(appdatabase, `banned_users_by_email/${encodedEmail}`);

    const unsubscribe = onValue(banRef, (snapshot) => {
      const banData = snapshot.val();
      setStrikeInfo(banData || null);
    });

    return () => unsubscribe();
  }, [currentUserEmail]);

  const validateMessage = useCallback((message) => {
    const hasText = !!message?.text?.trim();
    const hasGif  = !!message?.gif;
  
    // If no content at all → delete from DB and skip locally
    if (!hasText && !hasGif) {
      try {
        const sanitizedId = message?.id?.replace(/^chat_new-?/, '');
        if (sanitizedId) {
          remove(ref(appdatabase, `chat_new/${sanitizedId}`));
        }
      } catch (_) {}
      return null; // <-- drop this message in UI state
    }
  
    return {
      ...message,
      sender: message?.sender?.trim() || 'Anonymous',
      text: hasText ? message.text.trim() : '', // keep empty string for GIF-only messages
      timestamp: Number(message?.timestamp) || Date.now(), // or serverNow() if you prefer
      gif: message?.gif ?? null,
    };
  }, [appdatabase]);
  

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
  
        const parsedMessages = Object.entries(data)
        .map(([key, value]) => validateMessage({ id: key, ...value }))
        .filter(Boolean) // <-- drop nulls
        .filter((msg) => !bannedUsers.includes(msg.senderId))
        .sort((a, b) => b.timestamp - a.timestamp);
  
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
    [chatRef, lastLoadedKey, validateMessage, bannedUsers]
  );
  

  useEffect(() => {
    // console.log('Initial loading of messages.');
    loadMessages(true); // Reset and load the latest messages
    setChatFocused(false)
    // unbanUser("prNhc9QDnkXAF1caiFGmJwxu1N33")
  }, []);

  // const bannedUserIds = bannedUsers.map((user) => user.id); // Extract IDs from bannedUsers

  useEffect(() => {
    if(!isFocused) return
    const listener = chatRef.limitToLast(1).on('child_added', (snapshot) => {
      const newMessage = validateMessage({ id: snapshot.key, ...snapshot.val() });
      if (!newMessage) return; 

      setMessages((prev) => {
        const seenKeys = new Set(prev.map((msg) => msg.id));
        if (seenKeys.has(newMessage.id)) return prev;

        if (isAtBottom) {
          // Insert immediately
          // console.log("📥 User is at bottom, adding message now");
          return [newMessage, ...prev];
        } else {
          // Hold in pending
          // console.log("⏳ Holding new message, user not at bottom");
          setPendingMessages((prevPending) => [newMessage, ...prevPending]);
          return prev;
        }
      });
    });

    return () => chatRef.off('child_added', listener);
  }, [chatRef, validateMessage, isAtBottom, isFocused]);





  const handleLoadMore = async () => {
    if (!user.id & !signinMessage) {
      Alert.alert(
        t('misc.loginToStartChat'),
        t('misc.loginRequired'),
        [{ text: 'OK', onPress: () => setIsSigninDrawerVisible(true) }]
      );
      setSigninMessage(true)
      return;
    }

    if (!loading && lastLoadedKey) {
      await loadMessages(false);
    } else {
      // console.log('No more messages to load or currently loading.');
    }
  };





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

  const handleSendMessage = () => {
    const MAX_CHARACTERS = 250;
    const MESSAGE_COOLDOWN = 2000;
    const LINK_REGEX = /(https?:\/\/[^\s]+)/g;
    if (!user?.id || !currentUserEmail) {
      showMessage({
        message: 'You are not loggedin',
        description: 'You must be logged in to send Messages',
        type: 'danger',
      });
      return;

    }

    if (strikeInfo) {
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

    const trimmedInput = input.trim();
    if (!trimmedInput) {
      Alert.alert(t('home.alert.error'), 'Message cannot be empty.');
      return;
    }

    if (leoProfanity.check(trimmedInput)) {
      Alert.alert(t('home.alert.error'), t('misc.inappropriateLanguage'));
      return;
    }

    if (trimmedInput.length > MAX_CHARACTERS) {
      Alert.alert(t('home.alert.error'), t('misc.messageTooLong'));
      return;
    }

    if (isCooldown) {
      Alert.alert(t('home.alert.error'), t('misc.sendingTooQuickly'));
      return;
    }

    const containsLink = LINK_REGEX.test(trimmedInput);
    if (containsLink  && !isAdmin) {
      Alert.alert(t('home.alert.error'), t('misc.proUsersOnlyLinks'));
      return;
    }

    try {
      ref(appdatabase, 'chat_new').push({
        text: trimmedInput,
        timestamp: database.ServerValue.TIMESTAMP,
        sender: user.displayName || 'Anonymous',
        senderId: user.id,
        avatar: user.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
        replyTo: replyTo ? { id: replyTo.id, text: replyTo.text } : null,
        reportCount: 0,
        containsLink,
        isPro: localState.isPro,
        isAdmin: isAdmin,
        strikeCount: strikeInfo?.strikeCount || null,
        currentUserEmail: currentUserEmail

      });

      setInput('');
      setReplyTo(null);
      setIsCooldown(true);
      setTimeout(() => setIsCooldown(false), MESSAGE_COOLDOWN);
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert(t('home.alert.error'), 'Could not send your message. Please try again.');
    }
  };

  // console.log(isPro)
  return (
    <>
      <GestureHandlerRootView>

        <View style={styles.container}>
          <AdminHeader
           pinnedMessages={pinnedMessages}
           onClearPin={clearAllPinnedMessages}
           onUnpinMessage={unpinSingleMessage}
            // isAdmin={isAdmin}
            selectedTheme={selectedTheme}
            onlineMembersCount={onlineMembersCount}
            // isOwner={isOwner}
            modalVisibleChatinfo={modalVisibleChatinfo}
            setModalVisibleChatinfo={setModalVisibleChatinfo}
            triggerHapticFeedback={triggerHapticFeedback}
            unreadMessagesCount={unreadMessagesCount}
            unreadcount={unreadcount}
            setunreadcount={setunreadcount}
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
                toggleDrawer={toggleDrawer}
                setMessages={setMessages}

               
              />
            )}
                  {(!localState.isPro && !proGranted) && <BannerAdComponent />}

            {user.id ? (
              <MessageInput
                input={input}
                setInput={setInput}
                handleSendMessage={handleSendMessage}
                selectedTheme={selectedTheme}
                replyTo={replyTo} // Pass reply context to MessageInput
                onCancelReply={() => setReplyTo(null)} // Clear reply context
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
          toggleModal={toggleDrawer}
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
