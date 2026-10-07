/* eslint-disable no-console */
/**
 * Emulator suite for functions/modVoteTally.js (server-counted mod ratings).
 *
 * From the Blox_Fruit directory:
 *   firebase emulators:exec --only auth,database --project demo-fruiteblocks \
 *     'node functions/test/modVoteTally.test.js'
 *
 * Calls the counting code in-process against the emulators; the Admin SDK
 * bypasses rules, so this tests the server logic, not database.rules.json.
 */
const assert = require('assert');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-fruiteblocks';
const DB_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT, databaseURL: `http://${DB_HOST}?ns=${PROJECT}` });
process.env.GCLOUD_PROJECT = PROJECT;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = require('firebase-admin');
const T = require('../modVoteTally')._internal;

const DAY = 24 * 60 * 60 * 1000;
const M = 'modUid0000001';
const OLD1 = 'voterOld00001';
const OLD2 = 'voterOld00002';
const NEW = 'voterNew00001';
const BAN = 'voterBan00001';
const MUTE = 'voterMute0001';
const EXP = 'voterExpired1';
const MAILBAN = 'voterMailBan1';

const db = () => admin.database();
const tally = async () => (await db().ref(`mod_votes_tally/${M}`).get()).val() || { ups: 0, downs: 0 };
const vote = async (voter, v) => {
  await db().ref(`mod_votes_by_user/${voter}/${M}`).set(v);
  await T.countVote(voter, M);
};

let pass = 0;
async function test(name, fn) {
  try { await fn(); pass += 1; console.log(`ok   ${name}`); } catch (e) { console.error(`FAIL ${name}\n     ${e.message}`); process.exitCode = 1; }
}

async function seed() {
  const created = (age) => new Date(Date.now() - age).toUTCString();
  const users = [
    [OLD1, 30 * DAY], [OLD2, 30 * DAY], [NEW, 2 * DAY], [BAN, 30 * DAY],
    [MUTE, 30 * DAY], [EXP, 30 * DAY], [MAILBAN, 30 * DAY], [M, 90 * DAY],
  ].map(([uid, age]) => ({ uid, email: `${uid.toLowerCase()}@example.com`, metadata: { creationTime: created(age), lastSignInTime: created(0) } }));
  const res = await admin.auth().importUsers(users);
  assert.strictEqual(res.failureCount, 0, JSON.stringify(res.errors));

  const now = Date.now();
  await db().ref().set({
    mods: { [M]: { displayName: 'Mod', role: 'mod' } },
    banned_uids: {
      [BAN]: { type: 'ban', bannedUntil: 'permanent', strikeCount: 3 },
      [MUTE]: { type: 'mute', bannedUntil: now + DAY, strikeCount: 0 },
      [EXP]: { type: 'ban', bannedUntil: now - DAY, strikeCount: 1 },
    },
    banned_users_by_email: {
      'votermailban1@example(dot)com': { bannedUntil: now + DAY, strikeCount: 1 },
    },
  });
}

async function main() {
  if (!admin.apps.length) admin.initializeApp();
  await seed();

  await test('old account upvote counts', async () => {
    await vote(OLD1, 1);
    assert.deepStrictEqual(await tally(), { ups: 1, downs: 0 });
  });
  await test('switching up → down moves one vote', async () => {
    await vote(OLD1, -1);
    assert.deepStrictEqual(await tally(), { ups: 0, downs: 1 });
  });
  await test('running twice for the same vote never double-counts', async () => {
    await T.countVote(OLD1, M);
    await T.countVote(OLD1, M);
    assert.deepStrictEqual(await tally(), { ups: 0, downs: 1 });
  });
  await test('undoing a vote removes it', async () => {
    await vote(OLD1, null);
    assert.deepStrictEqual(await tally(), { ups: 0, downs: 0 });
  });
  await test('account under 7 days: not counted', async () => {
    await vote(NEW, -1);
    assert.deepStrictEqual(await tally(), { ups: 0, downs: 0 });
  });
  await test('banned voter: not counted', async () => {
    await vote(BAN, -1);
    assert.deepStrictEqual(await tally(), { ups: 0, downs: 0 });
  });
  await test('muted voter: not counted', async () => {
    await vote(MUTE, -1);
    assert.deepStrictEqual(await tally(), { ups: 0, downs: 0 });
  });
  await test('banned by email record only: not counted', async () => {
    await vote(MAILBAN, -1);
    assert.deepStrictEqual(await tally(), { ups: 0, downs: 0 });
  });
  await test('expired ban: counted', async () => {
    await vote(EXP, 1);
    assert.deepStrictEqual(await tally(), { ups: 1, downs: 0 });
  });
  await test('mod voting for themself: not counted', async () => {
    await vote(M, 1);
    assert.deepStrictEqual(await tally(), { ups: 1, downs: 0 });
  });
  await test('counted list holds only eligible voters', async () => {
    const counted = (await db().ref(`mod_votes_counted/${M}`).get()).val();
    assert.deepStrictEqual(counted, { [EXP]: 1 });
  });

  await test('daily rebuild repairs a tampered tally and adds missed votes', async () => {
    await db().ref(`mod_votes_tally/${M}`).set({ ups: 999, downs: 0 });
    await db().ref(`mod_votes_by_user/${OLD2}/${M}`).set(1); // cast before the trigger existed
    await T.rebuildAll();
    assert.deepStrictEqual(await tally(), { ups: 2, downs: 0 });
  });
  await test('rebuild drops a voter banned after voting, restores after unban', async () => {
    await db().ref(`banned_uids/${OLD2}`).set({ type: 'ban', bannedUntil: Date.now() + DAY, strikeCount: 1 });
    await T.rebuildAll();
    assert.deepStrictEqual(await tally(), { ups: 1, downs: 0 });
    await db().ref(`banned_uids/${OLD2}`).remove();
    await T.rebuildAll();
    assert.deepStrictEqual(await tally(), { ups: 2, downs: 0 });
  });
  await test('rebuild drops votes for someone no longer a mod', async () => {
    await db().ref(`mods/${M}`).remove();
    await T.rebuildAll();
    assert.strictEqual((await db().ref(`mod_votes_tally/${M}`).get()).val(), null);
  });

  console.log(`\n${pass} passed${process.exitCode ? ', some FAILED' : ''}`);
  await admin.app().delete();
}

main().catch((e) => { console.error(e); process.exit(1); });
