-- =====================================================================
-- 002_chat_metadata.sql — Phases 2 + 3
--
-- Mirror of RTDB /chat_meta_data and /group_meta_data into Supabase so
-- the chat list / unread badge listeners can move off RTDB egress
-- (these listeners are open continuously and dominate read costs).
--
-- Backward compat (same pattern as Phase 1):
--   * RTDB stays the SOURCE OF TRUTH. Clients keep writing
--     increment(unreadCount), mute toggles, lastMessage updates straight
--     to RTDB so existing notification CFs (notifyTradeAccept etc.) and
--     the per-member fan-out in groupUtils keep working unchanged, and
--     OLD APP VERSIONS DO NOT BREAK — they keep reading RTDB as today.
--   * Cloud Functions mirrorChatMetaToSupabase / mirrorGroupMetaToSupabase
--     trigger on RTDB onWrite and upsert/delete here.
--   * NEW clients SUBSCRIBE here for the unread/chat-list stream.
--
-- Field shapes mirror what PrivateChat.jsx and groupUtils.js write today
-- (verified by inspection — see commit message for grep references).
--
-- Auth: depends on public.firebase_uid() from 000_init.sql.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. chat_meta_data — one row per (owner, partner) pair, identical
--    grain to RTDB /chat_meta_data/{ownerUid}/{partnerUid}.
-- ---------------------------------------------------------------------
create table if not exists public.chat_meta_data (
  owner_uid        text not null,                 -- Firebase UID who owns this row
  partner_uid      text not null,                 -- the other party's Firebase UID
  chat_id          text,                          -- canonical chat id ([owner, partner].sort().join('_'))
  last_message     text,
  timestamp_ms     bigint,                        -- ms epoch, mirrors RTDB `timestamp` field
  receiver_id      text,                          -- denormalised; matches RTDB shape
  receiver_name    text,
  receiver_avatar  text,
  unread_count     int  not null default 0,
  muted            boolean not null default false,
  updated_at       timestamptz not null default now(),
  primary key (owner_uid, partner_uid)
);

-- Listener filters by owner_uid; Supabase realtime needs a btree index
-- to evaluate the filter efficiently on every published row.
create index if not exists idx_chat_meta_owner
  on public.chat_meta_data (owner_uid);


-- ---------------------------------------------------------------------
-- 2. group_meta_data — one row per (user, group) pair, identical
--    grain to RTDB /group_meta_data/{userId}/{groupId}.
--
--    Field names match what groupUtils.js writes (Code/ChatScreen/utils/
--    groupUtils.js lines 156–164, 737–739).
-- ---------------------------------------------------------------------
create table if not exists public.group_meta_data (
  user_id                     text not null,
  group_id                    text not null,
  group_name                  text,
  group_avatar                text,
  last_message                text,
  last_message_timestamp_ms   bigint,             -- mirrors RTDB lastMessageTimestamp
  last_message_sender_id      text,
  last_message_sender_name    text,
  member_count                int,
  created_by                  text,
  unread_count                int  not null default 0,
  muted                       boolean not null default false,
  joined_at_ms                bigint,             -- mirrors RTDB joinedAt
  last_read_at_ms             bigint,             -- mirrors RTDB lastReadAt (if present)
  updated_at                  timestamptz not null default now(),
  primary key (user_id, group_id)
);

create index if not exists idx_group_meta_user
  on public.group_meta_data (user_id);


-- =====================================================================
-- Row Level Security
-- =====================================================================
-- Each user can only see rows they own. Writes are SERVICE-ROLE only —
-- the Cloud Function mirror is the only writer. Service-role bypasses
-- RLS, so we don't add any insert/update/delete policies for end-users.
-- (Direct client writes to Supabase are deliberately NOT supported here
-- — the entire Phase 2+3 strategy is "RTDB writes, Supabase reads".)
--
-- ONE EXCEPTION: resetUnreadCount() in the client backend writes
-- unread_count = 0 directly so the badge clears instantly without
-- waiting on the mirror CF. We allow that narrowly via an UPDATE policy
-- that lets the owner set unread_count only.
-- =====================================================================

alter table public.chat_meta_data  enable row level security;
alter table public.group_meta_data enable row level security;

create policy "chat_meta_data read own"
  on public.chat_meta_data for select
  using (owner_uid = public.firebase_uid());

create policy "group_meta_data read own"
  on public.group_meta_data for select
  using (user_id = public.firebase_uid());

-- Direct unread reset (instant badge clear). Body still needs the row
-- to belong to the caller, and Postgres checks both USING (current row)
-- and WITH CHECK (proposed row) — so the user can't reassign ownership.
create policy "chat_meta_data unread reset by owner"
  on public.chat_meta_data for update
  using (owner_uid = public.firebase_uid())
  with check (owner_uid = public.firebase_uid());

create policy "group_meta_data unread reset by owner"
  on public.group_meta_data for update
  using (user_id = public.firebase_uid())
  with check (user_id = public.firebase_uid());


-- =====================================================================
-- Realtime publication
-- =====================================================================
-- REPLICA IDENTITY FULL so UPDATE payloads include unchanged columns
-- (the listener derives `muted` and `unread_count` from the same row),
-- and so DELETE filters on non-PK columns keep working.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_meta_data'
  ) then
    alter publication supabase_realtime add table public.chat_meta_data;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_meta_data'
  ) then
    alter publication supabase_realtime add table public.group_meta_data;
  end if;
end $$;

alter table public.chat_meta_data  replica identity full;
alter table public.group_meta_data replica identity full;


-- =====================================================================
-- Autovacuum tuning
-- =====================================================================
-- These tables are upsert-heavy (every chat send updates lastMessage,
-- timestamp, unread_count). Default 20% dead-row threshold is too loose
-- — adoptme hit a disk-IO incident at 73% dead rows. Lower to 1% so
-- VACUUM kicks in early and disk IO stays bounded.
-- After backfill, run VACUUM ANALYZE manually (see SUPABASE_MIGRATION.md).

alter table public.chat_meta_data  set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.05
);
alter table public.group_meta_data set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.05
);
