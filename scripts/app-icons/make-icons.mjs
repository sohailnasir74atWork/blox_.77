/**
 * make-icons.mjs — tiny glossy images that replace the font icons in the most
 * visible places: the six bottom tabs and the six Home quick actions.
 * Same approach as adoptme-jan7/scripts/tab-icons/make-icons.mjs.
 *
 *   node scripts/app-icons/make-icons.mjs
 *
 * Tabs (assets/tab-icons/<name>[-off].png, 26 pt base):
 *   home        a house with an orange roof and a pirate flag
 *   calculator  a calculator with colourful keys
 *   stock       a devil fruit (the dealer's stock)
 *   trade       two swap arrows
 *   feed        a photo card with a heart
 *   chat        a speech bubble
 *   more        four candy tiles (the More tab, 2026-10-08; replaced Stock,
 *               whose icon is kept for reuse)
 *   Every tab icon gets an "-off" twin (soft grey) for the unselected state.
 *
 * Quick actions (assets/home-actions/<name>.png, 32 pt base):
 *   values, leaderboard, stars, cosmetics, friends, mods
 *
 * Mini games (assets/game-icons/<name>.png, 32 pt base):
 *   mystery, crash, smash, chest, slash, memory
 *
 * Trade header (assets/trade-icons/<name>[-off].png, 18 pt base):
 *   mytrades, following, saved, notifier
 *
 * Settings rows (assets/settings-icons/<name>.png, 28 pt base): glossy
 * coloured tiles with a white glyph, one per row.
 *
 * Writes @1x, @2x and @3x. Deterministic: re-running gives identical files.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TAB_OUT = path.join(ROOT, 'assets/tab-icons');
const ACTION_OUT = path.join(ROOT, 'assets/home-actions');
const GAME_OUT = path.join(ROOT, 'assets/game-icons');
const TRADE_OUT = path.join(ROOT, 'assets/trade-icons');
const SETTINGS_OUT = path.join(ROOT, 'assets/settings-icons');
const OUTLINE = 'rgba(16,24,48,0.42)';

const grad = (id, stops, vertical = true) => `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="1">${
  stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
const radial = (id, stops, cx = 0.35, cy = 0.3) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="0.75">${
  stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</radialGradient>`;
const svg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${defs}</defs>${body}</svg>`;

const sparkle = (x, y, r, fill = '#FDE68A') =>
  `<path d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z" fill="${fill}"/>`;

const heart = (x, y, r, fill, stroke = '') =>
  `<path d="M${x} ${y + r * 0.95} C${x - r * 1.5} ${y - r * 0.05} ${x - r * 0.95} ${y - r * 1.2} ${x} ${y - r * 0.45} C${x + r * 0.95} ${y - r * 1.2} ${x + r * 1.5} ${y - r * 0.05} ${x} ${y + r * 0.95} Z" fill="${fill}" ${stroke}/>`;

const star = (cx, cy, R, r, fill, extra = '') => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke-linejoin="round" ${extra}/>`;
};

const key = (x, y, id) => `
  <rect x="${x}" y="${y + 1.2}" width="10" height="8.5" rx="3" fill="rgba(16,24,48,0.28)"/>
  <rect x="${x}" y="${y}" width="10" height="8.5" rx="3" fill="url(#${id})"/>
  <rect x="${x + 2}" y="${y + 1.2}" width="6" height="2" rx="1" fill="rgba(255,255,255,0.55)"/>`;

/** A devil fruit: a round fruit covered in swirls, with a curly stem. */
const devilFruit = (body, swirl, prefix) => `
  <ellipse cx="32" cy="40" rx="21" ry="19" fill="rgba(16,24,48,0.25)" transform="translate(0 2)"/>
  <ellipse cx="32" cy="38" rx="21" ry="19.5" fill="url(#${prefix}body)" stroke="${OUTLINE}" stroke-width="1.6"/>
  <path d="M20 34 c0-5 7-6 7-1 c0 3-4 3-4 1" fill="none" stroke="${swirl}" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M33 30 c0-5 7-6 7-1 c0 3-4 3-4 1" fill="none" stroke="${swirl}" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M25 45 c0-5 7-6 7-1 c0 3-4 3-4 1" fill="none" stroke="${swirl}" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M38 44 c0-5 7-6 7-1 c0 3-4 3-4 1" fill="none" stroke="${swirl}" stroke-width="2.6" stroke-linecap="round"/>
  <ellipse cx="24" cy="27" rx="7" ry="3.6" fill="rgba(255,255,255,0.45)" transform="rotate(-25 24 27)"/>
  <path d="M32 19 C31 13 34 9 38 8 C36 11 35 14 36 18" fill="#15803D" stroke="${OUTLINE}" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M33 18 C38 12 45 13 47 16 C43 15 39 17 36 20 Z" fill="url(#${prefix}leaf)" stroke="${OUTLINE}" stroke-width="1.2" stroke-linejoin="round"/>`;

