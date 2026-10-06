-- 034 step 6 of 8 — run in the SQL editor as ONE query, in order.
-- Source: supabase/034_chat_moderation_enforcement.sql

-- =====================================================================
-- STEP 6 — chat_meta_data: direct writes to your OWN rows only.
-- The pair write is send_private_chat_meta() (SECURITY DEFINER); unread
-- reset, mute and swipe-delete all touch the caller's own row.
-- =====================================================================
set lock_timeout = '5s';

drop policy if exists "chat_meta_data insert by participant" on public.chat_meta_data;
drop policy if exists "chat_meta_data insert by owner"       on public.chat_meta_data;
create policy "chat_meta_data insert by owner"
  on public.chat_meta_data for insert
  with check (owner_uid = (select public.firebase_uid()));

drop policy if exists "chat_meta_data update by participant" on public.chat_meta_data;
drop policy if exists "chat_meta_data update by owner"       on public.chat_meta_data;
create policy "chat_meta_data update by owner"
  on public.chat_meta_data for update
  using (owner_uid = (select public.firebase_uid()))
  with check (owner_uid = (select public.firebase_uid()));

reset lock_timeout;
