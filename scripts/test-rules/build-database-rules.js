#!/usr/bin/env node
/**
 * Builds the security-relevant parts of database.rules.json (RTDB).
 *
 * RTDB rules have no functions, so the rank / hierarchy expressions below
 * would otherwise be pasted by hand dozens of times. This script reads the
 * current database.rules.json, replaces the nodes listed in OVERRIDES and
 * writes it back. Nodes not listed here are left exactly as they are.
 * Re-running it is idempotent.
 *
 *   node scripts/test-rules/build-database-rules.js        (from the repo root)
 *
 * Edit the expressions HERE, not in the JSON, or the next run overwrites them.
 * See INVENTORY.md for who reads/writes each node and why each rule is shaped
 * the way it is.
 */
const fs = require('fs');
const path = require('path');

const RULES_PATH = path.join(__dirname, '..', '..', 'database.rules.json');

// Same list as functions/banEnforcement.js OWNER_EMAILS.
const OWNER_EMAILS = ['thesolanalabs@gmail.com', 'sohailnasir74business@gmail.com', 'sohailnasir74@gmail.com'];

const or = (...xs) => `(${xs.join(' || ')})`;
const and = (...xs) => `(${xs.join(' && ')})`;
const not = (x) => `!${x}`;

const owner = and('auth.token.email_verified === true', or(...OWNER_EMAILS.map((e) => `auth.token.email === '${e}'`)));
const U = (uidExpr) => `root.child('users').child(${uidExpr})`;
const flag = (uidExpr, f) => `${U(uidExpr)}.child('${f}').val() === true`;

// Rank sets for an arbitrary uid expression (string-valued).
const adminU = (x) => or(flag(x, 'admin'), flag(x, 'isAdmin'));
const seniorPlusU = (x) => or(flag(x, 'admin'), flag(x, 'isAdmin'), flag(x, 'isSeniorMod'));
const modPlusU = (x) => or(flag(x, 'admin'), flag(x, 'isAdmin'), flag(x, 'isSeniorMod'), flag(x, 'isModerator'));
const jmdPlusU = (x) => or(flag(x, 'admin'), flag(x, 'isAdmin'), flag(x, 'isSeniorMod'), flag(x, 'isModerator'), flag(x, 'isBabyMod'));

// Rank of the writer (owner email counts as admin, like the server's readRank).
const ME = 'auth.uid';
const wAdmin = and('auth != null', or(owner, adminU(ME)));
const wSenior = and('auth != null', or(owner, seniorPlusU(ME)));
const wMod = and('auth != null', or(owner, modPlusU(ME)));
const wJMD = and('auth != null', or(owner, jmdPlusU(ME)));
const isGranter = `root.child('jmd_granters').child(auth.uid).val() === true`;
// Read access the dashboards already had (staff + JMD granters + owners).
const staffRead = and('auth != null', or(owner, jmdPlusU(ME), `root.child('jmd_granters').child(auth.uid).exists()`));

const UID_RE = '/^[A-Za-z0-9]{10,128}$/';
const validUid = (snap) => and(`${snap}.isString()`, `${snap}.val().matches(${UID_RE})`);

// Writer may sanction target uid (snapshot expression): strictly outranks,
// staff immunity (staff targets need admin/owner), never self.
const canSanction = (snap) => and(
  validUid(snap),
  `${snap}.val() !== auth.uid`,
  or(
    and(wAdmin, not(adminU(`${snap}.val()`))),
    and(wJMD, not(jmdPlusU(`${snap}.val()`))),
  ),
);

// Writer rank >= rank of the uid in a snapshot (the original banner).
const meAtLeast = (b) => or(
  wAdmin,
  and(wSenior, not(adminU(b))),
  and(wMod, not(seniorPlusU(b))),
  and(wJMD, not(modPlusU(b))),
);
// "May lift / soften the existing record": admin, or rank >= original banner.
// bannedBy is either { uid, ... } (strikes/bans) or a bare uid string (mutes).
// Anything else (legacy display names, missing) counts as rank "user".
const bannerOK = or(
  wAdmin,
  and(validUid(`data.child('bannedBy').child('uid')`), meAtLeast(`data.child('bannedBy').child('uid').val()`)),
  and(validUid(`data.child('bannedBy')`), meAtLeast(`data.child('bannedBy').val()`)),
  and(not(validUid(`data.child('bannedBy').child('uid')`)), not(validUid(`data.child('bannedBy')`))),
);

