// proOfferings.js — which RevenueCat offerings the offer wall shows.
// Identical in the MM2, Adopt Me and Blox Fruit apps.
//
//   pro_full  — the first wall: $9.99 / $19.99 / $49.99, 3-day free trial for
//               new subscribers (set on the store products, not here).
//   pro_offer — the exit offer: the same plans at 50% off, shown ONCE per
//               install, right after someone closes the first wall unbought.
//   default   — the old prices. Fallback when pro_full can't load, and what
//               builds older than this one keep reading.
//
// Owner decisions 2026-11-10 (Ops/revenue/LOG.md). Every price shown comes
// from the store; nothing here hardcodes an amount.
import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';

export const OFFERING_FULL = 'pro_full';
export const OFFERING_EXIT = 'pro_offer';
export const OFFERING_FALLBACK = 'default';

// localState key (MMKV) — set the moment the exit offer is shown.
export const EXIT_OFFER_SHOWN_KEY = 'proExitOfferShown';

// Trigger name the exit offer reports to analytics (paywall_trigger).
export const EXIT_OFFER_TRIGGER = 'exit_offer';

let cachedAll = null;

// offerings.all — { [lookupKey]: Offering }. The SDK caches too, so a repeat
// open costs no network; on failure the last good copy is reused.
export const loadWallOfferings = async () => {
  try {
    const result = await Purchases.getOfferings();
    if (result?.all) cachedAll = result.all;
  } catch (e) {
    // keep the cached copy
  }
  return cachedAll || {};
};

const packagesOf = (all, key) => all?.[key]?.availablePackages || [];

// The first wall: the new prices, else the old offering, else whatever the
// app already loaded at launch.
export const fullWallPackages = (all, fallbackPackages) => {
  const full = packagesOf(all, OFFERING_FULL);
  if (full.length) return full;
  const old = packagesOf(all, OFFERING_FALLBACK);
  return old.length ? old : (fallbackPackages || []);
};

export const exitWallPackages = (all) => packagesOf(all, OFFERING_EXIT);

// Is the full-price wall showing the new prices (and so can lead to the exit
// offer)? False while it is on the old 'default' fallback.
export const isNewPricing = (all) => packagesOf(all, OFFERING_FULL).length > 0;

// iOS only: Apple gives the free trial to people who never subscribed in this
// subscription group, and the wall must not promise it to anyone else.
// → { [productId]: true | false }. Android needs no check: Google Play only
// returns offers the user is eligible for (product.defaultOption).
export const trialEligibility = async (packages) => {
  if (Platform.OS !== 'ios' || !packages?.length) return {};
  const ids = packages.map((p) => p?.product?.identifier).filter(Boolean);
  try {
    const res = await Purchases.checkTrialOrIntroductoryPriceEligibility(ids);
    const out = {};
    ids.forEach((id) => { out[id] = res?.[id]?.status === 2; }); // INTRO_ELIGIBILITY_STATUS_ELIGIBLE
    return out;
  } catch (e) {
    return {};
  }
};

// For the exit offer: the full-price package of the same billing period, so
// the wall can show the real "was" price and the real % off.
export const matchByPeriod = (packages, periodOf) => {
  const map = {};
  (packages || []).forEach((p) => { const k = periodOf(p); if (k && !map[k]) map[k] = p; });
  return map;
};
