import { Platform } from 'react-native';
import { startIosUpdatePrompt } from './iosUpdatePrompt';

// Android only: Play in-app updates. iOS is iosUpdatePrompt.js.
let inAppUpdates = null;
let IAUUpdateKind = null;
if (Platform.OS === 'android') {
  const SpMod = require('sp-react-native-in-app-updates');
  const SpInAppUpdates = SpMod.default || SpMod;
  IAUUpdateKind = SpMod.IAUUpdateKind;
  inAppUpdates = new SpInAppUpdates(false);
}

export const checkForUpdate = async () => {
  if (__DEV__) return;

  if (Platform.OS === 'ios') {
    startIosUpdatePrompt();
    return;
  }

  try {
    if (Platform.OS === 'android') {
      const result = await inAppUpdates.checkNeedsUpdate();
      if (result?.shouldUpdate) {
        // Leaving for Play's update screen is not a return worth an app-open ad.
        require('../Ads/openApp').default.skipNextForeground(2 * 60 * 1000);
        await inAppUpdates.startUpdate({ updateType: IAUUpdateKind.IMMEDIATE });
      }
    }
  } catch (err) {
    console.warn('Update check failed:', err?.message || err);
  }
};
