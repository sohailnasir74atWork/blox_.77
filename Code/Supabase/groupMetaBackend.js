// Group-list metadata backend — Supabase-native client for /group_meta_data.
//
// As of the chat-meta cut-over, all writes go directly to Supabase from
// the client: send-time fan-out across members, mute toggles, unread
// reset on chat enter, group create / add-member / remove-member.
//
// UI shape exposed matches what ChatNavigator.js / GroupChatScreen.jsx
// already consume:
//   { groupId, groupName, groupAvatar, lastMessage, lastMessageTimestamp,
//     lastMessageSenderId, lastMessageSenderName, memberCount, createdBy,
//     unreadCount, muted, joinedAt, lastReadAt }

import { supabase } from './client';

// Explicit column list for hot reads — avoids select('*') egress on the
// group-list table. Must list exactly the columns fromGroupMetaRow() reads.
const GROUP_META_COLS =
  'group_id, group_name, group_avatar, last_message, last_message_timestamp_ms, last_message_sender_id, last_message_sender_name, member_count, created_by, unread_count, muted, joined_at_ms, last_read_at_ms';

// -----------------------------------------------------------------
// Row mapper — DB snake_case → UI camelCase
// -----------------------------------------------------------------
export function fromGroupMetaRow(row) {
  if (!row) return null;
  return {
    groupId: row.group_id,
    groupName: row.group_name ?? null,
    groupAvatar: row.group_avatar ?? null,
    lastMessage: row.last_message ?? null,
    lastMessageTimestamp: row.last_message_timestamp_ms ?? 0,
    lastMessageSenderId: row.last_message_sender_id ?? null,
    lastMessageSenderName: row.last_message_sender_name ?? null,
    memberCount: row.member_count ?? null,
    createdBy: row.created_by ?? null,
    unreadCount: row.unread_count ?? 0,
    muted: !!row.muted,
    joinedAt: row.joined_at_ms ?? null,
    lastReadAt: row.last_read_at_ms ?? null,
  };
}

// -----------------------------------------------------------------
// Initial load.
//
// Paginated via .range() because Supabase enforces a server-side
// max_rows cap (default 1000) that .limit(N) doesn't override. Same
// silent-truncation class as loadChatMeta — see that fn for context.
// Ordering by last_message_timestamp_ms DESC keeps the most-recent
// groups in the first page.
// -----------------------------------------------------------------
const GROUP_META_PAGE = 1000;

