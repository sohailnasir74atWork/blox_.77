// Centralised AdMob initialisation.
//
// Why this exists: the request configuration (maxAdContentRating 'T', child
// treatment flag) MUST be applied before the first ad request, otherwise the
// first impressions of the session — including the high-value App Open ad —
// get served at AdMob's default 'G' ceiling and lower eCPM. Previously the
// config ran in one requestIdleCallback while the ad managers loaded in a
// separate one, so ordering was a coin flip.
//
// Consent comes first. Google's required order is: gather UMP consent →
// check canRequestAds → initialise → request. Before the gate below, the
// interstitial manager started loading on App mount while the consent form
// was still on screen, so EEA users' first requests went out with no TC
// string (non-compliant, and limited-ads pricing). App.js runs the consent
// flow (UMP form, then iOS ATT) and calls openAdsGate() when it is done;
// nothing initialises or requests an ad before that.
//
// ensureAdsInitialized() returns a single shared promise: gate (skipped when
// consent from an earlier session already allows ads) → consent check →
// setRequestConfiguration → initialize(). Every ad loader awaits it before
// calling load(), so no ad is ever requested before consent and config land.
// Safe to call any number of times from anywhere — the work runs once.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { AdsConsent, MobileAds, MaxAdContentRating } from 'react-native-google-mobile-ads';
import { getTrackingStatus } from 'react-native-tracking-transparency';
import { adLog } from './adTelemetry';

let releaseAdsGate;
const adsGate = new Promise((resolve) => { releaseAdsGate = resolve; });

// Called by App.js once the consent flow has finished (or failed). Idempotent.
export const openAdsGate = () => releaseAdsGate();

// Resolves once the gate above opens: App.js mounts (and so starts the UMP →
// iOS ATT chain) only after onboarding, so this is also "onboarding done".
// For other first-launch prompts that must not stack on those screens
// (Code/Helper/valueUpdateAlerts.js). Never rejects.
export const whenAdsGateOpen = () => adsGate;

// Show the UMP form if this user needs it, and return the resulting consent
// info. Never throws: offline / SDK errors fall back to the SDK's cached info,
// or null when even that is unavailable.
// While it runs, the UMP form may be on screen: openApp.js holds the launch
// ad until it is done (a returning user's launch ad loads in parallel with
// this refresh and used to be able to present over a re-shown form).
let consentFlow = null;
export const isConsentFlowActive = () => consentFlow !== null;
export const whenConsentFlowIdle = () => consentFlow || Promise.resolve();

// One UMP consent refresh per launch, shared by the two callers below. It is
// started as early as possible because UMP only reports the consent stored by
// an earlier session (canRequestAds) once this session's refresh has been
// requested — before that it always says false (verified on the emulator,
// 2026-10-12), which made every returning user's launch ad wait for the full
// refresh and miss its window (`launch_ad` outcome not_loaded).
let consentRefresh = null;
function startConsentRefresh() {
  if (!consentRefresh) {
    try {
      // Called synchronously so the native request is queued before any
      // getConsentInfo() that follows it.
      consentRefresh = AdsConsent.requestInfoUpdate().catch(() => null);
    } catch (_) {
      consentRefresh = Promise.resolve(null);
    }
  }
  return consentRefresh;
}

export async function gatherAdsConsent() {
  let release;
  consentFlow = new Promise((resolve) => { release = resolve; });
  try {
    // Same steps as AdsConsent.gatherConsent(), sharing this launch's refresh.
    await startConsentRefresh();
    await AdsConsent.loadAndShowConsentFormIfRequired();
  } catch (_) {
  } finally {
    consentFlow = null;
    release();
  }
  try {
    return await AdsConsent.getConsentInfo();
  } catch (_) {
    return null;
  }
}

// Consent the user gave in an earlier session is kept on the device by UMP and
// is enough to request ads right away: Google's UMP sample initialises the SDK
// in parallel with the new session's consent refresh whenever canRequestAds()
// is already true. Waiting for the gate below (the consent refresh, a network
// round trip, then ATT) is what made the launch ad miss its splash window.
// First launches, anyone whose consent is still incomplete, and iOS users with
// the ATT prompt still to come keep waiting for the gate. getConsentInfo()
// reads the stored state; it makes no network call.
export async function canRequestAdsFromLastSession() {
  try {
    startConsentRefresh();
    const info = await AdsConsent.getConsentInfo();
    if (!info?.canRequestAds) return false;
    if (Platform.OS === 'ios' && (await getTrackingStatus()) === 'not-determined') return false;
    return true;
  } catch (_) {
    return false;
  }
}

let initPromise = null;
let initialized = false;

// True once the SDK is initialised and ads may be requested.
export const adsInitialized = () => initialized;

export function ensureAdsInitialized() {
  if (!initPromise) {
    initPromise = canRequestAdsFromLastSession()
      // Earlier consent stands: skip the gate. App.js still runs this
      // session's consent flow and opens the gate; that is a no-op by then.
      .then((alreadyConsented) => {
        if (__DEV__) console.log(`[ads] consent from last session usable: ${alreadyConsented}`);
        return alreadyConsented ? undefined : adsGate;
      })
      .then(() => AdsConsent.getConsentInfo())
      .then((info) => {
        // canRequestAds is false only when the UMP flow could not complete
        // (e.g. offline on a first EEA launch). No requests until it can.
        if (!info?.canRequestAds) throw new Error('ads-consent-not-ready');
        // Set BEFORE initialize() so every request — including the Next-Gen
        // SDK's, which folds it into its InitializationConfig — carries it.
        // No per-user age signal (owner decision, 2026-10-12): the app's own
        // date-of-birth data is not used for ads; Google applies its own
        // protections to accounts it knows are children or teens.
        return MobileAds().setRequestConfiguration({
          // 'T' (Teen) opens up Teen-rated inventory that AdMob's default 'G'
          // ceiling silently locks out — matches our Play Console 13+ audience.
          maxAdContentRating: MaxAdContentRating.T,
          // Confirms this is NOT a kids-app build, avoiding the conservative
          // kids pricing AdMob applies when treatment is left unspecified.
          tagForChildDirectedTreatment: false,
          // Explicit: not a mixed-audience under-age build either — leaving it
          // unspecified lets AdMob guess; false keeps personalized ads eligible.
          tagForUnderAgeOfConsent: false,
        });
      })
      .then(() => MobileAds().initialize())
      .then(() => {
        initialized = true;
        adLog('initialized');
      })
      .catch((err) => {
        // Reset so a transient failure (or consent completed later via the
        // privacy options form) can be retried by the next caller instead of
        // permanently poisoning the promise.
        initPromise = null;
        throw err;
      });
  }
  return initPromise;
}

// For components that render an ad view themselves (banners): false until the
// SDK may serve, so a <BannerAd> never mounts — and requests — before consent.
export function useAdsReady() {
  const [ready, setReady] = useState(initialized);
  useEffect(() => {
    if (ready) return undefined;
    let alive = true;
    ensureAdsInitialized()
      .then(() => { if (alive) setReady(true); })
      .catch(() => {});
    return () => { alive = false; };
  }, [ready]);
  return ready;
}
