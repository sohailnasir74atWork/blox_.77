/**
 * functions/reportRouting.js against in-memory fakes (no emulator, no
 * network). From the Blox_Fruit directory:
 *   node functions/test/reportRouting.test.js
 */
const assert = require('assert');
const {
  RESTRICTED, minRankFor, rankFromRoles, loadStaffRanks, viewersFor, userReportTargets,
  chatReportTargets, routeReport, cachedDeps, reconcile,
} = require('../reportRouting')._internal;
const { RANK, OWNER_EMAILS } = require('../banEnforcement')._internal;

const U = 'userUUUUUUUUUUUUUUUUUUUUUUU1';
const U2 = 'userUUUUUUUUUUUUUUUUUUUUUUU2';
const J = 'jmdJJJJJJJJJJJJJJJJJJJJJJJJ1';
const M = 'modMMMMMMMMMMMMMMMMMMMMMMMM1';
const M2 = 'modMMMMMMMMMMMMMMMMMMMMMMMM2';
const S = 'seniorSSSSSSSSSSSSSSSSSSSSS1';
const S2 = 'seniorSSSSSSSSSSSSSSSSSSSSS2';
const A = 'adminAAAAAAAAAAAAAAAAAAAAAA1';
const A2 = 'adminAAAAAAAAAAAAAAAAAAAAAA2';
const O = 'ownerOOOOOOOOOOOOOOOOOOOOOO1';
const RANKS = { [J]: RANK.babyMod, [M]: RANK.moderator, [M2]: RANK.moderator, [S]: RANK.seniorMod, [S2]: RANK.seniorMod,
  [A]: RANK.admin, [A2]: RANK.admin, [O]: RANK.owner };
const rankOf = async (uid) => RANKS[uid] ?? RANK.user;
const STAFF = new Map(Object.entries(RANKS));
const key = (x, y) => [x, y].sort().join('_');

// Firestore: collection(c).doc(id).get(), collection(c).get(),
// collection(c).orderBy().limit().get(), batch(), doc.ref.update().
// `colls` = { name: { id: data } } (mutated in place).
const fakeFirestore = (colls) => {
  const writes = [];
  const col = (c) => (colls[c] = colls[c] || {});
  const docOf = (c, id) => ({
    id,
    data: () => colls[c][id],
    ref: { update: async (patch) => { writes.push(['update', c, id]); Object.assign(colls[c][id], patch); } },
  });
  return {
    writes,
    collection: (c) => ({
      doc: (id) => ({
        _path: [c, id],
        get: async () => ({ exists: !!col(c)[id], get: (f) => col(c)[id]?.[f] }),
      }),
      get: async () => ({ forEach: (fn) => Object.keys(col(c)).forEach((id) => fn(docOf(c, id))) }),
      orderBy: () => ({
        limit: (n) => ({
          get: async () => ({
            docs: Object.entries(col(c)).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, n).map(([id]) => docOf(c, id)),
          }),
        }),
      }),
    }),
    batch: () => {
      const ops = [];
      return {
        set: (ref, data) => ops.push(() => { col(ref._path[0])[ref._path[1]] = { ...data }; writes.push(['set', ...ref._path]); }),
        delete: (ref) => ops.push(() => { delete col(ref._path[0])[ref._path[1]]; writes.push(['delete', ...ref._path]); }),
        commit: async () => ops.forEach((op) => op()),
      };
    },
  };
};
const deps = () => cachedDeps(rankOf, async () => STAFF);

