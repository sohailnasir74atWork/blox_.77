-- =====================================================================
-- 033_mod_actions_evidence.sql (2026-10-06) — APPLIED 2026-10-06 (SQL editor)
--
-- Moderation contract §3/§4/§7/§8 (MODERATION_CONTRACT 2026-10-06), the
-- schema half the Cloud Functions (functions/banEnforcement.js) write to:
--
--   * banned_senders.type      'ban' | 'mute' | NULL (legacy). Mutes are
--                              chat-only: 034 blocks chat for both, polls
--                              for bans only. NULL rows are classified by
--                              the legacy rule (reason ~* '^Muted for').
--   * mod_actions.evidence     up to 3 https URLs (screenshots) per action.
--   * mod_actions.details      jsonb (≤ 4 KB here; the server caps at 2 KB)
--                              for the new 'log' actions.
--   * mod_actions.action       CHECK widened: unmute, message_delete,
--                              delete_all, pin, unpin, role_change,
--                              review_delete, profile_delete.
--   * mod_actions.actor_role   CHECK widened with 'owner' (contract §1 rank).
--   * the 031 read rpcs are re-created so they return the new columns.
--
-- (The contract calls this "032"; 032 was already taken by
-- 032_private_messages_report_count.sql, so it is 033.)
--
-- Touches no hot table: banned_senders and mod_actions take tens of writes a
-- day and are not in the realtime publication. Every step is idempotent.
-- Run it BEFORE 034 (034's ban check reads banned_senders.type) and before
-- deploying functions that write type / evidence / details.
-- =====================================================================

set lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- STEP 1 — banned_senders.type
-- ---------------------------------------------------------------------
alter table public.banned_senders
  add column if not exists type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.banned_senders'::regclass
       and conname  = 'banned_senders_type_check'
  ) then
    alter table public.banned_senders
      add constraint banned_senders_type_check
      check (type is null or type in ('ban', 'mute'));
  end if;
end $$;

comment on column public.banned_senders.type is
  '033: ban | mute. NULL = legacy row; a mute iff reason ~* ''^Muted for''. Mutes block chat only.';


-- ---------------------------------------------------------------------
-- STEP 2 — mod_actions.evidence / details
-- ---------------------------------------------------------------------
alter table public.mod_actions
  add column if not exists evidence text[],
  add column if not exists details  jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.mod_actions'::regclass
                    and conname  = 'mod_actions_evidence_max_3') then
    alter table public.mod_actions
      add constraint mod_actions_evidence_max_3
      check (evidence is null or coalesce(array_length(evidence, 1), 0) <= 3);
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.mod_actions'::regclass
                    and conname  = 'mod_actions_details_size') then
    alter table public.mod_actions
      add constraint mod_actions_details_size
      check (details is null or octet_length(details::text) <= 4096);
  end if;
end $$;


-- ---------------------------------------------------------------------
-- STEP 3 — widen the action / actor_role CHECKs
--
-- 031 declared them inline, so Postgres named them itself. Drop every CHECK
-- that constrains exactly that one column (whatever its name) and add a
-- named one. Re-running drops and re-adds the named one: same result.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.conrelid = 'public.mod_actions'::regclass
       and c.contype  = 'c'
       and array_length(c.conkey, 1) = 1
       and a.attname in ('action', 'actor_role')
  loop
    execute format('alter table public.mod_actions drop constraint %I', r.conname);
  end loop;

  alter table public.mod_actions
    add constraint mod_actions_action_check
    check (action in (
      'mute', 'strike', 'ban', 'unban', 'unmute',
      'message_delete', 'delete_all', 'pin', 'unpin',
      'role_change', 'review_delete', 'profile_delete'
    ));

  alter table public.mod_actions
    add constraint mod_actions_actor_role_check
    check (actor_role is null or actor_role in (
      'owner', 'admin', 'senior_mod', 'moderator', 'baby_mod', 'system'
    ));
end $$;

reset lock_timeout;


-- ---------------------------------------------------------------------
-- STEP 4 — read rpcs (bodies identical to 031)
--
-- Both return `setof public.mod_actions` with `select *`, so evidence and
-- details come back as two extra keys. Re-created here so no session keeps
-- a plan cached against the old row type.
-- ---------------------------------------------------------------------
create or replace function public.mod_actions_for_user(
  p_email          text default null,
  p_uid            text default null,
  p_cursor_created timestamptz default null,
  p_cursor_id      uuid default null,
  p_limit          int default 50
) returns setof public.mod_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(trim(p_email), ''));
  v_uid   text := nullif(trim(p_uid), '');
begin
  if not public.is_mod_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_email is null and v_uid is null then
    raise exception 'email or uid required' using errcode = '22023';
  end if;
  return query
    select *
      from public.mod_actions
     where ((v_email is not null and target_email = v_email)
         or (v_uid   is not null and target_uid   = v_uid))
       and (
         p_cursor_created is null
         or created_at < p_cursor_created
         or (created_at = p_cursor_created and id < p_cursor_id)
       )
     order by created_at desc, id desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

revoke all on function public.mod_actions_for_user(text, text, timestamptz, uuid, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.mod_actions_for_user(text, text, timestamptz, uuid, int) from anon;
  end if;
end $$;
grant execute on function public.mod_actions_for_user(text, text, timestamptz, uuid, int) to authenticated;

create or replace function public.mod_actions_recent(
  p_action         text default null,
  p_actor_uid      text default null,
  p_days           int default 30,
  p_cursor_created timestamptz default null,
  p_cursor_id      uuid default null,
  p_limit          int default 30
) returns setof public.mod_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days   int := greatest(1, least(coalesce(p_days, 30), 365));
  v_since  timestamptz := now() - make_interval(days => v_days);
  v_action text := nullif(trim(p_action), '');
  v_actor  text := nullif(trim(p_actor_uid), '');
begin
  if not public.is_mod_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select *
      from public.mod_actions
     where created_at >= v_since
       and (v_action is null or action = v_action)
       and (v_actor  is null or actor_uid = v_actor)
       and (
         p_cursor_created is null
         or created_at < p_cursor_created
         or (created_at = p_cursor_created and id < p_cursor_id)
       )
     order by created_at desc, id desc
     limit greatest(1, least(coalesce(p_limit, 30), 100));
end $$;

revoke all on function public.mod_actions_recent(text, text, int, timestamptz, uuid, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.mod_actions_recent(text, text, int, timestamptz, uuid, int) from anon;
  end if;
end $$;
grant execute on function public.mod_actions_recent(text, text, int, timestamptz, uuid, int) to authenticated;

notify pgrst, 'reload schema';

-- Verify:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'mod_actions'
--      and column_name in ('evidence', 'details');                 -- 2 rows
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('mod_actions_action_check', 'mod_actions_actor_role_check');

-- =====================================================================
-- ROLLBACK (by hand). The widened CHECKs are harmless to keep: the 031 set
-- is a subset, and narrowing them again would fail on (or require deleting)
-- audit rows written with the new actions. Do not delete audit rows.
--   alter table public.mod_actions drop constraint if exists mod_actions_evidence_max_3;
--   alter table public.mod_actions drop constraint if exists mod_actions_details_size;
--   alter table public.mod_actions drop column if exists evidence, drop column if exists details;
--   alter table public.banned_senders drop constraint if exists banned_senders_type_check;
--   alter table public.banned_senders drop column if exists type;
--   -- then re-run 031 STEP 3 to recreate the read rpcs against the old row type.
-- =====================================================================
