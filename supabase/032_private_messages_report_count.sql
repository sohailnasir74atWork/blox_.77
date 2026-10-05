-- =====================================================================
-- 032_private_messages_report_count.sql (2026-10-05)
--
-- 009_private_messages.sql defines report_count, but the column is missing
-- in production (checked 2026-10-05: PostgREST 42703 "column
-- private_messages.report_count does not exist"; deleted / deleted_at /
-- deleted_by are present). Every DM report from the app
-- (privateMessagesBackend.reportPrivateMessage) and the website therefore
-- failed.
--
-- Adding a column with a constant default is a metadata-only change in
-- Postgres 11+ (no table rewrite), so this is safe under live traffic. The
-- lock_timeout keeps it from queueing behind a long transaction; just re-run
-- if it times out. Idempotent.
-- =====================================================================
set lock_timeout = '5s';

alter table public.private_messages
  add column if not exists report_count integer not null default 0;

reset lock_timeout;

-- Let PostgREST see the new column straight away.
notify pgrst, 'reload schema';
