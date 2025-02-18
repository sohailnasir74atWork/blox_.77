import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { getApp, getApps, initializeApp } from '@react-native-firebase/app';
import  { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import  { ref, set, update, get, onDisconnect, getDatabase } from '@react-native-firebase/database';
import  { getFirestore } from '@react-native-firebase/firestore';
import { createNewUser, firebaseConfig, registerForNotifications } from './Globelhelper';
import { useLocalState } from './LocalGlobelStats';
import { requestPermission } from './Helper/PermissionCheck';
import { getAnalytics, logEvent, setAnalyticsCollectionEnabled } from '@react-native-firebase/analytics';
import { Platform } from 'react-native';
import config from './Helper/Environment';
import { MMKV } from 'react-native-mmkv';
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);


const analytics = getAnalytics(app);
const firestoreDB = getFirestore(app);
const appdatabase = getDatabase(app);
const GlobalStateContext = createContext();
setAnalyticsCollectionEnabled(analytics, true);
const storage_user_data = new MMKV(); // Initialize MMKV


// Custom hook to access global state
export const useGlobalState = () => useContext(GlobalStateContext);

export const GlobalStateProvider = ({ children }) => {
  const {localState, updateLocalState} = useLocalState()
  const [theme, setTheme] = useState(localState.theme || 'light');
  useEffect(() => {
    const appOwner = config.isNoman ? "Noman" : "Waqas";
    logEvent(analytics, 'myappopen', { 
      platform: Platform.OS.toLowerCase(),
      app_owner: appOwner  
    });
  }, []); 
  


  const [user, setUser] = useState({
      id: null,
      selectedFruits: [],
      admin: false,
      isReminderEnabled: false,
      isSelectedReminderEnabled: false,
      displayname: '',
      avatar: null,
      points: 0, 
      isBlock:false,
      fcmToken:null,
      lastactivity:null
  });

  const [onlineMembersCount, setOnlineMembersCount] = useState(0);
  const [loading, setLoading] = useState(false);
  
  // Track theme changes
  useEffect(() => {
      setTheme(localState.theme); 

  }, [localState.theme]);

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
      setUser((prev) => {
        const updatedUser = { ...prev, ...updates };
        storage_user_data.set(`userData_${user.id}`, JSON.stringify(updatedUser)); // ✅ Update MMKV
        return updatedUser;
      });
  
      // ✅ Update Firebase database
      await update(userRef, updates);
    } catch (error) {
      console.error('Error updating user state or database:', error);
    }
  };


  // Reset user state
  const resetUserState = () => {
    setUser({
      id: null,
      selectedFruits: [],
      admin: false,
      isReminderEnabled: false,
      isSelectedReminderEnabled: false,
      displayname: '',
      avatar: null,
      points: 0, 
      isBlock:false,
      fcmToken:null,
      lastactivity:null
    });
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (loggedInUser) => {
      try {
        if (!loggedInUser) {
          resetUserState();
          storage_user_data.delete('userData'); // Clear MMKV user data on logout
          return;
        }
  
        const userId = loggedInUser.uid;
        const storedUser = storage_user_data.getString(`userData_${userId}`);
  
        if (storedUser) {
          // ✅ If user data exists in MMKV, parse and use it
          setUser(JSON.parse(storedUser));
          return;
        }
  
        // 🔹 Fetch from Firebase only if MMKV data is not available
        const userRef = ref(appdatabase, `users/${userId}`);
        get(userRef).then(async (snapshot) => {
          if (snapshot.exists()) {
            const userData = { ...snapshot.val(), id: userId };
            // console.log(userData)
            
            // ✅ Save to state and MMKV
            setUser(userData);
            storage_user_data.set(`userData_${userId}`, JSON.stringify(userData));
          } else {
            const newUser = createNewUser(userId, loggedInUser);
            await set(userRef, newUser);
            
            setUser(newUser);
            storage_user_data.set(`userData_${userId}`, JSON.stringify(newUser));
          }
  
          // Notifications & Permissions
          await registerForNotifications(userId);
          await requestPermission();
        }).catch((error) => console.error("Firebase fetch error:", error));
  
      } catch (error) {
        console.error("Auth state change error:", error);
      }
    });
  
    return () => unsubscribe();
  }, []);
  
  


  
 const checkInternetConnection = async () => {
  try {
    const response = await fetch('https://www.google.com/favicon.ico', { method: 'HEAD', cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Unable to reach the internet. Please check your connection.');
    }
  } catch {
    throw new Error('No internet connection. Please check your network.');
  }
};

useEffect(() => {
  const now = new Date().toISOString(); 
  updateLocalStateAndDatabase('lastactivity', now); 
  checkInternetConnection()
}, []);




const fetchStockData = async () => {
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

    if (shouldFetchCodesData) {
      // console.log("📌 Fetching codes & data from database...");

      const [xlsSnapshot, codeSnapShot] = await Promise.all([
        get(ref(appdatabase, 'testing')),
        get(ref(appdatabase, 'codes')),
      ]);

      const codes = codeSnapShot.exists() ? codeSnapShot.val() : {};
      const data = xlsSnapshot.exists() ? xlsSnapshot.val() : {};
      // console.log(codes, data)

      // ✅ Store fetched data locally
      await updateLocalState('codes', JSON.stringify(codes));
      await updateLocalState('data', JSON.stringify(data));

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



  const contextValue = useMemo(
    () => ({
      user,
      onlineMembersCount,
      firestoreDB,
      appdatabase,
      theme,
      setUser,
      setOnlineMembersCount,
      updateLocalStateAndDatabase, fetchStockData, loading,
      
    }),
    [user, onlineMembersCount, theme, fetchStockData, loading]
  );

  return (
    <GlobalStateContext.Provider value={contextValue}>
      {children}
    </GlobalStateContext.Provider>
  );
};


