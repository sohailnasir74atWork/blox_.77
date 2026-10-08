/**
 * make-art.mjs — the Home tab card art as tiny PNGs (same approach as
 * scripts/more-hub/make-icons.mjs).
 *
 *   node scripts/home-cards/make-art.mjs
 *
 *   cake      Birthdays: your birthday      (a chubby pink cake, one candle)
 *   balloons  Birthdays: your birthday soon (a round violet balloon)
 *   gift      Birthdays: players' birthdays today (a yellow present, pink bow)
 *
 * Ported from Adopt Me (2026-10-08); Blox only needs the birthday set.
 * Simple, friendly style: chunky rounded shapes, a cute face on each, two-tone
 * shading, one white shine, no outlines. Drawn for the white disc in
 * Code/HomeTab/HomeCardArt.jsx. Writes assets/home-cards/<name>.png, @2x and
 * @3x at a 56 pt base. Deterministic: re-running gives identical files.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// HOME_ART_OUT lets a draft go to a scratch folder before it replaces the assets.
const OUT = process.env.HOME_ART_OUT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/home-cards');
const BASE = 56;
const INK = '#3B1F33';

const grad = (id, stops, vertical = true) => `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="1">${
  stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
const svg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${defs}</defs>${body}</svg>`;

/** A cute face: dot eyes with a glint, a small smile, cheeks; `k` scales it. */
const face = (cx, cy, w = 7, k = 1, cheek = '#FF7EB6') => `
  <ellipse cx="${cx - w - 3.2 * k}" cy="${cy + 3.4 * k}" rx="${3 * k}" ry="${1.9 * k}" fill="${cheek}" opacity="0.55"/>
  <ellipse cx="${cx + w + 3.2 * k}" cy="${cy + 3.4 * k}" rx="${3 * k}" ry="${1.9 * k}" fill="${cheek}" opacity="0.55"/>
  <ellipse cx="${cx - w}" cy="${cy}" rx="${2.1 * k}" ry="${2.5 * k}" fill="${INK}"/>
  <ellipse cx="${cx + w}" cy="${cy}" rx="${2.1 * k}" ry="${2.5 * k}" fill="${INK}"/>
  <circle cx="${cx - w + 0.7 * k}" cy="${cy - 0.9 * k}" r="${0.8 * k}" fill="#FFFFFF"/>
  <circle cx="${cx + w + 0.7 * k}" cy="${cy - 0.9 * k}" r="${0.8 * k}" fill="#FFFFFF"/>
  <path d="M${cx - 2.6 * k} ${cy + 3 * k} Q${cx} ${cy + 5.6 * k} ${cx + 2.6 * k} ${cy + 3 * k}" stroke="${INK}" stroke-width="${1.6 * k}" stroke-linecap="round" fill="none"/>`;

