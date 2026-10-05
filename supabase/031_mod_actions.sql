-- =====================================================================
-- 031_mod_actions.sql — moderation audit log
--
-- Port of adoptme-jan7/supabase/029_mod_actions.sql, adapted:
--   * Written ONLY by Cloud Functions (service role) from
--     functions/banEnforcement.js. Every ban / strike / mute / unban — from
--     any app build — passes through syncEmailBan or modSanction, so the
--     server is the one place that can record all of them, and a mod cannot
--     forge or skip a row. No client insert policy exists.
--   * target_email may be null: uid bans (phone sign-ins, deleted accounts,
--     alts caught on a banned device) have none.
--   * Roles come from public.user_roles (is_admin, is_cmsr = senior mod,
--     is_moderator, is_baby_mod).
--   * pg_cron is not installed on this project, so retention is a function
--     to call by hand, not a scheduled job.
--
-- Reads are SECURITY DEFINER rpcs gated on is_mod_staff(), same as Adopt Me.
-- NOT in the realtime publication.
--
-- Safe to run more than once.
-- =====================================================================

-- 1. is_mod_staff() ----------------------------------------------------
create or replace function public.is_mod_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  -- coalesce: with no email claim (phone sign-in, most users) the IN() test is
  -- NULL, `false or NULL` is NULL, and `if not public.is_mod_staff()` would
  -- then NOT raise — every signed-in user could read the log. (Adopt Me's
  -- 029 file lacks this; its live function was patched with the coalesce.)
  select coalesce(
    exists (
      select 1
        from public.user_roles
       where uid = public.firebase_uid()
         and (is_admin = true or is_cmsr = true or is_moderator = true or is_baby_mod = true)
    )
    or lower(current_setting('request.jwt.claims', true)::jsonb ->> 'email') in (
      'thesolanalabs@gmail.com',
      'sohailnasir74business@gmail.com',
      'sohailnasir74@gmail.com'
    ),
    false
  );
$$;

grant execute on function public.is_mod_staff() to authenticated;

-- 2. mod_actions -------------------------------------------------------
create table if not exists public.mod_actions (
  id                  uuid primary key default gen_random_uuid(),

  -- who it was done to
  target_uid          text,
  target_email        text,                    -- decoded + lowercased; null for uid-only bans
  target_name         text,

  -- what was done
  action              text not null
    check (action in ('mute', 'strike', 'ban', 'unban')),
  reason              text,
  strike_count        int,
  duration_minutes    int,                     -- mute only
  banned_until_ms     bigint,                  -- null when permanent or unban
  is_permanent        boolean not null default false,

  -- who did it (null actor = automatic)
  actor_uid           text,
  actor_name          text,
  actor_role          text
    check (actor_role is null or actor_role in ('admin', 'senior_mod', 'moderator', 'baby_mod', 'system')),

  -- where from: 'app' (an email-ban write from any app build), 'uid'
  -- (modSanction), 'linked' / 'device' / 'email_hash' (automatic evasion bans)
  source              text not null default 'app',
  created_at          timestamptz not null default now()
);

create index if not exists idx_mod_actions_target_email
  on public.mod_actions (target_email, created_at desc)
  where target_email is not null;
create index if not exists idx_mod_actions_target_uid
  on public.mod_actions (target_uid, created_at desc)
  where target_uid is not null;
create index if not exists idx_mod_actions_actor
  on public.mod_actions (actor_uid, created_at desc)
  where actor_uid is not null;
create index if not exists idx_mod_actions_created
  on public.mod_actions (created_at desc);

-- RLS on, no policies: anon/authenticated can neither read nor write the
-- table directly. Service role (Cloud Functions) bypasses RLS to insert;
-- staff read through the rpcs below.
alter table public.mod_actions enable row level security;
revoke all on public.mod_actions from anon, authenticated;

-- 3. Read rpcs (staff only) --------------------------------------------
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
begin
  if not public.is_mod_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_email is null and v_uid is null then
    raise exception 'email or uid required' using errcode = '22023';
  end if;
  return query
    select *
      from public.mod_actions
     where ((v_email is not null and target_email = v_email)
         or (v_uid   is not null and target_uid   = v_uid))
       and (
         p_cursor_created is null
         or created_at < p_cursor_created
         or (created_at = p_cursor_created and id < p_cursor_id)
       )
     order by created_at desc, id desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

revoke all on function public.mod_actions_for_user(text, text, timestamptz, uuid, int) from public;
grant execute on function public.mod_actions_for_user(text, text, timestamptz, uuid, int) to authenticated;

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
  if not public.is_mod_staff() then
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
grant execute on function public.mod_leaderboard(int, int) to authenticated;

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
  if not public.is_mod_staff() then
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
grant execute on function public.mod_actions_recent(text, text, int, timestamptz, uuid, int) to authenticated;

-- 4. Retention (call by hand; pg_cron is not installed) ------------------
--   select public.retention_mod_actions();
create or replace function public.retention_mod_actions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.mod_actions where created_at < now() - interval '400 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function public.retention_mod_actions() from public;

-- =====================================================================
-- ROLLBACK
--   drop function if exists public.retention_mod_actions();
--   drop function if exists public.mod_actions_recent(text, text, int, timestamptz, uuid, int);
--   drop function if exists public.mod_leaderboard(int, int);
--   drop function if exists public.mod_actions_for_user(text, text, timestamptz, uuid, int);
--   drop table if exists public.mod_actions;
--   -- is_mod_staff() can stay; nothing else depends on it yet.
-- =====================================================================
