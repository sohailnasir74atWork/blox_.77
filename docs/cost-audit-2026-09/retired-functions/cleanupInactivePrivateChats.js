/**
 * One-time local script to delete inactive private chats.
 *
 * A chat is "inactive" if its last activity (chat_meta_data.timestamp)
 * is older than INACTIVE_DAYS (default 30).
 *
 * For each inactive chat we delete:
 *   - private_messages/{chatId}            (messages + trade + lastRead)
 *   - chat_meta_data/{uidA}/{uidB}         (sender side metadata)
 *   - chat_meta_data/{uidB}/{uidA}         (receiver side metadata)
 *
 * RTDB schema (from Code/ChatScreen/PrivateChat/PrivateChat.jsx):
 *   chatId          = [uidA, uidB].sort().join('_')
 *   metadata path   = chat_meta_data/{userId}/{otherUserId}
 *   metadata fields = { chatId, receiverId, lastMessage, timestamp, unreadCount, ... }
 *   messages path   = private_messages/{chatId}/messages/{ts}
 *
 * Run on your PC:  node cleanupInactivePrivateChats.js
 * Dry-run first:   node cleanupInactivePrivateChats.js --dry
 */

const admin = require('firebase-admin');
const fs = require('fs');
const https = require('https');

const SERVICE_ACCOUNT_PATH = './fruiteblocks-firebase-adminsdk-yfyra-203584e8a0.json';
const RTDB_URL = 'https://fruiteblocks-default-rtdb.firebaseio.com';

const DRY_RUN = process.argv.includes('--dry');
const INACTIVE_DAYS = 30;
const CUTOFF_MS = Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;   // chats per multi-path update (delete phase)
const SCAN_CONCURRENCY = 25; // parallel per-user reads (scan phase)

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.log('Service account file not found:', SERVICE_ACCOUNT_PATH);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
  databaseURL: RTDB_URL,
});

const db = admin.database();

function chatIdOf(a, b) {
  return [a, b].sort().join('_');
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(data ? JSON.parse(data) : null);
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}; body=${data.slice(0, 200)}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('Request timeout')));
  });
}

/**
 * List the top-level user IDs under chat_meta_data via the REST shallow API.
 * Shallow returns only keys (not values), so the payload is small even when
 * the full subtree is far too big to fetch in one go.
 */
async function listUserIdsShallow() {
  const tokenObj = await admin.app().options.credential.getAccessToken();
  const accessToken = tokenObj.access_token;
  const url = `${RTDB_URL}/chat_meta_data.json?shallow=true&access_token=${accessToken}`;
  const result = await httpsGetJson(url);
  return result ? Object.keys(result) : [];
}

