/**
 * robloxIdentity.js — the Roblox name a new trade is posted under.
 *
 * Settings verifies a Roblox name (bio-code check) and saves
 * users/{uid}/robloxUsername + robloxUsernameVerified + robloxUserId on RTDB,
 * which stays the source of truth (Supabase user_roblox is a mirror). Once a
 * name is verified it is the only one a trade can carry: the create-trade
 * form shows it read-only, and the trade is stamped from the stored record,
 * re-read at submit, never from the text field. To change it the player
 * verifies a new name in Settings.
 *
 * Until 2026-10-23 the form field stayed editable, so a verified player could
 * post under any name, and posting also wrote the typed name to the profile
 * while robloxUsernameVerified stayed true. Unverified players still type a
 * name, as before.
 */
import { ref, get } from '@react-native-firebase/database';

const READ_TIMEOUT_MS = 5000;

// The verified name on a user record, or null when it is not verified.
export const verifiedRobloxName = (record) => {
  if (record?.robloxUsernameVerified !== true) return null;
  const name = typeof record.robloxUsername === 'string' ? record.robloxUsername.trim() : '';
  return name || null;
};

// Re-reads the two leaves from RTDB so a stale in-memory profile (verified on
// another device, Supabase mirror missed at login) cannot decide the name.
// Falls back to the in-memory record when the read fails or hangs.
export const readVerifiedRobloxName = async (db, uid, fallbackRecord) => {
  if (!db || !uid) return verifiedRobloxName(fallbackRecord);
  let timer;
  try {
    const [nameSnap, verifiedSnap] = await Promise.race([
      Promise.all([
        get(ref(db, `users/${uid}/robloxUsername`)),
        get(ref(db, `users/${uid}/robloxUsernameVerified`)),
      ]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), READ_TIMEOUT_MS); }),
    ]);
    return verifiedRobloxName({
      robloxUsername: nameSnap.val(),
      robloxUsernameVerified: verifiedSnap.val(),
    });
  } catch (e) {
    return verifiedRobloxName(fallbackRecord);
  } finally {
    clearTimeout(timer);
  }
};

// Name + verified flag for a new trade: the verified name when there is one,
// otherwise whatever the player typed (never marked verified).
export const robloxFieldsForTrade = (verifiedName, typedName) => (
  verifiedName
    ? { robloxUsername: verifiedName, robloxUsernameVerified: true }
    : { robloxUsername: typeof typedName === 'string' ? typedName.trim() : '', robloxUsernameVerified: false }
);
