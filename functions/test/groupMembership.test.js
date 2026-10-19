/**
 * functions/groupMembership.js against the Firestore emulator, with an
 * in-memory Supabase (group_members, group_meta_data, purge_group_chat).
 * The trigger is called in-process with the before/after the write produced.
 * From the Blox_Fruit directory:
 *   firebase emulators:exec --config functions/firebase.test.json --only firestore \
 *     --project demo-fruiteblocks 'node functions/test/groupMembership.test.js'
 */
const assert = require('assert');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-fruiteblocks';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT, databaseURL: `http://127.0.0.1:9000?ns=${PROJECT}` });

const admin = require('firebase-admin');
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const { FieldValue } = require('firebase-admin/firestore');
const GM = require('../groupMembership')._internal;
const { RANK } = require('../banEnforcement')._internal;

const RUN = Date.now().toString(36);
const uid = (s) => `${s}${RUN}`.padEnd(12, '0');
const C = uid('creator'), U1 = uid('memberone'), U2 = uid('membertwo'), U3 = uid('memberthree');
const X = uid('outsider'), Y = uid('otherguy'), R = uid('requester'), S = uid('senior'), H = uid('hoarder');
const RANKS = { [S]: RANK.seniorMod };

function fakeSupabase() {
  const tables = { group_members: [], group_meta_data: [] };
  const purged = [];
  const from = (table) => {
    let op = 'select'; let payload = null; const filters = [];
    const match = (r) => filters.every(([k, c, v]) => (k === 'eq' ? r[c] === v : k === 'neq' ? r[c] !== v : v.includes(r[c])));
    const exec = () => {
      const rows = tables[table];
      if (op === 'select') return { data: rows.filter(match).map((r) => ({ ...r })), error: null };
      if (op === 'delete') { tables[table] = rows.filter((r) => !match(r)); return { error: null }; }
      if (op === 'update') { rows.filter(match).forEach((r) => Object.assign(r, payload)); return { error: null }; }
      for (const p of [].concat(payload)) {
        const i = rows.findIndex((r) => r.group_id === p.group_id && r.user_id === p.user_id);
        if (i >= 0) Object.assign(rows[i], p); else rows.push({ ...p });
      }
      return { error: null };
    };
    const b = {
      select() { op = 'select'; return b; },
      delete() { op = 'delete'; return b; },
      update(p) { op = 'update'; payload = p; return b; },
      upsert(p) { op = 'upsert'; payload = p; return Promise.resolve(exec()); },
      eq(c, v) { filters.push(['eq', c, v]); return b; },
      neq(c, v) { filters.push(['neq', c, v]); return b; },
      in(c, v) { filters.push(['in', c, v]); return b; },
      then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
    };
    return b;
  };
  const lastAt = new Map();  // group → newest message iso (group_last_activity)
  const rpc = async (fn, args) => {
    if (fn === 'group_last_activity') {
      return { data: args.p_group_ids.map((g) => ({ group_id: g, last_at: lastAt.get(g) || null })), error: null };
    }
    assert.strictEqual(fn, 'purge_group_chat');
    purged.push(args.p_group_id);
    for (const t of ['group_members', 'group_meta_data']) tables[t] = tables[t].filter((r) => r.group_id !== args.p_group_id);
    return { data: { messages: 0 }, error: null };
  };
  return { tables, purged, lastAt, from, rpc };
}

const sb = fakeSupabase();
const deps = { db, sb, rankOf: async (u) => RANKS[u] ?? RANK.user, now: () => Date.now() };
const gref = (g) => db.collection('groups').doc(g);
const rowsOf = (g) => sb.tables.group_members.filter((r) => r.group_id === g);
const roleOf = (g, u) => rowsOf(g).find((r) => r.user_id === u)?.role;
const data = async (g) => ((await gref(g).get()).data() || null);

// Write like a client would, then run the trigger with the write's before/after.
async function write(g, fn) {
  const before = await data(g);
  await fn(gref(g));
  const after = await data(g);
  return GM.handleGroupWrite({ groupId: g, before, after }, deps);
}
const create = (g, owner, name = 'Blox Trade Hub') => write(g, (ref) => ref.set({
  id: g, name, groupName: name, createdBy: owner, memberIds: [owner], memberCount: 1,
  members: { [owner]: { id: owner, displayName: owner } }, isActive: true, createdAt: FieldValue.serverTimestamp(),
}));
// acceptGroupInvite / approveJoinRequest shape: add one member.
const join = (g, who, extra = {}) => write(g, async (ref) => {
  const d = await data(g);
  await ref.update({ memberIds: [...d.memberIds, who], [`members.${who}`]: { id: who, role: 'member' }, memberCount: d.memberIds.length + 1, ...extra });
});
const leave = (g, who, extra = {}) => write(g, async (ref) => {
  const d = await data(g);
  const ids = d.memberIds.filter((x) => x !== who);
  await ref.update({ memberIds: ids, [`members.${who}`]: FieldValue.delete(), memberCount: ids.length, ...extra });
});
const invite = (g, from, to, extra = {}) => db.collection('group_invitations').add({
  groupId: g, invitedBy: from, invitedUserId: to, status: 'accepted', expiresAt: Date.now() + 86400000, ...extra,
});