/** A glossy rounded tile for the More tab (same as adoptme-jan7's tab icon). */
const tile = (x, y, id) => `
  <rect x="${x}" y="${y + 2}" width="25" height="25" rx="8" fill="rgba(16,24,48,0.25)"/>
  <rect x="${x}" y="${y}" width="25" height="25" rx="8" fill="url(#${id})" stroke="${OUTLINE}" stroke-width="1.4"/>
  <path d="M${x + 4.5} ${y + 3.2} H${x + 20.5} C${x + 22.5} ${y + 3.2} ${x + 22.5} ${y + 7.5} ${x + 20.5} ${y + 8} C${x + 15} ${y + 6.5} ${x + 10} ${y + 6.5} ${x + 4.5} ${y + 8} C${x + 2.5} ${y + 7.5} ${x + 2.5} ${y + 3.2} ${x + 4.5} ${y + 3.2} Z" fill="rgba(255,255,255,0.5)"/>`;

// ─────────────────────────────── Tabs ───────────────────────────────
const TABS = {
  home: svg(
    grad('roof', [[0, '#FDBA74'], [0.5, '#F97316'], [1, '#C2410C']])
      + grad('wall', [[0, '#FFFBEB'], [1, '#FCD34D']])
      + grad('door', [[0, '#93C5FD'], [1, '#2563EB']]),
    `<path d="M14 31 V53 C14 56 16 58 19 58 H45 C48 58 50 56 50 53 V31 Z" fill="#92400E" opacity="0.32" transform="translate(0 2)"/>
     <path d="M14 31 V53 C14 56 16 58 19 58 H45 C48 58 50 56 50 53 V31 Z" fill="url(#wall)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <path d="M7 33 L32 11 L57 33 C58.5 34.5 57 37 55 36 L32 18 L9 36 C7 37 5.5 34.5 7 33 Z" fill="url(#roof)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M15 28 L32 14 L37 18" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="2" stroke-linecap="round"/>
     <rect x="27" y="40" width="11" height="18" rx="4" fill="url(#door)" stroke="${OUTLINE}" stroke-width="1.4"/>
     <circle cx="35" cy="49.5" r="1.2" fill="#FDE68A"/>
     <rect x="42.5" y="5" width="2" height="15" rx="1" fill="#78350F"/>
     <path d="M44.5 6 H55 L52 9.5 L55 13 H44.5 Z" fill="#1F2937" stroke="${OUTLINE}" stroke-width="1"/>
     <circle cx="49" cy="9.5" r="1.6" fill="#F8FAFC"/>`
  ),
  calculator: svg(
    grad('body', [[0, '#A78BFA'], [1, '#6D28D9']])
      + grad('screen', [[0, '#ECFDF5'], [1, '#A7F3D0']])
      + grad('k1', [[0, '#FDE68A'], [1, '#F59E0B']])
      + grad('k2', [[0, '#93C5FD'], [1, '#3B82F6']])
      + grad('k3', [[0, '#FCA5A5'], [1, '#EF4444']])
      + grad('k4', [[0, '#86EFAC'], [1, '#22C55E']]),
    `<rect x="13" y="8" width="38" height="50" rx="10" fill="rgba(16,24,48,0.3)" transform="translate(0 2)"/>
     <rect x="13" y="6" width="38" height="50" rx="10" fill="url(#body)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <rect x="18" y="11" width="28" height="12" rx="4" fill="url(#screen)" stroke="${OUTLINE}" stroke-width="1.2"/>
     <rect x="31" y="14.5" width="12" height="5" rx="2.5" fill="#059669" opacity="0.75"/>
     ${key(18, 28, 'k1')}${key(32.5, 28, 'k2')}${key(18, 40.5, 'k3')}${key(32.5, 40.5, 'k4')}
     <path d="M17 9.5 H35" stroke="rgba(255,255,255,0.45)" stroke-width="2" stroke-linecap="round"/>`
  ),
  stock: svg(
    radial('fbody', [[0, '#E9D5FF'], [0.45, '#A855F7'], [1, '#6B21A8']])
      + grad('fleaf', [[0, '#86EFAC'], [1, '#16A34A']]),
    devilFruit('#A855F7', '#5B21B6', 'f') + sparkle(51, 22, 4.5)
  ),
  trade: svg(
    grad('a1', [[0, '#6EE7B7'], [1, '#059669']])
      + grad('a2', [[0, '#93C5FD'], [1, '#2563EB']]),
    `<path d="M10 24 H40 V16 L56 28 L40 40 V32 H10 C7.5 32 6 30 6 28 C6 26 7.5 24 10 24 Z" fill="rgba(16,24,48,0.25)" transform="translate(0 2)"/>
     <path d="M10 22 H40 V14 L56 26 L40 38 V30 H10 C7.5 30 6 28 6 26 C6 24 7.5 22 10 22 Z" fill="url(#a1)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M54 44 H24 V52 L8 40 L24 28 V36 H54 C56.5 36 58 38 58 40 C58 42 56.5 44 54 44 Z" fill="rgba(16,24,48,0.25)" transform="translate(0 4)"/>
     <path d="M54 46 H24 V54 L8 42 L24 30 V38 H54 C56.5 38 58 40 58 42 C58 44 56.5 46 54 46 Z" fill="url(#a2)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M11 24.5 H38" stroke="rgba(255,255,255,0.55)" stroke-width="2" stroke-linecap="round"/>
     <path d="M27 40.5 H53" stroke="rgba(255,255,255,0.55)" stroke-width="2" stroke-linecap="round"/>`
  ),
  feed: svg(
    grad('card', [[0, '#FFFFFF'], [1, '#E2E8F0']])
      + grad('sky', [[0, '#7DD3FC'], [1, '#38BDF8']])
      + grad('sea', [[0, '#22D3EE'], [1, '#0891B2']])
      + grad('hrt', [[0, '#FDA4AF'], [1, '#E11D48']]),
    `<rect x="7" y="11" width="46" height="42" rx="9" fill="rgba(16,24,48,0.28)" transform="translate(0 2)"/>
     <rect x="7" y="9" width="46" height="42" rx="9" fill="url(#card)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <rect x="12" y="14" width="36" height="25" rx="5" fill="url(#sky)"/>
     <path d="M12 32 L22 24 L30 30 L36 26 L48 34 V34 C48 36.8 45.8 39 43 39 H17 C14.2 39 12 36.8 12 34 Z" fill="url(#sea)"/>
     <circle cx="40" cy="20" r="3.5" fill="#FDE68A"/>
     <rect x="12" y="43" width="20" height="3" rx="1.5" fill="#CBD5E1"/>
     ${heart(48, 48, 9, 'url(#hrt)', `stroke="${OUTLINE}" stroke-width="1.4"`)}
     <ellipse cx="44.5" cy="44" rx="2.6" ry="1.6" fill="rgba(255,255,255,0.6)" transform="rotate(-30 44.5 44)"/>`
  ),
  chat: svg(
    grad('bub', [[0, '#93C5FD'], [1, '#2563EB']]),
    `<path d="M32 9 C46 9 57 18 57 30 C57 42 46 51 32 51 C29 51 26 50.6 23.4 49.8 L12 56 L14.8 45.6 C10 41.8 7 36.2 7 30 C7 18 18 9 32 9 Z" fill="rgba(16,24,48,0.28)" transform="translate(0 2)"/>
     <path d="M32 9 C46 9 57 18 57 30 C57 42 46 51 32 51 C29 51 26 50.6 23.4 49.8 L12 56 L14.8 45.6 C10 41.8 7 36.2 7 30 C7 18 18 9 32 9 Z" fill="url(#bub)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M17 20 C21 15.5 26 14 31 14" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="2.4" stroke-linecap="round"/>
     <circle cx="21" cy="31" r="4" fill="#FFFFFF"/><circle cx="32" cy="31" r="4" fill="#FFFFFF"/><circle cx="43" cy="31" r="4" fill="#FFFFFF"/>`
  ),
  // Four candy tiles: Stock, Codes and everything else live here.
  more: svg(
    grad('tPurple', [[0, '#E9D5FF'], [1, '#7C3AED']]) + grad('tBlue', [[0, '#BAE6FD'], [1, '#2563EB']])
      + grad('tAmber', [[0, '#FEF3C7'], [1, '#F59E0B']]) + grad('tGreen', [[0, '#BBF7D0'], [1, '#16A34A']]),
    `${tile(5, 5, 'tPurple')}${tile(34, 5, 'tBlue')}${tile(5, 34, 'tAmber')}${tile(34, 34, 'tGreen')}`
  ),
};

