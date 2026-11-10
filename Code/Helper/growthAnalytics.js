import {getAnalytics, logEvent} from '@react-native-firebase/analytics';
import Purchases from 'react-native-purchases';

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
// The same events in the MM2, Adopt Me and Blox Fruit apps:
//   paywall_view           — the wall was shown
//   paywall_close          — closed with the × (or Android back) without buying
//   paywall_purchase_start — Continue tapped, the store sheet is about to open
//   paywall_purchase_fail  — the store sheet came back without Pro (reason:
//                            cancelled, payment_pending, store_problem, …,
//                            no_entitlement when the store charged but Pro
//                            did not arrive)
//   pro_purchase           — a plan was bought on it
// Each carries
//   paywall_source  — the screen that opened it ('onboarding', 'setting', …)
//   placement       — 'onboarding' for the first-run wall, 'in_app' otherwise
//   paywall_trigger — the exact spot on that screen ('setting_pro_card',
//                     'setting_online_status', 'trade_boost_limit', …)
// so GA4 can answer "which button sells Pro?", not only "which screen?".

const cleanKey = v =>
  String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// Callers pass display strings ('On Boarding', 'Remove Ads', 'Trade'); GA4
// gets one stable lowercase name for each.
export const paywallSource = track => {
  const key = cleanKey(track);
  if (!key) return 'unknown';
  return key === 'on_boarding' ? 'onboarding' : key;
};

export const paywallPlacement = track =>
  (paywallSource(track) === 'onboarding' ? 'onboarding' : 'in_app');

// The spot inside the screen. The onboarding wall has only one spot, so it
// needs no trigger from its caller.
export const paywallTrigger = (track, trigger) => {
  const key = cleanKey(trigger);
  if (key) return key.slice(0, 100);
  return paywallSource(track) === 'onboarding' ? 'onboarding' : 'unknown';
};

const paywallParams = (track, trigger) => ({
  paywall_source: paywallSource(track),
  placement: paywallPlacement(track),
  paywall_trigger: paywallTrigger(track, trigger),
});

const planParams = pkg => ({
  product_id: pkg?.product?.identifier || 'unknown',
  plan: pkg?.packageType || 'unknown',
});

// Whole days since RevenueCat first saw this customer, so GA4 can tell
// "bought on install day" from "came back a week later". null when unknown.
const daysSinceFirstSeen = customerInfo => {
  const t = Date.parse(customerInfo?.firstSeen || '');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};

// 'cancelled', 'payment_pending', 'store_problem', … from a RevenueCat
// error; 'no_entitlement' when the purchase went through without Pro.
export const purchaseFailReason = error => {
  if (!error) return 'no_entitlement';
  if (error.userCancelled) return 'cancelled';
  const readable = error.readableErrorCode || error.userInfo?.readableErrorCode || '';
  const key = cleanKey(readable).replace(/_error$/, '');
  if (key) return key.slice(0, 100);
  return error.code != null ? `code_${cleanKey(error.code)}` : 'error';
};

export const trackPaywallView = (track, trigger) =>
  trackGrowthEvent('paywall_view', paywallParams(track, trigger));
export const trackPaywallClose = (track, trigger) =>
  trackGrowthEvent('paywall_close', paywallParams(track, trigger));

// Call right before Purchases.purchasePackage. Also stores the source on the
// RevenueCat customer (sent with the purchase), so RevenueCat's own revenue,
// renewals and refunds can be split by where the subscription started.
export const trackPurchaseStart = (pkg, track, trigger) => {
  const params = paywallParams(track, trigger);
  trackGrowthEvent('paywall_purchase_start', {...planParams(pkg), ...params});
  try {
    Promise.resolve(
      Purchases.setAttributes({
        paywall_source: params.paywall_source,
        paywall_placement: params.placement,
        paywall_trigger: params.paywall_trigger,
      }),
    ).catch(() => {});
  } catch {
    // Attribution must never block a purchase.
  }
};

export const trackPurchaseFail = (pkg, track, trigger, error) =>
  trackGrowthEvent('paywall_purchase_fail', {
    ...planParams(pkg),
    reason: purchaseFailReason(error),
    ...paywallParams(track, trigger),
  });

// A Pro purchase with its price. Deliberately not GA4's reserved `purchase`
// event: Analytics already auto-logs `in_app_purchase` for store purchases,
// and both count toward total revenue, so `purchase` would double it. Google
// Ads reads value/currency from any key event, so the custom name loses nothing.
export const trackProPurchase = (pkg, track, trigger, customerInfo) => {
  const product = pkg?.product || {};
  const days = daysSinceFirstSeen(customerInfo);
  trackGrowthEvent('pro_purchase', {
    value: Number(product.price) || 0,
    currency: product.currencyCode || 'USD',
    ...planParams(pkg),
    ...(days == null ? {} : {days_since_first_seen: days}),
    ...paywallParams(track, trigger),
  });
};
