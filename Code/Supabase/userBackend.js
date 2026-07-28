// User profile backend — Supabase mirror of the RTDB /users/{uid}
// subtree split across 8 tables (user_identity, user_roblox, user_roles,
// user_cosmetics, user_notifications, user_settings, user_badges,
// user_blocks). See supabase/003_users_split.sql.
//
// READ-ONLY from the client. RTDB stays the source of truth for /users —
// the app keeps writing to /users/{uid} as today, mirrorUsersToSupabase
// (Cloud Function) tails those writes and upserts here. This module
// only provides reads, so flipping a caller from RTDB→Supabase is a
// one-line transport change without touching any write paths or the
// existing CFs that depend on /users.
//
// Convention: snake_case on the wire, camelCase shape returned to
// callers (matches what existing UI code already consumes from RTDB).
//
// Returns null on miss/error so callers can fall back to RTDB per-uid
// — same failure-mode contract as the legacy profileCache lookups.
//
// Fields deliberately NOT here (still on RTDB):
//   * fcmToken, isTokenInvalid (notification CF dependency)
//   * coins, rewardPoints, xp, dailyStars, purchases (economy)
//   * cosmetics inventory / shop (write-heavy)
//   * checkin (small)
//   * selectedFruits (game state)

import { supabase } from './client';

// Explicit column lists per table — one per from*Row() mapper below. Selecting
// only the columns the mapper reads (instead of select('*')) trims egress on
// these hot, batched profile-hydration reads (online list, leaderboard, chat
// headers). Keep in sync with the mappers when a column is added.
const IDENTITY_COLS = 'uid, display_name, avatar, email, is_block, created_at_ms, last_activity_ms, online, os';
const ROLES_COLS = 'uid, is_admin, is_cmsr, is_moderator, is_baby_mod, is_trusted, is_grinder, is_raider';
const COSMETICS_COLS = 'uid, top_badge, is_pro';
const ROBLOX_COLS = 'uid, roblox_username, roblox_user_id, roblox_username_verified';
const SETTINGS_COLS = 'uid, is_reminder_enabled, is_selected_reminder_enabled';
const NOTIFICATIONS_COLS = 'uid, is_token_invalid, mute_trade_notifs, notification_settings';

// =================================================================
// WAVE 1 — identity (display name, avatar, basic profile)
// =================================================================

export function fromIdentityRow(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    displayName: row.display_name ?? null,
    avatar: row.avatar ?? null,
    email: row.email ?? null,
    isBlock: !!row.is_block,
    createdAt: row.created_at_ms ?? null,
    lastactivity: row.last_activity_ms ?? null,    // matches RTDB key
    online: !!row.online,
    OS: row.os ?? null,
  };
}

export async function getIdentity(uid) {
  if (!uid) return null;
  const { data, error } = await supabase
    .from('user_identity')
    .select(IDENTITY_COLS)
    .eq('uid', uid)
    .maybeSingle();
  if (error) {
    if (error.code !== 'PGRST116') {
      console.warn('[userBackend] getIdentity error:', error.message);
    }
    return null;
  }
  return fromIdentityRow(data);
}

// -----------------------------------------------------------------
// Write-side helper: advance the caller's last_activity_ms heartbeat.
// Bypasses the RTDB → mirrorUsersToSupabase round-trip (which fired a
// Cloud Function invocation per heartbeat even though no other mirror
// cared). Backed by set_last_activity() in supabase/016_user_last_activity.sql
// — server-side clock is authoritative so client clock skew can't
// back-date the timestamp.
//
// Fire-and-forget from the caller's perspective. Returns the ms-epoch
// written, or 0 on failure / no auth.
// -----------------------------------------------------------------
export async function setLastActivity() {
  const { data, error } = await supabase.rpc('set_last_activity');
  if (error) {
    console.warn('[userBackend] setLastActivity error:', error.message);
    return 0;
  }
  return Number(data) || 0;
}

export async function getIdentityBatch(uids) {
  return _batchByUid('user_identity', uids, fromIdentityRow, IDENTITY_COLS);
}


// =================================================================
// WAVE 2 — roles + cosmetics
// =================================================================

