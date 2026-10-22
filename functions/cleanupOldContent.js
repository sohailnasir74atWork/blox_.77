/**
 * Old-content cleanup (ported from Adopt Me's cleanupExpiredStatuses,
 * cleanupOldTrades and cleanupOldPosts, 2026-10-22).
 *
 * Blox never deleted anything: on 2026-10-22 it held 916k legacy trades_new,
 * 491k trades_new_upgrade older than 7 days, 60k posts older than 7 days and
 * 25k expired statuses (Adopt Me holds ~2.6k of all of these). The app never
 * shows them in a feed (feeds filter on age), only in profile history.
 *
 *   cleanupExpiredStatuses  every 30 min    statuses            expiresAt < now
 *   cleanupOldTrades        every 6 hours   trades_new_upgrade,  timestamp < now - 7 d
 *                                           trades_new (old builds) + RTDB tradeAcceptors/{id}
 *   cleanupOldPosts         daily 06:00 UTC designPosts_upgrade, createdAt < now - 7 d
 *                                           designPosts (old builds), with their comments
 *
 * Kept: anything an unreviewed user_reports / user_reports_restricted doc
 * points at (mods need the evidence; ReportsTab treats a missing status as
 * open), and trades still featured. Post images on Bunny are not deleted.
 * Every function on these collections is onCreate, so deletes trigger nothing.
 *
 * Dry run (counts + sample ids in the log) until Firestore
 * server_config/contentCleanup has apply: true. Each run stops after
 * MAX_DELETE_PER_RUN docs or TIME_BUDGET_MS (≈300 deletes/s at most), so the
 * 1.5M backlog drains over several runs instead of one long, failing run.
 * Trades run every 6 hours (1.4M backlog ≈ 4 days); `deleted` in the report
 * counts every successful delete, comments included.
 *
 * Deploy:
 *   firebase deploy --only functions:cleanupExpiredStatuses,functions:cleanupOldTrades,functions:cleanupOldPosts --project fruiteblocks
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) admin.initializeApp();

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 500;
const MAX_DELETE_PER_RUN = 150000;
const TIME_BUDGET_MS = 300 * 1000; // of the 540 s timeout (close + RTDB get grace after it)
const MAX_WRITE_ATTEMPTS = 3;

const JOBS = {
  statuses: { collections: ['statuses'], field: 'expiresAt', maxAgeMs: 0 },
  trades: {
    collections: ['trades_new_upgrade', 'trades_new'],
    field: 'timestamp',
    maxAgeMs: 7 * DAY_MS,
    extraFields: ['featuredUntil'],
    rtdbPaths: (id) => [`tradeAcceptors/${id}`],
  },
  posts: { collections: ['designPosts_upgrade', 'designPosts'], field: 'createdAt', maxAgeMs: 7 * DAY_MS, recursive: true },
};

const millis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : Number(v) || 0);

// Ids that an unreviewed report points at. Small collections (46 docs on
// 2026-10-22), so a full read per run is cheap.
async function reportedTargets(db) {
  const out = new Set();
  for (const col of ['user_reports', 'user_reports_restricted']) {
    const snap = await db.collection(col).select('targetId', 'status').get();
    snap.forEach((d) => {
      const id = d.get('targetId');
      if (typeof id === 'string' && id && d.get('status') !== 'reviewed') out.add(id);
    });
  }
  return out;
}

async function runCleanup(jobName, deps, opts = {}) {
  const job = JOBS[jobName];
  const { db, rtdb, now = () => Date.now() } = deps;
  const started = now();
  const apply = opts.apply ?? ((await db.collection('server_config').doc('contentCleanup').get()).get('apply') === true);
  const maxDelete = opts.maxDelete ?? MAX_DELETE_PER_RUN;
  const timeBudget = opts.timeBudgetMs ?? TIME_BUDGET_MS;
  const cutoff = admin.firestore.Timestamp.fromMillis(started - job.maxAgeMs);
  const keep = await reportedTargets(db);
  const report = { job: jobName, mode: apply ? 'apply' : 'dry_run', cutoff: cutoff.toDate().toISOString(), protectedIds: keep.size, collections: {} };

  if (!apply) {
    for (const col of job.collections) {
      const base = db.collection(col).where(job.field, '<', cutoff);
      const count = (await base.count().get()).data().count;
      const sample = (await base.select(job.field).limit(10).get()).docs.map((d) => d.id);
      report.collections[col] = { wouldDelete: count, sample };
    }
    return report;
  }

  // One throttled BulkWriter for the whole run. The first apply run (2026-10-22)
  // deleted ~11k statuses in a minute, then writes trickled while the default
  // writer retried with long backoffs, and the run hit the 540 s timeout before
  // logging anything. So: a gentler rate, few retries, error codes in the
  // report, and a deadline that never waits on a write.
  const writer = db.bulkWriter({ throttling: { initialOpsPerSecond: 100, maxOpsPerSecond: 300 } });
  const errors = {};
  let deleted = 0;
  let failed = 0;
  writer.onWriteResult(() => { deleted += 1; });
  writer.onWriteError((err) => {
    if (err.failedAttempts < MAX_WRITE_ATTEMPTS) return true;
    failed += 1;
    errors[err.code] = (errors[err.code] || 0) + 1;
    return false;
  });
  const deadline = started + timeBudget;
  const TIMED_OUT = Symbol('timedOut');
  const beforeDeadline = (p, graceMs = 0) => Promise.race([
    p,
    new Promise((res) => setTimeout(() => res(TIMED_OUT), Math.max(0, deadline + graceMs - now()))),
  ]);

  let queued = 0;
  let stoppedEarly = false;
  let pages = 0;
  for (const col of job.collections) {
    const stats = { queued: 0, skipped: 0 };
    report.collections[col] = stats;
    let last = null;
    while (!stoppedEarly) {
      if (queued >= maxDelete || now() >= deadline) { stoppedEarly = true; break; }
      let q = db.collection(col).where(job.field, '<', cutoff).orderBy(job.field)
        .select(job.field, ...(job.extraFields || [])).limit(Math.min(PAGE, maxDelete - queued));
      if (last) q = q.startAfter(last);
      const snap = await beforeDeadline(q.get());
      if (snap === TIMED_OUT) { stoppedEarly = true; break; }
      if (snap.empty) break;
      last = snap.docs[snap.docs.length - 1];

      const doomed = snap.docs.filter((d) => {
        const featured = millis(d.get('featuredUntil')) > started;
        if (keep.has(d.id) || featured) { stats.skipped += 1; return false; }
        return true;
      });
      // recursiveDelete takes the comments subcollection with the post.
      const pending = job.recursive
        ? doomed.map((d) => db.recursiveDelete(d.ref, writer))
        : doomed.map((d) => writer.delete(d.ref).catch(() => {}));
      // A part-filled batch is only sent on flush.
      pending.push(writer.flush());
      if (await beforeDeadline(Promise.allSettled(pending)) === TIMED_OUT) stoppedEarly = true;
      if (job.rtdbPaths && rtdb && doomed.length) {
        const updates = {};
        doomed.forEach((d) => job.rtdbPaths(d.id).forEach((p) => { updates[p] = null; }));
        await beforeDeadline(rtdb.ref().update(updates), 30000);
      }
      stats.queued += doomed.length;
      queued += doomed.length;
      pages += 1;
      if (pages % 20 === 0) console.log(`[cleanup:${jobName}] progress`, JSON.stringify({ col, queued, deleted, failed, s: Math.round((now() - started) / 1000) }));
      if (snap.size < PAGE) break;
    }
  }
  if (queued >= maxDelete) stoppedEarly = true;
  if (await beforeDeadline(writer.close(), 60000) === TIMED_OUT) report.closeTimedOut = true;
  Object.assign(report, { queued, deleted, failed, errors, stoppedEarly, ms: now() - started });
  return report;
}

const defaultDeps = () => ({ db: admin.firestore(), rtdb: admin.database() });

const scheduled = (jobName, schedule) => functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .pubsub.schedule(schedule)
  .timeZone('UTC')
  .onRun(async () => {
    try {
      const report = await runCleanup(jobName, defaultDeps());
      console.log(`[cleanup:${jobName}]`, JSON.stringify(report));
    } catch (err) {
      console.error(`[cleanup:${jobName}] failed`, err);
    }
    return null;
  });

exports.cleanupExpiredStatuses = scheduled('statuses', 'every 30 minutes');
exports.cleanupOldTrades = scheduled('trades', 'every 6 hours');
exports.cleanupOldPosts = scheduled('posts', 'every day 06:00');
exports.runCleanup = runCleanup;
exports.JOBS = JOBS;
