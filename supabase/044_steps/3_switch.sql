-- 044 step 3 of 4 — run in the SQL editor as ONE query, in order.
-- Source: supabase/044_group_privacy.sql

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

-- 3e. fanout_group_message_meta — 034 body; caller check is _group_can_post,
-- the member list is cut to verified members once the group has rows, and
-- each member's row is written once instead of twice (see the insert).
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

  -- ONE write per member (034 wrote every non-sender row twice: the preview
  -- upsert, then a separate unread bump). Same result — new rows start at 1
  -- for everyone but the sender, existing rows go +1 — with half the row
  -- updates, WAL (replica identity full) and realtime events per message.
  insert into public.group_meta_data (
    user_id, group_id,
    last_message, last_message_timestamp_ms,
    last_message_sender_id, last_message_sender_name,
    group_name, unread_count, updated_at
  )
  select m, p_group_id,
         v_last, ts,
         caller, v_name,
         left(p_group_name, 100),
         case when m = caller then 0 else 1 end,
         now()
    from unnest(v_members) m
  on conflict (user_id, group_id) do update set
    last_message              = excluded.last_message,
    last_message_timestamp_ms = excluded.last_message_timestamp_ms,
    last_message_sender_id    = excluded.last_message_sender_id,
    last_message_sender_name  = excluded.last_message_sender_name,
    group_name                = coalesce(excluded.group_name, group_meta_data.group_name),
    unread_count              = group_meta_data.unread_count
                                  + case when excluded.user_id = caller then 0 else 1 end,
    updated_at                = now();

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
