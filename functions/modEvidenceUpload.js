/**
 * modEvidenceUpload — staff upload a screenshot that backs a ban, mute or
 * strike. The image goes to Bunny storage with a key held server-side
 * (Secret Manager: BUNNY_STORAGE_KEY), so evidence uploads never need a
 * storage key in the app.
 *
 * POST JSON { data: <base64>, contentType: 'image/jpeg'|'image/png'|'image/webp' }
 * Authorization: Bearer <Firebase ID token>
 * → 200 { url } | 4xx/5xx { error }
 *
 * The app uploads on Confirm (before the sanction is applied) and passes the
 * returned URLs to modSanction as `evidence`.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { _internal: { readRank, RANK } } = require('./banEnforcement');

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

const MAX_BYTES = 1.5 * 1024 * 1024; // the app compresses to well under this
const MAX_PER_HOUR = 30;              // per moderator

// Magic bytes, so a mislabelled or non-image payload is refused.
const TYPES = {
  'image/jpeg': { ext: 'jpg', ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', ok: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': {
    ext: 'webp',
    ok: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP',
  },
};

const STATUS = {
  method_not_allowed: 405, unauthenticated: 401, not_staff: 403, bad_image: 400,
  too_large: 413, rate_limited: 429, upload_failed: 502, internal: 500,
};
const fail = (res, error) => res.status(STATUS[error] || 400).json({ error });

// One counter per moderator per hour; server-only RTDB node (no client rule).
async function takeQuota(uid) {
  const hour = Math.floor(Date.now() / 3600000);
  const ref = admin.database().ref(`mod_evidence_quota/${uid}/${hour}`);
  const { committed, snapshot } = await ref.transaction((n) => {
    if ((n || 0) >= MAX_PER_HOUR) return undefined; // abort
    return (n || 0) + 1;
  });
  return committed && snapshot.val() <= MAX_PER_HOUR;
}

async function handleUpload(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return fail(res, 'method_not_allowed');

  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return fail(res, 'unauthenticated');
  let caller;
  try {
    caller = await admin.auth().verifyIdToken(m[1], true);
  } catch (_) {
    return fail(res, 'unauthenticated');
  }
  if ((await readRank(caller.uid, caller)) < RANK.babyMod) return fail(res, 'not_staff');

  const { data, contentType } = req.body || {};
  const type = TYPES[contentType];
  if (!type || typeof data !== 'string' || data.length > MAX_BYTES * 1.4) return fail(res, 'bad_image');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0) return fail(res, 'bad_image');
  if (bytes.length > MAX_BYTES) return fail(res, 'too_large');
  if (!type.ok(bytes)) return fail(res, 'bad_image');

  if (!(await takeQuota(caller.uid))) return fail(res, 'rate_limited');

  const key = process.env.BUNNY_STORAGE_KEY;
  if (!key) {
    console.error('[modEvidenceUpload] BUNNY_STORAGE_KEY is not set');
    return fail(res, 'internal');
  }
  const path = `mod-evidence/${caller.uid}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${type.ext}`;
  const put = await fetch(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${path}`, {
    method: 'PUT',
    headers: { AccessKey: key, 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });
  if (!put.ok) {
    console.error('[modEvidenceUpload] Bunny PUT failed', put.status);
    return fail(res, 'upload_failed');
  }
  return res.status(200).json({ url: `${BUNNY_CDN_BASE}/${path}` });
}

exports.modEvidenceUpload = functions
  .runWith({ secrets: ['BUNNY_STORAGE_KEY'], memory: '256MB', timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    try {
      await handleUpload(req, res);
    } catch (e) {
      console.error('[modEvidenceUpload]', e?.message || e);
      if (!res.headersSent) fail(res, 'internal');
    }
  });

exports._internal = { handleUpload, TYPES, MAX_BYTES };
