import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  Text,
  Platform,
  ScrollView,
  StyleSheet as RNStyleSheet,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import SignInDrawer from '../../Firebase/SigninDrawer';
import ChatHeaderContent from './ChatHeaderContent';
import MessagesList from './MessagesList';
import MessageInput from './MessageInput';
import { getStyles } from '../Style';
import getAdUnitId from '../../Ads/ads';
import { banUser, handleDeleteLast300Messages, isUserOnline, unbanUser } from '../utils';
import { useIsFocused, useNavigation, useFocusEffect } from '@react-navigation/native';
import ProfileBottomDrawer from './BottomDrawer';
import leoProfanity from 'leo-profanity';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useLocalState } from '../../LocalGlobelStats';
import database, { onValue, ref, remove, get, query as dbQuery, orderByKey, limitToLast, endAt, onChildAdded, push, set, child, serverTimestamp } from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';
import { mixpanel } from '../../AppHelper/MixPenel';
import InterstitialAdManager from '../../Ads/IntAd';
import BannerAdComponent from '../../Ads/bannerAds';
import { logoutUser } from '../../Firebase/UserLogics';
import { showMessage } from 'react-native-flash-message';
import PetModal from '../PrivateChat/PetsModel';
import { getCachedProfile, getOrFetchProfile, seedCurrentUser, warmProfileCache } from '../../Helper/profileCache';
// getMyCosmetics no longer needed — cosmetics resolved from profileCache on render

leoProfanity.add(['hell', 'shit']);
leoProfanity.loadDictionary('en');

const CHANNELS = [
  // ── Core channels ──────────────────────────────────────────────────────────
  { id: 'chat', label: 'English', icon: 'handshake', path: 'chat_new_upgrade' },
  { id: 'raid', label: 'Raids', icon: 'bolt', path: 'chat_raid_upgrade' },
  { id: 'help', label: 'Help', icon: 'circle-question', path: 'chat_help_upgrade' },
  { id: 'playing', label: 'Playing', icon: 'gamepad', path: 'chat_playing_upgrade' },
  // ── Language channels ──────────────────────────────────────────────────────
  { id: 'es', label: '🇪🇸 Español', icon: 'globe', path: 'chat_es_upgrade' },
  { id: 'ar', label: '🇸🇦 Arabic', icon: 'globe', path: 'chat_ar_upgrade' },
  { id: 'pt', label: '🇧🇷 Português', icon: 'globe', path: 'chat_pt_upgrade' },
  { id: 'fr', label: '🇫🇷 Français', icon: 'globe', path: 'chat_fr_upgrade' },
  { id: 'de', label: '🇩🇪 Deutsch', icon: 'globe', path: 'chat_de_upgrade' },
  { id: 'tr', label: '🇹🇷 Türkçe', icon: 'globe', path: 'chat_tr_upgrade' },
  { id: 'ru', label: '🇷🇺 Русский', icon: 'globe', path: 'chat_ru_upgrade' },
  { id: 'id', label: '🇮🇩 Indonesia', icon: 'globe', path: 'chat_id_upgrade' },
  { id: 'ja', label: '🇯🇵 日本語', icon: 'globe', path: 'chat_ja_upgrade' },
  { id: 'ko', label: '🇰🇷 한국어', icon: 'globe', path: 'chat_ko_upgrade' },
  { id: 'ph', label: '🇵🇭 Filipino', icon: 'globe', path: 'chat_ph_upgrade' },
];

