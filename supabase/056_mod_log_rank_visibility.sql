-- =====================================================================
-- 056_mod_log_rank_visibility.sql (2026-10-23) — NOT APPLIED YET
--
-- Owner decision 2026-10-23: the Mod log follows the staff hierarchy. Each
-- rank sees entries made by its own rank and below, never above:
--   Admin / owner  everything
--   Senior Mod     Senior Mods, Mods, JMDs, server jobs
--   Mod            Mods, JMDs, server jobs
--   JMD            JMDs, server jobs (player history only; no Mod log)
-- 054 hid only Admin entries; Mods could still see Senior Mods' actions.
-- Applies to the same three rpcs:
--   * the Mod log's "Recent" list           (mod_actions_recent)
--   * the Mod log's per-staff ranking       (mod_leaderboard)
--   * a player's moderation history         (mod_actions_for_user)
--
-- An entry's rank is the higher of the actor_role it was logged with
-- (functions/banEnforcement.js) and the actor's rank now, so a staffer
-- promoted later stays hidden from their old peers. Server-job ('system')
-- entries and entries with no known actor rank stay visible to all staff.
-- The filter is in the rpcs, so every app build gets it at once.
--
-- Requires 053 (_caller_is_admin, is_moderator_staff) and 054.
-- Same names and arguments as before. Safe to run more than once.
-- =====================================================================

-- Rank of an entry: 3 Admin, 2 Senior Mod, 1 Mod, 0 JMD, -1 system / unknown.
create or replace function public._mod_action_rank(p_actor_uid text, p_actor_role text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    case p_actor_role
      when 'admin'      then 3
      when 'senior_mod' then 2
      when 'moderator'  then 1
      when 'baby_mod'   then 0
      else -1
    end,
    coalesce((
      select case
               when ur.is_admin     then 3
               when ur.is_cmsr      then 2
               when ur.is_moderator then 1
               when ur.is_baby_mod  then 0
               else -1
             end
        from public.user_roles ur
       where ur.uid = p_actor_uid
    ), -1)
  );
$$;

-- Rank of the caller on the same scale (owner emails count as Admin).
create or replace function public._caller_staff_rank()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
           when public._caller_is_admin() then 3
           else coalesce((
             select case
                      when ur.is_cmsr      then 2
                      when ur.is_moderator then 1
                      when ur.is_baby_mod  then 0
                      else -1
                    end
               from public.user_roles ur
              where ur.uid = public.firebase_uid()
           ), -1)
         end;
$$;

do $$ begin
  revoke all on function public._mod_action_rank(text, text) from public;
  revoke all on function public._caller_staff_rank() from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public._mod_action_rank(text, text) from anon;
    revoke all on function public._caller_staff_rank() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public._mod_action_rank(text, text) from authenticated;
    revoke all on function public._caller_staff_rank() from authenticated;
  end if;
end $$;


-- Mod log ▸ Recent (054 body, rank filter).
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
  v_rank   int;
begin
  if not public.is_moderator_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_rank := public._caller_staff_rank();
  return query
    select *
      from public.mod_actions m
     where m.created_at >= v_since
       and (v_action is null or m.action = v_action)
       and (v_actor  is null or m.actor_uid = v_actor)
       and public._mod_action_rank(m.actor_uid, m.actor_role) <= v_rank
       and (
         p_cursor_created is null
         or m.created_at < p_cursor_created
         or (m.created_at = p_cursor_created and m.id < p_cursor_id)
       )
     order by m.created_at desc, m.id desc
     limit greatest(1, least(coalesce(p_limit, 30), 100));
end $$;

-- Mod log ▸ By moderator (054 body, rank filter).
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
  v_rank  int;
begin
  if not public.is_moderator_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_rank := public._caller_staff_rank();
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
       and public._mod_action_rank(a.actor_uid, a.actor_role) <= v_rank
     group by a.actor_uid
     order by count(*) desc, max(a.created_at) desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

-- A player's moderation history (054 body, rank filter). Every staff
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
  v_rank  int;
begin
  if not public.is_mod_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_email is null and v_uid is null then
    raise exception 'email or uid required' using errcode = '22023';
  end if;
  v_rank := public._caller_staff_rank();
  return query
    select *
      from public.mod_actions m
     where ((v_email is not null and m.target_email = v_email)
         or (v_uid   is not null and m.target_uid   = v_uid))
       and public._mod_action_rank(m.actor_uid, m.actor_role) <= v_rank
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
--      and prosrc ~ '_mod_action_rank';                           -- 3 rows

-- =====================================================================
-- ROLLBACK (by hand): re-run 054 (Admin entries hidden only); then
-- drop function public._mod_action_rank(text, text);
-- drop function public._caller_staff_rank();
-- =====================================================================
