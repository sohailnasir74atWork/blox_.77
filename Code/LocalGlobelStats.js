import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { Alert, Appearance } from 'react-native'; // For system theme detection
import { MMKV } from 'react-native-mmkv';
import Purchases from 'react-native-purchases'; // Ensure react-native-purchases is installed
import config from './Helper/Environment';

const storage = new MMKV();
const LocalStateContext = createContext();

export const useLocalState = () => useContext(LocalStateContext);

export const LocalStateProvider = ({ children }) => {
  // Initial local state
  const [localState, setLocalState] = useState(() => {
    const systemTheme = Appearance.getColorScheme(); // 'light' or 'dark'
    const storedTheme = storage.getString('theme');
    const initialTheme = storedTheme === 'system' || !storedTheme ? systemTheme : storedTheme;

    return {
      localKey: storage.getString('localKey') || 'defaultValue',
      reviewCount: parseInt(storage.getString('reviewCount') || '0', 10), // Ensure reviewCount is a number
      lastVersion: storage.getString('lastVersion') || 'UNKNOWN',
      updateCount: parseInt(storage.getString('updateCount') || '0', 10),
      isHaptic: storage.getBoolean('isHaptic') ?? true,
      theme: initialTheme, // Default to system theme if not set
      userId: storage.getString('userId') || null, // Store User ID
      consentStatus: storage.getString('consentStatus') || 'UNKNOWN',
      isPro: storage.getBoolean('isPro') ?? false, 
      fetchDataTime: storage.getString('fetchDataTime') || null,
      data: JSON.parse(storage.getString('data') || '{}'),
      codes: JSON.parse(storage.getString('codes') || '{}'),
      normalStock: JSON.parse(storage.getString('normalStock') || '[]'),
      bannedUsers: JSON.parse(storage.getString('bannedUsers') || '[]'),
      mirageStock: JSON.parse(storage.getString('mirageStock') || '[]'),
      prenormalStock: JSON.parse(storage.getString('prenormalStock') || '[]'),
      premirageStock: JSON.parse(storage.getString('premirageStock') || '[]'),
      isAppReady: storage.getBoolean('isAppReady') ?? false,
      lastActivity: storage.getString('lastActivity') || null,
      showOnBoardingScreen: storage.getBoolean('showOnBoardingScreen') ?? true,
    };
  });

  // RevenueCat states
  const [customerId, setCustomerId] = useState(null);
  // const [isPro, setIsPro] = useState(true); // Sync with MMKV storage
  const [packages, setPackages] = useState([]);
  const [mySubscriptions, setMySubscriptions] = useState([]);

  // Listen for system theme changes
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
      if (offerings.current?.availablePackages.length > 0) {
        // console.log('✅ Offerings loaded:', offerings.current.availablePackages);

        setPackages(offerings.current.availablePackages);
      } else {
        console.warn('⚠️ No offerings found. Check RevenueCat settings.');
      }
    } catch (error) {
      console.error('❌ Error fetching offerings:', error.message);
    }
  };



  const restorePurchases = async (setLoadingReStore) => {
    setLoadingReStore(true)
    try {
      const customerInfo = await Purchases.restorePurchases();
  
      if (customerInfo.entitlements.active['Pro']) {
        // console.log('✅ Purchases restored! Pro features unlocked.');
        // setIsPro(true);
        updateLocalState('isPro', true);
        const activePlansWithExpiry = customerInfo.activeSubscriptions.map((subscription) => ({
          plan: subscription,
          expiry: customerInfo.allExpirationDates[subscription],
        }));
        setMySubscriptions(activePlansWithExpiry);
      } else {
        console.warn('⚠️ No active subscriptions found.');
        // setsPro(false);
        updateLocalState('isPro', false);
        setLoadingReStore(false)

      }
    } catch (error) {
      console.error('❌ Error restoring purchases:', error);
      setLoadingReStore(false)

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
  const purchaseProduct = async (packageToPurchase, setLoading) => {
    // console.log("🛒 Starting purchase process...");

  setLoading(true)
    try {
      if (!packageToPurchase || !packageToPurchase.product) {
        console.error("🚨 Invalid package passed:", JSON.stringify(packageToPurchase, null, 2));
        return;
      }
  
      // console.log("📦 Package details:", packageToPurchase.identifier);
      // console.log("💰 Attempting to purchase:", packageToPurchase.product.title);
  
      // ✅ Attempt the purchase
      const { customerInfo } = await Purchases.purchasePackage(packageToPurchase);
  
      // console.log("✅ Apple purchase dialog completed! Checking purchase status...");
      // console.log("🛒 Purchased productIdentifier:", productIdentifier);
  
      // ✅ Check if user has "Pro" entitlement
      if (customerInfo.entitlements.active["Pro"]) {
        // console.log("🎉 Purchase successful! User now has Pro features.");
        Alert.alert("🎉 Purchase successful! User now has Pro features.")
        updateLocalState("isPro", true);
      } else {
        // console.warn("⚠️ Purchase completed, but Pro entitlement NOT active!");
        // console.warn("🛒 Customer Info:", JSON.stringify(customerInfo, null, 2));
      }
      setLoading(false)

    } catch (error) {
      console.error("❌ Error during purchase:", error);
      // Alert.alert(`Error during purchase:", ${error}`)
      setLoading(false)
  
      if (error.userCancelled) {
        console.warn("🚫 User cancelled the purchase.");
      } else if (error.code === Purchases.PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED) {
        console.error("🔒 Purchases not allowed on this device (Parental Controls?)");
      } else if (error.code === Purchases.PURCHASES_ERROR_CODE.NETWORK_ERROR) {
        console.error("📶 Network error - Check internet connection!");
      } else {
        console.error("🔥 Unknown purchase error:", error.code, error.message);

      }
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
