/**
 * raid/logic.js — Sea Beast Raid rules, no I/O (2026-10-31, Phase 1 step 2).
 * Pure so test/raidLogic.test.js covers it without the emulators; core.js
 * does the reads and writes.
 *
 * Tables here are the server copy of Code/Raid/raidBridge.js RAID_RULES and
 * the game's constants (Code/Raid/game/raid.html); the app test compares
 * game ↔ bridge, raidLogic.test.js compares bridge ↔ server.
 *
 * What the server enforces: a ticket per raid, each ticket pays once, the
 * damage is capped at what the loadout could deal in the time played (a
 * modified client gets the cap, flagged valid=false), 1 free raid + 3 after
 * a rewarded ad per UTC day, PRO time capped per rolling week.
 */

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const DMG_SCALE = 300;
const ROUND_SECS = 60;
const RAIDS_FREE = 1;
const RAIDS_PER_DAY = 4;
const PRO_WEEK_CAP_MS = 7 * DAY;        // rewarded PRO per player per rolling 7 days
const PRO_TO_BOUNTY_PER_HOUR = 50000;   // when PRO cannot be granted (cap, paid Pro) → bounty instead
const MIN_ROUND_MS = 3 * 1000;          // under this a round is noise (a quit on the first second pays nothing)
const MAX_ROUND_MS = 15 * 60 * 1000;    // a ticket older than this is dead (app killed mid-raid)
const BOSS_HP_FLOOR = 5e8;
const BOSS_HP_PER_RAIDER = 1.1e6 * 1.3; // yesterday's raiders × typical damage × 1.3 so it dies most days

const FRUITS = [
  { id: 'dough', pow: 9, spd: 5, ult: 6 },
  { id: 'dragon', pow: 10, spd: 4, ult: 5 },
  { id: 'kitsune', pow: 7, spd: 9, ult: 8 },
  { id: 'leopard', pow: 8, spd: 9, ult: 6 },
  { id: 'spirit', pow: 7, spd: 7, ult: 9 },
  { id: 'venom', pow: 8, spd: 6, ult: 7 },
  { id: 'buddha', pow: 8, spd: 5, ult: 7 },
  { id: 'rumble', pow: 7, spd: 8, ult: 7 },
  { id: 'ice', pow: 6, spd: 7, ult: 8 },
  { id: 'magma', pow: 9, spd: 5, ult: 6 },
  { id: 'light', pow: 6, spd: 10, ult: 7 },
  { id: 'dark', pow: 7, spd: 6, ult: 9 },
];
const SWORDS = [
  { id: 'cutlass', pow: 5, cd: 3.0 },
  { id: 'saber', pow: 7, cd: 3.2 },
  { id: 'rengoku', pow: 8, cd: 3.4 },
  { id: 'cdk', pow: 10, cd: 3.8 },
];
const STYLES = [
  { id: 'combat', spd: 1.0, ult: 1.0 },
  { id: 'ds', spd: 1.1, ult: 1.0 },
  { id: 'ec', spd: 1.25, ult: 1.1 },
  { id: 'godhuman', spd: 1.15, ult: 1.3 },
];
const BOSSES = [
  { id: 'seabeast', hp: 2.5e9, weak: 'rumble' },
  { id: 'leviathan', hp: 4.0e9, weak: 'light' },
  { id: 'doughking', hp: 3.2e9, weak: 'magma' },
  { id: 'kitsune', hp: 3.0e9, weak: 'dark' },
  { id: 'tyrant', hp: 4.5e9, weak: 'ice' },
];
const RANKS = [['rookie', 0], ['pirate', 1e6], ['captain', 5e6], ['warlord', 2e7], ['emperor', 7.5e7], ['king', 2.5e8]];
const CHESTS = [
  { id: 'wood', min: 0, pro: 0, pct: 5 },
  { id: 'iron', min: 4e5, pro: 30 * 60e3, pct: 10 },
  { id: 'gold', min: 9e5, pro: 2 * HOUR, pct: 15 },
  { id: 'mythic', min: 1.5e6, pro: 12 * HOUR, pct: 25 },
];
const RANK_PRO = { pirate: 1 * DAY, captain: 3 * DAY, warlord: 7 * DAY, emperor: 14 * DAY, king: 30 * DAY };
const STREAK_PRO = { 3: 6 * HOUR, 7: 3 * DAY, 14: 7 * DAY, 30: 30 * DAY };
const BOSS_CRATE_PRO = DAY;
const BOSS_TITLE = 'Raider';