// ─────────────────────────── Quick actions ───────────────────────────
const ACTIONS = {
  // A flame devil fruit with a gold price tag.
  values: svg(
    radial('vbody', [[0, '#FED7AA'], [0.45, '#F97316'], [1, '#B91C1C']])
      + grad('vleaf', [[0, '#86EFAC'], [1, '#16A34A']])
      + grad('tag', [[0, '#FDE68A'], [1, '#F59E0B']]),
    devilFruit('#F97316', '#9A3412', 'v')
      + `<g transform="rotate(-18 48 46)"><rect x="40" y="40" width="18" height="13" rx="3.5" fill="url(#tag)" stroke="${OUTLINE}" stroke-width="1.3"/>
         <circle cx="43.5" cy="46.5" r="1.6" fill="#92400E"/>
         <path d="M50.5 42.5 v8 M48.4 44.6 c0-1.4 4.2-1.4 4.2 0.3 c0 1.6-4.2 1-4.2 2.8 c0 1.8 4.2 1.8 4.2 0.3" fill="none" stroke="#92400E" stroke-width="1.3" stroke-linecap="round"/></g>`
  ),
  leaderboard: svg(
    grad('cup', [[0, '#FEF3C7'], [0.45, '#FBBF24'], [1, '#B45309']])
      + grad('base', [[0, '#A78BFA'], [1, '#6D28D9']]),
    `<path d="M18 10 H46 V26 C46 35 40 41 32 41 C24 41 18 35 18 26 Z" fill="rgba(16,24,48,0.25)" transform="translate(0 2)"/>
     <path d="M18 14 C10 14 9 26 19 28" fill="none" stroke="#D97706" stroke-width="3.4" stroke-linecap="round"/>
     <path d="M46 14 C54 14 55 26 45 28" fill="none" stroke="#D97706" stroke-width="3.4" stroke-linecap="round"/>
     <path d="M18 9 H46 V25 C46 34 40 40 32 40 C24 40 18 34 18 25 Z" fill="url(#cup)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <rect x="28.5" y="39" width="7" height="8" fill="#D97706" stroke="${OUTLINE}" stroke-width="1.2"/>
     <rect x="18" y="46" width="28" height="11" rx="3.5" fill="url(#base)" stroke="${OUTLINE}" stroke-width="1.5"/>
     ${star(32, 22, 7.5, 3.4, '#FFFFFF', 'opacity="0.9"')}
     <path d="M21.5 12 V22" stroke="rgba(255,255,255,0.6)" stroke-width="2.4" stroke-linecap="round"/>
     <rect x="24" y="49.5" width="16" height="3" rx="1.5" fill="rgba(255,255,255,0.45)"/>`
  ),
  stars: svg(
    grad('st', [[0, '#FEF3C7'], [0.45, '#FBBF24'], [1, '#EA580C']]),
    `${star(32, 34, 25, 11, 'rgba(16,24,48,0.25)', 'transform="translate(0 2)"')}
     ${star(32, 33, 25, 11, 'url(#st)', `stroke="${OUTLINE}" stroke-width="1.6"`)}
     <path d="M24 26 L30 15" stroke="rgba(255,255,255,0.65)" stroke-width="2.6" stroke-linecap="round"/>
     ${sparkle(52, 12, 4.5)}${sparkle(11, 48, 3.5)}`
  ),
  cosmetics: svg(
    grad('shirt', [[0, '#F9A8D4'], [1, '#DB2777']])
      + grad('crown', [[0, '#FDE68A'], [1, '#F59E0B']]),
    `<path d="M22 12 L12 18 L6 30 L15 35 L18 30 V56 H46 V30 L49 35 L58 30 L52 18 L42 12 C40 17 36 19 32 19 C28 19 24 17 22 12 Z" fill="rgba(16,24,48,0.25)" transform="translate(0 2)"/>
     <path d="M22 12 L12 18 L6 30 L15 35 L18 30 V56 H46 V30 L49 35 L58 30 L52 18 L42 12 C40 17 36 19 32 19 C28 19 24 17 22 12 Z" fill="url(#shirt)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M12.5 20 L8.5 28.5" stroke="rgba(255,255,255,0.5)" stroke-width="2.2" stroke-linecap="round"/>
     <path d="M24 35 L27 28 L32 33 L37 28 L40 35 V42 H24 Z" fill="url(#crown)" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/>
     <circle cx="32" cy="38.5" r="1.8" fill="#E11D48"/>`
  ),
  friends: svg(
    grad('h1', [[0, '#D8B4FE'], [1, '#9333EA']])
      + grad('h2', [[0, '#FDA4AF'], [1, '#E11D48']]),
    `${heart(24, 31, 17, 'rgba(16,24,48,0.22)', 'transform="translate(0 2)"')}
     ${heart(24, 30, 17, 'url(#h1)', `stroke="${OUTLINE}" stroke-width="1.6"`)}
     ${heart(42, 40, 13, 'url(#h2)', `stroke="${OUTLINE}" stroke-width="1.6"`)}
     <ellipse cx="15.5" cy="23" rx="4" ry="2.4" fill="rgba(255,255,255,0.55)" transform="rotate(-35 15.5 23)"/>
     <ellipse cx="36" cy="35" rx="3" ry="1.8" fill="rgba(255,255,255,0.55)" transform="rotate(-35 36 35)"/>`
  ),
  mods: svg(
    grad('sh', [[0, '#7DD3FC'], [0.5, '#0EA5E9'], [1, '#0369A1']]),
    `<path d="M32 7 L53 14 V30 C53 43 44 52 32 57 C20 52 11 43 11 30 V14 Z" fill="rgba(16,24,48,0.28)" transform="translate(0 2)"/>
     <path d="M32 7 L53 14 V30 C53 43 44 52 32 57 C20 52 11 43 11 30 V14 Z" fill="url(#sh)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M32 12 L48 17.5 V30 C48 40 41.5 47 32 51.5 Z" fill="rgba(255,255,255,0.14)"/>
     <path d="M21.5 31 L29 38.5 L43 24" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M16 17 V27" stroke="rgba(255,255,255,0.55)" stroke-width="2.4" stroke-linecap="round"/>`
  ),
};


