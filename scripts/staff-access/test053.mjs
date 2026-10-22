// PGlite test of supabase/053_staff_access_chat_readers.sql.
//   node scripts/staff-access/test053.mjs
// Checks: Mod log open to Mods (not JMDs, not banned staff); private-chat
// readers: only Admins / verified owners manage the list, only Mods / Senior
// Mods can be listed, a listed reader reads any chat list and any chat, a
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

const SQL = read('053_staff_access_chat_readers.sql');
await db.exec(SQL);
await db.exec(SQL); // idempotent

const ADMIN = 'adminUid0001', SR = 'seniorUid0001', MOD = 'modUid0000001', MOD2 = 'modUid0000002';
const JMD = 'jmdUid0000001', U = 'userUid000001', BANNED = 'bannedMod0001';
await db.exec(`
  insert into user_roles (uid, is_admin, is_cmsr, is_moderator, is_baby_mod) values
    ('${ADMIN}', true, false, false, false), ('${SR}', false, true, false, false),
    ('${MOD}', false, false, true, false), ('${MOD2}', false, false, true, false),
    ('${JMD}', false, false, false, true), ('${BANNED}', false, false, true, false);
  insert into banned_senders (uid, banned_until, reason, type) values ('${BANNED}', now() + interval '1 day', 'x', 'ban');
  insert into chat_meta_data values ('${U}', 'x', 1), ('${U}', 'y', 2);
  insert into private_messages (chat_id, text) values ('a_b', 'hello'), ('c_d', 'reported one');
  insert into reported_chats values ('c_d');
  insert into mod_actions (id, action, actor_uid) values ('00000000-0000-0000-0000-000000000001', 'strike', '${MOD}');
`);
const OWNER = user('ownerUid0001', { email: 'thesolanalabs@gmail.com', email_verified: true });

// --- Mod log -------------------------------------------------------------
const recent = async (c) => { await as(c); return err(`select * from mod_actions_recent()`); };
const board = async (c) => { await as(c); return err(`select * from mod_leaderboard()`); };
for (const [c, label] of [[user(ADMIN), 'admin'], [user(SR), 'senior'], [user(MOD), 'mod'], [OWNER, 'owner']]) {
  ok((await recent(c)) === null, `mod log: ${label} reads recent`);
  ok((await board(c)) === null, `mod log: ${label} reads leaderboard`);
}
for (const [c, label] of [[user(JMD), 'JMD'], [user(U), 'player'], [user(BANNED), 'banned mod'], [null, 'no JWT']]) {
  ok(/not authorized/.test((await recent(c)) || ''), `mod log: ${label} refused (recent)`);
  ok(/not authorized/.test((await board(c)) || ''), `mod log: ${label} refused (leaderboard)`);
}
await as(user(MOD));
ok((await q(`select * from mod_actions_recent()`)).length === 1, 'mod log rows come back');

// --- Readers list: Admin only ---------------------------------------------
const setR = async (c, uid, on) => { await as(c); return err(`select chat_reader_set($1, $2)`, [uid, on]); };
ok(/not authorized/.test((await setR(user(SR), MOD, true)) || ''), 'senior cannot grant');
ok(/not authorized/.test((await setR(user(MOD), MOD2, true)) || ''), 'mod cannot grant');
ok((await setR(user(ADMIN), MOD, true)) === null, 'admin grants a Mod');
ok((await setR(OWNER, SR, true)) === null, 'verified owner grants a Senior Mod');
ok(/not authorized/.test((await setR(user('ownerUid0002', { email: 'thesolanalabs@gmail.com' }), MOD2, true)) || ''), 'unverified owner email cannot grant');
ok(/NOT_MOD/.test((await setR(user(ADMIN), U, true)) || ''), 'a player cannot be listed');
ok(/NOT_MOD/.test((await setR(user(ADMIN), JMD, true)) || ''), 'a JMD cannot be listed');
ok(/NOT_MOD/.test((await setR(user(ADMIN), ADMIN, true)) || ''), 'an Admin is not listed (already can)');
ok(/BAD_UID/.test((await setR(user(ADMIN), 'bad id!', true)) || ''), 'bad uid refused');
ok((await setR(user(ADMIN), MOD, true)) === null, 'granting twice is fine');
await as(user(ADMIN));
const list = (await one(`select chat_readers_list() as r`)).r;
ok(list.length === 2 && list.some((x) => x.uid === MOD && x.grantedBy === ADMIN), 'admin lists readers');
await as(user(SR));
ok(/not authorized/.test((await err(`select chat_readers_list()`)) || ''), 'senior cannot list readers');
await as(user(U));
ok(/permission denied|not authorized/.test((await err(`select * from private_chat_readers`)) || 'permission denied'), 'table not readable directly');

