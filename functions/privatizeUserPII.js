/**
 * Cloud Functions group: privatizeUserPII (round 2, 2026-09)
 *
 * Keeps account emails off world-readable data after the cutover:
 *
 *   privatizeUserPII-email         /users/{uid}/email         (v2 RTDB, leaf)
 *   privatizeUserPII-decodedEmail  /users/{uid}/decodedEmail  (v2 RTDB, leaf)
 *   privatizeUserPII-postEmail     designPosts_upgrade/{id}   (v1 Firestore onCreate)
 *
 * WHY
 * users/{uid} is readable by anyone (and listable by any signed-in user), so
 * the email stored there was public. New app/website builds write the email to
 * users_private/{uid} instead (owner + staff read only, database.rules.json).
 * Old builds stay in the field for months and keep writing it:
 *   - app: `email` on every login where it differs from auth (GlobelStats),
 *     and inside the full record it `set()`s for a new user;
 *   - website: `email` ('.' → ',') and `decodedEmail` on account creation;
 *   - app + website: `email` on every new Firestore post.
 * These triggers move the RTDB value into users_private/{uid} and delete the
 * leaves, and strip the field from new posts. The email is readable for the
 * seconds between the old build's write and the trigger — unavoidable while
 * those builds exist. scripts/migrate-user-pii.js cleans existing data.
 *
 * COST
 * Leaf triggers, never a whole-node /users/{uid} trigger: they fire only when
 * an email leaf changes (old-build logins/sign-ups), not on the ~100k/day
 * other /users writes. Our own leaf deletion re-fires once with a null value
 * and exits immediately. Posts: ~200 new posts/day.
 *
 * SAFETY
 * Idempotent (re-running moves the same value), ignores deletions, never
 * throws. Records whose KEY is an encoded email (legacy) are left alone.
 *
 * Deploy at CUTOVER, after the app release that stops writing email:
 *   firebase deploy --only functions:privatizeUserPII --project fruiteblocks
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { onValueWritten } = require('firebase-functions/v2/database');

if (!admin.apps.length) {
  admin.initializeApp();
}

const REGION = 'us-central1';
const INSTANCE = 'fruiteblocks-default-rtdb';

// The leaves old builds write. Removing all of them on any trigger keeps one
// invocation per write even when a full record carried both.
const LEGACY_EMAIL_LEAVES = ['email', 'decodedEmail'];

// '(dot)' is the ban-key encoding, ',' the website's; users_private holds the
// plain lowercased address.
const normalizeEmail = (v) => {
  if (typeof v !== 'string') return null;
  const e = v.replace(/\(dot\)/g, '.').replace(/,/g, '.').trim().toLowerCase();
  return e.includes('@') ? e : null;
};

// Pre-uid builds keyed some records by encoded email. Report-only (the
// migration script lists them); never touched here.
const isLegacyEmailKey = (key) => key.includes('@') || key.includes('(dot)');

// Firebase Auth is the ONLY source (it is also what the users_private rule
// checks for owner writes). The written leaf is never trusted: users/$userId
// lets any signed-in user write another user's fields, so falling back to it
// would let someone plant a victim's email on a phone-only account and get the
// wrong person banned. No auth email → the leaf is just removed.
async function canonicalEmail(uid) {
  try {
    const authUser = await admin.auth().getUser(uid);
    if (authUser.email) return authUser.email.trim().toLowerCase();
  } catch (_) {
    // auth user gone / not a uid
  }
  return null;
}

async function privatize(leaf, uid, value) {
  if (value === null || value === undefined) return null; // deletion (incl. our own) — ignore
  if (isLegacyEmailKey(uid)) return null;
  try {
    const email = await canonicalEmail(uid);
    const db = admin.database();
    if (email) await db.ref(`users_private/${uid}/email`).set(email);
    const cleared = {};
    for (const k of LEGACY_EMAIL_LEAVES) cleared[k] = null;
    await db.ref(`users/${uid}`).update(cleared);
  } catch (e) {
    console.error(`[privatizeUserPII/${leaf}]`, uid, e.message);
  }
  return null;
}

const leafTrigger = (leaf) => onValueWritten(
  {
    ref: `/users/{uid}/${leaf}`,
    instance: INSTANCE,
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  (event) => privatize(leaf, event.params.uid, event.data.after.val()),
);

// Old app/website builds put the poster's email on every Firestore post, and
// designPosts_upgrade is world-readable (the live Firestore rules allow all
// reads until 2027-03-05; they are not in this repo). Strip it on create.
const postEmail = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .firestore.document('designPosts_upgrade/{postId}')
  .onCreate(async (snap, context) => {
    if (snap.get('email') === undefined) return null;
    try {
      await snap.ref.update({ email: admin.firestore.FieldValue.delete() });
    } catch (e) {
      console.error('[privatizeUserPII/postEmail]', context.params.postId, e.message);
    }
    return null;
  });

exports.privatizeUserPII = {
  email: leafTrigger('email'),
  decodedEmail: leafTrigger('decodedEmail'),
  postEmail,
};
