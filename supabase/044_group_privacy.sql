-- =====================================================================
-- 044_group_privacy.sql (2026-10-19) — NOT APPLIED
--
-- Group chats become private on the server, and group powers follow the
-- staff ladder the owner approved on 2026-10-19 (Senior Mod suggestions).
-- Bug log 2026-10-19: "Group chats are not private on the server" (P1),
-- "Staff group buttons don't match what the code allows", "Deleting a large
-- group leaves its messages behind".
--
-- Live state read 2026-10-19 (read-only query): 013's "select by anyone
-- authenticated" is the live SELECT policy, 034 is fully applied, 040 is NOT
-- (no _jwt_is_owner()), 124,752 group messages, largest group 7,602 live rows.
--
-- WHAT WAS WRONG
--   * 013 opened group_messages SELECT (and so realtime) to every signed-in
--     user.
--   * Postgres learned membership from group_meta_data (is_group_member,
--     010), a table anyone may insert their OWN row into for any group id. So
--     "member" meant "says so": it also opened the group's other inbox rows
--     (last_message previews) and the cross-member meta rpcs.
--   * Staff = is_mod_staff() (JMD and up) could change any group message and
--     read every group's inbox rows.
--
-- WHAT THIS DOES
--   * public.group_members: one row per (group, verified member). Written
--     ONLY by Cloud Functions with the service role (functions/
--     groupMembership.js): the Firestore groups/{id} trigger adds a member
--     only when an invitation or an approved join request backs the add (or
--     they are the creator), and removes rows when people leave, are removed,
--     or the group is deleted. scripts/groups/backfill-group-members.js seeds
--     today's members once (they are kept as they are).
--   * is_group_member() reads group_members.
--   * group_messages SELECT, and so realtime: verified members, the sender
--     of the row, and Senior Mod / Admin / owner (is_group_staff()).
--     Moderators and JMDs get no override in groups (owner decision
--     2026-10-19). Reported group messages stay readable by all staff through
--     list_message_reports (SECURITY DEFINER, reads the table as its owner).
--   * send_group_message / fanout_group_message_meta: verified members and
--     Senior Mod+; the fan-out list is cut down to verified members, so a
--     self-added account gets no inbox preview either.
--   * group_meta_data co-member policies (034 STEP 7): the staff part narrows
--     from is_mod_staff() (JMD+) to is_group_staff() (Senior Mod+).
--   * Moderating group messages: the sender, the GROUP CREATOR and Senior
--     Mod+. New rpcs delete_group_message / delete_group_messages_by_sender
--     (creators could not delete others' messages before); trg_ab_group_scope
--     refuses JMD / Mod edits of other people's group messages; hard DELETE:
--     sender or Senior Mod+.
--   * purge_group_chat(group): service role only. Soft-deletes every message
--     of the group in one UPDATE (no 1,000-row cap, no URL-length limit) and
--     removes every member's group_meta_data row and every group_members row.
--     The Firestore delete trigger calls it, so it only ever follows a delete
--     the Firestore rules allowed: the creator, Senior Mod+, or the last
--     member leaving.
--
-- ROLES: is_group_staff() = user_roles.is_admin or is_cmsr (Senior Mod), or a
-- verified owner email. Same mirror caveat as 034: a user_roles change can
-- lag up to 6 h (reconcileRolesMirror). 2026-10-19 live: 4 admin, 1 cmsr.
--
-- OLD BUILDS (Play 4.0.22+, iOS 8.5, blox-web)
--   * Members read and send as before. Right after accepting an invite (or a
--     creator right after creating a group) the group_members row lands when
--     the trigger runs (a few seconds, longer on a cold start): until then
--     history loads empty and a send fails once with NOT_ALLOWED (a brand-new
--     group's creator may already send — see _group_can_post). New builds call
--     the groupSync function first and are not affected. Own messages are
--     always readable.
--   * Moderators / JMDs "Enter" on a group they are not in: the chat opens
--     empty and sends fail. Their Delete on other people's group messages
--     fails (NOT_ALLOWED).
--   * Deleting a group: the client's own bulk soft-delete still fails as it
--     did (>1,000 rows, or not staff), but the server purge now does it.
--
-- HOW TO RUN — ONE STEP AT A TIME, IN ORDER (044_steps/ has each step as its
-- own file). STEP 3 waits for the functions deploy and the backfill.
--   0  read-only: where am I?
--   1  functions + table only; changes nothing for anyone
--   2  group_messages: scope trigger + narrower hard-delete policy
--   -- deploy functions onGroupWrite + groupSync, then run
--      node scripts/groups/backfill-group-members.js (dry run, then --apply)
--   3  the switch: membership from group_members, private SELECT, member-only
--      send / fan-out, Senior Mod+ instead of JMD+ on group_meta_data
-- Every step is idempotent. STEPs 2 and 3 take brief locks on hot tables with
-- lock_timeout, so they fail fast instead of queueing app traffic; re-run one
-- that times out. Rollback for STEP 3 is at the bottom.
-- =====================================================================


-- =====================================================================
-- STEP 0 — Read-only. Where am I?   Fully applied: t | 8 | 2 | (rows) | 4
-- =====================================================================
select
  (select count(*) = 1 from pg_tables
    where schemaname = 'public' and tablename = 'group_members')                        as step1_table,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('_jwt_is_owner', 'is_group_staff', '_group_member_role', '_group_can_post',
                        'guard_group_message_scope', 'delete_group_message',
                        'delete_group_messages_by_sender', 'purge_group_chat'))         as step1_functions,
  (select count(*) from pg_trigger where tgrelid = 'public.group_messages'::regclass
      and tgname = 'trg_ab_group_scope')
    + (select count(*) from pg_policies where schemaname = 'public' and tablename = 'group_messages'
      and policyname = 'group_messages delete by sender or senior staff')                 as step2_group_messages,
  (select reltuples::bigint from pg_class
    where oid = to_regclass('public.group_members'))                                     as backfilled_rows_estimate,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'group_messages'
      and policyname = 'group_messages select member or senior staff')
    + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'is_group_member' and p.prosrc like '%group_members%')
    + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'send_group_message' and p.prosrc like '%_group_can_post%')
    + (select count(*) from pg_policies where schemaname = 'public' and tablename = 'group_meta_data'
      and policyname = 'group_meta_data read shared group' and qual like '%is_group_staff%')  as step3_switch;