const bannerAdUnitId = getAdUnitId('banner');
const ChatScreen = ({ selectedTheme, bannedUsers, modalVisibleChatinfo, setChatFocused,
  setModalVisibleChatinfo, unreadMessagesCount, unreadcount, setunreadcount, onlineUsersVisible, setOnlineUsersVisible }) => {
  const { user, theme, onlineMembersCount, appdatabase, setUser, isAdmin, proTagBought, currentUserEmail, proGranted, strikeInfo, isBabyMod, isTrusted, isCMSR, isGrinder, isRaider } = useGlobalState();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedKey, setLastLoadedKey] = useState(null);
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null); // Store the selected user's details
  const [isOnline, setIsOnline] = useState(false);
  const [isAdVisible, setIsAdVisible] = useState(true);
  const [isCooldown, setIsCooldown] = useState(false);
  const cooldownEndRef = useRef(0);
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
  const [activeChannel, setActiveChannel] = useState(CHANNELS[0]); // ✅ Default to Trade Chat
  const [pinnedMessages, setPinnedMessages] = useState([]);

  // ✅ Track last sent message to prevent duplicates (session-based, no Firebase cost)
  const lastSentMessageRef = useRef(null);
  // ✅ OPTIMIZED: Track newest message to skip initial download in listener
  const newestMessageIdRef = useRef(null);
  const hasInitializedRef = useRef(false);

  const flatListRef = useRef();
  const gifAllowed = true; // Always allow GIFs/emojis

  const chatRef = useMemo(() => ref(appdatabase, activeChannel.path), [activeChannel.path]);
  const pinnedMessagesRef = useMemo(() => appdatabase ? ref(appdatabase, 'pin_messages') : null, [appdatabase]);

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

  // ✅ Ref to track isAtBottom without triggering re-renders in listener
  const isAtBottomRef = useRef(isAtBottom);

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
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
  }, [selectedUser, selectedTheme, closeProfileDrawer]);


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
      // ✅ Keep original sender if present (old format), leave undefined for slim messages
      // resolveProfile() in MessagesList handles the fallback: message → cache → default
      sender: message?.sender ? message.sender.toString().trim() : undefined,
      text: trimmed,
      timestamp:
        typeof message?.timestamp === "number"
          ? message.timestamp
          : Date.now(),
      _invalid: !hasContent,
    };
  }, []);



  const loadMessages = useCallback(
    async (reset = false, refOverride = null) => {
      const activeRef = refOverride || chatRef;
      try {
        if (reset) {
          // console.log('[loadMessages] Resetting messages...');
          setLoading(true);
          setLastLoadedKey(null);
        }

        // console.log(`[loadMessages] Fetching messages... reset: ${reset}, lastLoadedKey: ${lastLoadedKey}`);

        const messageQuery = reset
          ? dbQuery(activeRef, orderByKey(), limitToLast(PAGE_SIZE))
          : dbQuery(activeRef, orderByKey(), endAt(lastLoadedKey), limitToLast(PAGE_SIZE));

        const snapshot = await get(messageQuery);
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
          return;
        }

        // ✅ Warm profile cache before rendering so slim messages show correct names
        const senderIds = parsedMessages.map(m => m.senderId).filter(Boolean);
        await warmProfileCache(appdatabase, senderIds);

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


  // ✅ Initial setup (runs once on mount)
  useEffect(() => {
    if (setChatFocused && typeof setChatFocused === 'function') {
      setChatFocused(false);
    }
    setDevice(Platform.OS);
    // ✅ Seed current user's profile into cache so own slim messages render correctly
    if (user?.id) seedCurrentUser(user, localState, appdatabase);
  }, [setChatFocused]);

  // ✅ Channel switch handler — resets state for new channel
  const handleChannelSwitch = useCallback((channel) => {
    if (channel.id === activeChannel.id) return;
    setActiveChannel(channel);
    setMessages([]);
    setPendingMessages([]);
    setLastLoadedKey(null);
    setReplyTo(null);
    setInput('');
    newestMessageIdRef.current = null;
    hasInitializedRef.current = false;
    lastSentMessageRef.current = null;
  }, [activeChannel.id]);

  // ✅ Load messages when channel changes (covers initial mount + every switch)
  //    Fully inlined to avoid ANY stale-closure issues with loadMessages/chatRef
  useEffect(() => {
    if (!appdatabase || !activeChannel?.path) return;
    let cancelled = false;
    const currentRef = ref(appdatabase, activeChannel.path);

    const load = async () => {
      try {
        setLoading(true);
        setLastLoadedKey(null);

        const snapshot = await get(dbQuery(currentRef, orderByKey(), limitToLast(PAGE_SIZE)));
        if (cancelled) return;

        const data = snapshot.val() || {};
        const bannedIds = Array.isArray(bannedUsers)
          ? bannedUsers.map(u => (typeof u === 'string' ? u : u?.id)).filter(Boolean)
          : [];

        const parsed = Object.entries(data)
          .map(([key, value]) => {
            if (!key || !value || typeof value !== 'object') return null;
            return validateMessage({ id: key, ...value });
          })
          .filter(Boolean)
          .filter(msg => msg?.senderId && !bannedIds.includes(msg.senderId))
          .sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));

        if (cancelled) return;

        setMessages(parsed);
        const newLastKey = parsed.length > 0 ? parsed[parsed.length - 1]?.id : null;
        setLastLoadedKey(newLastKey);
      } catch (error) {
        if (!cancelled) console.error('[channel load] Error:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeChannel.path, appdatabase, bannedUsers, validateMessage]);

  // const bannedUserIds = bannedUsers.map((user) => user.id); // Extract IDs from bannedUsers

  // ✅ Real-time listener using onValue (more reliable than onChildAdded with limitToLast)
  //    onChildAdded + limitToLast(1) has known bugs in Firebase SDKs where remote writes don't fire
  //    Also: no isFocused gate so messages keep arriving when screen loses focus
  useEffect(() => {
    if (!appdatabase || !activeChannel?.path) return;

    let cancelled = false;
    const currentRef = ref(appdatabase, activeChannel.path);
    const latestQuery = dbQuery(currentRef, orderByKey(), limitToLast(1));

    const unsubscribe = onValue(latestQuery, (snapshot) => {
      if (cancelled || !snapshot.exists()) return;

      snapshot.forEach((childSnap) => {
        const key = childSnap.key;
        const data = childSnap.val();
        if (!key || !data || typeof data !== 'object') return;

        const newMessage = validateMessage({ id: key, ...data });
        if (!newMessage || !newMessage.id) return;

        // ✅ Check if message is from banned user
        const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
        if (banned.includes(newMessage.senderId)) return;

        // ✅ Fetch profile for uncached senders (slim messages have no name/avatar)
        if (data.senderId && !getCachedProfile(data.senderId)) {
          getOrFetchProfile(appdatabase, data.senderId).then(() => {
            if (!cancelled) setMessages(prev => [...prev]); // Re-render with resolved profile
          });
        }

        setMessages((prev) => {
          if (!Array.isArray(prev) || prev.length === 0) return [newMessage];
          const exists = prev.some((m) => String(m?.id) === String(key));
          if (exists) return prev;

          // ✅ Use ref for isAtBottom to prevent listener recreation
          if (isAtBottomRef.current) {
            newestMessageIdRef.current = key;
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
    });

    return () => {
      cancelled = true;
      unsubscribe();
      hasInitializedRef.current = false;
    };
  }, [activeChannel.path, appdatabase, validateMessage, bannedUsers]);






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





  const handleLoginSuccess = () => {
    setIsSigninDrawerVisible(false);
  };


  useEffect(() => {
    if (!user?.id) return;

    const userRef = ref(appdatabase, `users/${user.id}/isBlock`);

    const unsubscribe = onValue(userRef, (snapshot) => {
      const isBlocked = snapshot.val();
      if (isBlocked === true) {
        Alert.alert(
          'Blocked',
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
      unsubscribe();
    };
  }, [user?.id]);


  const handleRefresh = async () => {
    setRefreshing(true);
    await loadMessages(true);
    setRefreshing(false);
  };

  // ✅ Pinned messages: load + real-time listener
  useEffect(() => {
    if (!pinnedMessagesRef) return;

    const fetchPinnedMessages = async () => {
      try {
        const snapshot = await get(pinnedMessagesRef);
        const pinnedMessagesData = snapshot.val() || {};

        const pinnedMessagesArray = Object.entries(pinnedMessagesData)
          .map(([key, value]) => {
            if (!key || !value || typeof value !== 'object') return null;
            return { firebaseKey: key, ...value };
          })
          .filter(Boolean)
          .sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0));

        setPinnedMessages(pinnedMessagesArray);
      } catch (error) {
        console.error('Error loading pinned messages:', error);
      }
    };

    fetchPinnedMessages();

    const unsubPinned = onChildAdded(pinnedMessagesRef, (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      const data = snapshot.val();
      if (!data || typeof data !== 'object') return;
      const newPinnedMessage = { firebaseKey: snapshot.key, ...data };
      setPinnedMessages((prev) => {
        const exists = prev.some(msg => msg.firebaseKey === snapshot.key);
        return exists ? prev : [newPinnedMessage, ...prev];
      });
    });

    return () => {
      unsubPinned();
    };
  }, [pinnedMessagesRef]);

  const handlePinMessage = async (message) => {
    try {
      const pinnedMessage = { ...message, pinnedAt: Date.now() };
      const newRef = push(pinnedMessagesRef);
      await set(newRef, pinnedMessage);

      setPinnedMessages((prev) => [
        ...prev,
        { firebaseKey: newRef.key, ...pinnedMessage },
      ]);
    } catch (error) {
      console.error('Error pinning message:', error);
      Alert.alert(t('home.alert.error'), t('chat.pin_error'));
    }
  };

  const unpinSingleMessage = async (firebaseKey) => {
    try {
      const messageRef = child(pinnedMessagesRef, firebaseKey);
      await remove(messageRef);

      setPinnedMessages((prev) => prev.filter((msg) => msg.firebaseKey !== firebaseKey));
    } catch (error) {
      console.error('Error unpinning message:', error);
      Alert.alert(t('home.alert.error'), t('chat.unpin_error'));
    }
  };

  const clearAllPinnedMessages = async () => {
    try {
      await remove(pinnedMessagesRef);
      setPinnedMessages([]);
    } catch (error) {
      console.error('Error clearing pinned messages:', error);
      Alert.alert(t('home.alert.error'), t('chat.clear_pins_error'));
    }
  };

  const handleSendMessage = async (replyToArg, trimmedInputArg, fruits, emojiUrl) => {
    const hasEmoji = !!emojiUrl;

    // console.log(emojiUrl)
    const hasFruits = Array.isArray(fruits) && fruits.length > 0;

    const MAX_CHARACTERS = 250;
    const MESSAGE_COOLDOWN = 10 * 1000; // ms
    const LINK_REGEX = /(https?:\/\/[^\s]+)/i; // no "g" flag
    if (!user?.id || !currentUserEmail) {
      showMessage({
        message: 'You are not loggedin',
        description: 'You must be logged in to send Messages',
        type: 'danger',
      });
      return false;

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
        return false;
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
        return false;
      }
    }
    // Use the argument, not external state
    const trimmedInput = (trimmedInputArg || '').trim();

    // ✅ Validate fruits count - maximum 18 fruits allowed
    if (hasFruits && fruits.length > 18) {
      showMessage({ message: t('home.alert.error'), description: 'You can only send up to 18 pets in a message.', type: 'danger' });
      return false;
    }

    // Disallow empty text + no fruits
    if (!trimmedInput && !hasFruits && !emojiUrl) {
      showMessage({ message: t('home.alert.error'), description: 'Message cannot be empty.', type: 'danger' });
      return false;
    }

    // Profanity check
    if (trimmedInput && leoProfanity.check(trimmedInput)) {
      showMessage({ message: t('home.alert.error'), description: t('misc.inappropriateLanguage'), type: 'danger' });
      return false;
    }

    // Length check
    if (trimmedInput.length > MAX_CHARACTERS) {
      showMessage({ message: t('home.alert.error'), description: t('misc.messageTooLong'), type: 'danger' });
      return false;
    }

    // Cooldown check
    if (isCooldown) {
      const secondsLeft = Math.ceil((cooldownEndRef.current - Date.now()) / 1000);
      showMessage({ message: `Please wait ${secondsLeft > 0 ? secondsLeft : 1}s before sending another message.`, type: 'warning', duration: 2000 });
      return false;
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
        showMessage({ message: t('home.alert.error'), description: 'You cannot send the same message twice. Please modify your message.', type: 'warning' });
        return false;
      }
    }

    // Link check - disallow links for all users
    const containsLink = trimmedInput ? LINK_REGEX.test(trimmedInput) : false;
    if (containsLink) {
      showMessage({ message: t('home.alert.error'), description: 'Links are not allowed in messages.', type: 'danger' });
      return false;
    }

    try {
      // ✅ Use chatRef instead of creating new ref
      if (!chatRef) {
        console.error('❌ Chat ref not available');
        return;
      }

      // ✅ SLIM MESSAGE: Only send message-specific data
      // User metadata (name, avatar, badges, cosmetics) resolved from profileCache on render
      await push(chatRef, {
        text: trimmedInput || null,
        timestamp: serverTimestamp(),
        senderId: user.id,
        replyTo: replyToArg
          ? { id: replyToArg.id, text: replyToArg.text }
          : null,
        fruits: hasFruits ? fruits : [],
        gif: hasEmoji ? emojiUrl : null,
        OS: Platform.OS,
      });

      // ✅ Store last sent message to prevent duplicates (session-based, no Firebase cost)
      lastSentMessageRef.current = currentMessage;

      // Reset local input state
      setInput('');
      setReplyTo(null);

      // Start cooldown
      cooldownEndRef.current = Date.now() + MESSAGE_COOLDOWN;
      setIsCooldown(true);
      setTimeout(() => setIsCooldown(false), MESSAGE_COOLDOWN);
      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      showMessage({ message: t('home.alert.error'), description: 'Could not send your message. Please try again.', type: 'danger' });
      return false;
    }
  };

  // console.log(user.flage)
  return (
    <>
      <GestureHandlerRootView>

        <View style={styles.container}>
          {/* ✅ Channel Pill Switcher */}
          <ScrollView
            horizontal
            maxHeight={35}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={channelTabStyles.scrollContent}
          >
            {CHANNELS.map((channel) => {
              const isActive = channel.id === activeChannel.id;
              return (
                <TouchableOpacity
                  key={channel.id}
                  style={[
                    channelTabStyles.pill,
                    isActive
                      ? { backgroundColor: config.colors.primary, borderColor: config.colors.primary }
                      : { backgroundColor: theme === 'dark' ? config.darkColors.surface : 'transparent', borderColor: theme === 'dark' ? config.darkColors.border : '#ccc' },
                  ]}
                  onPress={() => handleChannelSwitch(channel)}
                  activeOpacity={0.8}
                >
                  <FontAwesome
                    name={channel.icon}
                    size={11}
                    color={isActive ? '#fff' : (theme === 'dark' ? config.darkColors.textSecondary : '#666')}
                    solid={isActive}
                    style={{ marginRight: 5 }}
                  />
                  <Text
                    style={[
                      channelTabStyles.pillText,
                      { color: isActive ? '#fff' : (theme === 'dark' ? config.darkColors.textSecondary : '#666') },
                      isActive && channelTabStyles.pillTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {channel.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

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
                onDeleteMessage={(messageId) => chatRef.child(messageId.replace(`${activeChannel.path}-`, '')).remove()}
                // isAdmin={isAdmin}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                handleLoadMore={handleLoadMore}
                onReply={(message) => { setReplyTo(message); triggerHapticFeedback('impactLight'); }} // Pass selected message to MessageInput
                onDeleteAllMessage={(senderId) => handleDeleteLast300Messages(senderId, false, activeChannel.path)}
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
                chatPath={activeChannel.path}
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
                activeChannelId={activeChannel.id}
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

const channelTabStyles = RNStyleSheet.create({
  scrollContent: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: 'center',
    maxHeight: 38,
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '500',
  },
  pillTextActive: {
    fontWeight: '700',
  },
});

export default ChatScreen;
