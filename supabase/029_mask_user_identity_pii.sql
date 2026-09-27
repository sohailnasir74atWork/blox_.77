-- =====================================================================
-- 029_mask_user_identity_pii.sql — emails / DOB visible only to the owner
-- and staff (round 2, 2026-09). NOT APPLIED YET.
-- =====================================================================
-- Problem: the "user_identity readable by any authed user" policy (003) lets
-- any signed-in user `select email, decoded_email, date_of_birth` for every
-- account. A column REVOKE would break shipped builds (old builds select
-- '*' or an explicit list that includes `email` → PostgREST 42501 for the
-- whole request, i.e. no names/avatars in chat).
--
-- Fix: keep the name `user_identity` for readers but make it a masking VIEW.
--   1. table public.user_identity → public.user_identity_base (indexes,
--      constraints, RLS policy and replica identity move with it).
--   2. public.is_staff() — admin / senior mod (is_cmsr) / moderator / JMD
--      (is_baby_mod) from user_roles for public.firebase_uid(). Trusted,
--      grinder and raider are not staff.
--   3. view public.user_identity: same columns, same order, generated from
--      the base's live column list; email / decoded_email / date_of_birth
--      are NULL unless the row is the caller's own or the caller is staff.
--   4. clients lose ALL privileges on user_identity_base and get SELECT on
--      the view only (same roles that could SELECT the table).
--   5. SECURITY DEFINER code that named user_identity (set_last_activity,
--      claim_username) is repointed at user_identity_base.
--
-- DEVIATION FROM THE ROUND-2 SPEC (deliberate): the spec asked for
-- `with (security_invoker = true)`. An invoker view needs the caller to hold
-- SELECT on user_identity_base — including the email column the CASE reads —
-- and a base table in `public` with that grant is served by PostgREST as
-- /rest/v1/user_identity_base, so any signed-in user could read every
-- email straight from the base and the mask would be decorative. So the view
-- runs with its owner's rights (security_invoker = false), clients have no
-- privileges on the base at all, and the base's only SELECT policy
-- ("firebase_uid() is not null") is re-applied in the view's WHERE.
-- security_barrier keeps user-supplied filters from being evaluated ahead of
-- that WHERE. The Supabase linter reports this as "Security Definer View";
-- that is expected here.
--
-- Deploy (step a, before the app release, safe for every build):
--   1. firebase deploy --only functions:mirrorUsersToSupabase,functions:mirrorUsersPrivateToSupabase
--      (they write user_identity_base and fall back to user_identity until
--      this file has run — deploying them second leaves identity mirroring
--      failing until they are live: the old code upserts into the view).
--   2. Run this file (one transaction; the rename takes a brief exclusive
--      lock on a table read ~11 M times/day — run off-peak).
--
-- PostgREST behaviour after this file:
--   * .from('user_identity').select(...).eq('uid', x) / .in('uid', [...])
--     (userBackend.js, every build): unchanged; email / decoded_email /
--     date_of_birth come back NULL for other users unless the caller is staff.
--   * .eq('email', x) / ilike on the masked columns by non-staff: matches
--     nothing (intended). No client does this today.
--   * INSERT / UPDATE / UPSERT / DELETE on user_identity: permission denied
--     for every role — writers must use user_identity_base (service role).
--     Affected: the CURRENTLY deployed mirrorUsersToSupabase (hence step 1),
--     scripts/backfill-users-to-supabase.js and
--     scripts/backfill-cosmetics-gamewin-2026-09.js (one-off; would now fail
--     instead of writing).
--   * No embedded selects and no realtime use user_identity (017 removed it
--     from the publication).
--   * 028_repair_bootstrap_admin_roles.sql must not be re-run as is: it
--     matches on user_identity.email, which the SQL editor (no JWT) now sees
--     as NULL. Point it at user_identity_base first.
-- =====================================================================

begin;

-- Roles that can SELECT user_identity now (first run: the table; a re-run:
-- the view from the previous run). The view gets exactly these.
create temp table r2_identity_readers on commit drop as
select distinct g.grantee::text as grantee
  from information_schema.role_table_grants g
  join pg_namespace n on n.nspname = g.table_schema
  join pg_class c on c.relnamespace = n.oid and c.relname = g.table_name
 where g.table_schema = 'public'
   and g.table_name in ('user_identity', 'user_identity_base')
   and g.privilege_type = 'SELECT'
   and g.grantee <> pg_get_userbyid(c.relowner);

