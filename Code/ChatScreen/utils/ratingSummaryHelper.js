/**
 * ✅ OPTIMIZED: Helper function to update user_ratings_summary collection
 * This reduces Firebase costs by maintaining aggregated data instead of querying all reviews
 * 
 * Firestore Indexes Required:
 * 1. Simple Index:
 *    Collection: user_ratings_summary
 *    Fields: count (Descending)
 * 
 * 2. Composite Index (for optimized leaderboard query with rating filter):
 *    Collection: user_ratings_summary
 *    Fields: averageRating (Descending), count (Descending)
 *    This allows querying with: 
 *      - where(averageRating >= 3.5) 
 *      - orderBy(averageRating desc) [REQUIRED: must match where field]
 *      - orderBy(count desc) [secondary sort]
 *    
 *    ⚠️ Note: When using inequality (>=) in where(), FIRST orderBy() MUST be on same field
 */
import { doc, getDoc, setDoc, collection, query, where, getDocs, serverTimestamp } from '@react-native-firebase/firestore';

/**
 * Update the rating summary for a user in Firestore
 * This should be called whenever a review is created, updated, or deleted
 * 
 * @param {Object} firestoreDB - Firestore database instance
 * @param {string} userId - The user ID whose summary needs to be updated
 * @returns {Promise<void>}
 */
