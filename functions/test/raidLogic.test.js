/**
 * Sea Beast Raid rules (functions/raid/logic.js) — pure, no emulators.
 *   node --test functions/test/raidLogic.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../raid/logic');

const HOUR = 3600e3; const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0); // 2026-11-03 12:00Z
const TODAY = '2026-11-03'; const YESTERDAY = '2026-11-02';
const player = (o) => Object.assign({ bounty: 0, streak: 0, lastRaidDay: null, streakRewardDay: null, proUntil: 0, proWeekStart: null, proWeekMs: 0, adUnlockedDay: null, crateDay: null, frames: [], title: null }, o);
const loadout = (fruit = 'kitsune', sword = 'saber', style = 'combat') => ({ fruit, sword, style });

// The app's copy of the rules (Code/Raid/raidBridge.js is an ES module; evaluate its consts).
function appRules() {
  const src = fs.readFileSync(path.join(__dirname, '../../Code/Raid/raidBridge.js'), 'utf8');
  const body = src.replace(/^export const /gm, 'exports.').replace(/^export function (\w+)/gm, 'exports.$1 = function $1');
  const exp = {};
  // eslint-disable-next-line no-new-func
  new Function('exports', body)(exp);
  return exp.RAID_RULES;
}

test('server tables equal the app bridge tables', () => {
  const R = appRules();
  assert.deepStrictEqual(L.FRUITS.map((f) => f.id), R.FRUIT_IDS);
  assert.deepStrictEqual(L.SWORDS.map((f) => f.id), R.SWORD_IDS);
  assert.deepStrictEqual(L.STYLES.map((f) => f.id), R.STYLE_IDS);
  assert.deepStrictEqual(L.BOSSES.map((b) => b.id), R.BOSS_IDS);
  assert.deepStrictEqual(Object.fromEntries(L.BOSSES.map((b) => [b.id, b.weak])), R.BOSS_WEAK);
  assert.deepStrictEqual(L.RANKS, R.RANKS);
  assert.deepStrictEqual(L.CHESTS, R.CHESTS);
  assert.deepStrictEqual(L.RANK_PRO, R.RANK_PRO);
  assert.deepStrictEqual(L.STREAK_PRO, R.STREAK_PRO);
  assert.strictEqual(L.BOSS_CRATE_PRO, R.BOSS_CRATE_PRO);
  assert.strictEqual(L.DMG_SCALE, R.DMG_SCALE);
  assert.deepStrictEqual([L.RAIDS_FREE, L.RAIDS_PER_DAY, L.ROUND_SECS], [R.RAIDS_FREE, R.RAIDS_PER_DAY, R.ROUND_SECS]);
});

test('server fruit/sword/style stats equal the game file', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../Code/Raid/game/raid.html'), 'utf8');
  const gameConst = (name) => {
    const start = html.indexOf(`const ${name} = `) + `const ${name} = `.length;
    // eslint-disable-next-line no-new-func
    return Function('HOUR', 'DAY', `return ${html.slice(start, html.indexOf(';\n', start))}`)(HOUR, DAY);
  };
  assert.deepStrictEqual(gameConst('FRUITS').map((f) => ({ id: f.id, pow: f.pow, spd: f.spd, ult: f.ult })), L.FRUITS);
  assert.deepStrictEqual(gameConst('SWORDS').map((f) => ({ id: f.id, pow: f.pow, cd: f.cd })), L.SWORDS);
  assert.deepStrictEqual(gameConst('STYLES').map((f) => ({ id: f.id, spd: f.spd, ult: f.ult })), L.STYLES);
  assert.deepStrictEqual(gameConst('BOSSES').map((b) => ({ id: b.id, hp: b.hp, weak: b.weak })), L.BOSSES);
});

test('day keys, boss rotation, reset, hp', () => {
  assert.strictEqual(L.dayKey(NOW), TODAY);
  assert.strictEqual(L.yesterdayKey(NOW), YESTERDAY);
  assert.strictEqual(L.resetAt(NOW), Date.UTC(2026, 10, 4));
  const ids = [0, 1, 2, 3, 4, 5].map((d) => L.bossForDay(NOW + d * DAY).id);
  assert.deepStrictEqual(ids.slice(0, 5).sort(), L.BOSSES.map((b) => b.id).sort());
  assert.strictEqual(ids[5], ids[0]);
  const boss = L.bossById('seabeast');
  assert.strictEqual(L.bossHpMax(boss, 0), 5e8);
  assert.strictEqual(L.bossHpMax(boss, 1800), Math.round(1800 * 1.1e6 * 1.3));
  assert.strictEqual(L.bossHpMax(boss, 1e9), boss.hp * 4);
});

test('ranks and chests', () => {
  assert.deepStrictEqual([0, 999999, 1e6, 5e6, 2e7, 7.5e7, 2.5e8, 1e12].map(L.rankOf), ['rookie', 'rookie', 'pirate', 'captain', 'warlord', 'emperor', 'king', 'king']);
  assert.deepStrictEqual([0, 399999, 4e5, 9e5, 1.5e6, 9e9].map((d) => L.chestFor(d).id), ['wood', 'wood', 'iron', 'gold', 'mythic', 'mythic']);
});

test('cleanLoadout', () => {
  assert.deepStrictEqual(L.cleanLoadout({ fruit: 'dragon', sword: 'cdk', style: 'godhuman', extra: 1 }), { fruit: 'dragon', sword: 'cdk', style: 'godhuman' });
  assert.strictEqual(L.cleanLoadout({ fruit: 'banana', sword: 'cdk', style: 'godhuman' }), null);
  assert.strictEqual(L.cleanLoadout(null), null);
});

test('maxDamage: a strong legit round passes, a cheat is capped', () => {
  // a perfect-bot run from the demo: magma (weak) vs doughking, 94 hits, 2 ults, 60 s → 2.1M
  const cap = L.maxDamage(loadout('magma', 'cdk', 'godhuman'), 'doughking', 94, 2, 60);
  assert.ok(cap > 2.1e6, `cap ${cap}`);
  assert.ok(cap < 60e6, `cap too loose ${cap}`);
  // time matters: 10 s of play cannot deal a 60 s cap
  assert.ok(L.maxDamage(loadout(), 'seabeast', 94, 2, 10) < L.maxDamage(loadout(), 'seabeast', 94, 2, 60) / 3);
  // hit counts beyond what can spawn are ignored
  assert.strictEqual(L.maxDamage(loadout(), 'seabeast', 5000, 0, 60), L.maxDamage(loadout(), 'seabeast', 150, 0, 60));
  // weak fruit multiplies
  assert.ok(L.maxDamage(loadout('rumble'), 'seabeast', 50, 1, 60) > L.maxDamage(loadout('rumble'), 'leviathan', 50, 1, 60) * 1.4);
});

test('validateRound: bad loadout, too fast, expired, caps and sanity', () => {
  const round = (o) => Object.assign({ loadout: loadout(), startedAt: new Date(NOW - 61 * 1000).toISOString(), bossId: 'seabeast' }, o);
  assert.deepStrictEqual(L.validateRound({ round: round({ loadout: { fruit: 'x' } }), body: {}, now: NOW }), { ok: false, reason: 'bad_loadout' });
  assert.strictEqual(L.validateRound({ round: round({ startedAt: NOW - 1000 }), body: { dmg: 1 }, now: NOW }).reason, 'too_fast');
  assert.strictEqual(L.validateRound({ round: round({ startedAt: NOW - 16 * 60 * 1000 }), body: { dmg: 1 }, now: NOW }).reason, 'expired');
  const ok = L.validateRound({ round: round(), body: { dmg: 800000, hits: 40, dodged: 10, best: 20, ulted: 1, secs: 60 }, now: NOW });
  assert.strictEqual(ok.ok, true); assert.strictEqual(ok.valid, true); assert.strictEqual(ok.dmg, 800000); assert.strictEqual(ok.secs, 60);
  const cheat = L.validateRound({ round: round(), body: { dmg: 5e9, hits: 40, dodged: 10, best: 20, ulted: 1, secs: 60 }, now: NOW });
  assert.strictEqual(cheat.valid, false); assert.strictEqual(cheat.dmg, cheat.cap); assert.ok(cheat.dmg < 5e7);
  // the client cannot claim more seconds than the server saw
  const quick = L.validateRound({ round: round({ startedAt: NOW - 12 * 1000 }), body: { dmg: 3e6, hits: 40, best: 20, secs: 60 }, now: NOW });
  assert.strictEqual(quick.secs, 12); assert.ok(quick.dmg < 3e6);
  // garbage numbers are clamped, never thrown
  const junk = L.validateRound({ round: round(), body: { dmg: 'x', hits: -4, dodged: 1e9, best: null, ulted: 'q', secs: {} }, now: NOW });
  assert.strictEqual(junk.ok, true); assert.strictEqual(junk.dmg, 0); assert.strictEqual(junk.dodged, 60);
});

test('proCap: a rolling 7-day window of 7 days', () => {
  const fresh = L.proCap(player(), 2 * HOUR, NOW);
  assert.deepStrictEqual(fresh, { granted: 2 * HOUR, excess: 0, weekStart: TODAY, weekMs: 2 * HOUR });
  const near = L.proCap(player({ proWeekStart: YESTERDAY, proWeekMs: 7 * DAY - HOUR }), 3 * HOUR, NOW);
  assert.deepStrictEqual([near.granted, near.excess, near.weekStart], [HOUR, 2 * HOUR, YESTERDAY]);
  const reset = L.proCap(player({ proWeekStart: '2026-10-20', proWeekMs: 7 * DAY }), 3 * HOUR, NOW);
  assert.deepStrictEqual([reset.granted, reset.weekStart, reset.weekMs], [3 * HOUR, TODAY, 3 * HOUR]);
  assert.strictEqual(L.proToBounty(HOUR), 50000);
  assert.strictEqual(L.extendPro(0, HOUR, NOW), NOW + HOUR);
  assert.strictEqual(L.extendPro(NOW + DAY, HOUR, NOW), NOW + DAY + HOUR);
});

const v = (dmg, o) => Object.assign({ dmg, best: 20, dodged: 10 }, o);

test('computeRewards: chest, bounty, rank-up, streak, PRO stacking', () => {
  const r = L.computeRewards({ player: player({ bounty: 900000, streak: 2, lastRaidDay: YESTERDAY }), v: v(1.0e6), isPro: false, now: NOW });
  assert.strictEqual(r.chest, 'gold');
  assert.strictEqual(r.bounty, Math.round((1.0e6 * 0.8 + 20 * 8000 + 10 * 10000) * 1.15));
  assert.strictEqual(r.rank, 'pirate'); assert.strictEqual(r.rankUp, true);
  assert.strictEqual(r.streak, 3); assert.strictEqual(r.streakRewardDay, TODAY); assert.strictEqual(r.lastRaidDay, TODAY);
  assert.deepStrictEqual(r.loot.map((l) => l.kind), ['bounty', 'pro', 'rankup', 'streak']);
  assert.strictEqual(r.proMs, 2 * HOUR + DAY + 6 * HOUR);
  assert.strictEqual(r.proUntil, NOW + r.proMs);
  assert.deepStrictEqual([r.proWeekStart, r.proWeekMs], [TODAY, r.proMs]);
});

test('computeRewards: second raid of the day keeps the streak and pays no streak twice', () => {
  const r = L.computeRewards({ player: player({ streak: 3, lastRaidDay: TODAY, streakRewardDay: TODAY }), v: v(100000), isPro: false, now: NOW });
  assert.strictEqual(r.chest, 'wood'); assert.strictEqual(r.streak, 3);
  assert.deepStrictEqual(r.loot.map((l) => l.kind), ['bounty']);
  assert.strictEqual(r.proMs, 0); assert.strictEqual(r.proUntil, 0);
});

test('computeRewards: a missed day resets the streak to 1', () => {
  const r = L.computeRewards({ player: player({ streak: 6, lastRaidDay: '2026-10-30' }), v: v(100000), isPro: false, now: NOW });
  assert.strictEqual(r.streak, 1);
});

test('computeRewards: paid Pro gets bounty instead of PRO time', () => {
  const r = L.computeRewards({ player: player({ bounty: 999000 }), v: v(1.6e6), isPro: true, now: NOW });
  assert.strictEqual(r.chest, 'mythic'); assert.strictEqual(r.proMs, 0);
  const kinds = r.loot.map((l) => l.kind);
  assert.deepStrictEqual(kinds, ['bounty', 'pro_paid', 'rankup']);
  assert.strictEqual(r.loot[1].amount, L.proToBounty(12 * HOUR));
  assert.strictEqual(r.loot[2].amount, L.proToBounty(DAY) * 2); assert.strictEqual(r.loot[2].ms, undefined);
  assert.strictEqual(r.bounty, r.loot[0].amount + r.loot[1].amount + r.loot[2].amount);
});

test('computeRewards: the weekly cap turns the excess into bounty', () => {
  const r = L.computeRewards({ player: player({ proWeekStart: YESTERDAY, proWeekMs: 7 * DAY - HOUR }), v: v(1.0e6), isPro: false, now: NOW });
  // gold chest 2 h: 1 h fits, 1 h → bounty; the rank-up to pirate (1 day) is all over the cap → bounty
  assert.deepStrictEqual(r.loot.map((l) => l.kind), ['bounty', 'pro', 'cap', 'cap']);
  assert.strictEqual(r.loot[1].ms, HOUR); assert.strictEqual(r.loot[2].amount, L.proToBounty(HOUR)); assert.strictEqual(r.loot[3].amount, L.proToBounty(DAY));
  assert.strictEqual(r.proMs, HOUR); assert.strictEqual(r.proWeekMs, 7 * DAY); assert.strictEqual(r.rank, 'pirate');
});

test('bossCrate: frame + title + 24 h, cap and paid Pro variants', () => {
  const c = L.bossCrate({ player: player(), bossId: 'tyrant', isPro: false, now: NOW });
  assert.strictEqual(c.frameId, 'raid_tyrant'); assert.strictEqual(c.title, 'Raider');
  assert.deepStrictEqual(c.loot.map((l) => l.kind), ['boss', 'boss_pro']); assert.strictEqual(c.proMs, DAY); assert.strictEqual(c.bounty, 0);
  const capped = L.bossCrate({ player: player({ proWeekStart: TODAY, proWeekMs: 7 * DAY }), bossId: 'tyrant', isPro: false, now: NOW });
  assert.deepStrictEqual(capped.loot.map((l) => l.kind), ['boss', 'cap']); assert.strictEqual(capped.bounty, L.proToBounty(DAY));
  const paid = L.bossCrate({ player: player(), bossId: 'kitsune', isPro: true, now: NOW });
  assert.deepStrictEqual(paid.loot.map((l) => l.kind), ['boss', 'pro_paid']); assert.strictEqual(paid.proMs, 0);
  assert.strictEqual(L.bossCrate({ player: player(), bossId: 'nope', isPro: false, now: NOW }).frameId, null);
});

test('raidsAllowed and records', () => {
  assert.strictEqual(L.raidsAllowed(player(), TODAY, false, NOW), 1);
  assert.strictEqual(L.raidsAllowed(player({ adUnlockedDay: TODAY }), TODAY, false, NOW), 4);
  assert.strictEqual(L.raidsAllowed(player({ adUnlockedDay: YESTERDAY }), TODAY, false, NOW), 1);
  assert.strictEqual(L.raidsAllowed(player({ proUntil: NOW + 1000 }), TODAY, false, NOW), 4);
  assert.strictEqual(L.raidsAllowed(player(), TODAY, true, NOW), 4);
  const pr = L.proPurchaseRecord(NOW + DAY, NOW, DAY);
  assert.strictEqual(pr.title, 'Pro Membership (Weekly)'); assert.strictEqual(pr.expiresAt, NOW + DAY); assert.strictEqual(pr.source, 'raid');
  const fr = L.frameRecord(L.FRAMES.seabeast, NOW);
  assert.deepStrictEqual([fr.id, fr.type, fr.expiresAt, fr.duration, fr.source], ['raid_seabeast', 'profileFrame', -1, -1, 'raid']);
  assert.strictEqual(L.inventoryRecord(L.FRAMES.seabeast, NOW).eggSource, 'raid');
  for (const b of L.BOSSES) assert.ok(L.FRAMES[b.id] && L.FRAMES[b.id].id === `raid_${b.id}`, b.id);
  const st = L.stateForGame({ day: { day: TODAY, bossId: 'tyrant', hpMax: 10, hpLeft: 4, raiders: 3, killed: false }, player: player({ bounty: 5, adUnlockedDay: TODAY, frames: ['raid_tyrant'] }), raidsUsed: 2, share: 6, now: NOW });
  assert.deepStrictEqual(st, { day: TODAY, bossId: 'tyrant', hpMax: 10, hpLeft: 4, raiders: 3, share: 6, bounty: 5, streak: 0, raidsUsed: 2, adUnlocked: true, proUntil: 0, frames: ['raid_tyrant'], title: null, killed: false, resetAt: Date.UTC(2026, 10, 4) });
});