/** A thick arc of a circle (angles in degrees, clockwise) ending in an arrowhead. */
const arcArrow = (cx, cy, r, a0, a1, color) => {
  const pt = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = pt(a0);
  const [x1, y1] = pt(a1 - 9); // the head covers the last few degrees
  const [tx, ty] = pt(a1);
  const t = ((a1 + 90) * Math.PI) / 180;   // clockwise tangent at the tip
  const n = (a1 * Math.PI) / 180;          // outward normal at the tip
  const head = [
    [tx + 3.2 * Math.cos(t), ty + 3.2 * Math.sin(t)],
    [tx - 2.6 * Math.cos(t) + 4.6 * Math.cos(n), ty - 2.6 * Math.sin(t) + 4.6 * Math.sin(n)],
    [tx - 2.6 * Math.cos(t) - 4.6 * Math.cos(n), ty - 2.6 * Math.sin(t) - 4.6 * Math.sin(n)],
  ].map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L');
  const f = (v) => v.toFixed(2);
  return `<path d="M${f(x0)} ${f(y0)} A${r} ${r} 0 0 1 ${f(x1)} ${f(y1)}" stroke="${color}" stroke-width="4.2" stroke-linecap="round" fill="none"/>
    <path d="M${head} Z" fill="${color}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
};

/** A gumdrop friend: a dome body centred on x, top at yt, bottom at yb. */
const blob = (x, r, yt, yb, id, shade) => `
  <path d="M${x - r} ${yb} V${yt + r} A${r} ${r} 0 0 1 ${x + r} ${yt + r} V${yb} Q${x + r} ${yb + 3} ${x + r - 3} ${yb + 3} H${x - r + 3} Q${x - r} ${yb + 3} ${x - r} ${yb} Z" fill="url(#${id})"/>
  <path d="M${x - r} ${yb - 4} V${yb} Q${x - r} ${yb + 3} ${x - r + 3} ${yb + 3} H${x + r - 3} Q${x + r} ${yb + 3} ${x + r} ${yb} V${yb - 4} Z" fill="${shade}" opacity="0.45"/>
  <ellipse cx="${x - r * 0.45}" cy="${yt + r * 0.55}" rx="${r * 0.2}" ry="${r * 0.32}" fill="#FFFFFF" opacity="0.75" transform="rotate(30 ${x - r * 0.45} ${yt + r * 0.55})"/>`;

const HEART = 'M32 51 C22 44 13 37.5 13 27.5 C13 21 17.8 16.5 23.5 16.5 C27.3 16.5 30.4 18.6 32 21.6 C33.6 18.6 36.7 16.5 40.5 16.5 C46.2 16.5 51 21 51 27.5 C51 37.5 42 44 32 51 Z';

/** A teardrop flame with a light core, its tip at (x, y). */
const flame = (x, y) => `
  <path d="M${x} ${y} C${x + 4.6} ${y + 5} ${x + 4.4} ${y + 11} ${x} ${y + 11} C${x - 4.4} ${y + 11} ${x - 4.6} ${y + 5} ${x} ${y} Z" fill="#FFB020"/>
  <path d="M${x} ${y + 4.5} C${x + 2.2} ${y + 7} ${x + 2} ${y + 10} ${x} ${y + 10} C${x - 2} ${y + 10} ${x - 2.2} ${y + 7} ${x} ${y + 4.5} Z" fill="#FFF3B0"/>`;

const ART = {
  // A chubby pink cake with a face, white drip icing and one candle.
  cake: svg(
    grad('cake', [[0, '#FF9CCB'], [1, '#F2559B']]),
    `<ellipse cx="32" cy="58" rx="20" ry="2.8" fill="rgba(120,40,80,0.16)"/>
     <rect x="11" y="28" width="42" height="29" rx="11" fill="url(#cake)"/>
     <path d="M11 53 C11 55 13 57 16 57 H48 C51 57 53 55 53 53 V49 C53 53 51 54 48 54 H16 C13 54 11 53 11 49 Z" fill="#D9437F" opacity="0.55"/>
     <path d="M11 37 C11 31.5 15 28 21 28 H43 C49 28 53 31.5 53 37 C53 40 51 41 49.5 39.5 C48 43.5 44 43.5 43 39.5 C41.5 42 38.5 42 37.5 39.5
              C36 44.5 31 44.5 30 39.5 C28.5 42 25.5 42 24.5 39.5 C23 43 19 43 18 39.5 C16 41.5 11 41 11 37 Z" fill="#FFFFFF"/>
     <circle cx="20" cy="33" r="1.3" fill="#FFC93C"/><circle cx="31" cy="31.5" r="1.3" fill="#7DD3FC"/>
     <circle cx="42" cy="33" r="1.3" fill="#A78BFA"/><circle cx="36.5" cy="35" r="1.1" fill="#FF7EB6"/><circle cx="25.5" cy="35.5" r="1.1" fill="#86EFAC"/>
     <rect x="29.5" y="15" width="5" height="14" rx="2.5" fill="#8B5CF6"/>
     <rect x="31" y="17" width="1.6" height="9" rx="0.8" fill="#FFFFFF" opacity="0.6"/>
     ${flame(32, 3.5)}
     ${face(32, 46.5)}`),

  // One round violet balloon with a face and a curly string.
  balloons: svg(
    grad('balloon', [[0, '#B79BFF'], [1, '#7C4DFF']]),
    `<path d="M32 46.5 C29 51 35 53 32 57 C30 59.5 33 61 34.5 62" stroke="#B9A6E8" stroke-width="1.8" stroke-linecap="round" fill="none"/>
     <path d="M29.6 44 H34.4 L35.6 48.2 H28.4 Z" fill="#6A3DF0"/>
     <path d="M32 4 C43 4 50 12.5 50 23.5 C50 35 41.5 45 32 45 C22.5 45 14 35 14 23.5 C14 12.5 21 4 32 4 Z" fill="url(#balloon)"/>
     <path d="M17 29 C19 38 25 44 32 45 C41.5 45 50 35 50 23.5 C49 33 42 40.5 32 40.5 C25 40.5 19.5 36 17 29 Z" fill="#6A3DF0" opacity="0.4"/>
     <ellipse cx="22.5" cy="14.5" rx="3.6" ry="6" fill="#FFFFFF" opacity="0.8" transform="rotate(28 22.5 14.5)"/>
     <circle cx="21" cy="23" r="1.4" fill="#FFFFFF" opacity="0.8"/>
     ${face(32, 26)}`),

  // A sunny yellow present with a pink ribbon and bow, and a face.
  gift: svg(
    grad('box', [[0, '#FFE070'], [1, '#FFB81F']]) + grad('lid', [[0, '#FFE88F'], [1, '#FFC93C']]),
    `<ellipse cx="32" cy="59" rx="20" ry="2.6" fill="rgba(120,80,0,0.16)"/>
     <rect x="13" y="30" width="38" height="27" rx="7" fill="url(#box)"/>
     <path d="M13 52 C13 55 15 57 18 57 H46 C49 57 51 55 51 52 V49 C51 52.5 49 54 46 54 H18 C15 54 13 52.5 13 49 Z" fill="#E59A00" opacity="0.5"/>
     <rect x="10" y="22" width="44" height="12" rx="6" fill="url(#lid)"/>
     <rect x="28" y="22" width="8" height="12" fill="#FF6FAE"/>
     <rect x="14" y="24.5" width="10" height="2.4" rx="1.2" fill="#FFFFFF" opacity="0.7"/>
     <path d="M32 22.5 C26 13 17 13.5 18.5 19.5 C19.5 23.5 26.5 23.5 32 22.5 Z" fill="#FF6FAE"/>
     <path d="M32 22.5 C38 13 47 13.5 45.5 19.5 C44.5 23.5 37.5 23.5 32 22.5 Z" fill="#FF6FAE"/>
     <path d="M21.5 17.5 C23.5 16.5 26 17.3 27.5 19" stroke="#FFFFFF" stroke-width="1.3" stroke-linecap="round" fill="none" opacity="0.75"/>
     <circle cx="32" cy="22.5" r="3.3" fill="#F24E97"/>
     ${face(32, 44.5, 6.5, 1, '#FF8A3D')}`),
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, body] of Object.entries(ART)) {
  for (const scale of [1, 2, 3]) {
    const px = BASE * scale;
    const file = path.join(OUT, `${name}${scale > 1 ? `@${scale}x` : ''}.png`);
    // density: librsvg rasterises at 72 dpi for the viewBox; scale it so the 64-unit art fills px.
    await sharp(Buffer.from(body), { density: 72 * (px / 64) * 2 })
      .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
      .toFile(file);
    console.log(`${path.basename(file).padEnd(16)} ${px}px ${fs.statSync(file).size} B`);
  }
}
