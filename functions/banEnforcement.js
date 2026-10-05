/**
 * Server-side ban enforcement.
 *
 * WHY THIS EXISTS
 * Every ban in the app used to be keyed by email and written from the
 * moderator's phone. Three ways out of that:
 *   1. Delete the account (Settings → Delete Account). users/{uid},
 *      users_private/{uid} and the Auth user go with it, so the next ban
 *      attempt finds no email and aborts with "email not found" — nothing is
 *      ever written. Messages stay in Supabase, so mods can still tap him.
 *   2. Sign in with a phone number. No email, so never bannable.
 *   3. Make a new account. The device ban only existed if users/{uid}/deviceId
 *      happened to be stamped (≈11 % of ban records carried one).
 *
 * WHAT THIS ADDS
 *   banned_uids/{uid}              uid-keyed ban, server-written only. The app
 *                                  listens to it next to the email/device bans.
 *   device_accounts/{fp}/{uid}     every account seen on a device (server-only)
 *   account_devices/{uid}/{fp}     every device seen for an account (server-only)
 *   deleted_accounts/{uid}         tombstone kept when an account is deleted:
 *                                  sha256(email), phone, devices. No plaintext email.
 *   banned_email_hashes/{hash}     ban on an email we only know as a hash (deleted
 *                                  accounts) — matched again at sign-up.
 *   Supabase banned_senders        read by a BEFORE INSERT trigger on every
 *                                  message table (supabase/030_banned_senders.sql).
 *
 * applyBan / liftBan are the single core. Everything below calls them:
 *   modSanction              HTTPS (Bearer ID token) — ban/mute/unban by UID,
 *                            works with no email; also lists linked accounts.
 *   syncEmailBan             banned_users_by_email/{key} onWrite — every
 *                            existing client ban path feeds the server too.
 *   indexDeviceAccount       users_private/{uid}/deviceId onWrite — builds the
 *                            device index, auto-bans a new account on a banned device.
 *   indexLegacyDeviceAccount users/{uid}/deviceId (old builds) — same, then moves
 *                            the value off the publicly readable node.
 *   banCheckOnSignup         Auth onCreate — re-ban a returning email.
 *   tombstoneDeletedAccount  Auth onDelete — keep what's needed to re-ban.
 *
 * Deploy: firebase deploy --only functions:modSanction,functions:syncEmailBan,functions:indexDeviceAccount,functions:indexLegacyDeviceAccount,functions:banCheckOnSignup,functions:tombstoneDeletedAccount
 */

const crypto = require('crypto');
const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = () => admin.database();

const SECRETS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

// Mirrors the email allowlist in database.rules.json.
const OWNER_EMAILS = new Set([
  'thesolanalabs@gmail.com',
  'sohailnasir74business@gmail.com',
  'sohailnasir74@gmail.com',
]);

// Same ladder as STAFF_RANK in Code/ChatScreen/utils.js.
const RANK = { admin: 4, seniorMod: 3, moderator: 2, babyMod: 1, user: 0 };

const HOUR = 60 * 60 * 1000;
const STRIKE_DURATION_MS = { 1: 3 * HOUR, 2: 3 * 24 * HOUR }; // 3 → permanent

// Device fingerprints are ANDROID_ID hex or an iOS UUID, already sanitised
// for RTDB keys by Code/Helper/deviceFingerprint.js.
const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{6,128}$/;
const UID_RE = /^[A-Za-z0-9]{10,128}$/;

const LINKED_LIMIT = 25;

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

const normEmail = (e) => (typeof e === 'string' && e.trim() ? e.trim().toLowerCase() : null);

// Same encoding as the app, lowercased (keys in the wild are all lowercase).
const encodeEmailKey = (email) => normEmail(email).replace(/\./g, '(dot)');
const decodeEmailKey = (key) => String(key).replace(/\(dot\)/g, '.');

// Peppered so the stored value isn't a bare sha256 of the address.
const EMAIL_HASH_PEPPER = 'bloxfruit-ban-v1';
const hashEmail = (email) => {
  const e = normEmail(email);
  return e ? crypto.createHash('sha256').update(`${EMAIL_HASH_PEPPER}:${e}`).digest('hex') : null;
};

