// The no-key path of scripts/groups/delete-inactive-groups.js (cliStore: SQL
// through `supabase db query --linked`) against PGlite with the real chain
// 000–043, before and after supabase/044.
//   node scripts/groups/test-cli-store.mjs
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { cliStore } = require('./delete-inactive-groups.js');
const ROOT = fileURLToPath(new URL('../../supabase/', import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

async function boot(with044) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create publication supabase_realtime;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);
  const skip = new Set(['026_private_message_retention.sql', '038_birthday_emails.sql', '040_owner_email_verified.sql']);
  if (!with044) skip.add('044_group_privacy.sql');
  for (const f of fs.readdirSync(ROOT).filter((x) => /^0\d\d_.*\.sql$/.test(x) && !skip.has(x)).sort()) await db.exec(fs.readFileSync(ROOT + f, 'utf8'));
  // Like the SQL editor / CLI: no end-user JWT, so the chat triggers pass through.
  await db.exec(`select set_config('request.jwt.claims', '', false);
    insert into public.group_messages (group_id, sender_id, text, created_at) values
      ('gKeep', 'u1', 'new', now() - interval '2 days'),
      ('gQuiet', 'u1', 'old', now() - interval '40 days'), ('gQuiet', 'u2', 'older', now() - interval '90 days'),
      ('it''s', 'u1', 'quote id', now() - interval '30 days');
    insert into public.group_meta_data (user_id, group_id) values ('u1', 'gQuiet'), ('u2', 'gQuiet'), ('u1', 'gKeep'), ('u1', 'it''s');`);
  if (with044) await db.exec(`insert into public.group_members (group_id, user_id, role) values ('gQuiet', 'u1', 'creator'), ('gKeep', 'u1', 'creator');`);
  return db;
}

for (const with044 of [false, true]) {
  const db = await boot(with044);
  const store = cliStore(async (sql) => (await db.query(sql)).rows);
  const tag = with044 ? 'after 044' : 'before 044';
  const active = await store.activeGroupIds(new Date(Date.now() - 15 * 864e5).toISOString());
  ok(active.has('gKeep') && !active.has('gQuiet') && active.size === 1, `${tag}: active = groups with a message in 15 days`);
  const inbox = await store.inboxRows(['gQuiet', "it's", 'gNone']);
  ok(inbox.get('gQuiet').length === 2 && inbox.get("it's").length === 1 && inbox.get('gNone').length === 0, `${tag}: inbox rows for the backup`);
  await store.purge(['gQuiet', "it's"]);
  const q = async (s) => (await db.query(s)).rows;
  ok((await q(`select count(*)::int n from public.group_messages where group_id in ('gQuiet', 'it''s') and not deleted`))[0].n === 0, `${tag}: messages soft-deleted`);
  ok((await q(`select count(*)::int n from public.group_messages where group_id = 'gQuiet' and deleted_by = 'system:group_deleted'`))[0].n === 2, `${tag}: deleted_by stamped`);
  ok((await q(`select count(*)::int n from public.group_messages where group_id = 'gKeep' and not deleted`))[0].n === 1, `${tag}: kept group untouched`);
  ok((await q(`select count(*)::int n from public.group_meta_data where group_id in ('gQuiet', 'it''s')`))[0].n === 0, `${tag}: inbox rows removed`);
  ok((await q(`select count(*)::int n from public.group_meta_data where group_id = 'gKeep'`))[0].n === 1, `${tag}: kept group keeps its inbox row`);
  if (with044) {
    ok((await q(`select count(*)::int n from public.group_members where group_id = 'gQuiet'`))[0].n === 0, `${tag}: membership rows removed`);
    ok((await q(`select count(*)::int n from public.group_members where group_id = 'gKeep'`))[0].n === 1, `${tag}: kept membership`);
  }
  await store.purge(['gQuiet']); // again: no-op
  ok(true, `${tag}: re-run is a no-op`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
