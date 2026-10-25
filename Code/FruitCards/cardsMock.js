/**
 * cardsMock.js — DEV ONLY. A local stand-in for supabase/057_fruit_cards.sql,
 * used automatically by cardsApi.js when the 057 functions are not deployed,
 * so the screens can be built and tested on a simulator. Same rules as the
 * SQL (odds, bias, pity, shards, serials, streak, completion), kept in MMKV.
 *
 * Never imported by release builds (cardsApi requires it under __DEV__).
 * Optional: set global.__FRUIT_CARDS_CDN__ to a local art server
 * (scripts/fruit-cards/dev-cdn.py) to see the real fruit art.
 */

import { DEFAULT_ODDS, DUPE_SHARDS, CRAFT_COST, RARITY_POINTS, FINISH_STYLE, FUSE_NEXT, FUSE_COPIES, cdnBase } from './cardConfig';
import { applyFusion } from './cardMath';

const RULES = require('../../scripts/fruit-cards/sets.json');

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'fruit_cards_mock' });
} catch (e) {
  const mem = new Map();
  storage = { getString: (k) => mem.get(k), set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
}

const ORDER = ['common', 'uncommon', 'rare', 'legendary', 'mythical', 'limited'];
const FANCY = ['holo', 'gilded', 'aura', 'fullart'];
const today = () => Math.floor(Date.now() / 86400000);
const key = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const SETS = [
  { id: 'all', kind: 'pack', theme: 'sea', names: { en: 'All Fruits' }, sort: 20, endsAt: null, odds: {},
    reward: { shards: 3000, frame: 'fruit_master', back: 'gold', wallpaper: 'sea' } },
  ...[['natural', 'sea', 'Natural Fruits', 150], ['beast', 'beast', 'Beast Den', 150], ['logia', 'logia', 'Elementals', 150],
    ['mythical', 'sea', 'Mythical Hoard', 200], ['limited', 'skins', 'Limited Vault', 400]].map(([id, theme, en, shards], i) => ({
    id, kind: 'page', theme, names: { en }, sort: 100 + i * 10, endsAt: null, odds: {}, reward: { shards },
  })),
  ...Object.entries(RULES.skinPages).map(([id, word], i) => ({
    id, kind: 'page', theme: 'skins', names: { en: `${word} Skins` }, sort: 200 + i * 10, endsAt: null, odds: {}, reward: { shards: 50 },
  })),
];

let catalog = null;
const load = (k, d) => {
  try { const v = storage.getString(k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
};
const save = (k, v) => storage.set(k, JSON.stringify(v));

const LOCAL_CDN = 'http://localhost:8765';   // scripts/fruit-cards/dev-cdn.py (+ adb reverse tcp:8765 tcp:8765)
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Same rules as scripts/fruit-cards/sync-card-catalog.js (toCard).
async function buildCatalog() {
  if (catalog) return catalog;
  const rows = await (await fetch(RULES.catalog)).json();
  let art = null;
  try {
    // Prefer the local art server when it is running: the real art, and only
    // the fruits that have it (the same gate as card_catalog.hd_ready).
    const r = await fetch(`${LOCAL_CDN}/fruits/index.json`);
    if (r.ok) {
      art = new Set(await r.json());
      global.__FRUIT_CARDS_CDN__ = LOCAL_CDN;
    }
  } catch (e) { /* no local server */ }
  if (!art) {
    try {
      const r = await fetch(`${cdnBase()}/fruits/index.json`);
      const list = r.ok ? await r.json() : null;
      if (Array.isArray(list) && list.every((x) => typeof x === 'string')) art = new Set(list);
    } catch (e) { /* every card counts as having art */ }
  }
  const seen = new Set();
  const list = [];
  rows.forEach((item) => {
    if (!item || RULES.excludeTypes.includes(item.type) || RULES.excludeNames.includes(item.name)) return;
    const k = key(item.name);
    const limited = item.type === 'Limited';
    const rarity = limited ? 'limited' : String(item.rarity || '').toLowerCase();
    if (!k || !ORDER.includes(rarity) || seen.has(k)) return;
    if (art && !art.has(k)) return;
    seen.add(k);
    const sets = [];
    if (RULES.typePages[item.type]) sets.push(RULES.typePages[item.type]);
    if (RULES.rarityPages[item.rarity]) sets.push(RULES.rarityPages[item.rarity]);
    if (limited) {
      sets.push(RULES.limitedPage);
      Object.entries(RULES.skinPages).forEach(([page, word]) => {
        if (new RegExp(`\\b${escapeRe(word)}\\b`, 'i').test(item.name)) sets.push(page);
      });
    }
    list.push({ key: k, name: item.name, rarity, family: limited ? 'skin' : String(item.type || '').toLowerCase(), sets, bg: null });
  });
  list.sort((a, b) => ORDER.indexOf(a.rarity) - ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name));
  list.forEach((c, i) => { c.no = i + 1; });
  catalog = list;
  return list;
}

const inSet = (c, s) => s === 'all' || c.sets.includes(s);
const weighted = (w) => {
  const entries = Object.entries(w).filter(([, v]) => v > 0);
  let r = Math.random() * entries.reduce((s, [, v]) => s + v, 0);
  for (const [k, v] of entries) { r -= v; if (r < 0) return k; }
  return entries[entries.length - 1][0];
};
const oddsOf = (setId) => ({ ...DEFAULT_ODDS, ...(SETS.find((s) => s.id === setId)?.odds || {}) });

const state = () => load('state', {
  wallet: { shards: 0, pity_top: 0, pity_holo: 0, free_day: -1, star_day: -1, star_count: 0, streak: 0,
    bonus_packs: 25, packs_opened: 0, unique_cards: 0, score: 0, completed: [] }, // dev: plenty of packs to test with
  owned: {}, serials: {},
});

const walletJson = (w) => ({
  shards: w.shards, bonusPacks: w.bonus_packs, streak: w.streak, freeReady: w.free_day < today() || (w.free_count || 0) < 2,
  freeLeft: w.free_day === today() ? Math.max(0, 2 - (w.free_count || 0)) : 2,
  starPacksLeft: Math.max(0, 2 - (w.star_day === today() ? w.star_count : 0)), packsOpened: w.packs_opened,
  uniqueCards: w.unique_cards, score: w.score, completed: w.completed, pityTop: w.pity_top, pityHolo: w.pity_holo,
});

function addCard(st, c, finish) {
  const had = !!st.owned[c.key];
  const entries = st.owned[c.key] || [];
  const e = entries.find((x) => x[0] === finish);
  let serial = null;
  if (FANCY.includes(finish)) {
    const sk = `${c.key}|${finish}`;
    st.serials[sk] = (st.serials[sk] || Math.floor(Math.random() * 40)) + 1;
    serial = st.serials[sk];
  }
  let shards = 0;
  if (e) {
    e[1] += 1;
    if (serial != null) e[2] = e[2] == null ? serial : Math.min(e[2], serial);
    shards = DUPE_SHARDS[c.rarity] * FINISH_STYLE[finish].mult;
  } else {
    entries.push([finish, 1, serial]);
    st.wallet.score += RARITY_POINTS[c.rarity] * FINISH_STYLE[finish].mult;
  }
  st.owned[c.key] = entries;
  st.wallet.shards += shards;
  if (!had) st.wallet.unique_cards += 1;
  return { key: c.key, name: c.name, rarity: c.rarity, no: c.no, family: c.family, sets: c.sets, finish, serial,
    new: !had, newFinish: had && !e, dupe: !!e, shards };
}

function settle(st, keys) {
  const done = [];
  let reward = 0;
  SETS.forEach((s) => {
    if (st.wallet.completed.includes(s.id)) return;
    if (s.id !== 'all' && !keys.some((k) => catalog.find((c) => c.key === k)?.sets.includes(s.id))) return;
    const cards = catalog.filter((c) => inSet(c, s.id));
    if (cards.length && cards.every((c) => st.owned[c.key])) {
      done.push(s.id);
      reward += s.reward.shards || 0;
    }
  });
  st.wallet.completed.push(...done);
  st.wallet.shards += reward;
  return { completed: done, rewardShards: reward };
}

const fail = (msg) => { throw new Error(msg); };

export default {
  async cards_state() {
    await buildCatalog();
    const st = state();
    return {
      wallet: walletJson(st.wallet),
      sets: SETS.map((s) => ({ ...s, startsAt: null, odds: oddsOf(s.id), open: s.kind === 'pack' && (!s.endsAt || Date.parse(s.endsAt) > Date.now()),
        total: catalog.filter((c) => inSet(c, s.id)).length })),
      catalogVersion: `mock:${catalog.length}`,
      now: new Date().toISOString(),
      nextFreeAt: new Date((today() + 1) * 86400000).toISOString(),
    };
  },

  async card_catalog_list() {
    await buildCatalog();
    return catalog.map((c) => [c.key, c.name, c.rarity, c.no, c.family, c.sets, c.bg]);
  },

  async open_card_pack({ p_set, p_source }) {
    await buildCatalog();
    const st = state();
    const w = st.wallet;
    const set = SETS.find((s) => s.id === p_set && s.kind === 'pack');
    if (!set) fail('pack not available');
    let streakBonus = false;
    if (p_source === 'free') {
      if (w.free_day >= today() && (w.free_count || 0) >= 2) fail('free pack already opened today');
      if (w.free_day < today()) {
        w.streak = w.free_day === today() - 1 ? w.streak + 1 : 1;
        w.free_day = today();
        w.free_count = 1;
        if (w.streak % 7 === 0) { w.bonus_packs += 1; streakBonus = true; }
      } else {
        w.free_count = (w.free_count || 0) + 1;
      }
    } else if (p_source === 'stars') {
      if (w.star_day !== today()) { w.star_day = today(); w.star_count = 0; }
      if (w.star_count >= 2) fail('star pack limit reached');
      w.star_count += 1;
    } else if (p_source === 'bonus') {
      if (w.bonus_packs <= 0) fail('no bonus packs');
      w.bonus_packs -= 1;
    } else fail('bad source');
    w.packs_opened += 1;

    const odds = oddsOf(p_set);
    const cards = [];
    let legend = false;
    let holo = false;
    for (let slot = 1; slot <= 3; slot++) {
      let rarity = slot === 3 && !legend && w.pity_top + 1 >= odds.pity_top
        ? 'limited' : weighted(slot === 3 ? odds.hit : odds.slot);
      const order = [rarity, ...ORDER.filter((r) => r !== rarity)];
      let pick = null;
      for (const r of order) {
        const all = catalog.filter((c) => c.rarity === r && inSet(c, p_set));
        if (!all.length) continue;
        // Never the same card twice in one pack while the rarity has another (057).
        const fresh = all.filter((c) => !cards.some((x) => x.key === c.key));
        const pool = fresh.length ? fresh : all;
        const missing = pool.filter((c) => !st.owned[c.key]);
        const from = missing.length && Math.random() < odds.bias ? missing : pool;
        pick = from[Math.floor(Math.random() * from.length)];
        rarity = r;
        break;
      }
      if (!pick) fail('no cards in this pack yet');
      if (rarity === 'limited') legend = true;
      const finishOdds = slot === 3 && !holo && w.pity_holo + 1 >= odds.pity_holo
        ? Object.fromEntries(FANCY.map((f) => [f, odds.finish[f]])) : odds.finish;
      const finish = weighted(finishOdds);
      if (FANCY.includes(finish)) holo = true;
      cards.push(addCard(st, pick, finish));
    }
    w.pity_top = legend ? 0 : w.pity_top + 1;
    w.pity_holo = holo ? 0 : w.pity_holo + 1;
    const s = settle(st, cards.map((c) => c.key));
    save('state', st);
    return { cards, wallet: walletJson(w), streakBonus, ...s };
  },

  async craft_card({ p_key }) {
    await buildCatalog();
    const st = state();
    const c = catalog.find((x) => x.key === p_key);
    if (!c) fail('unknown card');
    if (st.owned[p_key]) fail('already owned');
    const cost = CRAFT_COST[c.rarity];
    if (st.wallet.shards < cost) fail('not enough shards');
    st.wallet.shards -= cost;
    const card = addCard(st, c, 'classic');
    const s = settle(st, [p_key]);
    save('state', st);
    return { card, wallet: walletJson(st.wallet), ...s };
  },

  async fuse_card({ p_key, p_from }) {
    await buildCatalog();
    const st = state();
    const to = FUSE_NEXT[p_from];
    if (!to) fail('cannot fuse');
    const c = catalog.find((x) => x.key === p_key);
    if (!c) fail('unknown card');
    const entries = st.owned[p_key] || [];
    const e = entries.find((x) => x[0] === p_from);
    if (!e || e[1] < FUSE_COPIES) fail('not enough copies');
    const hadTo = entries.some((x) => x[0] === to);
    const pts = (f) => RARITY_POINTS[c.rarity] * FINISH_STYLE[f].mult;
    if (e[1] === FUSE_COPIES) st.wallet.score -= pts(p_from);
    if (!hadTo) st.wallet.score += pts(to);
    st.owned[p_key] = applyFusion(entries, p_from, to);
    save('state', st);
    const left = (st.owned[p_key].find((x) => x[0] === p_from) || [null, 0])[1];
    return {
      card: { key: c.key, name: c.name, rarity: c.rarity, no: c.no, family: c.family, sets: c.sets, finish: to, serial: null,
        fused: true, new: false, newFinish: !hadTo, dupe: hadTo, shards: 0 },
      left, wallet: walletJson(st.wallet),
    };
  },

  async get_card_collection() {
    const st = state();
    return {
      cards: st.owned, score: st.wallet.score, uniqueCards: st.wallet.unique_cards, completed: st.wallet.completed,
      showcase: st.showcase || [],
    };
  },

  async set_card_showcase({ p_cards }) {
    await buildCatalog();
    const st = state();
    const list = [];
    (Array.isArray(p_cards) ? p_cards : []).slice(0, 3).forEach((x) => {
      const c = x && catalog.find((y) => y.key === x.k);
      const e = c && (st.owned[x.k] || []).find((en) => en[0] === x.f);
      if (!c || !e || list.some((l) => l.k === x.k)) return;
      list.push({ k: c.key, f: x.f, s: e[2], n: c.name, r: c.rarity, no: c.no, fa: c.family, sets: c.sets, bg: c.bg });
    });
    st.showcase = list;
    save('state', st);
    return list;
  },
};
