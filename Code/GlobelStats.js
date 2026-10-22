import {trackGrowthEvent} from './Helper/growthAnalytics';
import { fetchCatalog, refreshCatalog, usableCatalog, withDeadline } from './Helper/catalogNetwork';
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getApps } from '@react-native-firebase/app';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { ref, set, update, get, onDisconnect, getDatabase, onValue } from '@react-native-firebase/database';
import { getFirestore } from '@react-native-firebase/firestore';
import { createNewUser, firebaseConfig, registerForNotifications } from './Globelhelper';
import { useLocalState } from './LocalGlobelStats';
import { requestPermission } from './Helper/PermissionCheck';
import { useColorScheme, AppState, Alert } from 'react-native';
import { clearUserCache } from './Helper/UserDataCache';
import { generateOnePieceUsername } from './Helper/RendomNamegen';
import { getDeviceFingerprint } from './Helper/deviceFingerprint';
import { getServerTime, warmServerTime, serverNowMs } from './Helper/serverTime';
import { encodeEmailKey, isMuteRecord } from './Helper/banKeys';
import { setCurrentUserOwner } from './Helper/ownerFlag';
import * as chatBackend from './Supabase/chatBackend';
import i18n from 'i18next';
import { setLastActivity } from './Supabase/userBackend';
import { saveOwnEmailOnce, saveOwnDeviceIdOnce } from './Helper/privateProfile';
import Purchases from 'react-native-purchases';
import { getAnalytics, logEvent } from '@react-native-firebase/analytics';
import { createMMKV } from 'react-native-mmkv';

// MMKV mirror of the `proGranted` React state for the ad singletons
// (Code/Ads/IntAd.js, Code/Ads/openApp.js), which read MMKV rather than React
// context. Before this mirror, a user whose Pro came from an RTDB purchase
// (not the RevenueCat `isPro` flag) still got interstitials and app-open ads.
// Same default-instance pattern as LocalGlobelStats.js.
let proFlagStorage = null;
try { proFlagStorage = createMMKV(); } catch (_) {}

// registerForNotifications used to run three times per cold start (login
// handler, user-id effect, auth listener). Run it once per uid per sign-in;
// the APNS/FCM retry logic inside Globelhelper is untouched. The set is
// cleared on sign-out so a re-login registers again.
const notificationsRegisteredFor = new Set();
const registerForNotificationsOnce = async (uid) => {
  if (!uid || notificationsRegisteredFor.has(uid)) return;
  notificationsRegisteredFor.add(uid);
  try {
    await registerForNotifications(uid);
  } catch (e) {
    // Let a later trigger retry if this attempt failed outright.
    notificationsRegisteredFor.delete(uid);
  }
};
// ── Startup instrumentation (2026-09-21) ────────────────────────────────
// Ported from adoptme-jan7; see HANDOFF_2026-09-21.md there.
//
// `am start -W` measures time to FIRST DRAW, which is only the splash
// appearing. What users call "slow to open" is the time until isAppReady flips
// and the real UI renders, which sits behind the auth + profile work below.
// Nothing has ever measured that in this app.
//
// Sent to Analytics rather than Crashlytics deliberately: a Crashlytics log is
// a breadcrumb visible only if that session later crashes, which is a useless
// sample for typical startup time. Analytics aggregates across all users.
const _launchedAt = Date.now();
const logStartupTiming = (name, params) => {
  try {
    logEvent(getAnalytics(), name, params);
  } catch (_) {}
};

// ── Ban / mute state helpers ─────────────────────────────────────────────
// Three RTDB sources can restrict the signed-in user: banned_users_by_email
// (by encodeEmailKey), banned_uids/{uid} and banned_devices/{fingerprint}.
// Email and uid records are either bans or mutes (isMuteRecord); device
// records are always bans. A mute is chat-only, a ban blocks everything
// (MODERATION_CONTRACT §4).
const DAY_MS = 24 * 60 * 60 * 1000;
// How long content creation waits for the ban listeners on a fresh sign-in
// before falling back to the last-known (cached) state.
const BAN_CHECK_TIMEOUT_MS = 5000;
const BAN_CACHE_KEY = 'modState.lastKnown';

const recordUntilMs = (rec) => {
  if (rec?.bannedUntil === 'permanent') return Infinity;
  return typeof rec?.bannedUntil === 'number' ? rec.bannedUntil : 0;
};
// Permanent beats timed; among timed records the latest expiry wins.
const pickRecord = (records) =>
  records.reduce((best, r) => (r && (!best || recordUntilMs(r) > recordUntilMs(best)) ? r : best), null);
const isRecordLive = (rec) => !!rec && recordUntilMs(rec) > serverNowMs();

// Subscribes to one ban record and reports `{ record, active }` each time the
// record changes or its expiry passes. `active` is decided against
// authoritative server time (getServerTime probe), and a setTimeout
// (monotonic, immune to wall-clock changes) re-evaluates when a timed record
// expires; AppState 'active' re-probes so a clock changed while backgrounded
// is caught. A read error reports "no record" (rules not deployed / offline).
const watchBanRecord = (db, path, getProbeUid, onState) => {
  let cancelled = false;
  let current = null;
  let expiryTimer = null;

  const evaluate = async () => {
    if (cancelled) return;
    if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }
    const rec = current;
    if (!rec || (rec.bannedUntil !== 'permanent' && typeof rec.bannedUntil !== 'number')) {
      onState({ record: null, active: false });
      return;
    }
    if (rec.bannedUntil === 'permanent') {
      onState({ record: rec, active: true });
      return;
    }
    let serverNow;
    try {
      serverNow = (await getServerTime(db, getProbeUid())).getTime();
    } catch (_) {
      serverNow = serverNowMs();
    }
    if (cancelled || current !== rec) return;
    const remaining = rec.bannedUntil - serverNow;
    if (remaining <= 0) {
      onState({ record: null, active: false });
      return;
    }
    onState({ record: rec, active: true });
    // Cap the timer at ~24h so long bans don't sit on a stale offset.
    expiryTimer = setTimeout(evaluate, Math.min(remaining, DAY_MS));
  };

  const unsubscribe = onValue(
    ref(db, path),
    (snapshot) => {
      current = snapshot.val() || null;
      evaluate();
    },
    () => {
      current = null;
      evaluate();
    }
  );
  const appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') evaluate();
  });

  return () => {
    cancelled = true;
    if (expiryTimer) clearTimeout(expiryTimer);
    appStateSub.remove();
    unsubscribe();
  };
};

const tr = (key, defaultValue, opts) => {
  try {
    return i18n.t(key, { defaultValue, ...opts });
  } catch (_) {
    return defaultValue;
  }
};

