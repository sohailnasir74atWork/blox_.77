-- =====================================================================
-- 045_helper_role.sql  (Blox Fruits, 2026-10-19) — NOT APPLIED YET
--
-- Staff-given badges (owner-approved Senior Mod suggestions, 2026-10-19):
--   * user_roles.is_helper     cosmetic "Helper" badge (users/{uid}/isHelper,
--                              granted by Mod+). NOT staff: no moderation
--                              powers, no panel access, never in staff/{uid}.
--                              Partial index for the Leaderboard "Helper" tab
--                              (getUsersByRole('is_helper')).
--   * user_roles.custom_title  short title a Senior Mod / Admin / owner gives
--                              a user (users/{uid}/customTitle, <= 20 chars,
--                              checked by the RTDB rules). Rides the roles row
--                              so chat rows show it with zero extra reads.
--   * mod_actions action CHECK widened with 'title_change' (the audit row the
--                              app writes through modSanction 'log').
--
-- Additive only. Old builds select explicit user_roles columns, so the new
-- columns are invisible to them.
--
-- ORDER: apply BEFORE deploying functions (mirrorUsersToSupabase and
-- reconcileRolesMirror upsert/select is_helper + custom_title; a missing
-- column fails the whole upsert, see 027) and before shipping an app build
-- that selects them (Code/Supabase/userBackend.js ROLES_COLS).
-- Safe to run more than once.
--
-- If another migration re-creates mod_actions_action_check, its list must
-- keep 'title_change' (and this one must keep theirs).
--
-- Rollback (only after reverting the functions and app build):
--   drop index if exists public.idx_user_roles_helper;
--   alter table public.user_roles drop column if exists is_helper,
--                                  drop column if exists custom_title;
--   then re-run 033 STEP 3 to restore the old action list.
-- =====================================================================

set lock_timeout = '5s';

-- 1. user_roles columns --------------------------------------------------
alter table public.user_roles
  add column if not exists is_helper    boolean not null default false,
  add column if not exists custom_title text;

-- Sparse, like the other role indexes in 003: only rows with the flag set.
create index if not exists idx_user_roles_helper
  on public.user_roles (uid) where is_helper = true;

-- 2. mod_actions.action CHECK: 033's list + 'title_change' ----------------
alter table public.mod_actions
  drop constraint if exists mod_actions_action_check;

alter table public.mod_actions
  add constraint mod_actions_action_check
  check (action in (
    'mute', 'strike', 'ban', 'unban', 'unmute',
    'message_delete', 'delete_all', 'pin', 'unpin',
    'role_change', 'review_delete', 'profile_delete',
    'title_change'
  ));

reset lock_timeout;

-- PostgREST schema cache
notify pgrst, 'reload schema';

-- Check:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'user_roles'
--      and column_name in ('is_helper', 'custom_title');
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'mod_actions_action_check';
