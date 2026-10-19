// PGlite test of supabase/047_mod_powers.sql on top of 031 + 033.
//   node scripts/mod-powers/test047.mjs
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase') + '/';
const read = (f) => fs.readFileSync(ROOT + f, 'utf8');
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL', msg); } };
const q = async (s, p) => (await db.query(s, p)).rows;
// Caller = JWT claims, as PostgREST sets them.
const as = (claims) => db.query(`select set_config('request.jwt.claims', $1, false)`, [claims ? JSON.stringify(claims) : '']);
const err = async (s, p) => { try { await q(s, p); return null; } catch (e) { return e.message; } };

await db.exec(`
  create role anon; create role authenticated;
  create function public.firebase_uid() returns text language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub' $$;
  create table public.user_roles (uid text primary key, is_admin boolean default false, is_cmsr boolean default false,
    is_moderator boolean default false, is_baby_mod boolean default false);
  create table public.banned_senders (uid text primary key, banned_until timestamptz, reason text, source text, updated_at timestamptz);
`);
await db.exec(read('031_mod_actions.sql'));
await db.exec(read('033_mod_actions_evidence.sql'));
// Another migration (044–048) widening the same CHECK before us must survive.
await db.exec(`
  alter table public.mod_actions drop constraint mod_actions_action_check;
  alter table public.mod_actions add constraint mod_actions_action_check check (action in (
    'mute','strike','ban','unban','unmute','message_delete','delete_all','pin','unpin',
    'role_change','review_delete','profile_delete','someone_elses_action'));
`);
const SQL = read('047_mod_powers.sql');
await db.exec(SQL);
await db.exec(SQL); // idempotent

await q(`insert into user_roles(uid, is_admin, is_cmsr, is_moderator, is_baby_mod) values
  ('ADM', true, false, false, false), ('SEN', false, true, false, false),
  ('MOD', false, false, true, false), ('JMD', false, false, false, true), ('USR', false, false, false, false)`);