-- =====================================================================
-- STEP 1 — Table + functions only. Nobody's access changes yet.
-- Requires 034 (_chat_end_user_uid, guard_chat_message_update with the
-- blox.report_rpc bypass) and 003 (user_roles).
-- =====================================================================
do $$
begin
  if to_regprocedure('public._chat_end_user_uid()') is null
     or to_regprocedure('public.guard_chat_message_update()') is null then
    raise exception 'Run 034_chat_moderation_enforcement.sql first';
  end if;
end $$;

-- 1a. _jwt_is_owner() — the 040 helper, same body (040 is not applied live;
-- re-running 040 later replaces it with the identical function).
create or replace function public._jwt_is_owner()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    (c ->> 'email_verified')::boolean
      and lower(c ->> 'email') in (
        'thesolanalabs@gmail.com',
        'sohailnasir74business@gmail.com',
        'sohailnasir74@gmail.com'
      ),
    false)
  from (select nullif(current_setting('request.jwt.claims', true), '')::jsonb as c) s;
$$;

-- 1b. group_members — verified membership. Service role only: RLS on, no
-- policies, no client grants, not in the realtime publication.
create table if not exists public.group_members (
  group_id  text not null,
  user_id   text not null,
  role      text not null default 'member' check (role in ('creator', 'member')),
  added_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists idx_group_members_user on public.group_members (user_id);

alter table public.group_members enable row level security;
revoke all on table public.group_members from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.group_members from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.group_members from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.group_members to service_role;
  end if;
end $$;

-- 1c. is_group_staff() — Senior Mod, Admin, owner. False for service role
-- and anonymous callers. Used inside RLS policies, so authenticated may call it.
create or replace function public.is_group_staff()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid text := public._chat_end_user_uid();
begin
  if v_uid is null then
    return false;
  end if;
  if public._jwt_is_owner() then
    return true;
  end if;
  return exists (
    select 1 from public.user_roles r
     where r.uid = v_uid and (r.is_admin or r.is_cmsr)
  );
end;
$$;

-- 1d. Internals.
create or replace function public._group_member_role(p_group_id text, p_uid text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.group_members m
   where m.group_id = p_group_id and m.user_id = p_uid;
$$;

-- May p_uid post in p_group_id? A verified member, Senior Mod+, or — only
-- while the group has NO group_members rows yet (created seconds ago, the
-- trigger hasn't run) — the account whose own inbox row says it created the
-- group, which is what every build writes right after creating one. A
-- deleted group also has no rows; posting there reaches nobody.
create or replace function public._group_can_post(p_group_id text, p_uid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null and (
    exists (select 1 from public.group_members m
             where m.group_id = p_group_id and m.user_id = p_uid)
    or public.is_group_staff()
    or (not exists (select 1 from public.group_members m where m.group_id = p_group_id)
        and exists (select 1 from public.group_meta_data g
                     where g.group_id = p_group_id and g.user_id = p_uid and g.created_by = p_uid))
  );
$$;

-- 1e. guard_group_message_scope — BEFORE UPDATE on group_messages (STEP 2).
-- Runs before guard_chat_message_update (trg_ac): there, "staff" is JMD+ for
-- every chat table; in GROUPS only Senior Mod+ may change someone else's
-- message. Sender changes and the legacy report shim pass through to the
-- 034 guard, which still decides the details. Group creators delete through
-- delete_group_message (below).
create or replace function public.guard_group_message_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     text;
  v_old     jsonb;
  v_new     jsonb;
  v_changed text[];
  c_report  constant text[] := array['report_count', 'deleted', 'deleted_at', 'deleted_by'];
begin
  if coalesce(current_setting('blox.report_rpc', true), '') = 'on' then
    return new;                                      -- report_message / 044 rpcs
  end if;
  v_uid := public._chat_end_user_uid();
  if v_uid is null or v_uid = old.sender_id then
    return new;                                      -- service role / sender
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  select coalesce(array_agg(k), '{}'::text[]) into v_changed
    from jsonb_object_keys(v_new) as k
   where (v_new -> k) is distinct from (v_old -> k);
  if cardinality(v_changed) = 0 then
    return new;
  end if;
  if 'report_count' = any(v_changed) and v_changed <@ c_report then
    return new;                                      -- legacy report shim (034)
  end if;
  if public.is_group_staff() then
    return new;
  end if;
  raise exception 'NOT_ALLOWED'
    using errcode = 'check_violation',
          hint = 'In groups only the sender, the group creator or a Senior Mod+ can change a message.';
end;
$$;

-- 1f. delete_group_message — the sender, the group's creator, Senior Mod+.
-- TRUE when it soft-deleted the row, FALSE when it was already deleted.
-- The blox.report_rpc flag lets the row past the 034 guard (whose staff test
-- does not know group creators); deleted_by / deleted_at are stamped here.
create or replace function public.delete_group_message(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     text := public._chat_end_user_uid();
  v_group   text;
  v_sender  text;
  v_deleted boolean;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_message_id is null then
    raise exception 'message_id required' using errcode = '22023';
  end if;

  select group_id, sender_id, deleted into v_group, v_sender, v_deleted
    from public.group_messages where id = p_message_id for update;
  if not found then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if v_uid is distinct from v_sender
     and public._group_member_role(v_group, v_uid) is distinct from 'creator'
     and not public.is_group_staff() then
    raise exception 'NOT_ALLOWED'
      using errcode = 'check_violation',
            hint = 'Only the sender, the group creator or a Senior Mod+ can delete this message.';
  end if;
  if v_deleted then
    return false;
  end if;

  perform set_config('blox.report_rpc', 'on', true);
  update public.group_messages
     set deleted = true, deleted_at = now(), deleted_by = v_uid
   where id = p_message_id;
  perform set_config('blox.report_rpc', '', true);
  return true;
end;
$$;

-- 1g. delete_group_messages_by_sender — "Delete All" from one person in one
-- group: the group's creator or Senior Mod+. Newest p_limit (1-500) live
-- messages; returns how many it deleted.
create or replace function public.delete_group_messages_by_sender(
  p_group_id  text,
  p_sender_id text,
  p_limit     integer default 60
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   text := public._chat_end_user_uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 60), 500));
  v_n     integer;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_group_id is null or p_group_id = '' or p_sender_id is null or p_sender_id = '' then
    raise exception 'group_id and sender_id required' using errcode = '22023';
  end if;
  if public._group_member_role(p_group_id, v_uid) is distinct from 'creator'
     and not public.is_group_staff() then
    raise exception 'NOT_ALLOWED'
      using errcode = 'check_violation',
            hint = 'Only the group creator or a Senior Mod+ can do this.';
  end if;

  perform set_config('blox.report_rpc', 'on', true);
  with t as (
    select id from public.group_messages
     where group_id = p_group_id and sender_id = p_sender_id and not deleted
     order by created_at desc
     limit v_limit
  )
  update public.group_messages g
     set deleted = true, deleted_at = now(), deleted_by = v_uid
    from t
   where g.id = t.id;
  get diagnostics v_n = row_count;
  perform set_config('blox.report_rpc', '', true);
  return v_n;
end;
$$;

-- 1h. purge_group_chat — service role only (functions/groupMembership.js, on
-- the Firestore delete). One UPDATE for the messages, then every member's
-- inbox row and every membership row.
create or replace function public.purge_group_chat(p_group_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msgs    integer;
  v_meta    integer;
  v_members integer;
begin
  if public._chat_end_user_uid() is not null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_group_id is null or p_group_id = '' then
    raise exception 'group_id required' using errcode = '22023';
  end if;
  update public.group_messages
     set deleted = true, deleted_at = now(), deleted_by = 'system:group_deleted'
   where group_id = p_group_id and not deleted;
  get diagnostics v_msgs = row_count;
  delete from public.group_meta_data where group_id = p_group_id;
  get diagnostics v_meta = row_count;
  delete from public.group_members where group_id = p_group_id;
  get diagnostics v_members = row_count;
  return jsonb_build_object('messages', v_msgs, 'meta_rows', v_meta, 'members', v_members);
end;
$$;

-- 1i. Grants. Supabase grants EXECUTE on new functions to PUBLIC by default.
do $$
declare
  v_fn   text;
  v_role text;
begin
  foreach v_fn in array array[
    'public._jwt_is_owner()',
    'public.is_group_staff()',
    'public._group_member_role(text, text)',
    'public._group_can_post(text, text)',
    'public.guard_group_message_scope()',
    'public.delete_group_message(uuid)',
    'public.delete_group_messages_by_sender(text, text, integer)',
    'public.purge_group_chat(text)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    foreach v_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = v_role) then
        execute format('revoke all on function %s from %I', v_fn, v_role);
      end if;
    end loop;
  end loop;

  -- is_group_staff() sits in RLS policies, which run as the caller's role:
  -- anon needs it too (it answers false) or an anon read errors instead of
  -- returning no rows.
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('grant execute on function public.is_group_staff() to %I', v_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.delete_group_message(uuid) to authenticated;
    grant execute on function public.delete_group_messages_by_sender(text, text, integer) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.purge_group_chat(text) to service_role;
  end if;
end
$$;

notify pgrst, 'reload schema';


-- =====================================================================
-- STEP 2 — Arm public.group_messages: JMD / Mod edits of other people's
-- group messages are refused, hard DELETE is the sender or Senior Mod+.
-- Safe before the backfill (does not read group_members).
-- =====================================================================
set lock_timeout = '5s';

drop trigger if exists trg_ab_group_scope on public.group_messages;
create trigger trg_ab_group_scope
  before update on public.group_messages
  for each row execute function public.guard_group_message_scope();

drop policy if exists "group_messages delete by sender or staff"        on public.group_messages;
drop policy if exists "group_messages delete by sender or senior staff" on public.group_messages;
create policy "group_messages delete by sender or senior staff"
  on public.group_messages for delete
  using (sender_id = (select public.firebase_uid()) or (select public.is_group_staff()));

reset lock_timeout;


-- =====================================================================
-- STEP 3 — The switch. ONLY after onGroupWrite + groupSync are deployed and
-- scripts/groups/backfill-group-members.js --apply has run: before that,
-- group_members is empty and every member would lose their groups.
-- Check first:  select count(*), count(distinct group_id) from public.group_members;
-- (expect about the Firestore group count and ~20k rows).
-- =====================================================================
set lock_timeout = '5s';

-- 3a. Membership = group_members (was: "has an own group_meta_data row").
create or replace function public.is_group_member(p_group_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.group_members m
     where m.group_id = p_group_id
       and m.user_id  = public._chat_end_user_uid()
  );
$$;

-- 3b. group_messages SELECT (and realtime): own rows, verified members,
-- Senior Mod+. Replaces 013.
drop policy if exists "group_messages select by anyone authenticated" on public.group_messages;
drop policy if exists "group_messages select by member"               on public.group_messages;
drop policy if exists "group_messages select member or senior staff"  on public.group_messages;
create policy "group_messages select member or senior staff"
  on public.group_messages for select
  using (
    sender_id = (select public.firebase_uid())
    or public.is_group_member(group_id)
    or (select public.is_group_staff())
  );

-- 3c. group_meta_data co-member policies (034 STEP 7): staff part is Senior
-- Mod+ now; the member part already follows is_group_member (3a).
drop policy if exists "group_meta_data read shared group" on public.group_meta_data;
create policy "group_meta_data read shared group"
  on public.group_meta_data for select
  using (public.is_group_member(group_id) or (select public.is_group_staff()));

drop policy if exists "group_meta_data insert by member" on public.group_meta_data;
create policy "group_meta_data insert by member"
  on public.group_meta_data for insert
  with check (
    user_id = (select public.firebase_uid())
    or public.is_group_member(group_id)
    or (select public.is_group_staff())
  );

drop policy if exists "group_meta_data update by member" on public.group_meta_data;
create policy "group_meta_data update by member"
  on public.group_meta_data for update
  using (
    user_id = (select public.firebase_uid())
    or public.is_group_member(group_id)
    or (select public.is_group_staff())
  )
  with check (
    user_id = (select public.firebase_uid())
    or public.is_group_member(group_id)
    or (select public.is_group_staff())
  );

reset lock_timeout;

-- 3d. send_group_message — 012 body plus the membership check.
create or replace function public.send_group_message(
  p_group_id                  text,
  p_client_msg_id             uuid,
  p_text                      text    default null,
  p_image_url                 text    default null,
  p_fruits                    jsonb   default '[]'::jsonb,
  p_reply_to                  jsonb   default null,
  p_sender_name               text    default null,
  p_sender_avatar             text    default null,
  p_is_pro                    boolean default false,
  p_roblox_username_verified  boolean default false,
  p_has_recent_game_win       boolean default false,
  p_last_game_win_at          bigint  default null,
  p_is_creator                boolean default false,
  p_os                        text    default null
) returns public.group_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  caller   text := public.firebase_uid();
  inserted public.group_messages;
begin
  if caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_group_id is null or p_group_id = '' then
    raise exception 'group_id required' using errcode = '22023';
  end if;
  if not public._group_can_post(p_group_id, caller) then
    raise exception 'NOT_ALLOWED'
      using errcode = 'check_violation', hint = 'Only group members can send messages in this group.';
  end if;

  if p_client_msg_id is not null then
    insert into public.group_messages (
      group_id, client_msg_id, sender_id,
      text, image_url, fruits, reply_to,
      sender_name, sender_avatar,
      is_pro, roblox_username_verified,
      has_recent_game_win, last_game_win_at, is_creator, os
    ) values (
      p_group_id, p_client_msg_id, caller,
      p_text, p_image_url, coalesce(p_fruits, '[]'::jsonb), p_reply_to,
      p_sender_name, p_sender_avatar,
      coalesce(p_is_pro, false), coalesce(p_roblox_username_verified, false),
      coalesce(p_has_recent_game_win, false), p_last_game_win_at,
      coalesce(p_is_creator, false), p_os
    )
    on conflict (group_id, client_msg_id) where client_msg_id is not null
      do nothing
    returning * into inserted;

    if inserted.id is null then
      select * into inserted
        from public.group_messages
       where group_id = p_group_id
         and client_msg_id = p_client_msg_id;
    end if;
  else
    insert into public.group_messages (
      group_id, client_msg_id, sender_id,
      text, image_url, fruits, reply_to,
      sender_name, sender_avatar,
      is_pro, roblox_username_verified,
      has_recent_game_win, last_game_win_at, is_creator, os
    ) values (
      p_group_id, null, caller,
      p_text, p_image_url, coalesce(p_fruits, '[]'::jsonb), p_reply_to,
      p_sender_name, p_sender_avatar,
      coalesce(p_is_pro, false), coalesce(p_roblox_username_verified, false),
      coalesce(p_has_recent_game_win, false), p_last_game_win_at,
      coalesce(p_is_creator, false), p_os
    )
    returning * into inserted;
  end if;

  return inserted;
end $$;

-- 3e. fanout_group_message_meta — 034 body; caller check is _group_can_post
-- and the member list is cut to verified members once the group has rows.
create or replace function public.fanout_group_message_meta(
  p_group_id      text,
  p_member_ids    text[],
  p_sender_id     text,
  p_sender_name   text   default null,
  p_last_message  text   default null,
  p_timestamp_ms  bigint default null,
  p_group_name    text   default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller    text   := public.firebase_uid();
  ts        bigint := coalesce(p_timestamp_ms, (extract(epoch from now()) * 1000)::bigint);
  v_members text[];
  v_name    text   := public._chat_clean_name(p_sender_name);
  v_id_name text;
  v_last    text   := left(p_last_message, 1000);
begin
  if caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_group_id is null or p_group_id = '' then
    raise exception 'group_id required' using errcode = '22023';
  end if;
  if p_member_ids is null or array_length(p_member_ids, 1) is null then
    return;
  end if;
  if public.caller_chat_ban_kind() is not null then
    raise exception 'SENDER_BANNED'
      using errcode = 'check_violation', hint = 'This account is banned from sending messages.';
  end if;

  select array_agg(distinct m) into v_members
    from unnest(p_member_ids) m
   where m is not null and m <> '';
  if v_members is null then
    return;
  end if;
  if array_length(v_members, 1) > 200 then
    raise exception 'too many members' using errcode = '22023';
  end if;
  if not public._group_can_post(p_group_id, caller) then
    raise exception 'NOT_ALLOWED'
      using errcode = 'check_violation', hint = 'Only group members can fan out group messages.';
  end if;
  if exists (select 1 from public.group_members gm where gm.group_id = p_group_id) then
    select array_agg(m) into v_members
      from unnest(v_members) m
     where exists (select 1 from public.group_members gm
                    where gm.group_id = p_group_id and gm.user_id = m);
    if v_members is null then
      return;
    end if;
  end if;
  perform public._chat_check_links('group_messages', v_last);

  select i.display_name into v_id_name from public.user_identity i where i.uid = caller;
  v_name := coalesce(public._chat_clean_name(v_id_name), v_name);

  perform set_config('blox.meta_rpc', 'on', true);

  insert into public.group_meta_data (
    user_id, group_id,
    last_message, last_message_timestamp_ms,
    last_message_sender_id, last_message_sender_name,
    group_name, updated_at
  )
  select m, p_group_id,
         v_last, ts,
         caller, v_name,
         left(p_group_name, 100), now()
    from unnest(v_members) m
  on conflict (user_id, group_id) do update set
    last_message              = excluded.last_message,
    last_message_timestamp_ms = excluded.last_message_timestamp_ms,
    last_message_sender_id    = excluded.last_message_sender_id,
    last_message_sender_name  = excluded.last_message_sender_name,
    group_name                = coalesce(excluded.group_name, group_meta_data.group_name),
    updated_at                = now();

  update public.group_meta_data
     set unread_count = unread_count + 1,
         updated_at   = now()
   where group_id = p_group_id
     and user_id <> caller
     and user_id = any(v_members);

  perform set_config('blox.meta_rpc', '', true);
end $$;

-- 3f. upsert_group_meta_members — 034 body; "member" = verified member,
-- staff = Senior Mod+.
create or replace function public.upsert_group_meta_members(
  p_group_id     text,
  p_member_ids   text[],
  p_group_name   text    default null,
  p_group_avatar text    default null,
  p_member_count integer default null,
  p_created_by   text    default null,
  p_joined_at_ms bigint  default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  caller    text := public._chat_end_user_uid();
  v_members text[];
  v_n       integer;
begin
  if caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_group_id is null or p_group_id = '' then
    raise exception 'group_id required' using errcode = '22023';
  end if;
  if public._sender_ban_kind(caller) = 'ban' and public._chat_caller_link_tier() <> 'admin' then
    raise exception 'SENDER_BANNED'
      using errcode = 'check_violation', hint = 'This account is banned.';
  end if;

  select array_agg(distinct m) into v_members
    from unnest(coalesce(p_member_ids, '{}'::text[])) m
   where m is not null and m <> '';
  if v_members is null then
    return 0;
  end if;
  if array_length(v_members, 1) > 200 then
    raise exception 'too many members' using errcode = '22023';
  end if;

  if not public.is_group_member(p_group_id) and not public.is_group_staff() then
    raise exception 'NOT_ALLOWED'
      using errcode = 'check_violation', hint = 'Only group members can update other members'' group rows.';
  end if;

  perform set_config('blox.meta_rpc', 'on', true);
  insert into public.group_meta_data (
    user_id, group_id, group_name, group_avatar, member_count,
    created_by, joined_at_ms, unread_count, muted, updated_at
  )
  select m, p_group_id,
         left(p_group_name, 100),
         public._chat_clean_avatar(p_group_avatar),
         case when p_member_count between 0 and 1000 then p_member_count end,
         p_created_by,
         coalesce(p_joined_at_ms, (extract(epoch from now()) * 1000)::bigint),
         0, false, now()
    from unnest(v_members) m
  on conflict (user_id, group_id) do update set
    group_name   = coalesce(excluded.group_name,   group_meta_data.group_name),
    group_avatar = coalesce(excluded.group_avatar, group_meta_data.group_avatar),
    member_count = coalesce(excluded.member_count, group_meta_data.member_count),
    updated_at   = now();

  get diagnostics v_n = row_count;
  perform set_config('blox.meta_rpc', '', true);
  return v_n;
end $$;

-- 3g. increment_group_unread — 034 body, verified member or Senior Mod+.
create or replace function public.increment_group_unread(
  p_user_id  text,
  p_group_id text
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := public._chat_end_user_uid();
  v_n   int;
begin
  if v_uid is not null
     and not public.is_group_member(p_group_id)
     and not public.is_group_staff() then
    raise exception 'NOT_ALLOWED' using errcode = 'check_violation';
  end if;
  perform set_config('blox.meta_rpc', 'on', true);
  update public.group_meta_data
     set unread_count = unread_count + 1,
         updated_at   = now()
   where user_id  = p_user_id
     and group_id = p_group_id
   returning unread_count into v_n;
  perform set_config('blox.meta_rpc', '', true);
  return v_n;
end $$;

notify pgrst, 'reload schema';


-- =====================================================================
-- ROLLBACK (STEP 3) — reopens group reads exactly as before 044:
--   run 013_open_group_rules.sql; 010's is_group_member (section
--   "Membership helper"); 012's send_group_message; 034_steps/1_functions.sql
--   (fanout_group_message_meta, upsert_group_meta_members,
--   increment_group_unread blocks) and 034_steps/7_group_meta.sql.
-- STEP 2:  drop trigger trg_ab_group_scope on public.group_messages; and
--   re-run 034_steps/4_group_messages.sql (delete policy).
-- STEP 1 objects are inert on their own; group_members can stay.
-- =====================================================================