// ──────────────────────────── Mini games ────────────────────────────
const GAMES = {
  // A lime devil fruit with a "?" badge.
  mystery: svg(
    radial('mbody', [[0, '#ECFCCB'], [0.45, '#A3E635'], [1, '#3F6212']])
      + grad('mleaf', [[0, '#86EFAC'], [1, '#16A34A']]),
    devilFruit('#A3E635', '#365314', 'm')
      + `<circle cx="47" cy="47" r="10" fill="#FFFFFF" stroke="${OUTLINE}" stroke-width="1.4"/>
         <path d="M43.5 44.5 C43.5 40 50.5 40 50.5 44.5 C50.5 47.5 47 47.5 47 50" fill="none" stroke="#7C3AED" stroke-width="2.8" stroke-linecap="round"/>
         <circle cx="47" cy="53.4" r="1.7" fill="#7C3AED"/>`
  ),
  crash: svg(
    grad('rbody', [[0, '#FFFFFF'], [1, '#CBD5E1']], false)
      + grad('rfin', [[0, '#FCA5A5'], [1, '#DC2626']])
      + grad('rflame', [[0, '#FDE68A'], [0.6, '#F97316'], [1, '#DC2626']]),
    `<path d="M26 44 Q32 62 38 44 Z" fill="url(#rflame)"/>
     <path d="M22 32 L12 46 L23 43 Z" fill="url(#rfin)" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/>
     <path d="M42 32 L52 46 L41 43 Z" fill="url(#rfin)" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/>
     <path d="M32 5 C43 13 46 27 42 44 H22 C18 27 21 13 32 5 Z" fill="url(#rbody)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <circle cx="32" cy="24" r="6" fill="#38BDF8" stroke="${OUTLINE}" stroke-width="1.4"/>
     <circle cx="30" cy="22" r="1.8" fill="rgba(255,255,255,0.8)"/>
     <path d="M25.5 18 C26.5 13 28.5 10.5 31 9" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-linecap="round"/>`
  ),
  smash: svg(
    radial('apple', [[0, '#FECACA'], [0.45, '#EF4444'], [1, '#7F1D1D']])
      + grad('aleaf', [[0, '#86EFAC'], [1, '#16A34A']]),
    `<path d="M32 23 C26 16 11 18 11 35 C11 49 22 60 32 55 C42 60 53 49 53 35 C53 18 38 16 32 23 Z" fill="rgba(16,24,48,0.25)" transform="translate(0 2)"/>
     <path d="M32 23 C26 16 11 18 11 35 C11 49 22 60 32 55 C42 60 53 49 53 35 C53 18 38 16 32 23 Z" fill="url(#apple)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <path d="M32 22 C32 16 34 11 38 9" fill="none" stroke="#78350F" stroke-width="3" stroke-linecap="round"/>
     <path d="M35 15 C40 9 47 10 49 13 C45 13 41 15 37 18 Z" fill="url(#aleaf)" stroke="${OUTLINE}" stroke-width="1.1"/>
     <path d="M35 28 L29 37 L36 41 L30 50" fill="none" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
     <ellipse cx="21" cy="30" rx="5" ry="3" fill="rgba(255,255,255,0.45)" transform="rotate(-30 21 30)"/>
     ${sparkle(53, 19, 5)}${sparkle(9, 52, 3.5)}`
  ),
  chest: svg(
    grad('wood', [[0, '#D97706'], [1, '#78350F']])
      + grad('wood2', [[0, '#F59E0B'], [1, '#92400E']])
      + grad('gold', [[0, '#FEF3C7'], [1, '#F59E0B']]),
    `<rect x="9" y="31" width="46" height="25" rx="5" fill="rgba(16,24,48,0.25)" transform="translate(0 2)"/>
     <rect x="9" y="31" width="46" height="25" rx="5" fill="url(#wood)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <path d="M9 32 V25 C9 16 18 11 32 11 C46 11 55 16 55 25 V32 Z" fill="url(#wood2)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <rect x="16" y="11.5" width="6" height="44" fill="url(#gold)" opacity="0.95"/>
     <rect x="42" y="11.5" width="6" height="44" fill="url(#gold)" opacity="0.95"/>
     <rect x="9" y="29.5" width="46" height="4.5" fill="url(#gold)"/>
     <rect x="26" y="26" width="12" height="14" rx="3" fill="url(#gold)" stroke="${OUTLINE}" stroke-width="1.3"/>
     <circle cx="32" cy="31.5" r="2" fill="#78350F"/><rect x="31" y="32" width="2" height="4.5" rx="1" fill="#78350F"/>
     <path d="M13 22 C15 17 21 14.5 28 14" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="2.2" stroke-linecap="round"/>
     ${sparkle(55, 10, 4.5)}`
  ),
  slash: svg(
    grad('steel', [[0, '#F8FAFC'], [1, '#94A3B8']], false)
      + grad('hilt', [[0, '#FDE68A'], [1, '#D97706']]),
    `<path d="M8 52 Q28 42 56 12" fill="none" stroke="rgba(254,240,138,0.85)" stroke-width="4" stroke-linecap="round"/>
     <path d="M12 56 Q30 47 56 20" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2" stroke-linecap="round"/>
     <g transform="rotate(40 32 32)">
       <path d="M29 2 L32 -2 L35 2 V40 H29 Z" fill="url(#steel)" stroke="${OUTLINE}" stroke-width="1.3"/>
       <path d="M30.5 4 V38" stroke="rgba(255,255,255,0.9)" stroke-width="1.2"/>
       <rect x="22" y="40" width="20" height="5.5" rx="2.7" fill="url(#hilt)" stroke="${OUTLINE}" stroke-width="1.2"/>
       <rect x="29.3" y="45.5" width="5.4" height="14" rx="2" fill="#7C2D12" stroke="${OUTLINE}" stroke-width="1.1"/>
       <circle cx="32" cy="61" r="2.6" fill="url(#hilt)"/>
     </g>`
  ),
  memory: svg(
    grad('cback', [[0, '#A5B4FC'], [1, '#4F46E5']])
      + grad('cfront', [[0, '#FFFFFF'], [1, '#E2E8F0']]),
    `<g transform="rotate(-14 26 34)">
       <rect x="10" y="12" width="28" height="40" rx="6" fill="url(#cback)" stroke="${OUTLINE}" stroke-width="1.5"/>
       <rect x="14.5" y="16.5" width="19" height="31" rx="4" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.6"/>
       ${star(24, 32, 6, 2.6, 'rgba(255,255,255,0.75)')}
     </g>
     <g transform="rotate(12 40 34)">
       <rect x="26" y="12" width="28" height="40" rx="6" fill="rgba(16,24,48,0.25)" transform="translate(0 2)"/>
       <rect x="26" y="12" width="28" height="40" rx="6" fill="url(#cfront)" stroke="${OUTLINE}" stroke-width="1.5"/>
       ${heart(40, 32, 7, '#E11D48')}
     </g>`
  ),
};

