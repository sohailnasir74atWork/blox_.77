/**
 * Word prefixes of a group name, lowercased: the `searchKeys` array on
 * groups/{id} that the All groups search queries with array-contains.
 * Written by functions/groupMembership.js (trigger) and
 * scripts/groups/backfill-group-members.js. The app's copy is
 * Code/ChatScreen/utils/groupSearch.js; __tests__/groupSearch.test.js keeps
 * the two identical. No dependencies, so the backfill script can require it.
 */
// Spaces, ASCII / Latin-1 / general / CJK / full-width punctuation and
// symbols, arrows-to-misc-symbols (U+2190–2BFF), emoji (surrogate pairs) and
// U+FE0F. Spelled out instead of \p{…}, which Hermes may not support.
const SEPARATORS = /[\s!-/:-@[-`{-~¡-¿×÷ -⁯₠-⃏℀-⅏←-⯿　-〿️！-／：-＠［-｀｛-･\uD800-\uDFFF]+/;
const MAX_WORD = 20;
const MAX_KEYS = 80;

const normalise = (s) => {
  const t = String(s || '');
  return (typeof t.normalize === 'function' ? t.normalize('NFKC') : t).toLowerCase().trim();
};
const wordsOf = (s) => normalise(s).split(SEPARATORS).filter(Boolean);

function searchKeysFor(name) {
  const keys = new Set();
  for (const word of wordsOf(name)) {
    const chars = Array.from(word);
    for (let i = 1; i <= Math.min(chars.length, MAX_WORD); i++) keys.add(chars.slice(0, i).join(''));
    if (keys.size >= MAX_KEYS) break;
  }
  return [...keys].slice(0, MAX_KEYS);
}

module.exports = { searchKeysFor, wordsOf, MAX_WORD };
