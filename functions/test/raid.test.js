/**
 * Sea Beast Raid handlers (functions/raid/core.js) against an in-memory
 * Supabase + RTDB double that follows supabase/059's semantics.
 *   node --test functions/test/raid.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG
  || JSON.stringify({ projectId: 'demo-fruiteblocks', databaseURL: 'https://demo-fruiteblocks-default-rtdb.firebaseio.com' });
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-fruiteblocks';

const core = require('../raid/core');
const L = require('../raid/logic');
const { handleRequest } = require('../raid/index')._internal;

const HOUR = 3600e3; const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 3, 12, 0, 0);

/** A tiny Supabase double: the RPCs of 059 over plain objects, plus from('raid_rounds').select().eq().eq().limit(). */
function fakeSupabase(now) {
  const days = {}; const players = {}; const rounds = {};
  const dayJson = (d) => ({ day: d.day, bossId: d.boss_id, hpMax: d.hp_max, hpLeft: d.hp_left, raiders: d.raiders, rounds: d.rounds, killed: !!d.killed_at, killedAt: d.killed_at || null });
  const playerJson = (p) => ({ uid: p.uid, bounty: p.bounty, rank: p.rank, streak: p.streak, lastRaidDay: p.last_raid_day, streakRewardDay: p.streak_reward_day, frames: p.frames.slice(), title: p.title, proUntil: p.pro_until || 0, proWeekStart: p.pro_week_start, proWeekMs: p.pro_week_ms, adUnlockedDay: p.ad_unlocked_day, crateDay: p.crate_day, raidsTotal: p.raids_total, bestDmg: p.best_dmg });
  const getPlayer = (uid) => (players[uid] = players[uid] || { uid, bounty: 0, rank: 'rookie', streak: 0, last_raid_day: null, streak_reward_day: null, frames: [], title: null, pro_until: null, pro_week_start: null, pro_week_ms: 0, ad_unlocked_day: null, crate_day: null, raids_total: 0, best_dmg: 0 });
  const roundsOf = (uid, day) => Object.values(rounds).filter((r) => r.uid === uid && r.day === day);
  const share = (uid, day) => roundsOf(uid, day).reduce((s, r) => s + r.dmg, 0);
  const rpcs = {
    raid_prev_raiders: ({ p_day }) => { const prev = L.dayKey(Date.parse(p_day) - DAY); return days[prev] ? days[prev].raiders : 0; },
    raid_state: ({ p_uid, p_day, p_boss, p_hp_max }) => {
      days[p_day] = days[p_day] || { day: p_day, boss_id: p_boss, hp_max: p_hp_max, hp_left: p_hp_max, raiders: 0, rounds: 0, killed_at: null };
      const rs = roundsOf(p_uid, p_day);
      return { day: dayJson(days[p_day]), player: playerJson(getPlayer(p_uid)), raidsUsed: rs.length, share: share(p_uid, p_day), hasRoundToday: rs.length > 0 };
    },
    raid_round_open: ({ p_uid, p_day, p_boss, p_ticket, p_loadout, p_max }) => {
      getPlayer(p_uid);
      for (const r of Object.values(rounds)) if (r.uid === p_uid && !r.finished_at) { r.finished_at = now(); r.valid = false; }
      const used = roundsOf(p_uid, p_day).length;
      if (used >= p_max) return { error: 'capped', raidsUsed: used };
      rounds[p_ticket] = { ticket: p_ticket, uid: p_uid, day: p_day, boss_id: p_boss, loadout: p_loadout, started_at: new Date(now()).toISOString(), finished_at: null, dmg: 0, valid: null };
      days[p_day].rounds += 1; if (used === 0) days[p_day].raiders += 1;
      return { ticket: p_ticket, raidsUsed: used + 1 };
    },
    raid_commit: (a) => {
      const r = rounds[a.p_ticket];
      if (!r || r.uid !== a.p_uid || r.finished_at) return { error: 'no_round' };
      Object.assign(r, { finished_at: now(), dmg: a.p_dmg, dmg_claimed: a.p_dmg_claimed, valid: a.p_valid, bounty: a.p_bounty, chest: a.p_chest, pro_ms: a.p_pro_ms });
      const d = days[r.day]; const wasAlive = !d.killed_at;
      d.hp_left = Math.max(0, d.hp_left - a.p_dmg); if (!d.killed_at && d.hp_left <= 0) d.killed_at = now();
      const p = getPlayer(a.p_uid);
      p.bounty += a.p_bounty; p.rank = a.p_rank || p.rank; p.streak = a.p_streak == null ? p.streak : a.p_streak;
      p.last_raid_day = a.p_last_raid_day || p.last_raid_day; p.streak_reward_day = a.p_streak_reward_day || p.streak_reward_day;
      if (a.p_pro_until) p.pro_until = Date.parse(a.p_pro_until); p.pro_week_start = a.p_pro_week_start || p.pro_week_start; if (a.p_pro_week_ms != null) p.pro_week_ms = a.p_pro_week_ms;
      p.raids_total += 1; p.best_dmg = Math.max(p.best_dmg, a.p_dmg);
      return { day: dayJson(d), player: playerJson(p), killedNow: wasAlive && !!d.killed_at, share: share(a.p_uid, r.day) };
    },
    raid_crate_claim: (a) => {
      const d = days[a.p_day]; if (!d || !d.killed_at) return { error: 'alive' };
      if (!roundsOf(a.p_uid, a.p_day).length) return { error: 'no_round' };
      const p = getPlayer(a.p_uid); if (p.crate_day === a.p_day) return { error: 'claimed' };
      p.crate_day = a.p_day; p.bounty += a.p_bounty || 0; if (a.p_bounty) p.rank = L.rankOf(p.bounty);
      if (a.p_frame && !p.frames.includes(a.p_frame)) p.frames.push(a.p_frame);
      p.title = p.title || a.p_title; if (a.p_pro_until) p.pro_until = Date.parse(a.p_pro_until);
      p.pro_week_start = a.p_pro_week_start || p.pro_week_start; if (a.p_pro_week_ms != null) p.pro_week_ms = a.p_pro_week_ms;
      return { player: playerJson(p), frameNew: !!a.p_frame && p.frames.includes(a.p_frame) };
    },
    raid_rewarded: ({ p_uid, p_day }) => { const p = getPlayer(p_uid); p.ad_unlocked_day = p_day; return { player: playerJson(p) }; },
    raid_leaderboard_today: ({ p_day, p_limit }) => {
      const by = {}; for (const r of Object.values(rounds)) if (r.day === p_day && r.valid != null) by[r.uid] = (by[r.uid] || 0) + r.dmg;
      return Object.entries(by).map(([uid, value]) => ({ uid, name: `N_${uid}`, value, rank: getPlayer(uid).rank })).sort((a, b) => b.value - a.value).slice(0, p_limit);
    },
    raid_leaderboard_all: ({ p_limit }) => Object.values(players).filter((p) => p.bounty > 0).sort((a, b) => b.bounty - a.bounty).slice(0, p_limit).map((p) => ({ uid: p.uid, name: `N_${p.uid}`, value: p.bounty, rank: p.rank })),
  };
  const calls = [];
  return {
    days, players, rounds, calls,
    rpc: async (name, args) => { calls.push(name); if (!rpcs[name]) return { data: null, error: { message: `no rpc ${name}` } }; return { data: rpcs[name](args), error: null }; },
    from: (table) => ({ select: () => ({ eq: (k1, v1) => ({ eq: (k2, v2) => ({ limit: async () => ({ data: Object.values(rounds).filter((r) => r[k1] === v1 && r[k2] === v2), error: null }) }) }) }) }),
  };
}

