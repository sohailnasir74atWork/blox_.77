-- =====================================================================
-- 028_repair_bootstrap_admin_roles.sql — unblock poll creation for the
-- bootstrap admins whose is_admin was wiped by reconcileRolesMirror.
-- =====================================================================
-- Symptom: creating a poll from the AdminDashboard fails with
--   "new row violates row-level security policy for table \"polls\""
-- even though the dashboard and the create-poll form are visible.
--
-- Cause: "admin" is stored under TWO different RTDB keys.
--   • Legacy grants                     → users/{uid}/admin
--   • Hardcoded-email bootstrap         → users/{uid}/isAdmin
--     (Code/GlobelStats.js: `update(userRef, { isAdmin: true })`, and
--      database.rules.json guards `isAdmin` with its own child rule)
--
-- The client gate accepts either (`existing.admin || existing.isAdmin`),
-- and scripts/backfill-users-to-supabase.js did too
-- (`is_admin: asBool(u.admin) || asBool(u.isAdmin)`) — so these accounts
-- were correctly is_admin = true from the May backfill and polls worked.
--
-- functions/reconcileRolesMirror.js (added 2026-09-04) read ONLY `admin`.
-- On its first run it computed "not an admin" for the bootstrap accounts,
-- saw drift against the correct mirror row, and upserted is_admin = false.
-- The RLS policy `polls_staff_write` (024) then rejected every insert,
-- while the client-side gate — which reads RTDB, not Supabase — kept
-- showing the form. Admin chat badges disappeared for the same reason
-- (RoleBadges reads user_roles.is_admin via fromRolesRow).
--
-- The mirror and the reconcile job are both fixed to accept either key;
-- this repairs the rows they already damaged, so poll creation works
-- without waiting for the next 6-hourly reconcile run.
--
-- Idempotent: safe to run more than once.
-- =====================================================================

-- 1) Before: what Supabase currently believes.
--   select r.uid, i.email, i.display_name, r.is_admin, r.is_cmsr, r.is_moderator
--     from public.user_roles r
--     left join public.user_identity i on i.uid = r.uid
--    where r.is_admin or r.is_cmsr or r.is_moderator;

-- 2) Repair the bootstrap admins (the accounts Code/GlobelStats.js grants
--    by email, which therefore only ever hold RTDB `isAdmin`).
update public.user_roles r
   set is_admin = true, updated_at = now()
  from public.user_identity i
 where i.uid = r.uid
   and lower(i.email) in ('thesolanalabs@gmail.com', 'sohailnasir74@gmail.com')
   and r.is_admin is distinct from true;

-- 3) Cover the case where the roles row does not exist at all.
insert into public.user_roles (uid, is_admin)
select i.uid, true
  from public.user_identity i
 where lower(i.email) in ('thesolanalabs@gmail.com', 'sohailnasir74@gmail.com')
   and not exists (select 1 from public.user_roles r where r.uid = i.uid)
on conflict (uid) do nothing;

-- 4) After: expect is_admin = true for both accounts.
--   select r.uid, i.email, r.is_admin
--     from public.user_roles r
--     join public.user_identity i on i.uid = r.uid
--    where lower(i.email) in ('thesolanalabs@gmail.com', 'sohailnasir74@gmail.com');
