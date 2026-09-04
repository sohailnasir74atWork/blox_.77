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
exports.mirrorUsersToSupabase = require('./mirrorUsersToSupabase').mirrorUsersToSupabase;
exports.mirrorChatMetaToSupabase = require('./mirrorChatMetaToSupabase').mirrorChatMetaToSupabase;
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
const mods = require('./modRoster');
exports.refreshModProfiles = mods.refreshModProfiles;
exports.seedModRoster = mods.seedModRoster;

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
