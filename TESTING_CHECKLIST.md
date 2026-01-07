# Comprehensive Testing Checklist

## Overview
This checklist covers all optimizations made to Firestore and Realtime Database (RTDB). Test each feature to ensure functionality is preserved while data usage is optimized.

---

## 🔥 Firestore Optimizations Testing

### 1. Design Posts & Comments
**What to Test:** Firestore reads optimization (single listener instead of multiple)

#### Test Steps:
1. ✅ **Create a Post**
   - Go to Design screen
   - Create a new design post
   - **Expected:** Post appears immediately
   - **Check:** Only 1 Firestore read (not multiple)

2. ✅ **View Posts**
   - Open Design screen
   - Scroll through posts
   - **Expected:** All posts load correctly
   - **Check:** Single `onSnapshot` listener (not one per post)

3. ✅ **Comment on Post**
   - Click on a post
   - Add a comment
   - **Expected:** Comment appears, notification sent
   - **Check:** Notification uses optimized FCM token fetching

4. ✅ **Like/Unlike Post**
   - Like a post
   - Unlike it
   - **Expected:** Like count updates correctly
   - **Check:** Firestore updates work correctly

---

### 2. Trades (Firestore)
**What to Test:** Combined query optimization (normal + featured trades)

#### Test Steps:
1. ✅ **View Trades**
   - Go to Trades screen
   - **Expected:** Normal and featured trades load
   - **Check:** Single query fetches both (not 2 separate queries)

2. ✅ **Create Trade**
   - Create a new trade
   - Mark as featured (if admin)
   - **Expected:** Trade appears in correct section
   - **Check:** Trade saves correctly

3. ✅ **Filter Trades**
   - Filter by type (buy/sell)
   - **Expected:** Filtering works correctly
   - **Check:** Client-side filtering works

---

### 3. Group Management (Firestore)
**What to Test:** Focus-based listeners (only active when screen focused)

#### Test Steps:
1. ✅ **View Groups**
   - Go to Groups screen
   - Switch between "My Groups" and "All Groups" tabs
   - **Expected:** Groups load correctly
   - **Check:** Listeners only active when screen focused

2. ✅ **Create Group**
   - Create a new group
   - **Expected:** Group appears immediately
   - **Check:** Group saves correctly

3. ✅ **Group Invitations**
   - As creator: Send invitation
   - As member: Accept/decline invitation
   - **Expected:** Invitation status updates
   - **Check:** Listeners only active when screen focused

4. ✅ **Join Requests**
   - Request to join a group
   - As creator: Approve/deny request
   - **Expected:** Request status updates
   - **Check:** Listeners only active when screen focused

---

### 4. User Settings (Firestore)
**What to Test:** Polling instead of continuous listener

#### Test Steps:
1. ✅ **View Profile**
   - Go to Settings
   - View profile
   - **Expected:** Profile loads correctly

2. ✅ **Update Owned Pets/Wishlist**
   - Open Pet Modal
   - Add/remove pets
   - Close modal
   - **Expected:** Pets update correctly
   - **Check:** `getDoc` called only on mount and modal close (not continuous)

---

## 🔄 Realtime Database (RTDB) Optimizations Testing

### 5. Notifier System
**What to Test:** Reverse index system for cloud function optimization

#### Test Steps:
1. ✅ **Add Item to Notifier**
   - Go to Trades → Trade Notifier
   - Add item to "Buy" notifier
   - Add item to "Sell" notifier
   - **Expected:** Items save correctly
   - **Check Firebase Console:** 
     - `/notifier/buy/{userId}/{itemKey}` exists
     - `/notifier_index/buy/{itemKey}/{userId}` exists (NEW)

2. ✅ **Remove Item from Notifier**
   - Remove an item from notifier
   - **Expected:** Item removed
   - **Check Firebase Console:**
     - Both `/notifier/...` and `/notifier_index/...` deleted

3. ✅ **Receive Trade Notification**
   - User A: Add item to "Buy" notifier
   - User B: Create trade with that item
   - **Expected:** User A receives notification
   - **Check:** Cloud function uses index (not downloading all notifier data)

4. ✅ **Test Existing Items (Backward Compatibility)**
   - Open notifier with existing items
   - **Expected:** Items load correctly
   - **Check:** Index automatically created for old items

---

### 6. Private Messages
**What to Test:** Child listener optimization (only new messages)

#### Test Steps:
1. ✅ **Send Message**
   - Open private chat
   - Send a text message
   - **Expected:** Message appears immediately
   - **Check:** Only new message downloaded (not all messages)

2. ✅ **Receive Message**
   - Have another user send you a message
   - **Expected:** Message appears in real-time
   - **Check:** Only new message downloaded

3. ✅ **Load Message History**
   - Open private chat with many messages
   - Scroll up to load older messages
   - **Expected:** Older messages load (15 at a time)
   - **Check:** Pagination works correctly

