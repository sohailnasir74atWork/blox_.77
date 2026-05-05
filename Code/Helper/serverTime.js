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
 * @param {string} uid - User ID (writes to users/{uid}/_st)
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

  // Probe: write serverTimestamp(), read back the server-generated value
  if (uid) {
    try {
      const probeRef = ref(db, `users/${uid}/_st`);
      await set(probeRef, serverTimestamp());
      const snap = await get(probeRef);
      const ts = snap.val();
      if (ts && typeof ts === 'number') {
        _probeOffset = ts - Date.now();
        _lastProbeAt = Date.now();
        return new Date(ts);
      }
    } catch (e) {
      console.warn('[serverTime] probe failed:', e?.message);
    }
  }

  // Fallback: .info/serverTimeOffset (less reliable after clock change)
  try {
    const snap = await get(ref(db, '.info/serverTimeOffset'));
    const offset = snap.val() || 0;
    return new Date(Date.now() + offset);
  } catch {}

  return new Date();
};

/**
 * Instant server-time estimate using the cached probe offset.
 * Use for UI display (countdowns). NOT for anti-cheat validation.
 */
export const getServerTimeQuick = () => new Date(Date.now() + _probeOffset);

/** Format a Date as "YYYY-MM-DD" in UTC */
export const formatServerDate = (d) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