const isActive = (until, now = Date.now()) =>
  until === 'permanent' || (typeof until === 'number' && until > now);

// Is ban `a` at least as strict as ban `b`?
const atLeastAsStrict = (a, b) => {
  if (a === 'permanent') return true;
  if (b === 'permanent') return false;
  return (typeof a === 'number' ? a : 0) >= (typeof b === 'number' ? b : 0);
};

async function getAuthUser(uid) {
  try {
    return await admin.auth().getUser(uid);
  } catch (e) {
    if (e?.code === 'auth/user-not-found' || e?.code === 'auth/invalid-uid') return null;
    throw e;
  }
}

// Rank from RTDB role flags, plus the owner-email allowlist. `identity` is
// either a decoded ID token or an Auth UserRecord — both carry email and
// email_verified/emailVerified.
async function readRank(uid, identity = null) {
  const email = normEmail(identity?.email);
  const verified = identity?.email_verified === true || identity?.emailVerified === true;
  if (email && verified && OWNER_EMAILS.has(email)) return RANK.admin;
  if (!uid) return RANK.user;
  const keys = ['admin', 'isAdmin', 'isSeniorMod', 'isModerator', 'isBabyMod'];
  const snaps = await Promise.all(keys.map((k) => db().ref(`users/${uid}/${k}`).get()));
  const v = Object.fromEntries(keys.map((k, i) => [k, snaps[i].val() === true]));
  if (v.admin || v.isAdmin) return RANK.admin;
  if (v.isSeniorMod) return RANK.seniorMod;
  if (v.isModerator) return RANK.moderator;
  if (v.isBabyMod) return RANK.babyMod;
  return RANK.user;
}

// Everything we can still find out about an account, live or deleted.
async function resolveIdentity(uid) {
  const [authUser, privEmailSnap, tombSnap, devicesSnap, stampedSnap] = await Promise.all([
    getAuthUser(uid),
    db().ref(`users_private/${uid}/email`).get(),
    db().ref(`deleted_accounts/${uid}`).get(),
    db().ref(`account_devices/${uid}`).get(),
    db().ref(`users_private/${uid}/deviceId`).get(),
  ]);
  const tomb = tombSnap.val() || null;
  const email = normEmail(authUser?.email) || normEmail(privEmailSnap.val()) || null;

  const devices = new Set(Object.keys(devicesSnap.val() || {}));
  for (const fp of Object.keys(tomb?.devices || {})) devices.add(fp);
  const stamped = stampedSnap.val();
  if (typeof stamped === 'string') devices.add(stamped);
  // Not yet moved off the public node by indexLegacyDeviceAccount.
  const legacy = (await db().ref(`users/${uid}/deviceId`).get()).val();
  if (typeof legacy === 'string') devices.add(legacy);

  return {
    uid,
    exists: !!authUser,
    authUser,
    email,
    emailHash: email ? hashEmail(email) : tomb?.emailHash || null,
    phone: authUser?.phoneNumber || tomb?.phone || null,
    deleted: !authUser && !!tomb,
    devices: [...devices].filter((fp) => DEVICE_KEY_RE.test(fp)),
  };
}

