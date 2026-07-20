-- =====================================================================
-- 016_user_last_activity.sql
--
-- Skip the RTDB → mirror-CF round-trip for the lastActivity heartbeat.
-- Per the cost-reduction work this is the biggest remaining cost lever —
-- every active user fired mirrorUsersToSupabase on a launch write that
-- nothing-else-mirrored cares about, paying a CF invocation + an upsert
-- just to advance user_identity.last_activity_ms.
--
-- The client now calls set_last_activity() directly (6h-throttled). RTDB
-- /users/{uid}/lastActivity stops being written by new clients, so the
-- mirror CF stops firing for heartbeats. Old-app clients still write RTDB
-- (mirror replays into the same column) until they die off.
--a
-- Server-side clock_timestamp() is used so a wonky client clock can't
-- back-date last_activity_ms — important for the inactive-cohort queries
-- that drive notification targeting.
--
-- Depends on: public.firebase_uid() (000_init.sql),
--             public.user_identity (003_users_split.sql).
-- =====================================================================

create or replace function public.set_last_activity()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me     text;
  now_ms bigint;
begin
  me := public.firebase_uid();
  if me is null then return null; end if;

  now_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;

  -- INSERT-ON-CONFLICT in case a brand-new user beats the mirror CF to
  -- the first user_identity row. UPDATE-only would silently no-op and
  -- they'd never appear in active-cohort queries until another /users
  -- write fired.
  insert into public.user_identity (uid, last_activity_ms, updated_at)
  values (me, now_ms, now())
  on conflict (uid) do update
    set last_activity_ms = excluded.last_activity_ms,
        updated_at       = excluded.updated_at;

  return now_ms;
end;
$$;

grant execute on function public.set_last_activity() to authenticated;
