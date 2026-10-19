-- =====================================================================
-- 046_chat_slowmode.sql (2026-10-19) — NOT APPLIED
--
-- Two staff-hierarchy requests from a Senior Mod (2026-10-19), as the owner
-- approved them. Requires 034 (chat moderation) and 040 (_jwt_is_owner).
--
-- A. CHAT SLOW-MODE — public chat (public.messages) only
--   Senior Mod / Admin / owner set a minimum gap between one player's
--   messages: Off, 5s, 10s, 30s, 1m, 5m, either for every public room at once
--   (scope '*') or for one room (scope = public.rooms.id, e.g.
--   'chat_new_upgrade' — the RTDB path Trader.jsx CHANNELS uses as room_id).
--   * Effective gap in a room = max(the '*' value, that room's value): a room
--     setting can make one room stricter, never looser than all-rooms.
--   * The gap counts per room: the sender's previous message in THIS room.
--   * Staff (JMD and up, plus owner emails) are exempt. Service role (Cloud
--     Functions, scripts) and the SQL editor are never checked.
--   * Group chats and private chats are not touched.
--
--   chat_slowmode          one row per scope. Readable by everyone (the app
--                          shows the countdown); written only by the rpc.
--   set_chat_slowmode(p_scope, p_seconds)
--                          Senior Mod+ (user_roles.is_cmsr / is_admin, or a
--                          verified owner email); also the SQL editor.
--                          Returns the stored seconds.
--   trg_ad_chat_slowmode   BEFORE INSERT on public.messages. BEFORE triggers
--                          fire alphabetically, so it runs after 034's ban
--                          (aa) and link (ab) checks: a banned sender still
--                          gets SENDER_BANNED.
--   Error: SLOW_MODE, errcode 23514 (check_violation, like 034's errors);
--   DETAIL = whole seconds left (e.g. '12'); HINT = English text.
--
--   COST per message. Slow mode off (the normal case): one probe of a table
--   that holds at most 16 rows, nothing else. On: plus one range probe of
--   idx_messages_sender_created (046_chat_slowmode_index.sql) bounded by the
--   gap (at most 5 minutes of that one sender's messages). The staff lookup
--   and the retry check run only for a message that is about to be refused.
--   While slow mode is on in a room, an end user's created_at is stamped
--   now(): no app build sends created_at, and a crafted client could
--   otherwise backdate its messages to dodge the gap.
--
--   OLD BUILDS (they don't know SLOW_MODE):
--   * 4.0.15 and later (incl. Play production 4.0.22 (171) and iOS 8.5):
--     chatSendErrorCode() (GlobelStats.js) falls back on errcode 23514 →
--     'NOT_ALLOWED' → toast "Message not sent · This message isn't allowed
--     here."; the typed message stays in the box, nothing is queued.
--   * 4.0.12–4.0.14: the catch-all path → toast "Offline · Your message will
--     send automatically…", the box is cleared and the send is queued. The
--     queue is replayed only when the realtime channel (re)subscribes, never
--     on a timer, and a send that keeps failing is dropped after 3 replays
--     (Trader.jsx flushRetryQueue `attempts < 3`, present since 4.0.10), so
--     it cannot loop: at most 4 inserts per message. A replay that lands
--     after the gap goes through (the message shows up late); otherwise the
--     message silently disappears. Switching rooms clears the queue.
--     SENDER_BANNED takes the same path on those builds today.
--   No build crashes. Every build also has its own 10 s client cooldown in
--   public chat (Trader.jsx MESSAGE_COOLDOWN, all users), so 5 s / 10 s only
--   bite crafted clients; 30 s and up are felt by everyone.
--
-- B. REPORTS ABOUT STAFF GO UP THE LADDER
--   The mod asked that Senior Mods can't be reported; the owner chose to keep
--   accepting those reports but route them up, and nobody may see or act on
--   a report about themselves. A report's target rank is looked up when
--   listing, from user_roles (the server mirror of the RTDB role flags:
--   mirrorUsersToSupabase + reconcileRolesMirror every 6 h), never from the
--   client:
--     target is a player               every staff member (unchanged)
--     target is a JMD or Mod           Senior Mods, Admins, owner
--     target is a Senior Mod or Admin  Admins and owner (Admin counts as
--                                      owner level, owner decision 2026-10-19)
--     and never the target themselves.
--   * list_message_reports (034): same signature and columns, the hidden rows
--     are filtered out before the page limit. Old builds' dashboards simply
--     get fewer rows.
--   * mod_read_private_chat (039/040): a non-admin staff member may open a
--     DM only through a report whose reported_uid is one they may see by the
--     table above, and not themselves (same error text 'chat not reported'
--     as before, so old builds show their usual message). Admins still read
--     any chat (owner decision 2026-10-10).
--   * user_roles has no owner column: a report about the owner's account is
--     routed by the flags that account carries (is_admin → Admins + owner).
--   Firestore user_reports / chat_reports are routed separately:
--   functions/reportRouting.js moves reports about staff into
--   *_restricted collections that only the allowed staff can read.
--
-- HOW TO RUN (owner)
--   1. supabase/046_chat_slowmode_index.sql — ON ITS OWN, not in begin/commit.
--   2. This file, STEP 1–3. One transaction is fine. STEP 2 refuses to arm
--      the trigger until the index from step 1 exists and is valid; STEP 2
--      takes a brief lock on public.messages with lock_timeout 5s — if it
--      times out, run it again. Every step is idempotent.
--   STEP 0 is read-only. Fully applied: t | t | 4 | t | t
-- =====================================================================


-- =====================================================================
-- STEP 0 — Read-only. Where am I?
-- =====================================================================
select
  (select coalesce(bool_and(i.indisvalid), false) from pg_index i
    where i.indexrelid = to_regclass('public.idx_messages_sender_created'))          as index_valid,
  (to_regclass('public.chat_slowmode') is not null)                                as step1_table,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('_staff_rank_of', '_chat_caller_staff_rank',
                        'set_chat_slowmode', 'enforce_chat_slowmode'))               as step1_functions,
  (select count(*) = 1 from pg_trigger
    where tgrelid = 'public.messages'::regclass and tgname = 'trg_ad_chat_slowmode') as step2_trigger,
  (select coalesce(bool_and(pg_get_functiondef(p.oid) like '%staff_rank%'), false)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('list_message_reports', 'mod_read_private_chat'))           as step3_reports;


-- =====================================================================
-- STEP 1 — Table, helpers, rpc, trigger function. Touches no hot table.
-- =====================================================================
set lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public._jwt_is_owner()') is null then
    raise exception '046 needs 040 applied first: run supabase/040_owner_email_verified.sql, then run 046 again (public._jwt_is_owner() is missing)';
  end if;
  if to_regprocedure('public._chat_end_user_uid()') is null
     or to_regclass('public.message_reports') is null then
    raise exception 'Run 034_chat_moderation_enforcement.sql first';
  end if;
end $$;

-- 1a. chat_slowmode -------------------------------------------------------
create table if not exists public.chat_slowmode (
  scope       text primary key,              -- '*' = every public room, else public.rooms.id
  seconds     integer not null default 0
              check (seconds in (0, 5, 10, 30, 60, 300)),
  set_by      text,                          -- Firebase uid; null = SQL editor / service role
  updated_at  timestamptz not null default now()
);

alter table public.chat_slowmode enable row level security;
drop policy if exists "chat_slowmode read all" on public.chat_slowmode;
create policy "chat_slowmode read all"
  on public.chat_slowmode for select
  using (true);
-- No write policies: only set_chat_slowmode (security definer) writes.
-- Clients may read scope and seconds only: set_by (a staff uid) and
-- updated_at stay server-side (column grant; `select *` is refused).
revoke all on table public.chat_slowmode from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.chat_slowmode from anon;
    grant select (scope, seconds) on table public.chat_slowmode to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.chat_slowmode from authenticated;
    grant select (scope, seconds) on table public.chat_slowmode to authenticated;
  end if;
end $$;

-- Report routing (STEP 3) lists JMDs; user_roles has partial indexes for
-- every other staff flag (003) but not this one. user_roles is written only
-- on role changes, so a plain (brief) build is fine.
create index if not exists idx_user_roles_baby_mod
  on public.user_roles (uid) where is_baby_mod = true;

reset lock_timeout;

-- 1b. Staff rank (same ladder as functions/banEnforcement.js RANK) --------
-- 4 admin, 3 senior mod (is_cmsr), 2 moderator, 1 JMD (is_baby_mod), 0 user.
-- The owner (5) is only known from the caller's JWT (_jwt_is_owner, 040).
create or replace function public._staff_rank_of(p_uid text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
             when ur.is_admin     then 4
             when ur.is_cmsr      then 3
             when ur.is_moderator then 2
             when ur.is_baby_mod  then 1
             else 0
           end
      from public.user_roles ur
     where ur.uid = p_uid), 0);
$$;

-- Rank of the end user making this request; 0 for anon / service role / no JWT.
create or replace function public._chat_caller_staff_rank()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid text := public._chat_end_user_uid();
begin
  if v_uid is null then
    return 0;
  end if;
  if public._jwt_is_owner() then
    return 5;
  end if;
  return public._staff_rank_of(v_uid);
end;
$$;

revoke all on function public._staff_rank_of(text) from public;
revoke all on function public._chat_caller_staff_rank() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public._staff_rank_of(text) from anon;
    revoke all on function public._chat_caller_staff_rank() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public._staff_rank_of(text) from authenticated;
    revoke all on function public._chat_caller_staff_rank() from authenticated;
  end if;
end $$;

-- 1c. set_chat_slowmode ---------------------------------------------------
-- p_scope '*' or a public.rooms id; p_seconds one of 0 (off), 5, 10, 30, 60,
-- 300. Errors: 'not authorized' 42501, 'invalid scope' / 'invalid seconds'
-- 22023.
create or replace function public.set_chat_slowmode(
  p_scope   text,
  p_seconds integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims jsonb := public._chat_jwt_claims();
  v_uid    text  := public._chat_end_user_uid();
  v_scope  text  := nullif(btrim(coalesce(p_scope, '')), '');
begin
  -- An app request carries claims: Senior Mod+ only. No claims (SQL editor)
  -- or the service role: allowed. anon has claims with no uid → refused.
  if v_claims is not null and coalesce(v_claims ->> 'role', '') <> 'service_role' then
    if v_uid is null or public._chat_caller_staff_rank() < 3 then
      raise exception 'not authorized'
        using errcode = '42501',
              hint = 'Only Senior Mods, Admins and the owner can set slow mode.';
    end if;
  end if;
  if v_scope is null
     or (v_scope <> '*' and not exists (select 1 from public.rooms r where r.id = v_scope)) then
    raise exception 'invalid scope' using errcode = '22023';
  end if;
  if p_seconds is null or p_seconds not in (0, 5, 10, 30, 60, 300) then
    raise exception 'invalid seconds'
      using errcode = '22023', hint = 'One of 0, 5, 10, 30, 60, 300.';
  end if;

  insert into public.chat_slowmode (scope, seconds, set_by, updated_at)
  values (v_scope, p_seconds, v_uid, now())
  on conflict (scope) do update
    set seconds    = excluded.seconds,
        set_by     = excluded.set_by,
        updated_at = excluded.updated_at;
  return p_seconds;
end;
$$;

revoke all on function public.set_chat_slowmode(text, integer) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.set_chat_slowmode(text, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.set_chat_slowmode(text, integer) to authenticated;
  end if;
end $$;

-- 1d. enforce_chat_slowmode — BEFORE INSERT on public.messages ------------
create or replace function public.enforce_chat_slowmode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secs integer;
  v_uid  text;
  v_last timestamptz;
  v_wait integer;
begin
  select coalesce(max(s.seconds), 0) into v_secs
    from public.chat_slowmode s
   where s.scope in ('*', new.room_id);
  if v_secs <= 0 then
    return new;                                      -- off: the normal case
  end if;

  v_uid := public._chat_end_user_uid();
  if v_uid is null then
    return new;                                      -- service role / cron / editor
  end if;
  new.created_at := now();                           -- no backdating while slow mode is on
  -- One sender's parallel inserts queue here until the earlier one commits,
  -- so the lookup below sees it (a volatile function's query takes a fresh
  -- snapshot). Transaction-scoped; only taken while slow mode is on.
  perform pg_advisory_xact_lock(hashtext('chat_slowmode'), hashtext(v_uid));

  -- RLS ("messages insert own") already pins new.sender_id to the caller.
  select max(m.created_at) into v_last
    from public.messages m
   where m.sender_id = v_uid
     and m.created_at > now() - make_interval(secs => v_secs)
     and m.room_id = new.room_id;
  if v_last is null then
    return new;
  end if;

  if public._chat_caller_staff_rank() >= 1 then
    return new;                                      -- staff (JMD and up) exempt
  end if;
  -- A retry of a send that already landed (same client_msg_id): let the
  -- UNIQUE(room_id, client_msg_id) index answer 23505, which every build
  -- turns into "return the existing row".
  if new.client_msg_id is not null and exists (
       select 1 from public.messages m
        where m.room_id = new.room_id and m.client_msg_id = new.client_msg_id) then
    return new;
  end if;

  v_wait := greatest(1, ceil(extract(epoch from (v_last + make_interval(secs => v_secs) - now())))::integer);
  raise exception 'SLOW_MODE'
    using errcode = 'check_violation',
          detail  = v_wait::text,
          hint    = format('Slow mode is on: wait %s seconds before sending again.', v_wait);
end;
$$;

notify pgrst, 'reload schema';


-- =====================================================================
-- STEP 2 — Arm public.messages. Needs the index from
-- 046_chat_slowmode_index.sql (refuses to run without it).
-- =====================================================================
do $$
begin
  if not coalesce((select i.indisvalid from pg_index i
                    where i.indexrelid = to_regclass('public.idx_messages_sender_created')), false) then
    raise exception 'Run 046_chat_slowmode_index.sql first, on its own (index idx_messages_sender_created missing or invalid)';
  end if;
end $$;

set lock_timeout = '5s';

drop trigger if exists trg_ad_chat_slowmode on public.messages;
create trigger trg_ad_chat_slowmode
  before insert on public.messages
  for each row execute function public.enforce_chat_slowmode();

reset lock_timeout;


-- =====================================================================
-- STEP 3 — Reports about Senior Mod+ go up. Touches no hot table.
-- =====================================================================

-- 3a. list_message_reports (034 1g) + rank routing -------------------------
-- Hidden for the caller: reports about themselves; for a JMD / Mod, reports
-- about any staff member; for a Senior Mod, reports about a Senior Mod or
-- Admin. Admins and the owner see the rest. Partial-index probes on
-- user_roles (idx_user_roles_admin / _cmsr / _moderators / _baby_mod) build
-- the hidden set once; the rest is 034's query unchanged.
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
  v_rank  integer;
  v_uid   text := public._chat_end_user_uid();
begin
  if not public._chat_caller_is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_rank := public._chat_caller_staff_rank();
  return query
    with hidden as (
      select v_uid as uid where v_uid is not null
      union
      select ur.uid from public.user_roles ur where ur.is_admin = true and v_rank < 4
      union
      select ur.uid from public.user_roles ur where ur.is_cmsr = true and v_rank < 4
      union
      select ur.uid from public.user_roles ur where ur.is_moderator = true and v_rank < 3
      union
      select ur.uid from public.user_roles ur where ur.is_baby_mod = true and v_rank < 3
    ), g as (
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
       where r.sender_uid is null
          or r.sender_uid not in (select h.uid from hidden h)
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
           -- Stickers in DMs / groups (050 adds their gif column). to_jsonb so
           -- this works before 050 too: a missing key is NULL.
           coalesce(m.gif, to_jsonb(pm) ->> 'gif', to_jsonb(gm) ->> 'gif'),
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

-- 3b. mod_read_private_chat (039 / 040) + rank routing ----------------------
-- Non-admin staff need a report they may see: about a player (JMD / Mod), or
-- about a player, JMD or Mod (Senior Mod) — never one about themselves.
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
declare
  v_uid text := public.firebase_uid();
  v_is_admin boolean;
begin
  if not coalesce(public.is_mod_staff(), false) then
    raise exception 'not staff' using errcode = '42501';
  end if;
  if p_chat_id is null or p_chat_id = '' then
    return;
  end if;

  v_is_admin := coalesce(
    exists (select 1 from public.user_roles where uid = v_uid and is_admin = true)
    or public._jwt_is_owner(),
    false
  );

  if not v_is_admin
     and not exists (
       select 1 from public.reported_chats rc
        where rc.chat_id = p_chat_id
          and rc.reported_uid is distinct from v_uid
          and (rc.reported_uid is null
               or public._staff_rank_of(rc.reported_uid)
                  < case when public._staff_rank_of(v_uid) >= 3 then 3 else 1 end)) then
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

notify pgrst, 'reload schema';


-- =====================================================================
-- SMOKE TEST (supabase-js, signed in):
--   await supabase.from('chat_slowmode').select('scope,seconds')          // [] or rows
--   await supabase.rpc('set_chat_slowmode', { p_scope: '*', p_seconds: 30 })
--        // ordinary user / Mod / JMD: 'not authorized'; Senior Mod+: 30
--   then, as an ordinary user, two sends in one room within 30 s:
--        // second: { code: '23514', message: 'SLOW_MODE', details: '<s>' }
--   await supabase.rpc('set_chat_slowmode', { p_scope: '*', p_seconds: 0 })
-- =====================================================================


-- =====================================================================
-- ROLLBACK — run as one query (the index file has its own rollback line).
--   set lock_timeout = '5s';
--   drop trigger if exists trg_ad_chat_slowmode on public.messages;
--   reset lock_timeout;
--   drop function if exists public.enforce_chat_slowmode();
--   drop function if exists public.set_chat_slowmode(text, integer);
--   drop table if exists public.chat_slowmode;
--   -- report routing back to 034 / 040: re-run 034_steps/1_functions.sql
--   -- section 1g (list_message_reports) and 040 section 4
--   -- (mod_read_private_chat); both are create or replace. Then:
--   drop function if exists public._chat_caller_staff_rank();
--   drop function if exists public._staff_rank_of(text);
--   drop index if exists public.idx_user_roles_baby_mod;
-- =====================================================================
