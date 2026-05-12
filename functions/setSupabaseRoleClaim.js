/**
 * Cloud Function: Set the Supabase `role: "authenticated"` custom claim
 * on every new Firebase user at signup.
 *
 * Why: Supabase Realtime (with Third-Party Auth for Firebase) requires
 * the JWT to carry a `role` claim. Firebase ID tokens don't include one
 * by default, so without this hook, brand-new users get realtime
 * rejected with `InvalidJWTToken: Fields role and exp are required`.
 *
 * Existing users were backfilled by scripts/set-supabase-role-claim.js.
 *
 * Deployment:
 * firebase deploy --only functions:setSupabaseRoleClaim
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.setSupabaseRoleClaim = functions.auth.user().onCreate(async (user) => {
  try {
    await admin.auth().setCustomUserClaims(user.uid, { role: 'authenticated' });
    console.log(`✅ Set role=authenticated claim for new user ${user.uid}`);
  } catch (e) {
    // Don't throw — failing here would break signup for the user. Better
    // to log and let the next sign-in / migration sweep catch them.
    console.error(`❌ Failed to set role claim for ${user.uid}:`, e?.message || e);
  }
});

// HTTPS self-heal: lets an existing user (one the offline backfill
// hasn't reached yet) request the claim on demand, using their own
// Firebase ID token as auth. Idempotent — claim already set is a no-op.
// The client must call getIdToken(user, true) afterwards so the next
// Supabase request carries the new claim.
exports.ensureRoleClaim = functions
  .runWith({ memory: '256MB', timeoutSeconds: 10 })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const authHeader = req.headers.authorization || '';
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) { res.status(401).json({ error: 'Missing Bearer token' }); return; }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(m[1]);
    } catch (e) {
      res.status(401).json({ error: e?.message || 'verify failed' });
      return;
    }

    if (decoded.role === 'authenticated') {
      res.status(200).json({ ok: true, set: false });
      return;
    }

    try {
      // Read the current user record so we merge over any other claims
      // that may have been set after this token was minted.
      const userRec = await admin.auth().getUser(decoded.uid);
      const existing = userRec.customClaims || {};
      await admin.auth().setCustomUserClaims(decoded.uid, {
        ...existing,
        role: 'authenticated',
      });
      res.status(200).json({ ok: true, set: true });
    } catch (e) {
      console.error('[ensureRoleClaim] error:', e?.message || e);
      res.status(500).json({ error: e?.message || 'set failed' });
    }
  });
