/**
 * Cloud Function: mirror RTDB /group_meta_data/{userId}/{groupId}
 * into Supabase.
 *
 * Symmetric to mirrorChatMetaToSupabase, but for group rooms. RTDB stays
 * the source of truth — groupUtils.js continues to fan writes out to
 * every member's /group_meta_data subtree, this CF tails those writes
 * and upserts here.
 *
 * Field shape mirrors what groupUtils.js writes (see
 * Code/ChatScreen/utils/groupUtils.js lines 156–164, 737–739).
 *
 * Deployment:
 *   firebase deploy --only functions:mirrorGroupMetaToSupabase
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.mirrorGroupMetaToSupabase = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '256MB',
    timeoutSeconds: 30,
  })
  .database.ref('/group_meta_data/{userId}/{groupId}')
  .onWrite(async (change, context) => {
    const { userId, groupId } = context.params;
    const supabase = getSupabaseAdmin();

    if (!change.after.exists()) {
      const { error } = await supabase
        .from('group_meta_data')
        .delete()
        .eq('user_id', userId)
        .eq('group_id', groupId);
      if (error) {
        console.error('[mirrorGroupMeta] delete failed:', error.message, { userId, groupId });
      }
      return null;
    }

    const v = change.after.val() || {};

    const row = {
      user_id: userId,
      group_id: groupId,
      group_name: v.groupName ?? null,
      group_avatar: v.groupAvatar ?? null,
      last_message: typeof v.lastMessage === 'string' ? v.lastMessage : null,
      last_message_timestamp_ms:
        typeof v.lastMessageTimestamp === 'number' ? v.lastMessageTimestamp : null,
      last_message_sender_id: v.lastMessageSenderId ?? null,
      last_message_sender_name: v.lastMessageSenderName ?? null,
      member_count: typeof v.memberCount === 'number' ? v.memberCount : null,
      created_by: v.createdBy ?? null,
      unread_count: typeof v.unreadCount === 'number' ? v.unreadCount : 0,
      muted: v.muted === true,
      joined_at_ms: typeof v.joinedAt === 'number' ? v.joinedAt : null,
      last_read_at_ms: typeof v.lastReadAt === 'number' ? v.lastReadAt : null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('group_meta_data')
      .upsert(row, { onConflict: 'user_id,group_id' });

    if (error) {
      console.error('[mirrorGroupMeta] upsert failed:', error.message, { userId, groupId });
    }
    return null;
  });
