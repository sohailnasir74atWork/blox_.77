import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
} from 'react';
import { Appearance, InteractionManager } from 'react-native';
import { MMKV } from 'react-native-mmkv';
import Purchases from 'react-native-purchases';
import config from './Helper/Environment';

const storage = new MMKV();
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
    isAppReady: storage.getBoolean('isAppReady') ?? false,
    lastActivity: storage.getString('lastActivity') || null,
    showOnBoardingScreen: storage.getBoolean('showOnBoardingScreen') ?? true,
    user_name: storage.getString('user_name') || 'Anonymous',
    translationUsage: safeParseJSON('translationUsage', {
      count: 0,
      date: new Date().toDateString(),
    }),
    showAd1: storage.getBoolean('showAd1') ?? true,
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

  const updateLocalState = (key, value) => {
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
  };

  const canTranslate = () => {
    const today = new Date().toDateString();
    const { count, date } = localState.translationUsage || {
      count: 0,
      date: today,
    };

    if (date !== today) {
      const newUsage = { count: 0, date: today };
      updateLocalState('translationUsage', newUsage);
      return true;
    }

    return count < 5;
  };

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

  const incrementTranslationCount = () => {
    const today = new Date().toDateString();
    const { count, date } = localState.translationUsage || {
      count: 0,
      date: today,
    };

    const updatedUsage = {
      count: date === today ? count + 1 : 1,
      date: today,
    };

    updateLocalState('translationUsage', updatedUsage);
  };

  const toggleAd = () => {
    const newAdState = !localState.showAd1;
    updateLocalState('showAd1', newAdState);
    return newAdState;
  };

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

  const clearKey = key => {
    setLocalState(prevState => {
      const newState = { ...prevState };
      delete newState[key];
      return newState;
    });

    storage.delete(key);
  };

  const clearAll = () => {
    setLocalState({});
    storage.clearAll();
  };

  const getRemainingTranslationTries = () => {
    const today = new Date().toDateString();
    const { count = 0, date = today } = localState.translationUsage || {};
    return date === today ? 5 - count : 5;
  };

  const refreshCustomerInfo = async () => {
    try {
      const customerInfo = await Purchases.getCustomerInfo();
      applyCustomerInfo(customerInfo);
    } catch (e) {
      // ignore
    }
  };

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
    [localState, mySubscriptions]
  );

  return (
    <LocalStateContext.Provider value={contextValue}>
      {children}
    </LocalStateContext.Provider>
  );
};
