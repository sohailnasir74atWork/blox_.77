import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { MMKV } from 'react-native-mmkv';

// MMKV Storage Instance
const mmkvStorage = new MMKV();

const persistenceMMKV = {
  setItem: (key, value) => Promise.resolve(mmkvStorage.set(key, value)),
  getItem: (key) => Promise.resolve(mmkvStorage.getString(key)),
  removeItem: (key) => Promise.resolve(mmkvStorage.delete(key)),
};

// Initialize Firebase App
const firebaseConfig = {
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
  

const app = initializeApp(firebaseConfig);

// Initialize Firebase Auth with MMKV
const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(persistenceMMKV),
});

export { auth };