(async () => {
  // Tiers.
  assert.strictEqual(minRankFor(RANK.user), 0, 'player: stays public');
  assert.strictEqual(minRankFor(RANK.babyMod), RANK.seniorMod, 'JMD → Senior Mod+');
  assert.strictEqual(minRankFor(RANK.moderator), RANK.seniorMod, 'Mod → Senior Mod+');
  assert.strictEqual(minRankFor(RANK.seniorMod), RANK.admin, 'Senior Mod → Admin+');
  assert.strictEqual(minRankFor(RANK.admin), RANK.admin, 'Admin → Admin+ (Admin is owner level)');
  assert.strictEqual(minRankFor(RANK.owner), RANK.admin);
  assert.strictEqual(rankFromRoles(['isAdmin']), RANK.admin);
  assert.strictEqual(rankFromRoles(['admin', 'isBabyMod']), RANK.admin);
  assert.strictEqual(rankFromRoles(['isSeniorMod']), RANK.seniorMod);
  assert.strictEqual(rankFromRoles(['isModerator', 'isBabyMod']), RANK.moderator);
  assert.strictEqual(rankFromRoles(['isBabyMod']), RANK.babyMod);
  assert.strictEqual(rankFromRoles(undefined), RANK.user);

  // Viewers: rank ≥ minRank, never a target.
  assert.deepStrictEqual(viewersFor(STAFF, RANK.seniorMod, [M]), [A, A2, O, S, S2].sort());
  assert.deepStrictEqual(viewersFor(STAFF, RANK.admin, [A]), [A2, O].sort(), 'an Admin never sees reports about themselves');
  assert.deepStrictEqual(viewersFor(STAFF, RANK.admin, [O]), [A, A2].sort(), 'reports about the owner: the Admins');
  assert.deepStrictEqual(viewersFor(STAFF, RANK.babyMod, [U]).length, STAFF.size);

  // Staff list = staff/{uid} mirror + verified owner accounts.
  const fsStaff = fakeFirestore({ staff: { [J]: { roles: ['isBabyMod'] }, [S]: { roles: ['isSeniorMod'] }, x: { roles: [] } } });
  const auth = {
    getUserByEmail: async (email) => {
      if (email === OWNER_EMAILS.values().next().value) return { uid: O, emailVerified: true };
      const e = new Error('nope'); e.code = 'auth/user-not-found'; throw e;
    },
  };
  const loaded = await loadStaffRanks(fsStaff, auth);
  assert.deepStrictEqual([...loaded.entries()].sort(), [[J, RANK.babyMod], [O, RANK.owner], [S, RANK.seniorMod]].sort());
  const unverified = await loadStaffRanks(fsStaff, { getUserByEmail: async () => ({ uid: 'evil', emailVerified: false }) });
  assert.ok(!unverified.has('evil'), 'unverified owner email is not staff');

  // Targets: client targetUid + the reported item's owner; chat: the other side of chatKey.
  const fsT = fakeFirestore({ trades_new_upgrade: { t1: { userId: S } }, statuses: { s1: { userId: M } } });
  assert.deepStrictEqual((await userReportTargets(fsT, { type: 'trade', targetId: 't1', targetUid: U })).sort(), [S, U].sort(),
    'a lying targetUid does not hide the real owner');
  assert.deepStrictEqual(await userReportTargets(fsT, { type: 'status', targetId: 's1', targetUid: null }), [M]);
  assert.deepStrictEqual(await userReportTargets(fsT, { type: 'scam', targetId: 'robloxName', targetUid: null }), []);
  assert.deepStrictEqual(await userReportTargets(fsT, { type: 'user', targetId: S2 }), [S2]);
  assert.deepStrictEqual(chatReportTargets('c1', { chatKey: key(U, M), reportedBy: U, reportedUser: U2 }), [M]);
  assert.deepStrictEqual(chatReportTargets('c2', { chatKey: key(U, M), reportedBy: U2 }), [], 'reporter not in the chat');

  // routeReport: player report stays; staff reports move with viewers, in one batch.
  const colls = {
    trades_new_upgrade: { t1: { userId: S } },
    user_reports: {
      rp: { type: 'user', targetId: U2, targetUid: U2, reporterUid: U, createdAt: 1 },
      rm: { type: 'user', targetId: M, targetUid: M, reporterUid: U, createdAt: 2 },
      rt: { type: 'trade', targetId: 't1', targetUid: U2, reporterUid: U, createdAt: 3 },
    },
    chat_reports: { ca: { chatKey: key(U, A), reportedBy: U, chatConsent: true, status: 'pending', createdAt: 4 } },
  };
  const fs = fakeFirestore(colls);
  assert.deepStrictEqual(await routeReport(fs, 'user_reports', 'rp', colls.user_reports.rp, deps()), { moved: false });
  assert.ok(colls.user_reports.rp, 'player report stays in user_reports');
  const dry = await routeReport(fs, 'user_reports', 'rm', colls.user_reports.rm, deps(), { dryRun: true });
  assert.strictEqual(dry.moved, true);
  assert.ok(colls.user_reports.rm && !colls.user_reports_restricted?.rm, 'dry run writes nothing');
  const rm = await routeReport(fs, 'user_reports', 'rm', colls.user_reports.rm, deps());
  assert.strictEqual(rm.to, RESTRICTED.user_reports);
  assert.ok(!colls.user_reports.rm, 'original deleted');
  const moved = colls.user_reports_restricted.rm;
  assert.strictEqual(moved.minRank, RANK.seniorMod);
  assert.deepStrictEqual(moved.targetUids, [M]);
  assert.deepStrictEqual(moved.viewers, [A, A2, O, S, S2].sort(), 'Mod report: Senior Mod+, not other Mods / JMDs');
  assert.strictEqual(moved.reporterUid, U, 'reporter kept (own-report reads)');
  assert.strictEqual(moved.movedFrom, 'user_reports');
  await routeReport(fs, 'user_reports', 'rt', colls.user_reports.rt, deps());
  assert.strictEqual(colls.user_reports_restricted.rt.minRank, RANK.admin, 'trade owned by a Senior Mod → Admin+ despite the client naming a player');
  assert.deepStrictEqual(colls.user_reports_restricted.rt.viewers, [A, A2, O].sort());
  await routeReport(fs, 'chat_reports', 'ca', colls.chat_reports.ca, deps());
  assert.deepStrictEqual(colls.chat_reports_restricted.ca.viewers, [A2, O].sort(), 'DM report about an Admin: other Admins + owner');
  assert.strictEqual(colls.chat_reports_restricted.ca.reportedBy, U);
  const setThenDelete = fs.writes.filter(([op, c, id]) => id === 'ca' && op !== 'update').map(([op, c]) => `${op}:${c}`);
  assert.deepStrictEqual(setThenDelete, ['set:chat_reports_restricted', 'delete:chat_reports'], 'create before delete, one batch');

  // reconcile: moves a missed / promoted report, re-stamps viewers after staff changes.
  const colls2 = {
    user_reports: {
      p1: { type: 'user', targetId: U2, targetUid: U2, createdAt: 3 },   // player: stays
      p2: { type: 'user', targetId: U, targetUid: U, createdAt: 2 },     // U promoted to Mod since → moves
    },
    chat_reports: {},
    user_reports_restricted: {
      r1: { type: 'user', targetId: S, targetUid: S, targetUids: [S], minRank: RANK.admin, viewers: [A, O], createdAt: 1 }, // A2 new
      r2: { type: 'user', targetId: M2, targetUid: M2, targetUids: [M2], minRank: RANK.seniorMod, viewers: [A, A2, O, S, S2], createdAt: 0 }, // M2 demoted
    },
    chat_reports_restricted: {
      c1: { chatKey: key(U2, A), reportedBy: U2, targetUids: [A], minRank: RANK.admin, viewers: [A2, O], createdAt: 5 }, // correct
    },
  };
  const fs2 = fakeFirestore(colls2);
  const promoted = async (uid) => (uid === U ? RANK.moderator : uid === M2 ? RANK.user : rankOf(uid));
  const r = await reconcile(fs2, promoted, async () => STAFF);
  // 2 public + 3 restricted (p2 is re-checked right after its move) + 1 chat.
  assert.deepStrictEqual(r, { checked: 6, moved: 1, restamped: 2, failed: 0 }, JSON.stringify(r));
  assert.ok(colls2.user_reports.p1 && !colls2.user_reports.p2 && colls2.user_reports_restricted.p2, 'promoted target: moved');
  assert.deepStrictEqual(colls2.user_reports_restricted.r1.viewers, [A, A2, O].sort(), 'new Admin added to viewers');
  assert.strictEqual(colls2.user_reports_restricted.r2.minRank, RANK.babyMod, 'demoted target: all staff but them');
  assert.ok(!colls2.user_reports_restricted.r2.viewers.includes(M2) && colls2.user_reports_restricted.r2.viewers.includes(J));
  assert.ok(!fs2.writes.some(([, c, id]) => c === 'chat_reports_restricted' && id === 'c1'), 'correct doc untouched');
  const again = await reconcile(fs2, promoted, async () => STAFF);
  assert.strictEqual(again.moved + again.restamped, 0, 'second run writes nothing');

  // A failing rank lookup counts as failed and moves nothing.
  const fs3 = fakeFirestore({ user_reports: { x: { type: 'user', targetId: S, targetUid: S, createdAt: 1 } } });
  const r3 = await reconcile(fs3, async () => { throw new Error('rtdb down'); }, async () => STAFF);
  assert.strictEqual(r3.failed, 1);
  assert.strictEqual(r3.moved, 0);

  console.log('reportRouting: all assertions passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
