-- =====================================================================
-- 012_send_group_message.sql — atomic group message insert via RPC
-- =====================================================================
-- Why an RPC:
--   The 010_group_messages.sql INSERT policy requires
--   `sender_id = firebase_uid() AND is_group_member(group_id)`.
--   `is_group_member()` reads from group_meta_data — which is populated
--   lazily (fanOutGroupMessage upserts it on every send). Members who
--   exist in Firestore /groups/{groupId}/memberIds but haven't yet
--   received a fanout (new joins, race with first send, missed
--   backfills) have no group_meta_data row, so the policy rejects
--   their first send with `42501 RLS`. Same class of bug we hit on
--   chat_meta_data → solved with the same pattern (011).
--
-- Trust model:
--   This bypasses the membership check, matching what we already do for
--   group_meta_data writes ("any authenticated user can insert/update;
--   we trust the client"). Practical security:
--     • sender_id is forced to firebase_uid() — no identity spoofing
--     • SELECT policy on group_messages still gates reads via
--       is_group_member(), so messages spammed into a group the caller
--       isn't in CAN be seen by legit members of that group, which is
--       a real spam surface — but it matches the existing group_meta
--       posture and the notifyGroupNewMessage CF still gates pushes
--       against Firestore memberIds, so push abuse is contained.
--
-- Idempotent: ON CONFLICT DO NOTHING + fallback select via UNIQUE
-- (group_id, client_msg_id) so retries return the existing row.
-- =====================================================================

create or replace function public.send_group_message(
  p_group_id                  text,
  p_client_msg_id             uuid,
  p_text                      text    default null,
  p_image_url                 text    default null,
  p_fruits                    jsonb   default '[]'::jsonb,
  p_reply_to                  jsonb   default null,
  p_sender_name               text    default null,
  p_sender_avatar             text    default null,
  p_is_pro                    boolean default false,
  p_roblox_username_verified  boolean default false,
  p_has_recent_game_win       boolean default false,
  p_last_game_win_at          bigint  default null,
  p_is_creator                boolean default false,
  p_os                        text    default null
) returns public.group_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  caller   text := public.firebase_uid();
  inserted public.group_messages;
begin
  if caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_group_id is null or p_group_id = '' then
    raise exception 'group_id required' using errcode = '22023';
  end if;

  -- Idempotency: the unique index from 010_group_messages.sql is a
  -- PARTIAL index (`where client_msg_id is not null`) — so the only way
  -- ON CONFLICT can match it is to repeat that predicate here. Without
  -- the WHERE, Postgres throws 42P10 "no unique or exclusion constraint
  -- matching the ON CONFLICT specification". For a NULL client_msg_id
  -- we fall through to a plain insert (no idempotency, but the client
  -- always generates one — see groupMessagesBackend.newClientMsgId).
  if p_client_msg_id is not null then
    insert into public.group_messages (
      group_id, client_msg_id, sender_id,
      text, image_url, fruits, reply_to,
      sender_name, sender_avatar,
      is_pro, roblox_username_verified,
      has_recent_game_win, last_game_win_at, is_creator, os
    ) values (
      p_group_id, p_client_msg_id, caller,
      p_text, p_image_url, coalesce(p_fruits, '[]'::jsonb), p_reply_to,
      p_sender_name, p_sender_avatar,
      coalesce(p_is_pro, false), coalesce(p_roblox_username_verified, false),
      coalesce(p_has_recent_game_win, false), p_last_game_win_at,
      coalesce(p_is_creator, false), p_os
    )
    on conflict (group_id, client_msg_id) where client_msg_id is not null
      do nothing
    returning * into inserted;

    -- Idempotent retry path: client_msg_id already existed, fetch the
    -- prior row and return it so the caller can promote its optimistic
    -- placeholder cleanly.
    if inserted.id is null then
      select * into inserted
        from public.group_messages
       where group_id = p_group_id
         and client_msg_id = p_client_msg_id;
    end if;
  else
    insert into public.group_messages (
      group_id, client_msg_id, sender_id,
      text, image_url, fruits, reply_to,
      sender_name, sender_avatar,
      is_pro, roblox_username_verified,
      has_recent_game_win, last_game_win_at, is_creator, os
    ) values (
      p_group_id, null, caller,
      p_text, p_image_url, coalesce(p_fruits, '[]'::jsonb), p_reply_to,
      p_sender_name, p_sender_avatar,
      coalesce(p_is_pro, false), coalesce(p_roblox_username_verified, false),
      coalesce(p_has_recent_game_win, false), p_last_game_win_at,
      coalesce(p_is_creator, false), p_os
    )
    returning * into inserted;
  end if;

  return inserted;
end $$;

grant execute on function public.send_group_message(
  text, uuid, text, text, jsonb, jsonb, text, text,
  boolean, boolean, boolean, bigint, boolean, text
) to authenticated;
