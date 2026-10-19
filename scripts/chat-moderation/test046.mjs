// PGlite test of supabase/046_chat_slowmode.sql (+ 046_chat_slowmode_index.sql)
// on top of the real migrations it depends on (000–040, 034 as its step files).
//   node scripts/chat-moderation/test046.mjs
// Inserts go through `set role authenticated` + request.jwt.claims, the way
// PostgREST runs an app request, so RLS and the trigger order are the real ones.
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';
import path from 'path';

// Relative to this script (works from any worktree): <repo>/supabase/
const ROOT = path.join(path.dirname(path.resolve(process.argv[1])), '..', '..', 'supabase') + '/';
const read = (f) => fs.readFileSync(ROOT + f, 'utf8');
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL', msg); } };
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];

// ── Who is calling ──────────────────────────────────────────────────────
// uid → claims like the Firebase JWT Supabase sees; null → SQL editor (no claims).
const OWNER_EMAIL = 'thesolanalabs@gmail.com';
const claimsFor = (who) => {
  if (who === null) return '';
  if (who === 'service') return JSON.stringify({ role: 'service_role' });
  if (who === 'anon') return JSON.stringify({ role: 'anon' });
  if (who === 'O') return JSON.stringify({ role: 'authenticated', sub: 'O', email: OWNER_EMAIL, email_verified: true });
  if (who === 'OU') return JSON.stringify({ role: 'authenticated', sub: 'OU', email: OWNER_EMAIL, email_verified: false });
  return JSON.stringify({ role: 'authenticated', sub: who });
};
// Runs fn as `who`: app callers under the authenticated role, others as the superuser.
const as = async (who, fn) => {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claimsFor(who)]);
  const app = who !== null && who !== 'service';
  if (app) await db.exec(`set role ${who === 'anon' ? 'anon' : 'authenticated'}`);
  try { return await fn(); } finally { if (app) await db.exec('reset role'); }
};
const err = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

const setSlow = (who, scope, secs) => as(who, () => one(`select public.set_chat_slowmode($1, $2) as r`, [scope, secs]));
let seq = 0;
const send = (who, room, extra = {}) => as(who, () => one(
  `insert into public.messages (room_id, sender_id, text, client_msg_id, created_at)
   values ($1, $2, $3, $4, coalesce($5::timestamptz, now())) returning id, created_at`,
  [room, extra.sender ?? who, extra.text ?? `m${++seq}`, extra.cmid ?? null, extra.createdAt ?? null]));
// Push a sender's messages into the past (time travel), as the superuser.
const age = (uid, secs) => as(null, () => q(
  `update public.messages set created_at = created_at - make_interval(secs => $2) where sender_id = $1`, [uid, secs]));

// ── Schema: the real migrations ─────────────────────────────────────────
await db.exec(`create role anon; create role authenticated; create role service_role; create publication supabase_realtime;`);
for (const f of ['000_init.sql', '001_public_chat.sql', '002_chat_metadata.sql', '003_users_split.sql',
  '004_fix_messages_unique_index.sql', '005_client_msg_id.sql', '006_message_moderation.sql',
  '009_private_messages.sql', '010_group_messages.sql', '030_banned_senders.sql', '031_mod_actions.sql',
  '033_mod_actions_evidence.sql', '034_steps/1_functions.sql', '034_steps/2_messages.sql',
  '039_mod_read_private_chat.sql', '040_owner_email_verified.sql']) {
  await db.exec(read(f));
}
// What Supabase grants the API roles by default (PGlite has no such defaults).
await db.exec(`
  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on public.messages, public.rooms to anon, authenticated;
`);

// STEP 2 must refuse without the index.
const noIndex = await err(() => db.exec(read('046_chat_slowmode.sql')));
ok(noIndex && /046_chat_slowmode_index/.test(noIndex.message), `main file refuses before the index (got ${noIndex?.message})`);
await db.exec(read('046_chat_slowmode_index.sql'));
// Supabase's default grants on a new table, which 1a must take back.
await db.exec(`create table if not exists public.chat_slowmode (scope text primary key, seconds integer not null default 0
  check (seconds in (0, 5, 10, 30, 60, 300)), set_by text, updated_at timestamptz not null default now());
  grant all on public.chat_slowmode to anon, authenticated;`);
