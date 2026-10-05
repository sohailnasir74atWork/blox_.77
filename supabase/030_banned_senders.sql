-- =====================================================================
-- 030_banned_senders.sql
--
-- Server-side ban enforcement for every chat table.
--
-- WHY THIS EXISTS
-- Bans were enforced only by the app (isUserBlocked disables the input).
-- The insert policies check nothing but sender_id = firebase_uid(), so a
-- banned user on an older build, or one calling the API directly, could
-- keep posting. This makes the database the authority, the same way
-- 025_chat_availability.sql does for the chat on/off switches.
--
-- banned_senders is written ONLY by Cloud Functions (service role) from
-- functions/banEnforcement.js, which mirrors RTDB banned_uids/{uid}. Every
-- kind of ban lands there: email bans (via syncEmailBan), uid bans
-- (modSanction), device-linked alts and re-registered emails. Mutes too —
-- they are short bans on the same node.
--
-- banned_until NULL = permanent.
--
-- Safe to run more than once.
-- =====================================================================

-- Run each numbered step as its OWN query (hot tables; see 025).
set lock_timeout = '5s';

-- 1. Table -------------------------------------------------------------
create table if not exists public.banned_senders (
  uid          text primary key,
  banned_until timestamptz,
  reason       text,
  source       text,
  updated_at   timestamptz not null default now()
);

-- Service role only: RLS on with no policies means anon/authenticated can
-- neither read nor write it. The trigger below reads it as SECURITY DEFINER.
alter table public.banned_senders enable row level security;
revoke all on public.banned_senders from anon, authenticated;

-- 2. Check --------------------------------------------------------------
create or replace function public.is_sender_banned(p_uid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.banned_senders b
     where b.uid = p_uid
       and (b.banned_until is null or b.banned_until > now())
  );
$$;

revoke all on function public.is_sender_banned(text) from public;
grant execute on function public.is_sender_banned(text) to service_role;

create or replace function public.reject_banned_sender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sender_id is not null and public.is_sender_banned(new.sender_id) then
    raise exception 'SENDER_BANNED'
      using errcode = 'check_violation',
            hint = 'This account is banned from sending messages.';
  end if;
  return new;
end;
$$;

-- 3. Triggers ----------------------------------------------------------
-- BEFORE INSERT, so it also covers SECURITY DEFINER RPCs that insert on the
-- caller's behalf (send_group_message in 012).
drop trigger if exists trg_reject_banned_sender on public.messages;
create trigger trg_reject_banned_sender
  before insert on public.messages
  for each row execute function public.reject_banned_sender();

drop trigger if exists trg_reject_banned_sender on public.private_messages;
create trigger trg_reject_banned_sender
  before insert on public.private_messages
  for each row execute function public.reject_banned_sender();

drop trigger if exists trg_reject_banned_sender on public.group_messages;
create trigger trg_reject_banned_sender
  before insert on public.group_messages
  for each row execute function public.reject_banned_sender();

-- 4. Backfill ----------------------------------------------------------
-- Not done in SQL: the source of truth is RTDB. Run
--   node scripts/backfill-ban-enforcement.js            (dry run)
--   node scripts/backfill-ban-enforcement.js --write
-- which re-applies every active banned_users_by_email record through the
-- same applyBan() the Cloud Functions use.

-- =====================================================================
-- ROLLBACK
--   drop trigger if exists trg_reject_banned_sender on public.messages;
--   drop trigger if exists trg_reject_banned_sender on public.private_messages;
--   drop trigger if exists trg_reject_banned_sender on public.group_messages;
--   drop function if exists public.reject_banned_sender();
--   drop function if exists public.is_sender_banned(text);
--   drop table if exists public.banned_senders;
-- =====================================================================
