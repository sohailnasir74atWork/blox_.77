// Backfill (2026-10): push every ACTIVE ban that exists today into the
// server-side enforcement in functions/banEnforcement.js.
//
// Default pass — for each banned_users_by_email record:
//   - its deviceId/deviceIds go into the device index (device_accounts /
//     account_devices) unless the id is a shared/constant one;
//   - if still active, it is re-applied through the same applyBan() the Cloud
//     Functions use: banned_uids (with `type`), devices (bans only), Supabase
//     banned_senders, Firestore banned_uids (bans only).
//   Records whose userId isn't a valid uid are resolved by email or skipped;
//   staff targets are skipped (the hierarchy would never let them through).
//
// --mirrors pass — reconcile the mirrors against RTDB banned_uids (the same
// code as the 6-hourly reconcileBanMirrors function): Firestore banned_uids
// (bans only, MODERATION_CONTRACT §5) and, when SUPABASE_URL is set, Supabase
// banned_senders. Use it once after deploying the Firestore mirror.
//
// Permanent bans do NOT disable Auth accounts here unless --disable-auth is
// passed.
//
// Run from the repo root (serviceAccount.json must exist there):
//   node scripts/backfill-ban-enforcement.js                    # dry run
//   node scripts/backfill-ban-enforcement.js --write            # apply
//   node scripts/backfill-ban-enforcement.js --write --disable-auth
//   node scripts/backfill-ban-enforcement.js --mirrors          # dry run of the mirror reconcile
//   node scripts/backfill-ban-enforcement.js --mirrors --write
// Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to include Supabase; without
// them the Supabase step is skipped with a warning.
// Against the emulators (tests): FIREBASE_DATABASE_EMULATOR_HOST and
// GCLOUD_PROJECT set → no service account is used (RTDB_NAMESPACE overrides
// the namespace, default = the project id).
//
// Idempotent.

const path = require('path');
// Same firebase-admin instance banEnforcement.js uses (functions/node_modules).
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const WRITE = process.argv.includes('--write');
const DISABLE_AUTH = process.argv.includes('--disable-auth');
const MIRRORS = process.argv.includes('--mirrors');

if (process.env.FIREBASE_DATABASE_EMULATOR_HOST && process.env.GCLOUD_PROJECT) {
  const projectId = process.env.GCLOUD_PROJECT;
  admin.initializeApp({
    projectId,
    databaseURL: `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${process.env.RTDB_NAMESPACE || projectId}`,
  });
} else {
  const serviceAccount = require(path.join(__dirname, '..', 'serviceAccount.json'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`,
  });
}
const rtdb = admin.database();
const {
  applyBan, banFromEmailRecord, isActive, readRank, recordType, canonicalBanKey,
  isBadDeviceId, reconcileBans, RANK, UID_RE,
} = require(path.join(__dirname, '..', 'functions', 'banEnforcement'))._internal;

async function rankOf(uid) {
  let user = null;
  try { user = await admin.auth().getUser(uid); } catch (_) { /* deleted */ }
  return readRank(uid, user);
}

async function backfillRecords() {
  const all = (await rtdb.ref('banned_users_by_email').get()).val() || {};
  const keys = Object.keys(all);
  const stats = {
    records: keys.length, active: 0, permanent: 0, mutes: 0, noUserId: 0, badUserId: 0,
    shadowedLegacyKeys: 0, devicesIndexed: 0, junkDevices: 0, applied: 0, keptStricter: 0,
    skippedStaff: 0, unresolved: 0, failed: 0,
  };

  const index = {};
  const work = [];
  for (const rawKey of keys) {
    const rec = all[rawKey];
    if (!rec || typeof rec !== 'object') continue;
    const key = canonicalBanKey(rawKey);
    // A legacy mixed-case node is shadowed by its lowercase twin.
    if (rawKey !== key && all[key]) { stats.shadowedLegacyKeys += 1; continue; }
    let uid = null;
    if (typeof rec.userId === 'string' && rec.userId) {
      if (UID_RE.test(rec.userId)) uid = rec.userId;
      else stats.badUserId += 1;
    }
    const fps = new Set([...(Array.isArray(rec.deviceIds) ? rec.deviceIds : []), rec.deviceId]
      .filter((fp) => typeof fp === 'string'));
    if (uid) {
      for (const fp of fps) {
        if (isBadDeviceId(fp)) { stats.junkDevices += 1; continue; }
        const at = typeof rec.bannedAt === 'number' ? rec.bannedAt : Date.now();
        index[`device_accounts/${fp}/${uid}`] = at;
        index[`account_devices/${uid}/${fp}`] = at;
        stats.devicesIndexed += 1;
      }
    }
    if (!isActive(rec.bannedUntil)) continue;
    stats.active += 1;
    if (rec.bannedUntil === 'permanent') stats.permanent += 1;
    if (recordType(rec) === 'mute') stats.mutes += 1;
    if (!uid) stats.noUserId += 1;
    work.push({ key, rec, uid });
  }

  console.log(`[backfill] ${WRITE ? 'WRITE' : 'DRY RUN'}${DISABLE_AUTH ? ' +disable-auth' : ''}`);
  console.log('[backfill]', JSON.stringify(stats));
  if (!WRITE) return stats;

  // Index first-seen times without overwriting existing (earlier) ones.
  const entries = Object.entries(index);
  for (let i = 0; i < entries.length; i += 200) {
    const chunk = entries.slice(i, i + 200);
    const snaps = await Promise.all(chunk.map(([p]) => rtdb.ref(p).get()));
    const missing = Object.fromEntries(chunk.filter((_, j) => !snaps[j].exists()));
    if (Object.keys(missing).length) await rtdb.ref().update(missing);
  }

  for (const { key, rec, uid: recUid } of work) {
    let uid = recUid;
    if (!uid) {
      // Older records carry no userId: find the live account by email.
      try {
        uid = (await admin.auth().getUserByEmail(key.replace(/\(dot\)/g, '.'))).uid;
        stats.resolvedByEmail = (stats.resolvedByEmail || 0) + 1;
      } catch (_) { stats.unresolved += 1; continue; }
    }
    try {
      if ((await rankOf(uid)) >= RANK.babyMod) { stats.skippedStaff += 1; continue; }
      const ban = banFromEmailRecord(key, rec);
      ban.bannedByRank = ban.bannedByUid ? await rankOf(ban.bannedByUid) : null;
      const r = await applyBan(uid, ban, null, { disableAuth: DISABLE_AUTH });
      if (r.applied) stats.applied += 1;
      else stats.keptStricter += 1;
    } catch (e) {
      stats.failed += 1;
      console.error('[backfill]', key, e?.message);
    }
  }
  console.log('[backfill] done', JSON.stringify(stats));
  return stats;
}

(async () => {
  if (MIRRORS) {
    const stats = await reconcileBans({ dryRun: !WRITE });
    console.log(`[backfill:mirrors] ${WRITE ? 'WRITE' : 'DRY RUN'}`, JSON.stringify(stats));
  } else {
    await backfillRecords();
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