const MAIN = read('046_chat_slowmode.sql');
await db.exec(MAIN);
await db.exec(MAIN); // idempotent
const step0 = await one(MAIN.slice(MAIN.indexOf('select\n  (select coalesce(bool_and(i.indisvalid)'), MAIN.indexOf(';', MAIN.indexOf('as step3_reports')) + 1));
ok(step0.index_valid && step0.step1_table && Number(step0.step1_functions) === 4 && step0.step2_trigger && step0.step3_reports,
  `STEP 0 reports fully applied (got ${JSON.stringify(step0)})`);

// Staff: S senior mod, S2 senior mod, A admin, A2 admin, M mod, J JMD, MJ mod+jmd flags.
await q(`insert into public.user_roles (uid, is_admin, is_cmsr, is_moderator, is_baby_mod) values
  ('A', true, false, false, false), ('A2', true, false, false, false),
  ('S', false, true, false, false), ('S2', false, true, false, false),
  ('M', false, false, true, false), ('J', false, false, false, true),
  ('T', false, false, false, false)`);
const R = 'chat_new_upgrade', ES = 'chat_es_upgrade', RAID = 'chat_raid_upgrade';

// ── Reading the setting ─────────────────────────────────────────────────
ok((await as('U1', () => q(`select * from public.chat_slowmode`))).length === 0, 'user reads settings (empty)');
ok((await as('anon', () => q(`select * from public.chat_slowmode`))).length === 0, 'anon reads settings (empty)');
for (const [sql, label] of [
  [`insert into public.chat_slowmode (scope, seconds) values ('*', 300)`, 'insert'],
  [`update public.chat_slowmode set seconds = 0`, 'update'],
  [`delete from public.chat_slowmode`, 'delete'],
]) {
  const e = await err(() => as('S', () => q(sql)));
  ok(e && /permission denied/.test(e.message), `direct ${label} refused even for a Senior Mod (got ${e?.message})`);
}

// ── Who may set it ──────────────────────────────────────────────────────
for (const who of ['U1', 'T', 'J', 'M', 'OU']) {
  const e = await err(() => setSlow(who, '*', 30));
  ok(e && e.message === 'not authorized' && e.code === '42501', `${who} cannot set slow mode (got ${e?.message})`);
}
const anonSet = await err(() => setSlow('anon', '*', 30));
ok(anonSet && /permission denied for function/.test(anonSet.message), `anon key: no execute grant (got ${anonSet?.message})`);
// A token with claims but no uid (should not exist; the in-function check still holds).
await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'authenticated' })]);
await db.exec('set role authenticated');
const noUid = await err(() => one(`select public.set_chat_slowmode('*', 30)`));
await db.exec('reset role');
ok(noUid && noUid.message === 'not authorized', `claims without a uid refused (got ${noUid?.message})`);
ok((await setSlow('S', '*', 30)).r === 30, 'Senior Mod sets all rooms 30s');
ok((await one(`select set_by from public.chat_slowmode where scope = '*'`)).set_by === 'S', 'set_by stamped');
ok((await setSlow('A', R, 10)).r === 10, 'Admin sets one room');
ok((await setSlow('O', '*', 0)).r === 0, 'verified owner (no role row) sets all rooms off');
ok((await setSlow(null, R, 0)).r === 0, 'SQL editor (no claims) may set');
ok((await setSlow('service', '*', 0)).r === 0, 'service role may set');
for (const [scope, secs, label] of [['chat_nope_upgrade', 30, 'unknown room'], ['', 30, 'empty scope'], [null, 30, 'null scope'],
  ['*', 7, '7s'], ['*', -5, 'negative'], ['*', null, 'null seconds'], ['*', 3600, '1h']]) {
  const e = await err(() => setSlow('S', scope, secs));
  ok(e && e.code === '22023', `${label} refused with 22023 (got ${e?.code} ${e?.message})`);
}
ok((await as('U1', () => q(`select scope, seconds from public.chat_slowmode order by scope`))).length === 2, 'user sees both rows');

