// Re-export all cloud functions from separate files.
//
// Existing CFs (unchanged):
const { syncModRoster } = require('./syncModRoster');

// Supabase mirror CFs (RTDB → Supabase). RTDB stays the source of truth;
// these tail every relevant write and fan it out to Supabase. See
// SUPABASE_MIGRATION.md for the full migration story.
const {
  mirrorPublicChatMessageToSupabase,
  mirrorPublicChatMessageDeleteToSupabase,
  mirrorPublicChatPinToSupabase,
} = require('./mirrorPublicChatToSupabase');
const { mirrorChatMetaToSupabase } = require('./mirrorChatMetaToSupabase');
const { mirrorGroupMetaToSupabase } = require('./mirrorGroupMetaToSupabase');
const { mirrorUsersToSupabase } = require('./mirrorUsersToSupabase');

// Supabase auth bridge: every new Firebase user needs the
// `role: "authenticated"` custom claim, otherwise their Firebase ID token
// is rejected by Supabase Realtime as `InvalidJWTToken`.
const { setSupabaseRoleClaim, ensureRoleClaim } = require('./setSupabaseRoleClaim');

// Scheduled cleanup: wipe the RTDB presence node every 20 min so it (and its
// .value index) stays bounded. Live clients re-arm onDisconnect on next write.
const { clearPresenceNode } = require('./clearPresenceNode');

// Scheduled feed ranking: computes Hot/Trending scores from recent
// designPosts_upgrade docs and writes /feedRanking to RTDB. The Feed
// screen's Hot & Trending tabs are empty without it.
const { computeFeedRanking } = require('./computeFeedRanking');

exports.syncModRoster = syncModRoster;

exports.mirrorPublicChatMessageToSupabase = mirrorPublicChatMessageToSupabase;
exports.mirrorPublicChatMessageDeleteToSupabase = mirrorPublicChatMessageDeleteToSupabase;
exports.mirrorPublicChatPinToSupabase = mirrorPublicChatPinToSupabase;
exports.mirrorChatMetaToSupabase = mirrorChatMetaToSupabase;
exports.mirrorGroupMetaToSupabase = mirrorGroupMetaToSupabase;
exports.mirrorUsersToSupabase = mirrorUsersToSupabase;

exports.setSupabaseRoleClaim = setSupabaseRoleClaim;
exports.ensureRoleClaim = ensureRoleClaim;

exports.clearPresenceNode = clearPresenceNode;

exports.computeFeedRanking = computeFeedRanking;
