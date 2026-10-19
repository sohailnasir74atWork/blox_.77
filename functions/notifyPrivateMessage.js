// 2026-09: this is the newer (2026-07-29) notifier body, deployed under the name the
// Supabase webhook already calls (notifyPrivateMessage). Adds active-chat push
// suppression, chat-off doors and image_urls support.
/**
 * notifyNewMessage — HTTPS webhook handler for new private messages.
 *
 * Triggered by a Supabase Database Webhook configured in
 *   Dashboard -> Database -> Webhooks
 *   Table:  public.private_messages
 *   Event:  INSERT
 *   Method: POST
 *   URL:    <this CF's HTTPS URL>
 *   Header: x-webhook-secret = <SUPABASE_WEBHOOK_SECRET>
 *
 * Reads:
 *   - /activeChats/{userId}             RTDB (presence-based push suppression)
 *   - /users/{userId}/fcmToken          RTDB (FCM device token)
 *   - chat_meta_data.muted              Supabase (per-pair mute). MUST be
 *                                       Supabase, not RTDB: after Phase 5
 *                                       new app builds toggle mute on
 *                                       Supabase directly via 007_meta_writable
 *                                       policies, so RTDB no longer reflects
 *                                       new-app mute state.
 *
 * Replaces the old RTDB onCreate trigger at
 *   /chat_meta_data/{userId}/{chatPartnerId}/unreadCount
 * which is going away in Phase 5 because client writes flip from RTDB
 * to Supabase.
 *
 * Required secrets:
 *   firebase functions:secrets:set SUPABASE_WEBHOOK_SECRET
 *
 * Deployment:
 *   firebase deploy --only functions:notifyNewMessage
 */

const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");
const { getSupabaseAdmin } = require("./_supabaseAdmin");

if (!admin.apps.length) {
  admin.initializeApp();
}

function validateWebhookOrSend(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return null;
  }
  const expected = (process.env.SUPABASE_WEBHOOK_SECRET || '').trim();
  const got = (req.headers['x-webhook-secret'] || '').trim();
  if (!expected || got !== expected) {
    res.status(401).send('Unauthorized');
    return null;
  }
  const { type, record } = req.body || {};
  if (type !== 'INSERT' || !record) {
    res.status(200).send('Skipped: not an INSERT');
    return null;
  }
  return record;
}

function previewFor(r) {
  if (r.text && String(r.text).trim()) return r.text;
  if (r.image_url || (Array.isArray(r.image_urls) && r.image_urls.length > 0)) return '📷 Photo';
  if (Array.isArray(r.fruits) && r.fruits.length > 0) {
    return r.fruits.length === 1 ? '🐾 Sent a pet' : `🐾 Sent ${r.fruits.length} pets`;
  }
  if (r.gif) return '✨ Sent a sticker'; // 050 sticker column
  return 'New message';
}

exports.notifyPrivateMessage = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_WEBHOOK_SECRET'],
    memory: '256MB',
    timeoutSeconds: 30,
  })
  .https.onRequest(async (req, res) => {
    const record = validateWebhookOrSend(req, res);
    if (!record) return;

    const senderId = record.sender_id;
    const recipientId = record.recipient_id;
    if (!senderId || !recipientId) {
      res.status(200).send('Skipped: missing sender/recipient');
      return;
    }
    if (senderId === recipientId) {
      res.status(200).send('Skipped: self-message');
      return;
    }
    // Bridge note: during the 2-day cross-version window, OLD-app sends
    // are mirrored to Supabase by mirrorPrivateMessageToSupabase (rtdb_key
    // set on the row). We INTENTIONALLY don't skip those here — instead
    // notifyNewMessageLegacy has been disabled, so this function is the
    // single source of truth for private-message pushes regardless of
    // which app version sent the message. No double-push risk because the
    // legacy CF early-returns.

    try {
      // Parallel: RTDB reads (presence + fcmToken) and Supabase lookup
      // (muted + receiver_name in one query).
      const supabase = getSupabaseAdmin();
      const [activeChatSnap, fcmTokenSnap, chatOffSnap, chatMetaResult] = await Promise.all([
        admin.database().ref(`/activeChats/${recipientId}`).once('value'),
        admin.database().ref(`/users/${recipientId}/fcmToken`).once('value'),
        // Chat-availability switches. Which one applies depends on the door the
        // message came through (`origin` on the row). Old app versions don't set
        // origin — treat those as 'general', the door almost all of them use.
        admin.database().ref(`/users/${recipientId}/chatOffTrade`).once('value')
          .then(async (t) => ({
            trade: t.val() === true,
            general: (await admin.database()
              .ref(`/users/${recipientId}/chatOffGeneral`).once('value')).val() === true,
          }))
          .catch(() => ({ trade: false, general: false })),
        supabase
          .from('chat_meta_data')
          .select('muted, receiver_name')
          .eq('owner_uid', recipientId)
          .eq('partner_uid', senderId)
          .maybeSingle(),
      ]);

      // Active-chat suppression: recipient is viewing this exact chat,
      // they'll see the message inline.
      const activeChatId = activeChatSnap.val();
      if (activeChatId && String(activeChatId) === String(record.chat_id)) {
        res.status(200).send('Skipped: recipient on this chat');
        return;
      }
      if (chatMetaResult?.data?.muted === true) {
        res.status(200).send('Skipped: muted');
        return;
      }

      // Recipient has switched this door off — don't disturb them. Note this
      // only suppresses the push; rejecting the message itself happens in the
      // Supabase insert path (see supabase/chat_availability.sql).
      const chatOff = chatOffSnap || { trade: false, general: false };
      const isTradeOrigin = String(record.origin || 'general') === 'trade';
      if (isTradeOrigin ? chatOff.trade : chatOff.general) {
        res.status(200).send('Skipped: recipient unavailable for this chat type');
        return;
      }

      const fcmToken = fcmTokenSnap.val();
      if (!fcmToken || typeof fcmToken !== 'string') {
        res.status(200).send('Skipped: no fcmToken');
        return;
      }

      const senderName = chatMetaResult?.data?.receiver_name || 'New Message';

      await admin.messaging().send({
        token: fcmToken,
        notification: {
          title: senderName,
          body: previewFor(record),
        },
        data: {
          type: 'private_message',
          chatId: String(record.chat_id || ''),
          senderId: String(senderId),
          messageId: String(record.id || ''),
          timestamp: record.created_at
            ? String(Date.parse(record.created_at))
            : String(Date.now()),
        },
        android: {
          priority: 'high',
          notification: { sound: 'default', channelId: 'default' },
        },
        apns: {
          payload: { aps: { sound: 'default', badge: 1 } },
        },
      });

      res.status(200).send('OK');
    } catch (err) {
      console.error('[notifyNewMessage] error:', err);
      // Clean up dead tokens so the CF doesn't retry pointlessly next time.
      if (err && (err.code === 'messaging/invalid-registration-token'
              || err.code === 'messaging/registration-token-not-registered')) {
        try {
          await admin.database().ref(`/users/${recipientId}/fcmToken`).remove();
        } catch {}
      }
      res.status(500).send('Error');
    }
  });