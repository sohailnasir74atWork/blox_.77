// =====================================================================
// PASTE THIS ENTIRE FILE INTO YOUR index.js. After pasting, deploy:
//
//   firebase deploy --only functions:notifyPrivateMessage,functions:notifyGroupNewMessage
//
// Required Firebase secrets (set once on that deployment):
//   firebase functions:secrets:set SUPABASE_URL
//   firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
//   firebase functions:secrets:set SUPABASE_WEBHOOK_SECRET
//
// Two webhooks needed in Supabase Dashboard → Database → Webhooks:
//
//   Private message webhook
//     Name:    notify-new-private-message
//     Table:   public.private_messages
//     Event:   INSERT
//     Method:  POST
//     URL:     <your CF URL for notifyPrivateMessage>
//     Header:  x-webhook-secret = <same value as Firebase secret>
//
//   Group message webhook
//     Name:    notify-new-group-message
//     Table:   public.group_messages
//     Event:   INSERT
//     Method:  POST
//     URL:     <your CF URL for notifyGroupNewMessage>
//     Header:  x-webhook-secret = <same value as Firebase secret>
//
// Uses Firebase Functions v1 API (matches your existing mirror CFs).
// If your existing index.js already has these requires + admin init,
// skip those lines on paste — keep only one copy.
// =====================================================================

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

if (!admin.apps.length) admin.initializeApp();


// --- Supabase client (lazy + cached) ---------------------------------
let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  _supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return _supabase;
}

// --- Webhook auth + INSERT-only guard --------------------------------
// Returns the record on accept, or null if the caller should stop
// (response already sent).
function validateWebhookOr401(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return null;
  }
  const providedSecret = req.headers['x-webhook-secret'];
  if (!providedSecret || providedSecret !== process.env.SUPABASE_WEBHOOK_SECRET) {
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

// --- Body preview text -----------------------------------------------
function previewFor(r) {
  if (r.text && String(r.text).trim()) return r.text;
  if (r.image_url) return '📷 Photo';
  if (Array.isArray(r.fruits) && r.fruits.length > 0) return `🐾 Sent ${r.fruits.length} pet(s)`;
  return 'New message';
}

const RUN_OPTIONS = {
  secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_WEBHOOK_SECRET'],
  memory: '256MB',
};


// =====================================================================
// notifyPrivateMessage — private 1-on-1 push
// (renamed from notifyNewMessage to avoid trigger-type conflict with
// the existing RTDB-triggered function of the same name)
// =====================================================================
exports.notifyPrivateMessage = functions
  .runWith({ ...RUN_OPTIONS, timeoutSeconds: 30 })
  .https.onRequest(async (req, res) => {
    const record = validateWebhookOr401(req, res);
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

    try {
      const supabase = getSupabase();

      // Parallel: mute + sender name (Supabase) AND active-chat check + fcmToken (RTDB).
      // Active-chat skip: if the recipient is currently viewing this exact
      // chat, suppress the push — they'll see the message inline. The
      // client maintains /activeChats/{userId} = chatId via setActiveChat()
      // on focus and clears it via onDisconnect / blur.
      const [chatRowResult, activeChatSnap, tokenSnap] = await Promise.all([
        supabase
          .from('chat_meta_data')
          .select('muted, receiver_name')
          .eq('owner_uid', recipientId)
          .eq('partner_uid', senderId)
          .maybeSingle(),
        admin.database().ref(`/activeChats/${recipientId}`).once('value'),
        admin.database().ref(`/users/${recipientId}/fcmToken`).once('value'),
      ]);
      const chatRow = chatRowResult?.data;

      if (chatRow?.muted === true) {
        res.status(200).send('Skipped: muted');
        return;
      }

      const activeChatId = activeChatSnap.val();
      if (activeChatId && String(activeChatId) === String(record.chat_id)) {
        res.status(200).send('Skipped: recipient on this chat');
        return;
      }

      const fcmToken = tokenSnap.val();
      if (!fcmToken || typeof fcmToken !== 'string') {
        res.status(200).send('Skipped: no fcmToken');
        return;
      }

      const senderName = chatRow?.receiver_name || 'Someone';

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
        },
        android: {
          priority: 'high',
          notification: { sound: 'default', channelId: 'messages' },
        },
        apns: {
          payload: { aps: { sound: 'default' } },
        },
      });

      res.status(200).send('OK');
    } catch (err) {
      console.error('[notifyNewMessage] error:', err);
      res.status(500).send('Error');
    }
  });


