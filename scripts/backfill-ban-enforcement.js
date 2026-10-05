// One-shot backfill (2026-10): push every ACTIVE ban that exists today into
// the server-side enforcement added in functions/banEnforcement.js.
//
// For each banned_users_by_email record:
//   - its deviceId/deviceIds go into the device index (device_accounts /
//     account_devices), so alts on those devices are caught from now on;
//   - if still active and it names a userId, it is re-applied through the same
//     applyBan() the Cloud Functions use: banned_uids, every known device,
//     Supabase banned_senders.
//
// Permanent bans do NOT disable Auth accounts here unless --disable-auth is
// passed — 3k historic bans signing people out at once is a separate call.
//
// Run from the repo root (serviceAccount.json must exist there):
//   node scripts/backfill-ban-enforcement.js                    # dry run
//   node scripts/backfill-ban-enforcement.js --write            # apply
//   node scripts/backfill-ban-enforcement.js --write --disable-auth
// Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment to mirror
// into Supabase; without them the Supabase step is skipped with a warning.
//
// Idempotent. Run after deploying the functions and supabase/030.

const path = require('path');
// Same firebase-admin instance banEnforcement.js uses (functions/node_modules).
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const serviceAccount = require(path.join(__dirname, '..', 'serviceAccount.json'));
const WRITE = process.argv.includes('--write');
const DISABLE_AUTH = process.argv.includes('--disable-auth');
const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{6,128}$/;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`,
});
const rtdb = admin.database();
const { applyBan, banFromEmailRecord, isActive } =
  require(path.join(__dirname, '..', 'functions', 'banEnforcement'))._internal;

(async () => {
  const all = (await rtdb.ref('banned_users_by_email').get()).val() || {};
  const keys = Object.keys(all);
  const stats = { records: keys.length, active: 0, permanent: 0, noUserId: 0, devicesIndexed: 0, applied: 0, failed: 0 };

  const index = {};
  for (const key of keys) {
    const rec = all[key] || {};
    const uid = typeof rec.userId === 'string' ? rec.userId : null;
    const fps = new Set([...(Array.isArray(rec.deviceIds) ? rec.deviceIds : []), rec.deviceId].filter(
      (fp) => typeof fp === 'string' && DEVICE_KEY_RE.test(fp)
    ));
    if (uid) {
      for (const fp of fps) {
        index[`device_accounts/${fp}/${uid}`] = rec.bannedAt || Date.now();
        index[`account_devices/${uid}/${fp}`] = rec.bannedAt || Date.now();
        stats.devicesIndexed += 1;
      }
    }
    if (!isActive(rec.bannedUntil)) continue;
    stats.active += 1;
    if (rec.bannedUntil === 'permanent') stats.permanent += 1;
    if (!uid) stats.noUserId += 1;
  }

  console.log(`[backfill] ${WRITE ? 'WRITE' : 'DRY RUN'}${DISABLE_AUTH ? ' +disable-auth' : ''}`);
  console.log('[backfill]', stats);
  if (!WRITE) return process.exit(0);

  const entries = Object.entries(index);
  for (let i = 0; i < entries.length; i += 500) {
    await rtdb.ref().update(Object.fromEntries(entries.slice(i, i + 500)));
  }

  for (const key of keys) {
    const rec = all[key] || {};
    if (!isActive(rec.bannedUntil)) continue;
    let uid = typeof rec.userId === 'string' ? rec.userId : null;
    if (!uid) {
      // Older records carry no userId: find the live account by email.
      try {
        uid = (await admin.auth().getUserByEmail(key.replace(/\(dot\)/g, '.'))).uid;
        stats.resolvedByEmail = (stats.resolvedByEmail || 0) + 1;
      } catch (_) { continue; }
    }
    try {
      const r = await applyBan(uid, banFromEmailRecord(key, rec), null, { disableAuth: DISABLE_AUTH });
      if (r.applied) stats.applied += 1;
    } catch (e) {
      stats.failed += 1;
      console.error('[backfill]', key, e?.message);
    }
  }
  console.log('[backfill] done', stats);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
