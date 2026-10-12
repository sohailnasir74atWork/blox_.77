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
 *   banned_uids/{uid}              uid-keyed ban or mute (`type`), server-written
 *                                  only. The app listens to it next to the
 *                                  email/device bans.
 *   banned_devices/{fp}.banners    every uid whose BAN covers this device; the
 *                                  device is free only when the set is empty.
 *   device_accounts/{fp}/{uid}     first time an account was seen on a device
 *   account_devices/{uid}/{fp}     (same value, other direction; server-only)
 *   deleted_accounts/{uid}         tombstone kept when an account is deleted:
 *                                  sha256(email), sha256(phone), devices.
 *   banned_email_hashes/{hash}     ban on an email / phone we only know as a
 *   banned_phone_hashes/{hash}     hash (deleted accounts) — matched at sign-up.
 *   Supabase banned_senders        bans AND mutes; read by a BEFORE INSERT
 *                                  trigger on every message table (030).
 *   Firestore banned_uids/{uid}    BANS only { type, permanent, until,
 *                                  updatedAt } — read by firestore.rules.
 *
 * TRUST
 * banned_users_by_email/{key} is written by staff phones. The server never
 * trusts the record's `bannedBy`: syncEmailBan ranks the real writer
 * (context.auth.uid). A write the writer may not make is reverted (the
 * previous record is restored, or the new one deleted) so the app doesn't
 * enforce it either. Admin-SDK writes are trusted; unauthenticated ones are
 * ignored.
 *
 * Hierarchy (MODERATION_CONTRACT §2):
 *   - actor strictly outranks the target, never self;
 *   - staff targets (JMD+) only by admin/owner;
 *   - JMD: mute ≤ 2 h and unmute only;
 *   - lifting or softening needs actor rank ≥ the original banner's rank.
 *
 * Mutes are chat-only: Supabase YES; devices, Auth disable, Firestore NO.
 *
 * applyBan / liftBan are the single core. Everything below calls them:
 *   modSanction              HTTPS (Bearer ID token) — strike/mute/unban/
 *                            unmute/linked/log by UID.
 *   syncEmailBan             banned_users_by_email/{key} onWrite.
 *   indexDeviceAccount       users_private/{uid}/deviceId onWrite — device
 *                            index + ban-evasion check.
 *   indexLegacyDeviceAccount users/{uid}/deviceId (old builds) — same, then
 *                            moves the value off the public node.
 *   banCheckOnSignup         Auth onCreate — re-ban a returning email / phone.
 *   tombstoneDeletedAccount  Auth onDelete — keep what's needed to re-ban.
 *   reconcileBanMirrors      every 6 h — Supabase + Firestore mirrors vs
 *                            banned_uids (mirror writes are best-effort).
 *
 * Deploy: firebase deploy --only functions:modSanction,functions:syncEmailBan,functions:indexDeviceAccount,functions:indexLegacyDeviceAccount,functions:banCheckOnSignup,functions:tombstoneDeletedAccount,functions:reconcileBanMirrors
 */

const crypto = require('crypto');
const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { Timestamp, FieldValue, FieldPath } = require('firebase-admin/firestore');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = () => admin.database();
const firestore = () => admin.firestore();

const SECRETS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

// Mirrors the email allowlist in database.rules.json. Server-side only: the
// app learns who the owners are from users/{uid}/owner, which
// reconcileRolesMirror sets from this list.
const OWNER_EMAILS = new Set([
  'thesolanalabs@gmail.com',
  'sohailnasir74business@gmail.com',
  'sohailnasir74@gmail.com',
]);

// Same ladder as STAFF_RANK in Code/ChatScreen/utils.js. Owner = a VERIFIED
// owner email; owner outranks admin.
const RANK = { owner: 5, admin: 4, seniorMod: 3, moderator: 2, babyMod: 1, user: 0 };
const isStaffRank = (r) => r >= RANK.babyMod;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const STRIKE_DURATION_MS = { 1: 3 * HOUR, 2: 3 * 24 * HOUR }; // 3 → permanent
const JMD_MAX_MUTE_MIN = 120;
const MAX_MUTE_MIN = 60 * 24 * 30;

// Device fingerprints are ANDROID_ID hex or an iOS UUID, already sanitised
// for RTDB keys by Code/Helper/deviceFingerprint.js.
const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{6,128}$/;
const UID_RE = /^[A-Za-z0-9]{10,128}$/;

// Ids many unrelated phones report. Banning one bans everybody behind it.
//   9774d56d682e549c  the Android 2.2 ANDROID_ID bug (millions of devices)
//   0123456789abcdef  default serial on many MTK / emulator images
//   all-zero / one repeated char: IDFV "unavailable", blank Android ids
const DEVICE_DENYLIST = new Set([
  'unknown', 'unknown_device', 'null', 'undefined', 'none', 'nil', 'android_id',
  'emulator', 'generic', 'simulator', 'default', 'device', 'deviceid',
  '9774d56d682e549c', '0123456789abcdef', '0123456789abcdef0', 'abcdef0123456789',
  '1234567890abcdef', '1234567890', '12345678', '123456789',
]);
const isBadDeviceId = (fp) => {
  if (typeof fp !== 'string' || !DEVICE_KEY_RE.test(fp)) return true;
  const low = fp.toLowerCase();
  if (DEVICE_DENYLIST.has(low)) return true;
  if (/^[0_-]+$/.test(low)) return true;          // all zero (incl. 00000000-0000-…)
  const hex = low.replace(/[_-]/g, '');
  return /^(.)\1+$/.test(hex);                    // ffff…, aaaa…
};

// Device spreading limits (spoofing / shared-device protection).
const DEVICE_CAP = 5;            // more eligible devices than this → mark suspect, ban none
const DEVICE_SHARED_LIMIT = 3;   // ≥ this many other unbanned accounts → shared, skip
const DEVICE_SCAN_LIMIT = 20;    // more accounts than this on one device → shared, skip
const DEVICE_SEEN_SLACK_MS = MINUTE;

const LINKED_LIMIT = 25;
const REASON_MAX = 500;
const EVIDENCE_MAX = 3;
const EVIDENCE_URL_MAX = 1000;
const DETAILS_MAX_BYTES = 2048;
const LOG_ACTIONS = new Set([
  'message_delete', 'delete_all', 'pin', 'unpin', 'role_change', 'review_delete', 'profile_delete',
]);
const ACTIONS = new Set(['strike', 'mute', 'unban', 'unmute', 'linked', 'log']);

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

const normEmail = (e) => (typeof e === 'string' && e.trim() ? e.trim().toLowerCase() : null);

// Same encoding as Code/Helper/banKeys.js: trim, lowercase, '.' → '(dot)'.
const encodeEmailKey = (email) => normEmail(email).replace(/\./g, '(dot)');
const decodeEmailKey = (key) => String(key).replace(/\(dot\)/g, '.');
// Legacy mixed-case keys (old builds) → the lowercase key (AdoptMe canonicalBanKey).
const canonicalBanKey = (rawKey) => String(rawKey || '').trim().toLowerCase();

// Peppered so the stored value isn't a bare sha256 of the address.
const EMAIL_HASH_PEPPER = 'bloxfruit-ban-v1';
const PHONE_HASH_PEPPER = 'bloxfruit-ban-phone-v1';
const hashEmail = (email) => {
  const e = normEmail(email);
  return e ? crypto.createHash('sha256').update(`${EMAIL_HASH_PEPPER}:${e}`).digest('hex') : null;
};
const hashPhone = (phone) => {
  const p = typeof phone === 'string' ? phone.replace(/[^\d+]/g, '') : '';
  return p.length >= 5 ? crypto.createHash('sha256').update(`${PHONE_HASH_PEPPER}:${p}`).digest('hex') : null;
};

const isActive = (until, now = Date.now()) =>
  until === 'permanent' || (typeof until === 'number' && until > now);

// Is ban `a` at least as strict as ban `b`?
const atLeastAsStrict = (a, b) => {
  if (a === 'permanent') return true;
  if (b === 'permanent') return false;
  return (typeof a === 'number' ? a : 0) >= (typeof b === 'number' ? b : 0);
};

const asRecord = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