// "2d 3h" / "1h 5m" / "12m" until `untilMs`, on the server clock. Never
// shows less than 1m: the gate already decided the record is active.
export const formatBanTimeLeft = (untilMs) => {
  const remaining = Math.max(60000, (Number(untilMs) || 0) - serverNowMs());
  const totalMinutes = Math.ceil(remaining / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return tr('home.globel_stats.time_days_hours', '{{days}}d {{hours}}h', { days, hours });
  if (hours > 0) return tr('home.globel_stats.time_hours_minutes', '{{hours}}h {{minutes}}m', { hours, minutes });
  return tr('home.globel_stats.time_minutes', '{{minutes}}m', { minutes });
};

const MOD_ACTION_TEXT = {
  chat: ['moderation.action_chat', 'send messages'],
  post: ['moderation.action_post', 'post'],
  comment: ['moderation.action_comment', 'comment'],
  trade: ['moderation.action_trade', 'create trades'],
  feature: ['moderation.action_feature', 'feature trades'],
  report: ['moderation.action_report', 'make reports'],
  profile: ['moderation.action_profile', 'edit your profile'],
  review: ['moderation.action_review', 'write reviews'],
  vote: ['moderation.action_vote', 'vote in polls'],
  react: ['moderation.action_react', 'react to posts'],
  follow: ['moderation.action_follow', 'follow people'],
  group: ['moderation.action_group', 'manage groups'],
  server: ['moderation.action_server', 'share servers'],
};

// Title + body for a gate returned by getModGate(). `action` is a
// MOD_ACTION_TEXT key describing what the user tried to do.
export const modGateText = (gate, action) => {
  if (!gate) return null;
  if (gate.kind === 'checking') {
    return {
      title: tr('moderation.checking_title', 'One moment'),
      message: tr('moderation.checking_body', 'Checking your account status. Please try again in a few seconds.'),
    };
  }
  const [actionKey, actionDefault] = MOD_ACTION_TEXT[action] || ['moderation.action_generic', 'do this'];
  const actionText = tr(actionKey, actionDefault);
  const info = gate.info || {};
  const permanent = info.bannedUntil === 'permanent';
  const time = typeof info.bannedUntil === 'number' ? formatBanTimeLeft(info.bannedUntil) : null;
  if (gate.kind === 'muted') {
    return {
      title: tr('moderation.muted_title', 'Muted'),
      message: time
        ? tr('moderation.muted_body', 'You are muted in chat for {{time}} more.', { time })
        : tr('moderation.muted_body_generic', 'You are muted in chat.'),
    };
  }
  let title;
  if (permanent) title = tr('moderation.banned_perm_title', 'Permanently banned');
  else if (info.strikeCount) title = tr('moderation.banned_strike_title', 'Strike {{n}}', { n: info.strikeCount });
  else title = tr('moderation.banned_title', 'Banned');
  let message;
  if (permanent) {
    message = tr('moderation.banned_perm_body', 'Your account is permanently banned, so you can\'t {{action}}.', { action: actionText });
  } else if (time) {
    message = tr('moderation.banned_body', 'You are banned for {{time}} more, so you can\'t {{action}} until then.', { time, action: actionText });
  } else {
    message = tr('moderation.banned_body_generic', 'You are banned, so you can\'t {{action}} right now.', { action: actionText });
  }
  return { title, message };
};

// Machine-readable reason for a rejected Supabase chat write
// ('SENDER_BANNED' | 'LINKS_NOT_ALLOWED' | 'NOT_ALLOWED' | null). Prefers the
// backend's chatErrorCode() when present; falls back to the error text.
export const chatSendErrorCode = (error) => {
  try {
    if (typeof chatBackend.chatErrorCode === 'function') {
      const code = chatBackend.chatErrorCode(error);
      if (code) return code;
    }
  } catch (_) {}
  const msg = String(error?.message || error?.details || '');
  if (/SENDER_BANNED/.test(msg)) return 'SENDER_BANNED';
  if (/LINKS_NOT_ALLOWED/.test(msg)) return 'LINKS_NOT_ALLOWED';
  if (/NOT_ALLOWED/.test(msg)) return 'NOT_ALLOWED';
  if (error?.code === '23514') return 'NOT_ALLOWED';
  return null;
};

// User-facing text for a chatSendErrorCode() result; null for other errors.
export const chatSendErrorText = (code) => {
  if (code === 'SENDER_BANNED') {
    return {
      title: tr('moderation.send_blocked_title', 'Message not sent'),
      message: tr('moderation.send_banned_body', 'You are banned or muted, so your messages can\'t be sent right now.'),
    };
  }
  if (code === 'LINKS_NOT_ALLOWED') {
    return {
      title: tr('moderation.send_blocked_title', 'Message not sent'),
      message: tr('moderation.send_links_body', 'Links are not allowed in messages.'),
    };
  }
  if (code === 'NOT_ALLOWED') {
    return {
      title: tr('moderation.send_blocked_title', 'Message not sent'),
      message: tr('moderation.send_not_allowed_body', 'This message isn\'t allowed here.'),
    };
  }
  return null;
};

const app = getApps();
const auth = getAuth(app);
const firestoreDB = getFirestore(app);
const appdatabase = getDatabase(app);
const GlobalStateContext = createContext();

// Custom hook to access global state
export const useGlobalState = () => useContext(GlobalStateContext);

export const GlobalStateProvider = ({ children }) => {
  const { localState, updateLocalState } = useLocalState()

  const colorScheme = useColorScheme(); // 'light' or 'dark'

  const resolvedTheme = localState.theme === 'system' ? colorScheme : localState.theme;
  const [theme, setTheme] = useState(resolvedTheme);
  const [api, setApi] = useState(null);
  const [freeTranslation, setFreeTranslation] = useState(null);
  const [proGranted, setProGranted] = useState(false)
  const [currentUserEmail, setCurrentuserEmail] = useState('')
  const [single_offer_wall, setSingle_offer_wall] = useState(false)
  const [tradingServerLink, setTradingServerLink] = useState(null); // Trading server link from admin servers






  const [isAdmin, setIsAdmin] = useState(false);
  const [isSeniorMod, setIsSeniorMod] = useState(false); // ✅ Global Senior Mod State (one rank below Admin)
  const [isModerator, setIsModerator] = useState(false); // ✅ Global Moderator State
  const [isBabyMod, setIsBabyMod] = useState(false); // ✅ Global JMD State
  const [isTrusted, setIsTrusted] = useState(false); // ✅ Global Trusted State
  const [isGrinder, setIsGrinder] = useState(false); // ✅ Global Grinder State
  const [isRaider, setIsRaider] = useState(false); // ✅ Global Raider State
  const [isHelper, setIsHelper] = useState(false); // Cosmetic Helper badge (no staff powers)
  // Staff Access grants (Admin Dashboard → Staff → Staff access): RTDB
  // /jmd_granters/{uid} and /mod_granters/{uid} = true let this account
  // appoint / remove JMDs or Mods, and nothing else (database.rules.json
  // checks the same). Ported from adoptme-jan7's canGrantJmd, 2026-10-22.
  const [canGrantJmd, setCanGrantJmd] = useState(false);
  const [canGrantMod, setCanGrantMod] = useState(false);
  const [isInActiveGame, setIsInActiveGame] = useState(false); // ✅ Track if user is in active game
  const [user, setUser] = useState({
    id: null,
    selectedFruits: [],
    isReminderEnabled: false,
    isSelectedReminderEnabled: false,
    displayName: '',
    avatar: null,
    rewardPoints: 0,
    isBlock: false,
    fcmToken: null,
    lastActivity: null,
    online: false,
    isPro: false,
    coins: null,
    createdAt: null


  });

  const [onlineMembersCount, setOnlineMembersCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [catalogStatus, setCatalogStatus] = useState('ready');
  const [proTagBought, setProTagBought] = useState(false);
  const [stockNotifierPurchase, setStockNotifierPurchase] = useState(false);
  // Ban listener results. Each is tagged with the identity it was read for
  // (email key / uid) so a sign-out or account switch can never show one
  // user's ban state to the next; a result for another identity counts as
  // "not resolved yet".
  // banned_users_by_email/{encodeEmailKey(email)}
  const [emailBanState, setEmailBanState] = useState({ key: null, record: null, active: false });
  // banned_uids/{uid}: server-written uid ban (functions/banEnforcement.js).
  // Covers accounts with no email (phone sign-in), deleted-and-recreated
  // accounts, and alts caught on a banned device.
  const [uidBanState, setUidBanState] = useState({ uid: null, record: null, active: false });
  // banned_devices/{fp}: always a ban. The payload carries the email + userId
  // of the ORIGINAL banned account, which the ban card uses to show "your
  // associated account is banned" copy.
  const [deviceBanState, setDeviceBanState] = useState({ resolved: false, record: null, active: false });

  // const [robloxUsername, setRobloxUsername] = useState('');
  const robloxUsernameRef = useRef('');


  // Track theme changes
  useEffect(() => {
    setTheme(localState.theme === 'system' ? colorScheme : localState.theme);
  }, [localState.theme, colorScheme]);

  // const isAdmin = user?.id  ? user?.id == '3CAAolfaX3UE3BLTZ7ghFbNnY513' : false
  // console.log(isAdmin, user)

  // const updateLocalStateAndDatabase = async (keyOrUpdates, value) => {
  //   if (!user.id) return; // Prevent updates if user is not logged in

  //   try {
  //     const userRef = ref(appdatabase, `users/${user.id}`);
  //     let updates = {};

  //     if (typeof keyOrUpdates === 'string') {
  //       // Single update
  //       updates = { [keyOrUpdates]: value };
  //     } else if (typeof keyOrUpdates === 'object') {
  //       // Batch update
  //       updates = keyOrUpdates;
  //     } else {
  //       throw new Error('Invalid arguments for update.');
  //     }

  //     // ✅ Update local state
  //     setUser((prev) => ({ ...prev, ...updates }));


  //     // ✅ Update Firebase database
  //     await update(userRef, updates);
  //   } catch (error) {
  //     console.error('Error updating user state or database:', error);
  //   }
  //   // };



  useEffect(() => {
    if (!user?.id || !user?.purchases || typeof user.purchases !== 'object') return;

    const now = Date.now();

    const proTagPurchase = Object.values(user.purchases || {}).find(p => p?.id === 0);
    const isProTagValid = proTagPurchase && proTagPurchase.expiresAt > now;
    setProTagBought(isProTagValid);

    const stockNotifierPurchase = Object.values(user.purchases || {}).find(p => p?.id === 4);
    const isStockNotifierValid = stockNotifierPurchase && stockNotifierPurchase.expiresAt > now;
    setStockNotifierPurchase(isStockNotifierValid);

    const isProActive = Object.values(user.purchases || {}).some(p => {
      if (!p || !p.title) return false;
      const { title, expiresAt } = p;
      const isPro = title === 'Pro Membership (Weekly)' || title === 'Pro Membership (Monthly)';
      return isPro && expiresAt && expiresAt > now;
    });

    setProGranted(isProActive);
    try { proFlagStorage?.set('proGranted', !!isProActive); } catch (_) {}
  }, [user?.id, user?.purchases]);
  // console.log('user', user)

  // console.log('bought', proTagBought)

  // ✅ OPTIMIZED: Debounce helper for non-critical updates
  const debounceTimeoutRef = useRef(null);
  const pendingUpdatesRef = useRef({});
  // Last isPro value known to be in RTDB (users/{uid} read at login, or our own
  // last write) so updateUserProStatus only writes when the value changes.
  const lastKnownIsProRef = useRef({ uid: null, value: undefined });

  // ✅ Critical fields that should update immediately (no debounce)
  const CRITICAL_FIELDS = ['rewardPoints', 'isBlock', 'fcmToken', 'email', 'isPro'];

  // ✅ Memoize updateLocalStateAndDatabase to prevent recreation and reduce re-renders
  const updateLocalStateAndDatabase = useCallback(async (keyOrUpdates, value) => {
    try {
      let updates = {};

      if (typeof keyOrUpdates === 'string') {
        updates = { [keyOrUpdates]: value };
      } else if (typeof keyOrUpdates === 'object') {
        updates = keyOrUpdates;
      } else {
        throw new Error('Invalid arguments for update.');
      }

      // Update AsyncStorage (localState) only for top-level keys
      for (const [key, val] of Object.entries(updates)) {
        if (!key.includes('/')) {
          await updateLocalState(key, val);
        }
      }

      // ✅ Update in-memory user state immediately (always)
      setUser((prev) => {
        // ✅ Check if updates are actually different to prevent duplicate writes
        const hasChanges = Object.keys(updates).some(key => prev[key] !== updates[key]);
        if (!hasChanges && prev?.id) {
          // No changes, skip Firebase write
          return prev;
        }

        const updatedUser = { ...prev, ...updates };

        // ✅ Separate critical and non-critical updates
        const criticalUpdates = {};
        const nonCriticalUpdates = {};

        Object.keys(updates).forEach(key => {
          if (key === 'online') {
            // Skip online field (handled separately)
            return;
          }
          if (CRITICAL_FIELDS.includes(key)) {
            criticalUpdates[key] = updates[key];
          } else {
            nonCriticalUpdates[key] = updates[key];
          }
        });

        // ✅ Write critical fields immediately to Firebase
        if (prev?.id && appdatabase && Object.keys(criticalUpdates).length > 0) {
          const userRef = ref(appdatabase, `users/${prev.id}`);
          update(userRef, criticalUpdates).catch((error) => {
            // Silently handle Firebase errors
          });
        }

        // ✅ Merge non-critical updates into pending batch for debouncing
        if (Object.keys(nonCriticalUpdates).length > 0) {
          Object.assign(pendingUpdatesRef.current, nonCriticalUpdates);

          // ✅ Clear existing debounce timer
          if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
          }

          // ✅ Set new debounce timer (500ms)
          debounceTimeoutRef.current = setTimeout(() => {
            const pending = { ...pendingUpdatesRef.current };
            pendingUpdatesRef.current = {};

            if (Object.keys(pending).length === 0) return;

            // Get current user ID from state (use closure)
            setUser((currentUser) => {
              if (!currentUser?.id || !appdatabase) return currentUser;

              const userRef = ref(appdatabase, `users/${currentUser.id}`);
              update(userRef, pending).catch((error) => {
                // Silently handle Firebase errors
              });

              return currentUser;
            });
          }, 500); // 500ms debounce delay
        }

        return updatedUser;
      });
    } catch (error) {
      console.error('❌ Error updating user state or database:', error);
    }
  }, [appdatabase, updateLocalState]); // ✅ Memoize with dependencies

  // console.log(user)
  // console.log(robloxUsernameRef?.current, 'robloxUsername_outside')


  // ✅ Memoize resetUserState to prevent unnecessary re-renders
  const resetUserState = useCallback(() => {
    setUser({
      id: null,
      selectedFruits: [],
      isReminderEnabled: false,
      isSelectedReminderEnabled: false,
      displayName: '',
      avatar: null,
      rewardPoints: 0,
      isBlock: false,
      fcmToken: null,
      lastActivity: null,
      online: false,
      isPro: false,
      coins: null,
      createdAt: null


    });
  }, []); // No dependencies, so it never re-creates

  // Uid whose data is loaded into this provider (null when signed out). Used
  // to spot an account switch that arrives without a null auth callback.
  const loadedUidRef = useRef(null);

  // Drop everything tied to the previous account: identity, email (which
  // drives the email-ban listener) and every role flag. Ban listener state is
  // keyed by identity, so it stops applying as soon as user/email change.
  const clearSignedInState = useCallback(() => {
    loadedUidRef.current = null;
    resetUserState();
    setCurrentuserEmail('');
    setCurrentUserOwner(null, false);
    setIsAdmin(false);
    setIsSeniorMod(false);
    setIsModerator(false);
    setIsBabyMod(false);
    setIsTrusted(false);
    setIsGrinder(false);
    setIsRaider(false);
    setIsHelper(false);
    setEmailBanState({ key: null, record: null, active: false });
    setUidBanState({ uid: null, record: null, active: false });
  }, [resetUserState]);

  // ✅ Memoize handleUserLogin
  const handleUserLogin = useCallback(async (loggedInUser) => {
    if (!loggedInUser) {
      notificationsRegisteredFor.clear();
      lastKnownIsProRef.current = { uid: null, value: undefined };
      // The ad managers read this flag from MMKV; a signed-out device must not
      // keep the previous user's granted Pro suppressing ads.
      try { proFlagStorage?.set('proGranted', false); } catch (_) {}
      clearSignedInState();
      // ✅ Clear user data cache on logout
      clearUserCache();
      return;
    }

    // ✅ Block unverified email/password users from entering the app.
    // Firebase auto-signs-in users immediately after createUserWithEmailAndPassword,
    // so onAuthStateChanged fires BEFORE signOut() is called in SigninDrawer.
    // This guard prevents that race condition from granting unverified users access.
    const isEmailProvider = loggedInUser.providerData?.some(
      (p) => p.providerId === 'password'
    );
    if (isEmailProvider && !loggedInUser.emailVerified) {
      return; // SigninDrawer will call signOut() — wait for the null callback
    }
    try {
      const userId = loggedInUser.uid;
      // Account switch without a sign-out in between: clear A's identity,
      // email and roles before B's data loads so B never inherits them.
      if (loadedUidRef.current && loadedUidRef.current !== userId) {
        clearSignedInState();
      }
      loadedUidRef.current = userId;
      const userRef = ref(appdatabase, `users/${userId}`);

      // console.log(snapshot, userId, 'userData', userRef)

      // 🔄 Fetch user data
      const snapshot = await get(userRef);
      let userData;
      let isNewRecord = false;

      setCurrentuserEmail(loggedInUser.email)

      if (snapshot.exists()) {
        const existing = snapshot.val();

        // ✅ Owner: users/{uid}/owner, written only by the server
        // (functions/reconcileRolesMirror.js). No owner emails in the app;
        // the owner gets the admin screens too.
        setCurrentUserOwner(userId, existing.owner === true);
        if (existing.owner === true) setIsAdmin(true);

        // ✅ Check if user is Senior Mod from DB (one rank below Admin).
        // Senior Mod is granted in-app via the Admin dashboard (makeSeniorMod),
        // no hardcoded bootstrap — RTDB users/{uid}/isSeniorMod is the source of truth.
        if (existing.isSeniorMod) setIsSeniorMod(true);
        // ✅ Check if user is moderator from DB
        if (existing.isModerator) setIsModerator(true);
        // ✅ Also check admin from DB if not hardcoded
        if (existing.admin || existing.isAdmin) setIsAdmin(true);
        // ✅ Check if user is JMD (Baby Mod)
        if (existing.isBabyMod) setIsBabyMod(true);
        // ✅ Check if user is Trusted
        if (existing.isTrusted) setIsTrusted(true);
        // ✅ Check if user is Grinder
        if (existing.isGrinder) setIsGrinder(true);
        // ✅ Check if user is Raider
        if (existing.isRaider) setIsRaider(true);
        // Helper: cosmetic badge only, never a staff gate
        if (existing.isHelper) setIsHelper(true);

        // 🩹 Heal bad displayNames ('Anonymous', empty, or missing) left by the
        // registration race condition or any other cause
        const isBadName = !existing.displayName ||
          existing.displayName.trim() === '' ||
          existing.displayName.trim() === 'Anonymous';

        const healedDisplayName = isBadName
          ? (loggedInUser.displayName || generateOnePieceUsername())
          : existing.displayName;

        if (isBadName) {
          await update(userRef, { displayName: healedDisplayName });
        }

        userData = {
          ...existing,
          id: userId,
          displayName: healedDisplayName,
          createdAt: existing.createdAt || Date.now(),
          // Own email comes from Firebase Auth only. It is kept in memory but no
          // longer written to users/{uid} (publicly readable) — it goes to
          // users_private/{uid} below. The old "self-heal" write is gone.
          email: loggedInUser.email || null,
        };

      } else {
        // console.log(robloxUsernameRef?.current, 'robloxUsername_inside')
        const newRecord = {
          ...createNewUser(userId, loggedInUser, robloxUsernameRef?.current),
          createdAt: Date.now(),
        };

        // ✅ No email in the public record — see users_private below.
        await set(userRef, newRecord);
        isNewRecord = true;
        userData = { ...newRecord, email: loggedInUser.email || null };
      }
      // console.log(userData, 'user')
      setUser(userData);

      // Own email → users_private/{uid} (owner + staff readable only). Fire-and-
      // forget: sign-in never waits on it, and a failure can't abort login the
      // way the old awaited users/{uid} email write could. Phone accounts have
      // no auth email and are skipped.
      if (loggedInUser.email) {
        saveOwnEmailOnce(appdatabase, userId, loggedInUser.email, { force: isNewRecord }).catch(() => {});
      }

      lastKnownIsProRef.current = {
        uid: userId,
        value: typeof userData?.isPro === 'boolean' ? userData.isPro : undefined,
      };

      // Record this device's fingerprint on users_private/{uid} (owner + staff
      // only). The server indexes it to link alt accounts and carry bans to
      // every device an account uses. Best-effort: sign-in never waits on it.
      getDeviceFingerprint().then((fp) => {
        if (fp) saveOwnDeviceIdOnce(appdatabase, userId, fp).catch(() => {});
      }).catch(() => {});

      // 🔥 Refresh and update FCM token
      await Promise.all([registerForNotificationsOnce(userId)]);

    } catch (error) {
      console.error("❌ Auth state change error:", error);
    }
  }, [appdatabase, clearSignedInState]); // ✅ Uses memoized clearSignedInState

  useEffect(() => {
    if (!user?.id) return;

    const run = async () => {
      try {
        // console.log('Registering push token for user:', user.id);
        await registerForNotificationsOnce(user.id);
      } catch (e) {
        // console.log('registerForNotifications error', e);
      }
    };

    run();
  }, [user?.id]);


  // ✅ Ensure useEffect runs only when necessary
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (loggedInUser) => {
      requestIdleCallback(async () => {
        await handleUserLogin(loggedInUser);

        if (loggedInUser?.uid) {
          await registerForNotificationsOnce(loggedInUser.uid);
          // await requestPermission();
        }

        // Bind RevenueCat user to the Firebase UID so webhook events
        // carry an `app_user_id` we can map back to a Firebase user.
        // Without this, RC uses anonymous IDs and the webhook can't
        // update the right `users/{uid}/isPro` record.
        try {
          if (loggedInUser?.uid) {
            await Purchases.logIn(loggedInUser.uid);
          } else if (!(await Purchases.isAnonymous())) {
            await Purchases.logOut();
          }
        } catch (e) {
          // RC throws if not yet configured or if logging out anonymous —
          // both are non-fatal; the next auth transition will retry.
        }

        // Time-to-interactive: process start -> splash hide.
        logStartupTiming('startup_ready', { ms: Date.now() - _launchedAt });
        await updateLocalState('isAppReady', true);
      }, { timeout: 1000 });
    });

    return () => unsubscribe();
  }, []);


  useEffect(() => {
    const fetchAPIKeys = async () => {
      try {
        const apiRef = ref(appdatabase, 'api');
        const paywallSecondOnlyFlagRef = ref(appdatabase, 'single_offer_wall');
        const freeRef = ref(appdatabase, 'free_translation');

        const [snapshotApi, paywallSecondOnlyFlag, snapshotFree] = await Promise.all([
          get(apiRef),
          get(paywallSecondOnlyFlagRef),
          get(freeRef),
        ]);

        if (snapshotApi.exists()) {
          const value = snapshotApi.val();
          setApi(value);
          // console.log('🔑 [Firebase] Google API Key from /api:', value);
        } else {
          console.warn('⚠️ No Google Translate API key found at /api');
        }

        if (snapshotFree.exists()) {
          const value = snapshotFree.val();
          // console.log('chec', value)
          setFreeTranslation(value);
          // console.log('🔑 [Firebase] Free Translation Key from /free_translation:', value);
        } else {
          console.warn('⚠️ No free translation key found at /free_translation');
        }
        if (paywallSecondOnlyFlag.exists()) {
          const value = paywallSecondOnlyFlag.val();
          // console.log('chec', value)
          setSingle_offer_wall(value);
          // console.log('🔑 [Firebase] Free Translation Key from /free_translation:', value);
        } else {
          console.warn('⚠️ No free translation key found at /free_translation');
        }

      } catch (error) {
        console.error('🔥 Error fetching API keys from Firebase:', error);
      }
    };

    fetchAPIKeys();
  }, []);




  const updateUserProStatus = () => {
    if (!user?.id) return;
    const nextIsPro = !!localState?.isPro;
    const known = lastKnownIsProRef.current;
    // Skip the write when RTDB already holds this value (login read / last write).
    if (known?.uid === user.id && known.value === nextIsPro) return;
    const userIsProRef = ref(appdatabase, `/users/${user?.id}/isPro`);
    set(userIsProRef, nextIsPro)
      .then(() => {
        lastKnownIsProRef.current = { uid: user.id, value: nextIsPro };
      })
      .catch((error) => {
        console.error('Error updating isPro:', error);
      });
  };

  const checkInternetConnection = async () => {
    try {
      const response = await fetch('https://www.google.com/favicon.ico', { method: 'HEAD', cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Unable to reach the internet.');
      }
    } catch {
      // ✅ Show a friendly alert message
      Alert.alert(
        tr('home.globel_stats.no_internet_title', '⚠️ No Internet Connection'),
        tr('home.globel_stats.no_internet_body', 'Some features may not work properly. Please check your network and try again.'),
        [{ text: tr('home.globel_stats.ok', 'OK') }]
      );
    }
  };

  useEffect(() => {
    requestIdleCallback(() => {
      updateUserProStatus();
    }, { timeout: 1000 });
  }, [user?.id, localState?.isPro]);


  useEffect(() => {
    // Local-only write (MMKV), NOT updateLocalStateAndDatabase. This anchors
    // the stock-data cache freshness check below (fetchStockData reads
    // localState.lastActivity) but no longer writes RTDB /users/{uid}/lastActivity
    // — that per-launch write was firing the mirrorUsersToSupabase Cloud
    // Function on every app open for a field nothing else mirrored. The actual
    // activity heartbeat now goes straight to Supabase, throttled, below.
    updateLocalState('lastActivity', new Date().toISOString());
  }, [updateLocalState]);



  // ✅ Ref to always have latest localState without adding it to useCallback deps
  const localStateRef = useRef(localState);
  useEffect(() => { localStateRef.current = localState; }, [localState]);

  // 6h-throttled Supabase activity heartbeat. Replaces the old RTDB-write →
  // mirror-CF fan-out (see the lastActivity effect above) — the single largest
  // avoidable Cloud Function class. set_last_activity() (016_user_last_activity.sql)
  // uses the server clock, so a skewed client can't back-date the cohort
  // timestamp. We only advance the local throttle on a successful RPC, so an
  // early call before the Supabase JWT is attached just retries next session.
  useEffect(() => {
    if (!user?.id) return;
    const HEARTBEAT_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6h
    const prevMs = Number(localStateRef.current?.lastActivitySyncedAt) || 0;
    const now = Date.now();
    if (now - prevMs < HEARTBEAT_THROTTLE_MS) return;
    setLastActivity()
      .then((ms) => { if (ms > 0) updateLocalState('lastActivitySyncedAt', now); })
      .catch(() => {});
  }, [user?.id, updateLocalState]);

  const fetchStockData = useCallback(async (refresh) => {
    const currentLocalState = localStateRef.current;
    let catalogRefreshed = true;
    try {
      setLoading(true);

      // Catalog freshness must not use the user-presence heartbeat.
      const lastFetched = Number(currentLocalState.fetchDataTime) || 0;
      const now = Date.now();
      const shouldFetch = refresh || now - lastFetched > 6 * 60 * 1000 ||
        !usableCatalog(currentLocalState.data) || !usableCatalog(currentLocalState.codes);
      if (shouldFetch) {
        const catalogStartedAt = Date.now();
        const results = await Promise.all([
          refreshCatalog({
            load: () => fetchCatalog('https://blox-api.b-cdn.net/data.json'),
            cached: currentLocalState.data,
            save: value => updateLocalState('data', JSON.stringify(value)),
          }),
          refreshCatalog({
            load: () => fetchCatalog('https://blox-api.b-cdn.net/codes.json'),
            cached: currentLocalState.codes,
            save: value => updateLocalState('codes', JSON.stringify(value)),
          }),
        ]);
        catalogRefreshed = results.every(r => r.fresh);
        trackGrowthEvent('catalog_load_result', {
          duration_ms: Date.now() - catalogStartedAt,
          fresh_feeds: results.filter(r => r.fresh).length,
          available_feeds: results.filter(r => r.available).length,
          manual_refresh: refresh ? 1 : 0,
        });
        setCatalogStatus(results.every(r => r.fresh) ? 'ready' :
          results[0].available ? 'cached' : 'unavailable');
        if (results.every(r => r.fresh)) updateLocalState('fetchDataTime', String(now));
      }

      // ✅ OPTIMIZED: Cache calcData — only fetch from Firebase if 5 min have passed
      const lastCalcDataFetch = currentLocalState.lastCalcDataFetch
        ? parseInt(currentLocalState.lastCalcDataFetch, 10)
        : 0;
      const fiveMinutes = 5 * 60 * 1000;
      const shouldFetchCalcData = refresh || (Date.now() - lastCalcDataFetch > fiveMinutes)
        || !currentLocalState.cachedNormalStock || !currentLocalState.cachedMirageStock;

      let normalStock = {};
      let mirageStock = {};

      if (shouldFetchCalcData) {
        const calcSnapshot = await withDeadline(() => get(ref(appdatabase, 'calcData')));
        normalStock = calcSnapshot.exists() ? calcSnapshot.val()?.test || {} : {};
        mirageStock = calcSnapshot.exists() ? calcSnapshot.val()?.mirage || {} : {};

        updateLocalState('cachedNormalStock', JSON.stringify(normalStock));
        updateLocalState('cachedMirageStock', JSON.stringify(mirageStock));
        updateLocalState('lastCalcDataFetch', Date.now().toString());
      } else {
        try {
          normalStock = typeof currentLocalState.cachedNormalStock === 'string'
            ? JSON.parse(currentLocalState.cachedNormalStock)
            : (currentLocalState.cachedNormalStock || {});
          mirageStock = typeof currentLocalState.cachedMirageStock === 'string'
            ? JSON.parse(currentLocalState.cachedMirageStock)
            : (currentLocalState.cachedMirageStock || {});
        } catch (parseErr) {
          console.error('❌ Failed to parse cached calcData:', parseErr);
          const calcSnapshot = await withDeadline(() => get(ref(appdatabase, 'calcData')));
          normalStock = calcSnapshot.exists() ? calcSnapshot.val()?.test || {} : {};
          mirageStock = calcSnapshot.exists() ? calcSnapshot.val()?.mirage || {} : {};
        }
      }

      // ✅ OPTIMIZED: Cache previousStock - only fetch once per hour
      const lastPreviousStockFetch = currentLocalState.lastPreviousStockFetch
        ? parseInt(currentLocalState.lastPreviousStockFetch, 10)
        : 0;
      const oneHour = 60 * 60 * 1000;
      const shouldFetchPreviousStock = refresh || (Date.now() - lastPreviousStockFetch > oneHour);

      let prenormalStock = {};
      let premirageStock = {};

      if (shouldFetchPreviousStock) {
        const preSnapshot = await withDeadline(() => get(ref(appdatabase, 'previousStock')));
        prenormalStock = preSnapshot.exists() ? preSnapshot.val()?.normalStock || {} : {};
        premirageStock = preSnapshot.exists() ? preSnapshot.val()?.mirageStock || {} : {};

        updateLocalState('prenormalStock', JSON.stringify(prenormalStock));
        updateLocalState('premirageStock', JSON.stringify(premirageStock));
        updateLocalState('lastPreviousStockFetch', Date.now().toString());
      } else {
        try {
          prenormalStock = typeof currentLocalState.prenormalStock === 'string'
            ? JSON.parse(currentLocalState.prenormalStock)
            : (currentLocalState.prenormalStock || {});
          premirageStock = typeof currentLocalState.premirageStock === 'string'
            ? JSON.parse(currentLocalState.premirageStock)
            : (currentLocalState.premirageStock || {});
        } catch (parseErr) {
          console.error('❌ Failed to parse cached previousStock:', parseErr);
          prenormalStock = {};
          premirageStock = {};
        }
      }

      // ✅ Store frequently updated stock data
      updateLocalState('normalStock', JSON.stringify(normalStock));
      updateLocalState('mirageStock', JSON.stringify(mirageStock));

    } catch (error) {
      catalogRefreshed = false;
      console.error("❌ Error fetching stock data:", error);
    } finally {
      setLoading(false);
    }
    return catalogRefreshed;
  }, [appdatabase, updateLocalState]); // ✅ Stable deps only — localState accessed via ref

  // ✅ Run the function only if needed
  useEffect(() => {
    const task = requestIdleCallback(() => {
      fetchStockData();
    }, { timeout: 1000 });

    return () => cancelIdleCallback(task);
  }, [fetchStockData]);

  const reload = useCallback(() => {
    return fetchStockData(true);
  }, [fetchStockData]);

  // Probe uid for the server-time checks below. Read through a ref so the
  // listeners don't resubscribe (and drop back to "unresolved") whenever the
  // signed-in user object changes. Never an email: RTDB keys can't hold '.'.
  // null when signed out: the probe needs an own-uid path the rules allow, so
  // getServerTime skips it and uses .info/serverTimeOffset instead.
  const probeUidRef = useRef(null);
  probeUidRef.current = user?.id || null;
  const getProbeUid = useCallback(() => probeUidRef.current, []);

  // Warm the authoritative server-time offset early (and again whenever the
  // app returns to foreground — the user may have changed the clock while
  // backgrounded). Ban countdowns read the cached offset synchronously via
  // serverNowMs(); the ban listeners only probe when a timed record exists,
  // so without this the offset could stay cold. Ported from adoptme-jan7.
  useEffect(() => {
    if (!appdatabase) return;
    const probeUid = user?.id || null;
    warmServerTime(appdatabase, probeUid);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') warmServerTime(appdatabase, probeUid);
    });
    return () => sub.remove();
  }, [user?.id]); // appdatabase is module-level

  // Email-side ban/mute listener (banned_users_by_email/{encodeEmailKey}).
  const emailKey = currentUserEmail ? encodeEmailKey(currentUserEmail) : '';
  useEffect(() => {
    if (!emailKey || !appdatabase) return;
    return watchBanRecord(appdatabase, `banned_users_by_email/${emailKey}`, getProbeUid, ({ record, active }) => {
      setEmailBanState({ key: emailKey, record, active });
    });
  }, [emailKey, getProbeUid]); // appdatabase is module-level

  // Device-side ban listener. Closes the "ban the email, sign up with a fresh
  // one on the same device" bypass. banned_devices entries are written by the
  // server when a user is banned and removed on unban. Always a ban.
  useEffect(() => {
    if (!appdatabase) {
      setDeviceBanState({ resolved: true, record: null, active: false });
      return;
    }
    let cancelled = false;
    let stop = null;
    getDeviceFingerprint().then((fp) => {
      if (cancelled) return;
      if (!fp) {
        setDeviceBanState({ resolved: true, record: null, active: false });
        return;
      }
      stop = watchBanRecord(appdatabase, `banned_devices/${fp}`, getProbeUid, ({ record, active }) => {
        setDeviceBanState({ resolved: true, record, active });
      });
    }).catch(() => {
      if (!cancelled) setDeviceBanState({ resolved: true, record: null, active: false });
    });
    return () => {
      cancelled = true;
      if (stop) stop();
    };
  }, [getProbeUid]); // appdatabase is module-level

  // Uid-side ban/mute listener (banned_uids/{uid}). Applies to every account,
  // including phone-only accounts that have no email record.
  useEffect(() => {
    if (!appdatabase || !user?.id) return;
    const uid = user.id;
    return watchBanRecord(appdatabase, `banned_uids/${uid}`, getProbeUid, ({ record, active }) => {
      setUidBanState({ uid, record, active });
    });
  }, [user?.id, getProbeUid]); // appdatabase is module-level

  // Staff Access grants: one tiny leaf each, live, so an admin's grant or
  // revoke reaches the phone at once. Only the account's own entry is read.
  useEffect(() => {
    if (!appdatabase || !user?.id) {
      setCanGrantJmd(false);
      setCanGrantMod(false);
      return;
    }
    const watch = (path, setter) => onValue(
      ref(appdatabase, `${path}/${user.id}`),
      (snap) => setter(!!(snap && snap.exists() && snap.val() === true)),
      () => setter(false),
    );
    const offJmd = watch('jmd_granters', setCanGrantJmd);
    const offMod = watch('mod_granters', setCanGrantMod);
    return () => { offJmd(); offMod(); };
  }, [user?.id]); // appdatabase is module-level

  // ── Derived ban / mute state ─────────────────────────────────────────────
  const emailResult = emailKey && emailBanState.key === emailKey ? emailBanState : null;
  const uidResult = user?.id && uidBanState.uid === user.id ? uidBanState : null;
  const banListenersResolved =
    (!emailKey || !!emailResult) && (!user?.id || !!uidResult) && deviceBanState.resolved;

  const emailRecord = emailResult?.active ? emailResult.record : null;
  const uidRecord = uidResult?.active ? uidResult.record : null;
  const deviceRecord = deviceBanState.active ? deviceBanState.record : null;

  const liveBan = useMemo(() => {
    const bans = [];
    if (emailRecord && !isMuteRecord(emailRecord)) bans.push({ ...emailRecord, source: 'email' });
    if (uidRecord && !isMuteRecord(uidRecord)) bans.push({ ...uidRecord, source: 'uid' });
    if (deviceRecord) bans.push({ ...deviceRecord, source: 'device' });
    return pickRecord(bans);
  }, [emailRecord, uidRecord, deviceRecord]);
  const liveMute = useMemo(() => {
    const mutes = [];
    if (emailRecord && isMuteRecord(emailRecord)) mutes.push({ ...emailRecord, source: 'email' });
    if (uidRecord && isMuteRecord(uidRecord)) mutes.push({ ...uidRecord, source: 'uid' });
    return pickRecord(mutes);
  }, [emailRecord, uidRecord]);

  // Last-known state for this uid (MMKV). Used only until the listeners have
  // resolved, so a banned user who opens the app offline / on a slow network
  // stays blocked instead of getting a fail-open window.
  const cachedModState = useMemo(() => {
    if (!user?.id) return null;
    try {
      const raw = proFlagStorage?.getString(BAN_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || parsed.uid !== user.id) return null;
      return {
        ban: isRecordLive(parsed.ban) ? parsed.ban : null,
        mute: isRecordLive(parsed.mute) ? parsed.mute : null,
      };
    } catch (_) {
      return null;
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !banListenersResolved) return;
    try {
      proFlagStorage?.set(BAN_CACHE_KEY, JSON.stringify({ uid: user.id, ban: liveBan, mute: liveMute }));
    } catch (_) {}
  }, [user?.id, banListenersResolved, liveBan, liveMute]);

  // Content creation waits (briefly) for the listeners on a fresh sign-in;
  // after BAN_CHECK_TIMEOUT_MS it proceeds on the cached state instead of
  // blocking forever when offline. Reading is never gated.
  const banIdentity = `${user?.id || ''}|${emailKey}`;
  const [banCheckTimedOutFor, setBanCheckTimedOutFor] = useState(null);
  useEffect(() => {
    if (!user?.id || banListenersResolved) return;
    const timer = setTimeout(() => setBanCheckTimedOutFor(banIdentity), BAN_CHECK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [banIdentity, banListenersResolved, user?.id]);
  const banCheckPending = !!user?.id && !banListenersResolved && banCheckTimedOutFor !== banIdentity;

  // Public values. strikeInfo = the active ban record that restricts longest
  // (permanent first, then latest bannedUntil) across email, uid and device;
  // muteInfo = the same for mutes. Expired records never surface here.
  const strikeInfo = banListenersResolved
    ? liveBan
    : (pickRecord([liveBan, cachedModState?.ban]) || null);
  const muteInfo = banListenersResolved
    ? liveMute
    : (pickRecord([liveMute, cachedModState?.mute]) || null);
  const isUserBlocked = !!strikeInfo;
  const isUserMuted = !!muteInfo;
  const deviceBanInfo = deviceRecord;

  // Single gate for every write surface. scope:
  //   'chat'    → ban OR mute, waits for the ban check (public/DM/group chat)
  //   'content' → ban only, waits for the ban check (trades, posts, comments…)
  //   'action'  → ban only, never waits (votes, reactions, follows)
  // Returns null when allowed, else { kind: 'banned'|'muted'|'checking', info }.
  // Admins are exempt. Stable identity (reads a ref), so callers' callbacks
  // can't go stale on it.
  const modGateStateRef = useRef({});
  modGateStateRef.current = { isAdmin, strikeInfo, muteInfo, banCheckPending };
  const getModGate = useCallback((scope = 'content') => {
    const s = modGateStateRef.current;
    if (s.isAdmin) return null;
    if (s.strikeInfo) return { kind: 'banned', info: s.strikeInfo };
    if (scope === 'chat' && s.muteInfo) return { kind: 'muted', info: s.muteInfo };
    if (scope !== 'action' && s.banCheckPending) return { kind: 'checking', info: null };
    return null;
  }, []);

  // ✅ Set up online status tracking using separate presence node (RTDB-only, optimized for scale)
  // ✅ Foreground-only presence (ACTIVE = online, background/inactive = offline)
  // ✅ Uses presence/{uid} instead of users/{uid}/online for better scalability
  useEffect(() => {
    if (!user?.id || !appdatabase) return;

    const uid = user.id;
    const presenceRef = ref(appdatabase, `presence/${uid}`); // ✅ Separate presence node
    const connectedRef = ref(appdatabase, ".info/connected")

    let isConnected = false;
    let currentAppState = AppState.currentState; // 'active' | 'background' | 'inactive'
    let armedOnDisconnect = false;

    const setLocalOnline = (val) => {
      // Only a real change makes a new object: a new `user` re-renders every
      // consumer of the global context, and this fires on each
      // .info/connected flap and AppState change.
      setUser((prev) => (prev?.id && prev.online !== val ? { ...prev, online: val } : prev));
    };

    const forceOffline = async () => {
      try {
        await set(presenceRef, false);
      } catch (e) {
        // log if you want: console.log("forceOffline error", e);
      }
      setLocalOnline(false);
    };

    let onDisconnectHandler = null;

    const armOnDisconnect = async () => {
      if (armedOnDisconnect) return;
      try {
        onDisconnectHandler = onDisconnect(presenceRef);
        await onDisconnectHandler.set(false);
        armedOnDisconnect = true;
      } catch (e) {
        // Handle error silently
      }
    };

    let running = false;
    let pending = false;
    let lastPresenceUpdate = 0;
    const PRESENCE_UPDATE_THROTTLE = 30000; // ✅ OPTIMIZED: 30 seconds throttle

    const updatePresence = async () => {
      if (running) {
        pending = true;
        return;
      }

      // ✅ OPTIMIZED: Throttle presence updates (max once per 30 seconds)
      const now = Date.now();
      const timeSinceLastUpdate = now - lastPresenceUpdate;
      if (timeSinceLastUpdate < PRESENCE_UPDATE_THROTTLE && lastPresenceUpdate > 0) {
        // Skip update if within throttle window
        return;
      }

      running = true;

      try {
        // ✅ Block online status update if user is blocked (admins are exempt)
        if (isUserBlocked && !isAdmin) {
          await forceOffline();
          lastPresenceUpdate = Date.now();
          return;
        }

        if (localState?.showOnlineStatus === false) {
          try {
            if (onDisconnectHandler) {
              await onDisconnectHandler.cancel();
            }
          } catch { }
          armedOnDisconnect = false;
          await forceOffline();
          lastPresenceUpdate = Date.now();
          return;
        }

        if (!isConnected || currentAppState !== "active") {
          await forceOffline();
          lastPresenceUpdate = Date.now();
          return;
        }

        await armOnDisconnect();
        await set(presenceRef, true);
        setLocalOnline(true);
        lastPresenceUpdate = Date.now(); // ✅ Update throttle timestamp

      } catch (e) {
        // console.log("updatePresence error", e);
      } finally {
        running = false;

        // ✅ if something changed while we were running, apply latest state once more
        if (pending) {
          pending = false;
          updatePresence();
        }
      }
    };


    // Listen to RTDB connection state
    const unsubConnected = onValue(connectedRef, (snap) => {
      isConnected = snap.val() === true;
      updatePresence();
    });

    // Listen to AppState changes
    const sub = AppState.addEventListener("change", (nextState) => {
      currentAppState = nextState;
      // immediately offline when background/inactive
      updatePresence();
    });

    // Initial sync
    updatePresence();

    return () => {
      // ✅ Cleanup: Mark user offline when component unmounts or user.id changes (logout)
      sub.remove();
      if (typeof unsubConnected === "function") unsubConnected();

      // ✅ Cancel onDisconnect handler if it exists
      if (onDisconnectHandler) {
        onDisconnectHandler.cancel().catch(() => { });
      }

      // ✅ Mark offline in RTDB (using closure to capture the old uid)
      // This ensures when user.id changes to null (logout), the previous user is marked offline
      set(presenceRef, false).catch(() => { });
      setLocalOnline(false);
    };
  }, [user?.id, appdatabase, localState?.showOnlineStatus, isUserBlocked, isAdmin]);

  // ✅ Fetch trading server link (cached for 3 hours) — runs once on mount
  useEffect(() => {
    if (!appdatabase) return;

    const fetchTradingServerLink = async () => {
      const currentLocal = localStateRef.current;
      try {
        const lastServerFetch = currentLocal.lastServerFetch ? new Date(currentLocal.lastServerFetch).getTime() : 0;
        const now = Date.now();
        const timeElapsed = now - lastServerFetch;
        const EXPIRY_LIMIT = 3 * 60 * 60 * 1000; // 3 hours

        // Only fetch if expired or not cached
        if (timeElapsed > EXPIRY_LIMIT || !currentLocal.tradingServerLink) {
          const serverRef = ref(appdatabase, 'server');
          const snapshot = await get(serverRef);

          if (snapshot.exists()) {
            const serverData = snapshot.val();
            const serverList = Object.entries(serverData).map(([id, value]) => ({ id, ...value }));
            const firstServer = serverList.length > 0 ? serverList[0] : null;
            const serverLink = firstServer?.link || null;

            if (serverLink) {
              setTradingServerLink(serverLink);
              updateLocalState('tradingServerLink', serverLink);
              updateLocalState('lastServerFetch', new Date().toISOString());
            }
          }
        } else {
          // Use cached link
          if (currentLocal.tradingServerLink) {
            setTradingServerLink(currentLocal.tradingServerLink);
          }
        }
      } catch (error) {
        console.error('Error fetching trading server link:', error);
        if (currentLocal.tradingServerLink) {
          setTradingServerLink(currentLocal.tradingServerLink);
        }
      }
    };

    fetchTradingServerLink();
  }, [appdatabase, updateLocalState]);

  // console.log(user)

  const contextValue = useMemo(
    () => ({
      auth,
      user,
      onlineMembersCount,
      firestoreDB,
      appdatabase,
      theme,
      setUser,
      setOnlineMembersCount,
      updateLocalStateAndDatabase,
      fetchStockData,
      loading,
      catalogStatus,
      freeTranslation,
      isAdmin,
      isSeniorMod, // ✅ Export Senior Mod status (one rank below Admin)
      isModerator, // ✅ Export moderator status
      isBabyMod, // ✅ Export JMD status
      isTrusted, // ✅ Export Trusted status
      isGrinder, // ✅ Export Grinder status
      isRaider, // ✅ Export Raider status
      isHelper, // Cosmetic Helper badge
      canGrantJmd, // Staff Access: may appoint / remove JMDs (RTDB /jmd_granters/{uid})
      canGrantMod, // Staff Access: may appoint / remove Mods (RTDB /mod_granters/{uid})
      reload,
      robloxUsernameRef, api, proTagBought, stockNotifierPurchase, proGranted, currentUserEmail, single_offer_wall,
      isInActiveGame,
      setIsInActiveGame, // ✅ Set game state
      tradingServerLink, // ✅ Trading server link
      strikeInfo, // ✅ Active ban record (email / uid / device; permanent, then latest expiry) or null
      muteInfo, // ✅ Active chat mute record or null
      deviceBanInfo, // ✅ Device-side ban payload (carries originating email/userId)
      isUserBlocked, // ✅ Banned right now (blocks everything)
      isUserMuted, // ✅ Muted right now (blocks chat only)
      banCheckPending, // ✅ Ban listeners not resolved yet for this sign-in (≤5s)
      getModGate, // ✅ getModGate('chat' | 'content' | 'action') → null | { kind, info }

    }),
    [user, onlineMembersCount, theme, fetchStockData, loading, catalogStatus, robloxUsernameRef, api, freeTranslation, proTagBought, stockNotifierPurchase, proGranted, currentUserEmail, single_offer_wall, auth, isInActiveGame, setIsInActiveGame, tradingServerLink, strikeInfo, muteInfo, deviceBanInfo, isUserBlocked, isUserMuted, banCheckPending, getModGate, isAdmin, isSeniorMod, isModerator, isBabyMod, isTrusted, isGrinder, isRaider, isHelper, canGrantJmd, canGrantMod, updateLocalStateAndDatabase, reload]
  );

  return (
    <GlobalStateContext.Provider value={contextValue}>
      {children}
    </GlobalStateContext.Provider>
  );
};


