/**
 * ✅ OPTIMIZED: Scheduled Cloud Function to pre-compute leaderboard top 50
 * 
 * This function runs once daily to:
 * 1. Query all users from user_ratings_summary
 * 2. Filter for users with rating >= 3.7 and at least 1 review
 * 3. Sort by review count (desc) - MOST REVIEWED FIRST (priority #1)
 * 4. Then by rating (desc) for tie-breaking
 * 5. Take top 50 users
 * 6. Store in leaderboard_cache collection for fast client-side reads
 * 
 * Benefits:
 * - Pre-computed: No querying/filtering on every app load
 * - Cost-effective: Runs once per day, app just reads 1 document
 * - Fast: App reads from single cached document (very fast)
 * - Accurate: Shows users with most reviews (who have >= 3.7 rating)
 * 
 * Schedule: Runs daily at 12:00 AM UTC (configured in Firebase Console)
 * 
 * Collection Structure:
 * - Collection: leaderboard_cache
 * - Document ID: top50
 * - Fields:
 *   - users: Array of user objects
 *   - lastUpdated: Timestamp
 *   - version: String (for cache invalidation if needed)
 */

const functions = require("firebase-functions/v1");
const admin = require('firebase-admin');

// Initialize Admin SDK (if not already initialized)
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const MIN_RATING_THRESHOLD = 3.7; // Minimum rating to include
const TOP_USERS_LIMIT = 50; // Number of users to include in leaderboard

/**
 * Scheduled function to update leaderboard cache
 * Configure in Firebase Console to run daily at 12:00 AM UTC
 * Or use: functions.pubsub.schedule('0 0 * * *').timeZone('UTC')
 */
exports.updateLeaderboardCache = functions.pubsub
  .schedule('0 0 * * *') // Run daily at 12:00 AM UTC
  .timeZone('UTC')
  .onRun(async (context) => {
    console.log('🚀 [Leaderboard] Starting daily leaderboard cache update...');
    
    try {
      // ✅ Step 1: Fetch all users from user_ratings_summary collection
      const summaryRef = db.collection('user_ratings_summary');
      const summarySnapshot = await summaryRef.get();
      
      if (summarySnapshot.empty) {
        console.log('⚠️ [Leaderboard] No users found in user_ratings_summary');
        return null;
      }
      
      console.log(`📊 [Leaderboard] Processing ${summarySnapshot.size} users...`);
      
      // ✅ Step 2: Extract and filter users
      const allUsers = [];
      
      summarySnapshot.docs.forEach((doc) => {
        const data = doc.data();
        const userId = doc.id;
        const ratingCount = data.count || 0;
        const averageRating = data.averageRating || 0;
        
        // Filter: At least 1 review AND rating >= 3.7
        if (ratingCount > 0 && averageRating >= MIN_RATING_THRESHOLD) {
          allUsers.push({
            userId: userId,
            ratingCount: ratingCount,
            averageRating: averageRating,
            updatedAt: data.updatedAt ? data.updatedAt.toMillis() : Date.now(),
          });
        }
      });
      
      console.log(`✅ [Leaderboard] Found ${allUsers.length} users with rating >= ${MIN_RATING_THRESHOLD}`);
      
      if (allUsers.length === 0) {
        console.log('⚠️ [Leaderboard] No users meet the criteria (rating >= 3.7)');
        return null;
      }
      
      // ✅ Step 3: Sort by review count (desc) first, then rating (desc)
      // Priority #1: NUMBER OF REVIEWS (most reviewed first)
      // Priority #2: Average rating (descending) - only breaks ties
      const sortedUsers = allUsers.sort((a, b) => {
        // Primary sort: Review count (descending) - MOST REVIEWED FIRST
        if (b.ratingCount !== a.ratingCount) {
          return b.ratingCount - a.ratingCount;
        }
        // Secondary sort: Average rating (descending) - only for tie-breaking
        return b.averageRating - a.averageRating;
      });
      
      // ✅ Step 4: Take top 50 users
      const topUsers = sortedUsers.slice(0, TOP_USERS_LIMIT);
      
      // ✅ Step 5: Fetch user details (displayName, avatar) from Realtime Database
      // We need to fetch these from the users node in Realtime Database
      const database = admin.database();
      const userDetailsPromises = topUsers.map(async (user) => {
        try {
          const userRef = database.ref(`users/${user.userId}`);
          const userSnapshot = await userRef.once('value');
          const userData = userSnapshot.val();
          
          return {
            userId: user.userId,
            ratingCount: user.ratingCount,
            averageRating: user.averageRating,
            displayName: userData?.displayName || 'Anonymous',
            avatar: userData?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
            rank: topUsers.indexOf(user) + 1, // Assign rank (1-based)
            updatedAt: user.updatedAt,
          };
        } catch (error) {
          console.error(`❌ [Leaderboard] Error fetching details for user ${user.userId}:`, error);
          return {
            userId: user.userId,
            ratingCount: user.ratingCount,
            averageRating: user.averageRating,
            displayName: 'Anonymous',
            avatar: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
            rank: topUsers.indexOf(user) + 1,
            updatedAt: user.updatedAt,
          };
        }
      });
      
      const leaderboardWithDetails = await Promise.all(userDetailsPromises);
      
      // ✅ Step 6: Store in leaderboard_cache collection
      const cacheRef = db.collection('leaderboard_cache').doc('top50');
      
      await cacheRef.set({
        users: leaderboardWithDetails,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        version: '1.0',
        minRatingThreshold: MIN_RATING_THRESHOLD,
        totalUsers: leaderboardWithDetails.length,
      }, { merge: false }); // Replace entire document
      
      console.log(`✅ [Leaderboard] Successfully updated leaderboard cache with ${leaderboardWithDetails.length} users`);
      console.log(`📊 [Leaderboard] Top 3 users:`);
      leaderboardWithDetails.slice(0, 3).forEach((user, index) => {
        console.log(`   ${index + 1}. ${user.displayName} - ${user.ratingCount} reviews, ${user.averageRating.toFixed(2)} rating`);
      });
      
      return {
        success: true,
        userCount: leaderboardWithDetails.length,
        timestamp: new Date().toISOString(),
      };
      
    } catch (error) {
      console.error('❌ [Leaderboard] Error updating leaderboard cache:', error);
      throw error; // Let Firebase retry the function
    }
  });