// ── Off: nothing changes ────────────────────────────────────────────────
for (let i = 0; i < 3; i++) ok(!!(await send('U1', R)), `off: rapid send ${i + 1}`);
const kept = await send('U1', R, { createdAt: '2020-01-01T00:00:00Z' });
ok(new Date(kept.created_at).getUTCFullYear() === 2020, 'off: created_at untouched (no behaviour change)');
const forged = await err(() => send('U1', R, { sender: 'U2' }));
ok(forged && /row-level security/.test(forged.message), 'RLS still pins sender_id to the caller');

// ── On: all rooms 30s ───────────────────────────────────────────────────
await setSlow('S', '*', 30);
await age('U1', 3600);
ok(!!(await send('U1', R)), 'on: first message passes');
const e1 = await err(() => send('U1', R));
ok(e1 && e1.message === 'SLOW_MODE' && e1.code === '23514', `on: second within 30s refused with SLOW_MODE/23514 (got ${e1?.code} ${e1?.message})`);
ok(e1 && /^\d+$/.test(e1.detail) && Number(e1.detail) >= 29 && Number(e1.detail) <= 30, `detail = seconds left (got ${e1?.detail})`);
ok(e1 && /wait \d+ seconds/.test(e1.hint), `hint text (got ${e1?.hint})`);
ok(!!(await send('U1', ES)), 'per room: another room is not blocked');
await age('U1', 20);
const e2 = await err(() => send('U1', R));
ok(e2 && Number(e2.detail) >= 9 && Number(e2.detail) <= 10, `20s later: ~10s left (got ${e2?.detail})`);
await age('U1', 11);
ok(!!(await send('U1', R)), '31s later: passes');

// Backdating is ignored while on.
await age('U1', 3600);
const bd = await send('U1', R, { createdAt: '2020-01-01T00:00:00Z' });
ok(new Date(bd.created_at).getUTCFullYear() !== 2020, 'on: client created_at replaced by now()');
const e3 = await err(() => send('U1', R, { createdAt: '2020-01-01T00:00:00Z' }));
ok(e3 && e3.message === 'SLOW_MODE', 'on: a backdated follow-up is still refused');

// A retry of a send that landed gets 23505 (every build returns the existing row).
await age('U1', 3600);
const cmid = '11111111-1111-4111-8111-111111111111';
ok(!!(await send('U1', R, { cmid })), 'send with client_msg_id');
const dup = await err(() => send('U1', R, { cmid }));
ok(dup && dup.code === '23505', `retry with the same client_msg_id → 23505, not SLOW_MODE (got ${dup?.code} ${dup?.message})`);
const fresh = await err(() => send('U1', R, { cmid: '22222222-2222-4222-8222-222222222222' }));
ok(fresh && fresh.message === 'SLOW_MODE', 'a new client_msg_id is still refused');

// Staff exempt; service role never checked.
for (const who of ['J', 'M', 'S', 'A', 'O']) {
  await send(who, R);
  ok(!!(await send(who, R)), `${who} (staff) exempt`);
}
await send('service', R, { sender: 'U9' });
ok(!!(await send('service', R, { sender: 'U9' })), 'service role (mirror CF / scripts) never checked');
await send('T', R);
const te = await err(() => send('T', R));
ok(te && te.message === 'SLOW_MODE', 'a user_roles row with no staff flag is not exempt');

// Ban check still wins (ban trigger aa fires before slow mode ad).
await send('U3', R);
await q(`insert into public.banned_senders (uid, reason, type) values ('U3', 'test', 'ban')`);
const be = await err(() => send('U3', R));
ok(be && be.message === 'SENDER_BANNED', `banned sender gets SENDER_BANNED first (got ${be?.message})`);

