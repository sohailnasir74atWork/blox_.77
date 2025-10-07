import { Platform, Linking } from 'react-native';
import SpInAppUpdates, { IAUUpdateKind } from 'sp-react-native-in-app-updates';
import DeviceInfo from 'react-native-device-info';
import { getDatabase, ref, get } from '@react-native-firebase/database';

const ANDROID_UPDATER = (() => {
  try { return new SpInAppUpdates(true); } catch { return undefined; }
})();

const IOS_APP_ID = '6737775801';
const IOS_STORE_DEEPLINK = `itms-apps://itunes.apple.com/app/id${IOS_APP_ID}`;
const IOS_STORE_HTTP = `https://apps.apple.com/app/id${IOS_APP_ID}`;

export const checkForUpdate = async () => {
  if (__DEV__) return;

  try {
    // ---------- Android ----------
    if (Platform.OS === 'android') {
      if (!ANDROID_UPDATER) return;
      const result = await ANDROID_UPDATER.checkNeedsUpdate();
      if (result?.shouldUpdate) {
        await ANDROID_UPDATER.startUpdate({ updateType: IAUUpdateKind.IMMEDIATE });
      }
      return;
    }

    // ---------- iOS ----------
    const snap = await get(ref(getDatabase(), 'ios_version'));
    const remoteValue = String(snap.val() ?? '').trim().toLowerCase();
    if (!remoteValue) return;

    // skip if backend flag says under review
    if (remoteValue === 'underreview') return;

    const localVersion = DeviceInfo.getVersion();
    if (remoteValue !== localVersion) {
      try {
        await Linking.openURL(IOS_STORE_DEEPLINK);
      } catch {
        await Linking.openURL(IOS_STORE_HTTP);
      }
    }
  } catch (err) {
    console.error('Update check failed:', err?.message || err);
  }
};
