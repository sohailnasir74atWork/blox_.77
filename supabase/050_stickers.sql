-- =====================================================================
-- 050_stickers.sql (2026-10-19) — chat stickers in every chat + sticker URL allowlist
--
-- WHAT
--   * Stickers in group and private chat. public.messages has had `gif` (the
--     sticker URL) since 001; private_messages (009) and group_messages (010)
--     get the same nullable `gif` column here.
--   * Sticker URL allowlist on all three tables. Until now any signed-in user
--     could put ANY URL in messages.gif, and every build renders it as an image
--     in public chat (image injection). From STEP 2 on, an end user's gif must
--     be a .png / .webp / .gif under one of the sticker folders:
--       https://bloxfruitscalc.com/wp-content/uploads/2025/Emojies/  (the 16
--         original stickers, served by blox-web; what every shipped build sends)
--       https://blox-api.b-cdn.net/stickers/  (Bunny storage zone blox-data,
--         folder stickers/: all new art)
--     Same list as Code/ChatScreen/Stickers/stickerManifest.js
--     (isAllowedStickerUrl). A new folder needs both changed, plus a release.
--   * send_group_sticker(): the group send path for stickers. It checks the
--     URL, then calls send_group_message() (012, or whatever later file
--     replaced it) unchanged, handing the URL to the insert through the
--     transaction-local setting blox.sticker_gif, the same hand-off 034 uses
--     for blox.meta_rpc / blox.report_rpc. send_group_message keeps its
--     signature, so old builds' named-argument calls cannot become ambiguous
--     (a second overload with a defaulted p_gif would make PostgREST answer
--     PGRST203 to every old build).
--
-- WHO IS CHECKED
--   End users only, like 034: a JWT carrying a Firebase uid. Service role
--   (Cloud Functions, scripts), pg_cron and the SQL editor pass through.
--   Admins are checked too: no build ever sends a URL outside the folders.
--   Rows that already exist are not re-checked (STEP 5 lists them).
--
-- ERROR
--   STICKER_NOT_ALLOWED, errcode 23514 check_violation. Every shipped build's
--   chatErrorCode() / chatSendErrorCode() maps text containing NOT_ALLOWED to
--   'NOT_ALLOWED' ("This message isn't allowed here."), and Trader.jsx does not
--   queue such a send for retry.
--
-- OLD BUILDS (Play 4.0.22 (171)+, iOS 8.5)
--   * Public chat: they only send the 16 Emojies/eN.png URLs, which pass.
--   * Private / group: they never send gif, so it stays NULL. Their
--     send_group_message call is untouched. They select explicit column lists,
--     so the new column is invisible to them; a sticker message from a new
--     build shows there as a bubble with the sender's name and no content
--     (no crash: their mappers ignore unknown fields, and an empty text/image/
--     fruits message renders as an empty bubble).
--   * Push notifications (notifyPrivateMessage / notifyGroupNewMessage) read
--     record.gif and say "✨ Sent a sticker" for everyone.
--
-- DEPLOY ORDER
--   This file before any app build that selects `gif` from private_messages /
--   group_messages (that build's history loads fail without the column).
--   The functions change (push text) can go before or after.
--
-- HOW TO RUN — ONE STEP AT A TIME, IN ORDER (each is its own query)
--   STEP 1 touches no table. STEPs 2-4 each take a brief lock on one hot table
--   with lock_timeout, so they fail fast instead of queueing app traffic; if
--   one times out, re-run it. Every step is idempotent. Requires 034.
--
-- ROLLBACK
--   drop trigger if exists trg_ae_chat_sticker on public.messages;
--   drop trigger if exists trg_ae_chat_sticker on public.private_messages;
--   drop trigger if exists trg_ae_chat_sticker on public.group_messages;
--   drop function if exists public.send_group_sticker(text, uuid, text, jsonb,
--     text, text, boolean, boolean, boolean, bigint, boolean, text);
--   The gif columns can stay: nullable, unread by old builds. New builds then
--   get "could not find the function" on sticker sends in groups only.
-- =====================================================================


-- =====================================================================
-- STEP 0 — Read-only. Where am I?   Fully applied: 2 | 1 | 2 | 3
-- =====================================================================
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('sticker_url_allowed', 'enforce_chat_sticker'))                  as step1_functions,
  (select count(*) from pg_trigger
    where tgrelid = 'public.messages'::regclass and tgname = 'trg_ae_chat_sticker')       as step2_messages,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'private_messages' and column_name = 'gif')
    + (select count(*) from pg_trigger
        where tgrelid = 'public.private_messages'::regclass and tgname = 'trg_ae_chat_sticker') as step3_private,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'group_messages' and column_name = 'gif')
    + (select count(*) from pg_trigger
        where tgrelid = 'public.group_messages'::regclass and tgname = 'trg_ae_chat_sticker')
    + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'send_group_sticker')                 as step4_group;


-- =====================================================================
-- STEP 1 — Functions. Touches no table.
-- =====================================================================
do $$
begin
  if to_regprocedure('public._chat_end_user_uid()') is null then
    raise exception 'Run 034_chat_moderation_enforcement.sql first (public._chat_end_user_uid is missing)';
  end if;
end $$;

-- TRUE for a sticker URL the app may send. [.] instead of \. so
-- standard_conforming_strings is moot; no query string, no "..", no host
-- tricks (the host is fixed by the prefix up to its first "/").
create or replace function public.sticker_url_allowed(p_url text)
returns boolean
language sql
immutable
as $$
  select coalesce(
    char_length(p_url) <= 300
    and p_url ~ '^https://(bloxfruitscalc[.]com/wp-content/uploads/2025/Emojies/|blox-api[.]b-cdn[.]net/stickers/)[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*[.](png|webp|gif)$',
    false);
