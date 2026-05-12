// One-time migration: add `role: "authenticated"` as a custom claim to
// every existing Firebase user, so their ID tokens carry the role claim
// that Supabase Realtime requires for Third-Party Auth to work.
//
// Run: `node scripts/set-supabase-role-claim.js`
// Prereqs:
//   1. Download serviceAccount.json from Firebase Console → Project
//      Settings → Service Accounts → Generate new private key.
//      Save it to the project root.
//   2. `npm install firebase-admin --no-save` (one-time, just for this
//      script — no need to commit the dependency).
//
// Idempotent: safe to re-run. Existing claims are preserved.

const admin = require('firebase-admin');
const https = require('https');
const path = require('path');

// Reuse TCP/TLS connections to googleapis.com instead of opening a fresh
// socket per call. Without this, ~25 concurrent setCustomUserClaims
// requests trigger 25 simultaneous TLS handshakes, which exhausts the
// local socket pool and lights up retry-storms even when the API is fine.
https.globalAgent.keepAlive = true;
https.globalAgent.maxSockets = 50;

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json');

let serviceAccount;
try {
  serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (e) {
  console.error(`\n❌ Could not load ${SERVICE_ACCOUNT_PATH}`);
  console.error('   Download it from Firebase Console → Project Settings');
  console.error('   → Service Accounts → Generate new private key.\n');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// Concurrency + sleep tuned for Firebase Auth's setCustomUserClaims write
// quota, which is ~10 QPS sustained per project (NOT the ~100 QPS that
// Identity Toolkit advertises for reads). With CONCURRENCY=3 and a 250ms
// inter-batch sleep we stay around 12 QPS ceiling — under quota with
// headroom, no retry storms.
const CONCURRENCY = 3;
const INTER_BATCH_SLEEP_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(label, fn, maxAttempts = 5) {
  let attempt = 0;
  let lastErr;
  while (attempt < maxAttempts) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const msg = e.message || '';
      const code = e.code || e.errorInfo?.code || '';
      const isRetryable =
        /ENOTFOUND|EADDRNOTAVAIL|ECONNRESET|ETIMEDOUT|EAI_AGAIN|timeout of \d+ms exceeded|DEADLINE_EXCEEDED|RESOURCE_EXHAUSTED|QUOTA_EXCEEDED|TOO_MANY_REQUESTS|rate.?limit/i.test(msg) ||
        /resource-exhausted|quota-exceeded|too-many-requests/i.test(code);
      if (!isRetryable) throw e;
      attempt++;
      const delay = Math.min(1000 * Math.pow(2, attempt), 15000);
      console.warn(`  ~ ${label}: ${msg.slice(0, 80)} — retry ${attempt}/${maxAttempts} in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function processInBatches(items, fn) {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const slice = items.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(fn));
    if (i + CONCURRENCY < items.length) await sleep(INTER_BATCH_SLEEP_MS);
  }
}

(async () => {
  let pageToken;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  do {
    const result = await withRetry('listUsers', () => admin.auth().listUsers(1000, pageToken));

    await processInBatches(result.users, async (u) => {
      const existing = u.customClaims || {};
      if (existing.role === 'authenticated') {
        totalSkipped++;
        return;
      }
      try {
        await withRetry(u.uid, () => admin.auth().setCustomUserClaims(u.uid, {
          ...existing,
          role: 'authenticated',
        }));
        totalUpdated++;
      } catch (e) {
        totalFailed++;
        console.warn(`  ! ${u.uid}: ${e.message}`);
      }
    });

    console.log(`Processed batch of ${result.users.length} (running total: ${totalUpdated} updated, ${totalSkipped} already had it, ${totalFailed} failed)`);
    pageToken = result.pageToken;
  } while (pageToken);

  console.log(`\n✅ Done.`);
  console.log(`   Updated: ${totalUpdated}`);
  console.log(`   Already had the claim: ${totalSkipped}`);
  console.log(`   Failed: ${totalFailed}`);
  console.log(`\nUsers will pick up the claim on their next Firebase token refresh`);
  console.log(`(within 1 hour, or immediately if the app calls getIdToken(user, true)).`);
  process.exit(0);
})().catch((e) => {
  console.error('\n❌ Migration failed:', e);
  process.exit(1);
});