// The boss frames as My Cosmetics records (Code/Engagement/shopItems.js gets
// the same catalogue entries in step 3; FramedAvatar draws unknown ids from
// borderColors, so older builds still show them).
const FRAMES = {
  seabeast: { id: 'raid_seabeast', name: '🐉 Sea Beast Slayer', borderColors: ['#2a7fb8', '#5fd0ff', '#e8f6ff'], borderWidth: 3.6, glowColor: '#5fd0ff60' },
  leviathan: { id: 'raid_leviathan', name: '🐋 Leviathan Hunter', borderColors: ['#1e4a8a', '#7bb0ff', '#dff5ff'], borderWidth: 3.6, glowColor: '#7bb0ff60' },
  doughking: { id: 'raid_doughking', name: '🍩 Dough Crusher', borderColors: ['#c98a4b', '#ffd7a3', '#ffc542'], borderWidth: 3.6, glowColor: '#ffd7a360' },
  kitsune: { id: 'raid_kitsune', name: '🦊 Nine-Tail', borderColors: ['#c25a1e', '#ffb13d', '#fff2a8'], borderWidth: 3.6, glowColor: '#ffb13d60' },
  tyrant: { id: 'raid_tyrant', name: '🐲 Dragon Tyrant', borderColors: ['#7a1f1f', '#ff6a3d', '#ffc542'], borderWidth: 3.6, glowColor: '#ff6a3d60' },
};

const byId = (list, id) => list.find((x) => x.id === id) || null;
const fruitById = (id) => byId(FRUITS, id);
const swordById = (id) => byId(SWORDS, id);
const styleById = (id) => byId(STYLES, id);
const bossById = (id) => byId(BOSSES, id);

/** UTC day key 'YYYY-MM-DD' for a ms timestamp. */
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayIndex = (ms) => Math.floor(ms / DAY);
/** The boss of a UTC day: a fixed rotation, same as the game's standalone page. */
const bossForDay = (ms) => BOSSES[dayIndex(ms) % BOSSES.length];
/** Reset time of the day that contains `ms`: the next UTC midnight. */
const resetAt = (ms) => (dayIndex(ms) + 1) * DAY;
const yesterdayKey = (ms) => dayKey(ms - DAY);

/** hp_max for a new day: floor, or yesterday's raiders × typical damage × 1.3; never above the boss's nominal HP ×4. */
function bossHpMax(boss, prevRaiders) {
  const n = Math.max(0, Number(prevRaiders) || 0);
  return Math.round(Math.min(boss.hp * 4, Math.max(BOSS_HP_FLOOR, n * BOSS_HP_PER_RAIDER)));
}

function rankOf(bounty) {
  let r = RANKS[0];
  for (const x of RANKS) if (bounty >= x[1]) r = x;
  return r[0];
}
const chestFor = (dmg) => [...CHESTS].reverse().find((c) => dmg >= c.min);

/** The loadout the game sent, cleaned to known ids. Null when any part is unknown. */
function cleanLoadout(raw) {
  const l = raw && typeof raw === 'object' ? raw : {};
  const f = fruitById(l.fruit); const w = swordById(l.sword); const s = styleById(l.style);
  if (!f || !w || !s) return null;
  return { fruit: f.id, sword: w.id, style: s.id };
}

/**
 * The most damage this loadout could deal against this boss in `secs`
 * seconds, with the counts the game reported (hits, ulted) also capped by
 * time. Every roll at its maximum (crit ×1.8, combo ×5, weak ×1.5), plus 10%.
 * Mirrors the game's formulas in Code/Raid/game/raid.html.
 */