/** RTDB double: records set/push by path. */
function fakeDb() {
  const writes = [];
  const ref = (path) => ({
    set: async (v) => { writes.push({ op: 'set', path, v }); },
    push: async (v) => { writes.push({ op: 'push', path, v }); },
  });
  return { writes, ref };
}

function harness(startAt = T0) {
  let now = startAt; const sb = fakeSupabase(() => now); const db = fakeDb(); let n = 0;
  core.io.sb = () => sb; core.io.db = () => db; core.io.now = () => now; core.io.uuid = () => `tk-${++n}`; core.io.log = () => {};
  core.io.verifyIdToken = async (t) => { if (t === 'bad') throw new Error('bad'); return { uid: t }; };
  core._internal.lbCache.today.rows = null; core._internal.lbCache.all.rows = null;
  return { sb, db, tick: (ms) => { now += ms; }, get now() { return now; } };
}

async function raid(uid, h, { dmg, hits = 60, best = 25, dodged = 10, ulted = 1, loadout = { fruit: 'kitsune', sword: 'saber', style: 'combat' }, isPro = false, secs = 60 }) {
  const s = await core.start({ uid, body: { loadout, isPro } });
  h.tick(secs * 1000);
  return core.finish({ uid, body: { ticket: s.ticket, dmg, hits, best, dodged, ulted, secs, isPro } });
}

