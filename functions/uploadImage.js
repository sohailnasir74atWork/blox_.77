/* eslint-env node */
/**
 * uploadImage — every player image in the app (feed post, DM, avatar, status,
 * group chat, group icon, scammer proof, poll image, complaint screenshot)
 * goes to Bunny through here.
 *
 * Until 2026-10-19 the app PUT straight to storage.bunnycdn.com with the
 * post-gag zone's storage password compiled into the bundle, so anyone who
 * unpacked the APK/IPA could upload, overwrite or delete any file in the zone.
 * The password now lives only in Secret Manager (BUNNY_STORAGE_KEY, the same
 * secret modEvidenceUpload uses). The app sends the image; this function
 * checks who is asking and what they sent, and picks the storage path itself,
 * so a caller can never name a path and cannot overwrite or delete anything.
 *
 * POST JSON { kind: <KINDS key>, data: <base64> }
 * Authorization: Bearer <Firebase ID token>
 * → 200 { url } | 4xx/5xx { error }
 *
 * Checks, in order: signed-in caller (ID token, revocation checked, so a
 * disabled account is refused), known kind, image bytes (magic bytes: jpeg,
 * png or webp; the client's content type is not trusted), size cap, an active
 * ban (banned_uids/{uid} or the email record; a mute only refuses chat and DM
 * images; complaint screenshots stay open so a banned player can appeal),
 * staff rank for poll images, then a per-user hourly quota held
 * server-side at upload_quota/{uid} (no client rule, so database.rules.json
 * denies it to the app).
 *
 * Folders and file names are the ones the app wrote before, so every existing
 * URL keeps working and the /player_feedback rule (report-images/ prefix,
 * ≤ 120 chars) still accepts complaint screenshots.
 *
 * Old builds keep PUTting with the embedded password until the owner rotates
 * it, so this function is only half the fix. Rollout and rotation order:
 * docs/BUNNY_UPLOAD_ROLLOUT_2026-10-19.md.
 *
 * Deploy by name:
 *   firebase deploy --only functions:uploadImage --project fruiteblocks
 * Test: node functions/test/uploadImage.test.js (stubbed), or under
 *   firebase emulators:exec --only auth,database for the RTDB and Auth paths.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { _internal: { readRank, RANK, isActive, recordType, encodeEmailKey } } = require('./banEnforcement');

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

const MB = 1024 * 1024;
// The app compresses to ~1024 px JPEG (avatars to 300 px and ≤ 500 KB), and
// Code/Helper/imageUpload.js recompresses anything over 2 MB before sending,
// so a legitimate upload stays well under these.
const DEFAULT_MAX_BYTES = 3 * MB;

// name: how the file is named inside `dir`, matching the old client paths.
//   owner  <dir>/<uid>/<time>-<random>.<ext>
//   prefix <dir>/<prefix><time>_<random>.<ext>
//   uuid   <dir>/<uuid>.<ext>  (bare, so a complaint URL doesn't name its sender)
const KINDS = {
  post: { dir: 'uploads', name: 'owner' },                       // UploadModal
  dm: { dir: 'uploads', name: 'owner', chat: true },              // PrivateMessageInput
  avatar: { dir: 'avatars', name: 'owner', maxBytes: 1 * MB },    // Setting.jsx
  status: { dir: 'statuses', name: 'prefix', prefix: 'status_' }, // StatusFeed
  chat: { dir: 'chat', name: 'prefix', prefix: 'chat_', chat: true }, // GroupMessageInput
  group: { dir: 'groups', name: 'prefix', prefix: 'group_' },     // CreateGroupModal, GroupsScreen
  scammer: { dir: 'scammer', name: 'prefix', prefix: 'scam_' },   // ScammerDatabaseScreen
  poll: { dir: 'polls', name: 'prefix', prefix: 'poll_', staff: true }, // AdminDashboard
  // Complaint screenshots, incl. the ban card's appeal: a banned player may send these.
  report: { dir: 'report-images', name: 'uuid', appeal: true },   // Helper/reportImageUpload
};
const kindSpec = (kind) => (Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null);

// Per user, across all kinds. A feed post carries a few images (MAX_IMAGES in
// UploadModal), a scammer report or a complaint up to 3.
const MAX_PER_HOUR = 60;

// Magic bytes. No SVG, HTML or anything else a browser could run.
const ascii = (b, from, to) => b.subarray(from, to).toString('ascii');
const TYPES = [
  { ext: 'jpg', ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', ok: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', ok: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
];
const sniff = (bytes) => (bytes.length >= 12 ? TYPES.find((t) => t.ok(bytes)) : undefined);

const STATUS = {
  method_not_allowed: 405, unauthenticated: 401, bad_kind: 400, bad_image: 400,
  too_large: 413, banned: 403, muted: 403, not_staff: 403, rate_limited: 429,
  upload_failed: 502, internal: 500,
};
const fail = (res, error) => res.status(STATUS[error] || 400).json({ error });

// 'ban' | 'mute' | null — the strictest ACTIVE record on the uid or the
// caller's email key (same two sources the app listens to; device bans reach
// the uid through indexDeviceAccount).
function restrictionOf(records) {
  const active = records.filter((r) => r && typeof r === 'object' && isActive(r.bannedUntil));
  if (active.some((r) => recordType(r) === 'ban')) return 'ban';
  return active.length ? 'mute' : null;
}

const RTDB_KEY_RE = /^[^.#$[\]/]{1,700}$/;
async function readBanRecords(uid, email) {
  const db = admin.database();
  const reads = [db.ref(`banned_uids/${uid}`).get()];
  let key = null;
  try { key = email ? encodeEmailKey(email) : null; } catch (_) { key = null; }
  if (key && RTDB_KEY_RE.test(key)) reads.push(db.ref(`banned_users_by_email/${key}`).get());
  return (await Promise.all(reads)).map((s) => s.val());
}

// One counter per user, reset each hour: { h: hour index, n: uploads }.
async function takeQuota(uid) {
  const hour = Math.floor(Date.now() / 3600000);
  const { committed } = await admin.database().ref(`upload_quota/${uid}`).transaction((cur) => {
    if (!cur || cur.h !== hour) return { h: hour, n: 1 };
    if (cur.n >= MAX_PER_HOUR) return undefined; // abort
    return { h: hour, n: cur.n + 1 };
  });
  return committed;
}

// Everything that leaves the process, so the test can stub it.
const io = {
  verifyIdToken: (token) => admin.auth().verifyIdToken(token, true),
  readBanRecords,
  readRank,
  takeQuota,
  storageKey: () => process.env.BUNNY_STORAGE_KEY,
  put: (url, init) => fetch(url, init),
};

// Firebase uids are [A-Za-z0-9]; hash anything else rather than put it in a path.
const ownerSegment = (uid) => (/^[A-Za-z0-9_-]{1,128}$/.test(uid)
  ? uid
  : crypto.createHash('sha256').update(String(uid)).digest('hex').slice(0, 32));

function storagePath(spec, uid, ext) {
  const rand = crypto.randomBytes(6).toString('hex');
  if (spec.name === 'owner') return `${spec.dir}/${ownerSegment(uid)}/${Date.now()}-${rand}.${ext}`;
  if (spec.name === 'uuid') return `${spec.dir}/${crypto.randomUUID()}.${ext}`;
  return `${spec.dir}/${spec.prefix}${Date.now()}_${rand}.${ext}`;
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
    caller = await io.verifyIdToken(m[1]);
  } catch (_) {
    return fail(res, 'unauthenticated');
  }
  if (!caller?.uid) return fail(res, 'unauthenticated');

  const { kind, data } = req.body || {};
  const spec = kindSpec(kind);
  if (!spec) return fail(res, 'bad_kind');
  const maxBytes = spec.maxBytes || DEFAULT_MAX_BYTES;
  // base64 is 4/3 the size; refuse an oversized string before decoding it.
  if (typeof data !== 'string' || data.length === 0) return fail(res, 'bad_image');
  if (data.length > Math.ceil(maxBytes / 3) * 4 + 8) return fail(res, 'too_large');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > maxBytes) return fail(res, 'too_large');
  const type = sniff(bytes);
  if (!type) return fail(res, 'bad_image');

  if (!spec.appeal) {
    const restriction = restrictionOf(await io.readBanRecords(caller.uid, caller.email));
    if (restriction === 'ban') return fail(res, 'banned');
    if (restriction === 'mute' && spec.chat) return fail(res, 'muted');
  }
  if (spec.staff && (await io.readRank(caller.uid, caller)) < RANK.babyMod) return fail(res, 'not_staff');

  if (!(await io.takeQuota(caller.uid))) return fail(res, 'rate_limited');

  const key = io.storageKey();
  if (!key) {
    console.error('[uploadImage] BUNNY_STORAGE_KEY is not set');
    return fail(res, 'internal');
  }
  const path = storagePath(spec, caller.uid, type.ext);
  const put = await io.put(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${path}`, {
    method: 'PUT',
    headers: { AccessKey: key, 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });
  if (!put.ok) {
    console.error('[uploadImage] Bunny PUT failed', put.status);
    return fail(res, 'upload_failed');
  }
  return res.status(200).json({ url: `${BUNNY_CDN_BASE}/${path}` });
}

exports.uploadImage = functions
  .runWith({ secrets: ['BUNNY_STORAGE_KEY'], memory: '256MB', timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    try {
      await handleUpload(req, res);
    } catch (e) {
      console.error('[uploadImage]', e?.message || e);
      if (!res.headersSent) fail(res, 'internal');
    }
  });

exports._internal = { handleUpload, io, KINDS, DEFAULT_MAX_BYTES, MAX_PER_HOUR, sniff, restrictionOf, storagePath };
