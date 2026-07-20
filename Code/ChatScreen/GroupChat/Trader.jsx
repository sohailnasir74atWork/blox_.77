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
import database, { onValue, ref, get, query as dbQuery, orderByKey, limitToLast, endAt } from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';
import { mixpanel } from '../../AppHelper/MixPenel';
import InterstitialAdManager from '../../Ads/IntAd';
import BannerAdComponent from '../../Ads/bannerAds';
import { logoutUser } from '../../Firebase/UserLogics';
import { showMessage } from 'react-native-flash-message';
import PetModal from '../PrivateChat/PetsModel';
import { getCachedProfile, getOrFetchProfile, seedCurrentUser, warmProfileCache } from '../../Helper/profileCache';
import {
  subscribeToMessages,
  subscribeToPinned,
  loadMessages as loadMessagesFromSupabase,
  loadMessagesSince as loadMessagesSinceFromSupabase,
  loadPinnedMessages as loadPinnedMessagesFromSupabase,
  sendMessage as sbSendMessage,
  newClientMsgId,
  ensureRealtimeAuth as sbEnsureRealtimeAuth,
  resetRealtimeAndAuth as sbResetRealtimeAndAuth,
  pinMessage as sbPinMessage,
  unpinMessage as sbUnpinMessage,
  clearPinnedForRoom as sbClearPinnedForRoom,
  softDeleteMessage as sbSoftDeleteMessage,
  softDeleteMessageByRtdbKey as sbSoftDeleteMessageByRtdbKey,
} from '../../Supabase/chatBackend';
import { SUPABASE_PUBLIC_CHAT_ENABLED } from '../../Supabase/featureFlags';
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
  const { user, theme, onlineMembersCount, appdatabase, setUser, isAdmin, proTagBought, currentUserEmail, proGranted, strikeInfo, isBabyMod, isTrusted, isGrinder, isRaider, isUserBlocked } = useGlobalState();
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

  // ── §4.1 realtime recovery + send retry ─────────────────────────────
  // Newest { createdAt, id } cursor we've actually rendered. Gap-fill on
  // reconnect resumes strictly after this so INSERTs missed while the socket
  // was dead/resubscribing are backfilled (the "chat froze forever" class).
  const newestCursorRef = useRef(null);
  const lastRealtimeStatusRef = useRef(null);
  const channelErrorAttemptsRef = useRef(0);
  const channelRetryTimerRef = useRef(null);
  const gapFillTimerRef = useRef(null);
  // Sends that failed (offline / socket wedged) — replayed on reconnect.
  // sbSendMessage is idempotent on clientMsgId so replay is duplicate-free.
  const retryQueueRef = useRef([]);
  // Bumping this re-runs the realtime effect → tears down the wedged channel
  // and opens a fresh one after a hard auth/socket reset.
  const [resubKey, setResubKey] = useState(0);

  // -------------------------------------------------------------------
  // Idle auto-pause for the (billed) public-room realtime stream.
  // -------------------------------------------------------------------
  // The room channel fans EVERY message out to EVERY subscriber, so a user
  // who leaves the chat open but stops interacting is pure realtime-message
  // cost. After IDLE_PAUSE_MS with no interaction we tear the subscription
  // down and show a resume bar; any touch (scroll/tap/send) flips
  // realtimePaused back to false, the subscription effect re-subscribes,
  // and the existing onStatus → gap-fill backfills whatever was missed.
  const IDLE_PAUSE_MS = 180000; // 3 min — tune for cost vs. interruption
  const [realtimePaused, setRealtimePaused] = useState(false);
  const idleTimerRef = useRef(null);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const armIdleTimer = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      setRealtimePaused(true);
    }, IDLE_PAUSE_MS);
  }, [clearIdleTimer]);

  // Wire onto every interaction signal (container onTouchStart, send).
  // Resumes if paused and restarts the idle countdown. Returning the same
  // value from the updater makes React bail out, so touches while
  // already-live cost no re-render.
  const registerChatActivity = useCallback(() => {
    setRealtimePaused((paused) => (paused ? false : paused));
    armIdleTimer();
  }, [armIdleTimer]);

  // Reset any leftover pause when the tab blurs, so the next visit
  // starts live again.
  useEffect(() => {
    if (!isFocused) setRealtimePaused(false);
  }, [isFocused]);

  const flatListRef = useRef();
  const gifAllowed = true; // Always allow GIFs/emojis

  // Kept for the RTDB-fallback path (kill switch). Not used for writes.
  const chatRef = useMemo(() => ref(appdatabase, activeChannel.path), [activeChannel.path]);

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
      setMessages((prev) => {
        const next = [...pendingMessages, ...prev];
        return next.length > MAX_LIVE ? next.slice(0, MAX_LIVE) : next;
      });
      setPendingMessages([]); // Clear the queue
    }
  }, [isAtBottom, pendingMessages]);


  const INITIAL_PAGE_SIZE = 10; // first paint — older pages load on scroll
  const PAGE_SIZE = 10;         // pagination batch
  const PENDING_CAP = 50;
  // Cap the live in-memory list. Without this the array grows unbounded for
  // the whole session (every insert prepends), so per-event + render cost
  // climbs the longer the room stays open. Scrolling past this re-fetches
  // older pages from Supabase.
  const MAX_LIVE = 150;

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
    // Reset §4.1 recovery state for the new channel.
    newestCursorRef.current = null;
    retryQueueRef.current = [];
    lastRealtimeStatusRef.current = null;
    channelErrorAttemptsRef.current = 0;
    if (gapFillTimerRef.current) { clearTimeout(gapFillTimerRef.current); gapFillTimerRef.current = null; }
    if (channelRetryTimerRef.current) { clearTimeout(channelRetryTimerRef.current); channelRetryTimerRef.current = null; }
  }, [activeChannel.id]);

  // Initial channel load (mount + every switch).
  //
  // Supabase path: loadMessages pulls the last PAGE_SIZE rows in a
  // single round-trip with proper indexing on (room_id, created_at).
  // This is the new primary path now that mirror CFs are populating
  // messages live (12k+ rows accumulated within hours of deploy).
  //
  // RTDB fallback: if Supabase returns empty (e.g. read fails) we run
  // the original limitToLast() query. This also handles the pre-
  // migration case where Supabase has no rows yet.
  useEffect(() => {
    if (!activeChannel?.path) return;
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setLastLoadedKey(null);

        const bannedIds = Array.isArray(bannedUsers)
          ? bannedUsers.map(u => (typeof u === 'string' ? u : u?.id)).filter(Boolean)
          : [];

        // ── Supabase path ────────────────────────────────────────────
        if (SUPABASE_PUBLIC_CHAT_ENABLED) {
          try {
            const rows = await loadMessagesFromSupabase(activeChannel.path, { limit: INITIAL_PAGE_SIZE });
            if (cancelled) return;

            // Seed the gap-fill cursor from the newest loaded row (uuid + ts)
            // so the first reconnect resumes from here, not from the top.
            if (rows.length > 0 && rows[0]?.id) {
              newestCursorRef.current = {
                createdAt: new Date(rows[0].timestamp || Date.now()).toISOString(),
                id: rows[0].id,
              };
            }

            // Adapt Supabase row → UI shape that validateMessage expects.
            const parsed = rows
              .map((m) => {
                const v = validateMessage({
                  id: m.rtdbKey || m.id,
                  senderId: m.senderId,
                  text: m.text,
                  gif: m.gif,
                  fruits: m.fruits,
                  replyTo: m.replyTo,
                  OS: m.OS,
                  timestamp: m.timestamp,
                });
                // Carry the real Supabase uuid for the gap-free load-more cursor.
                // State `id` may be a legacy RTDB key, which can't anchor the
                // composite cursor against the uuid `id` column.
                if (v) v._sbId = m.id;
                return v;
              })
              .filter(Boolean)
              .filter(msg => msg?.senderId && !bannedIds.includes(msg.senderId));

            if (parsed.length > 0) {
              if (cancelled) return;
              setMessages(parsed);
              setLastLoadedKey(parsed[parsed.length - 1]?.id || null);
              return;
            }
            // Empty Supabase result → fall through to RTDB so the
            // pre-migration / cold-start scenario still loads.
          } catch (e) {
            // Network blip or auth race → fall through.
          }
        }

        // ── RTDB fallback (original code) ────────────────────────────
        if (!appdatabase) return;
        const currentRef = ref(appdatabase, activeChannel.path);
        const snapshot = await get(dbQuery(currentRef, orderByKey(), limitToLast(INITIAL_PAGE_SIZE)));
        if (cancelled) return;

        const data = snapshot.val() || {};
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

  // Real-time listener for new messages.
  //
  // Supabase path: subscribeToMessages opens a single Postgres realtime
  // channel filtered by room_id and emits one event per INSERT. Cuts
  // RTDB egress on the highest-traffic listener in the app.
  //
  // RTDB fallback: onValue(limitToLast(1)) — the original code, kept
  // intact for the kill switch and for ensuring messages from old app
  // versions (which write only to RTDB) still surface if the mirror CF
  // ever lags.
  //
  // Initial load + pagination are still on RTDB this phase — the
  // cursor semantics (RTDB push key vs Postgres timestamp) differ
  // enough that swapping that path is a separate, larger change.
  // Worst case here is some duplicate work on first page load, which
  // the dedup logic in setMessages handles.
  useEffect(() => {
    if (!appdatabase || !activeChannel?.path) return;

    // Cost gates: no subscription while the chat tab is blurred (user is on
    // Home/Values/etc. — the fan-out would be pure waste) or while idle-paused.
    // On refocus/resume the effect re-runs, re-subscribes, and the
    // onStatus → gap-fill path backfills anything missed.
    if (!isFocused || realtimePaused) return;

    let cancelled = false;

    // Shared "new message arrived" handler — fed by both code paths so
    // the UI logic (banned filter, cache warming, scroll-position
    // gate) is single-sourced.
    const onNewMessage = (newMessage, key) => {
      if (cancelled || !newMessage || !newMessage.id) return;

      const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
      if (banned.includes(newMessage.senderId)) return;

      if (newMessage.senderId && !getCachedProfile(newMessage.senderId)) {
        getOrFetchProfile(appdatabase, newMessage.senderId).then(() => {
          if (!cancelled) setMessages(prev => [...prev]);
        });
      }

      setMessages((prev) => {
        if (!Array.isArray(prev) || prev.length === 0) return [newMessage];
        const exists = prev.some((m) => String(m?.id) === String(newMessage.id));
        if (exists) return prev;

        if (isAtBottomRef.current) {
          newestMessageIdRef.current = key || newMessage.id;
          const next = [newMessage, ...prev];
          return next.length > MAX_LIVE ? next.slice(0, MAX_LIVE) : next;
        }
        setPendingMessages((prevPending) => {
          const pendingIds = new Set(prevPending.map((msg) => msg?.id).filter(Boolean));
          if (pendingIds.has(newMessage.id)) return prevPending;
          const nextPending = [newMessage, ...prevPending];
          // Cap so a long scrollback session can't grow pending unboundedly.
          return nextPending.length > PENDING_CAP ? nextPending.slice(0, PENDING_CAP) : nextPending;
        });
        return prev;
      });
    };

    // ── Supabase path ────────────────────────────────────────────────
    if (SUPABASE_PUBLIC_CHAT_ENABLED) {
      // Removes a message from both the live messages list and the
      // pending-messages queue. Used for soft-delete (UPDATE deleted=true)
      // and hard-delete (DELETE row).
      const removeFromState = (uiId) => {
        if (!uiId) return;
        setMessages((prev) => prev.filter((m) => m?.id !== uiId));
        setPendingMessages((prev) => prev.filter((m) => m?.id !== uiId));
      };

      // Advance the gap-fill cursor whenever a realtime row lands, so a later
      // reconnect resumes from the last thing we actually saw (uuid + ts).
      const advanceCursor = (msg) => {
        if (!msg?.id) return;
        const t = typeof msg?.timestamp === 'number' ? msg.timestamp : Date.now();
        const cur = newestCursorRef.current;
        if (!cur || new Date(cur.createdAt).getTime() < t) {
          newestCursorRef.current = { createdAt: new Date(t).toISOString(), id: msg.id };
        }
      };

      // Adapt a raw Supabase row → UI shape and route it through the shared
      // onNewMessage path (banned filter, cache warm, scroll-gate, dedup).
      // Use rtdbKey as the UI id when present so dedup against initial RTDB
      // page rows still works; carry the uuid as _sbId for the load-more cursor.
      const ingest = (msg) => {
        if (!msg) return;
        advanceCursor(msg);
        const adapted = validateMessage({
          id: msg.rtdbKey || msg.id,
          senderId: msg.senderId,
          text: msg.text,
          gif: msg.gif,
          fruits: msg.fruits,
          replyTo: msg.replyTo,
          OS: msg.OS,
          timestamp: msg.timestamp,
        });
        if (adapted) adapted._sbId = msg.id;
        onNewMessage(adapted, msg.rtdbKey || msg.id);
      };

      // Forward gap-fill: pull everything strictly newer than the cursor and
      // ingest it. onNewMessage dedups by id, so rows already on screen are
      // ignored — only the genuinely-missed INSERTs get added.
      const gapFillSince = async () => {
        const since = newestCursorRef.current;
        try {
          const rows = await loadMessagesSinceFromSupabase(activeChannel.path, since, { limit: 60 });
          if (cancelled || !rows.length) return;
          // Oldest-first so they stack in the right order via onNewMessage.
          for (let i = rows.length - 1; i >= 0; i--) ingest(rows[i]);
        } catch (e) {
          // Best-effort — a failed backfill just retries on the next reconnect.
        }
      };
      const scheduleGapFill = () => {
        if (gapFillTimerRef.current) clearTimeout(gapFillTimerRef.current);
        gapFillTimerRef.current = setTimeout(() => {
          gapFillTimerRef.current = null;
          gapFillSince();
        }, 400);
      };

      // Replay sends that failed while offline / wedged. Idempotent on
      // clientMsgId, so a row that actually landed just returns the existing
      // one; the result surfaces via ingest (and the INSERT echo is deduped).
      const flushRetryQueue = async () => {
        const queue = retryQueueRef.current;
        if (!queue.length) return;
        retryQueueRef.current = [];
        for (const item of queue) {
          try {
            const saved = await sbSendMessage(item.path, item.payload);
            if (!cancelled && saved) ingest(saved);
          } catch (e) {
            // Still failing — keep for the next reconnect, but cap attempts so
            // a poison send (e.g. RLS reject) can't loop on every reconnect.
            if ((item.attempts || 0) < 3) {
              retryQueueRef.current.push({ ...item, attempts: (item.attempts || 0) + 1 });
            }
          }
        }
      };

      let unsubscribe = () => {};
      const subscribeCallbacks = {
        onInsert: (msg) => { if (msg) ingest(msg); },
        onUpdate: (msg) => {
          // Soft-delete arrives as an UPDATE with deleted=true. Drop it
          // from state. Other UPDATEs are ignored (slim schema has no
          // editable fields the UI cares about today).
          if (msg?.deleted) removeFromState(msg.rtdbKey || msg.id);
        },
        onDelete: (id) => {
          // Hard-delete: row id is the Supabase UUID. The UI's id might be the
          // rtdbKey instead, so match on both the UI id and the carried _sbId.
          if (!id) return;
          setMessages((prev) => prev.filter((m) => m?.id !== id && m?._sbId !== id));
          setPendingMessages((prev) => prev.filter((m) => m?.id !== id && m?._sbId !== id));
        },
        onStatus: (status) => {
          const prev = lastRealtimeStatusRef.current;
          lastRealtimeStatusRef.current = status;

          if (status === 'SUBSCRIBED') {
            // Every fresh SUBSCRIBED (incl. the first) backfills the gap — on
            // cold-start the channel may have opened pre-auth and RLS dropped
            // INSERTs that landed in that window.
            if (prev !== 'SUBSCRIBED') {
              scheduleGapFill();
              flushRetryQueue();
            }
            channelErrorAttemptsRef.current = 0;
            return;
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            const attempts = channelErrorAttemptsRef.current;
            if (attempts >= 5) return; // give up — the warn log shows the cause
            channelErrorAttemptsRef.current = attempts + 1;
            const delay = Math.min(2000 * Math.pow(2, attempts), 30000);
            if (channelRetryTimerRef.current) clearTimeout(channelRetryTimerRef.current);
            channelRetryTimerRef.current = setTimeout(async () => {
              channelRetryTimerRef.current = null;
              // Hard-reset socket + refresh JWT before resubscribing, else the
              // new channel inherits the wedged WS + stale token and re-fails.
              await sbResetRealtimeAndAuth();
              if (!cancelled) setResubKey((k) => k + 1);
            }, delay);
          }
        },
      };

      // Start the idle countdown now that we're committing to a (billed)
      // subscription. Interaction re-arms it via registerChatActivity.
      armIdleTimer();

      // Pre-flight realtime auth so the channel JOIN carries a valid JWT.
      // supabase-js's connect-time auth is fire-and-forget; without this a
      // cold-start channel can join unauth and get rejected (InvalidJWTToken).
      sbEnsureRealtimeAuth().finally(() => {
        if (cancelled) return;
        unsubscribe = subscribeToMessages(activeChannel.path, subscribeCallbacks);
      });

      return () => {
        cancelled = true;
        unsubscribe();
        clearIdleTimer();
        hasInitializedRef.current = false;
        lastRealtimeStatusRef.current = null;
        if (gapFillTimerRef.current) { clearTimeout(gapFillTimerRef.current); gapFillTimerRef.current = null; }
        if (channelRetryTimerRef.current) { clearTimeout(channelRetryTimerRef.current); channelRetryTimerRef.current = null; }
      };
    }

    // ── RTDB fallback (original code) ────────────────────────────────
    const currentRef = ref(appdatabase, activeChannel.path);
    const latestQuery = dbQuery(currentRef, orderByKey(), limitToLast(1));

    const unsubscribe = onValue(latestQuery, (snapshot) => {
      if (cancelled || !snapshot.exists()) return;

      snapshot.forEach((childSnap) => {
        const key = childSnap.key;
        const data = childSnap.val();
        if (!key || !data || typeof data !== 'object') return;

        const newMessage = validateMessage({ id: key, ...data });
        onNewMessage(newMessage, key);
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
      hasInitializedRef.current = false;
    };
    // resubKey: bumped by the onStatus error path after a hard auth/socket
    // reset, so this effect tears down the wedged channel and opens a fresh one.
    // isFocused / realtimePaused: cost gates — see top of effect.
  }, [activeChannel.path, appdatabase, validateMessage, bannedUsers, resubKey, isFocused, realtimePaused, armIdleTimer, clearIdleTimer]);






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

    if (loading || !lastLoadedKey) return;

    // ── Supabase path ────────────────────────────────────────────────
    // messages is sorted newest-first, so the last element is the oldest
    // currently loaded — its timestamp is the `beforeMs` cursor.
    if (SUPABASE_PUBLIC_CHAT_ENABLED) {
      const oldest = messages[messages.length - 1];
      if (oldest?.timestamp) {
        try {
          const rows = await loadMessagesFromSupabase(activeChannel.path, {
            limit: PAGE_SIZE,
            // Gap-free composite cursor when we have the Supabase uuid (rows that
            // came from a Supabase load); fall back to timestamp-only for the rare
            // RTDB-fallback rows that have no uuid to anchor on.
            ...(oldest._sbId
              ? { before: { createdAt: new Date(oldest.timestamp).toISOString(), id: oldest._sbId } }
              : { beforeMs: oldest.timestamp }),
          });

          const bannedIds = Array.isArray(bannedUsers)
            ? bannedUsers.map(u => (typeof u === 'string' ? u : u?.id)).filter(Boolean)
            : [];
          const parsed = rows
            .map((m) => {
              const v = validateMessage({
                id: m.rtdbKey || m.id,
                senderId: m.senderId,
                text: m.text,
                gif: m.gif,
                fruits: m.fruits,
                replyTo: m.replyTo,
                OS: m.OS,
                timestamp: m.timestamp,
              });
              if (v) v._sbId = m.id;
              return v;
            })
            .filter(Boolean)
            .filter(msg => msg?.senderId && !bannedIds.includes(msg.senderId));

          if (parsed.length === 0) {
            setLastLoadedKey(null); // end of history
            return;
          }

          const senderIds = parsed.map(m => m.senderId).filter(Boolean);
          await warmProfileCache(appdatabase, senderIds);

          setMessages(prev => {
            const seen = new Set(prev.map(m => String(m?.id)));
            const fresh = parsed.filter(m => !seen.has(String(m.id)));
            return fresh.length ? [...prev, ...fresh] : prev;
          });
          setLastLoadedKey(parsed[parsed.length - 1]?.id || null);
          return;
        } catch (e) {
          // Fall through to RTDB on network blip / auth race.
        }
      }
    }

    // ── RTDB fallback (original code) ────────────────────────────────
    await loadMessages(false);
  }, [user?.id, signinMessage, loading, lastLoadedKey, loadMessages, t, messages, activeChannel.path, bannedUsers, validateMessage, appdatabase]);





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
    try {
      const bannedIds = Array.isArray(bannedUsers)
        ? bannedUsers.map(u => (typeof u === 'string' ? u : u?.id)).filter(Boolean)
        : [];

      const rows = await loadMessagesFromSupabase(activeChannel.path, { limit: INITIAL_PAGE_SIZE });
      const parsed = rows
        .map((m) => validateMessage({
          id: m.rtdbKey || m.id,
          senderId: m.senderId,
          text: m.text,
          gif: m.gif,
          fruits: m.fruits,
          replyTo: m.replyTo,
          OS: m.OS,
          timestamp: m.timestamp,
        }))
        .filter(Boolean)
        .filter(msg => msg?.senderId && !bannedIds.includes(msg.senderId));

      const senderIds = parsed.map(m => m.senderId).filter(Boolean);
      if (senderIds.length > 0) await warmProfileCache(appdatabase, senderIds);
      setMessages(parsed);
      setLastLoadedKey(parsed.length > 0 ? parsed[parsed.length - 1]?.id || null : null);
    } catch (e) {
      console.error('[handleRefresh] Supabase refresh failed:', e?.message || e);
    } finally {
      setRefreshing(false);
    }
  };

  // Pinned messages: load + realtime — both Supabase. We refetch on
  // any pin/unpin event for the room rather than reconciling individual
  // INSERT/DELETE payloads, since the pin row alone doesn't carry the
  // joined message content the UI needs.
  //
  // `firebaseKey` field name is preserved on each pinned-message object
  // for backward compatibility with AdminHeader.jsx + ChatHeaderContent.jsx
  // (they call onUnpinMessage(msg.firebaseKey)). It now holds the
  // Supabase pin-row id, not an RTDB push key.
  useEffect(() => {
    if (!activeChannel?.path) return;
    // Channel (and refetches) only while the tab is focused — pins change
    // rarely; the refetch on refocus keeps them current.
    if (!isFocused) return;

    let cancelled = false;

    const fetchPinned = async () => {
      try {
        const rows = await loadPinnedMessagesFromSupabase(activeChannel.path);
        if (cancelled) return;
        setPinnedMessages(
          (rows || []).map((p) => ({ ...p, firebaseKey: p.pinnedRowId })),
        );
      } catch (error) {
        console.error('Error loading pinned messages:', error);
      }
    };

    fetchPinned();

    const unsubPinned = subscribeToPinned(activeChannel.path, {
      onUpsert: () => { if (!cancelled) fetchPinned(); },
      onRemove: () => { if (!cancelled) fetchPinned(); },
    });

    return () => {
      cancelled = true;
      unsubPinned?.();
    };
  }, [activeChannel?.path, isFocused]);

  const handlePinMessage = async (message) => {
    if (!message?.id) {
      console.warn('handlePinMessage: message.id missing');
      return;
    }
    try {
      await sbPinMessage(activeChannel.path, message.id, user?.id ?? null);
      // realtime sub triggers fetchPinned; no manual state update needed
    } catch (error) {
      console.error('Error pinning message:', error);
      Alert.alert(t('home.alert.error'), t('chat.pin_error'));
    }
  };

  const unpinSingleMessage = async (pinId) => {
    if (!pinId) return;
    try {
      await sbUnpinMessage(pinId);
      setPinnedMessages((prev) => prev.filter((msg) => msg.firebaseKey !== pinId));
    } catch (error) {
      console.error('Error unpinning message:', error);
      Alert.alert(t('home.alert.error'), t('chat.unpin_error'));
    }
  };

  const clearAllPinnedMessages = async () => {
    try {
      await sbClearPinnedForRoom(activeChannel.path);
      setPinnedMessages([]);
    } catch (error) {
      console.error('Error clearing pinned messages:', error);
      Alert.alert(t('home.alert.error'), t('chat.clear_pins_error'));
    }
  };

  const handleSendMessage = async (replyToArg, trimmedInputArg, fruits, emojiUrl) => {
    // Sending is interaction — resume/extend the live realtime window.
    registerChatActivity();
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

    // Block banned users from sending (admins exempt). Defer expiry to
    // server-time-validated `isUserBlocked` so a clock-rolled device
    // can't slip past — strikeInfo is used only for the message text.
    if (isUserBlocked && !isAdmin) {
      const { strikeCount, bannedUntil } = strikeInfo || {};

      if (bannedUntil === 'permanent') {
        showMessage({
          message: '⛔ Permanently Banned',
          description: 'You are permanently banned from sending messages.',
          type: 'danger',
        });
        return false;
      }

      if (typeof bannedUntil === 'number') {
        const remaining = Math.max(0, bannedUntil - Date.now());
        const totalMinutes = Math.ceil(remaining / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        showMessage({
          message: `⚠️ Strike ${strikeCount ?? ''}`.trim(),
          description: `You are banned from chatting for ${timeLeftText} more minute(s).`,
          type: 'warning',
          duration: 5000,

        });
        return false;
      }

      showMessage({ message: '⛔ Banned', description: 'You are currently banned from sending messages.', type: 'danger' });
      return false;
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

    // SLIM MESSAGE: only message-specific fields. Sender profile
    // (avatar, badges, cosmetics) is resolved client-side from profileCache
    // on render — not snapshotted here. The clientMsgId is generated ONCE and
    // reused by the offline retry path, so a row that actually landed before
    // the socket dropped is returned (UNIQUE(room_id, client_msg_id)) instead
    // of duplicated.
    const sendPayload = {
      clientMsgId: newClientMsgId(),
      senderId: user.id,
      text: trimmedInput || null,
      replyTo: replyToArg
        ? { id: replyToArg.id, text: replyToArg.text }
        : null,
      fruits: hasFruits ? fruits : [],
      gif: hasEmoji ? emojiUrl : null,
      OS: Platform.OS,
    };

    try {
      await sbSendMessage(activeChannel.path, sendPayload);

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
      // §4.1 offline send queue: keep the message and replay it (idempotent on
      // clientMsgId) when the realtime channel next reconnects, instead of
      // dropping it. Set the dup-guard + clear input so a manual re-send can't
      // race the auto-retry into a duplicate. flushRetryQueue (realtime effect)
      // drains this on SUBSCRIBED and caps attempts so a poison send can't loop.
      retryQueueRef.current.push({ path: activeChannel.path, payload: sendPayload, attempts: 0 });
      lastSentMessageRef.current = currentMessage;
      setInput('');
      setReplyTo(null);
      showMessage({
        message: 'Offline',
        description: "Your message will send automatically when you're back online.",
        type: 'warning',
        duration: 3000,
      });
      return true;
    }
  };

  // console.log(user.flage)
  return (
    <>
      <GestureHandlerRootView>

        <View style={styles.container} onTouchStart={registerChatActivity}>
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
                onDeleteMessage={async (messageId) => {
                  if (!messageId) return;
                  try {
                    // UI ids are either Supabase UUIDs (new direct writes)
                    // or legacy RTDB push keys (mirror-CF rows where the
                    // dedup logic preferred rtdb_key). Detect by format
                    // and route to the right soft-delete helper.
                    const isUuid =
                      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId);
                    if (isUuid) {
                      await sbSoftDeleteMessage(messageId, user?.id ?? null);
                    } else {
                      await sbSoftDeleteMessageByRtdbKey(activeChannel.path, messageId, user?.id ?? null);
                    }
                    setMessages((prev) => prev.filter((m) => m?.id !== messageId));
                  } catch (e) {
                    console.error('softDelete failed:', e?.message || e);
                  }
                }}
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
                pendingCount={pendingMessages.length}
                // toggleDrawer={toggleDrawer}
                setMessages={setMessages}
                isAdmin={isAdmin}
                toggleDrawer={openProfileDrawer}
                chatPath={activeChannel.path}
              />
            )}


            {realtimePaused && (
              <TouchableOpacity
                onPress={registerChatActivity}
                activeOpacity={0.85}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  backgroundColor: config.colors.primary,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                  ⏸  {t('chat.paused_resume', { defaultValue: 'Live chat paused to save data — tap to resume' })}
                </Text>
              </TouchableOpacity>
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
