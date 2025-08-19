

import { Platform } from 'react-native';
import SpInAppUpdates, { IAUUpdateKind, IAUInstallStatus } from 'sp-react-native-in-app-updates';

const inAppUpdates = new SpInAppUpdates(true);

export const checkForUpdate = async () => {
  if (__DEV__) return;

  try {
    const result = await inAppUpdates.checkNeedsUpdate();
    if (result.shouldUpdate) {
      let options = {};
      if (Platform.OS === 'android') {
        options = { updateType: IAUUpdateKind.IMMEDIATE };
        await inAppUpdates.startUpdate(options);
      } else if (Platform.OS === 'ios') {
        options = {
          title: 'Update Available',
          message: 'There is a new version on App Store, proceed to update?',
          buttonUpgradeText: 'Update',
          buttonCancelText: 'Later',
          forceUpgrade: false,
          country: 'us'
        };
        await inAppUpdates.startUpdate(options);
      }
    }
  } catch (err) {
    console.error('Update check failed:', err);
  }
};