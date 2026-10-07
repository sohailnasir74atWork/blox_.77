/**
 * Blox Fruit — Cloud Functions (single deployable codebase, 2026-09).
 *
 * This folder is the ONLY source of truth for what is deployed to `fruiteblocks`.
 * Every module below is the latest version that was live in production (pulled
 * from the deployed source archives on 2026-09-03), so deploying from here is
 * behaviour-preserving for every app build. Retired functions live in
 * docs/cost-audit-2026-09/retired-functions/ for reference only.
 *
 * Deploy (explicit names — never rely on the CLI's "delete missing" prompt):
 *   firebase deploy --only functions:<name>,functions:<name> --project fruiteblocks
 */

// --- Supabase mirror / auth bridge ---------------------------------------
const usersMirror = require('./mirrorUsersToSupabase');
exports.mirrorUsersToSupabase = usersMirror.mirrorUsersToSupabase;
// Round 2 (2026-09): users_private/{uid} email → user_identity_base. Deploy
// EARLY, together with mirrorUsersToSupabase and supabase/029.
exports.mirrorUsersPrivateToSupabase = usersMirror.mirrorUsersPrivateToSupabase;
// Retired 2026-10-05: mirrorChatMetaToSupabase. The app writes chat_meta_data
// to Supabase via send_private_chat_meta, and the website moved to Supabase too;
// only pre-2026-05 builds still wrote RTDB chat_meta_data, and mirroring those
// created ghost inbox rows and overwrote unread_count / muted.
const roleClaim = require('./setSupabaseRoleClaim');
exports.setSupabaseRoleClaim = roleClaim.setSupabaseRoleClaim;
exports.ensureRoleClaim = roleClaim.ensureRoleClaim;

// --- Push notifications (Supabase webhooks + Firestore triggers) ---------
exports.notifyPrivateMessage = require('./notifyPrivateMessage').notifyPrivateMessage;
exports.notifyGroupNewMessage = require('./notifyGroupNewMessage').notifyGroupNewMessage;
exports.notifyFromTrade = require('./notifyFromTrade').notifyFromTrade;
exports.notifyPostComment = require('./notifyPostComment').notifyPostComment;
exports.notifyTradeAccept = require('./notifyTradeAccept').notifyTradeAccept;

// --- Stock scraper + stock push topics -----------------------------------
exports.checkStockUpdates = require('./checkStockUpdates').checkStockUpdates;
exports.sendStockNotifications = require('./sendStockNotifications').sendStockNotifications;
exports.backupAndClearCalcData = require('./backupAndClearCalcData').backupAndClearCalcData;
const topics = require('./stockTopics');
exports.syncTopicsOnTokenChange = topics.syncTopicsOnTokenChange;
exports.syncTopicsOnReminderToggle = topics.syncTopicsOnReminderToggle;
exports.syncTopicsOnSelectedReminderToggle = topics.syncTopicsOnSelectedReminderToggle;
exports.syncTopicsOnSelectedFruitsChange = topics.syncTopicsOnSelectedFruitsChange;

// --- Scheduled maintenance -----------------------------------------------
exports.clearPresenceNode = require('./clearPresenceNode').clearPresenceNode;
exports.computeFeedRanking = require('./computeFeedRanking').computeFeedRanking;
exports.aggregateTradeAnalytics = require('./aggregateTradeAnalytics').aggregateTradeAnalytics;
exports.updateLeaderboardCache = require('./updateLeaderboardCache').updateLeaderboardCache;
const reviewIntegrity = require('./reviewIntegrity');
exports.scoreReviewOnWrite = reviewIntegrity.scoreReviewOnWrite;
exports.voidReviewsOfDeletedUser = reviewIntegrity.voidReviewsOfDeletedUser;
const staffMirror = require('./staffMirror');
for (const flag of staffMirror.STAFF_FLAGS) exports[`syncStaff_${flag}`] = staffMirror[`syncStaff_${flag}`];
const mods = require('./modRoster');
exports.refreshModProfiles = mods.refreshModProfiles;
exports.seedModRoster = mods.seedModRoster;
// Mod ratings: server-counted tally (skips banned/muted and new accounts).
const modVotes = require('./modVoteTally');
exports.countModVote = modVotes.countModVote;
exports.rebuildModVoteTally = modVotes.rebuildModVoteTally;

// --- Fruit Crash game (2nd-gen scheduled function) ----------------------
exports.fruitCrashController = require('./fruitCrashController').fruitCrashController;

// Intentionally NOT exported (retired 2026-09, see COST_OPTIMIZATION_2026-09.md):
//   syncModRoster, syncModRole_Moderator, syncModRole_BabyMod  → covered by mirrorModsRoster inside mirrorUsersToSupabase
//   syncSubscriptionOnSelectedReminderToggle                    → legacy Firestore `subscriptions`; topics are used
//   notifyNewMessage                                            → same body now deployed as notifyPrivateMessage
//   fetchWorldCupDataNow / fetchWorldCupDataScheduled           → feature not present in app or website
//   rebuildSubscriptionsFromRTDB                                → one-off admin tool, functions.config() (removed API)
//   updateLeaderboardCacheManual, resetFruitCrashRound          → unauthenticated manual endpoints, never deployed

// ── Roles mirror safety net (6-hourly RTDB ⇄ Supabase user_roles diff, 2026-09-04) ──
exports.reconcileRolesMirror = require('./reconcileRolesMirror').reconcileRolesMirror;
exports.expireFeaturedTrades = require('./expireFeaturedTrades').expireFeaturedTrades;

// ── Round 2 PII privacy (2026-09): move emails that old builds still write
// onto users/{uid} and Firestore posts into users_private / off the post.
// Group → privatizeUserPII-email, -decodedEmail, -postEmail. Deploy at CUTOVER:
//   firebase deploy --only functions:privatizeUserPII --project fruiteblocks
exports.privatizeUserPII = require('./privatizeUserPII').privatizeUserPII;
// Server-side ban enforcement: ban by uid, device index, ban evasion,
// deleted-account tombstones, Supabase sender bans. See banEnforcement.js.
const bans = require('./banEnforcement');
exports.modSanction = bans.modSanction;
// Staff evidence screenshots → Bunny, key held server-side. See modEvidenceUpload.js.
exports.modEvidenceUpload = require('./modEvidenceUpload').modEvidenceUpload;
exports.syncEmailBan = bans.syncEmailBan;
exports.indexDeviceAccount = bans.indexDeviceAccount;
exports.indexLegacyDeviceAccount = bans.indexLegacyDeviceAccount;
exports.banCheckOnSignup = bans.banCheckOnSignup;
exports.tombstoneDeletedAccount = bans.tombstoneDeletedAccount;
// 6-hourly safety net: Supabase banned_senders + Firestore banned_uids follow
// RTDB banned_uids (the per-ban mirror writes are best-effort).
exports.reconcileBanMirrors = bans.reconcileBanMirrors;

// Birthdays (supabase/036_birthdays.sql; ported from Adopt Me 2026-10-07).
// Deploy the schedulers PAUSED until an app build with Birthdays ships.
exports.notifyBirthdays = require('./notifyBirthdays').notifyBirthdays;
exports.notifyBirthdayWishes = require('./notifyBirthdayWishes').notifyBirthdayWishes;
exports.updateBirthday = require('./updateBirthday').updateBirthday;
