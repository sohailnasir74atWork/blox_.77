-- =====================================================================
-- 061_chat_schedules.sql (Blox Fruits, 2026-11-03) — scheduled public-chat
-- messages from the "Announcements" bot
--
-- Senior Mods and Admins (is_senior_mod_staff(), 047) create schedules in
-- Admin Dashboard ▸ Content ▸ Scheduled messages. A schedule has one text
-- per public room (each language channel gets its own text), a start time,
-- an optional repeat interval and a stop rule. pg_cron runs
-- chat_schedules_tick() every minute; it inserts the due messages into
-- public.messages as the bot (sender_id 'announcements_bot'), so every
-- build sees them through the normal Realtime stream.
--
-- Spam guard (a function posting every 3 min for two months happened here
-- before — Ops/STATUS hazards): every schedule MUST end. Either end_at or
-- max_runs is required, end_at is at most 60 days after start_at, max_runs
-- at most 500, and the interval is at least 10 minutes. Missed ticks (cron
-- down) never post a backlog: the next run jumps to the next future slot.
--
-- Bot identity: user_identity_base row ('Announcements') so every build
-- shows the name; user_roles.custom_title 'BOT' so every build shows the
-- chip (functions/reconcileRolesMirror.js skips this uid, else it clears
-- the title every 6 h: the bot has no RTDB /users record). Builds from
-- 2026-11-03 also hard-code the chip and do not open a profile for it
-- (Code/Helper/chatBot.js).
--
-- The tick inserts as the table owner with no JWT, so the slow-mode and
-- word-filter triggers let it through (_chat_end_user_uid() is null) and
-- RLS does not apply. Touches no hot path: a few rows a minute at most.
--
-- Needs 001 (rooms, messages), 005 (client_msg_id), 029
-- (user_identity_base), 045 (custom_title), 047 (is_senior_mod_staff),
-- pg_cron (already used by 026 / 051). Safe to run more than once.
-- Rollback at the bottom.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.is_senior_mod_staff()') is null then
    raise exception 'Run 047_mod_powers.sql first';
  end if;
  if to_regclass('public.user_identity_base') is null then
    raise exception 'Run 029_mask_user_identity_pii.sql first';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- STEP 1 — table
-- messages: [{ "room_id": "chat_es_upgrade", "text": "..." }, ...], one
-- per room, 1..20 entries, each text 1..500 chars (checked in the save rpc).
-- ---------------------------------------------------------------------
create table if not exists public.chat_schedules (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (char_length(title) between 1 and 80),
  messages          jsonb not null,
  start_at          timestamptz not null,
  interval_minutes  integer check (interval_minutes is null or interval_minutes between 10 and 10080),
  end_at            timestamptz,
  max_runs          integer check (max_runs is null or max_runs between 1 and 500),
  runs_done         integer not null default 0,
  next_run_at       timestamptz,               -- null = finished
  active            boolean not null default true,
  last_run_at       timestamptz,
  last_error        text,
  created_by        text,                      -- Firebase uid
  created_by_name   text,
  updated_by        text,
  updated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  constraint chat_schedules_must_end check (end_at is not null or max_runs is not null or interval_minutes is null),
  constraint chat_schedules_end_after_start check (end_at is null or end_at >= start_at),
  constraint chat_schedules_max_span check (end_at is null or end_at <= start_at + interval '60 days')
);

create index if not exists idx_chat_schedules_due
  on public.chat_schedules (next_run_at)
  where active and next_run_at is not null;

alter table public.chat_schedules enable row level security;
revoke all on public.chat_schedules from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.chat_schedules from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.chat_schedules from authenticated;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- STEP 2 — bot identity
-- ---------------------------------------------------------------------
insert into public.user_identity_base (uid, display_name, avatar)
values ('announcements_bot', 'Announcements', null)
on conflict (uid) do update set display_name = excluded.display_name;

insert into public.user_roles (uid, custom_title)
values ('announcements_bot', 'BOT')
on conflict (uid) do update set custom_title = 'BOT';


-- ---------------------------------------------------------------------
-- STEP 3 — helpers + rpcs
-- ---------------------------------------------------------------------

-- First slot at or after p_now (start_at + k * interval). One-shot
-- schedules (no interval) have only start_at.
create or replace function public._chat_schedule_next_slot(
  p_start timestamptz, p_interval integer, p_after timestamptz)
