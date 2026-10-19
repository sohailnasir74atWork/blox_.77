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
import { reportChatMessage } from './messageReports';
import {
  stickersSupported, markStickersUnsupported, isUnknownGifColumn,
  stickersUnavailableError, withoutGifColumn, selectWithGifFallback,
} from './stickerSupport';

const PAGE_SIZE_DEFAULT = 15;

// Explicit column list for reads — avoids select('*') egress on every page
// of message history. Must list exactly the columns fromPrivateMessageRow() reads.
const PRIVATE_MSG_COLS =
  'id, client_msg_id, chat_id, sender_id, recipient_id, text, image_url, gif, fruits, reply_to, os, deleted, created_at';
// Before 050 there is no `gif` column (see stickerSupport.js).
const PRIVATE_MSG_COLS_NO_GIF = withoutGifColumn(PRIVATE_MSG_COLS);
const privateMsgCols = (withGif = stickersSupported('private_messages')) =>
  (withGif ? PRIVATE_MSG_COLS : PRIVATE_MSG_COLS_NO_GIF);

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
    gif: row.gif ?? null,                        // sticker URL (050)
    fruits: Array.isArray(row.fruits) ? row.fruits : [],
    replyTo: row.reply_to ?? null,
    OS: row.os ?? null,
    deleted: !!row.deleted,
    timestamp: ts,           // ms epoch — UI sort key
    serverTime: ts,          // mirrors RTDB serverTime (resolved server-side)
    // Raw Postgres timestamp (microsecond precision). Pagination cursors use
    // this instead of `timestamp`, which is truncated to ms and would make a
    // `lt`/`gt` cursor skip or repeat rows that share a millisecond.
    createdAt: row.created_at ?? null,
  };
}

// Set false the first time Postgres tells us `origin` doesn't exist, so a repo
// whose SQL migration hasn't been applied yet keeps sending messages instead of
// failing every insert. Flips back on only by restarting the app.
let originColumnSupported = true;

function toInsertPayload({
  chatId, clientMsgId, senderId, recipientId,
  text, imageUrl, gif, fruits, replyTo, OS, origin,
}) {
  return {
    chat_id: chatId,
    client_msg_id: clientMsgId ?? null,
    sender_id: senderId,
    recipient_id: recipientId,
    text: text ?? null,
    image_url: imageUrl ?? null,
    // Sticker URL; the server checks it against the sticker folders (050).
    ...(gif ? { gif } : {}),
    fruits: fruits ?? [],
    reply_to: replyTo ?? null,
    os: OS ?? null,
    // Which door the message came through: 'trade' or 'general'. Omitted
    // entirely when the column isn't there, so the insert stays valid.
    ...(originColumnSupported ? { origin: origin ?? null } : {}),
  };
}

// PostgREST reports an unknown column as 42703 (or PGRST204 on newer builds).
const isUnknownOriginColumn = (error) =>
  !!error && (error.code === '42703' || error.code === 'PGRST204') &&
  String(error.message || '').includes('origin');

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
  const { data, error } = await selectWithGifFallback('private_messages', (withGif) => {
    let q = supabase
      .from('private_messages')
      .select(privateMsgCols(withGif))
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
    return q;
  });
  if (error) {
    console.warn('[privateMessagesBackend] loadPrivateMessages error:', error.message);
    return [];
  }
  return (data || []).map(fromPrivateMessageRow);
}

// Rows newer than `since` ({ createdAt: ISO, id }), newest-first. Used to
// gap-fill after a realtime (re)subscribe: realtime never replays what it
// missed while the channel was down or the screen was blurred.
// Staff read of a private chat (Mod Panel → Chat Viewer). The table's SELECT
// policy is participant-only, so a plain select returns 0 rows for a mod who
// isn't in the chat. The 039 rpc lets admins read any chat and other staff
// only a reported one; a refusal is thrown so the viewer shows the reason.
// Falls back to the plain select only while the rpc isn't deployed yet.
export async function modLoadPrivateChat(chatId, { limit = 50 } = {}) {
  if (!chatId) return [];
  const { data, error } = await supabase.rpc('mod_read_private_chat', {
    p_chat_id: chatId,
    p_limit: limit,
  });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      return loadPrivateMessages(chatId, { limit });
    }
    throw new Error(error.message || 'Could not load chat');
  }
  return (data || []).map(fromPrivateMessageRow);
}

export async function loadPrivateMessagesSince(chatId, since = null, { limit = 200 } = {}) {
  if (!chatId) return [];
  const { data, error } = await selectWithGifFallback('private_messages', (withGif) => {
    let q = supabase
      .from('private_messages')
      .select(privateMsgCols(withGif))
      .eq('chat_id', chatId)
      .eq('deleted', false)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (since?.createdAt) {
      q = q.or(
        `created_at.gt.${since.createdAt},and(created_at.eq.${since.createdAt},id.gt.${since.id})`,
      );
    }
    return q;
  });
  if (error) {
    console.warn('[privateMessagesBackend] loadPrivateMessagesSince error:', error.message);
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
  text = null, imageUrl = null, gif = null, fruits = [], replyTo = null,
  OS = null, clientMsgId = null, origin = null,
}) {
  if (!chatId || !senderId || !recipientId) {
    throw new Error('sendPrivateMessage: chatId + senderId + recipientId required');
  }
  if (gif && !stickersSupported('private_messages')) throw stickersUnavailableError();

  const buildPayload = () => toInsertPayload({
    chatId,
    clientMsgId: clientMsgId ?? newClientMsgId(),
    senderId,
    recipientId,
    text,
    imageUrl,
    gif,
    fruits,
    replyTo,
    OS,
    origin,
  });

  const insertOnce = (p) => supabase
    .from('private_messages')
    .insert(p)
    .select(privateMsgCols())
    .single();

  let payload = buildPayload();
  let { data, error } = await insertOnce(payload);

  // Schema hasn't caught up: drop `origin` / `gif` and send again rather than
  // losing the message. Costs one wasted round-trip each, once per app session.
  // A sticker can't go without `gif`, so that send fails as not allowed.
  for (let attempt = 0; attempt < 2 && error; attempt++) {
    if (isUnknownOriginColumn(error)) {
      originColumnSupported = false;
    } else if (isUnknownGifColumn(error) && stickersSupported('private_messages')) {
      markStickersUnsupported('private_messages');
      if (gif) throw stickersUnavailableError();
    } else {
      break;
    }
    payload = buildPayload();
    ({ data, error } = await insertOnce(payload));
  }

  if (error) {
    // Idempotency: a previous retry already landed → fetch + return it
    // so the caller can swap their optimistic placeholder cleanly.
    if (error.code === '23505' && payload.client_msg_id) {
      const { data: existing, error: selectErr } = await supabase
        .from('private_messages')
        .select(privateMsgCols())
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

// Report a private message through the report_message rpc (supabase/034).
// Only the two participants can report; one report per reporter; the server
// soft-deletes at the threshold. Returns { action: 'reported' | 'deleted', count }.
export async function reportPrivateMessage(messageId, reporterId = null, reason = null) {
  if (!messageId) throw new Error('reportPrivateMessage: messageId required');
  return reportChatMessage('private_messages', messageId, { reporterId, reason });
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
