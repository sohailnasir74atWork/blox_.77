/**
 * Emulator suite for functions/cleanupIdlePrivateChats.js (runs the prune
 * in-process against the RTDB emulator). Named *.emulator.js so Jest does not
 * pick it up. From the Blox_Fruit directory:
 *   JAVA_HOME=/opt/homebrew/opt/openjdk@24 firebase emulators:exec \
 *     --config functions/firebase.test.json --only database \
 *     --project demo-fruiteblocks 'node functions/test/cleanupIdlePrivateChats.emulator.js'
 */
const assert = require('assert');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-fruiteblocks';
process.env.GCLOUD_PROJECT = PROJECT;

const admin = require('firebase-admin');
admin.initializeApp({ projectId: PROJECT, databaseURL: `http://127.0.0.1:9000?ns=${PROJECT}` });
const rtdb = admin.database();
const { pruneIdlePrivateChats, lastActivity } = require('../cleanupIdlePrivateChats');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const ago = (d) => NOW - d * DAY;
const exists = async (p) => (await rtdb.ref(p).get()).exists();

let pass = 0;
async function test(name, fn) {
  await fn();
  pass++;
  console.log('ok -', name);
}

async function seed() {
  await rtdb.ref().set({
    private_messages: {
      a_b_recentRead: { lastRead: { a: ago(40), b: ago(2) }, trade: { timestamp: ago(60), id: 't1' }, unread: { a: 0 } },
      a_c_oldAll: { lastRead: { a: ago(45), c: ago(31) }, trade: { timestamp: ago(50) }, unread: { c: 0 } },
      a_d_newTrade: { trade: { timestamp: ago(1), id: 't2' } },
      a_e_unreadOnly: { unread: { a: 0, e: 0 } },
      a_f_recentMsg: { messages: { m1: { timestamp: ago(5), senderId: 'a' } } },
      a_g_oldMsg: { messages: { m1: { timestamp: ago(200), senderId: 'a' } }, lastRead: { g: 'bad' } },
    },
    users: { a: { displayName: 'A' } },
  });
}

(async () => {
  await test('lastActivity takes the newest of lastRead, trade, messages', async () => {
    assert.strictEqual(lastActivity({ lastRead: { a: 5, b: 9 }, trade: { timestamp: 7 } }), 9);
    assert.strictEqual(lastActivity({ messages: { x: { timestamp: 11 } }, trade: { timestamp: 3 } }), 11);
    assert.strictEqual(lastActivity({ unread: { a: 0 } }), 0);
    assert.strictEqual(lastActivity({ lastRead: { a: 'x' } }), 0);
    assert.strictEqual(lastActivity(null), 0);
  });

  await seed();

  await test('dry run counts idle rooms and deletes nothing', async () => {
    const r = await pruneIdlePrivateChats(rtdb, { apply: false, pageSize: 2, now: () => NOW });
    assert.strictEqual(r.scanned, 6);
    assert.strictEqual(r.idle, 3);
    assert.strictEqual(r.deleted, 0);
    assert.ok(await exists('private_messages/a_c_oldAll'));
  });

  await test('apply removes only rooms idle 30+ days, backup hook sees them first', async () => {
    const backedUp = [];
    const r = await pruneIdlePrivateChats(rtdb, {
      apply: true,
      pageSize: 2,
      now: () => NOW,
      onDoomed: async (entries) => {
        for (const [k] of entries) {
          assert.ok(await exists(`private_messages/${k}`), `${k} still there when backed up`);
          backedUp.push(k);
        }
      },
    });
    assert.strictEqual(r.deleted, 3);
    assert.deepStrictEqual(backedUp.sort(), ['a_c_oldAll', 'a_e_unreadOnly', 'a_g_oldMsg']);
    for (const k of ['a_b_recentRead', 'a_d_newTrade', 'a_f_recentMsg']) assert.ok(await exists(`private_messages/${k}`), k);
    for (const k of backedUp) assert.ok(!(await exists(`private_messages/${k}`)), k);
    assert.ok(await exists('users/a'), 'other nodes untouched');
  });

  await test('a failing backup stops the run before any delete', async () => {
    await rtdb.ref('private_messages/z_old').set({ lastRead: { z: ago(90) } });
    await assert.rejects(pruneIdlePrivateChats(rtdb, { apply: true, now: () => NOW, onDoomed: async () => { throw new Error('disk full'); } }));
    assert.ok(await exists('private_messages/z_old'));
  });

  await test('startAfter resumes after a key', async () => {
    const r = await pruneIdlePrivateChats(rtdb, { apply: false, startAfter: 'a_f_recentMsg', now: () => NOW });
    assert.strictEqual(r.scanned, 1);
    assert.strictEqual(r.idle, 1);
  });

  console.log(`\n${pass} passed`);
  process.exit(0);
})().catch((err) => { console.error('FAIL', err); process.exit(1); });