returns timestamptz
language sql
immutable
as $$
  select case
    when p_interval is null then p_start
    when p_after <= p_start then p_start
    else p_start + make_interval(mins => p_interval)
         * ceil(extract(epoch from (p_after - p_start)) / (p_interval * 60))::integer
  end;
$$;

-- Null when the schedule has nothing left to post at or after p_slot.
create or replace function public._chat_schedule_live_slot(
  s public.chat_schedules, p_slot timestamptz)
returns timestamptz
language sql
immutable
as $$
  select case
    when s.max_runs is not null and s.runs_done >= s.max_runs then null
    when s.interval_minutes is null and s.runs_done >= 1 then null
    when s.end_at is not null and p_slot > s.end_at then null
    else p_slot
  end;
$$;

-- Row -> json for the dashboard.
create or replace function public._chat_schedule_json(s public.chat_schedules)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', s.id, 'title', s.title, 'messages', s.messages,
    'start_at', s.start_at, 'interval_minutes', s.interval_minutes,
    'end_at', s.end_at, 'max_runs', s.max_runs, 'runs_done', s.runs_done,
    'next_run_at', s.next_run_at, 'active', s.active,
    'last_run_at', s.last_run_at, 'last_error', s.last_error,
    'created_by', s.created_by, 'created_by_name', s.created_by_name,
    'updated_at', s.updated_at, 'created_at', s.created_at);
$$;

-- chat_schedules_list() -> { rooms: [{id,label}], rows: [...] }
create or replace function public.chat_schedules_list()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_senior_mod_staff() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'label', r.label)
                                        order by r.category, r.created_at, r.id)
                         from public.rooms r), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(public._chat_schedule_json(s)
                                       order by s.active desc, s.next_run_at nulls last, s.created_at desc)
                        from (select * from public.chat_schedules
                               order by created_at desc limit 200) s), '[]'::jsonb));
end;
$$;

-- chat_schedule_save(p) — create (p.id null) or edit. p: { id?, title,
-- messages:[{room_id,text}], start_at, interval_minutes?, end_at?,
-- max_runs?, active?, by_name? }. Editing resets runs_done only when the
-- start time changes. Errors (22023): BAD_TITLE, BAD_MESSAGES, BAD_ROOM,
-- BAD_TEXT, BAD_START, BAD_INTERVAL, MUST_END, BAD_END, BAD_MAX_RUNS,
-- NOT_FOUND.
create or replace function public.chat_schedule_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text := public.firebase_uid();
  v_id       uuid := nullif(p ->> 'id', '')::uuid;
  v_title    text := btrim(coalesce(p ->> 'title', ''));
  v_msgs     jsonb := p -> 'messages';
  v_clean    jsonb := '[]'::jsonb;
  v_start    timestamptz := nullif(p ->> 'start_at', '')::timestamptz;
  v_interval integer := nullif(p ->> 'interval_minutes', '')::integer;
  v_end      timestamptz := nullif(p ->> 'end_at', '')::timestamptz;
  v_max      integer := nullif(p ->> 'max_runs', '')::integer;
  v_active   boolean := coalesce((p ->> 'active')::boolean, true);
  v_old      public.chat_schedules;
  v_row      public.chat_schedules;
  m          jsonb;
  v_room     text;
  v_text     text;
  v_seen     text[] := '{}';
