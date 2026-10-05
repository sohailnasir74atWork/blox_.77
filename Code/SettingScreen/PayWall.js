// PayWall.js
// Store plumbing for the custom paywall in OfferWall.jsx. It used to hand off
// to react-native-purchases-ui (RevenueCatUI.presentPaywall); that library
// pulled Jetpack Compose + RevenueCatUI into the Android build and crashed on
// some devices loading its downloaded paywall font. The products, offerings
// ('default' and 'paywallrc') and the 'pro' entitlement are unchanged.
import Purchases from 'react-native-purchases';

const ENTITLEMENT_ID = 'pro';

export const OFFERING_MAIN = 'default';
export const OFFERING_DISCOUNT = 'paywallrc';

export const hasProEntitlement = (customerInfo) => {
  const active = customerInfo?.entitlements?.active || {};
  return Object.keys(active).some((k) => k.toLowerCase() === ENTITLEMENT_ID);
};

let cachedOfferings = null;

// { default: Offering|null, paywallrc: Offering|null }. Cached after the first
// success; the SDK caches too, so a repeat open costs no network.
export const getPaywallOfferings = async () => {
  try {
    const offerings = await Purchases.getOfferings();
    cachedOfferings = offerings?.all || cachedOfferings;
  } catch (e) {
    // fall back to whatever loaded last time
  }
  const all = cachedOfferings || {};
  return {
    [OFFERING_MAIN]: all[OFFERING_MAIN] || null,
    [OFFERING_DISCOUNT]: all[OFFERING_DISCOUNT] || null,
  };
};

// Warm the cache on app start so the wall opens with prices already loaded.
export const preloadOfferings = () => { getPaywallOfferings().catch(() => {}); };

// → { pro: boolean, cancelled: boolean, error?: string }
export const purchasePaywallPackage = async (pkg) => {
  try {
    // Coming back from the store sheet must not open an App Open ad on someone
    // who was just buying ad-free.
    require('../Ads/openApp').default.skipNextForeground();
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { pro: hasProEntitlement(customerInfo), cancelled: false };
  } catch (e) {
    return { pro: false, cancelled: !!e?.userCancelled, error: e?.message };
  }
};

// → { pro: boolean, error?: string }
export const restorePaywallPurchases = async () => {
  try {
    const customerInfo = await Purchases.restorePurchases();
    return { pro: hasProEntitlement(customerInfo) };
  } catch (e) {
    return { pro: false, error: e?.message };
  }
};
