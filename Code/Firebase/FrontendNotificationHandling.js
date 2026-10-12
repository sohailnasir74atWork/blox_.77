// Code/Firebase/FrontendNotificationHandling.js

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import {
  getMessaging,
  onMessage,
  onNotificationOpenedApp,
  getInitialNotification,
} from '@react-native-firebase/messaging';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import { useLocalState } from '../LocalGlobelStats';
import i18next from 'i18next';
import { openPushRoute } from '../Helper/navigationService';
import {
  VALUE_UPDATES_TYPE,
  setValueUpdateSubscription,
  scheduleValueUpdatePermissionAsk,
} from '../Helper/valueUpdateAlerts';

// ✅ Messaging instance for default app
const messaging = getMessaging();

// Only value-update pushes open a screen when tapped; every other type keeps
// its old behaviour (the app just opens). openPushRoute ignores any route that
// is not on its allowlist.
const openFromNotificationData = (data) => {
  if (data?.type === VALUE_UPDATES_TYPE && typeof data?.route === 'string') {
    openPushRoute(data.route);
  }
};

// A tap that cold-started the app is delivered once; don't replay it if this
// component remounts.
let initialTapHandled = false;
// The `value-updates` topic is re-applied once per launch, a few seconds in so
// it stays off the startup path.
let valueTopicSyncedThisLaunch = false;
const VALUE_TOPIC_SYNC_DELAY_MS = 4000;

const NotificationHandler = () => {
  const { localState } = useLocalState();

  // Latest Settings choice, for the listeners below (they don't re-subscribe
  // when it changes).
  const valueUpdatesOnRef = useRef(true);
  valueUpdatesOnRef.current = localState?.valueUpdateNotifications !== false;

  // Value-update topic, for guests and signed-in users alike. Settings applies
  // later changes itself (Code/SettingScreen/Setting.jsx).
  useEffect(() => {
    // The once-per-install permission ask. It waits by itself for onboarding
    // and the consent prompts (see valueUpdateAlerts.js); safe to call again.
    scheduleValueUpdatePermissionAsk();
    if (valueTopicSyncedThisLaunch) {
      return undefined;
    }
    const id = setTimeout(() => {
      valueTopicSyncedThisLaunch = true;
      setValueUpdateSubscription(valueUpdatesOnRef.current);
    }, VALUE_TOPIC_SYNC_DELAY_MS);
    return () => clearTimeout(id);
  }, []);

  // Taps on system-tray pushes: app in background, or killed (cold start; the
  // navigation waits for the NavigationContainer, see navigationService.js).
  useEffect(() => {
    const unsubscribeOpened = onNotificationOpenedApp(messaging, (remoteMessage) => {
      openFromNotificationData(remoteMessage?.data);
    });

    if (!initialTapHandled) {
      initialTapHandled = true;
      getInitialNotification(messaging)
        .then((remoteMessage) => openFromNotificationData(remoteMessage?.data))
        .catch(() => {});
      // Android: a notification shown by notifee while the app was open (see
      // processNotification below) and tapped after the app was killed.
      notifee.getInitialNotification()
        .then((initial) => openFromNotificationData(initial?.notification?.data))
        .catch(() => {});
    }

    return () => {
      unsubscribeOpened();
    };
  }, []);

  useEffect(() => {
    const setup = async () => {
      try {
        // Android: create channel once
        if (Platform.OS === 'android') {
          await notifee.createChannel({
            id: 'default',
            name: i18next.t('app.notifications.default_channel'),
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
        const senderId = data?.senderId || data?.sender_id || null; // ✅ Handle different field names
        const type = data?.type || data?.taype || null; // ✅ Fixed typo: 'taype' -> 'type'

        // ✅ OPTIMIZED: Check if sender is blocked (more robust check)
        // Only check if we have a valid senderId and bannedUsers array exists
        if (senderId && typeof senderId === 'string' && senderId.trim() !== '') {
          const bannedUsersList = Array.isArray(localState?.bannedUsers) 
            ? localState.bannedUsers 
            : [];
          
          // ✅ Check if sender is in blocked users list
          if (bannedUsersList.includes(senderId) || bannedUsersList.includes(senderId.trim())) {
            // console.log('[Notification] Sender is blocked, skipping notification:', senderId);
            return; // ✅ Don't show notification from blocked users
          }
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
          notificationTitle = i18next.t('app.notifications.stock_update_title');
          notificationBody = i18next.t('app.notifications.stock_update_body');
        }

        // Value updates show the publisher's own title/body. A fixed id makes a
        // newer one replace the last (the push's Android tag / APNs collapse id
        // do the same outside the app), and the data lets a tap open the values
        // screen. Skipped if the Settings switch is off but the unsubscribe has
        // not gone through yet.
        const isValuesUpdate = type === VALUE_UPDATES_TYPE;
        if (isValuesUpdate && !valueUpdatesOnRef.current) {
          return;
        }
        const valuesUpdateExtras = isValuesUpdate
          ? {
              id: VALUE_UPDATES_TYPE,
              data: {
                type: VALUE_UPDATES_TYPE,
                ...(typeof data?.route === 'string' ? { route: data.route } : {}),
              },
            }
          : {};

        await notifee.displayNotification({
          ...valuesUpdateExtras,
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
          openFromNotificationData(detail?.notification?.data);
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