4. ✅ **Switch Between Chats**
   - Open Chat A
   - Switch to Chat B
   - Switch back to Chat A
   - **Expected:** Each chat loads correctly
   - **Check:** No duplicate messages

5. ✅ **Send Image Message**
   - Send an image in private chat
   - **Expected:** Image uploads and displays
   - **Check:** Message payload optimized (no unnecessary fields)

6. ✅ **Send Fruits/Pets Message**
   - Send a message with selected fruits/pets
   - **Expected:** Fruits display correctly
   - **Check:** Fruits list inside message bubble

---

### 7. Group Chat Messages
**What to Test:** Message payload optimization

#### Test Steps:
1. ✅ **Send Group Message**
   - Go to a group chat
   - Send a message
   - **Expected:** Message appears
   - **Check:** Message doesn't contain: `containsLink`, `currentUserEmail`, `flage`, `robloxUsername`, `robloxUserId`

2. ✅ **View User Profile (Bottom Drawer)**
   - Long press on a message
   - Tap user avatar or name
   - **Expected:** User profile opens
   - **Check:** `flage`, `robloxUsername`, `robloxUserId` fetched on-demand

3. ✅ **Admin Actions**
   - As admin: Long press message
   - Try to block user
   - **Expected:** Block works
   - **Check:** `currentUserEmail` fetched on-demand if needed

4. ✅ **Report Message**
   - Report a message
   - **Expected:** Report submitted
   - **Check:** Report functionality works

---

### 8. Chat Metadata (Inbox)
**What to Test:** Child listeners + pagination

#### Test Steps:
1. ✅ **View Inbox**
   - Go to Chat → Inbox
   - **Expected:** Shows 15 chats initially
   - **Check:** Only 15 chats loaded (not all)

2. ✅ **Scroll to Load More**
   - Scroll down in inbox
   - **Expected:** Loads 10 more chats
   - **Check:** Pagination works correctly

3. ✅ **New Chat Appears**
   - Receive a new message
   - **Expected:** Chat appears at top of inbox
   - **Check:** Only changed chat downloaded (not all chats)

4. ✅ **Unread Count**
   - Receive unread messages
   - **Expected:** Badge shows correct count
   - **Check:** Only unreadCount fields downloaded (not full chat data)

5. ✅ **Delete Chat**
   - Delete a chat from inbox
   - **Expected:** Chat removed
   - **Check:** Deletion works correctly

---

### 9. Stock Data (PreviousStock Caching)
**What to Test:** Timestamp-based caching

#### Test Steps:
1. ✅ **First App Load**
   - Close and reopen app
   - Go to Stock screen
   - **Expected:** Previous stock displays
   - **Check:** Fetched from Firebase (first time)

2. ✅ **Second App Load (Within 1 Hour)**
   - Close and reopen app within 1 hour
   - Go to Stock screen
   - **Expected:** Previous stock displays
   - **Check:** Uses cached data (not fetched from Firebase)

3. ✅ **Manual Refresh**
   - Pull to refresh on Stock screen
   - **Expected:** Fresh data loaded
   - **Check:** Forces fetch even if < 1 hour

4. ✅ **After 1 Hour**
   - Wait > 1 hour (or change system time)
   - Reopen app
   - **Expected:** Fresh previous stock fetched
   - **Check:** Fetches from Firebase

---

### 10. User Data Optimization
**What to Test:** Field-specific fetching

#### Test Steps:
1. ✅ **View Online Users**
   - Go to group chat
   - View online users list
   - **Expected:** Users display with avatars
   - **Check:** Only specific fields fetched (displayName, avatar, isPro, etc.)

2. ✅ **View User Profile**
   - Open user profile drawer
   - **Expected:** Profile displays correctly
   - **Check:** Only required fields fetched on-demand

3. ✅ **Block/Unblock User**
   - Block a user
   - Unblock them
   - **Expected:** Status updates correctly
   - **Check:** Works correctly

---

### 11. Cloud Function: Stock Notifications
**What to Test:** Optimized FCM token fetching

#### Test Steps:
1. ✅ **Enable Stock Reminder**
   - Go to Settings
   - Enable stock reminder
   - **Expected:** Setting saves

2. ✅ **Enable Selected Fruits Reminder**
   - Go to Stock screen
   - Select some fruits
   - Enable selected fruits reminder
   - **Expected:** Setting saves

3. ✅ **Wait for Stock Update**
   - Wait for scheduled stock update (or trigger manually)
   - **Expected:** Receive notification
   - **Check Cloud Function Logs:**
     - Should fetch only `fcmToken`, `selectedFruits`, `isSelectedReminderEnabled`, `isReminderEnabled`
     - Should NOT download full user objects
     - Data download should be ~90-95% less

4. ✅ **Test Selected Fruits Match**
   - Select fruits that are in stock
   - Wait for stock update
   - **Expected:** Receive notification with matched fruits

---

## 🔔 Notification Testing

