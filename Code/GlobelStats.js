import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
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
import { developmentMode } from './Ads/ads';
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
    const platform = Platform.OS.toLowerCase(); 
    logEvent(analytics, `${appOwner}_app_open`);
    logEvent(analytics, `platform_${platform}`);
  }, []);


  const [user, setUser] = useState({
      id: null,
      selectedFruits: [],
      admin: false,
      isReminderEnabled: false,
      isSelectedReminderEnabled: false,
      displayName: '',
      avatar: null,
      points: 0, 
      isBlock:false,
      fcmToken:null,
      lastactivity:null,
      online:false
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
      displayName: '',
      avatar: null,
      points: 0, 
      isBlock:false,
      fcmToken:null,
      lastactivity:null,
      online:false
    });
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (loggedInUser) => {
        // console.log("🔄 Auth state changed. Current user:", loggedInUser ? loggedInUser.uid : "No user");

        try {
            if (!loggedInUser) {
                // console.log("🔴 User logged out. Clearing local data...");
                resetUserState();
                storage_user_data.clearAll(); // ✅ Fix: Removed double semicolon
                return;
            }

            const userId = loggedInUser.uid;
            // console.log(`🟢 User logged in: ${userId}`);

            const storedUser = storage_user_data.getString(`userData_${userId}`);

            if (storedUser) {
                // console.log("✅ Using cached user data from MMKV.");
                setUser(JSON.parse(storedUser));
            } else {
                // console.log("⚠️ No cached user data. Fetching from Firebase...");
                const userRef = ref(appdatabase, `users/${userId}`);
                const snapshot = await get(userRef);

                if (snapshot.exists()) {
                    const userData = { ...snapshot.val(), id: userId };
                    // console.log("✅ User data loaded from Firebase.");
                    setUser(userData);
                    storage_user_data.set(`userData_${userId}`, JSON.stringify(userData));
                } else {
                    // console.log("🆕 New user detected. Creating in Firebase...");
                    const newUser = createNewUser(userId, loggedInUser);
                    await set(userRef, newUser);
                    setUser(newUser);
                    storage_user_data.set(`userData_${userId}`, JSON.stringify(newUser));
                }
            }

            // 🔥 Always refresh and update the FCM token
            // console.log("🔄 Updating FCM token...");
            await registerForNotifications(userId);
            await requestPermission();
        } catch (error) {
            // console.error("❌ Auth state change error:", error);
        }
    });

    return () => {
        // console.log("🚪 Unsubscribing from auth state changes...");
        unsubscribe();
    };
}, [auth]); // ✅ Fix: Added `auth` dependency





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
  
  
// console.log(user)


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

     
    
            // 🔹 Calculate total downloaded size
            
            // if (developmentMode) {
            //     const codeSize = JSON.stringify(codes).length / 1024; 
            //     const dataSize = JSON.stringify(data).length / 1024; 
            //     console.log(`🚀 user code data: ${codeSize.toFixed(2)} KB`);
            //     // console.log(`🚀 user values data: ${dataSize.toFixed(2)} KB`);
            // }
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
    
    // 🔹 Calculate data size in KB for each dataset
   
    
    // 🔹 Calculate total downloaded size
   
    
    // if (developmentMode) {
    //   const normalStockSize = JSON.stringify(normalStock).length / 1024; 
    //   const mirageStockSize = JSON.stringify(mirageStock).length / 1024; 
    //   const prenormalStockSize = JSON.stringify(prenormalStock).length / 1024; 
    //   const premirageStockSize = JSON.stringify(premirageStock).length / 1024; 
    //   const totalDownloadedSize = normalStockSize + mirageStockSize + prenormalStockSize + premirageStockSize;
    //     console.log(`🚀 Total stock data: ${totalDownloadedSize.toFixed(2)} KB`);
    // }
    

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

// console.log(user.online)


  const contextValue = useMemo(
    () => ({
      user,
      onlineMembersCount,
      firestoreDB,
      appdatabase,
      theme,
      setUser,
      setOnlineMembersCount,
      updateLocalStateAndDatabase, fetchStockData, loading, analytics
      
    }),
    [user, onlineMembersCount, theme, fetchStockData, loading]
  );

  return (
    <GlobalStateContext.Provider value={contextValue}>
      {children}
    </GlobalStateContext.Provider>
  );
};


