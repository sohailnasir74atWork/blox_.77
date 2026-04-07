import { Platform, Linking, Alert } from 'react-native';
import SpInAppUpdates, { IAUUpdateKind } from 'sp-react-native-in-app-updates';

// Initialize updater for both platforms (isDebug: false for production behavior)
const inAppUpdates = new SpInAppUpdates(false);

const IOS_APP_ID = '6737775801';
const IOS_STORE_DEEPLINK = `itms-apps://itunes.apple.com/app/id${IOS_APP_ID}`;
const IOS_STORE_HTTP = `https://apps.apple.com/app/id${IOS_APP_ID}`;

export const checkForUpdate = async () => {
  if (__DEV__) return;

  try {
    // Standard Store Check (Library) - Play Store (Android) or App Store (iOS)
    const result = await inAppUpdates.checkNeedsUpdate();

    if (result?.shouldUpdate) {
      if (Platform.OS === 'android') {
        await inAppUpdates.startUpdate({ updateType: IAUUpdateKind.IMMEDIATE });
      } else if (Platform.OS === 'ios') {
        Alert.alert(
          'Update Available',
          'A new version of the app is available. Please update from the App Store for the best experience.',
          [
            { text: 'Later', style: 'cancel' },
            {
              text: 'Update Now',
              onPress: async () => {
                try {
                  await Linking.openURL(result.storeUrl || IOS_STORE_DEEPLINK);
                } catch {
                  await Linking.openURL(IOS_STORE_HTTP);
                }
              },
            },
          ],
        );
      }
    }
  } catch (err) {
    console.warn('Update check failed:', err?.message || err);
  }
};