// ── Room setting vs all-rooms: the stricter wins ───────────────────────
await setSlow('S', '*', 0);
await setSlow('S', RAID, 60);
await age('U1', 3600);
await send('U1', RAID);
ok((await err(() => send('U1', RAID)))?.message === 'SLOW_MODE', 'room 60s, all-rooms off: room refuses');
ok(!!(await send('U1', R)) && !!(await send('U1', R)), 'room 60s, all-rooms off: other rooms free');
await setSlow('S', '*', 30);
await setSlow('S', RAID, 5);
await age('U1', 10);
const mx = await err(() => send('U1', RAID));
ok(mx && mx.message === 'SLOW_MODE' && Number(mx.detail) >= 19 && Number(mx.detail) <= 20, `room 5s, all-rooms 30s → 30s applies (got ${mx?.detail})`);

// ── Old builds read the error ───────────────────────────────────────────
// PostgREST hands supabase-js { code, message, details, hint }. Mapping copied
// from 4.0.22 Code/GlobelStats.js chatSendErrorCode + messageReports.chatErrorCode.
const pg = { code: e1.code, message: e1.message, details: e1.detail, hint: e1.hint };
const chatErrorCode = (error) => {
  const text = [error.message, error.details, error.hint].filter((s) => typeof s === 'string').join(' ');
  if (text.includes('SENDER_BANNED')) return 'SENDER_BANNED';
  if (text.includes('LINKS_NOT_ALLOWED')) return 'LINKS_NOT_ALLOWED';
  if (text.includes('NOT_ALLOWED')) return 'NOT_ALLOWED';
  if (error.code === '42501' || /row-level security/i.test(text)) return 'NOT_ALLOWED';
  return null;
};
const chatSendErrorCode = (error) => {
  const code = chatErrorCode(error);
  if (code) return code;
  const msg = String(error?.message || error?.details || '');
  if (/SENDER_BANNED/.test(msg)) return 'SENDER_BANNED';
  if (/LINKS_NOT_ALLOWED/.test(msg)) return 'LINKS_NOT_ALLOWED';
  if (/NOT_ALLOWED/.test(msg)) return 'NOT_ALLOWED';
  if (error?.code === '23514') return 'NOT_ALLOWED';
  return null;
};
ok(chatErrorCode(pg) === null, 'old chatErrorCode does not mistake SLOW_MODE for a known code');
ok(chatSendErrorCode(pg) === 'NOT_ALLOWED', '4.0.15+ builds: SLOW_MODE → NOT_ALLOWED ("Message not sent")');

// ── The lookup is index-backed ──────────────────────────────────────────
await db.exec('set enable_seqscan = off');
const plan = (await q(`explain select max(m.created_at) from public.messages m
  where m.sender_id = 'U1' and m.created_at > now() - interval '30 seconds' and m.room_id = '${R}'`))
  .map((r) => r['QUERY PLAN']).join('\n');
await db.exec('reset enable_seqscan');
ok(/idx_messages_sender_created/.test(plan), `last-message probe uses idx_messages_sender_created\n${plan}`);

// ── B. Reports about Senior Mod+ ────────────────────────────────────────
await setSlow('S', '*', 0);
await setSlow('S', RAID, 0);
await q(`delete from public.message_reports`);
// One reported message per sender rank; newest first: A (admin) … U2 (user).
const reportOn = async (sender, minutesAgo) => q(
  `insert into public.message_reports (table_name, message_id, reporter_uid, sender_uid, reason, created_at)
   values ('messages', gen_random_uuid(), 'R1', $1, 'spam', now() - make_interval(mins => $2))`, [sender, minutesAgo]);
