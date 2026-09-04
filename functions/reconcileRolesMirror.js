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
 * Cost: one indexed RTDB query per flag (7 tiny queries — every flag below
 * has an `.indexOn` entry under /users) + one Supabase select of rows with
 * any flag true + upserts only for drift.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) admin.initializeApp();

// RTDB flag → Supabase column (exactly the columns the table has).
const FLAGS = [
  { rtdb: 'admin',       col: 'is_admin' },
  { rtdb: 'isModerator', col: 'is_moderator' },
  { rtdb: 'isBabyMod',   col: 'is_baby_mod' },
  { rtdb: 'isTrusted',   col: 'is_trusted' },
  { rtdb: 'isSeniorMod', col: 'is_cmsr' },     // client maps is_cmsr → isSeniorMod
  { rtdb: 'isGrinder',   col: 'is_grinder' },
  { rtdb: 'isRaider',    col: 'is_raider' },
];

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

    // 1) Truth: uids that hold each flag in RTDB.
    const truth = {}; // uid -> { col: true }
    for (const { rtdb, col } of FLAGS) {
      const snap = await db.ref('users').orderByChild(rtdb).equalTo(true).once('value');
      snap.forEach((child) => {
        (truth[child.key] = truth[child.key] || {})[col] = true;
      });
    }

    // 2) Mirror: every Supabase row with any flag true.
    const orFilter = FLAGS.map((f) => `${f.col}.eq.true`).join(',');
    const { data: rows, error } = await supabase
      .from('user_roles')
      .select('uid,' + FLAGS.map((f) => f.col).join(','))
      .or(orFilter);
    if (error) {
      console.error('[reconcileRoles] select failed:', error.message);
      return null;
    }
    const mirror = {};
    for (const r of rows || []) mirror[r.uid] = r;

    // 3) Diff. A uid drifts if any flag differs in either direction.
    const drifted = [];
    const uids = new Set([...Object.keys(truth), ...Object.keys(mirror)]);
    for (const uid of uids) {
      const t = truth[uid] || {};
      const m = mirror[uid] || {};
      if (FLAGS.some((f) => !!t[f.col] !== !!m[f.col])) {
        const row = { uid, updated_at: new Date().toISOString() };
        for (const f of FLAGS) row[f.col] = !!t[f.col];
        drifted.push(row);
      }
    }

    if (drifted.length === 0) {
      console.log(`[reconcileRoles] in sync (${Object.keys(truth).length} role holders)`);
      return null;
    }
    for (let i = 0; i < drifted.length; i += 500) {
      const chunk = drifted.slice(i, i + 500);
      const { error: upErr } = await supabase.from('user_roles').upsert(chunk, { onConflict: 'uid' });
      if (upErr) { console.error('[reconcileRoles] upsert failed:', upErr.message); return null; }
    }
    console.log(`[reconcileRoles] repaired ${drifted.length} drifted row(s)`);
    return null;
  });