function maxDamage(loadout, bossId, hits, ulted, secs) {
  const f = fruitById(loadout.fruit); const w = swordById(loadout.sword); const s = styleById(loadout.style);
  const boss = bossById(bossId);
  const t = Math.max(0, Math.min(ROUND_SECS + 5, Number(secs) || 0));
  const base = (f.pow + w.pow * 0.4) * DMG_SCALE;
  const weak = boss && boss.weak === f.id ? 1.5 : 1;
  const comboMax = 5; const critMax = 1.8;
  // weak points: ≤ 1 per 0.5 s (enrage rate, kitsune ×1.2) → generous 2.5/s cap
  const hitsCap = Math.min(Number(hits) || 0, Math.ceil(t * 2.5));
  const taps = hitsCap * base * comboMax * critMax * weak;
  const poison = f.id === 'venom' ? hitsCap * 9 * 0.5 * base * weak : 0;
  const swords = Math.ceil(t / w.cd) * (w.pow * DMG_SCALE * 5) * comboMax * critMax * weak;
  const fruitCd = (f.id === 'light' ? 2.4 : 4.0) / s.spd;
  const skills = Math.ceil(t / fruitCd) * (base * 6) * comboMax * critMax * weak;
  // ultimate: 100 charge at ≥ 4/hit → ≥ ~8 s between ults in practice; allow one per 5 s
  const ultCap = Math.min(Number(ulted) || 0, Math.ceil(t / 5));
  const bestMax = hitsCap + Math.ceil(t / w.cd) + Math.ceil(t / fruitCd);
  const ults = ultCap * base * 25 * (1 + bestMax * 0.04) * (5 / 6 + critMax / 6) * weak;
  return Math.round((taps + poison + swords + skills + ults) * 1.1);
}

/**
 * Validate what the game reported for an open round.
 * Returns { ok, reason?, dmg, valid, hits, dodged, best, ulted, secs }:
 *   ok=false  → nothing is paid (reason: 'bad_loadout' | 'too_fast' | 'expired')
 *   valid=false → paid at the cap (the client claimed more than possible)
 */
function validateRound({ round, body, now }) {
  const loadout = cleanLoadout(round.loadout);
  if (!loadout) return { ok: false, reason: 'bad_loadout' };
  const startedAt = typeof round.startedAt === 'number' ? round.startedAt : Date.parse(round.startedAt);
  const elapsedMs = now - startedAt;
  if (!(elapsedMs >= MIN_ROUND_MS)) return { ok: false, reason: 'too_fast' };
  if (elapsedMs > MAX_ROUND_MS) return { ok: false, reason: 'expired' };
  const num = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  const secsClient = num(body.secs, ROUND_SECS + 5);
  // the time actually played: never more than the server saw, never more than a round
  const secs = Math.min(secsClient || ROUND_SECS, Math.ceil(elapsedMs / 1000), ROUND_SECS + 5);
  const hits = num(body.hits, 1000); const dodged = num(body.dodged, 100); const best = num(body.best, 1000); const ulted = num(body.ulted, 100);
  const claimed = num(body.dmg, 1e12);
  const cap = maxDamage(loadout, round.bossId, hits, ulted, secs);
  const dmg = Math.min(claimed, cap);
  const sane = claimed <= cap && dodged <= Math.ceil(secs / 1.5) + 2 && best <= hits + Math.ceil(secs / 2) + 2;
  return { ok: true, loadout, dmg, claimed, cap, valid: sane, hits, dodged: Math.min(dodged, 60), best: Math.min(best, hits + 60), ulted, secs };
}

