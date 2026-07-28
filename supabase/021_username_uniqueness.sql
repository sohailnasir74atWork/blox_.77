-- =====================================================================
-- 021_username_uniqueness.sql — case-insensitive unique display names
-- =====================================================================
-- Problem: nothing anywhere stopped two accounts from using the same
-- display name. Names are chosen in Settings (Setting.jsx handleSaveChanges
-- → RTDB users/{uid}/displayName) and mirrored here into
-- user_identity.display_name by mirrorUsersToSupabase. A plain UNIQUE
-- constraint on display_name would be wrong for two reasons:
--   1. production already contains MANY duplicate names (organic history);
--      a UNIQUE index can't even be built, and would break the mirror.
--   2. the mirror is eventually-consistent, so the constraint would fail
--      AFTER the fact (client already wrote to RTDB) instead of blocking.
--
-- Decision (see chat): block NEW duplicates, case-insensitively; grandfather
-- existing dupes untouched. Enforcement must sit on the write path, so we
-- expose an atomic SECURITY DEFINER RPC the client calls BEFORE it writes
-- the new name to RTDB. It rejects the name if anyone else already holds it.
--
-- Two-part uniqueness source:
--   • user_identity.display_name — the mirror of every real, current name.
--     Guards against taking a name a grandfathered user is actually using.
--   • public.usernames — a reservation table whose lower_name PRIMARY KEY is
--     the atomic serialization point for two brand-new claims of the same
--     name that haven't mirrored yet (closes the mirror-lag race window).
--
-- No UNIQUE(uid): a rename transiently leaves the old row until we delete it
-- inside the same call; the uid<>caller checks never mis-fire on own rows.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. reservation table
-- ---------------------------------------------------------------------
create table if not exists public.usernames (
  lower_name    text primary key,          -- lower(display_name)
  uid           text not null,             -- Firebase uid of the holder
  display_name  text not null,             -- as-typed (case preserved)
  updated_at    timestamptz not null default now()
);

create index if not exists idx_usernames_uid on public.usernames (uid);

alter table public.usernames enable row level security;

-- Anyone authenticated may read (e.g. optional "is this free?" prefetch).
-- All writes go through claim_username(); no direct client writes.
drop policy if exists usernames_select on public.usernames;
create policy usernames_select on public.usernames
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------
-- 2. case-insensitive lookup index on the identity mirror
--    (non-unique — existing data has dupes; this is only for the
--    exists() check in the RPC to stay cheap)
-- ---------------------------------------------------------------------
create index if not exists idx_user_identity_lower_display_name
  on public.user_identity (lower(display_name));

-- ---------------------------------------------------------------------
-- 3. claim_username — atomic check-and-reserve
-- ---------------------------------------------------------------------
-- Returns { ok: true, display_name } on success. Raises 'username taken'
-- (SQLSTATE 23505) if another user holds the name; the client maps that to
-- a friendly "already taken" message. Validation mirrors the client
-- (<=15 chars, [A-Za-z0-9_-]) so the DB is authoritative even if a caller
-- skips the UI checks.
-- ---------------------------------------------------------------------
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
  if char_length(v_name) > 15 then
    raise exception 'username too long' using errcode = '22023';
  end if;
  if v_name !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'username has invalid characters' using errcode = '22023';
  end if;

  v_lower := lower(v_name);

  -- (a) Is another user currently displaying this name? (source-of-truth
  --     mirror — protects grandfathered names too.)
  if exists (
    select 1 from public.user_identity
     where lower(display_name) = v_lower
       and uid <> caller
  ) then
    raise exception 'username taken' using errcode = '23505';
  end if;

  -- (b) Atomic reservation. The lower_name PK serialises concurrent
  --     brand-new claims. If the row exists and is ours, refresh the
  --     as-typed casing; if it belongs to someone else the WHERE makes the
  --     update a no-op and step (c) rejects.
  insert into public.usernames (lower_name, uid, display_name, updated_at)
    values (v_lower, caller, v_name, now())
  on conflict (lower_name) do update
     set display_name = excluded.display_name,
         updated_at   = now()
   where public.usernames.uid = caller;

  -- (c) Confirm we actually own the row now (lost-race guard).
  select uid into v_owner from public.usernames where lower_name = v_lower;
  if v_owner is distinct from caller then
    raise exception 'username taken' using errcode = '23505';
  end if;

  -- (d) Release any previous reservation this user held under another name.
  delete from public.usernames
   where uid = caller and lower_name <> v_lower;

  return jsonb_build_object('ok', true, 'display_name', v_name);
end $$;

grant execute on function public.claim_username(text) to authenticated;
