# Cloud Function: notifyPostComment

## Overview
Triggers when a new comment is created on a design post. Sends push notifications to the post creator and all previous commenters (excluding the new commenter).

## Type
**Firestore Trigger (onCreate)**

## Trigger
- **Collection:** `designPosts/{postId}/comments/{commentId}`
- **Event:** Document created
- **Automatic:** Yes, triggers on every new comment

---

## Functionality

### 1. Notification Recipients

#### A. Post Creator
- **Condition:** Post creator is not the new commenter
- **Message:** "New Comment on Your Post - {commenterName} commented on your post: {postDescription}"

#### B. Previous Commenters
- **Condition:** User has commented before (excluding new commenter)
- **Message:** "New Comment on Post - {commenterName} also commented on {postDescription}"
- **Limit:** Last 100 comments checked (cost optimization)
- **Max Recipients:** 50 users (cost optimization)

### 2. User Preferences
- Checks `notificationSettings.postCommentNotifications`
- Skips users who disabled post comment notifications
- Respects user preferences

---

## Data Flow

### Step 1: Get Post Data
```javascript
1. Read post document: designPosts/{postId}
2. Extract post creator ID
3. Extract post description
```

### Step 2: Find Commenters
```javascript
1. Query last 100 comments (ordered by createdAt desc)
2. Collect unique userIds (excluding new commenter)
3. Add post creator to list (if not new commenter)
4. Limit to 50 users max
```

### Step 3: Fetch User Data
```javascript
// Batch fetch for each user:
1. /users/{userId}/fcmToken
2. /users/{userId}/notificationSettings
```

### Step 4: Send Notifications
```javascript
// For each user:
1. Check notification preferences
2. Create notification payload
3. Send via Firebase Cloud Messaging
4. Handle errors
```

---

## Database Reads

### Firestore Reads:
- `designPosts/{postId}` - Get post data (1 read)
- `designPosts/{postId}/comments` - Get comments (up to 100 reads, limited)

### Realtime Database Reads:
- `/users/{userId}/fcmToken` - Get FCM token (per user)
- `/users/{userId}/notificationSettings` - Get preferences (per user)

### Total Reads:
- **Minimum:** 1 Firestore + 2 RTDB per user
- **Maximum:** 101 Firestore + 100 RTDB (50 users × 2)

---

## Cost Optimizations

### 1. Comment Limit
- Only checks last 100 comments
- Prevents excessive Firestore reads for posts with many comments

### 2. User Limit
- Maximum 50 users notified per comment
- Prevents excessive notification costs

### 3. Batch FCM Token Fetching
- Uses `Promise.all` for parallel fetching
- Reduces total execution time

### 4. Early Exit
- If post creator is new commenter and no other commenters exist, exits early
- Saves unnecessary processing

---

## Error Handling

### Invalid FCM Tokens:
- Detects `messaging/invalid-registration-token`
- Detects `messaging/registration-token-not-registered`
- Automatically removes invalid tokens from database

### Missing Data:
- Skips users without FCM tokens
- Skips users who disabled notifications
- Continues processing other users

---

## Notification Payload

```javascript
{
  notification: {
    title: "New Comment on Your Post" | "New Comment on Post",
    body: "{commenterName} commented on your post: {description}"
  },
  data: {
    type: 'postComment',
    postId: '{postId}',
    commentId: '{commentId}',
    commenterId: '{commenterId}',
    commenterName: '{commenterName}',
    timestamp: '{timestamp}'
  },
  token: '{fcmToken}',
  android: {
    priority: 'high',
    notification: {
      channelId: 'default',
      sound: 'default'
    }
  },
  apns: {
    payload: {
      aps: {
        sound: 'default',
        badge: 1
      }
    }
  }
}
```

---

## Logging

### Success Logs:
- `💬 Post comment notification triggered: postId={postId}, commentId={commentId}`
- `✅ Post found. Creator: {creatorId}, New commenter: {commenterId}`
- `📋 Found {count} unique commenters, notifying {count} users (max 50)`
- `📡 Preparing notification for user {userId} ({role})`
- `✅ Notification sent to {userId} ({role})`
- `✅ Completed sending notifications for comment {commentId} on post {postId}`

### Warning Logs:
- `⚠️ Missing userId in comment. Skipping...`
- `⚠️ Post not found. Skipping...`
- `⚠️ Missing FCM token for user: {userId}`
- `User {userId} has disabled post comment notifications`
- `ℹ️ No users to notify.`
- `ℹ️ Only creator has commented. No one to notify.`

### Error Logs:
- `❌ Failed to send notification to {userId}: {error}`
- `❌ Error in notifyPostComment: {error}`

---

## Deployment

```bash
firebase deploy --only functions:notifyPostComment
```

---

## Files

- **File:** `functions/notifyPostComment.js`

---

## Testing

### Manual Test:
1. User A: Create a design post
2. User B: Comment on the post
3. **Expected:** User A receives notification
4. User C: Comment on the same post
5. **Expected:** User A and User B receive notifications

### Edge Cases:
- Post creator comments on own post → Only previous commenters notified
- Post with 200+ comments → Only last 100 checked
- Post with 100+ commenters → Only 50 notified
- User disabled notifications → Skipped

---

## Performance

### Execution Time:
- **Typical:** 2-5 seconds
- **With many commenters:** 5-10 seconds

### Cost:
- **Firestore Reads:** 1-101 reads per comment
- **RTDB Reads:** 2 reads per user (up to 100 reads)
- **FCM Sends:** Up to 50 sends per comment

---

## Notes

- Respects user notification preferences
- Limits notifications to prevent spam
- Handles large comment threads efficiently
- Automatically cleans up invalid tokens
- Optimized for cost and performance

