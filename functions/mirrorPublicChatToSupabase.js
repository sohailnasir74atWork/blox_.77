/**
 * Cloud Functions: mirror RTDB public chat into Supabase.
 *
 * One trigger per concept:
 *   - mirrorPublicChatMessageToSupabase  — RTDB onCreate at /chat_*_upgrade/{key}
 *   - mirrorPublicChatPinToSupabase      — RTDB onWrite  at /pin_messages/{key}
 *
 * RTDB stays the source of truth. The app keeps writing to
 * /chat_<lang>_upgrade as today, so old app versions keep seeing each
 * other's messages and the message stream is identical for both build
 * versions during the rollout window.
 *
 * Why onCreate (not onWrite) for messages:
 *   Public chat in Blox Fruit doesn't edit messages — sends are
 *   immutable, deletes are hard removes. Mirroring on create is enough
 *   and avoids re-firing on stray updates. We mirror the delete path
 *   separately (onDelete) so removed messages disappear from Supabase too.
 *
 * Channel routing:
 *   The RTDB path looks like /chat_new_upgrade/{key}, /chat_es_upgrade/{key}, …
 *   We wildcard the language segment with {channel} and look it up in
 *   ROOM_IDS. Unknown channels are ignored (defence in depth — if someone
 *   adds a channel and forgets to register it here, we log + drop instead
 *   of crashing the function).
 *
 * Deployment:
 *   firebase deploy --only functions:mirrorPublicChatMessageToSupabase,functions:mirrorPublicChatMessageDeleteToSupabase,functions:mirrorPublicChatPinToSupabase
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) {
  admin.initializeApp();
}

// Mirrors the CHANNELS array in Code/ChatScreen/GroupChat/Trader.jsx.
// Add new channels in two places: this set and the rooms table seed
// (supabase/001_public_chat.sql). Mismatches log + drop, not crash.
const ROOM_IDS = new Set([
  'chat_new_upgrade',
  'chat_raid_upgrade',
  'chat_help_upgrade',
  'chat_playing_upgrade',
  'chat_es_upgrade',
  'chat_ar_upgrade',
  'chat_pt_upgrade',
  'chat_fr_upgrade',
  'chat_de_upgrade',
  'chat_tr_upgrade',
  'chat_ru_upgrade',
  'chat_id_upgrade',
  'chat_ja_upgrade',
  'chat_ko_upgrade',
  'chat_ph_upgrade',
]);

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

const asString = (v) => (typeof v === 'string' ? v : null);

// RTDB serverTimestamp() lands as a number (ms epoch). Some legacy rows
// may store it as a Firebase Timestamp-shaped object; coerce defensively.
function tsToIso(v) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return new Date(v).toISOString();
  }
  if (v && typeof v === 'object' && typeof v.seconds === 'number') {
    return new Date(v.seconds * 1000).toISOString();
  }
  // Fall back to "now" — better than dropping the row. Mirror CF runs
  // ~1s after the write, so this is at most a 1s clock skew.
  return new Date().toISOString();
}

function buildMessageRow({ rtdbKey, channel, value }) {
  const reply = value && typeof value.replyTo === 'object' ? value.replyTo : null;
  return {
    rtdb_key: rtdbKey,
    room_id: channel,
    sender_id: asString(value?.senderId) || 'unknown',
    text: asString(value?.text),
    gif: asString(value?.gif),
    fruits: Array.isArray(value?.fruits) ? value.fruits : [],
    reply_to: reply ? { id: asString(reply.id), text: asString(reply.text) } : null,
    os: asString(value?.OS),
    created_at: tsToIso(value?.timestamp),
  };
}

// --------------------------------------------------------------------
// 1. Message create — fires when a user sends a message.
// --------------------------------------------------------------------
exports.mirrorPublicChatMessageToSupabase = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '256MB',
    timeoutSeconds: 30,
  })
  .database.ref('/{channel}/{key}')
  .onCreate(async (snap, context) => {
    const { channel, key } = context.params;
    if (!ROOM_IDS.has(channel)) return null; // not a public chat path

    const value = snap.val();
    if (!value || typeof value !== 'object') return null;

    const supabase = getSupabaseAdmin();
    const row = buildMessageRow({ rtdbKey: key, channel, value });

    // Idempotent insert via upsert on (room_id, rtdb_key). If the mirror
    // CF runs twice (CF retry, backfill overlap, etc.) we get one row.
    const { error } = await supabase
      .from('messages')
      .upsert(row, { onConflict: 'room_id,rtdb_key', ignoreDuplicates: true });
    if (error) {
      console.error('[mirrorPublicChatMessage] insert failed:', error.message, {
        channel, key,
      });
    }
    return null;
  });

// --------------------------------------------------------------------
// 2. Message delete — fires when a mod / admin removes a message
//    via the existing handleDeleteLast300Messages / per-row delete flows.
// --------------------------------------------------------------------
exports.mirrorPublicChatMessageDeleteToSupabase = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '256MB',
    timeoutSeconds: 30,
  })
  .database.ref('/{channel}/{key}')
  .onDelete(async (snap, context) => {
    const { channel, key } = context.params;
    if (!ROOM_IDS.has(channel)) return null;

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('room_id', channel)
      .eq('rtdb_key', key);
    if (error) {
      console.error('[mirrorPublicChatMessage] delete failed:', error.message, {
        channel, key,
      });
    }
    return null;
  });

// --------------------------------------------------------------------
// 3. Pin / unpin — RTDB /pin_messages/{key} stores a full copy of the
//    message with a `pinnedAt` field added. We normalise: keep the
//    message row in `messages`, link via pinned_messages row.
//
// On write:
//   - if rtdb has a value, we resolve the underlying message (by room +
//     senderId + text + close timestamp — Trader.jsx's pin flow doesn't
//     stash the original RTDB key, so we match heuristically) and
//     upsert a pinned_messages row.
//   - on delete, drop the pinned_messages row keyed by rtdb_key.
//
// Note: if the heuristic match misses (rare — exact text + sender +
// minute window is enough in practice), we still create a fresh
// `messages` row from the snapshot so the pin is never lost.
// --------------------------------------------------------------------
exports.mirrorPublicChatPinToSupabase = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '256MB',
    timeoutSeconds: 30,
  })
  .database.ref('/pin_messages/{key}')
  .onWrite(async (change, context) => {
    const { key } = context.params;
    const supabase = getSupabaseAdmin();

    // Unpin → delete the pinned_messages row.
    if (!change.after.exists()) {
      const { error } = await supabase
        .from('pinned_messages')
        .delete()
        .eq('rtdb_key', key);
      if (error) {
        console.error('[mirrorPublicChatPin] delete failed:', error.message, { key });
      }
      return null;
    }

    const v = change.after.val() || {};
    if (typeof v !== 'object') return null;

    // Best-effort: figure out which channel the original message lived
    // in. RTDB pin payload doesn't always include it directly; fall
    // back to default English room when ambiguous (matches client's
    // historical behaviour of pinning from the active channel only).
    const channel = ROOM_IDS.has(v.channel) ? v.channel
                  : ROOM_IDS.has(v.path) ? v.path
                  : 'chat_new_upgrade';

    // Locate the underlying message row. The pin payload mirrors the
    // original RTDB message shape (set by Trader.jsx pin flow), so we
    // match on (sender_id, text, ~timestamp). created_at must be within
    // a 5 minute window — sloppy but safe.
    const tsIso = tsToIso(v.timestamp);
    const earliest = new Date(new Date(tsIso).getTime() - 5 * 60 * 1000).toISOString();
    const latest = new Date(new Date(tsIso).getTime() + 5 * 60 * 1000).toISOString();

    let messageId = null;
    {
      const { data, error } = await supabase
        .from('messages')
        .select('id')
        .eq('room_id', channel)
        .eq('sender_id', v.senderId || '')
        .eq('text', v.text || null)
        .gte('created_at', earliest)
        .lte('created_at', latest)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') {
        console.warn('[mirrorPublicChatPin] lookup failed:', error.message);
      }
      if (data) messageId = data.id;
    }

    // Heuristic miss → write a fresh messages row from the snapshot so
    // the pin still resolves. This row won't have an rtdb_key (the pin
    // copy doesn't preserve the original push id), so the next mirror
    // run for the original message will produce a duplicate; accepted
    // as low-likelihood / low-impact.
    if (!messageId) {
      const ins = await supabase
        .from('messages')
        .insert(buildMessageRow({ rtdbKey: null, channel, value: v }))
        .select('id')
        .single();
      if (ins.error) {
        console.error('[mirrorPublicChatPin] fallback insert failed:', ins.error.message, { key });
        return null;
      }
      messageId = ins.data.id;
    }

    const pinRow = {
      rtdb_key: key,
      message_id: messageId,
      room_id: channel,
      pinned_by: asString(v.pinnedBy),
      pinned_at: tsToIso(v.pinnedAt || v.timestamp),
    };
    const { error } = await supabase
      .from('pinned_messages')
      .upsert(pinRow, { onConflict: 'rtdb_key' });
    if (error) {
      console.error('[mirrorPublicChatPin] upsert failed:', error.message, { key });
    }
    return null;
  });
