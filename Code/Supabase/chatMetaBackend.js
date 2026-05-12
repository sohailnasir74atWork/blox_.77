// Chat-list metadata backend — Supabase-native client for /chat_meta_data.
//
// As of the chat-meta cut-over, *all* writes go directly to Supabase from
// the client: send-time upserts (both pair sides), mute toggles, unread
// reset on chat enter. RTDB is no longer the source of truth for chat
// metadata. The mirrorChatMetaToSupabase CF is still deployed but only
// fires when an old (pre-cutover) build writes to RTDB — that path is
// dwindling and harmless.
//
// API shape exposed to the UI is flat camelCase to match the existing
// listener consumers in ChatNavigator.js / InboxScreen.jsx / PrivateChat.jsx:
//   { partnerId, chatId, lastMessage, timestamp, receiverId, receiverName,
//     receiverAvatar, unreadCount, muted }

import { supabase } from './client';

// -----------------------------------------------------------------
// Row mapper — DB snake_case → UI camelCase
// -----------------------------------------------------------------
export function fromChatMetaRow(row) {
  if (!row) return null;
  return {
    partnerId: row.partner_uid,
    chatId: row.chat_id ?? null,
    lastMessage: row.last_message ?? null,
    timestamp: row.timestamp_ms ?? 0,
    receiverId: row.receiver_id ?? null,
    receiverName: row.receiver_name ?? null,
    receiverAvatar: row.receiver_avatar ?? null,
    unreadCount: row.unread_count ?? 0,
    muted: !!row.muted,
  };
}

// -----------------------------------------------------------------
// Initial load — Supabase realtime doesn't replay history, so the
// caller fetches once on attach and then keeps state in sync via the
// realtime channel.
// -----------------------------------------------------------------
export async function loadChatMeta(ownerUid) {
  if (!ownerUid) return [];
  const { data, error } = await supabase
    .from('chat_meta_data')
    .select('*')
    .eq('owner_uid', ownerUid);
  if (error) {
    console.warn('[chatMetaBackend] loadChatMeta error:', error.message);
    return [];
  }
  return (data || []).map(fromChatMetaRow);
}

// -----------------------------------------------------------------
// Reset unread count directly in Supabase — called when user opens a
// chat so the badge clears instantly without waiting for the mirror CF.
// RTDB is still the source of truth; PrivateChat also writes
// unreadCount=0 to RTDB as before, and the mirror CF will upsert the
// same value shortly after. The direct write here just prevents a
// stale badge flash.
// -----------------------------------------------------------------
export async function resetUnreadCount(ownerUid, partnerUid) {
  if (!ownerUid || !partnerUid) return;
  await supabase
    .from('chat_meta_data')
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq('owner_uid', ownerUid)
    .eq('partner_uid', partnerUid);
  // Errors are intentionally swallowed — at-most-once is fine; the next
  // chat-list snapshot will reflect the true state.
}

// =====================================================================
// Send-time writes
// =====================================================================

// canonical chat id, mirroring the RTDB convention: sort the two UIDs
// alphabetically and join with an underscore.
function chatIdFor(uidA, uidB) {
  return [uidA, uidB].sort().join('_');
}

// Write the sender's (owner=sender, partner=receiver) row when sending a
// private message. unread_count stays 0 on the sender's side. Identity
// fields (receiver_name / receiver_avatar) are only persisted when the
// caller passes them — matches the "write once per session" optimization
// in PrivateChat.jsx.
export async function upsertChatMetaSenderSide({
  senderUid, receiverUid, lastMessage, timestampMs,
  receiverName = null, receiverAvatar = null,
}) {
  if (!senderUid || !receiverUid) throw new Error('upsertChatMetaSenderSide: uids required');
  const row = {
    owner_uid: senderUid,
    partner_uid: receiverUid,
    chat_id: chatIdFor(senderUid, receiverUid),
    receiver_id: receiverUid,
    last_message: lastMessage ?? null,
    timestamp_ms: timestampMs ?? Date.now(),
    unread_count: 0,
    updated_at: new Date().toISOString(),
  };
  if (receiverName !== null) row.receiver_name = receiverName;
  if (receiverAvatar !== null) row.receiver_avatar = receiverAvatar;
  const { error } = await supabase
    .from('chat_meta_data')
    .upsert(row, { onConflict: 'owner_uid,partner_uid' });
  if (error) throw error;
}

