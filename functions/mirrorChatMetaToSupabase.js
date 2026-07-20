/**
 * Cloud Function: mirror RTDB /chat_meta_data/{ownerUid}/{partnerUid}
 * into Supabase.
 *
 * RTDB stays the source of truth — the app keeps writing increment(),
 * mute toggles, lastMessage updates straight to RTDB so all existing
 * notification CFs (and old app versions) are unaffected. This function
 * fans those writes out to Supabase so new clients can subscribe there
 * for the chat list / unread badge stream and we can drop a chunk of
 * RTDB egress.
 *
 * Trigger: onWrite at the row level (not the unread leaf), so we capture
 * every field change in one shot — increment, mute toggle, lastMessage,
 * receiverName, etc.
 *
 * Deployment:
 *   firebase functions:secrets:set SUPABASE_URL
 *   firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
 *   firebase deploy --only functions:mirrorChatMetaToSupabase
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.mirrorChatMetaToSupabase = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '256MB',
    timeoutSeconds: 30,
  })
  .database.ref('/chat_meta_data/{ownerUid}/{partnerUid}')
  .onWrite(async (change, context) => {
    const { ownerUid, partnerUid } = context.params;
    const supabase = getSupabaseAdmin();

    // RTDB row was deleted (chat removed) — drop the Supabase row too.
    if (!change.after.exists()) {
      const { error } = await supabase
        .from('chat_meta_data')
        .delete()
        .eq('owner_uid', ownerUid)
        .eq('partner_uid', partnerUid);
      if (error) {
        console.error('[mirrorChatMeta] delete failed:', error.message, { ownerUid, partnerUid });
      }
      return null;
    }

    const v = change.after.val() || {};

    // Ghost-row guard (ported from adoptme-jan7): skip writes where the
    // parent RTDB node holds only a sub-leaf (e.g. a stray lastRead or
    // mirror marker) with none of the identifying fields a real chat row
    // carries. Without this we upsert a row with chat_id/last_message/
    // timestamp_ms/receiver_* all null, and the inbox renders those as
    // "Anonymous — No messages yet" entries from people the user never
    // chatted with (~10% of chat_meta_data was ghosts in adoptme before
    // this guard landed). Skipping writes only — existing ghost rows are
    // cleaned up by supabase/018_cleanup_ghost_chat_meta.sql.
    const hasChatId    = typeof v.chatId === 'string' && v.chatId.length > 0;
    const hasLastMsg   = typeof v.lastMessage === 'string';
    const hasTimestamp = typeof v.timestamp === 'number';
    const hasReceiver  = typeof v.receiverId === 'string' && v.receiverId.length > 0;
    if (!hasChatId && !hasLastMsg && !hasTimestamp && !hasReceiver) {
      return null;
    }

    // Mirror every field defined in the table. Coerce to expected types
    // so a stray null/undefined from a partial write doesn't break the
    // upsert (Postgres NOT NULL columns reject undefined).
    const row = {
      owner_uid: ownerUid,
      partner_uid: partnerUid,
      chat_id: v.chatId ?? null,
      last_message: typeof v.lastMessage === 'string' ? v.lastMessage : null,
      timestamp_ms: typeof v.timestamp === 'number' ? v.timestamp : null,
      receiver_id: v.receiverId ?? null,
      receiver_name: v.receiverName ?? null,
      receiver_avatar: v.receiverAvatar ?? null,
      unread_count: typeof v.unreadCount === 'number' ? v.unreadCount : 0,
      muted: v.muted === true,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('chat_meta_data')
      .upsert(row, { onConflict: 'owner_uid,partner_uid' });

    if (error) {
      console.error('[mirrorChatMeta] upsert failed:', error.message, {
        ownerUid, partnerUid,
      });
    }
    return null;
  });
