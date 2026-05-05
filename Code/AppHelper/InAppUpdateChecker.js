import React, { useEffect } from 'react';
import { Platform, Alert, Linking } from 'react-native';
import InAppUpdates from 'sp-react-native-in-app-updates';
import DeviceInfo from 'react-native-device-info';

// Compare semver-ish strings: returns true if `remote` > `local`
const isRemoteNewer = (remote, local) => {
  if (!remote || !local) return false;
  const r = String(remote).split('.').map(n => parseInt(n, 10) || 0);
  const l = String(local).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
};

let inAppUpdates;

try {
  inAppUpdates = new InAppUpdates(true); // true = enable logs
} catch (error) {
  console.warn('[Update Init] Failed to initialize InAppUpdates:', error);
}

const AppUpdateChecker = () => {
  useEffect(() => {
    const checkForUpdate = async () => {
      if (__DEV__) {
        // console.log('[Update Check] Skipped in development mode.');
        return;
      }

      if (Platform.OS === 'android') {
        // console.log('[Update Check] Starting Android update check...');
        try {
          if (!inAppUpdates) throw new Error('InAppUpdates not initialized');

          const result = await inAppUpdates.checkNeedsUpdate();
          // console.log('[Update Check] Result:', result);

          if (result?.shouldUpdate) {
            await inAppUpdates.startUpdate({
              updateType:
                Platform.Version >= 21
                  ? InAppUpdates.UPDATE_TYPE.IMMEDIATE
                  : InAppUpdates.UPDATE_TYPE.FLEXIBLE,
            });
          } else {
            // console.log('[Update Check] No update needed.');
          }
        } catch (err) {
          console.error('[Update Check] Android update check failed:', err?.message || err);
        }
      } else if (Platform.OS === 'ios') {
        try {
          const currentVersion = DeviceInfo.getVersion();
          const bundleId = DeviceInfo.getBundleId();

          // Query App Store lookup API for the latest published version.
          // Cache-bust so we don't get a stale CDN response.
          const lookupUrl = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}&t=${Date.now()}`;
          const res = await fetch(lookupUrl);
          const data = await res.json();
          const storeVersion = data?.results?.[0]?.version;

          if (!storeVersion) {
            // Couldn't determine — silently skip rather than nagging users.
            return;
          }

          if (!isRemoteNewer(storeVersion, currentVersion)) {
            // User is on the latest version (or newer) — do nothing.
            return;
          }

          Alert.alert(
            'Update Available',
            `A new version (${storeVersion}) is available on the App Store. You're on ${currentVersion}.`,
            [
              {
                text: 'Update Now',
                onPress: () => {
                  const storeUrl = 'https://apps.apple.com/app/id6737775801';
                  Linking.openURL(storeUrl).catch(error => {
                    console.warn('[iOS] Failed to open App Store:', error);
                  });
                },
              },
              { text: 'Later', style: 'cancel' },
            ]
          );
        } catch (err) {
          console.error('[iOS Update Fallback] Failed:', err?.message || err);
        }
      }
    };

    checkForUpdate();
  }, []);

  return null; // Pure logic component
};

export default AppUpdateChecker;
