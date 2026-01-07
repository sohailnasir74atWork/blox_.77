# Cloud Function: notifyFromTrade

## Overview
Triggers when a new trade is created in Firestore. Finds users who have matching items in their notifier and sends them push notifications.

## Type
**Firestore Trigger (onCreate)**

## Trigger
- **Collection:** `trades_new/{tradeId}`
- **Event:** Document created
- **Automatic:** Yes, triggers on every new trade

---

## Functionality

### 1. Trade Processing
- Reads trade data from Firestore
- Extracts `hasItems` (items user has/wants to sell)
- Extracts `wantsItems` (items user wants to buy)

### 2. Matching Logic

#### A. Buy Side Matching
- For each item in `hasItems`:
  - Finds users who have that item in their "buy" notifier
  - Sends notification: "Items Available to Buy!"

#### B. Sale Side Matching
- For each item in `wantsItems`:
  - Finds users who have that item in their "sale" notifier
  - Sends notification: "Someone Needs Your Items!"

### 3. Notification Message
- **Buy:** "🔥 Wow! {itemNames} matched and available for buy now! Check trades."
- **Sale:** "🔥 Wow! {itemNames} matched and available for sell now! Check trades."

---

## Optimization: Reverse Index System

### Before Optimization:
1. Downloaded entire `/notifier/buy` node (~11.86 MB)
2. Downloaded entire `/notifier/sale` node (~7 MB)
3. Searched through all users' items
4. **Total:** ~18.86 MB per trade

### After Optimization:
1. For each trade item, queries `/notifier_index/{side}/{itemKey}`
2. Gets list of userIds who have that item
3. Verifies item exists for each user (safety check)
4. Only downloads specific user items needed
5. **Total:** ~1 MB per trade

**Savings:** ~95% data reduction (from 18.86 MB to ~1 MB)

---

## Data Flow

### Step 1: Find Matching Users
```javascript
// For each item in trade:
1. Create itemKey from itemName (sanitize)
2. Query: /notifier_index/{side}/{itemKey}
3. Get userIds who have this item
4. Verify each user actually has the item
5. Add to matchedUsers map
```

### Step 2: Send Notifications
```javascript
// For each matched user:
1. Fetch FCM token: /users/{userId}/fcmToken
2. Create notification payload
3. Send via Firebase Cloud Messaging
4. Handle errors (invalid tokens, etc.)
```

---

## Database Reads

### Reads From:
- `/notifier_index/{side}/{itemKey}` - Reverse index lookup
- `/notifier/{side}/{userId}/{itemKey}` - Verify item exists
- `/users/{userId}/fcmToken` - Get FCM token for notification

### Writes To:
- `/users/{userId}/fcmToken` - Removes invalid tokens

---

## Error Handling

### Invalid FCM Tokens:
- Detects `messaging/registration-token-not-registered` errors
- Automatically removes invalid tokens from database
- Logs cleanup actions

### Missing Data:
- Skips items without names
- Skips users without FCM tokens
- Continues processing other matches

---

## Index Structure

### Required Index:
```
/notifier_index/
  {side}/          # 'buy' or 'sale'
    {itemKey}/     # Sanitized item name (e.g., 'Dragon', 'Leopard')
      {userId}/    # User ID
        = true     # Just a flag
```

### Example:
```
/notifier_index/
  buy/
    Dragon/
      user123/ = true
      user456/ = true
    Leopard/
      user789/ = true
```

---

## Logging

### Success Logs:
- `📦 New trade created: {tradeId}`
- `🔍 Finding matches for {side} side using reverse index...`
- `✅ Found {count} users with item "{itemName}" in {side} notifier`
- `📡 Notifying {count} users for {messageType}...`
- `✅ Notification sent to {userId} ({messageType}): {itemNames}`
- `✅ Notification process completed. Buy: {count} users, Sale: {count} users`

### Error Logs:
- `❌ Error checking index for item {itemName}: {error}`
- `⚠️ Missing FCM token for user {userId}`
- `❌ Failed to notify {userId} {error}`
- `❌ Error processing new trade notification: {error}`

---

## Deployment

```bash
firebase deploy --only functions:notifyFromTrade
```

**Note:** Make sure to deploy the optimized version (`notifyFromTrade_optimized.js`)

---

## Files

- **Optimized:** `functions/notifyFromTrade_optimized.js`

---

## Prerequisites

### 1. Reverse Index Must Exist
- Index is created automatically when users add items to notifier
- For existing data, run migration: `migrateNotifierIndex`

### 2. Database Rules
- Cloud function needs read access to:
  - `/notifier_index/**`
  - `/notifier/**`
  - `/users/{userId}/fcmToken`

---

## Testing

### Manual Test:
1. User A: Add item to "Buy" notifier
2. User B: Create trade with that item in `hasItems`
3. **Expected:** User A receives notification
4. **Check Logs:** Should use index, not download all notifier data

### Expected Results:
- Notifications sent to matching users
- Data download < 1 MB (instead of ~18 MB)
- Invalid tokens cleaned up automatically

---

## Performance

### Before Optimization:
- **Data Download:** ~18.86 MB per trade
- **Time:** ~5-10 seconds
- **Cost:** High (large data transfer)

### After Optimization:
- **Data Download:** ~1 MB per trade
- **Time:** ~2-3 seconds
- **Cost:** Low (minimal data transfer)

**Improvement:** 95% reduction in data download

---

## Notes

- Requires reverse index to be set up
- Automatically handles missing indexes gracefully
- Processes buy and sale sides in parallel
- Limits notifications to prevent spam
- Cleans up invalid tokens automatically

