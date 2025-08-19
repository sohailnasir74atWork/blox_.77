import React, { useEffect } from 'react';
import { Platform, Alert, Linking } from 'react-native';
import InAppUpdates from 'sp-react-native-in-app-updates';

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
        console.log('[Update Check] Skipped in development mode.');
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
          // Optionally, add remote version check here using Firebase or API
          Alert.alert(
            'Update Available',
            'A new version of the app is available. Please update it from the App Store.',
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
