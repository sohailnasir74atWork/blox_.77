-- =====================================================================
-- 006_message_moderation.sql — soft delete + report counter on messages
-- =====================================================================
-- Adds the moderation fields needed to move delete + ban-and-delete-history
-- flows off RTDB (where they're hard deletes) and onto Supabase (soft
-- delete + audit trail).
--
-- Soft delete:
--   - `deleted` flag (bool, default false). UI filters on `deleted = false`
--     in loadMessages so deleted rows disappear immediately for everyone.
--   - `deleted_at`, `deleted_by` for audit / undo.
--
-- Report counter:
--   - `report_count` int (default 0). First report bumps to 1; second
--     report soft-deletes the message. Mirrors adoptme's reportMessage().
--
-- Safe to run on populated tables: existing rows get the column defaults.
-- =====================================================================

alter table public.messages
  add column if not exists deleted boolean not null default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists report_count integer not null default 0;

-- Index to keep "list non-deleted messages in a room" cheap. Partial
-- because deleted rows are a tiny minority and never appear in the feed.
create index if not exists idx_messages_room_active
  on public.messages (room_id, created_at desc, id desc)
  where deleted = false;
