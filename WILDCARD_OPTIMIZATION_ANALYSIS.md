# Wildcard Path Optimization Analysis

## Summary of High-Usage Paths

| Path | Data Downloaded | Reads | Priority | Status |
|------|----------------|-------|----------|--------|
| `/private_messages/$wildcard/messages` | 6.85 MB | 7,898 | 🔴 HIGH | Needs optimization |
| `/chat_meta_data/$wildcard/$wildcard` | 3.62 MB | 18,261 | 🟡 MEDIUM | Already optimized, but high reads |
| `/previousStock` | 3.35 MB | 4,838 | 🟡 MEDIUM | Can be optimized |
| `/users/$wildcard/fcmToken` | 2.72 MB | **22,489** | 🔴 **CRITICAL** | **Highest reads - needs optimization** |
| `/users/$wildcard` | 1.74 MB | 4,328 | 🟢 LOW | Mostly optimized |

---

## 1. `/users/$wildcard/fcmToken` - 🔴 CRITICAL (22,489 reads)

### Current Usage:
- **Cloud Function:** `functions/checkFruitsAndNotify.js` (line 78-95)
  - Reads **ALL users** using `usersRef.orderByKey().once('value')`
  - Downloads entire user objects just to get `fcmToken`
  - Runs on a schedule (every 28 minutes)
  - **This is the main culprit for high reads**

### Optimization Opportunities:

#### Option A: Fetch Only Required Fields (Recommended) ✅ IMPLEMENTED
```javascript
// Instead of: const user = usersData[userId]; (full user object)
// Use: Fetch only required fields for each user
const userDataPromises = userIds.map(userId => 
  Promise.all([
    db.ref(`/users/${userId}/fcmToken`).once('value'),
    db.ref(`/users/${userId}/selectedFruits`).once('value'),
    db.ref(`/users/${userId}/isSelectedReminderEnabled`).once('value'),
    db.ref(`/users/${userId}/isReminderEnabled`).once('value'),
  ])
);
```
**Savings:** ~90-95% data reduction per user (from ~5-10 KB to ~200-800 bytes per user)
**Note:** We still need to query users to get userIds, but we ignore the downloaded data and fetch only specific fields

#### Option B: Create Separate fcmTokens Node
```javascript
// Structure: /fcm_tokens/{userId} = token
// Cloud function reads from /fcm_tokens instead of /users/{userId}/fcmToken
```
**Savings:** ~90% data reduction, cleaner separation

#### Option C: Reverse Index (Similar to Notifier)
```javascript
// Structure: /fcm_tokens_index/{token}/{userId} = true
// Only for users with valid tokens
```
**Savings:** ~85% data reduction, but more complex

**Recommendation:** Option A is easiest and most effective.

---

## 2. `/private_messages/$wildcard/messages` - 🔴 HIGH (6.85 MB, 7,898 reads)

### Current Usage:
- **File:** `Code/ChatScreen/PrivateChat/PrivateChat.jsx`
- Uses pagination (`limitToLast(PAGE_SIZE)` where PAGE_SIZE = 15)
- Fetches full message objects with `once('value')`

### Optimization Opportunities:

#### Option A: Use child_added/child_changed Listeners
```javascript
// Instead of: messagesRef.orderByKey().limitToLast(PAGE_SIZE).once('value')
// Use: child_added listener with limitToLast(1) for new messages
// Initial load: once('value') with limitToLast(15)
// Updates: child_added listener only for new messages
```
**Savings:** ~60-70% data reduction (only download new messages, not all on update)

#### Option B: Reduce Message Payload Size
- Remove unnecessary fields (similar to chat_new optimization)
- Store only essential fields in message object
**Savings:** ~30-40% per message

#### Option C: Client-Side Caching
- Cache messages locally
- Only fetch new messages since last sync
**Savings:** ~50% reduction in repeated reads

**Recommendation:** Combine Option A + B for best results.

