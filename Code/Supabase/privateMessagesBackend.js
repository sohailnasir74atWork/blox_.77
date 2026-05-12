// Private (1-on-1) message body backend — Supabase-native.
//
// Replaces the RTDB /private_messages/{chatId}/messages/{key} subtree
// with a flat Postgres table. Same shape as public chat: idempotent
// sends via client_msg_id, soft-delete with audit trail, realtime
// INSERT/UPDATE/DELETE stream filtered by chat_id.
//
// Schema: supabase/009_private_messages.sql
//
// Notification CF: this module does NOT send pushes. Configure a
// Database Webhook in Supabase (dashboard → Database → Webhooks) on
// INSERT of public.private_messages that POSTs to the rewritten
// notifyNewMessage Cloud Function HTTPS endpoint. See HANDOFF.md.
//
// API surface mirrors what PrivateChat.jsx already consumes (id +
// senderId + text + imageUrl + fruits + replyTo + timestamp).

import { supabase } from './client';
import { uuidv4 } from './uuid';

const PAGE_SIZE_DEFAULT = 15;

// Canonical chat id used by both RTDB and the Supabase chat_id column.
// Sort the two UIDs alphabetically and join with an underscore.
export function chatIdForPair(uidA, uidB) {
  return [uidA, uidB].sort().join('_');
}

// =====================================================================
// Row mapper
// =====================================================================
// DB columns → camelCase shape PrivateChat.jsx + PrivateMessageList
// already render. Field names (`id`, `senderId`, `text`, `imageUrl`,
// `fruits`, `replyTo`, `timestamp`, `serverTime`) match the RTDB shape
// so there is no UI rewrite.
export function fromPrivateMessageRow(row) {
  if (!row) return null;
  const ts = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  return {
    id: row.id,                                  // uuid — React key + cursor
    clientMsgId: row.client_msg_id ?? null,
    chatId: row.chat_id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    text: row.text ?? null,
    imageUrl: row.image_url ?? null,
    fruits: Array.isArray(row.fruits) ? row.fruits : [],
    replyTo: row.reply_to ?? null,
    OS: row.os ?? null,
    deleted: !!row.deleted,
    timestamp: ts,           // ms epoch — UI sort key
    serverTime: ts,          // mirrors RTDB serverTime (resolved server-side)
  };
}

function toInsertPayload({
  chatId, clientMsgId, senderId, recipientId,
  text, imageUrl, fruits, replyTo, OS,
}) {
  return {
    chat_id: chatId,
    client_msg_id: clientMsgId ?? null,
    sender_id: senderId,
    recipient_id: recipientId,
    text: text ?? null,
    image_url: imageUrl ?? null,
    fruits: fruits ?? [],
    reply_to: replyTo ?? null,
    os: OS ?? null,
  };
}

export function newClientMsgId() {
  return uuidv4();
}

// =====================================================================
// Reads
// =====================================================================

