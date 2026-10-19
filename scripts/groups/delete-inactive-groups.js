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
// From the Blox_Fruit folder (or this worktree), no keys to paste:
//   node scripts/groups/delete-inactive-groups.js                  # dry run: counts only
//   node scripts/groups/delete-inactive-groups.js --apply --confirm=<N>
//     N = the "would delete" number the dry run printed; anything else aborts.
//   Options: --days=15 (quiet window).
//
// Credentials it uses:
//   Firebase  serviceAccount.json found in this folder or a parent folder
//             (or GOOGLE_APPLICATION_CREDENTIALS).
//   Supabase  the Supabase CLI login on this Mac (`npx supabase db query
//             --linked`, the same as the SQL deploy steps). If
//             SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set, those are used.
// Safe to re-run: groups already gone are skipped.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DAY_MS = 24 * 60 * 60 * 1000;
const CHUNK = 50; // groups per Supabase purge statement
const millis = (t) => (typeof t?.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null));
const rpcMissing = (e) => ['PGRST202', '42883'].includes(e?.code || '') || /could not find the function/i.test(e?.message || '');
const tableMissing = (e) => ['42P01', 'PGRST205'].includes(e?.code || '') || /does not exist|could not find the table/i.test(e?.message || '');
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// ── Supabase through supabase-js (service role key) ──
function serviceRoleStore(sb) {
  return {
    async activeGroupIds(cutoffIso) {
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
    },
    async inboxRows(groupIds) {
      const out = new Map();
      for (const id of groupIds) {
        const { data, error } = await sb.from('group_meta_data').select('*').eq('group_id', id);
        if (error) throw error;
        out.set(id, data || []);
      }
      return out;
    },
    async purge(groupIds) {
      for (const id of groupIds) {
        const { error } = await sb.rpc('purge_group_chat', { p_group_id: id });
        if (!error) continue;
        if (!rpcMissing(error)) throw error;
        const r1 = await sb.from('group_messages')
          .update({ deleted: true, deleted_at: new Date().toISOString(), deleted_by: 'system:group_deleted' })
          .eq('group_id', id).eq('deleted', false);
        if (r1.error) throw r1.error;
        const r2 = await sb.from('group_meta_data').delete().eq('group_id', id);
        if (r2.error) throw r2.error;
        const r3 = await sb.from('group_members').delete().eq('group_id', id);
        if (r3.error && !tableMissing(r3.error)) throw r3.error;
      }
    },
  };
}

// ── Supabase through the CLI login (`db query --linked`, runs as postgres) ──
const sqlText = (s) => `'${String(s).replace(/\0/g, '').replace(/'/g, "''")}'`;
const sqlArray = (ids) => `array[${ids.map(sqlText).join(',')}]::text[]`;

function cliStore(runSql) {
  let hasMembers = null;
  return {
    async activeGroupIds(cutoffIso) {
      const rows = await runSql(`select distinct group_id from public.group_messages where created_at >= ${sqlText(cutoffIso)}::timestamptz;`);
      return new Set(rows.map((r) => r.group_id));
    },
    async inboxRows(groupIds) {
      const out = new Map(groupIds.map((id) => [id, []]));
      for (const part of chunks(groupIds, 200)) {
        for (const r of await runSql(`select * from public.group_meta_data where group_id = any(${sqlArray(part)});`)) {
          out.get(r.group_id)?.push(r);
        }
      }
      return out;
    },
    async purge(groupIds) {
      if (!groupIds.length) return;
      if (hasMembers === null) {
        hasMembers = (await runSql(`select to_regclass('public.group_members') is not null as yes;`))[0]?.yes === true;
      }
      const ids = sqlArray(groupIds);
      await runSql(`with m as (
          update public.group_messages
             set deleted = true, deleted_at = now(), deleted_by = 'system:group_deleted'
           where group_id = any(${ids}) and not deleted
          returning 1),
        g as (delete from public.group_meta_data where group_id = any(${ids}) returning 1)${hasMembers ? `,
        gm as (delete from public.group_members where group_id = any(${ids}) returning 1)` : ''}
        select (select count(*) from m) as messages, (select count(*) from g) as inbox_rows;`);
    },
  };
}

