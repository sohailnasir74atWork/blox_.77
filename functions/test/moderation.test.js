/* eslint-disable no-console */
/**
 * Emulator suite for functions/banEnforcement.js.
 *
 * From the Blox_Fruit directory:
 *   firebase emulators:exec --only auth,database,firestore,functions \
 *     --project demo-fruiteblocks 'node functions/test/moderation.test.js'
 *
 * No SUPABASE_URL is set, so the deployed-shape functions run with Supabase
 * skipped; in-process cases inject a fake Supabase client to check the audit
 * log and the reconcile job. The emulator's RTDB rules are replaced with open
 * rules (+ indexes) so this suite tests the server, not database.rules.json;
 * USER-authenticated writes go through the RTDB REST API with Auth-emulator
 * ID tokens, so syncEmailBan sees context.authType === 'USER'.
 */
const assert = require('assert');
const path = require('path');
const { execFile } = require('child_process');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-fruiteblocks';
// The functions emulator's Admin SDK uses the namespace named after the demo project.
const NS = process.env.RTDB_NAMESPACE || PROJECT;
const DB_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const FN_HOST = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
const FN_URL = `http://${FN_HOST}/${PROJECT}/us-central1/modSanction`;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT, databaseURL: `http://${DB_HOST}?ns=${NS}` });
process.env.GCLOUD_PROJECT = PROJECT;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = require('firebase-admin');
admin.initializeApp({ projectId: PROJECT, databaseURL: `http://${DB_HOST}?ns=${NS}` });
const db = admin.database();
const fsdb = admin.firestore();
const BE = require('../banEnforcement')._internal;

const RUN = Date.now().toString(36);
const HOUR = 3600 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ekey = (e) => BE.encodeEmailKey(e);
const val = async (p) => (await db.ref(p).get()).val();
const fsDoc = async (uid) => (await fsdb.collection('banned_uids').doc(uid).get());

async function waitFor(fn, label, timeout = 25000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) { last = e; }
    await sleep(250);
  }
  throw new Error(`timeout waiting for: ${label} (last=${JSON.stringify(last && last.message ? last.message : last)})`);
}

// ── users ────────────────────────────────────────────────────────────
let seq = 0;
const tokens = new Map();
async function mkUser(label, { role, email, phone, noEmail } = {}) {
  seq += 1;
  const em = noEmail ? undefined : (email || `${label.toLowerCase()}.${RUN}.${seq}@example.com`);
  const rec = await admin.auth().createUser({
    ...(em ? { email: em, emailVerified: true, password: 'test-pass-123' } : {}),
    ...(phone ? { phoneNumber: phone } : {}),
  });
  const updates = { [`users/${rec.uid}/displayName`]: label, [`users/${rec.uid}/createdAt`]: Date.now() };
  if (role === 'granter') updates[`jmd_granters/${rec.uid}`] = true;
  else if (role) updates[`users/${rec.uid}/${role}`] = true;
  if (em) updates[`users_private/${rec.uid}/email`] = em;
  await db.ref().update(updates);
  return { uid: rec.uid, email: em, label };
}
async function tokenFor(u) {
  if (tokens.has(u.uid)) return tokens.get(u.uid);
  const r = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: 'test-pass-123', returnSecureToken: true }),
  });
  const b = await r.json();
  if (!b.idToken) throw new Error(`sign-in failed for ${u.label}: ${JSON.stringify(b)}`);
  tokens.set(u.uid, b.idToken);
  return b.idToken;
}
// RTDB write as a signed-in user (REST + emulator ID token) → authType USER.
async function userWrite(u, p, value, method = 'PUT') {
  const auth = u ? `&auth=${await tokenFor(u)}` : '';
  const r = await fetch(`http://${DB_HOST}/${p}.json?ns=${NS}${auth}`, {
    method, body: method === 'DELETE' ? undefined : JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`write ${p}: ${r.status} ${await r.text()}`);
}
const userDelete = (u, p) => userWrite(u, p, null, 'DELETE');
async function sanction(u, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (u) headers.Authorization = `Bearer ${await tokenFor(u)}`;
  const r = await fetch(FN_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  let b = null;
  try { b = await r.json(); } catch (_) { /* empty */ }
  return { status: r.status, body: b || {} };
}
const indexDevice = (uid, fp, at = Date.now() - 10 * 60 * 1000) =>
  db.ref().update({ [`account_devices/${uid}/${fp}`]: at, [`device_accounts/${fp}/${uid}`]: at });
const fp16 = () => [...Array(16)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const strikeRec = (by, target, n, extra = {}) => ({
  strikeCount: n,
  bannedUntil: n === 3 ? 'permanent' : Date.now() + (n === 1 ? 3 * HOUR : 72 * HOUR),
  reason: `Strike ${n}`,
  email: target.email,
  displayName: target.label,
  avatar: null,
  userId: target.uid,
  bannedAt: Date.now(),
  bannedBy: { uid: by.uid, displayName: by.label, avatar: null, role: 'Admin' },
  ...extra,
});
const muteRec = (by, target, minutes, extra = {}) => ({
  strikeCount: 0,
  bannedUntil: Date.now() + minutes * 60000,
  reason: `Muted for ${minutes} min`,
  bannedAt: Date.now(),
  userId: target.uid,
  displayName: target.label,
  avatar: null,
  email: target.email,
  bannedBy: by.uid,
  bannerAvatar: null,
  ...extra,
});
const activeBan = async (uid) => {
  const b = await val(`banned_uids/${uid}`);
  return b && BE.isActive(b.bannedUntil) ? b : null;
};

// ── fake Supabase (in-process cases) ─────────────────────────────────
function makeFakeSupabase({ noNewColumns = false, oldActionCheck = false } = {}) {
  const senders = new Map();
  const modActions = [];
  const from = (table) => {
    const q = { op: 'select', filters: [], range: null, rows: null };
    const exec = async () => {
      if (table === 'mod_actions') {
        if (q.op === 'insert') {
          const row = q.rows;
          if (noNewColumns && ('evidence' in row || 'details' in row)) {
            return { error: { code: 'PGRST204', message: "Could not find the 'evidence' column of 'mod_actions' in the schema cache" } };
          }
          if (oldActionCheck && !['mute', 'strike', 'ban', 'unban'].includes(row.action)) {
            return { error: { code: '23514', message: 'new row for relation "mod_actions" violates check constraint' } };
          }
          modActions.push({ ...row, created_at: new Date().toISOString() });
          return { error: null };
        }
        return { data: modActions.filter((r) => q.filters.every((f) => f(r))), error: null };
      }
      if (q.op === 'upsert') {
        for (const r of [].concat(q.rows)) senders.set(r.uid, { ...r });
        return { error: null };
      }
      const rows = [...senders.values()].filter((r) => q.filters.every((f) => f(r)))
        .sort((a, b) => (a.uid < b.uid ? -1 : 1));
      if (q.op === 'delete') {
        for (const r of rows) senders.delete(r.uid);
        return { error: null };
      }
      return { data: q.range ? rows.slice(q.range[0], q.range[1] + 1) : rows, error: null };
    };
    const b = {
      select() { return b; },
      order() { return b; },
      limit() { return b; },
      range(a, z) { q.range = [a, z]; return b; },
      eq(c, v) { q.filters.push((r) => r[c] === v); return b; },
      in(c, arr) { q.filters.push((r) => arr.includes(r[c])); return b; },
      gte(c, v) { q.filters.push((r) => r[c] >= v); return b; },
      delete() { q.op = 'delete'; return b; },
      upsert(rows) { q.op = 'upsert'; q.rows = rows; return b; },
      insert(row) { q.op = 'insert'; q.rows = row; return b; },
      then(res, rej) { return exec().then(res, rej); },
    };
    return b;
  };
  return { from, senders, modActions };
}
function fakeRes() {
  return {
    statusCode: 200, body: null, headersSent: false,
    set() { return this; },
    status(c) { this.statusCode = c; return this; },
    json(x) { this.body = x; this.headersSent = true; return this; },
    send(x) { this.body = x; this.headersSent = true; return this; },
  };
}
async function inProcessSanction(u, body) {
  const res = fakeRes();
  await BE.handleModSanction({ method: 'POST', headers: { authorization: `Bearer ${await tokenFor(u)}` }, body }, res);
  return res;
}

// ── runner ───────────────────────────────────────────────────────────
const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e });
    const where = e && e.stack ? e.stack.split('\n').find((l) => l.includes('moderation.test.js')) : null;
    console.log(`  FAIL  ${name}\n        ${(e && e.message) || e}${where ? `\n        ${where.trim()}` : ''}`);
  }
}