async function main() {
  console.log(`\n=== Inactive Private Chat Cleanup ${DRY_RUN ? '(DRY RUN)' : ''} ===`);
  console.log(`Inactivity threshold : ${INACTIVE_DAYS} days`);
  console.log(`Cutoff timestamp     : ${new Date(CUTOFF_MS).toISOString()}\n`);

  // Step 1: list every user under chat_meta_data via REST shallow.
  // The full subtree is far too big to fetch at once ("payload too large").
  // Shallow only returns keys, which is tiny even for millions of users.
  console.log('Listing user IDs under chat_meta_data (shallow) ...');
  const userIds = await listUserIdsShallow();
  if (userIds.length === 0) {
    console.log('No chat metadata found. Nothing to do.');
    process.exit(0);
  }
  console.log(`Found ${userIds.length} users with metadata.\n`);

  // Step 2: scan each user's subtree individually with bounded concurrency.
  // chatId -> { latestTimestamp, participants:Set<uid>, sides:number }
  const chatInfo = new Map();
  let usersScanned = 0;
  let userReadFailures = 0;
  let metaEntriesScanned = 0;

  async function scanUser(userId) {
    try {
      const snap = await db.ref(`chat_meta_data/${userId}`).once('value');
      if (snap.exists()) {
        snap.forEach(otherChild => {
          metaEntriesScanned++;
          const otherUserId = otherChild.key;
          const meta = otherChild.val() || {};

          const ts = typeof meta.timestamp === 'number' ? meta.timestamp : 0;
          const cid =
            typeof meta.chatId === 'string' && meta.chatId
              ? meta.chatId
              : chatIdOf(userId, otherUserId);

          let info = chatInfo.get(cid);
          if (!info) {
            info = { latestTimestamp: 0, participants: new Set(), sides: 0 };
            chatInfo.set(cid, info);
          }
          if (ts > info.latestTimestamp) info.latestTimestamp = ts;
          info.participants.add(userId);
          info.participants.add(otherUserId);
          info.sides++;
        });
      }
    } catch (err) {
      userReadFailures++;
      console.log(`  failed to read chat_meta_data/${userId}: ${err && err.message}`);
    } finally {
      usersScanned++;
      if (usersScanned % 250 === 0 || usersScanned === userIds.length) {
        console.log(
          `  ...scanned ${usersScanned}/${userIds.length} users  ` +
          `(entries=${metaEntriesScanned}, distinct chats=${chatInfo.size})`
        );
      }
    }
  }

  console.log(`Scanning per-user metadata (concurrency=${SCAN_CONCURRENCY}) ...`);
  for (let i = 0; i < userIds.length; i += SCAN_CONCURRENCY) {
    const slice = userIds.slice(i, i + SCAN_CONCURRENCY);
    await Promise.all(slice.map(scanUser));
  }

  console.log(`\nUsers scanned        : ${usersScanned}`);
  console.log(`User read failures   : ${userReadFailures}`);
  console.log(`Metadata entries     : ${metaEntriesScanned}`);
  console.log(`Distinct chats       : ${chatInfo.size}\n`);

  // Decide which chats to delete.
  const toDelete = [];
  let activeCount = 0;
  let noTimestampCount = 0;

  for (const [chatId, info] of chatInfo.entries()) {
    if (info.latestTimestamp === 0) {
      // No usable timestamp on either side — treat as stale.
      noTimestampCount++;
      toDelete.push({
        chatId,
        participants: Array.from(info.participants),
        latestTimestamp: 0,
      });
      continue;
    }
    if (info.latestTimestamp < CUTOFF_MS) {
      toDelete.push({
        chatId,
        participants: Array.from(info.participants),
        latestTimestamp: info.latestTimestamp,
      });
    } else {
      activeCount++;
    }
  }

  console.log(`Active chats (kept)              : ${activeCount}`);
  console.log(`Inactive chats (>${INACTIVE_DAYS}d)             : ${toDelete.length - noTimestampCount}`);
  console.log(`Chats with no timestamp (stale)  : ${noTimestampCount}`);
  console.log(`Total chats to delete            : ${toDelete.length}\n`);

  if (toDelete.length === 0) {
    console.log('Nothing to delete.');
    process.exit(0);
  }

  console.log('Preview (first 10):');
  for (const c of toDelete.slice(0, 10)) {
    const last = c.latestTimestamp ? new Date(c.latestTimestamp).toISOString() : 'unknown';
    console.log(`  ${c.chatId}  last=${last}  participants=${c.participants.length}`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('DRY RUN — nothing deleted. Re-run without --dry to perform deletion.');
    process.exit(0);
  }

  // Delete in batches via multi-path update with null values.
  console.log('Deleting in batches ...');
  let batch = {};
  let chatsInBatch = 0;
  let totalChatsDeleted = 0;
  let totalPathsNulled = 0;
  let batchNumber = 0;

  async function flushBatch() {
    if (chatsInBatch === 0) return;
    batchNumber++;
    const pathCount = Object.keys(batch).length;
    await db.ref().update(batch);
    totalPathsNulled += pathCount;
    console.log(
      `  batch #${batchNumber}: ${chatsInBatch} chats / ${pathCount} paths nulled  ` +
      `(running ${totalChatsDeleted}/${toDelete.length})`
    );
    batch = {};
    chatsInBatch = 0;
  }

  for (const c of toDelete) {
    // Wipe the entire messages subtree for this chat (messages + trade + lastRead).
    batch[`private_messages/${c.chatId}`] = null;

    // Wipe both sides of metadata. Participants set always contains both uids
    // because we add both keys (userId from outer loop, otherUserId from inner)
    // even if only one side wrote metadata.
    const [a, b] = c.participants;
    if (a && b) {
      batch[`chat_meta_data/${a}/${b}`] = null;
      batch[`chat_meta_data/${b}/${a}`] = null;
    } else if (a) {
      // Defensive: chatId path encodes both uids — extract the missing one.
      const parts = c.chatId.split('_');
      const other = parts.find(p => p !== a);
      if (other) {
        batch[`chat_meta_data/${a}/${other}`] = null;
        batch[`chat_meta_data/${other}/${a}`] = null;
      }
    }

    chatsInBatch++;
    totalChatsDeleted++;

    if (chatsInBatch >= BATCH_SIZE) {
      await flushBatch();
    }
  }
  await flushBatch();

  console.log(
    `\n✅ Done. Deleted ${totalChatsDeleted} inactive chats ` +
    `(${totalPathsNulled} RTDB paths nulled across ${batchNumber} batches).`
  );
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
