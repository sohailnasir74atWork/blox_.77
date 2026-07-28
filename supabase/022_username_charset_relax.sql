-- =====================================================================
-- 022_username_charset_relax.sql — don't reject emoji/space/unicode names
-- =====================================================================
-- 021 shipped claim_username() with a `[A-Za-z0-9_-]` charset check. That
-- was wrong for this app: display names are NOT restricted to ASCII. The
-- Settings input applies no charset filter (only a 15-char length cap), and
-- production is full of names like `★CoolPlayer★`, `🔥DragonKing`, and names
-- with spaces. The strict regex would have thrown "username has invalid
-- characters" the moment any of those users tried to rename — a
-- backward-compat break for a large slice of real users.
--
-- This replaces the function (CREATE OR REPLACE — no data change) to drop
-- the charset check. Uniqueness is still case-insensitive: Postgres lower()
-- handles unicode fine. The length guard is kept but loosened to a
-- defensive 60 (well above the client's 15-char UI cap, and above any
-- 15-emoji name whose UTF-16 length the client counts differently) purely
-- to stop a non-UI caller reserving a giant string.
--
-- Everything else from 021 (usernames table, indexes, reservation logic)
-- is unchanged and stays in place.
-- =====================================================================

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
    select 1 from public.user_identity
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