export function fromRolesRow(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    isAdmin: !!row.is_admin,
    // Senior Mod (one rank below Admin) reuses the pre-scaffolded is_cmsr
    // column so no Supabase schema migration is needed. RTDB
    // users/{uid}/isSeniorMod stays the source of truth; the mirror CF
    // writes it here as is_cmsr.
    isSeniorMod: !!row.is_cmsr,
    isModerator: !!row.is_moderator,
    isBabyMod: !!row.is_baby_mod,
    isTrusted: !!row.is_trusted,
    isGrinder: !!row.is_grinder,
    isRaider: !!row.is_raider,
  };
}

export function fromCosmeticsRow(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    topBadge: row.top_badge ?? null,
    isPro: !!row.is_pro,
  };
}

export async function getRoles(uid) {
  if (!uid) return null;
  const { data, error } = await supabase
    .from('user_roles')
    .select(ROLES_COLS)
    .eq('uid', uid)
    .maybeSingle();
  if (error) {
    if (error.code !== 'PGRST116') console.warn('[userBackend] getRoles error:', error.message);
    return null;
  }
  return fromRolesRow(data);
}

export async function getCosmetics(uid) {
  if (!uid) return null;
  const { data, error } = await supabase
    .from('user_cosmetics')
    .select(COSMETICS_COLS)
    .eq('uid', uid)
    .maybeSingle();
  if (error) {
    if (error.code !== 'PGRST116') console.warn('[userBackend] getCosmetics error:', error.message);
    return null;
  }
  return fromCosmeticsRow(data);
}

export async function getRolesBatch(uids) {
  return _batchByUid('user_roles', uids, fromRolesRow, ROLES_COLS);
}

// Fetch users where `roleField` is true, joined with displayName/avatar
// from user_identity. Used by the Leaderboard tag tabs (Trusted / Grinder /
// Raider).
//
// `roleField` must be one of: is_trusted, is_grinder, is_raider.
// Returns [] on error (caller treats that the same as empty roster).
export async function getUsersByRole(roleField, limit = 100) {
  const allowed = new Set(['is_trusted', 'is_grinder', 'is_raider']);
  if (!allowed.has(roleField)) return [];

  const { data, error } = await supabase
    .from('user_roles')
    .select('uid, updated_at')
    .eq(roleField, true)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn(`[userBackend] getUsersByRole(${roleField}) error:`, error.message);
    return [];
  }
  const uids = (data || []).map(r => r.uid).filter(Boolean);
  if (uids.length === 0) return [];

  const identities = await getIdentityBatch(uids);
  return uids
    .map(uid => {
      const ident = identities.get(uid);
      return {
        userId: uid,
        displayName: ident?.displayName || 'Unknown',
        avatar: ident?.avatar || null,
      };
    })
    .filter(u => u.displayName !== 'Unknown' || u.avatar);
}

export async function getCosmeticsBatch(uids) {
  return _batchByUid('user_cosmetics', uids, fromCosmeticsRow, COSMETICS_COLS);
}


// =================================================================
// WAVE 2b — roblox (public-read; chat headers, online list, drawer)
// =================================================================

export function fromRobloxRow(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    robloxUsername: row.roblox_username ?? null,
    robloxUserId: row.roblox_user_id ?? null,
    robloxUsernameVerified: !!row.roblox_username_verified,
  };
}

export async function getRoblox(uid) {
  if (!uid) return null;
  const { data, error } = await supabase
    .from('user_roblox')
    .select(ROBLOX_COLS)
    .eq('uid', uid)
    .maybeSingle();
  if (error) {
    if (error.code !== 'PGRST116') console.warn('[userBackend] getRoblox error:', error.message);
    return null;
  }
  return fromRobloxRow(data);
}

export async function getRobloxBatch(uids) {
  return _batchByUid('user_roblox', uids, fromRobloxRow, ROBLOX_COLS);
}


// =================================================================
// WAVE 3 — settings + notifications (owner-only)
//
// No batch flavour: nobody else can read these (RLS owner-only),
// and we never need to look them up for other users.
// =================================================================

export function fromSettingsRow(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    isReminderEnabled: !!row.is_reminder_enabled,
    isSelectedReminderEnabled: !!row.is_selected_reminder_enabled,
  };
}

export function fromNotificationsRow(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    isTokenInvalid: !!row.is_token_invalid,
    muteTradeNotifs: !!row.mute_trade_notifs,
    notificationSettings: row.notification_settings ?? null,
  };
}