// MODERATION_CONTRACT §3: `type` when present.
// Legacy EMAIL records (old builds) — same rule as isMuteRecord in
// Code/Helper/banKeys.js: a mute when the reason has the mute prefix, or
// bannedBy is a plain string / bannerAvatar is set (only the old muteUser
// wrote those), or there is no strike count (every old strike writer set one).
// Legacy SERVER records (banned_uids before `type`, recognisable by `source`
// and no `bannedBy`): automatic evasion bans carry strikeCount 0, so the
// source decides first.
const AUTO_BAN_SOURCES = new Set(['device', 'email_hash', 'phone_hash', 'linked', 'server']);
const recordType = (rec) => {
  if (!rec || typeof rec !== 'object') return 'ban';
  if (rec.type === 'mute' || rec.type === 'ban') return rec.type;
  if (/^Muted for/i.test(rec.reason || '')) return 'mute';
  if ('source' in rec && !('bannedBy' in rec)) {
    if (AUTO_BAN_SOURCES.has(rec.source)) return 'ban';
    return Number(rec.strikeCount) >= 1 ? 'ban' : 'mute';
  }
  if (typeof rec.bannedBy === 'string' || 'bannerAvatar' in rec) return 'mute';
  return Number(rec.strikeCount) >= 1 ? 'ban' : 'mute';
};

// Would `next` loosen what `prev` enforces? A ban over a mute is never softer.
const isSofter = (next, prev) => {
  const nt = recordType(next);
  const pt = recordType(prev);
  if (pt === 'mute' && nt === 'ban') return false;
  if (pt === 'ban' && nt === 'mute') return true;
  return !atLeastAsStrict(next.bannedUntil, prev.bannedUntil);
};

// The enforcement-relevant fields of an email record (AdoptMe
// enforcementFingerprint). deviceId tags etc. don't change it.
const banFingerprint = (rec) => {
  const r = asRecord(rec);
  if (!r) return 'none';
  return JSON.stringify([
    r.userId ?? null, r.bannedUntil ?? null, r.strikeCount ?? null, r.reason ?? null, r.type ?? null,
  ]);
};

// bannedBy is { uid, … } (strikes, new mutes) or '<uid>' (old mutes).
const bannerUidOf = (rec) => {
  if (!rec) return null;
  if (typeof rec.bannedByUid === 'string' && UID_RE.test(rec.bannedByUid)) return rec.bannedByUid;
  const by = rec.bannedBy;
  if (by && typeof by === 'object' && typeof by.uid === 'string' && UID_RE.test(by.uid)) return by.uid;
  if (typeof by === 'string' && UID_RE.test(by)) return by;
  return null;
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
// a decoded ID token, a v1 context.auth.token or an Auth UserRecord — all
// carry email and email_verified/emailVerified.
async function readRank(uid, identity = null) {
  const email = normEmail(identity?.email);
  const verified = identity?.email_verified === true || identity?.emailVerified === true;
  if (email && verified && OWNER_EMAILS.has(email)) return RANK.owner;
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

const rankOfUid = async (uid) => (uid ? readRank(uid, await getAuthUser(uid)) : RANK.user);

// Rank of whoever placed `rec`. banned_uids records carry the rank at ban
// time; email records only a uid. Bans with no banner (automatic evasion
// bans) count as moderator, banner-less mutes as JMD.
async function bannerRankOf(rec) {
  if (typeof rec?.bannedByRank === 'number') return rec.bannedByRank;
  const by = bannerUidOf(rec);
  if (by) return rankOfUid(by);
  return recordType(rec) === 'mute' ? RANK.babyMod : RANK.moderator;
}

// ── Permission checks (MODERATION_CONTRACT §2). Return an error code or null.
function checkActorOverTarget(actor, targetUid, targetRank) {
  if (!isStaffRank(actor.rank)) return 'not_staff';
  if (targetUid && actor.uid === targetUid) return 'self_target';
  if (actor.rank <= targetRank) return 'outranked';
  if (isStaffRank(targetRank) && actor.rank < RANK.admin) return 'staff_immune';
  return null;
}

function checkSanction(actor, targetUid, targetRank, { type, minutes, permanent }) {
  const base = checkActorOverTarget(actor, targetUid, targetRank);
  if (base) return base;
  if (actor.rank === RANK.babyMod && (type !== 'mute' || permanent || !(minutes <= JMD_MAX_MUTE_MIN))) {
    return 'rank_limit';
  }
  return null;
}

// Lifting or softening `rec`: JMD only touches mutes; otherwise the actor's
// rank must reach the banner's. Admin/owner can always lift.
async function checkLift(actor, rec) {
  if (actor.rank === RANK.babyMod && recordType(rec) !== 'mute') return 'rank_limit';
  if (actor.rank >= RANK.admin) return null;
  return actor.rank >= (await bannerRankOf(rec)) ? null : 'banner_outranks';
}

// Everything we can still find out about an account, live or deleted.
async function resolveIdentity(uid) {
  const [authUser, privEmailSnap, tombSnap, devicesSnap, stampedSnap, legacySnap] = await Promise.all([
    getAuthUser(uid),
    db().ref(`users_private/${uid}/email`).get(),
    db().ref(`deleted_accounts/${uid}`).get(),
    db().ref(`account_devices/${uid}`).get(),
    db().ref(`users_private/${uid}/deviceId`).get(),
    db().ref(`users/${uid}/deviceId`).get(), // not yet moved by indexLegacyDeviceAccount
  ]);
  const tomb = tombSnap.val() || null;
  const rawEmail = (typeof authUser?.email === 'string' && authUser.email.trim()) ||
    (typeof privEmailSnap.val() === 'string' && privEmailSnap.val().trim()) || null;
  const email = normEmail(rawEmail);

  // fp → first time seen on this account (null = not indexed yet).
  const deviceSeen = {};
  for (const [fp, at] of Object.entries(devicesSnap.val() || {})) {
    deviceSeen[fp] = typeof at === 'number' ? at : null;
  }
  for (const fp of Object.keys(tomb?.devices || {})) if (!(fp in deviceSeen)) deviceSeen[fp] = null;
  for (const v of [stampedSnap.val(), legacySnap.val()]) {
    if (typeof v === 'string' && !(v in deviceSeen)) deviceSeen[v] = null;
  }
  const allDevices = Object.keys(deviceSeen).filter((fp) => DEVICE_KEY_RE.test(fp));

  return {
    uid,
    exists: !!authUser,
    authUser,
    email,
    rawEmail,
    emailHash: email ? hashEmail(email) : tomb?.emailHash || null,
    phone: authUser?.phoneNumber || tomb?.phone || null,
    phoneHash: hashPhone(authUser?.phoneNumber) || tomb?.phoneHash || hashPhone(tomb?.phone) || null,
    deleted: !authUser && !!tomb,
    deviceSeen,
    allDevices,                                        // for lifting
    devices: allDevices.filter((fp) => !isBadDeviceId(fp)), // for banning / linking
  };
}

// ── Supabase (optional: no SUPABASE_URL → every Supabase step is skipped) ──
let supabaseOverride; // tests inject a fake client (or null)
let warnedNoSupabase = false;
function supa() {
  if (supabaseOverride !== undefined) return supabaseOverride;
  try {
    return getSupabaseAdmin();
  } catch (e) {
    if (!warnedNoSupabase) {
      console.warn('[banEnforcement] Supabase not configured, skipping Supabase steps:', e.message);
      warnedNoSupabase = true;
    }
    return null;
  }
}

const sendersRow = (uid, rec) => ({
  uid,
  banned_until: rec.bannedUntil === 'permanent' ? null : new Date(rec.bannedUntil).toISOString(),
  reason: rec.reason || null,
  source: rec.source || null,
  updated_at: new Date().toISOString(),
});

// Bans and mutes both block chat. Failures are logged; reconcileBanMirrors
// repairs them.
async function mirrorToSupabase(uid, rec) {
  const sb = supa();
  if (!sb) return false;
  try {
    if (!rec) {
      const { error } = await sb.from('banned_senders').delete().eq('uid', uid);
      if (error) throw error;
      return true;
    }
    const { error } = await sb.from('banned_senders').upsert(sendersRow(uid, rec));
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('[banEnforcement] Supabase mirror failed (reconcile will retry)', uid, e?.message || e);
    return false;
  }
}

// Firestore banned_uids/{uid} (MODERATION_CONTRACT §5): active BANS only.
const firestoreBanDoc = (rec) => {
  const permanent = rec.bannedUntil === 'permanent';
  return {
    type: 'ban',
    permanent,
    until: permanent ? null : Timestamp.fromMillis(rec.bannedUntil),
    updatedAt: FieldValue.serverTimestamp(),
  };
};

async function mirrorToFirestore(uid, rec) {
  try {
    const ref = firestore().collection('banned_uids').doc(uid);
    if (!rec || recordType(rec) !== 'ban' || !isActive(rec.bannedUntil)) {
      await ref.delete();
      return true;
    }
    await ref.set(firestoreBanDoc(rec));
    return true;
  } catch (e) {
    console.error('[banEnforcement] Firestore mirror failed (reconcile will retry)', uid, e?.message || e);
    return false;
  }
}

// ── Audit log (supabase/031_mod_actions.sql, + evidence/details in 032) ──
// Best-effort and never throws: a failed log row must not fail a ban.
// mod_actions.actor_role has no 'owner' (031 check constraint): logged as admin.
const ROLE_NAME = { [RANK.owner]: 'admin', [RANK.admin]: 'admin', [RANK.seniorMod]: 'senior_mod', [RANK.moderator]: 'moderator', [RANK.babyMod]: 'baby_mod' };

async function actorInfo(uid) {
  if (!uid) return { actor_uid: null, actor_name: null, actor_role: 'system' };
  try {
    const [rank, nameSnap] = await Promise.all([rankOfUid(uid), db().ref(`users/${uid}/displayName`).get()]);
    return { actor_uid: uid, actor_name: nameSnap.val() || null, actor_role: ROLE_NAME[rank] || null };
  } catch (_) {
    return { actor_uid: uid, actor_name: null, actor_role: null };
  }
}

async function logModAction(row) {
  const sb = supa();
  if (!sb) return false;
  const r = {};
  for (const [k, v] of Object.entries(row)) if (v !== undefined) r[k] = v;
  if (Array.isArray(r.evidence) && r.evidence.length === 0) delete r.evidence;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await sb.from('mod_actions').insert(r);
      if (!error) return true;
      const msg = `${error.code || ''} ${error.message || ''}`;
      // 032 not applied yet: drop the new columns and retry.
      if (('evidence' in r || 'details' in r) && /evidence|details/i.test(msg) &&
        /column|schema|PGRST204|42703/i.test(msg)) {
        delete r.evidence;
        delete r.details;
        continue;
      }
      // Older action check constraint (031) has no 'unmute'.
      if (r.action === 'unmute' && /23514|check/i.test(msg)) {
        r.action = 'unban';
        continue;
      }
      throw error;
    }
  } catch (e) {
    console.warn('[banEnforcement] mod_actions log failed:', e?.message || e);
  }
  return false;
}

