/**
 * functions/reportAudience.js (+ the mirrorChatReport audience guard), against
 * in-memory fakes (no emulator, no network). From the Blox_Fruit directory:
 *   node functions/test/reportAudience.test.js
 */
const assert = require('assert');
const { audienceForRank, userReportTargets, chatReportTargets, audienceFor, reconcile } = require('../reportAudience')._internal;
const { onlyAudienceChanged } = require('../mirrorChatReport')._internal;
const { RANK } = require('../banEnforcement')._internal;

const U = 'userUUUUUUUUUUUUUUUUUUUUUUU1';
const U2 = 'userUUUUUUUUUUUUUUUUUUUUUUU2';
const J = 'jmdJJJJJJJJJJJJJJJJJJJJJJJJ1';
const M = 'modMMMMMMMMMMMMMMMMMMMMMMMM1';
const S = 'seniorSSSSSSSSSSSSSSSSSSSSS1';
const A = 'adminAAAAAAAAAAAAAAAAAAAAAA1';
const O = 'ownerOOOOOOOOOOOOOOOOOOOOOO1';
const RANKS = { [J]: RANK.babyMod, [M]: RANK.moderator, [S]: RANK.seniorMod, [A]: RANK.admin, [O]: RANK.owner };
const rankOf = async (uid) => RANKS[uid] ?? RANK.user;
const key = (x, y) => [x, y].sort().join('_');

// Firestore: collection(c).doc(id).get(), collection(c).orderBy().limit().get(),
// doc.ref.update(). `colls` = { name: { id: data } }.
const fakeFirestore = (colls) => {
  const updates = [];
  const docOf = (c, id) => ({
    id,
    data: () => colls[c][id],
    ref: {
      update: async (patch) => {
        if (!colls[c][id]) { const e = new Error('No document to update'); e.code = 5; throw e; }
        updates.push([c, id, patch]);
        Object.assign(colls[c][id], patch);
      },
    },
  });
  return {
    updates,
    collection: (c) => ({
      doc: (id) => ({
        get: async () => {
          const d = (colls[c] || {})[id];
          return { exists: !!d, get: (f) => d?.[f] };
        },
      }),
      orderBy: () => ({
        limit: (n) => ({
          get: async () => ({
            docs: Object.entries(colls[c] || {})
              .sort((a, b) => b[1].createdAt - a[1].createdAt)
              .slice(0, n)
              .map(([id]) => docOf(c, id)),
          }),
        }),
      }),
    }),
  };
};

