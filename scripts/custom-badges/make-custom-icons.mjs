/**
 * make-custom-icons.mjs — the icon set a MOD picks from when creating a
 * custom badge (Code/Helper/customBadges.js CUSTOM_ICONS).
 *
 *   node scripts/custom-badges/make-custom-icons.mjs
 *
 * Unlike the role coins (scripts/role-badges/make-role-icons.mjs) these are
 * WHITE marks on a transparent square: the app draws each one inside a
 * circle of the badge's own colour (UserBadgeRail / UserBadgePill), so one
 * PNG serves every colour a MOD can pick. Details are cut with a dark
 * overlay so they read on light colours too. 40 pt base, @2x, @3x,
 * palette-quantised. Deterministic: re-running gives identical files.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OUT = process.env.CUSTOM_ICONS_OUT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/custom-badges');
const BASE = 40;
const CUT = 'rgba(0,0,0,0.32)';

const star = (cx, cy, ro, ri, n = 5) => {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
};

// Each mark is drawn inside a 64-unit box with roughly 12 units of margin.
const MARKS = {
  star: `<path d="${star(32, 33, 22, 9.5)}" fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`,
  heart: `<path d="M32 53 C14 41 9 31 13.5 22.5 C18 14 29 15 32 23 C35 15 46 14 50.5 22.5 C55 31 50 41 32 53 Z" fill="#fff"/>`,
  crown: `
    <path d="M14 42 L11.5 21 L22.5 30.5 L32 15 L41.5 30.5 L52.5 21 L50 42 Z" fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
    <rect x="14" y="44.5" width="36" height="6" rx="2" fill="#fff"/>
    <g fill="${CUT}"><circle cx="23.5" cy="37" r="2.6"/><circle cx="32" cy="35.5" r="3"/><circle cx="40.5" cy="37" r="2.6"/></g>`,
  flame: `
    <path d="M33 9 C34 19 46 24 46 37 C46 46 39.5 54 32 54 C24.5 54 18 46 18 37 C18 30 22.5 26 24.5 21 C25.5 27 29 29.5 31.5 29 C29.5 23 29.5 16 33 9 Z" fill="#fff"/>
    <path d="M32 54 C27.5 54 24 50 24 44.5 C24 40 27 38 28 34.5 C29.5 38 32 38.5 33.5 37 C36 40 40 41 40 45.5 C40 50 36.5 54 32 54 Z" fill="${CUT}"/>`,
  diamond: `
    <path d="M21 15 H43 L52 27 L32 52 L12 27 Z" fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
    <g fill="none" stroke="${CUT}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
      <path d="M14 27 H50"/><path d="M24 27 L32 48 L40 27"/><path d="M24 27 L28.5 16 M40 27 L35.5 16"/>
    </g>`,
  paw: `
    <g fill="#fff">
      <ellipse cx="20" cy="22" rx="5.5" ry="6.5"/><ellipse cx="32" cy="16.5" rx="5.5" ry="6.5"/><ellipse cx="44" cy="22" rx="5.5" ry="6.5"/>
      <path d="M32 29 C41 29 50 38 48 46.5 C46.5 52.5 38 54.5 32 52 C26 54.5 17.5 52.5 16 46.5 C14 38 23 29 32 29 Z"/>
    </g>`,
  trophy: `
    <path d="M19 12 H45 V27 C45 36 39 42 32 42 C25 42 19 36 19 27 Z" fill="#fff"/>
    <path d="M19 17 H12 C12 27 16 32 21 32 M45 17 H52 C52 27 48 32 43 32" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
    <rect x="29.5" y="41" width="5" height="7" fill="#fff"/>
    <rect x="21" y="47.5" width="22" height="6" rx="2" fill="#fff"/>
    <path d="${star(32, 26, 6.5, 2.8)}" fill="${CUT}"/>`,
  bolt: `<path d="M37 9 L17 36 H30 L26 55 L47 26 H34 Z" fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`,
  rocket: `
    <path d="M32 9 C41 17 43.5 30 41 43 H23 C20.5 30 23 17 32 9 Z" fill="#fff"/>
    <path d="M23.5 34 L14 45 H23.5 Z M40.5 34 L50 45 H40.5 Z" fill="#fff"/>
    <path d="M27 45 L32 56 L37 45 Z" fill="#fff"/>
    <circle cx="32" cy="26" r="4.5" fill="${CUT}"/>`,
  leaf: `
    <path d="M51 13 C30 13 13 28 13 51 C36 51 51 36 51 13 Z" fill="#fff"/>
    <path d="M14 50 L44 20" fill="none" stroke="${CUT}" stroke-width="3" stroke-linecap="round"/>
    <path d="M22 42 L24 32 M30 34 L31 25 M30 34 L39 33" fill="none" stroke="${CUT}" stroke-width="2.2" stroke-linecap="round"/>`,
  moon: `
    <path d="M36 9 C23 9 12 19.5 12 33 C12 46 22.5 56 35.5 56 C43 56 49.5 52.5 54 47 C52 47.6 50 48 47.5 48 C36 48 27 39 27 27.5 C27 20 30.5 13.5 36 9 Z" fill="#fff"/>
    <path d="${star(47, 17, 4.5, 1.9)}" fill="#fff"/>`,
  sun: `
    <circle cx="32" cy="32" r="10.5" fill="#fff"/>
    <g stroke="#fff" stroke-width="4.5" stroke-linecap="round">
      ${[0, 45, 90, 135, 180, 225, 270, 315].map((d) => `<line x1="32" y1="10" x2="32" y2="15.5" transform="rotate(${d} 32 32)"/>`).join('')}
    </g>`,
  gift: `
    <rect x="15" y="28" width="34" height="25" rx="2" fill="#fff"/>
    <rect x="12.5" y="19" width="39" height="10" rx="2" fill="#fff"/>
    <rect x="29" y="19" width="6" height="34" fill="${CUT}"/>
    <path d="M32 19 C26 19 21 15 23 11 C25 7 30 12 32 19 Z M32 19 C38 19 43 15 41 11 C39 7 34 12 32 19 Z" fill="#fff"/>`,
  pencil: `
    <g transform="rotate(45 32 32)">
      <rect x="26.5" y="8" width="11" height="34" rx="2" fill="#fff"/>
      <path d="M26.5 43 L32 56 L37.5 43 Z" fill="#fff"/>
      <rect x="26.5" y="8" width="11" height="7" rx="2" fill="${CUT}"/>
      <path d="M30 50.5 L32 56 L34 50.5 Z" fill="${CUT}"/>
    </g>`,
  shield: `
    <path d="M32 10 L50 16.5 V30 C50 41 42.5 48.5 32 53.5 C21.5 48.5 14 41 14 30 V16.5 Z" fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
    <path d="M23.5 32 L29.5 38 L41 25.5" fill="none" stroke="${CUT}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  egg: `
    <path d="M32 9 C44 9 49 28 49 37 C49 47 41.5 55 32 55 C22.5 55 15 47 15 37 C15 28 20 9 32 9 Z" fill="#fff"/>
    <path d="M23 33 C24 25 27 19 31 16" fill="none" stroke="${CUT}" stroke-width="3" stroke-linecap="round"/>`,
};

const svg = (mark) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <g transform="translate(0 1.4)" opacity="0.28" style="filter:none">${mark.replace(/#fff/g, '#000').replace(/rgba\(0,0,0,0\.32\)/g, 'transparent')}</g>
  ${mark}
</svg>`;

fs.mkdirSync(OUT, { recursive: true });
for (const [name, mark] of Object.entries(MARKS)) {
  const body = svg(mark);
  for (const scale of [1, 2, 3]) {
    const px = BASE * scale;
    const file = path.join(OUT, `${name}${scale > 1 ? `@${scale}x` : ''}.png`);
    await sharp(Buffer.from(body), { density: 72 * (px / 64) * 2 })
      .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
      .toFile(file);
    console.log(`${path.basename(file).padEnd(16)} ${px}px ${fs.statSync(file).size} B`);
  }
}
