import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getApps } from '@react-native-firebase/app';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { ref, set, update, get, onDisconnect, getDatabase, onValue } from '@react-native-firebase/database';
import { getFirestore } from '@react-native-firebase/firestore';
import { createNewUser, firebaseConfig, registerForNotifications } from './Globelhelper';
import { useLocalState } from './LocalGlobelStats';
import { requestPermission } from './Helper/PermissionCheck';
import { useColorScheme, InteractionManager, AppState } from 'react-native';
import { clearUserCache } from './Helper/UserDataCache';
import { generateOnePieceUsername } from './Helper/RendomNamegen';
import { getDeviceFingerprint } from './Helper/deviceFingerprint';
import { getServerTime } from './Helper/serverTime';
import { setLastActivity } from './Supabase/userBackend';
import Purchases from 'react-native-purchases';
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
  const [proTagBought, setProTagBought] = useState(false);
  const [stockNotifierPurchase, setStockNotifierPurchase] = useState(false);
  const [_isEmailBanned, setIsEmailBanned] = useState(false);
  const [_isDeviceBanned, setIsDeviceBanned] = useState(false);
  const isUserBlocked = _isEmailBanned || _isDeviceBanned;
  const [strikeInfo, setStrikeInfo] = useState(null);
  // Full payload from `banned_devices/{fp}` when this device is flagged.
  // Carries the email + userId of the ORIGINAL banned account, which the
  // ban-card UI uses to show "your associated account is banned" copy.
  const [deviceBanInfo, setDeviceBanInfo] = useState(null);

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
  }, [user?.id, user?.purchases]);
  // console.log('user', user)

  // console.log('bought', proTagBought)

  // ✅ OPTIMIZED: Debounce helper for non-critical updates
  const debounceTimeoutRef = useRef(null);
  const pendingUpdatesRef = useRef({});

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

  // ✅ Memoize handleUserLogin
  const handleUserLogin = useCallback(async (loggedInUser) => {
    if (!loggedInUser) {
      resetUserState(); // No longer recreates resetUserState
      setIsAdmin(false);
      setIsModerator(false); // ✅ Reset moderator status
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
      const userRef = ref(appdatabase, `users/${userId}`);

      // console.log(snapshot, userId, 'userData', userRef)

      // 🔄 Fetch user data
      const snapshot = await get(userRef);
      let userData;

      // console.log(loggedInUser.email)
      const makeadmin = loggedInUser.email === 'thesolanalabs@gmail.com' || loggedInUser.email === 'sohailnasir74@gmail.com';
      if (makeadmin) { setIsAdmin(makeadmin) }
      setCurrentuserEmail(loggedInUser.email)

      if (snapshot.exists()) {
        const existing = snapshot.val();

        // ✅ Persist hardcoded admin flag to RTDB once (so RoleBadges / profile cache see it)
        if (makeadmin && !existing.isAdmin && !existing.admin) {
          update(userRef, { isAdmin: true }).catch(() => {});
          existing.isAdmin = true;
        }

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
          email: loggedInUser.email || existing.email || null,
        };

        // ✅ Update email in Firebase if it's missing or changed
        if (loggedInUser.email && existing.email !== loggedInUser.email) {
          await update(userRef, { email: loggedInUser.email });
        }

      } else {
        // console.log(robloxUsernameRef?.current, 'robloxUsername_inside')
        userData = {
          ...createNewUser(userId, loggedInUser, robloxUsernameRef?.current),
          createdAt: Date.now(),
          email: loggedInUser.email || null, // ✅ Store email for new users
        };

        await set(userRef, userData);
      }
      // console.log(userData, 'user')
      setUser(userData);

      // Stamp this user's record with the current device fingerprint so the
      // ban flow can mirror an entry into banned_devices when the email is
      // banned. Best-effort: on failure we just don't gain device-side ban.
      getDeviceFingerprint().then((fp) => {
        if (fp) update(userRef, { deviceId: fp }).catch(() => {});
      }).catch(() => {});

      // 🔥 Refresh and update FCM token
      await Promise.all([registerForNotifications(userId)]);

    } catch (error) {
      console.error("❌ Auth state change error:", error);
    }
  }, [appdatabase, resetUserState]); // ✅ Uses memoized resetUserState

  useEffect(() => {
    if (!user?.id) return;

    const run = async () => {
      try {
        // console.log('Registering push token for user:', user.id);
        await registerForNotifications(user.id);
      } catch (e) {
        // console.log('registerForNotifications error', e);
      }
    };

    run();
  }, [user?.id]);


  // ✅ Ensure useEffect runs only when necessary
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (loggedInUser) => {
      InteractionManager.runAfterInteractions(async () => {
        await handleUserLogin(loggedInUser);

        if (loggedInUser?.uid) {
          await registerForNotifications(loggedInUser.uid);
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

        await updateLocalState('isAppReady', true);
      });
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
    const userIsProRef = ref(appdatabase, `/users/${user?.id}/isPro`);
    set(userIsProRef, !!localState?.isPro).catch((error) => {
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
        "⚠️ No Internet Connection",
        "Some features may not work properly. Please check your network and try again.",
        [{ text: "OK" }]
      );
    }
  };

  useEffect(() => {
    InteractionManager.runAfterInteractions(() => {
      updateUserProStatus();
    });
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
    try {
      setLoading(true);

      // ✅ Check when `codes & data` were last fetched
      const lastActivity = currentLocalState.lastActivity ? new Date(currentLocalState.lastActivity).getTime() : 0;
      const now = Date.now();
      const timeElapsed = now - lastActivity;

      // ✅ Fetch `codes & data` only if 6min have passed OR they are missing
      const EXPIRY_LIMIT = refresh ? 1 * 1000 : 6 * 60 * 1000;

      const shouldFetch =
        timeElapsed > EXPIRY_LIMIT ||
        !currentLocalState.data ||
        !Object.keys(currentLocalState.data).length

      if (shouldFetch) {
        let codes = {};
        let data = {};

        try {
          const [codesRes, dataRes] = await Promise.all([
            fetch('https://blox-api.b-cdn.net/codes.json', {
              method: 'GET',
              cache: 'no-store',
            }),
            fetch('https://blox-api.b-cdn.net/data.json', {
              method: 'GET',
              cache: 'no-store',
            })
          ]);

          if (!codesRes.ok || !dataRes.ok) {
            throw new Error(`CDN request failed: codes=${codesRes.status}, data=${dataRes.status}`);
          }

          const codesJson = await codesRes.json();
          const dataJson = await dataRes.json();

          codes = codesJson || {};
          data = dataJson || {};

          if (!Object.keys(codes).length || !Object.keys(data).length) {
            throw new Error('CDN data incomplete: empty response');
          }

        } catch (err) {
          console.error('❌ Failed to fetch from CDN:', err.message);

          if (currentLocalState.codes && currentLocalState.data) {
            try {
              codes = typeof currentLocalState.codes === 'string' ? JSON.parse(currentLocalState.codes) : currentLocalState.codes;
              data = typeof currentLocalState.data === 'string' ? JSON.parse(currentLocalState.data) : currentLocalState.data;
              console.warn('⚠️ Using cached codes & data due to CDN failure');
            } catch (parseErr) {
              console.error('❌ Failed to parse cached data:', parseErr);
              codes = {};
              data = {};
            }
          } else {
            codes = {};
            data = {};
            console.warn('⚠️ No cached data available, using empty objects');
          }
        }

        // ✅ Store fetched data locally
        updateLocalState('codes', JSON.stringify(codes));
        updateLocalState('data', JSON.stringify(data));
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
        const calcSnapshot = await get(ref(appdatabase, 'calcData'));
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
          const calcSnapshot = await get(ref(appdatabase, 'calcData'));
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
        const preSnapshot = await get(ref(appdatabase, 'previousStock'));
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
      console.error("❌ Error fetching stock data:", error);
    } finally {
      setLoading(false);
    }
  }, [appdatabase, updateLocalState]); // ✅ Stable deps only — localState accessed via ref

  // ✅ Run the function only if needed
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      fetchStockData();
    });

    return () => task.cancel();
  }, [fetchStockData]);

  const reload = useCallback(() => {
    fetchStockData(true);
  }, [fetchStockData]);

  // ✅ Check if user is blocked by email (centralized - used everywhere)
  // Server-time-validated: comparing `bannedUntil` against `Date.now()` lets
  // a banned user roll their device clock backward to bypass the gate. We
  // probe authoritative server time via getServerTime() and schedule a
  // setTimeout (monotonic, immune to wall-clock changes) to auto-clear when
  // the ban actually expires. AppState 'active' triggers a re-probe so a
  // user who changes the clock while backgrounded still gets re-evaluated.
  useEffect(() => {
    if (!currentUserEmail || !appdatabase) {
      setIsEmailBanned(false);
      setStrikeInfo(null);
      return;
    }

    const encodedEmail = currentUserEmail.replace(/\./g, '(dot)');
    const banRef = ref(appdatabase, `banned_users_by_email/${encodedEmail}`);

    let currentBan = null;
    let expiryTimer = null;
    let cancelled = false;

    const evaluate = async () => {
      if (cancelled) return;
      const banData = currentBan;
      if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }

      if (!banData) {
        setIsEmailBanned(false);
        return;
      }
      const { bannedUntil } = banData;
      if (bannedUntil === 'permanent') {
        setIsEmailBanned(true);
        return;
      }
      if (typeof bannedUntil !== 'number') {
        setIsEmailBanned(false);
        return;
      }

      const probeUid = user?.id || currentUserEmail;
      const serverNow = (await getServerTime(appdatabase, probeUid)).getTime();
      if (cancelled) return;
      const remaining = bannedUntil - serverNow;
      if (remaining <= 0) {
        setIsEmailBanned(false);
        return;
      }
      setIsEmailBanned(true);
      // Cap the timer at ~24h so long bans don't sit on a stale offset.
      const wait = Math.min(remaining, 24 * 60 * 60 * 1000);
      expiryTimer = setTimeout(evaluate, wait);
    };

    const unsubscribe = onValue(banRef, (snapshot) => {
      const banData = snapshot.val();
      currentBan = banData || null;
      setStrikeInfo(currentBan);
      evaluate();
    });

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') evaluate();
    });

    return () => {
      cancelled = true;
      if (expiryTimer) clearTimeout(expiryTimer);
      appStateSub.remove();
      unsubscribe();
    };
  }, [currentUserEmail, appdatabase, user?.id]);

  // Device-side ban listener. Mirrors the email check above so a banned user
  // can't escape by re-registering with a fresh email on the same device.
  // banned_devices entries are written by banUserwithEmail / setUserStrike
  // when a user is banned, and removed by unbanUserWithEmail.
  // Server-time-validated for the same reason as the email listener above —
  // see that effect for the full rationale.
  useEffect(() => {
    if (!appdatabase) {
      setIsDeviceBanned(false);
      return;
    }

    let unsub = null;
    let cancelled = false;
    let currentBan = null;
    let expiryTimer = null;
    let appStateSub = null;

    const evaluate = async () => {
      if (cancelled) return;
      const data = currentBan;
      if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }

      if (!data) {
        setIsDeviceBanned(false);
        setDeviceBanInfo(null);
        return;
      }
      const { bannedUntil } = data;
      if (bannedUntil === 'permanent') {
        setIsDeviceBanned(true);
        setDeviceBanInfo(data);
        return;
      }
      if (typeof bannedUntil !== 'number') {
        setIsDeviceBanned(false);
        setDeviceBanInfo(null);
        return;
      }
      const probeUid = user?.id || data?.userId || 'anon';
      const serverNow = (await getServerTime(appdatabase, probeUid)).getTime();
      if (cancelled) return;
      const remaining = bannedUntil - serverNow;
      if (remaining <= 0) {
        setIsDeviceBanned(false);
        setDeviceBanInfo(null);
        return;
      }
      setIsDeviceBanned(true);
      setDeviceBanInfo(data);
      const wait = Math.min(remaining, 24 * 60 * 60 * 1000);
      expiryTimer = setTimeout(evaluate, wait);
    };

    getDeviceFingerprint().then((fp) => {
      if (cancelled || !fp) {
        setIsDeviceBanned(false);
        setDeviceBanInfo(null);
        return;
      }
      const deviceBanRef = ref(appdatabase, `banned_devices/${fp}`);
      unsub = onValue(deviceBanRef, (snapshot) => {
        currentBan = snapshot.val() || null;
        evaluate();
      });
      appStateSub = AppState.addEventListener('change', (state) => {
        if (state === 'active') evaluate();
      });
    }).catch(() => {
      setIsDeviceBanned(false);
      setDeviceBanInfo(null);
    });

    return () => {
      cancelled = true;
      if (expiryTimer) clearTimeout(expiryTimer);
      if (appStateSub) appStateSub.remove();
      if (unsub) unsub();
    };
  }, [appdatabase, user?.id]);

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
      setUser((prev) => (prev?.id ? { ...prev, online: val } : prev));
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
      freeTranslation,
      isAdmin,
      isSeniorMod, // ✅ Export Senior Mod status (one rank below Admin)
      isModerator, // ✅ Export moderator status
      isBabyMod, // ✅ Export JMD status
      isTrusted, // ✅ Export Trusted status
      isGrinder, // ✅ Export Grinder status
      isRaider, // ✅ Export Raider status
      reload,
      robloxUsernameRef, api, proTagBought, stockNotifierPurchase, proGranted, currentUserEmail, single_offer_wall,
      isInActiveGame,
      setIsInActiveGame, // ✅ Set game state
      tradingServerLink, // ✅ Trading server link
      strikeInfo, // ✅ User ban/strike information (centralized)
      deviceBanInfo, // ✅ Device-side ban payload (carries originating email/userId)
      isUserBlocked, // ✅ Boolean flag if user is currently blocked

    }),
    [user, onlineMembersCount, theme, fetchStockData, loading, robloxUsernameRef, api, freeTranslation, proTagBought, stockNotifierPurchase, proGranted, currentUserEmail, single_offer_wall, auth, isInActiveGame, setIsInActiveGame, tradingServerLink, strikeInfo, deviceBanInfo, isUserBlocked, isAdmin, isSeniorMod, isModerator, isBabyMod, isTrusted, isGrinder, isRaider, updateLocalStateAndDatabase, reload]
  );

  return (
    <GlobalStateContext.Provider value={contextValue}>
      {children}
    </GlobalStateContext.Provider>
  );
};


