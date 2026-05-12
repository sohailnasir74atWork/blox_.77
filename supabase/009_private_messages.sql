-- =====================================================================
-- 009_private_messages.sql — Phase 5
--
-- Move /private_messages/{chatId}/messages/{key} off RTDB into Supabase.
-- This is the "actual private message body" — the chat list metadata
-- (who you talked to / unread / mute) is already in chat_meta_data.
--
-- Backward compat: NONE this phase. Old app builds reading RTDB
-- /private_messages will not see new messages. Accepted tradeoff per
-- user direction ("don't care about old users").
--
-- Notification CF: needs to be re-pointed at Supabase. The current CF
-- is a RTDB onCreate trigger; rewrite it as an HTTPS function that
-- accepts a Supabase Database Webhook payload (configured in dashboard:
-- Database → Webhooks → INSERT on private_messages).
--
-- Trade subtree (private_messages/{chatId}/trade) is OUT of scope —
-- stays on RTDB.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. private_messages — flat table, one row per message across all
--    1-on-1 conversations. chat_id is the canonical [a,b].sort().join('_')
--    pair id, mirroring the RTDB convention.
-- ---------------------------------------------------------------------
create table if not exists public.private_messages (
  id              uuid primary key default gen_random_uuid(),

  -- Idempotency: client generates a UUID per send, retries are no-ops
  -- via UNIQUE(chat_id, client_msg_id). Same pattern as
  -- public.messages.client_msg_id (005_client_msg_id.sql).
  client_msg_id   uuid,

  chat_id         text not null,             -- e.g. 'abc123_xyz789' (sorted)
  sender_id       text not null,             -- Firebase UID
  recipient_id    text not null,             -- denormalised so RLS + indexes are simple

  text            text,                      -- nullable when image-only / fruit-only
  image_url       text,
  fruits          jsonb not null default '[]'::jsonb,

  -- reply_to: { id, text, senderId, imageUrl, hasFruits, fruitsCount }
  -- Mirrors the shape PrivateChat.jsx wrote to RTDB.
  reply_to        jsonb,

  os              text,

  -- Soft delete: keep the audit trail for moderation. UI filters
  -- `deleted = false` in load + treats UPDATE deleted=true as a removal.
  deleted         boolean not null default false,
  deleted_at      timestamptz,
  deleted_by      text,

  -- Report counter for the second-report → soft-delete flow in
  -- ReportPopUp. First report bumps to 1; second report (count >= 1)
  -- soft-deletes + escalates ban. Mirrors public.messages.report_count.
  report_count    integer not null default 0,

  created_at      timestamptz not null default now()
);

-- Pagination + realtime filter index. Same composite-cursor approach as
-- public.messages.
create index if not exists idx_private_messages_chat_created
  on public.private_messages (chat_id, created_at desc, id desc);

-- Idempotent send. NULL client_msg_id is allowed (legacy / mirrored
-- rows have no idempotency key) and Postgres treats NULLs as distinct
-- so the index doesn't collide.
create unique index if not exists idx_private_messages_chat_client_msg_id
  on public.private_messages (chat_id, client_msg_id)
  where client_msg_id is not null;

-- Active-only partial index — ~all reads filter on deleted = false.
create index if not exists idx_private_messages_chat_active
  on public.private_messages (chat_id, created_at desc, id desc)
  where deleted = false;

-- For "delete all messages by a user across all their chats" admin flows,
-- and the notification CF lookup by recipient.
create index if not exists idx_private_messages_sender on public.private_messages (sender_id);
create index if not exists idx_private_messages_recipient on public.private_messages (recipient_id);


-- =====================================================================
-- Row Level Security
-- =====================================================================
-- A 1-on-1 message belongs to exactly two people (sender, recipient).
-- Either of them can read; only the sender can insert their own
-- message; either side can soft-delete (UPDATE deleted=true) so a
-- recipient can clear an offensive message from their own thread; only
-- a participant can hard-delete (rare, normally moderation route).
-- =====================================================================

alter table public.private_messages enable row level security;

drop policy if exists "private_messages select by participant" on public.private_messages;
create policy "private_messages select by participant"
  on public.private_messages for select
  using (
    public.firebase_uid() in (sender_id, recipient_id)
  );

drop policy if exists "private_messages insert own" on public.private_messages;
create policy "private_messages insert own"
  on public.private_messages for insert
  with check (sender_id = public.firebase_uid());

drop policy if exists "private_messages update by participant" on public.private_messages;
create policy "private_messages update by participant"
  on public.private_messages for update
  using (public.firebase_uid() in (sender_id, recipient_id))
  with check (public.firebase_uid() in (sender_id, recipient_id));

drop policy if exists "private_messages delete by participant" on public.private_messages;
create policy "private_messages delete by participant"
  on public.private_messages for delete
  using (public.firebase_uid() in (sender_id, recipient_id));


-- =====================================================================
-- Realtime publication
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'private_messages'
  ) then
    alter publication supabase_realtime add table public.private_messages;
  end if;
end $$;

alter table public.private_messages replica identity full;


-- =====================================================================
-- Autovacuum tuning
-- =====================================================================
-- Soft-deletes leave dead tuples + this is a high-write table. Same
-- aggressive autovacuum threshold we apply to chat_meta_data.
alter table public.private_messages set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.05
);
