/**
 * make-icons.mjs — the card hub icons (Values ▸ More) as tiny PNGs. Ported
 * from adoptme-jan7/scripts/more-hub/make-icons.mjs (2026-10-07): the pet paw
 * became a devil fruit, and Codes + Analytics were added.
 *
 *   node scripts/more-hub/make-icons.mjs
 *
 *   more       the hub header (four app tiles)
 *   stock      Stock          (a purple devil fruit with a timer badge; 2026-10-08,
 *                             when Stock moved from its own tab into the hub)
 *   codes      Codes          (a golden gift ticket)
 *   wallpaper  HD Wallpapers  (a phone showing a sunny scene with a fruit)
 *   scammer    Scammer DB     (a red warning shield under a magnifier)
 *   news       News           (a megaphone)
 *   analytics  Analytics      (a rising chart with an up arrow)
 *   birthdays  Birthdays      (a pink cake with three lit candles)
 *   reports    Complaints & ideas (a purple speech bubble with "!" and a bulb)
 *   admin      Admin reports  (a clipboard with a bar chart)
 *
 * Glossy toy style to sit next to the assets/home-actions art: soft gradients,
 * a white gloss, a soft dark outline so they read on light and dark cards.
 * Writes assets/more-hub/<name>.png, @2x and @3x at a 64 pt base.
 * Deterministic: re-running gives identical files.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// MORE_HUB_ICONS_OUT lets a draft go to a scratch folder before it replaces the assets.
const OUT = process.env.MORE_HUB_ICONS_OUT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/more-hub');
const BASE = 64;
const OUTLINE = 'rgba(28,16,48,0.40)';

const grad = (id, stops, vertical = true) => `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="1">${
  stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
const svg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${defs}</defs>${body}</svg>`;

/** A four-point sparkle centred on (x, y). */
const sparkle = (x, y, r, fill = '#FFFFFF') =>
  `<path d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z" fill="${fill}"/>`;

/** A paw print centred on (x, y) at scale s. */
const paw = (x, y, s, fill) => `
  <g transform="translate(${x} ${y}) scale(${s})" fill="${fill}">
    <ellipse cx="0" cy="4" rx="7" ry="6"/>
    <ellipse cx="-8" cy="-4" rx="3" ry="3.8"/>
    <ellipse cx="-3" cy="-9" rx="3" ry="3.8"/>
    <ellipse cx="3" cy="-9" rx="3" ry="3.8"/>
    <ellipse cx="8" cy="-4" rx="3" ry="3.8"/>
  </g>`;

/** A devil fruit centred on (x, y) at scale s: swirled sphere, stem, leaf. */
const fruit = (x, y, s, fill, swirl = 'rgba(255,255,255,0.75)') => `
  <g transform="translate(${x} ${y}) scale(${s})">
    <circle cx="0" cy="2" r="10" fill="${fill}"/>
    <path d="M-6 -1 C-3 -5 3 -5 5 -1 C3 -3 -2 -3 -3 0 C-1 -2 2 -2 2 1" fill="none" stroke="${swirl}" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M-7 5 C-4 2 1 2 3 5 C1 3.5 -3 3.5 -4 6" fill="none" stroke="${swirl}" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M0 -8 C0 -11 1 -13 3 -14" stroke="#7C4A1E" stroke-width="2" stroke-linecap="round" fill="none"/>
    <path d="M2 -12 C6 -15 10 -13 10 -10 C7 -9 4 -10 2 -12 Z" fill="#22C55E"/>
  </g>`;

/** A glossy rounded tile for the hub icon. */
const appTile = (x, y, id) => `
  <rect x="${x}" y="${y + 1.5}" width="23" height="23" rx="7" fill="rgba(28,16,48,0.25)"/>
  <rect x="${x}" y="${y}" width="23" height="23" rx="7" fill="url(#${id})" stroke="${OUTLINE}" stroke-width="1.3"/>
  <path d="M${x + 4} ${y + 3} H${x + 19} C${x + 21} ${y + 3} ${x + 21} ${y + 7} ${x + 19} ${y + 7.5} C${x + 14} ${y + 6} ${x + 9} ${y + 6} ${x + 4} ${y + 7.5} C${x + 2} ${y + 7} ${x + 2} ${y + 3} ${x + 4} ${y + 3} Z" fill="rgba(255,255,255,0.45)"/>`;

