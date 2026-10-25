// Fill / refresh Supabase card_catalog (supabase/057_fruit_cards.sql) from:
//   * the live values catalogue (blox-api.b-cdn.net/data.json): every fruit and skin;
//   * scripts/fruit-cards/sets.json: which items are cards and which pages they fill;
//   * the art manifest: which cards have their art on the CDN (art.py).
//
//   node scripts/fruit-cards/sync-card-catalog.js --offline            # no database: print the rows
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/fruit-cards/sync-card-catalog.js           # dry run
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/fruit-cards/sync-card-catalog.js --apply   # write
//
//   --hd <file|url>   art manifest (JSON array of card keys). Default: the CDN
//                     manifest written by art.py --apply.
//   --out <file>      also write the rows as JSON (the app's dev mock uses this).
//
// Collector numbers never change: existing cards keep theirs, new cards are
// appended (commons first, Limited last, A-Z inside a rarity). Cards that
// leave the catalogue are marked inactive, never deleted (players own them).
// Keep the item rules in step with cards.py (same sets.json, same key rule).

const path = require('path');
const fs = require('fs');

const APPLY = process.argv.includes('--apply');
const OFFLINE = process.argv.includes('--offline');
const argAt = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
};
const SETS = JSON.parse(fs.readFileSync(path.join(__dirname, 'sets.json'), 'utf8'));
const CARDS_CDN = process.env.FRUIT_CARDS_CDN || 'https://bloxcards.b-cdn.net/v1';   // = CARDS_CDN in Code/FruitCards/cardConfig.js
const HD_SOURCE = argAt('--hd') || `${CARDS_CDN}/fruits/index.json`;
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'legendary', 'mythical', 'limited'];

const cardKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const loadJson = async (src) => {
  if (/^https?:\/\//.test(src)) {
    // Bypass the CDN cache: the list changes with every upload.
    const r = await fetch(`${src}${src.includes('?') ? '&' : '?'}v=${Date.now()}`);
    if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
    return r.json();
  }
  return JSON.parse(fs.readFileSync(src, 'utf8'));
};

// One data.json item -> card fields, or null when it is not a card.
function toCard(item) {
  if (!item || SETS.excludeTypes.includes(item.type) || SETS.excludeNames.includes(item.name)) return null;
  const limited = item.type === 'Limited';
  const rarity = limited ? 'limited' : String(item.rarity || '').toLowerCase();
  if (!RARITY_ORDER.includes(rarity)) return { skip: `unknown rarity "${item.rarity}"` };
  const sets = [];
  if (SETS.typePages[item.type]) sets.push(SETS.typePages[item.type]);
  if (SETS.rarityPages[item.rarity]) sets.push(SETS.rarityPages[item.rarity]);
  if (limited) {
    sets.push(SETS.limitedPage);
    for (const [page, word] of Object.entries(SETS.skinPages)) {
      if (new RegExp(`\\b${escapeRe(word)}\\b`, 'i').test(item.name)) sets.push(page);
    }
  }
  return {
    key: cardKey(item.name),
    name: String(item.name).slice(0, 80),
    rarity,
    family: limited ? 'skin' : String(item.type || '').toLowerCase() || null,
    sets: [...new Set(sets)].sort(),
  };
}

async function main() {
  let sb = null;
  if (!OFFLINE) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or --offline)');
    const { createClient } = require(path.join(__dirname, '..', '..', 'node_modules', '@supabase', 'supabase-js'));
    sb = createClient(url, key, { auth: { persistSession: false } });
  }

  const catalog = await loadJson(SETS.catalog);
  let hd = [];
  try {
    hd = await loadJson(HD_SOURCE);
  } catch (e) {
    console.warn(`art manifest not readable (${e.message}); every card stays hd_ready=false`);
  }
  if (!Array.isArray(hd) || !hd.every((k) => typeof k === 'string')) {
    console.warn('art manifest is not a list of keys; every card stays hd_ready=false');
    hd = [];
  }
  const hdSet = new Set(hd);

  const cards = [];
  const seen = new Set();
  for (const item of catalog) {
    const c = toCard(item);
    if (!c) continue;
    if (c.skip) {
      console.warn(`skip ${item.name}: ${c.skip}`);
      continue;
    }
    if (!c.key || seen.has(c.key)) continue;
    seen.add(c.key);
    cards.push(c);
  }

  let existing = [];
  if (sb) {
    const { data, error } = await sb.from('card_catalog').select('key, no, active');
    if (error) throw error;
    existing = data;
  }
  const numberOf = new Map(existing.map((r) => [r.key, r.no]));
  let nextNo = existing.reduce((m, r) => Math.max(m, r.no), 0) + 1;
  const fresh = cards.filter((c) => !numberOf.has(c.key))
    .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name));
  for (const c of fresh) numberOf.set(c.key, nextNo++);

  const now = new Date().toISOString();
  const rows = cards.map((c) => ({
    ...c,
    no: numberOf.get(c.key),
    bg: null,
    hd_ready: hdSet.has(c.key),
    active: true,
    updated_at: now,
  })).sort((a, b) => a.no - b.no);
  const gone = existing.filter((r) => r.active && !seen.has(r.key)).map((r) => r.key);

  const bySet = {};
  const byRarity = {};
  rows.forEach((r) => {
    r.sets.forEach((s) => { bySet[s] = (bySet[s] || 0) + 1; });
    byRarity[r.rarity] = (byRarity[r.rarity] || 0) + 1;
  });
  console.log(`${rows.length} cards: ${fresh.length} new, ${rows.length - fresh.length} existing; ${gone.length} leaving`);
  console.log(`art ready: ${rows.filter((r) => r.hd_ready).length}/${rows.length}`);
  console.log('per rarity:', byRarity);
  console.log('per set:', bySet);
  const out = argAt('--out');
  if (out) {
    fs.writeFileSync(out, JSON.stringify(rows.map((r) => [r.key, r.name, r.rarity, r.no, r.family, r.sets, r.bg])));
    console.log(`rows -> ${out}`);
  }
  if (!APPLY || !sb) {
    console.log('dry run: add --apply (with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) to write');
    return;
  }

  for (let i = 0; i < rows.length; i += 200) {
    const { error: e } = await sb.from('card_catalog').upsert(rows.slice(i, i + 200), { onConflict: 'key' });
    if (e) throw e;
  }
  if (gone.length) {
    const { error: e } = await sb.from('card_catalog').update({ active: false, updated_at: now }).in('key', gone);
    if (e) throw e;
  }
  console.log('written.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
