-- =====================================================================
-- 017_realtime_publication_cleanup.sql — stop paying realtime for
-- tables no client ever subscribes to
-- (ported from adoptme-jan7 021_realtime_publication_cleanup.sql)
-- =====================================================================
-- COST CONTEXT:
-- Every table in the `supabase_realtime` publication is WAL-decoded by
-- the Realtime server on every write — whether or not anyone subscribes.
-- With REPLICA IDENTITY FULL, every UPDATE also writes the complete old
-- row image into WAL, doubling the decode payload.
--
-- The app's ONLY realtime subscriptions (Code/Supabase/*.js, verified
-- 2026-07-09 via grep over every postgres_changes binding) are:
--   messages, pinned_messages, private_messages, group_messages,
--   chat_meta_data, group_meta_data
-- Those stay untouched.
--
-- Never subscribed by any client — pure decode waste:
--   * All 8 user_* tables (003_users_split.sql:280-295). Written by the
--     mirrorUsersToSupabase CF on EVERY /users/{uid} RTDB write — the
--     hottest write path in the system — so each avatar change, xp bump,
--     counter write etc. was WAL-decoded (full row) for zero deliveries.
--
-- Old-build compatibility: pre-cutover builds have no Supabase client at
-- all, and no build has ever subscribed to a user_* table, so dropping
-- them from the publication affects no client. Plain selects (userBackend
-- fallback reads) are unaffected by publication membership.
--
-- Functional impact: NONE. If user_* realtime is ever introduced, re-add
-- the table to the publication and restore replica identity full.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Drop from the realtime publication (idempotent).
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'user_identity', 'user_roblox', 'user_roles', 'user_cosmetics',
    'user_notifications', 'user_settings', 'user_badges', 'user_blocks'
  ] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2) Reset replica identity to DEFAULT (primary key only).
-- FULL was only needed so realtime UPDATE payloads carried unchanged
-- columns; with no subscribers it just bloats WAL on every UPDATE.
-- ---------------------------------------------------------------------
alter table public.user_identity      replica identity default;
alter table public.user_roblox        replica identity default;
alter table public.user_roles         replica identity default;
alter table public.user_cosmetics     replica identity default;
alter table public.user_notifications replica identity default;
alter table public.user_settings      replica identity default;
alter table public.user_badges        replica identity default;
alter table public.user_blocks        replica identity default;

-- Verify (should list ONLY: chat_meta_data, group_meta_data,
-- group_messages, messages, pinned_messages, private_messages):
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' order by tablename;
