/* eslint-env node */
/**
 * functions/uploadImage.js. Bunny is always stubbed: no real storage and no
 * real key are ever touched.
 *
 * Stubbed run (no emulator, no network). From the Blox_Fruit directory:
 *   node functions/test/uploadImage.test.js
 *
 * Under the Auth + RTDB emulators the second half also runs against the real
 * io (ID-token check, banned_uids / email-ban reads, role flags, the
 * upload_quota transaction):
 *   firebase emulators:exec --config functions/firebase.test.json --only auth,database \
 *     --project demo-fruiteblocks 'node functions/test/uploadImage.test.js'
 */
const assert = require('assert');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-fruiteblocks';
const DB_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const EMULATED = !!(DB_HOST && AUTH_HOST);
process.env.GCLOUD_PROJECT = PROJECT;
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: PROJECT,
  databaseURL: EMULATED ? `http://${DB_HOST}?ns=${PROJECT}` : `https://${PROJECT}.firebaseio.com`,
});

const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT, databaseURL: JSON.parse(process.env.FIREBASE_CONFIG).databaseURL });
const UI = require('../uploadImage')._internal;
const { handleUpload, io, KINDS, MAX_PER_HOUR, DEFAULT_MAX_BYTES } = UI;
const realIo = { ...io };

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 1), Buffer.from('WEBPVP8 '), Buffer.alloc(64, 1)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(64, 1)]);
const HEIC = Buffer.concat([Buffer.alloc(4, 0), Buffer.from('ftypheic'), Buffer.alloc(64, 1)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const b64 = (b) => b.toString('base64');
const HOUR = 3600 * 1000;

function fakeRes() {
  const res = { statusCode: 200, body: undefined, headers: {}, headersSent: false };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; res.headersSent = true; return res; };
  res.send = (b) => { res.body = b; res.headersSent = true; return res; };
  return res;
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`  FAIL  ${name}\n        ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n        ') : e}`);
  }
}

// ── stubs ──────────────────────────────────────────────────────────
let puts;
let quota;
let bans;  // uid → record
let ranks; // uid → rank
function stubAll() {
  puts = [];
  quota = new Map();
  bans = new Map();
  ranks = new Map();
  io.verifyIdToken = async (t) => {
    const m = /^tok:([A-Za-z0-9]+)$/.exec(t);
    if (!m) throw new Error('bad token');
    return { uid: m[1], email: `${m[1].toLowerCase()}@example.com`, email_verified: true };
  };
  io.readBanRecords = async (uid) => [bans.get(uid) || null];
  io.readRank = async (uid) => ranks.get(uid) || 0;
  io.takeQuota = async (uid) => {
    const n = (quota.get(uid) || 0) + 1;
    if (n > MAX_PER_HOUR) return false;
    quota.set(uid, n);
    return true;
  };
  io.storageKey = () => 'test-key';
  io.put = async (url, init) => { puts.push({ url, init }); return { ok: true, status: 201 }; };
}

const UID = 'user123ABCdefGHIjklMNOpqr12';
const call = async (body, { token = `tok:${UID}`, method = 'POST' } = {}) => {
  const res = fakeRes();
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  await handleUpload({ method, headers, body }, res);
  return res;
};

// The paths the app wrote before 2026-10-19, one per kind.
const OLD_LAYOUT = {
  post: new RegExp(`^uploads/${UID}/\\d+-[0-9a-f]{12}\\.(jpg|png|webp)$`),
  dm: new RegExp(`^uploads/${UID}/\\d+-[0-9a-f]{12}\\.(jpg|png|webp)$`),
  avatar: new RegExp(`^avatars/${UID}/\\d+-[0-9a-f]{12}\\.(jpg|png|webp)$`),
  status: /^statuses\/status_\d+_[0-9a-f]{12}\.(jpg|png|webp)$/,
  chat: /^chat\/chat_\d+_[0-9a-f]{12}\.(jpg|png|webp)$/,
  group: /^groups\/group_\d+_[0-9a-f]{12}\.(jpg|png|webp)$/,
  scammer: /^scammer\/scam_\d+_[0-9a-f]{12}\.(jpg|png|webp)$/,
  poll: /^polls\/poll_\d+_[0-9a-f]{12}\.(jpg|png|webp)$/,
  report: /^report-images\/[0-9a-f-]{36}\.(jpg|png|webp)$/,
};

