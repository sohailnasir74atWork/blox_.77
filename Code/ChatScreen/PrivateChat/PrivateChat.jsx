import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  ActivityIndicator,
  Alert,
  Text,
  Image,
  TouchableOpacity, TextInput,
} from 'react-native';
import { useFocusEffect, useIsFocused, useRoute } from '@react-navigation/native';
import { getStyles } from '../Style';
import PrivateMessageInput from './PrivateMessageInput';
import PrivateMessageList from './PrivateMessageList';
import { useGlobalState } from '../../GlobelStats';
import { chatTypeForRoute, fetchChatAvailability, resolveChatBlock } from '../chatAvailability';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { isUserOnline, updateLastRead, flushLastRead, useOtherLastRead, useActiveChatLifecycle } from '../utils';
import { useLocalState } from '../../LocalGlobelStats';
// RTDB usage in this file is now limited to: rewardPoints reads/writes
// (`/users/{uid}/rewardPoints`) and the trade subtree
// (`private_messages/{chatId}/trade`). Message bodies, chat metadata,
// pagination + realtime are all Supabase-native.
import { get, set, ref, update } from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import BannerAdComponent from '../../Ads/bannerAds';
import { seedCurrentUser } from '../../Helper/profileCache';
import InterstitialAdManager from '../../Ads/IntAd';
import config from '../../Helper/Environment';

// Dedicated MMKV instance for ad-frequency caps. Falls back to a no-op
// store if MMKV fails to init so the cap never blocks normal rendering.
let adFreqStorage;
try {
  const { createMMKV } = require('react-native-mmkv');
  adFreqStorage = createMMKV({ id: 'ad-frequency' });
} catch (_) {
  adFreqStorage = { getString: () => undefined, set: () => {} };
}
const PVT_CHAT_BACK_AD_KEY = 'pvt_chat_back_ad_date';
import PetModal from './PetsModel';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from '@react-native-firebase/firestore';
import { updateUserRatingSummary } from '../utils/ratingSummaryHelper';
import { incrementAndCheckBadge, awardBadge, REVIEW_BADGE_THRESHOLDS } from '../GroupChat/badgeUtils';
import { addXP, XP_ACTIONS } from '../../Engagement/xpUtils';
import ProfileBottomDrawer from '../GroupChat/BottomDrawer';
import {
  sendPrivateChatMeta,
  resetUnreadCount as sbResetUnreadCount,
} from '../../Supabase/chatMetaBackend';
import {
  loadPrivateMessages as sbLoadPrivateMessages,
  subscribeToPrivateMessages as sbSubscribeToPrivateMessages,
  sendPrivateMessage as sbSendPrivateMessage,
  softDeleteAllInChat as sbSoftDeleteAllInChat,
  newClientMsgId as newPvtClientMsgId,
} from '../../Supabase/privateMessagesBackend';


const PAGE_SIZE = 10;
// Cap the live in-memory list so a long back-and-forth session doesn't grow
// the array (and per-insert sort cost) unboundedly. Older pages re-fetch on
// scroll.
const MAX_LIVE = 150;

