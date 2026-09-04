// One-shot backfill (2026-09): bring Supabase `user_identity` and
// `user_cosmetics` in line with RTDB /users for EVERY user, so the client can
// stop reading `shop/activeItems`, `hasRecentGameWin` and `lastGameWinAt` from
// RTDB per profile (that was 64% of all RTDB operations).
//
// Why it is needed: the mirror CF only writes these tables when a mirrored key
// CHANGES, and `user_cosmetics` was missing the five cosmetic columns until
// migration 027 — so ~60k users have no identity row and no user has cosmetics
// mirrored. Idempotent (upsert on uid) — safe to re-run.
//
// Run from the repo root (serviceAccount.json must exist there):
//   SUPABASE_URL=https://jaimyhmanefvrijvjzxl.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role key> \
//   node scripts/backfill-cosmetics-gamewin-2026-09.js
//
// Options (env): PAGE=2000 (users per RTDB page), BATCH=500 (rows per upsert),
//                DRY_RUN=1 (read only), START_KEY=<uid> (resume).

const path = require('path');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

const serviceAccount = require(path.join(__dirname, '..', 'serviceAccount.json'));
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const PAGE = Number(process.env.PAGE || 2000);
const BATCH = Number(process.env.BATCH || 500);
const DRY_RUN = process.env.DRY_RUN === '1';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`,
});
const db = admin.database();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Same coercions as functions/mirrorUsersToSupabase.js
const nowIso = () => new Date().toISOString();
const asString = (v) => (typeof v === 'string' ? v : null);
const asBool = (v) => v === true;
const asNumber = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asJsonb = (v) => (v && typeof v === 'object' ? v : null);

function identityRow(uid, u) {
  return {
    uid,
    display_name: asString(u.displayName),
    avatar: asString(u.avatar),
    email: asString(u.email),
    decoded_email: asString(u.decodedEmail),
    flag: asString(u.flage),
    date_of_birth: asString(u.dateOfBirth),
    os: asString(u.OS),
    created_at_ms: asNumber(u.createdAt),
    last_activity_ms: asNumber(u.lastActivity),
    last_profile_edit_ms: asNumber(u.lastProfileEditAt),
    last_game_win_ms: asNumber(u.lastGameWinAt),
    is_block: asBool(u.isBlock),
    updated_at: nowIso(),
  };
}

function cosmeticsRow(uid, u) {
  const a = (u.shop && u.shop.activeItems) || {};
  return {
    uid,
    top_badge: asString(u.topBadge),
    is_pro: asBool(u.isPro),
    profile_frame: asJsonb(a.profileFrame),
    chat_text_color: asJsonb(a.chatTextColor),
    trade_card_bg: asJsonb(a.tradeCardBg),
    profile_banner: asJsonb(a.profileBanner),
    chat_bubble_bg: asJsonb(a.chatBubbleBg),
    updated_at: nowIso(),
  };
}

async function upsert(table, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    if (DRY_RUN) continue;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const { error } = await supabase.from(table).upsert(chunk, { onConflict: 'uid' });
      if (!error) break;
      console.warn(`[${table}] upsert error (attempt ${attempt}):`, error.message);
      if (attempt === 4) throw new Error(`${table} upsert failed: ${error.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function main() {
  let startKey = process.env.START_KEY || null;
  let total = 0, withCosmetics = 0, withWin = 0, pages = 0;
  const t0 = Date.now();
  for (;;) {
    let q = db.ref('users').orderByKey().limitToFirst(PAGE + (startKey ? 1 : 0));
    if (startKey) q = q.startAt(startKey);
    const snap = await q.once('value');
    const val = snap.val() || {};
    let keys = Object.keys(val).sort();
    if (startKey) keys = keys.filter((k) => k !== startKey);
    if (keys.length === 0) break;

    const ids = [], cos = [];
    for (const uid of keys) {
      const u = val[uid];
      if (!u || typeof u !== 'object') continue;
      ids.push(identityRow(uid, u));
      cos.push(cosmeticsRow(uid, u));
      if (u.shop && u.shop.activeItems) withCosmetics++;
      if (typeof u.lastGameWinAt === 'number') withWin++;
    }
    await upsert('user_identity', ids);
    await upsert('user_cosmetics', cos);

    total += keys.length; pages++;
    startKey = keys[keys.length - 1];
    console.log(`page ${pages}: ${total} users, ${withCosmetics} with cosmetics, ${withWin} with game win, ${((Date.now() - t0) / 1000).toFixed(0)}s, next=${startKey}`);
    if (keys.length < PAGE) break;
  }
  console.log(`DONE ${DRY_RUN ? '(dry run) ' : ''}${total} users in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  process.exit(0);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
