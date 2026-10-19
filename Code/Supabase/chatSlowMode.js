// Public-chat slow mode (supabase/046_chat_slowmode.sql).
//
// - fetchSlowMode(roomId): the all-rooms ('*') and per-room gap in seconds.
//   One tiny select per room, cached for TTL_MS; the server is the authority
//   (trg_ad_chat_slowmode), so a stale cache only affects the countdown.
// - A per-room "next send allowed at" clock that MessageInput (countdown) and
//   Trader (server SLOW_MODE errors) share; subscribe() re-renders on change.
// - setSlowMode(scope, seconds): Senior Mod+ (set_chat_slowmode rpc).
// - The public room on screen (Trader sets it) for the staff sheet in the
//   chat header, which lives outside Trader.
import { supabase } from './client';
import { isMissingSchemaError } from './modLogBackend';

export const SLOW_MODE_CHOICES = [0, 5, 10, 30, 60, 300];
export const ALL_ROOMS = '*';

const TTL_MS = 2 * 60 * 1000;
const cache = new Map();        // roomId → { global, room, at, available }
const nextAllowedAt = new Map(); // roomId → ms epoch
const listeners = new Set();
let activeRoom = null;           // { id, label }

const notify = () => listeners.forEach((fn) => { try { fn(); } catch (_) {} });

export const subscribeSlowMode = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const shape = (e) => ({
  global: e.global,
  room: e.room,
  effective: Math.max(e.global, e.room),
  available: e.available,
});

export const getCachedSlowMode = (roomId) => {
  const e = roomId && cache.get(roomId);
  return e ? shape(e) : { global: 0, room: 0, effective: 0, available: true };
};

// Never throws. `available: false` = 046 not applied yet (no slow mode).
export async function fetchSlowMode(roomId, { force = false } = {}) {
  if (!roomId) return getCachedSlowMode(null);
  const hit = cache.get(roomId);
  if (hit && !force && Date.now() - hit.at < TTL_MS) return shape(hit);
  try {
    const { data, error } = await supabase
      .from('chat_slowmode')
      .select('scope, seconds')
      .in('scope', [ALL_ROOMS, roomId]);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const val = (scope) => Number(rows.find((r) => r.scope === scope)?.seconds) || 0;
    cache.set(roomId, { global: val(ALL_ROOMS), room: val(roomId), at: Date.now(), available: true });
  } catch (err) {
    const available = !isMissingSchemaError(err);
    if (available) console.warn('[slowMode] fetch failed:', err?.message);
    // Keep the last good value on a network error; cache "off" otherwise.
    const prev = cache.get(roomId);
    cache.set(roomId, prev && available
      ? { ...prev, at: Date.now() }
      : { global: 0, room: 0, at: Date.now(), available });
  }
  notify();
  return shape(cache.get(roomId));
}

// Seconds left from a SLOW_MODE rejection (DETAIL carries them), else null.
export function slowModeErrorWait(error) {
  if (!error) return null;
  const text = [error.message, error.details, error.hint].filter((s) => typeof s === 'string').join(' ');
  if (!text.includes('SLOW_MODE')) return null;
  const secs = parseInt(error.details, 10);
  return Number.isFinite(secs) && secs > 0 ? secs : 1;
}

export const slowModeRemainingMs = (roomId) => Math.max(0, (nextAllowedAt.get(roomId) || 0) - Date.now());

// A message went through: the next one waits the room's gap.
export function noteSlowModeSent(roomId, seconds) {
  if (!roomId || !(seconds > 0)) return;
  nextAllowedAt.set(roomId, Date.now() + seconds * 1000);
  notify();
}

// The server refused with SLOW_MODE: trust its clock, and re-read the
// setting (it may have changed since we cached it).
export function noteSlowModeRejected(roomId, seconds) {
  if (!roomId) return;
  nextAllowedAt.set(roomId, Date.now() + Math.max(1, seconds) * 1000);
  notify();
  fetchSlowMode(roomId, { force: true });
}

// Senior Mod+ only (the rpc checks). Throws the Supabase error.
export async function setSlowMode(scope, seconds) {
  const { data, error } = await supabase.rpc('set_chat_slowmode', { p_scope: scope, p_seconds: seconds });
  if (error) throw error;
  const stored = Number(data) || 0;
  cache.forEach((e, roomId) => {
    if (scope === ALL_ROOMS) e.global = stored;
    else if (roomId === scope) e.room = stored;
  });
  notify();
  return stored;
}

export const setActivePublicRoom = (room) => {
  activeRoom = room?.id ? { id: room.id, label: room.label || room.id } : null;
  notify();
};
export const getActivePublicRoom = () => activeRoom;

// "30s" / "1m" style label for the choices (staff sheet).
export const slowModeShortLabel = (s) => (s <= 0 ? 'Off' : s < 60 ? `${s}s` : `${s / 60}m`);
