// One-off (owner, 2026-10-19): delete every group with no message in the last
// 15 days and keep the active ones (~220 on 2026-10-19), plus any group created
// in the last 15 days. Works before supabase/044 and the group functions are
// deployed: it does the whole delete itself.
//
// Per deleted group: every message soft-deleted (deleted = true, recoverable),
// every member's group_meta_data row removed, group_members rows removed (if
// 044 is applied), its invitations and join requests deleted, the Firestore
// group doc deleted. A JSON backup of every group doc, invitation, join
// request and inbox row is written to ~/Downloads BEFORE anything is deleted.
//
//   SUPABASE_URL=https://jaimyhmanefvrijvjzxl.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role key> \
//   node scripts/groups/delete-inactive-groups.js                  # dry run: counts only
//   node scripts/groups/delete-inactive-groups.js --apply --confirm=<N>
//     N = the "would delete" number the dry run printed; anything else aborts.
//   Options: --days=15 (quiet window).
//
// Credentials: serviceAccount.json at the repo root, or GOOGLE_APPLICATION_CREDENTIALS.
// Safe to re-run: groups already gone are skipped.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;
const millis = (t) => (typeof t?.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null));
const rpcMissing = (e) => ['PGRST202', '42883'].includes(e?.code || '') || /could not find the function/i.test(e?.message || '');
const tableMissing = (e) => ['42P01', 'PGRST205'].includes(e?.code || '') || /does not exist|could not find the table/i.test(e?.message || '');

// Groups that had any message since `cutoffIso` (group_messages is indexed on
// (group_id, created_at); ~6k messages a week, so this is a few pages).
async function activeGroupIds(sb, cutoffIso) {
  const ids = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('group_messages').select('group_id')
      .gte('created_at', cutoffIso).order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data || []) ids.add(r.group_id);
    if (!data || data.length < 1000) break;
  }
  return ids;
}

async function plan({ db, sb, now, days }) {
  const cutoff = now - days * DAY_MS;
  const [snap, active] = await Promise.all([
    db.collection('groups').get(),
    activeGroupIds(sb, new Date(cutoff).toISOString()),
  ]);
  const keepActive = [];
  const keepNew = [];
  const remove = [];
  for (const d of snap.docs) {
    if (active.has(d.id)) keepActive.push(d);
    else if ((millis(d.get('createdAt')) || 0) >= cutoff) keepNew.push(d);
    else remove.push(d);
  }
  return { total: snap.size, keepActive, keepNew, remove, cutoff };
}

// Everything the server delete (purge_group_chat) does, with a fallback for
// before 044 is applied.
async function purgeChat(sb, groupId) {
  const { error } = await sb.rpc('purge_group_chat', { p_group_id: groupId });
  if (!error) return;
  if (!rpcMissing(error)) throw error;
  const r1 = await sb.from('group_messages')
    .update({ deleted: true, deleted_at: new Date().toISOString(), deleted_by: 'system:group_deleted' })
    .eq('group_id', groupId).eq('deleted', false);
  if (r1.error) throw r1.error;
  const r2 = await sb.from('group_meta_data').delete().eq('group_id', groupId);
  if (r2.error) throw r2.error;
  const r3 = await sb.from('group_members').delete().eq('group_id', groupId);
  if (r3.error && !tableMissing(r3.error)) throw r3.error;
}

async function joinDocs(db, groupId) {
  const [inv, req] = await Promise.all([
    db.collection('group_invitations').where('groupId', '==', groupId).get(),
    db.collection('group_join_requests').where('groupId', '==', groupId).get(),
  ]);
  return [...inv.docs, ...req.docs];
}

const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x.toMillis === 'function' ? { _ms: x.toMillis() } : x)));

// The backup holds player data (names, avatars, member ids): it goes to
// ~/Downloads (or the home folder), never into the repo.
const defaultBackupDir = () => {
  const dl = path.join(os.homedir(), 'Downloads');
  return fs.existsSync(dl) ? dl : os.homedir();
};

async function run({ db, sb, now = Date.now(), days = 15, apply = false, confirm = null, backupDir = defaultBackupDir(), log = console.log }) {
  const p = await plan({ db, sb, now, days });
  const report = {
    mode: apply ? 'apply' : 'dry_run',
    quietDays: days,
    groups: p.total,
    keepActive: p.keepActive.length,
    keepNew: p.keepNew.length,
    wouldDelete: p.remove.length,
    sample: p.remove.slice(0, 15).map((d) => `${d.id} "${String(d.get('name') || d.get('groupName') || '').slice(0, 40)}" (${(d.get('memberIds') || []).length} members)`),
  };
  if (!apply) return report;
  if (Number(confirm) !== p.remove.length) {
    throw new Error(`refusing to delete: --confirm=${confirm} but ${p.remove.length} groups would be deleted. Run the dry run again and pass that number.`);
  }

  // Backup first: every group doc + its invitations and join requests.
  const backup = [];
  for (const d of p.remove) {
    const extra = await joinDocs(db, d.id);
    const { data: meta, error } = await sb.from('group_meta_data').select('*').eq('group_id', d.id);
    if (error) throw error;
    backup.push({
      id: d.id,
      data: plain(d.data()),
      joinDocs: extra.map((x) => ({ path: x.ref.path, data: plain(x.data()) })),
      inboxRows: meta || [],
    });
  }
  const file = path.join(backupDir, `group-delete-backup-${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 1));
  report.backup = file;
  log(`backup: ${file} (${backup.length} groups)`);

  report.deleted = 0;
  report.failed = [];
  for (const b of backup) {
    try {
      await purgeChat(sb, b.id);
      for (let i = 0; i < b.joinDocs.length; i += 400) {
        const batch = db.batch();
        b.joinDocs.slice(i, i + 400).forEach((j) => batch.delete(db.doc(j.path)));
        await batch.commit();
      }
      await db.collection('groups').doc(b.id).delete();
      report.deleted += 1;
      if (report.deleted % 100 === 0) log(`deleted ${report.deleted}/${backup.length}`);
    } catch (e) {
      report.failed.push(`${b.id}: ${e?.message || e}`);
    }
  }
  return report;
}

module.exports = { run, plan, activeGroupIds };

if (require.main === module) {
  const arg = (name) => {
    const a = process.argv.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
    return a ? (a.includes('=') ? a.split('=')[1] : true) : null;
  };
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  const admin = require('firebase-admin');
  const { createClient } = require('@supabase/supabase-js');
  const SA = path.join(__dirname, '..', '..', 'serviceAccount.json');
  if (fs.existsSync(SA)) admin.initializeApp({ credential: admin.credential.cert(require(SA)) });
  else admin.initializeApp();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  run({
    db: admin.firestore(),
    sb,
    days: Number(arg('days')) || 15,
    apply: arg('apply') === true,
    confirm: arg('confirm'),
  }).then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (report.mode === 'dry_run') {
      console.log(`\nDry run. To delete these ${report.wouldDelete} groups:\n  node scripts/groups/delete-inactive-groups.js --apply --confirm=${report.wouldDelete}`);
    }
    process.exit(report.failed?.length ? 1 : 0);
  }).catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
  });
}
