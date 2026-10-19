/**
 * groupMembership — the server half of group privacy (supabase/044).
 *
 * Firestore groups/{groupId}.memberIds is written from the phone by every
 * build, and an invitee joins by adding THEMSELVES (acceptGroupInvite). The
 * rules can't tell a real join from a fake one: the invitation that backs it
 * has a random doc id the rules can't look up. So the server checks after the
 * fact, and Supabase only trusts what the server wrote (public.group_members):
 *
 * onGroupWrite — Firestore trigger on every groups/{groupId} write
 *   - Every uid ADDED in the write must be the creator, already verified, or
 *     hold a live invitation (group_invitations: invitedUserId, pending or
 *     accepted, not expired, sent by the creator or a member, not revoked) or
 *     an approved join request (creatorId = the group's creator, not revoked).
 *     Anyone else is taken out of memberIds again and gets no group_members row.
 *   - Verified adds → group_members (service role). People who left or were
 *     removed → their group_members row and inbox row are deleted, and their
 *     invitations / requests for the group are revoked, so an old invite can't
 *     be replayed after a kick.
 *   - Group cap (owner decision 2026-10-19): 2 owned groups, 10 for Senior Mod
 *     / Admin / owner. A group created past the cap is deleted again. A group
 *     handed to someone already at the cap goes back to the previous owner; if
 *     that owner left, to the first member under the cap (no one under it: it
 *     stays, logged). Existing owners above the cap keep what they have.
 *   - searchKeys (word prefixes of the name) for the All groups search.
 *   - Delete → purge_group_chat (every message soft-deleted, every member's
 *     inbox row and membership row removed) and the invitations / requests.
 *   - creatorDisplayName / creatorAvatar follow the owner (All groups tab).
 *
 * cleanupInactiveGroups — daily 03:30 UTC. A group with no message for 15
 *   days (counting from its creation when it never had one) is deleted
 *   through the delete path above: messages, every inbox row, membership,
 *   invitations, join requests. Up to 200 a run. DRY RUN (counts in the log
 *   only) until Firestore server_config/groupCleanup has apply: true.
 *
 * groupSync — HTTPS, Authorization: Bearer <Firebase ID token>, POST {groupId}
 *   New builds call it right after creating, accepting or approving, so the
 *   member can read and send at once instead of waiting for the trigger. Adds
 *   verified members only and drops rows of people no longer in memberIds; it
 *   never edits the Firestore doc. → 200 { ok, member } | 4xx { error }
 *
 * Deploy (after supabase/044 STEP 1; cleanupInactiveGroups after STEP 4):
 *   firebase deploy --only functions:onGroupWrite,functions:groupSync --project fruiteblocks
 *   firebase deploy --only functions:cleanupInactiveGroups --project fruiteblocks
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { FieldValue, FieldPath } = require('firebase-admin/firestore');
const { getSupabaseAdmin } = require('./_supabaseAdmin');
const { _internal: { readRank, RANK } } = require('./banEnforcement');
const { searchKeysFor } = require('./groupSearchKeys');

if (!admin.apps.length) {
  admin.initializeApp();
}

const SECRETS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

// Same numbers as Code/ChatScreen/utils/groupUtils.js (MAX_GROUPS_PER_USER /
// MAX_GROUPS_PER_STAFF); the server is the one that holds.
const MAX_GROUPS = 2;
const MAX_GROUPS_STAFF = 10;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // groupUtils.js createGroup
const CLOCK_GRACE_MS = 10 * 60 * 1000;         // phones' clocks drift
const OWNER_CANDIDATES = 10;                   // members checked when re-picking an owner
const GROUP_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const STALE_EVENT_MS = 3 * 60 * 60 * 1000;     // stop retrying after this
// Inactive-group cleanup (owner decision 2026-10-19: no message for 15 days → deleted).
const DAY_MS = 24 * 60 * 60 * 1000;
const DELETE_AFTER_QUIET_MS = 15 * DAY_MS;
const MAX_DELETE_PER_RUN = 200;
const ACTIVITY_CHUNK = 300;                    // group ids per group_last_activity call

const capFor = (rank) => (rank >= RANK.seniorMod ? MAX_GROUPS_STAFF : MAX_GROUPS);
const memberIdsOf = (d) => (Array.isArray(d?.memberIds)
  ? [...new Set(d.memberIds.filter((x) => typeof x === 'string' && x))]
  : []);
const millis = (t) => (typeof t?.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null));

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

const rankOfUid = async (uid) => readRank(uid, await admin.auth().getUser(uid).catch(() => null));

function defaultDeps() {
  return {
    db: admin.firestore(),
    sb: getSupabaseAdmin(),
    rtdb: () => admin.database(),
    rankOf: rankOfUid,
    now: () => Date.now(),
  };
}

// ── Firestore helpers ────────────────────────────────────────────────

// Active groups `uid` owns (old groups without isActive count as active, like
// the All groups tab).
async function ownedActiveCount(db, uid) {
  const snap = await db.collection('groups').where('createdBy', '==', uid).select('isActive').get();
  return snap.docs.filter((d) => d.get('isActive') !== false).length;
}

// What backs `uid` joining `groupId`: 'invite' | 'request' | null.
// `owner` = the group's creator, `members` = who could have sent an invite.
async function joinBacking(db, groupId, uid, { owner, members, now }) {
  const invites = await db.collection('group_invitations')
    .where('groupId', '==', groupId).where('invitedUserId', '==', uid).get();
  for (const doc of invites.docs) {
    const v = doc.data();
    if (v.status !== 'pending' && v.status !== 'accepted') continue;
    if (v.revokedAt) continue;
    if (typeof v.invitedBy !== 'string' || v.invitedBy === uid) continue;
    if (v.invitedBy !== owner && !members.has(v.invitedBy)) continue;
    const sent = millis(v.timestamp);
    const expires = typeof v.expiresAt === 'number' ? v.expiresAt : (sent ? sent + INVITE_TTL_MS : null);
    if (!expires || expires + CLOCK_GRACE_MS < now) continue;
    return 'invite';
  }
  const requests = await db.collection('group_join_requests')
    .where('groupId', '==', groupId).where('requesterId', '==', uid).get();
  for (const doc of requests.docs) {
    const v = doc.data();
    if (v.status !== 'approved' || v.revokedAt) continue;
    if (!owner || v.creatorId !== owner) continue;
    return 'request';
  }
  return null;
}

// Take `uids` out of the group again (they were never verified).
async function revertAdds(db, ref, uids) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data();
    const drop = new Set(uids.filter((u) => memberIdsOf(data).includes(u) && u !== data.createdBy));
    if (drop.size === 0) return data;
    const memberIds = memberIdsOf(data).filter((u) => !drop.has(u));
    const args = ['memberIds', memberIds, 'memberCount', memberIds.length];
    for (const u of drop) args.push(new FieldPath('members', u), FieldValue.delete());
    tx.update(ref, ...args);
    return { ...data, memberIds, memberCount: memberIds.length };
  });
}

// Invitations / join requests of people who are out of the group can't be
// used to come back in.
async function revokeJoinDocs(db, groupId, uids) {
  for (const uid of uids) {
    const [inv, req] = await Promise.all([
      db.collection('group_invitations').where('groupId', '==', groupId).where('invitedUserId', '==', uid).get(),
      db.collection('group_join_requests').where('groupId', '==', groupId).where('requesterId', '==', uid).get(),
    ]);
    const batch = db.batch();
    let n = 0;
    for (const d of [...inv.docs, ...req.docs]) {
      if (!d.get('revokedAt')) {
        batch.update(d.ref, { revokedAt: FieldValue.serverTimestamp() });
        n += 1;
      }
    }
    if (n) await batch.commit();
  }
}

async function sweepJoinDocs(db, groupId) {
  for (const col of ['group_invitations', 'group_join_requests']) {
    for (;;) {
      const snap = await db.collection(col).where('groupId', '==', groupId).limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      if (snap.size < 400) break;
    }
  }
}

// ── Supabase helpers ─────────────────────────────────────────────────

async function verifiedMembers(sb, groupId) {
  const { data, error } = await sb.from('group_members').select('user_id, role').eq('group_id', groupId);
  if (error) throw error;
  return new Map((data || []).map((r) => [r.user_id, r.role]));
}

async function addMembers(sb, groupId, uids, owner) {
  if (!uids.length) return;
  const rows = uids.map((u) => ({ group_id: groupId, user_id: u, role: u === owner ? 'creator' : 'member' }));
  const { error } = await sb.from('group_members').upsert(rows, { onConflict: 'group_id,user_id' });
  if (error) throw error;
}

// Membership rows and inbox rows of people no longer in the group.
async function dropMembers(sb, groupId, uids) {
  if (!uids.length) return;
  const r1 = await sb.from('group_members').delete().eq('group_id', groupId).in('user_id', uids);
  if (r1.error) throw r1.error;
  const r2 = await sb.from('group_meta_data').delete().eq('group_id', groupId).in('user_id', uids);
  if (r2.error) throw r2.error;
}

async function setOwnerRow(sb, groupId, owner) {
  const r1 = await sb.from('group_members').update({ role: 'member' })
    .eq('group_id', groupId).eq('role', 'creator').neq('user_id', owner);
  if (r1.error) throw r1.error;
  const r2 = await sb.from('group_members')
    .upsert({ group_id: groupId, user_id: owner, role: 'creator' }, { onConflict: 'group_id,user_id' });
  if (r2.error) throw r2.error;
}

// ── onGroupWrite ─────────────────────────────────────────────────────

async function onGroupDeleted(groupId, { db, sb, rtdb }) {
  const { data, error } = await sb.rpc('purge_group_chat', { p_group_id: groupId });
  if (error) throw error;
  await sweepJoinDocs(db, groupId);
  // Push collapse state (notifyGroupNewMessage).
  if (rtdb) await rtdb().ref(`group_push_state/${groupId}`).remove().catch(() => {});
  return { action: 'purged', ...(data || {}) };
}

// A transfer to someone already at the cap is undone. Returns the owner the
// group ends up with.
async function enforceTransferCap(ref, before, current, deps) {
  const { rankOf, db } = deps;
  const newOwner = current.createdBy;
  // Our own re-pick (it stamps ownerCap) is not checked again.
  if (JSON.stringify(before.ownerCap ?? null) !== JSON.stringify(current.ownerCap ?? null)) return newOwner;
  if (typeof newOwner !== 'string' || !newOwner) return newOwner;
  const [count, rank] = await Promise.all([ownedActiveCount(db, newOwner), rankOf(newOwner)]);
  if (count <= capFor(rank)) return newOwner;

  const members = memberIdsOf(current);
  const prev = before.createdBy;
  let target = null;
  if (typeof prev === 'string' && members.includes(prev)) {
    target = prev; // makeMemberCreator: the old owner is still here
  } else {
    // The owner left (leaveGroup picked someone at random): first member under the cap.
    for (const uid of members.filter((u) => u !== newOwner).slice(0, OWNER_CANDIDATES)) {
      const [c, r] = await Promise.all([ownedActiveCount(db, uid), rankOf(uid)]);
      if (c < capFor(r)) { target = uid; break; }
    }
  }
  if (!target) {
    console.warn(`[groupMembership] ${ref.id}: ${newOwner} is over the group cap, no member under it; ownership kept`);
    return newOwner;
  }
  const args = ['createdBy', target,
    'ownerCap', { blocked: newOwner, to: target, at: FieldValue.serverTimestamp() }];
  if (target !== prev) {
    // leaveGroup gave the random pick role 'admin' (groupAdmin() in the rules): move it.
    args.push(new FieldPath('members', newOwner, 'role'), 'member');
    args.push(new FieldPath('members', target, 'role'), 'admin');
  }
  await ref.update(...args);
  console.log(`[groupMembership] ${ref.id}: ${newOwner} is at the group cap; owner is ${target}`);
  return target;
}

async function handleGroupWrite({ groupId, before, after }, deps) {
  const { db, sb, rankOf, now } = deps;
  const ref = db.collection('groups').doc(groupId);
  if (!after) return onGroupDeleted(groupId, deps);
  const result = { action: 'ok' };

  // 1. Group cap on a new group.
  if (!before && typeof after.createdBy === 'string' && after.createdBy) {
    const [count, rank] = await Promise.all([ownedActiveCount(db, after.createdBy), rankOf(after.createdBy)]);
    if (count > capFor(rank)) {
      console.warn(`[groupMembership] ${groupId}: ${after.createdBy} owns ${count} > ${capFor(rank)} groups; deleting the new one`);
      await ref.delete(); // the delete event purges the rest
      return { action: 'over_cap_deleted', count };
    }
  }

  // 2. Membership changes.
  const beforeIds = new Set(memberIdsOf(before));
  const afterIds = memberIdsOf(after);
  const added = afterIds.filter((u) => !beforeIds.has(u));
  const removed = [...beforeIds].filter((u) => !afterIds.includes(u));
  const ownerChanged = !!before && before.createdBy !== after.createdBy;
  let current = after;

  if (added.length || removed.length) {
    const known = await verifiedMembers(sb, groupId);
    const owner = before ? before.createdBy : after.createdBy;
    const verified = [];
    const unverified = [];
    for (const uid of added) {
      if (uid === after.createdBy || known.has(uid)) { verified.push(uid); continue; }
      const why = await joinBacking(db, groupId, uid, { owner, members: beforeIds, now: now() });
      (why ? verified : unverified).push(uid);
    }
    if (unverified.length) {
      console.warn(`[groupMembership] ${groupId}: unbacked join by ${unverified.join(',')}; removed`);
      current = await revertAdds(db, ref, unverified);
      if (!current) return { action: 'gone' };
    } else {
      const snap = await ref.get(); // decide on the latest state, not the event's
      if (!snap.exists) return { action: 'gone' };
      current = snap.data();
    }
    const nowIds = new Set(memberIdsOf(current));
    await addMembers(sb, groupId, verified.filter((u) => nowIds.has(u)), current.createdBy);
    const out = [...removed, ...unverified].filter((u) => !nowIds.has(u));
    await dropMembers(sb, groupId, out);
    await revokeJoinDocs(db, groupId, removed.filter((u) => !nowIds.has(u)));
    Object.assign(result, { verified, unverified, removed });
  }

  // 3. Ownership transfer + cap.
  if (ownerChanged && current.createdBy !== before.createdBy) {
    const owner = await enforceTransferCap(ref, before, current, deps);
    await setOwnerRow(sb, groupId, owner);
    result.owner = owner;
  }

  // 4. Search keys, and the owner's name / avatar the All groups tab shows
  // (saves one RTDB read per creator per page). Skipped when step 3 just
  // re-picked the owner: that write comes back here with the final owner.
  const fix = {};
  const keys = searchKeysFor(current.name || current.groupName);
  if (!sameList(keys, current.searchKeys)) fix.searchKeys = keys;
  const ownerEntry = current.members?.[current.createdBy];
  if (ownerEntry && (result.owner === undefined || result.owner === current.createdBy)
      && (ownerChanged || current.creatorDisplayName === undefined || current.creatorAvatar === undefined)) {
    const name = typeof ownerEntry.displayName === 'string' && ownerEntry.displayName ? ownerEntry.displayName : null;
    const avatar = typeof ownerEntry.avatar === 'string' && ownerEntry.avatar ? ownerEntry.avatar : null;
    if (name && current.creatorDisplayName !== name) fix.creatorDisplayName = name;
    if (current.creatorAvatar !== avatar && (ownerChanged || current.creatorAvatar === undefined)) fix.creatorAvatar = avatar;
  }
  if (Object.keys(fix).length) {
    await ref.update(fix).catch((e) => {
      if (e?.code !== 5) throw e; // NOT_FOUND: deleted meanwhile
    });
  }

  return result;
}

// ── Inactive-group cleanup ───────────────────────────────────────────

// Newest message per group (supabase/044 group_last_activity).
async function lastMessageAt(sb, groupIds) {
  const out = new Map();
  for (let i = 0; i < groupIds.length; i += ACTIVITY_CHUNK) {
    const { data, error } = await sb.rpc('group_last_activity', { p_group_ids: groupIds.slice(i, i + ACTIVITY_CHUNK) });
    if (error) throw error;
    for (const r of data || []) {
      const t = r.last_at ? Date.parse(r.last_at) : NaN;
      if (Number.isFinite(t)) out.set(r.group_id, t);
    }
  }
  return out;
}

// Groups with no message for 15 days. Activity = the newest message
// (group_messages), or when the group was created if it never had one.
// Firestore's lastMessageTimestamp is never written, so it isn't used.
async function planGroupCleanup({ db, sb, now }) {
  const t = now();
  const snap = await db.collection('groups').select('createdAt').get();
  const last = await lastMessageAt(sb, snap.docs.map((d) => d.id));
  const plan = { groups: snap.size, withMessages: last.size, delete: [] };
  for (const d of snap.docs) {
    const activity = Math.max(last.get(d.id) || 0, millis(d.get('createdAt')) || 0);
    if (activity < t - DELETE_AFTER_QUIET_MS) plan.delete.push(d.id);
  }
  return plan;
}

// Dry run unless Firestore server_config/groupCleanup has apply: true (the
// owner sets it in the console after reading a dry run's counts).
async function runGroupCleanup(deps, opts = {}) {
  const { db } = deps;
  const apply = opts.apply ?? ((await db.collection('server_config').doc('groupCleanup').get()).get('apply') === true);
  const plan = await planGroupCleanup(deps);
  const report = {
    mode: apply ? 'apply' : 'dry_run',
    groups: plan.groups,
    groupsWithMessages: plan.withMessages,
    wouldDelete: plan.delete.length,
    perRun: MAX_DELETE_PER_RUN,
    sample: plan.delete.slice(0, 10),
  };
  if (!apply) return report;

  report.deleted = 0;
  for (const id of plan.delete.slice(0, MAX_DELETE_PER_RUN)) {
    // The onGroupWrite delete event purges messages, inbox rows, membership,
    // invitations and join requests (the safe server delete).
    await db.collection('groups').doc(id).delete();
    report.deleted += 1;
  }
  return report;
}

const cleanupInactiveGroups = functions
  .runWith({ secrets: SECRETS, memory: '256MB', timeoutSeconds: 540 })
  .pubsub.schedule('every day 03:30')
  .timeZone('UTC')
  .onRun(async () => {
    const report = await runGroupCleanup(defaultDeps());
    console.log('[cleanupInactiveGroups]', JSON.stringify(report));
    return null;
  });

const onGroupWrite = functions
  .runWith({ secrets: SECRETS, memory: '256MB', timeoutSeconds: 120, failurePolicy: true })
  .firestore.document('groups/{groupId}')
  .onWrite(async (change, context) => {
    const { groupId } = context.params;
    if (Date.now() - Date.parse(context.timestamp) > STALE_EVENT_MS) {
      console.error(`[groupMembership] ${groupId}: giving up on event ${context.eventId} (too old)`);
      return null;
    }
    try {
      const res = await handleGroupWrite({
        groupId,
        before: change.before.exists ? change.before.data() : null,
        after: change.after.exists ? change.after.data() : null,
      }, defaultDeps());
      if (res.action !== 'ok' || res.unverified?.length) console.log('[groupMembership]', groupId, JSON.stringify(res));
    } catch (e) {
      console.error('[groupMembership]', groupId, e?.message || e);
      throw e; // failurePolicy retries (every step is idempotent)
    }
    return null;
  });

// ── groupSync ────────────────────────────────────────────────────────

async function syncGroup(groupId, callerUid, deps) {
  const { db, sb, rankOf, now } = deps;
  const snap = await db.collection('groups').doc(groupId).get();
  if (!snap.exists) return { status: 404, body: { error: 'not_found' } };
  const data = snap.data();
  const memberIds = memberIdsOf(data);
  if (!memberIds.includes(callerUid) && data.createdBy !== callerUid
      && (await rankOf(callerUid)) < RANK.seniorMod) {
    return { status: 403, body: { error: 'not_member' } };
  }
  const known = await verifiedMembers(sb, groupId);
  const verified = [];
  for (const uid of memberIds) {
    if (known.has(uid)) continue;
    if (uid === data.createdBy
        || await joinBacking(db, groupId, uid, { owner: data.createdBy, members: new Set(known.keys()), now: now() })) {
      verified.push(uid);
    }
  }
  await addMembers(sb, groupId, verified, data.createdBy);
  await dropMembers(sb, groupId, [...known.keys()].filter((u) => !memberIds.includes(u)));
  if (typeof data.createdBy === 'string' && data.createdBy && known.get(data.createdBy) !== 'creator'
      && (known.has(data.createdBy) || verified.includes(data.createdBy))) {
    await setOwnerRow(sb, groupId, data.createdBy);
  }
  return { status: 200, body: { ok: true, member: known.has(callerUid) || verified.includes(callerUid) } };
}

async function handleGroupSyncRequest(req, res, makeDeps) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'unauthenticated' });
  let caller;
  try {
    caller = await admin.auth().verifyIdToken(m[1], true);
  } catch (_) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  const groupId = req.body?.groupId;
  if (typeof groupId !== 'string' || !GROUP_ID_RE.test(groupId)) return res.status(400).json({ error: 'bad_group' });
  const { status, body } = await syncGroup(groupId, caller.uid, makeDeps());
  return res.status(status).json(body);
}

const groupSync = functions
  .runWith({ secrets: SECRETS, memory: '256MB', timeoutSeconds: 60 })
  .https.onRequest(async (req, res) => {
    try {
      await handleGroupSyncRequest(req, res, defaultDeps);
    } catch (e) {
      console.error('[groupSync]', e?.message || e);
      if (!res.headersSent) res.status(500).json({ error: 'internal' });
    }
  });

module.exports = {
  onGroupWrite,
  groupSync,
  cleanupInactiveGroups,
  _internal: {
    planGroupCleanup,
    runGroupCleanup,
    DELETE_AFTER_QUIET_MS,
    MAX_GROUPS,
    MAX_GROUPS_STAFF,
    capFor,
    searchKeysFor,
    joinBacking,
    handleGroupWrite,
    syncGroup,
  },
};