begin
  if not public.is_senior_mod_staff() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if char_length(v_title) not between 1 and 80 then
    raise exception 'BAD_TITLE' using errcode = '22023';
  end if;
  if jsonb_typeof(v_msgs) is distinct from 'array'
     or jsonb_array_length(v_msgs) not between 1 and 20 then
    raise exception 'BAD_MESSAGES' using errcode = '22023';
  end if;
  for m in select * from jsonb_array_elements(v_msgs) loop
    v_room := m ->> 'room_id';
    v_text := btrim(coalesce(m ->> 'text', ''));
    if v_room is null or v_room = any(v_seen)
       or not exists (select 1 from public.rooms r where r.id = v_room) then
      raise exception 'BAD_ROOM' using errcode = '22023', detail = coalesce(v_room, '');
    end if;
    if char_length(v_text) not between 1 and 500 then
      raise exception 'BAD_TEXT' using errcode = '22023', detail = v_room;
    end if;
    v_seen := v_seen || v_room;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('room_id', v_room, 'text', v_text));
  end loop;

  if v_id is not null then
    select * into v_old from public.chat_schedules where id = v_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = '22023';
    end if;
  end if;

  -- A new schedule cannot start in the past (5 min grace for clock skew);
  -- an edit may keep its old start.
  if v_start is null
     or (v_start < now() - interval '5 minutes'
         and (v_old.id is null or v_start is distinct from v_old.start_at)) then
    raise exception 'BAD_START' using errcode = '22023';
  end if;
  if v_start > now() + interval '90 days' then
    raise exception 'BAD_START' using errcode = '22023';
  end if;
  if v_interval is not null and v_interval not between 10 and 10080 then
    raise exception 'BAD_INTERVAL' using errcode = '22023';
  end if;
  if v_interval is not null and v_end is null and v_max is null then
    raise exception 'MUST_END' using errcode = '22023';
  end if;
  if v_end is not null and (v_end < v_start or v_end > v_start + interval '60 days') then
    raise exception 'BAD_END' using errcode = '22023';
  end if;
  if v_max is not null and v_max not between 1 and 500 then
    raise exception 'BAD_MAX_RUNS' using errcode = '22023';
  end if;
  if v_interval is null then
    v_end := null;
    v_max := null;
  end if;

  if v_old.id is null then
    insert into public.chat_schedules (title, messages, start_at, interval_minutes, end_at,
                                       max_runs, active, created_by, created_by_name, updated_by)
    values (v_title, v_clean, v_start, v_interval, v_end, v_max, v_active,
            v_uid, left(nullif(btrim(p ->> 'by_name'), ''), 60), v_uid)
    returning * into v_row;
  else
    update public.chat_schedules
       set title = v_title, messages = v_clean, start_at = v_start,
           interval_minutes = v_interval, end_at = v_end, max_runs = v_max,
           active = v_active, updated_by = v_uid, updated_at = now(), last_error = null,
           runs_done = case when v_start is distinct from v_old.start_at then 0 else runs_done end
     where id = v_id
    returning * into v_row;
  end if;

  update public.chat_schedules s
     set next_run_at = public._chat_schedule_live_slot(
           s, public._chat_schedule_next_slot(s.start_at, s.interval_minutes,
                case when s.runs_done = 0 then s.start_at else now() end))
   where s.id = v_row.id
  returning * into v_row;
  if v_row.active and v_row.next_run_at is null then
    update public.chat_schedules set active = false where id = v_row.id
    returning * into v_row;                          -- nothing left to post
  end if;

  return public._chat_schedule_json(v_row);
end;
$$;

-- Pause / resume. Resuming never posts the missed slots.
create or replace function public.chat_schedule_set_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.chat_schedules;
begin
  if not public.is_senior_mod_staff() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  update public.chat_schedules s
     set active = p_active, updated_by = public.firebase_uid(), updated_at = now(),
         next_run_at = case when p_active then public._chat_schedule_live_slot(
           s, public._chat_schedule_next_slot(s.start_at, s.interval_minutes,
                case when s.runs_done = 0 then greatest(s.start_at, now()) else now() end))
           else s.next_run_at end
   where s.id = p_id
  returning * into v_row;
  if not found then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;
  return public._chat_schedule_json(v_row);
end;
$$;

