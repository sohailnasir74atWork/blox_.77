// One-shot backfill: copy existing RTDB /users/{uid} into the 8
// Supabase split tables.
//
// Idempotent — uses upsert, safe to re-run. For relational tables
// (user_badges, user_blocks) ignoreDuplicates is set so re-runs don't
// rewrite earned_at_ms / blocked_at_ms timestamps.
//
// Run:
//   SUPABASE_URL=https://jaimyhmanefvrijvjzxl.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role> \
//   node scripts/backfill-users-to-supabase.js
//
// Optional: parallelise across N workers with key ranges:
//   WORKER_TAG=W1 RANGE_START=A RANGE_END=H node scripts/...
//   WORKER_TAG=W2 RANGE_START=H RANGE_END=Z node scripts/...
//
// Prereqs:
//   1. serviceAccount.json at project root.
//   2. SUPABASE_SERVICE_ROLE_KEY in env.
//   3. supabase/000_init.sql + supabase/003_users_split.sql applied.

const path = require('path');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json');

let serviceAccount;
try {
  serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (e) {
  console.error(`\n❌ Could not load ${SERVICE_ACCOUNT_PATH}\n`);
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌ Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.\n');
  process.exit(1);
}

const RTDB_URL = process.env.RTDB_URL ||
  `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: RTDB_URL,
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PAGE_USERS = 100;
const FLUSH_AT = 200;

const RANGE_START = process.env.RANGE_START || null;
const RANGE_END = process.env.RANGE_END || null;
const WORKER_TAG = process.env.WORKER_TAG || '';
const TAG = WORKER_TAG ? `[${WORKER_TAG}] ` : '';

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
    is_block: asBool(u.isBlock),
    created_at_ms: asNumber(u.createdAt),
    last_activity_ms: asNumber(u.lastactivity ?? u.lastActivity),
    online: asBool(u.online),
    os: asString(u.OS),
    updated_at: nowIso(),
  };
}

function robloxRow(uid, u) {
  return {
    uid,
    roblox_username: asString(u.robloxUsername),
    roblox_user_id: u.robloxUserId == null ? null : String(u.robloxUserId),
    roblox_username_verified: asBool(u.robloxUsernameVerified),
    updated_at: nowIso(),
  };
}

function rolesRow(uid, u) {
  return {
    uid,
    is_admin: asBool(u.admin) || asBool(u.isAdmin),
    is_moderator: asBool(u.isModerator),
    is_baby_mod: asBool(u.isBabyMod),
    is_trusted: asBool(u.isTrusted),
    is_grinder: asBool(u.isGrinder),
    is_raider: asBool(u.isRaider),
    updated_at: nowIso(),
  };
}

function cosmeticsRow(uid, u) {
  return {
    uid,
    top_badge: asString(u.topBadge),
    is_pro: asBool(u.isPro),
    updated_at: nowIso(),
  };
}

function notificationsRow(uid, u) {
  return {
    uid,
    is_token_invalid: asBool(u.isTokenInvalid),
    mute_trade_notifs: asBool(u.muteTradeNotifs),
    notification_settings: asJsonb(u.notificationSettings),
    updated_at: nowIso(),
  };
}

function settingsRow(uid, u) {
  return {
    uid,
    is_reminder_enabled: asBool(u.isReminderEnabled),
    is_selected_reminder_enabled: asBool(u.isSelectedReminderEnabled),
    updated_at: nowIso(),
  };
}

function badgeRows(uid, u) {
  const badges = u.badges || {};
  if (!badges || typeof badges !== 'object') return [];
  return Object.keys(badges)
    .filter((k) => badges[k] === true)
    .map((badge_id) => ({
      uid,
      badge_id,
      earned_at_ms: typeof u.createdAt === 'number' ? u.createdAt : Date.now(),
      metadata: null,
    }));
}

function blockRows(uid, u) {
  const blocks = u.blocked_users || {};
  if (!blocks || typeof blocks !== 'object') return [];
  return Object.keys(blocks)
    .filter((k) => blocks[k] === true)
    .map((blocked_uid) => ({
      uid,
      blocked_uid,
      blocked_at_ms: typeof u.createdAt === 'number' ? u.createdAt : Date.now(),
    }));
}

async function upsertSlice(table, slice, conflictKey, opts = {}) {
  if (slice.length === 0) return;
  const delays = [1000, 2000, 4000, 8000, 16000, 30000, 60000, 60000, 60000, 60000];
  let attempt = 0;
  while (true) {
    try {
      const { error } = await supabase.from(table).upsert(slice, {
        onConflict: conflictKey,
        ...opts,
      });
      if (error) throw new Error(error.message);
      return;
    } catch (e) {
      attempt += 1;
      if (attempt > delays.length) throw e;
      const wait = delays[attempt - 1];
      console.log(`  ⚠️  ${table} hiccup (${e.message}). retry ${attempt}/${delays.length} in ${wait}ms…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function backfill() {
  console.log(`${TAG}📥 Streaming /users (page=${PAGE_USERS}, range=${RANGE_START || '∅'}…${RANGE_END || '∅'})`);
  const ref = admin.database().ref('users');
  let lastKey = null;
  let usersSeen = 0;

  // Per-table buffers — flush when any reaches FLUSH_AT.
  const buffers = {
    user_identity: [],
    user_roblox: [],
    user_roles: [],
    user_cosmetics: [],
    user_notifications: [],
    user_settings: [],
    user_badges: [],
    user_blocks: [],
  };

  const flushIfNeeded = async (force = false) => {
    const tasks = [];
    if (force || buffers.user_identity.length >= FLUSH_AT) {
      tasks.push(upsertSlice('user_identity', buffers.user_identity.splice(0), 'uid'));
    }
    if (force || buffers.user_roblox.length >= FLUSH_AT) {
      tasks.push(upsertSlice('user_roblox', buffers.user_roblox.splice(0), 'uid'));
    }
    if (force || buffers.user_roles.length >= FLUSH_AT) {
      tasks.push(upsertSlice('user_roles', buffers.user_roles.splice(0), 'uid'));
    }
    if (force || buffers.user_cosmetics.length >= FLUSH_AT) {
      tasks.push(upsertSlice('user_cosmetics', buffers.user_cosmetics.splice(0), 'uid'));
    }
    if (force || buffers.user_notifications.length >= FLUSH_AT) {
      tasks.push(upsertSlice('user_notifications', buffers.user_notifications.splice(0), 'uid'));
    }
    if (force || buffers.user_settings.length >= FLUSH_AT) {
      tasks.push(upsertSlice('user_settings', buffers.user_settings.splice(0), 'uid'));
    }
    if (force || buffers.user_badges.length >= FLUSH_AT) {
      tasks.push(upsertSlice('user_badges', buffers.user_badges.splice(0), 'uid,badge_id', { ignoreDuplicates: true }));
    }
    if (force || buffers.user_blocks.length >= FLUSH_AT) {
      tasks.push(upsertSlice('user_blocks', buffers.user_blocks.splice(0), 'uid,blocked_uid', { ignoreDuplicates: true }));
    }
    if (tasks.length) await Promise.all(tasks);
  };

  while (true) {
    let q = ref.orderByKey().limitToFirst(PAGE_USERS + (lastKey ? 1 : 0));
    if (lastKey) {
      q = q.startAt(lastKey);
    } else if (RANGE_START) {
      q = q.startAt(RANGE_START);
    }
    if (RANGE_END) q = q.endAt(RANGE_END);
    const snap = await q.once('value');
    const page = snap.val();
    if (!page) break;

    const keys = Object.keys(page);
    const newKeys = lastKey ? keys.filter((k) => k !== lastKey) : keys;
    if (newKeys.length === 0) break;

    for (const uid of newKeys) {
      const u = page[uid];
      if (!u || typeof u !== 'object') continue;

      buffers.user_identity.push(identityRow(uid, u));
      buffers.user_roblox.push(robloxRow(uid, u));
      buffers.user_roles.push(rolesRow(uid, u));
      buffers.user_cosmetics.push(cosmeticsRow(uid, u));
      buffers.user_notifications.push(notificationsRow(uid, u));
      buffers.user_settings.push(settingsRow(uid, u));
      buffers.user_badges.push(...badgeRows(uid, u));
      buffers.user_blocks.push(...blockRows(uid, u));

      usersSeen += 1;
    }

    await flushIfNeeded(false);
    process.stdout.write(`${TAG}users=${usersSeen}\n`);

    lastKey = keys[keys.length - 1];
    if (newKeys.length < PAGE_USERS) break;
  }

  await flushIfNeeded(true);
  console.log(`${TAG}✅ Done. users=${usersSeen}`);
  return usersSeen;
}

(async () => {
  try {
    await backfill();
    console.log('\n💡 Next: run VACUUM ANALYZE on each user_* table in Supabase CLI.');
    process.exit(0);
  } catch (e) {
    console.error('❌ Backfill failed:', e?.message || e);
    process.exit(1);
  }
})();
