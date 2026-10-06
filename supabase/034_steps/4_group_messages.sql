-- 034 step 4 of 8 — run in the SQL editor as ONE query, in order.
-- Source: supabase/034_chat_moderation_enforcement.sql

-- =====================================================================
-- STEP 4 — Arm public.group_messages.
-- Fires inside send_group_message (012) with the caller's JWT. BEFORE INSERT
-- runs before ON CONFLICT, so a banned user's idempotent retry gets
-- SENDER_BANNED rather than the old row.
-- The member-only update policy (010) becomes "signed in": membership was
-- self-grantable and kept staff who are not members from moderating; the
-- guard now decides who may change what.
-- =====================================================================
set lock_timeout = '5s';

drop trigger if exists trg_reject_banned_sender on public.group_messages;

drop trigger if exists trg_aa_chat_ban on public.group_messages;
create trigger trg_aa_chat_ban
  before insert or update of text, image_url, fruits, reply_to, sender_id, sender_name, sender_avatar
  on public.group_messages
  for each row execute function public.enforce_chat_ban();

drop trigger if exists trg_ab_chat_links on public.group_messages;
create trigger trg_ab_chat_links
  before insert or update of text on public.group_messages
  for each row execute function public.enforce_chat_links();

drop trigger if exists trg_ac_chat_update_guard on public.group_messages;
create trigger trg_ac_chat_update_guard
  before update on public.group_messages
  for each row execute function public.guard_chat_message_update();

drop policy if exists "group_messages update by member"        on public.group_messages;
drop policy if exists "group_messages update by authenticated" on public.group_messages;
create policy "group_messages update by authenticated"
  on public.group_messages for update
  using ((select public.firebase_uid()) is not null)
  with check ((select public.firebase_uid()) is not null);

drop policy if exists "group_messages delete by sender"          on public.group_messages;
drop policy if exists "group_messages delete by sender or staff" on public.group_messages;
create policy "group_messages delete by sender or staff"
  on public.group_messages for delete
  using (sender_id = (select public.firebase_uid()) or (select public.is_mod_staff()));

reset lock_timeout;
