-- =====================================================================
-- 008_meta_rpcs.sql — atomic unread-count increment helpers
-- =====================================================================
-- Without these, two concurrent senders racing to bump the receiver's
-- unread_count would read the same value, write +1, and lose one
-- increment ("lost update"). PostgREST doesn't expose
-- `unread_count = unread_count + 1` directly, so we wrap it in a
-- SECURITY DEFINER function that runs as the table owner.
--
-- Why SECURITY DEFINER:
--   - The function performs a single UPDATE keyed on (owner_uid,
--     partner_uid) / (user_id, group_id). The caller can't escalate to
--     touching arbitrary rows because the WHERE clause is parameterized.
--   - Running with caller's permissions would force us to keep the very
--     permissive RLS in place; SECURITY DEFINER lets us scope the
--     increment narrowly while keeping the broader policy tight.
--
-- Both functions return the new unread_count for callers that want to
-- show an immediate badge update. Errors propagate normally (no row →
-- 0 rows updated → return null).
-- =====================================================================

-- ---------------------------------------------------------------------
-- chat_meta_data: increment unread_count on the receiver's row.
-- ---------------------------------------------------------------------
create or replace function public.increment_chat_unread(
  p_owner_uid text,
  p_partner_uid text
) returns int
language sql
security definer
set search_path = public
as $$
  update public.chat_meta_data
     set unread_count = unread_count + 1,
         updated_at   = now()
   where owner_uid   = p_owner_uid
     and partner_uid = p_partner_uid
   returning unread_count;
$$;

grant execute on function public.increment_chat_unread(text, text) to authenticated, anon;


-- ---------------------------------------------------------------------
-- group_meta_data: increment unread_count for ONE member of a group.
-- Senders call this in a loop over the member list (excluding their
-- own user_id). Skipping self happens client-side so the function stays
-- a single-row UPDATE — easier to reason about, no membership lookup.
-- ---------------------------------------------------------------------
create or replace function public.increment_group_unread(
  p_user_id text,
  p_group_id text
) returns int
language sql
security definer
set search_path = public
as $$
  update public.group_meta_data
     set unread_count = unread_count + 1,
         updated_at   = now()
   where user_id  = p_user_id
     and group_id = p_group_id
   returning unread_count;
$$;

grant execute on function public.increment_group_unread(text, text) to authenticated, anon;
