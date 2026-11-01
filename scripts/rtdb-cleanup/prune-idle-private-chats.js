#!/usr/bin/env node
/**
 * One-off backlog run of functions/cleanupIdlePrivateChats.js with a local
 * backup (2026-10-29). Every idle room is appended to a gzip JSONL file
 * ({"k": chatKey, "v": room}) and flushed BEFORE its page is deleted.
 * Progress (last key) is saved after each page, so a re-run resumes.
 *
 *   node scripts/rtdb-cleanup/prune-idle-private-chats.js --out <dir>            # dry run
 *   node scripts/rtdb-cleanup/prune-idle-private-chats.js --out <dir> --apply
 *
 * Restore one room:  zcat <dir>/private_messages-*.jsonl.gz | grep '"k":"<chatKey>"'
 * then set private_messages/<chatKey> to its "v".
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const admin = require('firebase-admin');
const { pruneIdlePrivateChats } = require('../../functions/cleanupIdlePrivateChats');

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

const stateFile = path.join(outDir, 'state.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { part: 0 };
const part = (state.part || 0) + 1;
const backupFile = path.join(outDir, `private_messages-part${part}.jsonl.gz`);
const fd = fs.openSync(backupFile, 'a');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(JSON.stringify({ apply, outDir, resumeAfter: state.last || null, backupFile }));
  const report = await pruneIdlePrivateChats(admin.database(), {
    apply,
    startAfter: state.last ?? null,
    timeBudgetMs: 24 * 60 * 60 * 1000,
    // One gzip member per page (zcat reads concatenated members), on disk
    // and fsynced before the delete goes out.
    onDoomed: async (entries) => {
      fs.writeSync(fd, zlib.gzipSync(entries.map(([k, v]) => JSON.stringify({ k, v })).join('\n') + '\n'));
      fs.fsyncSync(fd);
    },
    onPage: async (r) => {
      if (apply) fs.writeFileSync(stateFile, JSON.stringify({ part, last: r.last, at: new Date().toISOString() }));
      if (r.pages % 20 === 0) console.log(JSON.stringify(r));
      await sleep(150);
    },
  });
  fs.closeSync(fd);
  if (apply) fs.writeFileSync(stateFile, JSON.stringify({ part, last: report.last, done: true, at: new Date().toISOString() }));
  else fs.unlinkSync(backupFile);
  console.log('DONE', JSON.stringify(report));
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
