#!/usr/bin/env node
// Upload the release AAB to the Play INTERNAL testing track (testers only).
//
//   node scripts/play-upload-internal.js [--notes "What's new"] [--dry-run]
//
// Uses the service account in .secrets/play-sa-key.json (same as
// play-fetch.js). Steps: open an edit, upload the bundle, set the internal
// track to this version only, commit. --dry-run validates and discards the edit.
// No separate mapping.txt upload: the AAB already carries the R8 mapping and
// native debug symbols, and Play extracts both on upload.
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

const ROOT = path.join(__dirname, '..');
const PKG = 'com.bloxfruitevalues';
const AAB = path.join(ROOT, 'android/app/build/outputs/bundle/release/app-release.aab');
const DRY = process.argv.includes('--dry-run');
const notesIdx = process.argv.indexOf('--notes');
const NOTES = notesIdx > -1 ? process.argv[notesIdx + 1] : 'Bug fixes and performance improvements.';

const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;
const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PKG}`;

(async () => {
  if (!fs.existsSync(AAB)) throw new Error(`No AAB at ${AAB} — run ./gradlew bundleRelease first`);
  const auth = new GoogleAuth({
    keyFile: path.join(ROOT, '.secrets/play-sa-key.json'),
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const token = (await (await auth.getClient()).getAccessToken()).token;
  const call = async (url, { method = 'GET', body, headers = {} } = {}) => {
    const r = await fetch(url, { method, body, headers: { Authorization: `Bearer ${token}`, ...headers } });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${url.replace(API, '').replace(UPLOAD, '')} → ${r.status} ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : {};
  };

  const edit = await call(`${API}/edits`, { method: 'POST' });
  console.log('edit', edit.id);
  try {
    const bundle = await call(`${UPLOAD}/edits/${edit.id}/bundles?uploadType=media`, {
      method: 'POST', body: fs.readFileSync(AAB), headers: { 'Content-Type': 'application/octet-stream' },
    });
    console.log('bundle uploaded: versionCode', bundle.versionCode, 'sha256', bundle.sha256?.slice(0, 12));

    const track = await call(`${API}/edits/${edit.id}/tracks/internal`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track: 'internal',
        releases: [{
          versionCodes: [String(bundle.versionCode)],
          status: 'completed',
          releaseNotes: [{ language: 'en-US', text: NOTES }],
        }],
      }),
    });
    console.log('internal track →', track.releases?.map((r) => `${r.name || ''} ${r.versionCodes} ${r.status}`).join('; '));

    if (DRY) {
      await call(`${API}/edits/${edit.id}:validate`, { method: 'POST' });
      await call(`${API}/edits/${edit.id}`, { method: 'DELETE' });
      console.log('dry run: validated and discarded');
      return;
    }
    const done = await call(`${API}/edits/${edit.id}:commit`, { method: 'POST' });
    console.log('committed edit', done.id);
  } catch (e) {
    await call(`${API}/edits/${edit.id}`, { method: 'DELETE' }).catch(() => {});
    throw e;
  }
})().catch((e) => { console.error('FAILED:', e.message, e.cause?.code || e.cause?.message || ''); process.exit(1); });
