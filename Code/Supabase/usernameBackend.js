// Username reservation — case-insensitive uniqueness for display names.
//
// RTDB stays the source of truth for the actual displayName write (Settings
// still does update(users/{uid}, { displayName })). This module only gates
// that write: call claimUsername(name) FIRST; if it resolves, the name is
// atomically reserved for this user and it's safe to write to RTDB. If it
// rejects with an "already taken" error, don't write — the name belongs to
// someone else.
//
// Backed by the claim_username() SECURITY DEFINER RPC — see
// supabase/021_username_uniqueness.sql. Uniqueness is checked against the
// user_identity mirror (all real current names, incl. grandfathered dupes)
// plus the reservation table (concurrency tiebreak), so it holds even while
// the mirror is catching up to a fresh RTDB write.
import { supabase } from './client';

export class UsernameTakenError extends Error {
  constructor(message = 'username taken') {
    super(message);
    this.name = 'UsernameTakenError';
    this.taken = true;
  }
}

// Reserves `name` (case-insensitively) for the current Firebase user.
// Resolves with the as-typed name on success. Throws UsernameTakenError if
// another account already holds it, or a generic Error on other failures
// (validation, network, RPC missing). Callers should abort the name write
// on any throw.
export async function claimUsername(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('username required');

  const { data, error } = await supabase.rpc('claim_username', { p_name: trimmed });

  if (error) {
    // Postgres unique_violation (23505) is how the RPC signals "taken".
    if (error.code === '23505' || /username taken/i.test(error.message || '')) {
      throw new UsernameTakenError(error.message);
    }
    console.warn('[usernameBackend] claimUsername error:', error.message);
    throw error;
  }

  return data?.display_name ?? trimmed;
}
