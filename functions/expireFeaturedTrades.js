/**
 * Cloud Function: Return expired boosted trades to the normal feed
 *
 * Runs hourly. Finds trades whose boost has elapsed (`isFeatured` is still
 * true but `featuredUntil` is in the past) and flips `isFeatured` back to
 * false.
 *
 * WHY THIS EXISTS
 * Boosting sets isFeatured=true and featuredUntil=+12h, but nothing ever set
 * isFeatured back. The feed runs two queries:
 *
 *   featured  →  isFeatured == true  AND featuredUntil > now
 *   normal    →  isFeatured == false
 *
 * Once featuredUntil passes, an expired trade matches NEITHER — it is no
 * longer featured, but it is not "normal" either. It disappeared from the app
 * completely and stayed invisible until cleanupOldTrades deleted it at 7 days.
 *
 * So boosting actively COST the owner visibility: 12 hours at the top, then
 * roughly six days of being invisible, versus seven normal days if they had
 * never boosted at all. With the rewarded-ad boost pushing far more trades
 * through this path, that goes from rare to routine.
 *
 * Hourly rather than daily: a trade should rejoin the feed shortly after its
 * boost ends, not at the next nightly sweep. The query is indexed and matches
 * only the handful of trades that expired in the last hour, so the read cost
 * is negligible.
 *
 * INDEX
 * Served by the existing composite (isFeatured ASC, featuredUntil DESC) in
 * firestore.indexes.json — Firestore uses a composite index in either
 * direction, so no new index is needed. Verified 2026-09-16 against this app's firestore.indexes.json.
 *
 * Deployment:
 * firebase deploy --only functions:expireFeaturedTrades
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const BATCH_SIZE = 400;

exports.expireFeaturedTrades = functions
  .runWith({ memory: '256MB', timeoutSeconds: 180 })
  .pubsub.schedule('every 1 hours')
  .timeZone('UTC')
  .onRun(async () => {
    const firestore = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    let totalExpired = 0;

    try {
      let hasMore = true;

      while (hasMore) {
        // Only trades still flagged featured whose window has already closed.
        // Re-queried each pass because the previous batch's writes remove those
        // documents from this result set.
        const snapshot = await firestore.collection('trades_new_upgrade')
          .where('isFeatured', '==', true)
          .where('featuredUntil', '<=', now)
          .limit(BATCH_SIZE)
          .get();

        if (snapshot.empty) {
          hasMore = false;
          break;
        }

        const batch = firestore.batch();
        for (const doc of snapshot.docs) {
          // featuredUntil is deliberately LEFT IN PLACE. The per-user boost
          // limit counts recent boosts by reading it, so clearing it would
          // hand everyone their daily allowance back the moment a boost ended.
          batch.update(doc.ref, { isFeatured: false });
        }
        await batch.commit();

        totalExpired += snapshot.size;
        if (snapshot.size < BATCH_SIZE) hasMore = false;
      }
    } catch (error) {
      if (error.code === 'failed-precondition') {
        console.error(
          '❌ expireFeaturedTrades needs a composite index on ' +
          '(isFeatured, featuredUntil). Create it from the link in this error:',
          error.message,
        );
      } else {
        console.error('❌ Error in expireFeaturedTrades:', error);
      }
    }

    console.log(`⭐ Feature expiry complete. Returned to normal feed: ${totalExpired}`);
    return null;
  });
