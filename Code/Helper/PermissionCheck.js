import notifee from '@notifee/react-native';
import { Alert, Linking } from 'react-native';




export const requestPermission = async () => {
  try {
    const settings = await notifee.requestPermission();
    if (
      settings.authorizationStatus == 0
    ) {
      Alert.alert(
        'Permission Required',
        'Notification permissions are disabled. Please enable them in the app settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Go to Settings',
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
    Alert.alert('Error', 'An error occurred while requesting notification permissions.');
    return false;
  }
};