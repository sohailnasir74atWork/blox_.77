/**
 * tradeSearch.js — which trades a trade search keeps (2026-11-20).
 *
 * The Firestore query matches any WORD of any item name (hasItemNames /
 * wantsItemNames hold the full name plus each word), so "gravity" also returns
 * Starlight Gravity. Players asked (in-app suggestions, Oct–Nov 2026) for:
 *   - the exact fruit: when the term is a real item name, only that item counts;
 *   - "Perm only": the matching item must be permanent (trade item type 'p');
 *   - "Only this item": that side holds nothing but the item (two of it is fine).
 * The query stays as it is; these rules run on the fetched page.
 */

export const normalizeTerm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Does one side of a trade (hasItems or wantsItems: [{ name, type, value }])
 * match? `exact`: the item name must equal the term. Otherwise the term must be
 * the full name or one of its words, which is what the server index matches.
 */
export const sideMatches = (items, term, { exact = false, permOnly = false, onlyThis = false } = {}) => {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const hit = (it) => {
    const name = normalizeTerm(it?.name);
    if (!name) return false;
    const nameOk = exact ? name === term : (name === term || name.split(' ').includes(term));
    return nameOk && (!permOnly || it?.type === 'p');
  };
  return onlyThis ? list.length > 0 && list.every(hit) : list.some(hit);
};

/**
 * Keep a trade when any searched side matches. `statusValues`: null, or the
 * trade-status letters to keep ('w' | 'l' | 'f').
 */
export const tradeMatchesSearch = (trade, term, { inHas, inWants, statusValues = null, ...opts }) => {
  if (statusValues && statusValues.length && !statusValues.includes(trade?.status)) return false;
  return (inHas && sideMatches(trade?.hasItems, term, opts))
    || (inWants && sideMatches(trade?.wantsItems, term, opts));
};
