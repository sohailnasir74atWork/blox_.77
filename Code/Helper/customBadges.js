/**
 * customBadges.js — mod-granted badge customisation (2026-10-31; ported from
 * Adopt Me, Code/Helper/customBadges.js there — keep the two in step).
 *
 * Two RTDB nodes, both public-read, written by admins and MODs only
 * (database.rules.json):
 *
 *   custom_badges/{id}  = { name, icon, color, createdBy, createdAt, updatedAt }
 *     A badge a MOD made up: a short name (NAME_MAX_WORDS words / NAME_MAX_CHARS
 *     chars), one icon from CUSTOM_ICONS (assets/custom-badges, white marks the
 *     app draws inside a circle of the badge colour) and a default colour.
 *
 *   worn_badges/{uid}   = { styles: { <roleKey>: '#hex' }, custom: { <badgeId>: { color, at, by } },
 *                           customCount, updatedAt }
 *     What this player wears on top of the role flags in users/{uid}:
 *       styles  — a colour override per role badge (trusted / grinder /
 *                 raider / helper). The flag itself stays the source of
 *                 truth; a style for a badge the player no longer has is ignored.
 *       custom  — the custom badges granted to the player, each with an
 *                 optional colour override (null = the badge's own colour).
 *       customCount — Object.keys(custom).length, kept for the leaderboard
 *                 query (orderByChild). Never read it to render.
 *
 * A player wears at most MAX_WORN_BADGES badges counting role badges and
 * custom ones together (UI-enforced in BadgeManager; rules cannot count). Blox has no squad bar
 * for badges, so any Mod+ may grant to someone they outrank (canModerate).
 *
 * Reading: RoleBadges.jsx gets `badgeStyles` / `customBadges` from the cached
 * profile (profileCache.js) — the Supabase user_roles mirror
 * (functions/mirrorWornBadges.js, supabase/058_worn_badges.sql), else
 * worn_badges/{uid}. Custom
 * badge DEFINITIONS come from the registry below: one onValue on
 * custom_badges for the whole session (tens of rows), persisted in MMKV so a
 * cold start renders names before the listener answers.
 */

import { useEffect, useSyncExternalStore } from 'react';

// Firebase is required lazily (as badgeUtils.js does) so the pure parts of
// this module — constants, normalizeWorn, the key helpers badgeRail.js uses —
// load in jest without the native module.
const fb = () => require('@react-native-firebase/database');

export const MAX_WORN_BADGES = 3;
export const NAME_MAX_WORDS = 5;
export const NAME_MAX_CHARS = 24;

// Role badges a MOD can colour, and the users/{uid} flag behind each.
export const ROLE_BADGE_KEYS = ['trusted', 'grinder', 'raider', 'helper'];
export const ROLE_FLAG = { trusted: 'isTrusted', grinder: 'isGrinder', raider: 'isRaider', helper: 'isHelper' };
export const ROLE_LABEL = { trusted: 'Trusted', grinder: 'Grinder', raider: 'Raider', helper: 'Helper' };
// The chip colours in Code/Design/componenets/RoleBadges.jsx — what a badge looks like with no override.
export const ROLE_DEFAULT_COLOR = { trusted: '#10B981', grinder: '#06B6D4', raider: '#DC2626', helper: '#14B8A6' };
// Ionicons glyph per role chip (RoleBadges.jsx); helper draws its own image there.
export const ROLE_ICON = { trusted: 'checkmark-circle', grinder: 'barbell', raider: 'flash', helper: 'hand-left' };

// The palette a MOD picks from. Fixed so every badge stays legible on both
// themes (community pills tint the colour to ~10-15% and draw text in it).
export const BADGE_COLORS = [
  { key: 'pink',    hex: '#EC4899', label: 'Pink' },
  { key: 'rose',    hex: '#E11D48', label: 'Rose' },
  { key: 'red',     hex: '#DC2626', label: 'Red' },
  { key: 'orange',  hex: '#EA580C', label: 'Orange' },
  { key: 'amber',   hex: '#D97706', label: 'Amber' },
  { key: 'lime',    hex: '#65A30D', label: 'Lime' },
  { key: 'emerald', hex: '#059669', label: 'Emerald' },
  { key: 'teal',    hex: '#0D9488', label: 'Teal' },
  { key: 'sky',     hex: '#0284C7', label: 'Sky' },
  { key: 'blue',    hex: '#2563EB', label: 'Blue' },
  { key: 'violet',  hex: '#7C3AED', label: 'Violet' },
  { key: 'slate',   hex: '#475569', label: 'Slate' },
];

