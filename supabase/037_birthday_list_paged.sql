-- =====================================================================
-- 037_birthday_list_paged.sql  (Blox Fruits, 2026-10-08; port of Adopt Me 052)
-- Birthdays screen, owner's call: only TODAY and TOMORROW, 20 players at a
-- time, with a "Load more" button. Cheaper than the old 7-day list of up to
-- 200 rows, which was fetched in full every time the screen opened.
--
--   list_birthdays_page(p_local_date, p_days, p_limit, p_cursor)
--     p_local_date  the phone's own date, so "today" and "tomorrow" match
--                   the phone exactly and no time-zone slack rows are sent
--                   just to be dropped. Clamped to UTC yesterday..tomorrow
--                   (every real time zone); anything else means UTC today.
--     p_days        0..7; the app sends 1 (today + tomorrow).
--     p_limit       1..50; the app sends 20.
--     p_cursor      the `next` of the previous page, or NULL for the first.
--   -> { rows:   [{uid, name, avatar, month, day, until, wishes, wished}],
--        next:   [until, last_activity_ms, uid] | null,
--        counts: [players today, players tomorrow, ...] }
--
--   Soonest first, then the most recently active, then uid. Pages are cut
--   by keyset on that order, so a player never repeats across pages. Wish
--   counts are computed for the returned page only.
--
-- list_birthdays (036) stays as it is for the builds that already call it.
-- Run after 036. Idempotent. Additive: old builds never call this.
-- =====================================================================

create or replace function public.list_birthdays_page(
  p_local_date date default null,
  p_days       int  default 1,
  p_limit      int  default 20,
  p_cursor     jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    text := public.firebase_uid();
  v_utc    date := public._birthday_today();
  v_today  date;
  v_days   int  := least(greatest(coalesce(p_days, 1), 0), 7);
  v_limit  int  := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_keys   int[] := '{}';
  v_d      date;
  v_active bigint := (extract(epoch from now()) * 1000)::bigint - 30::bigint * 86400000;
  c_until  int;
  c_active bigint;
  c_uid    text;
  v_rows   jsonb;
  v_next   jsonb;
  v_counts jsonb;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  v_today := case when p_local_date between v_utc - 1 and v_utc + 1 then p_local_date else v_utc end;

  if p_cursor is not null then
    if jsonb_typeof(p_cursor) <> 'array' or jsonb_array_length(p_cursor) <> 3 then
      raise exception 'bad cursor' using errcode = '22023';
    end if;
    c_until  := (p_cursor->>0)::int;
    c_active := (p_cursor->>1)::bigint;
    c_uid    := p_cursor->>2;
  end if;

  -- The month/day keys of today .. today + days. 29 Feb birthdays are
  -- celebrated on 28 Feb in non-leap years.
  for v_d in select generate_series(v_today, v_today + v_days, interval '1 day')::date loop
    v_keys := v_keys || (extract(month from v_d)::int * 100 + extract(day from v_d)::int);
    if extract(month from v_d) = 2 and extract(day from v_d) = 28
       and extract(day from (v_d + 1)) = 1 then
      v_keys := v_keys || 229;
    end if;
  end loop;

  with m as (
    select b.uid, coalesce(b.display_name, 'Player') as name, b.avatar,
           z.md[1] as mo, z.md[2] as dy, b.last_activity_ms as active,
           public._birthday_days_from(z.md[1], z.md[2], v_today) as until
      from public.user_identity_base b
      left join public.birthday_prefs p on p.uid = b.uid
      cross join lateral (select public._birthday_md(b.date_of_birth) as md) z
     where public._birthday_key(b.date_of_birth) = any(v_keys)
       and z.md is not null
       and b.last_activity_ms > v_active
       and public._birthday_public_ok(p.show_public, b.date_of_birth)
       and not public._birthday_blocked(v_uid, b.uid)
  ), f as (
    select * from m where until <= v_days
  ), pg as (
    -- One extra row tells whether another page exists.
    select f.*, row_number() over (order by until, active desc, uid) as rn
      from f
     where c_uid is null or (until, -active, uid) > (c_until, -c_active, c_uid)
     order by until, active desc, uid
     limit v_limit + 1
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'uid', x.uid, 'name', x.name, 'avatar', x.avatar, 'month', x.mo, 'day', x.dy, 'until', x.until,
               'wishes', (select count(*) from public.birthday_wishes w
                           where w.to_uid = x.uid and w.year = extract(year from v_today + x.until)::int),
               'wished', exists (select 1 from public.birthday_wishes w
                                  where w.from_uid = v_uid and w.to_uid = x.uid
                                    and w.year = extract(year from v_today + x.until)::int))
             order by x.rn)
        from pg x
       where x.rn <= v_limit
    ), '[]'::jsonb),
    (select jsonb_build_array(x.until, x.active, x.uid)
       from pg x
      where x.rn = v_limit and exists (select 1 from pg y where y.rn > v_limit)),
    -- Section totals, on the first page only.
    case when c_uid is null then (
      select jsonb_agg(coalesce(k.n, 0) order by g)
        from generate_series(0, v_days) g
        left join (select until, count(*)::int as n from f group by until) k on k.until = g
    ) end
  into v_rows, v_next, v_counts;

  return jsonb_build_object('rows', v_rows, 'next', v_next, 'counts', v_counts);
end;
$$;

revoke all on function public.list_birthdays_page(date, int, int, jsonb) from public, anon;
grant execute on function public.list_birthdays_page(date, int, int, jsonb) to authenticated;
