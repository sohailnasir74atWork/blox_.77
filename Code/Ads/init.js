// Centralised AdMob initialisation.
//
// Why this exists: the request configuration (maxAdContentRating 'T', child
// treatment flag) MUST be applied before the first ad request, otherwise the
// first impressions of the session — including the high-value App Open ad —
// get served at AdMob's default 'G' ceiling and lower eCPM. Previously the
// config ran in one requestIdleCallback while the ad managers loaded in a
// separate one, so ordering was a coin flip.
//
// ensureAdsInitialized() returns a single shared promise: setRequestConfiguration
// first, then initialize(). Every ad loader awaits it before calling load(), so
// no ad is ever requested before the config lands. Safe to call any number of
// times from anywhere — the work runs once.
import { MobileAds, MaxAdContentRating } from 'react-native-google-mobile-ads';

let initPromise = null;

export function ensureAdsInitialized() {
  if (!initPromise) {
    initPromise = MobileAds()
      .setRequestConfiguration({
        // 'T' (Teen) opens up Teen-rated inventory that AdMob's default 'G'
        // ceiling silently locks out — matches our Play Console 13+ audience.
        maxAdContentRating: MaxAdContentRating.T,
        // Confirms this is NOT a kids-app build, avoiding the conservative
        // kids pricing AdMob applies when treatment is left unspecified.
        tagForChildDirectedTreatment: false,
        // Explicit: not a mixed-audience under-age build either — leaving it
        // unspecified lets AdMob guess; false keeps personalized ads eligible.
        tagForUnderAgeOfConsent: false,
      })
      .then(() => MobileAds().initialize())
      .catch((err) => {
        // Reset so a transient failure can be retried by the next caller
        // instead of permanently poisoning the promise.
        initPromise = null;
        throw err;
      });
  }
  return initPromise;
}
