-- =====================================================================
-- 047_mod_powers.sql (Blox Fruits, 2026-10-19) — staff powers per rank
--
-- Owner-approved changes from a Senior Mod's suggestions (2026-10-19), the
-- Supabase half (the rest is functions/banEnforcement.js and the app):
--
--   * The Mod log — the staff activity log, rpcs mod_actions_recent and
--     mod_leaderboard — is Senior Mod and up. New helper
--     is_senior_mod_staff(): user_roles.is_admin or is_cmsr (= Senior Mod),
--     or a VERIFIED owner email. The owner check is inline, like 043:
--     _jwt_is_owner() (040) is not installed on every Blox database.
--   * mod_actions_for_user (ONE user's timeline, shown to every staff rank in
--     the profile drawer's Mod Tools) stays on is_mod_staff().
--   * mod_actions.action also allows 'perm_confirm' / 'perm_reject' (an
--     admin's answer to a non-admin's 3rd strike, which is now a 30-day ban
--     waiting for an admin) and 'post_delete' (staff deleting a feed post).
--     The CHECK is re-created as the UNION of what it allows now and these
--     three, so 044–048 can each widen it, in any order, without dropping
--     each other's values.
--
-- Old builds: rpc signatures are unchanged. A Mod or JMD on any build who
-- opens the Mod log now gets 'not authorized' (the tab shows its empty /
-- error state); new builds hide that tab below Senior Mod.
--
-- Run BEFORE deploying the functions that log perm_confirm / perm_reject /
-- post_delete; until then the server logs them as ban / strike /
-- message_delete with details.action = the real action. Touches no hot
-- table (mod_actions takes tens of writes a day). Safe to run more than once.
-- Rollback at the bottom.
-- =====================================================================

-- ---------------------------------------------------------------------
-- STEP 1 — is_senior_mod_staff()
-- ---------------------------------------------------------------------
create or replace function public.is_senior_mod_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    exists (
      select 1
        from public.user_roles
       where uid = public.firebase_uid()
         and (is_admin = true or is_cmsr = true)
    )
    or (
      (c ->> 'email_verified')::boolean
      and lower(c ->> 'email') in (
        'thesolanalabs@gmail.com',
        'sohailnasir74business@gmail.com',
        'sohailnasir74@gmail.com'
      )
    ),
    false
  )
  from (select nullif(current_setting('request.jwt.claims', true), '')::jsonb as c) s;
$$;

revoke all on function public.is_senior_mod_staff() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.is_senior_mod_staff() from anon;
  end if;
end $$;
grant execute on function public.is_senior_mod_staff() to authenticated;


-- ---------------------------------------------------------------------
-- STEP 2 — widen mod_actions_action_check (union, never a fixed list)
--
-- 033 named it mod_actions_action_check (031's inline one had the same
-- auto-name). Its definition reads CHECK ((action = ANY (ARRAY['mute'::text,
-- ...]))): take every quoted value, add ours, re-create it in the same
-- shape so the next migration can parse it the same way. No constraint at
-- all (dropped by hand) = everything allowed: left alone.
-- ---------------------------------------------------------------------
set lock_timeout = '5s';

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
    raise notice '047: mod_actions_action_check not found; nothing to widen';
    return;
  end if;

  select array(
    select distinct v
      from (
        select m[1] as v from regexp_matches(v_def, '''([^'']+)''', 'g') as m
        union all
        select unnest(array['perm_confirm', 'perm_reject', 'post_delete'])
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


-- ---------------------------------------------------------------------
-- STEP 3 — the Mod log rpcs: Senior Mod and up (bodies as in 031 / 033)
-- ---------------------------------------------------------------------
create or replace function public.mod_actions_recent(
  p_action         text default null,
  p_actor_uid      text default null,
  p_days           int default 30,
  p_cursor_created timestamptz default null,
  p_cursor_id      uuid default null,
  p_limit          int default 30
) returns setof public.mod_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days   int := greatest(1, least(coalesce(p_days, 30), 365));
  v_since  timestamptz := now() - make_interval(days => v_days);
  v_action text := nullif(trim(p_action), '');
  v_actor  text := nullif(trim(p_actor_uid), '');
begin
  if not public.is_senior_mod_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select *
      from public.mod_actions
     where created_at >= v_since
       and (v_action is null or action = v_action)
       and (v_actor  is null or actor_uid = v_actor)
       and (
         p_cursor_created is null
         or created_at < p_cursor_created
         or (created_at = p_cursor_created and id < p_cursor_id)
       )
     order by created_at desc, id desc
     limit greatest(1, least(coalesce(p_limit, 30), 100));
end $$;

revoke all on function public.mod_actions_recent(text, text, int, timestamptz, uuid, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.mod_actions_recent(text, text, int, timestamptz, uuid, int) from anon;
  end if;
end $$;
grant execute on function public.mod_actions_recent(text, text, int, timestamptz, uuid, int) to authenticated;

create or replace function public.mod_leaderboard(
  p_days  int default 30,
  p_limit int default 50
) returns table (
  actor_uid        text,
  actor_name       text,
  actor_role       text,
  ban_count        bigint,
  strike_count     bigint,
  mute_count       bigint,
  unban_count      bigint,
  total_count      bigint,
  distinct_targets bigint,
  last_action_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days  int := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => v_days);
begin
  if not public.is_senior_mod_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select
      a.actor_uid,
      (array_agg(a.actor_name order by a.created_at desc) filter (where a.actor_name is not null))[1],
      (array_agg(a.actor_role order by a.created_at desc) filter (where a.actor_role is not null))[1],
      count(*) filter (where a.action = 'ban')    ::bigint,
      count(*) filter (where a.action = 'strike') ::bigint,
      count(*) filter (where a.action = 'mute')   ::bigint,
      count(*) filter (where a.action = 'unban')  ::bigint,
      count(*)                                    ::bigint,
      count(distinct coalesce(a.target_uid, a.target_email)) ::bigint,
      max(a.created_at)
      from public.mod_actions a
     where a.created_at >= v_since
       and a.actor_uid is not null
     group by a.actor_uid
     order by count(*) desc, max(a.created_at) desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

revoke all on function public.mod_leaderboard(int, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.mod_leaderboard(int, int) from anon;
  end if;
end $$;
grant execute on function public.mod_leaderboard(int, int) to authenticated;

notify pgrst, 'reload schema';

-- Verify:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'mod_actions_action_check';         -- has perm_confirm, perm_reject, post_delete
--   select prosrc ~ 'is_senior_mod_staff' from pg_proc
--    where proname in ('mod_actions_recent', 'mod_leaderboard');   -- true, true

-- =====================================================================
-- ROLLBACK (by hand)
--   * Mod log back to every staff rank: re-run 033 STEP 4's
--     mod_actions_recent and 031 STEP 3's mod_leaderboard (is_mod_staff()).
--   * Keep the widened CHECK: narrowing it fails on (or needs deleting)
--     audit rows written with the new actions. Do not delete audit rows.
--   * drop function if exists public.is_senior_mod_staff();   -- after the two above
-- =====================================================================
