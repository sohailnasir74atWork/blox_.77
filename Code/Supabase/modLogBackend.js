// Moderation audit log — READ side (supabase/031_mod_actions.sql).
//
// Rows are written only by Cloud Functions (functions/banEnforcement.js), so
// there is no client insert here. Reads go through staff-gated rpcs that
// paginate server-side. Ported from adoptme-jan7/Code/Supabase/modLogBackend.js.
import { supabase } from './client';

// "Table/rpc not there yet" (031 not applied) vs. "nothing moderated": the
// UI shows different text for each.
export const isMissingSchemaError = (err) => {
  const code = err?.code || '';
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code)) return true;
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('could not find the function');
};

const mapAction = (r) => ({
  id: r.id,
  action: r.action,
  targetUid: r.target_uid,
  targetEmail: r.target_email,
  targetName: r.target_name,
  reason: r.reason,
  strikeCount: r.strike_count,
  durationMinutes: r.duration_minutes,
  bannedUntilMs: r.banned_until_ms,
  isPermanent: !!r.is_permanent,
  actorUid: r.actor_uid,
  actorName: r.actor_name,
  actorRole: r.actor_role,
  source: r.source,
  // supabase/033: screenshot URLs (≤ 3) and free-form details for log actions.
  evidence: Array.isArray(r.evidence) ? r.evidence : [],
  details: r.details ?? null,
  createdAt: r.created_at ? Date.parse(r.created_at) : null,
  _cursorCreated: r.created_at,
  _cursorId: r.id,
});

const page = (data, limit) => {
  const items = (data || []).map(mapAction);
  const last = items[items.length - 1];
  return {
    items,
    hasMore: items.length >= limit,
    cursor: last ? { created: last._cursorCreated, id: last._cursorId } : null,
    schemaMissing: false,
  };
};

/** One user's moderation timeline (by uid and/or email), newest first. */
export const fetchUserModHistory = async ({ email, uid, cursor = null, limit = 25 } = {}) => {
  try {
    const { data, error } = await supabase.rpc('mod_actions_for_user', {
      p_email: email ? String(email).replace(/\(dot\)/g, '.').trim().toLowerCase() : null,
      p_uid: uid || null,
      p_cursor_created: cursor?.created || null,
      p_cursor_id: cursor?.id || null,
      p_limit: limit,
    });
    if (error) throw error;
    return page(data, limit);
  } catch (err) {
    console.warn('[modLog] fetchUserModHistory failed:', err?.message);
    return { items: [], hasMore: false, cursor: null, schemaMissing: isMissingSchemaError(err) };
  }
};

/** Per-moderator totals over the last `days` days. */
export const fetchModLeaderboard = async ({ days = 30, limit = 50 } = {}) => {
  try {
    const { data, error } = await supabase.rpc('mod_leaderboard', { p_days: days, p_limit: limit });
    if (error) throw error;
    const rows = (data || []).map((r) => ({
      actorUid: r.actor_uid,
      actorName: r.actor_name || 'Unknown',
      actorRole: r.actor_role,
      banCount: Number(r.ban_count) || 0,
      strikeCount: Number(r.strike_count) || 0,
      muteCount: Number(r.mute_count) || 0,
      unbanCount: Number(r.unban_count) || 0,
      totalCount: Number(r.total_count) || 0,
      distinctTargets: Number(r.distinct_targets) || 0,
      lastActionAt: r.last_action_at ? Date.parse(r.last_action_at) : null,
    }));
    return { rows, schemaMissing: false };
  } catch (err) {
    console.warn('[modLog] fetchModLeaderboard failed:', err?.message);
    return { rows: [], schemaMissing: isMissingSchemaError(err) };
  }
};

/** Global recent-actions feed, filters applied server-side. */
export const fetchRecentModActions = async (
  { action = null, actorUid = null, days = 30, cursor = null, limit = 30 } = {}
) => {
  try {
    const { data, error } = await supabase.rpc('mod_actions_recent', {
      p_action: action,
      p_actor_uid: actorUid,
      p_days: days,
      p_cursor_created: cursor?.created || null,
      p_cursor_id: cursor?.id || null,
      p_limit: limit,
    });
    if (error) throw error;
    return page(data, limit);
  } catch (err) {
    console.warn('[modLog] fetchRecentModActions failed:', err?.message);
    return { items: [], hasMore: false, cursor: null, schemaMissing: isMissingSchemaError(err) };
  }
};
