-- =====================================================================
-- 007_meta_writable_by_owner.sql — open chat + group meta to client writes
-- =====================================================================
-- The Phase 2/3 RLS (002_chat_metadata.sql) only allowed reads + the one
-- narrow "unread = 0" UPDATE. Every other write went through the mirror
-- CF (RTDB → Supabase, service-role).
--
-- We're now cutting RTDB writes for chat_meta_data + group_meta_data
-- entirely. New builds write straight to Supabase. Old builds break (the
-- accepted tradeoff). The mirror CFs can keep running — anything still
-- coming in via RTDB (old builds) gets mirrored as before.
--
-- Two-sided semantics:
--   * chat_meta_data: when A sends a private message, A's client writes
--     BOTH owner_uid=A AND owner_uid=B rows. Policy permits either side
--     of the pair, scoped to (firebase_uid() in {owner_uid, partner_uid}).
--   * group_meta_data: when A sends a group message, A's client fans out
--     to every group member's row. There is no group-membership table in
--     Supabase, so we trust the client (same trust model as RTDB today)
--     — any authenticated user can write group_meta_data. Service-role
--     mirror CF still works regardless.
--
-- Safe to re-run: drop-then-create is idempotent for policies.
-- =====================================================================

-- ---------------------------------------------------------------------
-- chat_meta_data: allow either side of the pair to insert/update/delete.
-- ---------------------------------------------------------------------

drop policy if exists "chat_meta_data unread reset by owner" on public.chat_meta_data;

drop policy if exists "chat_meta_data insert by participant" on public.chat_meta_data;
create policy "chat_meta_data insert by participant"
  on public.chat_meta_data for insert
  with check (
    public.firebase_uid() is not null
    and (owner_uid = public.firebase_uid() or partner_uid = public.firebase_uid())
  );

drop policy if exists "chat_meta_data update by participant" on public.chat_meta_data;
create policy "chat_meta_data update by participant"
  on public.chat_meta_data for update
  using (
    public.firebase_uid() is not null
    and (owner_uid = public.firebase_uid() or partner_uid = public.firebase_uid())
  )
  with check (
    public.firebase_uid() is not null
    and (owner_uid = public.firebase_uid() or partner_uid = public.firebase_uid())
  );

drop policy if exists "chat_meta_data delete by owner" on public.chat_meta_data;
create policy "chat_meta_data delete by owner"
  on public.chat_meta_data for delete
  using (owner_uid = public.firebase_uid());


-- ---------------------------------------------------------------------
-- group_meta_data: any authenticated user can insert/update (group-send
-- fan-out hits every member's row; we have no group_members table to
-- validate against, so we trust the JWT's existence). DELETE is
-- restricted to the row's owner — only you can remove your own group
-- membership row.
-- ---------------------------------------------------------------------

drop policy if exists "group_meta_data unread reset by owner" on public.group_meta_data;

drop policy if exists "group_meta_data insert authenticated" on public.group_meta_data;
create policy "group_meta_data insert authenticated"
  on public.group_meta_data for insert
  with check (public.firebase_uid() is not null);

drop policy if exists "group_meta_data update authenticated" on public.group_meta_data;
create policy "group_meta_data update authenticated"
  on public.group_meta_data for update
  using (public.firebase_uid() is not null)
  with check (public.firebase_uid() is not null);

drop policy if exists "group_meta_data delete by owner" on public.group_meta_data;
create policy "group_meta_data delete by owner"
  on public.group_meta_data for delete
  using (user_id = public.firebase_uid());
