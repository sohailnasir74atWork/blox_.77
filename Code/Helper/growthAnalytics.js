import {getAnalytics, logEvent} from '@react-native-firebase/analytics';

// Uses the app's existing Analytics collection settings. No item names,
// search strings, emails, or account identifiers are sent by these events.
export const trackGrowthEvent = (event, params = {}) => {
  try {
    Promise.resolve(logEvent(getAnalytics(), event, params)).catch(() => {});
  } catch {
    // Measurement must never block the calculator or onboarding.
  }
};

// ── Offer wall ──
// The same three events in the MM2, Adopt Me and Blox Fruit apps:
//   paywall_view  — the wall was shown
//   paywall_close — closed with the × (or Android back) without buying
//   pro_purchase  — a plan was bought on it
// Each carries paywall_source (the screen that opened it) and placement
// ('onboarding' for the first-run wall, 'in_app' for every later one), so GA4
// can answer "how many buy during onboarding vs. after using the app?".

// Callers pass display strings ('On Boarding', 'Remove Ads', 'Trade'); GA4
// gets one stable lowercase name for each.
export const paywallSource = track => {
  const key = String(track || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!key) return 'unknown';
  return key === 'on_boarding' ? 'onboarding' : key;
};

export const paywallPlacement = track =>
  (paywallSource(track) === 'onboarding' ? 'onboarding' : 'in_app');

const paywallParams = track => ({
  paywall_source: paywallSource(track),
  placement: paywallPlacement(track),
});

export const trackPaywallView = track => trackGrowthEvent('paywall_view', paywallParams(track));
export const trackPaywallClose = track => trackGrowthEvent('paywall_close', paywallParams(track));

// A Pro purchase with its price. Deliberately not GA4's reserved `purchase`
// event: Analytics already auto-logs `in_app_purchase` for store purchases,
// and both count toward total revenue, so `purchase` would double it. Google
// Ads reads value/currency from any key event, so the custom name loses nothing.
export const trackProPurchase = (pkg, track) => {
  const product = pkg?.product || {};
  trackGrowthEvent('pro_purchase', {
    value: Number(product.price) || 0,
    currency: product.currencyCode || 'USD',
    product_id: product.identifier || 'unknown',
    plan: pkg?.packageType || 'unknown',
    ...paywallParams(track),
  });
};
