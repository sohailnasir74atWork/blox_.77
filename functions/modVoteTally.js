/**
 * Moderator ratings: the server decides which votes count.
 *
 *   mod_votes_by_user/{voterUid}/{modUid}  1 | -1   written by the voter's phone
 *   mod_votes_counted/{modUid}/{voterUid}  1 | -1   server only: votes that count
 *   mod_votes_tally/{modUid}               { ups, downs }  server only, public read
 *
 * The old mod_votes_summary counter was computed on the phone, so anyone
 * signed in could set a mod's score to any number. It is left alone for old
 * builds (they still write and read it); current builds read mod_votes_tally.
 *
 * A vote counts only when the voter is not currently banned or muted
 * (banned_uids — bans and mutes both live there — or a legacy email record)
 * and the account is at least MIN_ACCOUNT_AGE_MS old. That stops a user a mod
 * just punished, or a fresh alt account, from dragging a mod's score down.
 *
 * countModVote runs on every vote write. rebuildModVoteTally recounts
 * everything once a day: it fills in votes cast before this existed, drops
 * votes while their voter is banned or muted, and restores them after.
 */
const admin = require('firebase-admin');
const { onValueWritten } = require('firebase-functions/v2/database');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { _internal: ban } = require('./banEnforcement');

if (!admin.apps.length) admin.initializeApp();

const REGION = 'us-central1';
const INSTANCE = 'fruiteblocks-default-rtdb';
const MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const db = () => admin.database();
const isVote = (v) => v === 1 || v === -1;
const accountOldEnough = (authUser, now) => {
  const created = Date.parse(authUser?.metadata?.creationTime || '');
  return Number.isFinite(created) && now - created >= MIN_ACCOUNT_AGE_MS;
};
const activeRecord = (rec, now) => !!rec && typeof rec === 'object' && ban.isActive(rec.bannedUntil, now);

// Banned or muted right now. Both kinds sit in banned_uids; the email record
// catches one the mirror missed.
async function isRestricted(uid, authUser, now) {
  const reads = [db().ref(`banned_uids/${uid}`).get()];
  const emailKey = authUser?.email ? ban.encodeEmailKey(authUser.email) : null;
  if (emailKey) reads.push(db().ref(`banned_users_by_email/${emailKey}`).get());
  const snaps = await Promise.all(reads);
  return snaps.some((s) => activeRecord(s.val(), now));
}

async function isEligible(voterUid, modUid, now) {
  if (voterUid === modUid) return false;
  const modSnap = await db().ref(`mods/${modUid}`).get();
  if (!modSnap.exists()) return false;
  let authUser;
  try {
    authUser = await admin.auth().getUser(voterUid);
  } catch (_) {
    return false; // deleted account
  }
  if (!accountOldEnough(authUser, now)) return false;
  return !(await isRestricted(voterUid, authUser, now));
}

const deltas = (prev, next) => ({
  ups: (next === 1 ? 1 : 0) - (prev === 1 ? 1 : 0),
  downs: (next === -1 ? 1 : 0) - (prev === -1 ? 1 : 0),
});

// Reads the voter's CURRENT vote rather than the event payload, so rapid
// toggles that trigger out of order still settle on the latest vote. The
// counted entry is swapped in a transaction and the tally moved by the
// difference, so two runs for the same vote never count it twice.
async function countVote(voterUid, modUid) {
  const now = Date.now();
  const latest = (await db().ref(`mod_votes_by_user/${voterUid}/${modUid}`).get()).val();
  const next = isVote(latest) && (await isEligible(voterUid, modUid, now)) ? latest : null;

  let prev = null;
  const res = await db().ref(`mod_votes_counted/${modUid}/${voterUid}`).transaction((cur) => {
    prev = isVote(cur) ? cur : null;
    return next;
  });
  if (!res.committed) return;

  const d = deltas(prev, next);
  if (d.ups || d.downs) {
    await db().ref(`mod_votes_tally/${modUid}`).update({
      ups: admin.database.ServerValue.increment(d.ups),
      downs: admin.database.ServerValue.increment(d.downs),
    });
  }
}

async function rebuildAll() {
  const now = Date.now();
  const [modsSnap, votesSnap, bannedUidsSnap, bannedEmailsSnap] = await Promise.all([
    db().ref('mods').get(),
    db().ref('mod_votes_by_user').get(),
    db().ref('banned_uids').get(),
    db().ref('banned_users_by_email').get(),
  ]);
  const mods = modsSnap.val() || {};
  const votes = votesSnap.val() || {};

  const restrictedUids = new Set();
  for (const [uid, rec] of Object.entries(bannedUidsSnap.val() || {})) {
    if (activeRecord(rec, now)) restrictedUids.add(uid);
  }
  const restrictedEmails = new Set();
  for (const [key, rec] of Object.entries(bannedEmailsSnap.val() || {})) {
    if (activeRecord(rec, now)) restrictedEmails.add(ban.canonicalBanKey(key));
  }

  // Voters who voted on at least one current mod.
  const voters = Object.keys(votes).filter((uid) =>
    Object.keys(votes[uid] || {}).some((m) => mods[m] && m !== uid));

  const eligible = new Set();
  for (let i = 0; i < voters.length; i += 100) {
    const batch = voters.slice(i, i + 100);
    const { users } = await admin.auth().getUsers(batch.map((uid) => ({ uid })));
    for (const u of users) {
      if (!accountOldEnough(u, now)) continue;
      if (restrictedUids.has(u.uid)) continue;
      if (u.email && restrictedEmails.has(ban.encodeEmailKey(u.email))) continue;
      eligible.add(u.uid);
    }
  }

  const counted = {};
  const tally = {};
  for (const voter of eligible) {
    for (const [modUid, v] of Object.entries(votes[voter] || {})) {
      if (!mods[modUid] || modUid === voter || !isVote(v)) continue;
      (counted[modUid] = counted[modUid] || {})[voter] = v;
      const t = (tally[modUid] = tally[modUid] || { ups: 0, downs: 0 });
      if (v === 1) t.ups += 1; else t.downs += 1;
    }
  }

  // One write, so the tally and the counted set never disagree.
  await db().ref().update({ mod_votes_counted: counted, mod_votes_tally: tally });
  console.log(`[modVoteTally] rebuilt: ${voters.length} voters, ${eligible.size} counted, ${Object.keys(tally).length} mods`);
}

exports.countModVote = onValueWritten(
  { ref: '/mod_votes_by_user/{voterUid}/{modUid}', instance: INSTANCE, region: REGION, memory: '256MiB', timeoutSeconds: 60 },
  (event) => countVote(event.params.voterUid, event.params.modUid),
);

exports.rebuildModVoteTally = onSchedule(
  { schedule: 'every day 04:30', timeZone: 'UTC', region: REGION, memory: '512MiB', timeoutSeconds: 540 },
  () => rebuildAll(),
);

exports._internal = { countVote, rebuildAll, isEligible, deltas, MIN_ACCOUNT_AGE_MS };