// scripts/custom-badges/make-custom-icons.mjs draws these.
export const CUSTOM_ICONS = {
  star:    require('../../assets/custom-badges/star.png'),
  heart:   require('../../assets/custom-badges/heart.png'),
  crown:   require('../../assets/custom-badges/crown.png'),
  flame:   require('../../assets/custom-badges/flame.png'),
  diamond: require('../../assets/custom-badges/diamond.png'),
  paw:     require('../../assets/custom-badges/paw.png'),
  trophy:  require('../../assets/custom-badges/trophy.png'),
  bolt:    require('../../assets/custom-badges/bolt.png'),
  rocket:  require('../../assets/custom-badges/rocket.png'),
  leaf:    require('../../assets/custom-badges/leaf.png'),
  moon:    require('../../assets/custom-badges/moon.png'),
  sun:     require('../../assets/custom-badges/sun.png'),
  gift:    require('../../assets/custom-badges/gift.png'),
  pencil:  require('../../assets/custom-badges/pencil.png'),
  shield:  require('../../assets/custom-badges/shield.png'),
  egg:     require('../../assets/custom-badges/egg.png'),
};
export const CUSTOM_ICON_NAMES = Object.keys(CUSTOM_ICONS);
export const DEFAULT_ICON = 'star';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const isHexColor = (s) => typeof s === 'string' && HEX_RE.test(s);
const cleanColor = (s) => (isHexColor(s) ? s.toUpperCase() : null);

/** Trim, collapse spaces, and check the word / character caps. */
export const validateBadgeName = (raw) => {
  const value = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, reason: 'Give the badge a name.', value };
  if (value.length > NAME_MAX_CHARS) return { ok: false, reason: `Keep it under ${NAME_MAX_CHARS} characters.`, value };
  if (value.split(' ').length > NAME_MAX_WORDS) return { ok: false, reason: `${NAME_MAX_WORDS} words at most.`, value };
  if (/[<>{}[\]\\]/.test(value)) return { ok: false, reason: 'Letters, numbers and simple punctuation only.', value };
  return { ok: true, value };
};

// ── keys ────────────────────────────────────────────────────────────────
// Rails identify a custom badge as 'custom:<id>' next to the role keys.
export const customKey = (id) => `custom:${id}`;
export const isCustomKey = (k) => typeof k === 'string' && k.startsWith('custom:');
export const customIdOf = (k) => (isCustomKey(k) ? k.slice(7) : null);

/** Normalise a worn_badges row (RTDB or the Supabase columns) to { styles, custom }. */
export const normalizeWorn = (raw) => {
  const styles = {};
  const custom = {};
  const src = raw && typeof raw === 'object' ? raw : {};
  const st = src.styles && typeof src.styles === 'object' ? src.styles : {};
  for (const k of ROLE_BADGE_KEYS) {
    const c = cleanColor(st[k]);
    if (c) styles[k] = c;
  }
  const cu = src.custom && typeof src.custom === 'object' ? src.custom : {};
  for (const id of Object.keys(cu)) {
    const v = cu[id];
    if (!v) continue;
    const entry = typeof v === 'object' ? v : {};
    custom[id] = { color: cleanColor(entry.color), at: Number(entry.at) || 0, by: typeof entry.by === 'string' ? entry.by : null };
  }
  return { styles, custom };
};

/** Custom badge ids a player wears, oldest grant first. */
export const customIdsOf = (customBadges) => {
  if (!customBadges || typeof customBadges !== 'object') return [];
  return Object.keys(customBadges)
    .filter((id) => !!customBadges[id])
    .sort((a, b) => (Number(customBadges[a]?.at) || 0) - (Number(customBadges[b]?.at) || 0));
};

export const roleBadgeCount = (u) => ROLE_BADGE_KEYS.filter((k) => !!u?.[ROLE_FLAG[k]]).length;
/** Role badges + custom badges this player wears (the MAX_WORN_BADGES cap). */
export const wornBadgeCount = (u) => roleBadgeCount(u) + customIdsOf(u?.customBadges).length;

// ── registry: custom_badges definitions ─────────────────────────────────
let store;
try {
  const { createMMKV } = require('react-native-mmkv');
  store = createMMKV({ id: 'custom-badges' });
} catch (e) {
  store = { getString: () => undefined, set: () => {} };
}
const MMKV_KEY = 'defs_v1';

