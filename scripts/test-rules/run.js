/**
 * Security-rules tests for firestore.rules + database.rules.json.
 *
 * Run from the repo root (needs Java 17 + firebase-tools; demo project only):
 *   firebase emulators:exec --only firestore,database --project demo-fruiteblocks 'node scripts/test-rules/run.js'
 *
 * Every legitimate flow is replayed with the exact shape the app writes —
 * current build AND the old builds still in the field (4.0.12 = 59bead7,
 * 4.0.10 = 60bc59a, pre-Supabase May 2026 = 682e16d, Mar 2026 = 185c622,
 * Oct 2025 = 6e55f3a) and blox-web. Each `ok(...)` must succeed, each
 * `no(...)` (abuse) must be denied. See INVENTORY.md for the source lines.
 */
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment, assertSucceeds, assertFails,
} = require('@firebase/rules-unit-testing');
const F = require('firebase/firestore');
const D = require('firebase/database');

const ROOT = path.join(__dirname, '..', '..');
const PROJECT = 'demo-fruiteblocks';

// ── actors ──
const A = 'adminUid0001';     // RTDB isAdmin + staff mirror
const A2 = 'adminUid0002';    // second admin (target for "admin vs admin")
const O = 'ownerUid00001';    // verified owner email, no RTDB flag
const OU = 'ownerUnverif1';   // owner email, NOT verified
const S = 'seniorUid0001';
const M = 'modUid0000001';
const M2 = 'modUid0000002';
const J = 'jmdUid0000001';
const J2 = 'jmdUid0000002';
const G = 'granterUid001';    // jmd_granters/{G} = true, no staff role
const U1 = 'userUid000001';
const U2 = 'userUid000002';
const U3 = 'userUid000003';
const B = 'bannedUid0001';    // Firestore banned_uids/{B} permanent
const BT = 'bannedTmp0001';   // temporary ban, still active
const BX = 'bannedOld0001';   // expired ban → not banned

const EMAIL = {
  [A]: 'admin@example.com', [A2]: 'admin2@example.com', [O]: 'thesolanalabs@gmail.com', [OU]: 'sohailnasir74@gmail.com',
  [S]: 'senior@example.com', [M]: 'mod@example.com', [M2]: 'mod2@example.com', [J]: 'jmd@example.com', [J2]: 'jmd2@example.com',
  [G]: 'granter@example.com', [U1]: 'user.one@example.com', [U2]: 'User.Two@Example.com', [U3]: 'user3@example.com',
  [B]: 'banned@example.com', [BT]: 'bannedtmp@example.com', [BX]: 'bannedold@example.com',
};
const key = (email) => email.replace(/\./g, '(dot)');           // GlobelStats / old builds (raw case)
const keyLc = (email) => email.toLowerCase().trim().replace(/\./g, '(dot)');

let env;
const ctxCache = new Map();
const ctxOf = (uid) => {
  const k = uid || '__guest__';
  if (!ctxCache.has(k)) {
    const ctx = uid ? env.authenticatedContext(uid, { email: EMAIL[uid], email_verified: uid !== OU }) : env.unauthenticatedContext();
    ctxCache.set(k, { fs: ctx.firestore(), db: ctx.database() });
  }
  return ctxCache.get(k);
};
const fsOf = (uid) => ctxOf(uid).fs;
const dbOf = (uid) => ctxOf(uid).db;

// ── tiny runner ──
const results = { pass: 0, fail: 0, failures: [] };
let section = '';
async function check(kind, name, fn) {
  const label = `[${section}] ${kind === 'ok' ? 'ALLOW' : 'DENY '} ${name}`;
  try {
    if (kind === 'ok') await assertSucceeds(fn());
    else await assertFails(fn());
    results.pass++;
  } catch (e) {
    results.fail++;
    results.failures.push(`${label}\n      ${String(e && e.message || e).split('\n')[0]}`);
  }
}
const ok = (name, fn) => check('ok', name, fn);
const no = (name, fn) => check('no', name, fn);
const sec = (s) => { section = s; };

async function seed(fn) { await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore(), ctx.database())); }

const now = () => Date.now();
const H = 60 * 60 * 1000;

