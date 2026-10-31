// PGlite test of supabase/059_sea_beast_raid.sql (no network).
//   node scripts/raid/test059.mjs
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';

const SQL = fs.readFileSync(new URL('../../supabase/059_sea_beast_raid.sql', import.meta.url), 'utf8');
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL', msg); } };
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
const rpc = async (fn, args = []) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(',');
  return (await one(`select public.${fn}(${ph}) as r`, args)).r;
};

// --- stubs for what Blox's live database already has ---
await db.exec(`
  create role anon; create role authenticated;
  create table public.user_identity_base (uid text primary key, display_name text, avatar text);
  insert into public.user_identity_base values ('A', 'ArhamYT', null), ('B', '', null);
`);
await db.exec(SQL);
await db.exec(SQL); // idempotent
ok(true, 'migration applied twice');

const DAY = '2026-11-03';
// state creates day + player
let st = await rpc('raid_state', ['A', DAY, 'doughking', 3200000000]);
ok(st.day.day === DAY && st.day.bossId === 'doughking' && st.day.hpLeft === 3200000000 && st.day.killed === false, 'day created ' + JSON.stringify(st.day));
ok(st.player.uid === 'A' && st.player.bounty === 0 && st.player.rank === 'rookie' && st.player.proUntil === 0 && Array.isArray(st.player.frames), 'player created ' + JSON.stringify(st.player));
ok(st.raidsUsed === 0 && st.share === 0 && st.hasRoundToday === false, 'fresh counters');
// a second call with another boss/hp does not change the day
st = await rpc('raid_state', ['A', DAY, 'tyrant', 1]);
ok(st.day.bossId === 'doughking' && st.day.hpMax === 3200000000, 'day row is stable');
ok((await rpc('raid_prev_raiders', ['2026-11-04'])) === 0 && (await rpc('raid_prev_raiders', [DAY])) === 0, 'prev raiders 0 before anyone raids');

// open a ticket; cap at p_max
let o = await rpc('raid_round_open', ['A', DAY, 'doughking', 't1', JSON.stringify({ fruit: 'magma', sword: 'cdk', style: 'godhuman' }), 1]);
ok(o.ticket === 't1' && o.raidsUsed === 1, 'ticket opened ' + JSON.stringify(o));
o = await rpc('raid_round_open', ['A', DAY, 'doughking', 't2', '{}', 1]);
ok(o.error === 'capped' && o.raidsUsed === 1, 'capped at 1 ' + JSON.stringify(o));
// the capped attempt abandoned t1 (finished, valid=false) — a new open with p_max 4 works and counts the abandoned one
let r1 = await one('select finished_at, valid from public.raid_rounds where ticket = $1', ['t1']);
ok(r1.finished_at !== null && r1.valid === false, 'open abandons the older open round');
o = await rpc('raid_round_open', ['A', DAY, 'doughking', 't2', '{}', 4]);
ok(o.ticket === 't2' && o.raidsUsed === 2, 'second ticket with ad ' + JSON.stringify(o));
let d = await one('select raiders, rounds from public.raid_days where day = $1', [DAY]);
ok(d.raiders === 1 && d.rounds === 2, 'day counters raiders 1 rounds 2 ' + JSON.stringify(d));
ok((await rpc('raid_prev_raiders', ['2026-11-04'])) === 1, 'prev raiders for tomorrow = 1');

// commit t1 → no_round (already closed); commit t2 pays
let c = await rpc('raid_commit', ['A', 't1', 1, 1, true, 1, 1, 1, 0, 60, 1, 'wood', 0, 'rookie', 1, DAY, null, null, DAY, 0]);
ok(c.error === 'no_round', 'closed ticket cannot pay');
const proUntil = new Date(Date.now() + 86400000).toISOString();
c = await rpc('raid_commit', ['A', 't2', 1000000, 1000000, true, 60, 10, 25, 1, 60, 1300000, 'gold', 7200000, 'pirate', 1, DAY, null, proUntil, DAY, 7200000]);
ok(!c.error && c.day.hpLeft === 3200000000 - 1000000 && c.killedNow === false && c.share === 1000000, 'commit took damage off the boss ' + JSON.stringify(c.day));
ok(c.player.bounty === 1300000 && c.player.rank === 'pirate' && c.player.streak === 1 && c.player.lastRaidDay === DAY && c.player.proWeekMs === 7200000 && c.player.raidsTotal === 1 && c.player.bestDmg === 1000000, 'player progression ' + JSON.stringify(c.player));
ok(Math.abs(c.player.proUntil - Date.parse(proUntil)) < 1000, 'pro_until mirrored');
c = await rpc('raid_commit', ['A', 't2', 1, 1, true, 1, 1, 1, 0, 60, 1, 'wood', 0, null, null, null, null, null, null, null]);
ok(c.error === 'no_round', 'a ticket pays once');
// crate before the kill → alive
let cr = await rpc('raid_crate_claim', ['A', DAY, 'raid_doughking', 'Raider', null, null, null, 0]);
ok(cr.error === 'alive', 'no crate while the boss lives');

