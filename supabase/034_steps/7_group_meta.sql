-- 034 step 7 of 8 — run in the SQL editor as ONE query, in order.
-- Source: supabase/034_chat_moderation_enforcement.sql

-- =====================================================================
-- STEP 7 — group_meta_data: own rows freely; another member's row only as a
-- member of that group (or staff), and then only its group identity columns
-- (guard_group_meta_write). DELETE stays owner-only (007).
-- The co-member SELECT policy is what lets old builds' PostgREST upserts
-- (INSERT … ON CONFLICT DO UPDATE) reach other members' rows at all. It is
-- named to sort after "read own" so the cheap own-row test is tried first.
-- =====================================================================
set lock_timeout = '5s';

drop policy if exists "group_meta_data read shared group" on public.group_meta_data;
create policy "group_meta_data read shared group"
  on public.group_meta_data for select
  using (public.is_group_member(group_id) or (select public.is_mod_staff()));

drop policy if exists "group_meta_data insert authenticated" on public.group_meta_data;
drop policy if exists "group_meta_data insert by owner"      on public.group_meta_data;
drop policy if exists "group_meta_data insert by member"     on public.group_meta_data;
create policy "group_meta_data insert by member"
  on public.group_meta_data for insert
  with check (
    user_id = (select public.firebase_uid())
    or public.is_group_member(group_id)
    or (select public.is_mod_staff())
  );

drop policy if exists "group_meta_data update authenticated" on public.group_meta_data;
drop policy if exists "group_meta_data update by owner"      on public.group_meta_data;
drop policy if exists "group_meta_data update by member"     on public.group_meta_data;
create policy "group_meta_data update by member"
  on public.group_meta_data for update
  using (
    user_id = (select public.firebase_uid())
    or public.is_group_member(group_id)
    or (select public.is_mod_staff())
  )
  with check (
    user_id = (select public.firebase_uid())
    or public.is_group_member(group_id)
    or (select public.is_mod_staff())
  );

drop trigger if exists trg_ac_group_meta_guard on public.group_meta_data;
create trigger trg_ac_group_meta_guard
  before insert or update on public.group_meta_data
  for each row execute function public.guard_group_meta_write();

reset lock_timeout;