// CHECK: ours + 033's + the other migration's, nothing else.
const ins = (action) => err(`insert into mod_actions(action, target_uid) values ($1, 'T')`, [action]);
for (const a of ['perm_confirm', 'perm_reject', 'post_delete', 'unmute', 'strike', 'profile_delete', 'someone_elses_action']) {
  ok((await ins(a)) === null, `insert ${a} allowed`);
}
ok(/check/i.test((await ins('nuke')) || ''), 'unknown action refused');
const def = (await q(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'mod_actions_action_check'`))[0].d;
ok(/ARRAY\['/.test(def), `constraint keeps the parseable ARRAY[...] shape (got ${def})`);

const senior = async (claims) => { await as(claims); return (await q('select public.is_senior_mod_staff() as v'))[0].v; };
ok(await senior({ sub: 'ADM' }) === true, 'admin is senior+');
ok(await senior({ sub: 'SEN' }) === true, 'is_cmsr is senior+');
ok(await senior({ sub: 'MOD' }) === false, 'moderator is not');
ok(await senior({ sub: 'JMD' }) === false, 'JMD is not');
ok(await senior({ sub: 'X', email: 'sohailnasir74@gmail.com', email_verified: true }) === true, 'verified owner email');
ok(await senior({ sub: 'X', email: 'sohailnasir74@gmail.com', email_verified: false }) === false, 'unverified owner email is not');
ok(await senior({ sub: 'X', email: 'SohailNasir74@Gmail.com', email_verified: true }) === true, 'owner email any case');
ok(await senior(null) === false, 'no claims');

const recent = async (claims) => { await as(claims); return err('select * from public.mod_actions_recent()'); };
const board = async (claims) => { await as(claims); return err('select * from public.mod_leaderboard()'); };
const forUser = async (claims) => { await as(claims); return err(`select * from public.mod_actions_for_user(null, 'T')`); };
for (const [who, c] of [['admin', { sub: 'ADM' }], ['senior', { sub: 'SEN' }]]) {
  ok((await recent(c)) === null, `${who} reads mod_actions_recent`);
  ok((await board(c)) === null, `${who} reads mod_leaderboard`);
}
for (const [who, c] of [['moderator', { sub: 'MOD' }], ['JMD', { sub: 'JMD' }], ['user', { sub: 'USR' }]]) {
  ok(/not authorized/.test((await recent(c)) || ''), `${who} refused mod_actions_recent`);
  ok(/not authorized/.test((await board(c)) || ''), `${who} refused mod_leaderboard`);
}
ok((await forUser({ sub: 'MOD' })) === null, 'moderator still reads one user\'s history');
ok((await forUser({ sub: 'JMD' })) === null, 'JMD still reads one user\'s history');
ok(/not authorized/.test((await forUser({ sub: 'USR' })) || ''), 'user refused one user\'s history');
await as({ sub: 'SEN' });
ok((await q('select count(*)::int as n from public.mod_actions_recent()'))[0].n >= 7, 'senior sees the rows');

// Banned staff lose staff powers; mutes and expired bans don't count.
await q(`insert into user_roles(uid, is_admin, is_cmsr, is_moderator, is_baby_mod) values
  ('SENB', false, true, false, false), ('MODB', false, false, true, false), ('MODP', false, false, true, false),
  ('MODM', false, false, true, false), ('MODLM', false, false, true, false), ('JMDL', false, false, false, true),
  ('JMDX', false, false, false, true), ('ADMB', true, false, false, false)`);
await q(`insert into banned_senders(uid, banned_until, reason, type) values
  ('SENB', now() + interval '30 days', 'Strike 1', 'ban'),
  ('MODB', now() + interval '3 hours', 'Strike 1', 'ban'),
  ('MODP', null, 'Strike 3', 'ban'),
  ('MODM', now() + interval '1 hour', 'spam', 'mute'),
  ('MODLM', now() + interval '1 hour', 'Muted for 60 min', null),
  ('JMDL', now() + interval '1 day', 'Strike 2', null),
  ('JMDX', now() - interval '1 minute', 'Strike 1', 'ban'),
  ('ADMB', now() + interval '1 day', 'x', 'ban'),
  ('OWNB', null, 'x', 'ban')`);
const staff = async (claims) => { await as(claims); return (await q('select public.is_mod_staff() as v'))[0].v; };
ok(await staff({ sub: 'MODB' }) === false, 'banned mod is not staff');
ok(await staff({ sub: 'MODP' }) === false, 'permanently banned mod is not staff');
ok(await staff({ sub: 'JMDL' }) === false, 'legacy (no type) ban counts');
ok(await staff({ sub: 'ADMB' }) === false, 'banned admin is not staff');
ok(await staff({ sub: 'OWNB', email: 'sohailnasir74@gmail.com', email_verified: true }) === false, 'banned owner account is not staff');
ok(await staff({ sub: 'MODM' }) === true, 'muted mod is still staff');
ok(await staff({ sub: 'MODLM' }) === true, 'legacy mute (Muted for…) is still staff');
ok(await staff({ sub: 'JMDX' }) === true, 'expired ban: staff again');
ok(await staff({ sub: 'MOD' }) === true, 'unbanned mod is staff');
ok(await staff({ sub: 'X', email: 'sohailnasir74@gmail.com', email_verified: true }) === true, 'verified owner email is staff');
ok(await staff({ sub: 'X', email: 'sohailnasir74@gmail.com', email_verified: false }) === false, 'unverified owner email is not staff');
ok(await staff(null) === false, 'no claims: not staff');
ok(await senior({ sub: 'SENB' }) === false, 'banned senior is not senior+');
ok(/not authorized/.test((await recent({ sub: 'SENB' })) || ''), 'banned senior refused the Mod log');
ok(/not authorized/.test((await forUser({ sub: 'MODB' })) || ''), 'banned mod refused one user\'s history');
ok((await forUser({ sub: 'MODM' })) === null, 'muted mod still reads one user\'s history');

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
