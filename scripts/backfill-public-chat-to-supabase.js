// One-shot backfill: copy existing RTDB public-chat messages
// (chat_*_upgrade) and /pin_messages into Supabase.
//
// Idempotent — uses upsert on (room_id, rtdb_key), safe to re-run.
//
// IMPORTANT: by default we backfill the LAST 30 DAYS only. Older
// messages are dead weight (chat scroll-back rarely goes more than a
// week, and pulling an entire history of millions of messages into
// Postgres is bad for cost + index bloat). Override via:
//   BACKFILL_DAYS=90 node scripts/backfill-public-chat-to-supabase.js
//
// Run:
//   SUPABASE_URL=https://jaimyhmanefvrijvjzxl.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role> \
//   node scripts/backfill-public-chat-to-supabase.js
//
// Prereqs:
//   1. serviceAccount.json at project root (Firebase Console →
//      Project Settings → Service Accounts → Generate new private key).
//   2. SUPABASE_SERVICE_ROLE_KEY in env (Supabase dashboard →
//      Project Settings → API → service_role key).
//   3. supabase/000_init.sql + supabase/001_public_chat.sql applied.
//   4. `npm install firebase-admin @supabase/supabase-js --no-save` if
//      the project root doesn't have them yet.

const path = require('path');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json');

