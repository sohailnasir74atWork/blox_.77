-- =====================================================================
-- 040_owner_email_verified.sql  (Blox Fruits, 2026-10-11)
-- The owner-email fallback in is_mod_staff (031), _chat_caller_link_tier
-- (034 step 1) and mod_read_private_chat (039) trusted the JWT `email` claim
-- without `email_verified`. RTDB rules, Firestore rules and the Cloud
-- Functions all require a VERIFIED owner email; Supabase now does too.
-- Without it, an account registered with email/password on one of the owner
-- addresses (never verified) would count as an owner here: delete any chat
-- message, read any private chat.
--
-- One helper, _jwt_is_owner(), used by all three; their bodies are otherwise
-- unchanged. create or replace keeps the existing grants.
-- Run after 039. Safe to run more than once.
--
-- Rollback: re-run 031 section 1, 034_steps/1_functions.sql (the
-- _chat_caller_link_tier block) and 039 section 2; then
--   drop function public._jwt_is_owner();
-- =====================================================================

-- 1. _jwt_is_owner() ----------------------------------------------------
-- Verified owner email in the caller's JWT. coalesce: no claims, no email or
-- no email_verified (phone sign-in, service role) mean "not owner", not NULL.
create or replace function public._jwt_is_owner()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    (c ->> 'email_verified')::boolean
      and lower(c ->> 'email') in (
        'thesolanalabs@gmail.com',
        'sohailnasir74business@gmail.com',
        'sohailnasir74@gmail.com'
      ),
    false)
  from (select nullif(current_setting('request.jwt.claims', true), '')::jsonb as c) s;
$$;

revoke all on function public._jwt_is_owner() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public._jwt_is_owner() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public._jwt_is_owner() from authenticated;
  end if;
end $$;

-- 2. is_mod_staff() (031) -------------------------------------------------
create or replace function public.is_mod_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    exists (
      select 1
        from public.user_roles
       where uid = public.firebase_uid()
         and (is_admin = true or is_cmsr = true or is_moderator = true or is_baby_mod = true)
    )
    or public._jwt_is_owner(),
    false
  );
$$;

-- 3. _chat_caller_link_tier() (034 step 1) ------------------------------------
create or replace function public._chat_caller_link_tier()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   text := public._chat_end_user_uid();
  r       record;
begin
  if v_uid is null then
    return 'admin';                                  -- service role: unrestricted
  end if;
  if public._jwt_is_owner() then
    return 'admin';
  end if;
  select coalesce(ur.is_admin, false)     as is_admin,
         coalesce(ur.is_cmsr, false)      as is_cmsr,
         coalesce(ur.is_moderator, false) as is_moderator,
         coalesce(ur.is_baby_mod, false)  as is_baby_mod
    into r
    from public.user_roles ur
   where ur.uid = v_uid;
  if not found then
    return 'user';
  end if;
  if r.is_admin then
    return 'admin';
  end if;
  if r.is_cmsr or (r.is_moderator and not r.is_baby_mod) then
    return 'bypass';
  end if;
  return 'user';
end;
$$;

-- 4. mod_read_private_chat() (039) ----------------------------------------------
create or replace function public.mod_read_private_chat(
  p_chat_id text,
  p_limit int default 50
)
returns setof public.private_messages
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid text := public.firebase_uid();
  v_is_admin boolean;
begin
  if not coalesce(public.is_mod_staff(), false) then
    raise exception 'not staff' using errcode = '42501';
  end if;
  if p_chat_id is null or p_chat_id = '' then
    return;
  end if;

  v_is_admin := coalesce(
    exists (select 1 from public.user_roles where uid = v_uid and is_admin = true)
    or public._jwt_is_owner(),
    false
  );

  if not v_is_admin
     and not exists (select 1 from public.reported_chats where chat_id = p_chat_id) then
    raise exception 'chat not reported' using errcode = '42501';
  end if;

  return query
    select *
      from public.private_messages
     where chat_id = p_chat_id
     order by created_at desc, id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;
