-- =====================================================================
-- 039_mod_read_private_chat.sql  (Blox Fruits, 2026-10-10)
-- Mod Panel → Chat Viewer showed "No messages found between these users"
-- for every report. The 009 SELECT policy on private_messages is
-- participant-only, so a mod who isn't in the chat gets 0 rows (no error).
--
-- Who may read a private chat (owner decision 2026-10-10):
--   * Admins (user_roles.is_admin or an owner email): any chat.
--   * Other staff (Sr Mod / Mod / JMod): ONLY a chat a participant reported.
--     The check is enforced here, not just in the app's screens.
--
--   reported_chats: one row per Firestore chat_reports doc. Written ONLY by
--     the mirrorChatReport Cloud Function (service role) — clients have no
--     access at all. Firestore rules already guarantee the reporter is one of
--     the two people in chat_key. Deleting the report deletes the row, which
--     takes the chat back out of mods' reach.
--
--   mod_read_private_chat(p_chat_id, p_limit): newest-first rows of one
--     chat. Includes soft-deleted rows on purpose — a reported scammer
--     deleting messages shouldn't hide evidence.
--
-- Additive: no existing policy changes; old builds keep their behaviour.
-- Safe to run more than once.
-- =====================================================================

-- 1. reported_chats ----------------------------------------------------
create table if not exists public.reported_chats (
  report_id     text primary key,          -- Firestore chat_reports doc id
  chat_id       text not null,             -- sorted uid_uid, same as private_messages.chat_id
  reporter_uid  text not null,
  reported_uid  text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_reported_chats_chat on public.reported_chats (chat_id);

alter table public.reported_chats enable row level security;
-- No policies: anon/authenticated can't read or write; the service role
-- (Cloud Function) bypasses RLS.
revoke all on table public.reported_chats from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.reported_chats from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.reported_chats from authenticated;
  end if;
end $$;

-- 2. mod_read_private_chat ----------------------------------------------
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

  -- coalesce: no email claim (phone sign-in) must mean "not admin", not NULL.
  v_is_admin := coalesce(
    exists (select 1 from public.user_roles where uid = v_uid and is_admin = true)
    or lower(current_setting('request.jwt.claims', true)::jsonb ->> 'email') in (
      'thesolanalabs@gmail.com',
      'sohailnasir74business@gmail.com',
      'sohailnasir74@gmail.com'
    ),
    false
  );

  if not v_is_admin
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

revoke all on function public.mod_read_private_chat(text, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.mod_read_private_chat(text, int) from anon;
  end if;
end $$;
grant execute on function public.mod_read_private_chat(text, int) to authenticated;
