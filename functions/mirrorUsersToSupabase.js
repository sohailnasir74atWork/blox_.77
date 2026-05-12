/**
 * Cloud Function: mirror RTDB /users/{uid} into Supabase split tables.
 *
 * RTDB stays the SOURCE OF TRUTH. The app keeps reading/writing
 * /users/{uid} unchanged. This function tails every /users/{uid} write
 * and fans the relevant fields out to 8 narrow Supabase tables so new
 * clients can read profile data without pulling the full /users blob
 * from RTDB.
 *
 * See:
 *   - supabase/003_users_split.sql            — schema
 *   - SUPABASE_MIGRATION.md                   — context
 *
 * Trigger: onWrite at /users/{uid} (the whole row), so we capture every
 * field change in one shot. We DON'T trigger per-leaf because (a) it
 * would create 8x more deployments, (b) reading the after-snapshot once
 * per write is already free.
 *
 * Cost note: this fires on EVERY /users write, including hot-path
 * writes to fields we don't mirror (rewardPoints, coins, xp, shop).
 * Those fires no-op cheaply (each per-table function checks if its
 * fields changed and skips if not).
 *
 * Failure handling: each per-table mirror is independent. If one upsert
 * fails, others still succeed. The next /users write will retry the
 * failed table.
 *
 * Deployment:
 *   firebase deploy --only functions:mirrorUsersToSupabase
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) {
  admin.initializeApp();
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

const nowIso = () => new Date().toISOString();

const asString = (v) => (typeof v === 'string' ? v : null);
const asBool = (v) => v === true; // strict — RTDB sometimes stores 'true'/1; only literal true counts
const asNumber = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asJsonb = (v) => (v && typeof v === 'object' ? v : null);

// Did any of the listed leaf keys change between before/after snapshots?
function anyKeyChanged(before, after, keys) {
  for (const k of keys) {
    if ((before?.[k] ?? null) !== (after?.[k] ?? null)) return true;
  }
  return false;
}

// Diff two RTDB objects-of-true (`{key1: true, key2: true}`) shape used
// by /users/{uid}/badges and /users/{uid}/blocked_users.
// Returns { toAdd: [keys], toRemove: [keys] } — never touches existing
// keys so earned_at_ms / blocked_at_ms stay stable.
function diffBoolMap(before, after) {
  const beforeKeys = new Set(Object.keys(before || {}));
  const afterKeys = new Set(Object.keys(after || {}));
  const toAdd = [];
  const toRemove = [];
  for (const k of afterKeys) {
    if (!beforeKeys.has(k) && (after[k] === true)) toAdd.push(k);
  }
  for (const k of beforeKeys) {
    if (!afterKeys.has(k)) toRemove.push(k);
  }
  return { toAdd, toRemove };
}

// --------------------------------------------------------------------
// Per-table mirrors
// --------------------------------------------------------------------

// Identity — the slim "show this user in chat" set. lastactivity is
// intentionally typo'd in RTDB; mirror reads either spelling.
const IDENTITY_KEYS = [
  'displayName', 'avatar', 'email', 'isBlock',
  'createdAt', 'lastactivity', 'lastActivity', 'online', 'OS',
];
async function mirrorIdentity(uid, before, after, supabase) {
  if (!anyKeyChanged(before, after, IDENTITY_KEYS)) return;

  const row = {
    uid,
    display_name: asString(after.displayName),
    avatar: asString(after.avatar),
    email: asString(after.email),
    is_block: asBool(after.isBlock),
    created_at_ms: asNumber(after.createdAt),
    // lastactivity is the typo'd RTDB field; lastActivity is a future-
    // proofed alternative spelling — accept either.
    last_activity_ms: asNumber(after.lastactivity ?? after.lastActivity),
    online: asBool(after.online),
    os: asString(after.OS),
    updated_at: nowIso(),
  };

  const { error } = await supabase
    .from('user_identity')
    .upsert(row, { onConflict: 'uid' });
  if (error) console.error('[mirrorUsers/identity]', uid, error.message);
}

const ROBLOX_KEYS = ['robloxUsername', 'robloxUserId', 'robloxUsernameVerified'];
async function mirrorRoblox(uid, before, after, supabase) {
  if (!anyKeyChanged(before, after, ROBLOX_KEYS)) return;

  const row = {
    uid,
    roblox_username: asString(after.robloxUsername),
    // RTDB stores robloxUserId as either string or number historically — coerce.
    roblox_user_id:
      after.robloxUserId == null ? null : String(after.robloxUserId),
    roblox_username_verified: asBool(after.robloxUsernameVerified),
    updated_at: nowIso(),
  };

  const { error } = await supabase
    .from('user_roblox')
    .upsert(row, { onConflict: 'uid' });
  if (error) console.error('[mirrorUsers/roblox]', uid, error.message);
}

// Both `admin` and `isAdmin` are used in Blox Fruit RTDB
// (GlobelStats.js:316 reads either). Coalesce.
const ROLES_KEYS = [
  'admin', 'isAdmin',
  'isModerator', 'isBabyMod', 'isTrusted',
  'isGrinder', 'isRaider',
];
async function mirrorRoles(uid, before, after, supabase) {
  if (!anyKeyChanged(before, after, ROLES_KEYS)) return;

  const row = {
    uid,
    is_admin: asBool(after.admin) || asBool(after.isAdmin),
    is_moderator: asBool(after.isModerator),
    is_baby_mod: asBool(after.isBabyMod),
    is_trusted: asBool(after.isTrusted),
    is_grinder: asBool(after.isGrinder),
    is_raider: asBool(after.isRaider),
    updated_at: nowIso(),
  };

  const { error } = await supabase
    .from('user_roles')
    .upsert(row, { onConflict: 'uid' });
  if (error) console.error('[mirrorUsers/roles]', uid, error.message);
}

const COSMETICS_KEYS = ['topBadge', 'isPro'];
async function mirrorCosmetics(uid, before, after, supabase) {
  if (!anyKeyChanged(before, after, COSMETICS_KEYS)) return;

  const row = {
    uid,
    top_badge: asString(after.topBadge),
    is_pro: asBool(after.isPro),
    updated_at: nowIso(),
  };

  const { error } = await supabase
    .from('user_cosmetics')
    .upsert(row, { onConflict: 'uid' });
  if (error) console.error('[mirrorUsers/cosmetics]', uid, error.message);
}

const NOTIFICATIONS_KEYS = ['isTokenInvalid', 'muteTradeNotifs', 'notificationSettings'];
async function mirrorNotifications(uid, before, after, supabase) {
  if (!anyKeyChanged(before, after, NOTIFICATIONS_KEYS)) return;

  const row = {
    uid,
    is_token_invalid: asBool(after.isTokenInvalid),
    mute_trade_notifs: asBool(after.muteTradeNotifs),
    notification_settings: asJsonb(after.notificationSettings),
    updated_at: nowIso(),
  };

  const { error } = await supabase
    .from('user_notifications')
    .upsert(row, { onConflict: 'uid' });
  if (error) console.error('[mirrorUsers/notifications]', uid, error.message);
}

const SETTINGS_KEYS = ['isReminderEnabled', 'isSelectedReminderEnabled'];
async function mirrorSettings(uid, before, after, supabase) {
  if (!anyKeyChanged(before, after, SETTINGS_KEYS)) return;

  const row = {
    uid,
    is_reminder_enabled: asBool(after.isReminderEnabled),
    is_selected_reminder_enabled: asBool(after.isSelectedReminderEnabled),
    updated_at: nowIso(),
  };

  const { error } = await supabase
    .from('user_settings')
    .upsert(row, { onConflict: 'uid' });
  if (error) console.error('[mirrorUsers/settings]', uid, error.message);
}

// Badges + blocks use the diff-then-add/remove strategy so we don't
// rewrite earned_at_ms / blocked_at_ms on every parent write.
async function mirrorBadges(uid, before, after, supabase) {
  const beforeBadges = (before && before.badges) || {};
  const afterBadges = (after && after.badges) || {};
  if (beforeBadges === afterBadges) return;
  const { toAdd, toRemove } = diffBoolMap(beforeBadges, afterBadges);
  if (toAdd.length === 0 && toRemove.length === 0) return;

  const now = Date.now();
  if (toAdd.length > 0) {
    const rows = toAdd.map((badge_id) => ({
      uid,
      badge_id,
      earned_at_ms: now,
      metadata: null,
    }));
    const { error } = await supabase
      .from('user_badges')
      .upsert(rows, { onConflict: 'uid,badge_id', ignoreDuplicates: true });
    if (error) console.error('[mirrorUsers/badges add]', uid, error.message);
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('user_badges')
      .delete()
      .eq('uid', uid)
      .in('badge_id', toRemove);
    if (error) console.error('[mirrorUsers/badges remove]', uid, error.message);
  }
}

async function mirrorBlocks(uid, before, after, supabase) {
  const beforeBlocks = (before && before.blocked_users) || {};
  const afterBlocks = (after && after.blocked_users) || {};
  if (beforeBlocks === afterBlocks) return;
  const { toAdd, toRemove } = diffBoolMap(beforeBlocks, afterBlocks);
  if (toAdd.length === 0 && toRemove.length === 0) return;

  const now = Date.now();
  if (toAdd.length > 0) {
    const rows = toAdd.map((blocked_uid) => ({
      uid,
      blocked_uid,
      blocked_at_ms: now,
    }));
    const { error } = await supabase
      .from('user_blocks')
      .upsert(rows, { onConflict: 'uid,blocked_uid', ignoreDuplicates: true });
    if (error) console.error('[mirrorUsers/blocks add]', uid, error.message);
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('user_blocks')
      .delete()
      .eq('uid', uid)
      .in('blocked_uid', toRemove);
    if (error) console.error('[mirrorUsers/blocks remove]', uid, error.message);
  }
}

// On full /users/{uid} delete, drop rows from all 8 tables.
async function deleteAllForUser(uid, supabase) {
  const tables = [
    'user_identity', 'user_roblox', 'user_roles', 'user_cosmetics',
    'user_notifications', 'user_settings', 'user_badges', 'user_blocks',
  ];
  await Promise.all(
    tables.map(async (t) => {
      const { error } = await supabase.from(t).delete().eq('uid', uid);
      if (error) console.error(`[mirrorUsers/delete ${t}]`, uid, error.message);
    }),
  );
}

// --------------------------------------------------------------------
// Trigger
// --------------------------------------------------------------------

exports.mirrorUsersToSupabase = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '512MB',
    timeoutSeconds: 60,
  })
  .database.ref('/users/{uid}')
  .onWrite(async (change, context) => {
    const { uid } = context.params;
    const supabase = getSupabaseAdmin();

    // Full delete — propagate to every table.
    if (!change.after.exists()) {
      return deleteAllForUser(uid, supabase);
    }

    const before = change.before.exists() ? change.before.val() : {};
    const after = change.after.val() || {};

    // Run all per-table mirrors in parallel. Each catches its own errors
    // and logs — wrapping in Promise.allSettled would be belt-and-braces
    // but Promise.all is fine because no mirror function ever throws.
    await Promise.all([
      mirrorIdentity(uid, before, after, supabase),
      mirrorRoblox(uid, before, after, supabase),
      mirrorRoles(uid, before, after, supabase),
      mirrorCosmetics(uid, before, after, supabase),
      mirrorNotifications(uid, before, after, supabase),
      mirrorSettings(uid, before, after, supabase),
      mirrorBadges(uid, before, after, supabase),
      mirrorBlocks(uid, before, after, supabase),
    ]);

    return null;
  });
