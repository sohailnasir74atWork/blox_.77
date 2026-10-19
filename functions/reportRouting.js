/**
 * reportRouting — reports about staff go up the ladder (2026-10-19).
 *
 * Who may see and act on a report (owner decisions 2026-10-19; Admin counts
 * as owner level):
 *
 *   target (banEnforcement readRank)    readers                 where it lives
 *   player                              every staff member      user_reports / chat_reports
 *   JMD or Mod                          Senior Mods, Admins, owner   *_restricted, minRank 3
 *   Senior Mod, Admin or owner          Admins and owner        *_restricted, minRank 4
 *   … and never the target themselves.
 *
 * Why move instead of filter: old staff builds (4.0.22 production and older)
 * list user_reports / chat_reports with no filter, and Firestore denies a
 * whole list when any doc could be hidden (rules are not filters). So those
 * two collections keep their plain isStaff() reads, and a report about a
 * staff member is MOVED out of them, same doc id, in one batch (create +
 * delete), into user_reports_restricted / chat_reports_restricted with:
 *   targetUids  every uid the report may be about (below)
 *   minRank     3 (Senior Mod+) or 4 (Admin+)
 *   viewers     staff uids allowed to read it: staff/{uid} mirror rank
 *               (+ the verified owner accounts) ≥ minRank, minus targetUids.
 *               firestore.rules: read / dismiss = isStaff() && me() in
 *               viewers; delete = isAdmin() && me() in viewers. The reporter
 *               still reads their own report (reporterUid / reportedBy).
 *   movedFrom, movedAt
 *
 * WINDOW: a report about staff sits in user_reports / chat_reports from its
 * create until the trigger below moves it — normally a second or two. A
 * staff member who loads the queue in that instant can see it.
 *
 * Whose rank — never only what the client wrote:
 *   user_reports  the client's targetUid AND the owner (`userId`,
 *                 rules-protected) of the reported trade / post / status doc;
 *                 the highest rank decides. A reporter who names someone else
 *                 can only push their own report UP.
 *   chat_reports  the other participant of chatKey (rules require the
 *                 reporter to be one of the two) — not the client's
 *                 reportedUser. Same uid mirrorChatReport stores as
 *                 reported_uid, which supabase/046 routes the same way.
 *
 *   routeUserReport          onCreate user_reports/{id}
 *   routeChatReport          onCreate chat_reports/{id}
 *   reconcileReportRouting   every 6 h: moves any report about staff among
 *                            the newest 300 of each public collection (a
 *                            missed trigger, or a target promoted since), and
 *                            re-stamps viewers / minRank on the restricted
 *                            ones (staff added, removed, promoted, demoted).
 *   scripts/reports/backfill-restricted-reports.js moves the older ones once.
 *
 * Deploy order: firestore indexes → firestore.rules (the restricted blocks are
 * additive) → these functions (with mirrorRestrictedChatReport) → the backfill
 * → the app build. Until staff run that build, a moved report is visible only
 * in the new build (or the console), not in old builds' queues:
 *   firebase deploy --only functions:routeUserReport,functions:routeChatReport,functions:reconcileReportRouting,functions:mirrorChatReport,functions:mirrorRestrictedChatReport,functions:reconcileReportedChats --project fruiteblocks
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { RANK, UID_RE, OWNER_EMAILS, readRank } = require('./banEnforcement')._internal;
const { toRow: chatReportRow } = require('./mirrorChatReport')._internal;

const RESTRICTED = { user_reports: 'user_reports_restricted', chat_reports: 'chat_reports_restricted' };
const PUBLIC_SCAN = 300;
const RESTRICTED_SCAN = 1000;
const PARALLEL = 20;

// 0 = stays public; else the lowest rank that may read it.
const minRankFor = (targetRank) => {
  if (targetRank >= RANK.seniorMod) return RANK.admin;
  if (targetRank >= RANK.babyMod) return RANK.seniorMod;
  return 0;
};

// staff/{uid}.roles (functions/staffMirror.js) → rank, same ladder as RANK.
const rankFromRoles = (roles) => {
  const r = Array.isArray(roles) ? roles : [];
  if (r.includes('admin') || r.includes('isAdmin')) return RANK.admin;
  if (r.includes('isSeniorMod')) return RANK.seniorMod;
  if (r.includes('isModerator')) return RANK.moderator;
  if (r.includes('isBabyMod')) return RANK.babyMod;
  return RANK.user;
};

// Map uid → rank of everyone firestore.rules treats as staff: the staff/{uid}
// mirror, plus the verified owner accounts (isAdminEmail in the rules).
async function loadStaffRanks(firestore, auth) {
  const ranks = new Map();
  const snap = await firestore.collection('staff').get();
  snap.forEach((d) => {
    const rank = rankFromRoles(d.data()?.roles);
    if (rank >= RANK.babyMod) ranks.set(d.id, rank);
  });
  for (const email of OWNER_EMAILS) {
    try {
      const u = await auth.getUserByEmail(email);
      if (u?.emailVerified) ranks.set(u.uid, RANK.owner);
    } catch (e) {
      if (e?.code !== 'auth/user-not-found') throw e;
    }
  }
  return ranks;
}

const viewersFor = (staffRanks, minRank, targetUids) => {
  const out = [];
  staffRanks.forEach((rank, uid) => {
    if (rank >= minRank && !targetUids.includes(uid)) out.push(uid);
  });
  return out.sort();
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

// Every uid a user_reports doc may be about.
async function userReportTargets(firestore, data) {
  const out = new Set();
  if (typeof data?.targetUid === 'string' && data.targetUid) out.add(data.targetUid);
  if (data?.type === 'user' && typeof data.targetId === 'string' && UID_RE.test(data.targetId)) out.add(data.targetId);
  const owner = await contentOwner(firestore, data?.type, data?.targetId);
  if (owner) out.add(owner);
  return [...out];
}

function chatReportTargets(id, data) {
  const row = chatReportRow(id, data);
  return row?.reported_uid ? [row.reported_uid] : [];
}

const targetsOf = (firestore, collection, id, data) => (collection === 'user_reports'
  ? userReportTargets(firestore, data)
  : chatReportTargets(id, data));

async function topRank(uids, rankOf) {
  let top = RANK.user;
  for (const uid of uids) top = Math.max(top, await rankOf(uid));
  return top;
}

// Moves one public report when it is about staff. deps = { rankOf, staff }
// (staff: () => Promise<Map uid→rank>, called only when a move is needed).
// dryRun returns the plan without writing.
async function routeReport(firestore, collection, id, data, deps, { dryRun = false } = {}) {
  const targetUids = await targetsOf(firestore, collection, id, data);
  const minRank = minRankFor(await topRank(targetUids, deps.rankOf));
  if (!minRank) return { moved: false };
  const viewers = viewersFor(await deps.staff(), minRank, targetUids);
  const plan = { moved: true, collection, id, to: RESTRICTED[collection], minRank, targetUids, viewers };
  if (dryRun) return plan;
  const batch = firestore.batch();
  batch.set(firestore.collection(RESTRICTED[collection]).doc(id), {
    ...data, targetUids, minRank, viewers, movedFrom: collection, movedAt: new Date(),
  });
  batch.delete(firestore.collection(collection).doc(id));
  await batch.commit();
  return plan;
}

// Recomputes targetUids / minRank / viewers of a restricted report. A target
// demoted to player keeps the report restricted, readable by all staff but
// them (minRank 1).
async function restampRestricted(firestore, restrictedCol, doc, deps) {
  const data = doc.data() || {};
  const publicCol = restrictedCol === RESTRICTED.chat_reports ? 'chat_reports' : 'user_reports';
  const now = await targetsOf(firestore, publicCol, doc.id, data);
  const stored = Array.isArray(data.targetUids) ? data.targetUids : [];
  const targetUids = [...new Set([...stored, ...now])].sort();
  const minRank = Math.max(RANK.babyMod, minRankFor(await topRank(targetUids, deps.rankOf)));
  const viewers = viewersFor(await deps.staff(), minRank, targetUids);
  const same = data.minRank === minRank
    && JSON.stringify([...stored].sort()) === JSON.stringify(targetUids)
    && JSON.stringify(data.viewers || []) === JSON.stringify(viewers);
  if (same) return false;
  await doc.ref.update({ targetUids, minRank, viewers });
  return true;
}

async function inChunks(items, fn) {
  for (let i = 0; i < items.length; i += PARALLEL) {
    await Promise.all(items.slice(i, i + PARALLEL).map(fn));
  }
}

// Caches rank lookups and the staff list for one run.
function cachedDeps(rankOf, loadStaff) {
  const ranks = new Map();
  let staff = null;
  return {
    rankOf: (uid) => {
      if (!ranks.has(uid)) ranks.set(uid, rankOf(uid));
      return ranks.get(uid);
    },
    staff: () => {
      if (!staff) staff = loadStaff();
      return staff;
    },
  };
}

// `firestore`, `rankOf` and `loadStaff` are passed in so tests can use fakes.
async function reconcile(firestore, rankOf, loadStaff, { publicScan = PUBLIC_SCAN, restrictedScan = RESTRICTED_SCAN } = {}) {
  const deps = cachedDeps(rankOf, loadStaff);
  const result = { checked: 0, moved: 0, restamped: 0, failed: 0 };
  for (const collection of Object.keys(RESTRICTED)) {
    const snap = await firestore.collection(collection).orderBy('createdAt', 'desc').limit(publicScan).get();
    await inChunks(snap.docs || [], async (doc) => {
      result.checked++;
      try {
        if ((await routeReport(firestore, collection, doc.id, doc.data() || {}, deps)).moved) result.moved++;
      } catch (e) {
        result.failed++;
        console.error('[reconcileReportRouting]', collection, doc.id, e?.message || e);
      }
    });
    const restricted = RESTRICTED[collection];
    const rsnap = await firestore.collection(restricted).orderBy('createdAt', 'desc').limit(restrictedScan).get();
    await inChunks(rsnap.docs || [], async (doc) => {
      result.checked++;
      try {
        if (await restampRestricted(firestore, restricted, doc, deps)) result.restamped++;
      } catch (e) {
        result.failed++;
        console.error('[reconcileReportRouting]', restricted, doc.id, e?.message || e);
      }
    });
  }
  return result;
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

const liveDeps = () => cachedDeps(rankOfUid, () => loadStaffRanks(admin.firestore(), admin.auth()));

// A failure leaves the report where it is; the 6-hourly reconcile retries.
const routeTrigger = (collection) => functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .firestore.document(`${collection}/{id}`)
  .onCreate(async (snap) => {
    try {
      await routeReport(admin.firestore(), collection, snap.id, snap.data() || {}, liveDeps());
    } catch (e) {
      console.error('[routeReport]', collection, snap.id, e?.message || e);
    }
    return null;
  });

const routeUserReport = routeTrigger('user_reports');
const routeChatReport = routeTrigger('chat_reports');

const reconcileReportRouting = functions
  .runWith({ memory: '256MB', timeoutSeconds: 300 })
  .pubsub.schedule('every 6 hours')
  .onRun(async () => {
    const r = await reconcile(admin.firestore(), rankOfUid, () => loadStaffRanks(admin.firestore(), admin.auth()));
    console.log(`[reconcileReportRouting] ${r.checked} checked, ${r.moved} moved, ${r.restamped} re-stamped, ${r.failed} failed`);
    return null;
  });

module.exports = {
  routeUserReport,
  routeChatReport,
  reconcileReportRouting,
  _internal: {
    RESTRICTED,
    minRankFor,
    rankFromRoles,
    loadStaffRanks,
    viewersFor,
    userReportTargets,
    chatReportTargets,
    routeReport,
    restampRestricted,
    cachedDeps,
    reconcile,
    rankOfUid,
  },
};