(async () => {
  // ── create + creator row + search keys ──
  const G1 = `g1_${RUN}`;
  await create(G1, C);
  assert.strictEqual(roleOf(G1, C), 'creator', 'creator row on create');
  assert.deepStrictEqual((await data(G1)).searchKeys.slice(0, 4), ['b', 'bl', 'blo', 'blox'], 'searchKeys written');

  // ── invite accepted → verified ──
  await invite(G1, C, U1);
  const r1 = await join(G1, U1);
  assert.deepStrictEqual(r1.verified, [U1]);
  assert.strictEqual(roleOf(G1, U1), 'member', 'invited member gets a row');
  assert.ok((await data(G1)).memberIds.includes(U1), 'invited member stays');

  // ── unbacked self-joins are undone ──
  sb.tables.group_meta_data.push({ user_id: X, group_id: G1, last_message: 'x' });
  const r2 = await join(G1, X);
  assert.deepStrictEqual(r2.unverified, [X]);
  let d = await data(G1);
  assert.ok(!d.memberIds.includes(X) && !d.members[X] && d.memberCount === d.memberIds.length, 'self-join removed from memberIds/members');
  assert.strictEqual(roleOf(G1, X), undefined, 'no membership row');
  assert.ok(!sb.tables.group_meta_data.some((r) => r.user_id === X && r.group_id === G1), 'self-made inbox row removed');

  await invite(G1, X, X); // self-invite
  assert.deepStrictEqual((await join(G1, X)).unverified, [X], 'self-invite does not count');
  await invite(G1, Y, X); // invite from someone who is not in the group
  assert.deepStrictEqual((await join(G1, X)).unverified, [X], 'invite from a non-member does not count');
  await invite(G1, C, X, { expiresAt: Date.now() - 3600000 });
  assert.deepStrictEqual((await join(G1, X)).unverified, [X], 'expired invite does not count');
  await invite(G1, C, X, { status: 'declined' });
  assert.deepStrictEqual((await join(G1, X)).unverified, [X], 'declined invite does not count');
  await db.collection('group_join_requests').add({ groupId: G1, requesterId: X, creatorId: X, status: 'approved' });
  assert.deepStrictEqual((await join(G1, X)).unverified, [X], 'request "approved" with a forged creatorId does not count');

  // ── approved join request → verified ──
  await db.collection('group_join_requests').add({ groupId: G1, requesterId: R, creatorId: C, status: 'approved' });
  assert.deepStrictEqual((await join(G1, R)).verified, [R], 'approved join request counts');

  // ── kick: rows go, old invite can't be replayed ──
  sb.tables.group_meta_data.push({ user_id: U1, group_id: G1, last_message: 'hi' });
  await leave(G1, U1);
  assert.strictEqual(roleOf(G1, U1), undefined, 'removed member loses the row');
  assert.ok(!sb.tables.group_meta_data.some((r) => r.user_id === U1 && r.group_id === G1), 'removed member loses the inbox row');
  const inv = await db.collection('group_invitations').where('groupId', '==', G1).where('invitedUserId', '==', U1).get();
  assert.ok(inv.docs.every((x) => x.get('revokedAt')), 'their invitation is revoked');
  assert.deepStrictEqual((await join(G1, U1)).unverified, [U1], 'old invite can\'t be replayed after a kick');

  // ── forged inviter: a self-added account invites an alt before it is reverted ──
  const GF = `gf_${RUN}`, P = uid('altaccount');
  await create(GF, C);
  const fBefore = await data(GF);
  await gref(GF).update({ memberIds: [C, X], [`members.${X}`]: { id: X } }); // its trigger hasn't run yet
  await invite(GF, X, P);
  const rf = await join(GF, P);
  assert.deepStrictEqual(rf.unverified, [P], 'an invite from an unverified member does not count');
  assert.strictEqual(roleOf(GF, P), undefined, 'the alt gets no membership row');
  await GM.handleGroupWrite({ groupId: GF, before: fBefore, after: { ...fBefore, memberIds: [C, X] } }, deps);
  const sentByX = await db.collection('group_invitations').where('groupId', '==', GF).where('invitedBy', '==', X).get();
  assert.ok(sentByX.docs.length === 1 && sentByX.docs.every((x) => x.get('revokedAt')), 'invites the reverted account SENT are revoked');
  assert.ok(!(await data(GF)).memberIds.includes(X), 'the self-added account is reverted');

  // ── group cap ──
  const G2 = `g2_${RUN}`, G3 = `g3_${RUN}`;
  await create(G2, C);
  const r3 = await create(G3, C);
  assert.strictEqual(r3.action, 'over_cap_deleted', 'third group is deleted');
  assert.strictEqual(await data(G3), null);
  for (let i = 1; i <= 3; i++) assert.strictEqual((await create(`s${i}_${RUN}`, S)).action, 'ok', `Senior Mod group ${i}`);
  for (let i = 1; i <= 5; i++) await gref(`h${i}_${RUN}`).set({ createdBy: H, memberIds: [H], isActive: true });
  assert.strictEqual((await create(`h6_${RUN}`, H)).action, 'over_cap_deleted', 'owner above the cap keeps theirs, gets no new one');
  assert.strictEqual(await data(`h1_${RUN}`) !== null, true, 'existing groups of an owner above the cap are kept');

  // ── transfer to someone at the cap is undone ──
  const GT = `gt_${RUN}`;
  await create(GT, U3);
  await invite(GT, U3, C);
  await join(GT, C);
  const r4 = await write(GT, (ref) => ref.update({ createdBy: C })); // makeMemberCreator: C already owns 2
  d = await data(GT);
  assert.strictEqual(r4.owner, U3, 'makeMemberCreator to an owner at the cap goes back');
  assert.strictEqual(d.createdBy, U3);
  assert.strictEqual(d.ownerCap.blocked, C);
  // The trigger's own write: ownerCap changed in the same write → not checked again.
  const r5 = await GM.handleGroupWrite({ groupId: GT, before: { ...d, createdBy: C, ownerCap: null }, after: d }, deps);
  assert.strictEqual(r5.owner, U3, 'the re-pick write is not re-checked');
  assert.strictEqual(roleOf(GT, U3), 'creator');
  assert.strictEqual(roleOf(GT, C), 'member');

  // ── owner leaves, random pick is at the cap → first member under it ──
  const GL = `gl_${RUN}`;
  await create(GL, U2);
  await invite(GL, U2, C); await join(GL, C);
  await invite(GL, U2, R); await join(GL, R);
  const r6 = await leave(GL, U2, { createdBy: C, [`members.${C}.role`]: 'admin' });
  d = await data(GL);
  assert.strictEqual(r6.owner, R, 'ownership moves to a member under the cap');
  assert.strictEqual(d.createdBy, R);
  assert.strictEqual(d.members[R].role, 'admin');
  assert.strictEqual(d.members[C].role, 'member', 'the over-cap pick loses the admin role');
  assert.strictEqual(roleOf(GL, R), 'creator');

  // ── rename → search keys follow ──
  await write(G1, (ref) => ref.update({ name: 'Fruit Market', groupName: 'Fruit Market' }));
  assert.ok((await data(G1)).searchKeys.includes('market'), 'searchKeys follow a rename');

  // ── groupSync ──
  const GS = `gs_${RUN}`;
  await gref(GS).set({ createdBy: Y, memberIds: [Y, U3], name: 'Sync me' });
  await invite(GS, Y, U3);
  assert.strictEqual((await GM.syncGroup(GS, X, deps)).status, 403, 'outsider cannot sync');
  const s1 = await GM.syncGroup(GS, U3, deps);
  assert.ok(s1.status === 200 && s1.body.member === true, 'invited member syncs in');
  assert.strictEqual(roleOf(GS, Y), 'creator');
  await gref(GS).update({ memberIds: [Y, U3, X] });
  assert.strictEqual((await GM.syncGroup(GS, X, deps)).body.member, false, 'groupSync never adds an unbacked member');
  assert.strictEqual(roleOf(GS, X), undefined);
  assert.strictEqual((await GM.syncGroup(GS, S, deps)).status, 200, 'Senior Mod may sync any group');
  assert.strictEqual((await GM.syncGroup(`nope_${RUN}`, U3, deps)).status, 404);

  // ── delete → purge + sweep ──
  const before = await data(G1);
  await gref(G1).delete();
  const r7 = await GM.handleGroupWrite({ groupId: G1, before, after: null }, deps);
  assert.strictEqual(r7.action, 'purged');
  assert.ok(sb.purged.includes(G1), 'purge_group_chat called');
  assert.strictEqual((await db.collection('group_invitations').where('groupId', '==', G1).get()).size, 0, 'invitations swept');
  assert.strictEqual((await db.collection('group_join_requests').where('groupId', '==', G1).get()).size, 0, 'join requests swept');

  // ── creator name / avatar follow the owner (All groups tab) ──
  const GN = `gn_${RUN}`;
  await create(GN, U3);
  d = await data(GN);
  assert.strictEqual(d.creatorDisplayName, U3, 'creatorDisplayName from the creator entry');
  assert.strictEqual(d.creatorAvatar, null, 'creatorAvatar written (none yet)');
  await invite(GN, U3, U1);
  await join(GN, U1);
  await write(GN, (ref) => ref.update({ [`members.${U1}.displayName`]: 'One', [`members.${U1}.avatar`]: 'https://x/a.png' }));
  await write(GN, (ref) => ref.update({ createdBy: U1 }));
  d = await data(GN);
  assert.ok(d.createdBy === U1 && d.creatorDisplayName === 'One' && d.creatorAvatar === 'https://x/a.png', 'name + avatar follow a transfer');

  // ── a leftover role 'admin' is stripped from anyone who isn't the owner ──
  const GR = `gr_${RUN}`;
  await create(GR, U3);
  await gref(GR).update({ memberIds: [U3, R], [`members.${R}`]: { id: R, role: 'admin' } });
  await write(GR, (ref) => ref.update({ name: 'Renamed', groupName: 'Renamed' }));
  assert.strictEqual((await data(GR)).members[R].role, 'member', 'stray admin role removed');

  // ── cleanup: no message for 15 days → deleted (dry run first) ──
  const ago = (days) => admin.firestore.Timestamp.fromMillis(Date.now() - days * 864e5);
  const iso = (days) => new Date(Date.now() - days * 864e5).toISOString();
  const Q1 = `q_nomsg_old_${RUN}`, Q2 = `q_nomsg_new_${RUN}`, Q3 = `q_msg_old_${RUN}`, Q4 = `q_msg_new_${RUN}`;
  const base = (owner) => ({ createdBy: owner, memberIds: [owner], name: 'q', isActive: true });
  await gref(Q1).set({ ...base(Y), createdAt: ago(16) });                          // never a message, 16 days old
  await gref(Q2).set({ ...base(Y), createdAt: ago(3) });                           // new, no message yet
  await gref(Q3).set({ ...base(Y), createdAt: ago(100) }); sb.lastAt.set(Q3, iso(16)); // last message 16 days ago
  await gref(Q4).set({ ...base(Y), createdAt: ago(100) }); sb.lastAt.set(Q4, iso(14)); // last message 14 days ago
  const Q5 = `q_nocreated_${RUN}`;
  await gref(Q5).set({ ...base(Y) });                                                // no createdAt → skipped
  const plan = await GM.planGroupCleanup(deps);
  assert.ok(plan.delete.includes(Q1) && plan.delete.includes(Q3), 'quiet 15+ days → delete');
  assert.ok(!plan.delete.includes(Q2) && !plan.delete.includes(Q4), 'new or recently active → kept');
  assert.ok(!plan.delete.includes(Q5) && plan.noCreatedAt >= 1, 'no createdAt → skipped, not deleted');
  const dry = await GM.runGroupCleanup(deps); // no server_config doc → dry run
  assert.strictEqual(dry.mode, 'dry_run');
  assert.ok(dry.wouldDelete >= 2 && dry.deleted === undefined, 'dry run only counts');
  assert.ok((await data(Q1)) !== null, 'dry run deleted nothing');
  await db.collection('server_config').doc('groupCleanup').set({ apply: true });
  const run = await GM.runGroupCleanup(deps);
  assert.strictEqual(run.mode, 'apply');
  assert.strictEqual(await data(Q1), null, 'no message ever, 16 days old → deleted');
  assert.strictEqual(await data(Q3), null, 'last message 16 days ago → deleted');
  assert.ok((await data(Q2)) !== null && (await data(Q4)) !== null && (await data(Q5)) !== null, 'new, active and undated groups kept');
  assert.ok(sb.purged.includes(Q1) && sb.purged.includes(Q3), 'the job purges the chat itself, before deleting');
  const backupDoc = await db.collection('groups_deleted').doc(Q1).get();
  assert.ok(backupDoc.exists && backupDoc.get('group').name === 'q', 'backup kept in groups_deleted');
  for (const id of [Q1, Q3]) {
    // What the delete event does next (the safe server delete).
    await GM.handleGroupWrite({ groupId: id, before: { createdBy: Y }, after: null }, deps);
    assert.ok(sb.purged.includes(id), `${id} purged`);
  }
  await db.collection('server_config').doc('groupCleanup').delete();

  // ── unit bits ──
  assert.deepStrictEqual(GM.searchKeysFor('トレード 募集'), ['ト', 'トレ', 'トレー', 'トレード', '募', '募集']);
  assert.strictEqual(GM.capFor(RANK.seniorMod), 10);
  assert.strictEqual(GM.capFor(RANK.moderator), 2);
  assert.strictEqual(GM.capFor(RANK.owner), 10);

  console.log('groupMembership: all checks passed');
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e && e.stack || e);
  process.exit(1);
});
