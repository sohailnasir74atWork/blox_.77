-- =====================================================================
-- 055_private_edit_sender_only.sql (2026-10-22) — NOT APPLIED YET
--
-- Owner decision 2026-10-22: nobody may change another person's private
-- message. Follows 054 (deletes are Admin-only).
--
-- Before: 034's guard_chat_message_update trusts staff (JMD and up) on
-- every column but report_count. In their own DMs a staff member could, with
-- a hand-made API call:
--   * rewrite the other person's text / image / items / sticker / reply;
--   * change sender_id / recipient_id / chat_id / created_at on any message
--     in the chat — e.g. swap sender and recipient so their own message
--     shows as sent by the other person;
--   * restore a message an Admin deleted.
--
-- After (for app users; service role, cron and report_message() unchanged):
--   * Identity columns (id, chat_id, sender_id, recipient_id, created_at,
--     client_msg_id, origin): nobody changes them, Admins included.
--   * Every other column (text, image_url, fruits, gif, reply_to, os, …):
--     the sender only. New columns are sender-only by default.
--   * Someone else's message: only the report and delete fields (report_count,
--     deleted, deleted_at, deleted_by); who may delete is 054's rule.
--   * Restoring a deleted message (deleted true → false): Admin / verified
--     owner only.
--
-- Old builds: every shipped build only updates a DM to soft-delete it
-- (Admin-gated) or to report it (report_count, plus the deleted fields at the
-- threshold); both still pass. Sends are inserts, untouched.
-- Requires 054 (is_admin_staff). Additive and safe to run more than once.
-- =====================================================================
set lock_timeout = '5s';

do $$ begin
  if to_regprocedure('public.is_admin_staff()') is null then
    raise exception '055 needs 054_private_delete_admin_only.sql first (is_admin_staff missing)';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- STEP 1 — the rule, as a BEFORE UPDATE trigger on private_messages.
-- trg_ab_pm_edit_sender_only sorts after trg_ab_pm_delete_admin_only (054)
-- and before trg_ac_chat_update_guard (034), so it sees what the client sent
-- and the guard still handles reports and stamps deletes.
-- ---------------------------------------------------------------------
create or replace function public.guard_private_message_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims   jsonb;
  v_uid      text;
  v_changed  text[];
  c_identity constant text[] := array['id', 'chat_id', 'sender_id', 'recipient_id',
                                      'created_at', 'client_msg_id', 'origin'];
  c_others   constant text[] := array['report_count', 'deleted', 'deleted_at', 'deleted_by'];
begin
  -- report_message() sets this transaction-local flag around its own UPDATE.
  if coalesce(current_setting('blox.report_rpc', true), '') = 'on' then
    return new;
  end if;
  -- No end user: service role, cron, SQL editor.
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_uid := nullif(coalesce(v_claims ->> 'firebase_uid', v_claims ->> 'sub'), '');
  if v_uid is null or coalesce(v_claims ->> 'role', '') = 'service_role' then
    return new;
  end if;

  select coalesce(array_agg(k), '{}'::text[]) into v_changed
    from jsonb_object_keys(to_jsonb(new)) as k
   where (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k);
  if cardinality(v_changed) = 0 then
    return new;
  end if;

  if v_changed && c_identity then
    raise exception 'NOT_ALLOWED'
      using errcode = 'check_violation',
            hint = 'Who sent a private message, its chat and its time cannot be changed.';
  end if;

  if coalesce(old.deleted, false) and not coalesce(new.deleted, false)
     and not public.is_admin_staff() then
    raise exception 'NOT_ALLOWED'
      using errcode = 'check_violation',
            hint = 'Only an Admin can restore a deleted private message.';
  end if;

  if v_uid is distinct from old.sender_id and not (v_changed <@ c_others) then
    raise exception 'NOT_ALLOWED'
      using errcode = 'check_violation',
            hint = 'Only the sender can change a private message.';
  end if;

  return new;
end;
$$;
revoke all on function public.guard_private_message_edit() from public;
-- Supabase grants new functions to the API roles by default; take it back.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.guard_private_message_edit() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.guard_private_message_edit() from authenticated;
  end if;
end $$;

drop trigger if exists trg_ab_pm_edit_sender_only on public.private_messages;
create trigger trg_ab_pm_edit_sender_only
  before update on public.private_messages
  for each row execute function public.guard_private_message_edit();

reset lock_timeout;


-- ---------------------------------------------------------------------
-- STEP 0 — check (run after; both true = applied).
-- ---------------------------------------------------------------------
select
  exists (select 1 from pg_trigger
           where tgrelid = 'public.private_messages'::regclass
             and tgname = 'trg_ab_pm_edit_sender_only' and not tgisinternal) as step1_trigger,
  not has_function_privilege('authenticated', 'public.guard_private_message_edit()', 'execute') as step1_not_callable;


-- ---------------------------------------------------------------------
-- ROLLBACK (puts 054's behaviour back):
--   drop trigger if exists trg_ab_pm_edit_sender_only on public.private_messages;
-- ---------------------------------------------------------------------