(async () => {
  // audienceForRank
  assert.strictEqual(audienceForRank(RANK.user), 'staff');
  assert.strictEqual(audienceForRank(RANK.babyMod), 'staff');
  assert.strictEqual(audienceForRank(RANK.moderator), 'staff');
  assert.strictEqual(audienceForRank(RANK.seniorMod), 'admin');
  assert.strictEqual(audienceForRank(RANK.admin), 'owner');
  assert.strictEqual(audienceForRank(RANK.owner), 'owner');

  const fs = fakeFirestore({
    trades_new_upgrade: { t1: { userId: S }, t2: { userId: U2 } },
    trades_new: { old1: { userId: A } },
    designPosts_upgrade: { p1: { userId: M } },
    statuses: { s1: { userId: S } },
  });

  // user_reports targets: client targetUid + the reported doc's owner.
  assert.deepStrictEqual(await userReportTargets(fs, { type: 'trade', targetId: 't1', targetUid: S }), [S]);
  assert.deepStrictEqual((await userReportTargets(fs, { type: 'trade', targetId: 't1', targetUid: U })).sort(), [S, U].sort(),
    'a lying targetUid does not hide the real owner');
  assert.deepStrictEqual(await userReportTargets(fs, { type: 'trade', targetId: 'old1', targetUid: null }), [A], 'legacy trades_new');
  assert.deepStrictEqual(await userReportTargets(fs, { type: 'trade', targetId: 'gone', targetUid: U2 }), [U2], 'deleted trade: client uid only');
  assert.deepStrictEqual(await userReportTargets(fs, { type: 'status', targetId: 's1', targetUid: null }), [S]);
  assert.deepStrictEqual(await userReportTargets(fs, { type: 'post', targetId: 'p1', targetUid: M }), [M]);
  assert.deepStrictEqual(await userReportTargets(fs, { type: 'scam', targetId: 'robloxName_1', targetUid: null }), []);
  assert.deepStrictEqual(await userReportTargets(fs, { type: 'user', targetId: S }), [S], "type 'user': targetId is the uid");
  assert.deepStrictEqual(await userReportTargets(fs, { type: 'trade', targetId: 'a/b', targetUid: null }), [], 'path-like id never read');

  // chat_reports target: the other side of chatKey, never reportedUser.
  assert.deepStrictEqual(chatReportTargets('c1', { chatKey: key(U, S), reportedBy: U, reportedUser: U2 }), [S]);
  assert.deepStrictEqual(chatReportTargets('c2', { chatKey: key(U, S), reportedBy: U2 }), [], 'reporter not in chat');
  assert.deepStrictEqual(chatReportTargets('c3', { chatKey: 'garbage', reportedBy: U }), []);

  // audienceFor: highest rank wins.
  assert.strictEqual(await audienceFor([], rankOf), 'staff');
  assert.strictEqual(await audienceFor([U, M], rankOf), 'staff');
  assert.strictEqual(await audienceFor([U, S], rankOf), 'admin');
  assert.strictEqual(await audienceFor([S, A], rankOf), 'owner');
  assert.strictEqual(await audienceFor([O], rankOf), 'owner');

  // reconcile: stamps missing, re-stamps a promotion, leaves correct docs alone.
  const colls = {
    trades_new_upgrade: { t1: { userId: S }, t2: { userId: U2 } },
    user_reports: {
      r1: { type: 'trade', targetId: 't1', targetUid: U, createdAt: 5 },                    // missing → admin (owner is S)
      r2: { type: 'trade', targetId: 't2', targetUid: U2, createdAt: 4, audience: 'staff' }, // correct
      r3: { type: 'scam', targetId: 'x', targetUid: null, createdAt: 3 },                    // missing → staff
      r4: { type: 'user', targetId: M, targetUid: M, createdAt: 2, audience: 'staff' },      // M promoted → admin
      r5: { type: 'user', targetId: A, targetUid: A, createdAt: 1, audience: 'owner' },      // beyond the limit
    },
    chat_reports: {
      c1: { chatKey: key(U, A), reportedBy: U, createdAt: 9 },                       // → owner
      c2: { chatKey: key(U, U2), reportedBy: U, createdAt: 8, audience: 'admin' },  // demoted target → staff
    },
  };
  const fs2 = fakeFirestore(colls);
  const promoted = async (uid) => (uid === M ? RANK.seniorMod : rankOf(uid));
  const r = await reconcile(fs2, promoted, { limit: 4 });
  assert.deepStrictEqual(r, { checked: 6, stamped: 5, failed: 0 }, JSON.stringify(r));
  assert.strictEqual(colls.user_reports.r1.audience, 'admin');
  assert.strictEqual(colls.user_reports.r3.audience, 'staff');
  assert.strictEqual(colls.user_reports.r4.audience, 'admin');
  assert.strictEqual(colls.chat_reports.c1.audience, 'owner');
  assert.strictEqual(colls.chat_reports.c2.audience, 'staff');
  assert.ok(!fs2.updates.some(([c, id]) => c === 'user_reports' && (id === 'r2' || id === 'r5')), 'correct / out-of-window docs untouched');
  const again = await reconcile(fs2, promoted, { limit: 4 });
  assert.strictEqual(again.stamped, 0, 'second run writes nothing');

  // A rank lookup that throws counts as failed and leaves the doc as it was.
  const fs3 = fakeFirestore({ user_reports: { x1: { type: 'user', targetId: S, createdAt: 1 } }, chat_reports: {} });
  const r3 = await reconcile(fs3, async () => { throw new Error('rtdb down'); });
  assert.deepStrictEqual(r3, { checked: 1, stamped: 0, failed: 1 });

  // mirrorChatReport skips the audience-only write.
  const base = { chatKey: key(U, S), reportedBy: U, status: 'pending' };
  assert.strictEqual(onlyAudienceChanged(base, { ...base, audience: 'admin' }), true);
  assert.strictEqual(onlyAudienceChanged({ ...base, audience: 'staff' }, { ...base, audience: 'admin' }), true);
  assert.strictEqual(onlyAudienceChanged(base, { ...base, status: 'reviewed' }), false);
  assert.strictEqual(onlyAudienceChanged(base, { ...base, audience: 'admin', status: 'reviewed' }), false);
  assert.strictEqual(onlyAudienceChanged(base, { ...base }), false, 'no change at all → mirror as before');

  console.log('reportAudience: all assertions passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
