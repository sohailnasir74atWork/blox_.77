import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {  getApps } from '@react-native-firebase/app';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { ref, set, update, get, onDisconnect, getDatabase } from '@react-native-firebase/database';
import { getFirestore } from '@react-native-firebase/firestore';
import { createNewUser, firebaseConfig, registerForNotifications } from './Globelhelper';
import { useLocalState } from './LocalGlobelStats';
import { requestPermission } from './Helper/PermissionCheck';
import { useColorScheme, InteractionManager } from 'react-native';
import { getFlag } from './Helper/CountryCheck';
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


  



  const [isAdmin, setIsAdmin] = useState(false);
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
    coins:null,
    createdAt:null


  });

  const [onlineMembersCount, setOnlineMembersCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [proTagBought, setProTagBought] = useState(false);
  const [stockNotifierPurchase, setStockNotifierPurchase] = useState(false);

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
  // };



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
  

  // console.log('bought', proTagBought)

  const updateLocalStateAndDatabase = async (keyOrUpdates, value) => {
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
  
      // Update in-memory user state for top-level keys only
      setUser((prev) => {
        const newUser = { ...prev };
      
        for (const [path, val] of Object.entries(updates)) {
          if (!path.includes('/')) {
            newUser[path] = val;
          } else {
            const keys = path.split('/');
            let target = newUser;
            for (let i = 0; i < keys.length - 1; i++) {
              if (!target[keys[i]]) target[keys[i]] = {};
              target = target[keys[i]];
            }
            target[keys[keys.length - 1]] = val;
          }
        }
      
        return newUser;
      });      
  
      // Update Firebase for all keys (supports nested paths)
      if (user?.id) {
        const userRef = ref(appdatabase, `users/${user.id}`);
        await update(userRef, updates);
      }
    } catch (error) {
      console.error('❌ Error updating user state or database:', error);
    }
  };
  
  
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
      coins:null,
      createdAt:null


    });
  }, []); // No dependencies, so it never re-creates

  // ✅ Memoize handleUserLogin
  const handleUserLogin = useCallback(async (loggedInUser) => {
    if (!loggedInUser) {
      resetUserState(); // No longer recreates resetUserState
      return;
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
        userData = { 
          ...existing,
          id: userId,
          createdAt: existing.createdAt || Date.now()   // fallback if missing
        };
                // console.log(userData, 'userData')


      } else {
        // console.log(robloxUsernameRef?.current, 'robloxUsername_inside')
        userData = {
          ...createNewUser(userId, loggedInUser, robloxUsernameRef?.current),
          createdAt: Date.now()
        };
      
        await set(userRef, userData);
      }
      // console.log(userData, 'user')
      setUser(userData);

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
        console.log('Registering push token for user:', user.id);
        await registerForNotifications(user.id);
      } catch (e) {
        console.log('registerForNotifications error', e);
      }
    };
  
    run();
  }, [user?.id]);

  useEffect(()=>{
    // console.log(user)
    if(!isAdmin)
    updateLocalStateAndDatabase({flage:getFlag()})
    // getFlag()
  },[user.id])

  // ✅ Ensure useEffect runs only when necessary
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (loggedInUser) => {
      InteractionManager.runAfterInteractions(async () => {
        await handleUserLogin(loggedInUser);

        if (loggedInUser?.uid) {
          await registerForNotifications(loggedInUser.uid);
          // await requestPermission();
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

        const [snapshotApi, paywallSecondOnlyFlag,  snapshotFree] = await Promise.all([
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
    if (!user?.id) {
      // console.error("User ID or database instance is missing!");
      return;
    }

    const userIsProRef = ref(appdatabase, `/users/${user?.id}/isPro`);

    set(userIsProRef, localState?.isPro)
      .then(() => {
        // console.log("User online status updated to true");
      })
      .catch((error) => {
        console.error("Error updating online status:", error);
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
      // checkInternetConnection();
      updateUserProStatus();
    });
  }, [user.id, localState.isPro]);


  useEffect(() => {
    // console.log("🕓 Saving lastActivity:", new Date().toISOString());
    updateLocalStateAndDatabase('lastActivity', new Date().toISOString());
  }, []);



  const fetchStockData = async (refresh) => {
    try {
      setLoading(true);

      // ✅ Check when `codes & data` were last fetched
      const lastActivity = localState.lastActivity ? new Date(localState.lastActivity).getTime() : 0;
      const now = Date.now();
      const timeElapsed = now - lastActivity;


      // ✅ Fetch `codes & data` only if 24 hours have passed OR they are missing
      const EXPIRY_LIMIT = refresh ? 1 * 1000 : 6 * 60 * 1000; // 10s for refresh, 6min default

      const shouldFetch =
        timeElapsed > EXPIRY_LIMIT ||
        !localState.data ||
        !Object.keys(localState.data).length

      if (shouldFetch) {
        // console.log("📌 Fetching codes & data from database...");

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

          const codesJson = await codesRes.json();
          const dataJson = await dataRes.json();

          // Assign values or keep as empty object
          codes = codesJson || {};
          data = dataJson || {};
          // console.log(data)

          // If either is empty, force fallback
          if (!Object.keys(codes).length || !Object.keys(data).length) {
            throw new Error('CDN data incomplete');
          }

          // console.log('✅ Loaded codes & data from CDN');

        } catch (err) {
          console.warn('⚠️ Fallback to Firebase:', err.message);

          const [xlsSnapshot, codeSnapShot] = await Promise.all([
            get(ref(appdatabase, 'fruit_data')),
            get(ref(appdatabase, 'codes')),
          ]);

          codes = codeSnapShot.exists() ? codeSnapShot.val() : {};
          data = xlsSnapshot.exists() ? xlsSnapshot.val() : {};
          // console.log(data, codes)

        }





        // ✅ Store fetched data locally
        await updateLocalState('codes', JSON.stringify(codes));
        await updateLocalState('data', JSON.stringify(data));
        // console.log(data)
        // ✅ Update last fetch timestamp
        // await updateLocalState('lastActivity', new Date().toISOString());


        // console.log("✅ Data updated successfully.");
      } else {
        // console.log("⏳ Using cached codes & data, no need to fetch.");
      }

      // ✅ Always fetch stock data (`calcData`) on app load
      // console.log("📌 Fetching fresh stock data...");
      const [calcSnapshot, preSnapshot] = await Promise.all([
        get(ref(appdatabase, 'calcData')), // ✅ Always updated stock data
        get(ref(appdatabase, 'previousStock')),
      ]);

      // ✅ Extract relevant stock data
      const normalStock = calcSnapshot.exists() ? calcSnapshot.val()?.test || {} : {};
      const mirageStock = calcSnapshot.exists() ? calcSnapshot.val()?.mirage || {} : {};
      const prenormalStock = preSnapshot.exists() ? preSnapshot.val()?.normalStock || {} : {};
      const premirageStock = preSnapshot.exists() ? preSnapshot.val()?.mirageStock || {} : {};


      // ✅ Store frequently updated stock data
      await updateLocalState('normalStock', JSON.stringify(normalStock));
      await updateLocalState('mirageStock', JSON.stringify(mirageStock));
      await updateLocalState('prenormalStock', JSON.stringify(prenormalStock));
      await updateLocalState('premirageStock', JSON.stringify(premirageStock));

    } catch (error) {
      console.error("❌ Error fetching stock data:", error);
    } finally {
      setLoading(false);
    }
  };
  // console.log(user)

  // ✅ Run the function only if needed
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      fetchStockData(); // ✅ Now runs after main thread is free
    });

    return () => task.cancel();
  }, []);

  const reload = () => {
    fetchStockData(true);
  };

  useEffect(() => {
    if (!user?.id) return;

    // ✅ Mark user as online in local state & database
    updateLocalStateAndDatabase('online', true);

    // ✅ Ensure user is marked offline upon disconnection (only applies to Firebase)
    const userOnlineRef = ref(appdatabase, `/users/${user.id}/online`);

    onDisconnect(userOnlineRef)
      .set(false)
      .catch((error) => console.error("🔥 Error setting onDisconnect:", error));

    return () => {
      // ✅ Cleanup: Mark user offline when the app is closed
      updateLocalStateAndDatabase('online', false);
    };
  }, [user?.id]);

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
      reload,
      robloxUsernameRef, api,   proTagBought, stockNotifierPurchase, proGranted, currentUserEmail, single_offer_wall

    }),
    [user, onlineMembersCount, theme, fetchStockData, loading, robloxUsernameRef, api, freeTranslation, proTagBought, currentUserEmail, auth, ]
  );

  return (
    <GlobalStateContext.Provider value={contextValue}>
      {children}
    </GlobalStateContext.Provider>
  );
};