---

## 3. `/previousStock` - 🟡 MEDIUM (3.35 MB, 4,838 reads)

### Current Usage:
- **File:** `Code/GlobelStats.js` (line 508)
- Fetched on **every app load** in `fetchStockData()`
- Stored locally but re-fetched every time

### Optimization Opportunities:

#### Option A: Cache with Timestamp Check
```javascript
// Only fetch if last fetch was > 1 hour ago
const lastFetchTime = localState.lastPreviousStockFetch || 0;
const oneHour = 60 * 60 * 1000;
if (Date.now() - lastFetchTime > oneHour) {
  // Fetch previousStock
  await updateLocalState('lastPreviousStockFetch', Date.now());
} else {
  // Use cached data
}
```
**Savings:** ~80% reduction in reads (only fetch once per hour instead of every app load)

#### Option B: Fetch Only When Needed
- Only fetch when user opens stock screen
- Not on every app load
**Savings:** ~90% reduction (only fetch when actually viewing previous stock)

**Recommendation:** Option A is safer, Option B is more aggressive.

---

## 4. `/chat_meta_data/$wildcard/$wildcard` - 🟡 MEDIUM (3.62 MB, 18,261 reads)

### Current Usage:
- Already optimized with child listeners in `ChatNavigator.js` and `InboxScreen.jsx`
- High read count is likely from:
  - Multiple users accessing their chat metadata
  - Initial loads when users open inbox

### Optimization Opportunities:

#### Option A: Further Reduce Payload Size
- Check if all fields in chat_meta_data are necessary
- Remove any redundant fields
**Savings:** ~20-30% per chat metadata entry

#### Option B: Lazy Load Metadata
- Only load metadata when inbox is opened
- Don't keep listeners active when not needed
**Savings:** ~30-40% reduction (already partially implemented)

**Recommendation:** Already well optimized, minor improvements possible.

---

## 5. `/users/$wildcard` - 🟢 LOW (1.74 MB, 4,328 reads)

### Current Usage:
- Already optimized in most places (field-specific fetching)
- Used for user login and profile updates

### Optimization Opportunities:
- Already mostly optimized
- Check for any remaining full user object reads
**Savings:** Minimal (already optimized)

---

## Priority Implementation Order

1. **🔴 CRITICAL:** `/users/$wildcard/fcmToken` - Fix cloud function to fetch only fcmToken
   - **Impact:** ~95% reduction (2.72 MB → ~0.14 MB)
   - **Effort:** Low (simple code change)
   - **Reads saved:** ~20,000+ reads per run

2. **🔴 HIGH:** `/private_messages/$wildcard/messages` - Use child listeners + reduce payload
   - **Impact:** ~60-70% reduction (6.85 MB → ~2-3 MB)
   - **Effort:** Medium (requires refactoring listeners)
   - **Reads saved:** ~4,000-5,000 reads

3. **🟡 MEDIUM:** `/previousStock` - Cache with timestamp
   - **Impact:** ~80% reduction (3.35 MB → ~0.67 MB)
   - **Effort:** Low (simple caching logic)
   - **Reads saved:** ~3,800 reads

4. **🟡 MEDIUM:** `/chat_meta_data/$wildcard/$wildcard` - Minor optimizations
   - **Impact:** ~20-30% reduction (3.62 MB → ~2.5 MB)
   - **Effort:** Low (check payload size)
   - **Reads saved:** ~3,000-5,000 reads

---

## Expected Total Savings

**Before Optimization:**
- Total: ~18.28 MB, ~58,814 reads

**After Optimization:**
- Total: ~6-7 MB, ~25,000-30,000 reads
- **Savings: ~65-70% data reduction, ~50% read reduction**

---

## Notes

- All optimizations maintain backward compatibility
- No functionality will be compromised
- Cloud function optimization (#1) will have the biggest impact
- Private messages optimization (#2) will improve user experience (faster loading)

