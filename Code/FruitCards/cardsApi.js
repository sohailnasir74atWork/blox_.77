/**
 * cardsApi.js — Fruit Cards server calls (supabase/057_fruit_cards.sql) + caches.
 *
 * Reads: cards_state when the hub opens (cached 2 min), the catalogue once
 * per catalogVersion (MMKV), get_card_collection when the album opens
 * (cached 5 min; refetched after every pack; the last copy is kept in MMKV
 * only to paint the first frame). No realtime.
 *
 * Development: when the 057 functions are not deployed yet, __DEV__ builds
 * fall back to cardsMock.js (same rules, kept on the device) so every screen
 * can be exercised. Release builds never include the mock.
 */

import { supabase } from '../Supabase/client';
import { parseCatalog } from './cardMath';

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'fruit_cards' });
} catch (e) {
  const mem = new Map();
  storage = { getString: (k) => mem.get(k), set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
}

const STATE_TTL_MS = 2 * 60 * 1000;
const COLLECTION_TTL_MS = 5 * 60 * 1000;

let currentUid = null;
let stateCache = null;          // { at, uid, data }
const collectionCache = new Map(); // uid -> { at, data }
let catalogCache = null;        // { version, list }
let mock = null;

const isMissingFunction = (error) =>
  !!error && (error.code === 'PGRST202' || /Could not find the function|does not exist/i.test(error.message || ''));

async function call(fn, args) {
  if (mock) return mock[fn](args);
  const { data, error } = await supabase.rpc(fn, args || {});
  if (error) {
    if (__DEV__ && isMissingFunction(error)) {
      // 057 not deployed: switch this session to the local simulation.
      mock = require('./cardsMock').default;
      console.log('[FruitCards] 057 not deployed: using the local mock');
      return mock[fn](args);
    }
    throw error;
  }
  return data;
}

/** Map a server error to an i18n key under fruit_cards.err.* */
export const errorKey = (e) => {
  const m = String(e?.message || e || '');
  if (/free pack already opened/.test(m)) return 'free_used';
  if (/star pack limit/.test(m)) return 'star_limit';
  if (/no bonus packs/.test(m)) return 'no_bonus';
  if (/pack not available/.test(m)) return 'pack_closed';
  if (/no cards in this pack/.test(m)) return 'pack_empty';
  if (/not enough shards/.test(m)) return 'shards';
  if (/already owned/.test(m)) return 'owned';
  if (/not enough copies/.test(m)) return 'fuse_copies';
  if (/sign in required/.test(m)) return 'sign_in';
  return 'generic';
};

/** Scope caches to the signed-in player (null after sign-out). */
export const setCardsUser = (uid) => {
  if (uid === currentUid) return;
  currentUid = uid || null;
  stateCache = null;
  collectionCache.clear();
};

export const isMockActive = () => !!mock;

/** The pack this player last picked on the Fruit Cards screen, or null (then the first open one). */
export const getLastPackSet = (uid) => {
  try { return uid ? storage.getString(`pack:${uid}`) || null : null; } catch (e) { return null; }
};
export const rememberPackSet = (uid, setId) => {
  try { if (uid && setId) storage.set(`pack:${uid}`, setId); } catch (e) { /* convenience only */ }
};

export async function getCardsState({ force = false } = {}) {
  if (!force && stateCache && stateCache.uid === currentUid && Date.now() - stateCache.at < STATE_TTL_MS) {
    return stateCache.data;
  }
  const data = await call('cards_state');
  stateCache = { at: Date.now(), uid: currentUid, data };
  return data;
}

/** Last state without a network call (for an instant first paint). */
export const peekCardsState = () => (stateCache && stateCache.uid === currentUid ? stateCache.data : null);

// The catalogue for `version` from memory, else from the device copy; null if neither has it.
function cachedCatalog(version) {
  if (catalogCache && catalogCache.version === version) return catalogCache.list;
  try {
    const raw = storage.getString('catalog');
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && saved.version === version && Array.isArray(saved.rows)) {
        catalogCache = { version, list: parseCatalog(saved.rows) };
        return catalogCache.list;
      }
    }
  } catch (e) { /* refetch */ }
  return null;
}

export async function getCatalog(version) {
  const hit = cachedCatalog(version);
  if (hit) return hit;
  const rows = await call('card_catalog_list');
  catalogCache = { version, list: parseCatalog(rows) };
  if (!mock) {
    try { storage.set('catalog', JSON.stringify({ version, rows })); } catch (e) { /* cache only */ }
  }
  return catalogCache.list;
}

/** Catalogue already on the phone (or null), for a first paint without an empty frame. */
export const peekCatalog = (version) => (version == null ? null : cachedCatalog(version));

export async function getCollection(uid = null, { force = false } = {}) {
  const who = uid || currentUid || 'me';
  const hit = collectionCache.get(who);
  if (!force && hit && Date.now() - hit.at < COLLECTION_TTL_MS) return hit.data;
  const data = await call('get_card_collection', { p_uid: uid });
  collectionCache.set(who, { at: Date.now(), data });
  // The player's own copy is kept on the phone for the next first paint.
  if (!uid && currentUid && !mock) {
    try { storage.set(`col:${currentUid}`, JSON.stringify(data)); } catch (e) { /* paint cache only */ }
  }
  return data;
}

/**
 * The player's last known collection, even if stale (screens refetch behind
 * it): this session's copy, else the one saved on the phone. Paints "3 of 579"
 * on the first frame instead of "0 of 579" and then the jump.
 */
export const peekCollection = () => {
  const hit = collectionCache.get(currentUid || 'me');
  if (hit) return hit.data;
  if (!currentUid) return null;
  try {
    const raw = storage.getString(`col:${currentUid}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
};

const afterChange = (wallet) => {
  // Stale, not gone: the next getCollection refetches, while a screen that
  // opens meanwhile still paints the last known cards (peekCollection).
  const hit = collectionCache.get(currentUid || 'me');
  if (hit) hit.at = 0;
  if (stateCache && wallet) stateCache = { ...stateCache, at: Date.now(), data: { ...stateCache.data, wallet } };
};

/** source: 'free' | 'stars' | 'bonus' */
export async function openPack(setId, source) {
  const data = await call('open_card_pack', { p_set: setId, p_source: source });
  afterChange(data?.wallet);
  return data;
}

export async function craftCard(key) {
  const data = await call('craft_card', { p_key: key });
  afterChange(data?.wallet);
  return data;
}

/** 4 copies of (key, from) -> 1 of the next finish (fuse_card). */
export async function fuseCard(key, from) {
  const data = await call('fuse_card', { p_key: key, p_from: from });
  afterChange(data?.wallet);
  return data;
}

/** entries: [{ k, f }] (see cardMath.toggleShowcase). Returns the stored list. */
export async function setShowcase(entries) {
  const data = await call('set_card_showcase', { p_cards: entries.slice(0, 3).map((e) => ({ k: e.k, f: e.f })) });
  // Keep the cached collection in step, so the album sees the new pins at once.
  const hit = collectionCache.get(currentUid || 'me');
  if (hit && hit.data) hit.data = { ...hit.data, showcase: data };
  return data;
}
