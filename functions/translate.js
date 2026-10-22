/**
 * translateMessages — chat translation with a shared cache (2026-10-22 cost fix).
 *
 * Before, the app called Google Translate directly with the RTDB /api key and
 * kept nothing: every tap was billed, even the same person re-tapping the same
 * message or a hundred people translating one public message. Now builds after
 * 4.0.33 POST here; each (target language, text) is translated once and kept
 * in Firestore translation_cache for 30 days (TTL policy on expireAt).
 *
 * The app masks fruit names before sending (Helper/chatTranslate), so the
 * cache is keyed on the masked text and the app unmasks the result. Daily
 * limits stay in the app, as before. Translate is called with the function's
 * own service account, not the public key. Old builds keep calling Google
 * directly; nothing they use changes.
 *
 * POST { q: string[], target: 'en' }  (Authorization: Bearer <Firebase ID token>)
 *   → 200 { translations: [string|null, ...] }  same order as q
 *
 * Deploy:
 *   firebase deploy --only functions:translateMessages --project fruiteblocks
 */
const crypto = require('crypto');
const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) admin.initializeApp();

const TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2';
const CACHE = 'translation_cache';
const CACHE_DAYS = 30;
const MAX_TEXTS = 50;      // the app batches 50 ("Translate all")
const MAX_TEXT_CHARS = 2000;
const MAX_TOTAL_CHARS = 20000;
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,4})?$/;

const cacheId = (target, text) => crypto.createHash('sha256').update(`${target}\n${text}`).digest('hex');

// Everything that leaves the process, so the test can stub it.
const io = {
  verifyIdToken: (token) => admin.auth().verifyIdToken(token),
  db: () => admin.firestore(),
  translate: async (texts, target) => {
    const { access_token: token } = await admin.credential.applicationDefault().getAccessToken();
    const res = await fetch(TRANSLATE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: texts, target, format: 'text' }),
    });
    if (!res.ok) throw new Error(`translate_http_${res.status}`);
    const json = await res.json();
    return (json?.data?.translations || []).map((t) => (typeof t?.translatedText === 'string' ? t.translatedText : null));
  },
};

const fail = (res, status, error) => res.status(status).json({ error });

async function handleTranslate(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed');

  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return fail(res, 401, 'unauthenticated');
  try {
    const caller = await io.verifyIdToken(m[1]);
    if (!caller?.uid) return fail(res, 401, 'unauthenticated');
  } catch (_) {
    return fail(res, 401, 'unauthenticated');
  }

  const { q, target } = req.body || {};
  if (typeof target !== 'string' || !LANG_RE.test(target)) return fail(res, 400, 'bad_target');
  if (!Array.isArray(q) || q.length === 0 || q.length > MAX_TEXTS) return fail(res, 400, 'bad_texts');
  if (q.some((t) => typeof t !== 'string' || t.length > MAX_TEXT_CHARS)) return fail(res, 400, 'bad_texts');
  if (q.reduce((n, t) => n + t.length, 0) > MAX_TOTAL_CHARS) return fail(res, 400, 'too_long');

  const db = io.db();
  const texts = q.map((t) => t.trim());
  const out = texts.map(() => null);
  const refs = texts.map((t) => (t ? db.collection(CACHE).doc(cacheId(target, t)) : null));
  const live = refs.filter(Boolean);
  const snaps = live.length ? await db.getAll(...live) : [];
  const byId = new Map(snaps.map((s) => [s.id, s]));

  // Misses, de-duplicated so one request never pays twice for the same text.
  const missing = new Map(); // text → [indexes]
  texts.forEach((t, i) => {
    if (!t) return;
    const hit = byId.get(refs[i].id);
    if (hit?.exists && typeof hit.get('t') === 'string') out[i] = hit.get('t');
    else missing.set(t, [...(missing.get(t) || []), i]);
  });

  if (missing.size) {
    const todo = [...missing.keys()];
    let translated = [];
    try {
      translated = await io.translate(todo, target);
    } catch (e) {
      console.error('[translateMessages] translate failed', e?.message || e);
      return fail(res, 502, 'translate_failed');
    }
    const batch = db.batch();
    const expireAt = admin.firestore.Timestamp.fromMillis(Date.now() + CACHE_DAYS * 86400000);
    todo.forEach((t, j) => {
      const value = translated[j];
      if (typeof value !== 'string') return;
      missing.get(t).forEach((i) => { out[i] = value; });
      batch.set(db.collection(CACHE).doc(cacheId(target, t)), { t: value, lang: target, expireAt });
    });
    await batch.commit();
  }

  console.log('[translateMessages]', JSON.stringify({ n: texts.length, misses: missing.size, chars: [...missing.keys()].reduce((n, t) => n + t.length, 0) }));
  return res.status(200).json({ translations: out });
}

exports.translateMessages = functions
  .runWith({ memory: '256MB', timeoutSeconds: 30 })
  .https.onRequest(async (req, res) => {
    try {
      await handleTranslate(req, res);
    } catch (e) {
      console.error('[translateMessages]', e?.message || e);
      if (!res.headersSent) fail(res, 500, 'internal');
    }
  });

exports._internal = { handleTranslate, io, cacheId, CACHE };