// Row fields describing a ban/mute payload.
function banRowFields(ban, type = recordType(ban)) {
  const isMute = type === 'mute';
  const permanent = ban.bannedUntil === 'permanent';
  const until = typeof ban.bannedUntil === 'number' ? ban.bannedUntil : null;
  return {
    action: isMute ? 'mute' : 'strike',
    reason: ban.reason || null,
    strike_count: isMute ? null : (ban.strikeCount || null),
    duration_minutes: isMute && until ? Math.max(1, Math.round((until - (ban.bannedAt || Date.now())) / 60000)) : null,
    banned_until_ms: until,
    is_permanent: permanent,
  };
}

async function recentlyLoggedUnban(uid) {
  const sb = supa();
  if (!sb) return false;
  try {
    const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data } = await sb.from('mod_actions').select('id')
      .eq('target_uid', uid).in('action', ['unban', 'unmute']).gte('created_at', since).limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch (_) {
    return false;
  }
}

const displayNameOf = async (uid) =>
  (uid ? (await db().ref(`users/${uid}/displayName`).get()).val() || null : null);

// --------------------------------------------------------------------
// Devices: banned_devices/{fp} = top-level fields of the strictest active
// banner (what every app build reads) + `banners: { uid: entry }`.
// --------------------------------------------------------------------

const bannerEntry = (r) => ({
  bannedUntil: r.bannedUntil,
  bannedAt: r.bannedAt || null,
  reason: r.reason || null,
  strikeCount: r.strikeCount || 0,
  bannedByUid: r.bannedByUid || bannerUidOf(r) || null,
});

// Legacy entries (client-written, no `banners`) keep their owner as a banner.
function bannersOf(cur) {
  const c = asRecord(cur);
  if (!c) return {};
  if (asRecord(c.banners)) return { ...c.banners };
  if (!isActive(c.bannedUntil)) return {};
  const owner = typeof c.userId === 'string' && UID_RE.test(c.userId) ? c.userId : '_legacy';
  return { [owner]: bannerEntry(c) };
}

function activeBanners(banners, now = Date.now()) {
  const out = {};
  for (const [k, e] of Object.entries(banners || {})) if (e && isActive(e.bannedUntil, now)) out[k] = e;
  return out;
}

function strictestBanner(banners) {
  let best = null;
  for (const [k, e] of Object.entries(banners)) {
    if (!best || !atLeastAsStrict(best[1].bannedUntil, e.bannedUntil)) best = [k, e];
  }
  return best;
}

function deviceNodeFrom(banners, cur) {
  const top = strictestBanner(banners);
  if (!top) return null;
  const [owner, e] = top;
  return {
    bannedUntil: e.bannedUntil,
    bannedAt: e.bannedAt || null,
    bannedBy: { uid: e.bannedByUid || null, displayName: 'Moderation', role: 'Server' },
    reason: e.reason || null,
    strikeCount: e.strikeCount || 0,
    email: cur && cur.userId === owner ? cur.email || null : null,
    userId: owner === '_legacy' ? null : owner,
    source: 'server',
    banners,
  };
}

async function addDeviceBanner(fp, uid, rec) {
  await db().ref(`banned_devices/${fp}`).transaction((cur) => {
    const banners = bannersOf(cur);
    banners[uid] = bannerEntry(rec);
    return deviceNodeFrom(activeBanners(banners), asRecord(cur));
  });
}

// Removes only `uid`'s entry; the device is unbanned when none is left.
async function removeDeviceBanner(fp, uid) {
  await db().ref(`banned_devices/${fp}`).transaction((cur) => {
    if (cur === null) return null; // uncached first pass — the server value follows
    const banners = bannersOf(cur);
    if (!(uid in banners)) return undefined; // not ours: leave untouched
    delete banners[uid];
    return deviceNodeFrom(activeBanners(banners), asRecord(cur));
  });
}

// Why a device must not be banned for `uid`: it has a staff account, or it
// is shared by many unbanned accounts (family phone, or a spoofed id).
async function deviceShield(fp, uid) {
  const others = Object.keys((await db().ref(`device_accounts/${fp}`).get()).val() || {})
    .filter((o) => o !== uid && UID_RE.test(o));
  if (others.length > DEVICE_SCAN_LIMIT) return 'shared';
  const info = await Promise.all(others.map(async (o) => {
    const [rank, banSnap] = await Promise.all([rankOfUid(o), db().ref(`banned_uids/${o}`).get()]);
    const b = banSnap.val();
    return { staff: isStaffRank(rank), banned: !!b && isActive(b.bannedUntil) && recordType(b) === 'ban' };
  }));
  if (info.some((i) => i.staff)) return 'staff';
  if (info.filter((i) => !i.banned).length >= DEVICE_SHARED_LIMIT) return 'shared';
  return null;
}

// Only devices the account used BEFORE the ban (a fingerprint copied onto a
// banned account afterwards is not his device), at most DEVICE_CAP of them.
async function spreadToDevices(uid, rec, identity) {
  const cutoff = (rec.banStartedAt || rec.bannedAt || Date.now()) + DEVICE_SEEN_SLACK_MS;
  const eligible = identity.devices.filter((fp) => {
    const seen = identity.deviceSeen?.[fp];
    return seen == null || seen <= cutoff;
  });
  if (eligible.length > DEVICE_CAP) {
    console.warn(`[banEnforcement] ${uid}: ${eligible.length} devices > cap ${DEVICE_CAP}; marked suspect, no device bans`);
    return { devices: 0, suspect: eligible.length, skipped: [] };
  }
  let devices = 0;
  const skipped = [];
  for (const fp of eligible) {
    const why = await deviceShield(fp, uid);
    if (why) {
      skipped.push({ fp, why });
      continue;
    }
    await addDeviceBanner(fp, uid, rec);
    devices += 1;
  }
  return { devices, suspect: 0, skipped };
}

// --------------------------------------------------------------------
// Core
// --------------------------------------------------------------------

/**
 * Ban or mute `uid` everywhere we can reach.
 *
 * `ban` = { type ('ban'|'mute'), bannedUntil, strikeCount, reason, bannedAt,
 *           bannedByUid, bannedByRank, source, emailKey?, linkedFrom? }
 *
 * Never replaces a stricter active record (a mute never replaces an active
 * ban) unless opts.allowSoften — callers pass it only after checking the
 * actor may soften (checkLift).
 *
 * Bans: banned_uids, devices, email/phone hashes (deleted accounts),
 * Supabase, Firestore, and (permanent, opts.disableAuth) the Auth account.
 * Mutes: banned_uids + Supabase only; the strikeCount is preserved.
 */