-- ---------------------------------------------------------------------
-- 1. rename (guarded so a re-run is a no-op)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.user_identity_base') is null then
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname = 'user_identity' and c.relkind = 'r') then
      alter table public.user_identity rename to user_identity_base;
    else
      raise exception 'public.user_identity is not a table and user_identity_base does not exist — nothing to mask';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. is_staff()
-- ---------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select r.is_admin or r.is_cmsr or r.is_moderator or r.is_baby_mod
      from public.user_roles r
     where r.uid = public.firebase_uid()
  ), false);
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. masking view, generated from the base's current column list so it has
--    exactly the same columns in the same order as the old table.
--    initplans: firebase_uid() / is_staff() run once per query, not per row.
-- ---------------------------------------------------------------------
drop view if exists public.user_identity;

do $$
declare
  cols text;
begin
  select string_agg(
           case
             when c.column_name in ('email', 'decoded_email', 'date_of_birth') then format(
               'case when b.uid = (select public.firebase_uid()) or (select public.is_staff()) then b.%1$I end as %1$I',
               c.column_name)
             else format('b.%I', c.column_name)
           end,
           ', ' order by c.ordinal_position)
    into cols
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'user_identity_base';

  execute format(
    'create view public.user_identity with (security_barrier = true, security_invoker = false) as '
    'select %s from public.user_identity_base b '
    'where (select public.firebase_uid()) is not null',
    cols);
end $$;

comment on view public.user_identity is
  'Round 2 (029): masking view over user_identity_base. email, decoded_email and date_of_birth are NULL unless the row is the caller''s own or public.is_staff(). Read-only; writers use user_identity_base.';

-- ---------------------------------------------------------------------
-- 4. privileges: the view gets SELECT (only) for the roles captured at the
--    top — Supabase's default privileges would otherwise hand anon /
--    authenticated INSERT/UPDATE/DELETE on it, and this view is
--    auto-updatable with its owner's rights. Nobody but the owner and
--    service_role keeps any privilege on the base.
-- ---------------------------------------------------------------------
revoke all on public.user_identity from public, anon, authenticated, service_role;

do $$
declare
  r record;
begin
  for r in select grantee from r2_identity_readers loop
    if r.grantee = 'PUBLIC' then
      execute 'grant select on public.user_identity to public';
    else
      execute format('grant select on public.user_identity to %I', r.grantee);
    end if;
  end loop;
end $$;

revoke all on public.user_identity_base from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. repoint SECURITY DEFINER code (bodies otherwise identical to 016 / 022)
-- ---------------------------------------------------------------------
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
  -- the first identity row. UPDATE-only would silently no-op and
  -- they'd never appear in active-cohort queries until another /users
  -- write fired.
  insert into public.user_identity_base (uid, last_activity_ms, updated_at)
  values (me, now_ms, now())
  on conflict (uid) do update
    set last_activity_ms = excluded.last_activity_ms,
        updated_at       = excluded.updated_at;

  return now_ms;
end;
$$;

grant execute on function public.set_last_activity() to authenticated;

