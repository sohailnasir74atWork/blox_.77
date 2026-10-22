-- =====================================================================
-- 051_chat_cleanup.sql (2026-10-20) — nightly chat cleanup that sends
-- nothing over Realtime
-- =====================================================================
-- Owner decision 2026-10-20: old chat is useless. Keep
--   public chat (messages)            2 days   (pinned messages kept)
--   group chats (group_messages)     30 days
--   inbox rows (chat_meta_data)      30 days   (private messages are already
--                                              purged at 30 days by 026, so
--                                              these rows point at empty chats)
--
-- WHY
-- The project warned it was about to run out of its Disk IO budget
-- (Micro, 1 GB RAM, 6.7 GB database). The inbox load
-- (chatMetaBackend.loadChatMeta) reads EVERY chat_meta_data row of the
-- user: 3.4M rows, 88% older than 30 days. It was the top disk reader
-- after the 2026-10-20 restart. Public chat held 2.9M rows (~12k/day).
--
-- WHY NOT A PLAIN DELETE / pg_cron PURGE LIKE 026
-- All three tables are in the supabase_realtime publication with
-- REPLICA IDENTITY FULL, and clients subscribe to DELETE ('*' on
-- messages and chat_meta_data, DELETE on group_messages). Every deleted
-- row would be delivered to everyone watching that room / inbox / group,
-- and Realtime messages are billed per delivery (12.4M this cycle against
-- 5M included on 2026-10-20). A public-chat backlog of 2.86M rows x ~26
-- watchers would have been tens of millions of billed messages.
--
-- HOW IT STAYS SILENT
-- Realtime here is the wal2json poller (realtime.list_changes). It builds
-- its 'add-tables' list from pg_publication_tables AT EACH POLL. So:
--   1. drop the table from supabase_realtime        (phase idle -> sweeping)
--   2. delete old rows in ctid block ranges         (sweeping)
--   3. next tick: remember pg_current_wal_lsn()     (readd, lsn null)
--   4. once the wal2json slot's confirmed_flush_lsn has passed that LSN,
--      every delete was decoded while the table was out of the list ->
--      skipped. Add the table back.                 (readd -> idle)
-- Step 3 is a separate tick on purpose: an LSN read inside the deleting
-- transaction is BEFORE its commit record, and another transaction
-- committing in between could move the slot past it first.
--
-- WHAT USERS SEE
-- During the window (00:30 UTC, the quietest hour: ~130 public messages)
-- live updates for that table pause: new public/group messages and inbox
-- badge changes arrive on the next app foreground / reload instead of
-- live. First night (backlog) ~10-15 min, later nights ~2-3 min.
-- private_messages is NOT touched, so an open DM stays live.
-- Old chats leave the inbox; if either side writes again the row is
-- re-created by send_private_chat_meta. Old group/public messages are gone.
--
-- COST
-- No new index, no compute change. Each night reads each table once
-- (~2 GB total), far under the 11 MB/s baseline.
--
-- FAILSAFE
-- A table out of the publication for more than 3 hours is put back no
-- matter what. Manual: select public.chat_cleanup_restore_realtime();
-- =====================================================================


-- ---------------------------------------------------------------------
-- State (not exposed to the API: RLS on, no policies, grants revoked)
-- ---------------------------------------------------------------------
create table if not exists public.chat_cleanup_state (
  tbl           text primary key,
  pred          text not null,      -- rows to delete; table alias is t
  phase         text not null default 'idle'
                check (phase in ('idle', 'sweeping', 'readd')),
  next_block    bigint not null default 0,
  lsn           pg_lsn,
  started_at    timestamptz,
  finished_at   timestamptz,
  last_done_on  date,
  deleted_run   bigint not null default 0,
  deleted_total bigint not null default 0
);

alter table public.chat_cleanup_state enable row level security;
revoke all on public.chat_cleanup_state from public, anon, authenticated;

insert into public.chat_cleanup_state (tbl, pred) values
  ('messages',
   $p$t.created_at < now() - interval '2 days'
      and not exists (select 1 from public.pinned_messages p where p.message_id = t.id)$p$),
  ('group_messages',
   $p$t.created_at < now() - interval '30 days'$p$),
  ('chat_meta_data',
   $p$t.timestamp_ms < (extract(epoch from now() - interval '30 days') * 1000)::bigint$p$)
on conflict (tbl) do update set pred = excluded.pred;


-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.chat_cleanup_in_pub(p_tbl text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = p_tbl
  );
$$;