const PrivateChatScreen = ({ route, bannedUsers, isDrawerVisible, setIsDrawerVisible }) => {
  const { selectedUser: initialSelectedUser, selectedTheme, item } = route.params || {};
  const [currentSelectedUser, setCurrentSelectedUser] = useState(initialSelectedUser);

  const { user, theme, appdatabase, updateLocalStateAndDatabase, firestoreDB, currentUserEmail, strikeInfo, isAdmin, isUserBlocked } = useGlobalState();


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
  const isFocused = useIsFocused();
  // Set when a partner message arrives while this chat is focused; the blur
  // handler then issues ONE unread reset instead of one per incoming message.
  const unreadWhileFocusedRef = useRef(false);
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
                // `admin` is legacy, `isAdmin` is current — both exist in RTDB.
                isAdmin: data.isAdmin || data.admin || false,
                isSeniorMod: data.isSeniorMod || false,
                isModerator: data.isModerator || false,
                isBabyMod: data.isBabyMod || false,
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

  // ── Chat availability ────────────────────────────────────────────────────
  // The door decides which switch applies: the Trades screen pushes
  // PrivateChatTrade, everything else (inbox, feed, leaderboard, profiles) is
  // general. Same thread, different door = different switch. That's intended.
  const navRoute = useRoute();
  const routeName = route?.name || navRoute?.name;
  const chatType = useMemo(() => chatTypeForRoute(routeName), [routeName]);

  const [theirAvailability, setTheirAvailability] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!appdatabase || !selectedUserId) { setTheirAvailability(null); return undefined; }
    fetchChatAvailability(appdatabase, selectedUserId).then((a) => {
      if (!cancelled) setTheirAvailability(a);
    });
    return () => { cancelled = true; };
  }, [appdatabase, selectedUserId]);

  // Blocks both ways: 'them' = they closed this door, 'me' = I did, and I can't
  // message anyone through it either.
  const chatBlockedBy = useMemo(
    () => resolveChatBlock(chatType, user, theirAvailability),
    [chatType, user, theirAvailability]
  );
  const isChatUnavailable = !!chatBlockedBy;
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

  // Mirror showReadReceipts into a ref so the realtime subscription
  // (which depends only on chatKey) can read the latest value without
  // tearing down + resubscribing every time the toggle flips.
  const showReadReceiptsRef = useRef(localState?.showReadReceipts);
  showReadReceiptsRef.current = localState?.showReadReceipts;

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
    }, [user?.id])
  );

  // Active-chat lifecycle: focus + AppState aware. Replaces the prior
  // useFocusEffect+useEffect pair that left activeChats set for the
  // 10–60s window after backgrounding (notification CF then suppressed
  // pushes for the recipient during that window).
  useActiveChatLifecycle({ userId: user?.id, chatId: chatKey });

  const handleRating = useCallback(async () => {
    // Block banned users from submitting reviews. Defer expiry to the
    // server-time-validated `isUserBlocked` flag so a clock-rolled device
    // can't slip past.
    if (isUserBlocked && !isAdmin) {
      showErrorMessage(t("home.alert.error"), "You are banned and cannot submit reviews.");
      return;
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
      // This maintains aggregated data for efficient leaderboard queries.
      // The returned aggregate also drives the reviewed user's 5-Star badge
      // (4.5★ average with 50+ reviews received).
      updateUserRatingSummary(firestoreDB, selectedUserId)
        .then((summary) => {
          if (summary && summary.count >= 50 && summary.averageRating >= 4.5) {
            awardBadge(appdatabase, selectedUserId, 'fiveStar');
          }
        })
        .catch((err) => {
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
        // A NEW review (not an edit) grants the reviewer's +30 XP and counts
        // toward the Reviewer badge (25 reviews). Edits must re-award neither.
        if (!isUpdate) {
          addXP(appdatabase, user.id, XP_ACTIONS.LEAVE_REVIEW, 'LEAVE_REVIEW');
          incrementAndCheckBadge(appdatabase, user.id, 'reviewCount', REVIEW_BADGE_THRESHOLDS);
        }
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



  // chatKey is the canonical pair id ([a,b].sort().join('_')) — same
  // shape as the Supabase chat_id column.
  const loadMessages = useCallback(
    async (reset = false) => {
      if (!chatKey) return;

      if (reset) {
        setLoading(true);
        setMessages([]);
        // Cursor is { createdAt: ISO, id: uuid } — see privateMessagesBackend.
        lastLoadedKeyRef.current = null;
      }
      try {
        const before = !reset && lastLoadedKeyRef.current
          ? lastLoadedKeyRef.current
          : null;

        const rows = await sbLoadPrivateMessages(chatKey, { limit: PAGE_SIZE, before });
        if (!Array.isArray(rows) || rows.length === 0) return;

        setMessages(prev => {
          if (!Array.isArray(prev)) return rows;
          if (reset) return rows;
          const existingIds = new Set(prev.map(m => String(m?.id)));
          const onlyNew = rows.filter(m => !existingIds.has(String(m?.id)));
          const combined = [...prev, ...onlyNew];
          return combined.sort((a, b) => (b?.serverTime || b?.timestamp || 0) - (a?.serverTime || a?.timestamp || 0));
        });

        // Advance the cursor — oldest row of this page (rows are
        // newest-first, so the last element is the oldest).
        const oldest = rows[rows.length - 1];
        if (oldest) {
          lastLoadedKeyRef.current = {
            createdAt: new Date(oldest.timestamp).toISOString(),
            id: oldest.id,
          };
        }
      } catch (error) {
        console.error('Error loading messages:', error);
      } finally {
        if (reset) setLoading(false);
      }
    },
    [chatKey]
  );
  // Initial load (also re-runs on chat switch). Pagination + realtime
  // are wired separately below.
  useEffect(() => {
    if (!chatKey) return;

    const currentChatKey = chatKey;
    const previousChatKey = previousChatKeyRef.current;

    if (currentChatKey !== previousChatKey) {
      previousChatKeyRef.current = currentChatKey;
      loadMessages(true);
    } else if (previousChatKey === null) {
      previousChatKeyRef.current = currentChatKey;
      loadMessages(true);
    }
  }, [chatKey, loadMessages]);

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
    // Guard for a stale screen — the input is already disabled when this door
    // is shut, so this only fires if the switch flipped while the chat was open.
    if (chatBlockedBy) {
      Alert.alert(
        "Error",
        chatBlockedBy === 'them'
          ? (chatType === 'trade'
            ? "This user has disabled trade chat. You cannot message them from a trade."
            : "This user has disabled chat. You cannot message them right now.")
          : (chatType === 'trade'
            ? "You have disabled trade chat. Turn it back on in Settings."
            : "You have disabled chat. Turn it back on in Settings.")
      );
      return;
    }

    const trimmedText = (text || '').trim();
    const hasImage = !!image;
    const hasFruits = Array.isArray(fruits) && fruits.length > 0;

    if (!myUserId || !currentUserEmail) {
      showErrorMessage(t("home.alert.error"), "You must be logged in to send messages.");
      return;
    }
    // Block banned users from sending (admins exempt). Defer expiry to
    // server-time-validated `isUserBlocked` so a clock-rolled device
    // can't slip past — strikeInfo is used only for the message text.
    if (isUserBlocked && !isAdmin) {
      const { bannedUntil } = strikeInfo || {};

      if (bannedUntil === 'permanent') {
        showErrorMessage(t("home.alert.error"), "You are permanently banned from sending messages.");
        return;
      }

      if (typeof bannedUntil === 'number') {
        const remaining = Math.max(0, bannedUntil - Date.now());
        const totalMinutes = Math.ceil(remaining / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        showErrorMessage(
          t("home.alert.error"),
          `You are banned from chatting for ${timeLeftText} more minute(s).`
        );
        return;
      }

      showErrorMessage(t("home.alert.error"), "You are currently banned from sending messages.");
      return;
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

    // Build the reply_to JSON payload once — same shape as before.
    const replyToPayload = replyToMsg
      ? {
          id: replyToMsg.id,
          text: replyToMsg.text || '',
          senderId: replyToMsg.senderId,
          imageUrl: replyToMsg.imageUrl || null,
          hasFruits: replyToMsg.fruits && replyToMsg.fruits.length > 0,
          fruitsCount: replyToMsg.fruits ? replyToMsg.fruits.length : 0,
        }
      : null;

    const lastMessagePreview =
      trimmedText ||
      (hasImage ? '📷 Photo' : hasFruits ? `🐾 ${fruits.length} pet(s)` : '');

    // Pre-generate the idempotency key so the optimistic placeholder can
    // be matched against the realtime INSERT (and against the row
    // returned from sendPrivateMessage on retry collision).
    const clientMsgId = newPvtClientMsgId();

    // ✅ Optimistic: add message to local state immediately. The
    // realtime INSERT will replace this with the real row matched by
    // clientMsgId.
    const optimisticMsg = {
      id: clientMsgId,
      clientMsgId,
      senderId: myUserId,
      text: trimmedText,
      timestamp,
      serverTime: timestamp,
      _optimistic: true,
      sender: user?.displayName || 'You',
      avatar: user?.avatar || null,
      ...(hasImage ? { imageUrl: image } : {}),
      ...(hasFruits ? { fruits } : {}),
      ...(replyToPayload ? { replyTo: replyToPayload } : {}),
    };
    setMessages(prev => {
      if (!Array.isArray(prev)) return [optimisticMsg];
      return [optimisticMsg, ...prev].sort((a, b) => (b?.serverTime || b?.timestamp || 0) - (a?.serverTime || a?.timestamp || 0));
    });

    try {
      // Send the message body to Supabase. Idempotent via clientMsgId.
      await sbSendPrivateMessage({
        chatId,
        senderId: myUserId,
        recipientId: selectedUserId,
        text: trimmedText || null,
        imageUrl: hasImage ? image : null,
        fruits: hasFruits ? fruits : [],
        replyTo: replyToPayload,
        OS: undefined, // PrivateChat doesn't track OS today; leave null
        clientMsgId,
        // Lets the server enforce availability without trusting this client.
        // Dropped automatically if the column isn't there yet.
        origin: chatType,
      });

      // chat_meta_data is now Supabase-native. sendPrivateChatMeta does
      // both pair sides (sender + receiver) in parallel and atomically
      // increments the receiver's unread_count via an SQL RPC. Identity
      // fields (receiverName / receiverAvatar) are still written
      // once-per-session — chatMetaBackend leaves them unchanged on
      // upsert when the caller passes null.
      const senderKey = `${myUserId}_${selectedUserId}`;
      const receiverKey = `${selectedUserId}_${myUserId}`;

      const writeReceiverIdentity = !metaIdentityWrittenRef.current.has(senderKey);
      const writeSenderIdentity = !metaIdentityWrittenRef.current.has(receiverKey);

      await sendPrivateChatMeta({
        senderUid: myUserId,
        receiverUid: selectedUserId,
        lastMessage: lastMessagePreview,
        timestampMs: timestamp,
        receiverName: writeReceiverIdentity
          ? (currentSelectedUser?.sender || 'Anonymous')
          : null,
        receiverAvatar: writeReceiverIdentity
          ? (currentSelectedUser?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png')
          : null,
        senderName: writeSenderIdentity
          ? (user?.displayName || 'Anonymous')
          : null,
        senderAvatar: writeSenderIdentity
          ? (user?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png')
          : null,
      });

      if (writeReceiverIdentity) metaIdentityWrittenRef.current.add(senderKey);
      if (writeSenderIdentity) metaIdentityWrittenRef.current.add(receiverKey);

      setReplyTo(null);
      hasSentMessageRef.current += 1; // ✅ Increment message count
    } catch (error) {
      console.error("Error sending message:", error);
      Alert.alert("Error", "Could not send your message. Please try again.");
    }
  }, [myUserId, selectedUserId, appdatabase, currentSelectedUser, user, t, currentUserEmail, strikeInfo, isAdmin, chatBlockedBy, chatType]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !selectedUserId) return;

      // Unread reset moved to Supabase. Errors are swallowed by the
      // helper — at-most-once is fine; next snapshot reflects truth.
      sbResetUnreadCount(user.id, selectedUserId);

      // Mark messages as read — gated on the read-receipts toggle so the
      // sender doesn't see a blue tick if this user has read receipts
      // disabled. Otherwise the user-visible bug is "I turned off read
      // receipts but they still see I read it."
      if (localState?.showReadReceipts !== false) {
        updateLastRead(chatKey, user.id);
      }

      // ✅ Reset refs when entering chat (used by exit-ad logic)
      hasSentMessageRef.current = 0;
      chatEnterTimeRef.current = Date.now();

      // Back-ad: fire on blur (back press / nav away). Gated on the user
      // having sent at least 3 messages in this session (no ad for
      // drive-by opens) and capped to one show per local calendar day
      // across all private chats. Pro users skip. Date string is local-
      // time YYYY-MM-DD so the cap follows the user's perceived day.
      return () => {
        // Land any coalesced read receipt immediately on blur — must run
        // before the back-ad early returns below, which don't apply to it.
        flushLastRead(chatKey, user.id);

        // Partner messages that arrived while we sat in the chat bumped our
        // server-side unread_count (the per-message reset was removed to
        // save writes). Clear it once on the way out.
        if (unreadWhileFocusedRef.current) {
          unreadWhileFocusedRef.current = false;
          sbResetUnreadCount(user.id, selectedUserId);
        }

        if (localState?.isPro) return;
        if (hasSentMessageRef.current < 3) return;
        try {
          const today = new Date().toLocaleDateString('en-CA');
          if (adFreqStorage.getString(PVT_CHAT_BACK_AD_KEY) === today) return;
          adFreqStorage.set(PVT_CHAT_BACK_AD_KEY, today);
          setTimeout(() => {
            try { InterstitialAdManager.showAd(() => {}); } catch (_) {}
          }, 400);
        } catch (_) {}
      };
    }, [user?.id, selectedUserId, chatKey, localState?.isPro, localState?.showReadReceipts])
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMessages(true);
    setRefreshing(false);
  }, [loadMessages]);

  // ── Admin: soft-delete ALL messages in this chat ──
  const handleDeleteAllChat = useCallback(() => {
    if (!chatKey || !isAdmin) return;
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
              await sbSoftDeleteAllInChat(chatKey, user?.id ?? null);
              setMessages([]);
              showSuccessMessage('Success', 'All messages deleted.');
            } catch (e) {
              Alert.alert('Error', 'Failed to delete messages.');
            }
          },
        },
      ]
    );
  }, [chatKey, isAdmin, user?.id]);

  // Realtime listener — Supabase. INSERT brings new messages (from
  // either side); UPDATE fires for soft-deletes; DELETE for hard.
  // Optimistic placeholders are matched by clientMsgId on INSERT and
  // promoted to the real row.
  useEffect(() => {
    if (!chatKey) return;
    // Channel only while this screen is focused — navigating deeper (profile
    // drawer pushes, settings) or away tears it down; the focus effect's
    // unread reset + initial-load path cover anything missed on return.
    if (!isFocused) return;

    const handleInsert = (msg) => {
      if (!msg) return;

      // When the partner sends while we're sitting in this chat, the
      // send_private_chat_meta RPC has already bumped our unread_count on
      // the server. Don't fire an UPDATE per incoming message (each one
      // also echoes back over both parties' meta channels) — just flag it;
      // the blur handler clears the count once on the way out.
      const isFromPartner =
        msg.senderId &&
        msg.senderId !== myUserIdRef.current &&
        chatKeyRef.current;

      if (isFromPartner) {
        unreadWhileFocusedRef.current = true;

        // lastRead write is gated on the read-receipts toggle so the
        // sender doesn't see a blue tick if this user has read receipts off.
        // (Coalesced RTDB write — cheap, and keeps live blue ticks working.)
        if (showReadReceiptsRef.current !== false) {
          updateLastRead(chatKeyRef.current, myUserIdRef.current);
        }
      }

      setMessages(prev => {
        if (!Array.isArray(prev)) return [msg];

        // Optimistic-placeholder swap: same clientMsgId → replace with
        // the real row (real id, real timestamp).
        if (msg.clientMsgId) {
          const optIdx = prev.findIndex(
            (m) => m?._optimistic && m?.clientMsgId === msg.clientMsgId,
          );
          if (optIdx !== -1) {
            const updated = [...prev];
            updated[optIdx] = { ...updated[optIdx], ...msg, _optimistic: false };
            return updated.sort((a, b) => (b?.serverTime || b?.timestamp || 0) - (a?.serverTime || a?.timestamp || 0));
          }
        }

        // Plain dedup by id (handles both our own non-optimistic
        // self-INSERT echo and double-fire scenarios).
        if (prev.some((m) => String(m?.id) === String(msg.id))) return prev;
        const next = [msg, ...prev].sort((a, b) => (b?.serverTime || b?.timestamp || 0) - (a?.serverTime || a?.timestamp || 0));
        return next.length > MAX_LIVE ? next.slice(0, MAX_LIVE) : next;
      });
    };

    const handleUpdate = (msg) => {
      if (!msg) return;
      if (msg.deleted) {
        // Soft-delete from the other participant: drop the row.
        setMessages(prev => prev.filter(m => m?.id !== msg.id));
        return;
      }
      // Other UPDATE shapes (edit, etc.) — not used today; merge if/when added.
    };

    const handleDelete = (id) => {
      if (!id) return;
      setMessages(prev => prev.filter(m => m?.id !== id));
    };

    const unsubscribe = sbSubscribeToPrivateMessages(chatKey, {
      onInsert: handleInsert,
      onUpdate: handleUpdate,
      onDelete: handleDelete,
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [chatKey, isFocused]);







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
                onDeleteAllChat={handleDeleteAllChat}
                canRate={canRate}
                hasRated={hasRated}
                setShowRatingModal={setShowRatingModal}
                chatKey={chatKey}
                otherLastRead={otherLastRead}
              />
            )}

            {!localState.isPro && <BannerAdComponent />}

            {isChatUnavailable && (
              <View style={styles.chatUnavailableBanner}>
                <Text style={styles.chatUnavailableIcon}>🚫</Text>
                <Text style={styles.chatUnavailableText}>
                  {chatBlockedBy === 'them'
                    ? (chatType === 'trade'
                      ? 'This user has disabled trade chat. You cannot message them from a trade.'
                      : 'This user has disabled chat. You cannot message them right now.')
                    : (chatType === 'trade'
                      ? 'You have disabled trade chat. Turn it back on in Settings.'
                      : 'You have disabled chat. Turn it back on in Settings.')}
                </Text>
              </View>
            )}

            <PrivateMessageInput
              onSend={sendMessage}
              isBanned={isBanned || isChatUnavailable}
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
