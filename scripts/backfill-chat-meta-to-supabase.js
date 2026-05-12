// One-shot backfill: copy existing RTDB /chat_meta_data and
// /group_meta_data into Supabase. Run this BEFORE flipping any client
// to read from Supabase, so on first open every user already sees
// their chat list / group list / unread counts.
//
// Idempotent — uses upsert, safe to re-run.
//
// Run:
//   SUPABASE_URL=https://jaimyhmanefvrijvjzxl.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role> \
//   node scripts/backfill-chat-meta-to-supabase.js
//
// Optional: parallelise across N workers with key ranges:
//   WORKER_TAG=W1 RANGE_START=0  RANGE_END=8 node scripts/...
//   WORKER_TAG=W2 RANGE_START=8  RANGE_END=Z node scripts/...
//   (Firebase UIDs are lexicographic; pick partition points by sampling.)
//
// Prereqs:
//   1. serviceAccount.json at project root.
//   2. SUPABASE_SERVICE_ROLE_KEY in env.
//   3. supabase/000_init.sql + supabase/002_chat_metadata.sql applied.

const path = require('path');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json');

let serviceAccount;
try {
  serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (e) {
  console.error(`\n❌ Could not load ${SERVICE_ACCOUNT_PATH}\n`);
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌ Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.\n');
  process.exit(1);
}

const RTDB_URL = process.env.RTDB_URL ||
  `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: RTDB_URL,
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PAGE_USERS = 100;
const FLUSH_AT = 200;

const RANGE_START = process.env.RANGE_START || null;
const RANGE_END = process.env.RANGE_END || null;
const WORKER_TAG = process.env.WORKER_TAG || '';

function chatMetaRow(ownerUid, partnerUid, v) {
  return {
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
}

function groupMetaRow(userId, groupId, v) {
  return {
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
}

async function upsertSlice(table, slice, conflictKey) {
  const delays = [1000, 2000, 4000, 8000, 16000, 30000, 60000, 60000, 60000, 60000];
  let attempt = 0;
  while (true) {
    try {
      const { error } = await supabase.from(table).upsert(slice, { onConflict: conflictKey });
      if (error) throw new Error(error.message);
      return;
    } catch (e) {
      attempt += 1;
      if (attempt > delays.length) throw e;
      const wait = delays[attempt - 1];
      console.log(`  ⚠️  ${table} hiccup (${e.message}). retry ${attempt}/${delays.length} in ${wait}ms…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function paginateAndUpsert({ rootPath, table, conflictKey, makeRow }) {
  const tag = WORKER_TAG ? `[${WORKER_TAG}] ` : '';
  console.log(`${tag}📥 Streaming /${rootPath} (page=${PAGE_USERS}, range=${RANGE_START || '∅'}…${RANGE_END || '∅'})`);
  const ref = admin.database().ref(rootPath);
  let lastKey = null;
  let usersSeen = 0;
  let totalUpserted = 0;
  let pendingRows = [];

  while (true) {
    let q = ref.orderByKey().limitToFirst(PAGE_USERS + (lastKey ? 1 : 0));
    if (lastKey) {
      q = q.startAt(lastKey);
    } else if (RANGE_START) {
      q = q.startAt(RANGE_START);
    }
    if (RANGE_END) q = q.endAt(RANGE_END);
    const snap = await q.once('value');
    const page = snap.val();
    if (!page) break;

    const keys = Object.keys(page);
    const newKeys = lastKey ? keys.filter((k) => k !== lastKey) : keys;
    if (newKeys.length === 0) break;

    for (const ownerUid of newKeys) {
      const children = page[ownerUid] || {};
      if (typeof children !== 'object') continue;
      for (const childKey of Object.keys(children)) {
        const v = children[childKey];
        if (!v || typeof v !== 'object') continue;
        pendingRows.push(makeRow(ownerUid, childKey, v));
      }
      usersSeen += 1;
    }

    while (pendingRows.length >= FLUSH_AT) {
      const slice = pendingRows.slice(0, FLUSH_AT);
      pendingRows = pendingRows.slice(FLUSH_AT);
      await upsertSlice(table, slice, conflictKey);
      totalUpserted += slice.length;
    }

    process.stdout.write(`${tag}users=${usersSeen} upserted=${totalUpserted}\n`);

    lastKey = keys[keys.length - 1];
    if (newKeys.length < PAGE_USERS) break;
  }

  if (pendingRows.length) {
    await upsertSlice(table, pendingRows, conflictKey);
    totalUpserted += pendingRows.length;
  }
  process.stdout.write(`${tag}users=${usersSeen} upserted=${totalUpserted} (final)\n`);
  return totalUpserted;
}

(async () => {
  try {
    const a = await paginateAndUpsert({
      rootPath: 'chat_meta_data',
      table: 'chat_meta_data',
      conflictKey: 'owner_uid,partner_uid',
      makeRow: chatMetaRow,
    });
    const b = await paginateAndUpsert({
      rootPath: 'group_meta_data',
      table: 'group_meta_data',
      conflictKey: 'user_id,group_id',
      makeRow: groupMetaRow,
    });
    console.log(`\n✅ Done. chat_meta_data=${a}, group_meta_data=${b}`);
    console.log('\n💡 Next: run VACUUM ANALYZE public.chat_meta_data; and public.group_meta_data; in Supabase CLI.');
    process.exit(0);
  } catch (e) {
    console.error('❌ Backfill failed:', e?.message || e);
    process.exit(1);
  }
})();