test('state creates the day and the player; the game state shape', async () => {
  const h = harness();
  const r = await core.state({ uid: 'A', body: {} });
  assert.strictEqual(r.crate, null);
  assert.deepStrictEqual(Object.keys(r.state).sort(), ['adUnlocked', 'bossId', 'bounty', 'day', 'frames', 'hpLeft', 'hpMax', 'killed', 'raiders', 'raidsUsed', 'resetAt', 'share', 'streak', 'title'].sort().concat(['proUntil']).sort());
  assert.strictEqual(r.state.day, '2026-11-03'); assert.strictEqual(r.state.bossId, L.bossForDay(T0).id);
  assert.strictEqual(r.state.hpMax, L.BOSS_HP_FLOOR); // no yesterday → floor
  assert.strictEqual(r.state.raidsUsed, 0); assert.strictEqual(r.state.resetAt, Date.UTC(2026, 10, 4));
  assert.ok(h.sb.days['2026-11-03'] && h.sb.players.A);
});

test('a legit raid: ticket, capped at 1 free, rewards, PRO written to RTDB', async () => {
  const h = harness();
  const s = await core.start({ uid: 'A', body: { loadout: { fruit: 'kitsune', sword: 'saber', style: 'combat' } } });
  assert.strictEqual(s.ticket, 'tk-1'); assert.strictEqual(s.raidsUsed, 1);
  await assert.rejects(core.start({ uid: 'A', body: { loadout: { fruit: 'kitsune', sword: 'saber', style: 'combat' } } }), (e) => e.code === 'capped');
  await assert.rejects(core.start({ uid: 'A', body: { loadout: { fruit: 'nope' } } }), (e) => e.code === 'bad_loadout');
  h.tick(60 * 1000);
  const r = await core.finish({ uid: 'A', body: { ticket: 'tk-1', dmg: 1000000, hits: 60, best: 25, dodged: 10, ulted: 1, secs: 60 } });
  assert.strictEqual(r.valid, true); assert.strictEqual(r.dmg, 1000000); assert.strictEqual(r.chest, 'gold');
  assert.deepStrictEqual(r.loot.map((l) => l.kind), ['bounty', 'pro', 'rankup']); // 1.0M dmg → pirate
  assert.strictEqual(r.bountyTotal, r.bounty); assert.strictEqual(r.rankUp, true);
  assert.strictEqual(r.hpLeft, L.BOSS_HP_FLOOR - 1000000); assert.strictEqual(r.share, 1000000); assert.strictEqual(r.raidsUsed, 1); assert.strictEqual(r.killedNow, false);
  assert.strictEqual(r.proUntil, h.now + 2 * HOUR + DAY);
  const pro = h.db.writes.find((w) => w.path === 'users/A/purchases/raid_pro');
  assert.ok(pro && pro.op === 'set'); assert.strictEqual(pro.v.title, 'Pro Membership (Weekly)'); assert.strictEqual(pro.v.expiresAt, r.proUntil);
  // the same ticket pays once
  await assert.rejects(core.finish({ uid: 'A', body: { ticket: 'tk-1', dmg: 1000000, secs: 60 } }), (e) => e.code === 'no_round');
  // someone else's ticket is not yours
  await assert.rejects(core.finish({ uid: 'B', body: { ticket: 'tk-1', dmg: 1, secs: 60 } }), (e) => e.code === 'no_round');
  // Pro active → 4 raids with no ad
  const s2 = await core.start({ uid: 'A', body: { loadout: { fruit: 'kitsune', sword: 'saber', style: 'combat' } } });
  assert.strictEqual(s2.raidsUsed, 2);
});