// =====================================================================
// notifyGroupNewMessage — group fan-out push
// =====================================================================
exports.notifyGroupNewMessage = functions
  .runWith({ ...RUN_OPTIONS, timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    const record = validateWebhookOr401(req, res);
    if (!record) return;

    const groupId = record.group_id;
    const senderId = record.sender_id;
    const senderName = record.sender_name || 'Someone';

    if (!groupId || !senderId) {
      res.status(200).send('Skipped: missing group/sender');
      return;
    }

    try {
      // memberIds come from Firestore; the migration leaves group
      // membership where it lives today.
      const groupSnap = await admin.firestore().doc(`groups/${groupId}`).get();
      if (!groupSnap.exists) {
        res.status(200).send('Skipped: group not found');
        return;
      }
      const memberIds = (groupSnap.data().memberIds || [])
        .filter((id) => id && id !== senderId);
      if (memberIds.length === 0) {
        res.status(200).send('Skipped: no other members');
        return;
      }

      // Parallel: mute flags + group name (Supabase) AND who's currently
      // viewing this group's chat (RTDB /activeGroupChats/{groupId}).
      // Members on the chat screen see the message inline — push would
      // be redundant + spammy.
      const supabase = getSupabase();
      const [metaResult, activeGroupSnap] = await Promise.all([
        supabase
          .from('group_meta_data')
          .select('user_id, muted, group_name')
          .eq('group_id', groupId)
          .in('user_id', memberIds),
        admin.database().ref(`/activeGroupChats/${groupId}`).once('value'),
      ]);
      const metaRows = metaResult?.data;

      const mutedSet = new Set();
      let groupName = 'Group Chat';
      for (const r of metaRows || []) {
        if (r.muted) mutedSet.add(r.user_id);
        if (r.group_name) groupName = r.group_name;
      }

      const activeMap = activeGroupSnap.val() || {};
      const activeSet = new Set(
        Object.keys(activeMap).filter((uid) => activeMap[uid] === true),
      );

      const wantTokenFor = memberIds.filter(
        (id) => !mutedSet.has(id) && !activeSet.has(id),
      );
      if (wantTokenFor.length === 0) {
        res.status(200).send('Skipped: all muted or active in chat');
        return;
      }

      // Parallel fcmToken reads. Per-token failures don't kill the rest.
      const tokenSnaps = await Promise.all(
        wantTokenFor.map((uid) =>
          admin.database()
            .ref(`/users/${uid}/fcmToken`)
            .once('value')
            .catch(() => null),
        ),
      );
      const tokens = [];
      for (const snap of tokenSnaps) {
        const v = snap?.val();
        if (v && typeof v === 'string') tokens.push(v);
      }
      if (tokens.length === 0) {
        res.status(200).send('Skipped: no fcm tokens');
        return;
      }

      // sendEachForMulticast handles per-token errors so one bad
      // token doesn't tank the rest.
      await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: `${senderName} • ${groupName}`,
          body: previewFor(record),
        },
        data: {
          type: 'group_message',
          groupId: String(groupId),
          senderId: String(senderId),
          messageId: String(record.id || ''),
        },
        android: {
          priority: 'high',
          notification: { sound: 'default', channelId: 'messages' },
        },
        apns: {
          payload: { aps: { sound: 'default' } },
        },
      });

      res.status(200).send('OK');
    } catch (err) {
      console.error('[notifyGroupNewMessage] error:', err);
      res.status(500).send('Error');
    }
  });
