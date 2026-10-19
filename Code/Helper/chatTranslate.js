// Chat translation (Google Translate v2), one copy for the app: the public
// chat (ChatScreen/GroupChat/MessagesList) and the staff tools (Admin
// Dashboard chat viewer, reports queue — AppHelper/TranslatableText).
//
// Fruit names are swapped for placeholders before sending and put back
// after, so "leopard for dough" doesn't come back as animals and pastry.
// No limits here: callers decide (players have a daily cap, staff none).
// `apiKey` is useGlobalState().api.
import axios from 'axios';

const TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2';
// Google accepts up to 128 segments per request; stay well under.
const BATCH = 50;

export const FRUIT_KEYWORDS = [
  'rocket', 'spin', 'chop', 'spring', 'bomb', 'spike', 'blade',
  'smoke', 'flame', 'ice', 'sand', 'dark', 'diamond', 'falcon',
  'rubber', 'barrier', 'ghost', 'light', 'magma', 'quake', 'love',
  'spider', 'sound', 'portal', 'pain', 'rumble', 'blizzard', 'buddha',
  'phoenix', 'gravity', 'shadow', 'venom', 'control', 'spirit', 'dough',
  'gas', 'dragon', 'leopard', 'kitsune', 'mammoth', 't-rex', 'yeti', 'perm', 'west', 'east', 'gamepass', 'skin', 'chromatic', 'permanent', 'Fruit Storage', 'game pass', 'Eagle', 'Creation', 'gamepass'
];

const KEYWORD_RES = FRUIT_KEYWORDS.map((word) => new RegExp(`\\b${word}\\b`, 'gi')); // full word, any case

const mask = (text) => {
  const placeholders = {};
  let masked = String(text);
  KEYWORD_RES.forEach((re, index) => {
    const placeholder = `__FRUIT_${index}__`;
    masked = masked.replace(re, placeholder);
    placeholders[placeholder] = FRUIT_KEYWORDS[index];
  });
  return { masked, placeholders };
};

const unmask = (translated, placeholders) => {
  let out = translated;
  Object.entries(placeholders).forEach(([placeholder, word]) => {
    out = out.replace(new RegExp(placeholder, 'g'), word);
  });
  return out;
};

/**
 * Translate one text into `targetLang`. Never throws.
 * @returns {Promise<string|null>} null on any failure (callers show their own message)
 */
export async function translateText(text, { apiKey, targetLang }) {
  if (!text || !apiKey || !targetLang) return null;
  const { masked, placeholders } = mask(text);
  try {
    const response = await axios.post(TRANSLATE_URL, {}, {
      // format 'text': plain text back, not HTML entities (&#39; …).
      params: { q: masked, target: targetLang, key: apiKey, format: 'text' },
    });
    const translated = response?.data?.data?.translations?.[0]?.translatedText;
    return typeof translated === 'string' ? unmask(translated, placeholders) : null;
  } catch (err) {
    // Network / quota errors: no red box in production.
    if (__DEV__) console.error('Translation Error:', err?.message || err);
    return null;
  }
}

/**
 * Translate many texts in as few requests as possible ("Translate all").
 * Never throws. Same order as `texts`; null where a text failed or was empty.
 * @returns {Promise<Array<string|null>>}
 */
export async function translateMany(texts, { apiKey, targetLang }) {
  const out = texts.map(() => null);
  if (!apiKey || !targetLang) return out;
  const todo = texts.map((t, i) => [i, t]).filter(([, t]) => typeof t === 'string' && t.trim());
  for (let start = 0; start < todo.length; start += BATCH) {
    const chunk = todo.slice(start, start + BATCH).map(([i, t]) => ({ i, ...mask(t) }));
    try {
      const response = await axios.post(
        TRANSLATE_URL,
        { q: chunk.map((c) => c.masked), target: targetLang, format: 'text' },
        { params: { key: apiKey } },
      );
      const list = response?.data?.data?.translations || [];
      chunk.forEach((c, j) => {
        const t = list[j]?.translatedText;
        if (typeof t === 'string') out[c.i] = unmask(t, c.placeholders);
      });
    } catch (err) {
      if (__DEV__) console.error('Translation Error (batch):', err?.message || err);
    }
  }
  return out;
}
