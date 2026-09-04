-- =====================================================================
-- 027_cosmetics_columns_game_win.sql — APPLIED 2026-09-03 via Management API
--
-- Additive only (safe for every app build):
--   * user_cosmetics gains the five active-cosmetic columns that the
--     deployed mirrorUsersToSupabase CF has been trying to upsert since
--     July (the upserts failed silently → 0 writes in 18 days).
--   * user_identity gains last_game_win_ms so the client can stop doing a
--     per-user RTDB read for lastGameWinAt / hasRecentGameWin.
-- Old clients select explicit columns, so extra columns are invisible to them.
-- =====================================================================
alter table public.user_cosmetics
  add column if not exists profile_frame   jsonb,
  add column if not exists chat_text_color jsonb,
  add column if not exists trade_card_bg   jsonb,
  add column if not exists profile_banner  jsonb,
  add column if not exists chat_bubble_bg  jsonb;

alter table public.user_identity
  add column if not exists last_game_win_ms bigint;

-- PostgREST schema cache
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 2026-09-04: the deployed mirrorUsersToSupabase writes decoded_email,
-- flag, date_of_birth and last_profile_edit_ms into user_identity, but the
-- table never had them → every identity upsert failed ("Could not find the
-- 'date_of_birth' column"), so new users got no identity row and name /
-- avatar changes never reached Supabase. Additive fix. APPLIED 2026-09-04.
-- ---------------------------------------------------------------------
alter table public.user_identity
  add column if not exists decoded_email        text,
  add column if not exists flag                 text,
  add column if not exists date_of_birth        text,
  add column if not exists last_profile_edit_ms bigint;
notify pgrst, 'reload schema';
