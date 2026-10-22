// PGlite test of supabase/054_private_delete_admin_only.sql on top of the
// real migrations it sits on (000–047, 034 as its step files).
//   node scripts/chat-moderation/test054.mjs
// Updates and deletes go through `set role authenticated` + request.jwt.claims,
// the way PostgREST runs an app request, so RLS and the trigger order are the
// real ones. First proves the gap exists without 054, then applies 054 twice.
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(path.dirname(path.resolve(process.argv[1])), '..', '..', 'supabase') + '/';
const read = (f) => fs.readFileSync(ROOT + f, 'utf8');
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL', msg); } };
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];

// ── Who is calling ──────────────────────────────────────────────────────
const OWNER_EMAIL = 'thesolanalabs@gmail.com';
const claimsFor = (who) => {
  if (who === null) return '';
  if (who === 'service') return JSON.stringify({ role: 'service_role' });
  if (who === 'O') return JSON.stringify({ role: 'authenticated', sub: 'O', email: OWNER_EMAIL, email_verified: true });
  if (who === 'OU') return JSON.stringify({ role: 'authenticated', sub: 'OU', email: OWNER_EMAIL, email_verified: false });
  return JSON.stringify({ role: 'authenticated', sub: who });
};
const as = async (who, fn) => {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claimsFor(who)]);
  const app = who !== null && who !== 'service';
  if (app) await db.exec('set role authenticated');
  try { return await fn(); } finally { if (app) await db.exec('reset role'); }
};
const err = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ── Schema: the real migrations ─────────────────────────────────────────
await db.exec(`create role anon; create role authenticated; create role service_role; create publication supabase_realtime;`);
for (const f of ['000_init.sql', '001_public_chat.sql', '002_chat_metadata.sql', '003_users_split.sql',
  '004_fix_messages_unique_index.sql', '005_client_msg_id.sql', '006_message_moderation.sql',
  '009_private_messages.sql', '010_group_messages.sql', '030_banned_senders.sql', '031_mod_actions.sql',
  '033_mod_actions_evidence.sql', '034_steps/1_functions.sql', '034_steps/3_private_messages.sql',
  '039_mod_read_private_chat.sql', '040_owner_email_verified.sql', '047_mod_powers.sql']) {
  await db.exec(read(f));
}
await db.exec(`
  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on public.private_messages to anon, authenticated;
`);

// P, P2 players; M mod; S senior mod; J JMD; A admin; O / OU owner email (verified / not).
await q(`insert into public.user_roles (uid, is_admin, is_cmsr, is_moderator, is_baby_mod) values
  ('A', true, false, false, false), ('S', false, true, false, false),
  ('M', false, false, true, false), ('J', false, false, false, true)`);

// One chat between each caller and player P, with one message each way.
const chatOf = (a, b) => [a, b].sort().join('_');
const seed = async () => {
  await as(null, () => q(`delete from public.private_messages`));
  for (const who of ['P2', 'M', 'S', 'J', 'A', 'O', 'OU']) {
    const c = chatOf(who, 'P');
    await as(null, () => q(`insert into public.private_messages (chat_id, sender_id, recipient_id, text) values
      ($1, 'P', $2, 'from P'), ($1, $2, 'P', 'from ' || $2)`, [c, who]));
  }
};
const msg = (chat, sender) => as(null, () => one(
  `select id, deleted, deleted_by, report_count from public.private_messages where chat_id = $1 and sender_id = $2`, [chat, sender]));
// The app's softDeletePrivateMessage / softDeleteAllInChat payload.
const softDelete = (who, id) => as(who, () => q(
  `update public.private_messages set deleted = true, deleted_at = now(), deleted_by = $2 where id = $1 returning id`, [id, who]));
const softDeleteAll = (who, chat) => as(who, () => q(
  `update public.private_messages set deleted = true, deleted_at = now(), deleted_by = $2
    where chat_id = $1 and deleted = false returning id`, [chat, who]));
const hardDelete = (who, id) => as(who, () => q(`delete from public.private_messages where id = $1 returning id`, [id]));

// ── Before 054: the gap ─────────────────────────────────────────────────
await seed();
for (const who of ['M', 'S', 'J']) {
  const m = await msg(chatOf(who, 'P'), 'P');
  const e = await err(() => softDelete(who, m.id));
  ok(!e && (await msg(chatOf(who, 'P'), 'P')).deleted, `before 054: ${who} could soft-delete P's message (the gap)`);
}
{
  const m = await msg(chatOf('M', 'P'), 'P');
  await as(null, () => q(`update public.private_messages set deleted = false, deleted_at = null, deleted_by = null`));
  const rows = await hardDelete('M', m.id);
  ok(rows.length === 1, 'before 054: a Mod could hard-delete P\'s message (the gap)');
}

// ── Apply 054 (twice: safe to re-run) ───────────────────────────────────
const SQL = read('054_private_delete_admin_only.sql');
await db.exec(SQL);
await db.exec(SQL);
const check = await one(SQL.slice(SQL.indexOf('select\n  exists (select 1 from pg_trigger'), SQL.indexOf(';', SQL.indexOf('as step3_old_policy_gone')) + 1));
ok(check.step2_trigger && check.step3_policy && check.step3_old_policy_gone, `STEP 0 check all true (got ${JSON.stringify(check)})`);
await seed();