// Runs SQL with the Supabase CLI from the repo folder (it holds the project link).
function cliRunner(repoRoot) {
  return (sql) => {
    const file = path.join(os.tmpdir(), `group-cleanup-${process.pid}-${Date.now()}.sql`);
    fs.writeFileSync(file, sql);
    try {
      const out = execFileSync('npx', ['--yes', 'supabase@2.120.0', 'db', 'query', '--linked', '-f', file, '-o', 'json'],
        { cwd: repoRoot, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      return JSON.parse(out).rows || [];
    } finally {
      fs.rmSync(file, { force: true });
    }
  };
}

async function plan({ db, store, now, days }) {
  const cutoff = now - days * DAY_MS;
  const [snap, active] = await Promise.all([
    db.collection('groups').get(),
    store.activeGroupIds(new Date(cutoff).toISOString()),
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

async function run({ db, store, now = Date.now(), days = 15, apply = false, confirm = null, backupDir = defaultBackupDir(), log = console.log }) {
  const p = await plan({ db, store, now, days });
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

  // Backup first: every group doc, its invitations / join requests, inbox rows.
  const inbox = await store.inboxRows(p.remove.map((d) => d.id));
  const backup = [];
  for (const d of p.remove) {
    const extra = await joinDocs(db, d.id);
    backup.push({
      id: d.id,
      data: plain(d.data()),
      joinDocs: extra.map((x) => ({ path: x.ref.path, data: plain(x.data()) })),
      inboxRows: inbox.get(d.id) || [],
    });
  }
  const file = path.join(backupDir, `group-delete-backup-${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 1));
  report.backup = file;
  log(`backup: ${file} (${backup.length} groups)`);

  report.deleted = 0;
  report.failed = [];
  for (const part of chunks(backup, CHUNK)) {
    try {
      await store.purge(part.map((b) => b.id));
    } catch (e) {
      report.failed.push(`${part.length} groups (${part[0].id}…): ${e?.message || e}`);
      continue; // their Firestore docs stay, so a re-run picks them up
    }
    for (const b of part) {
      try {
        for (const slice of chunks(b.joinDocs, 400)) {
          const batch = db.batch();
          slice.forEach((j) => batch.delete(db.doc(j.path)));
          await batch.commit();
        }
        await db.collection('groups').doc(b.id).delete();
        report.deleted += 1;
      } catch (e) {
        report.failed.push(`${b.id}: ${e?.message || e}`);
      }
    }
    log(`deleted ${report.deleted}/${backup.length}`);
  }
  return report;
}

module.exports = { run, plan, serviceRoleStore, cliStore };

// serviceAccount.json in this folder or up to 4 parents (a worktree sits in
// <repo>/.claude/worktrees/<name>).
function findServiceAccount(start) {
  let dir = start;
  for (let i = 0; i < 5; i++) {
    const f = path.join(dir, 'serviceAccount.json');
    if (fs.existsSync(f)) return f;
    dir = path.dirname(dir);
  }
  return null;
}

if (require.main === module) {
  const arg = (name) => {
    const a = process.argv.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
    return a ? (a.includes('=') ? a.split('=')[1] : true) : null;
  };
  const repoRoot = path.join(__dirname, '..', '..');
  const admin = require('firebase-admin');
  const sa = process.env.GOOGLE_APPLICATION_CREDENTIALS ? null : findServiceAccount(repoRoot);
  if (sa) admin.initializeApp({ credential: admin.credential.cert(require(sa)) });
  else admin.initializeApp();

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const store = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? serviceRoleStore(require('@supabase/supabase-js').createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }))
    : cliStore(cliRunner(repoRoot));

  run({
    db: admin.firestore(),
    store,
    days: Number(arg('days')) || 15,
    apply: arg('apply') === true,
    confirm: arg('confirm'),
  }).then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (report.mode === 'dry_run') {
      console.log(`\nDry run: nothing was changed. To delete these ${report.wouldDelete} groups:\n  node scripts/groups/delete-inactive-groups.js --apply --confirm=${report.wouldDelete}`);
    }
    process.exit(report.failed?.length ? 1 : 0);
  }).catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
  });
}