// Initial / paginated load. `before` is a cursor: { createdAt: ISO, id }
// returned by the previous page's last row. Newest-first within a chat.
export async function loadPrivateMessages(chatId, { limit = PAGE_SIZE_DEFAULT, before = null } = {}) {
  if (!chatId) return [];
  let q = supabase
    .from('private_messages')
    .select('*')
    .eq('chat_id', chatId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (before?.createdAt) {
    // Composite cursor — Postgres evaluates this as a row comparison;
    // (chat_id, created_at desc, id desc) index serves it.
    q = q.or(
      `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
    );
  }

  const { data, error } = await q;
  if (error) {
    console.warn('[privateMessagesBackend] loadPrivateMessages error:', error.message);
    return [];
  }
  return (data || []).map(fromPrivateMessageRow);
}

// =====================================================================
// Realtime
// =====================================================================

// Subscribe to INSERT / UPDATE / DELETE on a single chat.
//
// Topic suffix is per-call so two screens subscribing to the same
// chat each get a fresh channel — supabase-js otherwise reuses the
// existing one and `.on('postgres_changes', …)` fails.
//
// `onInsert(msg)` fires for new messages (own + partner's).
// `onUpdate(msg)` fires for soft-delete + any edit. UI usually treats
//   `msg.deleted === true` as a removal.
// `onDelete(id)` fires for hard delete (rare, mod path).
//
// Returns an unsubscribe function.
export function subscribeToPrivateMessages(chatId, { onInsert, onUpdate, onDelete, onStatus } = {}) {
  if (!chatId) return () => {};

  let cancelled = false;
  const topic = `pvtchat:${chatId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const channel = supabase
    .channel(topic)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'private_messages', filter: `chat_id=eq.${chatId}` },
      (payload) => { if (!cancelled) onInsert?.(fromPrivateMessageRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'private_messages', filter: `chat_id=eq.${chatId}` },
      (payload) => { if (!cancelled) onUpdate?.(fromPrivateMessageRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'private_messages', filter: `chat_id=eq.${chatId}` },
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

// Send a message. Idempotent across retries via UNIQUE(chat_id,
// client_msg_id). Returns the row in the UI shape so callers can
// optimistic-update + reconcile on resolve.
export async function sendPrivateMessage({
  chatId, senderId, recipientId,
  text = null, imageUrl = null, fruits = [], replyTo = null,
  OS = null, clientMsgId = null,
}) {
  if (!chatId || !senderId || !recipientId) {
    throw new Error('sendPrivateMessage: chatId + senderId + recipientId required');
  }

  const payload = toInsertPayload({
    chatId,
    clientMsgId: clientMsgId ?? newClientMsgId(),
    senderId,
    recipientId,
    text,
    imageUrl,
    fruits,
    replyTo,
    OS,
  });

  const { data, error } = await supabase
    .from('private_messages')
    .insert(payload)
    .select()
    .single();

  if (error) {
    // Idempotency: a previous retry already landed → fetch + return it
    // so the caller can swap their optimistic placeholder cleanly.
    if (error.code === '23505' && payload.client_msg_id) {
      const { data: existing, error: selectErr } = await supabase
        .from('private_messages')
        .select('*')
        .eq('chat_id', chatId)
        .eq('client_msg_id', payload.client_msg_id)
        .maybeSingle();
      if (selectErr) throw selectErr;
      if (existing) return fromPrivateMessageRow(existing);
    }
    throw error;
  }
  return fromPrivateMessageRow(data);
}

// Soft-delete a single message. UI filters `deleted` rows out via
// loadPrivateMessages and via subscribeToPrivateMessages.onUpdate.
export async function softDeletePrivateMessage(messageId, deletedBy = null) {
  if (!messageId) return;
  const { error } = await supabase
    .from('private_messages')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
    })
    .eq('id', messageId);
  if (error) throw error;
}

// Report a private message. Increments report_count (best effort); when the
// count crosses REPORT_THRESHOLD the message is soft-deleted and the caller
// escalates the ban. Returns { action } so callers can branch their UI.
const REPORT_THRESHOLD = 10;
export async function reportPrivateMessage(messageId, reporterId = null) {
  if (!messageId) throw new Error('reportPrivateMessage: messageId required');

  const { data: existing, error: selectErr } = await supabase
    .from('private_messages')
    .select('report_count')
    .eq('id', messageId)
    .maybeSingle();
  if (selectErr) throw selectErr;
  if (!existing) throw new Error('Message not found');

  const nextCount = (existing.report_count ?? 0) + 1;

  if (nextCount >= REPORT_THRESHOLD) {
    const { error } = await supabase
      .from('private_messages')
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
    .from('private_messages')
    .update({ report_count: nextCount })
    .eq('id', messageId);
  if (error) throw error;
  return { action: 'reported' };
}

// Soft-delete every non-deleted message in a chat. Two round-trips
// because PostgREST doesn't expose UPDATE..ORDER BY..LIMIT.
export async function softDeleteAllInChat(chatId, deletedBy = null) {
  if (!chatId) return { count: 0 };
  const { data, error: selectErr } = await supabase
    .from('private_messages')
    .select('id')
    .eq('chat_id', chatId)
    .eq('deleted', false);
  if (selectErr) throw selectErr;
  if (!data?.length) return { count: 0 };

  const ids = data.map((r) => r.id);
  const { error: updateErr } = await supabase
    .from('private_messages')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
    })
    .in('id', ids);
  if (updateErr) throw updateErr;
  return { count: ids.length };
}
