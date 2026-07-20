// Public-chat backend — Supabase-native client for chat_<lang>_upgrade rooms.
//
// As of the public-chat cut-over, *all* writes (send, pin/unpin, delete,
// bulk-delete-by-sender) go directly to Supabase from the client. RTDB
// is no longer the source of truth for new messages. Old app builds
// (still on RTDB) are explicitly out of scope.
//
// Idempotent send: every send carries a client-generated UUID
// (`client_msg_id`). The UNIQUE(room_id, client_msg_id) index in
// 005_client_msg_id.sql makes retries safe — a duplicate insert returns
// the existing row instead of erroring.
//
// Soft delete: messages are flagged `deleted = true` rather than
// hard-deleted, so moderation has an audit trail. loadMessages filters
// them out; UI listens for UPDATE events and treats `deleted = true` as
// a removal.
//
// See SUPABASE_MIGRATION.md and adoptme-jan7's chatBackend.js for the
// pattern this is modeled after.

import { supabase } from './client';
import { uuidv4 } from './uuid';
import { getAuth, getIdToken } from '@react-native-firebase/auth';

// -----------------------------------------------------------------
// Realtime auth / hard-reset helpers (used by Trader.jsx recovery).
//
// ensureRealtimeAuth(): force realtime to populate its access token BEFORE
// a channel subscribes. supabase-js fires its own internal setAuth on
// connect, but it's fire-and-forget — if the WebSocket opens before our
// async accessToken callback resolves, the channel JOIN is sent with a
// null token and the server rejects with InvalidJWTToken. Awaiting
// setAuth() here closes that race.
//
// resetRealtimeAndAuth(): when a channel wedges (CHANNEL_ERROR / TIMED_OUT /
// CLOSED), removing + recreating it is NOT enough — the underlying
// WebSocket can stay dead (bad auth handshake, network blip across sleep,
// expired token cached by realtime) and every fresh channel inherits it.
// This force-refreshes the Firebase ID token, pushes it into the realtime
// client, then disconnects + reconnects so the next subscribe re-handshakes
// from scratch.
// -----------------------------------------------------------------
export async function ensureRealtimeAuth() {
  try { await supabase.realtime.setAuth(); }
  catch (e) { console.warn('[realtime] ensureRealtimeAuth failed:', e?.message); }
}

export async function resetRealtimeAndAuth() {
  const u = getAuth().currentUser;
  let freshToken = null;
  if (u) {
    try { freshToken = await getIdToken(u, /* forceRefresh */ true); }
    catch (e) { console.warn('[realtime] token refresh failed:', e?.message); }
  }
  // Push the fresh JWT into the realtime client BEFORE reconnecting, else the
  // socket can keep using its cached token and fail with InvalidJWTToken again.
  if (freshToken) {
    try { supabase.realtime.setAuth(freshToken); }
    catch (e) { console.warn('[realtime] setAuth failed:', e?.message); }
  }
  try { supabase.realtime.disconnect(); } catch {}
  try { supabase.realtime.connect(); }
  catch (e) { console.warn('[realtime] reconnect failed:', e?.message); }
}

// -----------------------------------------------------------------
// Row mapper — DB snake_case → UI camelCase shape used by Trader.jsx.
//
// `id` exposed to UI is the Supabase UUID. We also expose `rtdbKey` so
// callers can correlate against the legacy RTDB key if needed (e.g.
// during the transition window when both data sources are in play).
// -----------------------------------------------------------------
// Explicit column list for every hot-path messages read. Derived from
// fromMessageRow below (the ONLY consumer of these rows) — NOT copied
// from adoptme, whose schema differs (no rtdb_key, has sender_name etc.).
// Excludes moderation-audit columns (deleted_at, deleted_by, report_count,
// strike_count) so hot fetches don't silently widen as the table grows.
// Keep in sync with fromMessageRow.
const MSG_COLS =
  'id, client_msg_id, rtdb_key, room_id, sender_id, text, gif, fruits, reply_to, os, created_at, deleted';

