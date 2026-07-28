// Force-resync a user's Senior Mod flag from RTDB → Supabase is_cmsr.
//
// Problem: RTDB users/{uid}/isSeniorMod is the source of truth, and the
// deployed CF `mirrorUsersToSupabase` copies it into Supabase
// user_roles.is_cmsr — but ONLY when a role field actually CHANGES value.
// Some users are desynced (RTDB isSeniorMod=false, Supabase is_cmsr=true
// left over from an old backfill), so they render as "Sr Mod" in chat and
// the in-app "Remove Sr Mod" button no-ops (it writes false onto an
// already-false RTDB value → no change → mirror never fires).
//
// This toggles isSeniorMod true→false with a delay so the mirror fires on
// each distinct write and lands Supabase is_cmsr=false.
//
// Run:
//   node scripts/resync-seniormod.js                       # DRY RUN
//   APPLY=1 UIDS=<uid1,uid2> node scripts/resync-seniormod.js
//
// Prereqs: serviceAccount.json at project root.

const path = require('path');
const admin = require('firebase-admin');

const serviceAccount = require(path.join(__dirname, '..', 'serviceAccount.json'));
const RTDB_URL = process.env.RTDB_URL ||
  `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: RTDB_URL,
});

const UIDS = (process.env.UIDS || 'Se8Hl9gck5QKFFN4YmHBX2jMXNk1')
  .split(',').map((s) => s.trim()).filter(Boolean);
const APPLY = process.env.APPLY === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = admin.database();
  console.log(`\n${APPLY ? '✍️  APPLY' : '🔍 DRY RUN'} — resync Senior Mod for ${UIDS.length} UID(s)\n`);
  for (const uid of UIDS) {
    const ref = db.ref(`users/${uid}`);
    const before = (await ref.child('isSeniorMod').get()).val();
    const name = (await ref.child('displayName').get()).val() || '(unknown)';
    console.log(`  ${uid}  "${name}"  RTDB isSeniorMod=${before}`);
    if (!APPLY) continue;

    // 1) Flip to true (distinct change → mirror sets is_cmsr=true)
    await ref.update({ isSeniorMod: true });
    console.log('    → set isSeniorMod=true (waiting for mirror…)');
    await sleep(6000);
    // 2) Flip back to false (distinct change → mirror sets is_cmsr=false)
    await ref.update({ isSeniorMod: false });
    console.log('    → set isSeniorMod=false (waiting for mirror…)');
    await sleep(6000);
    console.log('    ✅ done — Supabase is_cmsr should now be false');
  }
  console.log(APPLY ? '\n✅ Complete.\n' : '\nDRY RUN only — re-run with APPLY=1 to fix.\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
