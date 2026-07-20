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

import { AppState } from 'react-native';
import { supabase } from './client';

// Explicit column list for hot reads — avoids select('*') egress on the
// largest chat table. Must list exactly the columns fromChatMetaRow() reads.
// `updated_at` rides along (~25 bytes/row) as the delta-sync cursor: every
// write path — client updates AND the send/increment RPCs — bumps it to
// now(), so "rows with updated_at > cursor" is the complete change set,
// including unread resets and mute toggles that don't move timestamp_ms.
const CHAT_META_COLS =
  'partner_uid, chat_id, last_message, timestamp_ms, receiver_id, receiver_name, receiver_avatar, unread_count, muted, updated_at';

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
    // Internal delta-sync cursor — ISO string from Postgres, lexicographic
    // order == chronological. UI consumers ignore it.
    updatedAt: row.updated_at ?? null,
  };
}

// -----------------------------------------------------------------
// Initial load — Supabase realtime doesn't replay history, so the
// caller fetches once on attach and then keeps state in sync via the
// realtime channel.
//
// Paginated via .range() because Supabase enforces a server-side
// max_rows cap (default 1000) that `.limit(N)` does NOT override. Heavy
// users silently lost rows past row 1000 — old chats whose row got bumped
// while the app was closed were invisible until the partner happened to
// send while the user was online. Ordering by timestamp_ms DESC keeps the
// most-recent chats in the first page so the UI populates quickly even
// before later pages land.
// -----------------------------------------------------------------
const CHAT_META_PAGE = 1000;

