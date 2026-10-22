/**
 * buildStatusFeed — every 2 minutes, writes status_feed/global: the live
 * statuses (newest first, same window the app's global query reads) as ONE
 * doc, without their viewedBy lists (2026-10-22 cost fix).
 *
 * Before, every Home load read ~56 status docs (~4.8 KB each, mostly viewedBy
 * uid arrays). Builds from 2026-10 read this doc instead (1 read) and fall
 * back to the query when it is missing or older than 10 minutes, so a stopped
 * job degrades to the old cost, never to an empty feed. Old builds keep
 * querying statuses directly; nothing they read changes.
 *
 * Cost: 720 runs/day × ≤60 reads + 1 write.
 *
 * Deploy:
 *   firebase deploy --only functions:buildStatusFeed --project fruiteblocks
 * Firestore rules: status_feed is read-only for signed-in users.
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) admin.initializeApp();

const WINDOW = 60; // = GLOBAL_FETCH_LIMIT in Code/Design/StatusFeed.js
const DROPPED_FIELDS = new Set(['viewedBy', 'randomSeed']);

const toMillis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : null);

// One status doc → a plain, JSON-safe entry. Timestamps become *Ms numbers
// (the app turns them back into Timestamps); any other Timestamp field is
// converted the same way so nothing non-serialisable reaches the snapshot.
function toEntry(doc) {
  const out = { id: doc.id };
  for (const [k, v] of Object.entries(doc.data())) {
    if (DROPPED_FIELDS.has(k)) continue;
    const ms = toMillis(v);
    if (ms !== null) out[`${k}Ms`] = ms;
    else out[k] = v;
  }
  return out;
}

async function buildStatusFeedSnapshot(db, now = Date.now()) {
  const snap = await db.collection('statuses')
    .where('expiresAt', '>', admin.firestore.Timestamp.fromMillis(now))
    .orderBy('expiresAt', 'desc')
    .limit(WINDOW)
    .get();
  const statuses = snap.docs.map(toEntry);
  await db.collection('status_feed').doc('global').set({
    statuses,
    count: statuses.length,
    builtAt: admin.firestore.Timestamp.fromMillis(now),
  });
  return statuses.length;
}

exports.buildStatusFeed = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .pubsub.schedule('every 2 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      await buildStatusFeedSnapshot(admin.firestore());
    } catch (err) {
      console.error('[buildStatusFeed] failed', err);
    }
    return null;
  });

exports.buildStatusFeedSnapshot = buildStatusFeedSnapshot;
