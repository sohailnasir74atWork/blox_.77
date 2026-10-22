// PGlite test of supabase/055_private_edit_sender_only.sql on top of the
// real migrations it sits on (000–047, 034 as its step files, 054).
//   node scripts/chat-moderation/test055.mjs
// Updates go through `set role authenticated` + request.jwt.claims, the way
// PostgREST runs an app request, so RLS and the trigger order are the real
// ones. First proves the gaps exist with only 054, then applies 055 twice.
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
  return JSON.stringify({ role: 'authenticated', sub: who });
};
const as = async (who, fn) => {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claimsFor(who)]);
  const app = who !== null && who !== 'service';
  if (app) await db.exec('set role authenticated');
  try { return await fn(); } finally { if (app) await db.exec('reset role'); }
};
const err = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const refused = (e) => !!e && /NOT_ALLOWED/.test(e.message);

// ── Schema: the real migrations ─────────────────────────────────────────
await db.exec(`create role anon; create role authenticated; create role service_role; create publication supabase_realtime;`);
for (const f of ['000_init.sql', '001_public_chat.sql', '002_chat_metadata.sql', '003_users_split.sql',
  '004_fix_messages_unique_index.sql', '005_client_msg_id.sql', '006_message_moderation.sql',
  '009_private_messages.sql', '010_group_messages.sql', '030_banned_senders.sql', '031_mod_actions.sql',
  '033_mod_actions_evidence.sql', '034_steps/1_functions.sql', '034_steps/3_private_messages.sql',
  '039_mod_read_private_chat.sql', '040_owner_email_verified.sql', '047_mod_powers.sql',
  '054_private_delete_admin_only.sql']) {
  await db.exec(read(f));
}
await db.exec(`
  alter table public.private_messages add column if not exists gif text;          -- 050
  alter table public.private_messages add column if not exists origin text;       -- 025
  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on public.private_messages to anon, authenticated;
`);

// P, P2 players; M mod; S senior mod; J JMD; A admin; O verified owner email.
await q(`insert into public.user_roles (uid, is_admin, is_cmsr, is_moderator, is_baby_mod) values
  ('A', true, false, false, false), ('S', false, true, false, false),
  ('M', false, false, true, false), ('J', false, false, false, true)`);
const CALLERS = ['P2', 'M', 'S', 'J', 'A', 'O'];

// One chat between each caller and player P, with one message each way.
const chatOf = (a, b) => [a, b].sort().join('_');
const seed = async () => {
  await as(null, () => q(`delete from public.private_messages`));
  for (const who of CALLERS) {
    await as(null, () => q(`insert into public.private_messages (chat_id, sender_id, recipient_id, text) values
      ($1, 'P', $2, 'from P'), ($1, $2, 'P', 'from ' || $2)`, [chatOf(who, 'P'), who]));
  }
};
const msg = (chat, sender) => as(null, () => one(
  `select id, text, sender_id, recipient_id, deleted, report_count from public.private_messages
    where chat_id = $1 and text in ('from ' || $2, 'edited') and (sender_id = $2 or recipient_id = $2)
    order by (sender_id = $2) desc limit 1`, [chat, sender]));
const byId = (id) => as(null, () => one(`select * from public.private_messages where id = $1`, [id]));
const upd = (who, id, set, params = []) => as(who, () => q(
  `update public.private_messages set ${set} where id = $1 returning id`, [id, ...params]));
const markDeleted = (id, by) => as(null, () => q(
  `update public.private_messages set deleted = true, deleted_at = now(), deleted_by = $2 where id = $1`, [id, by]));

// ── With only 054: the gaps ─────────────────────────────────────────────
await seed();
{
  const c = chatOf('M', 'P');
  const p = await msg(c, 'P');
  ok(!(await err(() => upd('M', p.id, `text = 'edited'`))) && (await byId(p.id)).text === 'edited',
    'before 055: a Mod could rewrite P\'s text (the gap)');
  const own = await msg(c, 'M');
  ok(!(await err(() => upd('M', own.id, `sender_id = 'P', recipient_id = 'M'`))) && (await byId(own.id)).sender_id === 'P',
    'before 055: a Mod could make their own message look sent by P (the gap)');
}
{
  const c = chatOf('S', 'P');
  const own = await msg(c, 'S');
  await markDeleted(own.id, 'A');
  ok(!(await err(() => upd('S', own.id, `deleted = false`))) && (await byId(own.id)).deleted === false,
    'before 055: a Senior Mod could restore a message an Admin deleted (the gap)');
}

// ── Apply 055 (twice: safe to re-run) ───────────────────────────────────
const SQL = read('055_private_edit_sender_only.sql');
await db.exec(SQL);
await db.exec(SQL);
const check = await one(SQL.slice(SQL.indexOf('select\n  exists (select 1 from pg_trigger'), SQL.indexOf(';', SQL.indexOf('as step1_not_callable')) + 1));
ok(check.step1_trigger && check.step1_not_callable, `STEP 0 check all true (got ${JSON.stringify(check)})`);

// ── Nobody edits the other person's message, Admins included ────────────
await seed();
const contentEdits = [
  [`text = 'edited'`, 'text'], [`image_url = 'https://x/y.png'`, 'image'], [`fruits = '[{"name":"Dragon"}]'::jsonb`, 'items'],
  [`gif = 'https://x/s.webp'`, 'sticker'], [`reply_to = '{"id":"1"}'::jsonb`, 'reply'], [`os = 'ios'`, 'os'],
];
for (const who of CALLERS) {
  const c = chatOf(who, 'P');
  const p = await msg(c, 'P');
  for (const [set, label] of contentEdits) {
    const e = await err(() => upd(who, p.id, set));
    ok(refused(e), `${who} cannot change P's ${label} (got ${e?.message})`);
  }
  ok((await byId(p.id)).text === 'from P', `${who}: P's message unchanged`);
}

