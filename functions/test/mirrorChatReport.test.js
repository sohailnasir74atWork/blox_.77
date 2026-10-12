/* eslint-disable no-console */
/**
 * functions/mirrorChatReport.js: toRow + reconcile, against in-memory fakes
 * (no emulator, no network). From the Blox_Fruit directory:
 *   node functions/test/mirrorChatReport.test.js
 */
const assert = require('assert');
const { toRow, reconcile } = require('../mirrorChatReport')._internal;

const A = 'uidAAAAAAAAAAAAAAAAAAAAAAAA1';
const B = 'uidBBBBBBBBBBBBBBBBBBBBBBBB2';
const C = 'uidCCCCCCCCCCCCCCCCCCCCCCCC3';
const key = (x, y) => [x, y].sort().join('_');

// Firestore: collection(name).select(...).get() → forEach over { id, data() }.
const fakeFirestore = (docs) => ({
  collection: () => ({
    select: () => ({
      get: async () => ({
        size: Object.keys(docs).length,
        forEach: (fn) => Object.entries(docs).forEach(([id, d]) => fn({ id, data: () => d })),
      }),
    }),
  }),
});

// Supabase: just the calls reconcile makes, on one table.
const fakeSupabase = (initial) => {
  const table = new Map(initial.map((r) => [r.report_id, r]));
  return {
    table,
    from: () => ({
      select: () => ({
        order: () => ({
          range: async (from, to) => ({
            data: [...table.keys()].sort().slice(from, to + 1).map((report_id) => ({ report_id })),
            error: null,
          }),
        }),
      }),
      upsert: async (rows) => { rows.forEach((r) => table.set(r.report_id, r)); return { error: null }; },
      delete: () => ({ in: async (_col, ids) => { ids.forEach((id) => table.delete(id)); return { error: null }; } }),
    }),
  };
};

(async () => {
  // toRow
  assert.deepStrictEqual(
    (({ created_at, ...r }) => r)(toRow('r1', { chatKey: key(A, B), reportedBy: A })),
    { report_id: 'r1', chat_id: key(A, B), reporter_uid: A, reported_uid: B },
  );
  assert.strictEqual(toRow('r2', { chatKey: key(A, B), reportedBy: C }), null, 'reporter not in chat');
  assert.strictEqual(toRow('r3', { chatKey: 'nounderscore', reportedBy: A }), null, 'bad chatKey');
  assert.strictEqual(toRow('r4', { reportedBy: A }), null, 'no chatKey');

  // reconcile: mirrors missing reports, rewrites a drifted row, drops reports that are gone.
  const fs = fakeFirestore({
    r1: { chatKey: key(A, B), reportedBy: A },
    r2: { chatKey: key(B, C), reportedBy: C },
    bad: { chatKey: key(A, B), reportedBy: C },
  });
  const sb = fakeSupabase([
    { report_id: 'r2', chat_id: key(A, C), reporter_uid: C, reported_uid: A }, // drifted
    { report_id: 'gone', chat_id: key(A, C), reporter_uid: A, reported_uid: C },
  ]);
  const res = await reconcile(fs, sb);
  assert.deepStrictEqual(res, { reports: 3, mirrored: 2, removed: 1 });
  assert.deepStrictEqual([...sb.table.keys()].sort(), ['r1', 'r2']);
  assert.strictEqual(sb.table.get('r2').chat_id, key(B, C));

  // Paging past PostgREST's 1000-row cap: 2500 stale rows all go.
  const many = Array.from({ length: 2500 }, (_, i) => ({ report_id: `old${String(i).padStart(4, '0')}` }));
  const sb2 = fakeSupabase(many);
  const res2 = await reconcile(fakeFirestore({}), sb2);
  assert.deepStrictEqual(res2, { reports: 0, mirrored: 0, removed: 2500 });
  assert.strictEqual(sb2.table.size, 0);

  console.log('mirrorChatReport: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