export async function loadChatMeta(ownerUid) {
  if (!ownerUid) return [];
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('chat_meta_data')
      .select(CHAT_META_COLS)
      .eq('owner_uid', ownerUid)
      .order('timestamp_ms', { ascending: false, nullsFirst: false })
      .range(from, from + CHAT_META_PAGE - 1);
    if (error) {
      console.warn('[chatMetaBackend] loadChatMeta error:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) out.push(fromChatMetaRow(row));
    if (data.length < CHAT_META_PAGE) break;
    from += CHAT_META_PAGE;
  }
  return out;
}

// -----------------------------------------------------------------
// Delta load — rows changed since a known updated_at cursor. This is the
// cheap re-sync path: on foreground / reconnect / late-joiner attach we
// fetch only what changed while the socket was down (usually 0–2 rows)
// instead of re-downloading the user's entire chat list. Returns
// { rows, maxUpdatedAt, pageFull }; `pageFull` means the backlog exceeded
// one page and the caller should fall back to a full load.
// -----------------------------------------------------------------
export async function loadChatMetaSince(ownerUid, sinceIso) {
  if (!ownerUid || !sinceIso) return { rows: [], maxUpdatedAt: null, pageFull: false };
  const { data, error } = await supabase
    .from('chat_meta_data')
    .select(CHAT_META_COLS)
    .eq('owner_uid', ownerUid)
    .gt('updated_at', sinceIso)
    .order('updated_at', { ascending: true })
    .limit(CHAT_META_PAGE);
  if (error) {
    console.warn('[chatMetaBackend] loadChatMetaSince error:', error.message);
    return { rows: [], maxUpdatedAt: null, pageFull: false };
  }
  const rows = (data || []).map(fromChatMetaRow);
  const maxUpdatedAt = rows.length ? rows[rows.length - 1].updatedAt : null;
  return { rows, maxUpdatedAt, pageFull: (data || []).length >= CHAT_META_PAGE };
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

// -----------------------------------------------------------------
// Shared (ref-counted) chat-meta subscription.
//
// ChatNavigator (unread badge) and InboxScreen (chat list) both need the
// same owner_uid stream. Subscribing twice opened TWO realtime channels and
// every chat_meta_data change was delivered — and BILLED — twice. This
// multiplexes a single underlying subscribeToChatMeta to N in-process
// consumers and tears it down only when the last one detaches.
//
// Late joiners (e.g. InboxScreen mounting after ChatNavigator) are replayed
// the rows cached so far, plus the latest status / ready, so they see the
// same initial-load semantics as a direct subscription.
// -----------------------------------------------------------------
const _chatMetaShared = new Map(); // ownerUid -> entry

// On app foreground, the long-lived shared realtime channel may have missed
// events while the socket was down (OS reclaim, network switch, device
// sleep). client.js reconnects the socket, but realtime does NOT replay the
// changes it missed — so unread counts freeze and new chats stay hidden until
// a cold restart. The reconnect-status path below is unreliable (the channel
// often doesn't report a non-SUBSCRIBED status on a silent reconnect), so we
// also force a REST re-sync of every live entry on every foreground. This is
// exactly the moment the user opens the app from a push notification.
let _chatMetaLastAppState = AppState.currentState;
AppState.addEventListener('change', (next) => {
  const cameToForeground =
    /inactive|background/.test(_chatMetaLastAppState) && next === 'active';
  _chatMetaLastAppState = next;
  if (!cameToForeground) return;
  _chatMetaShared.forEach((entry) => { try { entry.refresh?.(); } catch {} });
});

export function subscribeToChatMetaShared(ownerUid, handlers = {}) {
  if (!ownerUid) return () => {};

  let entry = _chatMetaShared.get(ownerUid);
  const isNewEntry = !entry;
  if (!entry) {
    entry = {
      listeners: new Set(),
      rows: new Map(),     // partnerId -> row (current snapshot)
      ready: false,
      lastStatus: null,
      unsubscribe: null,
      refresh: null,
      syncCursor: null,    // max updated_at seen (ISO); null until first load lands
    };
    _chatMetaShared.set(ownerUid, entry);

    // Advance the delta cursor. ISO strings from Postgres compare
    // lexicographically in chronological order.
    const advanceCursor = (iso) => {
      if (iso && (!entry.syncCursor || iso > entry.syncCursor)) entry.syncCursor = iso;
    };

    // Re-fetch the full chat-meta snapshot and fan the rows out to every
    // listener. Supabase realtime only streams *changes* and does NOT replay
    // them across a background disconnect — so a private message that arrives
    // while the app is backgrounded (the user gets a push notification but the
    // socket is down) is never delivered to this long-lived shared channel.
    // Without an explicit re-load, the inbox would render the stale cached
    // snapshot and that chat would be missing. We re-load on reconnect and on
    // every new-listener join (e.g. InboxScreen mounting) to backfill it.
    // Merge a freshly-loaded row WITHOUT clobbering newer realtime state.
    // The realtime stream is authoritative for anything it has delivered; a
    // REST re-sync can race and return an older snapshot (read replica lag, or
    // a query issued before the user tapped a chat). So we only apply a fresh
    // row when it genuinely adds information:
    //   • partner not seen yet                → a chat we were missing
    //   • newer timestamp_ms                  → a message realtime missed
    //   • same timestamp but LOWER unread     → a reset realtime missed
    // We deliberately skip "same timestamp, equal-or-higher unread" — that's
    // the case where a stale read would resurrect a badge the user just
    // cleared (reset does not bump timestamp_ms), or carries nothing new.
    const applyRefreshRow = (fresh) => {
      if (!fresh?.partnerId) return;
      advanceCursor(fresh.updatedAt);
      const cached = entry.rows.get(fresh.partnerId);
      if (cached) {
        const tf = fresh.timestamp || 0;
        const tc = cached.timestamp || 0;
        if (tf < tc) return;                                   // cached is newer
        if (tf === tc && (fresh.unreadCount || 0) >= (cached.unreadCount || 0)
          && (fresh.muted === cached.muted)) return;
      }
      entry.rows.set(fresh.partnerId, fresh);
      entry.listeners.forEach((l) => l.onUpsert?.(fresh));
    };

    const fullRefresh = () => loadChatMeta(ownerUid)
      .then((rows) => {
        if (!_chatMetaShared.has(ownerUid)) return; // torn down mid-flight
        rows.forEach(applyRefreshRow);
      })
      .catch(() => {});

    // Delta-first re-sync: with a cursor, fetch only rows whose updated_at
    // moved past it (usually 0–2 rows after a background window) instead of
    // the entire chat list. Falls back to a full load when there's no cursor
    // yet or the backlog overflowed one page.
    entry.refresh = () => {
      if (!entry.syncCursor) { fullRefresh(); return; }
      loadChatMetaSince(ownerUid, entry.syncCursor)
        .then(({ rows, pageFull }) => {
          if (!_chatMetaShared.has(ownerUid)) return;
          if (pageFull) { fullRefresh(); return; }
          rows.forEach(applyRefreshRow);
        })
        .catch(() => {});
    };

    entry.unsubscribe = subscribeToChatMeta(ownerUid, {
      onUpsert: (row) => {
        // Realtime payloads and the initial load both carry updated_at, so
        // the cursor stays current without any extra queries.
        advanceCursor(row?.updatedAt);
        if (row?.partnerId) entry.rows.set(row.partnerId, row);
        entry.listeners.forEach((l) => l.onUpsert?.(row));
      },
      onRemove: (partnerId) => {
        entry.rows.delete(partnerId);
        entry.listeners.forEach((l) => l.onRemove?.(partnerId));
      },
      onReady: () => {
        entry.ready = true;
        entry.listeners.forEach((l) => l.onReady?.());
      },
      onStatus: (status, err) => {
        const prev = entry.lastStatus;
        entry.lastStatus = status;
        // Reconnect after a drop (e.g. app foregrounded) → backfill anything
        // missed while the socket was down. Skip the very first SUBSCRIBED —
        // the subscribe() above already kicked off the initial load.
        if (status === 'SUBSCRIBED' && prev && prev !== 'SUBSCRIBED') {
          entry.refresh?.();
        }
        entry.listeners.forEach((l) => l.onStatus?.(status, err));
      },
    });
  }

  entry.listeners.add(handlers);

  // Replay current state to the late joiner so it doesn't miss the load.
  if (entry.rows.size > 0) {
    entry.rows.forEach((row) => handlers.onUpsert?.(row));
  }
  if (entry.lastStatus) handlers.onStatus?.(entry.lastStatus);
  if (entry.ready) handlers.onReady?.();

  // A late joiner (InboxScreen mounting after ChatNavigator already created the
  // entry) may be attaching to a snapshot that went stale while only the badge
  // listener was attached. Re-fetch so it sees chats that arrived in between.
  // (Skipped for the first listener — subscribe() already loads.)
  if (!isNewEntry && entry.refresh) entry.refresh();

  return () => {
    entry.listeners.delete(handlers);
    if (entry.listeners.size === 0) {
      try { entry.unsubscribe?.(); } catch {}
      _chatMetaShared.delete(ownerUid);
    }
  };
}
