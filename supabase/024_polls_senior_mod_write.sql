-- =====================================================================
-- 024_polls_senior_mod_write.sql — let Senior Mods manage polls
-- =====================================================================
-- 020_polls_staff_write.sql widened poll writes from admins to
-- "admins OR moderators", but Senior Mod is a SEPARATE flag — it is not
-- implied by is_moderator. A Senior Mod who was never also flagged as a
-- plain Mod therefore saw the AdminDashboard poll form (the client gate in
-- CommunityChatHeader.jsx already allows isAdmin || isSeniorMod ||
-- isModerator) but every insert was rejected by RLS, surfacing in-app as
-- the generic "Could not create poll".
--
-- Senior Mod lives in user_roles.is_cmsr — the column was pre-scaffolded
-- under an older name and repurposed; functions/mirrorUsersToSupabase.js
-- writes `is_cmsr := RTDB isSeniorMod`. See 023_reset_stale_cmsr.sql.
--
-- Backward compatible: admins and moderators keep exactly what they had;
-- this only adds Senior Mods to the allowed set.
--
-- Idempotent: drops every prior policy name before recreating.
-- =====================================================================

drop policy if exists polls_admin_write on public.polls;
drop policy if exists polls_staff_write on public.polls;

create policy polls_staff_write on public.polls
  for all to authenticated
  using (
    exists (
      select 1 from public.user_roles r
      where r.uid = public.firebase_uid()
        and (r.is_admin = true or r.is_cmsr = true or r.is_moderator = true)
    )
  )
  with check (
    exists (
      select 1 from public.user_roles r
      where r.uid = public.firebase_uid()
        and (r.is_admin = true or r.is_cmsr = true or r.is_moderator = true)
    )
  );

-- Verify (expect the Senior Mod's uid to appear):
--   select uid, is_admin, is_cmsr, is_moderator
--   from public.user_roles where is_cmsr = true;