const normalizeDef = (id, v) => {
  if (!v || typeof v !== 'object') return null;
  const name = validateBadgeName(v.name);
  if (!name.ok) return null;
  const icon = CUSTOM_ICONS[v.icon] ? v.icon : DEFAULT_ICON;
  return {
    id,
    name: name.value,
    icon,
    color: cleanColor(v.color) || BADGE_COLORS[0].hex,
    createdBy: typeof v.createdBy === 'string' ? v.createdBy : null,
    createdAt: Number(v.createdAt) || 0,
    updatedAt: Number(v.updatedAt) || 0,
  };
};

const normalizeDefs = (raw) => {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const id of Object.keys(raw)) {
      const d = normalizeDef(id, raw[id]);
      if (d) out[id] = d;
    }
  }
  return out;
};

let defs = (() => {
  try {
    const raw = store.getString(MMKV_KEY);
    return raw ? normalizeDefs(JSON.parse(raw)) : {};
  } catch { return {}; }
})();
let defsList = Object.values(defs).sort((a, b) => a.name.localeCompare(b.name));
const listeners = new Set();
let registryDb = null;
let unsubRegistry = null;

const publish = (next) => {
  defs = next;
  defsList = Object.values(defs).sort((a, b) => a.name.localeCompare(b.name));
  try { store.set(MMKV_KEY, JSON.stringify(defs)); } catch {}
  listeners.forEach((l) => { try { l(); } catch {} });
};

// Cost (2026-11-13): a live onValue re-downloaded the whole node (~0.9 KB) on
// every app start — ~100 reads/min project-wide for a list that changes a few
// times a week. Now one get() at most every REFRESH_MS (MMKV keeps the defs
// between launches), plus a throttled refresh when a player wears a badge id
// this phone has never seen, and a forced one after a MOD edits the list.
const FETCHED_AT_KEY = 'defs_fetched_at';
const REFRESH_MS = 6 * 60 * 60 * 1000;   // routine refresh
const MISS_REFRESH_MS = 10 * 60 * 1000;  // unknown badge id: at most this often
let lastAttemptAt = 0;
let inflight = null;

const fetchedAt = () => {
  try { return Number(store.getString(FETCHED_AT_KEY)) || 0; } catch { return 0; }
};

/** Read custom_badges once (deduped). force skips the throttle. */
export const refreshCustomBadges = ({ force = false, minGapMs = MISS_REFRESH_MS } = {}) => {
  const database = registryDb;
  if (!database) return Promise.resolve(false);
  if (inflight) return inflight;
  const now = Date.now();
  if (!force && now - lastAttemptAt < minGapMs) return Promise.resolve(false);
  lastAttemptAt = now;
  inflight = fb().get(fb().ref(database, 'custom_badges'))
    .then((snap) => {
      publish(normalizeDefs(snap && snap.exists() ? snap.val() : {}));
      try { store.set(FETCHED_AT_KEY, String(Date.now())); } catch {}
      return true;
    })
    .catch(() => false) // denied / offline: keep what MMKV had
    .finally(() => { inflight = null; });
  return inflight;
};

/** GlobelStats calls this once the database exists. Fetches only when stale. */
export const startCustomBadgeRegistry = (database) => {
  if (!database || registryDb === database) return;
  if (unsubRegistry) { try { unsubRegistry(); } catch {} unsubRegistry = null; }
  registryDb = database;
  if (Date.now() - fetchedAt() >= REFRESH_MS) refreshCustomBadges({ force: true });
};

export const getCustomBadge = (id) => {
  if (!id) return null;
  const def = defs[id];
  // A badge made after our last fetch: pick it up (throttled) and redraw.
  if (!def) refreshCustomBadges();
  return def || null;
};
export const getAllCustomBadges = () => defsList;

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getSnapshot = () => defsList;
/** Every custom badge definition, A→Z; re-renders when the node changes. */
export const useCustomBadges = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
/** Same, for the MOD screens that edit or grant badges: re-reads on open (≤ once a minute). */
export const useFreshCustomBadges = () => {
  useEffect(() => { refreshCustomBadges({ minGapMs: 60 * 1000 }); }, []);
  return useCustomBadges();
};

/** Resolve one worn custom badge to what the rail draws: { id, name, icon, color }. */
export const resolveCustomBadge = (id, wornEntry) => {
  const def = getCustomBadge(id);
  if (!def) return null;
  const override = cleanColor(wornEntry?.color);
  return { id, name: def.name, icon: def.icon, image: CUSTOM_ICONS[def.icon], color: override || def.color };
};

