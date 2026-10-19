// One-time seed of Supabase public.group_members (supabase/044) from Firestore
// groups/{id}.memberIds, plus the searchKeys the All groups search needs.
// Today's members are kept as they are (we can't tell how they joined); from
// here on functions/groupMembership.js (onGroupWrite) checks every new join.
//
// Order (044 header): STEP 1 applied → onGroupWrite + groupSync deployed →
// THIS SCRIPT → STEP 3. Dry run by default.
//
//   SUPABASE_URL=https://jaimyhmanefvrijvjzxl.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role> \
//   node scripts/groups/backfill-group-members.js            # dry run: counts only
//   node scripts/groups/backfill-group-members.js --apply    # write
//   node scripts/groups/backfill-group-members.js --apply --prune
//     --prune also deletes group_members rows whose group or member is gone
//     (safe to re-run any time; it never adds people the trigger removed,
//     except someone who is in memberIds at that very moment).
//
// Credentials: serviceAccount.json at the repo root (as the other backfills),
// or GOOGLE_APPLICATION_CREDENTIALS.
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

const APPLY = process.argv.includes('--apply');
const PRUNE = process.argv.includes('--prune');
const SA = path.join(__dirname, '..', '..', 'serviceAccount.json');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
if (fs.existsSync(SA)) admin.initializeApp({ credential: admin.credential.cert(require(SA)) });
else admin.initializeApp();
const db = admin.firestore();
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
// The same word-prefix keys the trigger writes.
const { searchKeysFor } = require('../../functions/groupSearchKeys');

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

(async () => {
  const snap = await db.collection('groups').select('createdBy', 'memberIds', 'name', 'groupName', 'searchKeys').get();
  const rows = [];
  const keyUpdates = [];
  let noOwnerRow = 0;
  for (const d of snap.docs) {
    const g = d.data();
    const ids = [...new Set((Array.isArray(g.memberIds) ? g.memberIds : []).filter((x) => typeof x === 'string' && x))];
    if (!ids.includes(g.createdBy)) noOwnerRow += 1;
    for (const u of ids) rows.push({ group_id: d.id, user_id: u, role: u === g.createdBy ? 'creator' : 'member' });
    const keys = searchKeysFor(g.name || g.groupName);
    if (!sameList(keys, g.searchKeys)) keyUpdates.push([d.ref, keys]);
  }
  console.log(`${snap.size} groups, ${rows.length} member rows, ${noOwnerRow} groups whose creator is not in memberIds, ${keyUpdates.length} searchKeys to write`);

  let have = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('group_members').select('group_id, user_id').order('group_id').order('user_id').range(from, from + 999);
    if (error) throw error;
    have = have.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  const want = new Set(rows.map((r) => `${r.group_id}\u0000${r.user_id}`));
  const stale = have.filter((r) => !want.has(`${r.group_id}\u0000${r.user_id}`));
  console.log(`group_members now: ${have.length} rows; ${stale.length} rows no longer match Firestore${PRUNE ? ' (will delete)' : ''}`);
  if (!APPLY) {
    console.log('Dry run. Re-run with --apply to write.');
    process.exit(0);
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('group_members').upsert(rows.slice(i, i + 500), { onConflict: 'group_id,user_id' });
    if (error) throw error;
  }
  console.log(`upserted ${rows.length} rows`);
  if (PRUNE) {
    for (const r of stale) {
      const { error } = await sb.from('group_members').delete().eq('group_id', r.group_id).eq('user_id', r.user_id);
      if (error) throw error;
    }
    console.log(`deleted ${stale.length} stale rows`);
  }
  for (let i = 0; i < keyUpdates.length; i += 400) {
    const batch = db.batch();
    keyUpdates.slice(i, i + 400).forEach(([ref, keys]) => batch.update(ref, { searchKeys: keys }));
    await batch.commit();
  }
  console.log(`wrote searchKeys on ${keyUpdates.length} groups`);
  const { count, error } = await sb.from('group_members').select('*', { count: 'exact', head: true });
  if (error) throw error;
  console.log(`group_members: ${count} rows. Next: supabase/044_steps/3_switch.sql`);
  process.exit(0);
})().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
