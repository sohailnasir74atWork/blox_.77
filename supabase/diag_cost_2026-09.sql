-- =====================================================================
-- Supabase cost diagnostics — Blox Fruit (jaimyhmanefvrijvjzxl)
-- Read-only. Paste into Dashboard → SQL Editor and run each block,
-- or let Claude run it via the Management API with a personal access token.
-- =====================================================================

-- 0) Plan facts that only the dashboard shows (not SQL):
--    Organization → Usage: Third-Party MAU, Realtime Messages,
--    Realtime Peak Connections, Egress, Disk size, Compute hours.

-- 1) Table sizes (data + indexes + toast)
select relname as table_name,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total,
       pg_size_pretty(pg_relation_size(c.oid))       as data,
       pg_size_pretty(pg_indexes_size(c.oid))        as indexes,
       n_live_tup, n_dead_tup,
       round(100.0*n_dead_tup/nullif(n_live_tup+n_dead_tup,0),1) as dead_pct,
       last_autovacuum
from pg_class c
join pg_stat_user_tables s on s.relid=c.oid
where c.relkind='r'
order by pg_total_relation_size(c.oid) desc;

-- 2) Database size total
select pg_size_pretty(pg_database_size(current_database())) as db_size;

-- 3) Write/read activity per table since stats reset (divide by days since reset)
select now()-stats_reset as stats_age from pg_stat_database where datname=current_database();
select relname, n_tup_ins as inserts, n_tup_upd as updates, n_tup_del as deletes,
       seq_scan, seq_tup_read, idx_scan, idx_tup_fetch
from pg_stat_user_tables order by (n_tup_ins+n_tup_upd+n_tup_del) desc;

-- 4) Top statements by total time / calls / rows (pg_stat_statements)
select calls, round(total_exec_time::numeric/1000,1) as total_s,
       round(mean_exec_time::numeric,2) as mean_ms, rows,
       left(query,160) as query
from pg_stat_statements
where query not ilike '%pg_stat%'
order by total_exec_time desc limit 30;

select calls, round(total_exec_time::numeric/1000,1) as total_s, rows, left(query,160) as query
from pg_stat_statements
where query not ilike '%pg_stat%'
order by calls desc limit 30;

-- 5) Realtime: what is still in the publication (each table = WAL decode on every write)
select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1;
select c.relname, c.relreplident  -- 'f' = FULL (bigger WAL), 'd' = default
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' order by 1;

-- 6) Realtime subscriptions right now (approximate live subscriber count per table/filter)
select entity::text as table_name, filters, count(*) as subscribers
from realtime.subscription group by 1,2 order by 3 desc limit 30;

-- 7) Database webhooks (each fires an HTTP call = egress + Cloud Function invocation)
select id, hook_table_id::regclass as on_table, hook_name, type, function_args
from supabase_functions.hooks order by hook_table_id;
select tgname, tgrelid::regclass as on_table, tgenabled
from pg_trigger where tgname ilike '%webhook%' or tgname ilike '%supabase_functions%';

-- 8) Unused / rarely used indexes (candidates to drop → smaller disk, cheaper writes)
select schemaname, relname, indexrelname, idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid)) as size
from pg_stat_user_indexes
where idx_scan < 50 and pg_relation_size(indexrelid) > 8*1024*1024
order by pg_relation_size(indexrelid) desc;

-- 9) Message retention check — how old is the oldest data still kept?
select 'messages' t, min(created_at) oldest, max(created_at) newest, count(*) from public.messages
union all select 'private_messages', min(created_at), max(created_at), count(*) from public.private_messages
union all select 'group_messages', min(created_at), max(created_at), count(*) from public.group_messages
union all select 'chat_meta_data', min(updated_at), max(updated_at), count(*) from public.chat_meta_data;
