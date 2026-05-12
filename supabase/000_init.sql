-- =====================================================================
-- 000_init.sql — Phase 0 foundation
--
-- One-time setup that everything else depends on:
--   * public.firebase_uid()  — extract Firebase UID from the JWT so RLS
--     policies can do `where uid = public.firebase_uid()`. Used by
--     every later phase.
--
-- Auth model:
--   Supabase verifies the Firebase ID token (Third-Party Auth, configured
--   in dashboard → Authentication → Providers → Third-party). The token's
--   `sub` claim is the Firebase UID. Some Supabase token issuers also
--   surface it as `firebase_uid`; we coalesce to handle both.
--
-- Run-once. Idempotent.
-- =====================================================================

create or replace function public.firebase_uid() returns text
language sql stable as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'firebase_uid',
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
  );
$$;

-- Optional sanity check — run after applying:
--   select public.firebase_uid();
-- Returns null when unauthenticated, your Firebase UID when called from
-- the app or with a Firebase ID token attached.
