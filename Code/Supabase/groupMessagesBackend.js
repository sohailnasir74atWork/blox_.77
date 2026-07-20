// Group message body backend — Supabase-native.
//
// Replaces the RTDB /group_messages/{groupId}/messages/{key} subtree
// with a flat Postgres table. Same shape as private_messages /
// public chat: idempotent sends via client_msg_id, soft-delete with
// audit trail, realtime INSERT/UPDATE/DELETE filtered by group_id.
//
// Schema: supabase/010_group_messages.sql
//
// Notification CF: this module does NOT send pushes. Configure a
// Database Webhook in Supabase (dashboard → Database → Webhooks) on
// INSERT of public.group_messages that POSTs to the rewritten
// notifyGroupNewMessage Cloud Function HTTPS endpoint. The CF reads
// the group's memberIds from Firestore + each member's mute flag from
// chat_meta_data (per-user) — see HANDOFF.md.
//
// API surface mirrors what GroupChatScreen.jsx + GroupMessageList
// already consume (id + senderId + sender + avatar + text + imageUrl
// + fruits + replyTo + timestamp + isPro + roblox_username_verified +
// hasRecentGameWin + isCreator).

import { supabase } from './client';
import { uuidv4 } from './uuid';

const PAGE_SIZE_DEFAULT = 25;

// Explicit column list for reads — avoids select('*') egress on every page
// of group history. Must list exactly the columns fromGroupMessageRow() reads.
const GROUP_MSG_COLS =
  'id, client_msg_id, group_id, sender_id, sender_name, sender_avatar, text, image_url, fruits, reply_to, is_pro, roblox_username_verified, has_recent_game_win, last_game_win_at, is_creator, os, deleted, created_at';

// =====================================================================
// Row mapper
// =====================================================================
// DB columns (snake_case) → camelCase shape the UI consumes today.
// Field names match what GroupChatScreen.jsx wrote to RTDB so
// GroupMessageList works without changes.
export function fromGroupMessageRow(row) {
  if (!row) return null;
  const ts = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  return {
    id: row.id,
    clientMsgId: row.client_msg_id ?? null,
    groupId: row.group_id,
    senderId: row.sender_id,
    sender: row.sender_name ?? null,
    avatar: row.sender_avatar ?? null,
    text: row.text ?? null,
    imageUrl: row.image_url ?? null,
    fruits: Array.isArray(row.fruits) ? row.fruits : [],
    replyTo: row.reply_to ?? null,
    isPro: !!row.is_pro,
    robloxUsernameVerified: !!row.roblox_username_verified,
    hasRecentGameWin: !!row.has_recent_game_win,
    lastGameWinAt: row.last_game_win_at ?? null,
    isCreator: !!row.is_creator,
    OS: row.os ?? null,
    deleted: !!row.deleted,
    timestamp: ts,           // ms epoch — UI sort key
  };
}

function toInsertPayload({
  groupId, clientMsgId, senderId, m,
}) {
  return {
    group_id: groupId,
    client_msg_id: clientMsgId ?? null,
    sender_id: senderId,
    text: m.text ?? null,
    image_url: m.imageUrl ?? null,
    fruits: m.fruits ?? [],
    reply_to: m.replyTo ?? null,
    sender_name: m.sender ?? null,
    sender_avatar: m.avatar ?? null,
    is_pro: !!m.isPro,
    roblox_username_verified: !!m.robloxUsernameVerified,
    has_recent_game_win: !!m.hasRecentGameWin,
    last_game_win_at: m.lastGameWinAt ?? null,
    is_creator: !!m.isCreator,
    os: m.OS ?? null,
  };
}

export function newClientMsgId() {
  return uuidv4();
}

// =====================================================================
// Reads
// =====================================================================

