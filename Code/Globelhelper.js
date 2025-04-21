import messaging from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import { generateOnePieceUsername } from './Helper/RendomNamegen';
import { getDatabase, ref, get, set } from '@react-native-firebase/database';

export const firebaseConfig = {
    apiKey: "AIzaSyDUXkQcecnhrNmeagvtRsKmDBmwz4AsRC0",
    authDomain: "fruiteblocks.firebaseapp.com",
    databaseURL: "https://fruiteblocks-default-rtdb.firebaseio.com",
    projectId: "fruiteblocks",
    storageBucket: "fruiteblocks.appspot.com",
    messagingSenderId: "409137828081",
    appId: Platform.select({
      ios: "1:409137828081:ios:89f062c9951cd664f39950",
      android: "1:409137828081:android:2b2e10b900614979f39950",
    }),
    measurementId: "G-C3T24PS3SF",
  };
  

  export const saveTokenToDatabase = async (token, currentUserId) => {
    if (!currentUserId || !token) {
        console.warn('⚠️ Invalid inputs: Cannot save FCM token.');
        return;
    }

    try {
        const db = getDatabase();
        const tokenRef = ref(db, `users/${currentUserId}/fcmToken`);
        const invalidTokenRef = ref(db, `users/${currentUserId}/isTokenInvalid`);

        // ✅ Set a timeout to prevent blocking the main thread
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("🔥 Firebase timeout while fetching token")), 5000)
        );

        const tokenSnapshot = await Promise.race([get(tokenRef), timeoutPromise]);

        const currentToken = tokenSnapshot.exists() ? tokenSnapshot.val() : null;

        if (currentToken === token) {
            return; // ✅ No update needed
        }

        await Promise.all([
            set(tokenRef, token),
            set(invalidTokenRef, false),
        ]);

    } catch (error) {
        console.error(`🔥 Error saving FCM token: ${error.message || error}`);
    }
};

  


  
  export const registerForNotifications = async (currentUserId, retryCount = 0) => {
      if (!currentUserId) {
          console.warn('⚠️ User ID is null. Cannot register for notifications.');
          return;
      }
  
      try {
          const authStatus = await messaging().requestPermission();
  
          const isAuthorized = 
              authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
              authStatus === messaging.AuthorizationStatus.PROVISIONAL;
  
          if (!isAuthorized) {
              console.warn('🚫 Notification permissions not granted.');
              return;
          }
  
          let fcmToken = null;
  
          if (Platform.OS === 'ios') {
              // console.log('🍏 Fetching APNS Token...');
              const apnsToken = await messaging().getAPNSToken();
  
              if (!apnsToken) {
                  console.error('❌ APNS token is not available. Ensure APNS is configured correctly.');
                  return;
              }
          }
  
        //   console.log('📡 Fetching FCM Token...');
          fcmToken = await messaging().getToken();
        //   console.log(fcmToken)
  
          if (!fcmToken) {
              console.error('❌ Failed to fetch FCM token. Token is null or undefined.');
              return;
          }
  
          // console.log('💾 Saving token to database...');
          await saveTokenToDatabase(fcmToken, currentUserId);
          // console.log('✅ FCM token registered successfully.');
          
      } catch (error) {
          console.error(`🔥 Error registering for notifications: ${error.message || error}`);
      }
  };
  
  


  export const createNewUser = (userId, loggedInUser = {}, robloxUsername) => ({
      id: userId,
      selectedFruits: [],
      isReminderEnabled: false,
      isSelectedReminderEnabled: false,
      displayName: robloxUsername || loggedInUser.displayName || generateOnePieceUsername() || 'Anonymous',
      avatar: loggedInUser.photoURL || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
      rewardPoints: 0, 
      isBlock:false,
      fcmToken:null,
      lastactivity:null,
      online:false,
      isPro:false

  });
  


export const resetUserState = (setUser) => {
    setUser({
        id: null,
        selectedFruits: [],
        isReminderEnabled: false,
        isSelectedReminderEnabled: false,
        displayName: '',
        avatar: null,
        rewardPoints: 0, 
        isBlock:false,
        fcmToken:null,
        lastactivity:null,
        online:false,
        isPro:false


    });
  };
