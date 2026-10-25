/**
 * useStarBalance — the player's spendable ⭐ balance, live.
 *
 * Listens to users/{uid}/dailyStars, so the number moves the moment stars are
 * claimed (DailyStarRewards) or spent (card packs, Mystery Egg) on any screen.
 * Same fallback as getStarBalance(): accounts from before `starBalance`
 * existed count their totalStarsEarned until the first spend seeds it.
 * Returns null until the first value arrives — or, after the first time this
 * session, the last balance seen, so a screen opening again does not swap its
 * star button's text a moment after it appears; the listener corrects it.
 */
import { useEffect, useState } from 'react';
import { ref, onValue } from '@react-native-firebase/database';

const lastSeen = new Map(); // uid -> balance

export default function useStarBalance(db, uid) {
  const [balance, setBalance] = useState(() => (db && uid && lastSeen.has(uid) ? lastSeen.get(uid) : null));
  useEffect(() => {
    if (!db || !uid) { setBalance(null); return undefined; }
    if (lastSeen.has(uid)) setBalance(lastSeen.get(uid));
    const unsub = onValue(
      ref(db, `users/${uid}/dailyStars`),
      (snap) => {
        const d = snap.exists() ? snap.val() || {} : {};
        const next = d.starBalance ?? d.totalStarsEarned ?? 0;
        lastSeen.set(uid, next);
        setBalance(next);
      },
      () => setBalance(0),
    );
    return () => unsub();
  }, [db, uid]);
  return balance;
}
