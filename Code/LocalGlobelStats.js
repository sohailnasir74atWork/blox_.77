import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { Appearance } from 'react-native';
import { MMKV } from 'react-native-mmkv';
import Purchases from 'react-native-purchases';
import config from './Helper/Environment';
import { useTranslation } from 'react-i18next';
import { InteractionManager } from 'react-native';

const storage = new MMKV();
const LocalStateContext = createContext();

export const useLocalState = () => useContext(LocalStateContext);

export const LocalStateProvider = ({ children }) => {
  // Initial local state
  const safeParseJSON = (key, defaultValue) => {
    try {
      const value = storage.getString(key);
      return value ? JSON.parse(value) : defaultValue;
    } catch (error) {
      console.error(`🚨 JSON Parse Error for key "${key}":`, error);
      return defaultValue; // Return a safe fallback value
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
    translationUsage: safeParseJSON('translationUsage', { count: 0, date: new Date().toDateString() }),

  }));


  // RevenueCat states
  const [customerId, setCustomerId] = useState(null);
  // const [isPro, setIsPro] = useState(true); // Sync with MMKV storage
  const [packages, setPackages] = useState([]);
  const [mySubscriptions, setMySubscriptions] = useState([]);
  const { t } = useTranslation();


  // Listen for system theme changes
  useEffect(() => {
    if (localState.theme === 'system') {
      const listener = Appearance.addChangeListener(({ colorScheme }) => {
        updateLocalState('theme', colorScheme);
      });
      return () => listener.remove(); // Correct cleanup
    }
  }, [localState.theme]);

  useEffect(() => {
    if (localState.data) {
      storage.set('data', JSON.stringify(localState.data)); // Force store
    }
  }, [localState.data]);

  // console.log(localState.isPro)
  // Update local state and MMKV storage
  const updateLocalState = (key, value) => {
    setLocalState((prevState) => ({
      ...prevState,
      [key]: value,
    }));

    // Save to MMKV storage
    if (typeof value === 'string') {
      storage.set(key, value);
    } else if (typeof value === 'number') {
      storage.set(key, value.toString());
    } else if (typeof value === 'boolean') {
      storage.set(key, value);
    } else if (typeof value === 'object') {
      storage.set(key, JSON.stringify(value)); // ✅ Store objects/arrays as JSON
    } else {
      console.error('🚨 MMKV supports only string, number, boolean, or JSON stringified objects.');
    }
  };
  const canTranslate = () => {
    const today = new Date().toDateString();
    const { count, date } = localState.translationUsage || { count: 0, date: today };

    if (date !== today) {
      // Reset count for new day
      const newUsage = { count: 0, date: today };
      updateLocalState('translationUsage', newUsage);
      return true;
    }

    return count < 20;
  };

  const incrementTranslationCount = () => {
    const today = new Date().toDateString();
    const { count, date } = localState.translationUsage || { count: 0, date: today };

    const updatedUsage = {
      count: date === today ? count + 1 : 1,
      date: today,
    };

    updateLocalState('translationUsage', updatedUsage);
  };


  // console.log(localState.data)
  // console.log(isPro)
  // Initialize RevenueCat
  const initRevenueCat = async () => {
    try {
      await Purchases.configure({ apiKey: config.apiKey, usesStoreKit2IfAvailable: false });
      const userID = await Purchases.getAppUserID();
      setCustomerId(userID);

      // Run these in parallel for better performance
      await Promise.all([
        fetchOfferings().catch(error => {
          console.error('❌ Error fetching offerings:', error.message);
          return null; // Return null instead of throwing
        }),
        checkEntitlements().catch(error => {
          console.error('❌ Error checking entitlements:', error.message);
          return null; // Return null instead of throwing
        })
      ]);
    } catch (error) {
      console.error('❌ Error initializing RevenueCat:', error.message);
      // Set a default state in case of failure
      setCustomerId(null);
      setPackages([]);
      setMySubscriptions([]);
    }
  };
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      initRevenueCat();
    });
    return () => task.cancel();
  }, []);

  // console.log(isPro)
  // Fetch available subscriptions
  const fetchOfferings = async () => {
    try {
      const offerings = await Purchases.getOfferings();
      if (offerings.current?.availablePackages?.length > 0) {
        setPackages(offerings.current.availablePackages);
      } else {
        console.warn('⚠️ No offerings found in RevenueCat.');
      }
    } catch (error) {
      console.error('❌ Fetch Offerings Error:', error.message);
    }
  };




  const restorePurchases = async (setLoadingReStore) => {
    setLoadingReStore(true);
    try {
      const customerInfo = await Purchases.restorePurchases();
      const entitlements = customerInfo.entitlements.active;
      const proKey = Object.keys(entitlements).find(
        (key) => key.toLowerCase() === 'pro'
      );
      const proStatus = !!(proKey && entitlements[proKey]);

      updateLocalState('isPro', proStatus);
      setMySubscriptions(
        proStatus
          ? customerInfo.activeSubscriptions.map((plan) => ({
            plan,
            expiry: customerInfo.allExpirationDates[plan] || null,
          }))
          : []
      );
    } catch (error) {
      console.error('❌ Restore Purchases Error:', error);
    } finally {
      setLoadingReStore(false); // Ensure loading state resets
    }
  };


  // Check if the user has an active subscription
  const checkEntitlements = async () => {
    try {
      const customerInfo = await Purchases.getCustomerInfo();
      const entitlements = customerInfo.entitlements.active;
      const proKey = Object.keys(entitlements).find(
        (key) => key.toLowerCase() === 'pro'
      );

      // console.log(customerInfo.activeSubscriptions)
      const proStatus = !!(proKey && entitlements[proKey]);
      if (proStatus) {
        updateLocalState('isPro', proStatus); // Persist Pro status in MMKV
        const activePlansWithExpiry = customerInfo.activeSubscriptions.map((subscription) => ({
          plan: subscription,
          expiry: customerInfo.allExpirationDates[subscription],
        }));
        setMySubscriptions(activePlansWithExpiry);
      }
    } catch (error) {
      console.error('❌ Error checking entitlements:', error);
    }
  };
  // Handle in-app purchase
  const purchaseProduct = async (packageToPurchase, setLoading, track) => {
    setLoading(true);
    try {
      const { customerInfo } = await Purchases.purchasePackage(packageToPurchase);
      const entitlements = customerInfo.entitlements.active;
      const proKey = Object.keys(entitlements).find(
        (key) => key.toLowerCase() === 'pro'
      );
      const proStatus = !!(proKey && entitlements[proKey]);

      updateLocalState('isPro', proStatus);
      setMySubscriptions(
        proStatus
          ? customerInfo.activeSubscriptions.map((plan) => ({
            plan,
            expiry: customerInfo.allExpirationDates[plan] || null,
          }))
          : []
      );

      if (track) {
        mixpanel.track('Purchase Completed', {
          package: packageToPurchase.identifier,
          price: packageToPurchase.product.price,
          currency: packageToPurchase.product.currencyCode,
        });
      }

      showSuccessMessage("Success", "Purchase completed successfully!");
    } catch (error) {
      if (!error.userCancelled) {
        console.error('❌ Purchase Error:', error);
        showErrorMessage("Error", "Failed to complete purchase. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

 
  // Clear a specific key
  const clearKey = (key) => {
    setLocalState((prevState) => {
      const newState = { ...prevState };
      delete newState[key];
      return newState;
    });

    storage.delete(key);
  };

  // Clear all local state and MMKV storage
  const clearAll = () => {
    setLocalState({});
    storage.clearAll();
  };

  const getRemainingTranslationTries = () => {
    const today = new Date().toDateString();
    const { count = 0, date = today } = localState.translationUsage || {};
    return date === today ? 20 - count : 20;
  };


  const contextValue = useMemo(
    () => ({
      localState,
      updateLocalState,
      clearKey,
      clearAll,
      customerId,
      packages,
      mySubscriptions,
      purchaseProduct,
      restorePurchases,
      canTranslate,
      incrementTranslationCount,
      getRemainingTranslationTries
    }),
    [localState, customerId, packages, mySubscriptions]
  );

  return (
    <LocalStateContext.Provider value={contextValue}>
      {children}
    </LocalStateContext.Provider>
  );
};