test('a cheat claim is paid at the cap and flagged; too fast pays nothing and burns the ticket', async () => {
  const h = harness();
  const r = await raid('C', h, { dmg: 9e9, hits: 60, best: 25 });
  assert.strictEqual(r.valid, false); assert.ok(r.dmg < 5e7); assert.strictEqual(r.dmg, h.sb.rounds['tk-1'].dmg); assert.strictEqual(h.sb.rounds['tk-1'].dmg_claimed, 9e9);
  const s = await core.start({ uid: 'D', body: { loadout: { fruit: 'dragon', sword: 'cdk', style: 'ds' } } });
  h.tick(500);
  await assert.rejects(core.finish({ uid: 'D', body: { ticket: s.ticket, dmg: 50000, secs: 60 } }), (e) => e.code === 'too_fast');
  assert.ok(h.sb.rounds[s.ticket].finished_at); assert.strictEqual(h.sb.rounds[s.ticket].dmg, 0);
  assert.strictEqual(h.sb.players.D.bounty, 0);
});

test('rewarded ad unlocks raids 2–4 today only', async () => {
  const h = harness();
  await raid('E', h, { dmg: 100000 });
  await assert.rejects(core.start({ uid: 'E', body: { loadout: { fruit: 'kitsune', sword: 'saber', style: 'combat' } } }), (e) => e.code === 'capped');
  const rw = await core.rewarded({ uid: 'E', body: {} });
  assert.deepStrictEqual(rw, { adUnlocked: true, raidsAllowed: 4 });
  const st = await core.state({ uid: 'E', body: {} }); assert.strictEqual(st.state.adUnlocked, true);
  await raid('E', h, { dmg: 100000 }); await raid('E', h, { dmg: 100000 }); await raid('E', h, { dmg: 100000 });
  await assert.rejects(core.start({ uid: 'E', body: { loadout: { fruit: 'kitsune', sword: 'saber', style: 'combat' } } }), (e) => e.code === 'capped');
  h.tick(DAY); // next day: ad is gone, 1 free again
  const st2 = await core.state({ uid: 'E', body: {} }); assert.strictEqual(st2.state.adUnlocked, false); assert.strictEqual(st2.state.raidsUsed, 0);
});

test('killing the boss: crate for the killer now, for an earlier raider on their next state call', async () => {
  const h = harness();
  const day = '2026-11-03';
  await core.state({ uid: 'A', body: {} });
  h.sb.days[day].hp_left = 1500000; // nearly dead
  await raid('B', h, { dmg: 800000 }); // B hits but does not kill
  const kill = await raid('A', h, { dmg: 900000 });
  assert.strictEqual(kill.killedNow, true); assert.strictEqual(kill.killed, true); assert.strictEqual(kill.hpLeft, 0);
  const kinds = kill.loot.map((l) => l.kind);
  assert.deepStrictEqual(kinds, ['bounty', 'pro', 'rankup', 'boss', 'boss_pro']); // gold chest + pirate rank-up + crate
  assert.deepStrictEqual(kill.frames, ['raid_' + h.sb.days[day].boss_id]); assert.strictEqual(kill.title, 'Raider');
  assert.strictEqual(kill.proUntil, h.now + 2 * HOUR + DAY + DAY);
  assert.strictEqual(kill.bountyTotal, kill.bounty);
  const frameWrites = h.db.writes.filter((w) => w.path === 'users/A/shop/ownedItems/profileFrame');
  assert.strictEqual(frameWrites.length, 1); assert.strictEqual(frameWrites[0].v.id, 'raid_' + h.sb.days[day].boss_id);
  assert.strictEqual(h.db.writes.filter((w) => w.path === 'users/A/shop/inventory').length, 1);
  // B opens the app later: the crate is granted on state
  const stB = await core.state({ uid: 'B', body: {} });
  assert.deepStrictEqual(stB.crate.map((l) => l.kind), ['boss', 'boss_pro']);
  assert.strictEqual(stB.state.title, 'Raider'); assert.strictEqual(stB.state.frames.length, 1);
  const stB2 = await core.state({ uid: 'B', body: {} }); assert.strictEqual(stB2.crate, null); // once
  // C never raided today: no crate
  const stC = await core.state({ uid: 'C', body: {} }); assert.strictEqual(stC.crate, null);
  // a raid after the kill still pays bounty, and the crate is not doubled for A
  h.sb.players.A.ad_unlocked_day = day;
  const after = await raid('A', h, { dmg: 300000 });
  assert.deepStrictEqual(after.loot.map((l) => l.kind), ['bounty']); assert.strictEqual(after.killedNow, false);
});

