-- =====================================================================
-- 053_staff_access_chat_readers.sql (2026-10-22) — NOT APPLIED YET
--
-- Owner decisions 2026-10-22:
--
-- 1. MOD LOG FOR MODS. mod_actions_recent / mod_leaderboard (047) were
--    Senior Mod and up; Mods (is_moderator) may read them too. JMDs still
--    may not (they have no dashboard). New helper is_moderator_staff().
--
-- 2. "CAN READ PRIVATE CHATS" (Admin Dashboard → Staff → Staff access).
--    Reading any player's private chats was Admin-only (043
--    admin_list_user_chats, 040 mod_read_private_chat). An Admin may now
--    list a Mod or Senior Mod in private_chat_readers; that person gets the
--    same two reads (the chat list of any user, any chat's messages). Only
--    Admins (or the verified owner emails) can add or remove readers, and a
--    reader with an active ban, or who is no longer staff, loses it.
--    Rpcs: chat_readers_list(), chat_reader_set(uid, on), chat_reader_me().
--
-- Old builds: same rpc names and arguments, so nothing changes for them
-- except that the new reads succeed for listed readers.
-- Requires 047 (is_mod_staff, _caller_has_active_ban) and 043.
-- Additive and safe to run more than once.
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 1 — helpers
-- ---------------------------------------------------------------------

-- Mod, Senior Mod, Admin or a verified owner email; never while banned.
create or replace function public.is_moderator_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      exists (
        select 1
          from public.user_roles
         where uid = public.firebase_uid()
           and (is_admin = true or is_cmsr = true or is_moderator = true)
      )
      or (
        (c ->> 'email_verified')::boolean
        and lower(c ->> 'email') in (
          'thesolanalabs@gmail.com',
          'sohailnasir74business@gmail.com',
          'sohailnasir74@gmail.com'
        )
      )
    )
    and not public._caller_has_active_ban(),
    false
  )
  from (select nullif(current_setting('request.jwt.claims', true), '')::jsonb as c) s;
$$;
revoke all on function public.is_moderator_staff() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.is_moderator_staff() from anon;
  end if;
end $$;
grant execute on function public.is_moderator_staff() to authenticated;

-- Admin or a verified owner email (043's check, inline). No ban check, as
-- in 043, so an admin is never locked out of these tools by a stray row.
create or replace function public._caller_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    exists (
      select 1 from public.user_roles
       where uid = public.firebase_uid() and is_admin = true
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
revoke all on function public._caller_is_admin() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public._caller_is_admin() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public._caller_is_admin() from authenticated;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- STEP 2 — the readers list
-- ---------------------------------------------------------------------
create table if not exists public.private_chat_readers (
  uid             text primary key,           -- Firebase uid of the reader
  granted_by      text,                       -- the Admin's uid
  created_at      timestamptz not null default now()
);
alter table public.private_chat_readers enable row level security;
revoke all on public.private_chat_readers from anon, authenticated;
-- No policies: reads and writes only through the rpcs below.

-- Listed, still a Mod or Senior Mod (or above), and not banned.
create or replace function public._caller_is_chat_reader()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    exists (select 1 from public.private_chat_readers where uid = public.firebase_uid())
    and public.is_moderator_staff(),
    false
  );
$$;
revoke all on function public._caller_is_chat_reader() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public._caller_is_chat_reader() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public._caller_is_chat_reader() from authenticated;
  end if;
end $$;

-- Admin: every reader, newest first.
create or replace function public.chat_readers_list()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public._caller_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('uid', r.uid, 'grantedBy', r.granted_by, 'createdAt', r.created_at)
                     order by r.created_at desc)
      from public.private_chat_readers r), '[]'::jsonb);
end;
$$;