const bannedByIsMe = or(
  `newData.child('bannedBy').child('uid').val() === auth.uid`,
  `newData.child('bannedBy').val() === auth.uid`,
);

const dataActive = or(
  `data.child('bannedUntil').val() === 'permanent'`,
  and(`data.child('bannedUntil').isNumber()`, `data.child('bannedUntil').val() > now`),
);
// The new record is at least as strict as the existing one (escalation or
// a pure metadata update such as mirrorBanToDevice's deviceId tag).
const newAtLeastAsStrict = or(
  `newData.child('bannedUntil').val() === 'permanent'`,
  and(
    `data.child('bannedUntil').val() !== 'permanent'`,
    `newData.child('bannedUntil').isNumber()`,
    or(not(`data.child('bannedUntil').isNumber()`), `newData.child('bannedUntil').val() >= data.child('bannedUntil').val()`),
  ),
);

// 2 h + 5 min slack for device clocks running ahead of the server.
const MUTE_MAX_MS = 2 * 60 * 60 * 1000 + 5 * 60 * 1000;
// A JMD write: a mute of at most 2 h that does not add a strike. Old builds
// write custom reasons for mutes, so the reason text is not required.
const newIsMuteShaped = and(
  `newData.child('bannedUntil').isNumber()`,
  `newData.child('bannedUntil').val() <= now + ${MUTE_MAX_MS}`,
  or(not(`newData.child('type').exists()`), `newData.child('type').val() === 'mute'`),
  or(
    not(`newData.child('strikeCount').exists()`),
    `newData.child('strikeCount').val() === 0`,
    and(`data.child('strikeCount').isNumber()`, `newData.child('strikeCount').val() <= data.child('strikeCount').val()`),
  ),
);
const dataIsMute = or(
  `data.child('type').val() === 'mute'`,
  and(`data.child('reason').isString()`, `data.child('reason').val().toLowerCase().beginsWith('muted for')`),
  and(
    `data.child('bannedUntil').isNumber()`, `data.child('bannedAt').isNumber()`,
    `data.child('bannedUntil').val() - data.child('bannedAt').val() <= ${MUTE_MAX_MS}`,
  ),
);

// Existing record (if any) must be one the writer could have sanctioned, and
// overwriting an active stricter record needs the "lift" permission.
const replaceOK = (allowJmd) => and(
  or(not(validUid(`data.child('userId')`)), canSanction(`data.child('userId')`)),
  or(
    not('data.exists()'),
    not(dataActive),
    newAtLeastAsStrict,
    and(bannerOK, allowJmd ? or(wMod, dataIsMute) : wMod),
  ),
);

const notOwnEmailKey = or(
  'auth.token.email == null',
  and(
    `$emailKey !== auth.token.email.toLowerCase().replace('.', '(dot)')`,
    `$emailKey !== auth.token.email.replace('.', '(dot)')`,
  ),
);
const ownEmailKey = and(
  'auth != null', 'auth.token.email != null',
  or(
    `$emailKey === auth.token.email.replace('.', '(dot)')`,
    `$emailKey === auth.token.email.toLowerCase().replace('.', '(dot)')`,
  ),
);
const notSelfUserId = and(`data.child('userId').val() !== auth.uid`, `newData.child('userId').val() !== auth.uid`);

