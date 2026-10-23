-- =====================================================================
-- 054_mod_log_admin_only.sql (2026-10-23) — NOT APPLIED YET
--
-- Owner decision 2026-10-23: actions done by Admins (and the owner) are
-- visible to Admins only. Senior Mods, Mods and JMDs no longer see them in
--   * the Mod log's "Recent" list           (mod_actions_recent)
--   * the Mod log's per-staff ranking       (mod_leaderboard)
--   * a player's moderation history         (mod_actions_for_user, the
--     profile drawer's Mod Tools and Admin Dashboard ▸ Find user)
--
-- An entry counts as an Admin's when it was logged with actor_role 'admin'
-- (functions/banEnforcement.js writes 'admin' for Admins and the owner) or
-- its actor is an Admin now. Server-job entries ('system') stay visible.
-- The filter is in the rpcs, so every app build gets it at once; the table
-- itself has no client access (031).
--
-- Requires 053 (_caller_is_admin, is_moderator_staff) and 033 / 047.
-- Same names and arguments as before. Safe to run more than once.
-- =====================================================================

-- TRUE when the entry was made by an Admin / the owner.
create or replace function public._mod_action_by_admin(p_actor_uid text, p_actor_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_actor_role, '') = 'admin'
      or exists (select 1 from public.user_roles ur where ur.uid = p_actor_uid and ur.is_admin = true);
$$;
revoke all on function public._mod_action_by_admin(text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public._mod_action_by_admin(text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public._mod_action_by_admin(text, text) from authenticated;
  end if;
end $$;


-- Mod log ▸ Recent (053 body + the admin filter).
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
  v_admin  boolean;
begin
  if not public.is_moderator_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_admin := public._caller_is_admin();
  return query
    select *
      from public.mod_actions m
     where m.created_at >= v_since
       and (v_action is null or m.action = v_action)
       and (v_actor  is null or m.actor_uid = v_actor)
       and (v_admin or not public._mod_action_by_admin(m.actor_uid, m.actor_role))
       and (
         p_cursor_created is null
         or m.created_at < p_cursor_created
         or (m.created_at = p_cursor_created and m.id < p_cursor_id)
       )
     order by m.created_at desc, m.id desc
     limit greatest(1, least(coalesce(p_limit, 30), 100));
end $$;

-- Mod log ▸ By moderator (053 body + the admin filter).
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
  v_admin boolean;
begin
  if not public.is_moderator_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_admin := public._caller_is_admin();
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
       and (v_admin or not public._mod_action_by_admin(a.actor_uid, a.actor_role))
     group by a.actor_uid
     order by count(*) desc, max(a.created_at) desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

-- A player's moderation history (033 body + the admin filter). Every staff
-- rank may still call it (Mod Tools in the profile drawer).
create or replace function public.mod_actions_for_user(
  p_email          text default null,
  p_uid            text default null,
  p_cursor_created timestamptz default null,
  p_cursor_id      uuid default null,
  p_limit          int default 50
) returns setof public.mod_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(trim(p_email), ''));
  v_uid   text := nullif(trim(p_uid), '');
  v_admin boolean;
begin
  if not public.is_mod_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_email is null and v_uid is null then
    raise exception 'email or uid required' using errcode = '22023';
  end if;
  v_admin := public._caller_is_admin();
  return query
    select *
      from public.mod_actions m
     where ((v_email is not null and m.target_email = v_email)
         or (v_uid   is not null and m.target_uid   = v_uid))
       and (v_admin or not public._mod_action_by_admin(m.actor_uid, m.actor_role))
       and (
         p_cursor_created is null
         or m.created_at < p_cursor_created
         or (m.created_at = p_cursor_created and m.id < p_cursor_id)
       )
     order by m.created_at desc, m.id desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

notify pgrst, 'reload schema';

-- Verify:
--   select proname from pg_proc
--    where proname in ('mod_actions_recent', 'mod_leaderboard', 'mod_actions_for_user')
--      and prosrc ~ '_mod_action_by_admin';                       -- 3 rows

-- =====================================================================
-- ROLLBACK (by hand): re-run 053 STEP 4 (recent + leaderboard) and 033's
-- mod_actions_for_user; drop function public._mod_action_by_admin(text, text).
-- =====================================================================