// ── Identity columns are locked for everyone ────────────────────────────
for (const who of ['P', 'M', 'A']) {
  const c = chatOf(who === 'P' ? 'P2' : who, 'P');
  const own = await msg(c, who);
  for (const [set, label] of [
    [`sender_id = 'P2'`, 'sender_id'], [`recipient_id = '${who}'`, 'recipient_id'], [`chat_id = 'other_chat'`, 'chat_id'],
    [`created_at = now() - interval '1 day'`, 'created_at'], [`client_msg_id = gen_random_uuid()`, 'client_msg_id'],
    [`origin = 'trade'`, 'origin'],
  ]) {
    const e = await err(() => upd(who, own.id, set));
    ok(refused(e) || /row-level security|violates/.test(e?.message || ''), `${who} cannot change ${label} on their own message (got ${e?.message})`);
  }
}

// ── The sender can still edit their own message ─────────────────────────
await seed();
for (const who of ['P2', 'M', 'A']) {
  const own = await msg(chatOf(who, 'P'), who);
  const e = await err(() => upd(who, own.id, `os = 'android'`));
  ok(!e && (await byId(own.id)).os === 'android', `${who} still updates their own message (got ${e?.message})`);
}

// ── Deletes (054) still behave ──────────────────────────────────────────
await seed();
const softDelete = (who, id) => upd(who, id, `deleted = true, deleted_at = now(), deleted_by = $2`, [who]);
for (const who of ['P2', 'M', 'S', 'J']) {
  const p = await msg(chatOf(who, 'P'), 'P');
  ok(refused(await err(() => softDelete(who, p.id))), `${who} still cannot delete P's message`);
  const own = await msg(chatOf(who, 'P'), who);
  ok(!(await err(() => softDelete(who, own.id))) && (await byId(own.id)).deleted, `${who} still deletes their own message`);
}
for (const who of ['A', 'O']) {
  const c = chatOf(who, 'P');
  const rows = await as(who, () => q(`update public.private_messages set deleted = true, deleted_at = now(), deleted_by = $2
    where chat_id = $1 and deleted = false returning id`, [c, who]));
  ok(rows.length === 2, `${who} "Delete All Chat" still deletes both messages (got ${rows.length})`);
}

// ── Restoring a deleted message: Admin / owner only ─────────────────────
await seed();
for (const who of ['P2', 'M', 'S']) {
  const c = chatOf(who, 'P');
  const own = await msg(c, who);
  await markDeleted(own.id, 'A');
  ok(refused(await err(() => upd(who, own.id, `deleted = false`))), `${who} cannot restore their own message an Admin deleted`);
  const p = await msg(c, 'P');
  await markDeleted(p.id, 'A');
  ok(refused(await err(() => upd(who, p.id, `deleted = false`))), `${who} cannot restore P's deleted message`);
}
for (const who of ['A', 'O']) {
  const p = await msg(chatOf(who, 'P'), 'P');
  await markDeleted(p.id, 'A');
  const e = await err(() => upd(who, p.id, `deleted = false`));
  ok(!e && (await byId(p.id)).deleted === false, `${who} can restore a deleted message (got ${e?.message})`);
}

// ── Reports keep working ────────────────────────────────────────────────
await seed();
{
  const m = await msg(chatOf('M', 'P'), 'M');
  const e = await err(() => as('P', () => q(`select public.report_message('private_messages', $1, 'spam')`, [m.id])));
  const after = await byId(m.id);
  ok(!e && after.report_count === 1 && !after.deleted, `report_message still works (got ${e?.message}, count ${after.report_count})`);
  const m2 = await msg(chatOf('S', 'P'), 'S');
  const e2 = await err(() => as('P', () => q(
    `update public.private_messages set report_count = report_count + 1, deleted = true, deleted_at = now(), deleted_by = 'P' where id = $1`, [m2.id])));
  const after2 = await byId(m2.id);
  ok(!e2 && after2.report_count === 1 && after2.deleted === false,
    `old builds' direct report still counts and never deletes (got ${e2?.message}, count ${after2.report_count}, deleted ${after2.deleted})`);
  const m3 = await msg(chatOf('J', 'P'), 'J');
  const e3 = await err(() => as('P', () => q(`update public.private_messages set report_count = report_count + 1 where id = $1`, [m3.id])));
  ok(!e3 && (await byId(m3.id)).report_count === 1, `old builds' report_count-only update still counts (got ${e3?.message})`);
}

// ── Server-side jobs ────────────────────────────────────────────────────
for (const who of ['service', null]) {
  await seed();
  const rows = await as(who, () => q(`update public.private_messages set text = 'cleaned', deleted = true where true returning id`));
  ok(rows.length === CALLERS.length * 2, `${who ?? 'SQL editor'} updates every row (cleanup jobs; got ${rows.length})`);
}

// ── Grants ──────────────────────────────────────────────────────────────
const can = async (role, fn) => (await one(`select has_function_privilege($1, $2, 'execute') as r`, [role, fn])).r;
ok(!(await can('anon', 'public.guard_private_message_edit()')) && !(await can('authenticated', 'public.guard_private_message_edit()')),
  'guard_private_message_edit(): not callable by the API');

// 055 refuses to run without 054.
{
  const fresh = new PGlite();
  const e = await err(() => fresh.exec(SQL));
  ok(e && /needs 054/.test(e.message), `055 refuses without 054 (got ${e?.message})`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
