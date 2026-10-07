// PGlite test of supabase/036_birthdays.sql (Blox port of Adopt Me 049-051).
//   node scripts/birthdays/test036.mjs
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';

const SQL = fs.readFileSync('/Volumes/Sohail/AI_Projects/RunningApps/Blox_Fruit/supabase/036_birthdays.sql', 'utf8');
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL', msg); } };
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
const as = async (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid || '']);
const rpc = async (fn, args = [], uid = 'A') => {
  await as(uid);
  const ph = args.map((_, i) => `$${i + 1}`).join(',');
  return (await one(`select public.${fn}(${ph}) as r`, args)).r;
};
const rpcErr = async (fn, args = [], uid = 'A') => {
  try { await rpc(fn, args, uid); return null; } catch (e) { return e.message; }
};

// --- stubs for what Blox's live database already has (000, 003, 016, 029) ---
await db.exec(`
  create role anon; create role authenticated;
  create function public.firebase_uid() returns text language sql stable as $$ select nullif(current_setting('test.uid', true), '') $$;
  create table public.user_identity_base (uid text primary key, display_name text, avatar text,
    date_of_birth text, created_at_ms bigint, last_activity_ms bigint);
  create table public.user_blocks (uid text not null, blocked_uid text not null, blocked_at_ms bigint, primary key (uid, blocked_uid));
`);
await db.exec(SQL);
await db.exec(SQL); // idempotent