// ── writes (MOD / admin; the rules reject anyone else) ──────────────────

/** Create (no id) or edit (id) a custom badge. Returns the id. */
export const saveCustomBadge = async (database, { id, name, icon, color }, byUid) => {
  const n = validateBadgeName(name);
  if (!n.ok) throw new Error(n.reason);
  if (!CUSTOM_ICONS[icon]) throw new Error('Pick an icon.');
  const hex = cleanColor(color);
  if (!hex) throw new Error('Pick a colour.');
  const now = Date.now();
  if (id) {
    await fb().update(fb().ref(database, `custom_badges/${id}`), { name: n.value, icon, color: hex, updatedAt: now });
    refreshCustomBadges({ force: true });
    return id;
  }
  const node = fb().push(fb().ref(database, 'custom_badges'));
  await fb().set(node, { name: n.value, icon, color: hex, createdBy: byUid || null, createdAt: now, updatedAt: now });
  refreshCustomBadges({ force: true });
  return node.key;
};

/** Delete a custom badge and take it off everyone wearing it (best effort). */
export const deleteCustomBadge = async (database, id) => {
  if (!id) return;
  await fb().remove(fb().ref(database, `custom_badges/${id}`));
  refreshCustomBadges({ force: true });
  try {
    const holders = await getCustomBadgeHolders(database, { limit: 500 });
    await Promise.all(holders
      .filter((h) => !!h.custom[id])
      .map((h) => revokeCustomBadge(database, h.uid, id)));
  } catch (e) {
    console.warn('[customBadges] holder cleanup failed:', e?.message);
  }
};

export const fetchWornBadges = async (database, uid) => {
  if (!database || !uid) return normalizeWorn(null);
  try {
    const snap = await fb().get(fb().ref(database, `worn_badges/${uid}`));
    return normalizeWorn(snap.exists() ? snap.val() : null);
  } catch (e) {
    return normalizeWorn(null);
  }
};

/** Write the whole node (small) so customCount can never drift. */
export const writeWornBadges = async (database, uid, worn) => {
  const w = normalizeWorn(worn);
  const customIds = Object.keys(w.custom);
  if (Object.keys(w.styles).length === 0 && customIds.length === 0) {
    await fb().remove(fb().ref(database, `worn_badges/${uid}`));
    return w;
  }
  await fb().set(fb().ref(database, `worn_badges/${uid}`), {
    styles: w.styles,
    custom: w.custom,
    customCount: customIds.length,
    updatedAt: Date.now(),
  });
  return w;
};

/** Colour a role badge (hex) or clear the override (null). Returns the new worn. */
export const setRoleBadgeColor = async (database, uid, roleKey, hexOrNull) => {
  if (!ROLE_BADGE_KEYS.includes(roleKey)) throw new Error('Unknown badge');
  const worn = await fetchWornBadges(database, uid);
  const hex = cleanColor(hexOrNull);
  if (hex) worn.styles[roleKey] = hex; else delete worn.styles[roleKey];
  return writeWornBadges(database, uid, worn);
};

export const grantCustomBadge = async (database, uid, badgeId, color, byUid) => {
  if (!getCustomBadge(badgeId)) throw new Error('That badge no longer exists');
  const worn = await fetchWornBadges(database, uid);
  const prev = worn.custom[badgeId];
  worn.custom[badgeId] = { color: cleanColor(color), at: prev?.at || Date.now(), by: byUid || prev?.by || null };
  return writeWornBadges(database, uid, worn);
};

export const revokeCustomBadge = async (database, uid, badgeId) => {
  const worn = await fetchWornBadges(database, uid);
  delete worn.custom[badgeId];
  return writeWornBadges(database, uid, worn);
};

/** Players wearing at least one custom badge (the leaderboard's Custom tab). */
export const getCustomBadgeHolders = async (database, { limit = 100 } = {}) => {
  const snap = await fb().get(fb().query(
    fb().ref(database, 'worn_badges'),
    fb().orderByChild('customCount'),
    fb().startAt(1),
    fb().limitToFirst(limit),
  ));
  const out = [];
  if (snap && snap.exists()) {
    snap.forEach((child) => {
      const worn = normalizeWorn(child.val());
      if (Object.keys(worn.custom).length > 0) {
        out.push({ uid: child.key, custom: worn.custom, styles: worn.styles, updatedAt: Number(child.val()?.updatedAt) || 0 });
      }
      return undefined;
    });
  }
  // Most recently changed first.
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
};
