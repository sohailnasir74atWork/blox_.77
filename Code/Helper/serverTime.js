/**
 * serverTime.js — Tamper-proof server time utility
 *
 * Problem: Firebase `.info/serverTimeOffset` becomes inaccurate when users
 * change their device clock after the SDK connects. This lets them cheat
 * daily rewards, ad cooldowns, and streak systems.
 *
 * Solution: Write `serverTimestamp()` to RTDB and read it back. The server
 * generates the timestamp, so it's immune to device clock manipulation.
 */

import { ref, set, get, serverTimestamp } from '@react-native-firebase/database';

// Cached offset (serverTime − Date.now()) from the last probe
let _probeOffset = 0;
let _lastProbeAt = 0;

/**
 * Get authoritative server time via a write-then-read probe.
 * Always returns real server time regardless of device clock.
 *
 * @param {object} db  - Firebase RTDB instance
 * @param {string} uid - User ID (writes to _serverTime/{uid}; legacy fallback users/{uid}/_st)
 * @param {boolean} [forceProbe=false] - Skip the 30-second cache
 * @returns {Promise<Date>}
 */
export const getServerTime = async (db, uid, forceProbe = false) => {
  if (!db) return new Date();

  // Use cached offset if fresh enough (< 30 s) and not forced
  const now = Date.now();
  if (!forceProbe && _lastProbeAt && (now - _lastProbeAt) < 30000) {
    return new Date(now + _probeOffset);
  }

  // Probe: write serverTimestamp(), read back the server-generated value.
  //
  // 2026-09: the probe lives at `_serverTime/{uid}` instead of
  // `users/{uid}/_st`. Every write under /users/{uid} fires the
  // mirrorUsersToSupabase Cloud Function (512 MB) for nothing — this probe
  // alone was ~80% of all its invocations. If the new path is rejected
  // (rules not deployed yet on some environment) we fall back to the legacy
  // path so behaviour is identical to older builds.
  if (uid) {
    const probeOnce = async (path) => {
      const probeRef = ref(db, path);
      await set(probeRef, serverTimestamp());
      const snap = await get(probeRef);
      const ts = snap.val();
      if (ts && typeof ts === 'number') {
        _probeOffset = ts - Date.now();
        _lastProbeAt = Date.now();
        return new Date(ts);
      }
      return null;
    };
    try {
      const d = await probeOnce(`_serverTime/${uid}`);
      if (d) return d;
    } catch (e) {
      try {
        const d = await probeOnce(`users/${uid}/_st`);
        if (d) return d;
      } catch (e2) {
        console.warn('[serverTime] probe failed:', e2?.message || e?.message);
      }
    }
  }

  // Fallback: .info/serverTimeOffset (less reliable after clock change)
  try {
    const snap = await get(ref(db, '.info/serverTimeOffset'));
    const offset = snap.val() || 0;
    // Better than nothing for the sync helpers when no probe has worked
    // (signed out); a real probe still wins once one succeeds.
    if (!_lastProbeAt) _probeOffset = offset;
    return new Date(Date.now() + offset);
  } catch {}

  return new Date();
};

/**
 * Instant server-time estimate using the cached probe offset.
 * Use for UI display (countdowns). NOT for anti-cheat validation.
 */
export const getServerTimeQuick = () => new Date(Date.now() + _probeOffset);

/** Sync ms-epoch server-time estimate (cached offset). See getServerTimeQuick. */
export const serverNowMs = () => Date.now() + _probeOffset;

/** True once at least one successful probe has populated the offset. */
export const isServerTimeWarm = () => _lastProbeAt > 0;

/**
 * Warm the cached offset with a real probe. Call once early (app start /
 * sign-in / foreground) so the synchronous getServerTimeQuick()/serverNowMs()
 * helpers are accurate for sync call sites (ban countdowns) that can't await.
 * Best-effort — swallows errors. Ported from adoptme-jan7.
 */
export const warmServerTime = async (db, uid) => {
  try {
    await getServerTime(db, uid, true);
  } catch {}
};

/** Format a Date as "YYYY-MM-DD" in UTC */
export const formatServerDate = (d) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
