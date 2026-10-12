import notifee from '@notifee/react-native';
import { Alert, Linking } from 'react-native';
import i18next from 'i18next';




export const requestPermission = async () => {
  try {
    const settings = await notifee.requestPermission();
    if (
      settings.authorizationStatus == 0
    ) {
      Alert.alert(
        i18next.t('settings.permission_required'),
        i18next.t('settings.notification_permissions_disabled'),
        [
          { text: i18next.t('common.cancel'), style: 'cancel' },
          {
            text: i18next.t('app.permission_check.go_to_settings'),
            onPress: () => Linking.openSettings(), // Redirect to app settings
          },
        ]
      );
      return false; // Permission not granted
    }

    if (
      settings.authorizationStatus === 1
    ) {
      // console.log('Notification permissions granted:', settings);
      return true; // Permission granted
    }
  } catch (error) {
    console.error('Error requesting notification permission:', error);
    Alert.alert(i18next.t('home.alert.error'), i18next.t('app.permission_check.request_error'));
    return false;
  }
};