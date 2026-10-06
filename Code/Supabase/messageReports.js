// Chat moderation helpers shared by the chat backends (supabase/034).
//
// - reportChatMessage(): the report_message rpc — one report per reporter per
//   message, server-side count and auto soft-delete at REPORT_THRESHOLD.
//   Falls back to the pre-034 read-modify-write when the rpc is not there yet
//   (034 not applied) or not callable (a token without the role claim maps to
//   `anon`); with 034 applied that legacy UPDATE is itself deduplicated by the
//   server, so the fallback can never inflate a count.
// - chatErrorCode(): maps a Supabase error to the codes the UI shows.
// - fetchMessageReports(): staff dashboard list (list_message_reports rpc).
import { supabase } from './client';

export const REPORT_THRESHOLD = 10; // = public._report_threshold()

const REPORT_TABLES = new Set(['messages', 'private_messages', 'group_messages']);

// 'SENDER_BANNED' | 'LINKS_NOT_ALLOWED' | 'NOT_ALLOWED' | null
export function chatErrorCode(error) {
  if (!error) return null;
  const text = [error.message, error.details, error.hint]
    .filter((s) => typeof s === 'string')
    .join(' ');
  if (text.includes('SENDER_BANNED')) return 'SENDER_BANNED';
  // Before NOT_ALLOWED: 'LINKS_NOT_ALLOWED' contains it.
  if (text.includes('LINKS_NOT_ALLOWED')) return 'LINKS_NOT_ALLOWED';
  if (text.includes('NOT_ALLOWED')) return 'NOT_ALLOWED';
  // RLS refusal (e.g. pinning as non-staff, writing another user's row).
  if (error.code === '42501' || /row-level security/i.test(text)) return 'NOT_ALLOWED';
  return null;
}

// rpc absent (034 not applied) or not executable for this token.
function rpcUnavailable(error) {
  const code = error?.code || '';
  if (['PGRST202', '42883', '42501'].includes(code)) return true;
  const msg = (error?.message || '').toLowerCase();
  return msg.includes('could not find the function') || msg.includes('permission denied for function');
}

async function legacyReport(table, messageId, reporterId) {
  const { data: existing, error: selectErr } = await supabase
    .from(table)
    .select('report_count')
    .eq('id', messageId)
    .maybeSingle();
  if (selectErr) throw selectErr;
  if (!existing) throw new Error('Message not found');

  const nextCount = (existing.report_count ?? 0) + 1;
  const patch = nextCount >= REPORT_THRESHOLD
    ? { report_count: nextCount, deleted: true, deleted_at: new Date().toISOString(), deleted_by: reporterId }
    : { report_count: nextCount };
  const { error } = await supabase.from(table).update(patch).eq('id', messageId);
  if (error) throw error;
  return { action: nextCount >= REPORT_THRESHOLD ? 'deleted' : 'reported', count: nextCount };
}

// Returns { action: 'reported' | 'deleted', count }.
export async function reportChatMessage(table, messageId, { reporterId = null, reason = null } = {}) {
  if (!REPORT_TABLES.has(table)) throw new Error(`reportChatMessage: bad table ${table}`);
  if (!messageId) throw new Error('reportChatMessage: messageId required');

  const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null;
  const { data, error } = await supabase.rpc('report_message', {
    p_table: table,
    p_message_id: messageId,
    p_reason: cleanReason,
  });
  if (error) {
    if (rpcUnavailable(error)) return legacyReport(table, messageId, reporterId);
    throw error;
  }
  const count = typeof data === 'number' ? data : Number(data) || 0;
  return { action: count >= REPORT_THRESHOLD ? 'deleted' : 'reported', count };
}

// Staff only (list_message_reports checks is_mod_staff). One item per
// reported message, newest report first. Page with `before` = the last item's
// lastReportedAt. Mirrors modLogBackend's { items, hasMore, schemaMissing }.
export async function fetchMessageReports({ limit = 50, before = null } = {}) {
  try {
    const { data, error } = await supabase.rpc('list_message_reports', {
      p_limit: limit,
      p_before: before,
    });
    if (error) throw error;
    const items = (data || []).map((r) => ({
      table: r.table_name,
      messageId: r.message_id,
      senderUid: r.sender_uid ?? null,
      locationId: r.location_id ?? null, // room_id / chat_id / group_id
      text: r.message_text ?? null,
      imageUrl: r.message_image_url ?? null,
      gif: r.message_gif ?? null,
      deleted: !!r.message_deleted,
      reportCount: r.report_count ?? 0,
      reportsRecorded: Number(r.reports_recorded) || 0,
      lastReportedAt: r.last_reported_at ?? null,
      reports: Array.isArray(r.reports)
        ? r.reports.map((x) => ({
            reporterUid: x.reporter_uid,
            reason: x.reason ?? null,
            createdAt: x.created_at ?? null,
          }))
        : [],
    }));
    return {
      items,
      hasMore: items.length >= limit,
      before: items.length ? items[items.length - 1].lastReportedAt : null,
      schemaMissing: false,
    };
  } catch (err) {
    console.warn('[messageReports] fetchMessageReports failed:', err?.message);
    const code = err?.code || '';
    const msg = (err?.message || '').toLowerCase();
    const schemaMissing = ['42883', 'PGRST202'].includes(code) || msg.includes('could not find the function');
    return { items: [], hasMore: false, before: null, schemaMissing };
  }
}
