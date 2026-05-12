/**
 * Shared Supabase service-role client for mirror Cloud Functions.
 *
 * Reads:
 *   SUPABASE_URL              — e.g. https://jaimyhmanefvrijvjzxl.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (bypasses RLS)
 *
 * Set them as Firebase secrets so they're injected at runtime:
 *   firebase functions:secrets:set SUPABASE_URL
 *   firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
 *
 * And declare them on each function:
 *   functions
 *     .runWith({ secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] })
 *     .database.ref(...)
 *
 * Module-level memoisation keeps the same client across warm invocations
 * (a single Cloud Function instance reuses it) without paying the
 * createClient() cost every call.
 */

const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getSupabaseAdmin() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      '[supabaseAdmin] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — declare them as secrets on the function',
    );
  }

  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}

module.exports = { getSupabaseAdmin };