async function mirrorToSupabase(uid, ban) {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.warn('[banEnforcement] Supabase not configured, skipping mirror:', e.message);
    return;
  }
  try {
    if (!ban) {
      const { error } = await supabase.from('banned_senders').delete().eq('uid', uid);
      if (error) throw error;
      return;
    }
    const { error } = await supabase.from('banned_senders').upsert({
      uid,
      banned_until: ban.bannedUntil === 'permanent' ? null : new Date(ban.bannedUntil).toISOString(),
      reason: ban.reason || null,
      source: ban.source || null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (e) {
    console.error('[banEnforcement] Supabase mirror failed', uid, e?.message || e);
  }
}

// --------------------------------------------------------------------
// Core
// --------------------------------------------------------------------

/**
 * Ban `uid` everywhere we can reach: banned_uids, every device it has used,
 * the email hash for deleted accounts, Supabase, and (permanent only) the
 * Auth account itself.
 *
 * `ban` = { bannedUntil, strikeCount, reason, bannedAt, bannedByUid, source,
 *           emailKey?, linkedFrom? }
 *
 * Won't replace a stricter active ban, except the mirror of the same email
 * record — that one tracks its source exactly.
 *
 * opts.disableAuth (default true): permanent bans disable the Auth account.
 */
async function applyBan(uid, ban, identity = null, { disableAuth = true } = {}) {
  if (!uid || !isActive(ban.bannedUntil)) return { applied: false, reason: 'inactive' };
  identity = identity || (await resolveIdentity(uid));

  const ref = db().ref(`banned_uids/${uid}`);
  const existing = (await ref.get()).val();
  const sameSource = existing && ban.emailKey && existing.emailKey === ban.emailKey;
  const keepExisting =
    existing && !sameSource && isActive(existing.bannedUntil) &&
    atLeastAsStrict(existing.bannedUntil, ban.bannedUntil) && !atLeastAsStrict(ban.bannedUntil, existing.bannedUntil);
  const effective = keepExisting ? existing : ban;

  const record = {
    bannedUntil: effective.bannedUntil,
    strikeCount: effective.strikeCount || 0,
    reason: effective.reason || null,
    bannedAt: effective.bannedAt || Date.now(),
    bannedByUid: effective.bannedByUid || null,
    source: effective.source || 'server',
    emailKey: effective.emailKey || null,
    linkedFrom: effective.linkedFrom || null,
    authDisabledByBan: existing?.authDisabledByBan === true,
    updatedAt: Date.now(),
  };

  // Permanent bans also disable the Auth account and revoke its sessions, so
  // he is signed out instead of browsing on a stale token.
  if (disableAuth && record.bannedUntil === 'permanent' && identity.exists && !identity.authUser.disabled) {
    try {
      await admin.auth().updateUser(uid, { disabled: true });
      await admin.auth().revokeRefreshTokens(uid);
      record.authDisabledByBan = true;
    } catch (e) {
      console.error('[banEnforcement] disable auth failed', uid, e?.message);
    }
  }

  await ref.set(record);

  const devicePayload = {
    bannedUntil: record.bannedUntil,
    bannedAt: record.bannedAt,
    bannedBy: { uid: record.bannedByUid, displayName: 'Moderation', role: 'Server' },
    reason: record.reason,
    strikeCount: record.strikeCount,
    email: null,
    userId: uid,
    source: 'server',
  };
  let devices = 0;
  for (const fp of identity.devices) {
    const dref = db().ref(`banned_devices/${fp}`);
    const cur = (await dref.get()).val();
    const mayWrite =
      !cur || cur.userId === uid || !isActive(cur.bannedUntil) ||
      atLeastAsStrict(record.bannedUntil, cur.bannedUntil);
    if (mayWrite) {
      await dref.set({ ...devicePayload, email: cur?.email || null });
      devices += 1;
    }
  }

  if (!identity.exists && identity.emailHash) {
    await db().ref(`banned_email_hashes/${identity.emailHash}`).set({
      bannedUntil: record.bannedUntil,
      userId: uid,
      reason: record.reason,
      bannedAt: record.bannedAt,
    });
  }

  await mirrorToSupabase(uid, record);
  return { applied: !keepExisting, devices, bannedUntil: record.bannedUntil };
}

/**
 * Lift the uid ban, the device and email-hash entries it owns, re-enable the
 * Auth account if we disabled it, and lift accounts banned only because they
 * shared a device with this one.
 */
async function liftBan(uid, { cascade = true } = {}) {
  const ref = db().ref(`banned_uids/${uid}`);
  const existing = (await ref.get()).val();
  const identity = await resolveIdentity(uid);

  await ref.remove();

  for (const fp of identity.devices) {
    const dref = db().ref(`banned_devices/${fp}`);
    const cur = (await dref.get()).val();
    if (cur && cur.userId === uid) await dref.remove();
  }

  if (identity.emailHash) {
    const href = db().ref(`banned_email_hashes/${identity.emailHash}`);
    const cur = (await href.get()).val();
    if (cur && cur.userId === uid) await href.remove();
  }

  if (existing?.authDisabledByBan && identity.exists) {
    try {
      await admin.auth().updateUser(uid, { disabled: false });
    } catch (e) {
      console.error('[banEnforcement] re-enable auth failed', uid, e?.message);
    }
  }

  await mirrorToSupabase(uid, null);

  let linkedLifted = 0;
  if (cascade) {
    const linked = await db().ref('banned_uids').orderByChild('linkedFrom').equalTo(uid).get();
    for (const altUid of Object.keys(linked.val() || {})) {
      await liftBan(altUid, { cascade: false });
      linkedLifted += 1;
    }
  }
  return { lifted: !!existing, linkedLifted };
}

// Other accounts that have used any of `identity`'s devices.
async function findLinkedAccounts(identity) {
  const linked = new Map(); // uid -> Set(fp)
  for (const fp of identity.devices) {
    const [accSnap, banSnap] = await Promise.all([
      db().ref(`device_accounts/${fp}`).get(),
      db().ref(`banned_devices/${fp}/userId`).get(),
    ]);
    const uids = new Set(Object.keys(accSnap.val() || {}));
    if (typeof banSnap.val() === 'string') uids.add(banSnap.val());
    for (const other of uids) {
      if (other === identity.uid) continue;
      if (!linked.has(other)) linked.set(other, new Set());
      linked.get(other).add(fp);
    }
  }
  return linked;
}

async function describeAccounts(uids) {
  const list = uids.slice(0, LINKED_LIMIT);
  const authUsers = list.length
    ? (await admin.auth().getUsers(list.map((uid) => ({ uid })))).users
    : [];
  const alive = new Set(authUsers.map((u) => u.uid));
  return Promise.all(list.map(async (uid) => {
    const [nameSnap, banSnap] = await Promise.all([
      db().ref(`users/${uid}/displayName`).get(),
      db().ref(`banned_uids/${uid}`).get(),
    ]);
    const ban = banSnap.val();
    return {
      uid,
      displayName: nameSnap.val() || null,
      exists: alive.has(uid),
      banned: !!ban && isActive(ban.bannedUntil),
      bannedUntil: ban?.bannedUntil || null,
    };
  }));
}

// Shapes a banned_users_by_email record into an applyBan payload.
function banFromEmailRecord(key, rec) {
  const by = rec.bannedBy;
  const bannedByUid =
    by && typeof by === 'object' ? by.uid || null : typeof by === 'string' && UID_RE.test(by) ? by : null;
  return {
    bannedUntil: rec.bannedUntil,
    strikeCount: rec.strikeCount || 0,
    reason: rec.reason || null,
    bannedAt: rec.bannedAt || Date.now(),
    bannedByUid,
    source: 'email',
    emailKey: key,
  };
}

// --------------------------------------------------------------------
// HTTPS: modSanction
// --------------------------------------------------------------------

/**
 * POST { action, targetUid, strikeCount?, minutes?, reason?, includeLinked? }
 * Authorization: Bearer <Firebase ID token of a staff member>
 *
 *   action 'strike'  strikeCount 1 (3 h) | 2 (3 days) | 3 (permanent)
 *   action 'mute'    minutes ≥ 1
 *   action 'unban'
 *   action 'linked'  list other accounts that used the same device(s)
 *
 * Same hierarchy as the app: the caller must strictly outrank the target,
 * and never on themselves. With includeLinked, the same ban is applied to
 * every linked account the caller also outranks.
 */
async function handleModSanction(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'unauthenticated' });
  let caller;
  try {
    caller = await admin.auth().verifyIdToken(m[1], true);
  } catch (e) {
    return res.status(401).json({ error: 'unauthenticated' });
  }

  const body = req.body || {};
  const { action, targetUid } = body;
  if (!['strike', 'mute', 'unban', 'linked'].includes(action)) {
    return res.status(400).json({ error: 'bad_action' });
  }
  if (typeof targetUid !== 'string' || !UID_RE.test(targetUid)) {
    return res.status(400).json({ error: 'bad_target' });
  }
  if (targetUid === caller.uid) return res.status(403).json({ error: 'self_target' });

  const callerRank = await readRank(caller.uid, caller);
  if (callerRank < RANK.babyMod) return res.status(403).json({ error: 'not_staff' });

  const identity = await resolveIdentity(targetUid);
  const targetRank = await readRank(targetUid, identity.authUser);
  if (callerRank <= targetRank) return res.status(403).json({ error: 'outranked' });

  const summary = {
    accountExists: identity.exists,
    accountDeleted: identity.deleted,
    hasEmail: !!identity.email,
    devices: identity.devices.length,
  };

  if (action === 'linked') {
    const linked = await findLinkedAccounts(identity);
    const accounts = await describeAccounts([...linked.keys()]);
    for (const a of accounts) a.sharedDevices = linked.get(a.uid).size;
    return res.json({ ok: true, ...summary, linked: accounts, linkedTotal: linked.size });
  }

  if (action === 'unban') {
    if (identity.email) await db().ref(`banned_users_by_email/${encodeEmailKey(identity.email)}`).remove();
    const out = await liftBan(targetUid);
    return res.json({ ok: true, ...summary, ...out });
  }

  let bannedUntil;
  let strikeCount;
  let reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  if (action === 'strike') {
    strikeCount = Number(body.strikeCount);
    if (![1, 2, 3].includes(strikeCount)) return res.status(400).json({ error: 'bad_strike' });
    bannedUntil = strikeCount === 3 ? 'permanent' : Date.now() + STRIKE_DURATION_MS[strikeCount];
    reason = reason || `Strike ${strikeCount}`;
  } else {
    const minutes = Math.floor(Number(body.minutes));
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60 * 24 * 30) {
      return res.status(400).json({ error: 'bad_minutes' });
    }
    bannedUntil = Date.now() + minutes * 60 * 1000;
    strikeCount = 0;
    reason = reason || `Muted for ${minutes} min`;
  }

  const ban = {
    bannedUntil,
    strikeCount,
    reason,
    bannedAt: Date.now(),
    bannedByUid: caller.uid,
    source: 'uid',
  };

  // Keep the email record too when there is one, so older app builds that
  // only listen by email still see the ban. Same no-downgrade rule as the app.
  if (identity.email) {
    const key = encodeEmailKey(identity.email);
    const eref = db().ref(`banned_users_by_email/${key}`);
    const cur = (await eref.get()).val();
    if (cur && isActive(cur.bannedUntil) && !atLeastAsStrict(bannedUntil, cur.bannedUntil)) {
      return res.status(409).json({ error: 'stricter_ban_active', ...summary });
    }
    const nameSnap = await db().ref(`users/${targetUid}/displayName`).get();
    await eref.set({
      strikeCount,
      bannedUntil,
      reason,
      email: identity.email,
      displayName: nameSnap.val() || 'Unknown',
      userId: targetUid,
      bannedAt: ban.bannedAt,
      bannedBy: { uid: caller.uid, displayName: caller.name || 'Staff', role: 'Staff' },
    });
    ban.source = 'email';
    ban.emailKey = key;
  }

  const out = await applyBan(targetUid, ban, identity);

  let linkedBanned = 0;
  if (body.includeLinked === true) {
    const linked = await findLinkedAccounts(identity);
    for (const altUid of [...linked.keys()].slice(0, LINKED_LIMIT)) {
      const alt = await resolveIdentity(altUid);
      if (callerRank <= (await readRank(altUid, alt.authUser))) continue;
      const r = await applyBan(altUid, {
        ...ban,
        source: 'linked',
        emailKey: null,
        linkedFrom: targetUid,
        reason: `${reason} (linked account)`,
      }, alt);
      if (r.applied) linkedBanned += 1;
    }
  }

  return res.json({ ok: true, ...summary, ...out, linkedBanned });
}

