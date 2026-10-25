/**
 * cardConfig.js — Fruit Cards constants (FRUIT_CARDS_PLAN.md, port of Adopt Me's Pet Cards).
 *
 * The server (supabase/057_fruit_cards.sql) decides everything that matters:
 * odds, pity, shards, crafting costs, serials. The tables here mirror it for
 * DISPLAY only (labels, colours, the odds sheet when the server is slow).
 */

// Where card art lives (scripts/fruit-cards/art.py → Bunny). Its own zone on
// purpose: blox-api.b-cdn.net holds the values JSON, and a card zone keeps the
// art's cache rules and purges apart from it. Owner creates the zone before launch.
export const CARDS_CDN = 'https://bloxcards.b-cdn.net/v1';
// Dev builds can point at a local art server (scripts/fruit-cards/dev-cdn.py).
export const cdnBase = () => (__DEV__ && global.__FRUIT_CARDS_CDN__) || CARDS_CDN;

export const RARITIES = ['common', 'uncommon', 'rare', 'legendary', 'mythical', 'limited'];
export const TOP_RARITY = 'limited';

// Blox Fruits' own rarity colours (Common grey → Mythical red), Limited skins gold.
export const RARITY_STYLE = {
  common:    { base: '#9AA8B8', light: '#E6ECF2', dark: '#5B6878', glow: '#C9D6E3' },
  uncommon:  { base: '#3B82F6', light: '#DBEAFE', dark: '#1E40AF', glow: '#60A5FA' },
  rare:      { base: '#A855F7', light: '#F1E3FF', dark: '#6B21A8', glow: '#D07BFF' },
  legendary: { base: '#EC4899', light: '#FCE7F3', dark: '#9D174D', glow: '#FF7AC6' },
  mythical:  { base: '#EF4444', light: '#FEE2E2', dark: '#991B1B', glow: '#FF6B6B' },
  limited:   { base: '#F5A700', light: '#FFF1CC', dark: '#A16207', glow: '#FFD23F' },
};

// Simple → fancy. `fancy` finishes get a global serial number.
export const FINISHES = ['classic', 'foil', 'awakened', 'holo', 'gilded', 'aura', 'fullart'];
export const FINISH_STYLE = {
  classic:  { mult: 1, fancy: false, chance: 72 },
  foil:     { mult: 2, fancy: false, chance: 14 },
  awakened: { mult: 3, fancy: false, chance: 8 },
  holo:     { mult: 5, fancy: true, chance: 4 },
  gilded:   { mult: 10, fancy: true, chance: 1.4 },
  aura:     { mult: 20, fancy: true, chance: 0.5 },
  fullart:  { mult: 40, fancy: true, chance: 0.1 },
};
export const FIRST_EDITION_MAX = 100;   // serial #1–#100 carries the 1st Edition stamp

export const RARITY_POINTS = { common: 1, uncommon: 2, rare: 4, legendary: 8, mythical: 16, limited: 24 };
export const DUPE_SHARDS = { common: 5, uncommon: 10, rare: 25, legendary: 50, mythical: 100, limited: 150 };
export const CRAFT_COST = { common: 40, uncommon: 80, rare: 200, legendary: 400, mythical: 1000, limited: 1500 };
export const STAR_PACK_COST = 3;          // client-only (stars live in RTDB)
export const FREE_PACKS_PER_DAY = 2;
export const STAR_PACKS_PER_DAY = 2;
export const STREAK_BONUS_EVERY = 7;
// Fusion (fuse_card): 4 copies of one finish -> 1 of the next.
export const FUSE_NEXT = { classic: 'awakened', awakened: 'aura' };
export const FUSE_COPIES = 4;

// Fallback odds sheet (the server sends the real one in cards_state).
export const DEFAULT_ODDS = {
  slot: { common: 22, uncommon: 20, rare: 14, legendary: 20, mythical: 14, limited: 10 },
  hit: { legendary: 40, mythical: 35, limited: 25 },
  finish: Object.fromEntries(FINISHES.map((f) => [f, FINISH_STYLE[f].chance])),
  bias: 0.45,
  pity_top: 8,
  pity_holo: 12,
};
export const HIT_RARITIES = ['legendary', 'mythical', 'limited'];

