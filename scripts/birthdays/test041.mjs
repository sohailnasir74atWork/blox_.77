// PGlite test (Blox) of supabase/041_birthday_short_list.sql (on top of 036–037).
// Port of adoptme-jan7/scripts/birthdays/test056.mjs; Blox has no squads.
//   node scripts/birthdays/test041.mjs
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';

const ROOT = '/Volumes/Sohail/AI_Projects/RunningApps/Blox_Fruit/supabase/';
const read = (f) => fs.readFileSync(ROOT + f, 'utf8');
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

await db.exec(`
  create role anon; create role authenticated;
  create function public.firebase_uid() returns text language sql stable as $$ select nullif(current_setting('test.uid', true), '') $$;
  create table public.user_identity_base (uid text primary key, display_name text, avatar text,
    date_of_birth text, created_at_ms bigint, last_activity_ms bigint);
  create table public.user_blocks (uid text not null, blocked_uid text not null, blocked_at_ms bigint, primary key (uid, blocked_uid));
`);
await db.exec(read('036_birthdays.sql'));
await db.exec(read('037_birthday_list_paged.sql'));
// What 002 provides on the live database (the columns 041 reads).
await db.exec(`
  create table public.chat_meta_data (owner_uid text not null, partner_uid text not null, primary key (owner_uid, partner_uid));
  create table public.group_meta_data (user_id text not null, group_id text not null, primary key (user_id, group_id));
`);
const SQL = read('041_birthday_short_list.sql');
await db.exec(SQL);
await db.exec(SQL); // idempotent

