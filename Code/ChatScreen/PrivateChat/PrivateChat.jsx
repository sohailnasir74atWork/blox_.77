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
import { useGlobalState, modGateText, chatSendErrorCode, chatSendErrorText } from '../../GlobelStats';
import ChatRestrictedBar from '../ChatRestrictedBar';
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
import { seedCurrentUser } from '../../Helper/profileCache';
import config from '../../Helper/Environment';
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
  loadPrivateMessagesSince as sbLoadPrivateMessagesSince,
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

const sortTs = (m) => m?.serverTime || m?.timestamp || 0;
const newestFirst = (a, b) => sortTs(b) - sortTs(a);

// Last messages seen per chat, in memory for this app session. Reopening a
// chat paints these instantly while the fresh page loads behind them, instead
// of a full-screen spinner on every visit. Keyed by chatKey (both UIDs), so a
// different signed-in account can never read another account's entries.
// (Ported from adoptme-jan7.)
const CACHE_MAX_CHATS = 20;
const CACHE_PER_CHAT = 50;
const messageCache = new Map(); // chatKey -> messages, newest first

const writeCachedMessages = (key, msgs) => {
  if (!key || !Array.isArray(msgs)) return;
  // Unsent placeholders aren't history; a reopen would show them forever.
  const real = msgs.filter((m) => m && !m._optimistic);
  messageCache.delete(key); // re-insert = most recently used
  if (real.length === 0) return; // emptied chat: nothing to repaint
  messageCache.set(key, real.slice(0, CACHE_PER_CHAT));
  if (messageCache.size > CACHE_MAX_CHATS) {
    messageCache.delete(messageCache.keys().next().value);
  }
};

// Supabase cursor for a message. Prefers the raw microsecond created_at; the
// ms `timestamp` fallback only covers optimistic rows.
const cursorOf = (m) => (m
  ? { createdAt: m.createdAt || new Date(m.timestamp).toISOString(), id: m.id }
  : null);

// Merge incoming rows into a newest-first list: an optimistic placeholder
// with the same clientMsgId is promoted to the real row, rows already present
// (by id or clientMsgId) are skipped, and the live list is capped.
const mergeIncoming = (prev, incoming) => {
  let list = Array.isArray(prev) ? prev : [];
  let changed = false;
  incoming.forEach((msg) => {
    if (!msg) return;
    if (msg.clientMsgId) {
      const optIdx = list.findIndex((m) => m?._optimistic && m?.clientMsgId === msg.clientMsgId);
      if (optIdx !== -1) {
        list = [...list];
        list[optIdx] = { ...list[optIdx], ...msg, _optimistic: false };
        changed = true;
        return;
      }
    }
    const exists = list.some((m) => String(m?.id) === String(msg.id)
      || (msg.clientMsgId && m?.clientMsgId === msg.clientMsgId));
    if (exists) return;
    list = [msg, ...list];
    changed = true;
  });
  if (!changed) return prev;
  const sorted = list.sort(newestFirst);
  return sorted.length > MAX_LIVE ? sorted.slice(0, MAX_LIVE) : sorted;
};