-- Admin: add (p_on true) or remove (false) a reader. Only a Mod or Senior
-- Mod can be added (Admins can read chats anyway; players have no dashboard).
create or replace function public.chat_reader_set(p_uid text, p_on boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public._caller_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_uid is null or p_uid !~ '^[A-Za-z0-9]{10,128}$' then
    raise exception 'BAD_UID' using errcode = '22023';
  end if;
  if coalesce(p_on, false) then
    if not exists (
      select 1 from public.user_roles
       where uid = p_uid and (is_cmsr = true or is_moderator = true) and coalesce(is_admin, false) = false
    ) then
      raise exception 'NOT_MOD: only a Mod or Senior Mod can be given this access' using errcode = '22023';
    end if;
    insert into public.private_chat_readers (uid, granted_by)
    values (p_uid, public.firebase_uid())
    on conflict (uid) do nothing;
  else
    delete from public.private_chat_readers where uid = p_uid;
  end if;
  return true;
end;
$$;

-- Anyone signed in: may I read private chats? (Admins: true.)
create or replace function public.chat_reader_me()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public._caller_is_admin() or public._caller_is_chat_reader();
$$;

revoke all on function public.chat_readers_list() from public;
revoke all on function public.chat_reader_set(text, boolean) from public;
revoke all on function public.chat_reader_me() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.chat_readers_list() from anon;
    revoke all on function public.chat_reader_set(text, boolean) from anon;
    revoke all on function public.chat_reader_me() from anon;
  end if;
end $$;
grant execute on function public.chat_readers_list() to authenticated;
grant execute on function public.chat_reader_set(text, boolean) to authenticated;
grant execute on function public.chat_reader_me() to authenticated;


-- ---------------------------------------------------------------------
-- STEP 3 — the two private-chat reads: Admin OR a listed reader
-- ---------------------------------------------------------------------

-- 043 body; the admin check now also accepts a reader.
create or replace function public.admin_list_user_chats(
  p_owner_uid text,
  p_offset int default 0,
  p_limit int default 20
)
returns setof public.chat_meta_data
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not (public._caller_is_admin() or public._caller_is_chat_reader()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_owner_uid is null or p_owner_uid = '' then
    raise exception 'user id required' using errcode = '22023';
  end if;

  return query
    select c.*
      from public.chat_meta_data c
     where c.owner_uid = p_owner_uid
     order by c.timestamp_ms desc nulls last, c.partner_uid asc
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.admin_list_user_chats(text, int, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.admin_list_user_chats(text, int, int) from anon;
  end if;
end $$;
grant execute on function public.admin_list_user_chats(text, int, int) to authenticated;

-- 040 body; owner check inline (no _jwt_is_owner), reader accepted.
create or replace function public.mod_read_private_chat(
  p_chat_id text,
  p_limit int default 50
)
returns setof public.private_messages
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not coalesce(public.is_mod_staff(), false) then
    raise exception 'not staff' using errcode = '42501';
  end if;
  if p_chat_id is null or p_chat_id = '' then
    return;
  end if;

  if not (public._caller_is_admin() or public._caller_is_chat_reader())
     and not exists (select 1 from public.reported_chats where chat_id = p_chat_id) then
    raise exception 'chat not reported' using errcode = '42501';
  end if;

  return query
    select *
      from public.private_messages
     where chat_id = p_chat_id
     order by created_at desc, id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;


-- ---------------------------------------------------------------------
-- STEP 4 — Mod log for Mods (047 bodies, gate is_moderator_staff)
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
  if not public.is_moderator_staff() then
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
  if not public.is_moderator_staff() then
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

notify pgrst, 'reload schema';

-- Verify:
--   select prosrc ~ 'is_moderator_staff' from pg_proc
--    where proname in ('mod_actions_recent', 'mod_leaderboard');          -- true, true
--   select prosrc ~ '_caller_is_chat_reader' from pg_proc
--    where proname in ('admin_list_user_chats', 'mod_read_private_chat');  -- true, true

-- =====================================================================
-- ROLLBACK (by hand)
--   * Mod log back to Senior Mod+: re-run 047 STEP 3.
--   * Chat reads back to Admin only: re-run 043, then 040's
--     mod_read_private_chat; optionally drop the four rpcs, the helpers
--     and private_chat_readers.
-- =====================================================================
