-- =====================================================================
-- 004_fix_messages_unique_index.sql — hotfix for Phase 1 mirror CF
--
-- Problem:
--   The original index in 001_public_chat.sql was a *partial* unique
--   index:
--     create unique index ... on messages (room_id, rtdb_key)
--       where rtdb_key is not null;
--   Postgres won't use a partial unique index to satisfy
--   `ON CONFLICT (room_id, rtdb_key)` unless the upsert query also
--   includes the matching predicate. supabase-js's onConflict option
--   doesn't expose the predicate, so the upsert fails with:
--     "there is no unique or exclusion constraint matching the
--      ON CONFLICT specification"
--   (seen in Cloud Function logs after deploy).
--
-- Fix:
--   Drop the partial index, replace with a full unique index on
--   (room_id, rtdb_key). Postgres treats NULLs as distinct in unique
--   indexes by default, so multiple rows with rtdb_key NULL in the
--   same room are still allowed (matches the prior partial-index
--   behaviour). In practice rtdb_key is essentially always set —
--   only the heuristic-pinned-message fallback path can leave it null.
-- =====================================================================

drop index if exists public.idx_messages_room_rtdb_key;

create unique index if not exists idx_messages_room_rtdb_key
  on public.messages (room_id, rtdb_key);
