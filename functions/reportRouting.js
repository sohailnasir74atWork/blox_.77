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
 * staff member is MOVED out of them, same doc id, in one transaction (read
 * the public doc fresh, create the restricted one only if it doesn't exist,
 * delete the public one), into user_reports_restricted /
 * chat_reports_restricted with:
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
 * Whose rank — never only what the client wrote (and only well-formed uids,
 * banEnforcement UID_RE; anything else could not be a staff account):
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
 *   routeTradeReport         onCreate RTDB tradeReports/{key}: old builds
 *                            (4.0.12–4.0.14, and newer ones when the
 *                            user_reports write fails) push trade reports
 *                            there; one about a staff member's trade is
 *                            copied into user_reports_restricted (type
 *                            'trade', doc id rtdb_<key>) and the RTDB node
 *                            removed. Admin SDK only: no RTDB rules change.
 *   reconcileReportRouting   every 6 h: moves any report about staff among
 *                            the newest 300 of each public collection and of
 *                            tradeReports (a missed trigger, or a target
 *                            promoted since), and
 *                            re-stamps viewers / minRank on the restricted
 *                            ones (staff added, removed, promoted, demoted).
 *
 * LEGACY (owner decision 2026-10-19): reports filed before routing went live
 * (ROUTING_SINCE, by Firestore's server-side createTime; RTDB: the trigger's
 * event time, else the node's timestamp) stay exactly where they are. There
 * is no backfill. A doc with a marker report_routing_legacy/{collection}_{id}
 * (server-only collection: no rules, so clients can't write it) is never
 * moved either — that is how a legacy report put back by hand stays put.
 *
 * Deploy order: firestore indexes → firestore.rules (the restricted blocks are
 * additive) → these functions (with mirrorRestrictedChatReport) → the app
 * build. Until staff run that build, a moved report is visible only in the
 * new build (or the console), not in old builds' queues:
 *   firebase deploy --only functions:routeUserReport,functions:routeChatReport,functions:routeTradeReport,functions:reconcileReportRouting,functions:mirrorChatReport,functions:mirrorRestrictedChatReport,functions:reconcileReportedChats --project fruiteblocks
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { RANK, UID_RE, OWNER_EMAILS, readRank } = require('./banEnforcement')._internal;
const { toRow: chatReportRow } = require('./mirrorChatReport')._internal;

const RESTRICTED = { user_reports: 'user_reports_restricted', chat_reports: 'chat_reports_restricted' };
// Routing went live 2026-10-19; anything created earlier is legacy and stays.
const ROUTING_SINCE_MS = Date.parse('2026-10-19T13:00:00Z');
const LEGACY_MARKERS = 'report_routing_legacy';

// Firestore Timestamp / Date / ms → ms (NaN when unknown).
const msOf = (v) => {
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return typeof v === 'number' ? v : NaN;
};

// Legacy = created before deps.since, or marked by hand. Only asked for a
// report about staff (one marker read), never for the player majority.
async function isLegacy(firestore, collection, id, createdMs, deps) {
  if (Number.isFinite(createdMs) && createdMs < deps.since) return true;
  return (await firestore.collection(LEGACY_MARKERS).doc(`${collection}_${id}`).get()).exists;
}
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
  if (r.includes('owner')) return RANK.owner;
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

const isUid = (v) => typeof v === 'string' && UID_RE.test(v);

// Every uid a user_reports doc may be about.
async function userReportTargets(firestore, data) {
  const out = new Set();
  if (isUid(data?.targetUid)) out.add(data.targetUid);
  if (data?.type === 'user' && isUid(data.targetId)) out.add(data.targetId);
  const owner = await contentOwner(firestore, data?.type, data?.targetId);
  if (isUid(owner)) out.add(owner);
  return [...out];
}

function chatReportTargets(id, data) {
  const row = chatReportRow(id, data);
  return isUid(row?.reported_uid) ? [row.reported_uid] : [];
}

// An RTDB tradeReports node as a user_reports-shaped doc (type 'trade').
// Old nodes carry { tradeId, reportedBy, reason, timestamp } and sometimes
// targetUid / status.
const tradeReportAsUserReport = (data) => ({
  type: 'trade',
  targetId: typeof data?.tradeId === 'string' ? data.tradeId : '',
  targetUid: isUid(data?.targetUid) ? data.targetUid : null,
  reporterUid: typeof data?.reportedBy === 'string' ? data.reportedBy : null,
  reason: String(data?.reason || 'Other').trim().slice(0, 200),
  text: '',
  createdAt: new Date(Number(data?.timestamp) || Date.now()),
  status: data?.status === 'reviewed' ? 'reviewed' : 'open',
});

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
// dryRun returns the plan without writing. The fields that decide the
// targets never change after create (rules: staff may only touch status /
// reviewedBy / reviewedAt), so the plan can come from `data`; the copy is
// made from the doc as it is inside the transaction. Idempotent: a repeated
// trigger or a reconcile racing it finds the public doc gone (or the
// restricted one there) and writes nothing, so a viewer's status change or
// delete is never undone.
// createdMs: the doc's server-side createTime (falls back to createdAt).
async function routeReport(firestore, collection, id, data, deps, { dryRun = false, createdMs = msOf(data?.createdAt) } = {}) {
  const targetUids = await targetsOf(firestore, collection, id, data);
  const minRank = minRankFor(await topRank(targetUids, deps.rankOf));
  if (!minRank) return { moved: false };
  if (await isLegacy(firestore, collection, id, createdMs, deps)) return { moved: false, reason: 'legacy' };
  const viewers = viewersFor(await deps.staff(), minRank, targetUids);
  const plan = { moved: true, collection, id, to: RESTRICTED[collection], minRank, targetUids, viewers };
  if (dryRun) return plan;
  const publicRef = firestore.collection(collection).doc(id);
  const restrictedRef = firestore.collection(RESTRICTED[collection]).doc(id);
  const moved = await firestore.runTransaction(async (tx) => {
    const [fresh, existing] = await Promise.all([tx.get(publicRef), tx.get(restrictedRef)]);
    if (!fresh.exists || existing.exists) return false;
    tx.create(restrictedRef, {
      ...fresh.data(), targetUids, minRank, viewers, movedFrom: collection, movedAt: new Date(),
    });
    tx.delete(publicRef);
    return true;
  });
  return moved ? plan : { moved: false, reason: 'already moved or gone' };
}

// Copies one RTDB tradeReports node into user_reports_restricted when the
// reported trade belongs to staff, then removes the node. The Firestore
// create is transactional (never overwrites an existing copy); the RTDB
// remove follows it, so a crash in between leaves both and the next run only
// removes the node.
async function routeTradeReport(firestore, rtdb, key, data, deps, { dryRun = false, createdMs = Number(data?.timestamp) } = {}) {
  const asReport = tradeReportAsUserReport(data);
  const targetUids = await userReportTargets(firestore, asReport);
  const minRank = minRankFor(await topRank(targetUids, deps.rankOf));
  if (!minRank) return { moved: false };
  if (await isLegacy(firestore, 'tradeReports', key, createdMs, deps)) return { moved: false, reason: 'legacy' };
  const viewers = viewersFor(await deps.staff(), minRank, targetUids);
  const id = `rtdb_${key}`;
  const plan = { moved: true, collection: 'tradeReports', id: key, to: RESTRICTED.user_reports, minRank, targetUids, viewers };
  if (dryRun) return plan;
  const nodeRef = rtdb.ref(`tradeReports/${key}`);
  const fresh = (await nodeRef.once('value')).val();
  if (!fresh) return { moved: false, reason: 'gone' };
  const restrictedRef = firestore.collection(RESTRICTED.user_reports).doc(id);
  await firestore.runTransaction(async (tx) => {
    if ((await tx.get(restrictedRef)).exists) return;
    tx.create(restrictedRef, {
      ...tradeReportAsUserReport(fresh), targetUids, minRank, viewers, movedFrom: 'tradeReports', movedAt: new Date(),
    });
  });
  await nodeRef.remove();
  return { ...plan, id };
}

// Recomputes targetUids / minRank / viewers of a restricted report. A target
// demoted to player keeps the report restricted, readable by all staff but
// them (minRank 1).
async function restampRestricted(firestore, restrictedCol, doc, deps) {
  const data = doc.data() || {};
  const publicCol = restrictedCol === RESTRICTED.chat_reports ? 'chat_reports' : 'user_reports';
  const now = await targetsOf(firestore, publicCol, doc.id, data);
  const stored = Array.isArray(data.targetUids) ? data.targetUids.filter(isUid) : [];
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
function cachedDeps(rankOf, loadStaff, since = ROUTING_SINCE_MS) {
  const ranks = new Map();
  let staff = null;
  return {
    since,
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

// `firestore`, `rtdb`, `rankOf` and `loadStaff` are passed in so tests can use fakes.
async function reconcile(firestore, rtdb, rankOf, loadStaff, { publicScan = PUBLIC_SCAN, restrictedScan = RESTRICTED_SCAN, since } = {}) {
  const deps = cachedDeps(rankOf, loadStaff, since);
  const result = { checked: 0, moved: 0, restamped: 0, failed: 0 };
  // Old builds' RTDB trade reports (push keys sort by time).
  const trades = [];
  (await rtdb.ref('tradeReports').orderByKey().limitToLast(publicScan).once('value'))
    .forEach((child) => { trades.push([child.key, child.val()]); return false; });
  await inChunks(trades, async ([key, val]) => {
    result.checked++;
    try {
      if ((await routeTradeReport(firestore, rtdb, key, val || {}, deps)).moved) result.moved++;
    } catch (e) {
      result.failed++;
      console.error('[reconcileReportRouting] tradeReports', key, e?.message || e);
    }
  });
  for (const collection of Object.keys(RESTRICTED)) {
    const snap = await firestore.collection(collection).orderBy('createdAt', 'desc').limit(publicScan).get();
    await inChunks(snap.docs || [], async (doc) => {
      result.checked++;
      try {
        const data = doc.data() || {};
        const createdMs = Number.isFinite(msOf(doc.createTime)) ? msOf(doc.createTime) : msOf(data.createdAt);
        if ((await routeReport(firestore, collection, doc.id, data, deps, { createdMs })).moved) result.moved++;
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
      // createTime is server-set; a client-written createdAt could be backdated.
      await routeReport(admin.firestore(), collection, snap.id, snap.data() || {}, liveDeps(), { createdMs: msOf(snap.createTime) });
    } catch (e) {
      console.error('[routeReport]', collection, snap.id, e?.message || e);
    }
    return null;
  });

const routeUserReport = routeTrigger('user_reports');
const routeChatReport = routeTrigger('chat_reports');

const routeTradeReportTrigger = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .database.ref('tradeReports/{key}')
  .onCreate(async (snap, context) => {
    try {
      await routeTradeReport(admin.firestore(), admin.database(), context.params.key, snap.val() || {}, liveDeps(),
        { createdMs: Date.parse(context.timestamp) });
    } catch (e) {
      console.error('[routeTradeReport]', context.params.key, e?.message || e);
    }
    return null;
  });

const reconcileReportRouting = functions
  .runWith({ memory: '256MB', timeoutSeconds: 300 })
  .pubsub.schedule('every 6 hours')
  .onRun(async () => {
    const r = await reconcile(admin.firestore(), admin.database(), rankOfUid, () => loadStaffRanks(admin.firestore(), admin.auth()));
    console.log(`[reconcileReportRouting] ${r.checked} checked, ${r.moved} moved, ${r.restamped} re-stamped, ${r.failed} failed`);
    return null;
  });

module.exports = {
  routeUserReport,
  routeChatReport,
  routeTradeReport: routeTradeReportTrigger,
  reconcileReportRouting,
  _internal: {
    RESTRICTED,
    ROUTING_SINCE_MS,
    LEGACY_MARKERS,
    minRankFor,
    rankFromRoles,
    loadStaffRanks,
    viewersFor,
    userReportTargets,
    chatReportTargets,
    routeReport,
    routeTradeReport,
    tradeReportAsUserReport,
    restampRestricted,
    cachedDeps,
    reconcile,
    rankOfUid,
  },
};