async function applyBan(uid, ban, identity = null, { disableAuth = true, allowSoften = false } = {}) {
  if (!uid || !isActive(ban.bannedUntil)) return { applied: false, reason: 'inactive' };
  const type = ban.type === 'mute' ? 'mute' : 'ban';
  identity = identity || (await resolveIdentity(uid));

  const ref = db().ref(`banned_uids/${uid}`);
  const existing = asRecord((await ref.get()).val());
  const exActive = !!existing && isActive(existing.bannedUntil);
  const exType = existing ? recordType(existing) : null;
  if (exActive && !allowSoften && isSofter({ ...ban, type }, existing)) {
    return { applied: false, reason: 'stricter_active', type: exType, bannedUntil: existing.bannedUntil, devices: 0 };
  }

  const now = Date.now();
  const record = {
    type,
    bannedUntil: ban.bannedUntil,
    strikeCount: type === 'mute'
      ? Math.max(existing?.strikeCount || 0, ban.strikeCount || 0)
      : (ban.strikeCount || existing?.strikeCount || 0),
    reason: ban.reason || null,
    bannedAt: ban.bannedAt || now,
    // Start of the uninterrupted ban: devices first seen after it are never
    // banned for it, however often the ban is re-applied or raised.
    banStartedAt: exActive && exType === 'ban' && type === 'ban'
      ? Math.min(existing.banStartedAt || existing.bannedAt || now, ban.bannedAt || now)
      : (ban.bannedAt || now),
    bannedByUid: ban.bannedByUid || null,
    bannedByRank: typeof ban.bannedByRank === 'number' ? ban.bannedByRank : null,
    source: ban.source || 'server',
    emailKey: ban.emailKey ? canonicalBanKey(ban.emailKey) : null,
    linkedFrom: ban.linkedFrom || null,
    authDisabledByBan: existing?.authDisabledByBan === true,
    updatedAt: now,
  };

  // Permanent bans also disable the Auth account and revoke its sessions.
  // The flag is written BEFORE the disable, so a failed write can never
  // leave an account disabled with nobody knowing the ban did it.
  const isPermBan = type === 'ban' && record.bannedUntil === 'permanent';
  const willDisable = disableAuth && isPermBan && identity.exists && !identity.authUser.disabled;
  const willEnable = !isPermBan && record.authDisabledByBan && identity.exists;
  if (willDisable) record.authDisabledByBan = true;
  await ref.set(record);
  if (willDisable) {
    try {
      await admin.auth().updateUser(uid, { disabled: true });
    } catch (e) {
      console.error('[banEnforcement] disable auth failed', uid, e?.message);
      record.authDisabledByBan = existing?.authDisabledByBan === true;
      await ref.child('authDisabledByBan').set(record.authDisabledByBan).catch(() => {});
    }
    if (record.authDisabledByBan) {
      await admin.auth().revokeRefreshTokens(uid).catch((e) =>
        console.error('[banEnforcement] revoke tokens failed', uid, e?.message));
    }
  }
  // A permanent ban became temporary (or a mute): give the account back.
  if (willEnable) {
    try {
      await admin.auth().updateUser(uid, { disabled: false });
      record.authDisabledByBan = false;
      await ref.child('authDisabledByBan').set(false);
    } catch (e) {
      console.error('[banEnforcement] re-enable auth failed', uid, e?.message);
    }
  }

  let dev = { devices: 0, suspect: 0, skipped: [] };
  if (type === 'ban') {
    dev = await spreadToDevices(uid, record, identity);
    if (dev.suspect) await ref.child('deviceSuspect').set(dev.suspect);
  } else if (exActive && exType === 'ban') {
    // Authorised ban → mute: the device bans go.
    for (const fp of identity.allDevices) await removeDeviceBanner(fp, uid);
  }

  if (!identity.exists) {
    const h = { bannedUntil: record.bannedUntil, type, userId: uid, reason: record.reason, bannedAt: record.bannedAt };
    const updates = {};
    if (identity.emailHash) updates[`banned_email_hashes/${identity.emailHash}`] = h;
    if (identity.phoneHash) updates[`banned_phone_hashes/${identity.phoneHash}`] = h;
    if (Object.keys(updates).length) await db().ref().update(updates);
  }

  await mirrorToSupabase(uid, record);
  await mirrorToFirestore(uid, record);
  return {
    applied: true,
    type,
    devices: dev.devices,
    deviceSuspect: dev.suspect,
    devicesSkipped: dev.skipped.length,
    bannedUntil: record.bannedUntil,
  };
}

/**
 * Lift the uid ban/mute, its entries on devices, the email/phone hashes it
 * owns, re-enable the Auth account if the ban disabled it, and (cascade)
 * every account banned because of it — transitively, via linkedFrom.
 */
