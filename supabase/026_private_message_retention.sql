-- =====================================================================
-- 026_private_message_retention.sql — purge private messages older than
-- 30 days, in self-throttling batches
-- =====================================================================
-- WHY THIS EXISTS
-- public.private_messages reached 8.0M rows / 6,249 MB — 61% of the
-- entire database — and pushed the disk past 90%, triggering Supabase's
-- auto-expansion (12 GB -> 18 GB, +$0.75/mo permanently; disks cannot be
-- shrunk). No retention policy existed anywhere in migrations 000-025.
--
-- WHY BATCHED AND NOT ONE `DELETE`
-- Two properties of this table make a single big DELETE dangerous:
--
--   1. `replica identity full` (009_private_messages.sql:135) — every
--      deleted row writes its COMPLETE old image into WAL, not just the
--      key. Millions of rows in one transaction is a WAL burst large
--      enough to trigger ANOTHER disk expansion before autovacuum can
--      reclaim it.
--
--   2. The table is in the `supabase_realtime` publication and clients
--      subscribe to DELETE (privateMessagesBackend.js:164). Every row
--      removed is WAL-decoded by the Realtime server. Millions at once
--      will peg CPU on the t4g.micro instance.
--
-- Batching through pg_cron gives one transaction per batch (WAL is
-- recycled between runs) and spreads decode load over hours.
--
-- WHY THERE IS NO `CONCURRENTLY` AND NO NEW INDEX UP FRONT
-- The Supabase SQL Editor wraps every statement in a transaction, so
-- CREATE/DROP INDEX CONCURRENTLY and VACUUM all fail there with
-- `25001: cannot run inside a transaction block`. There is no
-- single-statement workaround; they need a direct psql connection.
--
-- So this migration is written to need none of them. The purge below has
-- NO `order by`, which is the whole trick: with `limit p_batch` and no
-- sort, Postgres seq-scans and STOPS as soon as it finds a full batch.
-- private_messages has almost no UPDATEs (the `deleted = false` partial
-- index was byte-identical in size to the unfiltered one, proving soft
-- deletes are rare), so heap order still tracks insertion order and the
-- oldest rows sit at the front of the heap. Each batch reads a few
-- thousand pages and stops. An `order by created_at` would instead force
-- a sort of every matching row on every batch — that is what needs the
-- index, and that is what we are avoiding.
--
-- The created_at index still gets built, but in STEP 4 — AFTER the
-- backlog has drained. On a ~1M-row table a plain CREATE INDEX finishes
-- in seconds, so the brief write lock is a non-issue; on the 8M-row
-- table it would have blocked DM sends for minutes.
--
-- WHAT USERS SEE
-- DM history older than 30 days disappears. Inbox previews survive —
-- chat_meta_data.last_message is stored inline (002_chat_metadata.sql:33)
-- and is not touched here. Opening an old chat shows an empty thread.
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 0 — Know the blast radius before you commit. Read-only.
-- ---------------------------------------------------------------------
--   select
--     count(*) filter (where created_at < now() - interval '30 days') as will_delete,
--     count(*)                                                        as total,
--     min(created_at)                                                 as oldest
--   from public.private_messages;


-- ---------------------------------------------------------------------
-- STEP 1 — Finish the index cleanup that CONCURRENTLY blocked.
-- ---------------------------------------------------------------------
-- These two are redundant: each is byte-identical in size to an
-- unfiltered index over the same columns, so the `WHERE deleted = false`
-- predicate buys no selectivity while costing 1,531 MB and a write on
-- every INSERT.
--
-- Plain DROP INDEX takes a brief ACCESS EXCLUSIVE lock, but the work is
-- just unlinking files — it returns in well under a second. It does wait
-- for in-flight queries on the table to finish first.

drop index if exists public.idx_private_messages_chat_active;   -- 1,327 MB
drop index if exists public.idx_messages_room_active;           --   204 MB


-- ---------------------------------------------------------------------
-- STEP 2 — The batch worker.
-- ---------------------------------------------------------------------
-- Deletes at most p_batch rows per call and returns how many it removed.
-- `skip locked` means a batch never blocks on a row another transaction
-- is touching — a live chat write is never delayed by the purge.
--
-- Deliberately no `order by`: see the header. Once STEP 4's index exists
-- the planner switches to an index scan for the same query, so this
-- function is correct and efficient both before and after.

