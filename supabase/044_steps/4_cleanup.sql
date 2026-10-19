-- 044 step 4 of 4 — run in the SQL editor as ONE query, in order.
-- Source: supabase/044_group_privacy.sql

-- =====================================================================
-- STEP 4 — Inactive-group cleanup (functions/groupMembership.js
-- cleanupInactiveGroups). Independent of STEPs 2-3; run before deploying that
-- function and before an app build that shows the Archived label.
--   * group_meta_data.archived_at: set on every member's row while a group is
--     archived (the app's list shows "Archived"). Nullable, no default: a
--     catalog-only change. Builds that list their columns don't read it.
--   * group_last_activity(ids): newest message per group (one index probe on
--     idx_group_messages_group_created per group). Service role only.
--   * set_group_archived(group, at): writes that label. Service role only.
-- =====================================================================
set lock_timeout = '5s';
alter table public.group_meta_data add column if not exists archived_at timestamptz;
reset lock_timeout;

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

create or replace function public.set_group_archived(p_group_id text, p_archived_at timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if public._chat_end_user_uid() is not null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.group_meta_data
     set archived_at = p_archived_at
   where group_id = p_group_id
     and archived_at is distinct from p_archived_at;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

do $$
declare
  v_fn   text;
  v_role text;
begin
  foreach v_fn in array array[
    'public.group_last_activity(text[])',
    'public.set_group_archived(text, timestamptz)'
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
