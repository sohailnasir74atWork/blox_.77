-- 034 step 1 of 8 — run in the SQL editor as ONE query, in order.
-- Source: supabase/034_chat_moderation_enforcement.sql

-- =====================================================================
-- STEP 1 — Functions, message_reports, rpcs. Touches no hot table.
-- =====================================================================
set lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'banned_senders'
                    and column_name = 'type') then
    raise exception 'Run 033_mod_actions_evidence.sql first (banned_senders.type is missing)';
  end if;
end $$;

-- 1a. message_reports ------------------------------------------------------
-- One row per (message, reporter). Written only by report_message() and the
-- legacy shim inside guard_chat_message_update(); read by staff through
-- list_message_reports(). RLS on, no policies.
create table if not exists public.message_reports (
  id            uuid primary key default gen_random_uuid(),
  table_name    text not null check (table_name in ('messages', 'private_messages', 'group_messages')),
  message_id    uuid not null,
  reporter_uid  text not null,
  sender_uid    text,                       -- snapshot of the reported message's sender
  reason        text check (reason is null or char_length(reason) <= 500),
  created_at    timestamptz not null default now(),
  unique (table_name, message_id, reporter_uid)
);

create index if not exists idx_message_reports_created
  on public.message_reports (created_at desc);
create index if not exists idx_message_reports_reporter
  on public.message_reports (reporter_uid, created_at desc);
create index if not exists idx_message_reports_sender
  on public.message_reports (sender_uid, created_at desc)
  where sender_uid is not null;

alter table public.message_reports enable row level security;
revoke all on table public.message_reports from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.message_reports from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.message_reports from authenticated;
  end if;
end $$;

reset lock_timeout;

-- 1b. Who is the end user? -------------------------------------------------
-- request.jwt.claims as jsonb, NULL when absent/empty (cron, SQL editor,
-- plain connections). firebase_uid() casts '' straight to jsonb and throws;
-- these triggers fire on every write from every connection, so they must not.
create or replace function public._chat_jwt_claims()
returns jsonb
language sql
stable
set search_path = public
as $$
  select case
           when coalesce(current_setting('request.jwt.claims', true), '') = '' then null
           else current_setting('request.jwt.claims', true)::jsonb
         end;
$$;

-- Firebase uid of the end user, or NULL for service role / no JWT.
create or replace function public._chat_end_user_uid()
returns text
language sql
stable
set search_path = public
as $$
  select case
           when coalesce(c ->> 'role', '') = 'service_role' then null
           else nullif(coalesce(c ->> 'firebase_uid', c ->> 'sub'), '')
         end
    from (select public._chat_jwt_claims() as c) s;
$$;

-- Staff (JMD and above, owner emails). NULL-safe; false for non-end-users.
create or replace function public._chat_caller_is_staff()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public._chat_end_user_uid() is null then
    return false;
  end if;
  return coalesce(public.is_mod_staff(), false);   -- only reached with valid claims
end;
$$;

-- Link tier of the caller: 'admin' (isAdmin / owner email), 'bypass'
-- (canBypassModeration: senior mod, or moderator who is not JMD), 'user'.
create or replace function public._chat_caller_link_tier()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   text := public._chat_end_user_uid();
  v_email text;
  r       record;
begin
  if v_uid is null then
    return 'admin';                                  -- service role: unrestricted
  end if;
  v_email := lower(public._chat_jwt_claims() ->> 'email');
  if v_email in ('thesolanalabs@gmail.com', 'sohailnasir74business@gmail.com', 'sohailnasir74@gmail.com') then
    return 'admin';
  end if;
  select coalesce(ur.is_admin, false)     as is_admin,
         coalesce(ur.is_cmsr, false)      as is_cmsr,
         coalesce(ur.is_moderator, false) as is_moderator,
         coalesce(ur.is_baby_mod, false)  as is_baby_mod
    into r
    from public.user_roles ur
   where ur.uid = v_uid;
  if not found then
    return 'user';
  end if;
  if r.is_admin then
    return 'admin';
  end if;
  if r.is_cmsr or (r.is_moderator and not r.is_baby_mod) then
    return 'bypass';
  end if;
  return 'user';