// ───────────────────────────── RTDB ─────────────────────────────
async function rtdbTests() {
  const r = (uid, p) => D.ref(dbOf(uid), p);

  await seed(async (_f, db) => {
    const u = (uid, extra = {}) => D.set(D.ref(db, `users/${uid}`), { displayName: `n_${uid}`, createdAt: 1700000000000, ...extra });
    await u(A, { isAdmin: true }); await u(A2, { admin: true }); await u(S, { isSeniorMod: true });
    await u(M, { isModerator: true }); await u(M2, { isModerator: true });
    await u(J, { isBabyMod: true }); await u(J2, { isBabyMod: true });
    await u(G); await u(U1); await u(U3); await u(B); await u(O, { isAdmin: true });
    await D.set(D.ref(db, `users/${U2}`), { displayName: 'two' }); // no createdAt
    await D.set(D.ref(db, `jmd_granters/${G}`), true);
    await D.set(D.ref(db, `private_messages/${U1}_${U2}/messages/1`), { text: 'old', senderId: U1 });
    await D.set(D.ref(db, 'api'), { key: 'x' });
    await D.set(D.ref(db, `mod_votes_summary/${M}`), { ups: 3, downs: 1 });
    await D.set(D.ref(db, `banned_devices/devA123456`), { bannedUntil: 'permanent', userId: U3, bannedBy: { uid: A } });
    // Server-managed (has a banners set): app writes must not touch it.
    await D.set(D.ref(db, `banned_devices/devS123456`), { bannedUntil: 'permanent', userId: U2, bannedBy: { uid: A }, banners: { [U2]: true } });
  });

  sec('rtdb users');
  // GlobelStats new-user record (createNewUser, no roles) and display-name heal.
  await ok('new user creates own record (createNewUser)', () => D.set(r(U3, `users/${U3}`), { displayName: 'three', createdAt: now(), isPro: false, rewardPoints: 0, isBlock: false }));
  await no('new record with isAdmin', () => D.set(r(U3, `users/${U3}`), { displayName: 'three', isAdmin: true }));
  await ok('U1 updates own displayName', () => D.update(r(U1, `users/${U1}`), { displayName: 'healed' }));
  await ok('U1 own xp/shop/dailyStars', () => D.update(r(U1, `users/${U1}/xp`), { total: D.increment(5) }));
  await ok('U1 own fruitCrash multi-path', () => D.update(D.ref(dbOf(U1)), { [`fruitCrash/cashouts/${U1}`]: { name: 'x', multiplier: 2, cashedAt: now() }, [`users/${U1}/fruitCrash/totalRounds`]: 3 }));
  await ok('U1 own deviceId (old builds)', () => D.set(r(U1, `users/${U1}/deviceId`), 'abcdef123456'));
  await no('U1 deviceId of U2', () => D.set(r(U1, `users/${U2}/deviceId`), 'abcdef123456'));
  await no('U1 grants self isAdmin', () => D.update(r(U1, `users/${U1}`), { isAdmin: true }));
  await no('U1 grants self isMod (legacy flag)', () => D.update(r(U1, `users/${U1}`), { isMod: true }));
  await no('U1 grants self owner', () => D.update(r(U1, `users/${U1}`), { owner: true }));
  await no('U1 grants self isTrusted', () => D.set(r(U1, `users/${U1}/isTrusted`), true));
  await no('U1 writes U2 displayName', () => D.set(r(U1, `users/${U2}/displayName`), 'pwned'));
  await no('U1 writes U2 avatar', () => D.update(r(U1, `users/${U2}`), { avatar: 'x' }));
  await no('U1 writes U2 rewardPoints', () => D.set(r(U1, `users/${U2}/rewardPoints`), 999));
  await no('guest writes U2 field', () => D.set(r(null, `users/${U2}/displayName`), 'x'));
  await ok('U1 awards U2 influencer badge (follow)', () => D.set(r(U1, `users/${U2}/badges/influencer`), true));
  await ok('U1 awards U2 fiveStar badge (review)', () => D.set(r(U1, `users/${U2}/badges/fiveStar`), true));
  await no('U1 removes U2 badge', () => D.set(r(U1, `users/${U2}/badges/influencer`), null));
  await ok('U1 bumps U2 reactionCount +1', () => D.set(r(U1, `users/${U2}/counters/reactionCount`), D.increment(1)));
  await ok('U1 bumps U2 reactionCount +1 again', () => D.set(r(U1, `users/${U2}/counters/reactionCount`), D.increment(1)));
  await no('U1 sets U2 counter to 500', () => D.set(r(U1, `users/${U2}/counters/reactionCount`), 500));
  await ok('profile drawer back-fills missing createdAt', () => D.set(r(U1, `users/${U2}/createdAt`), now()));
  await no('createdAt overwrite', () => D.set(r(U1, `users/${U2}/createdAt`), now()));
  await no('createdAt ghost record', () => D.set(r(U1, `users/ghostUid000001/createdAt`), now()));
  // Role grants (utils.js makeX + BottomDrawer badges), with rolesUpdatedAt stamp.
  await ok('admin makes U1 senior', () => D.update(r(A, `users/${U1}`), { isSeniorMod: true, rolesUpdatedAt: now() }));
  await ok('admin removes U1 senior', () => D.update(r(A, `users/${U1}`), { isSeniorMod: false, rolesUpdatedAt: now() }));
  await ok('verified owner self-flag isAdmin (GlobelStats)', () => D.update(r(O, `users/${O}`), { isAdmin: true }));
  await no('UNVERIFIED owner email grants senior', () => D.update(r(OU, `users/${U1}`), { isSeniorMod: true, rolesUpdatedAt: now() }));
  await no('UNVERIFIED owner email self isAdmin', () => D.set(r(OU, `users/${OU}/isAdmin`), true));
  await ok('verified owner grants senior', () => D.update(r(O, `users/${U3}`), { isSeniorMod: true, rolesUpdatedAt: now() }));
  await D.set(D.ref(dbOf(O), `users/${U3}/isSeniorMod`), false);
  await no('admin makes other admin admin=false', () => D.update(r(A, `users/${A2}`), { admin: false }));
  await ok('senior makes U1 moderator', () => D.update(r(S, `users/${U1}`), { isModerator: true, rolesUpdatedAt: now() }));
  await ok('senior removes U1 moderator', () => D.update(r(S, `users/${U1}`), { isModerator: false, rolesUpdatedAt: now() }));
  await no('mod makes U1 moderator', () => D.update(r(M, `users/${U1}`), { isModerator: true, rolesUpdatedAt: now() }));
  await ok('mod makes U1 JMD', () => D.update(r(M, `users/${U1}`), { isBabyMod: true, rolesUpdatedAt: now() }));
  await ok('mod removes U1 JMD', () => D.update(r(M, `users/${U1}`), { isBabyMod: null, rolesUpdatedAt: now() }));
  await no('mod removes mod2 JMD flag', () => D.update(r(M, `users/${M2}`), { isBabyMod: null, rolesUpdatedAt: now() }));
  await no('JMD makes U1 JMD', () => D.update(r(J, `users/${U1}`), { isBabyMod: true, rolesUpdatedAt: now() }));
  await ok('JMD granter makes U1 JMD', () => D.update(r(G, `users/${U1}`), { isBabyMod: true, rolesUpdatedAt: now() }));
  await ok('JMD granter removes U1 JMD', () => D.update(r(G, `users/${U1}`), { isBabyMod: null, rolesUpdatedAt: now() }));
  await no('JMD granter makes self JMD', () => D.update(r(G, `users/${G}`), { isBabyMod: true, rolesUpdatedAt: now() }));
  await no('JMD granter touches a mod', () => D.update(r(G, `users/${M}`), { isBabyMod: null, rolesUpdatedAt: now() }));
  await ok('mod grants U1 trusted (update)', () => D.update(r(M, `users/${U1}`), { isTrusted: true, rolesUpdatedAt: now() }));
  await ok('mod grants U1 grinder (old set)', () => D.set(r(M, `users/${U1}/isGrinder`), true));
  await ok('mod grants U1 raider', () => D.update(r(M, `users/${U1}`), { isRaider: null, rolesUpdatedAt: now() }));
  await no('JMD grants trusted', () => D.update(r(J, `users/${U1}`), { isTrusted: true, rolesUpdatedAt: now() }));
  await no('U1 stamps rolesUpdatedAt on U2', () => D.set(r(U1, `users/${U2}/rolesUpdatedAt`), now()));
  await ok('admin deletes U3 profile (Delete Profile)', () => D.remove(r(A, `users/${U3}`)));
  await no('mod deletes a profile', () => D.remove(r(M, `users/${U1}`)));
  await no('admin deletes another admin profile', () => D.remove(r(A, `users/${A2}`)));
  await ok('user deletes own account', () => D.remove(r(U3, `users/${U3}`)));
  await ok('users_private own deviceId', () => D.update(r(U1, `users_private/${U1}`), { deviceId: 'dev_U1_abcdef' }));
  await ok('_serverTime probe', () => D.set(r(U1, `_serverTime/${U1}`), D.serverTimestamp()));
  await ok('presence own', () => D.set(r(U1, `presence/${U1}`), true));
  await no('presence other', () => D.set(r(U1, `presence/${U2}`), false));
  await ok('admin clears presence on delete', () => D.remove(r(A, `presence/${U2}`)));
  await ok('guest reads a user profile', () => D.get(r(null, `users/${U1}/displayName`)));

  sec('rtdb jmd_granters');
  await ok('admin adds granter', () => D.set(r(A, `jmd_granters/${U1}`), true));
  await ok('owner removes granter', () => D.set(r(O, `jmd_granters/${U1}`), null));
  await no('mod adds granter', () => D.set(r(M, `jmd_granters/${U1}`), true));
  await no('granter adds another', () => D.set(r(G, `jmd_granters/${U1}`), true));
  await no('admin writes non-true', () => D.set(r(A, `jmd_granters/${U1}`), 'yes'));
  await ok('granter reads own entry', () => D.get(r(G, `jmd_granters/${G}`)));
  await no('user lists granters', () => D.get(r(U1, 'jmd_granters')));
  await ok('admin lists granters', () => D.get(r(A, 'jmd_granters')));

  sec('rtdb banned_users_by_email');
  const by = (uid, role = 'Moderator') => ({ uid, displayName: 'mod', avatar: null, role });
  // setUserStrike / banUserwithEmail shape (current + 4.0.12 + Mar 2026).
  const strike = (uid, target, n, until, extra = {}) => ({
    strikeCount: n, bannedUntil: until, reason: `Strike ${n}`, email: EMAIL[target], displayName: 'x', avatar: null,
    userId: target, bannedAt: now(), bannedBy: by(uid), ...extra,
  });
  // muteUser shape (bannedBy = uid string).
  const mute = (uid, target, min, reason, strikeCount = 0) => ({
    strikeCount, bannedUntil: now() + min * 60000, reason: reason || `Muted for ${min} min`, bannedAt: now(),
    userId: target, displayName: 'x', avatar: null, email: EMAIL[target], bannedBy: uid, bannerAvatar: null,
  });
  const E = (uid) => `banned_users_by_email/${key(EMAIL[uid])}`;
  await ok('mod strike 1 on user', () => D.set(r(M, E(U2)), strike(M, U2, 1, now() + 3 * H)));
  await ok('mod tags record with deviceIds (mirrorBanToDevice)', () => D.update(r(M, E(U2)), { deviceId: 'devU2abcdef', deviceIds: ['devU2abcdef'] }));
  await ok('mod mirrors to banned_devices', () => D.set(r(M, 'banned_devices/devU2abcdef'), { bannedUntil: now() + 3 * H, bannedAt: now(), bannedBy: by(M), reason: 'Strike 1', strikeCount: 1, email: EMAIL[U2], userId: U2 }));
  await ok('mod2 escalates to strike 2', () => D.set(r(M2, E(U2)), strike(M2, U2, 2, now() + 72 * H)));
  await no('mod forges bannedBy (admin uid)', () => D.set(r(M, E(U1)), strike(A, U1, 1, now() + 3 * H)));
  await no('mod with no bannedBy uid (null)', () => D.set(r(M, E(U1)), strike(null, U1, 1, now() + 3 * H)));
  await no('mod strikes a JMD (staff immunity)', () => D.set(r(M, E(J)), strike(M, J, 1, now() + 3 * H)));
  await no('senior strikes a mod (staff immunity)', () => D.set(r(S, E(M)), strike(S, M, 1, now() + 3 * H)));
  await ok('admin strikes a JMD', () => D.set(r(A, E(J2)), strike(A, J2, 1, now() + 3 * H)));
  await no('admin strikes another admin', () => D.set(r(A, E(A2)), strike(A, A2, 1, now() + 3 * H)));
  await no('admin strikes owner-flagged admin', () => D.set(r(A, E(O)), strike(A, O, 3, 'permanent')));
  await no('mod self-ban (own key)', () => D.set(r(M, E(M)), strike(M, M, 1, now() + 3 * H)));
  await no('mod bans own uid under other key', () => D.set(r(M, 'banned_users_by_email/other(dot)mail'), strike(M, M, 1, now() + 3 * H)));
  await no('plain user writes a ban', () => D.set(r(U1, E(U3)), strike(U1, U3, 1, now() + 3 * H)));
  await no('guest writes a ban', () => D.set(r(null, E(U3)), strike(M, U3, 1, now() + 3 * H)));
  await no('JMD granter (no rank) mutes', () => D.set(r(G, E(U3)), mute(G, U3, 30)));
  await no('UNVERIFIED owner email strikes', () => D.set(r(OU, E(U3)), strike(OU, U3, 1, now() + 3 * H)));
  await ok('JMD mutes user 30 min (old mute shape)', () => D.set(r(J, E(U1)), mute(J, U1, 30)));
  await ok('JMD mutes user 120 min with custom reason (4.0.12 BottomDrawer)', () => D.set(r(J, E(U3)), mute(J, U3, 120, 'spamming links')));
  await ok('JMD mutes with type mute + object bannedBy (new client)', () => D.set(r(J, E(B)), { ...mute(J, B, 60), type: 'mute', bannedBy: by(J, 'JMD') }));
  await no('JMD mutes 3 hours', () => D.set(r(J2, E(U1)), mute(J2, U1, 180)));
  await no('JMD strikes (strikeCount up, 3h)', () => D.set(r(J, E(U3)), strike(J, U3, 1, now() + 3 * H)));
  await no('JMD writes type ban', () => D.set(r(J, E(U3)), { ...mute(J, U3, 30), type: 'ban' }));
  await no('JMD mutes a mod', () => D.set(r(J, E(M)), mute(J, M, 30)));
  await no('JMD mutes an admin', () => D.set(r(J, E(A)), mute(J, A, 30)));
  await no('JMD bans admin permanently', () => D.set(r(J, E(A)), strike(J, A, 3, 'permanent')));
  await no('JMD overrides an active strike with a mute', () => D.set(r(J, E(U2)), mute(J, U2, 30, null, 2)));
  // Lifting / softening.
  await seed(async (_f, db) => {
    await D.set(D.ref(db, E(U3)), strike(A, U3, 3, 'permanent'));
    await D.set(D.ref(db, `banned_users_by_email/${keyLc(EMAIL[U2])}`), mute(J, U2, 30));
    await D.set(D.ref(db, 'banned_users_by_email/legacy(dot)user@x(dot)com'), { strikeCount: 1, bannedUntil: now() + 24 * H, reason: 'Strike 1' });
  });
  await no('mod softens admin permanent ban to 3h', () => D.set(r(M, E(U3)), strike(M, U3, 1, now() + 3 * H)));
  await no('senior unbans admin-placed ban', () => D.set(r(S, E(U3)), null));
  await ok('mod adds a later ban over admin ban? (no: stricter only)', async () => { /* permanent can't get stricter: reapply permanent */ return D.set(r(M, E(U3)), strike(M, U3, 3, 'permanent')); });
  await ok('admin unbans', () => D.set(r(A, E(U3)), null));
  await ok('mod unbans a record mod2 placed (same rank)', () => D.set(r(M, E(U2)), null));
  await ok('JMD2 unmutes a JMD mute (lowercased key)', () => D.set(r(J2, `banned_users_by_email/${keyLc(EMAIL[U2])}`), null));
  await seed(async (_f, db) => { await D.set(D.ref(db, E(U1)), strike(M, U1, 1, now() + 3 * H)); });
  await no('JMD lifts a mod strike', () => D.set(r(J, E(U1)), null));
  await no('banned user deletes own record', () => D.set(r(U1, E(U1)), null));
  await no('banned user rewrites own record', () => D.update(r(U1, E(U1)), { bannedUntil: 1 }));
  await ok('senior lifts a mod strike', () => D.set(r(S, E(U1)), null));
  // Legacy shapes.
  await ok('Oct-2025 mod strike (no bannedBy, no userId)', () => D.set(r(M, 'banned_users_by_email/old(dot)target@x(dot)com'), { strikeCount: 1, bannedUntil: now() + 24 * H, reason: 'Strike 1' }));
  await ok('Oct-2025 mod strike 2 over legacy record', () => D.set(r(M, 'banned_users_by_email/legacy(dot)user@x(dot)com'), { strikeCount: 2, bannedUntil: now() + 72 * H, reason: 'Strike 2' }));
  await ok('Oct-2025 mod unban legacy record', () => D.set(r(M, 'banned_users_by_email/legacy(dot)user@x(dot)com'), null));
  await no('Oct-2025 shape from a JMD', () => D.set(r(J, 'banned_users_by_email/old2(dot)target@x(dot)com'), { strikeCount: 1, bannedUntil: now() + 24 * H, reason: 'Strike 1' }));
  await no('Oct-2025 shape from a user', () => D.set(r(U1, 'banned_users_by_email/old2(dot)target@x(dot)com'), { strikeCount: 1, bannedUntil: now() + 24 * H, reason: 'Strike 1' }));
  await ok('admin ban with no userId (email-only)', () => D.set(r(A, 'banned_users_by_email/nouid(dot)target@x(dot)com'), { strikeCount: 1, bannedUntil: now() + 3 * H, reason: 'Strike 1', email: 'nouid.target@x.com', bannedAt: now(), bannedBy: by(A, 'Admin') }));
  await no('mod current shape without userId', () => D.set(r(M, 'banned_users_by_email/nouid2(dot)target@x(dot)com'), { strikeCount: 1, bannedUntil: now() + 3 * H, reason: 'Strike 1', bannedAt: now(), bannedBy: by(M) }));
  await no('invalid bannedUntil', () => D.set(r(M, E(BT)), strike(M, BT, 1, 'forever')));
  // Reads.
  await ok('user reads own record (raw key, GlobelStats)', () => D.get(r(U2, `banned_users_by_email/${key(EMAIL[U2])}`)));
  await ok('user reads own record (lowercased key, website/utils)', () => D.get(r(U2, `banned_users_by_email/${keyLc(EMAIL[U2])}`)));
  await no('user reads someone else\'s record', () => D.get(r(U1, E(U2))));
  await no('guest reads a record', () => D.get(r(null, E(U2))));
  await no('user lists the ban list', () => D.get(r(U1, 'banned_users_by_email')));
  await ok('mod lists the ban list', () => D.get(r(M, 'banned_users_by_email')));
  await ok('mod reads one record', () => D.get(r(M, E(U2))));

  sec('rtdb banned_devices / _post / banned_uids');
  await ok('guest reads a device record', () => D.get(r(null, 'banned_devices/devA123456')));
  await no('guest lists device bans', () => D.get(r(null, 'banned_devices')));
  await no('user lists device bans', () => D.get(r(U1, 'banned_devices')));
  await no('user writes device ban', () => D.set(r(U1, 'banned_devices/devX1234567'), { bannedUntil: 'permanent', userId: U2, bannedBy: by(U1) }));
  await no('JMD writes device ban', () => D.set(r(J, 'banned_devices/devX1234567'), { bannedUntil: now() + H, userId: U2, bannedBy: by(J) }));
  await no('mod clears admin device ban', () => D.set(r(M, 'banned_devices/devA123456'), null));
  await no('banned user clears own device ban', () => D.set(r(U3, 'banned_devices/devA123456'), null));
  await ok('admin clears device ban (unban)', () => D.set(r(A, 'banned_devices/devA123456'), null));
  await ok('mod clears the device ban it wrote', () => D.set(r(M, 'banned_devices/devU2abcdef'), null));
  await no('mod overwrites a server-managed device ban', () => D.set(r(M, 'banned_devices/devS123456'), { bannedUntil: now() + 3 * H, bannedAt: now(), bannedBy: by(M), reason: 'Strike 1', strikeCount: 1, userId: U2 }));
  await no('admin deletes a server-managed device ban', () => D.set(r(A, 'banned_devices/devS123456'), null));
  await no('user writes banned_users_by_email_post', () => D.set(r(U1, `banned_users_by_email_post/${key(EMAIL[U2])}`), { strikeCount: 1, bannedUntil: now() + H, reason: 'Strike 1' }));
  await ok('Oct-2025 mod post-ban (banned_users_by_email_post)', () => D.set(r(M, `banned_users_by_email_post/${key(EMAIL[U2])}`), { strikeCount: 1, bannedUntil: now() + 24 * H, reason: 'Strike 1' }));
  await ok('user reads own _post record (Oct-2025 UploadModal)', () => D.get(r(U2, `banned_users_by_email_post/${key(EMAIL[U2])}`)));
  await no('user reads other _post record', () => D.get(r(U1, `banned_users_by_email_post/${key(EMAIL[U2])}`)));
  await no('user writes banned_uids', () => D.set(r(U1, `banned_uids/${U1}`), null));
  await ok('user reads own banned_uids', () => D.get(r(U1, `banned_uids/${U1}`)));
  await no('user reads other banned_uids', () => D.get(r(U1, `banned_uids/${U2}`)));
  await ok('mod queries banned_uids by emailKey', () => D.get(D.query(r(M, 'banned_uids'), D.orderByChild('emailKey'), D.equalTo('x'))));

  sec('rtdb content nodes');
  for (const n of ['api', 'server', 'news', 'stock', 'codes', 'fruit_data', 'xlsData', 'appVersions', 'calcData', 'free_translation', 'single_offer_wall', 'pic_numbers', 'storeItems', 'winners', 'prize', 'reward', 'mod', 'analytics', 'reviews', 'enrole', 'testing', 'lastChecked', 'ios_version']) {
    await no(`guest overwrites /${n}`, () => D.set(r(null, n), { x: 1 }));
    await no(`user overwrites /${n}`, () => D.set(r(U1, n), { x: 1 }));
  }
  for (const n of ['api', 'server', 'news', 'stock', 'codes', 'calcData', 'free_translation', 'single_offer_wall']) {
    await ok(`guest reads /${n}`, () => D.get(r(null, n)));
  }
  await ok('admin edits /news', () => D.set(r(A, 'news/item1'), { title: 't' }));
  await no('mod edits /news', () => D.set(r(M, 'news/item1'), { title: 't' }));

  sec('rtdb user-submitted nodes');
  // ReportTradePopUp push (every build since 2025).
  await ok('tradeReports push (old + current shape)', () => D.push(r(U1, 'tradeReports'), { tradeId: 'trade1', reportedBy: U1, reason: 'Scam', timestamp: now() }));
  await no('tradeReports forged reporter', () => D.push(r(U1, 'tradeReports'), { tradeId: 'trade1', reportedBy: U2, reason: 'Scam', timestamp: now() }));
  await no('tradeReports guest', () => D.push(r(null, 'tradeReports'), { tradeId: 'trade1', reportedBy: 'x', reason: 'x', timestamp: now() }));
  await no('tradeReports wipe', () => D.set(r(U1, 'tradeReports'), null));
  await no('user reads tradeReports', () => D.get(r(U1, 'tradeReports')));
  await ok('mod reads tradeReports', () => D.get(r(M, 'tradeReports')));
  await ok('staff marks a trade report reviewed (ReportsTab)', async () => {
    const k = D.push(r(U1, 'tradeReports')).key;
    await D.set(r(U1, `tradeReports/${k}`), { tradeId: 'trade2', reportedBy: U1, reason: 'Scam', timestamp: now() });
    return D.update(r(J, `tradeReports/${k}`), { status: 'reviewed', reviewedBy: J, reviewedAt: now() });
  });
  await no('reporter edits own report later', async () => {
    const k = D.push(r(U1, 'tradeReports')).key;
    await D.set(r(U1, `tradeReports/${k}`), { tradeId: 'trade3', reportedBy: U1, reason: 'Scam', timestamp: now() });
    return D.update(r(U1, `tradeReports/${k}`), { reason: 'changed' });
  });
  await no('staff rewrites the reporter', async () => {
    const k = D.push(r(U1, 'tradeReports')).key;
    await D.set(r(U1, `tradeReports/${k}`), { tradeId: 'trade4', reportedBy: U1, timestamp: now() });
    return D.update(r(M, `tradeReports/${k}`), { reportedBy: M });
  });
  await no('reports write', () => D.push(r(U1, 'reports'), { x: 1 }));
  await ok('withdrawal request (MyPurchases)', () => D.set(r(U1, `withdrawals/${U1}/withdrawal_1`), { amount: '10', status: 'Pending', requestedAt: now(), robloxUsername: 'r' }));
  await no('withdrawal for someone else', () => D.set(r(U1, `withdrawals/${U2}/withdrawal_1`), { amount: '10' }));
  await no('withdrawal self-approve (overwrite)', () => D.set(r(U1, `withdrawals/${U1}/withdrawal_1`), { amount: '10', status: 'Approved' }));
  await no('user reads all withdrawals', () => D.get(r(U1, 'withdrawals')));
  await ok('user reads own withdrawals', () => D.get(r(U1, `withdrawals/${U1}`)));
  await ok('staff reads withdrawals', () => D.get(r(M, 'withdrawals')));
  await ok('social submission (SocialMedia)', () => D.set(r(U1, 'submissions/Tiktok_1'), { userId: U1, platform: 'Tiktok', link: 'l', coins: 5, status: 'Pending', submittedAt: now() }));
  await no('submission as someone else', () => D.set(r(U1, 'submissions/Tiktok_2'), { userId: U2, platform: 'Tiktok' }));
  await no('submission self-approve', () => D.update(r(U1, 'submissions/Tiktok_1'), { status: 'Approved' }));
  await ok('news feedback (guest, anonymous)', () => D.push(r(null, 'news_feedback'), { type: 'poll_vote', userId: 'anonymous', userName: null, userEmail: null, createdAt: now() }));
  await no('news feedback forged userId', () => D.push(r(U1, 'news_feedback'), { userId: U2, createdAt: now() }));
  await no('news feedback wipe', () => D.set(r(U1, 'news_feedback'), null));
  // Old feedback in the reports inbox (2026-10-07): staff delete, players can't.
  await ok('mod deletes an old feedback entry', async () => {
    const k = D.push(r(null, 'news_feedback')).key;
    await D.set(r(null, `news_feedback/${k}`), { type: 'custom_feedback', text: 'x', userId: 'anonymous', createdAt: now() });
    return D.set(r(M, `news_feedback/${k}`), null);
  });
  await no('user deletes an old feedback entry', async () => {
    const k = D.push(r(null, 'news_feedback')).key;
    await D.set(r(null, `news_feedback/${k}`), { type: 'custom_feedback', text: 'x', userId: 'anonymous', createdAt: now() });
    return D.set(r(U1, `news_feedback/${k}`), null);
  });

  sec('rtdb news posts (Admin Dashboard News tab, 2026-10-07)');
  const post = (by, extra = {}) => ({ title: 'Update', body: 'Text', createdAt: D.serverTimestamp(), updatedAt: D.serverTimestamp(), order: -1, tag: '', by, ...extra });
  await ok('admin posts news', () => D.set(r(A, 'news/updates/p1'), post(A)));
  await ok('owner email posts news', () => D.set(r(O, 'news/updates/p2'), post(O)));
  await no('mod posts news', () => D.set(r(M, 'news/updates/p3'), post(M)));
  await no('user posts news', () => D.set(r(U1, 'news/updates/p3'), post(U1)));
  await no('admin post without a title', () => D.set(r(A, 'news/updates/p4'), post(A, { title: '' })));
  await no('admin post with an extra field', () => D.set(r(A, 'news/updates/p5'), post(A, { poll: 'x' })));
  await no('admin post signed as someone else', () => D.set(r(A, 'news/updates/p6'), post(A2)));
  await ok('admin deletes a post', () => D.set(r(A, 'news/updates/p1'), null));
  await ok('guest reads news posts', () => D.get(r(null, 'news/updates')));

  sec('rtdb player_feedback (Complaints & ideas, 2026-10-07)');
  const rep = (uid, extra = {}) => ({ userId: uid, userName: 'n', type: 'complaint', category: 'moderation', text: 'hello', app: 'android 1', createdAt: D.serverTimestamp(), status: 'open', ...extra });
  const send = (uid, id, extra) => D.update(D.ref(dbOf(uid)), { [`player_feedback/${id}`]: rep(uid, extra), [`player_feedback_last/${uid}`]: D.serverTimestamp() });
  await ok('player sends a complaint', () => send(U1, 'f1'));
  await no('second one within a minute', () => send(U1, 'f2', { type: 'suggestion' }));
  await no('without the rate stamp', () => D.set(r(U2, 'player_feedback/f3'), rep(U2)));
  await no('as someone else', () => D.update(D.ref(dbOf(U2)), { 'player_feedback/f4': rep(U1), [`player_feedback_last/${U2}`]: D.serverTimestamp() }));
  await no('guest sends', () => D.update(D.ref(dbOf(null)), { 'player_feedback/f5': rep('anonymous') }));
  await no('image outside report-images', () => send(U3, 'f6', { images: ['https://evil.example/x.jpg'] }));
  await no('status done on create', () => send(U3, 'f7', { status: 'done' }));
  await ok('suggestion with a report image', () => send(U2, 'f8', { type: 'suggestion', category: null, images: ['https://pull-gag.b-cdn.net/report-images/a.jpg'] }));
  await no('player deletes own rate stamp', () => D.set(r(U1, `player_feedback_last/${U1}`), null));
  await no('player edits own report', () => D.update(r(U1, 'player_feedback/f1'), { text: 'changed' }));
  await no('player reads all', () => D.get(r(U1, 'player_feedback')));
  await ok('player reads own by userId', () => D.get(D.query(r(U1, 'player_feedback'), D.orderByChild('userId'), D.equalTo(U1), D.limitToLast(20))));
  await no("player reads someone else's", () => D.get(D.query(r(U1, 'player_feedback'), D.orderByChild('userId'), D.equalTo(U2), D.limitToLast(20))));
  await ok('JMD reads the inbox', () => D.get(r(J, 'player_feedback')));
  await ok('mod marks done', () => D.update(r(M, 'player_feedback/f1'), { status: 'done' }));
  await no('JMD marks done', () => D.update(r(J, 'player_feedback/f8'), { status: 'done' }));
  await no('mod rewrites the sender', () => D.update(r(M, 'player_feedback/f1'), { userId: U2 }));
  await ok('mod deletes', () => D.set(r(M, 'player_feedback/f8'), null));
  // 2026-10-18: ban appeals and "Report review" (reviewId + reviewedUserId).
  await no('review report with an empty reviewId', () => send(U3, 'f9', { category: 'false_review', reviewId: '', reviewedUserId: U2 }));
  await no('review report with a 129-char reviewId', () => send(U3, 'f10', { category: 'false_review', reviewId: 'x'.repeat(129) }));
  await no('review report with a numeric reviewedUserId', () => send(U3, 'f11', { category: 'false_review', reviewId: `${U2}_${U3}`, reviewedUserId: 5 }));
  await ok('review report with reviewId + reviewedUserId', () => send(U3, 'f12', { category: 'false_review', reviewId: `${U2}_${U3}`, reviewedUserId: U2 }));
  await ok('banned player sends a ban appeal', () => send(B, 'f13', { category: 'ban_appeal' }));
  await ok('mod marks a review report done', () => D.update(r(M, 'player_feedback/f12'), { status: 'done' }));
  await ok('wallpaper like counter (guest)', () => D.update(r(null, 'like_counter/12'), { likes: 4, dislikes: 0, downloads: 9 }));
  await no('wallpaper counter junk field', () => D.update(r(null, 'like_counter/12'), { evil: 'x' }));
  await no('wallpaper counter delete', () => D.set(r(null, 'like_counter/12'), null));

  sec('rtdb trades/social');
  await ok('saveTrade own', () => D.set(r(U1, `savedTrades/${U1}/t1`), { type: 'saved', traderId: U2, traderName: 'x', traderRobloxUsername: '', savedAt: D.serverTimestamp() }));
  await ok('ping cooldown stamp', () => D.set(r(U1, `savedTrades/${U1}/t1/lastPingAt`), now()));
  await no('saveTrade into other user', () => D.set(r(U1, `savedTrades/${U2}/t1`), { type: 'saved' }));
  await ok('tradeAcceptors own (May-2026)', () => D.set(r(U1, `tradeAcceptors/t1/${U1}`), { name: 'x' }));
  await no('tradeAcceptors as other', () => D.set(r(U1, `tradeAcceptors/t1/${U2}`), { name: 'x' }));
  await ok('tradeAcceptors clear all (owner flow)', () => D.remove(r(U2, 'tradeAcceptors/t1')));
  await ok('tradeJournal push own', () => D.push(r(U1, `tradeJournal/${U1}`), { gave: [], got: [] }));
  await ok('tradeStats own', () => D.set(r(U1, `tradeStats/${U1}`), { wins: 1 }));
  await no('tradeStats other', () => D.set(r(U1, `tradeStats/${U2}`), { wins: 100 }));
  await ok('admin deletes tradeStats (Delete Profile)', () => D.remove(r(A, `tradeStats/${U1}`)));
  await ok('notifier own + index multi-path', () => D.update(D.ref(dbOf(U1)), { [`notifier/buy/${U1}/kitsune`]: true, [`notifier_index/buy/kitsune/${U1}`]: true }));
  await no('notifier other', () => D.set(r(U1, `notifier/buy/${U2}/kitsune`), true));
  await no('notifier_index other', () => D.set(r(U1, `notifier_index/buy/kitsune/${U2}`), true));
  await ok('mod vote multi-path', () => D.update(D.ref(dbOf(U1)), { [`mod_votes_by_user/${U1}/${M}`]: 1, [`mod_votes_summary/${M}`]: { ups: 4, downs: 1 } }));
  await ok('mod vote toggle off (stale counts)', () => D.update(D.ref(dbOf(U1)), { [`mod_votes_by_user/${U1}/${M}`]: null, [`mod_votes_summary/${M}`]: { ups: 2, downs: 1 } }));
  await no('summary without a vote change', () => D.set(r(U1, `mod_votes_summary/${M}`), { ups: 999, downs: 0 }));
  await no('vote as someone else', () => D.set(r(U1, `mod_votes_by_user/${U2}/${M}`), 1));
  await ok('current build: vote alone (server counts it)', () => D.set(r(U1, `mod_votes_by_user/${U1}/${M}`), -1));
  await no('vote value other than ±1', () => D.set(r(U1, `mod_votes_by_user/${U1}/${M2}`), 5));
  await no('vote for yourself', () => D.set(r(M, `mod_votes_by_user/${M}/${M}`), 1));
  await ok('read own votes', () => D.get(r(U1, `mod_votes_by_user/${U1}`)));
  await no('mod reads who voted on them', () => D.get(r(M, `mod_votes_by_user/${U1}`)));
  await no('guest reads votes', () => D.get(r(null, `mod_votes_by_user/${U1}`)));
  await ok('admin reads votes', () => D.get(r(A, `mod_votes_by_user/${U1}`)));
  await ok('guest reads tally', () => D.get(r(null, `mod_votes_tally/${M}`)));
  await no('user writes tally', () => D.set(r(U1, `mod_votes_tally/${M}`), { ups: 999, downs: 0 }));
  await no('mod writes own tally', () => D.set(r(M, `mod_votes_tally/${M}/ups`), D.increment(1)));
  await no('user writes counted', () => D.set(r(U1, `mod_votes_counted/${M}/${U1}`), 1));
  await no('user reads counted', () => D.get(r(U1, `mod_votes_counted/${M}`)));
  await ok('admin reads counted', () => D.get(r(A, `mod_votes_counted/${M}`)));
  await ok('old ratings (2025) own rater key', () => D.set(r(U1, `ratings/${U2}/${U1}`), { rating: 5, timestamp: now() }));
  await no('old ratings as other rater', () => D.set(r(U1, `ratings/${U2}/${U3}`), { rating: 1 }));
  await ok('old averageRatings', () => D.set(r(U1, `averageRatings/${U2}`), { value: 4.5, count: 3, updatedAt: now() }));
  await no('averageRatings out of range', () => D.set(r(U1, `averageRatings/${U2}`), { value: 9, count: 3 }));

  await ok('admin Delete Profile RTDB sweep (BottomDrawer)', async () => {
    for (const p of [`users/${U1}`, `presence/${U1}`, `chat_meta_data/${U1}`, `group_meta_data/${U1}`, `activeChats/${U1}`, `savedTrades/${U1}`, `tradeJournal/${U1}`, `tradeStats/${U1}`, `reward/${U1}`]) {
      await D.remove(r(A, p));
    }
  });
  await seed(async (_f, db) => { await D.set(D.ref(db, `users/${U1}`), { displayName: 'one', createdAt: 1700000000000 }); });
  await no('mod Delete Profile sweep', () => D.remove(r(M, `tradeJournal/${U2}`)));

  sec('rtdb legacy chat paths');
  const ck = `${U1}_${U2}`;
  await ok('participant writes trade card', () => D.set(r(U1, `private_messages/${ck}/trade`), { id: 't1' }));
  await ok('participant lastRead', () => D.set(r(U2, `private_messages/${ck}/lastRead/${U2}`), now()));
  await ok('participant unread reset', () => D.set(r(U1, `private_messages/${ck}/unread/${U1}`), 0));
  await no('outsider writes trade card', () => D.set(r(U3, `private_messages/${ck}/trade`), { id: 'x' }));
  await no('participant writes message body (locked 2026-10-05)', () => D.set(r(U1, `private_messages/${ck}/messages/2`), { text: 'hi', senderId: U1 }));
  await ok('participant reads chat', () => D.get(r(U1, `private_messages/${ck}`)));
  await no('outsider reads chat', () => D.get(r(U3, `private_messages/${ck}`)));
  await no('guest reads chat', () => D.get(r(null, `private_messages/${ck}`)));
  await no('anyone lists private_messages', () => D.get(r(U1, 'private_messages')));
  await ok('chat_meta_data own row', () => D.update(r(U1, `chat_meta_data/${U1}/${U2}`), { unreadCount: 0 }));
  await ok('chat_meta_data partner row about me (web fallback)', () => D.update(r(U1, `chat_meta_data/${U2}/${U1}`), { chatId: ck, receiverId: U1, lastMessage: 'x', timestamp: now(), unreadCount: D.increment(1) }));
  await no('chat_meta_data unrelated row', () => D.update(r(U3, `chat_meta_data/${U2}/${U1}`), { lastMessage: 'spoof' }));
  await ok('chat_meta_data read own', () => D.get(r(U1, `chat_meta_data/${U1}`)));
  await no('chat_meta_data read other', () => D.get(r(U3, `chat_meta_data/${U1}`)));
  await ok('group_meta_data own leave cleanup', () => D.set(r(U1, `group_meta_data/${U1}/g1`), null));
  await no('group_meta_data other', () => D.set(r(U1, `group_meta_data/${U2}/g1`), { unreadCount: 5 }));
  await ok('activeChats own', () => D.set(r(U1, `activeChats/${U1}`), ck));
  await ok('activeChats read other (web push check)', () => D.get(r(U2, `activeChats/${U1}`)));
  await no('activeChats other', () => D.set(r(U1, `activeChats/${U2}`), ck));
  await ok('activeGroupChats own', () => D.set(r(U1, `activeGroupChats/g1/${U1}`), true));
  await no('activeGroupChats other', () => D.set(r(U1, `activeGroupChats/g1/${U2}`), true));
  await no('private_chat_new write', () => D.set(r(U1, 'private_chat_new/x'), { a: 1 }));
  await no('private_chat write', () => D.set(r(U1, 'private_chat/x'), { a: 1 }));
  await no('private_chat read', () => D.get(r(U1, 'private_chat')));
  await ok('mod pins a message (Oct-2025 pin_messages)', () => D.push(r(M, 'pin_messages'), { text: 'rules' }));
  await no('user pins a message', () => D.push(r(U1, 'pin_messages'), { text: 'spam' }));
  await ok('guest reads pins', () => D.get(r(null, 'pin_messages')));
  await no('group_messages body write', () => D.set(r(U1, 'group_messages/g1/messages/1'), { text: 'x' }));
  await no('guest reads group_messages', () => D.get(r(null, 'group_messages/g1')));
  await ok('bannedUsers own (legacy block list)', () => D.set(r(U1, `bannedUsers/${U1}/${U2}`), true));
  await no('bannedUsers other', () => D.set(r(U1, `bannedUsers/${U2}/${U1}`), true));
}