/** One server unit: a glossy slab with vent lines and two status lights. */
const serverUnit = (y) => `
  <rect x="6" y="${y + 2}" width="44" height="15" rx="5" fill="#1E3A8A"/>
  <rect x="6" y="${y}" width="44" height="15" rx="5" fill="url(#slab)" stroke="${OUTLINE}" stroke-width="1.4"/>
  <rect x="9" y="${y + 2}" width="38" height="3.6" rx="1.8" fill="rgba(255,255,255,0.4)"/>
  <g stroke="rgba(15,23,42,0.45)" stroke-width="1.8" stroke-linecap="round">
    <path d="M12 ${y + 9.5} H24"/>
  </g>
  <circle cx="38" cy="${y + 9.5}" r="2.6" fill="#4ADE80" stroke="rgba(0,0,0,0.25)" stroke-width="0.6"/>
  <circle cx="44.5" cy="${y + 9.5}" r="2.6" fill="#FDE047" stroke="rgba(0,0,0,0.25)" stroke-width="0.6"/>`;

const ICONS = {
  // A swirled purple devil fruit with a curly stem and a white timer badge:
  // the dealer's stock and its reset countdown.
  stock: svg(
    `<radialGradient id="sbody" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stop-color="#F3E8FF"/><stop offset="0.45" stop-color="#A855F7"/><stop offset="1" stop-color="#6B21A8"/></radialGradient>`
      + grad('sleaf', [[0, '#86EFAC'], [1, '#16A34A']])
      + grad('sclock', [[0, '#FFFFFF'], [1, '#E0E7FF']]),
    `<ellipse cx="29" cy="37" rx="21" ry="19.5" fill="#4C1D95" transform="translate(0 2)"/>
     <ellipse cx="29" cy="37" rx="21" ry="19.5" fill="url(#sbody)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <g fill="none" stroke="#5B21B6" stroke-width="2.6" stroke-linecap="round">
       <path d="M17 33 c0-5 7-6 7-1 c0 3-4 3-4 1"/><path d="M30 29 c0-5 7-6 7-1 c0 3-4 3-4 1"/>
       <path d="M21 44 c0-5 7-6 7-1 c0 3-4 3-4 1"/>
     </g>
     <ellipse cx="21" cy="26" rx="7" ry="3.6" fill="rgba(255,255,255,0.5)" transform="rotate(-25 21 26)"/>
     <path d="M29 18 C28 12 31 8 35 7 C33 10 32 13 33 17" fill="#15803D" stroke="${OUTLINE}" stroke-width="1.2" stroke-linejoin="round"/>
     <path d="M30 17 C35 11 42 12 44 15 C40 14 36 16 33 19 Z" fill="url(#sleaf)" stroke="${OUTLINE}" stroke-width="1.2" stroke-linejoin="round"/>
     <circle cx="47" cy="47" r="12" fill="#312E81" transform="translate(0 1.5)"/>
     <circle cx="47" cy="47" r="12" fill="url(#sclock)" stroke="${OUTLINE}" stroke-width="1.5"/>
     <circle cx="47" cy="47" r="8.6" fill="none" stroke="#7C3AED" stroke-width="2.2"/>
     <path d="M47 41.5 V47 L51 49.5" fill="none" stroke="#4C1D95" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
     ${sparkle(55, 11, 5, '#FDE68A')}${sparkle(8, 14, 3.6, '#E9D5FF')}`),

  // Four candy app tiles: the "everything else lives here" mark.
  more: svg(
    grad('tPink', [[0, '#FBCFE8'], [1, '#DB2777']]) + grad('tBlue', [[0, '#BAE6FD'], [1, '#2563EB']])
      + grad('tAmber', [[0, '#FEF3C7'], [1, '#F59E0B']]) + grad('tGreen', [[0, '#BBF7D0'], [1, '#16A34A']]),
    `${appTile(6, 6, 'tPink')}${appTile(35, 6, 'tBlue')}${appTile(6, 34, 'tAmber')}${appTile(35, 34, 'tGreen')}
     ${fruit(17.5, 19, 0.62, '#FFFFFF', 'rgba(219,39,119,0.55)')}
     <path d="M41 22 L46.5 12 L52 22 Z" fill="#FFFFFF" stroke="none" opacity="0.95"/>
     <circle cx="17.5" cy="45.5" r="5" fill="#FFFFFF"/>
     <path d="M41 45.5 H52 M46.5 40 V51" stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round"/>
     ${sparkle(58, 5.5, 4.5, '#FDE68A')}`),

  // A phone whose screen is a sunny hill with a devil fruit: wallpapers.
  wallpaper: svg(
    grad('frame', [[0, '#C4B5FD'], [0.45, '#7C3AED'], [1, '#4C1D95']])
      + grad('sky', [[0, '#7DD3FC'], [1, '#F9A8D4']])
      + grad('hill', [[0, '#86EFAC'], [1, '#16A34A']])
      + grad('sun', [[0, '#FEF9C3'], [1, '#FBBF24']]),
    `<rect x="15" y="5" width="34" height="56" rx="9" fill="#2E1065"/>
     <rect x="14" y="3" width="34" height="56" rx="9" fill="url(#frame)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <rect x="18" y="9" width="26" height="44" rx="4.5" fill="url(#sky)"/>
     <circle cx="37" cy="18" r="5" fill="url(#sun)"/>
     <path d="M18 40 C23 33 29 33 33 37 C36 34 41 33 44 36 V48.5 C44 51 42.5 53 40 53 H22 C19.5 53 18 51 18 48.5 Z" fill="url(#hill)"/>
     ${fruit(27, 45, 0.5, '#A855F7')}
     <rect x="27" y="5.6" width="8" height="1.8" rx="0.9" fill="rgba(255,255,255,0.55)"/>
     <path d="M19 10.5 L26 10.5 L19 24 Z" fill="rgba(255,255,255,0.28)"/>
     ${sparkle(54, 13, 6, '#FDE68A')}${sparkle(9, 46, 3.8, '#FFFFFF')}`),

  // A red warning shield with "!" and a magnifying glass over its corner.
  scammer: svg(
    grad('shield', [[0, '#FECACA'], [0.45, '#EF4444'], [1, '#991B1B']])
      + grad('rim', [[0, '#FDE68A'], [1, '#D97706']])
      + grad('lens', [[0, 'rgba(224,242,254,0.95)'], [1, 'rgba(125,211,252,0.85)']]),
    `<path d="M29 5 L50 12.5 V29 C50 42 41 51.5 29 57 C17 51.5 8 42 8 29 V12.5 Z"
           fill="url(#shield)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M29 9 L46 15 V21 C36 17 22 17 12 21 V15 Z" fill="rgba(255,255,255,0.35)"/>
     <path d="M29 20 V35" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round"/>
     <circle cx="29" cy="43.5" r="3.4" fill="#FFFFFF"/>
     <path d="M50 50 L59 59" stroke="#78350F" stroke-width="7.5" stroke-linecap="round"/>
     <path d="M50 50 L59 59" stroke="url(#rim)" stroke-width="5" stroke-linecap="round"/>
     <circle cx="44" cy="44" r="10.5" fill="url(#lens)" stroke="url(#rim)" stroke-width="3.4"/>
     <circle cx="44" cy="44" r="12.2" fill="none" stroke="${OUTLINE}" stroke-width="1"/>
     <path d="M38 41.5 C39 38.5 41.5 37 44 37" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" fill="none"/>
     ${sparkle(56, 9, 4.5, '#FDE68A')}`),

  // An orange megaphone with sound waves.
  news: svg(
    grad('horn', [[0, '#FED7AA'], [0.45, '#F97316'], [1, '#C2410C']])
      + grad('grip', [[0, '#93C5FD'], [1, '#1D4ED8']]),
    `<path d="M13 35 L18.5 53 C19.1 54.9 21 55.9 22.9 55.3 L24.6 54.8 C26.5 54.2 27.4 52.2 26.8 50.4 L22 35 Z"
           fill="url(#grip)" stroke="${OUTLINE}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M8 27 C8 25 9.5 24 11.5 24 H20 L42 11 C44 10 46 11 46 13.5 V48.5 C46 51 44 52 42 51 L20 38 H11.5 C9.5 38 8 37 8 35 Z"
           fill="url(#horn)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M21 26 L43 13.6 C43.8 13.2 44 14 43.6 14.8 C36 19 28 23.6 21 28 Z" fill="rgba(255,255,255,0.5)"/>
     <rect x="17" y="24" width="4" height="14" rx="1" fill="rgba(124,45,18,0.35)"/>
     <g fill="none" stroke="#FBBF24" stroke-width="3.2" stroke-linecap="round">
       <path d="M51 23 C54 27 54 35 51 39"/>
       <path d="M56 18 C61 25 61 37 56 44"/>
     </g>
     ${sparkle(11, 12, 5.5, '#FDE68A')}`),

  // A clipboard holding a three-bar chart: staff reports.
  admin: svg(
    grad('board', [[0, '#99F6E4'], [0.45, '#14B8A6'], [1, '#0F766E']])
      + grad('clip', [[0, '#E2E8F0'], [1, '#64748B']]),
    `<rect x="10" y="9" width="44" height="52" rx="8" fill="#134E4A"/>
     <rect x="10" y="7" width="44" height="52" rx="8" fill="url(#board)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <rect x="15" y="14" width="34" height="40" rx="4" fill="#FFFFFF"/>
     <rect x="22" y="3" width="20" height="9" rx="3.5" fill="url(#clip)" stroke="${OUTLINE}" stroke-width="1.2"/>
     <rect x="20" y="36" width="6" height="13" rx="1.8" fill="#F472B6"/>
     <rect x="29" y="28" width="6" height="21" rx="1.8" fill="#60A5FA"/>
     <rect x="38" y="21" width="6" height="28" rx="1.8" fill="#FBBF24"/>
     <path d="M19 49.5 H45" stroke="#CBD5E1" stroke-width="1.4" stroke-linecap="round"/>
     ${sparkle(56, 12, 5, '#FDE68A')}`),

  // A golden gift ticket with notched sides and a ribbon: free codes.
  codes: svg(
    grad('ticket', [[0, '#FEF3C7'], [0.45, '#FBBF24'], [1, '#D97706']])
      + grad('ribbon', [[0, '#FBCFE8'], [1, '#DB2777']]),
    `<path d="M8 18 H56 V27 C52.5 27 50 29.5 50 33 C50 36.5 52.5 39 56 39 V48 H8 V39 C11.5 39 14 36.5 14 33 C14 29.5 11.5 27 8 27 Z"
           fill="#92400E" transform="translate(0 2)"/>
     <path d="M8 18 H56 V27 C52.5 27 50 29.5 50 33 C50 36.5 52.5 39 56 39 V48 H8 V39 C11.5 39 14 36.5 14 33 C14 29.5 11.5 27 8 27 Z"
           fill="url(#ticket)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M12 21 H52 C52 23 50 23.5 49 23.5 H15 C14 23.5 12 23 12 21 Z" fill="rgba(255,255,255,0.55)"/>
     <rect x="27" y="18" width="7" height="30" fill="url(#ribbon)"/>
     <path d="M30.5 18 C26 10 18 11 20 16 C21.5 19 27 18.5 30.5 18 C34 18.5 39.5 19 41 16 C43 11 35 10 30.5 18 Z"
           fill="url(#ribbon)" stroke="${OUTLINE}" stroke-width="1.2"/>
     <g fill="#92400E" opacity="0.55"><circle cx="19" cy="33" r="1.8"/><circle cx="42" cy="33" r="1.8"/><circle cx="46" cy="33" r="1.8"/></g>
     ${sparkle(55, 10, 5.5, '#FDE68A')}${sparkle(8, 52, 3.8, '#FFFFFF')}`),

  // A white card with a rising green line and an up arrow: market analytics.
  analytics: svg(
    grad('panel', [[0, '#DBEAFE'], [1, '#93C5FD']])
      + grad('up', [[0, '#BBF7D0'], [0.5, '#22C55E'], [1, '#15803D']]),
    `<rect x="7" y="11" width="46" height="44" rx="9" fill="#1E3A8A"/>
     <rect x="7" y="9" width="46" height="44" rx="9" fill="url(#panel)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <path d="M12 14 H48 C49.5 14 49.5 17 48 17.5 C36 16.5 24 16.5 12 17.5 C10.5 17 10.5 14 12 14 Z" fill="rgba(255,255,255,0.55)"/>
     <g stroke="rgba(30,58,138,0.25)" stroke-width="1.2"><path d="M13 27 H47"/><path d="M13 36 H47"/><path d="M13 45 H47"/></g>
     <path d="M14 44 L23 36 L30 40 L44 24" fill="none" stroke="#15803D" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M14 44 L23 36 L30 40 L44 24" fill="none" stroke="url(#up)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M37 22 L47 20 L45 30 Z" fill="url(#up)" stroke="#15803D" stroke-width="1.2" stroke-linejoin="round"/>
     ${sparkle(56, 9, 5, '#FDE68A')}`),

  // A pink layer cake with white icing and three lit candles: Birthdays.
  birthdays: svg(
    grad('cake', [[0, '#FBCFE8'], [0.45, '#EC4899'], [1, '#BE185D']])
      + grad('flame', [[0, '#FEF9C3'], [0.5, '#FDE047'], [1, '#F97316']])
      + grad('plate', [[0, '#F8FAFC'], [1, '#CBD5E1']]),
    `<ellipse cx="32" cy="56" rx="26" ry="5.5" fill="url(#plate)" stroke="${OUTLINE}" stroke-width="1.4"/>
     <rect x="11" y="31" width="42" height="24" rx="7" fill="url(#cake)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <path d="M11 37 C11 33 14 31 18 31 H46 C50 31 53 33 53 37 V39 C51 41.5 49 41.5 47.5 39 C46 42.5 43 42.5 41.5 39 C40 43.5 36.5 43.5 35 39
              C33.5 42.5 30.5 42.5 29 39 C27.5 43.5 24 43.5 22.5 39 C21 42 18 42 16.5 39 C15 41.5 12.5 41.5 11 39 Z"
           fill="#FFFFFF" stroke="${OUTLINE}" stroke-width="1.2" stroke-linejoin="round"/>
     <rect x="18" y="45" width="5" height="2.2" rx="1.1" fill="#FDE047" transform="rotate(-20 20 46)"/>
     <rect x="29" y="48" width="5" height="2.2" rx="1.1" fill="#67E8F9" transform="rotate(15 31 49)"/>
     <rect x="40" y="45" width="5" height="2.2" rx="1.1" fill="#A7F3D0" transform="rotate(-10 42 46)"/>
     <rect x="24" y="51" width="4" height="2" rx="1" fill="#FFFFFF" opacity="0.8"/>
     ${[19.5, 30, 40.5].map((x, i) => `
       <rect x="${x}" y="17" width="4.5" height="15" rx="1.6" fill="${['#60A5FA', '#FBBF24', '#A78BFA'][i]}" stroke="${OUTLINE}" stroke-width="1"/>
       <path d="M${x} 21 L${x + 4.5} 19 M${x} 25 L${x + 4.5} 23 M${x} 29 L${x + 4.5} 27" stroke="rgba(255,255,255,0.7)" stroke-width="1.2"/>
       <path d="M${x + 2.25} 6 C${x + 6} 10.5 ${x + 5.5} 15.5 ${x + 2.25} 15.5 C${x - 1} 15.5 ${x - 1.5} 10.5 ${x + 2.25} 6 Z" fill="url(#flame)" stroke="rgba(194,65,12,0.55)" stroke-width="0.8"/>`).join('')}
     <path d="M16 33.5 C20 32.6 26 32.4 30 32.6" stroke="rgba(255,255,255,0.9)" stroke-width="1.6" stroke-linecap="round" fill="none"/>
     ${sparkle(55, 13, 5, '#FDE68A')}
     ${sparkle(8, 22, 3.5, '#FBCFE8')}`),

  // A purple speech bubble with a white "!" (complaints) and a lit bulb (ideas).
  reports: svg(
    grad('bubble', [[0, '#DDD6FE'], [0.45, '#8B5CF6'], [1, '#6D28D9']])
      + grad('bulb', [[0, '#FEF9C3'], [0.55, '#FDE047'], [1, '#F59E0B']])
      + grad('cap', [[0, '#E2E8F0'], [1, '#64748B']]),
    `<path d="M7 12 C7 8.5 9.5 6 13 6 H43 C46.5 6 49 8.5 49 12 V33 C49 36.5 46.5 39 43 39 H24 L14 48 V39 H13 C9.5 39 7 36.5 7 33 Z"
           fill="#4C1D95" transform="translate(0 2)"/>
     <path d="M7 12 C7 8.5 9.5 6 13 6 H43 C46.5 6 49 8.5 49 12 V33 C49 36.5 46.5 39 43 39 H24 L14 48 V39 H13 C9.5 39 7 36.5 7 33 Z"
           fill="url(#bubble)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M13 9 H43 C45.5 9 46 11.5 44.5 12 C34 10.6 22 10.6 11.5 12 C10.3 11.5 10.8 9 13 9 Z" fill="rgba(255,255,255,0.5)"/>
     <rect x="25.5" y="14" width="5" height="14" rx="2.5" fill="#FFFFFF"/>
     <circle cx="28" cy="33" r="2.9" fill="#FFFFFF"/>
     <g fill="none" stroke="#FDE047" stroke-width="2.2" stroke-linecap="round">
       <path d="M47 34 L45 31"/><path d="M58 34 L60 31"/><path d="M62.5 42 H59.5"/>
     </g>
     <circle cx="52.5" cy="44" r="9" fill="url(#bulb)" stroke="${OUTLINE}" stroke-width="1.4"/>
     <path d="M48.5 41 C49.5 38.6 51.5 37.8 53.5 38" stroke="rgba(255,255,255,0.85)" stroke-width="1.8" stroke-linecap="round" fill="none"/>
     <rect x="48.5" y="52" width="8" height="7" rx="2" fill="url(#cap)" stroke="${OUTLINE}" stroke-width="1.1"/>
     <path d="M48.5 55.5 H56.5" stroke="rgba(15,23,42,0.35)" stroke-width="1"/>
     ${sparkle(9, 54, 4.5, '#DDD6FE')}`),
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, body] of Object.entries(ICONS)) {
  for (const scale of [1, 2, 3]) {
    const px = BASE * scale;
    const file = path.join(OUT, `${name}${scale > 1 ? `@${scale}x` : ''}.png`);
    // density: librsvg rasterises at 72 dpi for the viewBox; scale it so the 64-unit art fills px.
    await sharp(Buffer.from(body), { density: 72 * (px / 64) * 2 })
      .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
      .toFile(file);
    console.log(`${path.basename(file).padEnd(18)} ${px}px ${fs.statSync(file).size} B`);
  }
}
