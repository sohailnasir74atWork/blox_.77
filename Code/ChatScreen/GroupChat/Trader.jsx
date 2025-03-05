import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
import { AdEventType, BannerAd, BannerAdSize, InterstitialAd } from 'react-native-google-mobile-ads';
import getAdUnitId, { developmentMode } from '../../Ads/ads';
import { banUser, isUserOnline, makeAdmin, removeAdmin, unbanUser } from '../utils';
import { useNavigation } from '@react-navigation/native';
import ProfileBottomDrawer from './BottomDrawer';
import leoProfanity from 'leo-profanity';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useLocalState } from '../../LocalGlobelStats';
import { ref } from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';
import { logEvent } from '@react-native-firebase/analytics';
leoProfanity.add(['hell', 'shit']);
leoProfanity.loadDictionary('en');

const bannerAdUnitId = getAdUnitId('banner');
const interstitialAdUnitId = getAdUnitId('interstitial');
const interstitial = InterstitialAd.createForAdRequest(interstitialAdUnitId);


const ChatScreen = ({ selectedTheme, bannedUsers, modalVisibleChatinfo, setChatFocused,
  setModalVisibleChatinfo, unreadMessagesCount, fetchChats, unreadcount, setunreadcount }) => {
  const { user, theme, onlineMembersCount, appdatabase, analytics } = useGlobalState();
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
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isShowingAd, setIsShowingAd] = useState(false);
  const { localState } = useLocalState()
  const { t } = useTranslation();
  const platform = Platform.OS.toLowerCase();




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
    showInterstitialAd(() => {
      toggleDrawer();
      navigation.navigate('PrivateChat', { selectedUser, selectedTheme });

    })

  };

  const chatRef = useMemo(() => ref(appdatabase, 'chat_new'), []);
  const pinnedMessagesRef = useMemo(() => ref(appdatabase, 'pin_messages'), []);

  // const isAdmin = user?.admin || false;
  // const isOwner = user?.owner || false;
  const styles = useMemo(() => getStyles(theme === 'dark'), [theme]);




  const validateMessage = useCallback((message) => {
    const hasText = message?.text?.trim();
    return {
      ...message,
      sender: message.sender?.trim() || 'Anonymous',
      text: hasText || '[No content]',
      timestamp: hasText ? message.timestamp || Date.now() : Date.now() - 1 * 24 * 60 * 60 * 1000,
    };
  }, []);

  const loadMessages = useCallback(
    async (reset = false) => {
      try {
        if (reset) {
          // console.log('Resetting messages and loading the latest ones.');
          setLoading(true);
          setLastLoadedKey(null); // Reset pagination key
        }

        // console.log(`Fetching messages. Reset: ${reset}, LastLoadedKey: ${lastLoadedKey}`);

        const messageQuery = reset
          ? chatRef.orderByKey().limitToLast(PAGE_SIZE)
          : chatRef.orderByKey().endAt(lastLoadedKey).limitToLast(PAGE_SIZE);

        const snapshot = await messageQuery.once('value');
        const data = snapshot.val() || {};

        // if (developmentMode) {
        //   const dataSize = JSON.stringify(data).length / 1024;
        //   console.log(`🚀 Downloaded group chat data: ${dataSize.toFixed(2)} KB from load messages`);
        // }

        // console.log(`Fetched ${Object.keys(data).length} messages from Firebase.`);

        // const bannedUserIds = bannedUsers?.map((user) => user.id) || [];
        // console.log('Banned User IDs:', bannedUserIds);

        const parsedMessages = Object.entries(data)
          .map(([key, value]) => validateMessage({ id: key, ...value }))
          .filter((msg) => !bannedUsers.includes(msg.senderId))
          .sort((a, b) => b.timestamp - a.timestamp); // Descending order

        // console.log('Parsed Messages:', parsedMessages);

        if (parsedMessages.length === 0 && !reset) {
          // console.log('No more messages to load.');
          setLastLoadedKey(null);
          return;
        }

        if (reset) {
          setMessages(parsedMessages);
          // console.log('Resetting messages:', parsedMessages);
        } else {
          setMessages((prev) => [...prev, ...parsedMessages]);
          // console.log('Appending messages:', parsedMessages);
        }

        if (parsedMessages.length > 0) {
          // Use the last key from the newly fetched messages
          setLastLoadedKey(parsedMessages[parsedMessages.length - 1].id);
          // console.log('Updated LastLoadedKey:', parsedMessages[parsedMessages.length - 1].id);
        }
      } catch (error) {
        // console.error('Error loading messages:', error);
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
  }, []);

  // const bannedUserIds = bannedUsers.map((user) => user.id); // Extract IDs from bannedUsers

  useEffect(() => {
    const listener = chatRef.limitToLast(1).on('child_added', (snapshot) => {
      const newMessage = validateMessage({ id: snapshot.key, ...snapshot.val() })
      if (developmentMode) {
        const newMessageSize = JSON.stringify(newMessage).length / 1024;
        console.log(`🚀 Downloaded data: ${newMessageSize.toFixed(2)} KB from NEW MESSAGE`);
      }

      setMessages((prev) => {
        const seenKeys = new Set(prev.map((msg) => msg.id));

        if (!seenKeys.has(newMessage.id)) {
          return [newMessage, ...prev]; // Ensure no duplicates
        }
        return prev;
      });
    });

    return () => {
      chatRef.off('child_added'); // ✅ Correct cleanup
    };
  }, [chatRef]);




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



  // useEffect(() => {
  //   const loadPinnedMessages = async () => {
  //     try {
  //       const snapshot = await pinnedMessagesRef.once('value');
  //       if (snapshot.exists()) {
  //         const data = snapshot.val();
  //         if (developmentMode) {
  //           const dataSize = JSON.stringify(data).length / 1024;
  //           console.log(`🚀 Downloaded group chat data: ${dataSize.toFixed(2)} KB from pin messages`);
  //         }
  //         const parsedPinnedMessages = Object.entries(data).map(([key, value]) => ({
  //           firebaseKey: key, // Use the actual Firebase key here
  //           ...value,
  //         }));
  //         setPinnedMessages(parsedPinnedMessages); // Store the parsed messages with the Firebase key
  //       } else {
  //         setPinnedMessages([]); // No pinned messages
  //       }
  //     } catch (error) {
  //       console.error('Error loading pinned messages:', error);
  //       Alert.alert(t('home.alert.error'), 'Could not load pinned messages. Please try again.');
  //     }
  //   };

  //   loadPinnedMessages();
  // }, [pinnedMessagesRef]);





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

  useEffect(() => {
    interstitial.load();

    const onAdLoaded = () => setIsAdLoaded(true);
    const onAdClosed = () => {
      setIsAdLoaded(false);
      setIsShowingAd(false);
      interstitial.load(); // Reload ad for the next use
    };
    const onAdError = (error) => {
      setIsAdLoaded(false);
      setIsShowingAd(false);
      console.error('Ad Error:', error);
    };

    const loadedListener = interstitial.addAdEventListener(AdEventType.LOADED, onAdLoaded);
    const closedListener = interstitial.addAdEventListener(AdEventType.CLOSED, onAdClosed);
    const errorListener = interstitial.addAdEventListener(AdEventType.ERROR, onAdError);

    return () => {
      loadedListener();
      closedListener();
      errorListener();
    };
  }, []);

  const showInterstitialAd = (callback) => {
    if (isAdLoaded && !isShowingAd && !localState.isPro) {
      setIsShowingAd(true);
      try {
        interstitial.show();
        interstitial.addAdEventListener(AdEventType.CLOSED, callback);
      } catch (error) {
        console.error('Error showing interstitial ad:', error);
        setIsShowingAd(false);
        callback(); // Proceed with fallback in case of error
      }
    } else {
      callback(); // If ad is not loaded, proceed immediately
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadMessages(true);
    setRefreshing(false);
    // fetchChats()
  };

  const handleSendMessage = () => {
    const MAX_WORDS = 100;
    const MESSAGE_COOLDOWN = 1000;
    const LINK_REGEX = /(https?:\/\/[^\s]+)/g;

    // console.log("handleSendMessage triggered", input);

    if (!user?.id) {
      // Alert.alert(t('home.alert.error'), 'You must be logged in to send messages.');
      return;
    }

    if (user?.isBlock) {
      Alert.alert('You are blocked by an Admin');
      return;
    }
    const trimmedInput = input.trim();

    if (!trimmedInput) {
      Alert.alert(t('home.alert.error'), 'Message cannot be empty.');
      return;
    }

    // Check for profane content
    if (leoProfanity.check(trimmedInput)) {
      Alert.alert(t('home.alert.error'), t('misc.inappropriateLanguage'));
      return;
    }

    // 🛠️ Fix: Ensure word count is accurate
    const wordCount = trimmedInput.split(/\s+/).filter(word => word.length > 0).length;
    // console.log(`Word Count: ${wordCount}, Max Allowed: ${MAX_WORDS}`);

    if (wordCount > MAX_WORDS) {
      Alert.alert(
        t('home.alert.error'),
        t('misc.messageTooLong')
      );
      return;
    }

    if (isCooldown) {
      Alert.alert(t('home.alert.error'), t('misc.sendingTooQuickly'));
      return;
    }

    // 🔍 Check if the message contains a link
    const containsLink = LINK_REGEX.test(trimmedInput);

    if (containsLink && !localState?.isPro) {
      Alert.alert(t('home.alert.error'), t('misc.proUsersOnlyLinks'));
      return;
    }

    try {
      const newMessage = {
        text: trimmedInput,
        timestamp: Date.now(),
        sender: user.displayName || 'Anonymous',
        senderId: user.id,
        avatar: user.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
        replyTo: replyTo ? { id: replyTo.id, text: replyTo.text } : null,
        // isAdmin: user.admin || user.owner,
        reportCount: 0,
        containsLink: containsLink,
        isPro: localState.isPro
      };

      // Push the message to Firebase
      ref(appdatabase, 'chat_new').push(newMessage);

      // Clear the input and reply context
      setInput('');
      setReplyTo(null);

      // Activate the cooldown
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
                isDarkMode={theme === 'dark'}
                onPinMessage={handlePinMessage}
                onDeleteMessage={(messageId) => chatRef.child(messageId.replace('chat_new-', '')).remove()}
                // isAdmin={isAdmin}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                handleLoadMore={handleLoadMore}
                onReply={(message) => { setReplyTo(message); triggerHapticFeedback('impactLight'); }} // Pass selected message to MessageInput
                banUser={banUser}
                makeadmin={makeAdmin}
                // onReport={onReport}
                removeAdmin={removeAdmin}
                unbanUser={unbanUser}
                // isOwner={isOwner}
                toggleDrawer={toggleDrawer}
                setMessages={setMessages}
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
              />
            ) : (
              <TouchableOpacity
                style={styles.login}
                onPress={() => {
                  setIsSigninDrawerVisible(true); triggerHapticFeedback('impactLight'); logEvent(analytics, `${platform}_signin_from_group_chat`);
                }}
              >
                <Text style={styles.loginText}>{t('misc.loginToStartChat')}</Text>
              </TouchableOpacity>
            )}
          </ConditionalKeyboardWrapper>

          <SignInDrawer
            visible={isSigninDrawerVisible}
            onClose={() => setIsSigninDrawerVisible(false)}
            selectedTheme={selectedTheme}
            message={t('misc.loginRequired')}

          />
        </View>
        <ProfileBottomDrawer
          isVisible={isDrawerVisible}
          toggleModal={toggleDrawer}
          startChat={startPrivateChat}
          selectedUser={selectedUser}
          isOnline={isOnline}
          bannedUsers={bannedUsers}
          showInterstitialAd={showInterstitialAd}
        />
      </GestureHandlerRootView>

      {!localState.isPro && <View style={{ alignSelf: 'center' }}>
        {isAdVisible && (
          <BannerAd
            unitId={bannerAdUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            onAdLoaded={() => setIsAdVisible(true)}
            onAdFailedToLoad={() => setIsAdVisible(false)}
          />
        )}
      </View>}
    </>
  );
};

export default ChatScreen;
