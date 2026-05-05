import { Platform, Linking, Alert } from 'react-native';
import DeviceInfo from 'react-native-device-info';

// Only import & init the library on Android — on iOS it triggers its own
// native alert from the constructor, bypassing our JS version check entirely.
let inAppUpdates = null;
let IAUUpdateKind = null;
if (Platform.OS === 'android') {
  const SpMod = require('sp-react-native-in-app-updates');
  const SpInAppUpdates = SpMod.default || SpMod;
  IAUUpdateKind = SpMod.IAUUpdateKind;
  inAppUpdates = new SpInAppUpdates(false);
}

const IOS_APP_ID = '6737775801';
const IOS_STORE_DEEPLINK = `itms-apps://itunes.apple.com/app/id${IOS_APP_ID}`;
const IOS_STORE_HTTP = `https://apps.apple.com/app/id${IOS_APP_ID}`;

// Compare semver strings: returns true only if remote > local
const isNewerVersion = (remote, local) => {
  if (!remote || !local) return false;
  const r = String(remote).split('.').map(n => parseInt(n, 10) || 0);
  const l = String(local).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
};

export const checkForUpdate = async () => {
  if (__DEV__) return;

  try {
    if (Platform.OS === 'android') {
      const result = await inAppUpdates.checkNeedsUpdate();
      if (result?.shouldUpdate) {
        await inAppUpdates.startUpdate({ updateType: IAUUpdateKind.IMMEDIATE });
      }
    } else if (Platform.OS === 'ios') {
      // Don't trust the library's shouldUpdate on iOS — do our own semver check
      const currentVersion = DeviceInfo.getVersion();
      const bundleId = DeviceInfo.getBundleId();
      const res = await fetch(`https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}&t=${Date.now()}`);
      const data = await res.json();
      const storeVersion = data?.results?.[0]?.version;

      if (!storeVersion || !isNewerVersion(storeVersion, currentVersion)) return;

      Alert.alert(
        'Update Available',
        `A new version (${storeVersion}) is available. You're on ${currentVersion}.`,
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Update Now',
            onPress: async () => {
              try {
                await Linking.openURL(IOS_STORE_DEEPLINK);
              } catch {
                await Linking.openURL(IOS_STORE_HTTP);
              }
            },
          },
        ],
      );
    }
  } catch (err) {
    console.warn('Update check failed:', err?.message || err);
  }
};
