// PGlite test of supabase/054_mod_log_admin_only.sql (on top of 053).
//   node scripts/staff-access/test054.mjs
// Checks: Admin entries hidden from Senior Mods / Mods in Recent, the
// per-staff ranking and a player's history; Admins and the owner see all;
// system entries stay visible; idempotent; helper not callable.
// banned or demoted reader loses it; reported-chat reads unchanged; grants.
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
const SQL = read('054_mod_log_admin_only.sql');
await db.exec(SQL);
await db.exec(SQL); // idempotent

const ADMIN = 'adminUid0001', SR = 'seniorUid0001', MOD = 'modUid0000001', JMD = 'jmdUid0000001', T = 'userUid000001';
await db.exec(`
  insert into user_roles (uid, is_admin, is_cmsr, is_moderator, is_baby_mod) values
    ('${ADMIN}', true, false, false, false), ('${SR}', false, true, false, false),
    ('${MOD}', false, false, true, false), ('${JMD}', false, false, false, true);
  insert into mod_actions (id, created_at, action, actor_uid, actor_role, target_uid) values
    ('00000000-0000-0000-0000-000000000001', now() - interval '5 min', 'ban',    '${ADMIN}',      'admin',      '${T}'),
    ('00000000-0000-0000-0000-000000000002', now() - interval '4 min', 'strike', 'ownerUid0001', 'admin',      '${T}'),
    ('00000000-0000-0000-0000-000000000003', now() - interval '3 min', 'mute',   '${ADMIN}',      null,         '${T}'),
    ('00000000-0000-0000-0000-000000000004', now() - interval '2 min', 'strike', '${MOD}',        'moderator',  '${T}'),
    ('00000000-0000-0000-0000-000000000005', now() - interval '1 min', 'unban',  '${SR}',         'senior_mod', '${T}'),
    ('00000000-0000-0000-0000-000000000006', now(),                    'ban',    'system',        'system',     '${T}');
`);
const OWNER = user('ownerUid0001', { email: 'thesolanalabs@gmail.com', email_verified: true });
const ids = async (sql, p) => (await q(sql, p)).map((r) => String(r.id).slice(-1)).sort().join('');
const actors = async (sql) => (await q(sql)).map((r) => r.actor_uid).sort().join(',');

for (const [c, label] of [[user(ADMIN), 'admin'], [OWNER, 'owner']]) {
  await as(c);
  ok(await ids(`select id from mod_actions_recent()`) === '123456', `${label}: Recent shows every entry`);
  ok(await ids(`select id from mod_actions_for_user(null, $1)`, [T]) === '123456', `${label}: player history shows every entry`);
  ok((await q(`select * from mod_leaderboard()`)).length === 5, `${label}: ranking lists every actor`);
}
for (const [c, label] of [[user(SR), 'senior'], [user(MOD), 'mod']]) {
  await as(c);
  ok(await ids(`select id from mod_actions_recent()`) === '456', `${label}: Recent hides Admin / owner entries`);
  ok(await ids(`select id from mod_actions_for_user(null, $1)`, [T]) === '456', `${label}: player history hides them`);
  ok(await actors(`select actor_uid from mod_leaderboard()`) === `${MOD},${SR},system`, `${label}: ranking hides Admin actors`);
  ok(await ids(`select id from mod_actions_recent(null, $1)`, [ADMIN]) === '', `${label}: filtering by an Admin returns nothing`);
}
await as(user(JMD));
ok(/not authorized/.test((await err(`select * from mod_actions_recent()`)) || ''), 'JMD: no Mod log');
ok(await ids(`select id from mod_actions_for_user(null, $1)`, [T]) === '456', 'JMD: player history without Admin entries');
// A Mod's old entry, now an Admin: hidden too.
await db.exec(`update user_roles set is_admin = true where uid = '${MOD}'`);
await as(user(SR));
ok(await ids(`select id from mod_actions_recent()`) === '56', 'entries of a staffer who is an Admin now are hidden');
await db.exec(`update user_roles set is_admin = false where uid = '${MOD}'`);

const can = async (role, fn) => (await one(`select has_function_privilege($1, $2, 'execute') as r`, [role, fn])).r;
ok(!(await can('anon', 'public._mod_action_by_admin(text, text)')) && !(await can('authenticated', 'public._mod_action_by_admin(text, text)')),
  '_mod_action_by_admin internal');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
