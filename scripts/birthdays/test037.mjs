// PGlite test (Blox) of supabase/037_birthday_list_paged.sql (on top of 049–051, Pet Cards).
//   node scripts/birthdays/test037.mjs
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
const SQL = read('037_birthday_list_paged.sql');
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

// 45 shown today (distinct activity), 7 tomorrow, 5 in two days, 4 yesterday.
const TODAY = [], TOMORROW = [];
for (let i = 0; i < 45; i++) { const u = `t${String(i).padStart(2, '0')}`; TODAY.push(u); await add(u, `Today${i}`, dob(20, 0), NOW - i * 60000); }
for (let i = 0; i < 7; i++) { const u = `n${i}`; TOMORROW.push(u); await add(u, `Tomorrow${i}`, dob(21, 1), NOW - i * 60000); }
for (let i = 0; i < 5; i++) await add(`d${i}`, `Later${i}`, dob(22, 2), NOW);
for (let i = 0; i < 4; i++) await add(`y${i}`, `Yesterday${i}`, dob(23, -1), NOW);
// Never listed: hidden, minor, inactive, blocked, and the viewer's blocker.
await add('H', 'Hidden', dob(22), NOW);
await add('M', 'Mini', dob(10), NOW);
await add('Z', 'Sleepy', dob(30), NOW - 60 * 86400000);
await add('B1', 'BlockedByViewer', dob(30), NOW);
await add('B2', 'BlocksViewer', dob(30), NOW);
await add('V', 'Viewer', dob(30, 100), NOW);
await rpc('set_birthday_visibility', [false], 'H');
await q(`insert into user_blocks(uid, blocked_uid) values ('V','B1'), ('B2','V')`);

const page = (cursor = null, opts = {}) =>
  rpc('list_birthdays_page', [opts.date ?? iso(today), opts.days ?? 1, opts.limit ?? 20, cursor ? JSON.stringify(cursor) : null], opts.uid ?? 'V');

ok((await rpcErr('list_birthdays_page', [iso(today), 1, 20, null], '')) === 'sign in required', 'anon refused');

// First page
const p1 = await page();
ok(p1.rows.length === 20, `page 1 has 20 rows (got ${p1.rows.length})`);
ok(Array.isArray(p1.next) && p1.next.length === 3, 'page 1 has a next cursor');
ok(JSON.stringify(p1.counts) === JSON.stringify([45, 7]), `counts today/tomorrow (got ${JSON.stringify(p1.counts)})`);
ok(p1.rows.every((r) => r.until === 0), 'page 1 is all today');
ok(p1.rows[0].uid === 't00' && p1.rows[19].uid === 't19', 'most recently active first');
ok(['uid', 'name', 'avatar', 'month', 'day', 'until', 'wishes', 'wished'].every((k) => k in p1.rows[0]), 'row shape');

// Walk every page
const seen = [];
let cur = null, pages = 0, later;
do {
  const p = await page(cur);
  pages++;
  seen.push(...p.rows.map((r) => r.uid));
  if (pages > 1) ok(p.counts === null, 'counts only on the first page');
  cur = p.next;
  later = p;
} while (cur && pages < 10);
ok(pages === 3, `52 players in 3 pages (got ${pages})`);
ok(seen.length === 52 && new Set(seen).size === 52, `no repeats (got ${seen.length}, ${new Set(seen).size} distinct)`);
ok([...TODAY, ...TOMORROW].every((u) => seen.includes(u)), 'everyone today + tomorrow listed');
ok(!seen.some((u) => /^(d|y)\d|^(H|M|Z|B1|B2|V)$/.test(u)), 'nobody outside the window, hidden, minor, inactive or blocked');
ok(later.next === null, 'last page has no next');
ok(seen.indexOf('n0') > seen.indexOf('t44'), 'today before tomorrow');

// A player who becomes active between pages is not shown twice.
const a = await page();
await q(`update user_identity_base set last_activity_ms = $1 where uid = 't30'`, [NOW + 1000]);
const b = await page(a.next);
ok(!b.rows.some((r) => a.rows.map((x) => x.uid).includes(r.uid)), 'no repeat after an activity change');
await q(`update user_identity_base set last_activity_ms = $1 where uid = 't30'`, [NOW - 30 * 60000]);

// Days and limits
const d0 = await page(null, { days: 0, limit: 50 });
ok(d0.rows.length === 45 && d0.next === null && JSON.stringify(d0.counts) === '[45]', 'days 0 = today only');
const big = await page(null, { limit: 1000 });
ok(big.rows.length === 50, `limit clamps to 50 (got ${big.rows.length})`);
const tiny = await page(null, { limit: 0 });
ok(tiny.rows.length === 1, 'limit clamps to 1');

// The phone's date: a day ahead of UTC sees tomorrow's players as today.
const ahead = await page(null, { date: iso(shift(1)), days: 0, limit: 50 });
ok(ahead.rows.length === 7 && ahead.rows.every((r) => r.uid.startsWith('n')), 'phone date UTC+1');
const behind = await page(null, { date: iso(shift(-1)), days: 0, limit: 50 });
ok(behind.rows.length === 4 && behind.rows.every((r) => r.uid.startsWith('y')), 'phone date UTC-1');
const silly = await page(null, { date: iso(shift(40)), days: 0, limit: 50 });
ok(silly.rows.length === 45, 'a date outside ±1 day means UTC today');
const nodate = await rpc('list_birthdays_page', [null, 0, 50, null], 'V');
ok(nodate.rows.length === 45, 'no date means UTC today');

// Wishes
await rpc('send_birthday_wish', ['t05', 'hbd'], 'V');
await rpc('send_birthday_wish', ['t05', 'hbd'], 't01');
const w = (await page()).rows.find((r) => r.uid === 't05');
ok(w.wished === true && Number(w.wishes) === 2, `wished + count (got ${JSON.stringify(w)})`);
const w2 = (await page(null, { uid: 't02' })).rows.find((r) => r.uid === 't05');
ok(w2.wished === false && Number(w2.wishes) === 2, 'wished is per viewer');

// Bad cursor
ok(/bad cursor/.test(await rpcErr('list_birthdays_page', [iso(today), 1, 20, JSON.stringify({ a: 1 })], 'V')), 'object cursor refused');
ok(/bad cursor/.test(await rpcErr('list_birthdays_page', [iso(today), 1, 20, JSON.stringify([1, 2])], 'V')), 'short cursor refused');

// The old call still answers (builds already in testing use it).
const old = await rpc('list_birthdays', [7], 'V');
ok(Array.isArray(old) && old.length > 0, 'list_birthdays still works');

// grants
const g = await q(`select routine_name, grantee from information_schema.routine_privileges where routine_schema='public'
                    and routine_name = 'list_birthdays_page' and grantee in ('anon','PUBLIC','authenticated')`);
ok(g.some((r) => r.grantee === 'authenticated'), 'page: authenticated');
ok(!g.some((r) => r.grantee === 'anon' || r.grantee === 'PUBLIC'), 'no anon/public');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