async function liftBan(uid, { cascade = true, visited = new Set() } = {}) {
  visited.add(uid);
  const ref = db().ref(`banned_uids/${uid}`);
  const existing = asRecord((await ref.get()).val());
  const identity = await resolveIdentity(uid);

  await ref.remove();

  for (const fp of identity.allDevices) await removeDeviceBanner(fp, uid);

  for (const path of [
    identity.emailHash && `banned_email_hashes/${identity.emailHash}`,
    identity.phoneHash && `banned_phone_hashes/${identity.phoneHash}`,
  ].filter(Boolean)) {
    const cur = (await db().ref(path).get()).val();
    if (cur && cur.userId === uid) await db().ref(path).remove();
  }

  if (existing?.authDisabledByBan && identity.exists) {
    try {
      await admin.auth().updateUser(uid, { disabled: false });
    } catch (e) {
      console.error('[banEnforcement] re-enable auth failed', uid, e?.message);
    }
  }

  await mirrorToSupabase(uid, null);
  await mirrorToFirestore(uid, null);

  let linkedLifted = 0;
  if (cascade) {
    const linked = await db().ref('banned_uids').orderByChild('linkedFrom').equalTo(uid).get();
    for (const altUid of Object.keys(linked.val() || {})) {
      if (visited.has(altUid)) continue;
      const r = await liftBan(altUid, { cascade: true, visited });
      linkedLifted += 1 + r.linkedLifted;
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
      db().ref(`banned_devices/${fp}`).get(),
    ]);
    const uids = new Set(Object.keys(accSnap.val() || {}));
    for (const k of Object.keys(bannersOf(banSnap.val()))) uids.add(k);
    for (const other of uids) {
      if (other === identity.uid || !UID_RE.test(other)) continue;
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
  const byUid = new Map(authUsers.map((u) => [u.uid, u]));
  return Promise.all(list.map(async (uid) => {
    const [nameSnap, banSnap, rank] = await Promise.all([
      db().ref(`users/${uid}/displayName`).get(),
      db().ref(`banned_uids/${uid}`).get(),
      readRank(uid, byUid.get(uid) || null),
    ]);
    const ban = banSnap.val();
    const active = !!ban && isActive(ban.bannedUntil);
    return {
      uid,
      displayName: nameSnap.val() || null,
      exists: byUid.has(uid),
      isStaff: isStaffRank(rank),
      banned: active && recordType(ban) === 'ban',
      muted: active && recordType(ban) === 'mute',
      bannedUntil: ban?.bannedUntil || null,
    };
  }));
}

// Shapes a banned_users_by_email record into an applyBan payload. bannedBy
// comes from the record: callers that act on a USER write replace it with
// the verified writer.
function banFromEmailRecord(key, rec) {
  return {
    type: recordType(rec),
    bannedUntil: rec.bannedUntil,
    strikeCount: rec.strikeCount || 0,
    reason: rec.reason || null,
    bannedAt: rec.bannedAt || Date.now(),
    bannedByUid: bannerUidOf(rec),
    source: 'email',
    emailKey: canonicalBanKey(key),
  };
}

// --------------------------------------------------------------------
// HTTPS: modSanction
// --------------------------------------------------------------------

function parseReason(body, required) {
  const r = body.reason;
  if (r === undefined || r === null || r === '') return required ? { error: 'bad_reason' } : { value: '' };
  if (typeof r !== 'string') return { error: 'bad_reason' };
  const v = r.trim();
  if (v.length > REASON_MAX || (required && !v)) return { error: 'bad_reason' };
  return { value: v };
}

function parseEvidence(ev) {
  if (ev === undefined || ev === null) return { value: [] };
  if (!Array.isArray(ev) || ev.length > EVIDENCE_MAX) return { error: 'bad_evidence' };
  for (const u of ev) {
    if (typeof u !== 'string' || u.length > EVIDENCE_URL_MAX) return { error: 'bad_evidence' };
    let p;
    try { p = new URL(u); } catch (_) { return { error: 'bad_evidence' }; }
    if (p.protocol !== 'https:' || !p.hostname) return { error: 'bad_evidence' };
  }
  return { value: [...ev] };
}

const ERROR_STATUS = {
  bad_action: 400, bad_target: 400, bad_strike: 400, bad_minutes: 400, bad_reason: 400,
  bad_evidence: 400, bad_log: 400, unauthenticated: 401, not_staff: 403, self_target: 403,
  outranked: 403, staff_immune: 403, rank_limit: 403, banner_outranks: 403,
  stricter_ban_active: 409, not_muted: 409,
};
const fail = (res, code, extra = {}) => res.status(ERROR_STATUS[code] || 400).json({ error: code, ...extra });

/**
 * POST { action, targetUid, strikeCount?, minutes?, reason?, evidence?,
 *        includeLinked?, linkedUids?, logAction?, details? }
 * Authorization: Bearer <Firebase ID token of a staff member>
 *
 *   'strike'  strikeCount 1 (3 h) | 2 (3 days) | 3 (permanent)
 *   'mute'    minutes 1…43200 (JMD ≤ 120)
 *   reason optional (≤ 500; old builds send none → "Strike N" / "Muted for N min")
 *   'unban'   lift a ban or mute       'unmute'  lift a mute only
 *   'linked'  other accounts on the same device(s) {uid, displayName, isStaff, banned}
 *   'log'     audit row for a non-sanction staff action (targetUid optional)
 */
async function handleModSanction(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return fail(res, 'unauthenticated');
  let caller;
  try {
    caller = await admin.auth().verifyIdToken(m[1], true);
  } catch (e) {
    return fail(res, 'unauthenticated');
  }

  const body = asRecord(req.body) || {};
  const { action } = body;
  if (!ACTIONS.has(action)) return fail(res, 'bad_action');
  // Optional for backward compatibility: builds up to 4.0.14 send no reason
  // for strike/mute when the mod leaves it blank (defaults below).
  const reasonP = parseReason(body, false);
  if (reasonP.error) return fail(res, reasonP.error);
  const evidenceP = parseEvidence(body.evidence);
  if (evidenceP.error) return fail(res, evidenceP.error);
  const ctx = { caller, reason: reasonP.value, evidence: evidenceP.value };

  const callerRank = await readRank(caller.uid, caller);
  const actor = { uid: caller.uid, rank: callerRank };
  if (action === 'log') return handleLog(req, res, body, actor, ctx);

  const { targetUid } = body;
  if (typeof targetUid !== 'string' || !UID_RE.test(targetUid)) return fail(res, 'bad_target');
  if (targetUid === caller.uid) return fail(res, 'self_target');
  if (!isStaffRank(callerRank)) return fail(res, 'not_staff');

  const identity = await resolveIdentity(targetUid);
  const targetRank = await readRank(targetUid, identity.authUser);
  const denied = checkActorOverTarget(actor, targetUid, targetRank);
  if (denied) return fail(res, denied);
  if (callerRank === RANK.babyMod && (action === 'strike' || action === 'linked' || body.includeLinked === true)) {
    return fail(res, 'rank_limit');
  }

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
  if (action === 'unban' || action === 'unmute') {
    return handleLift(res, action, targetUid, identity, actor, ctx, summary);
  }
  return handleSanction(res, action, body, targetUid, identity, actor, ctx, summary);
}

async function handleLift(res, action, targetUid, identity, actor, ctx, summary) {
  const uidRec = asRecord((await db().ref(`banned_uids/${targetUid}`).get()).val());
  const keys = new Set();
  if (identity.email) keys.add(encodeEmailKey(identity.email));
  if (identity.rawEmail) keys.add(identity.rawEmail.trim().replace(/\./g, '(dot)')); // legacy mixed-case
  if (uidRec?.emailKey) keys.add(canonicalBanKey(uidRec.emailKey)); // deleted account: no email left
  const emailRecs = (await Promise.all([...keys].map(async (k) =>
    [k, asRecord((await db().ref(`banned_users_by_email/${k}`).get()).val())]))).filter(([, r]) => r);

  const active = [];
  if (uidRec && isActive(uidRec.bannedUntil)) active.push(uidRec);
  for (const [, r] of emailRecs) if (isActive(r.bannedUntil)) active.push(r);
  const hasBan = active.some((r) => recordType(r) === 'ban');
  if (action === 'unmute' && hasBan) return fail(res, 'not_muted', summary);
  for (const r of active) {
    const d = await checkLift(actor, r);
    if (d) return fail(res, d, summary);
  }

  for (const [k] of emailRecs) await db().ref(`banned_users_by_email/${k}`).remove();
  const out = await liftBan(targetUid);

  // Logged after the lift succeeded.
  await logModAction({
    target_uid: targetUid, target_email: identity.email, target_name: await displayNameOf(targetUid),
    action: action === 'unmute' || (active.length > 0 && !hasBan) ? 'unmute' : 'unban',
    reason: ctx.reason || null, evidence: ctx.evidence, ...(await actorInfo(actor.uid)), source: 'uid',
  });
  return res.json({ ok: true, ...summary, ...out, emailRecordsRemoved: emailRecs.length });
}

async function handleSanction(res, action, body, targetUid, identity, actor, ctx, summary) {
  const type = action === 'mute' ? 'mute' : 'ban';
  const now = Date.now();
  let bannedUntil;
  let strikeCount;
  if (type === 'ban') {
    strikeCount = Number(body.strikeCount);
    if (![1, 2, 3].includes(strikeCount)) return fail(res, 'bad_strike');
    bannedUntil = strikeCount === 3 ? 'permanent' : now + STRIKE_DURATION_MS[strikeCount];
  } else {
    const minutes = Number(body.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MUTE_MIN) return fail(res, 'bad_minutes');
    const lim = checkSanction(actor, targetUid, RANK.user, { type, minutes, permanent: false });
    if (lim) return fail(res, lim);
    bannedUntil = now + minutes * MINUTE;
  }

  let linkedPick = null;
  if (body.includeLinked === true && type === 'ban' && body.linkedUids !== undefined) {
    const l = body.linkedUids;
    if (!Array.isArray(l) || l.length > LINKED_LIMIT || l.some((u) => typeof u !== 'string' || !UID_RE.test(u))) {
      return fail(res, 'bad_target');
    }
    linkedPick = [...new Set(l)];
  }

  const uidRec = asRecord((await db().ref(`banned_uids/${targetUid}`).get()).val());
  const key = identity.email ? encodeEmailKey(identity.email) : null;
  const eref = key ? db().ref(`banned_users_by_email/${key}`) : null;
  const cur = eref ? asRecord((await eref.get()).val()) : null;

  // No downgrade through this endpoint: lifting/softening is unban/unmute.
  for (const r of [cur, uidRec]) {
    if (r && isActive(r.bannedUntil) && isSofter({ type, bannedUntil }, r)) {
      return fail(res, 'stricter_ban_active', summary);
    }
  }
  if (type === 'mute') strikeCount = Math.max(cur?.strikeCount || 0, uidRec?.strikeCount || 0);
  const reason = ctx.reason ||
    (type === 'mute' ? `Muted for ${Math.round((bannedUntil - now) / MINUTE)} min` : `Strike ${strikeCount}`);

  const ban = {
    type, bannedUntil, strikeCount, reason, bannedAt: now,
    bannedByUid: actor.uid, bannedByRank: actor.rank, source: 'uid',
  };

  // Keep the email record too, so builds that only listen by email see it.
  // managedBy:'server' tells syncEmailBan this write is already handled.
  if (eref) {
    await eref.set({
      type,
      strikeCount,
      bannedUntil,
      reason,
      email: identity.email,
      displayName: (await displayNameOf(targetUid)) || 'Unknown',
      userId: targetUid,
      bannedAt: now,
      bannedBy: { uid: actor.uid, displayName: ctx.caller.name || 'Staff', avatar: null, role: ROLE_NAME[actor.rank] || 'staff' },
      managedBy: 'server',
    });
    ban.source = 'email';
    ban.emailKey = key;
  }

  const out = await applyBan(targetUid, ban, identity);
  const actorRow = await actorInfo(actor.uid);
  if (out.applied) {
    await logModAction({
      target_uid: targetUid, target_email: identity.email, target_name: await displayNameOf(targetUid),
      ...banRowFields(ban, type), evidence: ctx.evidence, ...actorRow, source: 'uid',
    });
  }

  // Perm-ban-all: only the accounts the mod picked (re-checked), never staff.
  let linkedBanned = 0;
  const linkedResults = [];
  if (body.includeLinked === true && type === 'ban') {
    const linked = await findLinkedAccounts(identity);
    const picks = linkedPick || [...linked.keys()].slice(0, LINKED_LIMIT);
    for (const altUid of picks) {
      if (altUid === targetUid || altUid === actor.uid) { linkedResults.push({ uid: altUid, status: 'skipped' }); continue; }
      if (!linked.has(altUid)) { linkedResults.push({ uid: altUid, status: 'not_linked' }); continue; }
      const alt = await resolveIdentity(altUid);
      const altRank = await readRank(altUid, alt.authUser);
      if (isStaffRank(altRank)) { linkedResults.push({ uid: altUid, status: 'staff' }); continue; }
      if (actor.rank <= altRank) { linkedResults.push({ uid: altUid, status: 'outranked' }); continue; }
      const altReason = `${reason} (linked account)`.slice(0, REASON_MAX);
      const r = await applyBan(altUid, { ...ban, source: 'linked', emailKey: null, linkedFrom: targetUid, reason: altReason }, alt);
      linkedResults.push({ uid: altUid, status: r.applied ? 'banned' : 'kept_stricter' });
      if (r.applied) {
        linkedBanned += 1;
        await logModAction({
          target_uid: altUid, target_email: alt.email, target_name: await displayNameOf(altUid),
          ...banRowFields({ ...ban, reason: altReason }, type), evidence: ctx.evidence, ...actorRow, source: 'linked',
        });
      }
    }
  }

  return res.json({ ok: true, ...summary, ...out, linkedBanned, linkedResults });
}

async function handleLog(req, res, body, actor, ctx) {
  if (!isStaffRank(actor.rank)) return fail(res, 'not_staff');
  if (!LOG_ACTIONS.has(body.logAction)) return fail(res, 'bad_log');
  const targetUid = body.targetUid ?? null;
  if (targetUid !== null && (typeof targetUid !== 'string' || !UID_RE.test(targetUid))) return fail(res, 'bad_target');
  const details = body.details ?? {};
  if (!asRecord(details)) return fail(res, 'bad_log');
  let json;
  try { json = JSON.stringify(details); } catch (_) { return fail(res, 'bad_log'); }
  if (Buffer.byteLength(json, 'utf8') > DETAILS_MAX_BYTES) return fail(res, 'bad_log');

  const logged = await logModAction({
    action: body.logAction,
    target_uid: targetUid,
    target_email: null,
    target_name: await displayNameOf(targetUid),
    reason: ctx.reason || null,
    evidence: ctx.evidence,
    details: JSON.parse(json),
    ...(await actorInfo(actor.uid)),
    source: 'app',
  });
  return res.json({ ok: true, logged });
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
// RTDB: syncEmailBan — every client ban path feeds the server, but only
// what the real writer may do
// --------------------------------------------------------------------

// v1 context → { admin: true } | { uid, rank } | null (unauthenticated).
async function resolveWriter(context) {
  if (context.authType === 'ADMIN') return { admin: true };
  if (context.authType !== 'USER') return null;
  const uid = context.auth?.uid;
  if (!uid) return null;
  return { uid, rank: await readRank(uid, context.auth.token || {}) };
}

// The account an email record is about. The key IS the email, so the live
// account behind it wins over a userId the writer put in the body.
async function targetForEmailKey(key, rec) {
  const recUid = typeof rec?.userId === 'string' && UID_RE.test(rec.userId) ? rec.userId : null;
  let authUid = null;
  try {
    authUid = (await admin.auth().getUserByEmail(decodeEmailKey(key))).uid;
  } catch (_) { /* no live account for this email */ }
  if (authUid && recUid && authUid !== recUid) {
    console.warn('[syncEmailBan] record userId does not match the email\'s account; using the account', key);
  }
  return authUid || recUid;
}

const sameSourceKey = (uidRec, key) => !!uidRec && canonicalBanKey(uidRec.emailKey || '') === key;

// Every uid whose banned_uids record came from this key. Falls back to an
// emailKey query (needs ".indexOn": ["linkedFrom", "emailKey"] on banned_uids)
// for records with no userId whose account is gone.
async function liftTargetsForKey(key, rec) {
  const cands = new Set();
  const recUid = typeof rec?.userId === 'string' && UID_RE.test(rec.userId) ? rec.userId : null;
  if (recUid) cands.add(recUid);
  try {
    cands.add((await admin.auth().getUserByEmail(decodeEmailKey(key))).uid);
  } catch (_) { /* gone */ }
  const out = [];
  for (const u of cands) {
    const k = (await db().ref(`banned_uids/${u}/emailKey`).get()).val();
    if (canonicalBanKey(k || '') === key) out.push(u);
  }
  if (!out.length) {
    try {
      const snap = await db().ref('banned_uids').orderByChild('emailKey').equalTo(key).limitToFirst(10).get();
      for (const u of Object.keys(snap.val() || {})) out.push(u);
    } catch (e) {
      console.warn('[syncEmailBan] emailKey lookup failed', key, e?.message);
    }
  }
  return out;
}

// Put the record back to `restoreTo` (or delete it) — only while it is still
// exactly the write we are rejecting. Restored values carry managedBy:'server'
// so this function skips its own echo.
async function revertEmailRecord(rawKey, rejected, restoreTo) {
  const want = banFingerprint(rejected);
  const restored = restoreTo ? { ...restoreTo, managedBy: 'server' } : null;
  const r = await db().ref(`banned_users_by_email/${rawKey}`).transaction((cur) => {
    if (banFingerprint(cur) !== want) return cur === null ? null : undefined;
    return restored;
  });
  return r.committed && banFingerprint(r.snapshot.val()) === banFingerprint(restored);
}

// Old builds mirror a ban onto banned_devices themselves. When the ban is
// rejected, drop those copies (best effort — the client may write after us).
async function dropClientDeviceCopies(uid, identity, rec) {
  for (const fp of identity.allDevices) {
    const dref = db().ref(`banned_devices/${fp}`);
    const cur = asRecord((await dref.get()).val());
    if (cur && !cur.banners && cur.userId === uid && cur.bannedAt === rec.bannedAt) await dref.remove();
  }
}

// Lifting through a legacy mixed-case key must not lift what the lowercase
// record still enforces (and vice versa when the uid record keeps the raw key).
async function reapplySibling(rawKey, key, uid) {
  if (rawKey === key) return;
  const canon = asRecord((await db().ref(`banned_users_by_email/${key}`).get()).val());
  if (!canon || !isActive(canon.bannedUntil)) return;
  const ban = banFromEmailRecord(key, canon);
  ban.bannedByRank = ban.bannedByUid ? await rankOfUid(ban.bannedByUid) : null;
  await applyBan(uid, ban);
}

async function handleEmailBanWrite(change, context) {
  const rawKey = context.params.emailKey;
  const key = canonicalBanKey(rawKey);
  if (!key) return null;
  const before = asRecord(change.before.val());
  const after = asRecord(change.after.val());
  // bannedAt / deviceId tags etc.: nothing enforcement-relevant changed.
  if (banFingerprint(before) === banFingerprint(after)) return null;

  // Legacy mixed-case keys (strike/unban in builds ≤ 4.0.14 don't lowercase)
  // are processed like the lowercase key: banned_uids always stores the
  // canonical key, and stricter-wins decides between the two records.

  const writer = await resolveWriter(context);
  if (!writer) {
    console.warn('[syncEmailBan] ignored unauthenticated change', rawKey, context.authType);
    return null;
  }

  // Ordering: act only on the record as it is now. A newer write has its
  // own event (and a stale ban event must not resurrect a lifted ban).
  const current = asRecord((await db().ref(`banned_users_by_email/${rawKey}`).get()).val());
  if (banFingerprint(current) !== banFingerprint(after)) {
    console.log('[syncEmailBan] stale event skipped', rawKey);
    return null;
  }

  const now = Date.now();
  const beforeActive = !!before && isActive(before.bannedUntil, now);
  const afterActive = !!after && isActive(after.bannedUntil, now);

  // ── Admin SDK (modSanction, restores, scripts): trusted.
  if (writer.admin) {
    if (!afterActive) {
      if (!beforeActive) return null;
      // Only the ban this record placed (a rejected write we just deleted
      // never placed one).
      for (const u of await liftTargetsForKey(key, before)) {
        const until = (await db().ref(`banned_uids/${u}/bannedUntil`).get()).val();
        if (until === before.bannedUntil) {
          await liftBan(u);
          await reapplySibling(rawKey, key, u);
        }
      }
      return null;
    }
    if (after.managedBy === 'server') return null; // the writer already applied it
    const uid = await targetForEmailKey(key, after);
    if (!uid) return null;
    const ban = banFromEmailRecord(key, after);
    ban.bannedByRank = ban.bannedByUid ? await rankOfUid(ban.bannedByUid) : null;
    const uidRec = asRecord((await db().ref(`banned_uids/${uid}`).get()).val());
    const out = await applyBan(uid, ban, null, { allowSoften: sameSourceKey(uidRec, key) });
    if (out.applied) {
      await logModAction({
        target_uid: uid, target_email: decodeEmailKey(key), target_name: after.displayName || null,
        ...banRowFields(ban), ...(await actorInfo(ban.bannedByUid)), source: 'app',
      });
    }
    return null;
  }

  const actor = writer;

  // ── Lift: record deleted, or rewritten as inactive.
  if (!afterActive) {
    if (!beforeActive) {
      // A deleted record's deviceId tag landing afterwards leaves a stub.
      if (after && after.bannedUntil === undefined && !before &&
        Object.keys(after).every((k) => k === 'deviceId' || k === 'deviceIds')) {
        await db().ref(`banned_users_by_email/${rawKey}`).remove();
      }
      return null;
    }
    const targets = await liftTargetsForKey(key, before);
    const primary = targets[0] || (await targetForEmailKey(key, before));
    const targetRank = primary ? await rankOfUid(primary) : RANK.user;
    const uidRec = primary ? asRecord((await db().ref(`banned_uids/${primary}`).get()).val()) : null;
    const src = sameSourceKey(uidRec, key) && isActive(uidRec.bannedUntil) ? uidRec : before;
    const denied = checkActorOverTarget(actor, primary, targetRank) || (await checkLift(actor, src));
    if (denied) {
      console.warn(`[syncEmailBan] ${actor.uid} may not lift ${rawKey} (${denied}); restoring`);
      const restored = await revertEmailRecord(rawKey, after, before);
      // Old builds also deleted the device entries: put the ban back everywhere.
      if (restored && primary && sameSourceKey(uidRec, key) && isActive(uidRec.bannedUntil)) {
        await applyBan(primary, uidRec);
      }
      return null;
    }
    for (const u of targets) {
      await liftBan(u);
      await reapplySibling(rawKey, key, u);
    }
    if (primary && !(await recentlyLoggedUnban(primary))) {
      await logModAction({
        target_uid: primary, target_email: decodeEmailKey(key), target_name: before.displayName || null,
        action: recordType(before) === 'mute' ? 'unmute' : 'unban',
        ...(await actorInfo(actor.uid)), source: 'app',
      });
    }
    return null;
  }

  // ── Ban / mute / edit.
  const type = recordType(after);
  const permanent = after.bannedUntil === 'permanent';
  const minutes = permanent ? Infinity : Math.floor((after.bannedUntil - now) / MINUTE);
  const target = await targetForEmailKey(key, after);
  const identity = target ? await resolveIdentity(target) : null;
  const targetRank = target ? await readRank(target, identity.authUser) : RANK.user;
  const uidRec = target ? asRecord((await db().ref(`banned_uids/${target}`).get()).val()) : null;
  const sameSource = sameSourceKey(uidRec, key);
  const prev = sameSource && isActive(uidRec.bannedUntil) ? uidRec : beforeActive ? before : null;
  const softens = !!prev && isSofter(after, prev);

  let denied = checkSanction(actor, target, targetRank, { type, minutes, permanent });
  if (!denied && softens) denied = await checkLift(actor, prev);
  if (denied) {
    console.warn(`[syncEmailBan] ${actor.uid} may not write ${rawKey} (${denied}); reverting`);
    const restored = await revertEmailRecord(rawKey, after, before);
    if (target) {
      await dropClientDeviceCopies(target, identity, after);
      if (restored && sameSource && isActive(uidRec.bannedUntil)) await applyBan(target, uidRec, identity);
    }
    return null;
  }
  if (!target) return null; // no account behind this email (yet): banCheckOnSignup covers it

  const ban = { ...banFromEmailRecord(key, after), bannedByUid: actor.uid, bannedByRank: actor.rank };
  const out = await applyBan(target, ban, identity, { allowSoften: softens && sameSource });
  if (out.applied) {
    await logModAction({
      target_uid: target, target_email: decodeEmailKey(key), target_name: after.displayName || null,
      ...banRowFields(ban, type), ...(await actorInfo(actor.uid)), source: 'app',
    });
  }
  return null;
}

exports.syncEmailBan = functions
  .runWith({ secrets: SECRETS, memory: '256MB', timeoutSeconds: 60 })
  .database.ref('/banned_users_by_email/{emailKey}')
  .onWrite(async (change, context) => {
    try {
      await handleEmailBanWrite(change, context);
    } catch (e) {
      console.error('[syncEmailBan]', context.params.emailKey, e?.message || e);
    }
    return null;
  });

// --------------------------------------------------------------------
// RTDB: device ↔ account index + ban evasion
// --------------------------------------------------------------------

// Shared by both device triggers. `removed` = the deviceId was deleted (the
// account is being deleted): index the last value, nothing else.
async function onDeviceSeen(uid, fp, removed) {
  if (isBadDeviceId(fp)) return { indexed: false };
  const now = Date.now();

  // First-seen time: never overwritten (applyBan compares it to the ban time).
  const [a, d] = await Promise.all([
    db().ref(`account_devices/${uid}/${fp}`).get(),
    db().ref(`device_accounts/${fp}/${uid}`).get(),
  ]);
  const updates = {};
  if (!a.exists()) updates[`account_devices/${uid}/${fp}`] = now;
  if (!d.exists()) updates[`device_accounts/${fp}/${uid}`] = now;
  if (Object.keys(updates).length) await db().ref().update(updates);
  if (removed) return { indexed: true };

  // A banned account showing up on a NEW device does not spread its ban
  // there: the device may be someone else's fingerprint copied onto it.

  // This device is banned for someone else → ban evasion.
  const banners = activeBanners(bannersOf((await db().ref(`banned_devices/${fp}`).get()).val()), now);
  if (!Object.keys(banners).length || uid in banners) return { indexed: true };
  const own = asRecord((await db().ref(`banned_uids/${uid}`).get()).val());
  if (own && isActive(own.bannedUntil) && recordType(own) === 'ban') return { indexed: true };

  const identity = await resolveIdentity(uid);
  if (isStaffRank(await readRank(uid, identity.authUser))) return { indexed: true }; // never auto-ban staff
  const why = await deviceShield(fp, uid);
  if (why) {
    console.warn(`[banEnforcement] ${uid} on banned device ${fp} not auto-banned (${why})`);
    return { indexed: true, shielded: why };
  }
  const [ownerKey, entry] = strictestBanner(banners);
  const owner = ownerKey === '_legacy' ? null : ownerKey;
  const reason = `Ban evasion: same device as ${owner || 'a banned account'}`;
  const ban = {
    type: 'ban',
    bannedUntil: entry.bannedUntil,
    strikeCount: entry.strikeCount || 0,
    reason,
    bannedAt: now,
    bannedByUid: null,
    bannedByRank: null,
    source: 'device',
    linkedFrom: owner,
  };
  const out = await applyBan(uid, ban, identity);
  if (out.applied) {
    await logModAction({
      target_uid: uid, target_email: identity.email, target_name: await displayNameOf(uid),
      ...banRowFields(ban, 'ban'), actor_uid: null, actor_name: null, actor_role: 'system', source: 'device',
    });
    console.log(`[banEnforcement] ${uid} banned: device ${fp} belongs to banned ${owner}`);
  }
  return { indexed: true, banned: out.applied };
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
    if (isBadDeviceId(fp)) return null;
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
    // Our own move below deletes the public copy: that echo needs no work.
    if (removed && context.authType === 'ADMIN') return null;
    const fp = removed ? change.before.val() : change.after.val();
    if (typeof fp !== 'string') return null;
    try {
      if (isBadDeviceId(fp)) {
        // Still take a junk id off the public node, but never index it.
        if (!removed) await db().ref(`users/${uid}/deviceId`).remove();
        return null;
      }
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
// Auth: banCheckOnSignup — a returning email or phone is banned again
// --------------------------------------------------------------------

async function onSignup(user) {
  const email = normEmail(user.email);
  const phoneHash = hashPhone(user.phoneNumber);
  if (!email && !phoneHash) return null;
  const key = email ? encodeEmailKey(email) : null;
  const [recSnap, emailHashSnap, phoneHashSnap] = await Promise.all([
    key ? db().ref(`banned_users_by_email/${key}`).get() : null,
    email ? db().ref(`banned_email_hashes/${hashEmail(email)}`).get() : null,
    phoneHash ? db().ref(`banned_phone_hashes/${phoneHash}`).get() : null,
  ]);
  const now = Date.now();
  let ban = null;
  const rec = asRecord(recSnap?.val());
  if (rec && isActive(rec.bannedUntil)) {
    const base = banFromEmailRecord(key, rec);
    ban = {
      ...base,
      bannedAt: now,
      linkedFrom: rec.userId && rec.userId !== user.uid ? rec.userId : null,
      reason: `Re-registered banned email${base.reason ? `: ${base.reason}` : ''}`.slice(0, REASON_MAX),
    };
  } else {
    for (const [snap, what, source] of [[emailHashSnap, 'email', 'email_hash'], [phoneHashSnap, 'phone', 'phone_hash']]) {
      const h = asRecord(snap?.val());
      if (h && isActive(h.bannedUntil)) {
        ban = {
          type: h.type === 'mute' ? 'mute' : 'ban',
          bannedUntil: h.bannedUntil,
          strikeCount: 0,
          reason: `Ban evasion: re-registered ${what} of ${h.userId}`,
          bannedAt: now,
          bannedByUid: null,
          bannedByRank: null,
          source,
          linkedFrom: h.userId || null,
        };
        break;
      }
    }
  }
  if (!ban) return null;
  const out = await applyBan(user.uid, ban);
  if (out.applied) {
    await logModAction({
      target_uid: user.uid, target_email: email, target_name: null,
      ...banRowFields(ban), actor_uid: null, actor_name: null, actor_role: 'system', source: ban.source,
    });
  }
  return out;
}

exports.banCheckOnSignup = functions
  .runWith({ secrets: SECRETS, memory: '256MB', timeoutSeconds: 60 })
  .auth.user()
  .onCreate(async (user) => {
    try {
      await onSignup(user);
    } catch (e) {
      console.error('[banCheckOnSignup]', user.uid, e?.message || e);
    }
    return null;
  });

// --------------------------------------------------------------------
// Auth: tombstoneDeletedAccount — keep enough to ban a deleted account
// --------------------------------------------------------------------

async function onAccountDeleted(user) {
  const [devicesSnap, banSnap] = await Promise.all([
    db().ref(`account_devices/${user.uid}`).get(),
    db().ref(`banned_uids/${user.uid}`).get(),
  ]);
  const devices = {};
  for (const fp of Object.keys(devicesSnap.val() || {})) if (!isBadDeviceId(fp)) devices[fp] = true;
  const emailHash = hashEmail(user.email);
  const phoneHash = hashPhone(user.phoneNumber);
  const updates = {
    [`deleted_accounts/${user.uid}`]: {
      emailHash,
      phoneHash,
      phone: user.phoneNumber || null,
      providers: (user.providerData || []).map((p) => p.providerId),
      devices,
      deletedAt: Date.now(),
    },
  };
  // Banned or muted at deletion: the same email / phone is caught at sign-up.
  const ban = asRecord(banSnap.val());
  if (ban && isActive(ban.bannedUntil)) {
    const h = {
      bannedUntil: ban.bannedUntil, type: recordType(ban), userId: user.uid,
      reason: ban.reason || null, bannedAt: ban.bannedAt || Date.now(),
    };
    if (emailHash) updates[`banned_email_hashes/${emailHash}`] = h;
    if (phoneHash) updates[`banned_phone_hashes/${phoneHash}`] = h;
  }
  await db().ref().update(updates);
}

exports.tombstoneDeletedAccount = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .auth.user()
  .onDelete(async (user) => {
    try {
      await onAccountDeleted(user);
    } catch (e) {
      console.error('[tombstoneDeletedAccount]', user.uid, e?.message || e);
    }
    return null;
  });

// --------------------------------------------------------------------
// Scheduled: reconcileBanMirrors — Supabase banned_senders and Firestore
// banned_uids follow RTDB banned_uids (mirror writes are best-effort).
// --------------------------------------------------------------------

async function reconcileBans({ dryRun = false, pageSize = 500 } = {}) {
  const now = Date.now();
  const stats = { active: 0, activeBans: 0, supabase: null, firestore: null, junkDevices: 0, dryRun };

  // 1. Active records, paged by key.
  const active = new Map();
  const legacyTypes = {}; // pre-`type` records get it stamped, so every reader agrees
  let cursor = null;
  for (;;) {
    let q = db().ref('banned_uids').orderByKey();
    if (cursor) q = q.startAt(cursor);
    const snap = await q.limitToFirst(pageSize + (cursor ? 1 : 0)).get();
    let n = 0;
    let last = null;
    snap.forEach((child) => {
      if (child.key === cursor) return;
      n += 1;
      last = child.key;
      const v = asRecord(child.val());
      if (v && isActive(v.bannedUntil, now)) {
        active.set(child.key, v);
        if (v.type !== 'ban' && v.type !== 'mute') legacyTypes[`banned_uids/${child.key}/type`] = recordType(v);
      }
    });
    if (n < pageSize || !last) break;
    cursor = last;
  }
  stats.active = active.size;
  stats.typeStamped = Object.keys(legacyTypes).length;
  if (!dryRun && stats.typeStamped) await db().ref().update(legacyTypes);
  const bans = [...active].filter(([, v]) => recordType(v) === 'ban');
  stats.activeBans = bans.length;

  // 2. Supabase banned_senders (bans + mutes).
  const sb = supa();
  if (sb) {
    const have = new Map();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('banned_senders').select('uid,banned_until').order('uid').range(from, from + 999);
      if (error) throw error;
      for (const r of data || []) have.set(r.uid, r.banned_until);
      if (!data || data.length < 1000) break;
    }
    const upserts = [];
    for (const [uid, rec] of active) {
      const want = rec.bannedUntil === 'permanent' ? null : rec.bannedUntil;
      const got = have.has(uid) ? have.get(uid) : undefined;
      const same = got !== undefined && (got === null ? want === null : want !== null && Math.abs(Date.parse(got) - want) < 1000);
      if (!same) upserts.push(sendersRow(uid, rec));
    }
    const deletes = [...have.keys()].filter((uid) => !active.has(uid));
    if (!dryRun) {
      for (let i = 0; i < upserts.length; i += 500) {
        const { error } = await sb.from('banned_senders').upsert(upserts.slice(i, i + 500), { onConflict: 'uid' });
        if (error) throw error;
      }
      for (let i = 0; i < deletes.length; i += 500) {
        const { error } = await sb.from('banned_senders').delete().in('uid', deletes.slice(i, i + 500));
        if (error) throw error;
      }
    }
    stats.supabase = { rows: have.size, upserted: upserts.length, deleted: deletes.length };
  }

  // 3. Firestore banned_uids (bans only).
  const coll = firestore().collection('banned_uids');
  const fsHave = new Map();
  let lastDoc = null;
  for (;;) {
    let q = coll.orderBy(FieldPath.documentId()).limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    snap.forEach((d) => fsHave.set(d.id, d.data()));
    if (snap.size < pageSize) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }
  const fsWrites = [];
  const banSet = new Set();
  for (const [uid, rec] of bans) {
    banSet.add(uid);
    const got = fsHave.get(uid);
    const permanent = rec.bannedUntil === 'permanent';
    const ok = got && got.type === 'ban' && got.permanent === permanent &&
      (permanent || (got.until && typeof got.until.toMillis === 'function' && got.until.toMillis() === rec.bannedUntil));
    if (!ok) fsWrites.push([uid, rec]);
  }
  const fsDeletes = [...fsHave.keys()].filter((uid) => !banSet.has(uid));
  if (!dryRun) {
    const ops = [...fsWrites.map(([uid, rec]) => (b) => b.set(coll.doc(uid), firestoreBanDoc(rec))),
      ...fsDeletes.map((uid) => (b) => b.delete(coll.doc(uid)))];
    for (let i = 0; i < ops.length; i += 400) {
      const batch = firestore().batch();
      for (const op of ops.slice(i, i + 400)) op(batch);
      await batch.commit();
    }
  }
  stats.firestore = { docs: fsHave.size, written: fsWrites.length, deleted: fsDeletes.length };

  // 4. A device ban on a shared/constant id bans everyone behind it.
  for (const fp of DEVICE_DENYLIST) {
    if (!DEVICE_KEY_RE.test(fp)) continue;
    const ref = db().ref(`banned_devices/${fp}`);
    if ((await ref.get()).exists()) {
      stats.junkDevices += 1;
      if (!dryRun) await ref.remove();
    }
  }
  return stats;
}

exports.reconcileBanMirrors = functions
  .runWith({ secrets: SECRETS, memory: '256MB', timeoutSeconds: 300 })
  .pubsub.schedule('every 6 hours')
  .onRun(async () => {
    try {
      const stats = await reconcileBans();
      console.log('[reconcileBanMirrors]', JSON.stringify(stats));
    } catch (e) {
      console.error('[reconcileBanMirrors]', e?.message || e);
    }
    return null;
  });

// Exposed for tests and scripts.
exports._internal = {
  OWNER_EMAILS,
  RANK,
  UID_RE,
  DEVICE_KEY_RE,
  applyBan,
  liftBan,
  resolveIdentity,
  findLinkedAccounts,
  readRank,
  banFromEmailRecord,
  recordType,
  hashEmail,
  hashPhone,
  encodeEmailKey,
  canonicalBanKey,
  isActive,
  atLeastAsStrict,
  isBadDeviceId,
  handleModSanction,
  handleEmailBanWrite,
  onDeviceSeen,
  onSignup,
  onAccountDeleted,
  reconcileBans,
  logModAction,
  mirrorToFirestore,
  setSupabaseForTest: (client) => { supabaseOverride = client; },
};