const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const shift = (days) => new Date(today.getTime() + days * 86400000);
const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const dob = (age, days = 0) => {
  const d = shift(days);
  return `${d.getUTCFullYear() - age}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
const OLD = Date.now() - 400 * 86400000;
const NOW = Date.now();
const add = (uid, name, d, active) =>
  q(`insert into user_identity_base(uid, display_name, date_of_birth, created_at_ms, last_activity_ms) values ($1,$2,$3,$4,$5)`, [uid, name, d, OLD, active]);

// 45 shown today (t00 most recently active), 7 tomorrow; never listed: hidden, minor, inactive, blocked.
const TODAY = [];
for (let i = 0; i < 45; i++) { const u = `t${String(i).padStart(2, '0')}`; TODAY.push(u); await add(u, `Today${i}`, dob(20, 0), NOW - i * 60000); }
for (let i = 0; i < 7; i++) await add(`n${i}`, `Tomorrow${i}`, dob(21, 1), NOW - i * 60000);
await add('H', 'Hidden', dob(22), NOW);
await add('M', 'Mini', dob(10), NOW);
await add('Z', 'Sleepy', dob(30), NOW - 60 * 86400000);
await add('B1', 'BlockedByViewer', dob(30), NOW);
await add('V', 'Viewer', dob(30, 100), NOW);
await add('VB', 'ViewerBirthday', dob(30, 0), NOW - 99 * 60000); // a viewer whose birthday is today
await rpc('set_birthday_visibility', [false], 'H');
await q(`insert into user_blocks(uid, blocked_uid) values ('V','B1')`);

// V knows: t40 by DM, t43 shares a group, t44 wished V last year.
await q(`insert into chat_meta_data values ('V','t40'), ('t39','V')`); // t39's row is theirs, not V's: no DM for V
await q(`insert into group_meta_data values ('V','g1'), ('t43','g1'), ('t38','g2')`);
await q(`insert into birthday_wishes(from_uid, to_uid, year, template) values ('t44','V',2020,'hbd')`);

const top = (uid = 'V', opts = {}) => rpc('list_birthdays_top', [opts.date ?? iso(today), opts.limit ?? 6], uid);

ok((await rpcErr('list_birthdays_top', [iso(today), 6], '')) === 'sign in required', 'anon refused');
const t1 = await top();
ok(t1.rows.length === 6, `6 rows (got ${t1.rows.length})`);
// V sees the 45 plus VB (also born today); B1 is hidden from V only.
ok(t1.total === 46 && t1.unwished === 46 && t1.tomorrow === 7, `counts (got ${t1.total}/${t1.unwished}/${t1.tomorrow})`);
ok(JSON.stringify(t1.rows.map((r) => r.uid)) === JSON.stringify(['t40', 't43', 't44', 't00', 't01', 't02']),
  `people V knows first, then activity (got ${t1.rows.map((r) => r.uid)})`);
ok(JSON.stringify(t1.rows.map((r) => r.reason)) === JSON.stringify(['dm', 'group', 'wished_you', null, null, null]),
  `reasons (got ${t1.rows.map((r) => r.reason)})`);
ok(['uid', 'name', 'avatar', 'month', 'day', 'until', 'wishes', 'wished', 'reason'].every((k) => k in t1.rows[0]), 'row shape');
const t20 = await top('V', { limit: 1000 });
ok(t20.rows.length === 20, 'limit clamps to 20');
const vb = await top('VB', { limit: 20 });
ok(!vb.rows.some((r) => r.uid === 'VB') && vb.total === 46, `the viewer is never in their own list (got total ${vb.total})`); // 45 + B1
const allV = await top('V', { limit: 20 });
ok(!allV.rows.some((r) => /^(H|M|Z|B1|V|n\d)$/.test(r.uid)), 'hidden, minor, inactive, blocked, tomorrow never listed');
const ahead = await top('V', { date: iso(shift(1)) });
ok(ahead.total === 7, 'phone date UTC+1 sees tomorrow as today');

// A single wish, then Wish everyone.
await rpc('send_birthday_wish', ['t40', 'hbd'], 'V');
const t2 = await top();
ok(t2.rows[0].wished === true && Number(t2.rows[0].wishes) === 1 && t2.unwished === 45, 'single wish counted');
const all = await rpc('wish_all_birthdays', [iso(today), 'party'], 'V');
ok(all.sent === 45 && all.left === 0 && all.limited === false, `wish all (got ${JSON.stringify(all)})`);
const t3 = await top();
ok(t3.unwished === 0 && t3.rows.every((r) => r.wished), 'everyone wished');
const again = await rpc('wish_all_birthdays', [iso(today), 'party'], 'V');
ok(again.sent === 0 && again.left === 0, 'wish all twice sends nothing');
ok(/bad template/.test(await rpcErr('wish_all_birthdays', [iso(today), 'spam'], 'V')), 'bad template refused');

// The daily limit is now 100 (was 50), shared by both calls.
await q(`insert into birthday_wishes(from_uid, to_uid, year, template, created_at)
         select 'L', 'x' || g, 2000, 'hbd', now() - interval '1 hour' from generate_series(1, 90) g`);
const lim = await rpc('wish_all_birthdays', [iso(today), 'party'], 'L');
// L sees 47: the 45, VB and B1 (blocked by V, not by L).
ok(lim.sent === 10 && lim.left === 37 && lim.limited === true, `limit stops wish all at 100 (got ${JSON.stringify(lim)})`);
ok(/wish limit/.test(await rpcErr('send_birthday_wish', ['t44', 'hbd'], 'L')), 'single wish refused at 100');
await q(`insert into birthday_wishes(from_uid, to_uid, year, template, created_at)
         select 'K', 'x' || g, 2000, 'hbd', now() - interval '1 hour' from generate_series(1, 60) g`);
ok((await rpcErr('send_birthday_wish', ['t00', 'hbd'], 'K')) === null, 'a 61st wish is fine (old limit was 50)');

// Thanks: t00 got wishes from V, L, K (and nobody else).
const h0 = await rpc('birthday_home', [], 't00');
ok(h0.thankPending === 3, `thankPending before (got ${h0.thankPending})`);
ok(/not their birthday/.test(await rpcErr('thank_birthday_wishers', [], 'V')), 'thanks only on your birthday');
const th = await rpc('thank_birthday_wishers', [], 't00');
ok(th.thanked === 3, `thanked 3 (got ${th.thanked})`);
ok((await rpc('birthday_home', [], 't00')).thankPending === 0, 'thankPending after');
ok((await rpc('thank_birthday_wishers', [], 't00')).thanked === 0, 'thanking twice is a no-op');
ok((await rpc('birthday_home', [], 'V')).thankPending === 0, 'thankPending 0 when not your birthday');

// t01 thanks too: V wished both, so V gets ONE push naming one of them, "+1 other".
await rpc('thank_birthday_wishers', [], 't01');
const batch = await q(`select * from public.birthday_thanks_push_batch(500)`);
const forV = batch.filter((r) => r.uid === 'V');
ok(forV.length === 1 && Number(forV[0].others) === 1 && /^Today[01]$/.test(forV[0].from_name), `one push for V (got ${JSON.stringify(forV)})`);
ok(batch.some((r) => r.uid === 'L') && batch.some((r) => r.uid === 'K'), 'L and K pushed');
ok((await q(`select * from public.birthday_thanks_push_batch(500)`)).length === 0, 'claimed: never pushed twice');
await rpc('thank_birthday_wishers', [], 't02');
const later = await q(`select * from public.birthday_thanks_push_batch(500)`);
ok(!later.some((r) => r.uid === 'V'), 'V gets at most one thanks push a day');
ok(Number((await one(`select count(*) n from birthday_wishes where thanked_at is not null and thank_pushed_at is null`)).n) === 0,
  'capped thanks are still claimed (nothing piles up)');

// Old calls still answer.
ok(Array.isArray((await rpc('list_birthdays_page', [iso(today), 1, 20, null], 'V')).rows), 'list_birthdays_page still works');
ok(Array.isArray((await rpc('birthday_home', [], 'V')).today), 'birthday_home still has today');

// Grants: the 3 client calls for authenticated only; internals for nobody.
const g = await q(`select routine_name, grantee from information_schema.routine_privileges where routine_schema='public'
                    and grantee in ('anon','PUBLIC','authenticated')`);
for (const fn of ['list_birthdays_top', 'wish_all_birthdays', 'thank_birthday_wishers', 'send_birthday_wish', 'birthday_home']) {
  ok(g.some((r) => r.routine_name === fn && r.grantee === 'authenticated'), `${fn}: authenticated`);
  ok(!g.some((r) => r.routine_name === fn && (r.grantee === 'anon' || r.grantee === 'PUBLIC')), `${fn}: no anon/public`);
}
for (const fn of ['_birthday_today_ranked', 'birthday_thanks_push_batch']) {
  ok(!g.some((r) => r.routine_name === fn), `${fn}: no client access`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
