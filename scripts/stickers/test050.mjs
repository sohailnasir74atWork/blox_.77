// PGlite test of supabase/050_stickers.sql on top of the real 012
// send_group_message and stubs of the 001/009/010 tables and 034 helpers.
//   node scripts/stickers/test050.mjs
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'supabase', f), 'utf8');
const SQL050 = read('050_stickers.sql');
const SQL012 = read('012_send_group_message.sql');

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL', msg); } };
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
const as = async (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid || '']);
const err = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

const LEGACY = 'https://bloxfruitscalc.com/wp-content/uploads/2025/Emojies/e1.png';
const BUNNY = 'https://blox-api.b-cdn.net/stickers/fruits/dragon.webp';
const BAD = 'https://evil.example/x.png';

// --- what the live database already has (000, 001, 009, 010, 034) ---
await db.exec(`
  create role anon; create role authenticated;
  create function public.firebase_uid() returns text language sql stable
    as $$ select nullif(current_setting('test.uid', true), '') $$;
  create function public._chat_end_user_uid() returns text language sql stable
    as $$ select nullif(current_setting('test.uid', true), '') $$;
  create table public.messages (
    id uuid primary key default gen_random_uuid(), room_id text not null, sender_id text not null,
    text text, gif text, fruits jsonb not null default '[]', reply_to jsonb, deleted boolean not null default false,
    created_at timestamptz not null default now());
  create table public.private_messages (
    id uuid primary key default gen_random_uuid(), client_msg_id uuid, chat_id text not null,
    sender_id text not null, recipient_id text not null, text text, image_url text,
    fruits jsonb not null default '[]', reply_to jsonb, os text, deleted boolean not null default false,
    created_at timestamptz not null default now());
  create table public.group_messages (
    id uuid primary key default gen_random_uuid(), client_msg_id uuid, group_id text not null,
    sender_id text not null, text text, image_url text, fruits jsonb not null default '[]', reply_to jsonb,
    sender_name text, sender_avatar text, is_pro boolean, roblox_username_verified boolean,
    has_recent_game_win boolean, last_game_win_at bigint, is_creator boolean, os text,
    deleted boolean not null default false, deleted_at timestamptz, deleted_by text,
    report_count integer not null default 0, created_at timestamptz not null default now());
  create unique index idx_group_messages_group_client_msg_id
    on public.group_messages (group_id, client_msg_id) where client_msg_id is not null;
`);
await db.exec(SQL012);

// 034 missing -> 050 refuses to start.
await db.exec(`alter function public._chat_end_user_uid() rename to _hidden_uid`);
ok(/Run 034/.test(await err(() => db.exec(SQL050))), '050 needs 034');
await db.exec(`alter function public._hidden_uid() rename to _chat_end_user_uid`);

await db.exec(SQL050);
await db.exec(SQL050); // idempotent

// --- STEP 0 says fully applied ---
const s0 = await one(`
  select
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('sticker_url_allowed', 'enforce_chat_sticker'))::int as a,
    (select count(*) from pg_trigger where tgrelid = 'public.messages'::regclass and tgname = 'trg_ae_chat_sticker')::int as b,
    ((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'private_messages' and column_name = 'gif')
      + (select count(*) from pg_trigger where tgrelid = 'public.private_messages'::regclass and tgname = 'trg_ae_chat_sticker'))::int as c,
    ((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'group_messages' and column_name = 'gif')
      + (select count(*) from pg_trigger where tgrelid = 'public.group_messages'::regclass and tgname = 'trg_ae_chat_sticker')
      + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'send_group_sticker'))::int as d`);
ok(s0.a === 2 && s0.b === 1 && s0.c === 2 && s0.d === 3, `STEP 0 = 2|1|2|3 (got ${JSON.stringify(s0)})`);

// --- the allowlist ---
const allowed = async (u) => (await one(`select public.sticker_url_allowed($1) as r`, [u])).r;
const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/stickers/url-cases.json'), 'utf8'));
for (const u of CASES.allowed) ok(await allowed(u), `allowed: ${u}`);
for (const u of CASES.refused) ok(!(await allowed(u)), `refused: ${String(u).slice(0, 70)}`);

// --- public chat ---
await as('U1');
await q(`insert into messages(room_id, sender_id, text, gif) values ('r', 'U1', null, $1)`, [LEGACY]);
ok((await one(`select count(*)::int n from messages where gif = $1`, [LEGACY])).n === 1, 'legacy sticker sends (old builds)');
ok(/STICKER_NOT_ALLOWED/.test(await err(() => q(`insert into messages(room_id, sender_id, gif) values ('r', 'U1', $1)`, [BAD]))),
  'public: injected image refused');
await q(`insert into messages(room_id, sender_id, text) values ('r', 'U1', 'hi')`);
ok((await one(`select count(*)::int n from messages where text = 'hi' and gif is null`)).n === 1, 'text message unaffected');
await q(`insert into messages(room_id, sender_id, text, gif) values ('r', 'U1', 'blank', '')`);
ok((await one(`select gif from messages where text = 'blank'`)).gif === null, "'' stored as null");
const code = await (async () => {
  try { await q(`insert into messages(room_id, sender_id, gif) values ('r', 'U1', $1)`, [BAD]); return null; } catch (x) { return x.code; }
})();
ok(code === '23514', `errcode 23514 (got ${code})`);

