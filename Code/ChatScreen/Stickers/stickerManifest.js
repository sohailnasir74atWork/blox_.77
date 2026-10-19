// Chat sticker packs: a remote manifest on the Bunny CDN, cached in MMKV,
// with the original 16 stickers bundled as the offline fallback.
//
// Manifest: https://blox-api.b-cdn.net/stickers/manifest.json (storage zone
// blox-data, folder stickers/; the zone serves max-age=0, so an upload is
// live on the next check). Shape:
//   {
//     "version": 2,
//     "packs": [
//       { "id": "classic", "name": "Classic", "names": { "ja": "クラシック" },
//         "stickers": [ { "id": "e1", "url": "https://…/e1.png" } ] }
//     ]
//   }
// The app re-checks at most every CHECK_EVERY_MS, and only when the picker
// opens, and swaps its copy only when `version` changes. Bump it on every edit.
//
// isAllowedStickerUrl() mirrors public.sticker_url_allowed() in
// supabase/050_stickers.sql. The server rejects any other URL, so the picker
// drops it rather than offer a sticker that can't be sent.

import { withDeadline } from '../../Helper/catalogNetwork';

export const STICKER_MANIFEST_URL = 'https://blox-api.b-cdn.net/stickers/manifest.json';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_PACKS = 20;
const MAX_STICKERS_PER_PACK = 60;
const MAX_URL_LENGTH = 300;
const CACHE_KEY = 'manifest';
const CHECKED_AT_KEY = 'checkedAt';

// Legacy folder (the 16 original stickers, served by blox-web) and the Bunny
// folder new art goes into. Same list as 050_stickers.sql.
const LEGACY_BASE = 'https://bloxfruitscalc.com/wp-content/uploads/2025/Emojies/';
const STICKER_URL_RE =
  /^https:\/\/(bloxfruitscalc\.com\/wp-content\/uploads\/2025\/Emojies\/|blox-api\.b-cdn\.net\/stickers\/)[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.(png|webp|gif)$/;
const ID_RE = /^[a-z0-9_-]{1,32}$/;

export const isAllowedStickerUrl = (url) =>
  typeof url === 'string' && url.length <= MAX_URL_LENGTH && STICKER_URL_RE.test(url);

export const BUNDLED_MANIFEST = {
  version: 0,
  packs: [{
    id: 'classic',
    name: 'Classic',
    names: {},
    stickers: Array.from({ length: 16 }, (_, i) => ({ id: `e${i + 1}`, url: `${LEGACY_BASE}e${i + 1}.png` })),
  }],
};

// Keeps only well-formed packs and allowed URLs. null when nothing usable is
// left, so a broken upload falls back to the cached or bundled packs.
export function sanitizeManifest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const version = Number(raw.version);
  if (!Number.isFinite(version) || !Array.isArray(raw.packs)) return null;

  const seenPacks = new Set();
  const packs = [];
  for (const p of raw.packs) {
    if (packs.length >= MAX_PACKS) break;
    if (!p || typeof p !== 'object') continue;
    const id = String(p.id || '').toLowerCase();
    if (!ID_RE.test(id) || seenPacks.has(id)) continue;

    const seenUrls = new Set();
    const stickers = [];
    for (const s of Array.isArray(p.stickers) ? p.stickers : []) {
      if (stickers.length >= MAX_STICKERS_PER_PACK) break;
      const url = s && s.url;
      if (!isAllowedStickerUrl(url) || seenUrls.has(url)) continue;
      seenUrls.add(url);
      stickers.push({ id: String(s.id || url).slice(0, 64), url });
    }
    if (stickers.length === 0) continue;

    const names = {};
    if (p.names && typeof p.names === 'object') {
      for (const [lang, name] of Object.entries(p.names)) {
        if (typeof name === 'string' && name.trim()) names[lang] = name.trim().slice(0, 24);
      }
    }
    seenPacks.add(id);
    packs.push({
      id,
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 24) : id,
      names,
      stickers,
    });
  }
  return packs.length > 0 ? { version, packs } : null;
}

// Tab label: a translation key wins (chat.stickers.pack_<id>), then the
// manifest's name for this language, then its English name.
export const stickerPackName = (pack, t, language) => {
  const lang = String(language || 'en').split('-')[0];
  return t(`chat.stickers.pack_${pack.id}`, {
    defaultValue: (pack.names && pack.names[lang]) || pack.name || pack.id,
  });
};

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'stickers' });
} catch (e) {
  const mem = new Map();
  storage = { getString: (k) => mem.get(k), set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
}

const readCached = () => {
  try {
    const raw = storage.getString(CACHE_KEY);
    return raw ? sanitizeManifest(JSON.parse(raw)) : null;
  } catch (_) {
    return null;
  }
};

let current = readCached() || BUNDLED_MANIFEST;
let inflight = null;
const listeners = new Set();

export const getStickerPacks = () => current.packs;

export const subscribeStickerPacks = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Fetches the manifest when the last check is older than CHECK_EVERY_MS.
// Offline or broken uploads keep what the phone already has.
export function refreshStickerManifest({ force = false, now = Date.now() } = {}) {
  if (inflight) return inflight;
  const last = Number(storage.getString(CHECKED_AT_KEY)) || 0;
  if (!force && last && now - last < CHECK_EVERY_MS) return Promise.resolve(current);

  const controller = new AbortController();
  inflight = (async () => {
    try {
      const next = await withDeadline(async () => {
        const res = await fetch(STICKER_MANIFEST_URL, { signal: controller.signal });
        // Any HTTP answer counts as a check (a 404 before the first upload
        // should not refetch on every open). Network errors do not.
        storage.set(CHECKED_AT_KEY, String(now));
        return res.ok ? sanitizeManifest(await res.json()) : null;
      }, FETCH_TIMEOUT_MS, () => controller.abort());
      if (next && next.version !== current.version) {
        current = next;
        storage.set(CACHE_KEY, JSON.stringify(next));
        listeners.forEach((l) => { try { l(current.packs); } catch (_) {} });
      }
    } catch (_) {
      // keep the cached / bundled packs
    } finally {
      inflight = null;
    }
    return current;
  })();
  return inflight;
}

// Tests only.
export const __resetStickerManifestForTests = () => {
  storage.remove(CACHE_KEY);
  storage.remove(CHECKED_AT_KEY);
  current = BUNDLED_MANIFEST;
  inflight = null;
  listeners.clear();
};
