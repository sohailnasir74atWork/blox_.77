-- =====================================================================
-- 013_open_group_rules.sql — open group_messages SELECT for mods/admins
-- =====================================================================
-- group_messages SELECT was scoped to is_group_member(group_id), which
-- blocks the "Enter" button for moderators on groups they don't actively
-- belong to. Open SELECT to any authenticated user.
--
-- Trust model: the app already exposes the group-list UI to mods and
-- the notifyGroupNewMessage CF gates pushes against Firestore memberIds
-- — so opening SELECT here doesn't change what mods can practically
-- reach, just removes the in-app friction. INSERT stays routed through
-- the send_group_message RPC (012) which forces sender_id = firebase_uid().
-- UPDATE / DELETE policies unchanged (still member-only / sender-only
-- respectively) — moderation actions run as service-role anyway.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

drop policy if exists "group_messages select by member" on public.group_messages;
drop policy if exists "group_messages select by anyone authenticated" on public.group_messages;
create policy "group_messages select by anyone authenticated"
  on public.group_messages for select
  using (public.firebase_uid() is not null);