test('paid Pro: bounty instead of PRO time, no RTDB purchase write', async () => {
  const h = harness();
  const r = await raid('P', h, { dmg: 1.6e6, isPro: true });
  assert.deepStrictEqual(r.loot.map((l) => l.kind), ['bounty', 'pro_paid', 'rankup']);
  assert.strictEqual(h.db.writes.length, 0); assert.strictEqual(r.proUntil, 0);
});

test('leaderboards: cached 60 s, me appended when outside the rows', async () => {
  const h = harness();
  await raid('A', h, { dmg: 500000 }); await raid('B', h, { dmg: 700000 });
  const lb = await core.leaderboard({ uid: 'A', body: { tab: 'today' } });
  assert.deepStrictEqual(lb.rows.map((r) => [r.name, r.value, r.me]), [['N_B', 700000, false], ['N_A', 500000, true]]); assert.strictEqual(lb.me, null);
  const calls = h.sb.calls.filter((c) => c === 'raid_leaderboard_today').length;
  await core.leaderboard({ uid: 'A', body: { tab: 'today' } });
  assert.strictEqual(h.sb.calls.filter((c) => c === 'raid_leaderboard_today').length, calls); // cached
  const lbZ = await core.leaderboard({ uid: 'Z', body: { tab: 'all' } });
  assert.strictEqual(lbZ.rows.length, 2); assert.deepStrictEqual(lbZ.me, { value: 0, rank: 'rookie' });
  h.tick(61 * 1000);
  await core.leaderboard({ uid: 'A', body: { tab: 'today' } });
  assert.strictEqual(h.sb.calls.filter((c) => c === 'raid_leaderboard_today').length, calls + 1);
});

test('the day rolls over: new boss row, hp from yesterday raiders, streak continues', async () => {
  const h = harness();
  await raid('A', h, { dmg: 100000 }); await raid('B', h, { dmg: 100000 });
  h.tick(DAY);
  const st = await core.state({ uid: 'A', body: {} });
  assert.strictEqual(st.state.day, '2026-11-04'); assert.strictEqual(st.state.hpMax, L.bossHpMax(L.bossForDay(h.now), 2));
  const r = await raid('A', h, { dmg: 100000 });
  assert.strictEqual(r.streak, 2);
});

test('HTTP wiring: method, token, error codes', async () => {
  harness();
  const res = () => { const o = { code: 0, body: null, headers: {}, set(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send() { return this; } }; return o; };
  let r = res(); await handleRequest(core.state, { method: 'GET', headers: {} }, r); assert.strictEqual(r.code, 405);
  r = res(); await handleRequest(core.state, { method: 'OPTIONS', headers: {} }, r); assert.strictEqual(r.code, 204);
  r = res(); await handleRequest(core.state, { method: 'POST', headers: {} }, r); assert.deepStrictEqual([r.code, r.body], [401, { error: 'sign_in' }]);
  r = res(); await handleRequest(core.state, { method: 'POST', headers: { authorization: 'Bearer bad' } }, r); assert.strictEqual(r.code, 401);
  r = res(); await handleRequest(core.start, { method: 'POST', headers: { authorization: 'Bearer A' }, body: { loadout: { fruit: 'x' } } }, r); assert.deepStrictEqual([r.code, r.body], [400, { error: 'bad_loadout' }]);
  r = res(); await handleRequest(core.state, { method: 'POST', headers: { authorization: 'Bearer A' }, body: {} }, r); assert.strictEqual(r.code, 200); assert.ok(r.body.state);
  r = res(); await handleRequest(async () => { throw new Error('boom'); }, { method: 'POST', headers: { authorization: 'Bearer A' }, body: {} }, r); assert.deepStrictEqual([r.code, r.body], [500, { error: 'generic' }]);
});
