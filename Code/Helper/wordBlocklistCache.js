// Remote word-filter list (supabase/049 word_filter_list), cached in MMKV
// with its version, so the app downloads the list again only after a
// moderator changes it.
//
//   getRemoteWordList()  -> { v, terms: [[term, kind, mode]], off: [term], at } | null
//   refreshWordList({ force }) -> Promise of the same; never rejects.
//
// A refresh sends the cached version: unchanged -> {same: true} (a few
// bytes). It runs at most every 6 hours (an hour after a failure, e.g. 049
// not applied yet), unless forced (the staff Word filter tab after an edit).
// Without a cached list the app still has its bundled one
// (wordFilterCore.js BUNDLED + leo-profanity).

let storage = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV();
} catch (_) {}

const KEY = 'wordFilter.list.v1';
const REFRESH_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;

const sanitize = (d) => {
  if (!d || typeof d !== 'object' || !Number.isFinite(Number(d.v))) return null;
  const terms = Array.isArray(d.terms)
    ? d.terms
      .filter((t) => Array.isArray(t) && typeof t[0] === 'string' && typeof t[1] === 'string')
      .map((t) => [t[0], t[1], typeof t[2] === 'string' ? t[2] : 'auto'])
    : [];
  const off = Array.isArray(d.off) ? d.off.filter((t) => typeof t === 'string') : [];
  return { v: Number(d.v), terms, off, at: Number(d.at) || 0 };
};

let cached = null;
try {
  const raw = storage ? storage.getString(KEY) : null;
  if (raw) cached = sanitize(JSON.parse(raw));
} catch (_) {
  cached = null;
}

let lastAttempt = 0;
let inFlight = null;

const persist = () => {
  try {
    if (storage && cached) storage.set(KEY, JSON.stringify(cached));
  } catch (_) {}
};

export const getRemoteWordList = () => cached;

export const refreshWordList = ({ force = false } = {}) => {
  if (inFlight) return inFlight;
  const now = Date.now();
  if (!force) {
    if (cached && now - cached.at < REFRESH_MS) return Promise.resolve(cached);
    if (now - lastAttempt < RETRY_MS) return Promise.resolve(cached);
  }
  lastAttempt = now;
  inFlight = (async () => {
    try {
      const { supabase } = require('../Supabase/client');
      const { data, error } = await supabase.rpc('word_filter_list', { p_version: cached ? cached.v : null });
      if (error || !data) return cached;
      if (data.same && cached && Number(data.v) === cached.v) {
        cached = { ...cached, at: Date.now() };
      } else {
        const next = sanitize({ ...data, at: Date.now() });
        if (!next) return cached;
        cached = next;
      }
      persist();
      return cached;
    } catch (_) {
      return cached;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
};
