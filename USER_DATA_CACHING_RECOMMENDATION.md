# User Data Caching - Where and How to Cache

## Current App Architecture

Your app already uses:
- **MMKV** (`react-native-mmkv`) for persistent storage via `LocalStateProvider`
- **GlobalStateProvider** for app-wide state management
- **In-memory state** for React components

---

## Recommended Caching Strategy

### Option 1: In-Memory Cache + Global State (RECOMMENDED) ✅

**Best for:** Fast access during app session, shared across all components

**Location:** Add to `GlobelStats.js` (GlobalStateProvider)

**Implementation:**
```javascript
// In GlobelStats.js
const [userDataCache, setUserDataCache] = useState(new Map());

// Add to context value
const value = {
  // ... existing values
  userDataCache,
  setUserDataCache,
  // Helper function to get cached user
  getCachedUser: (userId) => userDataCache.get(userId),
  // Helper function to cache user
  cacheUser: (userId, userData) => {
    setUserDataCache(prev => new Map(prev).set(userId, {
      ...userData,
      cachedAt: Date.now(), // Track when cached
    }));
  },
};
```

**Pros:**
- ✅ Fast (in-memory access)
- ✅ Shared across all components
- ✅ No disk I/O overhead
- ✅ Easy to clear on logout

**Cons:**
- ⚠️ Lost on app restart (but that's OK - user data is small)

---

### Option 2: MMKV Persistent Cache (For Offline Access)

**Best for:** Persisting cache across app restarts, offline access

**Location:** Add to `LocalGlobelStats.js` (LocalStateProvider)

**Implementation:**
```javascript
// In LocalGlobelStats.js
const [localState, setLocalState] = useState(() => ({
  // ... existing state
  userDataCache: safeParseJSON('userDataCache', {}), // { userId: { data, cachedAt } }
}));

// Helper functions
const cacheUserData = (userId, userData) => {
  const cache = localState.userDataCache || {};
  cache[userId] = {
    ...userData,
    cachedAt: Date.now(),
  };
  updateLocalState('userDataCache', cache);
};

const getCachedUserData = (userId) => {
  const cache = localState.userDataCache || {};
  const cached = cache[userId];
  
  // Check if cache is still valid (e.g., 1 hour)
  if (cached && cached.cachedAt) {
    const oneHour = 60 * 60 * 1000;
    if (Date.now() - cached.cachedAt < oneHour) {
      return cached;
    }
  }
  return null;
};
```

**Pros:**
- ✅ Persists across app restarts
- ✅ Available offline
- ✅ Can add expiration logic

**Cons:**
- ⚠️ Slower than in-memory (disk I/O)
- ⚠️ Takes up storage space

---

### Option 3: Hybrid Approach (BEST) ✅✅

**Best for:** Best of both worlds - fast in-memory + persistent backup

**Location:** Create new utility file `Code/Helper/UserDataCache.js`

**Implementation:**
```javascript
// Code/Helper/UserDataCache.js
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV();
const CACHE_KEY = 'userDataCache';
const CACHE_EXPIRY = 60 * 60 * 1000; // 1 hour

// In-memory cache (fast)
const memoryCache = new Map();

// Load from MMKV on app start
const loadCacheFromStorage = () => {
  try {
    const cached = storage.getString(CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      Object.entries(data).forEach(([userId, userData]) => {
        // Only load if not expired
        if (userData.cachedAt && Date.now() - userData.cachedAt < CACHE_EXPIRY) {
          memoryCache.set(userId, userData);
        }
      });
    }
  } catch (error) {
    console.error('Error loading user cache:', error);
  }
};

// Initialize on import
loadCacheFromStorage();

export const getUserData = (userId) => {
  const cached = memoryCache.get(userId);
  
  // Check expiration
  if (cached && cached.cachedAt) {
    if (Date.now() - cached.cachedAt < CACHE_EXPIRY) {
      return cached;
    } else {
      // Expired, remove from cache
      memoryCache.delete(userId);
      return null;
    }
  }
  return null;
};

export const cacheUserData = (userId, userData) => {
  const dataToCache = {
    ...userData,
    cachedAt: Date.now(),
  };
  
  // Cache in memory
  memoryCache.set(userId, dataToCache);
  
  // Also save to MMKV (persistent)
  try {
    const existing = storage.getString(CACHE_KEY);
    const cache = existing ? JSON.parse(existing) : {};
    cache[userId] = dataToCache;
    
    // Limit cache size (keep only last 100 users)
    const entries = Object.entries(cache);
    if (entries.length > 100) {
      // Remove oldest entries
      const sorted = entries.sort((a, b) => 
        (b[1].cachedAt || 0) - (a[1].cachedAt || 0)
      );
      const limited = Object.fromEntries(sorted.slice(0, 100));
      storage.set(CACHE_KEY, JSON.stringify(limited));
    } else {
      storage.set(CACHE_KEY, JSON.stringify(cache));
    }
  } catch (error) {
    console.error('Error saving user cache:', error);
  }
};

export const clearUserCache = () => {
  memoryCache.clear();
  storage.delete(CACHE_KEY);
};

export const clearExpiredCache = () => {
  const now = Date.now();
  const toRemove = [];
  
  memoryCache.forEach((value, key) => {
    if (value.cachedAt && now - value.cachedAt >= CACHE_EXPIRY) {
      toRemove.push(key);
    }
  });
  
  toRemove.forEach(key => memoryCache.delete(key));
  
  // Also clean MMKV
  try {
    const existing = storage.getString(CACHE_KEY);
    if (existing) {
      const cache = JSON.parse(existing);
      const cleaned = {};
      Object.entries(cache).forEach(([userId, userData]) => {
        if (userData.cachedAt && now - userData.cachedAt < CACHE_EXPIRY) {
          cleaned[userId] = userData;
        }
      });
      storage.set(CACHE_KEY, JSON.stringify(cleaned));
    }
  } catch (error) {
    console.error('Error cleaning cache:', error);
  }
};
```

**Usage in OnlineUsersList.jsx:**
```javascript
import { getUserData, cacheUserData } from '../../Helper/UserDataCache';

const loadUserBatch = async (userIds) => {
  const uncachedIds = [];
  const cachedUsers = [];
  
  // Check cache first
  userIds.forEach(userId => {
    const cached = getUserData(userId);
    if (cached) {
      cachedUsers.push(cached);
    } else {
      uncachedIds.push(userId);
    }
  });
  
  // Only fetch uncached users
  const userPromises = uncachedIds.map(async (userId) => {
    const [displayNameSnap, avatarSnap, ...] = await Promise.all([
      get(ref(appdatabase, `users/${userId}/displayName`)),
      // ... 7 more fields
    ]);
    
    const userData = {
      id: userId,
      displayName: displayNameSnap?.val(),
      // ... extract fields
    };
    
    // Cache it!
    cacheUserData(userId, userData);
    return userData;
  });
  
  const fetchedUsers = await Promise.all(userPromises);
  return [...cachedUsers, ...fetchedUsers];
};
```

**Pros:**
- ✅ Fast in-memory access (primary)
- ✅ Persistent backup (survives app restart)
- ✅ Automatic expiration (1 hour)
- ✅ Size limit (max 100 users)
- ✅ Easy to use across all components

**Cons:**
- ⚠️ Slightly more complex

---

## Recommendation: Use Option 3 (Hybrid Approach)

### Why?
1. **Fast:** In-memory cache for instant access
2. **Persistent:** MMKV backup for app restarts
3. **Smart:** Automatic expiration and size limits
4. **Reusable:** Can be used in all components (OnlineUsersList, ChatHeader, ProfileDrawer, etc.)

### Implementation Steps:

1. **Create** `Code/Helper/UserDataCache.js` (utility file)
2. **Update** `OnlineUsersList.jsx` to use cache
3. **Update** `PrivateChatHeader.jsx` to use cache
4. **Update** `BottomDrawer.jsx` to use cache
5. **Clear cache** on user logout (in `GlobelStats.js`)

### Cache Expiration:
- **1 hour** - User data doesn't change frequently
- Can be adjusted based on needs

### Cache Size Limit:
- **100 users** - Prevents cache from growing too large
- Removes oldest entries when limit reached

---

## Where to Clear Cache

### On User Logout:
```javascript
// In GlobelStats.js - handleUserLogin function
if (!loggedInUser) {
  resetUserState();
  clearUserCache(); // Clear user data cache
  return;
}
```

### On App Start (Optional):
```javascript
// In GlobelStats.js - useEffect on mount
useEffect(() => {
  clearExpiredCache(); // Clean expired entries
}, []);
```

---

## Expected Savings

### Without Cache:
```
User appears in 3 screens = 3 × 200 bytes = 600 bytes
```

### With Cache:
```
User appears in 3 screens = 1 × 200 bytes (first) + 0 bytes (cached) = 200 bytes
Savings: 66% reduction
```

### For 20 users, 5 appear in multiple screens:
```
Without cache: 6,000 bytes
With cache: 4,000 bytes
Savings: 33% reduction
```

---

**Status:** Ready to implement  
**Priority:** HIGH (significant Firebase cost savings)

