// PGlite test of supabase/056_mod_log_rank_visibility.sql (on top of 053 + 054).
//   node scripts/staff-access/test056.mjs
// Checks: each rank sees entries of its own rank and below in Recent, the
// per-staff ranking and a player's history; Admins and the owner see all;
// system entries stay visible; promoted actors hidden from old peers;
// idempotent; helpers not callable.
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const read = (f) => fs.readFileSync(path.join(REPO, 'supabase', f), 'utf8');

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL', msg); } };
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
const err = async (s, p) => { try { await db.query(s, p); return null; } catch (e) { return e.message; } };
const as = async (claims) => {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims ? JSON.stringify(claims) : '']);
};
const user = (uid, extra = {}) => ({ role: 'authenticated', sub: uid, ...extra });

await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create function public.firebase_uid() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'firebase_uid',
                    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub') $$;
  create table public.user_roles (uid text primary key, is_admin boolean not null default false,
    is_moderator boolean not null default false, is_baby_mod boolean not null default false,
    is_trusted boolean not null default false, is_cmsr boolean not null default false);
  create table public.banned_senders (uid text primary key, banned_until timestamptz, reason text, type text);
  create table public.chat_meta_data (owner_uid text, partner_uid text, timestamp_ms bigint);
  create table public.private_messages (id bigserial primary key, chat_id text, text text, created_at timestamptz default now());
  create table public.reported_chats (chat_id text primary key);
  create table public.mod_actions (id uuid primary key, created_at timestamptz not null default now(), action text,
    actor_uid text, actor_name text, actor_role text, target_uid text, target_email text);
