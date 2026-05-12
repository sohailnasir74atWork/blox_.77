// Supabase migration kill switches.
//
// Every Supabase backend module (chatBackend, chatMetaBackend,
// groupMetaBackend, userBackend) imports `SUPABASE_READS_ENABLED` from
// here and short-circuits all reads (returns null / empty) when it's
// false. Callers already handle null by falling back to RTDB, so
// flipping this single flag completely disables the Supabase read path
// without code changes anywhere else.
//
// Use case: a hot revert if anything misbehaves in production. Build a
// new release with this set to false and the app instantly reads from
// RTDB end-to-end again. Mirror CFs keep running so Supabase stays in
// sync — the next re-enable is then a one-line change.
//
// Per-table flags allow narrower disables, e.g. if only profile reads
// are flaky we can keep chat metadata flowing.

export const SUPABASE_READS_ENABLED = true;

// Per-feature toggles. Default to inheriting the master flag.
export const SUPABASE_PUBLIC_CHAT_ENABLED = SUPABASE_READS_ENABLED;
export const SUPABASE_CHAT_META_ENABLED = SUPABASE_READS_ENABLED;
export const SUPABASE_GROUP_META_ENABLED = SUPABASE_READS_ENABLED;
export const SUPABASE_USERS_ENABLED = SUPABASE_READS_ENABLED;
