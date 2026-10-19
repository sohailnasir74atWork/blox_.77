/**
 * functions/notifyGroupNewMessage.js handleGroupPush against in-memory fakes
 * (no emulator, no network). From the Blox_Fruit directory:
 *   node functions/test/notifyGroupPush.test.js
 */
const assert = require('assert');
const { handleGroupPush } = require('../notifyGroupNewMessage')._internal;
const MIN = 60_000;

const G = 'group_1_test';
const S = 'senderUid000', A = 'memberAUid00', B = 'memberBUid00', M = 'mutedUid0000';
const V = 'viewingUid00', X = 'selfAddedUid';

// RTDB: a nested object; update() understands 'a/b' keys and increment().
function fakeRtdb(store) {
  const reads = [];
  const get = (path) => path.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), store);
  const set = (path, value) => {
    const keys = path.split('/').filter(Boolean);
    let o = store;
    for (const k of keys.slice(0, -1)) o = (o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {});
    const last = keys[keys.length - 1];
    o[last] = value && value.__inc ? (Number(o[last]) || 0) + value.__inc : value;
  };
  return {
    reads,
    increment: (n) => ({ __inc: n }),
    ref: (path) => ({
      once: async () => { reads.push(path); return { val: () => get(path) ?? null }; },
      update: async (obj) => { for (const [k, v] of Object.entries(obj)) set(`${path}/${k}`, v); },
    }),
  };
}

function fakeSupabase(tables) {
  return {
    from: (table) => {
      const filters = [];
      const b = {
        select: () => b,
        eq: (c, v) => { filters.push((r) => r[c] === v); return b; },
        in: (c, v) => { filters.push((r) => v.includes(r[c])); return b; },
        then: (res, rej) => Promise.resolve({ data: (tables[table] || []).filter((r) => filters.every((f) => f(r))), error: null }).then(res, rej),
      };
      return b;
    },
  };
}

(async () => {
  const groups = { [G]: { memberIds: [S, A, B, M, V, X], createdBy: S, isActive: true } };
  const firestore = { doc: (p) => ({ get: async () => { const id = p.split('/')[1]; return { exists: !!groups[id], data: () => groups[id] }; } }) };
  const store = {
    users: { [A]: { fcmToken: 'tokA' }, [B]: { fcmToken: 'tokB' }, [M]: { fcmToken: 'tokM' }, [V]: { fcmToken: 'tokV' }, [X]: { fcmToken: 'tokX' } },
    activeGroupChats: { [G]: { [V]: true } },
  };
  const rtdb = fakeRtdb(store);
  const tables = {
    group_members: [S, A, B, M, V].map((u) => ({ group_id: G, user_id: u, role: u === S ? 'creator' : 'member' })),
    group_meta_data: [{ group_id: G, user_id: M, muted: true, group_name: 'Traders' }, { group_id: G, user_id: A, muted: false, group_name: 'Traders' }],
  };
  const sent = [];
  const messaging = {
    sendEach: async (msgs) => {
      sent.push(...msgs);
      return { responses: msgs.map((m) => (m.token === 'bad' ? { success: false, error: { code: 'messaging/registration-token-not-registered' } } : { success: true })) };
    },
  };
  const cache = new Map();
  const deps = (now) => ({ firestore, rtdb, supabase: fakeSupabase(tables), messaging, now, cache });
  const tokenReads = () => rtdb.reads.filter((p) => p.endsWith('/fcmToken')).length;
  const rec = (text, id) => ({ group_id: G, sender_id: S, sender_name: 'Sam', text, id });

  const t0 = 1_800_000_000_000;
  let r = await handleGroupPush(rec('hey', 'm1'), deps(t0));
  assert.strictEqual(r, 'OK: 2 sent');
  assert.deepStrictEqual(sent.map((m) => m.token).sort(), ['tokA', 'tokB'], 'muted, viewing and self-added members get nothing');
  assert.strictEqual(sent[0].notification.title, 'Sam • Traders');
  assert.strictEqual(sent[0].notification.body, 'hey');
  assert.strictEqual(sent[0].android.notification.tag, `group_${G}`, 'Android replaces the group notification');
  assert.strictEqual(sent[0].apns.headers['apns-collapse-id'], G, 'iOS replaces it too');
  assert.strictEqual(tokenReads(), 2, 'tokens read only for people being pushed');

  // A burst: every message pushes (the last one must arrive), no new token reads.
  sent.length = 0;
  await handleGroupPush(rec('trade now?', 'm2'), deps(t0 + 30_000));
  await handleGroupPush(rec('last call', 'm3'), deps(t0 + 60_000));
  assert.strictEqual(sent.length, 4, 'each message in a burst pushes');
  assert.strictEqual(sent[sent.length - 1].notification.body, 'last call', 'the last message of a burst arrives');
  assert.strictEqual(tokenReads(), 2, 'cached tokens: no new reads');
  assert.strictEqual(store.group_push_state, undefined, 'no per-member push state kept');

  // A token the server rejects is dropped from the cache and read again.
  store.users[B].fcmToken = 'bad';
  cache.set(B, { token: 'bad', at: t0 + MIN });
  await handleGroupPush(rec('fifth', 'm5'), deps(t0 + 2 * MIN));
  assert.ok(!cache.has(B), 'rejected token evicted');
  store.users[B].fcmToken = 'tokB2';
  await handleGroupPush(rec('sixth', 'm6'), deps(t0 + 3 * MIN));
  assert.ok(sent.some((m) => m.token === 'tokB2'), 'fresh token used next time');

  // Not synced yet (no creator row in group_members): memberIds as before.
  tables.group_members = [];
  sent.length = 0;
  cache.clear();
  await handleGroupPush(rec('pre-044', 'm7'), deps(t0 + 10 * MIN));
  assert.ok(sent.some((m) => m.token === 'tokX'), 'unsynced group falls back to memberIds');

  assert.strictEqual(await handleGroupPush({ group_id: 'nope', sender_id: S }, deps(t0)), 'Skipped: group not found');
  console.log('notifyGroupPush: all checks passed');
})().catch((e) => {
  console.error('FAILED:', e && e.stack || e);
  process.exit(1);
});