await reportOn('U2', 50); await reportOn('J', 40); await reportOn('M', 30); await reportOn('S', 20); await reportOn('A', 10);
const listAs = async (who, limit = 50) => (await as(who, () => q(`select * from public.list_message_reports($1, null)`, [limit]))).map((r) => r.sender_uid);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok(same(await listAs('J'), ['M', 'J', 'U2']), `JMD: no Senior Mod / Admin reports (got ${await listAs('J')})`);
ok(same(await listAs('M'), ['M', 'J', 'U2']), `Mod: no Senior Mod / Admin reports (got ${await listAs('M')})`);
ok(same(await listAs('S'), ['M', 'J', 'U2']), `Senior Mod: not even reports about Senior Mods (got ${await listAs('S')})`);
ok(same(await listAs('S2'), ['M', 'J', 'U2']), 'another Senior Mod: same');
ok(same(await listAs('A'), ['A', 'S', 'M', 'J', 'U2']), `Admin (owner level): everything, own reports too (got ${await listAs('A')})`);
ok(same(await listAs('A2'), ['A', 'S', 'M', 'J', 'U2']), 'another Admin: reports about Admins too');
ok(same(await listAs('O'), ['A', 'S', 'M', 'J', 'U2']), `owner: everything (got ${await listAs('O')})`);
ok(same(await listAs('J', 1), ['M']), 'page limit applies after the filter (a hidden newer row does not eat the page)');
const ue = await err(() => listAs('U1'));
ok(ue && ue.message === 'not authorized', 'non-staff still refused');
const ou = await err(() => listAs('OU'));
ok(ou && ou.message === 'not authorized', 'unverified owner email still refused');
// A promotion is picked up at once (looked up when listing).
await q(`update public.user_roles set is_cmsr = true where uid = 'M'`);
ok(same(await listAs('J'), ['J', 'U2']), 'Mod promoted to Senior Mod: their reports leave the JMD view');
await q(`update public.user_roles set is_cmsr = false where uid = 'M'`);

// mod_read_private_chat: chat1 about a user, chat2 about a Senior Mod,
// chat3 about an Admin, chat4 reported both ways, chat5 legacy (no reported_uid).
await q(`insert into public.reported_chats (report_id, chat_id, reporter_uid, reported_uid) values
  ('r1', 'chat1', 'U1', 'U2'), ('r2', 'chat2', 'U1', 'S'), ('r3', 'chat3', 'U1', 'A'),
  ('r4a', 'chat4', 'U1', 'S2'), ('r4b', 'chat4', 'S2', 'U1'), ('r5', 'chat5', 'U1', null)`);
await q(`insert into public.private_messages (chat_id, sender_id, recipient_id, text) values ('chat2', 'U1', 'S', 'hi')`);
const readChat = (who, chat) => as(who, () => q(`select * from public.mod_read_private_chat($1, 50)`, [chat]));
const canRead = async (who, chat) => !(await err(() => readChat(who, chat)));
ok(await canRead('M', 'chat1') && await canRead('J', 'chat1') && await canRead('S', 'chat1'), 'staff read a chat reported about a user');
for (const who of ['J', 'M', 'S', 'S2']) {
  const e = await err(() => readChat(who, 'chat2'));
  ok(e && e.message === 'chat not reported', `${who} cannot open a chat reported about a Senior Mod (got ${e?.message})`);
  ok(!(await canRead(who, 'chat3')), `${who} cannot open a chat reported about an Admin`);
}
ok((await readChat('A', 'chat2')).length === 1, 'Admin reads the Senior Mod chat');
ok(await canRead('O', 'chat3'), 'owner reads the Admin chat');
ok(await canRead('A2', 'chat3'), 'another Admin reads the Admin chat');
ok(await canRead('M', 'chat4'), 'chat also reported about a user: readable as evidence for that report');
ok(await canRead('M', 'chat5'), 'legacy report with no reported_uid: unchanged');
ok(!(await canRead('M', 'chat9')), 'unreported chat still refused');
ok(!(await canRead('U1', 'chat1')), 'non-staff still refused');

console.log(`046: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
