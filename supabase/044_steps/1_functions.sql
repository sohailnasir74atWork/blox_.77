-- 044 step 1 of 3 — run in the SQL editor as ONE query, in order.
-- Source: supabase/044_group_privacy.sql

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