/**
 * Manual trigger function (for testing)
 * Call via: https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/updateLeaderboardCacheManual
 */
exports.updateLeaderboardCacheManual = functions.https.onRequest(async (req, res) => {
  console.log('🚀 [Leaderboard] Manual trigger - Starting leaderboard cache update...');
  
  try {
    // Reuse the same logic as scheduled function
    const summaryRef = db.collection('user_ratings_summary');
    const summarySnapshot = await summaryRef.get();
    
    if (summarySnapshot.empty) {
      res.status(200).json({ success: false, message: 'No users found' });
      return;
    }
    
    const allUsers = [];
    summarySnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const userId = doc.id;
      const ratingCount = data.count || 0;
      const averageRating = data.averageRating || 0;
      
      if (ratingCount > 0 && averageRating >= MIN_RATING_THRESHOLD) {
        allUsers.push({
          userId: userId,
          ratingCount: ratingCount,
          averageRating: averageRating,
          updatedAt: data.updatedAt ? data.updatedAt.toMillis() : Date.now(),
        });
      }
    });
    
    const sortedUsers = allUsers.sort((a, b) => {
      if (b.ratingCount !== a.ratingCount) {
        return b.ratingCount - a.ratingCount;
      }
      return b.averageRating - a.averageRating;
    });
    
    const topUsers = sortedUsers.slice(0, TOP_USERS_LIMIT);
    
    const database = admin.database();
    const userDetailsPromises = topUsers.map(async (user) => {
      try {
        const userRef = database.ref(`users/${user.userId}`);
        const userSnapshot = await userRef.once('value');
        const userData = userSnapshot.val();
        
        return {
          userId: user.userId,
          ratingCount: user.ratingCount,
          averageRating: user.averageRating,
          displayName: userData?.displayName || 'Anonymous',
          avatar: userData?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
          rank: topUsers.indexOf(user) + 1,
          updatedAt: user.updatedAt,
        };
      } catch (error) {
        return {
          userId: user.userId,
          ratingCount: user.ratingCount,
          averageRating: user.averageRating,
          displayName: 'Anonymous',
          avatar: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
          rank: topUsers.indexOf(user) + 1,
          updatedAt: user.updatedAt,
        };
      }
    });
    
    const leaderboardWithDetails = await Promise.all(userDetailsPromises);
    
    const cacheRef = db.collection('leaderboard_cache').doc('top50');
    await cacheRef.set({
      users: leaderboardWithDetails,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      version: '1.0',
      minRatingThreshold: MIN_RATING_THRESHOLD,
      totalUsers: leaderboardWithDetails.length,
    }, { merge: false });
    
    res.status(200).json({
      success: true,
      userCount: leaderboardWithDetails.length,
      timestamp: new Date().toISOString(),
      message: 'Leaderboard cache updated successfully',
    });
  } catch (error) {
    console.error('❌ [Leaderboard] Error in manual trigger:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
