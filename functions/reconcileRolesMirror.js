/**
 * reconcileRolesMirror — every 6 hours, make Supabase `user_roles` agree with
 * RTDB `/users/{uid}` role flags (RTDB is the source of truth).
 *
 * Why (2026-09-04): every screen trusts the Supabase roles row over RTDB and
 * only falls back when the row is MISSING. The roles mirror in
 * mirrorUsersToSupabase had failed on every call since May (it wrote a column
 * that does not exist), so `user_roles` was frozen at the May backfill and
 * admin grants/removals never showed up for other users. Even with the
 * mirror fixed, any future outage or a repeat "remove" (a no-op RTDB write
 * that fires no trigger) would leave drift behind — this job repairs it.
 *
 * Cost: one indexed RTDB query per RTDB key (9 tiny flag queries + 1 for
 * customTitle — every key below has an `.indexOn` entry under /users) + one
 * Supabase select of rows with any flag true or a title + upserts only for
 * drift.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');
const { OWNER_EMAILS } = require('./banEnforcement')._internal;

if (!admin.apps.length) admin.initializeApp();

// users/{uid}/owner = true for each owner account with a VERIFIED email. The
// app reads owner rank from this flag (clients can't write it: rules
// `.write: false`), so the owner emails never ship in the app. Only accounts
// that already have a users/{uid} profile, so no stub profile is created.
// Never cleared here (nothing else can set it); if an email leaves
// OWNER_EMAILS, delete that account's flag by hand.
async function syncOwnerFlags(db) {
  let set = 0;
  for (const email of OWNER_EMAILS) {
    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
    } catch (e) {
      if (e?.code === 'auth/user-not-found') continue;
      throw e;
    }
    if (!user.emailVerified) continue;
    const snap = await db.ref(`users/${user.uid}`).get();
    if (!snap.exists() || snap.child('owner').val() === true) continue;
    await db.ref(`users/${user.uid}/owner`).set(true);
    set += 1;
  }
  return set;
}

// RTDB flag(s) → Supabase column (exactly the columns the table has).
//
// 2026-09-09 fix: a column can be fed by MORE THAN ONE RTDB key. Admin grants
// land under `admin` (legacy) or `isAdmin` (what the hardcoded-email bootstrap
// in Code/GlobelStats.js writes), and the client gate accepts either. Reading
// only `admin` made this job compute truth = "not an admin" for bootstrap
// admins and then REVOKE the is_admin = true the May backfill had correctly
// written (that backfill used `admin || isAdmin`) — which is what broke poll
// creation from the AdminDashboard.
const FLAGS = [
  { rtdb: ['admin', 'isAdmin'], col: 'is_admin' },
  { rtdb: ['isModerator'],      col: 'is_moderator' },
  { rtdb: ['isBabyMod'],        col: 'is_baby_mod' },
  { rtdb: ['isTrusted'],        col: 'is_trusted' },
  { rtdb: ['isSeniorMod'],      col: 'is_cmsr' },     // client maps is_cmsr → isSeniorMod
  { rtdb: ['isGrinder'],        col: 'is_grinder' },
  { rtdb: ['isRaider'],         col: 'is_raider' },
  // Cosmetic badge, not staff (2026-10-19, supabase/045_helper_role.sql).
  { rtdb: ['isHelper'],         col: 'is_helper' },
];

// Staff-given custom title (users/{uid}/customTitle → custom_title, 045).
// Not a boolean, so it is diffed by value next to the flags.
const TITLE = { rtdb: 'customTitle', col: 'custom_title' };

// PostgREST: 42703 = undefined column (select), PGRST204 = unknown column in
// an upsert. Only "045 missing" when the message names one of its columns.
const ROLES_045_COLS = ['is_helper', 'custom_title'];
const isMissing045Column = (error) =>
  !!error && (error.code === '42703' || error.code === 'PGRST204') &&
  ROLES_045_COLS.some((c) => String(error.message || '').includes(c));

// Make Supabase match `truth` (uid -> { col: value }). Until
// supabase/045_helper_role.sql is applied the select fails on is_helper /
// custom_title; then the older columns are reconciled alone (logged) instead
// of skipping the whole run. Returns the number of repaired rows, or null.
async function reconcileMirror(supabase, truth) {
  let flags = FLAGS;
  let title = TITLE;
  const selectRows = () => supabase
    .from('user_roles')
    .select(['uid', ...flags.map((f) => f.col), ...(title ? [title.col] : [])].join(','))
    .or([...flags.map((f) => `${f.col}.eq.true`), ...(title ? [`${title.col}.not.is.null`] : [])].join(','));

  // Mirror: every Supabase row with any flag true or a title.
  let { data: rows, error } = await selectRows();
  if (isMissing045Column(error)) {
    console.warn('[reconcileRoles] supabase/045 not applied: reconciling without is_helper/custom_title');
    flags = FLAGS.filter((f) => !ROLES_045_COLS.includes(f.col));
    title = null;
    ({ data: rows, error } = await selectRows());
  }
  if (error) {
    console.error('[reconcileRoles] select failed:', error.message);
    return null;
  }
  const mirror = {};
  for (const r of rows || []) mirror[r.uid] = r;

  // Diff. A uid drifts if any flag (or the title) differs in either direction.
  const drifted = [];
  const uids = new Set([...Object.keys(truth), ...Object.keys(mirror)]);
  for (const uid of uids) {
    const t = truth[uid] || {};
    const m = mirror[uid] || {};
    const titleDrift = !!title && (t[title.col] || null) !== (m[title.col] || null);
    if (flags.some((f) => !!t[f.col] !== !!m[f.col]) || titleDrift) {
      const row = { uid, updated_at: new Date().toISOString() };
      for (const f of flags) row[f.col] = !!t[f.col];
      if (title) row[title.col] = t[title.col] || null;
      drifted.push(row);
    }
  }

  if (drifted.length === 0) {
    console.log(`[reconcileRoles] in sync (${Object.keys(truth).length} role holders)`);
    return 0;
  }
  for (let i = 0; i < drifted.length; i += 500) {
    const chunk = drifted.slice(i, i + 500);
    const { error: upErr } = await supabase.from('user_roles').upsert(chunk, { onConflict: 'uid' });
    if (upErr) { console.error('[reconcileRoles] upsert failed:', upErr.message); return null; }
  }
  console.log(`[reconcileRoles] repaired ${drifted.length} drifted row(s)`);
  return drifted.length;
}

exports.reconcileRolesMirror = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '256MB',
    timeoutSeconds: 120,
  })
  .pubsub.schedule('every 6 hours')
  .onRun(async () => {
    const db = admin.database();
    const supabase = getSupabaseAdmin();

    // 0) Owner flags (the app's only source of owner rank).
    try {
      const n = await syncOwnerFlags(db);
      if (n) console.log(`[reconcileRoles] set owner flag on ${n} account(s)`);
    } catch (e) {
      console.error('[reconcileRoles] owner flags failed:', e.message);
    }

    // 1) Truth: uids that hold each flag in RTDB.
    const truth = {}; // uid -> { col: true }
    for (const { rtdb, col } of FLAGS) {
      // OR across the aliases — any one of them being true grants the column.
      for (const key of rtdb) {
        const snap = await db.ref('users').orderByChild(key).equalTo(true).once('value');
        snap.forEach((child) => {
          (truth[child.key] = truth[child.key] || {})[col] = true;
        });
      }
    }

    // Titles: every string value (strings sort after booleans and numbers).
    const titleSnap = await db.ref('users').orderByChild(TITLE.rtdb).startAt('').once('value');
    titleSnap.forEach((child) => {
      const v = child.child(TITLE.rtdb).val();
      if (typeof v === 'string' && v) (truth[child.key] = truth[child.key] || {})[TITLE.col] = v;
    });

    // 2) + 3) Mirror, diff, repair.
    await reconcileMirror(supabase, truth);
    return null;
  });

exports._internal = { syncOwnerFlags, reconcileMirror };
