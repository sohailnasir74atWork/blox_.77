import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { getApp, getApps, initializeApp } from '@react-native-firebase/app';
import  { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import  { ref, set, update, get, onDisconnect, getDatabase } from '@react-native-firebase/database';
import  { getFirestore } from '@react-native-firebase/firestore';
import { createNewUser, firebaseConfig, registerForNotifications } from './Globelhelper';
import { useLocalState } from './LocalGlobelStats';
import { requestPermission } from './Helper/PermissionCheck';
import { getAnalytics, logEvent, setAnalyticsCollectionEnabled } from '@react-native-firebase/analytics';
import { Alert, Platform } from 'react-native';
import config from './Helper/Environment';
import { MMKV } from 'react-native-mmkv';
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const analytics = getAnalytics(app);
const firestoreDB = getFirestore(app);
const appdatabase = getDatabase(app);
const GlobalStateContext = createContext();
setAnalyticsCollectionEnabled(analytics, true);


// Custom hook to access global state
export const useGlobalState = () => useContext(GlobalStateContext);

export const GlobalStateProvider = ({ children }) => {
  const {localState, updateLocalState} = useLocalState()
  const [theme, setTheme] = useState(localState.theme || 'light');
  
  

  useEffect(() => {
    const appOwner = config.isNoman ? "Noman" : "Waqas";
    const platform = Platform.OS.toLowerCase(); 
    logEvent(analytics, `${appOwner}_app_open`);
    logEvent(analytics, `platform_${platform}`);
  }, []);

  const [user, setUser] = useState({
    id: null,
    selectedFruits: [],
    isReminderEnabled: false,
    isSelectedReminderEnabled: false,
    displayName: '',
    avatar: null,
    points: 0, 
    isBlock:false,
    fcmToken:null,
    lastactivity:null,
    online:false,
  });

  const [onlineMembersCount, setOnlineMembersCount] = useState(0);
  const [loading, setLoading] = useState(false);
  
  // Track theme changes
  useEffect(() => {
    setTheme(localState.theme); 
}, [localState.theme]);

  const isAdmin = user?.id  ? user?.id == '3CAAolfaX3UE3BLTZ7ghFbNnY513' : false
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


  


  // ✅ Memoize resetUserState to prevent unnecessary re-renders
  const resetUserState = useCallback(() => {
    setUser({
      id: null,
      selectedFruits: [],
      isReminderEnabled: false,
      isSelectedReminderEnabled: false,
      displayName: '',
      avatar: null,
      points: 0, 
      isBlock: false,
      fcmToken: null,
      lastactivity: null,
      online: false,
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
      
      // 🔄 Fetch user data
      const snapshot = await get(userRef);
      let userData;
      
      if (snapshot.exists()) {
        userData = { ...snapshot.val(), id: userId };
      } else {
        userData = createNewUser(userId, loggedInUser);
        await set(userRef, userData);
      }
  
      setUser(userData);
  
      // 🔥 Refresh and update FCM token
      await Promise.all([registerForNotifications(userId), requestPermission()]);
      
    } catch (error) {
      console.error("❌ Auth state change error:", error);
    }
  }, [appdatabase, resetUserState]); // ✅ Uses memoized resetUserState
  
  // ✅ Ensure useEffect runs only when necessary
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, handleUserLogin);
    return () => unsubscribe();
  }, [auth, handleUserLogin]); // ✅ Dependencies are stable
  


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

    const lastActivity = localState.lastactivity ? new Date(localState.lastactivity).getTime() : 0;
    const now = Date.now();
    const THREE_HOURS = 36 * 60 * 60 * 1000; // 3 hours in milliseconds
  
    if (now - lastActivity > THREE_HOURS) {
      updateLocalStateAndDatabase('lastactivity', new Date().toISOString());

    }
  }, []);
  
 

const fetchStockData = async (refresh) => {
  try {
    setLoading(true);

    // ✅ Check when `codes & data` were last fetched
    const lastActivity = localState.lastActivity ? new Date(localState.lastActivity).getTime() : 0;
    const now = Date.now();
    const timeElapsed = now - lastActivity;
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000; // 24 hours in ms

    // ✅ Fetch `codes & data` only if 24 hours have passed OR they are missing
    const shouldFetchCodesData =
      timeElapsed > TWENTY_FOUR_HOURS ||
      !localState.codes ||
      !Object.keys(localState.codes).length ||
      !localState.data ||
      !Object.keys(localState.data).length;

    if (shouldFetchCodesData || refresh) {
      // console.log("📌 Fetching codes & data from database...");

      const [xlsSnapshot, codeSnapShot] = await Promise.all([
        get(ref(appdatabase, 'testing')),
        get(ref(appdatabase, 'codes')),
      ]);

      const codes = codeSnapShot.exists() ? codeSnapShot.val() : {};
      const data = xlsSnapshot.exists() ? xlsSnapshot.val() : {};

     
    

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
    await updateLocalState('isAppReady', true);

    // console.log("✅ Stock data processed and stored successfully.");
  } catch (error) {
    console.error("❌ Error fetching stock data:", error);
  } finally {
    setLoading(false);
  }
};


// ✅ Run the function only if needed
useEffect(() => {
  fetchStockData();
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
      analytics, 
      isAdmin, 
      reload
    }),
    [user, onlineMembersCount, theme, fetchStockData, loading]
  );  

  return (
    <GlobalStateContext.Provider value={contextValue}>
      {children}
    </GlobalStateContext.Provider>
  );
};


