# Leaderboard Feature Analysis

## 📊 Current Data Structure

### 1. **Average Ratings (Firebase Realtime Database)**
- **Path**: `/averageRatings/{userId}`
- **Structure**:
  ```json
  {
    "value": 4.5,        // Average rating (0-5)
    "count": 25,         // Number of ratings received
    "updatedAt": 1234567890
  }
  ```
- **✅ Already optimized**: Contains `count` field - perfect for "Top 50 Most Rated"

### 2. **Reviews (Firestore)**
- **Collection**: `reviews`
- **Document ID Format**: `{toUserId}_{fromUserId}` (e.g., `user123_user456`)
- **Fields**:
  ```json
  {
    "fromUserId": "user456",
    "toUserId": "user123",
    "rating": 5,
    "userName": "John Doe",
    "review": "Great trader!",
    "createdAt": Timestamp,
    "updatedAt": Timestamp,
    "edited": false
  }
  ```

---

## 🎯 Requirements

1. **Top 50 Most Rated Persons** (users who received the most ratings)
   - Data source: `/averageRatings/{userId}` → `count` field
   - ✅ **EASY**: Data already exists in RTDB

2. **Top 50 Users Who Gave Most Reviews** (users who wrote the most reviews)
   - Data source: Firestore `reviews` collection → count by `fromUserId`
   - ⚠️ **CHALLENGING**: No aggregation exists, need to count

---

## 💰 Cost Analysis & Optimization Strategies

### **Option 1: Cloud Function + Index Collection (RECOMMENDED) ⭐**

#### How it works:
1. **Create Firestore collections**:
   - `leaderboard_most_rated` (top 50 most rated users)
   - `leaderboard_most_reviewers` (top 50 users who gave most reviews)

2. **Cloud Function** (scheduled, runs every 1-6 hours):
   - Queries `/averageRatings` in RTDB, sorts by `count`, takes top 50
   - Queries Firestore `reviews`, groups by `fromUserId`, counts, sorts, takes top 50
   - Updates leaderboard collections

3. **Client-side**:
   - Simple `getDocs()` query on leaderboard collections
   - **Cost**: ~50 reads per leaderboard load (very cheap!)

#### **Pros**:
- ✅ **Ultra-low cost**: Only 50-100 Firestore reads per user
- ✅ **Fast loading**: Pre-computed data
- ✅ **Scalable**: Works with millions of reviews
- ✅ **Real-time updates**: Can update every hour

#### **Cons**:
- ⚠️ Requires cloud function setup
- ⚠️ Data updates every 1-6 hours (not instant)

#### **Estimated Costs**:
- **Cloud Function**: ~$0.01-0.05/month (runs 4-24 times/day)
- **Client Reads**: 50 reads × 2 leaderboards = 100 reads per user
- **Total**: ~$0.0001 per user view (extremely cheap!)

---

### **Option 2: Client-Side Aggregation (NOT RECOMMENDED) ❌**

#### How it works:
1. Query all `/averageRatings` from RTDB
2. Query all `reviews` from Firestore
3. Count and sort on client

#### **Pros**:
- ✅ No cloud function needed
- ✅ Always up-to-date

#### **Cons**:
- ❌ **Very expensive**: Downloads ALL ratings/reviews
- ❌ **Slow**: Large data transfer
- ❌ **Not scalable**: Breaks with large datasets

#### **Estimated Costs**:
- **RTDB Download**: ~1-10 MB per load (expensive!)
- **Firestore Reads**: 10,000+ reads per load (very expensive!)
- **Total**: ~$0.10-1.00 per user view (1000x more expensive!)

---

### **Option 3: Hybrid Approach (BALANCED) ⚖️**

#### How it works:
1. **Most Rated**: Query RTDB `/averageRatings` with `orderByValue('count')` + `limitToLast(50)`
   - ✅ **Optimized**: RTDB supports ordering by value
   - ✅ **Low cost**: Only downloads top 50

2. **Most Reviewers**: Use cloud function (same as Option 1)
   - Firestore doesn't support aggregation queries efficiently

#### **Pros**:
- ✅ No cloud function needed for "most rated"
- ✅ Low cost for "most rated"
- ✅ Still need cloud function for "most reviewers"

#### **Cons**:
- ⚠️ Still need cloud function for reviewers leaderboard
- ⚠️ RTDB query might be slower than pre-computed Firestore

---

## 🏆 Recommended Implementation: Option 1 (Cloud Function + Index)

### **Step 1: Create Firestore Collections**

```javascript
// leaderboard_most_rated/{rank}
{
  "userId": "user123",
  "displayName": "John Doe",
  "avatar": "https://...",
  "ratingCount": 150,
  "averageRating": 4.8,
  "rank": 1,
  "updatedAt": Timestamp
}

// leaderboard_most_reviewers/{rank}
{
  "userId": "user456",
  "displayName": "Jane Smith",
  "avatar": "https://...",
  "reviewCount": 89,
  "rank": 1,
  "updatedAt": Timestamp
}
```

