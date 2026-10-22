/**
 * Emulator suite for functions/cleanupOldContent.js (runs the cleanup
 * in-process against the Firestore + RTDB emulators). Named *.emulator.js so
 * Jest does not pick it up. From the Blox_Fruit directory:
 *   JAVA_HOME=/opt/homebrew/opt/openjdk@24 firebase emulators:exec \
 *     --config functions/firebase.test.json --only database,firestore \
 *     --project demo-fruiteblocks 'node functions/test/cleanupOldContent.emulator.js'
 */
const assert = require('assert');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-fruiteblocks';
process.env.GCLOUD_PROJECT = PROJECT;

const admin = require('firebase-admin');
admin.initializeApp({ projectId: PROJECT, databaseURL: `http://127.0.0.1:9000?ns=${PROJECT}` });
const db = admin.firestore();
const rtdb = admin.database();
const { runCleanup } = require('../cleanupOldContent');

const { Timestamp } = admin.firestore;
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => Timestamp.fromMillis(Date.now() - ms);
const deps = { db, rtdb };
const exists = async (path) => (await db.doc(path).get()).exists;

let pass = 0;
async function test(name, fn) {
  await fn();
  pass++;
  console.log('ok -', name);
}

async function seed() {
  const b = db.batch();
  b.set(db.doc('statuses/s_expired'), { expiresAt: ago(DAY) });
  b.set(db.doc('statuses/s_live'), { expiresAt: ago(-DAY) });
  b.set(db.doc('statuses/s_reported'), { expiresAt: ago(DAY) });
  b.set(db.doc('trades_new_upgrade/t_old'), { timestamp: ago(8 * DAY) });
  b.set(db.doc('trades_new_upgrade/t_new'), { timestamp: ago(DAY) });
  b.set(db.doc('trades_new_upgrade/t_reported'), { timestamp: ago(9 * DAY) });
  b.set(db.doc('trades_new_upgrade/t_featured'), { timestamp: ago(8 * DAY), featuredUntil: ago(-DAY) });
  b.set(db.doc('trades_new/tl_old'), { timestamp: ago(30 * DAY) });
  b.set(db.doc('designPosts_upgrade/p_old'), { createdAt: ago(8 * DAY) });
  b.set(db.doc('designPosts_upgrade/p_old/comments/c1'), { text: 'hi' });
  b.set(db.doc('designPosts_upgrade/p_new'), { createdAt: ago(DAY) });
  b.set(db.doc('designPosts_upgrade/p_reported'), { createdAt: ago(8 * DAY) });
  b.set(db.doc('designPosts/pl_old'), { createdAt: ago(20 * DAY) });
  // ReportsTab treats a missing status as open, so only 'reviewed' releases a target.
  b.set(db.doc('user_reports/r1'), { type: 'status', targetId: 's_reported', status: 'open' });
  b.set(db.doc('user_reports/r2'), { type: 'trade', targetId: 't_reported' });
  b.set(db.doc('user_reports_restricted/r3'), { type: 'post', targetId: 'p_reported', status: 'open' });
  b.set(db.doc('user_reports/r4'), { type: 'post', targetId: 'p_old', status: 'reviewed' });
  await b.commit();
  await rtdb.ref().update({ 'tradeAcceptors/t_old/u1': true, 'tradeAcceptors/tl_old/u1': true, 'tradeAcceptors/t_new/u1': true });
}

(async () => {
  await seed();

  await test('dry run by default: counts only, nothing deleted', async () => {
    const r = await runCleanup('trades', deps);
    assert.strictEqual(r.mode, 'dry_run');
    assert.strictEqual(r.collections.trades_new_upgrade.wouldDelete, 3);
    assert.strictEqual(r.collections.trades_new.wouldDelete, 1);
    assert.ok(await exists('trades_new_upgrade/t_old'));
  });

  await test('cap: maxDelete 1 stops early after one delete', async () => {
    const r = await runCleanup('statuses', deps, { apply: true, maxDelete: 1 });
    assert.strictEqual(r.deleted, 1);
    assert.strictEqual(r.stoppedEarly, true);
  });

  await test('statuses: expired deleted, live and reported kept', async () => {
    await runCleanup('statuses', deps, { apply: true });
    assert.ok(!(await exists('statuses/s_expired')));
    assert.ok(await exists('statuses/s_live'));
    assert.ok(await exists('statuses/s_reported'));
  });

  await test('trades: old deleted in both collections with acceptors; new, reported, featured kept', async () => {
    const r = await runCleanup('trades', deps, { apply: true });
    assert.strictEqual(r.deleted, 2);
    assert.ok(!(await exists('trades_new_upgrade/t_old')));
    assert.ok(!(await exists('trades_new/tl_old')));
    assert.ok(await exists('trades_new_upgrade/t_new'));
    assert.ok(await exists('trades_new_upgrade/t_reported'));
    assert.ok(await exists('trades_new_upgrade/t_featured'));
    assert.strictEqual((await rtdb.ref('tradeAcceptors/t_old').get()).exists(), false);
    assert.strictEqual((await rtdb.ref('tradeAcceptors/tl_old').get()).exists(), false);
    assert.strictEqual((await rtdb.ref('tradeAcceptors/t_new').get()).exists(), true);
  });

  await test('posts: server_config apply flag; old post goes with its comments, reported kept', async () => {
    await db.doc('server_config/contentCleanup').set({ apply: true });
    const r = await runCleanup('posts', deps);
    assert.strictEqual(r.mode, 'apply');
    assert.ok(!(await exists('designPosts_upgrade/p_old')));
    assert.ok(!(await exists('designPosts_upgrade/p_old/comments/c1')));
    assert.ok(!(await exists('designPosts/pl_old')));
    assert.ok(await exists('designPosts_upgrade/p_new'));
    assert.ok(await exists('designPosts_upgrade/p_reported'));
  });

  console.log(`\n${pass} passed`);
  process.exit(0);
})().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
