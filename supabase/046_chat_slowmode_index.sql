-- =====================================================================
-- 046_chat_slowmode_index.sql (2026-10-19) — NOT APPLIED
--
-- Part of 046_chat_slowmode.sql. Run THIS FILE FIRST, ON ITS OWN, and NOT
-- inside begin/commit: CREATE INDEX CONCURRENTLY refuses to run in a
-- transaction block, so the file holds exactly one statement. CONCURRENTLY
-- builds the index without blocking chat inserts (public.messages has ~2 M
-- rows, ~15k new a day).
--
-- What it is for: the slow-mode trigger (046 STEP 2) asks "when did this
-- sender last post in this room, within the last N seconds?" for every
-- message while slow mode is on. With (sender_id, created_at desc) that is a
-- range probe over at most N seconds of one sender's messages. The existing
-- idx_messages_sender (sender_id only, 001) would read every message the
-- sender ever sent.
--
-- The new index also serves everything idx_messages_sender serves (same
-- leading column), so that one can be dropped later to win the space back —
-- optional, see the end of this file. Nothing else changes.
--
-- If the build fails or is cancelled it leaves an INVALID index: drop it
-- (drop index concurrently if exists public.idx_messages_sender_created;)
-- and run this file again. Check:
--   select indisvalid from pg_index
--    where indexrelid = 'public.idx_messages_sender_created'::regclass;   -- t
-- =====================================================================

create index concurrently if not exists idx_messages_sender_created
  on public.messages (sender_id, created_at desc);

-- OPTIONAL, later, once the index above is valid (each line on its own):
--   drop index concurrently if exists public.idx_messages_sender;
-- ROLLBACK:
--   drop index concurrently if exists public.idx_messages_sender_created;
