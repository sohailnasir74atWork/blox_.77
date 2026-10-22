// Own users/{uid} record WITHOUT the `shop` child (2026-10-22 cost fix).
//
// shop/inventory + shop/ownedItems are ~76% of an average record (up to
// tens of KB) and nothing that reads the whole record uses them — the
// Store screens read users/{uid}/shop/* directly. Whole-record reads were
// half of all RTDB download, so read everything else as two key ranges
// (orderByKey needs no index) instead of one whole read.
//
// RNFB's database has no startAfter/endBefore (the modular helpers exist but
// throw "Cannot read property 'apply' of undefined" — that broke sign-in in a
// test build), so the ranges use startAt/endAt around 'shop'. Any failure
// falls back to the old whole-record read: sign-in must never depend on this.
import { ref, get, query, orderByKey, startAt, endAt } from '@react-native-firebase/database';

const SKIPPED_CHILD = 'shop';
const BEFORE_END = 'shoo'; // last key sorting before 'shop'
const AFTER_START = 'shop ';      // first key sorting after 'shop' (' ' is the lowest legal key char)

/**
 * @returns {Promise<{ exists: boolean, val: object|null }>}
 *   `exists` is the record's existence INCLUDING shop, so a caller that
 *   creates missing records never overwrites a shop-only record.
 */
export async function getUserRecordWithoutShop(db, uid) {
  const userRef = ref(db, `users/${uid}`);
  try {
    const [before, after] = await Promise.all([
      get(query(userRef, orderByKey(), endAt(BEFORE_END))),
      get(query(userRef, orderByKey(), startAt(AFTER_START))),
    ]);
    const val = { ...(before.exists() ? before.val() : {}), ...(after.exists() ? after.val() : {}) };
    if (Object.keys(val).length > 0) return { exists: true, val };
    // Nothing but (maybe) shop: one tiny check before anyone treats it as new.
    const shop = await get(ref(db, `users/${uid}/${SKIPPED_CHILD}`));
    return { exists: shop.exists(), val: shop.exists() ? {} : null };
  } catch (err) {
    if (__DEV__) console.warn('[userRecord] range read failed, reading whole record:', err?.message || err);
    const snap = await get(userRef);
    if (!snap.exists()) return { exists: false, val: null };
    const { [SKIPPED_CHILD]: _shop, ...rest } = snap.val() || {};
    return { exists: true, val: rest };
  }
}