// update: changing gif is checked, other updates are not
const mid = (await one(`select id from messages where gif = $1`, [LEGACY])).id;
ok(/STICKER_NOT_ALLOWED/.test(await err(() => q(`update messages set gif = $1 where id = $2`, [BAD, mid]))), 'update to a bad gif refused');
await as('');
await q(`insert into messages(room_id, sender_id, gif) values ('r', 'SR', $1)`, [BAD]);
ok((await one(`select count(*)::int n from messages where gif = $1`, [BAD])).n === 1, 'service role passes');
await as('U1');
await q(`update messages set deleted = true where gif = $1`, [BAD]);
ok((await one(`select deleted from messages where gif = $1`, [BAD])).deleted === true, 'old bad row can still be soft-deleted');

// --- private chat ---
await q(`insert into private_messages(chat_id, sender_id, recipient_id, text) values ('U1_U2', 'U1', 'U2', 'old build')`);
ok((await one(`select gif from private_messages where text = 'old build'`)).gif === null, 'old-build private insert: gif null');
await q(`insert into private_messages(chat_id, sender_id, recipient_id, gif) values ('U1_U2', 'U1', 'U2', $1)`, [BUNNY]);
ok((await one(`select count(*)::int n from private_messages where gif = $1`, [BUNNY])).n === 1, 'private sticker sends');
ok(/STICKER_NOT_ALLOWED/.test(await err(() => q(
  `insert into private_messages(chat_id, sender_id, recipient_id, gif) values ('U1_U2', 'U1', 'U2', $1)`, [BAD]))), 'private: bad gif refused');

// --- group chat ---
// Old builds: named arguments, exactly what PostgREST sends for their 14 params.
const oldCall = `select (public.send_group_message(
  p_group_id => 'G', p_client_msg_id => $1::uuid, p_text => 'hello', p_image_url => null,
  p_fruits => '[]'::jsonb, p_reply_to => null, p_sender_name => 'Ann', p_sender_avatar => null,
  p_is_pro => false, p_roblox_username_verified => false, p_has_recent_game_win => false,
  p_last_game_win_at => null, p_is_creator => false, p_os => 'android')).*`;
const c1 = '00000000-0000-4000-8000-000000000001';
let row = await one(oldCall, [c1]);
ok(row.text === 'hello' && row.gif === null && row.sender_id === 'U1', 'old-build group send unchanged');
ok((await q(`select 1 from pg_proc where proname = 'send_group_message'`)).length === 1, 'send_group_message not overloaded');

const sticker = `select (public.send_group_sticker(
  p_group_id => 'G', p_client_msg_id => $1::uuid, p_gif => $2, p_reply_to => $3::jsonb,
  p_sender_name => 'Ann', p_sender_avatar => null, p_is_pro => true, p_roblox_username_verified => false,
  p_has_recent_game_win => false, p_last_game_win_at => null, p_is_creator => false, p_os => 'ios')).*`;
const c2 = '00000000-0000-4000-8000-000000000002';
row = await one(sticker, [c2, BUNNY, JSON.stringify({ id: 'x', text: 'hi' })]);
ok(row.gif === BUNNY && row.text === null && row.image_url === null && row.is_pro === true && row.reply_to.id === 'x',
  'group sticker row');
row = await one(sticker, [c2, BUNNY, null]);
ok((await one(`select count(*)::int n from group_messages where client_msg_id = $1`, [c2])).n === 1 && row.gif === BUNNY,
  'idempotent retry returns the first row');
ok(/STICKER_NOT_ALLOWED/.test(await err(() => one(sticker, ['00000000-0000-4000-8000-000000000003', BAD, null]))),
  'send_group_sticker refuses a bad URL');
ok(/STICKER_NOT_ALLOWED/.test(await err(() => one(sticker, ['00000000-0000-4000-8000-000000000004', null, null]))),
  'send_group_sticker refuses null');
ok((await one(`select count(*)::int n from group_messages where client_msg_id in
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004')`)).n === 0, 'refused sends leave no row');
ok(/STICKER_NOT_ALLOWED/.test(await err(() => q(
  `insert into group_messages(group_id, sender_id, gif) values ('G', 'U1', $1)`, [BAD]))), 'group: direct insert of a bad gif refused');

// The hand-off does not leak into the next send in the same transaction.
await db.exec('begin');
await one(sticker, ['00000000-0000-4000-8000-000000000005', BUNNY, null]);
row = await one(oldCall, ['00000000-0000-4000-8000-000000000006']);
await db.exec('commit');
ok(row.gif === null, 'next plain send in the same transaction has no sticker');
ok((await one(`select current_setting('blox.sticker_gif', true) as v`)).v !== BUNNY, 'setting cleared');

// Grants: anon cannot call the rpc, authenticated can.
const priv = await one(`select has_function_privilege('anon', 'public.send_group_sticker(text, uuid, text, jsonb, text, text, boolean, boolean, boolean, bigint, boolean, text)', 'execute') as anon,
  has_function_privilege('authenticated', 'public.send_group_sticker(text, uuid, text, jsonb, text, text, boolean, boolean, boolean, bigint, boolean, text)', 'execute') as auth,
  has_function_privilege('authenticated', 'public.enforce_chat_sticker()', 'execute') as trig`);
ok(priv.anon === false && priv.auth === true && priv.trig === false, `grants (got ${JSON.stringify(priv)})`);

// Re-running 050 with data present keeps everything.
await db.exec(SQL050);
ok((await one(`select count(*)::int n from group_messages where gif = $1`, [BUNNY])).n === 2, 're-run keeps rows');

console.log(`050 stickers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