export function fromMessageRow(row) {
  if (!row) return null;
  const ts = row.created_at ? new Date(row.created_at).getTime() : 0;
  return {
    id: row.id,                    // uuid — used as React key + cursor
    clientMsgId: row.client_msg_id ?? null, // idempotency key set by sender
    rtdbKey: row.rtdb_key ?? null, // legacy RTDB push key, may be null on heuristic-pinned messages
    roomId: row.room_id,
    senderId: row.sender_id,
    text: row.text ?? null,
    gif: row.gif ?? null,
    fruits: Array.isArray(row.fruits) ? row.fruits : [],
    replyTo: row.reply_to ?? null,
    OS: row.os ?? null,
    timestamp: ts,                 // ms epoch — UI sort key
    deleted: !!row.deleted,        // soft-delete flag — UI removes when true
  };
}

// Same idea for pinned_messages — keep in sync with fromPinnedRow and
// the loadPinnedMessages flatten.
const PINNED_COLS = 'id, rtdb_key, message_id, room_id, pinned_by, pinned_at';

export function fromPinnedRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    rtdbKey: row.rtdb_key ?? null,
    messageId: row.message_id,
    roomId: row.room_id,
    pinnedBy: row.pinned_by ?? null,
    pinnedAt: row.pinned_at ? new Date(row.pinned_at).getTime() : 0,
  };
}

