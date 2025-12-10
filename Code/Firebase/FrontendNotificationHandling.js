// Code/Firebase/FrontendNotificationHandling.js

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { getMessaging, onMessage } from '@react-native-firebase/messaging';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import { useLocalState } from '../LocalGlobelStats';

// ✅ Messaging instance for default app
const messaging = getMessaging();

const NotificationHandler = () => {
  const { localState } = useLocalState();

  useEffect(() => {
    const setup = async () => {
      try {
        // Android: create channel once
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
        // console.error('[Notification] createChannel error:', error);
      }
    };

    setup();

    let isProcessingNotification = false;

    const processNotification = async (remoteMessage) => {
      if (!remoteMessage) {
        // console.warn('[Notification] remoteMessage is null/undefined');
        return;
      }

      // console.log('[FCM] Received message in foreground:', remoteMessage);

      if (isProcessingNotification) {
        // console.warn('[Notification] Already processing, skipping…');
        return;
      }

      isProcessingNotification = true;

      try {
        const { notification, data } = remoteMessage || {};
        const title = notification?.title || data?.title || null;
        const body = notification?.body || data?.body || null;
        const senderId = data?.senderId;
        const type = data?.taype;

        if (localState?.bannedUsers?.includes(senderId)) {
          // console.log('[Notification] Sender is banned, skipping:', senderId);
          return;
        }

        if (!title || !body) {
          // console.warn('[Notification] Incomplete payload:', remoteMessage);
          return;
        }

        let notificationTitle = title;
        let notificationBody = body;

        if (type === 'selectedFruits') {
          // keep as is
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
        // console.error('[Notification] Error processing notification:', error);
      } finally {
        isProcessingNotification = false;
      }
    };

    // ✅ Foreground listener (modular)
    const unsubscribeForeground = onMessage(messaging, async (remoteMessage) => {
      await processNotification(remoteMessage);
    });

    // ✅ Handle Notifee notification clicks (foreground)
    const unsubscribeNotifee = notifee.onForegroundEvent(
      async ({ type, detail }) => {
        if (type === EventType.PRESS) {
          // console.log('Notification clicked:', detail.notification);
          // handle navigation if you want
        }
      },
    );

    return () => {
      unsubscribeForeground();
      unsubscribeNotifee();
    };
  }, [localState?.bannedUsers]);

  return null;
};

export default NotificationHandler;
