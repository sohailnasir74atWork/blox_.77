/**
 * raid/core.js — Sea Beast Raid on the server (2026-10-31, Phase 1 step 2).
 * Rules in logic.js; wiring in index.js.
 *
 * Storage: Supabase (supabase/059_sea_beast_raid.sql) through the service
 * role — raid_days / raid_players / raid_rounds, reachable only from here.
 * Rewards that the app must see outside the game go to RTDB:
 *   users/{uid}/purchases/raid_pro             → proGranted → useIsAdFree (no ads)
 *   users/{uid}/shop/ownedItems/profileFrame   → My Cosmetics (boss frames)
 *   users/{uid}/shop/inventory                 → history row, same as Mystery Eggs
 *
 * Each handler: ({ uid, body, now }) → result object, or throws RaidError.
 * `io` is a plain object so tests replace it.
 */

const admin = require('firebase-admin');
const crypto = require('crypto');
const L = require('./logic');

if (!admin.apps.length) admin.initializeApp();

let supabaseAdmin = null;
const io = {
  sb: () => {
    if (!supabaseAdmin) supabaseAdmin = require('../_supabaseAdmin').getSupabaseAdmin();
    return supabaseAdmin;
  },
  db: () => admin.database(),
  verifyIdToken: (token) => admin.auth().verifyIdToken(token, true),
  now: () => Date.now(),
  uuid: () => crypto.randomUUID(),
  log: (...a) => console.log('[raid]', ...a),
};

class RaidError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status) => { throw new RaidError(code, status); };

async function rpc(name, args) {
  const { data, error } = await io.sb().rpc(name, args);
  if (error) {
    io.log(name, 'rpc error', error.message || error);
    fail('generic', 500);
  }
  return data;
}

const isPro = (body) => body && body.isPro === true;

/** Today's day row + the player's row, creating both on first sight. */
async function loadState(uid, now, { dayExists = false } = {}) {
  const day = L.dayKey(now);
  const boss = L.bossForDay(now);
  // The day row is created by the first call of the day; once a ticket exists it is there, so finish skips the extra round trip.
  const hpMax = dayExists ? boss.hp : L.bossHpMax(boss, await rpc('raid_prev_raiders', { p_day: day }));
  const st = await rpc('raid_state', { p_uid: uid, p_day: day, p_boss: boss.id, p_hp_max: hpMax });
  if (!st || !st.day || !st.player) fail('generic', 500);
  return { day: st.day, player: st.player, raidsUsed: Number(st.raidsUsed) || 0, share: Number(st.share) || 0, hasRoundToday: !!st.hasRoundToday, today: day };
}

/** RTDB: the PRO grant the app reads as Pro. */
async function writeProGrant(uid, proUntil, now, addedMs) {
  await io.db().ref(`users/${uid}/purchases/raid_pro`).set(L.proPurchaseRecord(proUntil, now, addedMs));
}
/** RTDB: a boss frame into My Cosmetics (+ history row). */
async function writeFrame(uid, frame, now) {
  const db = io.db();
  await Promise.all([
    db.ref(`users/${uid}/shop/ownedItems/profileFrame`).push(L.frameRecord(frame, now)),
    db.ref(`users/${uid}/shop/inventory`).push(L.inventoryRecord(frame, now)),
  ]);
}

/**
 * If today's boss is dead and this player raided today but has no crate yet,
 * grant it. Returns { loot, player } or null.
 */
async function claimCrateIfDue({ uid, st, pro, now }) {
  if (!st.day.killed || !st.hasRoundToday || st.player.crateDay === st.day.day) return null;
  const crate = L.bossCrate({ player: st.player, bossId: st.day.bossId, isPro: pro, now });
  const res = await rpc('raid_crate_claim', {
    p_uid: uid, p_day: st.day.day, p_frame: crate.frameId, p_title: crate.title,
    p_pro_until: crate.proMs ? new Date(crate.proUntil).toISOString() : null,
    p_pro_week_start: crate.proWeekStart, p_pro_week_ms: crate.proWeekMs, p_bounty: crate.bounty,
  });
  if (!res || res.error) return null; // already claimed / raced: nothing to add
  const writes = [];
  if (crate.proMs) writes.push(writeProGrant(uid, crate.proUntil, now, crate.proMs));
  if (crate.frame && res.frameNew) writes.push(writeFrame(uid, crate.frame, now));
  await Promise.all(writes);
  return { loot: crate.loot, player: res.player, bounty: crate.bounty };
}

/** raidState { isPro } → { state, crate? } */
async function state({ uid, body }) {
  const now = io.now();
  const st = await loadState(uid, now);
  const crate = await claimCrateIfDue({ uid, st, pro: isPro(body), now });
  if (crate) st.player = crate.player;
  return { state: L.stateForGame({ day: st.day, player: st.player, raidsUsed: st.raidsUsed, share: st.share, now }), crate: crate ? crate.loot : null };
}

/** raidStart { loadout, isPro } → { ticket, raidsUsed } */
async function start({ uid, body }) {
  const now = io.now();
  const loadout = L.cleanLoadout(body.loadout);
  if (!loadout) fail('bad_loadout');
  const st = await loadState(uid, now);
  if (st.day.killed) { /* a dead boss can still be raided for bounty; the crate was/will be claimed */ }
  const max = L.raidsAllowed(st.player, st.today, isPro(body), now);
  if (st.raidsUsed >= max) fail('capped');
  const ticket = io.uuid();
  const res = await rpc('raid_round_open', { p_uid: uid, p_day: st.today, p_boss: st.day.bossId, p_ticket: ticket, p_loadout: loadout, p_max: max });
  if (!res || res.error === 'capped') fail('capped');
  if (!res.ticket) fail('generic', 500);
  return { ticket, raidsUsed: Number(res.raidsUsed) || st.raidsUsed + 1 };
}

