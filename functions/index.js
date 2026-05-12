// Re-export all cloud functions from separate files.
//
// Existing CFs (unchanged):
const { notifyTradeAccept } = require('./notifyTradeAccept');
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

exports.notifyTradeAccept = notifyTradeAccept;
exports.syncModRoster = syncModRoster;

exports.mirrorPublicChatMessageToSupabase = mirrorPublicChatMessageToSupabase;
exports.mirrorPublicChatMessageDeleteToSupabase = mirrorPublicChatMessageDeleteToSupabase;
exports.mirrorPublicChatPinToSupabase = mirrorPublicChatPinToSupabase;
exports.mirrorChatMetaToSupabase = mirrorChatMetaToSupabase;
exports.mirrorGroupMetaToSupabase = mirrorGroupMetaToSupabase;
exports.mirrorUsersToSupabase = mirrorUsersToSupabase;

exports.setSupabaseRoleClaim = setSupabaseRoleClaim;
exports.ensureRoleClaim = ensureRoleClaim;