// ─────────────────────────── Trade header ───────────────────────────
const TRADE_HEADER = {
  mytrades: svg(
    grad('pb', [[0, '#93C5FD'], [1, '#2563EB']]),
    `<circle cx="32" cy="21" r="12" fill="url(#pb)" stroke="${OUTLINE}" stroke-width="1.8"/>
     <path d="M10 56 C10 42 20 35 32 35 C44 35 54 42 54 56 Z" fill="url(#pb)" stroke="${OUTLINE}" stroke-width="1.8" stroke-linejoin="round"/>
     <circle cx="27.5" cy="17" r="3.4" fill="rgba(255,255,255,0.55)"/>`
  ),
  following: svg(
    grad('p1', [[0, '#C4B5FD'], [1, '#7C3AED']]) + grad('p2', [[0, '#F9A8D4'], [1, '#DB2777']]),
    `<circle cx="42" cy="20" r="9.5" fill="url(#p2)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <path d="M27 50 C27 39 34 33 42 33 C50 33 58 39 58 50 Z" fill="url(#p2)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <circle cx="23" cy="24" r="11" fill="url(#p1)" stroke="${OUTLINE}" stroke-width="1.8"/>
     <path d="M5 58 C5 45 13 38 23 38 C33 38 41 45 41 58 Z" fill="url(#p1)" stroke="${OUTLINE}" stroke-width="1.8" stroke-linejoin="round"/>
     <circle cx="19" cy="20" r="3" fill="rgba(255,255,255,0.55)"/>`
  ),
  saved: svg(
    grad('bm', [[0, '#FDE68A'], [0.5, '#FBBF24'], [1, '#D97706']]),
    `<path d="M16 8 H48 C50 8 52 10 52 12 V58 L32 45 L12 58 V12 C12 10 14 8 16 8 Z" fill="url(#bm)" stroke="${OUTLINE}" stroke-width="2" stroke-linejoin="round"/>
     <path d="M18 13 V40" stroke="rgba(255,255,255,0.65)" stroke-width="3" stroke-linecap="round"/>
     ${star(32, 25, 9, 4, '#FFFFFF', 'opacity="0.9"')}`
  ),
  notifier: svg(
    grad('bell', [[0, '#FDE68A'], [0.5, '#FBBF24'], [1, '#D97706']]),
    `<path d="M32 7 C21 7 15 15 15 26 V36 L9 44 C8 46 9 48 11 48 H53 C55 48 56 46 55 44 L49 36 V26 C49 15 43 7 32 7 Z" fill="url(#bell)" stroke="${OUTLINE}" stroke-width="2" stroke-linejoin="round"/>
     <path d="M25 50 C25 54 28 57 32 57 C36 57 39 54 39 50 Z" fill="#B45309" stroke="${OUTLINE}" stroke-width="1.6"/>
     <path d="M21 26 C21 19 25 14 30 13" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="3" stroke-linecap="round"/>
`
  ),
};

