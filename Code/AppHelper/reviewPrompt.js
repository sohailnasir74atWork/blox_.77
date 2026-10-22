// Store review prompt, asked only right after the app helped the user (a good
// calculator result, a growing owned / wishlist collection) and never next to
// a full-screen ad. Logging a trade is left out: an interstitial follows it.
// Replaces the old every-6th-launch ask, which fired at cold start alongside
// the app-open ad, UMP and ATT.
//
// The OS has the final say: iOS shows the sheet at most 3 times a year and Play
// applies its own quota, so each request should land on a good moment. Either
// platform may show nothing, and the app cannot tell whether it did.
import { AppState } from 'react-native';
import InAppReview from 'react-native-in-app-review';
import { isFullScreenAdVisible, msSinceAnyFullScreenAd } from '../Ads/adVisibility';

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV();
} catch (e) {
  storage = { getString: () => undefined, set: () => {} };
}

const KEY_LAST_ASK = 'reviewPrompt.lastAskAt';
const KEY_ACTIVE_DAYS = 'reviewPrompt.activeDays';
const KEY_LAST_DAY = 'reviewPrompt.lastActiveDay';
const KEY_COLLECTION_ADDS = 'reviewPrompt.collectionAdds';

const MIN_ACTIVE_DAYS = 3; // a returning user, not a first-day install
const COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;
const AD_GAP_MS = 60 * 1000; // since any interstitial / rewarded / app-open ad
const ASK_DELAY_MS = 1500; // let the success toast or card land first
const CALC_CHECKS_PER_SESSION = 5;
const COLLECTION_ADDS_NEEDED = 3;

let calcChecksThisSession = 0;
let pending = false;

const readNumber = (key) => Number(storage.getString(key)) || 0;

const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// Called once per launch. Counts distinct days the app was opened.
export const noteReviewActiveDay = () => {
  try {
    const today = localDay();
    if (storage.getString(KEY_LAST_DAY) === today) return;
    let days = readNumber(KEY_ACTIVE_DAYS);
    if (!storage.getString(KEY_LAST_DAY)) {
      // First launch on this build: users of the old launch counter are
      // already returning users, so they do not wait another 3 days.
      days = Math.min(readNumber('reviewCount'), MIN_ACTIVE_DAYS - 1);
    }
    storage.set(KEY_ACTIVE_DAYS, String(days + 1));
    storage.set(KEY_LAST_DAY, today);
  } catch (_) {}
};

const canAsk = () =>
  !pending &&
  readNumber(KEY_ACTIVE_DAYS) >= MIN_ACTIVE_DAYS &&
  Date.now() - readNumber(KEY_LAST_ASK) >= COOLDOWN_MS &&
  !isFullScreenAdVisible() &&
  msSinceAnyFullScreenAd() >= AD_GAP_MS;

// reason: 'calculator' (a settled profit/even check) or 'collection' (a fruit
// added to owned / wishlist). Any other reason asks at once. Call only on
// screens with no ad attached to that action.
export const maybeAskForReview = (reason) => {
  try {
    if (reason === 'calculator') {
      calcChecksThisSession += 1;
      if (calcChecksThisSession < CALC_CHECKS_PER_SESSION) return;
    } else if (reason === 'collection') {
      const adds = readNumber(KEY_COLLECTION_ADDS) + 1;
      storage.set(KEY_COLLECTION_ADDS, String(adds));
      if (adds < COLLECTION_ADDS_NEEDED) return;
    }
    if (!canAsk()) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      try {
        // An ad may have opened, or the user left, during the delay.
        if (!canAsk() || AppState.currentState !== 'active') return;
        if (!InAppReview.isAvailable()) return;
        storage.set(KEY_LAST_ASK, String(Date.now()));
        InAppReview.RequestInAppReview().catch(() => {});
      } catch (_) {}
    }, ASK_DELAY_MS);
  } catch (_) {
    pending = false;
  }
};
