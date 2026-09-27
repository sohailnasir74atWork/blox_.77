// One-time migration (round 2, 2026-09): move account emails off the
// world-readable users/{uid} record into users_private/{uid} (owner + staff
// read only — database.rules.json), and strip `email` from Firestore posts
// (designPosts_upgrade + legacy designPosts, both world-readable).
//
// Run (DRY RUN by default — reads only, prints counts, writes nothing):
//   node scripts/migrate-user-pii.js
//   node scripts/migrate-user-pii.js --apply               # move: write users_private, delete the leaves
//   node scripts/migrate-user-pii.js --apply --copy-only   # copy only: users/{uid} untouched
// Options:
//   --batch=500          users per page (orderByKey + limitToFirst; never the whole node)
//   --limit=N            stop after scanning N users (testing)
//   --start-after=KEY    resume after a /users key (printed on every page and on failure)
//   --skip-users         posts only
//   --skip-posts         users only
//
// What moves, per users/{uid}:
//   email         app: raw auth email; website: '.' → ','
//   decodedEmail  website: raw email
//   userEmail     never written by any build we know of; moved if found
//   dateOfBirth   never written by this app (DOB lives in email_prefs); moved if found
// users_private/{uid}/email gets the Firebase Auth email (lowercased) — the
// same value the rules accept from the owner. Leaf values are only the
// fallback for uids with no auth user / no auth email. If an Auth lookup
// errors, the script stops (resume with --start-after) instead of guessing.
// Records whose KEY is an encoded email (pre-uid builds) are REPORTED, never
// touched.
//
// --copy-only is backward compatible at any time (old builds still see
// users/{uid}/email) and lets staff email search find everyone before the
// cutover. The full move belongs to the CUTOVER, after deploying
// privatizeUserPII (it catches old builds re-writing the leaf):
//   firebase deploy --only functions:privatizeUserPII --project fruiteblocks
//   node scripts/migrate-user-pii.js --apply
//
// Side effects of --apply: each users_private write fires
// mirrorUsersPrivateToSupabase (one Supabase update); each leaf deletion fires
// mirrorUsersToSupabase (no-op for these keys) and privatizeUserPII (exits on
// a null value). Posts: one Firestore write per post that carries an email.
//
// Prereqs: serviceAccount.json at project root (same as the other scripts).
// Emulator: FIREBASE_DATABASE_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST /
// FIREBASE_AUTH_EMULATOR_HOST and RTDB_URL are honoured by the Admin SDK.

const path = require('path');
const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json');
let serviceAccount;
try {
  serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (e) {
  console.error(`\n❌ Could not load ${SERVICE_ACCOUNT_PATH}\n`);
  process.exit(1);
}

const arg = (name) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};
const APPLY = !!arg('apply');
const COPY_ONLY = !!arg('copy-only');
const BATCH = Math.max(1, Math.min(1000, Number(arg('batch')) || 500));
const LIMIT = Number(arg('limit')) || 0;
const START_AFTER = typeof arg('start-after') === 'string' ? arg('start-after') : null;
const SKIP_USERS = !!arg('skip-users');
const SKIP_POSTS = !!arg('skip-posts');

