// Shared NPA (non-personalized ads) decision.
//
// Forcing requestNonPersonalizedAdsOnly:true on EVERY user cut eCPM ~40-60%
// for the ~80% of traffic outside the EEA that would happily take personalized
// ads; hardcoding it to `false` is the opposite mistake — it serves
// personalized ads to EEA users who haven't consented, which is a policy
// violation. Decide from the persisted UMP consentStatus instead:
//   * NOT_REQUIRED → outside the EEA; personalized ads are fine.
//   * OBTAINED     → consent form completed; the SDK reads the IAB TCF v2
//                    string and serves the right flavour automatically — we
//                    must NOT override it.
//   * REQUIRED / UNKNOWN → form not completed; default to NPA so we stay
//                    compliant until the user makes a choice.

let storage = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV();
} catch (_) {}

// Pure form — caller already has the consent status (e.g. from localState).
export const npaRequiredFor = (status) =>
  status !== 'OBTAINED' && status !== 'NOT_REQUIRED';

// MMKV-reading form — for singletons / non-React modules (NativeAdPool, ad
// managers) that can't read localState. consentStatus is persisted by App.js's
// saveConsentStatus under the same MMKV key.
export const npaRequired = () => {
  let status = 'UNKNOWN';
  try {
    status = (storage && storage.getString('consentStatus')) || 'UNKNOWN';
  } catch (_) {}
  return npaRequiredFor(status);
};
