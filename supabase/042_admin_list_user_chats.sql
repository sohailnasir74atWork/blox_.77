-- Admin-only paginated inbox lookup for the Mod Panel's one-user chat view.
-- chat_meta_data remains participant-only under RLS; this RPC is the narrow
-- server-side exception and is available only to an admin or verified owner.

create or replace function public.admin_list_user_chats(
  p_owner_uid text,
  p_offset int default 0,
  p_limit int default 20
)
returns setof public.chat_meta_data
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid text := public.firebase_uid();
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_is_admin boolean;
begin
  v_is_admin := coalesce(
    exists (
      select 1 from public.user_roles
       where uid = v_uid and is_admin = true
    ) or (
      (v_claims ->> 'email_verified')::boolean
      and lower(v_claims ->> 'email') in (
        'thesolanalabs@gmail.com',
        'sohailnasir74business@gmail.com',
        'sohailnasir74@gmail.com'
      )
    ),
    false
  );

  if not v_is_admin then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_owner_uid is null or p_owner_uid = '' then
    raise exception 'user id required' using errcode = '22023';
  end if;

  return query
    select c.*
      from public.chat_meta_data c
     where c.owner_uid = p_owner_uid
     order by c.timestamp_ms desc nulls last, c.partner_uid asc
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.admin_list_user_chats(text, int, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.admin_list_user_chats(text, int, int) from anon;
  end if;
end $$;
grant execute on function public.admin_list_user_chats(text, int, int) to authenticated;