const RTDB_URL = process.env.RTDB_URL ||
  `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: RTDB_URL,
});
const db = admin.database();
const fs = admin.firestore();

const LEAVES = ['email', 'decodedEmail', 'userEmail', 'dateOfBirth'];
const EMAIL_LEAVES = ['email', 'decodedEmail', 'userEmail'];
const DOB_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const POST_COLLECTIONS = ['designPosts_upgrade', 'designPosts'];

const normalizeEmail = (v) => {
  if (typeof v !== 'string') return null;
  const e = v.replace(/\(dot\)/g, '.').replace(/,/g, '.').trim().toLowerCase();
  return e.includes('@') ? e : null;
};
const isLegacyEmailKey = (key) => key.includes('@') || key.includes('(dot)');
// Print shape, not the address: 'jo***@gm***'.
const mask = (key) => {
  const [local, domain = ''] = key.replace(/\(dot\)/g, '.').split('@');
  return `${local.slice(0, 2)}***@${domain.slice(0, 2)}***`;
};

const stats = {
  scanned: 0,
  withLeaves: 0,
  leaf: Object.fromEntries(LEAVES.map((k) => [k, 0])),
  emailFromAuth: 0,
  emailFromLeaf: 0,
  leafDiffersFromAuth: 0,
  noEmailAnywhere: 0,
  dobMoved: 0,
  dobKeptExisting: 0,
  dobInvalid: 0,
  legacyEmailKeys: 0,
  pathsWritten: 0,
};
const legacySamples = [];

// uid → lowercased auth email | null (no auth user / no email). Throws on a
// lookup error so the caller can stop cleanly.
async function lookupAuthEmails(uids) {
  const out = new Map();
  for (let i = 0; i < uids.length; i += 100) {
    const chunk = uids.slice(i, i + 100);
    const res = await admin.auth().getUsers(chunk.map((uid) => ({ uid })));
    for (const u of res.users) out.set(u.uid, u.email ? u.email.trim().toLowerCase() : null);
    for (const nf of res.notFound) out.set(nf.uid, null);
  }
  return out;
}

async function processPage(page) {
  const candidates = [];
  for (const [key, u] of page) {
    stats.scanned++;
    if (!u || typeof u !== 'object') continue;
    const leaves = LEAVES.filter((k) => u[k] !== undefined && u[k] !== null);
    if (isLegacyEmailKey(key)) {
      stats.legacyEmailKeys++;
      if (legacySamples.length < 20) legacySamples.push(mask(key));
      continue;
    }
    if (leaves.length === 0) continue;
    stats.withLeaves++;
    for (const k of leaves) stats.leaf[k]++;
    candidates.push({ uid: key, u, leaves });
  }
  if (candidates.length === 0) return;

  const authEmails = await lookupAuthEmails(candidates.map((c) => c.uid));

  // DOB is write-once in users_private: only fill it where it is still empty.
  const dobCandidates = candidates.filter((c) => typeof c.u.dateOfBirth === 'string' && DOB_RE.test(c.u.dateOfBirth));
  const existingDob = new Map();
  await Promise.all(dobCandidates.map(async (c) => {
    const s = await db.ref(`users_private/${c.uid}/dateOfBirth`).once('value');
    existingDob.set(c.uid, s.exists());
  }));

  const updates = {};
  for (const c of candidates) {
    const leafEmail = EMAIL_LEAVES.map((k) => normalizeEmail(c.u[k])).find(Boolean) || null;
    const authEmail = authEmails.get(c.uid) || null;
    const email = authEmail || leafEmail;
    if (authEmail && leafEmail && authEmail !== leafEmail) stats.leafDiffersFromAuth++;
    if (authEmail) stats.emailFromAuth++;
    else if (leafEmail) stats.emailFromLeaf++;
    else if (c.leaves.some((k) => EMAIL_LEAVES.includes(k))) stats.noEmailAnywhere++;
    if (email) updates[`users_private/${c.uid}/email`] = email;

    if (c.u.dateOfBirth !== undefined && c.u.dateOfBirth !== null) {
      if (typeof c.u.dateOfBirth === 'string' && DOB_RE.test(c.u.dateOfBirth)) {
        if (existingDob.get(c.uid)) stats.dobKeptExisting++;
        else { updates[`users_private/${c.uid}/dateOfBirth`] = c.u.dateOfBirth; stats.dobMoved++; }
      } else {
        stats.dobInvalid++;
      }
    }

    if (!COPY_ONLY) {
      for (const k of c.leaves) updates[`users/${c.uid}/${k}`] = null;
    }
  }

  stats.pathsWritten += Object.keys(updates).length;
  if (APPLY && Object.keys(updates).length > 0) {
    await db.ref().update(updates);
  }
}

async function migrateUsers() {
  let lastKey = START_AFTER;
  let pages = 0;
  for (;;) {
    let q = db.ref('users').orderByKey();
    if (lastKey) q = q.startAfter(lastKey);
    const snap = await q.limitToFirst(BATCH).once('value');
    if (!snap.exists()) break;
    const page = [];
    snap.forEach((child) => { page.push([child.key, child.val()]); });
    if (page.length === 0) break;
    try {
      await processPage(page);
    } catch (e) {
      console.error(`\n❌ Page after ${lastKey || '(start)'} failed: ${e.message}`);
      console.error(`   Nothing from this page was written. Resume with ${lastKey ? `--start-after=${lastKey}` : 'the same command (it failed on the first page)'}\n`);
      throw e;
    }
    lastKey = page[page.length - 1][0];
    pages++;
    if (pages % 20 === 0) console.log(`  … ${stats.scanned} users scanned, last key ${lastKey}`);
    if (LIMIT && stats.scanned >= LIMIT) break;
    if (page.length < BATCH) break;
  }
  return lastKey;
}

async function stripPosts() {
  const out = {};
  for (const name of POST_COLLECTIONS) {
    const withEmail = fs.collection(name).where('email', '>', '');
    const total = (await withEmail.count().get()).data().count;
    let stripped = 0;
    if (APPLY && total > 0) {
      // Re-query each pass: updated docs drop out of the result set.
      for (;;) {
        const snap = await withEmail.limit(400).get();
        if (snap.empty) break;
        const batch = fs.batch();
        snap.docs.forEach((d) => batch.update(d.ref, { email: admin.firestore.FieldValue.delete() }));
        await batch.commit();
        stripped += snap.size;
        if (stripped % 4000 < 400) console.log(`  … ${name}: ${stripped}/${total} stripped`);
      }
    }
    out[name] = { withEmail: total, stripped };
  }
  return out;
}

async function main() {
  const mode = !APPLY ? 'DRY RUN (no writes)' : COPY_ONLY ? 'APPLY — COPY ONLY (users/{uid} untouched)' : 'APPLY — MOVE';
  console.log(`\n🔒 User PII migration — ${mode}\n`);

  let lastKey = null;
  if (!SKIP_USERS) {
    lastKey = await migrateUsers();
    console.log('\n/users');
    console.log(`  scanned                    ${stats.scanned}`);
    console.log(`  records with PII leaves    ${stats.withLeaves}`);
    for (const k of LEAVES) console.log(`    ${k.padEnd(24)} ${stats.leaf[k]}`);
    console.log(`  email from Firebase Auth   ${stats.emailFromAuth}`);
    console.log(`  email from leaf (no auth)  ${stats.emailFromLeaf}`);
    console.log(`  leaf ≠ auth email          ${stats.leafDiffersFromAuth}`);
    console.log(`  leaf present, no email     ${stats.noEmailAnywhere}`);
    console.log(`  dateOfBirth moved          ${stats.dobMoved}  (kept existing: ${stats.dobKeptExisting}, invalid: ${stats.dobInvalid})`);
    console.log(`  RTDB paths set/deleted     ${stats.pathsWritten}${APPLY ? '' : ' (would be)'}`);
    console.log(`  last key                   ${lastKey || '(none)'}`);
    console.log(`\n  Legacy records keyed by an encoded email (NOT touched): ${stats.legacyEmailKeys}`);
    if (legacySamples.length) console.log(`    samples: ${legacySamples.join(', ')}`);
  }

  if (!SKIP_POSTS) {
    const posts = await stripPosts();
    console.log('\nFirestore posts (`email` field)');
    for (const [name, r] of Object.entries(posts)) {
      console.log(`  ${name.padEnd(22)} with email: ${r.withEmail}${APPLY ? `, stripped: ${r.stripped}` : ''}`);
    }
  }

  console.log(APPLY ? '\n✅ Done.\n' : '\nDry run only. Re-run with --apply to write.\n');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