/** raidFinish { ticket, dmg, hits, dodged, best, ulted, secs, isPro } → the game's result payload */
async function finish({ uid, body }) {
  const now = io.now();
  const ticket = String(body.ticket || '');
  if (!ticket) fail('no_round');
  // round + state in parallel (latency: raidFinish took 9.9 s on 2026-10-31 with sequential calls)
  const [{ data: rows, error }, st] = await Promise.all([
    io.sb().from('raid_rounds').select('ticket, uid, day, boss_id, loadout, started_at, finished_at').eq('ticket', ticket).eq('uid', uid).limit(1),
    loadState(uid, now, { dayExists: true }),
  ]);
  if (error) { io.log('round read', error.message); fail('generic', 500); }
  const round = rows && rows[0];
  if (!round || round.finished_at) fail('no_round');
  const v = L.validateRound({ round: { loadout: round.loadout, startedAt: round.started_at, bossId: round.boss_id }, body, now });
  if (!v.ok) {
    // close the ticket so it cannot be retried with better numbers
    await rpc('raid_commit', commitArgs(uid, ticket, { dmg: 0, claimed: Number(body.dmg) || 0, valid: false, hits: 0, dodged: 0, best: 0, ulted: 0, secs: 0 }, null));
    fail(v.reason);
  }
  const pro = isPro(body);
  const rw = L.computeRewards({ player: st.player, v, isPro: pro, now });
  const res = await rpc('raid_commit', commitArgs(uid, ticket, v, rw));
  if (!res || res.error) fail(res && res.error === 'no_round' ? 'no_round' : 'generic', res && res.error ? 400 : 500);
  const writes = [];
  if (rw.proMs) writes.push(writeProGrant(uid, rw.proUntil, now, rw.proMs));
  let loot = rw.loot.slice();
  let player = res.player;
  // boss crate: this round killed it, or it was already dead and this player had none yet
  const st2 = { day: res.day, player, hasRoundToday: true };
  const crate = res.killedNow || (res.day.killed && player.crateDay !== res.day.day) ? await claimCrateIfDue({ uid, st: st2, pro, now }) : null;
  if (crate) { loot = loot.concat(crate.loot); player = crate.player; }
  await Promise.all(writes);
  const raidsUsed = st.raidsUsed; // the round being finished was already counted at start
  return Object.assign(
    L.stateForGame({ day: res.day, player, raidsUsed, share: Number(res.share) || 0, now }),
    { dmg: v.dmg, claimed: v.claimed, valid: v.valid, bounty: rw.bounty + (crate ? crate.bounty : 0), bountyTotal: player.bounty, chest: rw.chest, loot, killedNow: !!res.killedNow, rankUp: rw.rankUp },
  );
}

function commitArgs(uid, ticket, v, rw) {
  return {
    p_uid: uid, p_ticket: ticket,
    p_dmg: Math.round(v.dmg), p_dmg_claimed: Math.round(v.claimed), p_valid: !!v.valid,
    p_hits: v.hits, p_dodged: v.dodged, p_best: v.best, p_ulted: v.ulted, p_secs: v.secs,
    p_bounty: rw ? rw.bounty : 0, p_chest: rw ? rw.chest : null, p_pro_ms: rw ? rw.proMs : 0,
    p_rank: rw ? rw.rank : null, p_streak: rw ? rw.streak : null, p_last_raid_day: rw ? rw.lastRaidDay : null, p_streak_reward_day: rw ? rw.streakRewardDay : null,
    p_pro_until: rw && rw.proMs ? new Date(rw.proUntil).toISOString() : null, p_pro_week_start: rw ? rw.proWeekStart : null, p_pro_week_ms: rw ? rw.proWeekMs : null,
  };
}

/** raidRewarded { } → { raidsUsed, raidsAllowed } — the app saw the rewarded ad finish. */
async function rewarded({ uid }) {
  const now = io.now();
  const today = L.dayKey(now);
  const res = await rpc('raid_rewarded', { p_uid: uid, p_day: today });
  if (!res || !res.player) fail('generic', 500);
  return { adUnlocked: true, raidsAllowed: L.RAIDS_PER_DAY };
}

// Leaderboards: one cached copy per tab per instance, 60 s.
const lbCache = { today: { at: 0, day: null, rows: null }, all: { at: 0, rows: null } };
const LB_TTL_MS = 60 * 1000;
/** raidLeaderboard { tab } → { tab, rows:[{uid,name,value,rank}], me:{value,rank} } */
async function leaderboard({ uid, body }) {
  const now = io.now();
  const tab = body.tab === 'all' ? 'all' : 'today';
  const today = L.dayKey(now);
  const c = lbCache[tab];
  if (!c.rows || now - c.at > LB_TTL_MS || (tab === 'today' && c.day !== today)) {
    c.rows = tab === 'today' ? await rpc('raid_leaderboard_today', { p_day: today, p_limit: 50 }) : await rpc('raid_leaderboard_all', { p_limit: 50 });
    c.at = now; c.day = today;
  }
  const rows = Array.isArray(c.rows) ? c.rows.map((r) => ({ name: r.name, value: Number(r.value) || 0, rank: r.rank, me: r.uid === uid })) : [];
  let me = null;
  if (!rows.some((r) => r.me)) {
    const st = await loadState(uid, now);
    me = { value: tab === 'today' ? st.share : Number(st.player.bounty) || 0, rank: st.player.rank };
  }
  return { tab, rows, me };
}

module.exports = { io, RaidError, state, start, finish, rewarded, leaderboard, _internal: { loadState, claimCrateIfDue, commitArgs, lbCache } };
