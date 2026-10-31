/**
 * raid/index.js — Sea Beast Raid Cloud Functions (2026-10-31, Phase 1 step 2).
 * Rules in logic.js, reads/writes in core.js; this file only wires them.
 *
 * HTTPS, POST JSON, Authorization: Bearer <Firebase ID token>. 200 with the
 * result, or 4xx/5xx { error } where error is one of sign_in, bad_loadout,
 * capped, no_round, too_fast, expired, generic:
 *   raidState, raidStart, raidFinish, raidRewarded, raidLeaderboard
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (already set for the
 * mirror functions). Deploy BY NAME only (never a bare `--only functions`):
 *   firebase deploy --only functions:raidState,functions:raidStart,functions:raidFinish,functions:raidRewarded,functions:raidLeaderboard --project fruiteblocks
 * Apply supabase/059_sea_beast_raid.sql BEFORE the first deploy.
 */

const functions = require('firebase-functions/v1');
const core = require('./core');

const { io, RaidError } = core;
const SECRETS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

async function handleRequest(handler, req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'generic' }); return; }
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  let uid = null;
  if (m) {
    try { uid = (await io.verifyIdToken(m[1])).uid; } catch (_) { uid = null; }
  }
  if (!uid) { res.status(401).json({ error: 'sign_in' }); return; }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    res.status(200).json(await handler({ uid, body }));
  } catch (e) {
    if (e instanceof RaidError) { res.status(e.status).json({ error: e.code }); return; }
    io.log('unhandled', e && e.message);
    res.status(500).json({ error: 'generic' });
  }
}

const https = (handler) => functions
  .runWith({ secrets: SECRETS, memory: '256MB', timeoutSeconds: 30 })
  .https.onRequest((req, res) => handleRequest(handler, req, res));

module.exports = {
  raidState: https(core.state),
  raidStart: https(core.start),
  raidFinish: https(core.finish),
  raidRewarded: https(core.rewarded),
  raidLeaderboard: https(core.leaderboard),
  _internal: { handleRequest },
};