// --- Reads ---------------------------------------------------------------
const listChats = async (c) => { await as(c); return err(`select * from admin_list_user_chats($1)`, [U]); };
const readChat = async (c, id) => { await as(c); return err(`select * from mod_read_private_chat($1)`, [id]); };
const me = async (c) => { await as(c); return (await one(`select chat_reader_me() as r`)).r; };
ok((await listChats(user(ADMIN))) === null && (await readChat(user(ADMIN), 'a_b')) === null, 'admin reads any chat');
ok((await listChats(user(MOD))) === null, 'listed Mod lists a user\'s chats');
await as(user(MOD));
ok((await q(`select * from admin_list_user_chats($1)`, [U])).length === 2, 'listed Mod gets the rows');
ok((await readChat(user(MOD), 'a_b')) === null, 'listed Mod reads an unreported chat');
ok((await readChat(user(SR), 'a_b')) === null, 'listed Senior Mod reads an unreported chat');
ok(/not authorized/.test((await listChats(user(MOD2))) || ''), 'unlisted Mod cannot list chats');
ok(/chat not reported/.test((await readChat(user(MOD2), 'a_b')) || ''), 'unlisted Mod cannot read an unreported chat');
ok((await readChat(user(MOD2), 'c_d')) === null, 'unlisted Mod still reads a reported chat');
ok(/not staff/.test((await readChat(user(U), 'c_d')) || ''), 'player cannot read');
ok(await me(user(ADMIN)) === true && await me(user(MOD)) === true && await me(user(MOD2)) === false && await me(user(U)) === false,
  'chat_reader_me');

// A listed reader who is banned or demoted loses it.
await db.exec(`insert into banned_senders values ('${MOD}', now() + interval '1 hour', 'x', 'ban')`);
ok(/not authorized/.test((await listChats(user(MOD))) || ''), 'banned reader cannot list');
ok(await me(user(MOD)) === false, 'banned reader: chat_reader_me false');
await db.exec(`delete from banned_senders where uid = '${MOD}'; insert into banned_senders values ('${MOD}', now() + interval '1 hour', 'Muted for 60 min', null)`);
ok((await listChats(user(MOD))) === null, 'a muted reader keeps it');
await db.exec(`update user_roles set is_cmsr = false where uid = '${SR}'`);
ok(/not staff/.test((await readChat(user(SR), 'a_b')) || ''), 'demoted reader loses it (no longer staff)');

// Revoke.
ok((await setR(user(ADMIN), MOD, false)) === null, 'admin removes a reader');
ok(/not authorized/.test((await listChats(user(MOD))) || ''), 'removed reader cannot list');

// --- Grants -----------------------------------------------------------------
const can = async (role, fn) => (await one(`select has_function_privilege($1, $2, 'execute') as r`, [role, fn])).r;
for (const fn of ['public._caller_is_admin()', 'public._caller_is_chat_reader()']) {
  ok(!(await can('anon', fn)) && !(await can('authenticated', fn)), `${fn} internal`);
}
for (const fn of ['public.chat_readers_list()', 'public.chat_reader_set(text, boolean)', 'public.chat_reader_me()',
  'public.is_moderator_staff()', 'public.admin_list_user_chats(text, integer, integer)']) {
  ok(!(await can('anon', fn)) && await can('authenticated', fn), `${fn}: authenticated only`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