// Initial / paginated load. `before` is a cursor: { createdAt, id }
// returned by the previous page's last (oldest) row.
export async function loadGroupMessages(groupId, { limit = PAGE_SIZE_DEFAULT, before = null } = {}) {
  if (!groupId) return [];
  let q = supabase
    .from('group_messages')
    .select(GROUP_MSG_COLS)
    .eq('group_id', groupId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (before?.createdAt) {
    q = q.or(
      `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
    );
  }

  const { data, error } = await q;
  if (error) {
    console.warn('[groupMessagesBackend] loadGroupMessages error:', error.message);
    return [];
  }
  return (data || []).map(fromGroupMessageRow);
}

// =====================================================================
// Realtime
// =====================================================================

// Subscribe to INSERT / UPDATE / DELETE for a group. Topic is
// per-call random so two screens subscribing to the same group don't
// collide on supabase-js's channel cache.
export function subscribeToGroupMessages(groupId, { onInsert, onUpdate, onDelete, onStatus } = {}) {
  if (!groupId) return () => {};

  let cancelled = false;
  const topic = `group:${groupId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const channel = supabase
    .channel(topic)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` },
      (payload) => { if (!cancelled) onInsert?.(fromGroupMessageRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` },
      (payload) => { if (!cancelled) onUpdate?.(fromGroupMessageRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` },
      (payload) => {
        if (cancelled) return;
        const id = payload.old?.id;
        if (id) onDelete?.(id);
      },
    )
    .subscribe((status, err) => onStatus?.(status, err));

  return () => {
    cancelled = true;
    try { supabase.removeChannel(channel); } catch {}
  };
}

// =====================================================================
// Writes
// =====================================================================

// Send a message via SECURITY DEFINER RPC (012_send_group_message.sql).
// Replaces the prior direct .insert() — which hit `42501 RLS` for any
// member without a populated group_meta_data row (is_group_member()
// gate). The RPC self-validates that the caller is the sender and
// stamps sender_id from firebase_uid(). Idempotent: ON CONFLICT DO
// NOTHING + a fallback select via UNIQUE(group_id, client_msg_id) so
// retries return the existing row.
export async function sendGroupMessage({
  groupId, senderId, message, clientMsgId = null,
}) {
  if (!groupId || !senderId || !message) {
    throw new Error('sendGroupMessage: groupId + senderId + message required');
  }

  const cmid = clientMsgId ?? newClientMsgId();

  const { data, error } = await supabase.rpc('send_group_message', {
    p_group_id: groupId,
    p_client_msg_id: cmid,
    p_text: message.text ?? null,
    p_image_url: message.imageUrl ?? null,
    p_fruits: message.fruits ?? [],
    p_reply_to: message.replyTo ?? null,
    p_sender_name: message.sender ?? null,
    p_sender_avatar: message.avatar ?? null,
    p_is_pro: !!message.isPro,
    p_roblox_username_verified: !!message.robloxUsernameVerified,
    p_has_recent_game_win: !!message.hasRecentGameWin,
    p_last_game_win_at: message.lastGameWinAt ?? null,
    p_is_creator: !!message.isCreator,
    p_os: message.OS ?? null,
  });

  if (error) throw error;
  return fromGroupMessageRow(data);
}

// Soft-delete a single message. Realtime UPDATE with deleted=true
// notifies all members; UI removes the row.
export async function softDeleteGroupMessage(messageId, deletedBy = null) {
  if (!messageId) return;
  const { error } = await supabase
    .from('group_messages')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
    })
    .eq('id', messageId);
  if (error) throw error;
}

// Soft-delete the last N non-deleted messages from a sender in a group.
export async function softDeleteGroupMessagesBySender(groupId, senderId, {
  limit = 60, deletedBy = null,
} = {}) {
  if (!groupId || !senderId) return { count: 0 };

  const { data, error: selectErr } = await supabase
    .from('group_messages')
    .select('id')
    .eq('group_id', groupId)
    .eq('sender_id', senderId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (selectErr) throw selectErr;
  if (!data?.length) return { count: 0 };

  const ids = data.map((r) => r.id);
  const { error: updateErr } = await supabase
    .from('group_messages')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
    })
    .in('id', ids);
  if (updateErr) throw updateErr;
  return { count: ids.length };
}

// Soft-delete every message in a group (admin "delete all" flow,
// usually paired with a group-delete in Firestore).
export async function softDeleteAllInGroup(groupId, deletedBy = null) {
  if (!groupId) return { count: 0 };
  const { data, error: selectErr } = await supabase
    .from('group_messages')
    .select('id')
    .eq('group_id', groupId)
    .eq('deleted', false);
  if (selectErr) throw selectErr;
  if (!data?.length) return { count: 0 };

  const ids = data.map((r) => r.id);
  const { error: updateErr } = await supabase
    .from('group_messages')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
    })
    .in('id', ids);
  if (updateErr) throw updateErr;
  return { count: ids.length };
}

// Report a group message. Increments report_count (best effort); when the
// count crosses REPORT_THRESHOLD the message is soft-deleted and the caller
// escalates the ban.
const REPORT_THRESHOLD = 10;
export async function reportGroupMessage(messageId, reporterId = null) {
  if (!messageId) throw new Error('reportGroupMessage: messageId required');

  const { data: existing, error: selectErr } = await supabase
    .from('group_messages')
    .select('report_count')
    .eq('id', messageId)
    .maybeSingle();
  if (selectErr) throw selectErr;
  if (!existing) throw new Error('Message not found');

  const nextCount = (existing.report_count ?? 0) + 1;

  if (nextCount >= REPORT_THRESHOLD) {
    const { error } = await supabase
      .from('group_messages')
      .update({
        report_count: nextCount,
        deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: reporterId,
      })
      .eq('id', messageId);
    if (error) throw error;
    return { action: 'deleted' };
  }

  const { error } = await supabase
    .from('group_messages')
    .update({ report_count: nextCount })
    .eq('id', messageId);
  if (error) throw error;
  return { action: 'reported' };
}