exports.modSanction = functions
  .runWith({ secrets: SECRETS, memory: '256MB', timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    try {
      await handleModSanction(req, res);
    } catch (e) {
      console.error('[modSanction]', e?.message || e);
      if (!res.headersSent) res.status(500).json({ error: 'internal' });
    }
  });

// --------------------------------------------------------------------
// RTDB: syncEmailBan — every existing client ban path feeds the server
// --------------------------------------------------------------------

exports.syncEmailBan = functions
  .runWith({ secrets: SECRETS, memory: '256MB', timeoutSeconds: 60 })
  .database.ref('/banned_users_by_email/{emailKey}')
  .onWrite(async (change, context) => {
    const { emailKey } = context.params;
    const before = change.before.val();
    const after = change.after.val();
    try {
      if (!after) {
        const uid = before?.userId;
        if (!uid) return null;
        const cur = (await db().ref(`banned_uids/${uid}/emailKey`).get()).val();
        if (cur === emailKey) await liftBan(uid);
        return null;
      }

      // The app tags the record with deviceId(s) right after writing it —
      // nothing about the ban itself changed, so don't redo the work.
      if (
        before &&
        before.bannedUntil === after.bannedUntil &&
        before.strikeCount === after.strikeCount &&
        before.userId === after.userId
      ) return null;

      if (!isActive(after.bannedUntil)) return null;

      let uid = typeof after.userId === 'string' && UID_RE.test(after.userId) ? after.userId : null;
      if (!uid) {
        try {
          uid = (await admin.auth().getUserByEmail(decodeEmailKey(emailKey))).uid;
        } catch (_) { /* no live account for this email */ }
      }
      if (!uid) return null;

      // The rules let any staff member write this node; the server holds the
      // line on hierarchy before it escalates (Auth disable, device bans).
      const ban = banFromEmailRecord(emailKey, after);
      if (ban.bannedByUid) {
        const bannerRank = await readRank(ban.bannedByUid, await getAuthUser(ban.bannedByUid));
        const identity = await resolveIdentity(uid);
        if (bannerRank <= (await readRank(uid, identity.authUser))) {
          console.warn('[syncEmailBan] banner does not outrank target, not escalating', emailKey);
          return null;
        }
        await applyBan(uid, ban, identity);
      } else {
        await applyBan(uid, ban);
      }
    } catch (e) {
      console.error('[syncEmailBan]', emailKey, e?.message || e);
    }
    return null;
  });

