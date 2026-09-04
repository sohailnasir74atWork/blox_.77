/**
 * Cloud Function: Send push notifications when someone comments on a post
 * 
 * This function triggers when a new comment is created in Firestore.
 * It sends push notifications to:
 * 1. The post creator (if they didn't comment themselves)
 * 2. All previous commenters on that post (excluding the new commenter)
 * 
 * Deployment:
 * firebase deploy --only functions:notifyPostComment
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

exports.notifyPostComment = functions.firestore
  .document('designPosts/{postId}/comments/{commentId}')
  .onCreate(async (snap, context) => {
    const commentData = snap.data();
    const { postId, commentId } = context.params;
    const newCommenterId = commentData.userId;
    const newCommenterName = commentData.displayName || 'Someone';

    console.log(`💬 Post comment notification triggered: postId=${postId}, commentId=${commentId}`);

    if (!newCommenterId) {
      console.log('⚠️ Missing userId in comment. Skipping...');
      return null;
    }

    try {
      // 1. Get the post data to find the creator
      const postDoc = await admin.firestore().doc(`designPosts/${postId}`).get();
      if (!postDoc.exists) {
        console.log('⚠️ Post not found. Skipping...');
        return null;
      }

      const postData = postDoc.data();
      const postCreatorId = postData.userId;
      const postDescription = postData.description || 'a post';
      // Truncate description for notification
      const shortDescription = postDescription.length > 50 
        ? postDescription.substring(0, 50) + '...' 
        : postDescription;

      console.log(`✅ Post found. Creator: ${postCreatorId}, New commenter: ${newCommenterId}`);

      // Early exit: if creator is the new commenter, check if anyone else has commented
      if (postCreatorId === newCommenterId) {
        // Quick check: get first comment that's not from the creator
        const commentsSnapshot = await admin.firestore()
          .collection(`designPosts/${postId}/comments`)
          .limit(10)
          .get();
        
        let hasOtherCommenters = false;
        commentsSnapshot.forEach((doc) => {
          if (doc.id !== commentId && doc.data().userId !== newCommenterId) {
            hasOtherCommenters = true;
          }
        });
        
        if (!hasOtherCommenters) {
          console.log('ℹ️ Only creator has commented. No one to notify.');
          return null;
        }
      }

      // 2. Get previous comments to find commenters (LIMIT to reduce reads)
      // Only get the last 100 comments to find unique commenters (cost optimization)
      const MAX_COMMENTS_TO_CHECK = 100;
      const commentsSnapshot = await admin.firestore()
        .collection(`designPosts/${postId}/comments`)
        .orderBy('createdAt', 'desc')
        .limit(MAX_COMMENTS_TO_CHECK)
        .get();

      // Collect unique user IDs who have commented (excluding the new commenter)
      const commenterIds = new Set();
      
      commentsSnapshot.forEach((doc) => {
        const comment = doc.data();
        // Only include previous commenters (not the new one)
        if (comment.userId && comment.userId !== newCommenterId && doc.id !== commentId) {
          commenterIds.add(comment.userId);
        }
      });

      // Add post creator to the list if they're not the new commenter
      if (postCreatorId && postCreatorId !== newCommenterId) {
        commenterIds.add(postCreatorId);
      }

      // Limit notifications to prevent excessive costs (notify max 50 users)
      const MAX_USERS_TO_NOTIFY = 50;
      const userIdsArray = Array.from(commenterIds).slice(0, MAX_USERS_TO_NOTIFY);
      
      if (userIdsArray.length === 0) {
        console.log('ℹ️ No users to notify.');
        return null;
      }

      console.log(`📋 Found ${commenterIds.size} unique commenters, notifying ${userIdsArray.length} users (max ${MAX_USERS_TO_NOTIFY})`);

      // 3. Batch fetch FCM tokens and preferences (cost optimization)
      const notificationPromises = [];
      
      // Batch RTDB reads using Promise.all for better performance
      const userDataPromises = userIdsArray.map(userId => 
        Promise.all([
          admin.database().ref(`/users/${userId}/fcmToken`).once('value'),
          admin.database().ref(`/users/${userId}/notificationSettings`).once('value'),
        ]).then(([fcmTokenSnap, prefsSnap]) => ({
          userId,
          fcmToken: fcmTokenSnap.val(),
          prefs: prefsSnap.val() || {},
        }))
      );

      const userDataArray = await Promise.all(userDataPromises);

      // Process each user's data
      for (const userData of userDataArray) {
        const { userId, fcmToken, prefs } = userData;

        // Skip if this is the new commenter
        if (userId === newCommenterId) {
          continue;
        }

        if (!fcmToken) {
          console.log(`⚠️ Missing FCM token for user: ${userId}`);
          continue;
        }

        // Check user's notification preferences
        if (prefs.postCommentNotifications === false) {
          console.log(`User ${userId} has disabled post comment notifications`);
          continue;
        }

        // Determine notification message based on whether user is the creator or a commenter
        const isCreator = userId === postCreatorId;
        const notificationTitle = isCreator 
          ? 'New Comment on Your Post' 
          : 'New Comment on Post';
        
        const notificationBody = isCreator
          ? `${newCommenterName} commented on your post: "${shortDescription}"`
          : `${newCommenterName} also commented on "${shortDescription}"`;

        console.log(`📡 Preparing notification for user ${userId} (${isCreator ? 'creator' : 'commenter'})`);

        const payload = {
          notification: {
            title: notificationTitle,
            body: notificationBody,
          },
          data: {
            type: 'postComment',
            postId: postId || '',
            commentId: commentId || '',
            commenterId: newCommenterId || '',
            commenterName: newCommenterName || '',
            timestamp: Date.now().toString(),
          },
          token: fcmToken,
          android: {
            priority: 'high',
            notification: {
              channelId: 'default',
              sound: 'default',
            },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                badge: 1,
              },
            },
          },
        };

        notificationPromises.push(
          admin.messaging().send(payload)
            .then(() => {
              console.log(`✅ Notification sent to ${userId} (${isCreator ? 'creator' : 'commenter'})`);
            })
            .catch((error) => {
              console.error(`❌ Failed to send notification to ${userId}:`, error);
              
              // If token is invalid, remove it
              if (error.code === 'messaging/invalid-registration-token' || 
                  error.code === 'messaging/registration-token-not-registered') {
                console.log(`Removing invalid token for user ${userId}`);
                admin.database().ref(`/users/${userId}/fcmToken`).remove();
              }
            })
        );
      }

      // Wait for all notifications to be sent
      await Promise.all(notificationPromises);
      console.log(`✅ Completed sending notifications for comment ${commentId} on post ${postId}`);

    } catch (error) {
      console.error('❌ Error in notifyPostComment:', error);
    }

    return null;
  });