export const updateUserRatingSummary = async (firestoreDB, userId) => {
  if (!firestoreDB || !userId) {
    console.error('❌ updateUserRatingSummary: Missing firestoreDB or userId');
    return;
  }

  try {
    // ✅ Query all reviews for this user (where toUserId == userId)
    // Firestore index required: collection: 'reviews', fields: [toUserId (Ascending)]
    const reviewsQuery = query(
      collection(firestoreDB, 'reviews'),
      where('toUserId', '==', userId)
    );

    const reviewsSnapshot = await getDocs(reviewsQuery);

    // ✅ Calculate aggregated stats
    let count = 0;
    let sum = 0;

    reviewsSnapshot.docs.forEach((reviewDoc) => {
      const reviewData = reviewDoc.data();
      const rating = reviewData.rating;

      // Only count valid ratings
      if (typeof rating === 'number' && rating > 0) {
        count++;
        sum += rating;
      }
    });

    const averageRating = count > 0 ? parseFloat((sum / count).toFixed(2)) : 0;

    // ✅ Update or create summary document
    const summaryRef = doc(firestoreDB, 'user_ratings_summary', userId);
    await setDoc(
      summaryRef,
      {
        count,
        averageRating,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    // Returned so callers can drive the 5-Star badge (4.5★ avg with 50+ reviews)
    // without re-reading the collection they just computed.
    return { count, averageRating };
  } catch (error) {
    console.error(`❌ Error updating rating summary for user ${userId}:`, error);
    // Don't throw - this is a background update, shouldn't block review submission
    return null;
  }
};

/**
 * Backfill user_ratings_summary collection for all users who have reviews
 * This should be called once to populate the summary collection from existing reviews
 * 
 * @param {Object} firestoreDB - Firestore database instance
 * @param {Function} onProgress - Optional callback for progress updates (userId, processed, total)
 * @returns {Promise<{success: boolean, processed: number, errors: number}>}
 */
export const backfillUserRatingsSummary = async (firestoreDB, onProgress = null) => {
  if (!firestoreDB) {
    console.error('❌ backfillUserRatingsSummary: Missing firestoreDB');
    return { success: false, processed: 0, errors: 0 };
  }

  try {
    console.log('🔄 [Backfill] Starting to populate user_ratings_summary collection...');
    
    // ✅ Get all reviews
    const reviewsQuery = query(collection(firestoreDB, 'reviews'));
    const reviewsSnapshot = await getDocs(reviewsQuery);
    
    if (reviewsSnapshot.empty) {
      console.log('⚠️ [Backfill] No reviews found');
      return { success: true, processed: 0, errors: 0 };
    }

    console.log(`📊 [Backfill] Found ${reviewsSnapshot.size} reviews`);

    // ✅ Group reviews by toUserId
    const userReviewsMap = new Map();
    
    reviewsSnapshot.docs.forEach((reviewDoc) => {
      const reviewData = reviewDoc.data();
      const toUserId = reviewData.toUserId;
      const rating = reviewData.rating;

      if (!toUserId) return; // Skip reviews without toUserId

      if (!userReviewsMap.has(toUserId)) {
        userReviewsMap.set(toUserId, []);
      }

      // Only count valid ratings
      if (typeof rating === 'number' && rating > 0) {
        userReviewsMap.get(toUserId).push(rating);
      }
    });

    console.log(`📊 [Backfill] Found ${userReviewsMap.size} unique users with reviews`);

    // ✅ Process each user and update their summary
    let processed = 0;
    let errors = 0;
    const total = userReviewsMap.size;
    let current = 0;

    for (const [userId, ratings] of userReviewsMap.entries()) {
      try {
        const count = ratings.length;
        const sum = ratings.reduce((acc, r) => acc + r, 0);
        const averageRating = count > 0 ? parseFloat((sum / count).toFixed(2)) : 0;

        // ✅ Update summary document
        const summaryRef = doc(firestoreDB, 'user_ratings_summary', userId);
        await setDoc(
          summaryRef,
          {
            count,
            averageRating,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        processed++;
        current++;

        // ✅ Call progress callback if provided
        if (onProgress && typeof onProgress === 'function') {
          onProgress(userId, current, total);
        }

        // ✅ Log progress every 10 users
        if (current % 10 === 0) {
          console.log(`📊 [Backfill] Progress: ${current}/${total} users processed`);
        }
      } catch (error) {
        console.error(`❌ [Backfill] Error processing user ${userId}:`, error);
        errors++;
      }
    }

    console.log(`✅ [Backfill] Completed! Processed: ${processed}, Errors: ${errors}`);
    
    // ✅ Log summary statistics
    if (processed > 0) {
      const summaryQuery = query(
        collection(firestoreDB, 'user_ratings_summary'),
        orderBy('count', 'desc'),
        limit(10)
      );
      const topUsers = await getDocs(summaryQuery);
      console.log('📊 [Backfill] Top 10 users by review count:');
      topUsers.docs.forEach((doc, index) => {
        const data = doc.data();
        console.log(`   ${index + 1}. User ${doc.id}: ${data.count} reviews, avg ${data.averageRating}`);
      });
    }
    
    return { success: true, processed, errors };
  } catch (error) {
    console.error('❌ [Backfill] Fatal error:', error);
    return { success: false, processed: 0, errors: 0 };
  }
};

/**
 * Diagnostic function to check review counts
 * Helps debug why leaderboard shows low numbers
 * 
 * @param {Object} firestoreDB - Firestore database instance
 * @returns {Promise<void>}
 */
export const diagnoseReviewCounts = async (firestoreDB) => {
  if (!firestoreDB) {
    console.error('❌ diagnoseReviewCounts: Missing firestoreDB');
    return;
  }

  try {
    console.log('🔍 [Diagnostic] Checking review counts...');
    
    // Get all reviews
    const reviewsQuery = query(collection(firestoreDB, 'reviews'));
    const reviewsSnapshot = await getDocs(reviewsQuery);
    
    console.log(`📊 [Diagnostic] Total reviews in Firestore: ${reviewsSnapshot.size}`);
    
    // Count by toUserId
    const userCounts = new Map();
    let reviewsWithRating = 0;
    let reviewsWithoutRating = 0;
    
    reviewsSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const toUserId = data.toUserId;
      const rating = data.rating;
      
      if (rating && typeof rating === 'number' && rating > 0) {
        reviewsWithRating++;
      } else {
        reviewsWithoutRating++;
      }
      
      if (toUserId) {
        userCounts.set(toUserId, (userCounts.get(toUserId) || 0) + 1);
      }
    });
    
    console.log(`📊 [Diagnostic] Reviews with valid rating: ${reviewsWithRating}`);
    console.log(`📊 [Diagnostic] Reviews without valid rating: ${reviewsWithoutRating}`);
    console.log(`📊 [Diagnostic] Unique users with reviews: ${userCounts.size}`);
    
    // Show top 10 users
    const sortedUsers = Array.from(userCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    console.log('📊 [Diagnostic] Top 10 users by review count:');
    sortedUsers.forEach(([userId, count], index) => {
      console.log(`   ${index + 1}. User ${userId}: ${count} reviews`);
    });
    
    // Check summary collection
    const summaryQuery = query(
      collection(firestoreDB, 'user_ratings_summary'),
      orderBy('count', 'desc'),
      limit(10)
    );
    const summarySnapshot = await getDocs(summaryQuery);
    
    console.log(`📊 [Diagnostic] Users in summary collection: ${summarySnapshot.size}`);
    if (!summarySnapshot.empty) {
      console.log('📊 [Diagnostic] Top users in summary collection:');
      summarySnapshot.docs.forEach((doc, index) => {
        const data = doc.data();
        console.log(`   ${index + 1}. User ${doc.id}: ${data.count} reviews, avg ${data.averageRating}`);
      });
    }
  } catch (error) {
    console.error('❌ [Diagnostic] Error:', error);
  }
};

