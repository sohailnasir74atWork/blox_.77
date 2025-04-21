import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getApp, getApps, initializeApp } from '@react-native-firebase/app';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { ref, set, update, get, onDisconnect, getDatabase } from '@react-native-firebase/database';
import { getFirestore } from '@react-native-firebase/firestore';
import { createNewUser, firebaseConfig, registerForNotifications } from './Globelhelper';
import { useLocalState } from './LocalGlobelStats';
import { requestPermission } from './Helper/PermissionCheck';
import { useColorScheme, InteractionManager } from 'react-native';
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
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
    lastactivity: null,
    online: false,
    isPro: false

  });

  const [onlineMembersCount, setOnlineMembersCount] = useState(0);
  const [loading, setLoading] = useState(false);
  // const [robloxUsername, setRobloxUsername] = useState('');
  const robloxUsernameRef = useRef('');


  // Track theme changes
  useEffect(() => {
    setTheme(localState.theme === 'system' ? colorScheme : localState.theme);
  }, [localState.theme, colorScheme]);

  // const isAdmin = user?.id  ? user?.id == '3CAAolfaX3UE3BLTZ7ghFbNnY513' : false
  // console.log(isAdmin, user)

  const updateLocalStateAndDatabase = async (keyOrUpdates, value) => {
    if (!user.id) return; // Prevent updates if user is not logged in

    try {
      const userRef = ref(appdatabase, `users/${user.id}`);
      let updates = {};

      if (typeof keyOrUpdates === 'string') {
        // Single update
        updates = { [keyOrUpdates]: value };
      } else if (typeof keyOrUpdates === 'object') {
        // Batch update
        updates = keyOrUpdates;
      } else {
        throw new Error('Invalid arguments for update.');
      }

      // ✅ Update local state
      setUser((prev) => ({ ...prev, ...updates }));


      // ✅ Update Firebase database
      await update(userRef, updates);
    } catch (error) {
      console.error('Error updating user state or database:', error);
    }
  };


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
      lastactivity: null,
      online: false,
      isPro: false
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
      const makeadmin = loggedInUser.email === 'thesolanalabs@gmail.com' || loggedInUser.email === 'mastermind@gmail.com';
      if (makeadmin) { setIsAdmin(makeadmin) }

      if (snapshot.exists()) {
        userData = { ...snapshot.val(), id: userId };
        // console.log(userData, 'userData')


      } else {
        // console.log(robloxUsernameRef?.current, 'robloxUsername_inside')
        userData = createNewUser(userId, loggedInUser, robloxUsernameRef?.current);
        await set(userRef, userData);
      }
      // console.log(userData, 'user')
      setUser(userData);

      // 🔥 Refresh and update FCM token
      await Promise.all([registerForNotifications(userId), requestPermission()]);

    } catch (error) {
      console.error("❌ Auth state change error:", error);
    }
  }, [appdatabase, resetUserState]); // ✅ Uses memoized resetUserState

  // ✅ Ensure useEffect runs only when necessary
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (loggedInUser) => {
      InteractionManager.runAfterInteractions(async () => {
        await handleUserLogin(loggedInUser);

        if (loggedInUser?.uid) {
          await registerForNotifications(loggedInUser.uid);
          await requestPermission();
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
      const freeRef = ref(appdatabase, 'free_translation');

      const [snapshotApi, snapshotFree] = await Promise.all([
        get(apiRef),
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
        setFreeTranslation(value);
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

    const lastActivity = localState.lastactivity ? new Date(localState.lastactivity).getTime() : 0;
    const now = Date.now();
    const THREE_HOURS = 36 * 60 * 60 * 1000; // 3 hours in milliseconds

    if (now - lastActivity > THREE_HOURS) {
      updateLocalStateAndDatabase('lastactivity', new Date().toISOString());

    }
  }, [localState.lastactivity]);



  const fetchStockData = async (refresh) => {
    try {
      setLoading(true);

      // ✅ Check when `codes & data` were last fetched
      const lastActivity = localState.lastActivity ? new Date(localState.lastActivity).getTime() : 0;
      const now = Date.now();
      const timeElapsed = now - lastActivity;
      const TWENTY_FOUR_HOURS = refresh ? 24 * 60 * 60 * 1000 : 1 * 1 * 60 * 1000; // 24 hours in ms
      // console.log(TWENTY_FOUR_HOURS, refresh)

      // ✅ Fetch `codes & data` only if 24 hours have passed OR they are missing
      const shouldFetchCodesData =
        timeElapsed > TWENTY_FOUR_HOURS ||
        !localState.codes ||
        !Object.keys(localState.codes).length ||
        !localState.data ||
        !Object.keys(localState.data).length;

      if (shouldFetchCodesData) {
        // console.log("📌 Fetching codes & data from database...");

        const [xlsSnapshot, codeSnapShot] = await Promise.all([
          get(ref(appdatabase, 'fruit_data')),
          get(ref(appdatabase, 'codes')),
        ]);

        const codes = codeSnapShot.exists() ? codeSnapShot.val() : {};
        const data = xlsSnapshot.exists() ? xlsSnapshot.val() : {};

        // console.log(data)




        // ✅ Store fetched data locally
        await updateLocalState('codes', JSON.stringify(codes));
        await updateLocalState('data', JSON.stringify(data));
        // console.log(data)
        // ✅ Update last fetch timestamp
        await updateLocalState('lastActivity', new Date().toISOString());

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

      // console.log("✅ Stock data processed and stored successfully.");
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
      robloxUsernameRef, api
    }),
    [user, onlineMembersCount, theme, fetchStockData, loading, robloxUsernameRef, api,freeTranslation]
  );

  return (
    <GlobalStateContext.Provider value={contextValue}>
      {children}
    </GlobalStateContext.Provider>
  );
};


