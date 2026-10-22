/**
 * Emulator suite for functions/statusFeed.js and functions/translate.js
 * (2026-10-22 cost fixes). Google Translate and the ID-token check are
 * stubbed; Firestore is the emulator. Named *.emulator.js so Jest skips it.
 * From the Blox_Fruit directory:
 *   JAVA_HOME=/opt/homebrew/opt/openjdk@24 firebase emulators:exec \
 *     --config functions/firebase.test.json --only firestore \
 *     --project demo-fruiteblocks 'node functions/test/costFixes.emulator.js'
 */
const assert = require('assert');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-fruiteblocks';
process.env.GCLOUD_PROJECT = PROJECT;

const admin = require('firebase-admin');
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const { buildStatusFeedSnapshot } = require('../statusFeed');
const { handleTranslate, io, cacheId, CACHE } = require('../translate')._internal;

const { Timestamp } = admin.firestore;
const H = 3600 * 1000;

let pass = 0;
async function test(name, fn) {
  await fn();
  pass++;
  console.log('ok -', name);
}

// Minimal Express-like response.
function fakeRes() {
  const r = { statusCode: 200, body: null, headers: {}, headersSent: false };
  r.set = (k, v) => { r.headers[k] = v; return r; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; r.headersSent = true; return r; };
  r.send = (b) => { r.body = b; r.headersSent = true; return r; };
  return r;
}
const post = async (body, auth = 'Bearer good') => {
  const res = fakeRes();
  await handleTranslate({ method: 'POST', headers: { authorization: auth }, body }, res);
  return res;
};

(async () => {
  await test('status snapshot: live only, newest first, no viewedBy, timestamps as ms', async () => {
    const now = Date.now();
    await db.doc('statuses/old').set({ userId: 'u1', caption: 'gone', expiresAt: Timestamp.fromMillis(now - H), viewedBy: ['a'] });
    await db.doc('statuses/s1').set({ userId: 'u1', caption: 'one', createdAt: Timestamp.fromMillis(now - 2 * H), expiresAt: Timestamp.fromMillis(now + 22 * H), viewedBy: ['a', 'b'], randomSeed: 0.4, reportCount: 1 });
    await db.doc('statuses/s2').set({ userId: 'u2', caption: 'two', createdAt: Timestamp.fromMillis(now - H), expiresAt: Timestamp.fromMillis(now + 23 * H), viewedBy: [], pollOptions: ['a', 'b'], pollVotes: { 0: ['x'], 1: [] } });
    const n = await buildStatusFeedSnapshot(db, now);
    assert.strictEqual(n, 2);
    const feed = (await db.doc('status_feed/global').get()).data();
    assert.deepStrictEqual(feed.statuses.map((s) => s.id), ['s2', 's1']);
    assert.ok(feed.statuses.every((s) => !('viewedBy' in s) && !('randomSeed' in s) && !('expiresAt' in s)));
    assert.strictEqual(feed.statuses[1].expiresAtMs, now + 22 * H);
    assert.strictEqual(feed.statuses[1].createdAtMs, now - 2 * H);
    assert.strictEqual(feed.statuses[1].reportCount, 1);
    assert.deepStrictEqual(feed.statuses[0].pollVotes, { 0: ['x'], 1: [] });
    assert.strictEqual(feed.builtAt.toMillis(), now);
  });

  const calls = [];
  io.verifyIdToken = async (t) => { if (t !== 'good') throw new Error('bad'); return { uid: 'u1' }; };
  io.db = () => db;
  io.translate = async (texts, target) => { calls.push({ texts, target }); return texts.map((t) => `${target}:${t}`); };

  await test('translate: rejects missing/bad token and bad input', async () => {
    assert.strictEqual((await post({ q: ['hola'], target: 'en' }, '')).statusCode, 401);
    assert.strictEqual((await post({ q: ['hola'], target: 'en' }, 'Bearer nope')).statusCode, 401);
    assert.strictEqual((await post({ q: ['hola'], target: 'en; drop' })).statusCode, 400);
    assert.strictEqual((await post({ q: [], target: 'en' })).statusCode, 400);
    assert.strictEqual((await post({ q: ['x'.repeat(2001)], target: 'en' })).statusCode, 400);
    assert.strictEqual(calls.length, 0);
  });

  await test('translate: miss calls Google once per distinct text and caches', async () => {
    const r = await post({ q: ['hola', ' hola ', 'gracias', ''], target: 'en' });
    assert.strictEqual(r.statusCode, 200);
    assert.deepStrictEqual(r.body.translations, ['en:hola', 'en:hola', 'en:gracias', null]);
    assert.deepStrictEqual(calls, [{ texts: ['hola', 'gracias'], target: 'en' }]);
    const cached = await db.collection(CACHE).doc(cacheId('en', 'hola')).get();
    assert.strictEqual(cached.get('t'), 'en:hola');
    assert.ok(cached.get('expireAt').toMillis() > Date.now() + 29 * 24 * H);
  });

  await test('translate: repeat is served from cache, other language is a miss', async () => {
    calls.length = 0;
    const r = await post({ q: ['hola', 'gracias'], target: 'en' });
    assert.deepStrictEqual(r.body.translations, ['en:hola', 'en:gracias']);
    assert.strictEqual(calls.length, 0);
    const fr = await post({ q: ['hola'], target: 'fr' });
    assert.deepStrictEqual(fr.body.translations, ['fr:hola']);
    assert.strictEqual(calls.length, 1);
  });

  await test('translate: Google failure → 502, nothing cached', async () => {
    io.translate = async () => { throw new Error('quota'); };
    const r = await post({ q: ['nuevo'], target: 'en' });
    assert.strictEqual(r.statusCode, 502);
    assert.strictEqual((await db.collection(CACHE).doc(cacheId('en', 'nuevo')).get()).exists, false);
  });

  console.log(`\n${pass} passed`);
  process.exit(0);
})().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