async function stubbedSuite() {
  console.log('uploadImage (stubbed):');

  await test('a feed post goes to uploads/<uid>/ in post-gag and returns the pull-gag URL', async () => {
    stubAll();
    const res = await call({ kind: 'post', data: b64(JPEG) });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.match(res.body.url, new RegExp(`^https://pull-gag\\.b-cdn\\.net/uploads/${UID}/\\d+-[0-9a-f]{12}\\.jpg$`));
    assert.strictEqual(puts.length, 1);
    assert.strictEqual(puts[0].url, `https://storage.bunnycdn.com/post-gag/${res.body.url.slice('https://pull-gag.b-cdn.net/'.length)}`);
    assert.strictEqual(puts[0].init.method, 'PUT');
    assert.strictEqual(puts[0].init.headers.AccessKey, 'test-key');
    assert.ok(puts[0].init.body.equals(JPEG), 'the bytes are passed through unchanged');
  });

  await test('every kind keeps the old folder and file-name layout', async () => {
    stubAll();
    ranks.set(UID, 1); // poll needs staff
    assert.deepStrictEqual(Object.keys(KINDS).sort(), Object.keys(OLD_LAYOUT).sort());
    for (const kind of Object.keys(KINDS)) {
      const res = await call({ kind, data: b64(JPEG) });
      assert.strictEqual(res.statusCode, 200, `${kind}: ${JSON.stringify(res.body)}`);
      const path = res.body.url.replace('https://pull-gag.b-cdn.net/', '');
      assert.match(path, OLD_LAYOUT[kind], kind);
    }
  });

  await test('complaint screenshot URLs still pass the /player_feedback rule (prefix, ≤ 120 chars)', async () => {
    stubAll();
    for (const img of [JPEG, PNG, WEBP]) {
      const { body } = await call({ kind: 'report', data: b64(img) });
      assert.ok(body.url.startsWith('https://pull-gag.b-cdn.net/report-images/'), body.url);
      assert.ok(body.url.length <= 120, `${body.url.length}`);
      assert.ok(!body.url.includes(UID), 'a complaint URL does not name its sender');
    }
  });

  await test('jpeg, png and webp are accepted; the extension follows the bytes, not the client', async () => {
    stubAll();
    for (const [img, ext] of [[JPEG, 'jpg'], [PNG, 'png'], [WEBP, 'webp']]) {
      const res = await call({ kind: 'status', data: b64(img), contentType: 'image/gif' });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.url.endsWith(`.${ext}`), res.body.url);
    }
  });

  await test('gif, heic, svg, html, json and junk are refused by their bytes', async () => {
    stubAll();
    for (const buf of [GIF, HEIC, SVG, Buffer.from('<html></html>'), Buffer.from('{"items":[]}'), Buffer.from([0xff, 0xd8])]) {
      const res = await call({ kind: 'post', data: b64(buf), contentType: 'image/jpeg' });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.error, 'bad_image');
    }
    for (const data of [12345, '', null, undefined, { a: 1 }]) {
      assert.strictEqual((await call({ kind: 'post', data })).body.error, 'bad_image', String(data));
    }
    assert.strictEqual(puts.length, 0);
  });

  await test('no token or a forged token is 401 and nothing is uploaded', async () => {
    stubAll();
    assert.strictEqual((await call({ kind: 'post', data: b64(JPEG) }, { token: null })).statusCode, 401);
    assert.strictEqual((await call({ kind: 'post', data: b64(JPEG) }, { token: 'forged' })).statusCode, 401);
    const basic = fakeRes();
    await handleUpload({ method: 'POST', headers: { authorization: 'Basic abc' }, body: { kind: 'post', data: b64(JPEG) } }, basic);
    assert.strictEqual(basic.statusCode, 401);
    assert.strictEqual(puts.length, 0);
  });

  await test('a caller cannot choose the zone, folder or file name', async () => {
    stubAll();
    const res = await call({
      kind: 'post', data: b64(JPEG), path: 'data.json', remotePath: '../codes.json', zone: 'blox-data', dir: 'x',
    });
    assert.strictEqual(res.statusCode, 200);
    const u = puts[0].url;
    assert.ok(u.startsWith(`https://storage.bunnycdn.com/post-gag/uploads/${UID}/`), u);
    assert.ok(!/data\.json|codes\.json|blox-data|\.\./.test(u), u);
  });

  await test('unknown kinds, including prototype keys and old folder names, are refused', async () => {
    stubAll();
    for (const kind of ['', 'json', 'uploads', 'mod-evidence', '../avatars', 'constructor', '__proto__', 'toString', undefined, 7]) {
      assert.strictEqual((await call({ kind, data: b64(JPEG) })).body.error, 'bad_kind', String(kind));
    }
    assert.strictEqual(puts.length, 0);
  });

  await test('size caps: 3 MB default, 1 MB for avatars; checked before decoding', async () => {
    stubAll();
    const pad = (n) => Buffer.concat([JPEG, Buffer.alloc(n - JPEG.length, 1)]);
    assert.strictEqual((await call({ kind: 'avatar', data: b64(pad(1024 * 1024)) })).statusCode, 200);
    assert.strictEqual((await call({ kind: 'avatar', data: b64(pad(1024 * 1024 + 1)) })).body.error, 'too_large');
    assert.strictEqual((await call({ kind: 'post', data: b64(pad(DEFAULT_MAX_BYTES)) })).statusCode, 200);
    assert.strictEqual((await call({ kind: 'post', data: b64(pad(DEFAULT_MAX_BYTES + 1)) })).body.error, 'too_large');
    // A huge string is refused on its length, without a decode.
    const huge = 'A'.repeat(DEFAULT_MAX_BYTES * 2);
    const r = await call({ kind: 'chat', data: huge });
    assert.strictEqual(r.statusCode, 413);
    assert.strictEqual(puts.length, 2);
  });

  await test('an active ban refuses every kind except complaint screenshots (ban appeal)', async () => {
    stubAll();
    ranks.set(UID, 1);
    bans.set(UID, { type: 'ban', bannedUntil: Date.now() + HOUR, strikeCount: 1 });
    for (const kind of Object.keys(KINDS)) {
      const res = await call({ kind, data: b64(JPEG) });
      if (kind === 'report') assert.strictEqual(res.statusCode, 200, kind);
      else assert.deepStrictEqual([res.statusCode, res.body.error], [403, 'banned'], kind);
    }
    assert.strictEqual(puts.length, 1);
    bans.set(UID, { type: 'ban', bannedUntil: 'permanent', strikeCount: 3 });
    assert.strictEqual((await call({ kind: 'avatar', data: b64(JPEG) })).body.error, 'banned');
  });

  await test('an active mute refuses chat and DM images only', async () => {
    stubAll();
    bans.set(UID, { type: 'mute', bannedUntil: Date.now() + HOUR, strikeCount: 0 });
    assert.strictEqual((await call({ kind: 'chat', data: b64(JPEG) })).body.error, 'muted');
    assert.strictEqual((await call({ kind: 'dm', data: b64(JPEG) })).body.error, 'muted');
    for (const kind of ['post', 'status', 'avatar', 'group', 'scammer', 'report']) {
      assert.strictEqual((await call({ kind, data: b64(JPEG) })).statusCode, 200, kind);
    }
  });

  await test('expired or legacy records: an old email-shaped mute is still a mute, expired records are ignored', async () => {
    stubAll();
    bans.set(UID, { type: 'ban', bannedUntil: Date.now() - 1000, strikeCount: 1 });
    assert.strictEqual((await call({ kind: 'chat', data: b64(JPEG) })).statusCode, 200);
    bans.set(UID, { reason: 'Muted for 30 min', bannedUntil: Date.now() + HOUR, bannedBy: 'someMod' });
    assert.strictEqual((await call({ kind: 'chat', data: b64(JPEG) })).body.error, 'muted');
    assert.strictEqual((await call({ kind: 'post', data: b64(JPEG) })).statusCode, 200);
    assert.strictEqual(UI.restrictionOf([null, 'x', [], { bannedUntil: 'soon' }]), null);
    assert.strictEqual(UI.restrictionOf([{ type: 'mute', bannedUntil: 'permanent' }, { type: 'ban', bannedUntil: 'permanent' }]), 'ban');
  });

  await test('poll images need staff rank; everything else does not', async () => {
    stubAll();
    assert.deepStrictEqual(Object.entries(KINDS).filter(([, s]) => s.staff).map(([k]) => k), ['poll']);
    const r = await call({ kind: 'poll', data: b64(JPEG) });
    assert.deepStrictEqual([r.statusCode, r.body.error], [403, 'not_staff']);
    ranks.set(UID, 1);
    assert.strictEqual((await call({ kind: 'poll', data: b64(JPEG) })).statusCode, 200);
  });

  await test('the hourly quota returns 429 once spent, per user', async () => {
    stubAll();
    quota.set(UID, MAX_PER_HOUR);
    assert.deepStrictEqual([(await call({ kind: 'chat', data: b64(JPEG) })).statusCode], [429]);
    assert.strictEqual((await call({ kind: 'chat', data: b64(JPEG) }, { token: 'tok:otherUser42' })).statusCode, 200);
    assert.strictEqual(puts.length, 1);
  });

  await test('refused requests (ban, kind, image) do not spend quota', async () => {
    stubAll();
    bans.set(UID, { type: 'ban', bannedUntil: Date.now() + HOUR });
    await call({ kind: 'post', data: b64(JPEG) });
    await call({ kind: 'nope', data: b64(JPEG) });
    await call({ kind: 'post', data: b64(SVG) });
    assert.strictEqual(quota.get(UID) || 0, 0);
  });

  await test('a Bunny failure is 502 and the response never carries the key', async () => {
    stubAll();
    io.put = async () => ({ ok: false, status: 401 });
    const res = await call({ kind: 'dm', data: b64(JPEG) });
    assert.strictEqual(res.statusCode, 502);
    assert.deepStrictEqual(res.body, { error: 'upload_failed' });
    assert.ok(!JSON.stringify(res).includes('test-key'));
  });

  await test('a missing secret is 500, never an unauthenticated PUT', async () => {
    stubAll();
    io.storageKey = () => undefined;
    assert.strictEqual((await call({ kind: 'post', data: b64(JPEG) })).statusCode, 500);
    assert.strictEqual(puts.length, 0);
  });

  await test('GET is 405; OPTIONS preflight is 204', async () => {
    stubAll();
    assert.strictEqual((await call({}, { method: 'GET' })).statusCode, 405);
    assert.strictEqual((await call({}, { method: 'OPTIONS', token: null })).statusCode, 204);
  });

  await test('the real storageKey reads the BUNNY_STORAGE_KEY secret env', async () => {
    const before = process.env.BUNNY_STORAGE_KEY;
    process.env.BUNNY_STORAGE_KEY = 'env-key';
    try {
      assert.strictEqual(realIo.storageKey(), 'env-key');
    } finally {
      if (before === undefined) delete process.env.BUNNY_STORAGE_KEY; else process.env.BUNNY_STORAGE_KEY = before;
    }
  });
}

