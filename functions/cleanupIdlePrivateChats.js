/**
 * Idle private-chat cleanup on RTDB (2026-10-29).
 *
 * Message bodies and the inbox live in Supabase since the chat cutover and
 * are purged there at 30 days (026, 051). RTDB private_messages/{chatKey}
 * still holds per-room leftovers that nothing ever deleted:
 *   trade      the trade card shown at the top of the DM (PrivateChat.jsx)
 *   lastRead   {uid: ms} seen receipts (ChatScreen/utils.js)
 *   unread     {uid: 0} reset on chat open (setActiveChat)
 *   messages   pre-cutover bodies, write:false since the rules lockdown
 * On 2026-10-29 that was 1.59M rooms / ~890 MB of a 1.2 GB database, ~85% of
 * the rooms with no activity for 30+ days.
 *
 * A room's last activity is the newest of lastRead/*, trade.timestamp and
 * messages/*\/timestamp. Rooms idle for longer than MAX_IDLE_MS are removed
 * whole; a room with no timestamp at all only holds unread counters (reset on
 * the next open), so it goes too. Paths and rules are unchanged: an old build
 * that opens a dead room just finds no trade card.
 *
 *   cleanupIdlePrivateChats   weekly, Sunday 04:00 UTC
 *
 * No function triggers on private_messages, so deletes fire nothing.
 * Dry run (counts in the log) unless Firestore server_config/contentCleanup
 * has apply: true (shared with cleanupOldContent.js). Each run stops after
 * TIME_BUDGET_MS; the next run carries on from the start.
 *
 * One-off backlog run with a local backup: scripts/rtdb-cleanup/prune-idle-private-chats.js
 *
 * Deploy:
 *   firebase deploy --only functions:cleanupIdlePrivateChats --project fruiteblocks
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) admin.initializeApp();

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_IDLE_MS = 30 * DAY_MS;
const PAGE = 1000;
const TIME_BUDGET_MS = 420 * 1000; // of the 540 s timeout

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function lastActivity(room) {
  if (!room || typeof room !== 'object') return 0;
  let best = 0;
  const lastRead = room.lastRead;
  if (lastRead && typeof lastRead === 'object') {
    for (const v of Object.values(lastRead)) best = Math.max(best, num(v));
  }
  if (room.trade && typeof room.trade === 'object') best = Math.max(best, num(room.trade.timestamp));
  const messages = room.messages;
  if (messages && typeof messages === 'object') {
    for (const m of Object.values(messages)) {
      if (m && typeof m === 'object') best = Math.max(best, num(m.timestamp));
    }
  }
  return best;
}

/**
 * Pages through private_messages by key and removes idle rooms.
 * opts.onDoomed(entries) runs before each page's delete (the one-off script
 * writes its backup there); a throw stops the run before anything is removed.
 */
async function pruneIdlePrivateChats(rtdb, opts = {}) {
  const now = opts.now ?? Date.now;
  const started = now();
  const cutoff = started - (opts.maxIdleMs ?? MAX_IDLE_MS);
  const apply = opts.apply === true;
  const deadline = started + (opts.timeBudgetMs ?? TIME_BUDGET_MS);
  const pageSize = opts.pageSize ?? PAGE;
  const ref = rtdb.ref('private_messages');
  const report = { mode: apply ? 'apply' : 'dry_run', cutoff: new Date(cutoff).toISOString(), scanned: 0, idle: 0, deleted: 0, bytesIdle: 0, pages: 0, stoppedEarly: false };

  let last = opts.startAfter ?? null;
  for (;;) {
    if (now() >= deadline) { report.stoppedEarly = true; break; }
    let q = ref.orderByKey();
    if (last !== null) q = q.startAfter(last);
    const snap = await q.limitToFirst(pageSize).get();
    const page = [];
    snap.forEach((c) => { page.push([c.key, c.val()]); });
    // startAfter returns limit - 1 rows in the admin SDK, so only an empty
    // page means the end.
    if (!page.length) break;
    last = page[page.length - 1][0];

    const doomed = page.filter(([, v]) => lastActivity(v) < cutoff);
    report.scanned += page.length;
    report.idle += doomed.length;
    report.bytesIdle += doomed.reduce((n, [, v]) => n + JSON.stringify(v).length, 0);
    if (apply && doomed.length) {
      if (opts.onDoomed) await opts.onDoomed(doomed);
      const updates = {};
      doomed.forEach(([k]) => { updates[k] = null; });
      await ref.update(updates);
      report.deleted += doomed.length;
    }
    report.pages += 1;
    if (opts.onPage) await opts.onPage({ last, ...report });
    if (report.pages % 50 === 0) console.log('[cleanupIdlePrivateChats] progress', JSON.stringify({ last, ...report }));
  }
  report.last = last;
  report.ms = now() - started;
  return report;
}

exports.cleanupIdlePrivateChats = functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .pubsub.schedule('every sunday 04:00')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      const cfg = await admin.firestore().collection('server_config').doc('contentCleanup').get();
      const report = await pruneIdlePrivateChats(admin.database(), { apply: cfg.get('apply') === true });
      console.log('[cleanupIdlePrivateChats]', JSON.stringify(report));
    } catch (err) {
      console.error('[cleanupIdlePrivateChats] failed', err);
    }
    return null;
  });

exports.pruneIdlePrivateChats = pruneIdlePrivateChats;
exports.lastActivity = lastActivity;
exports.MAX_IDLE_MS = MAX_IDLE_MS;
