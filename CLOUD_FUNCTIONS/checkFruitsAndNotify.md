# Cloud Function: checkFruitsAndNotify

## Overview
Scheduled cloud function that checks for stock updates and sends push notifications to users who have enabled stock reminders.

## Type
**Scheduled Function (Pub/Sub)**

## Schedule
- **Cron:** `6,7,9,11,13,15,17,19,21,23,25,28 1-23/2 * * *`
- **TimeZone:** `Asia/Karachi`
- **Frequency:** Runs at specific minutes every 2 hours between 1-23

## Trigger
Automatically runs on schedule, no manual trigger needed.

---

## Functionality

### 1. Stock Checking
- Checks `calcData/test` (normal stock)
- Checks `calcData/mirage` (mirage stock)
- Retries up to 40 times (waits 1 minute between retries)
- Validates stock is not in "Fetching..." state

### 2. Notification Types

#### A. Normal Stock Reminder
- **Condition:** User has `isNormalStockReminderEnabled = true`
- **Trigger:** Normal stock updated
- **Message:** "Normal Stock Update! - Normal stock has been updated!"

#### B. Mirage Stock Reminder
- **Condition:** User has `isMirageStockReminderEnabled = true`
- **Trigger:** Mirage stock updated
- **Message:** "Mirage Stock Update! - Mirage stock has been updated!"

#### C. Selected Fruits Reminder (Optimized Version)
- **Condition:** User has `isSelectedReminderEnabled = true` AND selected fruits match stock
- **Trigger:** User's selected fruits are in stock
- **Message:** "Selected Fruit Stock Update! - Wow! Your selected fruits are now in stock: [fruit names]"

### 3. Rate Limiting
- **Interval:** 28 minutes between notifications
- **Tracking:** Uses `notifications/lastSent` (or `lastNormalSent`/`lastMirageSent` in original)
- Prevents spam notifications

---

## Data Flow

### Original Version:
1. Downloads ALL user objects (~5-10 KB per user)
2. Accesses `fcmToken`, `isNormalStockReminderEnabled`, `isMirageStockReminderEnabled` from full object
3. Sends notifications

### Optimized Version:
1. Gets userIds from query (unavoidable)
2. **Fetches only 4 fields per user:**
   - `fcmToken`
   - `selectedFruits`
   - `isSelectedReminderEnabled`
   - `isReminderEnabled`
3. Sends notifications

**Savings:** ~90-95% data reduction (from 2.72 MB to ~0.14 MB)

---

## Database Reads

### Reads From:
- `/calcData/test` - Normal stock data
- `/calcData/mirage` - Mirage stock data
- `/notifications/lastSent` - Last notification timestamp
- `/users/{userId}/fcmToken` - User FCM tokens
- `/users/{userId}/isNormalStockReminderEnabled` - User preferences
- `/users/{userId}/isMirageStockReminderEnabled` - User preferences
- `/users/{userId}/selectedFruits` - User selected fruits (optimized version)
- `/users/{userId}/isSelectedReminderEnabled` - Selected fruits reminder setting (optimized version)
- `/users/{userId}/isReminderEnabled` - General reminder setting (optimized version)

### Writes To:
- `/notifications/lastSent` - Updates timestamp after sending
- `/users/{userId}` - Updates invalid tokens (disables reminders)

---

## Error Handling

### Invalid FCM Tokens:
- Detects `messaging/registration-token-not-registered` errors
- Automatically disables reminders for users with invalid tokens
- Updates user record: `{ isReminderEnabled: false, isSelectedReminderEnabled: false }`

### Missing Data:
- Skips users without FCM tokens
- Logs warnings for missing data
- Continues processing other users

---

## Batch Processing

- **Batch Size:** 200 users per batch
- **Pagination:** Uses `orderByKey().startAt().limitToFirst()`
- **Processing:** Processes all users in batches to handle large user bases

---

## Logging

### Success Logs:
- `✅ Notifications sent: {count}`
- `❌ Users without tokens: {count}`
- `🔄 Invalid tokens updated for {count} users`

### Error Logs:
- `❌ Error executing stock check and notifications: {error}`
- `Error sending notification to user {userId}: {error}`

---

## Deployment

### Deploy Original:
```bash
firebase deploy --only functions:checkFruitsAndNotify
```

### Deploy Optimized:
```bash
# Replace checkFruitsAndNotify.js with checkFruitsAndNotify_optimized.js
# Then deploy:
firebase deploy --only functions:checkFruitsAndNotify
```

---

## Files

- **Original:** `functions/checkFruitsAndNotify.js`
- **Optimized:** `functions/checkFruitsAndNotify_optimized.js`

---

## Differences: Original vs Optimized

| Feature | Original | Optimized |
|---------|----------|-----------|
| **Data Download** | Full user objects (~5-10 KB/user) | Only 4 fields (~200-800 bytes/user) |
| **Notification Types** | Normal + Mirage only | Normal + Mirage + Selected Fruits |
| **Timestamp Tracking** | Separate for Normal/Mirage | Single timestamp |
| **Data Reduction** | Baseline | ~90-95% reduction |

---

## Testing

### Manual Test:
1. Enable stock reminder in app
2. Wait for scheduled run (or trigger manually)
3. Verify notification received
4. Check Cloud Function logs for data download size

### Expected Results:
- Notifications sent successfully
- Data download < 1 MB (optimized version)
- Invalid tokens cleaned up automatically

---

## Notes

- Function runs automatically on schedule
- No manual intervention needed
- Handles large user bases efficiently
- Automatically cleans up invalid tokens
- Optimized version recommended for production

