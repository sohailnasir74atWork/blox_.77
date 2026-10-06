-- 034 step 5 of 8 — run in the SQL editor as ONE query, in order.
-- Source: supabase/034_chat_moderation_enforcement.sql

-- =====================================================================
-- STEP 5 — pinned_messages: staff only (M5). No update policy exists.
-- =====================================================================
set lock_timeout = '5s';

drop policy if exists "pinned insert authenticated" on public.pinned_messages;
drop policy if exists "pinned insert staff"         on public.pinned_messages;
create policy "pinned insert staff"
  on public.pinned_messages for insert
  with check (
    (select public.is_mod_staff())
    and (pinned_by is null or pinned_by = (select public.firebase_uid()))
  );

drop policy if exists "pinned delete authenticated" on public.pinned_messages;
drop policy if exists "pinned delete staff"         on public.pinned_messages;
create policy "pinned delete staff"
  on public.pinned_messages for delete
  using ((select public.is_mod_staff()));

reset lock_timeout;
