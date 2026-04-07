/**
 * Cloud Function: Send push notifications for trade accepts and pings
 *
 * Triggers when a new notification doc is created in Firestore 'notifications' collection.
 * Reads the recipient's FCM token and sends a push notification.
 *
 * Supports types: trade_accepted, trade_ping
 *
 * Deployment:
 * firebase deploy --only functions:notifyTradeAccept
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

exports.notifyTradeAccept = functions
  .runWith({ memory: '128MB', timeoutSeconds: 10 })
  .firestore
  .document('notifications/{notifId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    if (!data) return null;

    const { toUid, type, message, fromName } = data;

    // Only handle trade-related notifications
    if (!['trade_accepted', 'trade_ping'].includes(type)) {
      return null;
    }

    console.log(`🔔 Trade notification: type=${type}, to=${toUid}, from=${fromName}`);

    // ✅ 2 targeted reads in parallel — no excess data pulled
    let fcmToken = null;
    let isMuted = false;
    try {
      const [tokenSnap, muteSnap] = await Promise.all([
        admin.database().ref(`users/${toUid}/fcmToken`).once('value'),
        admin.database().ref(`users/${toUid}/muteTradeNotifs`).once('value'),
      ]);
      fcmToken = tokenSnap.val() || null;
      isMuted = muteSnap.val() === true;
    } catch (e) {
      console.error('Error fetching user data:', e);
      return null;
    }

    if (!fcmToken) {
      console.log(`⚠️ No FCM token for user: ${toUid}`);
      return null;
    }

    if (isMuted) {
      console.log(`🔇 User ${toUid} has muted trade notifications, skipping push`);
      return null;
    }

    // Build notification content
    const title = type === 'trade_accepted'
      ? '🤝 Trade Accepted!'
      : '📢 Trade Ping!';

    const body = message || (type === 'trade_accepted'
      ? `${fromName || 'Someone'} accepted your trade!`
      : `${fromName || 'Someone'} wants to trade with you!`);

    const payload = {
      notification: { title, body },
      data: {
        type: type,
        fromUid: data.fromUid || '',
        tradeId: data.tradeId || '',
        timestamp: Date.now().toString(),
      },
      token: fcmToken,
      android: {
        priority: 'high',
        notification: { channelId: 'default', sound: 'default' },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    };

    try {
      await admin.messaging().send(payload);
      console.log(`✅ Push sent to ${toUid} for ${type}`);
    } catch (error) {
      console.error('❌ Failed to send push:', error);
      // Clean up invalid token
      if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
        await admin.database().ref(`users/${toUid}/fcmToken`).remove();
      }
    }

    return null;
  });