end;
$$;

-- 1c. Bans ------------------------------------------------------------------
-- 'ban' | 'mute' | NULL for an active banned_senders row. Legacy rows with no
-- type are mutes iff the reason says so (contract §3 isMuteRecord rule).
create or replace function public._sender_ban_kind(p_uid text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when b.type = 'mute' then 'mute'
           when b.type is null and coalesce(b.reason, '') ~* '^muted for' then 'mute'
           else 'ban'
         end
    from public.banned_senders b
   where b.uid = p_uid
     and (b.banned_until is null or b.banned_until > now())
   limit 1;
$$;

-- What blocks the CALLER: 'ban' | 'mute' | NULL (not banned, admin/owner, or
-- not an end user). Callable by the app: it only ever answers about the caller.
create or replace function public.caller_chat_ban_kind()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  text := public._chat_end_user_uid();
  v_kind text;
begin
  if v_uid is null then
    return null;
  end if;
  v_kind := public._sender_ban_kind(v_uid);
  if v_kind is null then
    return null;                                     -- normal path: one pk probe
  end if;
  -- Admins / owner emails only (the app's own gate is `isUserBlocked &&
  -- !isAdmin` in every build). Banned or muted mods, senior mods and JMDs
  -- are blocked like anyone else: only admins/owner may sanction staff.
  if public._chat_caller_link_tier() = 'admin' then
    return null;
  end if;
  return v_kind;
end;
$$;

-- 1d. Link helpers ([.] instead of \. so standard_conforming_strings is moot) --
create or replace function public.chat_text_has_link(p_text text)
returns boolean
language sql
immutable
as $$
  select coalesce(
    p_text ~* '(https?://|www[.]|[.](com|net|org|io|co|me|xyz|dev|app|tech|tv|gg|link|click|online|site|website|web|blog|shop|store|buy|sale|deal))',
    false);
$$;

-- Trader.jsx LINK_REGEX up to 4.0.12: /(https?:\/\/[^\s]+)/i. 4.0.14 also
-- blocks bare www. for mods, but 4.0.12 (production) lets mods send it, so the
-- server allows what any shipped build allows: only http(s):// is blocked.
create or replace function public.chat_text_has_url(p_text text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_text ~* 'https?://[^[:space:]]', false);
$$;

create or replace function public.chat_text_has_allowed_link(p_text text)
returns boolean
language sql
immutable
as $$
  select coalesce(
    p_text ~* '(https?://)?(www[.])?(youtube[.]com|youtu[.]be)/|(https?://)?(www[.])?tiktok[.]com/|(https?://)?vm[.]tiktok[.]com/',
    false);
$$;

-- Raises LINKS_NOT_ALLOWED when the caller may not send p_text to p_table.
create or replace function public._chat_check_links(p_table text, p_text text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tier text;
begin
  if p_text is null or p_text = '' or not public.chat_text_has_link(p_text) then
    return;                                          -- no link: no role lookup
  end if;
  v_tier := public._chat_caller_link_tier();
  if v_tier = 'admin' then
    return;
  end if;
  if p_table = 'messages' then
    if v_tier = 'bypass' and not public.chat_text_has_url(p_text) then
      return;                                        -- mods: only http(s):// blocked
    end if;
  elsif p_table = 'group_messages' then
    if v_tier = 'bypass' or public.chat_text_has_allowed_link(p_text) then
      return;
    end if;
  else                                               -- private_messages
    if v_tier = 'bypass' then
      return;
    end if;
  end if;
  raise exception 'LINKS_NOT_ALLOWED'
    using errcode = 'check_violation',
          hint = 'Links are not allowed in this chat.';
end;
$$;

-- Did an UPDATE change what the row says or shows? to_jsonb(row) -> missing
-- column is NULL on both sides, so one function serves every table.
create or replace function public._chat_content_changed(p_old jsonb, p_new jsonb)
returns boolean
language sql
immutable
as $$
  select (p_old -> 'text')          is distinct from (p_new -> 'text')
      or (p_old -> 'gif')           is distinct from (p_new -> 'gif')
      or (p_old -> 'image_url')     is distinct from (p_new -> 'image_url')
      or (p_old -> 'fruits')        is distinct from (p_new -> 'fruits')
      or (p_old -> 'reply_to')      is distinct from (p_new -> 'reply_to')
      or (p_old -> 'sender_id')     is distinct from (p_new -> 'sender_id')
      or (p_old -> 'sender_name')   is distinct from (p_new -> 'sender_name')
      or (p_old -> 'sender_avatar') is distinct from (p_new -> 'sender_avatar')
      or (p_old -> 'user_id')       is distinct from (p_new -> 'user_id')
      or (p_old -> 'option_index')  is distinct from (p_new -> 'option_index');
$$;

create or replace function public._report_threshold()
returns integer
language sql
immutable
as $$ select 10 $$;                                  -- REPORT_THRESHOLD in the backends

-- 1e. Trigger functions ------------------------------------------------------
create or replace function public.enforce_chat_ban()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
begin
  -- Nested, not AND-ed: no short-circuit guarantee, and OLD is NULL on INSERT.
  if tg_op = 'UPDATE' then
    if not public._chat_content_changed(to_jsonb(old), to_jsonb(new)) then
      return new;                                    -- soft delete, report, …
    end if;
  end if;

  v_kind := public.caller_chat_ban_kind();
  if v_kind is null then
    return new;
  end if;
  if v_kind = 'mute' and tg_table_name in ('poll_comments', 'poll_votes') then
    return new;                                      -- mutes are chat-only
  end if;

  raise exception 'SENDER_BANNED'
    using errcode = 'check_violation',
          hint = 'This account is banned from sending messages.';
end;
$$;

create or replace function public.enforce_chat_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.text is not distinct from old.text then
      return new;
    end if;
  end if;
  if public._chat_end_user_uid() is null then
    return new;                                      -- service role / cron / editor
  end if;
  perform public._chat_check_links(tg_table_name, new.text);
  return new;
end;
$$;

-- Records one report. TRUE when a new row went in. p_strict (the rpc) raises
-- on refusal; the legacy shim gets FALSE instead and turns it into a no-op.
create or replace function public._record_message_report(
  p_table      text,
  p_message_id uuid,
  p_reporter   text,
  p_sender     text,
  p_reason     text,
  p_strict     boolean
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
begin
  if p_reporter is null or p_message_id is null then
    return false;
  end if;

  if public._sender_ban_kind(p_reporter) = 'ban' and public._chat_caller_link_tier() <> 'admin' then
    if p_strict then
      raise exception 'SENDER_BANNED'
        using errcode = 'check_violation', hint = 'Banned accounts cannot report.';
    end if;
    return false;
  end if;

  if p_sender is not distinct from p_reporter then
    if p_strict then
      raise exception 'NOT_ALLOWED'
        using errcode = 'check_violation', hint = 'You cannot report your own message.';
    end if;
    return false;
  end if;

  -- Rate-limit sanity: 30 reports per reporter per 10 minutes.
  select count(*) into v_recent
    from public.message_reports
   where reporter_uid = p_reporter
     and created_at > now() - interval '10 minutes';
  if v_recent >= 30 then
    if p_strict then
      raise exception 'NOT_ALLOWED'
        using errcode = 'check_violation', hint = 'Too many reports. Try again later.';
    end if;
    return false;
  end if;

  insert into public.message_reports (table_name, message_id, reporter_uid, sender_uid, reason)
  values (p_table, p_message_id, p_reporter, p_sender,
          nullif(left(btrim(coalesce(p_reason, '')), 500), ''))
  on conflict (table_name, message_id, reporter_uid) do nothing;

  return found;
end;
$$;

-- BEFORE UPDATE on messages / private_messages / group_messages.
create or replace function public.guard_chat_message_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text;
  v_old      jsonb;
  v_new      jsonb;
  v_changed  text[];
  v_recorded boolean;
  c_report   constant text[] := array['report_count', 'deleted', 'deleted_at', 'deleted_by'];
  c_locked   constant text[] := array['id', 'sender_id', 'recipient_id', 'room_id', 'chat_id',
                                      'group_id', 'created_at', 'client_msg_id', 'rtdb_key',
                                      'origin', 'report_count'];
begin
  -- report_message() sets this transaction-local flag around its own UPDATE.
  if coalesce(current_setting('blox.report_rpc', true), '') = 'on' then
    return new;
  end if;

  v_uid := public._chat_end_user_uid();
  if v_uid is null then
    return new;                                      -- service role / cron / editor
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  select coalesce(array_agg(k), '{}'::text[]) into v_changed
    from jsonb_object_keys(v_new) as k
   where (v_new -> k) is distinct from (v_old -> k);
  if cardinality(v_changed) = 0 then
    return new;
  end if;

  -- Legacy report shim (every shipped build reports with a direct UPDATE).
  if 'report_count' = any(v_changed) and v_changed <@ c_report then
    v_recorded := public._record_message_report(
      tg_table_name, old.id, v_uid, old.sender_id, 'legacy_client', false);
    new.report_count := old.report_count + case when v_recorded then 1 else 0 end;
    new.deleted      := old.deleted;
    new.deleted_at   := old.deleted_at;
    new.deleted_by   := old.deleted_by;
    if v_recorded and not old.deleted and new.report_count >= public._report_threshold() then
      new.deleted    := true;
      new.deleted_at := now();
      new.deleted_by := 'system:reports';
    end if;
    return new;
  end if;

  if public._chat_caller_is_staff() then
    if 'report_count' = any(v_changed) then
      raise exception 'NOT_ALLOWED'
        using errcode = 'check_violation', hint = 'report_count changes only through report_message().';
    end if;
  else
    if v_uid is distinct from old.sender_id then
      raise exception 'NOT_ALLOWED'
        using errcode = 'check_violation', hint = 'Only the sender or staff can change this message.';
    end if;
    if v_changed && c_locked then
      raise exception 'NOT_ALLOWED'
        using errcode = 'check_violation', hint = 'These message fields cannot be changed.';
    end if;
    if old.deleted and not new.deleted then
      raise exception 'NOT_ALLOWED'
        using errcode = 'check_violation', hint = 'A deleted message cannot be restored.';
    end if;
  end if;

  -- Deletion audit is stamped by the server, never trusted from the client.
  if new.deleted and not old.deleted then
    new.deleted_by := v_uid;
    new.deleted_at := now();
  elsif new.deleted = old.deleted then
    new.deleted_by := old.deleted_by;
    new.deleted_at := old.deleted_at;
  end if;

  return new;
end;
$$;

-- 1f. report_message — the one way to report (contract §8) ------------------
-- One report per reporter per message; returns the message's report_count
-- after the call (unchanged for a duplicate). Soft-deletes the message when
-- the count reaches 10 (same as the backends' REPORT_THRESHOLD).
create or replace function public.report_message(
  p_table      text,
  p_message_id uuid,
  p_reason     text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       text := public._chat_end_user_uid();
  v_sender    text;
  v_recipient text;
  v_count     integer;
  v_deleted   boolean;
  v_new       integer;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_table is null or p_table not in ('messages', 'private_messages', 'group_messages') then
    raise exception 'invalid table' using errcode = '22023';
  end if;
  if p_message_id is null then
    raise exception 'message_id required' using errcode = '22023';
  end if;

  -- Lock the row: concurrent reporters serialise on it, so the count is exact.
  if p_table = 'messages' then
    select sender_id, null::text, report_count, deleted
      into v_sender, v_recipient, v_count, v_deleted
      from public.messages where id = p_message_id for update;
  elsif p_table = 'private_messages' then
    select sender_id, recipient_id, report_count, deleted
      into v_sender, v_recipient, v_count, v_deleted
      from public.private_messages where id = p_message_id for update;
  else
    select sender_id, null::text, report_count, deleted
      into v_sender, v_recipient, v_count, v_deleted
      from public.group_messages where id = p_message_id for update;
  end if;

  if not found
     or (p_table = 'private_messages'
         and v_uid is distinct from v_sender
         and v_uid is distinct from v_recipient
         and not public._chat_caller_is_staff()) then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if not public._record_message_report(p_table, p_message_id, v_uid, v_sender, p_reason, true) then
    return coalesce(v_count, 0);                     -- already reported by this caller
  end if;

  v_new := coalesce(v_count, 0) + 1;

  perform set_config('blox.report_rpc', 'on', true);
  execute format(
    'update public.%I
        set report_count = $1,
            deleted      = deleted or $2,
            deleted_at   = case when not deleted and $2 then now() else deleted_at end,
            deleted_by   = case when not deleted and $2 then ''system:reports'' else deleted_by end
      where id = $3', p_table)
    using v_new, (v_new >= public._report_threshold()), p_message_id;
  perform set_config('blox.report_rpc', '', true);

  return v_new;
end;
$$;

-- 1g. list_message_reports — staff dashboard (one row per reported message) --
create or replace function public.list_message_reports(
  p_limit  integer default 50,
  p_before timestamptz default null
) returns table (
  table_name        text,
  message_id        uuid,
  sender_uid        text,
  location_id       text,           -- room_id / chat_id / group_id
  message_text      text,
  message_image_url text,
  message_gif       text,
  message_deleted   boolean,
  report_count      integer,        -- the message's counter (includes pre-034 reports)
  reports_recorded  bigint,         -- rows in message_reports
  last_reported_at  timestamptz,
  reports           jsonb           -- newest 20: [{reporter_uid, reason, created_at}]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  if not public._chat_caller_is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    with g as (
      select r.table_name                     as t,
             r.message_id                     as mid,
             max(r.sender_uid)                as sender,
             count(*)                         as n,
             max(r.created_at)                as last_at,
             (array_agg(jsonb_build_object('reporter_uid', r.reporter_uid,
                                           'reason',       r.reason,
                                           'created_at',   r.created_at)
                        order by r.created_at desc))[1:20] as reps
        from public.message_reports r
       group by r.table_name, r.message_id
      having p_before is null or max(r.created_at) < p_before
       order by max(r.created_at) desc
       limit v_limit
    )
    select g.t, g.mid,
           coalesce(g.sender, m.sender_id, pm.sender_id, gm.sender_id),
           coalesce(m.room_id, pm.chat_id, gm.group_id),
           coalesce(m.text, pm.text, gm.text),
           coalesce(pm.image_url, gm.image_url),
           m.gif,
           coalesce(m.deleted, pm.deleted, gm.deleted),
           coalesce(m.report_count, pm.report_count, gm.report_count),
           g.n, g.last_at, to_jsonb(g.reps)
      from g
      left join public.messages         m  on g.t = 'messages'         and m.id  = g.mid
      left join public.private_messages pm on g.t = 'private_messages' and pm.id = g.mid
      left join public.group_messages   gm on g.t = 'group_messages'   and gm.id = g.mid
     order by g.last_at desc;
end;
$$;

-- 1h. Chat-meta rpcs (signatures unchanged — shipped builds call them) -------
create or replace function public._chat_clean_name(p_name text)
returns text
language sql
immutable
as $$
  select nullif(left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g')), 60), '');
$$;

create or replace function public._chat_clean_avatar(p_url text)
returns text
language sql
immutable
as $$
  select case
           when p_url ~* '^https?://[^[:space:]]+$' and char_length(p_url) <= 2048 then p_url
         end;
$$;

-- 011 + ban check, link check on the preview, server-side sender identity,
-- sanitised names/avatars. Writes are still keyed off the caller's own uid.
create or replace function public.send_private_chat_meta(
  p_partner_uid     text,
  p_last_message    text,
  p_timestamp_ms    bigint,
  p_sender_name     text default null,
  p_sender_avatar   text default null,
  p_receiver_name   text default null,
  p_receiver_avatar text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller        text := public.firebase_uid();
  pair_id       text;
  v_last        text := left(p_last_message, 1000);
  v_sender_name text := public._chat_clean_name(p_sender_name);
  v_sender_av   text := public._chat_clean_avatar(p_sender_avatar);
  v_id_name     text;
  v_id_avatar   text;
begin
  if caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_partner_uid is null or p_partner_uid = '' then
    raise exception 'partner_uid required' using errcode = '22023';
  end if;
  if caller = p_partner_uid then
    raise exception 'cannot send chat meta to self' using errcode = '22023';
  end if;
  if public.caller_chat_ban_kind() is not null then
    raise exception 'SENDER_BANNED'
      using errcode = 'check_violation', hint = 'This account is banned from sending messages.';
  end if;
  perform public._chat_check_links('private_messages', v_last);

  -- The partner's row shows the CALLER's name/avatar: prefer the server copy.
  select i.display_name, i.avatar into v_id_name, v_id_avatar
    from public.user_identity i where i.uid = caller;
  v_sender_name := coalesce(public._chat_clean_name(v_id_name), v_sender_name);
  v_sender_av   := coalesce(public._chat_clean_avatar(v_id_avatar), v_sender_av);

  pair_id := case when caller < p_partner_uid
                  then caller || '_' || p_partner_uid
                  else p_partner_uid || '_' || caller
             end;

  insert into public.chat_meta_data (
    owner_uid, partner_uid, chat_id, receiver_id,
    last_message, timestamp_ms, unread_count,
    receiver_name, receiver_avatar, updated_at
  ) values (
    caller, p_partner_uid, pair_id, p_partner_uid,
    v_last, p_timestamp_ms, 0,
    public._chat_clean_name(p_receiver_name), public._chat_clean_avatar(p_receiver_avatar), now()
  )
  on conflict (owner_uid, partner_uid) do update set
    last_message    = excluded.last_message,
    timestamp_ms    = excluded.timestamp_ms,
    receiver_name   = coalesce(excluded.receiver_name, chat_meta_data.receiver_name),
    receiver_avatar = coalesce(excluded.receiver_avatar, chat_meta_data.receiver_avatar),
    updated_at      = now();

  insert into public.chat_meta_data (
    owner_uid, partner_uid, chat_id, receiver_id,
    last_message, timestamp_ms, unread_count,
    receiver_name, receiver_avatar, updated_at
  ) values (
    p_partner_uid, caller, pair_id, caller,
    v_last, p_timestamp_ms, 1,
    v_sender_name, v_sender_av, now()
  )
  on conflict (owner_uid, partner_uid) do update set
    last_message    = excluded.last_message,
    timestamp_ms    = excluded.timestamp_ms,
    unread_count    = chat_meta_data.unread_count + 1,
    receiver_name   = coalesce(excluded.receiver_name, chat_meta_data.receiver_name),
    receiver_avatar = coalesce(excluded.receiver_avatar, chat_meta_data.receiver_avatar),
    updated_at      = now();
end $$;

-- 014 + ban check; sender forced to the caller (p_sender_id is ignored);
-- caller must be in p_member_ids or staff (mods post in groups they are not
-- in); ≤ 200 distinct members; preview link-checked like a group message.
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
  if not (caller = any(v_members)) and not public._chat_caller_is_staff() then
    raise exception 'NOT_ALLOWED'
      using errcode = 'check_violation', hint = 'Only group members can fan out group messages.';
  end if;
  perform public._chat_check_links('group_messages', v_last);

  select i.display_name into v_id_name from public.user_identity i where i.uid = caller;
  v_name := coalesce(public._chat_clean_name(v_id_name), v_name);

  -- guard_group_meta_write() lets this rpc set other members' preview/unread.
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

-- Cross-user group_meta_data writes the app needs (approveJoinRequest creates
-- the requester's row; rename / avatar change update every member's row).
-- New builds use this; old builds' direct upserts get the same limits from
-- STEP 7 + guard_group_meta_write(). Caller must already have their
-- own row for the group (is_group_member) or be staff. Never touches another
-- user's unread_count / muted / last_read_at. Returns rows written.
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

  if not exists (select 1 from public.group_meta_data g
                  where g.user_id = caller and g.group_id = p_group_id)
     and not public._chat_caller_is_staff() then
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

-- 008's unread bumps: no longer callable by anon, and scoped to the caller.
-- (No shipped build calls them any more — 011/014 do the bump — so this
-- only closes the "bump anyone's badge" hole.)
create or replace function public.increment_chat_unread(
  p_owner_uid   text,
  p_partner_uid text
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := public._chat_end_user_uid();
  v_n   int;
begin
  -- Only the sender (the receiver row's partner) may bump the receiver.
  if v_uid is not null and v_uid is distinct from p_partner_uid
     and not public._chat_caller_is_staff() then
    raise exception 'NOT_ALLOWED' using errcode = 'check_violation';
  end if;
  update public.chat_meta_data
     set unread_count = unread_count + 1,
         updated_at   = now()
   where owner_uid   = p_owner_uid
     and partner_uid = p_partner_uid
   returning unread_count into v_n;
  return v_n;
end $$;

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
     and not exists (select 1 from public.group_meta_data g
                      where g.user_id = v_uid and g.group_id = p_group_id)
     and not public._chat_caller_is_staff() then
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

-- 1h2. guard_group_meta_write — BEFORE INSERT OR UPDATE on group_meta_data.
-- Own row: untouched (unread reset, mute, createGroup / accept invite).
-- Another member's row (old builds' approveJoinRequest / rename / avatar
-- upserts; RLS in STEP 7 already requires the caller to be a member or
-- staff): only group_name / group_avatar / member_count change; a NEW row may
-- also carry created_by / joined_at_ms. Per-user state is forced to defaults
-- on insert and kept on update — silently, so old builds' payloads (which
-- include unread_count: 0, muted: false) still succeed.
-- The fan-out / unread rpcs set blox.meta_rpc and pass through.
create or replace function public.guard_group_meta_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
begin
  if coalesce(current_setting('blox.meta_rpc', true), '') = 'on' then
    return new;
  end if;
  v_uid := public._chat_end_user_uid();
  if v_uid is null then
    return new;                                      -- service role / cron / editor
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id or new.group_id is distinct from old.group_id then
      raise exception 'NOT_ALLOWED'
        using errcode = 'check_violation', hint = 'Group rows cannot be moved.';
    end if;
  end if;

  if new.user_id = v_uid then
    return new;                                      -- own row
  end if;

  if public._sender_ban_kind(v_uid) = 'ban' and public._chat_caller_link_tier() <> 'admin' then
    raise exception 'SENDER_BANNED'
      using errcode = 'check_violation', hint = 'This account is banned.';
  end if;

  new.group_name   := left(new.group_name, 100);
  new.group_avatar := public._chat_clean_avatar(new.group_avatar);
  if new.member_count is not null and new.member_count not between 0 and 1000 then
    new.member_count := null;
  end if;

  if tg_op = 'INSERT' then
    new.unread_count              := 0;
    new.muted                     := false;
    new.last_read_at_ms           := null;
    new.last_message              := null;
    new.last_message_timestamp_ms := null;
    new.last_message_sender_id    := null;
    new.last_message_sender_name  := null;
    new.joined_at_ms := coalesce(new.joined_at_ms, (extract(epoch from now()) * 1000)::bigint);
  else
    new.group_name                := coalesce(new.group_name,   old.group_name);
    new.group_avatar              := coalesce(new.group_avatar, old.group_avatar);
    new.member_count              := coalesce(new.member_count, old.member_count);
    new.unread_count              := old.unread_count;
    new.muted                     := old.muted;
    new.last_read_at_ms           := old.last_read_at_ms;
    new.last_message              := old.last_message;
    new.last_message_timestamp_ms := old.last_message_timestamp_ms;
    new.last_message_sender_id    := old.last_message_sender_id;
    new.last_message_sender_name  := old.last_message_sender_name;
    new.joined_at_ms              := old.joined_at_ms;
    new.created_by                := old.created_by;
  end if;
  return new;
end;
$$;

-- 1i. Grants -----------------------------------------------------------------
-- Supabase grants EXECUTE on new public functions to PUBLIC/anon by default.
-- Internals and trigger functions: nobody but the definer (triggers and
-- SECURITY DEFINER callers reach them as the owner). Client-facing rpcs:
-- authenticated only.
do $$
declare
  v_fn   text;
  v_role text;
begin
  foreach v_fn in array array[
    'public._chat_jwt_claims()',
    'public._chat_end_user_uid()',
    'public._chat_caller_is_staff()',
    'public._chat_caller_link_tier()',
    'public._sender_ban_kind(text)',
    'public.caller_chat_ban_kind()',
    'public.chat_text_has_link(text)',
    'public.chat_text_has_url(text)',
    'public.chat_text_has_allowed_link(text)',
    'public._chat_check_links(text, text)',
    'public._chat_content_changed(jsonb, jsonb)',
    'public._report_threshold()',
    'public.enforce_chat_ban()',
    'public.enforce_chat_links()',
    'public._record_message_report(text, uuid, text, text, text, boolean)',
    'public.guard_chat_message_update()',
    'public.guard_group_meta_write()',
    'public.report_message(text, uuid, text)',
    'public.list_message_reports(integer, timestamptz)',
    'public._chat_clean_name(text)',
    'public._chat_clean_avatar(text)',
    'public.send_private_chat_meta(text, text, bigint, text, text, text, text)',
    'public.fanout_group_message_meta(text, text[], text, text, text, bigint, text)',
    'public.upsert_group_meta_members(text, text[], text, text, integer, text, bigint)',
    'public.increment_chat_unread(text, text)',
    'public.increment_group_unread(text, text)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    foreach v_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = v_role) then
        execute format('revoke all on function %s from %I', v_fn, v_role);
      end if;
    end loop;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach v_fn in array array[
      'public.caller_chat_ban_kind()',
      'public.chat_text_has_link(text)',
      'public.chat_text_has_url(text)',
      'public.chat_text_has_allowed_link(text)',
      'public.report_message(text, uuid, text)',
      'public.list_message_reports(integer, timestamptz)',
      'public.send_private_chat_meta(text, text, bigint, text, text, text, text)',
      'public.fanout_group_message_meta(text, text[], text, text, text, bigint, text)',
      'public.upsert_group_meta_members(text, text[], text, text, integer, text, bigint)',
      'public.increment_chat_unread(text, text)',
      'public.increment_group_unread(text, text)'
    ] loop
      execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
  end if;
end
$$;

notify pgrst, 'reload schema';