export async function getSettings(uid) {
  if (!uid) return null;
  const { data, error } = await supabase
    .from('user_settings')
    .select(SETTINGS_COLS)
    .eq('uid', uid)
    .maybeSingle();
  if (error) {
    if (error.code !== 'PGRST116') console.warn('[userBackend] getSettings error:', error.message);
    return null;
  }
  return fromSettingsRow(data);
}

export async function getNotifications(uid) {
  if (!uid) return null;
  const { data, error } = await supabase
    .from('user_notifications')
    .select(NOTIFICATIONS_COLS)
    .eq('uid', uid)
    .maybeSingle();
  if (error) {
    if (error.code !== 'PGRST116') console.warn('[userBackend] getNotifications error:', error.message);
    return null;
  }
  return fromNotificationsRow(data);
}


// =================================================================
// WAVE 4 — blocks + badges (relational tables — multi-row per uid)
//
// user_blocks  is owner-only RLS (only the blocker reads their own list).
// user_badges  is public-read (chat / drawer renders other users' badges).
// =================================================================

// Returns Set<blockedUid> for the given uid. Empty Set on miss.
// Returns null on error so callers can fall back to RTDB.
export async function getBlocks(uid) {
  if (!uid) return new Set();
  const { data, error } = await supabase
    .from('user_blocks')
    .select('blocked_uid')
    .eq('uid', uid);
  if (error) {
    console.warn('[userBackend] getBlocks error:', error.message);
    return null;
  }
  const out = new Set();
  for (const row of data || []) {
    if (row?.blocked_uid) out.add(row.blocked_uid);
  }
  return out;
}

// Returns Map<badgeId, { earnedAtMs, metadata }> for the given uid.
// Empty Map on miss; null on error.
export async function getBadges(uid) {
  if (!uid) return new Map();
  const { data, error } = await supabase
    .from('user_badges')
    .select('badge_id, earned_at_ms, metadata')
    .eq('uid', uid);
  if (error) {
    console.warn('[userBackend] getBadges error:', error.message);
    return null;
  }
  const out = new Map();
  for (const row of data || []) {
    if (!row?.badge_id) continue;
    out.set(row.badge_id, {
      earnedAtMs: row.earned_at_ms ?? null,
      metadata: row.metadata ?? null,
    });
  }
  return out;
}

// Batch: Map<uid, Map<badgeId, {...}>>. Used by leaderboard / drawer
// when showing badges for a list of users in one round-trip.
export async function getBadgesBatch(uids) {
  const result = new Map();
  if (!Array.isArray(uids) || uids.length === 0) return result;

  const dedup = [...new Set(uids.filter(Boolean))];
  if (dedup.length === 0) return result;

  const CHUNK = 200;
  for (let i = 0; i < dedup.length; i += CHUNK) {
    const slice = dedup.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('user_badges')
      .select('uid, badge_id, earned_at_ms, metadata')
      .in('uid', slice);
    if (error) {
      console.warn('[userBackend] getBadgesBatch chunk failed:', error.message);
      continue;
    }
    for (const row of data || []) {
      if (!row?.uid || !row?.badge_id) continue;
      let inner = result.get(row.uid);
      if (!inner) {
        inner = new Map();
        result.set(row.uid, inner);
      }
      inner.set(row.badge_id, {
        earnedAtMs: row.earned_at_ms ?? null,
        metadata: row.metadata ?? null,
      });
    }
  }
  return result;
}


// =================================================================
// Internal helper — generic batch-by-uid reader.
// All migrated single-row tables share the (uid PK, multi-row IN(...))
// shape, so we factor the chunk-and-merge logic out instead of
// duplicating it per table.
// =================================================================
async function _batchByUid(table, uids, mapRow, cols = '*') {
  const result = new Map();
  if (!Array.isArray(uids) || uids.length === 0) return result;

  const dedup = [...new Set(uids.filter(Boolean))];
  if (dedup.length === 0) return result;

  // Supabase URL length caps us around ~500 ids per .in() (URL-encoded).
  // Chunk to be safe.
  const CHUNK = 200;
  for (let i = 0; i < dedup.length; i += CHUNK) {
    const slice = dedup.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from(table)
      .select(cols)
      .in('uid', slice);
    if (error) {
      console.warn(`[userBackend] _batchByUid(${table}) chunk failed:`, error.message);
      continue; // partial result is fine — caller falls back per-uid
    }
    for (const row of data || []) {
      const mapped = mapRow(row);
      if (mapped) result.set(mapped.uid, mapped);
    }
  }
  return result;
}