// -----------------------------------------------------------------
// Initial page load — newest-first, capped at PAGE_SIZE. Drop-in
// replacement for the get(query(chatRef, orderByKey(), limitToLast(N)))
// path in Trader.jsx loadMessages().
// -----------------------------------------------------------------
export async function loadMessages(roomId, { limit = 50, before = null, beforeMs = null } = {}) {
  if (!roomId) return [];
  let q = supabase
    .from('messages')
    .select(MSG_COLS)
    .eq('room_id', roomId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (before?.createdAt && before?.id) {
    // Composite cursor — gap-free even when several messages share the same
    // created_at millisecond. The (room_id, created_at desc, id desc) index
    // serves it. Preferred over beforeMs, which silently skips the rows tied
    // on the boundary millisecond (permanent holes in scroll-back).
    q = q.or(
      `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
    );
  } else if (beforeMs) {
    // Legacy timestamp-only cursor — kept for the RTDB-fallback path, which
    // has no Supabase row id to anchor the composite cursor on.
    q = q.lt('created_at', new Date(beforeMs).toISOString());
  }
  const { data, error } = await q;
  if (error) {
    console.warn('[chatBackend] loadMessages error:', error.message);
    return [];
  }
  return (data || []).map(fromMessageRow);
}

// -----------------------------------------------------------------
// Forward pagination: fetch messages strictly NEWER than `since`
// ({ createdAt, id } composite cursor). Used for gap-fill on reconnect so
// INSERTs missed while the WebSocket was dead/resubscribing are backfilled.
// Symmetric to loadMessages' `before` cursor but with `>`. Returns
// newest-first to match the render order used everywhere else.
// -----------------------------------------------------------------
export async function loadMessagesSince(roomId, since = null, { limit = 200 } = {}) {
  if (!roomId) return [];
  let q = supabase
    .from('messages')
    .select(MSG_COLS)
    .eq('room_id', roomId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (since?.createdAt && since?.id) {
    q = q.or(
      `created_at.gt.${since.createdAt},and(created_at.eq.${since.createdAt},id.gt.${since.id})`,
    );
  }
  const { data, error } = await q;
  if (error) {
    console.warn('[chatBackend] loadMessagesSince error:', error.message);
    return [];
  }
  return (data || []).map(fromMessageRow);
}

// -----------------------------------------------------------------
// Pinned messages for a room (newest-pinned-first).
// -----------------------------------------------------------------
export async function loadPinnedMessages(roomId) {
  if (!roomId) return [];
  const { data, error } = await supabase
    .from('pinned_messages')
    .select(`${PINNED_COLS}, messages!inner(${MSG_COLS})`)
    .eq('room_id', roomId)
    .order('pinned_at', { ascending: false });
  if (error) {
    console.warn('[chatBackend] loadPinnedMessages error:', error.message);
    return [];
  }
  // Flatten the joined message into the UI shape.
  return (data || []).map((row) => {
    const msg = fromMessageRow(row.messages);
    if (!msg) return null;
    return {
      ...msg,
      pinnedAt: row.pinned_at ? new Date(row.pinned_at).getTime() : 0,
      pinnedBy: row.pinned_by ?? null,
      pinnedRowId: row.id,        // pinned_messages.id — used to unpin
      pinnedRtdbKey: row.rtdb_key ?? null,
    };
  }).filter(Boolean);
}

// -----------------------------------------------------------------
// Realtime subscription for new messages in a room. Drop-in
// replacement for the onChildAdded(messagesRef) listener in Trader.jsx.
//
// Topic suffix is per-call random — supabase-js returns the existing
// channel for duplicate topics; without the suffix, switching channels
// fast or having two screens subscribed for the same room would hit
// "cannot add postgres_changes callbacks after subscribe()".
//
// Returns an unsubscribe function.
// -----------------------------------------------------------------
export function subscribeToMessages(roomId, { onInsert, onDelete, onUpdate, onStatus } = {}) {
  if (!roomId) return () => {};

  let cancelled = false;
  const topic = `pubchat:${roomId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const channel = supabase
    .channel(topic)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
      (payload) => { if (!cancelled) onInsert?.(fromMessageRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
      (payload) => { if (!cancelled) onUpdate?.(fromMessageRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
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

// -----------------------------------------------------------------
// Realtime subscription for pin/unpin in a room.
// -----------------------------------------------------------------
export function subscribeToPinned(roomId, { onUpsert, onRemove, onStatus } = {}) {
  if (!roomId) return () => {};

  let cancelled = false;
  const topic = `pubchat-pin:${roomId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const channel = supabase
    .channel(topic)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'pinned_messages', filter: `room_id=eq.${roomId}` },
      (payload) => { if (!cancelled) onUpsert?.(fromPinnedRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'pinned_messages', filter: `room_id=eq.${roomId}` },
      (payload) => { if (!cancelled) onUpsert?.(fromPinnedRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'pinned_messages', filter: `room_id=eq.${roomId}` },
      (payload) => {
        if (cancelled) return;
        const id = payload.old?.id;
        if (id) onRemove?.(id);
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

// Map a Trader.jsx-shaped message object into the snake_case columns the
// `messages` table expects. Mirrors the field set Trader.jsx used to push
// to RTDB (text, timestamp, senderId, replyTo, fruits, gif, OS) — no
// sender profile snapshot, since profileCache resolves that on render.
function toInsertPayload(roomId, m) {
  return {
    room_id: roomId,
    client_msg_id: m.clientMsgId ?? null,
    sender_id: m.senderId,
    text: m.text ?? null,
    gif: m.gif ?? null,
    fruits: m.fruits ?? [],
    reply_to: m.replyTo ?? null,
    os: m.OS ?? null,
  };
}

// Generate a fresh client_msg_id. Callers should reuse the *same* id
// across retries of the same logical send.
export function newClientMsgId() {
  return uuidv4();
}

// Insert a new message. If `message.clientMsgId` is present and a row
// with the same (room_id, client_msg_id) already exists (i.e. a previous
// retry attempt landed), return that existing row instead of throwing —
// at-least-once semantics with no duplicates.
export async function sendMessage(roomId, message) {
  if (!roomId) throw new Error('sendMessage: roomId required');
  if (!message?.senderId) throw new Error('sendMessage: senderId required');

  const payload = toInsertPayload(roomId, message);
  const { data, error } = await supabase
    .from('messages')
    .insert(payload)
    .select(MSG_COLS)
    .single();

  if (error) {
    if (error.code === '23505' && payload.client_msg_id) {
      const { data: existing, error: selectErr } = await supabase
        .from('messages')
        .select(MSG_COLS)
        .eq('room_id', roomId)
        .eq('client_msg_id', payload.client_msg_id)
        .maybeSingle();
      if (selectErr) throw selectErr;
      if (existing) return fromMessageRow(existing);
    }
    throw error;
  }
  return fromMessageRow(data);
}

// Soft-delete a single message. UI is expected to filter `deleted`
// rows out via the realtime UPDATE handler (and loadMessages already
// filters them).
export async function softDeleteMessage(messageId, deletedBy = null) {
  const { error } = await supabase
    .from('messages')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
    })
    .eq('id', messageId);
  if (error) throw error;
}

// Soft-delete a single message by its legacy RTDB push key. Used for
// the transition window when the UI still has only the rtdbKey for a
// row (the mirror CF backfilled it from RTDB).
export async function softDeleteMessageByRtdbKey(roomId, rtdbKey, deletedBy = null) {
  const { error } = await supabase
    .from('messages')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
    })
    .eq('room_id', roomId)
    .eq('rtdb_key', rtdbKey);
  if (error) throw error;
}

// Report a public-chat message. Increments report_count atomically (best
// effort — read-modify-write); when the count crosses REPORT_THRESHOLD the
// message is soft-deleted and the caller escalates the ban.
const REPORT_THRESHOLD = 10;
export async function reportPublicMessage(messageId, reporterId = null) {
  if (!messageId) throw new Error('reportPublicMessage: messageId required');

  const { data: existing, error: selectErr } = await supabase
    .from('messages')
    .select('report_count')
    .eq('id', messageId)
    .maybeSingle();
  if (selectErr) throw selectErr;
  if (!existing) throw new Error('Message not found');

  const nextCount = (existing.report_count ?? 0) + 1;

  if (nextCount >= REPORT_THRESHOLD) {
    const { error } = await supabase
      .from('messages')
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
    .from('messages')
    .update({ report_count: nextCount })
    .eq('id', messageId);
  if (error) throw error;
  return { action: 'reported' };
}

// Soft-delete the last N non-deleted messages from a sender in a room.
// Two round-trips because PostgREST doesn't expose UPDATE..ORDER BY..LIMIT;
// fine for an admin-tier moderation action.
export async function softDeleteMessagesBySender(roomId, senderId, {
  limit = 60, deletedBy = null,
} = {}) {
  if (!roomId || !senderId) return { count: 0 };
  const { data, error: selectErr } = await supabase
    .from('messages')
    .select('id')
    .eq('room_id', roomId)
    .eq('sender_id', senderId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (selectErr) throw selectErr;
  if (!data?.length) return { count: 0 };

  const ids = data.map((r) => r.id);
  const { error: updateErr } = await supabase
    .from('messages')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
    })
    .in('id', ids);
  if (updateErr) throw updateErr;
  return { count: ids.length };
}

// =====================================================================
// Pinned messages — writes
// =====================================================================

// Pin a message. `pinnedBy` is the moderator's Firebase UID — used
// both to satisfy RLS and as an audit trail.
export async function pinMessage(roomId, messageId, pinnedBy) {
  if (!roomId || !messageId) throw new Error('pinMessage: roomId + messageId required');
  const { data, error } = await supabase
    .from('pinned_messages')
    .insert({ room_id: roomId, message_id: messageId, pinned_by: pinnedBy ?? null })
    .select(PINNED_COLS)
    .single();
  if (error) throw error;
  return fromPinnedRow(data);
}

// Unpin by pin-row id (the `id` returned from loadPinnedMessages →
// `pinnedRowId`).
export async function unpinMessage(pinId) {
  if (!pinId) return;
  const { error } = await supabase
    .from('pinned_messages')
    .delete()
    .eq('id', pinId);
  if (error) throw error;
}

// Remove every pin in a room.
export async function clearPinnedForRoom(roomId) {
  if (!roomId) return;
  const { error } = await supabase
    .from('pinned_messages')
    .delete()
    .eq('room_id', roomId);
  if (error) throw error;
}