// --------------------------------------------------------------------
// RTDB: device ↔ account index + ban evasion
// --------------------------------------------------------------------

// Shared by both device triggers. `removed` = the deviceId was deleted (the
// account is being deleted): index the last value, nothing else.
async function onDeviceSeen(uid, fp, removed) {
  const now = Date.now();
  await db().ref().update({
    [`device_accounts/${fp}/${uid}`]: now,
    [`account_devices/${uid}/${fp}`]: now,
  });
  if (removed) return;

  // 1. This account is banned and just showed up on a new device.
  const own = (await db().ref(`banned_uids/${uid}`).get()).val();
  if (own && isActive(own.bannedUntil)) {
    await applyBan(uid, own);
    return;
  }

  // 2. This device is banned for someone else → ban evasion.
  const dev = (await db().ref(`banned_devices/${fp}`).get()).val();
  if (!dev || !isActive(dev.bannedUntil) || !dev.userId || dev.userId === uid) return;
  const identity = await resolveIdentity(uid);
  if ((await readRank(uid, identity.authUser)) > RANK.user) return; // never auto-ban staff
  await applyBan(uid, {
    bannedUntil: dev.bannedUntil,
    strikeCount: dev.strikeCount || 0,
    reason: `Ban evasion: same device as ${dev.userId}`,
    bannedAt: now,
    bannedByUid: null,
    source: 'device',
    linkedFrom: dev.userId,
  }, identity);
  console.log(`[banEnforcement] ${uid} banned: device ${fp} belongs to banned ${dev.userId}`);
}

