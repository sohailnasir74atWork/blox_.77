-- =====================================================================
-- 010_group_messages.sql — Phase 5 (group bodies)
--
-- Move /group_messages/{groupId}/messages/{key} off RTDB into Supabase.
-- Symmetric to private_messages (009) but keyed by group_id rather
-- than chat_id; recipient is the group, not a single user.
--
-- Backward compat: NONE. Old builds reading RTDB /group_messages won't
-- see new messages. Accepted tradeoff per user direction.
--
-- Notification CF: needs the same Database-Webhook treatment as
-- private_messages. The webhook handler must fan out to every member's
-- fcmToken (membership lives in Firestore /groups/{groupId}/memberIds).
-- See functions/notifyGroupNewMessage.example.js for a template.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. group_messages — flat table, one row per message across all groups.
--    Membership-based access is enforced in RLS via a SECURITY DEFINER
--    helper that reads from the existing group_meta_data table (which
--    has user_id + group_id, one row per (member, group) pair).
-- ---------------------------------------------------------------------
create table if not exists public.group_messages (
  id              uuid primary key default gen_random_uuid(),

  -- Idempotency: client generates a UUID per send; UNIQUE(group_id,
  -- client_msg_id) makes retries no-ops. Same pattern as
  -- public.messages and public.private_messages.
  client_msg_id   uuid,

  group_id        text not null,
  sender_id       text not null,             -- Firebase UID of sender

  text            text,                      -- nullable when image-only / fruit-only
  image_url       text,
  fruits          jsonb not null default '[]'::jsonb,

  -- reply_to: { id, text, sender, imageUrl, hasFruits, fruitsCount }
  -- Mirrors the shape GroupChatScreen.jsx wrote to RTDB.
  reply_to        jsonb,

  -- Sender profile fields snapshotted at send time. The group chat UI
  -- reads these inline rather than via profileCache (different design
  -- from public chat) — keep the wire shape so MessageList works.
  sender_name     text,
  sender_avatar   text,
  is_pro          boolean,
  roblox_username_verified boolean,
  has_recent_game_win boolean,
  last_game_win_at  bigint,
  is_creator      boolean,

  os              text,

  -- Soft delete with audit trail.
  deleted         boolean not null default false,
  deleted_at      timestamptz,
  deleted_by      text,

  -- Report counter for the second-report → soft-delete flow.
  report_count    integer not null default 0,

  created_at      timestamptz not null default now()
);

-- Pagination + realtime filter. Index drives the (group_id, created_at,
-- id) cursor used by loadGroupMessages.
create index if not exists idx_group_messages_group_created
  on public.group_messages (group_id, created_at desc, id desc);

-- Idempotent send.
create unique index if not exists idx_group_messages_group_client_msg_id
  on public.group_messages (group_id, client_msg_id)
  where client_msg_id is not null;

-- Active-only partial — almost every read filters deleted = false.
create index if not exists idx_group_messages_group_active
  on public.group_messages (group_id, created_at desc, id desc)
  where deleted = false;

-- Bulk delete-by-sender (admin moderation) + notification CF lookup.
create index if not exists idx_group_messages_sender on public.group_messages (sender_id);


-- =====================================================================
-- Membership helper
-- =====================================================================
-- A SECURITY DEFINER function that returns true iff the caller is a
-- member of the given group, derived from group_meta_data (which has
-- one row per (user_id, group_id) pair). Used by both SELECT and
-- INSERT policies so we don't have to duplicate the membership logic.
-- =====================================================================

create or replace function public.is_group_member(p_group_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.group_meta_data g
     where g.user_id  = public.firebase_uid()
       and g.group_id = p_group_id
  );
$$;

grant execute on function public.is_group_member(text) to authenticated, anon;


-- =====================================================================
-- Row Level Security
-- =====================================================================
-- - SELECT: any group member can read every message in their group
-- - INSERT: only group members; sender_id must match the caller
-- - UPDATE: any group member (for soft delete by participant + report
--   counter bumps via reportGroupMessage). UPDATE is also how mods
--   soft-delete; admin-tier permission is enforced client-side today.
-- - DELETE: only the sender (rare; soft-delete is the standard path).
-- =====================================================================

alter table public.group_messages enable row level security;

drop policy if exists "group_messages select by member" on public.group_messages;
create policy "group_messages select by member"
  on public.group_messages for select
  using (public.is_group_member(group_id));

drop policy if exists "group_messages insert by sender member" on public.group_messages;
create policy "group_messages insert by sender member"
  on public.group_messages for insert
  with check (
    sender_id = public.firebase_uid()
    and public.is_group_member(group_id)
  );

drop policy if exists "group_messages update by member" on public.group_messages;
create policy "group_messages update by member"
  on public.group_messages for update
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

drop policy if exists "group_messages delete by sender" on public.group_messages;
create policy "group_messages delete by sender"
  on public.group_messages for delete
  using (sender_id = public.firebase_uid());


-- =====================================================================
-- Realtime publication
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_messages'
  ) then
    alter publication supabase_realtime add table public.group_messages;
  end if;
end $$;

alter table public.group_messages replica identity full;


-- =====================================================================
-- Autovacuum tuning
-- =====================================================================
alter table public.group_messages set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.05
);
