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
//
// Per message (2026-10-19, group lag): one Firestore read (memberIds), one group_members + one group_meta_data query, the
// activeGroupChats node and the collapse state below, then fcmTokens only for
// the members who actually get a push — from a per-instance cache, so a busy
// group re-reads none of them.
// Collapse: a member gets at most one push per group every 2 minutes. What
// arrives in between is counted, and the next push shows the newest message
// with "(+N)" — a number, so it reads in every language (the server knows no
// player languages). Android `tag` / iOS `apns-collapse-id` replace the
// group's previous notification in the tray instead of stacking them.
// =====================================================================
const PUSH_COLLAPSE_MS = 2 * 60 * 1000;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const TOKEN_CACHE_MAX = 5000;
const _tokenCache = new Map(); // uid → { token | null, at }

// fcmTokens for `uids`, cached per instance for TOKEN_TTL_MS.
async function tokensFor(uids, { rtdb, now, cache }) {
  const out = new Map();
  const miss = [];
  for (const uid of uids) {
    const c = cache.get(uid);
    if (c && now - c.at < TOKEN_TTL_MS) {
      if (c.token) out.set(uid, c.token);
    } else {
      miss.push(uid);
    }
  }
  if (cache.size + miss.length > TOKEN_CACHE_MAX) cache.clear();
  const snaps = await Promise.all(
    miss.map((uid) => rtdb.ref(`/users/${uid}/fcmToken`).once('value').catch(() => null)),
  );
  miss.forEach((uid, i) => {
    const v = snaps[i]?.val?.();
    const token = typeof v === 'string' && v ? v : null;
    cache.set(uid, { token, at: now });
    if (token) out.set(uid, token);
  });
  return out;
}

async function handleGroupPush(record, deps) {
  const { firestore, rtdb, supabase, messaging, now = Date.now(), cache = _tokenCache } = deps;
  const groupId = record.group_id;
  const senderId = record.sender_id;
  const senderName = record.sender_name || 'Someone';
  if (!groupId || !senderId) return 'Skipped: missing group/sender';

  const groupSnap = await firestore.doc(`groups/${groupId}`).get();
  if (!groupSnap.exists) return 'Skipped: group not found';
  const group = groupSnap.data() || {};

  let memberIds = [...new Set((group.memberIds || []).filter((id) => id && id !== senderId))];
  if (memberIds.length === 0) return 'Skipped: no other members';

  // Parallel: verified members (supabase/044), mute flags + group name, and
  // who's on this group's chat screen right now (they see it inline).
  const [verifiedResult, metaResult, activeGroupSnap, stateSnap] = await Promise.all([
    supabase.from('group_members').select('user_id, role').eq('group_id', groupId),
    supabase.from('group_meta_data').select('user_id, muted, group_name').eq('group_id', groupId).in('user_id', memberIds),
    rtdb.ref(`/activeGroupChats/${groupId}`).once('value'),
    rtdb.ref(`/group_push_state/${groupId}`).once('value'),
  ]);

  // Only server-verified members get the push, so an account that added
  // itself to memberIds sees no preview. Groups not synced yet (no creator
  // row) keep the memberIds list.
  const verifiedRows = verifiedResult?.data || [];
  if (verifiedRows.some((r) => r.role === 'creator')) {
    const verified = new Set(verifiedRows.map((r) => r.user_id));
    memberIds = memberIds.filter((id) => verified.has(id));
    if (memberIds.length === 0) return 'Skipped: no other verified members';
  }

  const mutedSet = new Set();
  let groupName = 'Group Chat';
  for (const r of metaResult?.data || []) {
    if (r.muted) mutedSet.add(r.user_id);
    if (r.group_name) groupName = r.group_name;
  }
  const activeMap = activeGroupSnap?.val?.() || {};
  const wanted = memberIds.filter((id) => !mutedSet.has(id) && activeMap[id] !== true);
  if (wanted.length === 0) return 'Skipped: all muted or active in chat';

  const state = stateSnap?.val?.() || {};
  const pushNow = [];
  const hold = [];
  for (const uid of wanted) {
    const at = state[uid]?.at;
    if (typeof at === 'number' && now - at < PUSH_COLLAPSE_MS) hold.push(uid);
    else pushNow.push(uid);
  }

  const tokens = await tokensFor(pushNow, { rtdb, now, cache });
  const preview = previewFor(record);
  const collapseId = String(groupId).slice(0, 64);
  const sendTo = pushNow.filter((uid) => tokens.has(uid));
  const messages = sendTo.map((uid) => {
    const missed = Number(state[uid]?.n) || 0;
    return {
      token: tokens.get(uid),
      notification: {
        title: `${senderName} • ${groupName}`,
        body: missed > 0 ? `${preview} (+${missed})` : preview,
      },
      data: {
        type: 'group_message',
        groupId: String(groupId),
        senderId: String(senderId),
        messageId: String(record.id || ''),
      },
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'messages', tag: `group_${collapseId}` },
      },
      apns: {
        headers: { 'apns-collapse-id': collapseId },
        payload: { aps: { sound: 'default', 'thread-id': collapseId } },
      },
    };
  });

  for (let i = 0; i < messages.length; i += 500) {
    const res = await messaging.sendEach(messages.slice(i, i + 500));
    (res?.responses || []).forEach((r, j) => {
      const code = r?.error?.code || '';
      if (!r?.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) {
        cache.delete(sendTo[i + j]); // re-read that token next time
      }
    });
  }

  // Remember who got a push now and count what the others missed.
  const update = {};
  for (const uid of sendTo) update[uid] = { at: now, n: 0 };
  for (const uid of hold) update[`${uid}/n`] = rtdb.increment(1);
  if (Object.keys(update).length) await rtdb.ref(`/group_push_state/${groupId}`).update(update);

  if (sendTo.length === 0) return hold.length ? `Held: ${hold.length} (collapse window)` : 'Skipped: no fcm tokens';
  return `OK: ${sendTo.length} sent, ${hold.length} held`;
}

exports.notifyGroupNewMessage = functions
  .runWith({ ...RUN_OPTIONS, timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    const record = validateWebhookOr401(req, res);
    if (!record) return;
    try {
      const db = admin.database();
      const result = await handleGroupPush(record, {
        firestore: admin.firestore(),
        rtdb: { ref: (p) => db.ref(p), increment: (n) => admin.database.ServerValue.increment(n) },
        supabase: getSupabase(),
        messaging: admin.messaging(),
        now: Date.now(),
      });
      res.status(200).send(result);
    } catch (err) {
      console.error('[notifyGroupNewMessage] error:', err);
      res.status(500).send('Error');
    }
  });

exports._internal = { handleGroupPush, tokensFor, PUSH_COLLAPSE_MS };