// banned_users_by_email/{key}
const emailBanWrite = and(
  'auth != null', notOwnEmailKey, notSelfUserId,
  or(
    // create / update
    and(
      'newData.exists()',
      or(
        // Current shape: bannedBy names the writer.
        and(
          bannedByIsMe,
          or(
            // Admin/owner may omit userId (email-only legacy accounts).
            and(wAdmin, not(`newData.child('userId').exists()`)),
            and(canSanction(`newData.child('userId')`), or(wMod, newIsMuteShaped)),
          ),
        ),
        // Shape written by builds from 2025 (no bannedBy, no userId at all).
        // Mod+ only; hierarchy cannot be checked here, see INVENTORY.md.
        and(wMod, not(`newData.child('bannedBy').exists()`), not(`newData.child('userId').exists()`), not(`data.child('userId').exists()`)),
      ),
      replaceOK(true),
    ),
    // delete (unban / unmute)
    and(
      not('newData.exists()'),
      or(canSanction(`data.child('userId')`), and(not(validUid(`data.child('userId')`)), wMod)),
      bannerOK,
      or(wMod, dataIsMute),
    ),
  ),
);

// banned_devices/{deviceId} — only strikes/bans are mirrored here (mod+).
// Records with a `banners` set are server-managed (functions/banEnforcement.js
// keeps one entry per banning uid and lifts the device only when it's empty).
// An app write would wipe that set, so clients may only touch device records
// the server hasn't taken over; the server applies and lifts those itself.
const deviceBanWrite = and(
  'auth != null', wMod, notSelfUserId, `!data.child('banners').exists()`,
  or(
    and(
      'newData.exists()', bannedByIsMe,
      or(and(wAdmin, not(`newData.child('userId').exists()`)), canSanction(`newData.child('userId')`)),
      replaceOK(false),
    ),
    and(
      not('newData.exists()'),
      or(canSanction(`data.child('userId')`), and(not(validUid(`data.child('userId')`)), wAdmin)),
      bannerOK,
    ),
  ),
);

const banValidate = and(
  `newData.hasChild('bannedUntil')`,
  or(`newData.child('bannedUntil').val() === 'permanent'`, `newData.child('bannedUntil').isNumber()`),
  or(not(`newData.child('userId').exists()`), `newData.child('userId').isString()`),
  or(not(`newData.child('type').exists()`), `newData.child('type').val() === 'ban'`, `newData.child('type').val() === 'mute'`),
);

// ---------- users/{uid} ----------
const FROZEN = ['isAdmin', 'admin', 'isSeniorMod', 'isModerator', 'isBabyMod', 'isTrusted', 'isGrinder', 'isRaider', 'isMod', 'owner'];
const usersWrite = and(
  'auth != null',
  or(
    and('auth.uid === $userId', or(not('newData.exists()'), and(...FROZEN.map((f) => `newData.child('${f}').val() === data.child('${f}').val()`)))),
    // Admin "Delete Profile (ALL DATA)" in BottomDrawer.
    and(not('newData.exists()'), wAdmin, '$userId !== auth.uid', not(adminU('$userId'))),
  ),
);
const targetAdmin = adminU('$userId');
const userChildren = {
  isAdmin: { '.write': and(wAdmin, not(targetAdmin)) },
  admin: { '.write': and(wAdmin, not(targetAdmin)) },
  isSeniorMod: { '.write': and(wAdmin, not(targetAdmin)) },
  isModerator: {
    '.write': and('auth != null', not(targetAdmin), or(wAdmin, and(flag(ME, 'isSeniorMod'), `${U('$userId')}.child('isSeniorMod').val() !== true`))),
  },
  isBabyMod: {
    '.write': and('auth != null', not(targetAdmin), or(
      wAdmin,
      and(flag(ME, 'isSeniorMod'), `${U('$userId')}.child('isSeniorMod').val() !== true`),
      and(flag(ME, 'isModerator'), `${U('$userId')}.child('isSeniorMod').val() !== true`, `${U('$userId')}.child('isModerator').val() !== true`),
      // Staff Access: a JMD granter may grant/remove JMD on ordinary users, never on themselves.
      and(isGranter, '$userId !== auth.uid', not(modPlusU('$userId'))),
    )),
  },
  isTrusted: { '.write': wMod },
  isGrinder: { '.write': wMod },
  isRaider: { '.write': wMod },
  // Legacy flags nobody may grant from a client.
  isMod: { '.write': and(wAdmin, not(targetAdmin)) },
  owner: { '.write': false },
  rolesUpdatedAt: {
    '.write': and('auth != null', or('auth.uid === $userId', wMod, isGranter)),
    '.validate': 'newData.isNumber()',
  },
  deviceId: {
    '.write': 'auth != null && auth.uid === $userId',
    '.validate': "newData.isString() && newData.val().matches(/^[A-Za-z0-9_-]{6,128}$/)",
  },
  // Other players award badges (influencer on follow, fiveStar on review):
  // set-to-true only.
  badges: { $badgeId: { '.write': 'auth != null && newData.val() === true' } },
  // Other players bump badge counters (reactionCount on a post): +1 only.
  counters: {
    $counter: { '.write': 'auth != null && newData.isNumber() && newData.val() === (data.isNumber() ? data.val() : 0) + 1' },
  },
  // Profile drawer back-fills a missing createdAt on a live record.
  createdAt: {
    '.write': `auth != null && !data.exists() && newData.isNumber() && newData.val() > 1400000000000 && ${U('$userId')}.child('displayName').exists()`,
  },
};

