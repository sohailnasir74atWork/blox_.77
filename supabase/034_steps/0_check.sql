-- 034 step 0 of 8 — run in the SQL editor as ONE query, in order.
-- Source: supabase/034_chat_moderation_enforcement.sql

-- =====================================================================
-- STEP 0 — Read-only. Where am I?   Fully applied: t | 9 | 3 | 3 | 3 | 2 | 2 | 4 | 2
-- =====================================================================
select
  (select count(*) = 1 from pg_tables
    where schemaname = 'public' and tablename = 'message_reports')               as step1_table,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('enforce_chat_ban', 'enforce_chat_links', 'guard_chat_message_update',
                        'report_message', 'list_message_reports', 'upsert_group_meta_members',
                        'caller_chat_ban_kind', '_record_message_report', '_sender_ban_kind')) as step1_functions,
  (select count(*) from pg_trigger where tgrelid = 'public.messages'::regclass
      and tgname in ('trg_aa_chat_ban', 'trg_ab_chat_links', 'trg_ac_chat_update_guard'))      as step2_messages,
  (select count(*) from pg_trigger where tgrelid = 'public.private_messages'::regclass
      and tgname in ('trg_aa_chat_ban', 'trg_ab_chat_links', 'trg_ac_chat_update_guard'))      as step3_private,
  (select count(*) from pg_trigger where tgrelid = 'public.group_messages'::regclass
      and tgname in ('trg_aa_chat_ban', 'trg_ab_chat_links', 'trg_ac_chat_update_guard'))      as step4_group,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'pinned_messages'
      and policyname in ('pinned insert staff', 'pinned delete staff'))                       as step5_pins,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'chat_meta_data'
      and policyname in ('chat_meta_data insert by owner', 'chat_meta_data update by owner')) as step6_chat_meta,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'group_meta_data'
      and policyname in ('group_meta_data insert by member', 'group_meta_data update by member',
                         'group_meta_data read shared group'))
    + (select count(*) from pg_trigger where tgname = 'trg_ac_group_meta_guard')            as step7_group_meta,
  (select count(*) from pg_trigger
    where tgname = 'trg_aa_chat_ban'
      and tgrelid in ('public.poll_comments'::regclass, 'public.poll_votes'::regclass))       as step8_polls;
