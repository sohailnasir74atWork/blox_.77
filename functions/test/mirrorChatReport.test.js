/* eslint-disable no-console */
/**
 * functions/mirrorChatReport.js: toRow + reconcile, against in-memory fakes
 * (no emulator, no network). From the Blox_Fruit directory:
 *   node functions/test/mirrorChatReport.test.js
 */
const assert = require('assert');
const { toRow, reconcile, mirrorWrite, onlyRoutingChanged } = require('../mirrorChatReport')._internal;

const A = 'uidAAAAAAAAAAAAAAAAAAAAAAAA1';
const B = 'uidBBBBBBBBBBBBBBBBBBBBBBBB2';
const C = 'uidCCCCCCCCCCCCCCCCCCCCCCCC3';
const key = (x, y) => [x, y].sort().join('_');

// Firestore: collection(name).select(...).get() → forEach over { id, data() };
// collection(name).doc(id).get() → { exists }. chat_reports = `docs`,
// chat_reports_restricted = `restricted`.
const fakeFirestore = (docs, restricted = {}) => ({
  collection: (name) => {
    const set = name === 'chat_reports_restricted' ? restricted : docs;
    return {
      select: () => ({
        get: async () => ({
          size: Object.keys(set).length,
          forEach: (fn) => Object.entries(set).forEach(([id, d]) => fn({ id, data: () => d })),
        }),
      }),
      doc: (id) => ({ get: async () => ({ exists: !!set[id] }) }),
    };
  },
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

  // Restricted (moved) reports are mirrored too and are not "stale".
  const fsR = fakeFirestore({ r1: { chatKey: key(A, B), reportedBy: A } }, { m1: { chatKey: key(A, C), reportedBy: A, viewers: [] } });
  const sbR = fakeSupabase([{ report_id: 'm1', chat_id: key(A, C), reporter_uid: A, reported_uid: C }]);
  assert.deepStrictEqual(await reconcile(fsR, sbR), { reports: 2, mirrored: 2, removed: 0 });
  assert.deepStrictEqual([...sbR.table.keys()].sort(), ['m1', 'r1']);
  assert.strictEqual(sb.table.get('r2').chat_id, key(B, C));

  // Paging past PostgREST's 1000-row cap: 2500 stale rows all go.
  const many = Array.from({ length: 2500 }, (_, i) => ({ report_id: `old${String(i).padStart(4, '0')}` }));
  const sb2 = fakeSupabase(many);
  const res2 = await reconcile(fakeFirestore({}), sb2);
  assert.deepStrictEqual(res2, { reports: 0, mirrored: 0, removed: 2500 });
  assert.strictEqual(sb2.table.size, 0);

  // mirrorWrite: a move (create in restricted + delete in chat_reports) keeps the row.
  const calls = [];
  const sbW = {
    from: () => ({
      delete: () => ({ eq: async (_c, id) => { calls.push(['delete', id]); return { error: null }; } }),
      upsert: async (row) => { calls.push(['upsert', row.report_id]); return { error: null }; },
    }),
  };
  const snap = (data) => (data ? { exists: true, data: () => data } : { exists: false, data: () => undefined });
  const doc = { chatKey: key(A, B), reportedBy: A, status: 'pending' };
  const movedFs = fakeFirestore({}, { x1: doc });
  assert.strictEqual(await mirrorWrite('chat_reports_restricted', 'x1', { before: snap(null), after: snap(doc) }, movedFs, sbW), 'upserted');
  assert.strictEqual(await mirrorWrite('chat_reports', 'x1', { before: snap(doc), after: snap(null) }, movedFs, sbW), 'moved');
  assert.strictEqual(await mirrorWrite('chat_reports', 'x2', { before: snap(doc), after: snap(null) }, fakeFirestore({}), sbW), 'deleted');
  assert.deepStrictEqual(calls, [['upsert', 'x1'], ['delete', 'x2']], 'the moved report keeps its reported_chats row');
  const restamp = { before: snap({ ...doc, viewers: ['a'] }), after: snap({ ...doc, viewers: ['a', 'b'], minRank: 3 }) };
  assert.strictEqual(await mirrorWrite('chat_reports_restricted', 'x1', restamp, movedFs, sbW), 'skipped', 'viewers re-stamp skipped');
  assert.strictEqual(onlyRoutingChanged(doc, { ...doc, status: 'reviewed' }), false);
  assert.strictEqual(onlyRoutingChanged(doc, { ...doc }), false, 'no change at all → mirror as before');

  console.log('mirrorChatReport: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