async function main() {
  // Open rules + the indexes the server queries.
  const rr = await fetch(`http://${DB_HOST}/.settings/rules.json?ns=${NS}`, {
    method: 'PUT', headers: { Authorization: 'Bearer owner' },
    body: JSON.stringify({ rules: { '.read': true, '.write': true, banned_uids: { '.indexOn': ['linkedFrom', 'emailKey'] } } }),
  });
  assert.ok(rr.ok, 'rules PUT');

  const owner = await mkUser('Owner', { email: 'sohailnasir74@gmail.com' });
  const adminU = await mkUser('Admin', { role: 'isAdmin' });
  const senior = await mkUser('Senior', { role: 'isSeniorMod' });
  const mod = await mkUser('Mod', { role: 'isModerator' });
  const mod2 = await mkUser('ModTwo', { role: 'isModerator' });
  const jmd = await mkUser('Jmd', { role: 'isBabyMod' });
  const granter = await mkUser('Granter', { role: 'granter' });
  // Wait for the functions emulator to be live.
  await waitFor(async () => (await sanction(null, { action: 'strike' })).status === 401, 'functions emulator up', 60000);

  console.log('\n# modSanction basics and hierarchy');
  await test('previous: 401 / not_staff / self_target / outranked / bad_target', async () => {
    const u = await mkUser('Plain');
    const t = await mkUser('T1');
    assert.strictEqual((await sanction(null, { action: 'strike', targetUid: t.uid })).status, 401);
    assert.strictEqual((await sanction(u, { action: 'strike', targetUid: t.uid, strikeCount: 1, reason: 'x' })).body.error, 'not_staff');
    assert.strictEqual((await sanction(mod, { action: 'strike', targetUid: mod.uid, strikeCount: 1, reason: 'x' })).body.error, 'self_target');
    assert.strictEqual((await sanction(mod, { action: 'strike', targetUid: senior.uid, strikeCount: 1, reason: 'x' })).body.error, 'outranked');
    assert.strictEqual((await sanction(mod, { action: 'strike', targetUid: 'bad', strikeCount: 1 })).body.error, 'bad_target');
    assert.strictEqual((await sanction(granter, { action: 'mute', targetUid: t.uid, minutes: 5 })).body.error, 'not_staff');
  });

  await test('F10 staff targets: mod cannot sanction staff, admin/owner can', async () => {
    const r1 = await sanction(mod, { action: 'mute', targetUid: jmd.uid, minutes: 5, reason: 'x' });
    assert.strictEqual(r1.status, 403); assert.strictEqual(r1.body.error, 'staff_immune');
    const r2 = await sanction(owner, { action: 'mute', targetUid: mod2.uid, minutes: 5, reason: 'x' });
    assert.strictEqual(r2.status, 200, JSON.stringify(r2.body));
    // Owner (verified owner email, rank 5) outranks admin.
    const oa = await sanction(owner, { action: 'mute', targetUid: adminU.uid, minutes: 5 });
    assert.strictEqual(oa.status, 200, JSON.stringify(oa.body));
    assert.strictEqual((await sanction(adminU, { action: 'mute', targetUid: owner.uid, minutes: 5 })).body.error, 'outranked');
    assert.strictEqual((await sanction(owner, { action: 'unmute', targetUid: adminU.uid })).status, 200);
    const r3 = await sanction(owner, { action: 'unmute', targetUid: mod2.uid, reason: 'done' });
    assert.strictEqual(r3.status, 200, JSON.stringify(r3.body));
    assert.strictEqual(await val(`banned_uids/${mod2.uid}`), null);
  });

  await test('F10 JMD limits: mute ≤ 1 day only, no strike/linked/perm-ban-all; unmute ok', async () => {
    const t = await mkUser('JmdTarget');
    assert.strictEqual((await sanction(jmd, { action: 'mute', targetUid: t.uid, minutes: 1441, reason: 'x' })).body.error, 'rank_limit');
    assert.strictEqual((await sanction(jmd, { action: 'strike', targetUid: t.uid, strikeCount: 1, reason: 'x' })).body.error, 'rank_limit');
    assert.strictEqual((await sanction(jmd, { action: 'linked', targetUid: t.uid })).body.error, 'rank_limit');
    assert.strictEqual((await sanction(jmd, { action: 'strike', targetUid: t.uid, strikeCount: 3, includeLinked: true, reason: 'x' })).body.error, 'rank_limit');
    const ok = await sanction(jmd, { action: 'mute', targetUid: t.uid, minutes: 120, reason: 'spam' });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    const rec = await val(`banned_uids/${t.uid}`);
    assert.strictEqual(rec.type, 'mute'); assert.strictEqual(rec.bannedByRank, 1);
    // JMD cannot unban a ban.
    await sanction(mod, { action: 'strike', targetUid: (await mkUser('X')).uid, strikeCount: 1, reason: 'x' });
    const un = await sanction(jmd, { action: 'unmute', targetUid: t.uid });
    assert.strictEqual(un.status, 200, JSON.stringify(un.body));
    assert.strictEqual(await val(`banned_uids/${t.uid}`), null);
    assert.strictEqual(await val(`banned_users_by_email/${ekey(t.email)}`), null);
    const t2 = await mkUser('JmdTarget2');
    await sanction(mod, { action: 'strike', targetUid: t2.uid, strikeCount: 1, reason: 'x' });
    assert.strictEqual((await sanction(jmd, { action: 'unban', targetUid: t2.uid })).body.error, 'rank_limit');
  });

  await test('F14 reason / evidence validation', async () => {
    const t = await mkUser('ValTarget');
    assert.strictEqual((await sanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 1, reason: 'x'.repeat(501) })).body.error, 'bad_reason');
    assert.strictEqual((await sanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 1, reason: 42 })).body.error, 'bad_reason');
    assert.strictEqual((await sanction(mod, { action: 'unban', targetUid: t.uid, reason: { a: 1 } })).body.error, 'bad_reason');
    assert.strictEqual((await sanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 1, reason: 'x', evidence: ['http://a.com/x'] })).body.error, 'bad_evidence');
    assert.strictEqual((await sanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 1, reason: 'x', evidence: ['https://a/1', 'https://a/2', 'https://a/3', 'https://a/4'] })).body.error, 'bad_evidence');
    assert.strictEqual((await sanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 1, reason: 'x', evidence: 'https://a/1' })).body.error, 'bad_evidence');
    const ok = await sanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 1, reason: 'spam', evidence: ['https://img.example.com/1.png'] });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  });

  await test('F14 log action: staff only, validated', async () => {
    const t = await mkUser('LogTarget');
    const ok = await sanction(jmd, { action: 'log', targetUid: t.uid, logAction: 'message_delete', details: { room: 'global', id: 'm1' } });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body)); assert.strictEqual(ok.body.logged, false); // no Supabase here
    assert.strictEqual((await sanction(mod, { action: 'log', targetUid: null, logAction: 'pin' })).status, 200);
    assert.strictEqual((await sanction(granter, { action: 'log', logAction: 'pin' })).body.error, 'not_staff');
    // Staff Access granters may log their own role changes, nothing else (2026-10-22).
    assert.strictEqual((await sanction(granter, { action: 'log', targetUid: t.uid, logAction: 'role_change', details: { role: 'isBabyMod', value: true } })).status, 200);
    const mg = await mkUser('ModGranterLog');
    await db.ref(`mod_granters/${mg.uid}`).set(true);
    assert.strictEqual((await sanction(mg, { action: 'log', targetUid: t.uid, logAction: 'role_change', details: { role: 'isModerator', value: true } })).status, 200);
    assert.strictEqual((await sanction(mg, { action: 'log', logAction: 'message_delete' })).body.error, 'not_staff');
    const plainLog = await mkUser('PlainLog');
    assert.strictEqual((await sanction(plainLog, { action: 'log', logAction: 'role_change' })).body.error, 'not_staff');
    assert.strictEqual((await sanction(mod, { action: 'log', logAction: 'nuke' })).body.error, 'bad_log');
    assert.strictEqual((await sanction(mod, { action: 'log', logAction: 'pin', details: [1] })).body.error, 'bad_log');
    assert.strictEqual((await sanction(mod, { action: 'log', logAction: 'pin', details: { x: 'y'.repeat(3000) } })).body.error, 'bad_log');
    // Custom titles (blox-badges, 2026-10-19).
    assert.strictEqual((await sanction(mod, { action: 'log', targetUid: t.uid, logAction: 'title_change', details: { title: 'Event Host' } })).status, 200);
  });

  console.log('\n# staff powers 2026-10-19');
  await test('POW1 JMD mute cap 1 day: 6h and 1d ok, 1d+1min refused; email path same cap', async () => {
    const t = await mkUser('JmdDay');
    for (const m of [360, 1440]) {
      const r = await sanction(jmd, { action: 'mute', targetUid: t.uid, minutes: m, reason: 'x' });
      assert.strictEqual(r.status, 200, `${m}: ${JSON.stringify(r.body)}`);
    }
    assert.strictEqual((await val(`banned_uids/${t.uid}`)).type, 'mute');
    assert.strictEqual((await sanction(jmd, { action: 'unmute', targetUid: t.uid })).status, 200);
    assert.strictEqual(BE.JMD_MAX_MUTE_MIN, 1440);
    const e = await mkUser('JmdDayEmail');
    const k = ekey(e.email);
    await userWrite(jmd, `banned_users_by_email/${k}`, muteRec(jmd, e, 25 * 60));
    await waitFor(async () => (await val(`banned_users_by_email/${k}`)) === null, '25h reverted');
    await userWrite(jmd, `banned_users_by_email/${k}`, muteRec(jmd, e, 6 * 60));
    const rec = await waitFor(() => activeBan(e.uid), '6h applied');
    assert.strictEqual(rec.type, 'mute'); assert.strictEqual(rec.bannedByRank, 1);
  });

  await test('POW6 senior sanctions mods/JMDs; mod cannot touch JMD; senior cannot touch senior/admin/owner', async () => {
    const senior2 = await mkUser('SeniorTwo', { role: 'isSeniorMod' });
    const m3 = await mkUser('ModThree', { role: 'isModerator' });
    const j2 = await mkUser('JmdTwo', { role: 'isBabyMod' });
    const mu = await sanction(senior, { action: 'mute', targetUid: m3.uid, minutes: 60, reason: 'spam' });
    assert.strictEqual(mu.status, 200, JSON.stringify(mu.body));
    assert.strictEqual((await sanction(senior, { action: 'unmute', targetUid: m3.uid })).status, 200);
    const st = await sanction(senior, { action: 'strike', targetUid: m3.uid, strikeCount: 1, reason: 'abuse' });
    assert.strictEqual(st.status, 200, JSON.stringify(st.body));
    assert.strictEqual((await val(`banned_uids/${m3.uid}`)).bannedByRank, 3);
    assert.strictEqual((await sanction(senior, { action: 'unban', targetUid: m3.uid })).status, 200);
    assert.strictEqual(await val(`banned_uids/${m3.uid}`), null);
    const sj = await sanction(senior, { action: 'strike', targetUid: j2.uid, strikeCount: 2, reason: 'x' });
    assert.strictEqual(sj.status, 200, JSON.stringify(sj.body));
    assert.strictEqual((await sanction(senior, { action: 'linked', targetUid: j2.uid })).status, 200);
    assert.strictEqual((await sanction(mod, { action: 'mute', targetUid: j2.uid, minutes: 5 })).body.error, 'staff_immune');
    assert.strictEqual((await sanction(mod, { action: 'unban', targetUid: j2.uid })).body.error, 'staff_immune');
    assert.strictEqual((await sanction(jmd, { action: 'mute', targetUid: j2.uid, minutes: 5 })).body.error, 'outranked');
    assert.strictEqual((await sanction(senior, { action: 'mute', targetUid: senior2.uid, minutes: 5 })).body.error, 'outranked');
    assert.strictEqual((await sanction(senior, { action: 'mute', targetUid: adminU.uid, minutes: 5 })).body.error, 'outranked');
    assert.strictEqual((await sanction(senior, { action: 'mute', targetUid: owner.uid, minutes: 5 })).body.error, 'outranked');
    // Lifts stay rank-based: a senior cannot lift an admin's ban on a mod.
    assert.strictEqual((await sanction(adminU, { action: 'strike', targetUid: m3.uid, strikeCount: 1, reason: 'x' })).status, 200);
    assert.strictEqual((await sanction(senior, { action: 'unban', targetUid: m3.uid })).body.error, 'banner_outranks');
    assert.strictEqual((await sanction(adminU, { action: 'unban', targetUid: m3.uid })).status, 200);
    // Email path: senior → mod applied, mod → JMD reverted.
    await userWrite(senior, `banned_users_by_email/${ekey(m3.email)}`, strikeRec(senior, m3, 1));
    assert.strictEqual((await waitFor(() => activeBan(m3.uid), 'senior email strike on mod')).bannedByRank, 3);
    const kj = ekey(j2.email);
    await sanction(adminU, { action: 'unban', targetUid: j2.uid });
    await userWrite(mod, `banned_users_by_email/${kj}`, strikeRec(mod, j2, 1));
    await waitFor(async () => (await val(`banned_users_by_email/${kj}`)) === null, 'mod email strike on JMD reverted');
    assert.strictEqual(await val(`banned_uids/${j2.uid}`), null);
  });

  await test('POW7 Mod strike 3 → 30 days + request; mirrors temporary, Auth untouched', async () => {
    const t = await mkUser('PendT');
    const fp = fp16();
    await indexDevice(t.uid, fp);
    const t0 = Date.now();
    const r = await sanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 3, reason: 'scam', evidence: ['https://e.example/p.png'] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.pendingPermanent, true); assert.strictEqual(typeof r.body.bannedUntil, 'number');
    assert.ok(Math.abs(r.body.bannedUntil - (t0 + BE.PENDING_PERM_MS)) < 60000, 'about 3 days');
    assert.strictEqual(BE.PENDING_PERM_MS, 3 * 24 * HOUR, 'Mod strike 3 waits 3 days (2026-10-22)');
    // Strike 1 = 6 h, strike 2 = 24 h (2026-10-22).
    const st = await mkUser('StrikeTimes');
    const s1 = await sanction(mod, { action: 'strike', targetUid: st.uid, strikeCount: 1, reason: 'x' });
    assert.ok(Math.abs(s1.body.bannedUntil - (Date.now() + 6 * HOUR)) < 60000, 'strike 1 is about 6 hours');
    const s2 = await sanction(mod, { action: 'strike', targetUid: st.uid, strikeCount: 2, reason: 'x' });
    assert.ok(Math.abs(s2.body.bannedUntil - (Date.now() + 24 * HOUR)) < 60000, 'strike 2 is about 24 hours');
    for (const f of ['accountExists', 'hasEmail', 'devices', 'linkedBanned']) assert.ok(f in r.body, f); // old builds read these
    const rec = await val(`banned_uids/${t.uid}`);
    assert.strictEqual(rec.type, 'ban'); assert.strictEqual(rec.strikeCount, 3);
    assert.strictEqual(rec.pendingPermanent, true); assert.strictEqual(rec.requestedByUid, mod.uid);
    assert.strictEqual(rec.bannedByRank, 2); assert.ok(!rec.authDisabledByBan);
    assert.strictEqual((await admin.auth().getUser(t.uid)).disabled, false);
    const em = await val(`banned_users_by_email/${ekey(t.email)}`);
    assert.strictEqual(em.bannedUntil, rec.bannedUntil); assert.strictEqual(em.pendingPermanent, true);
    const d = (await fsDoc(t.uid)).data();
    assert.strictEqual(d.permanent, false); assert.strictEqual(d.until.toMillis(), rec.bannedUntil);
    const dev = await val(`banned_devices/${fp}`);
    assert.strictEqual(dev.bannedUntil, rec.bannedUntil); assert.strictEqual(dev.banners[t.uid].pendingPermanent, true);
    const req = await val(`perm_ban_requests/${t.uid}`);
    assert.strictEqual(req.requestedByUid, mod.uid); assert.strictEqual(req.reason, 'scam');
    assert.deepStrictEqual(req.evidence, ['https://e.example/p.png']);
    // A Senior Mod's strike 3 is permanent at once (2026-10-22), like an admin's.
    const s3 = await mkUser('PendSenior');
    const sr = await sanction(senior, { action: 'strike', targetUid: s3.uid, strikeCount: 3, reason: 'x' });
    assert.strictEqual(sr.status, 200, JSON.stringify(sr.body)); assert.ok(!sr.body.pendingPermanent);
    const srec = await val(`banned_uids/${s3.uid}`);
    assert.strictEqual(srec.bannedUntil, 'permanent'); assert.strictEqual(srec.bannedByRank, 3);
    assert.strictEqual(srec.pendingPermanent, undefined); assert.strictEqual(await val(`perm_ban_requests/${s3.uid}`), null);
    assert.strictEqual((await admin.auth().getUser(s3.uid)).disabled, true);
  });

  await test('POW7 perm requests: admin only; confirm = permanent everywhere, only admin lifts it', async () => {
    const t = await mkUser('ConfirmT');
    const fp = fp16();
    await indexDevice(t.uid, fp);
    const alt = await mkUser('ConfirmAlt');
    await indexDevice(alt.uid, fp);
    const r = await sanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 3, reason: 'alts', includeLinked: true, linkedUids: [alt.uid] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.linkedBanned, 1);
    assert.strictEqual((await val(`banned_uids/${alt.uid}`)).pendingPermanent, true);
    assert.strictEqual(await val(`perm_ban_requests/${alt.uid}`), null, 'linked picks are not separate requests');
    const plain = await mkUser('PlainP');
    assert.strictEqual((await sanction(plain, { action: 'perm_requests' })).body.error, 'not_staff');
    for (const u of [jmd, mod]) {
      const x = await sanction(u, { action: 'perm_requests' });
      assert.strictEqual(x.status, 403); assert.strictEqual(x.body.error, 'admin_only');
      assert.strictEqual((await sanction(u, { action: 'perm_confirm', targetUid: t.uid })).body.error, 'admin_only');
    }
    // Senior Mods see the queue too since 2026-10-22.
    assert.strictEqual((await sanction(senior, { action: 'perm_requests' })).status, 200);
    const list = await sanction(adminU, { action: 'perm_requests' });
    assert.strictEqual(list.status, 200, JSON.stringify(list.body));
    const row = list.body.requests.find((x) => x.uid === t.uid);
    assert.ok(row, 'listed'); assert.strictEqual(row.requestedByUid, mod.uid); assert.strictEqual(row.targetName, 'ConfirmT');
    assert.strictEqual(row.requestedByName, 'Mod'); assert.strictEqual(row.includeLinked, true);
    const c = await sanction(adminU, { action: 'perm_confirm', targetUid: t.uid, reason: 'confirmed' });
    assert.strictEqual(c.status, 200, JSON.stringify(c.body)); assert.strictEqual(c.body.linkedUpdated, 1);
    const rec = await val(`banned_uids/${t.uid}`);
    assert.strictEqual(rec.bannedUntil, 'permanent'); assert.strictEqual(rec.pendingPermanent, undefined);
    assert.strictEqual(rec.bannedByRank, 4); assert.strictEqual(rec.requestedByUid, mod.uid);
    assert.strictEqual(rec.authDisabledByBan, true);
    assert.strictEqual((await admin.auth().getUser(t.uid)).disabled, true);
    assert.strictEqual((await fsDoc(t.uid)).data().permanent, true);
    const em = await val(`banned_users_by_email/${ekey(t.email)}`);
    assert.strictEqual(em.bannedUntil, 'permanent'); assert.strictEqual(em.pendingPermanent, undefined);
    assert.strictEqual((await val(`banned_devices/${fp}`)).bannedUntil, 'permanent');
    assert.strictEqual(await val(`perm_ban_requests/${t.uid}`), null);
    assert.strictEqual((await val(`banned_uids/${alt.uid}`)).bannedUntil, 'permanent', 'linked pick upgraded');
    assert.ok(!(await sanction(adminU, { action: 'perm_requests' })).body.requests.some((x) => x.uid === t.uid));
    assert.strictEqual((await sanction(adminU, { action: 'perm_confirm', targetUid: t.uid })).body.error, 'not_pending');
    // The mod who asked can no longer lift it; an admin can.
    assert.strictEqual((await sanction(mod, { action: 'unban', targetUid: t.uid })).body.error, 'banner_outranks');
    assert.strictEqual((await sanction(adminU, { action: 'unban', targetUid: t.uid })).status, 200);
    assert.strictEqual((await admin.auth().getUser(t.uid)).disabled, false);
  });

  await test('POW7 reject keeps 30 days; lift / admin strike 3 clear the request; evasion follows confirm', async () => {
    const t = await mkUser('RejectT');
    await sanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 3, reason: 'x' });
    const until = (await val(`banned_uids/${t.uid}`)).bannedUntil;
    const rj = await sanction(owner, { action: 'perm_reject', targetUid: t.uid, reason: 'too harsh' });
    assert.strictEqual(rj.status, 200, JSON.stringify(rj.body));
    const rec = await val(`banned_uids/${t.uid}`);
    assert.strictEqual(rec.bannedUntil, until); assert.strictEqual(rec.pendingPermanent, undefined);
    assert.strictEqual((await val(`banned_users_by_email/${ekey(t.email)}`)).pendingPermanent, undefined);
    assert.strictEqual(await val(`perm_ban_requests/${t.uid}`), null);
    assert.strictEqual((await admin.auth().getUser(t.uid)).disabled, false);
    const again = await sanction(adminU, { action: 'perm_reject', targetUid: t.uid });
    assert.strictEqual(again.status, 409); assert.strictEqual(again.body.error, 'not_pending');
    // Same-rank lift of a pending ban removes the request.
    const l = await mkUser('LiftPend');
    await sanction(mod, { action: 'strike', targetUid: l.uid, strikeCount: 3, reason: 'x' });
    assert.ok(await val(`perm_ban_requests/${l.uid}`));
    assert.strictEqual((await sanction(mod2, { action: 'unban', targetUid: l.uid })).status, 200);
    assert.strictEqual(await val(`perm_ban_requests/${l.uid}`), null);
    // An admin's own strike 3 over a pending ban: permanent, request gone.
    const a = await mkUser('AdminOver');
    await sanction(mod, { action: 'strike', targetUid: a.uid, strikeCount: 3, reason: 'x' });
    assert.strictEqual((await sanction(adminU, { action: 'strike', targetUid: a.uid, strikeCount: 3, reason: 'x' })).status, 200);
    assert.strictEqual((await val(`banned_uids/${a.uid}`)).bannedUntil, 'permanent');
    assert.strictEqual(await val(`perm_ban_requests/${a.uid}`), null);
    // An alt caught on the banned device while pending is upgraded on confirm.
    const s = await mkUser('PendEvader');
    const e1 = fp16();
    await indexDevice(s.uid, e1);
    await sanction(mod, { action: 'strike', targetUid: s.uid, strikeCount: 3, reason: 'x' });
    const n1 = await mkUser('PendAlt');
    await db.ref(`users_private/${n1.uid}/deviceId`).set(e1);
    const b1 = await waitFor(() => activeBan(n1.uid), 'alt auto-banned');
    assert.strictEqual(b1.pendingPermanent, true); assert.strictEqual(typeof b1.bannedUntil, 'number');
    const c = await sanction(adminU, { action: 'perm_confirm', targetUid: s.uid });
    assert.strictEqual(c.body.linkedUpdated, 1, JSON.stringify(c.body));
    assert.strictEqual((await val(`banned_uids/${n1.uid}`)).bannedUntil, 'permanent');
  });

  await test('POW7 OLD build: mod writes a permanent email strike → rewritten to 30 days + request', async () => {
    const t = await mkUser('OldPerm');
    const k = ekey(t.email);
    await userWrite(mod, `banned_users_by_email/${k}`, strikeRec(mod, t, 3));
    const rec = await waitFor(() => activeBan(t.uid), 'applied');
    assert.strictEqual(typeof rec.bannedUntil, 'number'); assert.strictEqual(rec.pendingPermanent, true);
    assert.strictEqual(rec.bannedByUid, mod.uid);
    const em = await waitFor(async () => {
      const v = await val(`banned_users_by_email/${k}`);
      return v && v.managedBy === 'server' ? v : null;
    }, 'record rewritten');
    assert.strictEqual(em.bannedUntil, rec.bannedUntil); assert.strictEqual(em.pendingPermanent, true);
    assert.strictEqual((await val(`perm_ban_requests/${t.uid}`)).requestedByUid, mod.uid);
    assert.strictEqual((await admin.auth().getUser(t.uid)).disabled, false);
    // A permanent ban already in place is never softened by such a write.
    const p = await mkUser('OldPermOver');
    const kp = ekey(p.email);
    await sanction(adminU, { action: 'strike', targetUid: p.uid, strikeCount: 3, reason: 'x' });
    await userWrite(mod, `banned_users_by_email/${kp}`, strikeRec(mod, p, 3, { reason: 'again' }));
    await waitFor(async () => (await val(`banned_users_by_email/${kp}`))?.reason === 'x', 'restored');
    assert.strictEqual((await val(`banned_users_by_email/${kp}`)).bannedUntil, 'permanent');
    assert.strictEqual((await val(`banned_uids/${p.uid}`)).bannedUntil, 'permanent');
    assert.strictEqual(await val(`perm_ban_requests/${p.uid}`), null);
    // An old build's Senior Mod permanent email strike stays permanent (2026-10-22).
    const sp = await mkUser('OldPermSenior');
    await userWrite(senior, `banned_users_by_email/${ekey(sp.email)}`, strikeRec(senior, sp, 3));
    const spRec = await waitFor(() => activeBan(sp.uid), 'senior perm applied');
    assert.strictEqual(spRec.bannedUntil, 'permanent'); assert.strictEqual(spRec.pendingPermanent, undefined);
    assert.strictEqual(await val(`perm_ban_requests/${sp.uid}`), null);
  });

  await test('POW7 audit rows: pending flag, perm_confirm / perm_reject, fallback before 047', async () => {
    const sb = makeFakeSupabase();
    BE.setSupabaseForTest(sb);
    const t = await mkUser('PermRows');
    await inProcessSanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 3, reason: 'scam' });
    const row = sb.modActions.find((x) => x.target_uid === t.uid && x.action === 'strike');
    assert.strictEqual(row.is_permanent, false); assert.strictEqual(row.strike_count, 3);
    assert.deepStrictEqual(row.details, { pending_permanent: true }); assert.strictEqual(typeof row.banned_until_ms, 'number');
    const c = await inProcessSanction(adminU, { action: 'perm_confirm', targetUid: t.uid, reason: 'ok' });
    assert.strictEqual(c.statusCode, 200, JSON.stringify(c.body));
    const cr = sb.modActions.at(-1);
    assert.strictEqual(cr.action, 'perm_confirm'); assert.strictEqual(cr.is_permanent, true);
    assert.strictEqual(cr.details.requested_by, mod.uid); assert.strictEqual(cr.actor_role, 'admin');
    assert.strictEqual(sb.senders.get(t.uid).banned_until, null);
    const pl = await inProcessSanction(mod, { action: 'log', targetUid: t.uid, logAction: 'post_delete', details: { postId: 'p1' } });
    assert.strictEqual(pl.body.logged, true); assert.strictEqual(sb.modActions.at(-1).action, 'post_delete');

    const old = makeFakeSupabase({ oldActionCheck: true });
    BE.setSupabaseForTest(old);
    const t2 = await mkUser('PermRowsOld');
    await inProcessSanction(mod, { action: 'strike', targetUid: t2.uid, strikeCount: 3 });
    await inProcessSanction(adminU, { action: 'perm_reject', targetUid: t2.uid });
    const rr = old.modActions.at(-1);
    assert.strictEqual(rr.action, 'strike'); assert.strictEqual(rr.details.action, 'perm_reject');
    const noCols = makeFakeSupabase({ noNewColumns: true, oldActionCheck: true });
    BE.setSupabaseForTest(noCols);
    const t3 = await mkUser('PermRowsNoCols');
    await inProcessSanction(mod, { action: 'strike', targetUid: t3.uid, strikeCount: 3 });
    await inProcessSanction(adminU, { action: 'perm_confirm', targetUid: t3.uid });
    assert.strictEqual(noCols.modActions.at(-1).action, 'ban');
    BE.setSupabaseForTest(undefined);
  });

  console.log('\n# review fixes 2026-10-19');
  await test('FIX1 banned staff lose server powers (modSanction + email path); muted staff keep them', async () => {
    const m4 = await mkUser('ModBanned', { role: 'isModerator' });
    const m5 = await mkUser('ModMuted', { role: 'isModerator' });
    const t = await mkUser('FixOneT');
    const placed = await mkUser('FixOnePlaced');
    assert.strictEqual((await sanction(m4, { action: 'strike', targetUid: placed.uid, strikeCount: 1, reason: 'x' })).status, 200);
    assert.strictEqual((await sanction(senior, { action: 'strike', targetUid: m4.uid, strikeCount: 1, reason: 'abuse' })).status, 200);
    for (const body of [
      { action: 'mute', targetUid: t.uid, minutes: 5, reason: 'x' },
      { action: 'strike', targetUid: t.uid, strikeCount: 1, reason: 'x' },
      { action: 'unban', targetUid: placed.uid },
      { action: 'linked', targetUid: t.uid },
      { action: 'log', targetUid: t.uid, logAction: 'message_delete' },
    ]) {
      const r = await sanction(m4, body);
      assert.strictEqual(r.status, 403, `${body.action}: ${JSON.stringify(r.body)}`); assert.strictEqual(r.body.error, 'actor_banned');
    }
    // Email path: a ban written by the banned mod is reverted, a lift restored.
    const k = ekey(t.email);
    await userWrite(m4, `banned_users_by_email/${k}`, strikeRec(m4, t, 1));
    await waitFor(async () => (await val(`banned_users_by_email/${k}`)) === null, 'banned writer reverted');
    assert.strictEqual(await val(`banned_uids/${t.uid}`), null);
    const kp = ekey(placed.email);
    await userDelete(m4, `banned_users_by_email/${kp}`);
    await waitFor(async () => !!(await val(`banned_users_by_email/${kp}`)), 'lift by banned writer restored');
    assert.ok(await activeBan(placed.uid));
    // A mute does not pause staff tools; the ban ending does.
    assert.strictEqual((await sanction(senior, { action: 'mute', targetUid: m5.uid, minutes: 60, reason: 'x' })).status, 200);
    assert.strictEqual((await sanction(m5, { action: 'mute', targetUid: t.uid, minutes: 5, reason: 'x' })).status, 200);
    assert.strictEqual((await sanction(senior, { action: 'unban', targetUid: m4.uid })).status, 200);
    assert.strictEqual((await sanction(m4, { action: 'unban', targetUid: placed.uid })).status, 200);
  });

  await test('FIX2 two admins answering one request at once: one wins, record consistent', async () => {
    const admin2 = await mkUser('AdminRace', { role: 'isAdmin' });
    for (const [first, second] of [['perm_confirm', 'perm_confirm'], ['perm_confirm', 'perm_reject'], ['perm_reject', 'perm_confirm']]) {
      const t = await mkUser(`Race${first}${second}`);
      await sanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 3, reason: 'x' });
      const [a, b] = await Promise.all([
        inProcessSanction(adminU, { action: first, targetUid: t.uid }),
        inProcessSanction(admin2, { action: second, targetUid: t.uid }),
      ]);
      const codes = [a.statusCode, b.statusCode].sort();
      assert.deepStrictEqual(codes, [200, 409], `${first}/${second}: ${JSON.stringify([a.body, b.body])}`);
      const winner = a.statusCode === 200 ? first : second;
      const rec = await val(`banned_uids/${t.uid}`);
      assert.strictEqual(rec.pendingPermanent, undefined);
      assert.strictEqual(await val(`perm_ban_requests/${t.uid}`), null);
      const disabled = (await admin.auth().getUser(t.uid)).disabled;
      if (winner === 'perm_confirm') {
        assert.strictEqual(rec.bannedUntil, 'permanent'); assert.strictEqual(rec.authDisabledByBan, true); assert.strictEqual(disabled, true);
      } else {
        assert.strictEqual(typeof rec.bannedUntil, 'number'); assert.ok(!rec.authDisabledByBan); assert.strictEqual(disabled, false);
      }
    }
  });

  await test('FIX3 old-build permanent client device copy is dropped on the 30-day conversion', async () => {
    const t = await mkUser('OldDevCopy');
    const fp = fp16();
    await indexDevice(t.uid, fp);
    for (let i = 0; i < 3; i++) await indexDevice((await mkUser(`OldDevFam${i}`)).uid, fp); // shared: server won't ban it
    const payload = strikeRec(mod, t, 3);
    await userWrite(mod, `banned_devices/${fp}`, {
      bannedUntil: 'permanent', bannedAt: payload.bannedAt, bannedBy: payload.bannedBy, reason: payload.reason, strikeCount: 3, email: t.email, userId: t.uid,
    });
    await userWrite(mod, `banned_users_by_email/${ekey(t.email)}`, payload);
    await waitFor(async () => (await activeBan(t.uid))?.pendingPermanent === true, 'converted');
    await waitFor(async () => (await val(`banned_devices/${fp}`)) === null, 'permanent client copy dropped');
  });

  await test('FIX4 email-only permanent strike, no account: 30 days + email-keyed request; confirm / reject', async () => {
    const email = `noacct.${RUN}.${Date.now()}@example.com`;
    const k = ekey(email);
    const rec = { ...strikeRec(mod, { email, label: 'NoAcct', uid: null }, 3), userId: null };
    await userWrite(mod, `banned_users_by_email/${k}`, rec);
    const em = await waitFor(async () => {
      const v = await val(`banned_users_by_email/${k}`);
      return v && v.managedBy === 'server' ? v : null;
    }, 'rewritten');
    assert.strictEqual(typeof em.bannedUntil, 'number'); assert.strictEqual(em.pendingPermanent, true);
    const req = await waitFor(() => val(`perm_ban_requests/email:${k}`), 'email request');
    assert.strictEqual(req.requestedByUid, mod.uid); assert.strictEqual(req.recordKey, k);
    const list = await sanction(adminU, { action: 'perm_requests' });
    const row = list.body.requests.find((x) => x.key === `email:${k}`);
    assert.ok(row, JSON.stringify(list.body)); assert.strictEqual(row.uid, null); assert.strictEqual(row.email, email);
    assert.strictEqual((await sanction(mod, { action: 'perm_confirm', emailKey: k })).body.error, 'admin_only');
    const c = await sanction(adminU, { action: 'perm_confirm', emailKey: k, reason: 'ok' });
    assert.strictEqual(c.status, 200, JSON.stringify(c.body)); assert.strictEqual(c.body.accountExists, false);
    assert.strictEqual((await val(`banned_users_by_email/${k}`)).bannedUntil, 'permanent');
    assert.strictEqual(await val(`perm_ban_requests/email:${k}`), null);
    assert.strictEqual((await sanction(adminU, { action: 'perm_confirm', emailKey: k })).body.error, 'not_pending');
    // Signing up with that email now is a permanent ban.
    const u = await admin.auth().createUser({ email, password: 'test-pass-123' });
    assert.strictEqual((await waitFor(() => activeBan(u.uid), 're-ban on sign-up')).bannedUntil, 'permanent');

    // An account made while pending follows the decision (reject → 30 days).
    const email2 = `noacct2.${RUN}.${Date.now()}@example.com`;
    const k2 = ekey(email2);
    await userWrite(mod, `banned_users_by_email/${k2}`, { ...strikeRec(mod, { email: email2, label: 'NoAcct2', uid: null }, 3), userId: null });
    await waitFor(() => val(`perm_ban_requests/email:${k2}`), 'email request 2');
    const u2 = await admin.auth().createUser({ email: email2, password: 'test-pass-123' });
    assert.strictEqual((await waitFor(() => activeBan(u2.uid), 'pending on sign-up')).pendingPermanent, true);
    const rj = await sanction(adminU, { action: 'perm_reject', emailKey: k2 });
    assert.strictEqual(rj.status, 200, JSON.stringify(rj.body)); assert.strictEqual(rj.body.accountExists, true);
    const b2 = await val(`banned_uids/${u2.uid}`);
    assert.strictEqual(typeof b2.bannedUntil, 'number'); assert.strictEqual(b2.pendingPermanent, undefined);
    assert.strictEqual((await val(`banned_users_by_email/${k2}`)).pendingPermanent, undefined);
  });

  await test('FIX5 an admin strike 3 over a pending ban settles its linked accounts', async () => {
    const t = await mkUser('SettleT');
    const fp = fp16();
    await indexDevice(t.uid, fp);
    const alt = await mkUser('SettleAlt');
    await indexDevice(alt.uid, fp);
    await sanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 3, reason: 'x', includeLinked: true, linkedUids: [alt.uid] });
    assert.strictEqual((await val(`banned_uids/${alt.uid}`)).pendingPermanent, true);
    const r = await sanction(adminU, { action: 'strike', targetUid: t.uid, strikeCount: 3, reason: 'final' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.derivedUpdated, 1);
    const a = await val(`banned_uids/${alt.uid}`);
    assert.strictEqual(a.bannedUntil, 'permanent'); assert.strictEqual(a.pendingPermanent, undefined); assert.strictEqual(a.bannedByRank, 4);
    assert.strictEqual(await val(`perm_ban_requests/${t.uid}`), null);
  });

  console.log('\n# bans vs mutes, mirrors');
  await test('F8/F13 admin strike 3: type ban, Firestore mirror, Auth disabled; unban reverses all', async () => {
    const a = await mkUser('PermA');
    const fp = fp16();
    await indexDevice(a.uid, fp);
    const r = await sanction(adminU, { action: 'strike', targetUid: a.uid, strikeCount: 3, reason: 'scam' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.devices, 1); assert.strictEqual(r.body.pendingPermanent, false);
    const rec = await val(`banned_uids/${a.uid}`);
    assert.strictEqual(rec.type, 'ban'); assert.strictEqual(rec.authDisabledByBan, true);
    assert.strictEqual(rec.bannedUntil, 'permanent'); assert.strictEqual(rec.pendingPermanent, undefined);
    assert.strictEqual(rec.bannedByUid, adminU.uid); assert.strictEqual(rec.bannedByRank, 4);
    assert.strictEqual(await val(`perm_ban_requests/${a.uid}`), null);
    const em = await val(`banned_users_by_email/${ekey(a.email)}`);
    assert.strictEqual(em.type, 'ban'); assert.strictEqual(em.managedBy, 'server');
    const d = await fsDoc(a.uid);
    assert.ok(d.exists); assert.strictEqual(d.data().permanent, true); assert.strictEqual(d.data().type, 'ban');
    assert.strictEqual((await admin.auth().getUser(a.uid)).disabled, true);
    const dev = await val(`banned_devices/${fp}`);
    assert.strictEqual(dev.userId, a.uid); assert.ok(dev.banners[a.uid]);
    const u = await sanction(adminU, { action: 'unban', targetUid: a.uid, reason: 'appeal' });
    assert.strictEqual(u.status, 200, JSON.stringify(u.body));
    assert.strictEqual(await val(`banned_uids/${a.uid}`), null);
    assert.strictEqual(await val(`banned_users_by_email/${ekey(a.email)}`), null);
    assert.strictEqual(await val(`banned_devices/${fp}`), null);
    assert.strictEqual((await fsDoc(a.uid)).exists, false);
    assert.strictEqual((await admin.auth().getUser(a.uid)).disabled, false);
  });

  await test('F8 mute: no devices / Auth / Firestore, strikeCount kept, type mute; unmute vs ban', async () => {
    const b = await mkUser('MuteB');
    const fp = fp16();
    await indexDevice(b.uid, fp);
    await db.ref(`banned_uids/${b.uid}`).set({ type: 'ban', bannedUntil: Date.now() - 1000, strikeCount: 2, reason: 'old' });
    const r = await sanction(mod, { action: 'mute', targetUid: b.uid, minutes: 30, reason: 'flood' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const rec = await val(`banned_uids/${b.uid}`);
    assert.strictEqual(rec.type, 'mute'); assert.strictEqual(rec.strikeCount, 2);
    const em = await val(`banned_users_by_email/${ekey(b.email)}`);
    assert.strictEqual(em.type, 'mute'); assert.strictEqual(em.strikeCount, 2);
    assert.strictEqual(await val(`banned_devices/${fp}`), null);
    assert.strictEqual((await fsDoc(b.uid)).exists, false);
    assert.strictEqual((await admin.auth().getUser(b.uid)).disabled, false);
    // A strike replaces the mute; then unmute is refused for a ban.
    const s = await sanction(mod, { action: 'strike', targetUid: b.uid, strikeCount: 1, reason: 'x' });
    assert.strictEqual(s.status, 200, JSON.stringify(s.body));
    assert.strictEqual((await val(`banned_uids/${b.uid}`)).type, 'ban');
    assert.strictEqual((await sanction(mod, { action: 'unmute', targetUid: b.uid })).body.error, 'not_muted');
    // Mute over an active ban is refused.
    assert.strictEqual((await sanction(mod, { action: 'mute', targetUid: b.uid, minutes: 600, reason: 'x' })).body.error, 'stricter_ban_active');
  });

  await test('previous: no-downgrade 409 through modSanction', async () => {
    const t = await mkUser('NoDown');
    assert.strictEqual((await sanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 3, reason: 'x' })).status, 200);
    const r = await sanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 1, reason: 'x' });
    assert.strictEqual(r.status, 409); assert.strictEqual(r.body.error, 'stricter_ban_active');
  });

  console.log('\n# syncEmailBan: who wrote it');
  await test('F1 JMD strike with spoofed admin bannedBy is reverted, not applied', async () => {
    const t = await mkUser('SpoofT');
    const k = ekey(t.email);
    await userWrite(jmd, `banned_users_by_email/${k}`, strikeRec(owner, t, 3));
    await waitFor(async () => (await val(`banned_users_by_email/${k}`)) === null, 'record reverted');
    assert.strictEqual(await val(`banned_uids/${t.uid}`), null);
    assert.strictEqual((await admin.auth().getUser(t.uid)).disabled, false);
  });

  await test('F1 moderator strike applied with the VERIFIED writer as banner', async () => {
    const t = await mkUser('VerifiedT');
    await userWrite(mod, `banned_users_by_email/${ekey(t.email)}`, strikeRec(owner, t, 2));
    const rec = await waitFor(() => activeBan(t.uid), 'uid ban');
    assert.strictEqual(rec.bannedByUid, mod.uid); assert.strictEqual(rec.bannedByRank, 2);
    assert.strictEqual(rec.type, 'ban'); assert.strictEqual(rec.emailKey, ekey(t.email));
  });

  await test('F1 unauthenticated write ignored', async () => {
    const t = await mkUser('AnonT');
    await userWrite(null, `banned_users_by_email/${ekey(t.email)}`, strikeRec(owner, t, 3));
    await sleep(5000);
    assert.strictEqual(await val(`banned_uids/${t.uid}`), null);
  });

  await test('F1 non-staff writer (jmd_granter only) reverted', async () => {
    const t = await mkUser('GranterT');
    const k = ekey(t.email);
    await userWrite(granter, `banned_users_by_email/${k}`, muteRec(granter, t, 10));
    await waitFor(async () => (await val(`banned_users_by_email/${k}`)) === null, 'reverted');
    assert.strictEqual(await val(`banned_uids/${t.uid}`), null);
  });

  await test('F1/F10 staff immunity and outranked via email path are reverted', async () => {
    const k1 = ekey(mod2.email);
    await userWrite(mod, `banned_users_by_email/${k1}`, strikeRec(mod, mod2, 1));
    await waitFor(async () => (await val(`banned_users_by_email/${k1}`)) === null, 'mod→mod reverted');
    const k2 = ekey(senior.email);
    await userWrite(mod, `banned_users_by_email/${k2}`, strikeRec(mod, senior, 1));
    await waitFor(async () => (await val(`banned_users_by_email/${k2}`)) === null, 'mod→senior reverted');
    assert.strictEqual(await val(`banned_uids/${mod2.uid}`), null);
    assert.strictEqual(await val(`banned_uids/${senior.uid}`), null);
  });

  await test('F1 Admin-SDK write is trusted', async () => {
    const t = await mkUser('AdminSdkT');
    const rec = strikeRec(mod, t, 1);
    delete rec.userId;
    await db.ref(`banned_users_by_email/${ekey(t.email)}`).set(rec);
    const b = await waitFor(() => activeBan(t.uid), 'applied');
    assert.strictEqual(b.bannedByUid, mod.uid);
  });

  await test('F10 JMD 25h mute via email reverted; 30-min legacy mute applied as mute', async () => {
    const t = await mkUser('JmdEmailT');
    const k = ekey(t.email);
    await userWrite(jmd, `banned_users_by_email/${k}`, muteRec(jmd, t, 25 * 60));
    await waitFor(async () => (await val(`banned_users_by_email/${k}`)) === null, 'reverted');
    assert.strictEqual(await val(`banned_uids/${t.uid}`), null);
    const fp = fp16();
    await indexDevice(t.uid, fp);
    await userWrite(jmd, `banned_users_by_email/${k}`, muteRec(jmd, t, 30));
    const rec = await waitFor(() => activeBan(t.uid), 'mute applied');
    assert.strictEqual(rec.type, 'mute');
    assert.strictEqual(await val(`banned_devices/${fp}`), null);
    assert.strictEqual((await fsDoc(t.uid)).exists, false);
  });

  console.log('\n# lifting and softening');
  await test('F2 mod cannot delete an admin-placed ban (record restored)', async () => {
    const t = await mkUser('AdminBanT');
    const k = ekey(t.email);
    await userWrite(owner, `banned_users_by_email/${k}`, strikeRec(owner, t, 2));
    const b = await waitFor(() => activeBan(t.uid), 'applied');
    assert.strictEqual(b.bannedByRank, 5); // owner
    await userDelete(mod, `banned_users_by_email/${k}`);
    const back = await waitFor(async () => val(`banned_users_by_email/${k}`), 'restored');
    assert.strictEqual(back.managedBy, 'server'); assert.strictEqual(back.strikeCount, 2);
    assert.ok(await activeBan(t.uid));
    // modSanction: banner_outranks for mod; admin may lift.
    const r = await sanction(mod, { action: 'unban', targetUid: t.uid });
    assert.strictEqual(r.status, 403); assert.strictEqual(r.body.error, 'banner_outranks');
    assert.strictEqual((await sanction(adminU, { action: 'unban', targetUid: t.uid })).status, 200);
    assert.strictEqual(await val(`banned_uids/${t.uid}`), null);
    assert.strictEqual(await val(`banned_users_by_email/${k}`), null);
  });

  await test('F2 softening perm→temp: lower rank restored, same rank allowed + Auth re-enabled', async () => {
    const t = await mkUser('SoftenT');
    const k = ekey(t.email);
    const admin2 = await mkUser('AdminTwo', { role: 'isAdmin' });
    await userWrite(adminU, `banned_users_by_email/${k}`, strikeRec(adminU, t, 3));
    await waitFor(async () => (await activeBan(t.uid))?.authDisabledByBan === true, 'perm applied');
    assert.strictEqual((await admin.auth().getUser(t.uid)).disabled, true);
    await userWrite(senior, `banned_users_by_email/${k}`, strikeRec(senior, t, 1));
    await waitFor(async () => (await val(`banned_users_by_email/${k}`))?.bannedUntil === 'permanent', 'restored perm');
    assert.strictEqual((await activeBan(t.uid)).bannedUntil, 'permanent');
    await userWrite(admin2, `banned_users_by_email/${k}`, strikeRec(admin2, t, 1));
    const rec = await waitFor(async () => {
      const r = await activeBan(t.uid);
      return r && typeof r.bannedUntil === 'number' && r.authDisabledByBan === false ? r : null;
    }, 'softened');
    assert.strictEqual(rec.strikeCount, 1);
    assert.strictEqual((await admin.auth().getUser(t.uid)).disabled, false);
    assert.strictEqual((await fsDoc(t.uid)).data().permanent, false);
  });

  await test('F3 delete of a record without userId lifts (getUserByEmail)', async () => {
    const t = await mkUser('NoUidT');
    const k = ekey(t.email);
    const rec = strikeRec(mod, t, 1); rec.userId = null;
    await userWrite(mod, `banned_users_by_email/${k}`, rec);
    await waitFor(() => activeBan(t.uid), 'applied');
    await userDelete(mod, `banned_users_by_email/${k}`);
    await waitFor(async () => (await val(`banned_uids/${t.uid}`)) === null, 'lifted');
  });

  await test('F3 delete without userId after the account is gone (emailKey lookup)', async () => {
    const t = await mkUser('GoneT');
    const k = ekey(t.email);
    const rec = strikeRec(mod, t, 1); delete rec.userId;
    await db.ref(`banned_users_by_email/${k}`).set(rec);
    await waitFor(() => activeBan(t.uid), 'applied');
    await admin.auth().deleteUser(t.uid);
    await waitFor(() => val(`deleted_accounts/${t.uid}`), 'tombstone');
    await userDelete(mod, `banned_users_by_email/${k}`);
    await waitFor(async () => (await val(`banned_uids/${t.uid}`)) === null, 'lifted');
  });

  await test('F4 stale events: old ban event and stale delete are skipped (in-process)', async () => {
    BE.setSupabaseForTest(null);
    const t = await mkUser('StaleT');
    const k = ekey(t.email);
    const current = { ...strikeRec(mod, t, 1), managedBy: 'server' }; // trigger skips managedBy
    await db.ref(`banned_users_by_email/${k}`).set(current);
    const stale = strikeRec(mod, t, 3);
    const ctx = { params: { emailKey: k }, authType: 'USER', auth: { uid: mod.uid, token: {} } };
    const snap = (v) => ({ val: () => v, exists: () => v !== null });
    await BE.handleEmailBanWrite({ before: snap(null), after: snap(stale) }, ctx);
    assert.strictEqual(await val(`banned_uids/${t.uid}`), null, 'stale ban must not apply');
    await BE.applyBan(t.uid, { ...BE.banFromEmailRecord(k, current), bannedByUid: mod.uid, bannedByRank: 2 });
    await BE.handleEmailBanWrite({ before: snap(current), after: snap(null) }, ctx);
    assert.ok(await activeBan(t.uid), 'stale delete must not lift');
    BE.setSupabaseForTest(undefined);
  });

  console.log('\n# devices');
  await test('F5 denylisted / junk device ids are not indexed', async () => {
    const t = await mkUser('JunkDev');
    for (const bad of ['9774d56d682e549c', '0000000000000000', 'unknown', '00000000-0000-0000-0000-000000000000', 'ffffffffffffffff']) {
      await db.ref(`users_private/${t.uid}/deviceId`).set(bad);
    }
    const good = fp16();
    await db.ref(`users_private/${t.uid}/deviceId`).set(good);
    await waitFor(() => val(`account_devices/${t.uid}/${good}`), 'good id indexed');
    await sleep(1500);
    const idx = Object.keys((await val(`account_devices/${t.uid}`)) || {});
    assert.deepStrictEqual(idx, [good]);
    assert.strictEqual(await val('device_accounts/9774d56d682e549c'), null);
  });

  await test('F5 device first seen after the ban is never banned (spoof)', async () => {
    const victim = await mkUser('Victim');
    const x = fp16();
    await indexDevice(victim.uid, x);
    const m = await mkUser('Spoofer');
    const d1 = fp16();
    await indexDevice(m.uid, d1);
    assert.strictEqual((await sanction(mod, { action: 'strike', targetUid: m.uid, strikeCount: 3, reason: 'x' })).status, 200);
    assert.ok(await val(`banned_devices/${d1}`));
    await sleep(1100);
    await db.ref(`users_private/${m.uid}/deviceId`).set(x);
    await waitFor(() => val(`account_devices/${m.uid}/${x}`), 'spoof indexed');
    await sleep(1500);
    assert.strictEqual(await val(`banned_devices/${x}`), null);
    // Re-applying / raising the ban later still leaves it alone.
    await db.ref(`account_devices/${m.uid}/${x}`).set(Date.now() + 5 * 60 * 1000); // seen well after the ban
    assert.strictEqual((await sanction(owner, { action: 'strike', targetUid: m.uid, strikeCount: 3, reason: 'again' })).status, 200);
    assert.strictEqual(await val(`banned_devices/${x}`), null);
    assert.strictEqual(await val(`banned_uids/${victim.uid}`), null);
  });

  await test('F5 more devices than the cap → suspect, no device bans', async () => {
    const n = await mkUser('ManyDev');
    const fps = [...Array(6)].map(fp16);
    for (const fp of fps) await indexDevice(n.uid, fp);
    const r = await sanction(mod, { action: 'strike', targetUid: n.uid, strikeCount: 1, reason: 'x' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.devices, 0); assert.strictEqual(r.body.deviceSuspect, 6);
    assert.strictEqual((await val(`banned_uids/${n.uid}`)).deviceSuspect, 6);
    for (const fp of fps) assert.strictEqual(await val(`banned_devices/${fp}`), null);
  });

  await test('F5 shared device (≥3 unbanned others) and staff device are not banned', async () => {
    const o = await mkUser('SharedO');
    const s1 = fp16();
    const s2 = fp16();
    await indexDevice(o.uid, s1);
    await indexDevice(o.uid, s2);
    for (let i = 0; i < 3; i++) await indexDevice((await mkUser(`Fam${i}`)).uid, s1);
    await indexDevice(jmd.uid, s2);
    const r = await sanction(mod, { action: 'strike', targetUid: o.uid, strikeCount: 3, reason: 'x' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.devices, 0); assert.strictEqual(r.body.devicesSkipped, 2);
    assert.strictEqual(await val(`banned_devices/${s1}`), null);
    assert.strictEqual(await val(`banned_devices/${s2}`), null);
  });

  await test('F6 per-device banner set: lifting one uid keeps the other ban', async () => {
    const r1 = await mkUser('RoomA');
    const r2 = await mkUser('RoomB');
    const z = fp16();
    await indexDevice(r1.uid, z);
    await indexDevice(r2.uid, z);
    await sanction(adminU, { action: 'strike', targetUid: r1.uid, strikeCount: 3, reason: 'x' });
    await sanction(mod, { action: 'strike', targetUid: r2.uid, strikeCount: 1, reason: 'x' });
    let dev = await val(`banned_devices/${z}`);
    assert.deepStrictEqual(Object.keys(dev.banners).sort(), [r1.uid, r2.uid].sort());
    assert.strictEqual(dev.userId, r1.uid); assert.strictEqual(dev.bannedUntil, 'permanent');
    await sanction(adminU, { action: 'unban', targetUid: r2.uid });
    dev = await val(`banned_devices/${z}`);
    assert.ok(dev && dev.userId === r1.uid && !dev.banners[r2.uid]);
    await sanction(adminU, { action: 'unban', targetUid: r1.uid });
    assert.strictEqual(await val(`banned_devices/${z}`), null);
  });

  await test('F5/F6 evasion auto-ban + transitive unban cascade', async () => {
    const s = await mkUser('Evader');
    const e1 = fp16();
    const e2 = fp16();
    await indexDevice(s.uid, e1);
    await sanction(mod, { action: 'strike', targetUid: s.uid, strikeCount: 3, reason: 'x' });
    const n1 = await mkUser('AltOne');
    await indexDevice(n1.uid, e2);
    await db.ref(`users_private/${n1.uid}/deviceId`).set(e1);
    const b1 = await waitFor(() => activeBan(n1.uid), 'alt 1 auto-banned');
    assert.strictEqual(b1.linkedFrom, s.uid); assert.strictEqual(b1.source, 'device');
    await waitFor(() => val(`banned_devices/${e2}/banners/${n1.uid}`), 'alt 1 device banned');
    const n2 = await mkUser('AltTwo');
    await db.ref(`users_private/${n2.uid}/deviceId`).set(e2);
    const b2 = await waitFor(() => activeBan(n2.uid), 'alt 2 auto-banned');
    assert.strictEqual(b2.linkedFrom, n1.uid);
    const u = await sanction(adminU, { action: 'unban', targetUid: s.uid });
    assert.strictEqual(u.body.linkedLifted, 2, JSON.stringify(u.body));
    assert.strictEqual(await val(`banned_uids/${n1.uid}`), null);
    assert.strictEqual(await val(`banned_uids/${n2.uid}`), null);
    assert.strictEqual(await val(`banned_devices/${e1}`), null);
    assert.strictEqual(await val(`banned_devices/${e2}`), null);
  });

  console.log('\n# accounts');
  await test('F7 unban of a deleted account also removes its email record', async () => {
    const t = await mkUser('DelUnban');
    const k = ekey(t.email);
    await sanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 2, reason: 'x' });
    assert.ok(await val(`banned_users_by_email/${k}`));
    await admin.auth().deleteUser(t.uid);
    await db.ref().update({ [`users_private/${t.uid}`]: null, [`users/${t.uid}`]: null });
    await waitFor(() => val(`deleted_accounts/${t.uid}`), 'tombstone');
    const r = await sanction(adminU, { action: 'unban', targetUid: t.uid });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(await val(`banned_users_by_email/${k}`), null);
    assert.strictEqual(await val(`banned_uids/${t.uid}`), null);
  });

  await test('F9 perm-ban-all honors linkedUids and skips staff; linked lists isStaff', async () => {
    const t = await mkUser('LinkT');
    const dl = fp16();
    await indexDevice(t.uid, dl);
    const a1 = await mkUser('LinkA1');
    const a2 = await mkUser('LinkA2', { role: 'isModerator' });
    const a3 = await mkUser('LinkA3');
    for (const u of [a1, a2, a3]) await indexDevice(u.uid, dl);
    const l = await sanction(owner, { action: 'linked', targetUid: t.uid });
    assert.strictEqual(l.status, 200);
    const byUid = Object.fromEntries(l.body.linked.map((x) => [x.uid, x]));
    assert.strictEqual(byUid[a2.uid].isStaff, true); assert.strictEqual(byUid[a1.uid].isStaff, false);
    assert.strictEqual(byUid[a1.uid].banned, false);
    const r = await sanction(owner, {
      action: 'strike', targetUid: t.uid, strikeCount: 3, reason: 'alts', includeLinked: true,
      linkedUids: [a1.uid, a2.uid, granter.uid],
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const st = Object.fromEntries(r.body.linkedResults.map((x) => [x.uid, x.status]));
    assert.strictEqual(st[a1.uid], 'banned'); assert.strictEqual(st[a2.uid], 'staff'); assert.strictEqual(st[granter.uid], 'not_linked');
    assert.strictEqual((await activeBan(a1.uid)).linkedFrom, t.uid);
    assert.strictEqual(await val(`banned_uids/${a2.uid}`), null);
    assert.strictEqual(await val(`banned_uids/${a3.uid}`), null);
  });

  await test('F11 phone re-registration is re-banned (tombstone phone hash)', async () => {
    const phone = `+1555${String(Date.now()).slice(-7)}`;
    const p = await mkUser('PhoneP', { noEmail: true, phone });
    const r = await sanction(owner, { action: 'strike', targetUid: p.uid, strikeCount: 3, reason: 'x' });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.hasEmail, false);
    await admin.auth().deleteUser(p.uid);
    await waitFor(() => val(`banned_phone_hashes/${BE.hashPhone(phone)}`), 'phone hash');
    assert.strictEqual((await val(`deleted_accounts/${p.uid}`)).phoneHash, BE.hashPhone(phone));
    const again = await admin.auth().createUser({ phoneNumber: phone });
    const b = await waitFor(() => activeBan(again.uid), 'phone re-ban');
    assert.strictEqual(b.source, 'phone_hash'); assert.strictEqual(b.linkedFrom, p.uid);
  });

  await test('previous + F11: re-registered banned email; email hash written at deletion', async () => {
    const t = await mkUser('ReReg');
    await userWrite(mod, `banned_users_by_email/${ekey(t.email)}`, strikeRec(mod, t, 3));
    await waitFor(() => activeBan(t.uid), 'applied');
    await admin.auth().deleteUser(t.uid);
    await waitFor(() => val(`banned_email_hashes/${BE.hashEmail(t.email)}`), 'email hash');
    const again = await admin.auth().createUser({ email: t.email, password: 'test-pass-123' });
    const b = await waitFor(() => activeBan(again.uid), 're-ban');
    assert.strictEqual(b.source, 'email'); assert.strictEqual(b.linkedFrom, t.uid);
  });

  await test('F11 sign-up check ignores a record about the new account itself (late-trigger race)', async () => {
    const u = await mkUser('LateSignup');
    const k = ekey(u.email);
    // What a late banCheckOnSignup can see: a Mod's raw permanent strike on
    // THIS account that syncEmailBan has not converted yet (managedBy keeps
    // syncEmailBan itself out of this case).
    await db.ref(`banned_users_by_email/${k}`).set({ ...strikeRec(mod, u, 3), managedBy: 'server' });
    assert.strictEqual(await BE.onSignup(await admin.auth().getUser(u.uid)), null);
    assert.strictEqual(await val(`banned_uids/${u.uid}`), null);
    // A record an EARLIER account with this email left behind is still a re-ban.
    await db.ref(`banned_users_by_email/${k}`).set({ ...strikeRec(mod, u, 2), userId: 'oldAccount0000000001', managedBy: 'server' });
    const again = await BE.onSignup(await admin.auth().getUser(u.uid));
    assert.strictEqual(again.applied, true, JSON.stringify(again));
    const b = await val(`banned_uids/${u.uid}`);
    assert.strictEqual(b.source, 'email'); assert.strictEqual(b.linkedFrom, 'oldAccount0000000001');
  });

  await test('previous: legacy public deviceId moved to users_private and indexed', async () => {
    const t = await mkUser('LegacyDev');
    const android = fp16();
    await db.ref(`users/${t.uid}/deviceId`).set(android);
    await waitFor(async () => (await val(`users_private/${t.uid}/deviceId`)) === android, 'moved');
    assert.strictEqual(await val(`users/${t.uid}/deviceId`), null);
    await waitFor(() => val(`account_devices/${t.uid}/${android}`), 'indexed');
  });

  await test('F16 legacy mixed-case key → canonical emailKey', async () => {
    const t = await mkUser('Mixed', { email: `mixed.case.${RUN}@example.com` });
    const raw = `Mixed(dot)Case(dot)${RUN}@Example(dot)com`;
    await userWrite(mod, `banned_users_by_email/${raw}`, strikeRec(mod, t, 1));
    const b = await waitFor(() => activeBan(t.uid), 'applied');
    assert.strictEqual(b.emailKey, ekey(t.email));
    await userDelete(mod, `banned_users_by_email/${raw}`);
    await waitFor(async () => (await val(`banned_uids/${t.uid}`)) === null, 'lifted');
  });

  console.log('\n# old-build replays (≤ 4.0.14)');
  await test('OLD setUserStrike + mirrorBanToDevice + unbanUserWithEmail (mod, raw key)', async () => {
    const t = await mkUser('OldStrike', { email: `Old.Strike.${RUN}@Example.com` });
    const rawKey = t.email.replace(/\./g, '(dot)'); // old builds don't lowercase here
    const fp = fp16();
    await indexDevice(t.uid, fp);
    const payload = strikeRec(mod, t, 2);
    payload.bannedBy.role = 'Admin';
    await userWrite(mod, `banned_users_by_email/${rawKey}`, payload);
    await userWrite(mod, `banned_devices/${fp}`, { bannedUntil: payload.bannedUntil, bannedAt: payload.bannedAt, bannedBy: payload.bannedBy, reason: payload.reason, strikeCount: 2, email: t.email, userId: t.uid });
    await userWrite(mod, `banned_users_by_email/${rawKey}`, { deviceId: fp, deviceIds: [fp] }, 'PATCH');
    const b = await waitFor(() => activeBan(t.uid), 'applied');
    assert.strictEqual(b.type, 'ban');
    await waitFor(async () => (await val(`banned_devices/${fp}`))?.banners, 'device under server');
    await userDelete(mod, `banned_users_by_email/${rawKey}`);
    await userWrite(mod, `banned_devices/${fp}`, null, 'DELETE');
    await waitFor(async () => (await val(`banned_uids/${t.uid}`)) === null, 'lifted');
    assert.strictEqual(await val(`banned_devices/${fp}`), null);
  });

  await test('OLD banUserwithEmail (userId null) escalation applied', async () => {
    const t = await mkUser('OldBan');
    const k = t.email.replace(/\./g, '(dot)');
    const p1 = strikeRec(mod, t, 1); p1.userId = null; p1.bannedUntil = Date.now() + 24 * HOUR;
    await userWrite(mod, `banned_users_by_email/${k}`, p1);
    await waitFor(async () => (await activeBan(t.uid))?.strikeCount === 1, 'strike 1');
    const p2 = strikeRec(mod, t, 2); p2.userId = null;
    await userWrite(mod, `banned_users_by_email/${k}`, p2);
    await waitFor(async () => (await activeBan(t.uid))?.strikeCount === 2, 'strike 2');
  });

  await test('OLD muteUser by JMD with custom reason (string bannedBy) → mute; mod unbans', async () => {
    const t = await mkUser('OldMute');
    const k = ekey(t.email);
    await userWrite(jmd, `banned_users_by_email/${k}`, muteRec(jmd, t, 60, { reason: 'stop spamming' }));
    const b = await waitFor(() => activeBan(t.uid), 'mute applied');
    assert.strictEqual(b.type, 'mute');
    await userDelete(mod, `banned_users_by_email/${k}`);
    await waitFor(async () => (await val(`banned_uids/${t.uid}`)) === null, 'lifted');
  });

  await test('OLD modSanction calls without reason/evidence/linkedUids', async () => {
    const t = await mkUser('OldApi');
    const s = await sanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 1 });
    assert.strictEqual(s.status, 200, JSON.stringify(s.body));
    for (const f of ['accountExists', 'accountDeleted', 'hasEmail', 'devices', 'linkedBanned']) assert.ok(f in s.body, f);
    assert.strictEqual((await val(`banned_uids/${t.uid}`)).reason, 'Strike 1');
    const t2 = await mkUser('OldApi2');
    const m = await sanction(mod, { action: 'mute', targetUid: t2.uid, minutes: 15 });
    assert.strictEqual(m.status, 200, JSON.stringify(m.body));
    assert.strictEqual((await val(`banned_uids/${t2.uid}`)).reason, 'Muted for 15 min');
    assert.strictEqual((await sanction(mod, { action: 'unban', targetUid: t2.uid })).status, 200);
    const t3 = await mkUser('OldApi3');
    const dl = fp16();
    await indexDevice(t3.uid, dl);
    const alt = await mkUser('OldApiAlt');
    await indexDevice(alt.uid, dl);
    const l = await sanction(mod, { action: 'linked', targetUid: t3.uid });
    assert.strictEqual(l.status, 200);
    for (const f of ['uid', 'displayName', 'exists', 'banned']) assert.ok(f in l.body.linked[0], f);
    assert.ok('linkedTotal' in l.body);
    const all = await sanction(mod, { action: 'strike', targetUid: t3.uid, strikeCount: 3, includeLinked: true, reason: 'Ban evasion (linked accounts)' });
    assert.strictEqual(all.status, 200); assert.strictEqual(all.body.linkedBanned, 1);
  });

  await test('OLD iOS UUID / Android hex ids accepted by indexing', async () => {
    const t = await mkUser('IdFormats');
    const ios = 'A1B2C3D4-E5F6-4711-8899-AABBCCDDEEFF';
    await db.ref(`users_private/${t.uid}/deviceId`).set(ios);
    await waitFor(() => val(`account_devices/${t.uid}/${ios}`), 'ios indexed');
  });

  console.log('\n# in-process: Supabase optional, audit log, reconcile, backfill');
  await test('Supabase absent: core still works and log calls return false', async () => {
    BE.setSupabaseForTest(undefined);
    const t = await mkUser('NoSb');
    const r = await BE.applyBan(t.uid, { type: 'mute', bannedUntil: Date.now() + 60000, reason: 'x', bannedByUid: mod.uid });
    assert.strictEqual(r.applied, true);
    assert.strictEqual(await BE.logModAction({ action: 'mute' }), false);
    await BE.liftBan(t.uid);
  });

  await test('F14/F15 audit rows: evidence/details, column fallback, unmute fallback, no log when kept', async () => {
    const sb = makeFakeSupabase();
    BE.setSupabaseForTest(sb);
    const t = await mkUser('LogRows');
    const s = await inProcessSanction(mod, { action: 'strike', targetUid: t.uid, strikeCount: 1, reason: 'scam', evidence: ['https://e.example/1.png'] });
    assert.strictEqual(s.statusCode, 200, JSON.stringify(s.body));
    const row = sb.modActions.find((x) => x.target_uid === t.uid && x.action === 'strike');
    assert.deepStrictEqual(row.evidence, ['https://e.example/1.png']); assert.strictEqual(row.reason, 'scam');
    assert.ok(sb.senders.has(t.uid));
    const lg = await inProcessSanction(mod, { action: 'log', targetUid: t.uid, logAction: 'role_change', details: { to: 'jmd' } });
    assert.strictEqual(lg.body.logged, true);
    assert.deepStrictEqual(sb.modActions.at(-1).details, { to: 'jmd' });
    const un = await inProcessSanction(adminU, { action: 'unban', targetUid: t.uid, reason: 'ok' });
    assert.strictEqual(un.statusCode, 200);
    assert.strictEqual(sb.modActions.at(-1).action, 'unban');
    assert.ok(!sb.senders.has(t.uid));

    const old = makeFakeSupabase({ noNewColumns: true, oldActionCheck: true });
    BE.setSupabaseForTest(old);
    const t2 = await mkUser('LogRows2');
    await inProcessSanction(mod, { action: 'mute', targetUid: t2.uid, minutes: 5, reason: 'x', evidence: ['https://e.example/2.png'] });
    assert.ok(old.modActions.find((x) => x.target_uid === t2.uid && x.action === 'mute' && !('evidence' in x)));
    await inProcessSanction(mod, { action: 'unmute', targetUid: t2.uid });
    assert.strictEqual(old.modActions.at(-1).action, 'unban');

    // A softer email strike over a stricter uid ban: kept, and NOT logged.
    const fresh = makeFakeSupabase();
    BE.setSupabaseForTest(fresh);
    const t3 = await mkUser('KeptT');
    await BE.applyBan(t3.uid, { type: 'ban', bannedUntil: 'permanent', reason: 'linked', source: 'linked' }, null, { disableAuth: false });
    const k3 = ekey(t3.email);
    const rec = { ...strikeRec(mod, t3, 1), managedBy: 'server' };
    await db.ref(`banned_users_by_email/${k3}`).set(rec);
    const snap = (v) => ({ val: () => v, exists: () => v !== null });
    await BE.handleEmailBanWrite({ before: snap(null), after: snap({ ...rec, managedBy: undefined }) },
      { params: { emailKey: k3 }, authType: 'USER', auth: { uid: mod.uid, token: {} } });
    assert.strictEqual((await val(`banned_uids/${t3.uid}`)).bannedUntil, 'permanent');
    assert.strictEqual(fresh.modActions.filter((x) => x.target_uid === t3.uid).length, 0);
    BE.setSupabaseForTest(undefined);
  });

  await test('F12 reconcile: Supabase + Firestore mirrors repaired (dry run first)', async () => {
    const sb = makeFakeSupabase();
    BE.setSupabaseForTest(sb);
    const banned = await mkUser('RecBan');
    const muted = await mkUser('RecMute');
    await db.ref(`banned_uids/${banned.uid}`).set({ type: 'ban', bannedUntil: 'permanent', reason: 'x' });
    await db.ref(`banned_uids/${muted.uid}`).set({ type: 'mute', bannedUntil: Date.now() + HOUR, reason: 'Muted for 60 min' });
    sb.senders.set('staleUid0000000000', { uid: 'staleUid0000000000', banned_until: null });
    await fsdb.collection('banned_uids').doc('staleUid0000000000').set({ type: 'ban', permanent: true, until: null });
    await fsdb.collection('banned_uids').doc(muted.uid).set({ type: 'ban', permanent: true, until: null });
    const dry = await BE.reconcileBans({ dryRun: true, pageSize: 7 });
    assert.ok(dry.supabase.upserted >= 2 && dry.supabase.deleted >= 1, JSON.stringify(dry));
    assert.ok(sb.senders.has('staleUid0000000000'));
    const st = await BE.reconcileBans({ pageSize: 7 });
    assert.ok(st.firestore.deleted >= 2, JSON.stringify(st));
    assert.ok(sb.senders.has(banned.uid) && sb.senders.get(banned.uid).banned_until === null);
    assert.ok(sb.senders.has(muted.uid));
    assert.ok(!sb.senders.has('staleUid0000000000'));
    assert.strictEqual((await fsDoc('staleUid0000000000')).exists, false);
    assert.strictEqual((await fsDoc(muted.uid)).exists, false);
    assert.strictEqual((await fsDoc(banned.uid)).data().permanent, true);
    const again = await BE.reconcileBans({ pageSize: 7 });
    assert.strictEqual(again.supabase.upserted + again.supabase.deleted + again.firestore.written + again.firestore.deleted, 0, JSON.stringify(again));
    BE.setSupabaseForTest(undefined);
  });

  await test('F13/F15 backfill script: dry run, skips staff / bad userId, --mirrors', async () => {
    const run = (args) => new Promise((resolve) => {
      execFile(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'backfill-ban-enforcement.js'), ...args],
        { env: { ...process.env, FIREBASE_DATABASE_EMULATOR_HOST: DB_HOST, GCLOUD_PROJECT: PROJECT, RTDB_NAMESPACE: NS }, timeout: 240000 },
        (err, stdout, stderr) => resolve({ code: err ? err.code || 1 : 0, out: stdout + stderr }));
    });
    const staffT = await mkUser('BfStaff', { role: 'isModerator' });
    await db.ref(`banned_users_by_email/${ekey(staffT.email)}`).set({ ...strikeRec(owner, staffT, 1), managedBy: 'server' });
    const badT = await mkUser('BfBad');
    await db.ref(`banned_users_by_email/${ekey(badT.email)}`).set({ ...strikeRec(mod, badT, 1), userId: 'not a uid', managedBy: 'server' });
    const lost = await mkUser('BfLost');
    await db.ref(`banned_uids/${lost.uid}`).set({ type: 'ban', bannedUntil: 'permanent', reason: 'x' });
    const dry = await run([]);
    assert.strictEqual(dry.code, 0, dry.out); assert.ok(/DRY RUN/.test(dry.out), dry.out);
    assert.ok(/"badUserId":[1-9]/.test(dry.out), dry.out);
    const w = await run(['--write']);
    assert.strictEqual(w.code, 0, w.out);
    assert.ok(/"skippedStaff":[1-9]/.test(w.out), w.out);
    assert.strictEqual(await val(`banned_uids/${staffT.uid}`), null);
    assert.ok(await activeBan(badT.uid), 'bad userId resolved by email');
    await fsdb.collection('banned_uids').doc(lost.uid).delete();
    const md = await run(['--mirrors']);
    assert.strictEqual(md.code, 0, md.out); assert.ok(/DRY RUN/.test(md.out));
    assert.strictEqual((await fsDoc(lost.uid)).exists, false);
    const mw = await run(['--mirrors', '--write']);
    assert.strictEqual(mw.code, 0, mw.out);
    assert.strictEqual((await fsDoc(lost.uid)).data().permanent, true);
  });

  // ── modEvidenceUpload (Bunny stubbed: no real storage is touched) ──
  await test('evidence upload: staff only, real images only, stored under mod-evidence/', async () => {
    const EV = require('../modEvidenceUpload')._internal;
    const upload = async (u, body) => {
      const res = fakeRes();
      await EV.handleUpload({ method: 'POST', headers: { authorization: `Bearer ${await tokenFor(u)}` }, body }, res);
      return res;
    };
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]).toString('base64');
    const realFetch = global.fetch;
    const puts = [];
    global.fetch = async (url, init) => {
      if (!String(url).includes('storage.bunnycdn.com')) return realFetch(url, init);
      puts.push({ url, init });
      return { ok: true, status: 201 };
    };
    process.env.BUNNY_STORAGE_KEY = 'test-key';
    try {
      const plain = await mkUser('EvidencePlain');
      const r1 = await upload(plain, { data: jpeg, contentType: 'image/jpeg' });
      assert.strictEqual(r1.statusCode, 403); assert.strictEqual(r1.body.error, 'not_staff');
      const r2 = await upload(mod, { data: Buffer.from('not an image at all').toString('base64'), contentType: 'image/jpeg' });
      assert.strictEqual(r2.body.error, 'bad_image');
      const r3 = await upload(mod, { data: jpeg, contentType: 'image/gif' });
      assert.strictEqual(r3.body.error, 'bad_image');
      const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(EV.MAX_BYTES + 10)]).toString('base64');
      const r4 = await upload(mod, { data: big, contentType: 'image/jpeg' });
      assert.ok(['too_large', 'bad_image'].includes(r4.body.error), JSON.stringify(r4.body));
      assert.strictEqual(puts.length, 0, 'nothing uploaded for refused requests');
      const r5 = await upload(mod, { data: jpeg, contentType: 'image/jpeg' });
      assert.strictEqual(r5.statusCode, 200, JSON.stringify(r5.body));
      assert.ok(r5.body.url.startsWith(`https://pull-gag.b-cdn.net/mod-evidence/${mod.uid}/`));
      assert.strictEqual(puts.length, 1);
      assert.strictEqual(puts[0].init.headers.AccessKey, 'test-key');
      const noAuth = fakeRes();
      await EV.handleUpload({ method: 'POST', headers: {}, body: { data: jpeg, contentType: 'image/jpeg' } }, noAuth);
      assert.strictEqual(noAuth.statusCode, 401);
    } finally {
      global.fetch = realFetch;
      delete process.env.BUNNY_STORAGE_KEY;
    }
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
