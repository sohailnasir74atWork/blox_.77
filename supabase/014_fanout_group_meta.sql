-- =====================================================================
-- 014_fanout_group_meta.sql — atomic group_meta_data fan-out via RPC
-- =====================================================================
-- Same RLS quirk we hit on chat_meta_data (→ 011) and group_messages
-- (→ 012): the table's own INSERT/UPDATE policy `firebase_uid() IS NOT
-- NULL` should logically allow any authenticated upsert — yet
-- production sends keep tripping 42501 on fanOutGroupMessage's bulk
-- upsert. Same fix pattern: SECURITY DEFINER RPC that self-validates
-- the caller and does the multi-row write in one transaction.
--
-- Side benefits over the prior client-side parallel writes:
--   • Atomic: every member row + every unread bump in one transaction.
--     No "some members got the preview, others didn't" half-state.
--   • One round-trip instead of N+1 (one upsert + N increment_group_unread
--     RPC calls).
--   • Bypasses the policy check that's been silently failing.
-- =====================================================================

create or replace function public.fanout_group_message_meta(
  p_group_id      text,
  p_member_ids    text[],
  p_sender_id     text,
  p_sender_name   text   default null,
  p_last_message  text   default null,
  p_timestamp_ms  bigint default null,
  p_group_name    text   default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller text  := public.firebase_uid();
  ts     bigint := coalesce(p_timestamp_ms, (extract(epoch from now()) * 1000)::bigint);
begin
  if caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_group_id is null or p_group_id = '' then
    raise exception 'group_id required' using errcode = '22023';
  end if;
  if p_member_ids is null or array_length(p_member_ids, 1) is null then
    return; -- nothing to fan out to
  end if;

  -- Phase 1: bulk upsert descriptive fields for every member.
  -- unread_count is intentionally omitted on the SET clause so existing
  -- rows keep their running count (phase 2 bumps non-senders); new rows
  -- land at the column default of 0 and phase 2 bumps them to 1.
  insert into public.group_meta_data (
    user_id, group_id,
    last_message, last_message_timestamp_ms,
    last_message_sender_id, last_message_sender_name,
    group_name, updated_at
  )
  select unnest(p_member_ids), p_group_id,
         p_last_message, ts,
         p_sender_id, p_sender_name,
         p_group_name, now()
  on conflict (user_id, group_id) do update set
    last_message              = excluded.last_message,
    last_message_timestamp_ms = excluded.last_message_timestamp_ms,
    last_message_sender_id    = excluded.last_message_sender_id,
    last_message_sender_name  = excluded.last_message_sender_name,
    group_name                = coalesce(excluded.group_name, group_meta_data.group_name),
    updated_at                = now();

  -- Phase 2: bump unread for every non-sender member in one statement
  -- (replaces the per-member increment_group_unread RPC loop).
  update public.group_meta_data
     set unread_count = unread_count + 1,
         updated_at   = now()
   where group_id = p_group_id
     and user_id <> coalesce(p_sender_id, '')
     and user_id = any(p_member_ids);
end $$;

grant execute on function public.fanout_group_message_meta(
  text, text[], text, text, text, bigint, text
) to authenticated;