let serviceAccount;
try {
  serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (e) {
  console.error(`\n❌ Could not load ${SERVICE_ACCOUNT_PATH}`);
  console.error('   Download it from Firebase Console → Project Settings');
  console.error('   → Service Accounts → Generate new private key.\n');
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

const ROOM_IDS = [
  'chat_new_upgrade', 'chat_raid_upgrade', 'chat_help_upgrade', 'chat_playing_upgrade',
  'chat_es_upgrade', 'chat_ar_upgrade', 'chat_pt_upgrade', 'chat_fr_upgrade',
  'chat_de_upgrade', 'chat_tr_upgrade', 'chat_ru_upgrade', 'chat_id_upgrade',
  'chat_ja_upgrade', 'chat_ko_upgrade', 'chat_ph_upgrade',
];

const BACKFILL_DAYS = parseInt(process.env.BACKFILL_DAYS || '30', 10);
const cutoffMs = Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000;
const FLUSH_AT = 200;

function tsToIso(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  return new Date().toISOString();
}

function buildRow(roomId, rtdbKey, value) {
  const reply = value && typeof value.replyTo === 'object' ? value.replyTo : null;
  return {
    rtdb_key: rtdbKey,
    room_id: roomId,
    sender_id: typeof value?.senderId === 'string' ? value.senderId : 'unknown',
    text: typeof value?.text === 'string' ? value.text : null,
    gif: typeof value?.gif === 'string' ? value.gif : null,
    fruits: Array.isArray(value?.fruits) ? value.fruits : [],
    reply_to: reply
      ? { id: typeof reply.id === 'string' ? reply.id : null, text: typeof reply.text === 'string' ? reply.text : null }
      : null,
    os: typeof value?.OS === 'string' ? value.OS : null,
    created_at: tsToIso(value?.timestamp),
  };
}

async function upsertSlice(table, slice, conflictKey) {
  const delays = [1000, 2000, 4000, 8000, 16000, 30000, 60000, 60000];
  let attempt = 0;
  while (true) {
    try {
      const { error } = await supabase
        .from(table)
        .upsert(slice, { onConflict: conflictKey, ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      return;
    } catch (e) {
      attempt += 1;
      if (attempt > delays.length) {
        console.error(`\n❌ ${table} upsert failed after ${delays.length} retries:`, e.message);
        throw e;
      }
      const wait = delays[attempt - 1];
      console.log(`  ⚠️  ${table} upsert hiccup (${e.message}). retry ${attempt}/${delays.length} in ${wait}ms…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function backfillRoom(roomId) {
  // Walk newest → oldest in pages keyed by RTDB push key. Push keys are
  // lexicographically time-ordered, so .endAt(lastKey) descends without
  // having to load the whole room into memory.
  const ref = admin.database().ref(roomId);
  const PAGE = 500;
  let endKey = null;
  let upserted = 0;
  let scanned = 0;

  while (true) {
    let q = ref.orderByKey().limitToLast(PAGE);
    if (endKey) q = q.endAt(endKey);
    const snap = await q.once('value');
    const page = snap.val();
    if (!page) break;

    const keys = Object.keys(page).sort(); // ascending
    if (endKey) {
      const idx = keys.indexOf(endKey);
      if (idx >= 0) keys.splice(idx, 1); // exclusive endAt
    }
    if (keys.length === 0) break;

    const rows = [];
    let oldestSeenMs = Infinity;
    for (const k of keys) {
      const v = page[k];
      if (!v || typeof v !== 'object') continue;
      const ts = typeof v.timestamp === 'number' ? v.timestamp : Date.now();
      oldestSeenMs = Math.min(oldestSeenMs, ts);
      if (ts < cutoffMs) continue; // older than backfill window
      rows.push(buildRow(roomId, k, v));
    }
    scanned += keys.length;

    for (let i = 0; i < rows.length; i += FLUSH_AT) {
      const slice = rows.slice(i, i + FLUSH_AT);
      await upsertSlice('messages', slice, 'room_id,rtdb_key');
      upserted += slice.length;
    }
    process.stdout.write(`  [${roomId}] scanned=${scanned} upserted=${upserted}\r`);

    // Stop when this page reaches before the cutoff.
    if (oldestSeenMs < cutoffMs) break;

    endKey = keys[0];
    if (keys.length < PAGE - 1) break; // last page
  }

  process.stdout.write(`  [${roomId}] scanned=${scanned} upserted=${upserted} (final)\n`);
  return upserted;
}

async function backfillPins() {
  console.log('📥 Backfilling /pin_messages …');
  const snap = await admin.database().ref('pin_messages').once('value');
  const data = snap.val();
  if (!data) {
    console.log('  no pinned messages.');
    return 0;
  }

  let upserted = 0;
  // For each pin: locate its underlying message row, then write a
  // pinned_messages row referencing it. Heuristic match on
  // (room, sender, text, ~timestamp) — same as the live mirror CF.
  for (const [pinKey, v] of Object.entries(data)) {
    if (!v || typeof v !== 'object') continue;

    const channel = ROOM_IDS.includes(v.channel) ? v.channel
                  : ROOM_IDS.includes(v.path) ? v.path
                  : 'chat_new_upgrade';
    const tsIso = tsToIso(v.timestamp);
    const earliest = new Date(new Date(tsIso).getTime() - 5 * 60 * 1000).toISOString();
    const latest = new Date(new Date(tsIso).getTime() + 5 * 60 * 1000).toISOString();

    let messageId = null;
    {
      const { data: rows, error } = await supabase
        .from('messages')
        .select('id')
        .eq('room_id', channel)
        .eq('sender_id', typeof v.senderId === 'string' ? v.senderId : '')
        .eq('text', typeof v.text === 'string' ? v.text : null)
        .gte('created_at', earliest)
        .lte('created_at', latest)
        .order('created_at', { ascending: true })
        .limit(1);
      if (error) {
        console.warn(`  ⚠️  pin ${pinKey} lookup failed:`, error.message);
      }
      if (rows && rows.length > 0) messageId = rows[0].id;
    }

    if (!messageId) {
      const ins = await supabase
        .from('messages')
        .insert(buildRow(channel, null, v))
        .select('id')
        .single();
      if (ins.error) {
        console.warn(`  ⚠️  pin ${pinKey} fallback insert failed:`, ins.error.message);
        continue;
      }
      messageId = ins.data.id;
    }

    const { error: pinErr } = await supabase
      .from('pinned_messages')
      .upsert({
        rtdb_key: pinKey,
        message_id: messageId,
        room_id: channel,
        pinned_by: typeof v.pinnedBy === 'string' ? v.pinnedBy : null,
        pinned_at: tsToIso(v.pinnedAt || v.timestamp),
      }, { onConflict: 'rtdb_key' });
    if (pinErr) {
      console.warn(`  ⚠️  pin ${pinKey} upsert failed:`, pinErr.message);
      continue;
    }
    upserted += 1;
  }
  console.log(`  pinned: ${upserted}`);
  return upserted;
}

(async () => {
  console.log(`📅 Backfill window: last ${BACKFILL_DAYS} days (cutoff = ${new Date(cutoffMs).toISOString()})`);
  try {
    let total = 0;
    for (const room of ROOM_IDS) {
      console.log(`\n📥 ${room}`);
      total += await backfillRoom(room);
    }
    const pins = await backfillPins();
    console.log(`\n✅ Done. messages=${total}, pins=${pins}`);
    console.log('\n💡 Next: run VACUUM ANALYZE public.messages; in Supabase CLI.');
    process.exit(0);
  } catch (e) {
    console.error('❌ Backfill failed:', e?.message || e);
    process.exit(1);
  }
})();
