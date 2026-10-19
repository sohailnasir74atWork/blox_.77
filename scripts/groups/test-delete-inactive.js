/**
 * scripts/groups/delete-inactive-groups.js against the Firestore emulator and
 * an in-memory Supabase. From the Blox_Fruit directory:
 *   firebase emulators:exec --config functions/firebase.test.json --only firestore \
 *     --project demo-fruiteblocks 'node scripts/groups/test-delete-inactive.js'
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-fruiteblocks';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const { run, serviceRoleStore } = require('./delete-inactive-groups');

const NOW = Date.now();
const DAY = 864e5;
const ts = (daysAgo) => admin.firestore.Timestamp.fromMillis(NOW - daysAgo * DAY);
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

// group_messages / group_meta_data / group_members; rpc purge_group_chat
// answers "function missing" so the pre-044 fallback runs.
function fakeSupabase(tables) {
  const from = (name) => {
    let op = 'select'; let patch = null; const f = []; let range = null;
    const rows = () => tables[name].filter((r) => f.every((fn) => fn(r)));
    const exec = () => {
      if (op === 'select') {
        const out = rows().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id || '').localeCompare(String(b.id || '')));
        return { data: range ? out.slice(range[0], range[1] + 1) : out, error: null };
      }
      if (op === 'update') { rows().forEach((r) => Object.assign(r, patch)); return { error: null }; }
      const keep = new Set(rows()); tables[name] = tables[name].filter((r) => !keep.has(r)); return { error: null };
    };
    const b = {
      select: () => b,
      update: (p) => { op = 'update'; patch = p; return b; },
      delete: () => { op = 'delete'; return b; },
      eq: (c, v) => { f.push((r) => r[c] === v); return b; },
      gte: (c, v) => { f.push((r) => r[c] >= v); return b; },
      order: () => b,
      range: (x, y) => { range = [x, y]; return b; },
      then: (res, rej) => Promise.resolve(exec()).then(res, rej),
    };
    return b;
  };
  return { from, rpc: async () => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }) };
}

(async () => {
  const groups = {
    gActive: { name: 'Busy', createdAt: ts(300), memberIds: ['a', 'b'] },   // message 2 days ago → keep
    gEdge: { name: 'Edge', createdAt: ts(300), memberIds: ['a'] },          // message 14 days ago → keep
    gNew: { name: 'New', createdAt: ts(3), memberIds: ['a'] },              // no message, 3 days old → keep
    gQuiet: { name: 'Quiet', createdAt: ts(300), memberIds: ['a', 'b'] },   // last message 40 days ago → delete
    gNever: { name: 'Empty', createdAt: ts(30), memberIds: ['a'] },         // never a message, 30 days → delete
    gOld: { name: 'Ancient', memberIds: ['a'] },                            // no createdAt, no message → delete
  };
  for (const [id, g] of Object.entries(groups)) await db.collection('groups').doc(id).set(g);
  await db.collection('group_invitations').doc('i1').set({ groupId: 'gQuiet', invitedUserId: 'c', status: 'pending' });
  await db.collection('group_join_requests').doc('r1').set({ groupId: 'gQuiet', requesterId: 'd', status: 'pending' });
  await db.collection('group_invitations').doc('i2').set({ groupId: 'gActive', invitedUserId: 'c', status: 'pending' });
  let n = 0;
  const msg = (group, daysAgo) => ({ id: `m${++n}`, group_id: group, created_at: iso(daysAgo), deleted: false });
  const tables = {
    group_messages: [msg('gActive', 2), msg('gActive', 50), msg('gEdge', 14), msg('gQuiet', 40), msg('gQuiet', 90)],
    group_meta_data: [{ group_id: 'gQuiet', user_id: 'a' }, { group_id: 'gQuiet', user_id: 'b' }, { group_id: 'gActive', user_id: 'a' }],
    group_members: [{ group_id: 'gQuiet', user_id: 'a' }],
  };
  const store = serviceRoleStore(fakeSupabase(tables));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grp-del-'));

  const dry = await run({ db, store, now: NOW, backupDir, log: () => {} });
  assert.strictEqual(dry.mode, 'dry_run');
  assert.deepStrictEqual([dry.groups, dry.keepActive, dry.keepNew, dry.wouldDelete], [6, 2, 1, 3], JSON.stringify(dry));
  assert.ok((await db.collection('groups').doc('gQuiet').get()).exists, 'dry run deletes nothing');

  await assert.rejects(() => run({ db, store, now: NOW, apply: true, confirm: 2, backupDir, log: () => {} }), /refusing to delete/, 'wrong --confirm aborts');
  assert.ok((await db.collection('groups').doc('gQuiet').get()).exists, 'nothing deleted after a refused run');

  const res = await run({ db, store, now: NOW, apply: true, confirm: 3, backupDir, log: () => {} });
  assert.strictEqual(res.deleted, 3);
  assert.deepStrictEqual(res.failed, []);
  for (const id of ['gQuiet', 'gNever', 'gOld']) assert.ok(!(await db.collection('groups').doc(id).get()).exists, `${id} deleted`);
  for (const id of ['gActive', 'gEdge', 'gNew']) assert.ok((await db.collection('groups').doc(id).get()).exists, `${id} kept`);
  assert.ok(!(await db.collection('group_invitations').doc('i1').get()).exists, 'its invitation deleted');
  assert.ok(!(await db.collection('group_join_requests').doc('r1').get()).exists, 'its join request deleted');
  assert.ok((await db.collection('group_invitations').doc('i2').get()).exists, 'kept group keeps its invitations');
  assert.ok(tables.group_messages.filter((m) => m.group_id === 'gQuiet').every((m) => m.deleted), 'messages soft-deleted');
  assert.ok(tables.group_messages.filter((m) => m.group_id === 'gActive').every((m) => !m.deleted), 'kept group untouched');
  assert.ok(!tables.group_meta_data.some((r) => r.group_id === 'gQuiet'), 'every inbox row removed');
  assert.ok(tables.group_meta_data.some((r) => r.group_id === 'gActive'), 'kept group keeps its inbox rows');
  assert.ok(!tables.group_members.some((r) => r.group_id === 'gQuiet'), 'membership rows removed');
  const backup = JSON.parse(fs.readFileSync(res.backup, 'utf8'));
  assert.deepStrictEqual(backup.map((b) => b.id).sort(), ['gNever', 'gOld', 'gQuiet']);
  assert.strictEqual(backup.find((b) => b.id === 'gQuiet').joinDocs.length, 2, 'backup has the invitations / requests');
  assert.strictEqual(backup.find((b) => b.id === 'gQuiet').data.name, 'Quiet', 'backup has the group doc');
  assert.strictEqual(backup.find((b) => b.id === 'gQuiet').inboxRows.length, 2, 'backup has the inbox rows');

  const again = await run({ db, store, now: NOW, backupDir, log: () => {} });
  assert.strictEqual(again.wouldDelete, 0, 're-run: nothing left to delete');
  console.log('delete-inactive-groups: all checks passed');
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e && e.stack || e);
  process.exit(1);
});