$$;

-- BEFORE INSERT OR UPDATE OF gif on messages / private_messages / group_messages.
create or replace function public.enforce_chat_sticker()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending text;
begin
  -- send_group_sticker() passes its URL here: send_group_message() has no
  -- gif parameter.
  if tg_op = 'INSERT' and tg_table_name = 'group_messages' then
    v_pending := nullif(current_setting('blox.sticker_gif', true), '');
    if v_pending is not null and new.gif is null then
      new.gif := v_pending;
    end if;
  end if;

  if new.gif = '' then
    new.gif := null;
  end if;
  if new.gif is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.gif is not distinct from old.gif then
      return new;
    end if;
  end if;
  if public._chat_end_user_uid() is null then
    return new;                                      -- service role / cron / editor
  end if;
  if public.sticker_url_allowed(new.gif) then
    return new;
  end if;
  raise exception 'STICKER_NOT_ALLOWED'
    using errcode = 'check_violation',
          hint = 'Only stickers from the sticker picker can be sent.';
end;
$$;

-- Supabase grants EXECUTE on new public functions to PUBLIC/anon by default.
do $$
declare
  v_role text;
begin
  revoke all on function public.sticker_url_allowed(text) from public;
  revoke all on function public.enforce_chat_sticker() from public;
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function public.sticker_url_allowed(text) from %I', v_role);
      execute format('revoke all on function public.enforce_chat_sticker() from %I', v_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.sticker_url_allowed(text) to authenticated;
  end if;
end
$$;


-- =====================================================================
-- STEP 2 — Arm public.messages (gif exists since 001).
-- BEFORE triggers fire alphabetically: 034's aa/ab/ac, 046's ad, then this.
-- =====================================================================
set lock_timeout = '5s';

drop trigger if exists trg_ae_chat_sticker on public.messages;
create trigger trg_ae_chat_sticker
  before insert or update of gif on public.messages
  for each row execute function public.enforce_chat_sticker();

reset lock_timeout;


-- =====================================================================
-- STEP 3 — public.private_messages: gif column + trigger.
-- Adding a nullable column with no default is metadata-only (no rewrite).
-- New builds insert it directly (Code/Supabase/privateMessagesBackend.js).
-- =====================================================================
set lock_timeout = '5s';

alter table public.private_messages
  add column if not exists gif text;

drop trigger if exists trg_ae_chat_sticker on public.private_messages;
create trigger trg_ae_chat_sticker
  before insert or update of gif on public.private_messages
  for each row execute function public.enforce_chat_sticker();

reset lock_timeout;

notify pgrst, 'reload schema';


-- =====================================================================
-- STEP 4 — public.group_messages: gif column + trigger + send_group_sticker.
-- =====================================================================
set lock_timeout = '5s';

alter table public.group_messages
  add column if not exists gif text;

drop trigger if exists trg_ae_chat_sticker on public.group_messages;
create trigger trg_ae_chat_sticker
  before insert or update of gif on public.group_messages
  for each row execute function public.enforce_chat_sticker();

reset lock_timeout;

-- A sticker message (no text, image or fruits). Every rule of
-- send_group_message and every group_messages trigger still applies, the
-- idempotent retry included (same p_client_msg_id -> the first row).
-- Calls send_group_message by position: a later file that adds parameters
-- must add them after p_os, with defaults, or update this call.
create or replace function public.send_group_sticker(
  p_group_id                  text,
  p_client_msg_id             uuid,
  p_gif                       text,
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
  v_row public.group_messages;
begin
  if not public.sticker_url_allowed(p_gif) then
    raise exception 'STICKER_NOT_ALLOWED'
      using errcode = 'check_violation',
            hint = 'Only stickers from the sticker picker can be sent.';
  end if;

  perform set_config('blox.sticker_gif', p_gif, true);
  v_row := public.send_group_message(
    p_group_id, p_client_msg_id,
    null, null, '[]'::jsonb, p_reply_to,
    p_sender_name, p_sender_avatar,
    p_is_pro, p_roblox_username_verified,
    p_has_recent_game_win, p_last_game_win_at, p_is_creator, p_os
  );
  perform set_config('blox.sticker_gif', '', true);
  return v_row;
end;
$$;

do $$
declare
  v_role text;
begin
  revoke all on function public.send_group_sticker(
    text, uuid, text, jsonb, text, text, boolean, boolean, boolean, bigint, boolean, text) from public;
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function public.send_group_sticker(text, uuid, text, jsonb, text, text, boolean, boolean, boolean, bigint, boolean, text) from %I', v_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.send_group_sticker(
      text, uuid, text, jsonb, text, text, boolean, boolean, boolean, bigint, boolean, text) to authenticated;
  end if;
end
$$;

notify pgrst, 'reload schema';


-- =====================================================================
-- STEP 5 — Optional, read-only. Public messages sent before STEP 2 whose gif
-- is not a sticker (injected images). Scans public.messages: run off-peak.
-- To clear them, soft-delete those rows as staff or set gif = null from the
-- SQL editor (service role passes the trigger).
-- =====================================================================
-- select gif, count(*) as messages, max(created_at) as last_sent
--   from public.messages
--  where gif is not null and not public.sticker_url_allowed(gif)
--  group by gif
--  order by messages desc
--  limit 50;