// ── emulator: real io except the Bunny PUT ──────────────────────────
async function emulatorSuite() {
  console.log('uploadImage (Auth + RTDB emulators):');
  const db = admin.database();
  const RUN = Date.now().toString(36);
  let seq = 0;
  async function mkUser(label, { role } = {}) {
    seq += 1;
    const email = `${label.toLowerCase()}.${RUN}.${seq}@example.com`;
    const rec = await admin.auth().createUser({ email, emailVerified: true, password: 'test-pass-123' });
    if (role) await db.ref(`users/${rec.uid}/${role}`).set(true);
    const r = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'test-pass-123', returnSecureToken: true }),
    });
    const b = await r.json();
    if (!b.idToken) throw new Error(`sign-in failed: ${JSON.stringify(b)}`);
    return { uid: rec.uid, email, token: b.idToken };
  }
  Object.assign(io, realIo);
  puts = [];
  io.put = async (url, init) => { puts.push({ url, init }); return { ok: true, status: 201 }; };
  process.env.BUNNY_STORAGE_KEY = 'test-key';
  const up = async (u, body) => {
    const res = fakeRes();
    await handleUpload({ method: 'POST', headers: { authorization: `Bearer ${u.token}` }, body }, res);
    return res;
  };
  const { encodeEmailKey } = require('../banEnforcement')._internal;

  try {
    await test('emulator: a real ID token uploads to uploads/<uid>/', async () => {
      const u = await mkUser('Plain');
      const r = await up(u, { kind: 'post', data: b64(JPEG) });
      assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
      assert.ok(r.body.url.startsWith(`https://pull-gag.b-cdn.net/uploads/${u.uid}/`));
    });

    await test('emulator: banned_uids ban → 403 banned; a complaint screenshot still goes through', async () => {
      const u = await mkUser('UidBanned');
      await db.ref(`banned_uids/${u.uid}`).set({ type: 'ban', bannedUntil: Date.now() + HOUR, strikeCount: 1, reason: 'Strike 1' });
      assert.strictEqual((await up(u, { kind: 'status', data: b64(JPEG) })).body.error, 'banned');
      assert.strictEqual((await up(u, { kind: 'report', data: b64(JPEG) })).statusCode, 200);
    });

    await test('emulator: an email-keyed ban (old builds\' record) → 403 banned', async () => {
      const u = await mkUser('EmailBanned');
      await db.ref(`banned_users_by_email/${encodeEmailKey(u.email)}`).set({
        strikeCount: 2, bannedUntil: Date.now() + HOUR, reason: 'Strike 2', email: u.email,
      });
      assert.strictEqual((await up(u, { kind: 'avatar', data: b64(JPEG) })).body.error, 'banned');
    });

    await test('emulator: a mute blocks chat images only', async () => {
      const u = await mkUser('Muted');
      await db.ref(`banned_uids/${u.uid}`).set({ type: 'mute', bannedUntil: Date.now() + HOUR, strikeCount: 0, reason: 'Muted for 60 min' });
      assert.strictEqual((await up(u, { kind: 'chat', data: b64(JPEG) })).body.error, 'muted');
      assert.strictEqual((await up(u, { kind: 'post', data: b64(JPEG) })).statusCode, 200);
    });

    await test('emulator: poll images need an RTDB staff flag', async () => {
      const plain = await mkUser('PollPlain');
      const jmd = await mkUser('PollJmd', { role: 'isBabyMod' });
      assert.strictEqual((await up(plain, { kind: 'poll', data: b64(JPEG) })).body.error, 'not_staff');
      assert.strictEqual((await up(jmd, { kind: 'poll', data: b64(JPEG) })).statusCode, 200);
    });

    await test('emulator: upload_quota/{uid} counts per hour and refuses past the cap', async () => {
      const u = await mkUser('Quota');
      const hour = Math.floor(Date.now() / 3600000);
      await db.ref(`upload_quota/${u.uid}`).set({ h: hour, n: MAX_PER_HOUR - 1 });
      assert.strictEqual((await up(u, { kind: 'chat', data: b64(JPEG) })).statusCode, 200);
      assert.deepStrictEqual((await db.ref(`upload_quota/${u.uid}`).get()).val(), { h: hour, n: MAX_PER_HOUR });
      assert.strictEqual((await up(u, { kind: 'chat', data: b64(JPEG) })).statusCode, 429);
      // A stale hour resets the counter.
      await db.ref(`upload_quota/${u.uid}`).set({ h: hour - 1, n: MAX_PER_HOUR });
      assert.strictEqual((await up(u, { kind: 'chat', data: b64(JPEG) })).statusCode, 200);
      assert.deepStrictEqual((await db.ref(`upload_quota/${u.uid}`).get()).val(), { h: hour, n: 1 });
    });

    await test('emulator: a disabled account (permanent ban) is 401', async () => {
      const u = await mkUser('Disabled');
      await admin.auth().updateUser(u.uid, { disabled: true });
      assert.strictEqual((await up(u, { kind: 'post', data: b64(JPEG) })).statusCode, 401);
    });
  } finally {
    delete process.env.BUNNY_STORAGE_KEY;
  }
}

(async () => {
  await stubbedSuite();
  if (EMULATED) await emulatorSuite();
  else console.log('  (Auth/RTDB emulators not running: emulator cases skipped)');
  const failed = results.filter((r) => !r.ok);
  console.log(`\nuploadImage: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