// ─────────────────────────── Settings rows ───────────────────────────
const W = '#FFFFFF';
const settingTile = (id, c1, c2, glyph) => svg(
  grad(id, [[0, c1], [1, c2]]),
  `<rect x="3" y="6" width="58" height="56" rx="15" fill="rgba(16,24,48,0.22)"/>
   <rect x="3" y="3" width="58" height="57" rx="15" fill="url(#${id})"/>
   <path d="M10 3.5 H54 C58 3.5 60.5 6 60.5 10 V22 C44 27 20 27 3.5 22 V10 C3.5 6 6 3.5 10 3.5 Z" fill="rgba(255,255,255,0.16)"/>
   ${glyph}`
);
const shield = (fill) => `<path d="M32 11 L49 17 V30 C49 41 41.5 48.5 32 53 C22.5 48.5 15 41 15 30 V17 Z" fill="${fill}"/>`;
const SETTINGS = {
  haptic: settingTile('t1', '#F9A8D4', '#BE185D',
    `<rect x="23" y="13" width="18" height="37" rx="4.5" fill="none" stroke="${W}" stroke-width="4"/>
     <circle cx="32" cy="43" r="2.4" fill="${W}"/>
     <path d="M15 23 Q10.5 31.5 15 40 M49 23 Q53.5 31.5 49 40" fill="none" stroke="${W}" stroke-width="3.6" stroke-linecap="round"/>`),
  notifications: settingTile('t2', '#86EFAC', '#15803D',
    `<path d="M32 12 C24 12 19 18 19 26 V34 L14 41 H50 L45 34 V26 C45 18 40 12 32 12 Z" fill="${W}" stroke="${W}" stroke-width="2" stroke-linejoin="round"/>
     <path d="M27 45 C27 48.5 29 51 32 51 C35 51 37 48.5 37 45 Z" fill="${W}"/>`),
  theme: settingTile('t3', '#93C5FD', '#1D4ED8',
    `<circle cx="32" cy="32" r="16" fill="none" stroke="${W}" stroke-width="4"/>
     <path d="M32 16 A16 16 0 0 1 32 48 Z" fill="${W}"/>`),
  pro: settingTile('t4', '#C4B5FD', '#6D28D9',
    `<path d="M14 43 L16 21 L25 31 L32 16 L39 31 L48 21 L50 43 Z" fill="#FDE68A" stroke="#B45309" stroke-width="2.2" stroke-linejoin="round"/>
     <rect x="14" y="43" width="36" height="6.5" rx="2.5" fill="#FBBF24" stroke="#B45309" stroke-width="1.6"/>
     <circle cx="32" cy="35" r="3" fill="#E11D48"/>`),
  share: settingTile('t5', '#FDA4AF', '#BE123C',
    `<path d="M22 32 L42 20 M22 32 L42 44" stroke="${W}" stroke-width="3.8"/>
     <circle cx="21" cy="32" r="6.5" fill="${W}"/><circle cx="43" cy="19" r="6.5" fill="${W}"/><circle cx="43" cy="45" r="6.5" fill="${W}"/>`),
  contact: settingTile('t6', '#5EEAD4', '#0F766E',
    `<rect x="12" y="18" width="40" height="29" rx="5" fill="${W}"/>
     <path d="M14.5 21.5 L32 35 L49.5 21.5" fill="none" stroke="#0F766E" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`),
  report: settingTile('t7', '#FDE68A', '#D97706',
    `<path d="M32 13 L52 48 H12 Z" fill="${W}" stroke="${W}" stroke-width="5" stroke-linejoin="round"/>
     <rect x="29.4" y="24" width="5.2" height="14" rx="2.6" fill="#B45309"/>
     <circle cx="32" cy="43" r="3" fill="#B45309"/>`),
  rate: settingTile('t8', '#FDBA74', '#EA580C', star(32, 33, 19, 8.5, W, `stroke="${W}" stroke-width="2"`)),
  community: settingTile('t9', '#93C5FD', '#1E40AF',
    `<circle cx="41" cy="22" r="7" fill="${W}" opacity="0.85"/>
     <path d="M30 46 C30 37 35 32 41 32 C47 32 53 37 53 46 Z" fill="${W}" opacity="0.85"/>
     <circle cx="25" cy="24" r="8.5" fill="${W}"/>
     <path d="M11 50 C11 40 17 34 25 34 C33 34 39 40 39 50 Z" fill="${W}"/>`),
  website: settingTile('t10', '#CBD5E1', '#475569',
    `<circle cx="32" cy="32" r="17" fill="none" stroke="${W}" stroke-width="3.6"/>
     <ellipse cx="32" cy="32" rx="7.5" ry="17" fill="none" stroke="${W}" stroke-width="3.2"/>
     <path d="M15 32 H49 M18.5 23 H45.5 M18.5 41 H45.5" stroke="${W}" stroke-width="3"/>`),
  privacy: settingTile('t11', '#6EE7B7', '#047857',
    `<rect x="18" y="29" width="28" height="21" rx="5" fill="${W}"/>
     <path d="M23.5 29 V23.5 A8.5 8.5 0 0 1 40.5 23.5 V29" fill="none" stroke="${W}" stroke-width="4.5"/>
     <circle cx="32" cy="37.5" r="3.2" fill="#047857"/><rect x="30.4" y="38.5" width="3.2" height="6.5" rx="1.6" fill="#047857"/>`),
  privacyOptions: settingTile('t12', '#4ADE80', '#166534',
    `${shield(W)}<path d="M23.5 31.5 L29.5 37.5 L41 25.5" fill="none" stroke="#166534" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>`),
  childSafety: settingTile('t13', '#A5B4FC', '#4338CA',
    `${shield(W)}${heart(32, 31, 8, '#E11D48')}`),
  logout: settingTile('t14', '#9CA3AF', '#374151',
    `<path d="M15 13 H35 V51 H15 Z" fill="none" stroke="${W}" stroke-width="4" stroke-linejoin="round"/>
     <path d="M27 32 H51 M43.5 24.5 L51 32 L43.5 39.5" fill="none" stroke="${W}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`),
};