// ── Soft delete of the other person's message ───────────────────────────
for (const who of ['P2', 'M', 'S', 'J', 'OU']) {
  const c = chatOf(who, 'P');
  const m = await msg(c, 'P');
  const e = await err(() => softDelete(who, m.id));
  ok(e && /NOT_ALLOWED/.test(e.message), `${who} cannot soft-delete P's message (got ${e?.message})`);
  ok((await msg(c, 'P')).deleted === false, `${who}: P's message still there`);
  const eAll = await err(() => softDeleteAll(who, c));
  ok(eAll && /NOT_ALLOWED/.test(eAll.message), `${who}: "Delete All Chat" refused (got ${eAll?.message})`);
  ok((await msg(c, who)).deleted === false && (await msg(c, 'P')).deleted === false, `${who}: Delete All left both messages`);
}
for (const who of ['A', 'O']) {
  const c = chatOf(who, 'P');
  const m = await msg(c, 'P');
  const e = await err(() => softDelete(who, m.id));
  const after = await msg(c, 'P');
  ok(!e && after.deleted && after.deleted_by === who, `${who} soft-deletes P's message (got ${e?.message}, by ${after.deleted_by})`);
}
{
  await as(null, () => q(`update public.private_messages set deleted = false, deleted_at = null, deleted_by = null`));
  const c = chatOf('A', 'P');
  const rows = await softDeleteAll('A', c);
  ok(rows.length === 2, `Admin "Delete All Chat" deletes both messages (got ${rows.length})`);
  const rowsO = await softDeleteAll('O', chatOf('O', 'P'));
  ok(rowsO.length === 2, `owner "Delete All Chat" deletes both messages (got ${rowsO.length})`);
}

// ── Own messages and other updates still work ───────────────────────────
await seed();
for (const who of ['P2', 'M', 'J']) {
  const c = chatOf(who, 'P');
  const own = await msg(c, who);
  const e = await err(() => softDelete(who, own.id));
  ok(!e && (await msg(c, who)).deleted, `${who} still soft-deletes their own message (got ${e?.message})`);
}
{
  const c = chatOf('M', 'P');
  const p = await msg(c, 'P');
  const e = await err(() => as('P', () => q(`update public.private_messages set text = 'edited' where id = $1`, [p.id])));
  ok(!e, `sender's non-delete update unaffected (got ${e?.message})`);
}

// ── Hard delete ─────────────────────────────────────────────────────────
await seed();
for (const who of ['P2', 'M', 'S', 'J', 'OU']) {
  const m = await msg(chatOf(who, 'P'), 'P');
  const rows = await hardDelete(who, m.id);
  ok(rows.length === 0 && (await msg(chatOf(who, 'P'), 'P')), `${who} cannot hard-delete P's message`);
}
for (const who of ['A', 'O']) {
  const m = await msg(chatOf(who, 'P'), 'P');
  const rows = await hardDelete(who, m.id);
  ok(rows.length === 1, `${who} hard-deletes P's message`);
}
{
  const own = await msg(chatOf('M', 'P'), 'M');
  ok((await hardDelete('M', own.id)).length === 1, 'sender hard-deletes their own message');
  const other = await msg(chatOf('S', 'P'), 'S');
  ok((await hardDelete('A', other.id)).length === 0, 'Admin still cannot touch a chat they are not in (SELECT policy)');
}

// ── Reports keep working ────────────────────────────────────────────────
await seed();
{
  const c = chatOf('M', 'P');
  const m = await msg(c, 'M');
  const e = await err(() => as('P', () => q(`select public.report_message('private_messages', $1, 'spam')`, [m.id])));
  const after = await msg(c, 'M');
  ok(!e && after.report_count === 1 && !after.deleted, `report_message still works (got ${e?.message}, count ${after.report_count})`);

  // Legacy shim: an old build reports with a direct UPDATE, sometimes with deleted = true.
  const c2 = chatOf('S', 'P');
  const m2 = await msg(c2, 'S');
  const e2 = await err(() => as('P', () => q(
    `update public.private_messages set report_count = report_count + 1, deleted = true where id = $1`, [m2.id])));
  const after2 = await msg(c2, 'S');
  ok(!e2 && after2.report_count === 1 && after2.deleted === false,
    `legacy report shim still counts and never deletes (got ${e2?.message}, count ${after2.report_count}, deleted ${after2.deleted})`);
}

// ── Server-side jobs ────────────────────────────────────────────────────
for (const who of ['service', null]) {
  await seed();
  const rows = await as(who, () => q(`update public.private_messages set deleted = true, deleted_at = now() where deleted = false returning id`));
  ok(rows.length === 14, `${who ?? 'SQL editor'} soft-deletes everything (cleanup jobs; got ${rows.length})`);
}

// ── Grants ──────────────────────────────────────────────────────────────
const can = async (role, fn) => (await one(`select has_function_privilege($1, $2, 'execute') as r`, [role, fn])).r;
ok(await can('authenticated', 'public.is_admin_staff()') && !(await can('anon', 'public.is_admin_staff()')), 'is_admin_staff(): authenticated only');
ok(!(await can('anon', 'public.guard_private_message_delete()')) && !(await can('authenticated', 'public.guard_private_message_delete()')),
  'guard_private_message_delete(): not callable by the API');
for (const [who, want] of [['A', true], ['O', true], ['OU', false], ['S', false], ['M', false], ['P', false]]) {
  const r = (await as(who, () => one(`select public.is_admin_staff() as r`))).r;
  ok(r === want, `is_admin_staff() for ${who} = ${want} (got ${r})`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
