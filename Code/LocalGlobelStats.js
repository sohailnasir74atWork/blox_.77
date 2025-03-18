import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { Alert, Appearance } from 'react-native'; // For system theme detection
import { MMKV } from 'react-native-mmkv';
import Purchases from 'react-native-purchases'; // Ensure react-native-purchases is installed
import config from './Helper/Environment';
import { showMessage } from 'react-native-flash-message';
import { useTranslation } from 'react-i18next';
import { mixpanel } from './AppHelper/MixPenel';

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

  // console.log(isPro)
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

  // console.log(localState.data)
  // console.log(isPro)
  // Initialize RevenueCat
  useEffect(() => {
    const initRevenueCat = async () => {
      try {
        await Purchases.configure({ apiKey: config.apiKey, usesStoreKit2IfAvailable: false });
        // Fetch customer ID
        const userID = await Purchases.getAppUserID();
        setCustomerId(userID);

        // Load offerings & check entitlements
        await fetchOfferings();
        await checkEntitlements();
      } catch (error) {
        console.error('❌ Error initializing RevenueCat:', error.message);
      }
    };

    initRevenueCat();
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
      const proStatus = !!customerInfo.entitlements.active['Pro'];
  
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
      const proStatus = !!customerInfo.entitlements.active['Pro'];

      // setIsPro(proStatus);
      updateLocalState('isPro', proStatus); // Persist Pro status in MMKV

      if (proStatus) {
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
      if (!packageToPurchase?.product) return;
      
      const { customerInfo } = await Purchases.purchasePackage(packageToPurchase);
      const isPro = !!customerInfo.entitlements.active['Pro'];
  
      if (isPro) {
        showMessage({
          message: t('trade.delete_success'),
          description: t('trade.purchase_success'),
          type: 'success',
        });
        updateLocalState('isPro', true);
        mixpanel.track(`Pro from ${track}`);
      }
    } catch (error) {
      console.error('❌ Purchase Error:', error);
    } finally {
      setLoading(false); // Always reset loading state
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
      restorePurchases
    }),
    [localState, customerId, packages, mySubscriptions]
  );

  return (
    <LocalStateContext.Provider value={contextValue}>
      {children}
    </LocalStateContext.Provider>
  );
};