// B kills it
await rpc('raid_round_open', ['B', DAY, 'doughking', 'tb', '{}', 1]);
await db.query('update public.raid_days set hp_left = 500000 where day = $1', [DAY]);
c = await rpc('raid_commit', ['B', 'tb', 900000, 900000, true, 50, 5, 20, 1, 60, 800000, 'gold', 0, 'rookie', 1, DAY, null, null, DAY, 0]);
ok(c.killedNow === true && c.day.killed === true && c.day.hpLeft === 0, 'kill detected ' + JSON.stringify(c.day));
d = await one('select raiders from public.raid_days where day = $1', [DAY]);
ok(d.raiders === 2, 'two distinct raiders');
// B claims the crate (+ bounty from a cap excess), once; C who never raided cannot
cr = await rpc('raid_crate_claim', ['B', DAY, 'raid_doughking', 'Raider', proUntil, DAY, 86400000, 250000]);
ok(!cr.error && cr.frameNew === true && cr.player.frames.length === 1 && cr.player.title === 'Raider' && cr.player.crateDay === DAY && cr.player.bounty === 1050000 && cr.player.rank === 'pirate', 'crate claimed ' + JSON.stringify(cr));
cr = await rpc('raid_crate_claim', ['B', DAY, 'raid_doughking', 'Raider', null, null, null, 0]);
ok(cr.error === 'claimed', 'crate once per day');
cr = await rpc('raid_crate_claim', ['C', DAY, 'raid_doughking', 'Raider', null, null, null, 0]);
ok(cr.error === 'no_round', 'no crate without a raid that day');
// A claims too: frame not duplicated on a second day later
cr = await rpc('raid_crate_claim', ['A', DAY, 'raid_doughking', 'Raider', null, null, null, 0]);
ok(!cr.error && cr.frameNew === true, 'A gets the crate');
await db.query(`insert into public.raid_days (day, boss_id, hp_max, hp_left, killed_at) values ('2026-11-04', 'doughking', 10, 0, now())`);
await rpc('raid_round_open', ['A', '2026-11-04', 'doughking', 'ta2', '{}', 1]);
cr = await rpc('raid_crate_claim', ['A', '2026-11-04', 'raid_doughking', 'Raider', null, null, null, 0]);
ok(!cr.error && cr.player.frames.length === 1 && cr.frameNew === true, 'same frame twice stays one entry');

// state after: share, hasRoundToday
st = await rpc('raid_state', ['B', DAY, 'doughking', 1]);
ok(st.share === 900000 && st.raidsUsed === 1 && st.hasRoundToday === true && st.day.killed === true, 'state reflects the raid ' + JSON.stringify(st));
// rewarded
const rw = await rpc('raid_rewarded', ['Z', DAY]);
ok(rw.player.adUnlockedDay === DAY && rw.player.uid === 'Z', 'rewarded creates + unlocks');

// leaderboards
const lt = await rpc('raid_leaderboard_today', [DAY, 50]);
ok(Array.isArray(lt) && lt.length === 2 && lt[0].uid === 'A' && lt[0].value === 1000000 && lt[0].name === 'ArhamYT' && lt[0].rank === 'pirate' && lt[1].name === 'Pirate', 'today board ' + JSON.stringify(lt));
const la = await rpc('raid_leaderboard_all', [50]);
ok(la.length === 2 && la[0].uid === 'A' && la[0].value === 1300000 && la[1].uid === 'B' && la[1].value === 1050000, 'all-time board ' + JSON.stringify(la));
ok((await rpc('raid_leaderboard_today', ['2026-11-09', 50])).length === 0, 'empty day → []');

// grants: anon / authenticated have nothing
for (const fn of ['raid_state(text,date,text,bigint)', 'raid_round_open(text,date,text,text,jsonb,int)', 'raid_commit(text,text,bigint,bigint,boolean,int,int,int,int,int,bigint,text,bigint,text,int,date,date,timestamptz,date,bigint)', 'raid_crate_claim(text,date,text,text,timestamptz,date,bigint,bigint)', 'raid_rewarded(text,date)', 'raid_leaderboard_today(date,int)', 'raid_leaderboard_all(int)', 'raid_delete_user(text)', 'raid_prev_raiders(date)']) {
  const g = await one(`select has_function_privilege('anon', 'public.${fn}', 'execute') as a, has_function_privilege('authenticated', 'public.${fn}', 'execute') as b`);
  ok(g.a === false && g.b === false, 'no execute for anon/authenticated on ' + fn);
}
for (const t of ['raid_days', 'raid_players', 'raid_rounds']) {
  const g = await one(`select has_table_privilege('anon', 'public.${t}', 'select') as a, has_table_privilege('authenticated', 'public.${t}', 'select') as b, relrowsecurity as rls from pg_class where relname = '${t}'`);
  ok(g.a === false && g.b === false && g.rls === true, 'rls on, no select for anon/authenticated on ' + t);
}

// delete user
await rpc('raid_delete_user', ['A']);
ok((await one('select count(*)::int as n from public.raid_rounds where uid = $1', ['A'])).n === 0 && (await one('select count(*)::int as n from public.raid_players where uid = $1', ['A'])).n === 0, 'delete user removes rows');

console.log(`059: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
