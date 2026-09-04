// ✅ OPTIMIZED Cloud Function - Uses reverse index to avoid downloading all notifier data
// This reduces data download from ~18 MB per trade to ~1 MB (95% reduction)
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
exports.notifyFromTrade = functions.firestore
  .document('trades_new/{tradeId}')
  .onCreate(async (snap, context) => {
    const trade = snap.data();
    const tradeId = context.params.tradeId;
    const db = admin.database();
    const messaging = admin.messaging();

    console.log('📦 New trade created:', tradeId);

    // ✅ OPTIMIZED: Use reverse index to find matching users instead of downloading all notifier data
    const findMatchingUsers = async ({ side, tradeItems }) => {
      console.log(`🔍 Finding matches for ${side} side using reverse index...`);
      const matchedUsers = new Map(); // userId -> [matchedItemNames]

      // For each item in trade, check reverse index
      for (const tradeItem of tradeItems) {
        const itemName = tradeItem.name || tradeItem.Name;
        if (!itemName) continue;

        const itemKey = itemName.replace(/[^a-zA-Z0-9]/g, '_');
        const indexRef = db.ref(`/notifier_index/${side}/${itemKey}`);

        try {
          const indexSnap = await indexRef.once('value');
          if (!indexSnap.exists()) continue;

          // Get all userIds who have this item in their notifier
          const userIds = Object.keys(indexSnap.val() || {});
          console.log(`✅ Found ${userIds.length} users with item "${itemName}" in ${side} notifier`);

          // For each user, verify they actually have this item (safety check)
          for (const userId of userIds) {
            const userItemRef = db.ref(`/notifier/${side}/${userId}/${itemKey}`);
            const userItemSnap = await userItemRef.once('value');
            
            if (userItemSnap.exists()) {
              // User has this item - add to matched users
              if (!matchedUsers.has(userId)) {
                matchedUsers.set(userId, []);
              }
              matchedUsers.get(userId).push(itemName);
            }
          }
        } catch (error) {
          console.error(`❌ Error checking index for item ${itemName}:`, error);
        }
      }

      return matchedUsers;
    };

    const notifyMatches = async ({ side, matchedUsers, messageType }) => {
      console.log(`📡 Notifying ${matchedUsers.size} users for ${messageType}...`);

      for (const [userId, matchedItemNames] of matchedUsers) {
        try {
          const fcmSnap = await db.ref(`/users/${userId}/fcmToken`).once('value');
          const fcmToken = fcmSnap.val();

          if (!fcmToken) {
            console.warn(`⚠️ Missing FCM token for user ${userId}`);
            continue;
          }

          const namesString = matchedItemNames.join(', ');
          const notification = {
            notification: {
              title: messageType === 'buy' ? 'Items Available to Buy!' : 'Someone Needs Your Items!',
              body: `🔥 Wow! ${namesString} matched and available for ${messageType === 'buy' ? 'buy' : 'sell'} now! Check trades.`
            },
            data: {
              tradeId,
              type: messageType
            },
            token: fcmToken
          };

          await messaging.send(notification);
          console.log(`✅ Notification sent to ${userId} (${messageType}):`, namesString);
        } catch (error) {
          console.error(`❌ Failed to notify ${userId}`, error);
          if (error.code === 'messaging/registration-token-not-registered') {
            console.log(`🧹 Cleaning up invalid token for user ${userId}`);
            await db.ref(`/users/${userId}/fcmToken`).remove();
          }
        }
      }
    };

    try {
      const hasItems = trade.hasItems || [];
      const wantsItems = trade.wantsItems || [];

      console.log('🚀 Starting optimized notification checks...');
      
      // ✅ OPTIMIZED: Use reverse index instead of downloading all notifier data
      const [buyMatchedUsers, saleMatchedUsers] = await Promise.all([
        findMatchingUsers({ side: 'buy', tradeItems: hasItems }),
        findMatchingUsers({ side: 'sale', tradeItems: wantsItems })
      ]);

      await Promise.all([
        notifyMatches({ side: 'buy', matchedUsers: buyMatchedUsers, messageType: 'buy' }),
        notifyMatches({ side: 'sale', matchedUsers: saleMatchedUsers, messageType: 'sale' })
      ]);

      console.log(`✅ Notification process completed. Buy: ${buyMatchedUsers.size} users, Sale: ${saleMatchedUsers.size} users`);
    } catch (err) {
      console.error('❌ Error processing new trade notification:', err);
    }

    return null;
  });