// Current builds stamp users_private/{uid}/deviceId (owner + staff readable).
// Account deletion removes users_private after users/{uid}, so the last
// deviceId only survives in the before-snapshot: it is indexed anyway.
exports.indexDeviceAccount = functions
  .runWith({ secrets: SECRETS, memory: '256MB', timeoutSeconds: 60 })
  .database.ref('/users_private/{uid}/deviceId')
  .onWrite(async (change, context) => {
    const { uid } = context.params;
    const removed = !change.after.exists();
    const fp = removed ? change.before.val() : change.after.val();
    if (typeof fp !== 'string' || !DEVICE_KEY_RE.test(fp)) return null;
    try {
      await onDeviceSeen(uid, fp, removed);
    } catch (e) {
      console.error('[indexDeviceAccount]', uid, e?.message || e);
    }
    return null;
  });

// Older builds stamp the PUBLIC users/{uid}/deviceId, which anyone can read —
// enough for a troll to copy a victim's fingerprint onto his own account and
// get the victim's phone banned with him. Index it, move it to users_private,
// and delete the public copy.
exports.indexLegacyDeviceAccount = functions
  .runWith({ secrets: SECRETS, memory: '256MB', timeoutSeconds: 60 })
  .database.ref('/users/{uid}/deviceId')
  .onWrite(async (change, context) => {
    const { uid } = context.params;
    const removed = !change.after.exists();
    const fp = removed ? change.before.val() : change.after.val();
    if (typeof fp !== 'string' || !DEVICE_KEY_RE.test(fp)) return null;
    try {
      if (removed) {
        await onDeviceSeen(uid, fp, true);
        return null;
      }
      // Only while the account still exists: writing users_private for a
      // deleted user would resurrect a record the delete flow just removed.
      const userSnap = await db().ref(`users/${uid}/createdAt`).get();
      const updates = { [`users/${uid}/deviceId`]: null };
      if (userSnap.exists()) updates[`users_private/${uid}/deviceId`] = fp;
      await db().ref().update(updates); // users_private trigger does the indexing
      if (!userSnap.exists()) await onDeviceSeen(uid, fp, false);
    } catch (e) {
      console.error('[indexLegacyDeviceAccount]', uid, e?.message || e);
    }
    return null;
  });

