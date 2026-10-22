/**
 * Emulator suite for functions/wordFilterContent.js (word filter on feed
 * posts, comments and statuses). Named *.emulator.js so Jest does not pick
 * it up. From the Blox_Fruit directory:
 *   JAVA_HOME=/opt/homebrew/opt/openjdk@24 firebase emulators:exec \
 *     --config functions/firebase.test.json --only database,firestore,functions \
 *     --project demo-fruiteblocks 'node functions/test/wordFilterContent.emulator.js'
 *
 * No SUPABASE_URL is set, so the deployed functions use the bundled list and
 * skip the hit log; one in-process case injects a fake Supabase client to
 * check the remote list and the log.
 */
const assert = require('assert');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-fruiteblocks';
process.env.GCLOUD_PROJECT = PROJECT;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = require('firebase-admin');
admin.initializeApp({ projectId: PROJECT });
const fsdb = admin.firestore();

const RUN = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, timeout = 25000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await fn();
    if (last) return last;
    await sleep(250);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

let pass = 0;
async function test(name, fn) {
  await fn();
  pass++;
  console.log('ok -', name);
}

(async () => {
  await test('post with a slur is masked, the rest kept', async () => {
    const ref = fsdb.collection('designPosts_upgrade').doc(`wf-post-${RUN}`);
    await ref.set({ userId: 'U1', desc: 'selling leopard, you n1gg3r lol', imageUrl: [], likes: {} });
    const d = await waitFor(async () => {
      const s = (await ref.get()).data();
      return s && s.wordFilter ? s : null;
    }, 'post masked');
    assert.strictEqual(d.desc, 'selling leopard, you ****** lol');
    assert.deepStrictEqual(d.wordFilter.fields, ['desc']);
    assert.strictEqual(d.wordFilter.masked, true);
    assert.deepStrictEqual(d.imageUrl, []);
  });

  await test('comment with spaced letters is masked', async () => {
    const ref = fsdb.collection('designPosts_upgrade').doc(`wf-post-${RUN}`).collection('comments').doc(`c-${RUN}`);
    await ref.set({ userId: 'U2', text: 'u r a f a g', displayName: 'x' });
    const d = await waitFor(async () => {
      const s = (await ref.get()).data();
      return s && s.wordFilter ? s : null;
    }, 'comment masked');
    assert.strictEqual(d.text, 'u r a *** *** ***');
  });

  await test('status caption and poll options are masked, votes kept', async () => {
    const ref = fsdb.collection('statuses').doc(`wf-status-${RUN}`);
    await ref.set({
      userId: 'U3', caption: 'vote, retard', type: 'poll',
      pollOptions: ['leopard', 'sp1c', 'dough'], pollVotes: { 0: [], 1: ['U9'], 2: [] },
    });
    const d = await waitFor(async () => {
      const s = (await ref.get()).data();
      return s && s.wordFilter ? s : null;
    }, 'status masked');
    assert.strictEqual(d.caption, 'vote, ******');
    assert.deepStrictEqual(d.pollOptions, ['leopard', '****', 'dough']);
    assert.deepStrictEqual(d.pollVotes[1], ['U9']);
    assert.deepStrictEqual(d.wordFilter.fields, ['caption', 'pollOptions']);
  });

  await test('clean and allow-listed text is left alone', async () => {
    const ref = fsdb.collection('statuses').doc(`wf-clean-${RUN}`);
    await ref.set({ userId: 'U4', caption: 'désolé, je suis en retard! spicy trade?' });
    const post = fsdb.collection('designPosts_upgrade').doc(`wf-clean-${RUN}`);
    await post.set({ userId: 'U4', desc: 'retards, spices, peacock, grape' }); // not slurs, not offensive
    await sleep(6000);
    assert.strictEqual((await ref.get()).data().wordFilter, undefined);
    assert.strictEqual((await ref.get()).data().caption, 'désolé, je suis en retard! spicy trade?');
    assert.strictEqual((await post.get()).data().wordFilter, undefined);
  });

  await test('offensive terms are masked too (052)', async () => {
    const post = fsdb.collection('designPosts_upgrade').doc(`wf-off-${RUN}`);
    await post.set({ userId: 'U4', desc: 'fuck this update' });
    await sleep(6000);
    const d = (await post.get()).data();
    assert.strictEqual(d.desc, '**** this update');
    assert.deepStrictEqual(d.wordFilter.fields, ['desc']);
  });

  await test('in-process: remote list replaces the bundled one, hits are logged', async () => {
    const wf = require('../wordFilterContent')._internal;
    const inserted = [];
    wf.setSupabase({
      rpc: async (name, args) => {
        assert.strictEqual(name, 'word_filter_list');
        assert.strictEqual(args.p_version, null);
        return { data: { v: 3, terms: [['xyzzy', 'slur', 'word'], ['plugh', 'offensive', 'word']], off: [] }, error: null };
      },
      from: (table) => ({
        insert: async (rows) => { assert.strictEqual(table, 'word_filter_hits'); inserted.push(...rows); return { error: null }; },
      }),
    });
    // A collection no trigger watches, so only this in-process call screens it.
    const ref = fsdb.collection('wf_test_inproc').doc(`wf-inproc-${RUN}`);
    await ref.set({ userId: 'U5', desc: 'xyzzy and plugh and n1gg3r' });
    await wf.screen(await ref.get(), 'post', ['desc']);
    const d = (await ref.get()).data();
    // Remote list only: n1gg3r is not in this fake list; plugh is offensive.
    assert.strictEqual(d.desc, '***** and ***** and n1gg3r');
    assert.strictEqual(inserted.length, 1);
    assert.strictEqual(inserted[0].uid, 'U5');
    assert.strictEqual(inserted[0].original, 'xyzzy and plugh and n1gg3r');
    assert.deepStrictEqual(inserted[0].terms.slice().sort(), ['plugh', 'xyzzy']);
    wf.setSupabase(undefined);
  });

  console.log(`${pass} passed`);
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
