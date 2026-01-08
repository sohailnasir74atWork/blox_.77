// UserDataCache.js - Cache for user data to reduce Firebase RTDB downloads
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV();
const CACHE_KEY = 'userDataCache';
const CACHE_EXPIRY = 60 * 60 * 1000; // 1 hour in milliseconds

// In-memory cache (fast access during app session)
const memoryCache = new Map();

// Load from MMKV on app start
const loadCacheFromStorage = () => {
  try {
    const cached = storage.getString(CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      const now = Date.now();
      Object.entries(data).forEach(([userId, userData]) => {
        // Only load if not expired
        if (userData.cachedAt && now - userData.cachedAt < CACHE_EXPIRY) {
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

/**
 * Get cached user data
 * @param {string} userId - User ID to lookup
 * @returns {object|null} - Cached user data or null if not found/expired
 */
export const getUserData = (userId) => {
  if (!userId) return null;
  
  const cached = memoryCache.get(userId);
  
  // Check expiration
  if (cached && cached.cachedAt) {
    const age = Date.now() - cached.cachedAt;
    if (age < CACHE_EXPIRY) {
      return cached;
    } else {
      // Expired, remove from cache
      memoryCache.delete(userId);
      return null;
    }
  }
  return null;
};

/**
 * Cache user data (both in-memory and persistent storage)
 * @param {string} userId - User ID
 * @param {object} userData - User data to cache
 */
export const cacheUserData = (userId, userData) => {
  if (!userId || !userData) return;
  
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
      // Remove oldest entries (sort by cachedAt, keep newest 100)
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

/**
 * Clear all cached user data
 */
export const clearUserCache = () => {
  memoryCache.clear();
  try {
    storage.delete(CACHE_KEY);
  } catch (error) {
    console.error('Error clearing user cache:', error);
  }
};

/**
 * Clear expired cache entries
 */
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

/**
 * Check if user is cached (without returning data)
 * @param {string} userId - User ID to check
 * @returns {boolean} - True if cached and not expired
 */
export const isUserCached = (userId) => {
  return getUserData(userId) !== null;
};