// Write the receiver's (owner=receiver, partner=sender) row when sending
// a private message. unread_count is incremented atomically via an
// rpc-free read-modify-write fallback: we upsert the row first (so it
// exists), then issue an UPDATE that adds 1 to the current value.
//
// receiver_name / receiver_avatar in this row describe the SENDER (i.e.
// what the receiver sees as the "other party" when they look at this row).
export async function upsertChatMetaReceiverSide({
  senderUid, receiverUid, lastMessage, timestampMs,
  senderName = null, senderAvatar = null,
}) {
  if (!senderUid || !receiverUid) throw new Error('upsertChatMetaReceiverSide: uids required');

  // Step 1: ensure the row exists with up-to-date last_message / timestamp.
  // Don't touch unread_count yet — that's atomic-incremented next.
  const baseRow = {
    owner_uid: receiverUid,
    partner_uid: senderUid,
    chat_id: chatIdFor(senderUid, receiverUid),
    receiver_id: senderUid,
    last_message: lastMessage ?? null,
    timestamp_ms: timestampMs ?? Date.now(),
    updated_at: new Date().toISOString(),
  };
  if (senderName !== null) baseRow.receiver_name = senderName;
  if (senderAvatar !== null) baseRow.receiver_avatar = senderAvatar;

  // Use upsert with ignoreDuplicates:false to update last_message etc. on
  // collision; unread_count stays untouched on existing rows because we
  // omit it from the payload.
  const { error: upsertErr } = await supabase
    .from('chat_meta_data')
    .upsert(baseRow, { onConflict: 'owner_uid,partner_uid' });
  if (upsertErr) throw upsertErr;

  // Step 2: atomic increment via SQL function. We use a Postgres `rpc`
  // call so the increment is one round-trip and race-free across two
  // concurrent senders. The function is defined in 008_chat_meta_rpcs.sql.
  const { error: rpcErr } = await supabase.rpc('increment_chat_unread', {
    p_owner_uid: receiverUid,
    p_partner_uid: senderUid,
  });
  if (rpcErr) {
    // Fall back to a non-atomic select+update if the rpc isn't deployed
    // (shouldn't happen in production, but prevents a hard failure during
    // the rollout window).
    const { data: existing } = await supabase
      .from('chat_meta_data')
      .select('unread_count')
      .eq('owner_uid', receiverUid)
      .eq('partner_uid', senderUid)
      .maybeSingle();
    const current = existing?.unread_count ?? 0;
    await supabase
      .from('chat_meta_data')
      .update({ unread_count: current + 1, updated_at: new Date().toISOString() })
      .eq('owner_uid', receiverUid)
      .eq('partner_uid', senderUid);
  }
}

// Atomic two-sided pair write via SECURITY DEFINER RPC (011_send_private_chat_meta.sql).
// Replaces the prior pair of parallel upserts — see the migration header for why.
// senderUid is implied by the JWT (firebase_uid()); the RPC ignores any
// caller-supplied sender id to prevent spoofing.
export async function sendPrivateChatMeta({
  senderUid, receiverUid, lastMessage, timestampMs,
  senderName = null, senderAvatar = null,
  receiverName = null, receiverAvatar = null,
}) {
  if (!receiverUid) throw new Error('sendPrivateChatMeta: receiverUid required');
  const { error } = await supabase.rpc('send_private_chat_meta', {
    p_partner_uid: receiverUid,
    p_last_message: lastMessage ?? null,
    p_timestamp_ms: timestampMs ?? Date.now(),
    p_sender_name: senderName,
    p_sender_avatar: senderAvatar,
    p_receiver_name: receiverName,
    p_receiver_avatar: receiverAvatar,
  });
  if (error) throw error;
}

