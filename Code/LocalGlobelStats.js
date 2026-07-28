import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import { Appearance, InteractionManager } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import Purchases from 'react-native-purchases';
import config from './Helper/Environment';

const storage = createMMKV();
const LocalStateContext = createContext();

export const useLocalState = () => useContext(LocalStateContext);

export const LocalStateProvider = ({ children }) => {
  const safeParseJSON = (key, defaultValue) => {
    try {
      const value = storage.getString(key);
      return value ? JSON.parse(value) : defaultValue;
    } catch (error) {
      console.error(`🚨 JSON Parse Error for key "${key}":`, error);
      return defaultValue;
    }
  };

  const [localState, setLocalState] = useState(() => ({
    localKey: storage.getString('localKey') || 'defaultValue',
    reviewCount: Number(storage.getString('reviewCount')) || 0,
    lastVersion: storage.getString('lastVersion') || 'UNKNOWN',
    updateCount: Number(storage.getString('updateCount')) || 0,
    featuredCount: safeParseJSON('featuredCount', { count: 0, time: null }),
    isHaptic: storage.getBoolean('isHaptic') ?? true,
    theme: storage.getString('theme') || 'system',
    consentStatus: storage.getString('consentStatus') || 'UNKNOWN',
    isPro: storage.getBoolean('isPro') ?? false,
    fetchDataTime: storage.getString('fetchDataTime') || null,
    data: safeParseJSON('data', {}),
    codes: safeParseJSON('codes', {}),
    normalStock: safeParseJSON('normalStock', []),
    bannedUsers: safeParseJSON('bannedUsers', []),
    mirageStock: safeParseJSON('mirageStock', []),
    prenormalStock: safeParseJSON('prenormalStock', []),
    premirageStock: safeParseJSON('premirageStock', []),
    lastPreviousStockFetch: storage.getString('lastPreviousStockFetch') || null,
    isAppReady: storage.getBoolean('isAppReady') ?? false,
    lastActivity: storage.getString('lastActivity') || null,
    // ms-epoch of the last set_last_activity() RPC send — throttles the
    // Supabase heartbeat to ~once/6h across restarts (see GlobelStats).
    lastActivitySyncedAt: storage.getString('lastActivitySyncedAt') || null,
    showOnBoardingScreen: storage.getBoolean('showOnBoardingScreen') ?? true,
    user_name: storage.getString('user_name') || 'Anonymous',
    translationUsage: safeParseJSON('translationUsage', {
      count: 0,
      date: new Date().toDateString(),
    }),
    showAd1: storage.getBoolean('showAd1') ?? true,
    leaderboardTop50: safeParseJSON('leaderboardTop50', {
      data: [],
      timestamp: null,
      lastFetched: null,
    }),
    trustedRoster: safeParseJSON('trustedRoster', { data: [], timestamp: null }),
    grinderRoster: safeParseJSON('grinderRoster', { data: [], timestamp: null }),
    raiderRoster: safeParseJSON('raiderRoster', { data: [], timestamp: null }),
    pollVotes: safeParseJSON('pollVotes', {}), // ✅ Store user's poll votes (pollId -> optionLabel)
    showReadReceipts: storage.getBoolean('showReadReceipts') ?? true, // ✅ Default ON
    gameAdDays: safeParseJSON('gameAdDays', {}), // Per-game free play tracking { gameId: "YYYY-MM-DD" }
    // User inventory (My Stuff). Source of truth is Firestore user_profiles;
    // TradeJournal/TradeCompletion mirror it here so the calculator's "My Items"
    // picker tab can read it from cache without a fetch. Hydrate from MMKV on boot.
    ownedFruits: safeParseJSON('ownedFruits', []),
    wishlistFruits: safeParseJSON('wishlistFruits', []),
  }));

  // RevenueCat subscriptions (for info/expiry)
  const [mySubscriptions, setMySubscriptions] = useState([]);

  // Theme system listener
  useEffect(() => {
    if (localState.theme === 'system') {
      const listener = Appearance.addChangeListener(({ colorScheme }) => {
        updateLocalState('theme', colorScheme);
      });
      return () => listener.remove();
    }
  }, [localState.theme]);

  useEffect(() => {
    if (localState.data) {
      storage.set('data', JSON.stringify(localState.data));
    }
  }, [localState.data]);

  const updateLocalState = useCallback((key, value) => {
    setLocalState(prev => ({
      ...prev,
      [key]: value,
    }));

    if (typeof value === 'string') {
      storage.set(key, value);
    } else if (typeof value === 'number') {
      storage.set(key, value.toString());
    } else if (typeof value === 'boolean') {
      storage.set(key, value);
    } else if (typeof value === 'object') {
      storage.set(key, JSON.stringify(value));
    } else {
      console.error(
        '🚨 MMKV supports only string, number, boolean, or JSON stringified objects.'
      );
    }
  }, []);

  // ✅ FIXED: Read directly from storage for real-time accuracy (no stale state)
  const canTranslate = useCallback(() => {
    const today = new Date().toDateString();
    // ✅ Read directly from storage to get latest value (not from stale localState)
    const storedUsage = safeParseJSON('translationUsage', {
      count: 0,
      date: today,
    });

    const { count, date } = storedUsage;

    // ✅ Reset if it's a new day
    if (date !== today) {
      const newUsage = { count: 0, date: today };
      updateLocalState('translationUsage', newUsage);
      return true;
    }

    // ✅ Check if under limit (5 translations per day)
    return count < 5;
  }, [updateLocalState]);

  const applyCustomerInfo = customerInfo => {
    if (!customerInfo) return;

    const entitlements = customerInfo.entitlements?.active || {};
    const proKey = Object.keys(entitlements).find(
      key => key.toLowerCase() === 'pro'
    );
    const proStatus = !!(proKey && entitlements[proKey]);

    // console.log(proStatus, 'pro')

    // persist pro
    updateLocalState('isPro', proStatus);

    // store subs + expiry
    setMySubscriptions(
      proStatus
        ? customerInfo.activeSubscriptions.map(plan => ({
            plan,
            expiry: customerInfo.allExpirationDates[plan] || null,
          }))
        : []
    );
  };

  // Listen for any customerInfo updates (including from RevenueCat UI paywall)
  useEffect(() => {
    const removeListener =
      Purchases.addCustomerInfoUpdateListener(applyCustomerInfo);
    return () => {
      if (typeof removeListener === 'function') {
        removeListener();
      }
    };
  }, []);

  // ✅ FIXED: Read from storage first, then increment for real-time accuracy
  const incrementTranslationCount = useCallback(() => {
    const today = new Date().toDateString();
    // ✅ Read directly from storage to get latest value (not from stale localState)
    const storedUsage = safeParseJSON('translationUsage', {
      count: 0,
      date: today,
    });

    const { count, date } = storedUsage;

    // ✅ Increment count (reset to 1 if new day)
    const updatedUsage = {
      count: date === today ? count + 1 : 1,
      date: today,
    };

    // ✅ Update both storage and state for immediate sync
    updateLocalState('translationUsage', updatedUsage);
  }, [updateLocalState]);

  const toggleAd = useCallback(() => {
    // ✅ Read directly from storage to get latest value
    const currentVal = storage.getBoolean('showAd1') ?? true;
    const newAdState = !currentVal;
    updateLocalState('showAd1', newAdState);
    return newAdState;
  }, [updateLocalState]);

  // Initialize RevenueCat once
  const initRevenueCat = async () => {
    try {
      await Purchases.configure({
        apiKey: config.apiKey,
        usesStoreKit2IfAvailable: false,
      });

      await checkEntitlements().catch(error => {
        console.error('❌ Error checking entitlements:', error.message);
        return null;
      });
    } catch (error) {
      console.error('❌ Error initializing RevenueCat:', error.message);
      setMySubscriptions([]);
    }
  };

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      initRevenueCat();
    });
    return () => task.cancel();
  }, []);

  const checkEntitlements = async () => {
    try {
      const customerInfo = await Purchases.getCustomerInfo();
      applyCustomerInfo(customerInfo);
    } catch (error) {
      console.error('❌ Error checking entitlements:', error);
    }
  };

  const clearKey = useCallback((key) => {
    setLocalState(prevState => {
      const newState = { ...prevState };
      delete newState[key];
      return newState;
    });

    storage.remove(key);
  }, []);

  const clearAll = useCallback(() => {
    setLocalState({});
    storage.clearAll();
  }, []);

  // ✅ FIXED: Read directly from storage for real-time accuracy
  const getRemainingTranslationTries = useCallback(() => {
    const today = new Date().toDateString();
    // ✅ Read directly from storage to get latest value (not from stale localState)
    const storedUsage = safeParseJSON('translationUsage', {
      count: 0,
      date: today,
    });

    const { count = 0, date = today } = storedUsage;
    // ✅ Return remaining tries (reset to 5 if new day)
    return date === today ? Math.max(0, 5 - count) : 5;
  }, []);

  const refreshCustomerInfo = useCallback(async () => {
    try {
      const customerInfo = await Purchases.getCustomerInfo();
      applyCustomerInfo(customerInfo);
    } catch (e) {
      // ignore
    }
  }, []);

  const contextValue = useMemo(
    () => ({
      localState,
      updateLocalState,
      clearKey,
      clearAll,
      mySubscriptions,
      canTranslate,
      incrementTranslationCount,
      getRemainingTranslationTries,
      toggleAd,
      refreshCustomerInfo,
    }),
    [localState, mySubscriptions, updateLocalState, clearKey, clearAll, canTranslate, incrementTranslationCount, getRemainingTranslationTries, toggleAd, refreshCustomerInfo]
  );

  return (
    <LocalStateContext.Provider value={contextValue}>
      {children}
    </LocalStateContext.Provider>
  );
};