// ---------- helpers for simple nodes ----------
const ownUid = (v) => `auth != null && auth.uid === ${v}`;
const ownOrAdminDelete = (v) => or(and('auth != null', `auth.uid === ${v}`), and(not('newData.exists()'), wAdmin));
const adminOnly = { '.write': wAdmin };
const participant = and('auth != null', or(`$chatKey.beginsWith(auth.uid + '_')`, `$chatKey.endsWith('_' + auth.uid)`));

const OVERRIDES = {
  users: (cur) => {
    const keep = { '.indexOn': cur['.indexOn'], '.read': cur['.read'] };
    return {
      ...keep,
      $userId: { '.read': true, '.write': usersWrite, ...userChildren },
    };
  },

  submissions: {
    '.read': wAdmin,
    $taskId: {
      '.read': `auth != null && data.child('userId').val() === auth.uid`,
      '.write': or(
        and('auth != null', not('data.exists()'), `newData.child('userId').val() === auth.uid`),
        wAdmin,
      ),
    },
  },
  savedTrades: {
    '.read': true,
    $uid: { '.write': ownOrAdminDelete('$uid') },
  },
  mod_votes_by_user: {
    '.read': true,
    $uid: {
      '.write': ownUid('$uid'),
      $modUid: { '.validate': 'newData.val() === 1 || newData.val() === -1' },
    },
  },
  mod_votes_summary: {
    '.read': true,
    $modUid: {
      // Only alongside a real change of the writer's own vote (ModsScreen
      // writes both in one multi-path update).
      '.write': and(
        'auth != null',
        `newData.parent().parent().child('mod_votes_by_user').child(auth.uid).child($modUid).val() !== root.child('mod_votes_by_user').child(auth.uid).child($modUid).val()`,
      ),
      '.validate': "newData.hasChildren(['ups', 'downs']) && newData.child('ups').isNumber() && newData.child('ups').val() >= 0 && newData.child('downs').isNumber() && newData.child('downs').val() >= 0",
      $other: { '.validate': "$other === 'ups' || $other === 'downs'" },
    },
  },
  tradeAcceptors: {
    '.read': true,
    $tradeId: {
      // Builds from May 2026 clear all acceptors of their own trade (the trade
      // lives in Firestore, so ownership can't be checked here): delete only.
      '.write': `auth != null && !newData.exists()`,
      $uid: { '.write': ownUid('$uid') },
    },
  },
  tradeAcceptNotifications: { '.read': true, '.write': false },
  tradeJournal: { '.read': true, $uid: { '.write': ownOrAdminDelete('$uid') } },
  tradeStats: { '.read': true, $uid: { '.write': ownOrAdminDelete('$uid') } },
  banned_devices: (cur) => ({
    '.read': cur['.read'],
    $deviceId: {
      // Guests read their own device id (not enumerable); listing stays staff-only.
      '.read': true,
      '.write': deviceBanWrite,
      '.validate': banValidate,
    },
  }),
  banned_uids: (cur) => ({ ...cur, '.indexOn': ['linkedFrom', 'emailKey'] }),
  mod: { '.read': true, '.write': false },
  analytics: { '.read': true, '.write': false },
  reviews: { '.read': true, '.write': false },
  notifier: {
    '.read': true,
    $mode: { $uid: { '.write': ownUid('$uid') } },
  },
  notifier_index: {
    '.read': true,
    $mode: { $itemKey: { $uid: { '.write': ownUid('$uid') } } },
  },
  presence: (cur) => ({ ...cur, $uid: { '.write': ownOrAdminDelete('$uid') } }),
  activeGroupChats: {
    '.read': 'auth != null',
    $groupId: { $uid: { '.write': ownUid('$uid') } },
  },
  group_meta_data: {
    $uid: { '.read': ownUid('$uid'), '.write': ownOrAdminDelete('$uid') },
  },
  group_messages: { '.read': 'auth != null', '.write': false },
  single_offer_wall: { '.read': true, ...adminOnly },
  pic_numbers: { '.read': true, ...adminOnly },
  like_counter: {
    '.read': true,
    // Wallpaper like/download counters; guests use them too, so this stays
    // open but shape-checked.
    $id: {
      '.write': 'newData.exists()',
      '.validate': "newData.hasChildren() && $id.length <= 128",
      likes: { '.validate': 'newData.isNumber() && newData.val() >= 0 && newData.val() < 100000000' },
      dislikes: { '.validate': 'newData.isNumber() && newData.val() >= 0 && newData.val() < 100000000' },
      downloads: { '.validate': 'newData.isNumber() && newData.val() >= 0 && newData.val() < 100000000' },
      $other: { '.validate': false },
    },
  },
  news_feedback: (cur) => ({
    '.read': cur['.read'],
    $id: {
      // Create-only (guests included, News screen has no sign-in gate).
      '.write': `!data.exists() && newData.exists()`,
      '.validate': "newData.hasChildren(['createdAt']) && newData.child('createdAt').isNumber() && (!newData.child('userId').exists() || newData.child('userId').val() === 'anonymous' || (auth != null && newData.child('userId').val() === auth.uid))",
    },
  }),
  news: { '.read': true, ...adminOnly },
  stock: { '.read': true, ...adminOnly },
  xlsData: { '.read': true, '.write': false },
  banned_users_by_email: (cur) => ({
    '.indexOn': cur['.indexOn'],
    '.read': cur['.read'],
    $emailKey: {
      // Own record only (raw and lowercased key); staff read via the parent.
      '.read': ownEmailKey,
      '.write': emailBanWrite,
      '.validate': banValidate,
    },
  }),
  banned_users_by_email_post: (cur) => ({
    '.read': cur['.read'],
    $emailKey: {
      '.read': ownEmailKey,
      // Nothing reads this any more; 2025 builds still let mods write it from
      // the feed. Mod+ only, never on yourself.
      '.write': and(wMod, notOwnEmailKey),
    },
  }),
  withdrawals: {
    '.read': staffRead,
    $uid: {
      '.read': ownUid('$uid'),
      $id: { '.write': or(and(ownUid('$uid'), not('data.exists()')), wAdmin) },
    },
  },
  storeItems: { '.read': true, ...adminOnly },
  background: { '.read': true, ...adminOnly },
  hd: { '.read': true, ...adminOnly },
  api: { '.read': true, ...adminOnly },
  free_translation: { '.read': true, ...adminOnly },
  server: { '.read': true, ...adminOnly },
  fruit_data: { '.read': true, ...adminOnly },
  ratings: {
    '.read': true,
    // Builds from 2025: ratings/{ratedUid}/{raterUid}.
    $ratedUid: { $raterUid: { '.write': and('auth != null', 'auth.uid === $raterUid', '$raterUid !== $ratedUid') } },
  },
  averageRatings: {
    '.read': true,
    $uid: {
      '.write': 'auth != null && auth.uid !== $uid',
      '.validate': "newData.child('value').isNumber() && newData.child('value').val() >= 0 && newData.child('value').val() <= 5 && newData.child('count').isNumber() && newData.child('count').val() >= 0",
    },
  },
  noman_app_version: { '.read': true, '.write': false },
  previous_enrole: { '.read': true, '.write': false },
  waqas_app_version: { '.read': true, '.write': false },
  ios_version: { '.read': true, ...adminOnly },
  featuredCounts: { '.read': true, '.write': false },
  reward: {
    '.read': true,
    $uid: { '.write': ownOrAdminDelete('$uid') },
  },
  prize: { '.read': true, '.write': false },
  winners: { '.read': true, ...adminOnly },
  pin_messages: { '.read': true, '.write': wMod },
  bannedUsers: {
    $uid: { '.read': ownUid('$uid'), '.write': ownUid('$uid') },
  },
  reports: { '.read': staffRead, '.write': false },
  codes: { '.read': true, ...adminOnly },
  enrole: { '.read': true, '.write': false },
  online_users: { '.read': true, '.write': false },
  freeTradeUsed: { '.read': true, '.write': false },
  tradeReports: {
    '.read': staffRead,
    $reportId: {
      // ReportTradePopUp push(): every build since 2025 writes this shape.
      // Staff mark them reviewed from the Admin Dashboard (ReportsTab).
      '.write': or(
        `auth != null && !data.exists() && newData.exists()`,
        and(wJMD, 'data.exists()', 'newData.exists()'),
      ),
      '.validate': "newData.hasChildren(['tradeId', 'reportedBy']) && (data.exists() ? (newData.child('reportedBy').val() === data.child('reportedBy').val() && newData.child('tradeId').val() === data.child('tradeId').val()) : newData.child('reportedBy').val() === auth.uid) && newData.child('tradeId').isString() && newData.child('tradeId').val().length <= 200 && (!newData.child('reason').exists() || (newData.child('reason').isString() && newData.child('reason').val().length <= 1000))",
    },
  },
  activeChats: {
    '.read': 'auth != null',
    $uid: { '.write': ownOrAdminDelete('$uid') },
  },
  appVersions: { '.read': true, '.write': false },
  lastChecked: { '.read': true, '.write': false },
  testing: { '.read': true, '.write': false },
  private_chat_new: { '.read': false, '.write': false },
  chat_meta_data: {
    // Inbox rows: chat_meta_data/{me}/{partner}. A sender also updates the
    // partner's row about themselves (website fallback, pre-May builds).
    $uid: {
      '.read': ownUid('$uid'),
      '.write': ownOrAdminDelete('$uid'),
      $partnerId: { '.write': ownUid('$partnerId') },
    },
  },
  private_messages: (cur) => ({
    $chatKey: {
      '.read': participant,
      messages: cur.$chatKey.messages,
      $other: { '.write': participant },
    },
  }),
  private_chat: { '.read': false, '.write': false },
  jmd_granters: {
    '.read': staffRead,
    $uid: {
      '.read': ownUid('$uid'),
      '.write': wAdmin,
      '.validate': 'newData.val() === true',
    },
  },
};

function main() {
  const json = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
  const rules = json.rules;
  for (const [key, val] of Object.entries(OVERRIDES)) {
    rules[key] = typeof val === 'function' ? val(rules[key] || {}) : val;
  }
  const out = JSON.stringify(json, null, 2) + '\n';
  const unverified = out.match(/auth\.token\.email === '[^']+'/g) || [];
  const verifiedCount = (out.match(/auth\.token\.email_verified === true/g) || []).length;
  if (process.argv.includes('--check')) {
    if (out !== fs.readFileSync(RULES_PATH, 'utf8')) {
      console.error('database.rules.json is out of date: run node scripts/test-rules/build-database-rules.js');
      process.exit(1);
    }
    console.log('database.rules.json matches build-database-rules.js');
    return;
  }
  fs.writeFileSync(RULES_PATH, out);
  console.log(`wrote ${RULES_PATH} (${out.length} bytes, ${Object.keys(OVERRIDES).length} nodes rebuilt, ${unverified.length} owner-email comparisons, ${verifiedCount} email_verified guards)`);
}

if (require.main === module) main();
module.exports = { OVERRIDES };
