// All groups search (bug log 2026-10-19: search only filtered the groups
// already paged in). The server keeps groups/{id}.searchKeys = every word
// prefix of the name (functions/groupSearchKeys.js); the app looks up the
// first word of the search text with array-contains and checks the other
// words here. These helpers MUST split words exactly like the server —
// __tests__/groupSearch.test.js compares the two.

// Same character class as functions/groupSearchKeys.js SEPARATORS.
const SEPARATORS = /[\s!-/:-@[-`{-~¡-¿×÷ -⁯₠-⃏℀-⅏←-⯿　-〿️！-／：-＠［-｀｛-･\uD800-\uDFFF]+/;
const MAX_WORD = 20;

const normalise = (s) => {
  const t = String(s || '');
  return (typeof t.normalize === 'function' ? t.normalize('NFKC') : t).toLowerCase().trim();
};

export const groupSearchWords = (s) => normalise(s).split(SEPARATORS).filter(Boolean);

// The key the query looks up: the first word, cut like the server's prefixes.
export const groupSearchToken = (text) => {
  const first = groupSearchWords(text)[0];
  return first ? Array.from(first).slice(0, MAX_WORD).join('') : '';
};

// Every word of the search text starts some word of the group's name.
export const groupNameMatches = (name, text) => {
  const want = groupSearchWords(text);
  if (want.length === 0) return true;
  const have = groupSearchWords(name);
  return want.every((w) => have.some((h) => h.startsWith(w.length > MAX_WORD ? Array.from(w).slice(0, MAX_WORD).join('') : w)));
};