const PrivateChatScreen = ({ route, bannedUsers, isDrawerVisible, setIsDrawerVisible }) => {
  const { selectedUser: initialSelectedUser, selectedTheme, item } = route.params || {};
  const [currentSelectedUser, setCurrentSelectedUser] = useState(initialSelectedUser);

  const { user, theme, appdatabase, updateLocalStateAndDatabase, firestoreDB, currentUserEmail, isAdmin, isUserBlocked, isUserMuted, getModGate } = useGlobalState();


  const [trade, setTrade] = useState(null)
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const lastLoadedKeyRef = useRef(null);
  const [lastLoadedKey, setLastLoadedKey] = useState(null);
  const previousChatKeyRef = useRef(null);
  // Mirrors `messages` for callbacks that must read the latest list without
  // re-subscribing (realtime gap-fill).
  const messagesRef = useRef([]);
  // True once the fresh first page has landed. Until then a realtime
  // SUBSCRIBED needs no gap-fill — the in-flight first page covers it.
  const initialLoadDoneRef = useRef(false);
  // Pagination guard as a ref: onEndReached can fire twice before a state
  // update re-renders.
  const paginatingRef = useRef(false);
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


  // Mounted on first open only: mounted hidden, the drawer fetched the
  // partner's full profile on every chat open, competing with the message
  // load for the same connection slots.
  const [drawerMounted, setDrawerMounted] = useState(false);
  useEffect(() => {
    if (isDrawerVisible) setDrawerMounted(true);
  }, [isDrawerVisible]);

  const closeProfileDrawer = () => {
    setIsDrawerVisible(false);
  };

  // Banned / muted users see why (and for how long) instead of an input,
  // like adoptme-jan7's isMeBanned state.
  const chatInputGate = (isUserBlocked || isUserMuted) ? getModGate('chat') : null;

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
    // Block banned users from submitting reviews (reviews are content, so a
    // mute doesn't apply). getModGate reads live, server-time-validated state
    // and is stable, so this callback can't act on a stale ban flag.
    const modGate = getModGate('content');
    if (modGate) {
      const { title, message } = modGateText(modGate, 'review');
      showErrorMessage(title, message);
      return;
    }

    if (!rating || rating < 1 || rating > 5) {
      showErrorMessage(t('chat.error'), t('chat.private_chat.select_rating'));
      return;
    }

    if (!selectedUserId || !myUserId || !appdatabase || !firestoreDB) {
      showErrorMessage(t('chat.error'), t('chat.private_chat.missing_data'));
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
        t('chat.message_common.success'),
        reviewWasSaved
          ? reviewWasUpdated
            ? t('chat.private_chat.review_updated')
            : t('chat.private_chat.thanks_review')
          : t('chat.private_chat.thanks_rating')
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

      // No post-review interstitial: the review modal lives on the private
      // chat screen, so an ad here still serves on a private-communications
      // surface.

    } catch (error) {
      console.error("Rating error:", error);
      showErrorMessage(t('chat.error'), t('chat.private_chat.rating_failed'));
      setStartRating(false);
    }
  }, [rating, selectedUserId, myUserId, appdatabase, firestoreDB, reviewText, user?.id, user?.displayName, updateUserPoints, getModGate, t]);



  // chatKey is the canonical pair id ([a,b].sort().join('_')) — same
  // shape as the Supabase chat_id column.
  const loadMessages = useCallback(
    async (reset = false) => {
      if (!chatKey) return;

      if (reset) {
        initialLoadDoneRef.current = false;
        const cached = messageCache.get(chatKey);
        if (cached?.length) {
          // Paint the last-seen messages now; the fresh page merges in below.
          setMessages(cached);
          setLoading(false);
          lastLoadedKeyRef.current = cursorOf(cached[cached.length - 1]);
        } else {
          setLoading(true);
          setMessages([]);
          // Cursor is { createdAt: ISO, id: uuid } — see privateMessagesBackend.
          lastLoadedKeyRef.current = null;
        }
      } else {
        if (paginatingRef.current) return;
        paginatingRef.current = true;
      }
      try {
        const before = reset ? null : lastLoadedKeyRef.current;

        const rows = await sbLoadPrivateMessages(chatKey, { limit: PAGE_SIZE, before });
        if (!Array.isArray(rows) || rows.length === 0) {
          // End of history: stop paginating (a stale cursor re-sent this
          // same empty request on every scroll to the top).
          lastLoadedKeyRef.current = null;
          // An empty fresh page means the chat has no messages now; drop
          // anything painted from the cache (keep unsent placeholders).
          if (reset) setMessages(prev => (Array.isArray(prev) ? prev.filter(m => m?._optimistic) : []));
          return;
        }

        if (reset) {
          // The fresh newest page wins. Rows already on screen survive only
          // if they sit outside its time range: older ones (cached history
          // the user may be scrolled into) and newer ones (realtime inserts
          // or unsent placeholders that landed while this request was in
          // flight). A row inside the range but missing from it was deleted.
          const newestFresh = sortTs(rows[0]);
          const oldestFresh = sortTs(rows[rows.length - 1]);
          const freshIds = new Set(rows.map(m => String(m?.id)));
          const freshClientIds = new Set(rows.map(m => m?.clientMsgId).filter(Boolean));
          setMessages(prev => {
            const keep = (Array.isArray(prev) ? prev : []).filter(m => m
              && !freshIds.has(String(m.id))
              && !(m.clientMsgId && freshClientIds.has(m.clientMsgId))
              && (sortTs(m) < oldestFresh || sortTs(m) > newestFresh));
            const merged = [...rows, ...keep].sort(newestFirst);
            lastLoadedKeyRef.current = cursorOf(merged.filter(m => !m._optimistic).pop());
            return merged;
          });
          return;
        }

        setMessages(prev => {
          if (!Array.isArray(prev)) return rows;
          const existingIds = new Set(prev.map(m => String(m?.id)));
          const onlyNew = rows.filter(m => !existingIds.has(String(m?.id)));
          return [...prev, ...onlyNew].sort(newestFirst);
        });

        // Advance the cursor — oldest row of this page (rows are
        // newest-first, so the last element is the oldest).
        lastLoadedKeyRef.current = cursorOf(rows[rows.length - 1]);
      } catch (error) {
        console.error('Error loading messages:', error);
      } finally {
        if (reset) {
          setLoading(false);
          initialLoadDoneRef.current = true;
        } else {
          paginatingRef.current = false;
        }
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

  // Keep the session cache and the gap-fill ref in step with what's on screen.
  useEffect(() => {
    messagesRef.current = messages;
    writeCachedMessages(chatKey, messages);
  }, [chatKey, messages]);

  const handleLoadMore = useCallback(() => {
    // No cursor = first page still loading, or end of history reached.
    if (paginatingRef.current || !lastLoadedKeyRef.current) return;
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
        t('chat.error'),
        chatBlockedBy === 'them'
          ? (chatType === 'trade'
            ? t('chat.private_chat.them_disabled_trade')
            : t('chat.private_chat.them_disabled_chat'))
          : (chatType === 'trade'
            ? t('chat.private_chat.you_disabled_trade')
            : t('chat.private_chat.you_disabled_chat'))
      );
      return;
    }

    const trimmedText = (text || '').trim();
    const hasImage = !!image;
    const hasFruits = Array.isArray(fruits) && fruits.length > 0;

    if (!myUserId || !currentUserEmail) {
      showErrorMessage(t("home.alert.error"), t('chat.private_chat.must_login'));
      return;
    }
    // Block banned / muted users from sending (admins exempt), and wait for
    // the ban check on a fresh sign-in. getModGate is stable and reads live,
    // server-time-validated state, so this callback can't go stale on it.
    const modGate = getModGate('chat');
    if (modGate) {
      const { title, message } = modGateText(modGate, 'chat');
      showErrorMessage(title, message);
      return;
    }

    if (hasFruits && fruits.length > 18) {
      showErrorMessage(t("home.alert.error"), t('chat.message_common.max_pets'));
      return;
    }

    if (!trimmedText && !hasImage && !hasFruits) {
      showErrorMessage(t("home.alert.error"), t("chat.cannot_empty"));
      return;
    }

    if (!myUserId || !selectedUserId || !appdatabase) {
      showErrorMessage(t("home.alert.error"), t('chat.private_chat.missing_data'));
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
    } catch (error) {
      console.error("Error sending message:", error);
      // Server rejected the sender / message (SENDER_BANNED,
      // LINKS_NOT_ALLOWED, NOT_ALLOWED — errcode 23514): say why, drop the
      // optimistic bubble (it never landed) and give the text back.
      const rejected = chatSendErrorText(chatSendErrorCode(error));
      if (rejected) {
        setMessages(prev => (Array.isArray(prev) ? prev.filter(m => m?.id !== clientMsgId) : prev));
        if (trimmedText) setInput(trimmedText);
        showErrorMessage(rejected.title, rejected.message);
        return;
      }
      Alert.alert(t('chat.error'), t('chat.private_chat.send_failed'));
    }
  }, [myUserId, selectedUserId, appdatabase, currentSelectedUser, user, t, currentUserEmail, getModGate, chatBlockedBy, chatType]);

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

      chatEnterTimeRef.current = Date.now();

      // The exit interstitial that used to fire here on blur is gone. It was
      // triggered by private-message activity and painted over the chat as it
      // unmounted (or over the inbox), both private-communications surfaces
      // under AdMob policy. Do not reintroduce it.
      return () => {
        // Land any coalesced read receipt immediately on blur.
        flushLastRead(chatKey, user.id);

        // Partner messages that arrived while we sat in the chat bumped our
        // server-side unread_count (the per-message reset was removed to
        // save writes). Clear it once on the way out.
        if (unreadWhileFocusedRef.current) {
          unreadWhileFocusedRef.current = false;
          sbResetUnreadCount(user.id, selectedUserId);
        }
      };
    }, [user?.id, selectedUserId, chatKey, localState?.showReadReceipts])
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

      // Promotes a matching optimistic placeholder, dedups by id /
      // clientMsgId, keeps newest-first and caps at MAX_LIVE.
      setMessages(prev => mergeIncoming(prev, [msg]));
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

    // Realtime never replays what it missed. Every SUBSCRIBED — re-focus
    // after the image viewer or profile, or the rejoin after the socket was
    // dropped in the background — fetches only the rows newer than the
    // newest on screen. Before this, a message that arrived in that gap
    // stayed invisible until the chat was closed and reopened.
    let active = true;
    let gapFillInFlight = false;
    const gapFill = () => {
      // Before the first page lands there's nothing to fill: that request
      // already covers everything up to now.
      if (!active || gapFillInFlight || !initialLoadDoneRef.current) return;
      const newest = (messagesRef.current || []).find(m => m && !m._optimistic);
      gapFillInFlight = true;
      sbLoadPrivateMessagesSince(chatKey, cursorOf(newest), { limit: 50 })
        .then((rows) => {
          if (active && rows.length > 0) setMessages(prev => mergeIncoming(prev, rows));
        })
        .catch((e) => console.warn('[PrivateChat] gap-fill failed:', e?.message))
        .finally(() => { gapFillInFlight = false; });
    };

    const unsubscribe = sbSubscribeToPrivateMessages(chatKey, {
      onInsert: handleInsert,
      onUpdate: handleUpdate,
      onDelete: handleDelete,
      onStatus: (status) => {
        if (status === 'SUBSCRIBED') gapFill();
      },
    });

    return () => {
      active = false;
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
                        <Image resizeMethod="resize"
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
                    <Image resizeMethod="resize" source={require('../../../assets/transfer.png')} style={styles.transferImage} />
                  </View>
                  <View style={styles.itemList}>
                    {groupedWantsItems?.map((wantitem, index) => (
                      <View key={`${wantitem.name}-${wantitem.type}`} style={{ justifyContent: 'center', alignItems: 'center' }}>
                        <Image resizeMethod="resize"
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

            {/* No ad slot here. AdMob's "Ads in private communications"
                policy prohibits ads on screens whose primary focus is a
                direct message; a banner in this thread is what put the app
                under restricted ad serving. Do not reintroduce it. */}

            {isChatUnavailable && (
              <View style={styles.chatUnavailableBanner}>
                <Text style={styles.chatUnavailableIcon}>🚫</Text>
                <Text style={styles.chatUnavailableText}>
                  {chatBlockedBy === 'them'
                    ? (chatType === 'trade'
                      ? t('chat.private_chat.them_disabled_trade')
                      : t('chat.private_chat.them_disabled_chat'))
                    : (chatType === 'trade'
                      ? t('chat.private_chat.you_disabled_trade')
                      : t('chat.private_chat.you_disabled_chat'))}
                </Text>
              </View>
            )}

            {chatInputGate ? (
              <ChatRestrictedBar gate={chatInputGate} isDarkMode={theme === 'dark'} />
            ) : (
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
            )}
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
              {t('chat.private_chat.rate_title')}
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
              placeholder={t('chat.private_chat.review_placeholder')}
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
                {!startRating ? t('chat.private_chat.submit_rating') : t('chat.private_chat.submitting')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {(drawerMounted || isDrawerVisible) && <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={closeProfileDrawer}
        startChat={() => { }}
        selectedUser={currentSelectedUser}
        isOnline={isOnline}
        bannedUsers={bannedUsers}
        fromPvtChat={true}
      />}
    </>
  );
};

export default PrivateChatScreen;