/** Rolling 7-day cap on rewarded PRO. Returns the ms that may be granted and the new window. */
function proCap(player, wantMs, now) {
  const today = dayKey(now);
  const start = player.proWeekStart || null;
  const fresh = !start || (Date.parse(today) - Date.parse(start)) >= 7 * DAY;
  const used = fresh ? 0 : Math.max(0, Number(player.proWeekMs) || 0);
  const room = Math.max(0, PRO_WEEK_CAP_MS - used);
  const granted = Math.max(0, Math.min(wantMs, room));
  return { granted, excess: Math.max(0, wantMs - granted), weekStart: fresh ? today : start, weekMs: used + granted };
}
const proToBounty = (ms) => Math.round((ms / HOUR) * PRO_TO_BOUNTY_PER_HOUR);
/** New absolute pro_until after adding ms (extends an active grant, starts now otherwise). */
const extendPro = (proUntil, ms, now) => Math.max(now, Number(proUntil) || 0) + ms;

/**
 * Rewards for a validated round. `player` is the raid_players json read in
 * the same request (bounty, streak, lastRaidDay, streakRewardDay, proUntil,
 * proWeekStart, proWeekMs). `isPro` = paying Pro (RevenueCat / purchase): PRO
 * time would be wasted, so it becomes bounty instead.
 */
function computeRewards({ player, v, isPro, now }) {
  const today = dayKey(now);
  const chest = chestFor(v.dmg);
  const bountyBase = Math.round((v.dmg * 0.8 + v.best * 8000 + v.dodged * 10000) * (1 + chest.pct / 100));
  const loot = [{ kind: 'bounty', amount: bountyBase, pct: chest.pct }];
  const bountyBefore = Number(player.bounty) || 0;
  const rankBefore = rankOf(bountyBefore);
  const rankAfter = rankOf(bountyBefore + bountyBase);
  // streak (UTC days)
  let streak = Number(player.streak) || 0;
  let streakRewardDay = player.streakRewardDay || null;
  if (player.lastRaidDay !== today) streak = player.lastRaidDay === yesterdayKey(now) ? streak + 1 : 1;
  const wants = []; // [kind, ms, extra]
  if (chest.pro) wants.push(['pro', chest.pro, {}]);
  if (rankAfter !== rankBefore && RANK_PRO[rankAfter]) wants.push(['rankup', RANK_PRO[rankAfter], { rank: rankAfter }]);
  if (STREAK_PRO[streak] && streakRewardDay !== today) { streakRewardDay = today; wants.push(['streak', STREAK_PRO[streak], { day: streak }]); }

  let bounty = bountyBase; let proMs = 0; let proUntil = Number(player.proUntil) || 0;
  let cur = { proWeekStart: player.proWeekStart || null, proWeekMs: Number(player.proWeekMs) || 0 };
  for (const [kind, ms, extra] of wants) {
    if (isPro) {
      const amount = proToBounty(ms) * (kind === 'rankup' ? 2 : 1);
      bounty += amount;
      loot.push(kind === 'rankup' ? { kind: 'rankup', rank: extra.rank, amount } : { kind: 'pro_paid', amount, ms, text: `PRO member bonus: +$${Math.round(amount / 1000)}K bounty` });
      continue;
    }
    const c = proCap(cur, ms, now);
    cur = { proWeekStart: c.weekStart, proWeekMs: c.weekMs };
    if (c.granted > 0) { proMs += c.granted; proUntil = extendPro(proUntil, c.granted, now); loot.push(Object.assign({ kind, ms: c.granted }, extra)); }
    if (c.excess > 0) { const amount = proToBounty(c.excess); bounty += amount; loot.push({ kind: 'cap', amount }); }
  }
  const rankFinal = rankOf(bountyBefore + bounty);
  return {
    chest: chest.id, bounty, loot, proMs, proUntil: proMs ? proUntil : (Number(player.proUntil) || 0),
    rank: rankFinal, rankUp: rankFinal !== rankBefore, streak, lastRaidDay: today, streakRewardDay,
    proWeekStart: cur.proWeekStart, proWeekMs: cur.proWeekMs,
  };
}

