/**
 * useDobGate — Blox's one-time date-of-birth screen. Owner decision
 * 2026-10-07: ask every signed-in player once (new and existing), like Adopt
 * Me, so Birthdays (Code/Birthdays, supabase/036) can include everyone.
 *
 * Where the date lives: users_private/{uid}/dateOfBirth (owner-only read,
 * write-once rule), mirrored to Supabase user_identity_base.date_of_birth by
 * mirrorUsersPrivateToSupabase.
 *
 * Cost: at most one tiny read per account per install. Once the date is
 * known, MMKV remembers it (dob:<uid>) and later launches read nothing.
 *   1. MMKV has it → done, no read.
 *   2. users_private/{uid}/dateOfBirth → remember it.
 *   3. email_prefs/{uid}/dob (players who gave it at email opt-in) → copied
 *      into users_private silently, so nobody is asked twice.
 *   4. Otherwise the screen shows.
 * A failed read (offline) shows nothing; the next launch tries again. Old app
 * builds never ask, so this is additive.
 */

import { useCallback, useEffect, useState } from 'react';
import { ref, get } from '@react-native-firebase/database';
import { saveOwnPrivateProfile } from '../Helper/privateProfile';

let storage = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'dob-gate' });
} catch (_) { /* MMKV missing: we just read once per launch */ }

const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;
const key = (uid) => `dob:${uid}`;
const remembered = (uid) => { try { return storage?.getString(key(uid)) || null; } catch (_) { return null; } };
const remember = (uid, dob) => { try { storage?.set(key(uid), dob); } catch (_) { /* ignore */ } };

export default function useDobGate(uid, db) {
  const [dob, setDob] = useState(() => (uid ? remembered(uid) : null));
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    if (!uid || !db) { setDob(null); return undefined; }
    const known = remembered(uid);
    if (known) { setDob(known); return undefined; }
    let alive = true;
    (async () => {
      try {
        const own = (await get(ref(db, `users_private/${uid}/dateOfBirth`))).val();
        if (!alive) return;
        if (typeof own === 'string' && DOB_RE.test(own)) { remember(uid, own); setDob(own); return; }
        const fromEmail = (await get(ref(db, `email_prefs/${uid}/dob`))).val();
        if (!alive) return;
        if (typeof fromEmail === 'string' && DOB_RE.test(fromEmail)) {
          await saveOwnPrivateProfile(db, uid, { dateOfBirth: fromEmail }).catch(() => {});
          remember(uid, fromEmail);
          setDob(fromEmail);
          return;
        }
        setVisible(true);
      } catch (_) {
        // Offline or a read error: don't block the app; ask next launch.
      }
    })();
    return () => { alive = false; };
  }, [uid, db]);

  const submit = useCallback(async (dobString) => {
    if (!uid || !db) return;
    try {
      // Write-once rule: if a date is already on file the write is refused
      // and the stored one wins.
      await saveOwnPrivateProfile(db, uid, { dateOfBirth: dobString });
      remember(uid, dobString);
      setDob(dobString);
    } catch (_) {
      const stored = (await get(ref(db, `users_private/${uid}/dateOfBirth`)).catch(() => null))?.val?.();
      const final = typeof stored === 'string' && DOB_RE.test(stored) ? stored : dobString;
      remember(uid, final);
      setDob(final);
    }
    // Never leave the player stuck behind the screen.
    setVisible(false);
  }, [uid, db]);

  return { visible, dob, submit };
}
