-- 044 step 2 of 3 — run in the SQL editor as ONE query, in order.
-- Source: supabase/044_group_privacy.sql

-- =====================================================================
-- STEP 2 — Arm public.group_messages: JMD / Mod edits of other people's
-- group messages are refused, hard DELETE is the sender or Senior Mod+.
-- Safe before the backfill (does not read group_members).
-- =====================================================================
set lock_timeout = '5s';

drop trigger if exists trg_ab_group_scope on public.group_messages;
create trigger trg_ab_group_scope
  before update on public.group_messages
  for each row execute function public.guard_group_message_scope();

drop policy if exists "group_messages delete by sender or staff"        on public.group_messages;
drop policy if exists "group_messages delete by sender or senior staff" on public.group_messages;
create policy "group_messages delete by sender or senior staff"
  on public.group_messages for delete
  using (sender_id = (select public.firebase_uid()) or (select public.is_group_staff()));

reset lock_timeout;
