-- 034 step 8 of 8 — run in the SQL editor as ONE query, in order.
-- Source: supabase/034_chat_moderation_enforcement.sql

-- =====================================================================
-- STEP 8 — polls: bans (not mutes) block comments and votes. Votes go
-- through cast_poll_vote (015, SECURITY DEFINER) — the trigger still sees
-- the caller.
-- =====================================================================
set lock_timeout = '5s';

drop trigger if exists trg_aa_chat_ban on public.poll_comments;
create trigger trg_aa_chat_ban
  before insert or update of text, user_id on public.poll_comments
  for each row execute function public.enforce_chat_ban();

drop trigger if exists trg_aa_chat_ban on public.poll_votes;
create trigger trg_aa_chat_ban
  before insert or update of option_index, user_id on public.poll_votes
  for each row execute function public.enforce_chat_ban();

reset lock_timeout;
