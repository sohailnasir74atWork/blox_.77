-- =====================================================================
-- 020_polls_staff_write.sql — let moderators (not just admins) manage polls
-- =====================================================================
-- Original 015_polls.sql gated ALL writes on the `polls` table to admins
-- (policy `polls_admin_write`, is_admin = true). Product decision: the
-- moderator team should be able to create/activate/delete polls from the
-- AdminDashboard too — the dashboard already shows them the create form,
-- but every insert was rejected by RLS with
--   "new row violates row-level security policy for table \"polls\""
-- which surfaced in-app as a generic "Could not create poll".
--
-- This replaces the admin-only policy with a staff policy that accepts
-- admins OR moderators. Everything else (poll_votes via cast_poll_vote,
-- poll_comments) is unchanged. Backward compatible: admins keep full
-- access; we only widen the set.
--
-- Idempotent: drops both the old and new policy names before recreating.
-- =====================================================================

drop policy if exists polls_admin_write on public.polls;
drop policy if exists polls_staff_write on public.polls;

create policy polls_staff_write on public.polls
  for all to authenticated
  using (
    exists (
      select 1 from public.user_roles r
      where r.uid = public.firebase_uid()
        and (r.is_admin = true or r.is_moderator = true)
    )
  )
  with check (
    exists (
      select 1 from public.user_roles r
      where r.uid = public.firebase_uid()
        and (r.is_admin = true or r.is_moderator = true)
    )
  );
