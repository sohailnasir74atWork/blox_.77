// Chat translation (Google Translate v2), one copy for the app: the public
// chat (ChatScreen/GroupChat/MessagesList), private chat (PrivateMessageList)
// and the staff tools (Admin Dashboard chat viewer, reports queue —
// AppHelper/TranslatableText).
//
// Goes through functions/translate.js (translateMessages) first: it keeps
// every translation for 30 days, so a repeat tap or the same public message
// translated by many players is billed once. If the function can't be reached
// (signed out, network, error) the old direct call with `apiKey` still works.
//
// Fruit names are swapped for placeholders before sending and put back
// after, so "leopard for dough" doesn't come back as animals and pastry.
// No limits here: callers decide (players have a daily cap, staff none).
// `apiKey` is useGlobalState().api.
import axios from 'axios';

const TRANSLATE_FN_URL = 'https://us-central1-fruiteblocks.cloudfunctions.net/translateMessages';

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

// Masked texts → translations (same order, null per failure), or null when
// the function can't be used at all and the caller should call Google itself.
async function viaFunction(maskedTexts, targetLang) {
  // Required here, not at the top: keeps this module loadable in Jest without
  // the native auth module (PrivateMessageList's render test imports it).
  const { getAuth, getIdToken } = require('@react-native-firebase/auth');
  const user = getAuth().currentUser;
  if (!user) return null;
  const send = async (forceRefresh) => fetch(TRANSLATE_FN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await getIdToken(user, forceRefresh)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: maskedTexts, target: targetLang }),
  });
  try {
    let res = await send(false);
    if (res.status === 401) res = await send(true);
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json?.translations) ? json.translations : null;
  } catch (err) {
    if (__DEV__) console.warn('translateMessages unavailable, calling Google directly:', err?.message || err);
    return null;
  }
}

/**
 * Translate one text into `targetLang`. Never throws.
 * @returns {Promise<string|null>} null on any failure (callers show their own message)
 */
export async function translateText(text, { apiKey, targetLang }) {
  if (!text || !targetLang) return null;
  const { masked, placeholders } = mask(text);
  const cached = await viaFunction([masked], targetLang);
  if (typeof cached?.[0] === 'string') return unmask(cached[0], placeholders);
  if (!apiKey) return null;
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
  if (!targetLang) return out;
  const todo = texts.map((t, i) => [i, t]).filter(([, t]) => typeof t === 'string' && t.trim());
  for (let start = 0; start < todo.length; start += BATCH) {
    const chunk = todo.slice(start, start + BATCH).map(([i, t]) => ({ i, ...mask(t) }));
    const cached = await viaFunction(chunk.map((c) => c.masked), targetLang);
    if (cached) {
      chunk.forEach((c, j) => {
        if (typeof cached[j] === 'string') out[c.i] = unmask(cached[j], c.placeholders);
      });
      continue;
    }
    if (!apiKey) continue;
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