// --------------------------------------------------------------------
// Auth: banCheckOnSignup — a returning email is banned again
// --------------------------------------------------------------------

exports.banCheckOnSignup = functions
  .runWith({ secrets: SECRETS, memory: '256MB', timeoutSeconds: 60 })
  .auth.user()
  .onCreate(async (user) => {
    const email = normEmail(user.email);
    if (!email) return null;
    try {
      const key = encodeEmailKey(email);
      const [recSnap, hashSnap] = await Promise.all([
        db().ref(`banned_users_by_email/${key}`).get(),
        db().ref(`banned_email_hashes/${hashEmail(email)}`).get(),
      ]);
      const rec = recSnap.val();
      if (rec && isActive(rec.bannedUntil)) {
        await applyBan(user.uid, { ...banFromEmailRecord(key, rec), linkedFrom: rec.userId !== user.uid ? rec.userId || null : null });
        return null;
      }
      const h = hashSnap.val();
      if (h && isActive(h.bannedUntil)) {
        await applyBan(user.uid, {
          bannedUntil: h.bannedUntil,
          strikeCount: 0,
          reason: `Ban evasion: re-registered email of ${h.userId}`,
          bannedAt: Date.now(),
          bannedByUid: null,
          source: 'email_hash',
          linkedFrom: h.userId || null,
        });
      }
    } catch (e) {
      console.error('[banCheckOnSignup]', user.uid, e?.message || e);
    }
    return null;
  });

// --------------------------------------------------------------------
// Auth: tombstoneDeletedAccount — keep enough to ban a deleted account
// --------------------------------------------------------------------

exports.tombstoneDeletedAccount = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .auth.user()
  .onDelete(async (user) => {
    try {
      const devicesSnap = await db().ref(`account_devices/${user.uid}`).get();
      const devices = {};
      for (const fp of Object.keys(devicesSnap.val() || {})) devices[fp] = true;
      await db().ref(`deleted_accounts/${user.uid}`).set({
        emailHash: hashEmail(user.email),
        phone: user.phoneNumber || null,
        providers: (user.providerData || []).map((p) => p.providerId),
        devices,
        deletedAt: Date.now(),
      });
    } catch (e) {
      console.error('[tombstoneDeletedAccount]', user.uid, e?.message || e);
    }
    return null;
  });

// Exposed for tests and scripts.
exports._internal = {
  applyBan,
  liftBan,
  resolveIdentity,
  findLinkedAccounts,
  readRank,
  banFromEmailRecord,
  hashEmail,
  encodeEmailKey,
  isActive,
  atLeastAsStrict,
  handleModSanction,
};
