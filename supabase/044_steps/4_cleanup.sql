-- 044 step 4 of 4 — run in the SQL editor as ONE query, in order.
-- Source: supabase/044_group_privacy.sql

-- =====================================================================
-- STEP 4 — Inactive-group cleanup (functions/groupMembership.js
-- cleanupInactiveGroups: a group with no message for 15 days is deleted).
-- Independent of STEPs 2-3; run before deploying that function.
--   * group_last_activity(ids): newest message per group (one index probe on
--     idx_group_messages_group_created per group). Service role only.
-- =====================================================================

create or replace function public.group_last_activity(p_group_ids text[])
returns table (group_id text, last_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select g,
         (select m.created_at from public.group_messages m
           where m.group_id = g
           order by m.created_at desc
           limit 1)
    from unnest(coalesce(p_group_ids, '{}'::text[])) as g;
$$;

do $$
declare
  v_fn   text;
  v_role text;
begin
  foreach v_fn in array array[
    'public.group_last_activity(text[])'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    foreach v_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = v_role) then
        execute format('revoke all on function %s from %I', v_fn, v_role);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', v_fn);
    end if;
  end loop;
end
$$;

notify pgrst, 'reload schema';
