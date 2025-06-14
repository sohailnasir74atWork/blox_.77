import  { useEffect } from 'react';
import { Platform } from 'react-native';
import { initializeApp, getApp, getApps } from '@react-native-firebase/app';
import { getMessaging, onMessage, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import { useLocalState } from '../LocalGlobelStats';

// ✅ Ensure Firebase is initialized only once
const firebaseConfig = { /* Your Firebase Config */ };
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ✅ Initialize Firebase Messaging
const messaging = getMessaging(app);

const NotificationHandler = () => {
  const { localState } = useLocalState()

  useEffect(() => {
    // ✅ Create Notification Channel
    const createNotificationChannel = async () => {
      try {
        if (Platform.OS === 'android') {
          await notifee.createChannel({
            id: 'default',
            name: 'Default Channel',
            importance: AndroidImportance.HIGH,
            smallIcon: 'ic_notification',
            color: '#36454F',
            pressAction: { id: 'default' },
          });
        }
      } catch (error) {
        console.error('Error creating notification channel:', error);
      }
    };

    createNotificationChannel();

    let isProcessingNotification = false;

    // ✅ Function to Process Notifications
    const processNotification = async (remoteMessage) => {
      // console.log(remoteMessage)
      if (isProcessingNotification) {
        console.warn('Already processing a notification. Skipping...');
        return;
      }

      isProcessingNotification = true;

      try {
        const { notification, data } = remoteMessage || {};
        const title = notification?.title || data?.title || null;
        const body = notification?.body || data?.body || null;
        const senderId = data?.senderId;        
        const type = data?.taype;
        // console.log(remoteMessage)
        if (localState?.bannedUsers?.includes(senderId)) {
          // console.warn(`🚫 Skipping notification from banned sender: ${senderId}`);

          return;
        }


        if (!title || !body) {
          console.warn('Notification payload is incomplete:', remoteMessage);
          return;
        }

        const capitalizeFruits = (fruits) =>
          fruits
            ?.split(',')
            .map((fruit) => fruit.trim().charAt(0).toUpperCase() + fruit.trim().slice(1))
            .join(', ') || '';

        let notificationTitle = title;
        let notificationBody = body;

        if (type === 'selectedFruits') {
          notificationTitle = title;
          notificationBody = body;
        } else if (type === 'stockUpdate') {
          notificationTitle = 'Stock Update';
          notificationBody = 'Stocks have been updated!';
        }

        await notifee.displayNotification({
          title: notificationTitle,
          body: notificationBody,
          android: {
            channelId: 'default',
            smallIcon: 'ic_notification',
            color: '#36454F',
            pressAction: { id: 'default' },
          },
        });
      } catch (error) {
        console.error('Error processing notification:', error);
      } finally {
        isProcessingNotification = false;
      }
    };

    // ✅ Foreground Notification Listener
    const unsubscribeForeground = onMessage(messaging, async (remoteMessage) => {
      await processNotification(remoteMessage);
    });
    // ✅ Background Notification Handler
    setBackgroundMessageHandler(messaging, async (remoteMessage) => {
      await processNotification(remoteMessage);
    });

    // ✅ Handle Notification Clicks
    const unsubscribeNotifee = notifee.onForegroundEvent(async ({ type, detail }) => {
      if (type === EventType.PRESS) {
        // console.log('Notification clicked:', detail.notification);
        // Handle navigation or other actions here
        // Alert.alert('Notification Clicked', 'You interacted with the notification!');
      }
    });

    return () => {
      unsubscribeForeground();
      unsubscribeNotifee();
    };
  }, [localState?.bannedUsers]);

  return null;
};

export default NotificationHandler;
