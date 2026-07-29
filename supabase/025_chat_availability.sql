-- =====================================================================
-- 025_chat_availability.sql
--
-- Server-side enforcement for the two chat-availability switches:
--
--   chat_off_general  not accepting chats opened from anywhere but Trades
--   chat_off_trade    not accepting chats opened from the Trades screen
--
-- WHY THIS EXISTS
-- The app already disables the input when a door is closed, but that is
-- client-side only. Users on an older build have no idea the switches exist
-- and will happily insert a message anyway. This trigger makes the database
-- the authority, so the guarantee holds no matter what version sent it.
--
-- The switches live on RTDB users/{uid}; mirrorUsersToSupabase keeps the two
-- columns below in sync (see functions/mirrorUsersToSupabase.js).
--
-- Safe to run more than once.
-- =====================================================================

-- Run each numbered step as its OWN query. private_messages is a hot table and
-- ALTER needs an AccessExclusiveLock — batching these deadlocked against live
-- traffic on the Adopt Me project. lock_timeout makes it fail fast instead of
-- deadlocking; if a step times out, just run it again.
set lock_timeout = '5s';

-- 1. Mirror targets for the two switches -------------------------------
alter table public.user_settings
  add column if not exists chat_off_trade   boolean not null default false,
  add column if not exists chat_off_general boolean not null default false;

-- 2. Which door a message came through --------------------------------
-- NULL means an old client that predates the feature. Those are treated as
-- 'general', which is the door nearly all of their entry points use.
alter table public.private_messages
  add column if not exists origin text;

alter table public.private_messages
  drop constraint if exists private_messages_origin_check;
alter table public.private_messages
  add constraint private_messages_origin_check
  check (origin is null or origin in ('trade', 'general'));

-- 3. Reject messages through a door the recipient has closed -----------
create or replace function public.reject_unavailable_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_off boolean;
begin
  select case
           when coalesce(new.origin, 'general') = 'trade' then s.chat_off_trade
           else s.chat_off_general
         end
    into v_off
    from public.user_settings s
   where s.uid = new.recipient_id;

  -- No settings row means the user never toggled anything → allowed.
  -- Fail OPEN everywhere: a missing mirror row must not block messaging.
  if coalesce(v_off, false) then
    raise exception 'RECIPIENT_CHAT_UNAVAILABLE'
      using errcode = 'check_violation',
            hint = 'Recipient is not accepting this chat type.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reject_unavailable_chat on public.private_messages;
create trigger trg_reject_unavailable_chat
  before insert on public.private_messages
  for each row execute function public.reject_unavailable_chat();

-- 4. Backfill the mirror for anyone who already flipped a switch -------
-- Nothing to do: RTDB is the source of truth and mirrorUsersToSupabase
-- upserts on the next write to users/{uid}. Until then the columns default
-- to false, which fails open — the intended direction.

-- =====================================================================
-- ROLLBACK
--   drop trigger if exists trg_reject_unavailable_chat on public.private_messages;
--   drop function if exists public.reject_unavailable_chat();
--   -- columns can stay; they are inert without the trigger.
-- =====================================================================
