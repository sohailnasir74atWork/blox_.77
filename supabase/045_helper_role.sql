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
--                              app writes through modSanction 'log'). Union
--                              with whatever the CHECK allows now, like 047,
--                              so 045/047 can run in either order.
--
-- Additive only. Old builds select explicit user_roles columns, so the new
-- columns are invisible to them.
--
-- ORDER: apply before deploying functions and before the app build. Both
-- tolerate it missing (mirrorUsersToSupabase / reconcileRolesMirror retry
-- without the two columns, userBackend falls back to the old ROLES_COLS),
-- but Helper badges and titles only reach Supabase once it is applied.
-- Safe to run more than once.
--
-- Rollback (only after reverting the functions and app build):
--   drop index if exists public.idx_user_roles_helper;
--   alter table public.user_roles drop column if exists is_helper,
--                                  drop column if exists custom_title;
--   'title_change' can stay in the CHECK (harmless).
-- =====================================================================

set lock_timeout = '5s';

-- 1. user_roles columns --------------------------------------------------
alter table public.user_roles
  add column if not exists is_helper    boolean not null default false,
  add column if not exists custom_title text;

-- Sparse, like the other role indexes in 003: only rows with the flag set.
create index if not exists idx_user_roles_helper
  on public.user_roles (uid) where is_helper = true;

-- 2. mod_actions.action CHECK: whatever it allows now + 'title_change' -----
-- Same shape as 047 STEP 2: take every quoted value from the current
-- definition, add ours, re-create it. Never a fixed list, so a migration
-- that widened it first (047 adds post_delete …) keeps its values. No
-- constraint at all (dropped by hand) = everything allowed: left alone.
do $$
declare
  v_def  text;
  v_vals text[];
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.mod_actions'::regclass
     and conname  = 'mod_actions_action_check';
  if v_def is null then
    raise notice '045: mod_actions_action_check not found; nothing to widen';
    return;
  end if;

  select array(
    select distinct v
      from (
        select m[1] as v from regexp_matches(v_def, '''([^'']+)''', 'g') as m
        union all
        select 'title_change'
      ) x
     order by v
  ) into v_vals;

  alter table public.mod_actions drop constraint mod_actions_action_check;
  execute format(
    'alter table public.mod_actions add constraint mod_actions_action_check check (action in (%s))',
    (select string_agg(quote_literal(v), ', ' order by v) from unnest(v_vals) as v)
  );
end $$;

reset lock_timeout;

-- PostgREST schema cache
notify pgrst, 'reload schema';

-- Check:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'user_roles'
--      and column_name in ('is_helper', 'custom_title');
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'mod_actions_action_check';