export async function loadGroupMeta(userId) {
  if (!userId) return [];
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('group_meta_data')
      .select(GROUP_META_COLS)
      .eq('user_id', userId)
      .order('last_message_timestamp_ms', { ascending: false, nullsFirst: false })
      .range(from, from + GROUP_META_PAGE - 1);
    if (error) {
      console.warn('[groupMetaBackend] loadGroupMeta error:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) out.push(fromGroupMetaRow(row));
    if (data.length < GROUP_META_PAGE) break;
    from += GROUP_META_PAGE;
  }
  return out;
}

// -----------------------------------------------------------------
// Reset unread count directly in Supabase — called when user opens a
// group chat. Same trick as chatMetaBackend.resetUnreadCount().
// -----------------------------------------------------------------
export async function resetGroupUnreadCount(userId, groupId) {
  if (!userId || !groupId) return;
  await supabase
    .from('group_meta_data')
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('group_id', groupId);
}

// =====================================================================
// Group-meta writes
// =====================================================================

// Initial group_meta_data row. Used by:
//   - group create flow (creator's own row)
//   - add-member flow (new member's row)
// All optional fields stay null when not provided so existing rows
// aren't clobbered on conflict (we use upsert with onConflict).
export async function upsertGroupMetaRow({
  userId,
  groupId,
  groupName = null,
  groupAvatar = null,
  lastMessage = null,
  lastMessageTimestampMs = null,
  lastMessageSenderId = null,
  lastMessageSenderName = null,
  memberCount = null,
  createdBy = null,
  joinedAtMs = null,
  unreadCount = null, // null = leave unchanged on conflict
  muted = null,
}) {
  if (!userId || !groupId) throw new Error('upsertGroupMetaRow: userId + groupId required');

  const row = {
    user_id: userId,
    group_id: groupId,
    updated_at: new Date().toISOString(),
  };
  if (groupName !== null) row.group_name = groupName;
  if (groupAvatar !== null) row.group_avatar = groupAvatar;
  if (lastMessage !== null) row.last_message = lastMessage;
  if (lastMessageTimestampMs !== null) row.last_message_timestamp_ms = lastMessageTimestampMs;
  if (lastMessageSenderId !== null) row.last_message_sender_id = lastMessageSenderId;
  if (lastMessageSenderName !== null) row.last_message_sender_name = lastMessageSenderName;
  if (memberCount !== null) row.member_count = memberCount;
  if (createdBy !== null) row.created_by = createdBy;
  if (joinedAtMs !== null) row.joined_at_ms = joinedAtMs;
  if (unreadCount !== null) row.unread_count = unreadCount;
  if (muted !== null) row.muted = muted;

  const { error } = await supabase
    .from('group_meta_data')
    .upsert(row, { onConflict: 'user_id,group_id' });
  if (error) throw error;
}

// Send-time fan-out: update every member's group_meta_data row with the
// new last message preview + timestamp, and atomically increment
// unread_count for every member except the sender. Membership list is
// passed in by the caller (already known from the group state).
//
// Two phases for safety + concurrency:
//   1) bulk upsert last_message / timestamp / sender / groupName for every
//      member — this is a single round-trip via supabase upsert.
//   2) per-member rpc increment for everyone except the sender. These
//      are race-free against other concurrent senders (atomic SQL UPDATE).
//
// Atomic fan-out via SECURITY DEFINER RPC (014_fanout_group_meta.sql).
// Replaces the prior client-side bulk upsert + per-member increment loop.
// Bypasses the same RLS quirk that bit chat_meta_data and group_messages,
// and collapses N+1 round-trips into a single RPC call.
export async function fanOutGroupMessage({
  groupId,
  memberIds,
  senderId,
  senderName,
  lastMessage,
  timestampMs,
  groupName = null,
}) {
  if (!groupId || !Array.isArray(memberIds) || memberIds.length === 0) return;
  const { error } = await supabase.rpc('fanout_group_message_meta', {
    p_group_id: groupId,
    p_member_ids: memberIds,
    p_sender_id: senderId ?? null,
    p_sender_name: senderName ?? null,
    p_last_message: lastMessage ?? null,
    p_timestamp_ms: timestampMs ?? Date.now(),
    p_group_name: groupName,
  });
  if (error) throw error;
}

// Toggle / set mute on the user's row.
export async function setGroupMuted(userId, groupId, muted) {
  if (!userId || !groupId) return;
  const { error } = await supabase
    .from('group_meta_data')
    .update({ muted: !!muted, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('group_id', groupId);
  if (error) throw error;
}

// Hard-delete a group from this user's list (leave-group flow). Does
// NOT touch other members' rows. Caller is responsible for the actual
// group-membership change in /groups/* (Firestore today).
export async function deleteGroupMetaForUser(userId, groupId) {
  if (!userId || !groupId) return;
  const { error } = await supabase
    .from('group_meta_data')
    .delete()
    .eq('user_id', userId)
    .eq('group_id', groupId);
  if (error) throw error;
}

// Update group identity (groupName / groupAvatar / memberCount) across
// every member's row. Used when an admin renames a group or changes its
// avatar. Sends one bulk upsert.
export async function updateGroupIdentityForMembers({
  groupId,
  memberIds,
  groupName = null,
  groupAvatar = null,
  memberCount = null,
}) {
  if (!groupId || !Array.isArray(memberIds) || memberIds.length === 0) return;
  const updatedAt = new Date().toISOString();
  const rows = memberIds.map((mid) => {
    const r = { user_id: mid, group_id: groupId, updated_at: updatedAt };
    if (groupName !== null) r.group_name = groupName;
    if (groupAvatar !== null) r.group_avatar = groupAvatar;
    if (memberCount !== null) r.member_count = memberCount;
    return r;
  });
  const { error } = await supabase
    .from('group_meta_data')
    .upsert(rows, { onConflict: 'user_id,group_id' });
  if (error) throw error;
}

// -----------------------------------------------------------------
// Realtime subscription. Drop-in replacement for the group-list
// listeners in ChatNavigator.js (the userGroupsRef onChildAdded path).
// -----------------------------------------------------------------
export function subscribeToGroupMeta(userId, { onUpsert, onRemove, onReady, onStatus } = {}) {
  if (!userId) return () => {};

  let cancelled = false;
  let initialDone = false;
  let subscribedOnce = false;

  const tryReady = () => {
    if (initialDone && subscribedOnce && !cancelled) {
      onReady?.();
    }
  };

  const topic = `group-meta:${userId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(topic)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'group_meta_data',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => { if (!cancelled) onUpsert?.(fromGroupMetaRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'group_meta_data',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => { if (!cancelled) onUpsert?.(fromGroupMetaRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'group_meta_data',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (cancelled) return;
        const groupId = payload.old?.group_id;
        if (groupId) onRemove?.(groupId);
      },
    )
    .subscribe((status, err) => {
      onStatus?.(status, err);
      if (status === 'SUBSCRIBED') {
        subscribedOnce = true;
        tryReady();
      }
    });

  loadGroupMeta(userId)
    .then((rows) => {
      if (cancelled) return;
      rows.forEach((r) => onUpsert?.(r));
      initialDone = true;
      tryReady();
    })
    .catch((e) => {
      console.warn('[groupMetaBackend] initial load failed:', e?.message);
      initialDone = true;
      tryReady();
    });

  return () => {
    cancelled = true;
    try { supabase.removeChannel(channel); } catch {}
  };
}