### **Step 2: Cloud Function (Scheduled)**

```javascript
// functions/updateLeaderboards.js
exports.updateLeaderboards = functions.pubsub
  .schedule('every 2 hours')
  .onRun(async (context) => {
    // 1. Query RTDB /averageRatings, sort by count, get top 50
    // 2. Query Firestore reviews, group by fromUserId, count, sort, get top 50
    // 3. Fetch user displayName/avatar from RTDB users/{userId}
    // 4. Update Firestore leaderboard collections
  });
```

### **Step 3: Client-Side Query**

```javascript
// In header component
const loadLeaderboards = async () => {
  const [mostRatedSnap, mostReviewersSnap] = await Promise.all([
    getDocs(query(
      collection(firestoreDB, 'leaderboard_most_rated'),
      orderBy('rank', 'asc'),
      limit(50)
    )),
    getDocs(query(
      collection(firestoreDB, 'leaderboard_most_reviewers'),
      orderBy('rank', 'asc'),
      limit(50)
    ))
  ]);
  
  // Process and display
};
```

---

## 📍 Where to Display

### **Header Location Options:**

1. **ChatNavigator.js** (Chat tab header)
   - Add leaderboard icon button in `headerRight`
   - Opens modal/drawer with leaderboard

2. **TradeNavigator.js** (Trade tab header)
   - Similar approach

3. **MainTabs.js** (Global header)
   - Accessible from all tabs

### **UI Component:**
- Modal/Drawer with two tabs:
  - "Top Rated" (most rated persons)
  - "Top Reviewers" (users who gave most reviews)
- Each item shows:
  - Rank badge
  - Avatar
  - Display name
  - Rating count / Review count
  - Average rating (for most rated)
  - "Chat" button → opens private chat

---

## 💡 Additional Optimizations

### **1. Caching**
- Cache leaderboard data in local state (MMKV)
- Refresh every 1-2 hours
- **Savings**: 90% reduction in reads

### **2. Incremental Updates**
- Cloud function only updates changed ranks
- Use Firestore transactions for consistency
- **Savings**: Faster updates, lower costs

### **3. Pagination**
- Load top 20 initially, load more on scroll
- **Savings**: 60% reduction in initial reads

### **4. User Data Pre-fetching**
- Store `displayName` and `avatar` in leaderboard docs
- Avoid fetching from `/users/{userId}` on every load
- **Savings**: 50% reduction in RTDB reads

---

## 📊 Cost Comparison

| Approach | Reads per Load | Cost per 1000 Users | Update Frequency |
|----------|---------------|---------------------|------------------|
| **Option 1 (Recommended)** | 100 reads | $0.10 | Every 1-6 hours |
| **Option 2 (Client-side)** | 10,000+ reads | $10.00+ | Real-time |
| **Option 3 (Hybrid)** | 150 reads | $0.15 | Every 1-6 hours |

---

## ✅ Final Recommendation

**Use Option 1 (Cloud Function + Index Collections)** because:
1. ✅ **Lowest cost**: 100x cheaper than client-side
2. ✅ **Fastest loading**: Pre-computed data
3. ✅ **Scalable**: Works with millions of users
4. ✅ **Maintainable**: Single source of truth

**Implementation Steps:**
1. Create Firestore collections (`leaderboard_most_rated`, `leaderboard_most_reviewers`)
2. Write cloud function to update leaderboards every 2 hours
3. Add leaderboard button in header (ChatNavigator.js or TradeNavigator.js)
4. Create leaderboard modal component
5. Implement instant chat functionality (reuse existing private chat)

---

## 🔗 Integration Points

### **Instant Chat:**
- Reuse `PrivateChatScreen` component
- Pass `selectedUser` with `senderId`, `sender`, `avatar`
- Navigate: `navigation.navigate('PrivateChatTrade', { selectedUser })`

### **User Data Fetching:**
- Leaderboard docs should include: `userId`, `displayName`, `avatar`
- Fetch from RTDB `/users/{userId}` in cloud function
- Store in leaderboard docs to avoid client-side fetches

---

## ⚠️ Considerations

1. **Privacy**: Ensure users can opt-out of leaderboard
2. **Spam Prevention**: Filter out users with suspicious review patterns
3. **Real-time Updates**: Consider using Firestore `onSnapshot` for live updates (optional)
4. **Error Handling**: Handle cases where user data is missing
5. **Performance**: Use `React.memo` for leaderboard items to prevent re-renders

---

## 📝 Next Steps (When Ready to Implement)

1. ✅ Create Firestore collections structure
2. ✅ Write cloud function for leaderboard updates
3. ✅ Add leaderboard button in header
4. ✅ Create leaderboard modal component
5. ✅ Implement instant chat integration
6. ✅ Add caching mechanism
7. ✅ Test with real data
8. ✅ Deploy and monitor costs

