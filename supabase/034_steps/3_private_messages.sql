-- 034 step 3 of 8 — run in the SQL editor as ONE query, in order.
-- Source: supabase/034_chat_moderation_enforcement.sql

-- =====================================================================
-- STEP 3 — Arm public.private_messages.
-- Sorts before trg_reject_unavailable_chat (025): a banned sender sees
-- SENDER_BANNED, not a recipient-side reason.
-- =====================================================================
set lock_timeout = '5s';

-- 032 again (idempotent, metadata-only): the shim and report_message use it.
alter table public.private_messages
  add column if not exists report_count integer not null default 0;

drop trigger if exists trg_reject_banned_sender on public.private_messages;

drop trigger if exists trg_aa_chat_ban on public.private_messages;
create trigger trg_aa_chat_ban
  before insert or update of text, image_url, fruits, reply_to, sender_id on public.private_messages
  for each row execute function public.enforce_chat_ban();

drop trigger if exists trg_ab_chat_links on public.private_messages;
create trigger trg_ab_chat_links
  before insert or update of text on public.private_messages
  for each row execute function public.enforce_chat_links();

drop trigger if exists trg_ac_chat_update_guard on public.private_messages;
create trigger trg_ac_chat_update_guard
  before update on public.private_messages
  for each row execute function public.guard_chat_message_update();

-- The 009 update policy (participants) stays: the guard narrows it to the
-- sender (or a staff participant). Staff who are not participants cannot
-- update a DM either way — UPDATE … WHERE also needs the SELECT policy,
-- which is participant-only.

drop policy if exists "private_messages delete by participant"     on public.private_messages;
drop policy if exists "private_messages delete by sender or staff" on public.private_messages;
create policy "private_messages delete by sender or staff"
  on public.private_messages for delete
  using (sender_id = (select public.firebase_uid()) or (select public.is_mod_staff()));

reset lock_timeout;
