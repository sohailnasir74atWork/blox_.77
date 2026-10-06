-- 034 step 2 of 8 — run in the SQL editor as ONE query, in order.
-- Source: supabase/034_chat_moderation_enforcement.sql

-- =====================================================================
-- STEP 2 — Arm public.messages.
-- BEFORE triggers fire alphabetically: ban (aa) → links (ab) → guard (ac).
-- Replaces 030's insert-only trg_reject_banned_sender (new.sender_id based).
-- Update policy stays "any signed-in user" (001); the guard enforces columns.
-- =====================================================================
set lock_timeout = '5s';

drop trigger if exists trg_reject_banned_sender on public.messages;

drop trigger if exists trg_aa_chat_ban on public.messages;
create trigger trg_aa_chat_ban
  before insert or update of text, gif, fruits, reply_to, sender_id on public.messages
  for each row execute function public.enforce_chat_ban();

drop trigger if exists trg_ab_chat_links on public.messages;
create trigger trg_ab_chat_links
  before insert or update of text on public.messages
  for each row execute function public.enforce_chat_links();

drop trigger if exists trg_ac_chat_update_guard on public.messages;
create trigger trg_ac_chat_update_guard
  before update on public.messages
  for each row execute function public.guard_chat_message_update();

drop policy if exists "messages delete authenticated"    on public.messages;
drop policy if exists "messages delete sender or staff" on public.messages;
create policy "messages delete sender or staff"
  on public.messages for delete
  using (sender_id = (select public.firebase_uid()) or (select public.is_mod_staff()));

reset lock_timeout;
