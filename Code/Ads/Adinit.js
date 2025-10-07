// AdsInit.ts
import { MobileAds, RequestConfiguration } from 'react-native-google-mobile-ads';

export async function initAds() {
  try {
    // console.log('[AdsInit] setRequestConfiguration');
    const cfg: RequestConfiguration = {
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
      maxAdContentRating: 'PG',
      testDeviceIdentifiers: ['EMULATOR'], // <- Uncomment to whitelist devices
    };
    await MobileAds().setRequestConfiguration(cfg);
  } catch (e) {
    console.warn('[AdsInit] setRequestConfiguration error:', e);
  }

  try {
    // console.log('[AdsInit] initialize() starting…');
    const adapterStatuses = await MobileAds().initialize();
    // console.log('[AdsInit] initialize() done. adapter statuses:', adapterStatuses);
  } catch (e) {
    // console.warn('[AdsInit] initialize() error:', e);
  }
}