-- Start a sweep now (all idle tables, or one). Used by the nightly tick
-- and by hand: select public.chat_cleanup_start('group_messages');
create or replace function public.chat_cleanup_start(p_tbl text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  n int := 0;
begin
  for s in
    select * from public.chat_cleanup_state
     where phase = 'idle' and (p_tbl is null or tbl = p_tbl)
     for update
  loop
    if public.chat_cleanup_in_pub(s.tbl) then
      execute format('alter publication supabase_realtime drop table public.%I', s.tbl);
    end if;
    update public.chat_cleanup_state
       set phase = 'sweeping', next_block = 0, lsn = null,
           started_at = now(), finished_at = null, deleted_run = 0
     where tbl = s.tbl;
    n := n + 1;
  end loop;
  return n || ' table(s) started';
end;
$$;

-- Put every table back into realtime immediately and mark it idle.
create or replace function public.chat_cleanup_restore_realtime()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  n int := 0;
begin
  for s in select * from public.chat_cleanup_state for update loop
    if not public.chat_cleanup_in_pub(s.tbl) then
      execute format('alter publication supabase_realtime add table public.%I', s.tbl);
      n := n + 1;
    end if;
    if s.phase <> 'idle' then
      update public.chat_cleanup_state
         set phase = 'idle', finished_at = now(),
             deleted_total = deleted_total + deleted_run
       where tbl = s.tbl;
    end if;
  end loop;
  return n || ' table(s) re-added';
end;
$$;


-- ---------------------------------------------------------------------
-- The tick (pg_cron, every minute). Does nothing unless a sweep is due
-- or running. Each tick spends at most ~50 s deleting.
-- ---------------------------------------------------------------------
create or replace function public.chat_cleanup_tick()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s        record;
  t0       timestamptz := clock_timestamp();
  step     constant bigint := 4000;   -- blocks per statement (~32 MB)
  nblocks  bigint;
  d        bigint;
  slot_lsn pg_lsn;
  utc_now  timestamp := now() at time zone 'utc';
begin
  -- Nightly start, once per UTC day, 00:30-01:29 UTC.
  if utc_now::time >= time '00:30' and utc_now::time < time '01:30' then
    perform public.chat_cleanup_start(c.tbl)
       from public.chat_cleanup_state c
      where c.phase = 'idle'
        and coalesce(c.last_done_on, date '2000-01-01') < utc_now::date;
  end if;

  for s in
    select * from public.chat_cleanup_state where phase <> 'idle' order by tbl for update
  loop
    -- Failsafe: never leave a table out of realtime for more than 3 hours.
    if now() - s.started_at > interval '3 hours' then
      if not public.chat_cleanup_in_pub(s.tbl) then
        execute format('alter publication supabase_realtime add table public.%I', s.tbl);
      end if;
      update public.chat_cleanup_state
         set phase = 'idle', finished_at = now(), last_done_on = utc_now::date,
             deleted_total = deleted_total + deleted_run
       where tbl = s.tbl;
      continue;
    end if;

    if s.phase = 'sweeping' then
      nblocks := pg_relation_size(format('public.%I', s.tbl)::regclass)
                 / current_setting('block_size')::bigint;
      while s.next_block < nblocks and clock_timestamp() - t0 < interval '50 seconds' loop
        execute format(
          'delete from public.%I t where t.ctid >= %L::tid and t.ctid < %L::tid and (%s)',
          s.tbl,
          format('(%s,0)', s.next_block),
          format('(%s,0)', s.next_block + step),
          s.pred);
        get diagnostics d = row_count;
        s.next_block  := s.next_block + step;
        s.deleted_run := s.deleted_run + d;
      end loop;
      update public.chat_cleanup_state
         set next_block = s.next_block,
             deleted_run = s.deleted_run,
             phase = case when s.next_block >= nblocks then 'readd' else 'sweeping' end
       where tbl = s.tbl;

    elsif s.phase = 'readd' then
      if s.lsn is null then
        -- First tick after the last delete committed: this LSN is past it.
        update public.chat_cleanup_state set lsn = pg_current_wal_lsn() where tbl = s.tbl;
      else
        select max(confirmed_flush_lsn) into slot_lsn
          from pg_replication_slots
         where plugin = 'wal2json' and slot_name like 'supabase_realtime%';
        if slot_lsn is null or slot_lsn >= s.lsn then
          if not public.chat_cleanup_in_pub(s.tbl) then
            execute format('alter publication supabase_realtime add table public.%I', s.tbl);
          end if;
          update public.chat_cleanup_state
             set phase = 'idle', finished_at = now(), last_done_on = utc_now::date,
                 deleted_total = deleted_total + deleted_run
           where tbl = s.tbl;
        end if;
      end if;
    end if;
  end loop;

  return 'ok';
end;
$$;

revoke all on function public.chat_cleanup_in_pub(text)          from public, anon, authenticated;
revoke all on function public.chat_cleanup_start(text)           from public, anon, authenticated;
revoke all on function public.chat_cleanup_restore_realtime()    from public, anon, authenticated;
revoke all on function public.chat_cleanup_tick()                from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------
select cron.schedule('chat-cleanup-tick', '* * * * *', $$select public.chat_cleanup_tick()$$);


-- =====================================================================
-- MONITORING
--   select tbl, phase, next_block, deleted_run, deleted_total, started_at,
--          finished_at, last_done_on from public.chat_cleanup_state;
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime';
--   select status, return_message, start_time from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'chat-cleanup-tick')
--    order by start_time desc limit 10;
-- ROLLBACK (stops future cleanups; deleted rows stay deleted)
--   select public.chat_cleanup_restore_realtime();
--   select cron.unschedule('chat-cleanup-tick');
-- =====================================================================