// Toggle / set mute on the owner's row. RLS allows this because we're
// writing our own row (owner_uid = firebase_uid()).
export async function setChatMuted(ownerUid, partnerUid, muted) {
  if (!ownerUid || !partnerUid) return;
  const { error } = await supabase
    .from('chat_meta_data')
    .update({ muted: !!muted, updated_at: new Date().toISOString() })
    .eq('owner_uid', ownerUid)
    .eq('partner_uid', partnerUid);
  if (error) throw error;
}

// Hard-delete a chat from this user's inbox (e.g. swipe-delete). Does
// NOT affect the partner's view — they keep the chat in their inbox.
export async function deleteChatForOwner(ownerUid, partnerUid) {
  if (!ownerUid || !partnerUid) return;
  const { error } = await supabase
    .from('chat_meta_data')
    .delete()
    .eq('owner_uid', ownerUid)
    .eq('partner_uid', partnerUid);
  if (error) throw error;
}

// -----------------------------------------------------------------
// Realtime subscription
//
// Drop-in replacement for the chat-list listeners in ChatNavigator.js
// and InboxScreen.jsx. Behaviour:
//
//   1. Open the channel and subscribe to INSERT / UPDATE / DELETE
//      filtered by owner_uid=eq.<uid>.
//   2. Fire `onUpsert(row)` for every existing row from the initial
//      load (so callers populate their map exactly the way the RTDB
//      onChildAdded did), then for every realtime INSERT/UPDATE.
//   3. Fire `onRemove(partnerId)` for every realtime DELETE.
//   4. Call `onReady()` once the initial load + first SUBSCRIBED
//      status have both landed, so the caller can flip its loading
//      flag.
//
// Returns an unsubscribe function.
// -----------------------------------------------------------------
export function subscribeToChatMeta(ownerUid, { onUpsert, onRemove, onReady, onStatus } = {}) {
  if (!ownerUid) return () => {};

  let cancelled = false;
  let initialDone = false;
  let subscribedOnce = false;

  const tryReady = () => {
    if (initialDone && subscribedOnce && !cancelled) {
      onReady?.();
    }
  };

  // Subscribe FIRST so we don't miss writes that land between the
  // initial load and the channel SUBSCRIBED state.
  //
  // Topic is suffixed with a per-call random id because supabase-js
  // returns the *existing* channel if one with the same topic is
  // already registered. Two callers (ChatNavigator + InboxScreen) both
  // subscribe for the same uid, so without the suffix the second
  // caller gets a post-`subscribe()` channel and `.on('postgres_changes', …)`
  // throws "cannot add postgres_changes callbacks after subscribe()".
  const topic = `chat-meta:${ownerUid}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(topic)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_meta_data',
        filter: `owner_uid=eq.${ownerUid}`,
      },
      (payload) => { if (!cancelled) onUpsert?.(fromChatMetaRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_meta_data',
        filter: `owner_uid=eq.${ownerUid}`,
      },
      (payload) => { if (!cancelled) onUpsert?.(fromChatMetaRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'chat_meta_data',
        filter: `owner_uid=eq.${ownerUid}`,
      },
      (payload) => {
        if (cancelled) return;
        const partnerId = payload.old?.partner_uid;
        if (partnerId) onRemove?.(partnerId);
      },
    )
    .subscribe((status, err) => {
      onStatus?.(status, err);
      if (status === 'SUBSCRIBED') {
        subscribedOnce = true;
        tryReady();
      }
    });

  loadChatMeta(ownerUid)
    .then((rows) => {
      if (cancelled) return;
      rows.forEach((r) => onUpsert?.(r));
      initialDone = true;
      tryReady();
    })
    .catch((e) => {
      console.warn('[chatMetaBackend] initial load failed:', e?.message);
      // Still mark loaded so the caller doesn't sit on a spinner forever.
      initialDone = true;
      tryReady();
    });

  return () => {
    cancelled = true;
    try { supabase.removeChannel(channel); } catch {}
  };
}
