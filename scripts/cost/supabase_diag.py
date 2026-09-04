import json, os, urllib.request, sys
REF="jaimyhmanefvrijvjzxl"
TOK=open(os.path.expanduser("~/.supabase/access-token")).read().strip()
def q(sql):
    req=urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query":sql}).encode(),
        headers={"Authorization":f"Bearer {TOK}","Content-Type":"application/json","User-Agent":"curl/8.7.1","Accept":"application/json"},method="POST")
    try:
        with urllib.request.urlopen(req,timeout=120) as r: return json.load(r)
    except urllib.error.HTTPError as e:
        return {"error":e.code,"body":e.read().decode()[:300]}
def show(title,sql,maxrows=40):
    print(f"\n## {title}")
    d=q(sql)
    if isinstance(d,dict) and "error" in d: print("  ERROR",d); return
    if not d: print("  (no rows)"); return
    cols=list(d[0].keys())
    print("  "+" | ".join(cols))
    for row in d[:maxrows]:
        print("  "+" | ".join(str(row.get(c))[:70].replace("\n"," ") for c in cols))
    if len(d)>maxrows: print(f"  ... {len(d)-maxrows} more")
Q=[
("db size","select pg_size_pretty(pg_database_size(current_database())) db_size, (now()-stats_reset)::text stats_age from pg_stat_database where datname=current_database()"),
("table sizes","""select relname, pg_size_pretty(pg_total_relation_size(c.oid)) total, pg_size_pretty(pg_relation_size(c.oid)) data, pg_size_pretty(pg_indexes_size(c.oid)) idx, n_live_tup live, n_dead_tup dead, round(100.0*n_dead_tup/nullif(n_live_tup+n_dead_tup,0),1) dead_pct, last_autovacuum::date av from pg_class c join pg_stat_user_tables s on s.relid=c.oid where c.relkind='r' order by pg_total_relation_size(c.oid) desc limit 25"""),
("table activity since stats reset","select relname, n_tup_ins ins, n_tup_upd upd, n_tup_del del, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch from pg_stat_user_tables order by (n_tup_ins+n_tup_upd+n_tup_del) desc limit 25"),
("top statements by total time","select calls, round(total_exec_time::numeric/1000) total_s, round(mean_exec_time::numeric,1) mean_ms, rows, left(regexp_replace(query,'\\s+',' ','g'),150) query from pg_stat_statements where query not ilike '%pg_stat%' and query not ilike '%pg_class%' order by total_exec_time desc limit 25"),
("top statements by rows returned (egress proxy)","select calls, rows, round(rows::numeric/nullif(calls,0)) rows_per_call, round(total_exec_time::numeric/1000) total_s, left(regexp_replace(query,'\\s+',' ','g'),150) query from pg_stat_statements where query not ilike '%pg_stat%' and query not ilike '%pg_class%' order by rows desc limit 25"),
("top statements by calls","select calls, rows, round(mean_exec_time::numeric,2) mean_ms, left(regexp_replace(query,'\\s+',' ','g'),150) query from pg_stat_statements where query not ilike '%pg_stat%' order by calls desc limit 25"),
("pg_stat_statements age","select (now()-stats_reset)::text age from pg_stat_statements_info"),
("realtime publication tables","select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1"),
("replica identity","select c.relname, c.relreplident from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1"),
("live realtime subscriptions by table","select entity::text tbl, count(*) subs, count(distinct subscription_id) ids, count(distinct claims->>'sub') users from realtime.subscription group by 1 order by 2 desc"),
("live realtime subscriptions sample filters","select entity::text tbl, filters::text f, count(*) n from realtime.subscription group by 1,2 order by 3 desc limit 15"),
("webhooks (supabase_functions.hooks)","select id, hook_table_id::regclass tbl, hook_name, type, left(function_args::text,120) args, created_at::date from supabase_functions.hooks order by id"),
("webhook triggers","select tgname, tgrelid::regclass tbl, tgenabled from pg_trigger where not tgisinternal and (tgname ilike '%webhook%' or tgname ilike '%supabase_functions%' or tgname ilike '%notify%')"),
("triggers per table (all)","select tgrelid::regclass tbl, count(*) n, string_agg(tgname, ', ') names from pg_trigger where not tgisinternal group by 1 order by 2 desc limit 20"),
("unused big indexes","select relname, indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) size from pg_stat_user_indexes where idx_scan < 50 and pg_relation_size(indexrelid) > 8*1024*1024 order by pg_relation_size(indexrelid) desc limit 15"),
("retention: oldest rows","""select 'messages' t, min(created_at)::date oldest, max(created_at)::date newest, count(*) n from public.messages
union all select 'private_messages', min(created_at)::date, max(created_at)::date, count(*) from public.private_messages
union all select 'group_messages', min(created_at)::date, max(created_at)::date, count(*) from public.group_messages
union all select 'chat_meta_data', min(updated_at)::date, max(updated_at)::date, count(*) from public.chat_meta_data
union all select 'user_identity', min(updated_at)::date, max(updated_at)::date, count(*) from public.user_identity"""),
("chat_meta rows per owner (distribution)","select percentile_cont(0.5) within group (order by n) p50, percentile_cont(0.9) within group (order by n) p90, percentile_cont(0.99) within group (order by n) p99, max(n) max, count(*) owners from (select owner_uid, count(*) n from public.chat_meta_data group by 1) s"),
("messages per day last 14d (public)","select created_at::date d, count(*) n from public.messages where created_at > now()-interval '14 days' group by 1 order by 1"),
("private messages per day last 14d","select created_at::date d, count(*) n from public.private_messages where created_at > now()-interval '14 days' group by 1 order by 1"),
("group messages per day last 14d","select created_at::date d, count(*) n from public.group_messages where created_at > now()-interval '14 days' group by 1 order by 1"),
("public messages per room last 7d","select room_id, count(*) n from public.messages where created_at > now()-interval '7 days' group by 1 order by 2 desc limit 20"),
("user_identity coverage","select (select count(*) from public.user_identity) identity_rows, (select count(*) from public.user_cosmetics) cosmetics_rows, (select count(*) from public.user_roles) roles_rows"),
("user_cosmetics columns","select column_name from information_schema.columns where table_schema='public' and table_name='user_cosmetics' order by ordinal_position"),
]
for t,s in Q: show(t,s)