async function render(svgText, file, size, off = false) {
  let img = sharp(Buffer.from(svgText), { density: 72 * (size / 64) * 4 }).resize(size, size);
  if (off) {
    // Soft grey twin for an unselected tab: desaturated, lightened, a bit see-through.
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const v = Math.round(110 + g * 0.42);
      data[i] = v; data[i + 1] = v + 4; data[i + 2] = v + 12;
      data[i + 3] = Math.round(data[i + 3] * 0.9);
    }
    img = sharp(data, { raw: info });
  }
  await img.png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 }).toFile(file);
  return fs.statSync(file).size;
}

async function writeSet(icons, dir, base, withOff) {
  fs.mkdirSync(dir, { recursive: true });
  let total = 0;
  for (const [name, text] of Object.entries(icons)) {
    for (const [suffix, scale] of [['', 1], ['@2x', 2], ['@3x', 3]]) {
      total += await render(text, path.join(dir, `${name}${suffix}.png`), base * scale);
      if (withOff) total += await render(text, path.join(dir, `${name}-off${suffix}.png`), base * scale, true);
    }
  }
  return total;
}

const tabBytes = await writeSet(TABS, TAB_OUT, 26, true);
const actionBytes = await writeSet(ACTIONS, ACTION_OUT, 32, false);
const gameBytes = await writeSet(GAMES, GAME_OUT, 32, false);
const tradeBytes = await writeSet(TRADE_HEADER, TRADE_OUT, 18, true);
const settingsBytes = await writeSet(SETTINGS, SETTINGS_OUT, 28, false);
console.log(`tab icons:     ${Object.keys(TABS).length} x (on, off) x 3 scales = ${(tabBytes / 1024).toFixed(1)} KB -> ${path.relative(ROOT, TAB_OUT)}`);
console.log(`home actions:  ${Object.keys(ACTIONS).length} x 3 scales = ${(actionBytes / 1024).toFixed(1)} KB -> ${path.relative(ROOT, ACTION_OUT)}`);
console.log(`mini games:    ${Object.keys(GAMES).length} x 3 scales = ${(gameBytes / 1024).toFixed(1)} KB -> ${path.relative(ROOT, GAME_OUT)}`);
console.log(`trade header:  ${Object.keys(TRADE_HEADER).length} x (on, off) x 3 scales = ${(tradeBytes / 1024).toFixed(1)} KB -> ${path.relative(ROOT, TRADE_OUT)}`);
console.log(`settings rows: ${Object.keys(SETTINGS).length} x 3 scales = ${(settingsBytes / 1024).toFixed(1)} KB -> ${path.relative(ROOT, SETTINGS_OUT)}`);