create or replace function public.claim_username(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller  text := public.firebase_uid();
  v_name  text := btrim(coalesce(p_name, ''));
  v_lower text;
  v_owner text;
begin
  if caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'username required' using errcode = '22023';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'username too long' using errcode = '22023';
  end if;

  v_lower := lower(v_name);

  -- (a) another user currently displaying this name? (mirror = source of truth)
  if exists (
    select 1 from public.user_identity_base
     where lower(display_name) = v_lower
       and uid <> caller
  ) then
    raise exception 'username taken' using errcode = '23505';
  end if;

  -- (b) atomic reservation; lower_name PK serialises concurrent new claims
  insert into public.usernames (lower_name, uid, display_name, updated_at)
    values (v_lower, caller, v_name, now())
  on conflict (lower_name) do update
     set display_name = excluded.display_name,
         updated_at   = now()
   where public.usernames.uid = caller;

  -- (c) confirm ownership (lost-race guard)
  select uid into v_owner from public.usernames where lower_name = v_lower;
  if v_owner is distinct from caller then
    raise exception 'username taken' using errcode = '23505';
  end if;

  -- (d) release any previous reservation under another name
  delete from public.usernames
   where uid = caller and lower_name <> v_lower;

  return jsonb_build_object('ok', true, 'display_name', v_name);
end $$;

grant execute on function public.claim_username(text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. fail closed on anything this file doesn't know about: a function that
--    still names user_identity (SECURITY DEFINER code would read masked
--    values), or another view that followed the rename to the unmasked base.
--    Either aborts the whole transaction with the object names.
-- ---------------------------------------------------------------------
do $$
declare
  fns   text;
  views text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into fns
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~ 'user_identity(?!_base)';

  select string_agg(distinct v.oid::regclass::text, ', ')
    into views
    from pg_depend d
    join pg_rewrite rw on rw.oid = d.objid
    join pg_class v on v.oid = rw.ev_class
   where d.refobjid = 'public.user_identity_base'::regclass
     and v.oid <> 'public.user_identity'::regclass
     and v.relkind in ('v', 'm');

  if fns is not null or views is not null then
    raise exception 'user_identity still referenced — repoint before applying. functions: %; views: %',
      coalesce(fns, '-'), coalesce(views, '-');
  end if;

  -- The app must still be able to read the view, and nothing else.
  if not has_table_privilege('authenticated', 'public.user_identity', 'select')
     or has_table_privilege('authenticated', 'public.user_identity', 'insert')
     or has_table_privilege('authenticated', 'public.user_identity', 'update')
     or has_table_privilege('authenticated', 'public.user_identity_base', 'select')
     or has_table_privilege('anon', 'public.user_identity_base', 'select') then
    raise exception 'unexpected privileges on user_identity / user_identity_base — aborting';
  end if;
end $$;

commit;

-- PostgREST schema cache
notify pgrst, 'reload schema';

-- Verify (as a non-staff Firebase user through the app / REST):
--   GET /rest/v1/user_identity?select=uid,email&uid=eq.<someone else>  → email null
--   GET /rest/v1/user_identity?select=uid,email&uid=eq.<me>            → own email
--   GET /rest/v1/user_identity_base?select=email                       → 401/42501
-- As staff: other users' email is returned.


-- =====================================================================
-- ROLLBACK (run by hand; restores the 003/016/022 state)
-- =====================================================================
-- begin;
-- drop view if exists public.user_identity;
-- alter table public.user_identity_base rename to user_identity;
-- grant all on public.user_identity to anon, authenticated, service_role;  -- Supabase defaults, as before 029
--
-- create or replace function public.set_last_activity()
-- returns bigint language plpgsql security definer set search_path = public as $$
-- declare me text; now_ms bigint;
-- begin
--   me := public.firebase_uid();
--   if me is null then return null; end if;
--   now_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
--   insert into public.user_identity (uid, last_activity_ms, updated_at)
--   values (me, now_ms, now())
--   on conflict (uid) do update
--     set last_activity_ms = excluded.last_activity_ms, updated_at = excluded.updated_at;
--   return now_ms;
-- end; $$;
--
-- create or replace function public.claim_username(p_name text)
-- returns jsonb language plpgsql security definer set search_path = public as $$
-- declare caller text := public.firebase_uid(); v_name text := btrim(coalesce(p_name, '')); v_lower text; v_owner text;
-- begin
--   if caller is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
--   if v_name = '' then raise exception 'username required' using errcode = '22023'; end if;
--   if char_length(v_name) > 60 then raise exception 'username too long' using errcode = '22023'; end if;
--   v_lower := lower(v_name);
--   if exists (select 1 from public.user_identity where lower(display_name) = v_lower and uid <> caller) then
--     raise exception 'username taken' using errcode = '23505';
--   end if;
--   insert into public.usernames (lower_name, uid, display_name, updated_at) values (v_lower, caller, v_name, now())
--   on conflict (lower_name) do update set display_name = excluded.display_name, updated_at = now()
--    where public.usernames.uid = caller;
--   select uid into v_owner from public.usernames where lower_name = v_lower;
--   if v_owner is distinct from caller then raise exception 'username taken' using errcode = '23505'; end if;
--   delete from public.usernames where uid = caller and lower_name <> v_lower;
--   return jsonb_build_object('ok', true, 'display_name', v_name);
-- end $$;
--
-- drop function if exists public.is_staff();
-- commit;
-- notify pgrst, 'reload schema';
-- (mirrorUsersToSupabase keeps working after a rollback: user_identity_base
--  is missing again, so it falls back to user_identity.)
