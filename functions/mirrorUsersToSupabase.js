/**
 * Cloud Function: mirror RTDB /users/{uid} into Supabase split tables.
 *
 * RTDB stays the SOURCE OF TRUTH. The app (and 14 other CFs) keep
 * reading/writing /users/{uid} unchanged. This function tails every
 * /users/{uid} write and fans the relevant fields out to 8 narrow
 * Supabase tables so new clients can read profile data without
 * pulling the full /users blob from RTDB.
 *
 * See:
 *   - supabase/004_users_split.sql                  — schema
 *   - supabase/004_users_split_FIELD_MAPPING.md     — field mapping
 *
 * Trigger: onWrite at /users/{uid} (the whole row), so we capture
 * every field change in one shot. We DON'T trigger per-leaf because
 * (a) it would create 8x more deployments, (b) reading the after-snapshot
 * once per write is already free.
 *
 * Cost note: this fires on EVERY /users write, including hot-path
 * writes to fields we don't mirror (rewardPoints, xp, dailyStars, shop).
 * Those fires no-op cheaply (each per-table function checks if its
 * fields changed and skips if not). Acceptable until measured otherwise.
 *
 * Failure handling: each per-table mirror is independent. If one
 * upsert fails, others still succeed. The next /users write will
 * retry the failed table. No dead-letter queue this phase — same
 * approach as mirrorChatMetaToSupabase.
 *
 * Deployment:
 *   firebase deploy --only functions:mirrorUsersToSupabase
 *   (Secrets SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY already set
 *    for Phase 2; reused here.)
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
// Used to skip per-table upserts when the changed leaf isn't ours.
function anyKeyChanged(before, after, keys) {
  for (const k of keys) {
    if ((before?.[k] ?? null) !== (after?.[k] ?? null)) return true;
  }
  return false;
}

// Diff two RTDB objects-of-true (`{key1: true, key2: true}`) shape used
// by /users/{uid}/badges and /users/{uid}/blocked_users.
// Returns { toAdd: [keys], toRemove: [keys] } — never touches existing keys
// so earned_at_ms / blocked_at_ms stay stable.
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
//
// Each takes (uid, before, after, supabase). Returns a Promise that
// resolves whether or not the mirror was needed. Errors are logged
// inside; never throw — we don't want one table failure to block the
// others (Promise.all rejects on first throw).
// --------------------------------------------------------------------

// Round 2 (2026-09): supabase/029 renames the identity table to
// user_identity_base and puts a masking VIEW named user_identity in front of
// it (email / decoded_email / date_of_birth only for the owner and staff).
// Writes must go to the base table. Until 029 has run the base doesn't exist,
// so fall back to the old name — this function can deploy before the SQL.
const IDENTITY_TABLE = 'user_identity_base';
const IDENTITY_TABLE_LEGACY = 'user_identity';
const isMissingTable = (error) => !!error && (
  error.code === '42P01' || error.code === 'PGRST205' ||
  /does not exist|could not find the table/i.test(error.message || '')
);
async function onIdentityTable(supabase, run) {
  const res = await run(supabase.from(IDENTITY_TABLE));
  if (isMissingTable(res.error)) return run(supabase.from(IDENTITY_TABLE_LEGACY));
  return res;
}

// email / decodedEmail / dateOfBirth are NOT copied from users/{uid} any more
// (round 2): the columns are omitted from this upsert so they are never
// nulled, and mirrorUsersPrivateToSupabase below fills them from
// users_private/{uid}.
const IDENTITY_KEYS = [
  'displayName', 'avatar', 'flage',
  'OS', 'createdAt', 'lastActivity', 'lastProfileEditAt',
  'lastGameWinAt',   // 2026-09: mirrored so clients stop reading it from RTDB per profile
];
async function mirrorIdentity(uid, before, after, supabase) {
  if (!anyKeyChanged(before, after, IDENTITY_KEYS)) return;

  const row = {
    uid,
    display_name: asString(after.displayName),
    avatar: asString(after.avatar),
    flag: asString(after.flage),               // typo fix: flage → flag
    os: asString(after.OS),
    created_at_ms: asNumber(after.createdAt),
    last_activity_ms: asNumber(after.lastActivity),
    last_profile_edit_ms: asNumber(after.lastProfileEditAt),
    last_game_win_ms: asNumber(after.lastGameWinAt),
    updated_at: nowIso(),
  };

  const { error } = await onIdentityTable(supabase, (t) => t.upsert(row, { onConflict: 'uid' }));
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

// 2026-09-04 fix: this upsert had FAILED on every call since the table was
// created — it wrote `is_helper` before the column existed, so no role change
// since the May backfill ever reached Supabase, and Senior Mod was read from
// `isCMSR`, a flag the Blox app never writes (it uses `isSeniorMod`).
// 2026-10-19: Blox now has a cosmetic Helper badge (isHelper) and staff-given
// custom titles (customTitle); supabase/045_helper_role.sql adds both columns.
// If 045 isn't applied yet the upsert is retried without them (logged), so
// every other role change still reaches Supabase. Columns are exactly:
//   uid, is_admin, is_moderator, is_baby_mod, is_trusted, is_cmsr, is_grinder,
//   is_raider, is_helper, custom_title
// `rolesUpdatedAt` is a stamp the admin UI writes with every role change so a
// repeat removal (same value) still re-mirrors.
const ROLES_KEYS = ['admin', 'isAdmin', 'isModerator', 'isBabyMod', 'isTrusted', 'isSeniorMod', 'isGrinder', 'isRaider', 'isHelper', 'customTitle', 'rolesUpdatedAt'];
const ROLES_045_COLS = ['is_helper', 'custom_title'];
// PostgREST: PGRST204 = upsert names a column the schema cache doesn't have,
// 42703 = undefined column. Only treat it as "045 missing" when it's ours.
const isMissing045Column = (error) =>
  !!error && (error.code === 'PGRST204' || error.code === '42703') &&
  ROLES_045_COLS.some((c) => String(error.message || '').includes(c));
async function mirrorRoles(uid, before, after, supabase) {
  if (!anyKeyChanged(before, after, ROLES_KEYS)) return;

  const row = {
    uid,
    // 2026-09-09 fix: admin lives under EITHER RTDB key. Legacy grants use
    // `admin`; the hardcoded-email bootstrap in Code/GlobelStats.js writes
    // `isAdmin` (and database.rules.json guards `isAdmin` with its own child
    // rule). The client gate is `existing.admin || existing.isAdmin`, so the
    // mirror has to accept both — reading only `admin` left bootstrap admins
    // at is_admin = false, and every RLS-gated write (poll creation) was
    // rejected with "new row violates row-level security policy".
    is_admin: asBool(after.admin) || asBool(after.isAdmin),
    is_moderator: asBool(after.isModerator),
    is_baby_mod: asBool(after.isBabyMod),
    is_trusted: asBool(after.isTrusted),
    is_cmsr: asBool(after.isSeniorMod),        // the client maps is_cmsr → isSeniorMod
    is_grinder: asBool(after.isGrinder),
    is_raider: asBool(after.isRaider),
    is_helper: asBool(after.isHelper),
    custom_title: asString(after.customTitle),
    updated_at: nowIso(),
  };

  let { error } = await supabase
    .from('user_roles')
    .upsert(row, { onConflict: 'uid' });
  if (isMissing045Column(error)) {
    console.warn('[mirrorUsers/roles] supabase/045 not applied: mirrored without is_helper/custom_title', uid);
    const legacy = { ...row };
    for (const c of ROLES_045_COLS) delete legacy[c];
    ({ error } = await supabase.from('user_roles').upsert(legacy, { onConflict: 'uid' }));
  }
  if (error) console.error('[mirrorUsers/roles]', uid, error.message);
}

const COSMETICS_KEYS = ['topBadge', 'isPro'];
// Active shop items mirrored as jsonb so the client (profileCache) can
// do its own expiresAt check without us needing a re-mirror at expiry.
const ACTIVE_ITEM_KEYS = ['profileFrame', 'chatTextColor', 'tradeCardBg', 'profileBanner', 'chatBubbleBg'];

function activeItemsChanged(before, after) {
  const beforeItems = before?.shop?.activeItems || {};
  const afterItems  = after?.shop?.activeItems  || {};
  for (const k of ACTIVE_ITEM_KEYS) {
    // Active items are OBJECTS ({expiresAt, color, ...}); `!==` compared object
    // identity, which is always different between the before/after snapshots,
    // so every /users write for a user with any cosmetic re-upserted the row
    // (2026-09: 11 M needless user_cosmetics updates on adoptme). Compare by value.
    if (JSON.stringify(beforeItems[k] ?? null) !== JSON.stringify(afterItems[k] ?? null)) return true;
  }
  return false;
}

async function mirrorCosmetics(uid, before, after, supabase) {
  if (!anyKeyChanged(before, after, COSMETICS_KEYS) && !activeItemsChanged(before, after)) return;

  const activeItems = after?.shop?.activeItems || {};
  const row = {
    uid,
    top_badge: asString(after.topBadge),
    is_pro: asBool(after.isPro),
    profile_frame:   asJsonb(activeItems.profileFrame),
    chat_text_color: asJsonb(activeItems.chatTextColor),
    trade_card_bg:   asJsonb(activeItems.tradeCardBg),
    profile_banner:  asJsonb(activeItems.profileBanner),
    chat_bubble_bg:  asJsonb(activeItems.chatBubbleBg),
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

const SETTINGS_KEYS = ['isReminderEnabled', 'isSelectedReminderEnabled', 'chatOffTrade', 'chatOffGeneral'];
async function mirrorSettings(uid, before, after, supabase) {
  if (!anyKeyChanged(before, after, SETTINGS_KEYS)) return;

  const row = {
    uid,
    is_reminder_enabled: asBool(after.isReminderEnabled),
    is_selected_reminder_enabled: asBool(after.isSelectedReminderEnabled),
    // Chat-availability switches — mirrored so the private_messages insert
    // trigger can reject blocked messages regardless of the sender's app version.
    chat_off_trade: asBool(after.chatOffTrade),
    chat_off_general: asBool(after.chatOffGeneral),
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
  // Quick equality short-circuit. Most /users writes don't touch badges.
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

// --------------------------------------------------------------------
// Mods roster (RTDB mods/{uid}) — absorbed from syncModRoster so the
// roster rides THIS function's invocation instead of a second CF
// triggering on every /users/{uid} write. After deploying this, delete
// the old trigger:  firebase functions:delete syncModRoster
// (keep seedModRoster — it's the separate scheduled seeder).
// --------------------------------------------------------------------
async function mirrorModsRoster(uid, before, after) {
  const relevantFields = ['isModerator', 'isBabyMod', 'displayName', 'avatar'];
  if (before && !anyKeyChanged(before, after, relevantFields)) return;

  const isMod = after.isModerator === true;
  const isJmod = after.isBabyMod === true;
  const ref = admin.database().ref(`mods/${uid}`);
  try {
    if (isMod || isJmod) {
      await ref.set({
        displayName: after.displayName || 'Unknown',
        avatar: after.avatar || '',
        role: isMod ? 'mod' : 'jmod',
        updatedAt: Date.now(),
      });
    } else {
      await ref.remove();
    }
  } catch (e) {
    console.error('[mirrorUsers/modsRoster]', uid, e.message);
  }
}

// On full /users/{uid} delete, drop rows from all 8 tables.
// Each delete is independent — if one fails, the others still go.
async function deleteAllForUser(uid, supabase) {
  const { error: identityError } = await onIdentityTable(supabase, (t) => t.delete().eq('uid', uid));
  if (identityError) console.error('[mirrorUsers/delete identity]', uid, identityError.message);
  const tables = [
    'user_roblox',
    'user_roles',
    'user_cosmetics',
    'user_notifications',
    'user_settings',
    'user_badges',
    'user_blocks',
  ];
  await Promise.all([
    ...tables.map(async (t) => {
      const { error } = await supabase.from(t).delete().eq('uid', uid);
      if (error) console.error(`[mirrorUsers/delete ${t}]`, uid, error.message);
    }),
    // Fruit Cards (supabase/057): collection, wallet and non-serial pulls go;
    // serial pulls stay as provenance with the uid blanked. Before 057 is
    // applied the function is missing (PGRST202): nothing to delete.
    (async () => {
      const { error } = await supabase.rpc('delete_user_cards', { p_uid: uid });
      if (error && error.code !== 'PGRST202') console.error('[mirrorUsers/delete cards]', uid, error.message);
    })(),
  ]);
}

// --------------------------------------------------------------------
// users_private/{uid} → user_identity_base.email / decoded_email /
// date_of_birth (round 2). Both email columns get the same canonical address
// (users_private holds it raw and lowercased; decoded_email used to be the
// website's raw copy next to its ','-encoded `email`). date_of_birth only
// ever exists on Adopt Me, so it is only sent when present.
//
// UPDATE, not upsert: a row holding only an email would have no display name,
// and profileCache would show "Anonymous" instead of falling back to RTDB.
// When the /users mirror hasn't created the row yet, create it from
// users/{uid} first (same mapper), then attach the email.
// --------------------------------------------------------------------
async function mirrorPrivate(uid, before, after, supabase) {
  const email = asString(after?.email);
  const dateOfBirth = asString(after?.dateOfBirth);
  // Compare against an empty record when there was none: a first write that
  // carries only deviceId (phone accounts, legacy users) must not null the
  // mirrored email.
  if (email === asString(before?.email) && dateOfBirth === asString(before?.dateOfBirth)) return;

  const cols = { email, decoded_email: email, updated_at: nowIso() };
  if (dateOfBirth || before?.dateOfBirth) cols.date_of_birth = dateOfBirth;

  const update = () => onIdentityTable(supabase, (t) => t.update(cols).eq('uid', uid).select('uid'));
  let { data, error } = await update();
  if (error) { console.error('[mirrorUsersPrivate/identity]', uid, error.message); return; }
  if ((data && data.length) || !after) return;

  const snap = await admin.database().ref(`users/${uid}`).once('value');
  if (!snap.exists()) return;
  await mirrorIdentity(uid, {}, snap.val() || {}, supabase);
  ({ error } = await update());
  if (error) console.error('[mirrorUsersPrivate/identity]', uid, error.message);
}

exports.mirrorUsersPrivateToSupabase = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '256MB',
    timeoutSeconds: 60,
  })
  .database.ref('/users_private/{uid}')
  .onWrite(async (change, context) => {
    const { uid } = context.params;
    try {
      await mirrorPrivate(
        uid,
        change.before.exists() ? change.before.val() : null,
        change.after.exists() ? change.after.val() : null,
        getSupabaseAdmin(),
      );
    } catch (e) {
      console.error('[mirrorUsersPrivate]', uid, e.message);
    }
    return null;
  });

// --------------------------------------------------------------------
// Trigger
// --------------------------------------------------------------------

exports.mirrorUsersToSupabase = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '512MB',     // bigger than chat-meta — we read the full /users row
    timeoutSeconds: 60,
  })
  .database.ref('/users/{uid}')
  .onWrite(async (change, context) => {
    const { uid } = context.params;
    const supabase = getSupabaseAdmin();

    // Full delete — propagate to every table + the mods roster. Also drop
    // users_private/{uid} (round 2): account deletion removes users/{uid},
    // and the rules don't let the client delete its own private record.
    if (!change.after.exists()) {
      await Promise.all([
        deleteAllForUser(uid, supabase),
        admin.database().ref(`mods/${uid}`).remove().catch(() => {}),
        admin.database().ref(`users_private/${uid}`).remove().catch(() => {}),
      ]);
      return null;
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
      mirrorModsRoster(uid, change.before.exists() ? before : null, after),
    ]);

    return null;
  });
exports._internal = { mirrorRoles, deleteAllForUser };
