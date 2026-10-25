// Account deletion also removes Fruit Cards rows (supabase/057 delete_user_cards).
//   node --test functions/test/deleteUserCards.test.js
const test = require('node:test');
const assert = require('node:assert');

process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG
  || JSON.stringify({ projectId: 'demo-fruiteblocks', databaseURL: 'https://demo-fruiteblocks-default-rtdb.firebaseio.com' });
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-fruiteblocks';
const { deleteAllForUser } = require('../mirrorUsersToSupabase')._internal;

// A fake supabase client that records every call.
function fakeSupabase(rpcError = null) {
  const calls = { deletes: [], rpc: [] };
  const query = (table) => ({
    delete: () => ({ eq: async (col, uid) => { calls.deletes.push([table, uid]); return { error: null }; } }),
  });
  return {
    calls,
    from: query,
    rpc: async (fn, args) => { calls.rpc.push([fn, args]); return { error: rpcError }; },
  };
}

test('deleting an account calls delete_user_cards with the uid', async () => {
  const sb = fakeSupabase();
  await deleteAllForUser('u1', sb);
  assert.deepStrictEqual(sb.calls.rpc, [['delete_user_cards', { p_uid: 'u1' }]]);
  assert.ok(sb.calls.deletes.some(([t, uid]) => t === 'user_cosmetics' && uid === 'u1'), 'cosmetics row still deleted');
});

test('a missing delete_user_cards (057 not applied) is not logged as an error', async () => {
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    await deleteAllForUser('u2', fakeSupabase({ code: 'PGRST202', message: 'Could not find the function' }));
    assert.strictEqual(errors.filter((e) => e.includes('delete cards')).length, 0);
    await deleteAllForUser('u3', fakeSupabase({ code: '500', message: 'boom' }));
    assert.strictEqual(errors.filter((e) => e.includes('delete cards')).length, 1);
  } finally {
    console.error = orig;
  }
});

test.after(() => setImmediate(() => process.exit(0)));   // firebase-admin keeps handles open