const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const shift = (days) => new Date(today.getTime() + days * 86400000);
const dob = (age, days = 0) => {
  const d = shift(days);
  return `${d.getUTCFullYear() - age}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
const OLD = Date.now() - 400 * 86400000;
const ACTIVE = Date.now() - 3600000;
const players = [
  ['A', 'Alice', dob(20), OLD, ACTIVE],          // adult, birthday today
  ['B', 'Bob', dob(25, 3), OLD, ACTIVE],         // adult, in 3 days
  ['D', 'Dana', dob(16), OLD, ACTIVE],           // 16, today
  ['M', 'Mini', dob(10), OLD, ACTIVE],           // 10, today (minor)
  ['N', 'Newbie', dob(19), Date.now(), ACTIVE],  // account today, birthday today
  ['F', 'Far', dob(30, 60), OLD, ACTIVE],        // in 60 days
  ['I', 'Idle', dob(22), OLD, OLD],              // today, but inactive 400 days
  ['X', 'NoDob', null, OLD, ACTIVE],
];
for (const [uid, name, d, created, active] of players) {
  await q(`insert into user_identity_base(uid, display_name, date_of_birth, created_at_ms, last_activity_ms) values ($1,$2,$3,$4,$5)`,
    [uid, name, d, created, active]);
}

// --- anon ---
ok((await rpcErr('get_my_birthday', [], '')) === 'sign in required', 'anon refused (mine)');
ok((await rpcErr('birthday_home', [], '')) === 'sign in required', 'anon refused (home)');
ok((await rpcErr('claim_birthday_gift', [], '')) === 'sign in required', 'anon refused (gift)');

// --- own birthday (shown by default since 050) ---
let me = await rpc('get_my_birthday', [], 'A');
ok(me.month === today.getUTCMonth() + 1 && me.day === today.getUTCDate(), 'A month/day');
ok(me.show === true && me.minor === false, 'adult shown by default');
ok(me.giftReady === true && me.giftOpened === false, 'A gift ready');
ok(me.canEdit === true, 'A can edit once');
ok(!JSON.stringify(me).match(/"year"|"age"|\d{4}-\d{2}-\d{2}/), 'no year/age/dob leaked');
ok((await rpc('get_my_birthday', [], 'X')).month === null, 'no DOB -> empty');
ok((await rpc('get_my_birthday', [], 'N')).giftReady === false, 'new account: no gift');
me = await rpc('get_my_birthday', [], 'M');
ok(me.minor === true && me.show === false, 'minor hidden by default');

// --- list + home ---
let list = await rpc('list_birthdays', [7], 'B');
let ids = list.map((x) => x.uid);
ok(ids.includes('A') && ids.includes('D') && ids.includes('B'), `list has A, D, B (got ${ids})`);
ok(!ids.includes('M'), 'minor never listed');
ok(!ids.includes('F'), '60 days away not in 7-day list');
ok(!ids.includes('I'), 'inactive 30+ days not listed');
await rpc('set_birthday_visibility', [false], 'D');
ok(!(await rpc('list_birthdays', [7], 'B')).some((x) => x.uid === 'D'), 'opted-out hidden');
await rpc('set_birthday_visibility', [true], 'D');
ok((await rpc('set_birthday_visibility', [true], 'M')).show === false, 'minor cannot show');
const home = await rpc('birthday_home', [], 'B');
const todayIds = (home.today || []).map((r) => r[0]);
ok(todayIds.includes('A') && todayIds.includes('D') && !todayIds.includes('M') && !todayIds.includes('I'), `home today list (got ${todayIds})`);
ok(home.month && 'giftReady' in home, 'home carries get_my_birthday');
ok(JSON.stringify(home).length < 4000, 'home stays small');
await q(`insert into user_blocks(uid, blocked_uid) values ('A', 'D')`);
ok(!(await rpc('list_birthdays', [7], 'A')).some((x) => x.uid === 'D'), 'block hides D for A');
ok(!(await rpc('birthday_home', [], 'D')).today.some((r) => r[0] === 'A'), 'block hides A on D home');

// --- public line ---
const pb = await rpc('get_public_birthday', ['B'], 'A');
ok(pb && pb.month && pb.day && Object.keys(pb).length === 2, 'public birthday: month/day only');
ok((await rpc('get_public_birthday', ['M'], 'A')) === null, 'minor profile: nothing');

// --- wishes ---
ok((await rpcErr('send_birthday_wish', ['B', 'hbd'], 'A')) === 'not their birthday', 'B not today');
ok((await rpcErr('send_birthday_wish', ['A', 'hbd'], 'A')) === 'cannot wish this player', 'no self wish');
ok((await rpcErr('send_birthday_wish', ['M', 'hbd'], 'A')) === 'cannot wish this player', 'no wish to minor');
ok((await rpcErr('send_birthday_wish', ['A', 'free text!'], 'B')) === 'bad template', 'templates only');
ok((await rpc('send_birthday_wish', ['A', 'party'], 'B')).wishes === 1, 'wish counted');
ok((await rpcErr('send_birthday_wish', ['A', 'hbd'], 'B')) === 'already wished', 'one wish per birthday');

// --- stars gift ---
const gift = await rpc('claim_birthday_gift', [], 'A');
ok(gift && gift.stars === 15, 'A gets 15 stars');
ok((await rpcErr('claim_birthday_gift', [], 'A')) === 'birthday gift not available', 'once per birthday');
ok((await rpcErr('claim_birthday_gift', [], 'B')) === 'birthday gift not available', 'not on another day');
ok((await rpcErr('claim_birthday_gift', [], 'N')) === 'birthday gift not available', 'not for a new account');
ok((await rpcErr('claim_birthday_gift', [], 'X')) === 'birthday gift not available', 'not without a DOB');
me = await rpc('get_my_birthday', [], 'A');
ok(me.giftReady === false && me.giftOpened === true, 'gift claimed');
ok((await rpc('claim_birthday_gift', [], 'M')).stars === 15, 'minor still gets the gift');

// --- pushes ---
const batch = (await q(`select * from public.birthday_push_batch(100) u`)).map((r) => r.u);
ok(batch.includes('A') && !batch.includes('N') && !batch.includes('B'), `birthday push batch (got ${batch})`);
ok((await q(`select * from public.birthday_push_batch(100) u`)).length === 0, 'birthday push once a year');
const wb = await q(`select * from public.birthday_wish_push_batch(100)`);
ok(wb.some((r) => r.kind === 'first' && r.uid === 'A' && r.from_name === 'Bob'), 'first-wish push for A from Bob');
ok((await q(`select * from public.birthday_wish_push_batch(100)`)).length === 0, 'first-wish push once');

// --- grants ---
const g = await q(`select routine_name, grantee from information_schema.routine_privileges
                    where routine_schema='public' and (routine_name like '%birthday%') and grantee in ('anon','authenticated','PUBLIC')`);
ok(!g.some((r) => r.grantee === 'anon' || r.grantee === 'PUBLIC'), 'no anon/public execute');
ok(!g.some((r) => r.routine_name.includes('push_batch')), 'push batches: server only');
ok(g.some((r) => r.routine_name === 'claim_birthday_gift' && r.grantee === 'authenticated'), 'gift: authenticated');
ok(g.some((r) => r.routine_name === 'birthday_home' && r.grantee === 'authenticated'), 'home: authenticated');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
