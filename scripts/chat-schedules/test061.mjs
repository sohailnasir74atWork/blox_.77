// PGlite test of supabase/061_chat_schedules.sql (scheduled public-chat
// messages). Stubs what 001 / 005 / 029 / 045 / 047 provide on the live db.
//   node scripts/chat-schedules/test061.mjs
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';

const SQL = fs.readFileSync('/Volumes/Sohail/AI_Projects/RunningApps/Blox_Fruit/supabase/061_chat_schedules.sql', 'utf8');
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL', msg); } };
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
const as = async (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid || '']);
const rpc = async (fn, args = [], uid = 'SM') => {
  await as(uid);
  const ph = args.map((_, i) => `$${i + 1}`).join(',');
  return (await one(`select public.${fn}(${ph}) as r`, args)).r;
};
const rpcErr = async (fn, args = [], uid = 'SM') => {
  try { await rpc(fn, args, uid); return null; } catch (e) { return e.message; }
};
const save = (p, uid) => rpc('chat_schedule_save', [JSON.stringify(p)], uid);
const saveErr = (p, uid) => rpcErr('chat_schedule_save', [JSON.stringify(p)], uid);
const tick = async () => { await as(''); return (await one('select public.chat_schedules_tick() as n')).n; };
const count = async (where = 'true') => Number((await one(`select count(*)::int as n from public.messages where ${where}`)).n);
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const MIN = 60000;

await db.exec(`
  create role anon; create role authenticated;
  create function public.firebase_uid() returns text language sql stable as $$ select nullif(current_setting('test.uid', true), '') $$;
  create function public.is_senior_mod_staff() returns boolean language sql stable as $$ select coalesce(public.firebase_uid() in ('SM', 'ADM'), false) $$;
  create table public.user_identity_base (uid text primary key, display_name text, avatar text);
  create table public.user_roles (uid text primary key, is_admin boolean not null default false, custom_title text,
    updated_at timestamptz not null default now());
  create table public.rooms (id text primary key, label text not null, language text, category text not null,
    created_at timestamptz not null default now());
  insert into public.rooms (id, label, language, category) values
    ('chat_new_upgrade', 'English', 'en', 'core'), ('chat_es_upgrade', 'Español', 'es', 'language'),
    ('chat_ja_upgrade', '日本語', 'ja', 'language');
  create table public.messages (id uuid primary key default gen_random_uuid(), room_id text not null references public.rooms(id),
    sender_id text not null, text text, os text, client_msg_id uuid, created_at timestamptz not null default now());
  create unique index on public.messages (room_id, client_msg_id) where client_msg_id is not null;
`);
await db.exec(SQL);
await db.exec(SQL); // re-runnable

// Bot identity
ok((await one(`select display_name from public.user_identity_base where uid = 'announcements_bot'`))?.display_name === 'Announcements', 'bot name');
ok((await one(`select custom_title from public.user_roles where uid = 'announcements_bot'`))?.custom_title === 'BOT', 'bot title');

// Permissions
ok(/NOT_ALLOWED/.test(await rpcErr('chat_schedules_list', [], 'MOD')), 'plain mod refused list');
ok(/NOT_ALLOWED/.test(await saveErr({ title: 'x', messages: [{ room_id: 'chat_new_upgrade', text: 'hi' }], start_at: iso(0) }, '')), 'anon refused save');
const list0 = await rpc('chat_schedules_list');
ok(list0.rooms.length === 3 && list0.rows.length === 0, 'list rooms + empty rows');

// Validation
const base = { title: 'Rules', messages: [{ room_id: 'chat_new_upgrade', text: 'Read the rules' }, { room_id: 'chat_es_upgrade', text: 'Lee las reglas' }], start_at: iso(0) };
ok(/MUST_END/.test(await saveErr({ ...base, interval_minutes: 60 })), 'repeat without end refused');
ok(/BAD_INTERVAL/.test(await saveErr({ ...base, interval_minutes: 5, max_runs: 3 })), 'interval < 10 refused');
ok(/BAD_END/.test(await saveErr({ ...base, interval_minutes: 60, end_at: iso(61 * 24 * 60 * MIN) })), 'end > 60 days refused');
ok(/BAD_ROOM/.test(await saveErr({ ...base, messages: [{ room_id: 'chat_zz', text: 'x' }] })), 'unknown room refused');
ok(/BAD_ROOM/.test(await saveErr({ ...base, messages: [{ room_id: 'chat_new_upgrade', text: 'a' }, { room_id: 'chat_new_upgrade', text: 'b' }] })), 'duplicate room refused');
ok(/BAD_TEXT/.test(await saveErr({ ...base, messages: [{ room_id: 'chat_new_upgrade', text: '  ' }] })), 'empty text refused');
ok(/BAD_TEXT/.test(await saveErr({ ...base, messages: [{ room_id: 'chat_new_upgrade', text: 'x'.repeat(501) }] })), 'long text refused');
ok(/BAD_START/.test(await saveErr({ ...base, start_at: iso(-60 * MIN) })), 'past start refused');
ok(/BAD_MAX_RUNS/.test(await saveErr({ ...base, interval_minutes: 60, max_runs: 501 })), 'max_runs > 500 refused');

