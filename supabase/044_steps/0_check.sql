-- 044 step 0 of 4 — run in the SQL editor as ONE query, in order.
-- Source: supabase/044_group_privacy.sql

-- =====================================================================
-- STEP 0 — Read-only. Where am I?   Fully applied: t | 8 | 2 | (rows) | 4 | 3
-- =====================================================================
select
  (select count(*) = 1 from pg_tables
    where schemaname = 'public' and tablename = 'group_members')                        as step1_table,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('_jwt_is_owner', 'is_group_staff', '_group_member_role', '_group_can_post',
                        'guard_group_message_scope', 'delete_group_message',
                        'delete_group_messages_by_sender', 'purge_group_chat'))         as step1_functions,
  (select count(*) from pg_trigger where tgrelid = 'public.group_messages'::regclass
      and tgname = 'trg_ab_group_scope')
    + (select count(*) from pg_policies where schemaname = 'public' and tablename = 'group_messages'
      and policyname = 'group_messages delete by sender or senior staff')                 as step2_group_messages,
  (select reltuples::bigint from pg_class
    where oid = to_regclass('public.group_members'))                                     as backfilled_rows_estimate,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'group_messages'
      and policyname = 'group_messages select member or senior staff')
    + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'is_group_member' and p.prosrc like '%group_members%')
    + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'send_group_message' and p.prosrc like '%_group_can_post%')
    + (select count(*) from pg_policies where schemaname = 'public' and tablename = 'group_meta_data'
      and policyname = 'group_meta_data read shared group' and qual like '%is_group_staff%')  as step3_switch,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'group_meta_data' and column_name = 'archived_at')
    + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('group_last_activity', 'set_group_archived')) as step4_cleanup;
