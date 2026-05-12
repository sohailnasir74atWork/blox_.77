// Audit: count how many Firebase Auth users carry the
// `role: "authenticated"` custom claim that Supabase Realtime requires.
//
// Read-only counterpart to set-supabase-role-claim.js. Re-run after each
// backfill pass to see how many users are still missing the claim.
//
// Run: `node scripts/check-supabase-role-claim.js`
// Output: summary to stdout + missing UIDs written to
//         analytics/role-claim-missing-<YYYY-MM-DD>.txt (one UID per line).

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccount = require(path.join(__dirname, '..', 'serviceAccount.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const today = new Date().toISOString().slice(0, 10);
const outDir = path.join(__dirname, '..', 'analytics');
fs.mkdirSync(outDir, { recursive: true });
const missingPath = path.join(outDir, `role-claim-missing-${today}.txt`);
const missingStream = fs.createWriteStream(missingPath, { flags: 'w' });

(async () => {
  let pageToken;
  let total = 0;
  let withClaim = 0;
  let missing = 0;
  let disabledMissing = 0;
  const sampleMissing = [];

  const startedAt = Date.now();
  do {
    const result = await admin.auth().listUsers(1000, pageToken);
    for (const u of result.users) {
      total++;
      const role = u.customClaims?.role;
      if (role === 'authenticated') {
        withClaim++;
      } else {
        missing++;
        if (u.disabled) disabledMissing++;
        missingStream.write(`${u.uid}\n`);
        if (sampleMissing.length < 5) {
          sampleMissing.push({
            uid: u.uid,
            email: u.email || null,
            disabled: !!u.disabled,
            createdAt: u.metadata?.creationTime || null,
            currentClaims: u.customClaims || null,
          });
        }
      }
    }
    if (total % 10000 < 1000) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`  scanned ${total.toLocaleString()} so far (${withClaim.toLocaleString()} ok, ${missing.toLocaleString()} missing) — ${elapsed}s`);
    }
    pageToken = result.pageToken;
  } while (pageToken);

  missingStream.end();
  await new Promise((r) => missingStream.on('close', r));

  const pct = total === 0 ? 0 : ((withClaim / total) * 100);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log('');
  console.log('====================================================');
  console.log('Supabase role-claim audit');
  console.log('====================================================');
  console.log(`Total Auth users        : ${total.toLocaleString()}`);
  console.log(`role=authenticated      : ${withClaim.toLocaleString()}  (${pct.toFixed(2)}%)`);
  console.log(`Missing the claim       : ${missing.toLocaleString()}`);
  console.log(`  ↳ of which disabled   : ${disabledMissing.toLocaleString()}`);
  console.log(`Scan time               : ${elapsed}s`);
  console.log(`Missing UIDs written to : ${path.relative(process.cwd(), missingPath)}`);
  if (sampleMissing.length) {
    console.log('');
    console.log('Sample of missing users (first 5):');
    for (const s of sampleMissing) console.log('  ', JSON.stringify(s));
  }
  if (missing === 0) {
    console.log('');
    console.log('✅ Every Auth user has the claim. Backfill complete.');
  } else {
    console.log('');
    console.log(`⚠️  Re-run scripts/set-supabase-role-claim.js to backfill the remaining ${missing.toLocaleString()}.`);
  }
  process.exit(0);
})().catch((e) => {
  console.error('\n❌ Audit failed:', e);
  process.exit(1);
});