// ─────────────────────────── FIRESTORE ───────────────────────────
async function firestoreTests() {
  const { doc, setDoc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, collection, query, where, orderBy, limit,
    serverTimestamp, Timestamp, increment, arrayUnion, arrayRemove, deleteField, runTransaction, writeBatch } = F;
  const d = (uid, ...p) => doc(fsOf(uid), ...p);
  const c = (uid, ...p) => collection(fsOf(uid), ...p);

  await seed(async (f) => {
    const staff = async (uid, roles) => F.setDoc(F.doc(f, 'staff', uid), { roles });
    await staff(A, ['isAdmin']); await staff(A2, ['admin']); await staff(S, ['isSeniorMod']);
    await staff(M, ['isModerator']); await staff(J, ['isBabyMod']);
    await F.setDoc(F.doc(f, 'banned_uids', B), { type: 'ban', permanent: true, until: null });
    await F.setDoc(F.doc(f, 'banned_uids', BT), { type: 'ban', permanent: false, until: F.Timestamp.fromMillis(Date.now() + H) });
    await F.setDoc(F.doc(f, 'banned_uids', BX), { type: 'ban', permanent: false, until: F.Timestamp.fromMillis(Date.now() - H) });
    await F.setDoc(F.doc(f, 'trades_new_upgrade', 'tr1'), { userId: U2, traderName: 'two', description: 'd', isFeatured: false, reportCount: 2, timestamp: F.Timestamp.now() });
    await F.setDoc(F.doc(f, 'designPosts_upgrade', 'p1'), { userId: U2, desc: 'd', likes: {}, createdAt: F.Timestamp.now(), report: false, selectedTags: ['Discussion'] });
    await F.setDoc(F.doc(f, 'designPosts', 'lp1'), { userId: U2, desc: 'legacy', likes: { [U3]: true }, commentCount: 1 });
    await F.setDoc(F.doc(f, 'statuses', 's1'), { userId: U2, caption: 'c', viewedBy: [], type: 'poll', pollOptions: ['a', 'b'], pollVotes: { 0: [U3], 1: [] }, expiresAt: F.Timestamp.fromMillis(Date.now() + 24 * H) });
    await F.setDoc(F.doc(f, 'groups', 'g1'), { id: 'g1', createdBy: U2, memberIds: [U2], members: { [U2]: { id: U2, displayName: 'two' } }, memberCount: 1, isActive: true, groupName: 'G' });
    await F.setDoc(F.doc(f, 'group_invitations', 'inv1'), { groupId: 'g1', invitedBy: U2, invitedUserId: U1, status: 'pending' });
    await F.setDoc(F.doc(f, 'group_invitations', 'invGone'), { groupId: 'gGone', invitedBy: U3, invitedUserId: U3, status: 'pending' });
    await F.setDoc(F.doc(f, 'group_join_requests', 'jr1'), { groupId: 'g1', requesterId: U3, creatorId: U2, status: 'pending' });
    await F.setDoc(F.doc(f, 'reviews', `${U2}_${U1}`), { fromUserId: U1, toUserId: U2, rating: 5 });
    await F.setDoc(F.doc(f, 'user_ratings_summary', U2), { count: 3, averageRating: 4.5 });
    await F.setDoc(F.doc(f, 'notifications', 'n1'), { toUid: U2, fromUid: U1, type: 'trade_ping', read: false, createdAt: F.Timestamp.now() });
    await F.setDoc(F.doc(f, 'scammerSummaries', 'bob_1'), { reportedUsername: 'bob', reportedUsername_lc: 'bob', status: 'unverified', reportCount: 1 });
    await F.setDoc(F.doc(f, 'userRateLimits', U2), { lastReportAt: F.Timestamp.now() });
    await F.setDoc(F.doc(f, 'review_verified_summary', U2), { count: 1, leaderboardHold: false });
    await F.setDoc(F.doc(f, 'following', 'f1'), { followerId: U3, followingId: U2 });
  });

  sec('fs catch-all removed');
  await no('guest writes an unknown collection', () => setDoc(d(null, 'whatever', 'x'), { a: 1 }));
  await no('user writes an unknown collection', () => setDoc(d(U1, 'whatever', 'x'), { a: 1 }));
  await no('guest reads an unknown collection', () => getDoc(d(null, 'whatever', 'x')));

  sec('fs trades');
  // HomeScreen newTrade shape (current = 4.0.12 shape).
  const trade = (uid) => ({
    userId: uid, traderName: 'n', avatar: null, isPro: false, isProGranted: false, isFeatured: false,
    hasItems: [{ name: 'Kitsune', type: 'fruit', value: 1 }], wantsItems: [], hasItemNames: ['kitsune'], wantsItemNames: [],
    hasTotal: { price: 0, value: 1 }, wantsTotal: { price: 0, value: 0 }, description: '', timestamp: serverTimestamp(),
    status: 'l', rating: null, ratingCount: 0, style: {}, icons: [], proTagBought: false, flage: null, robloxUsername: 'r',
    robloxUsernameVerified: false, hasRecentGameWin: false, lastGameWinAt: null,
  });
  await ok('create own trade', () => addDoc(c(U1, 'trades_new_upgrade'), trade(U1)));
  await ok('legacy trades_new create (pre-May builds)', () => addDoc(c(U1, 'trades_new'), trade(U1)));
  await ok('legacy first report sets reportCount 1 (Mar 2026)', async () => {
    await seed(async (f) => F.setDoc(F.doc(f, 'trades_new', 'old1'), { userId: U2, description: 'x' }));
    return updateDoc(d(U1, 'trades_new', 'old1'), { reportCount: 1 });
  });
  await ok('expired ban can trade', () => addDoc(c(BX, 'trades_new_upgrade'), trade(BX)));
  await no('create trade as someone else', () => addDoc(c(U1, 'trades_new_upgrade'), trade(U2)));
  await no('guest creates trade', () => addDoc(c(null, 'trades_new_upgrade'), trade('Anonymous')));
  await no('banned (permanent) creates trade', () => addDoc(c(B, 'trades_new_upgrade'), trade(B)));
  await no('banned (temporary) creates trade', () => addDoc(c(BT, 'trades_new_upgrade'), trade(BT)));
  await ok('owner boosts (featured)', () => updateDoc(d(U2, 'trades_new_upgrade', 'tr1'), { isFeatured: true, featuredUntil: Timestamp.fromMillis(Date.now() + 12 * H) }));
  await no('owner hands trade to someone else', () => updateDoc(d(U2, 'trades_new_upgrade', 'tr1'), { userId: U1 }));
  await ok('other user reports trade (reportCount+1)', () => updateDoc(d(U1, 'trades_new_upgrade', 'tr1'), { reportCount: 3 }));
  await no('other user sets reportCount +10', () => updateDoc(d(U1, 'trades_new_upgrade', 'tr1'), { reportCount: 13 }));
  await no('other user edits description', () => updateDoc(d(U1, 'trades_new_upgrade', 'tr1'), { description: 'scam' }));
  await no('other user extends feature window', () => updateDoc(d(U1, 'trades_new_upgrade', 'tr1'), { featuredUntil: Timestamp.fromMillis(Date.now() + 99 * H) }));
  await no('banned user reports trade', () => updateDoc(d(B, 'trades_new_upgrade', 'tr1'), { reportCount: 4 }));
  await ok('guest reads trades feed', () => getDocs(query(c(null, 'trades_new_upgrade'), where('isFeatured', '==', false), limit(10))));
  await ok('my-trades query', () => getDocs(query(c(U1, 'trades_new_upgrade'), where('userId', '==', U1), limit(3))));
  await no('other user deletes trade', () => deleteDoc(d(U1, 'trades_new_upgrade', 'tr1')));
  await ok('staff (mod) deletes trade', () => deleteDoc(d(M, 'trades_new_upgrade', 'tr1')));
  await no('UNVERIFIED owner email deletes a trade', async () => { await seed(async (f) => F.setDoc(F.doc(f, 'trades_new_upgrade', 'tr2'), { userId: U2 })); return deleteDoc(d(OU, 'trades_new_upgrade', 'tr2')); });
  await ok('owner deletes own trade', () => deleteDoc(d(U2, 'trades_new_upgrade', 'tr2')));
  await ok('admin delete-profile batch query', () => getDocs(query(c(A, 'trades_new_upgrade'), where('userId', '==', U2))));

  sec('fs posts + comments');
  const post = (uid) => ({ imageUrl: [], desc: 'hi', userId: uid, displayName: 'n', avatar: null, createdAt: serverTimestamp(), likes: {}, selectedTags: ['Discussion'], report: false, flage: null, isBabyMod: false, isTrusted: false, isGrinder: false, isRaider: false, profileFrame: null });
  await ok('create post', () => addDoc(c(U1, 'designPosts_upgrade'), post(U1)));
  await ok('create post with email (pre-round-2 builds)', () => addDoc(c(U1, 'designPosts_upgrade'), { ...post(U1), email: EMAIL[U1] }));
  await ok('web create post shape', () => addDoc(c(U1, 'designPosts_upgrade'), { ...post(U1), commentCount: 0, robloxUsername: null, robloxUsernameVerified: false, hasRecentGameWin: false }));
  await no('banned creates post', () => addDoc(c(B, 'designPosts_upgrade'), post(B)));
  await no('post as someone else', () => addDoc(c(U1, 'designPosts_upgrade'), post(U2)));
  await ok('react to post', () => updateDoc(d(U1, 'designPosts_upgrade', 'p1'), { [`reactions.${U1}`]: '🔥' }));
  await ok('react replacing old like', () => updateDoc(d(U3, 'designPosts_upgrade', 'p1'), { [`reactions.${U3}`]: '😂', [`likes.${U3}`]: deleteField() }));
  await ok('remove own reaction', () => updateDoc(d(U1, 'designPosts_upgrade', 'p1'), { [`reactions.${U1}`]: deleteField() }));
  await ok('web like toggle', () => updateDoc(d(U1, 'designPosts_upgrade', 'p1'), { [`likes.${U1}`]: true }));
  await no('react on behalf of someone', () => updateDoc(d(U1, 'designPosts_upgrade', 'p1'), { [`reactions.${U3}`]: '💩' }));
  await no('wipe all reactions', () => updateDoc(d(U1, 'designPosts_upgrade', 'p1'), { reactions: {} }));
  await no('banned reacts', () => updateDoc(d(B, 'designPosts_upgrade', 'p1'), { [`reactions.${B}`]: '🔥' }));
  await ok('comment + commentCount increment', async () => {
    await addDoc(c(U1, 'designPosts_upgrade', 'p1', 'comments'), { userId: U1, displayName: 'n', avatar: null, text: 'hey', createdAt: serverTimestamp() });
    return updateDoc(d(U1, 'designPosts_upgrade', 'p1'), { commentCount: increment(1) });
  });
  await ok('web comment shape', () => addDoc(c(U1, 'designPosts_upgrade', 'p1', 'comments'), { userId: U1, userName: 'n', userAvatar: '', text: 'x', timestamp: Timestamp.now(), isReported: false }));
  await no('commentCount jump', () => updateDoc(d(U1, 'designPosts_upgrade', 'p1'), { commentCount: 50 }));
  await no('comment as someone else', () => addDoc(c(U1, 'designPosts_upgrade', 'p1', 'comments'), { userId: U2, text: 'x' }));
  await no('banned comments', () => addDoc(c(B, 'designPosts_upgrade', 'p1', 'comments'), { userId: B, text: 'x' }));
  await ok('report post (ReportModal transaction)', () => runTransaction(fsOf(U1), async (tx) => {
    const ref = d(U1, 'designPosts_upgrade', 'p1'); const s = await tx.get(ref);
    tx.update(ref, { reportCount: (s.get('reportCount') || 0) + 1, report: true });
  }));
  await ok('report post reaching threshold sets banned', () => updateDoc(d(U3, 'designPosts_upgrade', 'p1'), { reportCount: 2, banned: true }));
  await no('other user edits post text', () => updateDoc(d(U1, 'designPosts_upgrade', 'p1'), { desc: 'x' }));
  await no('other user un-bans post', () => updateDoc(d(U1, 'designPosts_upgrade', 'p1'), { banned: false }));
  await ok('owner edits own post', () => updateDoc(d(U2, 'designPosts_upgrade', 'p1'), { desc: 'edited' }));
  await ok('legacy designPosts like (Mar 2026)', () => updateDoc(d(U1, 'designPosts', 'lp1'), { [`likes.${U1}`]: true }));
  await ok('legacy designPosts comment + count', async () => {
    await addDoc(c(U1, 'designPosts', 'lp1', 'comments'), { userId: U1, text: 'x' });
    return updateDoc(d(U1, 'designPosts', 'lp1'), { commentCount: increment(1) });
  });
  await ok('legacy designPosts create', () => addDoc(c(U1, 'designPosts'), post(U1)));
  await ok('guest reads posts by tag', () => getDocs(query(c(null, 'designPosts_upgrade'), where('selectedTags', 'array-contains', 'Discussion'), limit(5))));
  await no('other user deletes post', () => deleteDoc(d(U1, 'designPosts_upgrade', 'p1')));
  await ok('mod deletes post (PostCard)', () => deleteDoc(d(M, 'designPosts_upgrade', 'p1')));

  sec('fs statuses');
  const status = (uid) => ({ userId: uid, userName: 'n', caption: 'c', imageUrl: null, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 24 * H), viewedBy: [], type: 'text', randomSeed: 0.4 });
  await ok('create status', () => addDoc(c(U1, 'statuses'), status(U1)));
  await ok('create poll status', () => addDoc(c(U1, 'statuses'), { ...status(U1), type: 'poll', pollOptions: ['a', 'b'], pollVotes: { 0: [], 1: [] } }));
  await no('banned creates status', () => addDoc(c(B, 'statuses'), status(B)));
  await ok('mark viewed', () => updateDoc(d(U1, 'statuses', 's1'), { viewedBy: arrayUnion(U1) }));
  await ok('banned user can still mark viewed', () => updateDoc(d(B, 'statuses', 's1'), { viewedBy: arrayUnion(B) }));
  await no('add someone else to viewedBy', () => updateDoc(d(U1, 'statuses', 's1'), { viewedBy: arrayUnion(U3) }));
  await ok('react to status', () => updateDoc(d(U1, 'statuses', 's1'), { [`reactions.${U1}`]: '❤️' }));
  await no('banned reacts to status', () => updateDoc(d(B, 'statuses', 's1'), { [`reactions.${B}`]: '❤️' }));
  await ok('poll vote', () => updateDoc(d(U1, 'statuses', 's1'), { 'pollVotes.1': arrayUnion(U1) }));
  await no('remove another voter', () => updateDoc(d(U1, 'statuses', 's1'), { 'pollVotes.0': arrayRemove(U3) }));
  await no('stuff the ballot', () => updateDoc(d(U1, 'statuses', 's1'), { 'pollVotes.0': arrayUnion('x1', 'x2') }));
  await no('edit someone else\'s caption', () => updateDoc(d(U1, 'statuses', 's1'), { caption: 'x' }));
  await ok('global feed query (guest)', () => getDocs(query(c(null, 'statuses'), where('expiresAt', '>', Timestamp.now()), orderBy('expiresAt', 'desc'), limit(20))));
  await no('delete someone else\'s status', () => deleteDoc(d(U1, 'statuses', 's1')));
  await ok('staff deletes status (AdminDashboard)', () => deleteDoc(d(M, 'statuses', 's1')));

  sec('fs reviews + summary');
  const review = (from, to) => ({ fromUserId: from, toUserId: to, rating: 4, userName: 'n', review: 'good', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), edited: false });
  await ok('write review', () => setDoc(d(U3, 'reviews', `${U2}_${U3}`), review(U3, U2), { merge: true }));
  await ok('reviewer recomputes summary (+1)', () => setDoc(d(U3, 'user_ratings_summary', U2), { count: 4, averageRating: 4.4, updatedAt: serverTimestamp() }, { merge: true }));
  await ok('edit review then recompute (same count)', async () => {
    await setDoc(d(U3, 'reviews', `${U2}_${U3}`), { ...review(U3, U2), rating: 5, edited: true }, { merge: true });
    return setDoc(d(U3, 'user_ratings_summary', U2), { count: 4, averageRating: 4.6, updatedAt: serverTimestamp() }, { merge: true });
  });
  await no('non-reviewer rewrites summary', () => setDoc(d(M2, 'user_ratings_summary', U2), { count: 4, averageRating: 1, updatedAt: serverTimestamp() }, { merge: true }));
  await no('reviewer jumps count by 10', () => setDoc(d(U3, 'user_ratings_summary', U2), { count: 14, averageRating: 5, updatedAt: serverTimestamp() }, { merge: true }));
  await no('summary extra field', () => setDoc(d(U3, 'user_ratings_summary', U2), { count: 4, averageRating: 4, evil: 1 }, { merge: true }));
  await ok('staff resets summary after deleting review', () => setDoc(d(M, 'user_ratings_summary', U2), { averageRating: 0, count: 0 }, { merge: true }));
  await no('self review', () => setDoc(d(U1, 'reviews', `${U1}_${U1}`), review(U1, U1)));
  await no('banned writes review', () => setDoc(d(B, 'reviews', `${U2}_${B}`), review(B, U2)));
  await ok('own profile doc (bio)', () => setDoc(d(U1, 'reviews', U1), { bio: 'hi', updatedAt: serverTimestamp() }, { merge: true }));
  await no('banned edits own profile doc', () => setDoc(d(B, 'reviews', B), { bio: 'x' }, { merge: true }));
  await no('edit someone else\'s profile doc', () => setDoc(d(U1, 'reviews', U2), { bio: 'x' }, { merge: true }));
  await ok('reviews query by toUserId (guest/web)', () => getDocs(query(c(null, 'reviews'), where('toUserId', '==', U2))));
  await no('user deletes review', () => deleteDoc(d(U1, 'reviews', `${U2}_${U1}`)));
  // Admins only since 2026-10-18 (owner decision); moderators used to delete reviews.
  await no('mod deletes review', () => deleteDoc(d(M, 'reviews', `${U2}_${U1}`)));
  await ok('admin deletes review', () => deleteDoc(d(A, 'reviews', `${U2}_${U1}`)));
  await ok('staff toggles Top Rated hold', () => updateDoc(d(M, 'review_verified_summary', U2), { leaderboardHold: true, holdBy: M, holdByName: 'm', holdAt: serverTimestamp() }));
  await no('user toggles hold', () => updateDoc(d(U1, 'review_verified_summary', U2), { leaderboardHold: true }));
  await ok('user_profiles own (TradeJournal)', () => setDoc(d(U1, 'user_profiles', U1), { ownedFruits: ['a'] }, { merge: true }));
  await no('user_profiles other', () => setDoc(d(U1, 'user_profiles', U2), { ownedFruits: [] }, { merge: true }));
  await ok('user_profiles get other', () => getDoc(d(U1, 'user_profiles', U2)));

  sec('fs social');
  await ok('follow', () => addDoc(c(U1, 'following'), { followerId: U1, followingId: U2, createdAt: serverTimestamp() }));
  await ok('follow (setDoc auto-id, BottomDrawer)', () => setDoc(doc(c(U3, 'following')), { followerId: U3, followingId: U1, createdAt: serverTimestamp() }));
  await no('follow as someone else', () => addDoc(c(U1, 'following'), { followerId: U2, followingId: U3 }));
  await no('self-follow', () => addDoc(c(U1, 'following'), { followerId: U1, followingId: U1 }));
  await no('banned follows', () => addDoc(c(B, 'following'), { followerId: B, followingId: U1 }));
  await ok('follower count query', () => getDocs(query(c(U1, 'following'), where('followingId', '==', U2))));
  await no('unfollow on someone else\'s behalf', () => deleteDoc(d(U1, 'following', 'f1')));
  await ok('unfollow own', () => deleteDoc(d(U3, 'following', 'f1')));
  const ping = { toUid: U2, fromUid: U1, fromName: 'n', type: 'trade_ping', tradeId: 't', message: 'm', read: false, createdAt: serverTimestamp() };
  await ok('trade ping', () => addDoc(c(U1, 'notifications'), ping));
  await no('ping as someone else', () => addDoc(c(U3, 'notifications'), ping));
  await no('banned pings', () => addDoc(c(B, 'notifications'), { ...ping, fromUid: B }));
  await ok('read own inbox', () => getDocs(query(c(U2, 'notifications'), where('toUid', '==', U2), orderBy('createdAt', 'desc'), limit(20))));
  await no('read someone else\'s inbox', () => getDocs(query(c(U3, 'notifications'), where('toUid', '==', U2))));
  await ok('mark read (batch)', () => { const b = writeBatch(fsOf(U2)); b.update(d(U2, 'notifications', 'n1'), { read: true }); return b.commit(); });
  await no('sender edits notification', () => updateDoc(d(U1, 'notifications', 'n1'), { message: 'x' }));
  await ok('admin delete-profile notifications query', () => getDocs(query(c(A, 'notifications'), where('fromUid', '==', U1))));
  await ok('clear inbox', () => deleteDoc(d(U2, 'notifications', 'n1')));
  await ok('user_activity (web + pre-May builds)', () => addDoc(c(U1, 'user_activity'), { userId: U1, type: 'trade_post', referenceId: 'x', createdAt: serverTimestamp() }));
  await no('user_activity as someone else', () => addDoc(c(U1, 'user_activity'), { userId: U2, type: 'x' }));

  // ── blox-groups (2026-10-19): groups, invitations, join requests ──
  // Every legitimate write is the exact shape groupUtils.js (all builds since
  // 2026-05) or blox-web groups.ts makes; the server-side check of who may
  // join is functions/test/groupMembership.test.js.
  sec('fs groups (blox-groups 2026-10-19)');
  const crew = Array.from({ length: 99 }, (_, i) => `crewUid${String(i).padStart(5, '0')}`);
  await seed(async (f) => {
    await F.setDoc(F.doc(f, 'groups', 'gFull'), { createdBy: U2, memberIds: [U2, ...crew], members: {}, memberCount: 100 });
    await F.setDoc(F.doc(f, 'groups', 'gMuted'), { createdBy: U2, memberIds: [U2, U3], members: { [U2]: { id: U2 }, [U3]: { id: U3, role: 'member', muted: true } } });
    await F.setDoc(F.doc(f, 'groups', 'gS'), { createdBy: U3, memberIds: [U3, M, J], members: { [U3]: { id: U3 }, [M]: { id: M }, [J]: { id: J } }, name: 'S' });
    await F.setDoc(F.doc(f, 'groups', 'gLast'), { createdBy: U3, memberIds: [U1], members: { [U1]: { id: U1 } } });
    await F.setDoc(F.doc(f, 'groups', 'gArch'), { createdBy: U2, memberIds: [U2, U1, M], members: { [U2]: { id: U2 }, [U1]: { id: U1 }, [M]: { id: M } }, isActive: false, archivedAt: F.Timestamp.fromMillis(Date.now() - 61 * 24 * H) });
    await F.setDoc(F.doc(f, 'group_invitations', 'invD'), { groupId: 'g1', invitedBy: U2, invitedUserId: U3, status: 'pending' });
    await F.setDoc(F.doc(f, 'group_join_requests', 'jr2'), { groupId: 'g1', requesterId: U1, creatorId: U2, status: 'pending' });
    await F.setDoc(F.doc(f, 'group_join_requests', 'jr3'), { groupId: 'g1', requesterId: U3, creatorId: U1, status: 'pending' });
  });
  const groupDoc = (id, owner) => ({ id, name: 'G2', groupName: 'G2', description: 'd', createdBy: owner, creatorDisplayName: 'n', memberCount: 1, memberIds: [owner], members: { [owner]: { id: owner, displayName: 'n', avatar: null, joinedAt: serverTimestamp() } }, isPrivate: false, allowDirectJoin: false, allowMemberInvites: true, maxMembers: 100, lastMessage: null, isActive: true, avatar: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  const inviteDoc = (groupId, by, to, extra = {}) => ({ groupId, invitedBy: by, invitedUserId: to, status: 'pending', timestamp: serverTimestamp(), expiresAt: now() + 7 * 24 * H, groupName: 'G2', groupAvatar: null, invitedByDisplayName: 'n', invitedByAvatar: null, invitedUserDisplayName: 'n', invitedUserAvatar: null, ...extra });
  const joinUpdate = (uid, data, entry = {}) => ({ memberIds: [...data.memberIds, uid], [`members.${uid}`]: { id: uid, displayName: 'n', avatar: null, role: 'member', joinedAt: serverTimestamp(), ...entry }, memberCount: data.memberIds.length + 1, updatedAt: serverTimestamp() });

  // Create.
  await ok('create group (groupUtils + blox-web shape)', () => setDoc(d(U1, 'groups', 'g2'), groupDoc('g2', U1)));
  await no('create a group with other people already in it', () => setDoc(d(U1, 'groups', 'g4'), { ...groupDoc('g4', U1), memberIds: [U1, U2] }));
  await no('create a group carrying server fields', () => setDoc(d(U1, 'groups', 'g4'), { ...groupDoc('g4', U1), searchKeys: ['a'] }));
  await no('banned creates group', () => setDoc(d(B, 'groups', 'g3'), { createdBy: B, memberIds: [B] }));
  await no('create a group already archived', () => setDoc(d(U1, 'groups', 'g4'), { ...groupDoc('g4', U1), isActive: false }));

  // Invitations.
  await ok('invite (groupUtils createGroup / addMembersToGroup)', () => addDoc(c(U1, 'group_invitations'), inviteDoc('g2', U1, U3)));
  await ok('pending-invite check query (other users)', () => getDocs(query(c(U1, 'group_invitations'), where('groupId', '==', 'g2'), where('invitedUserId', '==', U3), where('status', '==', 'pending'))));
  await no('invite as someone else', () => addDoc(c(U1, 'group_invitations'), inviteDoc('g2', U2, U3)));
  await no('invite into a group you are not in', () => addDoc(c(U3, 'group_invitations'), inviteDoc('g2', U3, U2)));
  await no('invite yourself', () => addDoc(c(U1, 'group_invitations'), inviteDoc('g2', U1, U1)));
  await no('invite created as already accepted', () => addDoc(c(U1, 'group_invitations'), inviteDoc('g2', U1, U2, { status: 'accepted' })));
  await no('invite carrying revokedAt', () => addDoc(c(U1, 'group_invitations'), inviteDoc('g2', U1, U2, { revokedAt: null })));
  await no('invite into a group that does not exist', () => addDoc(c(U1, 'group_invitations'), inviteDoc('gNone', U1, U2)));

  // Accepting.
  await ok('accept invite: join + mark accepted (transaction)', () => runTransaction(fsOf(U1), async (tx) => {
    const gRef = d(U1, 'groups', 'g1'); const g = await tx.get(gRef); const data = g.data();
    tx.update(gRef, { memberIds: [...data.memberIds, U1], members: { ...data.members, [U1]: { id: U1, displayName: 'n', avatar: null, role: 'member', joinedAt: serverTimestamp() } }, memberCount: data.memberIds.length + 1, updatedAt: serverTimestamp() });
    tx.update(d(U1, 'group_invitations', 'inv1'), { status: 'accepted' });
  }));
  await no('add someone else to a group', () => updateDoc(d(U3, 'groups', 'g1'), { memberIds: [U2, U1, B], memberCount: 3 }));
  await no('invitee rewrites invite target', () => updateDoc(d(U1, 'group_invitations', 'inv1'), { invitedUserId: U3 }));
  await no('invitee moves the invite to another group', () => updateDoc(d(U1, 'group_invitations', 'inv1'), { groupId: 'gS' }));
  await no('invitee sets an unknown status', () => updateDoc(d(U1, 'group_invitations', 'inv1'), { status: 'revoked' }));
  await no('invitee clears revokedAt', () => updateDoc(d(U1, 'group_invitations', 'inv1'), { revokedAt: null }));
  await no('third party declines invite', () => updateDoc(d(U3, 'group_invitations', 'inv1'), { status: 'declined' }));
  await ok('invitee declines (declineGroupInvite)', () => updateDoc(d(U3, 'group_invitations', 'invD'), { status: 'declined' }));
  await no('banned user joins via invite', async () => {
    await seed(async (f) => F.setDoc(F.doc(f, 'group_invitations', 'invB'), { groupId: 'g1', invitedBy: U2, invitedUserId: B, status: 'pending' }));
    const g = (await getDoc(d(B, 'groups', 'g1'))).data();
    return updateDoc(d(B, 'groups', 'g1'), { memberIds: [...g.memberIds, B], [`members.${B}`]: { id: B }, memberCount: g.memberIds.length + 1, updatedAt: serverTimestamp() });
  });
  await no('join while giving yourself the admin role', async () => {
    const g = (await getDoc(d(U3, 'groups', 'g1'))).data();
    return updateDoc(d(U3, 'groups', 'g1'), joinUpdate(U3, g, { role: 'admin' }));
  });
  await no('member promotes themself to admin', () => updateDoc(d(U1, 'groups', 'g1'), { [`members.${U1}.role`]: 'admin' }));
  await no('muted member unmutes themself', () => updateDoc(d(U3, 'groups', 'gMuted'), { [`members.${U3}.muted`]: false }));
  await ok('muted member can still leave', async () => {
    const g = (await getDoc(d(U3, 'groups', 'gMuted'))).data(); const members = { ...g.members }; delete members[U3];
    return updateDoc(d(U3, 'groups', 'gMuted'), { memberIds: g.memberIds.filter((x) => x !== U3), members, memberCount: 1, updatedAt: serverTimestamp() });
  });
  await no('join a full group (100 members)', async () => {
    const g = (await getDoc(d(U3, 'groups', 'gFull'))).data();
    return updateDoc(d(U3, 'groups', 'gFull'), joinUpdate(U3, g));
  });

  // Join requests.
  await ok('join request (sendJoinRequest)', () => addDoc(c(U2, 'group_join_requests'), { groupId: 'g2', requesterId: U2, requesterDisplayName: 'n', requesterAvatar: null, status: 'pending', createdAt: serverTimestamp(), groupName: 'G2', creatorId: U1 }));
  await no('join request as someone else', () => addDoc(c(U1, 'group_join_requests'), { groupId: 'g2', requesterId: U3, status: 'pending', creatorId: U1 }));
  await no('join request addressed to a fake creator', () => addDoc(c(U3, 'group_join_requests'), { groupId: 'g1', requesterId: U3, status: 'pending', creatorId: U3 }));
  await no('join request created as approved', () => addDoc(c(U3, 'group_join_requests'), { groupId: 'g1', requesterId: U3, status: 'approved', creatorId: U2 }));
  await no('join request for a group that does not exist', () => addDoc(c(U3, 'group_join_requests'), { groupId: 'gNone', requesterId: U3, status: 'pending', creatorId: U2 }));
  await no('requester approves their own request', () => updateDoc(d(U3, 'group_join_requests', 'jr1'), { status: 'approved' }));
  await no('a stale creatorId approves (not the creator any more)', () => updateDoc(d(U1, 'group_join_requests', 'jr3'), { status: 'approved', approvedAt: serverTimestamp() }));
  await ok('creator approves request', () => runTransaction(fsOf(U2), async (tx) => {
    const gRef = d(U2, 'groups', 'g1'); const g = (await tx.get(gRef)).data();
    tx.update(gRef, { memberIds: [...g.memberIds, U3], [`members.${U3}`]: { id: U3, role: 'member' }, memberCount: g.memberIds.length + 1, updatedAt: serverTimestamp() });
    tx.update(d(U2, 'group_join_requests', 'jr1'), { status: 'approved', approvedAt: serverTimestamp() });
  }));
  await ok('creator rejects request (group full)', () => updateDoc(d(U2, 'group_join_requests', 'jr2'), { status: 'rejected', rejectedAt: serverTimestamp(), rejectionReason: 'Group is now full' }));
  await no('outsider approves request', () => updateDoc(d(M2, 'group_join_requests', 'jr1'), { status: 'rejected' }));
  await no('creator moves a request to another group', () => updateDoc(d(U2, 'group_join_requests', 'jr2'), { groupId: 'gS' }));

  // Leaving, managing.
  await ok('member leaves group', async () => {
    const g = (await getDoc(d(U3, 'groups', 'g1'))).data(); const members = { ...g.members }; delete members[U3];
    return updateDoc(d(U3, 'groups', 'g1'), { memberIds: g.memberIds.filter((x) => x !== U3), members, memberCount: g.memberIds.length - 1, updatedAt: serverTimestamp() });
  });
  await no('non-member renames group', () => updateDoc(d(U3, 'groups', 'g1'), { groupName: 'pwn', name: 'pwn' }));
  await ok('creator renames group', () => updateDoc(d(U2, 'groups', 'g1'), { groupName: 'G1', name: 'G1', updatedAt: serverTimestamp() }));
  await ok('creator pins a message', () => updateDoc(d(U2, 'groups', 'g1'), { pinnedMessages: [{ id: 'm1', text: 't', pinnedBy: U2, pinnedAt: now() }] }));
  await no('creator writes searchKeys (server field)', () => updateDoc(d(U2, 'groups', 'g1'), { searchKeys: ['a', 'b'] }));
  await no('creator writes ownerCap (server field)', () => updateDoc(d(U2, 'groups', 'g1'), { ownerCap: null }));
  await no('creator hands the group to a non-member', () => updateDoc(d(U2, 'groups', 'g1'), { createdBy: U3, updatedAt: serverTimestamp() }));
  await ok('creator transfers ownership to a member (makeMemberCreator)', () => updateDoc(d(U2, 'groups', 'g1'), { createdBy: U1, updatedAt: serverTimestamp() }));
  await ok('creator leaves: random member becomes owner with role admin (leaveGroup)', async () => {
    const g = (await getDoc(d(U1, 'groups', 'g1'))).data(); const members = { ...g.members }; delete members[U1];
    members[U2] = { ...members[U2], role: 'admin' };
    return updateDoc(d(U1, 'groups', 'g1'), { createdBy: U2, memberIds: g.memberIds.filter((x) => x !== U1), members, memberCount: g.memberIds.length - 1, updatedAt: serverTimestamp() });
  });

  // Archive / restore (inactive-group cleanup: only the server archives).
  await no('creator archives their own group (would dodge the cap)', () => updateDoc(d(U2, 'groups', 'g1'), { isActive: false }));
  await no('creator sets archivedAt', () => updateDoc(d(U2, 'groups', 'gArch'), { archivedAt: Timestamp.now() }));
  await no('member restores an archived group', () => updateDoc(d(U1, 'groups', 'gArch'), { isActive: true, restoredAt: serverTimestamp() }));
  await no('Moderator (member) restores an archived group', () => updateDoc(d(M, 'groups', 'gArch'), { isActive: true, restoredAt: serverTimestamp() }));
  await no('creator restores with a postdated restoredAt', () => updateDoc(d(U2, 'groups', 'gArch'), { isActive: true, restoredAt: Timestamp.fromMillis(now() + 365 * 24 * H) }));
  await ok('creator restores an archived group (restoreGroup)', () => updateDoc(d(U2, 'groups', 'gArch'), { isActive: true, restoredAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await seed(async (f) => F.updateDoc(F.doc(f, 'groups', 'gArch'), { isActive: false }));
  await ok('Senior Mod restores any archived group', () => updateDoc(d(S, 'groups', 'gArch'), { isActive: true, restoredAt: serverTimestamp() }));

  // Staff: Moderators and JMDs are members like anyone; Senior Mod+ manage any group.
  await no('Moderator (member) renames a group they do not own', () => updateDoc(d(M, 'groups', 'gS'), { name: 'mod', groupName: 'mod' }));
  await no('Moderator (member) pins in a group they do not own', () => updateDoc(d(M, 'groups', 'gS'), { pinnedMessages: [] }));
  await no('Moderator (member) removes another member', () => updateDoc(d(M, 'groups', 'gS'), { memberIds: [U3, M], [`members.${J}`]: deleteField(), memberCount: 2 }));
  await no('JMD (member) renames a group they do not own', () => updateDoc(d(J, 'groups', 'gS'), { description: 'jmd' }));
  await no('Moderator deletes a group they do not own (All groups tab)', () => deleteDoc(d(M, 'groups', 'gS')));
  await no('Moderator updates someone else\'s invitation', () => updateDoc(d(M, 'group_invitations', 'invD'), { status: 'pending' }));
  await ok('Senior Mod renames any group', () => updateDoc(d(S, 'groups', 'gS'), { name: 'S2', groupName: 'S2', updatedAt: serverTimestamp() }));
  await ok('Senior Mod pins in any group', () => updateDoc(d(S, 'groups', 'gS'), { pinnedMessages: [] }));
  await ok('Admin removes a member from any group', () => updateDoc(d(A, 'groups', 'gS'), { memberIds: [U3, M], [`members.${J}`]: deleteField(), memberCount: 2, updatedAt: serverTimestamp() }));
  await ok('verified owner email edits any group', () => updateDoc(d(O, 'groups', 'gS'), { description: 'owner' }));
  await no('UNVERIFIED owner email edits a group', () => updateDoc(d(OU, 'groups', 'gS'), { description: 'x' }));
  await no('Senior Mod hands a group to a non-member', () => updateDoc(d(S, 'groups', 'gS'), { createdBy: S }));
  await ok('Senior Mod deletes any group', () => deleteDoc(d(S, 'groups', 'gS')));

  // Deleting.
  await no('third party deletes live invite', () => deleteDoc(d(U3, 'group_invitations', 'inv1')));
  await ok('invitee deletes their own expired invite (GlobalGroupInviteToast)', () => deleteDoc(d(U3, 'group_invitations', 'invD')));
  await ok('orphan invite sweep after group deletion', () => deleteDoc(d(U1, 'group_invitations', 'invGone')));
  await ok('last member deletes the group', () => deleteDoc(d(U1, 'groups', 'gLast')));
  await ok('creator deletes group', () => deleteDoc(d(U2, 'groups', 'g1')));
  // ── end blox-groups ──

  sec('fs reports');
  const chatReport = (by, other) => ({ chatKey: [by, other].sort().join('_'), reportedBy: by, reporterName: 'n', reportedUser: other, reportedUserName: 'o', reason: 'Scam', chatConsent: true, status: 'pending', createdAt: Timestamp.now() });
  await ok('DM report (Scamwarning, all builds)', () => addDoc(c(U1, 'chat_reports'), chatReport(U1, U2)));
  await ok('reporter dedupe query', () => getDocs(query(c(U1, 'chat_reports'), where('chatKey', '==', [U1, U2].sort().join('_')), where('reportedBy', '==', U1), where('status', '==', 'pending'), limit(20))));
  await no('report a chat you are not in', () => addDoc(c(U3, 'chat_reports'), { ...chatReport(U1, U2), reportedBy: U3 }));
  await no('report as someone else', () => addDoc(c(U1, 'chat_reports'), chatReport(U2, U1)));
  await no('banned reports', () => addDoc(c(B, 'chat_reports'), chatReport(B, U1)));
  await no('user lists all chat reports', () => getDocs(query(c(U1, 'chat_reports'), orderBy('createdAt', 'desc'), limit(30))));
  await ok('staff dismisses chat report (ReportsTab)', async () => {
    const ref = await addDoc(c(U2, 'chat_reports'), chatReport(U2, U1));
    return updateDoc(d(M, 'chat_reports', ref.id), { status: 'reviewed' });
  });
  await no('staff points a chat report at another chat', async () => {
    const ref = await addDoc(c(U2, 'chat_reports'), chatReport(U2, U1));
    return updateDoc(d(M, 'chat_reports', ref.id), { chatKey: [U1, U3].sort().join('_'), reportedBy: U1 });
  });
  await no('reporter dismisses own chat report', async () => {
    const ref = await addDoc(c(U2, 'chat_reports'), chatReport(U2, U3));
    return updateDoc(d(U2, 'chat_reports', ref.id), { status: 'reviewed' });
  });
  await ok('staff lists chat reports', () => getDocs(query(c(J, 'chat_reports'), orderBy('createdAt', 'desc'), limit(30))));
  const ur = { type: 'trade', targetId: 'tr1', targetUid: U2, reporterUid: U1, reason: 'Scam', text: 'details', createdAt: serverTimestamp(), status: 'open' };
  await ok('user_reports create', () => setDoc(d(U1, 'user_reports', 'r1'), ur));
  await ok('user_reports create w/o optional text/targetUid', () => addDoc(c(U1, 'user_reports'), { type: 'post', targetId: 'p1', reporterUid: U1, reason: 'Spam', createdAt: serverTimestamp(), status: 'open' }));
  await ok('user_reports exact submitUserReport shape (text "", targetUid null)', () => addDoc(c(U1, 'user_reports'), { type: 'scam', targetId: 'bob_1', targetUid: null, reporterUid: U1, reason: 'Fake trade', text: '', createdAt: serverTimestamp(), status: 'open' }));
  await no('user_reports extra field', () => addDoc(c(U1, 'user_reports'), { ...ur, evil: 1 }));
  await no('user_reports status reviewed', () => addDoc(c(U1, 'user_reports'), { ...ur, status: 'reviewed' }));
  await no('user_reports bad type', () => addDoc(c(U1, 'user_reports'), { ...ur, type: 'x' }));
  await no('user_reports long reason', () => addDoc(c(U1, 'user_reports'), { ...ur, reason: 'x'.repeat(201) }));
  await no('user_reports forged reporter', () => addDoc(c(U1, 'user_reports'), { ...ur, reporterUid: U2 }));
  await no('user_reports banned', () => addDoc(c(B, 'user_reports'), { ...ur, reporterUid: B }));
  await no('user_reports client createdAt', () => addDoc(c(U1, 'user_reports'), { ...ur, createdAt: Timestamp.fromMillis(1) }));
  await no('user lists user_reports', () => getDocs(c(U2, 'user_reports')));
  await ok('staff lists user_reports', () => getDocs(c(J, 'user_reports')));
  await ok('staff marks reviewed', () => updateDoc(d(M, 'user_reports', 'r1'), { status: 'reviewed', reviewedBy: M, reviewedAt: serverTimestamp() }));
  await no('staff rewrites reason', () => updateDoc(d(M, 'user_reports', 'r1'), { reason: 'x' }));
  await no('mod deletes report', () => deleteDoc(d(M, 'user_reports', 'r1')));
  await ok('admin deletes report', () => deleteDoc(d(A, 'user_reports', 'r1')));

  sec('fs scammer db');
  const scamReport = (uid, name, existing) => runTransaction(fsOf(uid), async (tx) => {
    const rl = d(uid, 'userRateLimits', uid); await tx.get(rl);
    const id = `${name}_${Date.now()}`;
    if (existing) tx.update(d(uid, 'scammerSummaries', existing.id), { reportCount: existing.reportCount + 1, updatedAt: Timestamp.now() });
    else tx.set(d(uid, 'scammerSummaries', id), { reportedUsername: name, reportedUsername_lc: name, status: 'unverified', reportCount: 1, scamDate: Timestamp.now(), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    tx.set(d(uid, 'scammerDetails', id), { scamType: 'x', whatHappened: 'y', proofUrls: [], reporterUid: uid, reportedUsername_lc: name });
    tx.set(rl, { lastReportAt: Timestamp.now() }, { merge: true });
  });
  await ok('new scammer report (app + web transaction)', () => scamReport(U1, 'alice'));
  await ok('report on existing summary (+1)', () => scamReport(U3, 'bob', { id: 'bob_1', reportCount: 1 }));
  await no('summary +5', () => updateDoc(d(U1, 'scammerSummaries', 'bob_1'), { reportCount: 7 }));
  await no('user verifies a report', () => updateDoc(d(U1, 'scammerSummaries', 'bob_1'), { status: 'verified' }));
  await ok('mod verifies', () => updateDoc(d(M, 'scammerSummaries', 'bob_1'), { status: 'verified', updatedAt: Timestamp.now() }));
  await no('banned reports scammer', () => scamReport(B, 'carol'));
  await no('reset own rate limit (delete)', () => deleteDoc(d(U2, 'userRateLimits', U2)));
  await no('move own rate limit backwards', () => setDoc(d(U2, 'userRateLimits', U2), { lastReportAt: Timestamp.fromMillis(0) }));
  await no('write someone else\'s rate limit', () => setDoc(d(U1, 'userRateLimits', U2), { lastReportAt: Timestamp.now() }));
  await no('read someone else\'s rate limit', () => getDoc(d(U1, 'userRateLimits', U2)));
  await no('detail as someone else', () => setDoc(d(U1, 'scammerDetails', 'z1'), { reporterUid: U2 }));
  await ok('guest reads scammer list (web)', () => getDocs(query(c(null, 'scammerSummaries'), orderBy('reportCount', 'desc'), limit(15))));

  sec('fs games');
  await ok('games own (gameScores.saveGameStats)', () => setDoc(d(U1, 'games', U1), { whackBestScore: 10 }, { merge: true }));
  await no('games other', () => setDoc(d(U1, 'games', U2), { whackBestScore: 99 }, { merge: true }));
  await ok('legacy leaderboard list', () => getDocs(query(c(null, 'games'), orderBy('whackBestScore', 'desc'), limit(20))));
  await ok('game_scores own', () => setDoc(d(U1, 'game_scores', 'whack', 'scores', U1), { score: 10, username: 'n', avatar: null, updatedAt: new Date() }, { merge: true }));
  await no('game_scores other', () => setDoc(d(U1, 'game_scores', 'whack', 'scores', U2), { score: 9999 }));
  await ok('leaderboard cache rewrite', () => setDoc(d(U1, 'game_leaderboard_cache', 'whack'), { users: [{ uid: U1, score: 10, username: 'n', avatar: null }], gameId: 'whack', lastUpdated: new Date(), userCount: 1 }));
  await no('leaderboard cache junk', () => setDoc(d(U1, 'game_leaderboard_cache', 'whack'), { evil: true }));
  await ok('game_stats own (awardGameWin)', () => setDoc(d(U1, 'game_stats', U1), { fruitGameWins: 2 }, { merge: true }));
  await no('game_stats other', () => setDoc(d(U1, 'game_stats', U2), { fruitGameWins: 99 }, { merge: true }));
  await ok('room create', () => setDoc(d(U1, 'fruitGuessingGame_rooms', 'room1'), { hostId: U1, status: 'waiting', players: {}, invites: {} }));
  await no('room create as someone else', () => setDoc(d(U1, 'fruitGuessingGame_rooms', 'room2'), { hostId: U2 }));
  await ok('room join update', () => updateDoc(d(U2, 'fruitGuessingGame_rooms', 'room1'), { currentPlayers: increment(1) }));
  await ok('send game invite', () => setDoc(d(U1, 'fruitGuessingGame_userInvites', U2, 'invites', 'room1'), { roomId: 'room1', fromUserId: U1, status: 'pending', timestamp: serverTimestamp() }));
  await ok('invitee declines', () => updateDoc(d(U2, 'fruitGuessingGame_userInvites', U2, 'invites', 'room1'), { status: 'declined' }));
  await no('third party reads invite', () => getDoc(d(U3, 'fruitGuessingGame_userInvites', U2, 'invites', 'room1')));

  await ok('admin Delete Profile Firestore sweep (BottomDrawer)', async () => {
    const fa = fsOf(A);
    const sweep = async (coll, field, value) => {
      const snap = await getDocs(query(collection(fa, coll), where(field, '==', value)));
      const b = writeBatch(fa); snap.docs.forEach((x) => b.delete(x.ref)); await b.commit();
    };
    await sweep('reviews', 'fromUserId', U3); await sweep('reviews', 'toUserId', U3);
    for (const [coll, id] of [['reviews', U3], ['user_ratings_summary', U3], ['user_profiles', U3], ['game_stats', U3]]) await deleteDoc(doc(fa, coll, id));
    await sweep('trades_new_upgrade', 'userId', U3); await sweep('following', 'followerId', U3); await sweep('following', 'followingId', U3);
    await sweep('notifications', 'toUid', U3); await sweep('notifications', 'fromUid', U3); await sweep('designPosts_upgrade', 'userId', U3);
    await sweep('group_invitations', 'invitedUserId', U3); await sweep('group_invitations', 'invitedBy', U3); await sweep('group_join_requests', 'userId', U3);
  });

  sec('fs server-only');
  await no('user writes staff doc', () => setDoc(d(U1, 'staff', U1), { roles: ['isAdmin'] }));
  await no('user writes banned_uids mirror', () => setDoc(d(B, 'banned_uids', B), { permanent: false }));
  await no('banned user deletes own mirror', () => deleteDoc(d(B, 'banned_uids', B)));
  await ok('user reads own ban mirror', () => getDoc(d(B, 'banned_uids', B)));
  await no('user reads other ban mirror', () => getDoc(d(U1, 'banned_uids', B)));
  await ok('staff reads ban mirror', () => getDoc(d(J, 'banned_uids', B)));
  await no('user writes leaderboard_cache', () => setDoc(d(U1, 'leaderboard_cache', 'top50'), { x: 1 }));
  await ok('admin delete-profile sweeps cosmetics_inventory', () => deleteDoc(d(A, 'cosmetics_inventory', U2)));
  await no('user deletes cosmetics_inventory', () => deleteDoc(d(U1, 'cosmetics_inventory', U2)));
  await ok('guest reads top50', () => getDoc(d(null, 'leaderboard_cache', 'top50')));
}

async function main() {
  const [fsHost, fsPort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  const [dbHost, dbPort] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: fs.readFileSync(process.env.RULES_FIRESTORE || path.join(ROOT, 'firestore.rules'), 'utf8'), host: fsHost, port: Number(fsPort) },
    database: { rules: fs.readFileSync(process.env.RULES_DATABASE || path.join(ROOT, 'database.rules.json'), 'utf8'), host: dbHost, port: Number(dbPort) },
  });
  console.log('rules loaded into the emulators (both files compile)');
  await env.clearDatabase(); await env.clearFirestore();
  await rtdbTests();
  await firestoreTests();
  await env.cleanup();
  console.log(`\n${results.pass} passed, ${results.fail} failed`);
  if (results.fail) { console.log('\nFAILURES:\n  ' + results.failures.join('\n  ')); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
