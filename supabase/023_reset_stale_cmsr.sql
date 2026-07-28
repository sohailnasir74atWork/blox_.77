-- 023_reset_stale_cmsr.sql
--
-- Fix: phantom "Sr Mod" badges in public chat.
--
-- Senior Mod reuses the pre-scaffolded user_roles.is_cmsr column
-- (see fromRolesRow in Code/Supabase/userBackend.js and mirrorRoles in
-- functions/mirrorUsersToSupabase.js — is_cmsr := RTDB isSeniorMod).
--
-- Because is_cmsr existed BEFORE it was repurposed for Senior Mod, some
-- rows carried a stale is_cmsr = true left over from an earlier backfill.
-- The RTDB→Supabase mirror only rewrites is_cmsr when a user's role
-- fields change, so those stale rows were never corrected, and the app
-- rendered those users as Senior Mod in chat.
--
-- RTDB users/{uid}/isSeniorMod is the single source of truth. This resets
-- every is_cmsr back to false. Genuinely-appointed Senior Mods re-mirror
-- to is_cmsr = true automatically the moment an Admin (re)sets them via
-- the in-app "Make Sr Mod" button — so after running this, re-appoint any
-- real Senior Mods from the app.
--
-- Idempotent: safe to run more than once.

update public.user_roles
set is_cmsr = false, updated_at = now()
where is_cmsr = true;

-- Sanity check (should return 0 rows after the update):
-- select uid from public.user_roles where is_cmsr = true;
