/**
 * cardArt.js — which art exists, and painted fallbacks for everything else.
 *
 * Painted art (backgrounds, packs, backs) can be uploaded to the CDN over time.
 * The app asks for a file only when the CDN manifest lists it, so a missing
 * picture costs no request; until it arrives, each background is painted
 * with layered gradients (RN 0.87 `backgroundImage`), sharp at any size.
 */

import { cdnBase, fruitArtUrl } from './cardConfig';

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'fruit_cards_art' });
} catch (e) {
  const mem = new Map();
  storage = { getString: (k) => mem.get(k), set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
}

const MANIFEST_TTL_MS = 6 * 60 * 60 * 1000;
let fruitKeys = null;   // Set of card keys with art
let assetIds = null;    // Set of art ids (BG-…, P-…, CB-…)
let fruit2k = null;     // Set of card keys with 2048 px wallpaper art
let loading = null;
let cacheRead = false;  // the saved lists are parsed once per session
let lastTry = 0;        // last network refresh attempt
// The background-art list (index.json) 404s while no backgrounds are uploaded,
// so the lists were never all "fresh" and every card screen focus re-parsed
// the saved lists and re-downloaded all three. Now: retry at most this often.
const RETRY_MS = 10 * 60 * 1000;

// A manifest is a list of ids. Anything else (an error page, another file
// served on a catch-all path) is rejected rather than trusted.
const isIdList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

const readCache = (k) => {
  try {
    const raw = storage.getString(k);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && isIdList(v.list) ? v : null;
  } catch (e) {
    return null;
  }
};

// The CDN (and the phone's HTTP cache) keep files for 30 days. Pictures never
// change, so that's right for them; the id lists DO change, so they are asked
// for with a stamp that rolls over every 6 hours (a fresh copy at most 4x a day).
const listStamp = () => Math.floor(Date.now() / MANIFEST_TTL_MS);

const fetchList = async (url) => {
  const r = await fetch(`${url}?v=${listStamp()}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const len = Number(r.headers.get('content-length'));
  if (len > 200000) throw new Error('not a manifest');
  const list = await r.json();
  if (!isIdList(list)) throw new Error('not a manifest');
  return list;
};

/** Load the CDN manifests (cached 6 h). Safe to call often. */
export const loadArtManifest = async () => {
  if (loading) return loading;
  if (Date.now() - lastTry < RETRY_MS) return null;
  if (!cacheRead) {
    cacheRead = true;
    const cachedFruits = readCache('fruits');
    const cachedAssets = readCache('assets');
    const cached2k = readCache('fruits2k');
    if (cachedFruits) fruitKeys = new Set(cachedFruits.list);
    if (cachedAssets) assetIds = new Set(cachedAssets.list);
    if (cached2k) fruit2k = new Set(cached2k.list);
    const fresh = (c) => c && Date.now() - c.at < MANIFEST_TTL_MS;
    if (fresh(cachedFruits) && fresh(cachedAssets) && fresh(cached2k)) {
      // All fresh: check again once they can have gone stale.
      lastTry = Math.min(cachedFruits.at, cachedAssets.at, cached2k.at) + MANIFEST_TTL_MS - RETRY_MS;
      return null;
    }
  }
  lastTry = Date.now();
  let ok = 0;
  loading = Promise.all([
    fetchList(`${cdnBase()}/fruits/index.json`).then((list) => {
      fruitKeys = new Set(list);
      storage.set('fruits', JSON.stringify({ at: Date.now(), list }));
      ok += 1;
    }).catch(() => {}),
    fetchList(`${cdnBase()}/index.json`).then((list) => {
      assetIds = new Set(list);
      storage.set('assets', JSON.stringify({ at: Date.now(), list }));
      ok += 1;
    }).catch(() => {}),
    fetchList(`${cdnBase()}/fruits/2k/index.json`).then((list) => {
      fruit2k = new Set(list);
      storage.set('fruits2k', JSON.stringify({ at: Date.now(), list }));
      ok += 1;
    }).catch(() => {}),
  ]).finally(() => {
    loading = null;
    // All three fresh: the next look is when they go stale, as before.
    if (ok === 3) lastTry = Date.now() + MANIFEST_TTL_MS - RETRY_MS;
  });
  return loading;
};

/** True when the card's own art is listed in the CDN manifest (false while the list is unknown). */
export const hasFruitArt = (key) => !!fruitKeys && fruitKeys.has(key);

/**
 * The Values screen's icon for an item (ValueScreen.jsx formatName). Smaller
 * than the card art, but it exists for every item today, so a card never shows
 * the empty placeholder: before the card zone is live, while the manifest is
 * still unknown, or for a card the manifest does not list.
 */
export const fruitIconUrl = (name) =>
  `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${String(name || '').replace(/^\+/, '').replace(/\s+/g, '-')}_Icon.webp`;

/** Best picture for a card: the CDN art when the manifest lists it, else the Values icon. */
export const fruitImageUrl = (card, size = 1024) =>
  (hasFruitArt(card?.key) ? fruitArtUrl(card.key, size) : fruitIconUrl(card?.name));
/** True when the 2048 px wallpaper art exists (otherwise wallpapers use the 1024). */
export const hasFruitArt2k = (key) => !!fruit2k && fruit2k.has(key);
/** True when a painted asset (e.g. 'BG-SEA-SUNSET') has been uploaded. */
export const hasAsset = (id) => !!assetIds && assetIds.has(id);
export const assetUri = (id) => (hasAsset(id) ? `${cdnBase()}/${id}.webp` : null);

// ── Painted fallbacks ──────────────────────────────────────────────────────
// Each is a CSS background-image list: sky + light + ground. Designed to read
// as the same place as the AI painting that will replace it.
const sun = (x, y, c = '255,240,190') =>
  `radial-gradient(circle at ${x}% ${y}%, rgba(${c},0.95) 0%, rgba(${c},0.45) 7%, rgba(${c},0) 24%)`;
const ground = (c1, c2, y = 104) =>
  `radial-gradient(ellipse 140% 42% at 50% ${y}%, ${c1} 0%, ${c2} 55%, rgba(0,0,0,0) 72%)`;
const sky = (...stops) => `linear-gradient(180deg, ${stops.join(', ')})`;
const glow = (x, y, rgb, a = 0.5, r = 30) =>
  `radial-gradient(circle at ${x}% ${y}%, rgba(${rgb},${a}) 0%, rgba(${rgb},0) ${r}%)`;

export const BG_PAINT = {
  sea_day: [sun(74, 20, '255,250,215'), glow(30, 30, '255,255,255', 0.35, 30), ground('#0E6FA8', '#1690C9', 108), sky('#3FA9F5 0%', '#9BDBFF 42%', '#CFF3FF 56%', '#33B5E5 60%', '#0B6FA3 100%')],
  sea_sunset: [sun(50, 50, '255,170,70'), glow(50, 58, '255,120,60', 0.45, 40), ground('#0B3A66', '#14507F', 108), sky('#2A1450 0%', '#B5354B 32%', '#FF9A3C 52%', '#F2A541 58%', '#1B4F7A 61%', '#0B2C4F 100%')],
  sea_island: [sun(26, 22, '255,240,190'), ground('#F3D9A2', '#F8E6BE', 104), sky('#2FA8F0 0%', '#8EDCFF 40%', '#5FE0D8 54%', '#2BC4C4 59%', '#F3D9A2 64%', '#F8E6BE 100%')],
  sea_night: [glow(78, 18, '235,240,255', 0.9, 8), glow(30, 30, '120,160,255', 0.25, 45), ground('#0B2540', '#0E2F52', 108), sky('#030716 0%', '#0E1A44 45%', '#1F2E6B 58%', '#0B2540 61%', '#06182B 100%')],
  sea_snow: [sun(70, 30, '255,220,200'), ground('#FFFFFF', '#E3EEFA'), sky('#3A4F8C 0%', '#9AA8D9 35%', '#F6C9C2 58%', '#F2F6FC 61%', '#E5EEF9 100%')],
  beast_dusk: [glow(50, 56, '255,120,40', 0.55, 40), glow(80, 18, '255,220,160', 0.6, 10), ground('#2A1608', '#3B200D'), sky('#120A06 0%', '#4A1E0E 38%', '#E2683C 56%', '#3B200D 61%', '#1E1007 100%')],
  logia_storm: [glow(65, 25, '120,230,255', 0.75, 14), glow(25, 60, '160,120,255', 0.35, 40), ground('#141B3D', '#1C2552'), sky('#050B1F 0%', '#16205A 40%', '#3A4FA0 58%', '#141B3D 61%', '#0A0F26 100%')],
  vault: [glow(50, 40, '255,201,74', 0.45, 45), glow(20, 15, '200,140,255', 0.25, 30), glow(80, 85, '200,140,255', 0.25, 30), sky('#07040F 0%', '#1C0F33 45%', '#2E1A52 75%', '#120A22 100%')],
};

/** CSS background for a bg id (falls back to the day sea). */
export const paintFor = (bgId) => (BG_PAINT[bgId] || BG_PAINT.sea_day).join(', ');
export const bgAssetId = (bgId) => `BG-${String(bgId).toUpperCase().replace(/_/g, '-')}`;
