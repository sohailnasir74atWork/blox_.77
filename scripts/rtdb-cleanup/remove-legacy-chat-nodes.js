#!/usr/bin/env node
/**
 * Back up and empty the frozen pre-Supabase chat nodes on RTDB (2026-10-29).
 * All are write:false since the 2026-10-06 rules lockdown (newest message
 * 2026-10-05); the app and site read chat from Supabase, which keeps public
 * chat 2 days and group chat 30 days (051). Paths and rules stay.
 *
 * Each node is saved whole to <out>/<node>.json.gz (fsynced), then removed in
 * batches of 200 children so no single write is large.
 *
 *   node scripts/rtdb-cleanup/remove-legacy-chat-nodes.js --out <dir>            # dry run (sizes)
 *   node scripts/rtdb-cleanup/remove-legacy-chat-nodes.js --out <dir> --apply
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const admin = require('firebase-admin');

const LANGS = ['new', 'raid', 'help', 'playing', 'es', 'ar', 'pt', 'fr', 'de', 'tr', 'ru', 'id', 'ja', 'ko', 'ph'];
const NODES = [
  ...LANGS.map((l) => `chat_${l}`),
  ...LANGS.map((l) => `chat_${l}_upgrade`),
  'group_messages',
  'private_chat_new',
];
const BATCH = 200;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const outIdx = args.indexOf('--out');
if (outIdx < 0 || !args[outIdx + 1]) { console.error('--out <dir> is required'); process.exit(1); }
const outDir = path.resolve(args[outIdx + 1]);
fs.mkdirSync(outDir, { recursive: true });

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, '../../serviceAccount.json'))),
  databaseURL: 'https://fruiteblocks-default-rtdb.firebaseio.com',
});
const rtdb = admin.database();

(async () => {
  let total = 0;
  for (const node of NODES) {
    const val = (await rtdb.ref(node).get()).val();
    if (!val) { console.log(node, 'empty'); continue; }
    const json = JSON.stringify(val);
    const keys = Object.keys(val);
    total += json.length;
    if (!apply) { console.log(node, keys.length, 'children', json.length, 'bytes'); continue; }
    const file = path.join(outDir, `${node}.json.gz`);
    const fd = fs.openSync(file, 'w');
    fs.writeSync(fd, zlib.gzipSync(json));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    // Read the backup back before deleting anything.
    const back = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
    if (Object.keys(back).length !== keys.length) throw new Error(`${node}: backup mismatch`);
    for (let i = 0; i < keys.length; i += BATCH) {
      const updates = {};
      keys.slice(i, i + BATCH).forEach((k) => { updates[k] = null; });
      await rtdb.ref(node).update(updates);
    }
    console.log(node, 'removed', keys.length, 'children', json.length, 'bytes ->', path.basename(file));
  }
  console.log('DONE', apply ? 'apply' : 'dry_run', total, 'bytes');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
