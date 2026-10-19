/**
 * reportAudience — reports about senior staff go up the ladder (2026-10-19).
 *
 * A Senior Mod asked that Senior Mods can't be reported. The owner chose to
 * keep accepting those reports but show them only higher up. Each Firestore
 * report doc gets a server-stamped `audience`, and firestore.rules lets a
 * staff member read (and dismiss) a report only when its audience includes
 * them:
 *
 *   target rank (banEnforcement readRank)   audience   who sees it
 *   user / JMD / Mod                        'staff'    every staff member
 *   Senior Mod                              'admin'    Admins and the owner
 *   Admin / owner                           'owner'    the owner only
 *
 * A doc with no audience yet is readable by the owner and its reporter only
 * (fail-closed): a report in its first second, or one filed before this
 * shipped until the reconcile below reaches it. Clients can't write
 * `audience` (user_reports create is hasOnly; chat_reports create forbids it).
 *
 * Whose rank — never only what the client wrote:
 *   user_reports  the highest rank among the client's targetUid and the owner
 *                 (`userId`, rules-protected) of the reported trade / post /
 *                 status doc. A reporter who names someone else can only push
 *                 their own report UP, never pull a staff report down.
 *   chat_reports  the other participant of chatKey (rules require the
 *                 reporter to be one of the two) — not the client's
 *                 reportedUser. Same uid mirrorChatReport stores as
 *                 reported_uid, which supabase/046 routes the same way.
 *
 *   stampUserReportAudience  onCreate user_reports/{id}
 *   stampChatReportAudience  onCreate chat_reports/{id}
 *   reconcileReportAudience  every 6 h: the newest 300 docs of each; stamps
 *                            missing ones and re-stamps when a target was
 *                            promoted / demoted since. ReportsTab shows the
 *                            newest 50 / 30, so this covers what staff see.
 *
 * Deploy BEFORE the firestore.rules change (stamping is harmless under the
 * old rules), then run the reconcile once by hand so existing reports are
 * stamped before the rules start hiding unstamped ones:
 *   firebase deploy --only functions:stampUserReportAudience,functions:stampChatReportAudience,functions:reconcileReportAudience,functions:mirrorChatReport --project fruiteblocks
 *   gcloud scheduler jobs run firebase-schedule-reconcileReportAudience-us-central1 --location us-central1 --project fruiteblocks
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { RANK, UID_RE, readRank } = require('./banEnforcement')._internal;
const { toRow: chatReportRow } = require('./mirrorChatReport')._internal;

const RECONCILE_LIMIT = 300;
const PARALLEL = 20;

const audienceForRank = (rank) => {
  if (rank >= RANK.admin) return 'owner';
  if (rank >= RANK.seniorMod) return 'admin';
  return 'staff';
};

// Where a reported item lives and whose it is (`userId` in every collection;
// rules keep it pinned to the creator). Legacy collections second.
const CONTENT = {
  trade: ['trades_new_upgrade', 'trades_new'],
  post: ['designPosts_upgrade', 'designPosts'],
  status: ['statuses'],
};

async function contentOwner(firestore, type, targetId) {
  const cols = CONTENT[type];
  if (!cols || typeof targetId !== 'string' || !targetId || targetId.includes('/')) return null;
  for (const col of cols) {
    const snap = await firestore.collection(col).doc(targetId).get();
    if (snap.exists) {
      const uid = snap.get('userId');
      return typeof uid === 'string' && uid ? uid : null;
    }
  }
  return null;
}

// Every uid that may be the target of a user_reports doc.
async function userReportTargets(firestore, data) {
  const out = new Set();
  if (typeof data?.targetUid === 'string' && data.targetUid) out.add(data.targetUid);
  if (data?.type === 'user' && typeof data.targetId === 'string' && UID_RE.test(data.targetId)) out.add(data.targetId);
  try {
    const owner = await contentOwner(firestore, data?.type, data?.targetId);
    if (owner) out.add(owner);
  } catch (e) {
    console.warn('[reportAudience] content lookup failed:', e?.message || e);
  }
  return [...out];
}

function chatReportTargets(id, data) {
  const row = chatReportRow(id, data);
  return row?.reported_uid ? [row.reported_uid] : [];
}

// Highest-ranked target decides. No target → 'staff' (scam-database entries
// are Roblox names, not app accounts).
async function audienceFor(uids, rankOf) {
  let top = RANK.user;
  for (const uid of uids) top = Math.max(top, await rankOf(uid));
  return audienceForRank(top);
}

async function rankOfUid(uid) {
  let user = null;
  try {
    user = await admin.auth().getUser(uid);
  } catch (e) {
    if (e?.code !== 'auth/user-not-found' && e?.code !== 'auth/invalid-uid') throw e;
  }
  return readRank(uid, user); // verified owner email → owner; else RTDB role flags
}

async function stamp(ref, current, audience) {
  if (current === audience) return false;
  try {
    await ref.update({ audience });
    return true;
  } catch (e) {
    if (e?.code === 5 || /NOT_FOUND|No document to update/i.test(e?.message || '')) return false; // deleted meanwhile
    throw e;
  }
}

const stampUserReportAudience = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .firestore.document('user_reports/{id}')
  .onCreate(async (snap) => {
    const data = snap.data() || {};
    const audience = await audienceFor(await userReportTargets(admin.firestore(), data), rankOfUid);
    await stamp(snap.ref, data.audience, audience);
    return null;
  });

const stampChatReportAudience = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .firestore.document('chat_reports/{id}')
  .onCreate(async (snap, context) => {
    const data = snap.data() || {};
    const audience = await audienceFor(chatReportTargets(context.params.id, data), rankOfUid);
    await stamp(snap.ref, data.audience, audience);
    return null;
  });

// `firestore` and `rankOf` are passed in so the test can use fakes.
async function reconcile(firestore, rankOf, { limit = RECONCILE_LIMIT } = {}) {
  const ranks = new Map();
  const cachedRank = (uid) => {
    if (!ranks.has(uid)) ranks.set(uid, rankOf(uid));
    return ranks.get(uid);
  };
  const result = { checked: 0, stamped: 0, failed: 0 };
  const plans = [
    ['user_reports', (doc) => userReportTargets(firestore, doc.data())],
    ['chat_reports', (doc) => chatReportTargets(doc.id, doc.data())],
  ];
  for (const [col, targetsOf] of plans) {
    const snap = await firestore.collection(col).orderBy('createdAt', 'desc').limit(limit).get();
    const docs = snap.docs || [];
    for (let i = 0; i < docs.length; i += PARALLEL) {
      await Promise.all(docs.slice(i, i + PARALLEL).map(async (doc) => {
        result.checked++;
        try {
          const audience = await audienceFor(await targetsOf(doc), cachedRank);
          if (await stamp(doc.ref, doc.data()?.audience, audience)) result.stamped++;
        } catch (e) {
          result.failed++;
          console.error('[reconcileReportAudience]', col, doc.id, e?.message || e);
        }
      }));
    }
  }
  return result;
}

const reconcileReportAudience = functions
  .runWith({ memory: '256MB', timeoutSeconds: 300 })
  .pubsub.schedule('every 6 hours')
  .onRun(async () => {
    const r = await reconcile(admin.firestore(), rankOfUid);
    console.log(`[reconcileReportAudience] ${r.checked} checked, ${r.stamped} stamped, ${r.failed} failed`);
    return null;
  });

module.exports = {
  stampUserReportAudience,
  stampChatReportAudience,
  reconcileReportAudience,
  _internal: { audienceForRank, userReportTargets, chatReportTargets, audienceFor, reconcile },
};