`);
// 047's helpers, verbatim.
const s047 = read('047_mod_powers.sql');
const fnOf = (src, name) => {
  const start = src.indexOf(`create or replace function public.${name}(`);
  const open = src.indexOf('$$', start);
  const end = src.indexOf('$$;', open + 2) + 3;
  if (start < 0 || end < 3) throw new Error('function not found: ' + name);
  return src.slice(start, end);
};
await db.exec(fnOf(s047, '_caller_has_active_ban'));
await db.exec(fnOf(s047, 'is_mod_staff'));
await db.exec(`alter default privileges in schema public grant execute on functions to anon, authenticated, service_role`);

await db.exec(read('053_staff_access_chat_readers.sql'));
await db.exec(read('054_mod_log_admin_only.sql'));
const SQL = read('056_mod_log_rank_visibility.sql');
await db.exec(SQL);
await db.exec(SQL); // idempotent

const ADMIN = 'adminUid0001', SR = 'seniorUid0001', SR2 = 'seniorUid0002', MOD = 'modUid0000001', MOD2 = 'modUid0000002',
  JMD = 'jmdUid0000001', T = 'userUid000001';
await db.exec(`
  insert into user_roles (uid, is_admin, is_cmsr, is_moderator, is_baby_mod) values
    ('${ADMIN}', true, false, false, false), ('${SR}', false, true, false, false), ('${SR2}', false, true, false, false),
    ('${MOD}', false, false, true, false), ('${MOD2}', false, false, true, false), ('${JMD}', false, false, false, true);
  insert into mod_actions (id, created_at, action, actor_uid, actor_role, target_uid) values
    ('00000000-0000-0000-0000-000000000001', now() - interval '6 min', 'ban',    '${ADMIN}',      'admin',      '${T}'),
    ('00000000-0000-0000-0000-000000000002', now() - interval '5 min', 'strike', 'ownerUid0001', 'admin',      '${T}'),
    ('00000000-0000-0000-0000-000000000003', now() - interval '4 min', 'mute',   '${ADMIN}',      null,         '${T}'),
    ('00000000-0000-0000-0000-000000000004', now() - interval '3 min', 'strike', '${MOD}',        'moderator',  '${T}'),
    ('00000000-0000-0000-0000-000000000005', now() - interval '2 min', 'unban',  '${SR}',         'senior_mod', '${T}'),
    ('00000000-0000-0000-0000-000000000006', now() - interval '1 min', 'ban',    'system',        'system',     '${T}'),
    ('00000000-0000-0000-0000-000000000007', now(),                    'mute',   '${JMD}',        'baby_mod',   '${T}');
`);
const OWNER = user('ownerUid0001', { email: 'thesolanalabs@gmail.com', email_verified: true });
const ids = async (sql, p) => (await q(sql, p)).map((r) => String(r.id).slice(-1)).sort().join('');
const actors = async (sql) => (await q(sql)).map((r) => r.actor_uid).sort().join(',');

for (const [c, label] of [[user(ADMIN), 'admin'], [OWNER, 'owner']]) {
  await as(c);
  ok(await ids(`select id from mod_actions_recent()`) === '1234567', `${label}: Recent shows every entry`);
  ok(await ids(`select id from mod_actions_for_user(null, $1)`, [T]) === '1234567', `${label}: player history shows every entry`);
  ok((await q(`select * from mod_leaderboard()`)).length === 6, `${label}: ranking lists every actor`);
}
for (const [c, label] of [[user(SR), 'senior'], [user(SR2), 'other senior']]) {
  await as(c);
  ok(await ids(`select id from mod_actions_recent()`) === '4567', `${label}: Recent hides Admin / owner entries only`);
  ok(await ids(`select id from mod_actions_for_user(null, $1)`, [T]) === '4567', `${label}: player history hides them`);
  ok(await actors(`select actor_uid from mod_leaderboard()`) === `${JMD},${MOD},${SR},system`, `${label}: ranking hides Admin actors`);
  ok(await ids(`select id from mod_actions_recent(null, $1)`, [ADMIN]) === '', `${label}: filtering by an Admin returns nothing`);
}
for (const [c, label] of [[user(MOD), 'mod'], [user(MOD2), 'other mod']]) {
  await as(c);
  ok(await ids(`select id from mod_actions_recent()`) === '467', `${label}: Recent hides Admin and Senior Mod entries`);
  ok(await ids(`select id from mod_actions_for_user(null, $1)`, [T]) === '467', `${label}: player history hides them`);
  ok(await actors(`select actor_uid from mod_leaderboard()`) === `${JMD},${MOD},system`, `${label}: ranking hides Admin and Senior Mod actors`);
  ok(await ids(`select id from mod_actions_recent(null, $1)`, [SR]) === '', `${label}: filtering by a Senior Mod returns nothing`);
}
await as(user(JMD));
ok(/not authorized/.test((await err(`select * from mod_actions_recent()`)) || ''), 'JMD: no Mod log');
ok(await ids(`select id from mod_actions_for_user(null, $1)`, [T]) === '67', 'JMD: player history shows JMD and system entries only');
// A Mod's old entry, now a Senior Mod: hidden from the other Mod, still seen by Senior Mods.
await db.exec(`update user_roles set is_cmsr = true where uid = '${MOD}'`);
await as(user(MOD2));
ok(await ids(`select id from mod_actions_recent()`) === '67', 'Mod: entries of a staffer who is a Senior Mod now are hidden');
await as(user(SR2));
ok(await ids(`select id from mod_actions_recent()`) === '4567', 'Senior Mod: still sees the promoted staffer');
await db.exec(`update user_roles set is_cmsr = false where uid = '${MOD}'`);
// Banned Mod: no Mod log (is_moderator_staff unchanged).
await db.exec(`insert into banned_senders (uid, banned_until) values ('${MOD2}', now() + interval '1 day')`);
await as(user(MOD2));
ok(/not authorized/.test((await err(`select * from mod_actions_recent()`)) || ''), 'banned Mod: no Mod log');
await db.exec(`delete from banned_senders where uid = '${MOD2}'`);

const can = async (role, fn) => (await one(`select has_function_privilege($1, $2, 'execute') as r`, [role, fn])).r;
for (const fn of ['public._mod_action_rank(text, text)', 'public._caller_staff_rank()']) {
  ok(!(await can('anon', fn)) && !(await can('authenticated', fn)), `${fn} internal`);
}
const filtered = await q(`select proname from pg_proc where proname in ('mod_actions_recent', 'mod_leaderboard', 'mod_actions_for_user') and prosrc ~ '_mod_action_rank'`);
ok(filtered.length === 3, 'all 3 rpcs carry the rank filter');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
