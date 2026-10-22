-- =====================================================================
-- 054_private_delete_admin_only.sql (2026-10-22) — NOT APPLIED YET
--
-- Owner decision 2026-10-22: in private chats, deleting the OTHER person's
-- messages is for Admins (and the verified owner emails) only — not Senior
-- Mods, Mods, JMDs or anyone else. The app already shows "Delete All Chat"
-- to Admins only; this makes the database agree.
--
-- Before: 034's guard_chat_message_update let any staff participant
-- (is_mod_staff: JMD and up) soft-delete the other person's messages in
-- their own DMs, and 034's DELETE policy let any staff hard-delete a DM row
-- they can see. Reachable only with a hand-made API call.
--
-- After:
--   * Soft delete (deleted false → true) of someone else's private message:
--     Admin / verified owner only. A sender still deletes their own.
--   * Hard DELETE of a private message: the sender, or Admin / owner.
-- Unchanged: reports (report_message() and the legacy report_count shim,
-- including the auto-delete at the report threshold), service role / cron
-- (nightly cleanup 051, retention 026), group and public chat, every other
-- field rule in the 034 guard.
--
-- Old builds: every shipped build only deletes DMs from the Admin-gated
-- "Delete" / "Delete All Chat" options (checked back to 2026-05), so no
-- build loses a working path. Admins must have user_roles.is_admin = true
-- (reconcileRolesMirror keeps it in step with RTDB) or a verified owner email.
-- Self-contained (no dependency on 040 / 043 / 053 helpers). Additive and
-- safe to run more than once.
-- =====================================================================
set lock_timeout = '5s';


-- ---------------------------------------------------------------------
-- STEP 1 — Admin check the API role may call (for the DELETE policy).
-- Same body as 053's _caller_is_admin(): an Admin row or a VERIFIED owner
-- email; no ban check, so an Admin is never locked out by a stray row.
-- ---------------------------------------------------------------------
create or replace function public.is_admin_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    exists (
      select 1 from public.user_roles
       where uid = public.firebase_uid() and is_admin = true
    )
    or (
      (c ->> 'email_verified')::boolean
      and lower(c ->> 'email') in (
        'thesolanalabs@gmail.com',
        'sohailnasir74business@gmail.com',
        'sohailnasir74@gmail.com'
      )
    ),
    false
  )
  from (select nullif(current_setting('request.jwt.claims', true), '')::jsonb as c) s;
$$;
revoke all on function public.is_admin_staff() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.is_admin_staff() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.is_admin_staff() to authenticated;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- STEP 2 — Soft delete of someone else's DM: Admin / owner only.
-- Fires BEFORE trg_ac_chat_update_guard (triggers run in name order), so
-- it sees exactly what the client sent. Report updates are left to the
-- guard, which records them and puts `deleted` back (or auto-deletes at the
-- threshold as 'system:reports').
-- ---------------------------------------------------------------------
create or replace function public.guard_private_message_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text;
begin
  -- report_message() sets this transaction-local flag around its own UPDATE.
  if coalesce(current_setting('blox.report_rpc', true), '') = 'on' then
    return new;
  end if;
  -- No end user: service role, cron, SQL editor.
  v_uid := nullif(coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'firebase_uid',
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '');
  if v_uid is null
     or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role' then
    return new;
  end if;
  -- Legacy report shim (old builds report with a direct UPDATE that may also
  -- send deleted = true): the guard handles it and never keeps that delete.
  if new.report_count is distinct from old.report_count then
    return new;
  end if;

  if coalesce(new.deleted, false) and not coalesce(old.deleted, false)
     and v_uid is distinct from old.sender_id
     and not public.is_admin_staff() then
    raise exception 'NOT_ALLOWED'
      using errcode = 'check_violation',
            hint = 'Only an Admin can delete the other person''s private messages.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_private_message_delete() from public;
-- Supabase grants new functions to the API roles by default; take it back.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.guard_private_message_delete() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.guard_private_message_delete() from authenticated;
  end if;
end $$;

drop trigger if exists trg_ab_pm_delete_admin_only on public.private_messages;
create trigger trg_ab_pm_delete_admin_only
  before update of deleted on public.private_messages
  for each row execute function public.guard_private_message_delete();


-- ---------------------------------------------------------------------
-- STEP 3 — Hard DELETE: the sender, or Admin / owner (was: sender or any
-- staff). Non-participants still cannot see the row (SELECT policy is
-- participant-only), so this only narrows what a participant may do.
-- ---------------------------------------------------------------------
drop policy if exists "private_messages delete by sender or staff" on public.private_messages;
drop policy if exists "private_messages delete by sender or admin" on public.private_messages;
create policy "private_messages delete by sender or admin"
  on public.private_messages for delete
  using (sender_id = (select public.firebase_uid()) or (select public.is_admin_staff()));

reset lock_timeout;


-- ---------------------------------------------------------------------
-- STEP 0 — check (run after; all three true = applied).
-- ---------------------------------------------------------------------
select
  exists (select 1 from pg_trigger
           where tgrelid = 'public.private_messages'::regclass
             and tgname = 'trg_ab_pm_delete_admin_only' and not tgisinternal) as step2_trigger,
  exists (select 1 from pg_policies
           where schemaname = 'public' and tablename = 'private_messages'
             and policyname = 'private_messages delete by sender or admin') as step3_policy,
  not exists (select 1 from pg_policies
               where schemaname = 'public' and tablename = 'private_messages'
                 and policyname = 'private_messages delete by sender or staff') as step3_old_policy_gone;


-- ---------------------------------------------------------------------
-- ROLLBACK (puts 034's behaviour back):
--   drop trigger if exists trg_ab_pm_delete_admin_only on public.private_messages;
--   drop policy if exists "private_messages delete by sender or admin" on public.private_messages;
--   create policy "private_messages delete by sender or staff" on public.private_messages
--     for delete using (sender_id = (select public.firebase_uid()) or (select public.is_mod_staff()));
-- ---------------------------------------------------------------------