// Repeating schedule: every 60 min, 3 runs, two rooms
const rep = await save({ ...base, interval_minutes: 60, max_runs: 3, by_name: 'Sam' });
ok(rep.active && rep.next_run_at && rep.runs_done === 0 && rep.created_by === 'SM', 'saved repeating');
ok(await tick() === 2, 'tick posts one per room');
ok(await count(`sender_id = 'announcements_bot'`) === 2, '2 bot messages');
ok(await count(`room_id = 'chat_es_upgrade' and text = 'Lee las reglas'`) === 1, 'per-room text');
ok(await tick() === 0, 'nothing due right after');
let r = await one(`select * from public.chat_schedules where id = $1`, [rep.id]);
ok(r.runs_done === 1 && new Date(r.next_run_at) > new Date(), 'run 1 done, next in future');

// Simulate time passing: move the whole schedule back 60 min
const shift = (id, mins) => db.query(`update public.chat_schedules set start_at = start_at - make_interval(mins => $2),
  next_run_at = next_run_at - make_interval(mins => $2) where id = $1`, [id, mins]);
await shift(rep.id, 60);
ok(await tick() === 2, 'run 2 posts');
await shift(rep.id, 60);
ok(await tick() === 2, 'run 3 posts');
r = await one(`select * from public.chat_schedules where id = $1`, [rep.id]);
ok(r.runs_done === 3 && r.next_run_at === null && r.active === false, 'finished after max_runs');
await shift(rep.id, 60);
ok(await tick() === 0, 'finished schedule never posts again');
ok(await count(`sender_id = 'announcements_bot'`) === 6, '6 messages total');

// Cron down for 3 hours: no backlog, jumps to the next future slot
const late = await save({ ...base, title: 'Late', messages: [{ room_id: 'chat_ja_upgrade', text: 'こんにちは' }], interval_minutes: 30, end_at: iso(24 * 60 * MIN) });
await db.query(`update public.chat_schedules set start_at = start_at - interval '3 hours', next_run_at = next_run_at - interval '3 hours', end_at = end_at - interval '3 hours' where id = $1`, [late.id]);
ok(await tick() === 0, 'late slot skipped, not posted');
r = await one(`select * from public.chat_schedules where id = $1`, [late.id]);
ok(r.active && new Date(r.next_run_at) > new Date() && new Date(r.next_run_at) - new Date() <= 30 * MIN, 'jumped to next future slot');

// Pause / resume
let pr = await rpc('chat_schedule_set_active', [late.id, false]);
ok(pr.active === false, 'paused');
await db.query(`update public.chat_schedules set next_run_at = now() - interval '1 minute' where id = $1`, [late.id]);
ok(await tick() === 0, 'paused does not post');
pr = await rpc('chat_schedule_set_active', [late.id, true]);
ok(pr.active && new Date(pr.next_run_at) > new Date(), 'resume picks a future slot');

// One-shot, missed by > 15 min, finishes instead of looping
const once = await save({ ...base, title: 'Once', messages: [{ room_id: 'chat_new_upgrade', text: 'once' }] });
ok(once.interval_minutes === null && once.max_runs === null, 'one-shot saved');
await db.query(`update public.chat_schedules set start_at = now() - interval '20 minutes', next_run_at = now() - interval '20 minutes' where id = $1`, [once.id]);
ok(await tick() === 0, 'missed one-shot not posted');
r = await one(`select * from public.chat_schedules where id = $1`, [once.id]);
ok(r.active === false && r.next_run_at === null, 'missed one-shot finished');

// One-shot on time posts once
const once2 = await save({ ...base, title: 'Once2', messages: [{ room_id: 'chat_new_upgrade', text: 'once2' }] });
ok(await tick() === 1 && await tick() === 0, 'one-shot posts exactly once');
ok(await count(`text = 'once2'`) === 1, 'one once2 message');

// Edit: change text, keep start -> runs_done kept
const ed = await save({ ...base, id: rep.id, title: 'Rules v2', interval_minutes: 60, max_runs: 3, start_at: r.start_at ? (await one(`select start_at from public.chat_schedules where id=$1`, [rep.id])).start_at.toISOString() : iso(0) });
ok(ed.title === 'Rules v2' && ed.runs_done === 3 && ed.active === false && ed.next_run_at === null, 'edit keeps runs + finished');
const ed2 = await save({ ...base, id: rep.id, title: 'Rules v3', interval_minutes: 60, max_runs: 3, start_at: iso(10 * MIN) });
ok(ed2.runs_done === 0 && ed2.active && ed2.next_run_at, 'edit with new start restarts');


// Delete
ok(await rpc('chat_schedule_delete', [late.id]) === true, 'deleted');
ok(/NOT_ALLOWED/.test(await rpcErr('chat_schedule_delete', [rep.id], 'MOD')), 'plain mod refused delete');
ok((await rpc('chat_schedules_list')).rows.length === 3, 'list after delete');

// Grants: anon cannot touch the table or the tick
const grants = await q(`select has_function_privilege('anon', 'public.chat_schedules_tick()', 'execute') a,
  has_function_privilege('authenticated', 'public.chat_schedules_tick()', 'execute') b,
  has_function_privilege('authenticated', 'public.chat_schedule_save(jsonb)', 'execute') c,
  has_table_privilege('authenticated', 'public.chat_schedules', 'select') d`);
ok(!grants[0].a && !grants[0].b && grants[0].c && !grants[0].d, 'grants');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