### 12. Trade Notifications
**What to Test:** Optimized notifier cloud function

#### Test Steps:
1. ✅ **Setup Notifier**
   - User A: Add item to "Buy" notifier
   - User B: Add item to "Sell" notifier

2. ✅ **Create Matching Trade**
   - User C: Create trade with item from User A's notifier
   - **Expected:** User A receives notification
   - **Check Cloud Function Logs:**
     - Should use `/notifier_index/{side}/{itemKey}` to find users
     - Should NOT download entire `/notifier/{side}` node
     - Data download should be ~95% less

3. ✅ **Test Multiple Matches**
   - Multiple users have same item in notifier
   - Create trade with that item
   - **Expected:** All matching users receive notification
   - **Check:** Cloud function handles multiple matches correctly

---

### 13. Comment Notifications
**What to Test:** Optimized FCM token fetching

#### Test Steps:
1. ✅ **Comment on Post**
   - Comment on a design post
   - **Expected:** Post creator and previous commenters notified
   - **Check:** Uses optimized batch FCM token fetching

2. ✅ **Multiple Comments**
   - Multiple users comment on same post
   - **Expected:** All notifications sent correctly
   - **Check:** Max 50 users notified (cost optimization)

---

## 📊 Data Usage Verification

### 14. Firebase Console Checks

#### Realtime Database:
1. ✅ **Check `/notifier_index/` exists**
   - Should have structure: `/notifier_index/{side}/{itemKey}/{userId}`
   - Should be created automatically for new items

2. ✅ **Check Message Structure**
   - `/private_messages/{chatId}/messages/{messageId}`
   - Should NOT contain: `containsLink`, `currentUserEmail`, `flage`, `robloxUsername`, `robloxUserId`

3. ✅ **Check Chat Metadata**
   - `/chat_meta_data/{userId}/{otherUserId}`
   - Should only contain necessary fields

#### Firestore:
1. ✅ **Check Read Counts**
   - Monitor Firestore reads in console
   - Should see reduced reads for:
     - Design posts (single listener)
     - Trades (combined query)
     - Group invitations (focus-based)

---

## 🐛 Edge Cases & Error Handling

### 15. Error Scenarios

#### Test Steps:
1. ✅ **Network Disconnection**
   - Disconnect internet
   - Try to send message
   - **Expected:** Error handled gracefully
   - Reconnect: Messages sync correctly

2. ✅ **Invalid Data**
   - Try to access deleted chat
   - **Expected:** Handles gracefully, no crash

3. ✅ **Missing Index**
   - Manually delete an index entry
   - Add item to notifier
   - **Expected:** Index recreated automatically

4. ✅ **Cache Corruption**
   - Clear app data
   - Reopen app
   - **Expected:** Data fetches correctly, cache rebuilds

---

## 📱 Performance Testing

### 16. Performance Checks

#### Test Steps:
1. ✅ **App Startup Time**
   - Close app completely
   - Reopen app
   - **Expected:** Faster startup (cached previousStock)

2. ✅ **Chat Loading**
   - Open chat with many messages
   - **Expected:** Faster initial load (only 15 messages)
   - Scroll: Smooth pagination

3. ✅ **Inbox Loading**
   - Open inbox with many chats
   - **Expected:** Faster load (only 15 chats initially)
   - Scroll: Smooth pagination

4. ✅ **Memory Usage**
   - Monitor memory in dev tools
   - **Expected:** Lower memory usage (less data cached)

---

## ✅ Final Verification Checklist

### Before Release:
- [ ] All tests above pass
- [ ] No console errors
- [ ] No crashes
- [ ] Firebase Console shows reduced data usage
- [ ] Firestore reads reduced
- [ ] RTDB downloads reduced
- [ ] All notifications work
- [ ] All chat features work
- [ ] All trade features work
- [ ] All design/post features work
- [ ] Backward compatibility maintained
- [ ] No functionality lost

---

## 📝 Notes

- **Test on both iOS and Android**
- **Test with different user roles (admin, pro, free)**
- **Test with slow network connection**
- **Monitor Firebase Console during testing**
- **Check Cloud Function logs for optimizations**

---

## 🚨 Critical Tests (Must Pass)

1. ✅ **Notifier Index Creation** - Must work for new and old items
2. ✅ **Private Messages Real-time** - Must receive new messages
3. ✅ **Chat Metadata Pagination** - Must load chats correctly
4. ✅ **PreviousStock Caching** - Must use cache when appropriate
5. ✅ **Cloud Function Optimization** - Must reduce data download
6. ✅ **Admin Actions** - Must work with on-demand email fetching
7. ✅ **User Profile** - Must fetch data on-demand correctly

---

## 📞 If Issues Found

1. Check Firebase Console for data structure
2. Check Cloud Function logs
3. Check browser console for errors
4. Verify database rules are deployed
5. Verify cloud functions are deployed
6. Check local state cache

