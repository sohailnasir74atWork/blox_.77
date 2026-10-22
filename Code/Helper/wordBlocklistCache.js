// Remote word-filter list (supabase/049 word_blocklist), cached in MMKV
// with its version, so the app downloads only what moderators changed.
//
//   getRemoteWordList()  -> { v, terms: [[term, kind, mode]], off: [term], at } | null
//   refreshWordList({ force }) -> Promise of the same; never rejects.
//
// A refresh sends the cached version to word_filter_changes (052):
// unchanged -> {same: true} (a few bytes); changed -> only the rows that
// changed since that version, merged here by term key; no cache or a version
// the server can't diff from -> the full list. Without 052 it falls back to
// word_filter_list (049: full list after any change).
//
// It runs at most every 12 hours, and only when the app checks text (a send
// or a post), an hour after a failure, unless forced (the staff Word filter
// tab after an edit). Chat does not wait for it: the server checks every
// message against the current list (049/052 trigger).
// Without a cached list the app still has its bundled one
// (wordFilterCore.js BUNDLED + leo-profanity).

import { termKey } from './wordFilterCore';

let storage = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV();
} catch (_) {}

const KEY = 'wordFilter.list.v1';
const REFRESH_MS = 12 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;

const sanitizeTerms = (terms) => (Array.isArray(terms)
  ? terms
    .filter((t) => Array.isArray(t) && typeof t[0] === 'string' && typeof t[1] === 'string')
    .map((t) => [t[0], t[1], typeof t[2] === 'string' ? t[2] : 'auto'])
  : []);
const sanitizeOff = (off) => (Array.isArray(off) ? off.filter((t) => typeof t === 'string') : []);

const sanitize = (d) => {
  if (!d || typeof d !== 'object' || !Number.isFinite(Number(d.v))) return null;
  return { v: Number(d.v), terms: sanitizeTerms(d.terms), off: sanitizeOff(d.off), at: Number(d.at) || 0 };
};

// Server answer + cached list -> new cached list (null = keep the old one).
export const applyChanges = (base, data, now = Date.now()) => {
  if (!data || typeof data !== 'object' || !Number.isFinite(Number(data.v))) return null;
  if (data.same) return base && Number(data.v) === base.v ? { ...base, at: now } : null;
  if (data.delta) {
    if (!base) return null;
    const terms = sanitizeTerms(data.terms);
    const off = sanitizeOff(data.off);
    const touched = new Set([...terms.map((t) => termKey(t[0])), ...off.map(termKey)]);
    return {
      v: Number(data.v),
      terms: base.terms.filter((t) => !touched.has(termKey(t[0]))).concat(terms),
      off: base.off.filter((t) => !touched.has(termKey(t))).concat(off),
      at: now,
    };
  }
  return sanitize({ ...data, at: now });
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
let hasChangesRpc = true;

const persist = () => {
  try {
    if (storage && cached) storage.set(KEY, JSON.stringify(cached));
  } catch (_) {}
};

const missingFunction = (error) => ['PGRST202', '42883'].includes(error?.code)
  || /could not find the function/i.test(String(error?.message || ''));

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
      const p = { p_version: cached ? cached.v : null };
      let res = hasChangesRpc ? await supabase.rpc('word_filter_changes', p) : null;
      if (!res || (res.error && missingFunction(res.error))) {
        hasChangesRpc = false;
        res = await supabase.rpc('word_filter_list', p);
      }
      if (res.error || !res.data) return cached;
      const next = applyChanges(cached, res.data);
      if (!next) return cached;
      cached = next;
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