create or replace function public.purge_private_messages(
  p_older_than interval default '30 days',
  p_batch      integer  default 20000
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  with doomed as (
    select id
      from public.private_messages
     where created_at < now() - p_older_than
     limit p_batch
     for update skip locked
  )
  delete from public.private_messages p
   using doomed d
   where p.id = d.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_private_messages(interval, integer) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- STEP 3 — Schedule the drain, plus the webhook-log prune.
-- ---------------------------------------------------------------------
-- Each pg_cron run is its own transaction, so WAL is recycled between
-- batches instead of accumulating.
--
-- 20k/minute drains ~1.2M rows/hour — divide STEP 0's `will_delete` by
-- that for your drain time. It then settles into steady state (you write
-- far less than 20k DMs/minute). Start during low traffic and watch
-- Dashboard -> Reports -> Database CPU. Above ~70%, lower the batch.
--
-- supabase_functions.hooks refills at ~1 row/sec (one per private
-- message): ~2.6M rows and ~400 MB/month. Truncating once only resets
-- the clock, so it gets a daily prune with a 3-day audit window.

create extension if not exists pg_cron;

select cron.schedule(
  'purge-private-messages',
  '* * * * *',
  $$select public.purge_private_messages('30 days', 20000)$$
);

select cron.schedule(
  'purge-webhook-hooks',
  '17 4 * * *',
  $$delete from supabase_functions.hooks where created_at < now() - interval '3 days'$$
);


-- ---------------------------------------------------------------------
-- STEP 4 — ONLY after STEP 0 shows will_delete = 0. Index the predicate.
-- ---------------------------------------------------------------------
-- Now that the table is small, plain CREATE INDEX finishes in seconds.
-- It takes a SHARE lock (reads fine, writes blocked) for that window.
-- Costs ~25 MB at ~1M rows, and keeps the steady-state daily purge on an
-- index scan instead of a seq scan of the whole table every minute.

--   create index if not exists idx_private_messages_created_at
--     on public.private_messages (created_at);


-- ---------------------------------------------------------------------
-- STEP 5 — Reclaim the index space. NEEDS A DIRECT psql CONNECTION.
-- ---------------------------------------------------------------------
-- DELETE leaves btree pages partially empty; private_messages' 4,344 MB
-- of indexes will NOT shrink just because 85% of the rows are gone.
-- REINDEX is what compacts them and returns the space to the OS.
--
-- REINDEX (non-concurrent) *would* run in the SQL Editor, but it holds
-- an ACCESS EXCLUSIVE lock on the table for the whole rebuild — DMs stop
-- working entirely for minutes. Do not do that on a live table.
--
-- Get the connection string from Dashboard -> Settings -> Database
-- ("Connection string" -> psql), then run these one at a time:
--
--   reindex index concurrently public.idx_private_messages_chat_created;
--   reindex index concurrently public.idx_private_messages_chat_client_msg_id;
--   reindex index concurrently public.private_messages_pkey;
--   reindex index concurrently public.idx_private_messages_sender;
--   reindex index concurrently public.idx_private_messages_recipient;
--
-- Same session is the place to run the VACUUM that the editor refused:
--   vacuum analyze public.private_messages;
--
-- If you skip STEP 5 entirely: the freed space still becomes REUSABLE
-- inside Postgres, so the table stops growing and no further auto-
-- expansion is triggered. You just don't get the space back for other
-- tables. That is an acceptable place to stop.


-- =====================================================================
-- MONITORING
--   select jobname, schedule, active from cron.job;
--   select jobid, runid, status, return_message, start_time, end_time
--     from cron.job_run_details
--    where jobid in (select jobid from cron.job
--                     where jobname = 'purge-private-messages')
--    order by start_time desc limit 20;
--
-- PAUSE THE DRAIN (safe at any point — it resumes where it left off):
--   select cron.unschedule('purge-private-messages');
--
-- ROLLBACK
--   select cron.unschedule('purge-private-messages');
--   select cron.unschedule('purge-webhook-hooks');
--   drop function if exists public.purge_private_messages(interval, integer);
--   -- Deleted rows are NOT recoverable. There is no undo for the data.
-- =====================================================================