// Set themes. Colours used by frames, packs and screens.
//   sea   — the Grand Line: deep ocean, sunset gold (All Fruits, Natural, Mythical)
//   beast — jungle dusk, ember orange (Beast Den)
//   logia — storm sky, electric cyan (Elementals)
//   skins — midnight velvet, Limited gold (skin pages, Limited Vault)
//   winter — the December seasonal pack
export const THEMES = {
  sea: {
    panel: '#FFF9EE', panelText: '#2B2116', subText: '#7A6A55', plate: '#F6EAD3',
    stage: ['#04142B', '#0B3A66', '#F2A541'], accent: '#F2A541', packA: '#0EA5E9', packB: '#F2A541',
  },
  beast: {
    panel: '#FFF6EC', panelText: '#2A160C', subText: '#7A5A44', plate: '#F7E4CF',
    stage: ['#120A06', '#3B1D0E', '#E2683C'], accent: '#FF8A3D', packA: '#7C2D12', packB: '#FF8A3D',
  },
  logia: {
    panel: '#F2F8FF', panelText: '#10243A', subText: '#5B7896', plate: '#E2EEFB',
    stage: ['#050B1F', '#16205A', '#38E1FF'], accent: '#38E1FF', packA: '#312E81', packB: '#38E1FF',
  },
  skins: {
    panel: '#17112A', panelText: '#F7F0FF', subText: '#BBA8DA', plate: '#221A3D',
    stage: ['#07040F', '#1C0F33', '#C08A1E'], accent: '#FFC94A', packA: '#2E1A52', packB: '#FFC94A',
  },
  winter: {
    panel: '#F2F8FF', panelText: '#10243A', subText: '#5B7896', plate: '#E2EEFB',
    stage: ['#06142A', '#12355E', '#7DD3FC'], accent: '#38BDF8', packA: '#1E3A8A', packB: '#7DD3FC',
  },
};
export const themeOf = (id) => THEMES[id] || THEMES.sea;
// Themes whose card panel is dark (text turns light on them).
export const DARK_THEMES = new Set(['skins']);

// Small stable hash so a card always gets the same variant background.
export const hashKey = (s) => {
  let h = 0;
  // eslint-disable-next-line no-bitwise
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const SEA_BGS = ['sea_day', 'sea_sunset', 'sea_island'];

/**
 * Which background a card shows: by family (Beast → jungle dusk, Logia →
 * storm, skins → velvet vault), Mythical fruits → the sunset sea, the rest
 * → one of the sea scenes. Awakened finish → the night sea.
 */
export const bgIdFor = (card, finish) => {
  if (!card) return 'sea_day';
  if (finish === 'awakened') return 'sea_night';
  if (card.bg) return card.bg;
  if (card.family === 'skin') return 'vault';
  if (card.family === 'beast') return 'beast_dusk';
  if (card.family === 'logia') return 'logia_storm';
  if (card.rarity === 'mythical') return 'sea_sunset';
  if ((card.sets || []).includes('winter26')) return 'sea_snow';
  return SEA_BGS[hashKey(card.key) % SEA_BGS.length];
};

/** Theme for a card's frame. */
export const themeIdFor = (card) => {
  if (!card) return 'sea';
  if (card.family === 'skin') return 'skins';
  if (card.family === 'beast') return 'beast';
  if (card.family === 'logia') return 'logia';
  return 'sea';
};

export const fruitArtUrl = (key, size = 1024) => {
  if (size <= 512) return `${cdnBase()}/fruits/512/${key}.webp`;
  if (size >= 2048) return `${cdnBase()}/fruits/2k/${key}.webp`;   // wallpapers only
  return `${cdnBase()}/fruits/${key}.webp`;
};