create or replace function public.chat_schedule_delete(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_senior_mod_staff() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  delete from public.chat_schedules where id = p_id;
  return found;
end;
$$;


-- ---------------------------------------------------------------------
-- STEP 4 — the tick (pg_cron, every minute)
-- One message per room per run. client_msg_id = md5(schedule id, run
-- number) so a retried tick cannot post a run twice (UNIQUE room_id +
-- client_msg_id, 005). A run more than 15 minutes late (cron was down) is
-- skipped, not posted.
-- ---------------------------------------------------------------------
create or replace function public.chat_schedules_tick()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s       public.chat_schedules;
  m       jsonb;
  v_posts integer := 0;
  v_run   integer;
  v_err   text;
  v_next  timestamptz;
begin
  for s in
    select * from public.chat_schedules
     where active and next_run_at is not null and next_run_at <= now()
     order by next_run_at
     limit 50
     for update skip locked
  loop
    v_err := null;
    v_run := s.runs_done + 1;
    if s.next_run_at >= now() - interval '15 minutes' then
      for m in select * from jsonb_array_elements(s.messages) loop
        begin
          insert into public.messages (room_id, sender_id, text, client_msg_id, os)
          values (m ->> 'room_id', 'announcements_bot', m ->> 'text',
                  md5(s.id::text || ':' || v_run || ':' || (m ->> 'room_id'))::uuid, null)
          on conflict do nothing;
          v_posts := v_posts + 1;
        exception when others then
          v_err := left(format('%s: %s', m ->> 'room_id', sqlerrm), 300);
        end;
      end loop;
      s.runs_done := v_run;
      s.last_run_at := now();
    end if;

    -- A one-shot is done after its slot, posted or skipped.
    v_next := case when s.interval_minutes is null then null
                   else public._chat_schedule_live_slot(
                          s, public._chat_schedule_next_slot(s.start_at, s.interval_minutes,
                               now() + interval '1 second')) end;
    update public.chat_schedules t
       set runs_done = s.runs_done,
           last_run_at = s.last_run_at,
           last_error = v_err,
           next_run_at = v_next,
           active = v_next is not null
     where t.id = s.id;
  end loop;
  return v_posts;
end;
$$;


-- ---------------------------------------------------------------------
-- STEP 5 — grants
-- ---------------------------------------------------------------------
revoke all on function public._chat_schedule_next_slot(timestamptz, integer, timestamptz) from public;
revoke all on function public._chat_schedule_live_slot(public.chat_schedules, timestamptz) from public;
revoke all on function public._chat_schedule_json(public.chat_schedules) from public;
revoke all on function public.chat_schedules_tick() from public;
revoke all on function public.chat_schedules_list() from public;
revoke all on function public.chat_schedule_save(jsonb) from public;
revoke all on function public.chat_schedule_set_active(uuid, boolean) from public;
revoke all on function public.chat_schedule_delete(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public._chat_schedule_next_slot(timestamptz, integer, timestamptz) from anon;
    revoke all on function public._chat_schedule_live_slot(public.chat_schedules, timestamptz) from anon;
    revoke all on function public._chat_schedule_json(public.chat_schedules) from anon;
    revoke all on function public.chat_schedules_tick() from anon;
    revoke all on function public.chat_schedules_list() from anon;
    revoke all on function public.chat_schedule_save(jsonb) from anon;
    revoke all on function public.chat_schedule_set_active(uuid, boolean) from anon;
    revoke all on function public.chat_schedule_delete(uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.chat_schedules_tick() from authenticated;
    grant execute on function public.chat_schedules_list() to authenticated;
    grant execute on function public.chat_schedule_save(jsonb) to authenticated;
    grant execute on function public.chat_schedule_set_active(uuid, boolean) to authenticated;
    grant execute on function public.chat_schedule_delete(uuid) to authenticated;
  end if;
end $$;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- STEP 6 — schedule (re-runnable)
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'chat-schedules-tick';
    perform cron.schedule('chat-schedules-tick', '* * * * *', 'select public.chat_schedules_tick()');
  else
    raise notice 'pg_cron missing: chat-schedules-tick NOT scheduled';
  end if;
end $$;


-- =====================================================================
-- MONITORING
--   select title, active, runs_done, max_runs, next_run_at, last_run_at, last_error
--     from public.chat_schedules order by created_at desc;
--   select status, return_message, start_time from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'chat-schedules-tick')
--    order by start_time desc limit 10;
--
-- STOP EVERYTHING NOW (keeps the schedules):
--   update public.chat_schedules set active = false;
--
-- ROLLBACK
--   select cron.unschedule('chat-schedules-tick');
--   drop function if exists public.chat_schedules_tick();
--   drop function if exists public.chat_schedule_delete(uuid);
--   drop function if exists public.chat_schedule_set_active(uuid, boolean);
--   drop function if exists public.chat_schedule_save(jsonb);
--   drop function if exists public.chat_schedules_list();
--   drop function if exists public._chat_schedule_json(public.chat_schedules);
--   drop function if exists public._chat_schedule_live_slot(public.chat_schedules, timestamptz);
--   drop function if exists public._chat_schedule_next_slot(timestamptz, integer, timestamptz);
--   drop table if exists public.chat_schedules;
--   -- the bot's past messages stay; to hide them:
--   -- update public.messages set deleted = true where sender_id = 'announcements_bot';
-- =====================================================================