/** The boss crate for a dead boss: frame + title + 24 h PRO (cap-adjusted; bounty for paid Pro). */
function bossCrate({ player, bossId, isPro, now }) {
  const frame = FRAMES[bossId] || null;
  const loot = [{ kind: 'boss', bossId }];
  let proMs = 0; let bounty = 0; let proUntil = Number(player.proUntil) || 0;
  let weekStart = player.proWeekStart || null; let weekMs = Number(player.proWeekMs) || 0;
  if (isPro) {
    bounty = proToBounty(BOSS_CRATE_PRO);
    loot.push({ kind: 'pro_paid', amount: bounty, ms: BOSS_CRATE_PRO, text: `PRO member bonus: +$${Math.round(bounty / 1000)}K bounty` });
  } else {
    const c = proCap({ proWeekStart: weekStart, proWeekMs: weekMs }, BOSS_CRATE_PRO, now);
    weekStart = c.weekStart; weekMs = c.weekMs;
    if (c.granted > 0) { proMs = c.granted; proUntil = extendPro(proUntil, c.granted, now); loot.push({ kind: 'boss_pro', ms: c.granted }); }
    if (c.excess > 0) { bounty = proToBounty(c.excess); loot.push({ kind: 'cap', amount: bounty }); }
  }
  return { frame, frameId: frame ? frame.id : null, title: BOSS_TITLE, loot, proMs, proUntil, bounty, proWeekStart: weekStart, proWeekMs: weekMs };
}

/** Raids allowed today for this player: 1, or 4 after the rewarded ad / for Pro. */
function raidsAllowed(player, today, isPro, now) {
  const proActive = (Number(player.proUntil) || 0) > (typeof now === 'number' ? now : Date.parse(today));
  return isPro || player.adUnlockedDay === today || proActive ? RAIDS_PER_DAY : RAIDS_FREE;
}

/** The RTDB purchases entry that makes the app ad-free (GlobelStats.js isProActive). */
function proPurchaseRecord(proUntil, now, addedMs) {
  return { id: 90, title: 'Pro Membership (Weekly)', source: 'raid', expiresAt: proUntil, grantedAt: now, lastAddedMs: addedMs };
}
/** The My Cosmetics record for a boss frame (users/{uid}/shop/ownedItems/profileFrame push). */
function frameRecord(frame, now) {
  return { id: frame.id, name: frame.name, type: 'profileFrame', rarity: 'legendary', renderType: 'css', duration: -1,
    borderColors: frame.borderColors, borderWidth: frame.borderWidth, glowColor: frame.glowColor, purchasedAt: now, expiresAt: -1, source: 'raid' };
}
function inventoryRecord(frame, now) {
  return { itemId: frame.id, itemName: frame.name, type: 'profileFrame', rarity: 'legendary', eggSource: 'raid', purchasedAt: now, expiresAt: -1, xpCost: 0, starCost: 0 };
}

/** The state object the game's cleanState() expects (INIT.state / setState). */
function stateForGame({ day, player, raidsUsed, share, now }) {
  return {
    day: day.day, bossId: day.bossId, hpMax: day.hpMax, hpLeft: day.hpLeft, raiders: day.raiders,
    share, bounty: player.bounty, streak: player.streak, raidsUsed,
    adUnlocked: player.adUnlockedDay === day.day, proUntil: player.proUntil || 0,
    frames: player.frames || [], title: player.title || null, killed: !!day.killed, resetAt: resetAt(now),
  };
}

module.exports = {
  HOUR, DAY, DMG_SCALE, ROUND_SECS, RAIDS_FREE, RAIDS_PER_DAY, PRO_WEEK_CAP_MS, PRO_TO_BOUNTY_PER_HOUR, MIN_ROUND_MS, MAX_ROUND_MS,
  BOSS_HP_FLOOR, BOSS_HP_PER_RAIDER, BOSS_CRATE_PRO, BOSS_TITLE,
  FRUITS, SWORDS, STYLES, BOSSES, RANKS, CHESTS, RANK_PRO, STREAK_PRO, FRAMES,
  fruitById, swordById, styleById, bossById, dayKey, dayIndex, bossForDay, resetAt, yesterdayKey, bossHpMax, rankOf, chestFor,
  cleanLoadout, maxDamage, validateRound, proCap, proToBounty, extendPro, computeRewards, bossCrate, raidsAllowed,
  proPurchaseRecord, frameRecord, inventoryRecord, stateForGame,
};
