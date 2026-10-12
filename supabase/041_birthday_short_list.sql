-- =====================================================================
-- 041_birthday_short_list.sql  (2026-10-12)
-- Blox port of Adopt Me's 056 (adoptme-jan7/supabase/056_birthday_short_list.sql).
-- Birthdays screen, short and personal (owner's call, 2026-10-12). On
-- 2026-10-12 Blox had ~5,000 wishes a day and senders hitting the 50 limit;
-- the old list was pages of strangers. Now:
--
--   list_birthdays_top(p_local_date, p_limit)
--     Today's birthdays only, the people you KNOW first, at most p_limit
--     (the app sends 6). "Know" = you have a DM with them, you share a
--     group, or they wished you on a past birthday. (Adopt Me also ranks
--     squads; Blox has none, and its Friends list lives in Firestore where
--     SQL can't see it.) Then the most recently active. Each row carries a
--     `reason` ('dm' | 'group' | 'wished_you' | null) for its sub-line.
--     Also returns the day's totals:
--     -> { rows: [{uid, name, avatar, month, day, until, wishes, wished, reason}],
--          total: players today, unwished: today and not wished by you yet,
--          tomorrow: players tomorrow }
--
--   wish_all_birthdays(p_local_date, p_template)
--     "Wish everyone": every one of today's players you haven't wished yet,
--     in one call (people you know first), up to the daily wish limit.
--
--   send_birthday_wish: as 036, with the daily limit raised from 50 to 100
--     wishes per sender (owner, 2026-10-12: 30-50+ birthdays a day). Shared
--     with wish_all_birthdays.
--     -> { sent, left: still unwished (the limit stopped them), limited }
--
--   thank_birthday_wishers()
--     On your birthday, "Thank everyone": marks every wish you got this
--     birthday that isn't thanked yet. -> { thanked }
--     birthday_home() now also returns thankPending (wishes not thanked yet).
--
--   birthday_thanks_push_batch(p_limit)  (service role only)
--     For functions/notifyBirthdayWishes.js: claims thanked wishes not
--     pushed yet and returns ONE row per wisher, at most one thanks push
--     per wisher per UTC day ("BunnyQueen and 3 others thanked you").
--
-- Every reader uses the same rules as 036-037: shown, 13+, not blocked
-- either way, active in the last 30 days, and the phone's date clamped to
-- UTC yesterday..tomorrow. Only month and day ever leave the database.
-- Run after 037. Idempotent. Additive: old builds never call any of this
-- (they only see the higher wish limit and an extra thankPending key).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Thanks: per wish, when it was thanked and when its push was claimed.
-- ---------------------------------------------------------------------
alter table public.birthday_wishes add column if not exists thanked_at      timestamptz;
alter table public.birthday_wishes add column if not exists thank_pushed_at timestamptz;
create index if not exists birthday_wishes_thank_due_idx
  on public.birthday_wishes (thanked_at)
  where thanked_at is not null and thank_pushed_at is null;
-- "Wished you before" looks wishes up by sender and receiver.
create index if not exists birthday_wishes_pair_idx on public.birthday_wishes (to_uid, from_uid);

-- One thanks push per wisher per UTC day, however many players thank them.
create table if not exists public.birthday_thank_pushes (
  uid  text not null,
  day  date not null,
  primary key (uid, day)
);
alter table public.birthday_thank_pushes enable row level security;
revoke all on table public.birthday_thank_pushes from anon, authenticated;

-- ---------------------------------------------------------------------
-- _birthday_today_ranked(viewer, local_date): today's shown players for
-- this viewer (not the viewer), people they know first. Internal.
--   score: DM 4, shared group 2, wished you before 1 (summed);
--   reason: the strongest of those, or NULL.
-- ---------------------------------------------------------------------
create or replace function public._birthday_today_ranked(p_viewer text, p_local_date date)
returns table (uid text, name text, avatar text, mo int, dy int, active bigint, score int, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_utc    date := public._birthday_today();
  v_today  date;
  v_keys   int[];
  v_active bigint := (extract(epoch from now()) * 1000)::bigint - 30::bigint * 86400000;
begin
  v_today := case when p_local_date between v_utc - 1 and v_utc + 1 then p_local_date else v_utc end;
  v_keys := array[extract(month from v_today)::int * 100 + extract(day from v_today)::int];
  -- 29 Feb birthdays are celebrated on 28 Feb in non-leap years.
  if extract(month from v_today) = 2 and extract(day from v_today) = 28
     and extract(day from (v_today + 1)) = 1 then
    v_keys := v_keys || 229;
  end if;

  return query
  with m as (
    select b.uid, coalesce(b.display_name, 'Player') as name, b.avatar,
           z.md[1] as mo, z.md[2] as dy, b.last_activity_ms as active
      from public.user_identity_base b
      left join public.birthday_prefs p on p.uid = b.uid
      cross join lateral (select public._birthday_md(b.date_of_birth) as md) z
     where public._birthday_key(b.date_of_birth) = any(v_keys)
       and z.md is not null
       and b.uid <> p_viewer
       and b.last_activity_ms > v_active
       and public._birthday_public_ok(p.show_public, b.date_of_birth)
       and not public._birthday_blocked(p_viewer, b.uid)
  ), k as (
    select m.*,
           exists (select 1 from public.chat_meta_data c
                    where c.owner_uid = p_viewer and c.partner_uid = m.uid) as is_dm,
           exists (select 1 from public.group_meta_data g1
                     join public.group_meta_data g2 on g2.group_id = g1.group_id and g2.user_id = m.uid
                    where g1.user_id = p_viewer) as is_group,
           exists (select 1 from public.birthday_wishes w
                    where w.to_uid = p_viewer and w.from_uid = m.uid) as wished_you
      from m
  )
  select k.uid, k.name, k.avatar, k.mo, k.dy, k.active,
         (case when k.is_dm then 4 else 0 end
          + case when k.is_group then 2 else 0 end + case when k.wished_you then 1 else 0 end)::int,
         case when k.is_dm then 'dm'
              when k.is_group then 'group' when k.wished_you then 'wished_you' end
    from k;
end;
$$;
revoke all on function public._birthday_today_ranked(text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- list_birthdays_top
-- ---------------------------------------------------------------------
create or replace function public.list_birthdays_top(
  p_local_date date default null,
  p_limit      int  default 6
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid      text := public.firebase_uid();
  v_utc      date := public._birthday_today();
  v_today    date;
  v_year     int;
  v_limit    int  := least(greatest(coalesce(p_limit, 6), 1), 20);
  v_tomorrow date;
  v_tkeys    int[];
  v_active   bigint := (extract(epoch from now()) * 1000)::bigint - 30::bigint * 86400000;
  v_rows     jsonb;
  v_total    int;
  v_unwished int;
  v_tcount   int;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  v_today := case when p_local_date between v_utc - 1 and v_utc + 1 then p_local_date else v_utc end;
  v_year := extract(year from v_today)::int;

  with r as (
    select x.*,
           exists (select 1 from public.birthday_wishes w
                    where w.from_uid = v_uid and w.to_uid = x.uid and w.year = v_year) as wished
      from public._birthday_today_ranked(v_uid, v_today) x
  ), top as (
    select * from r order by score desc, active desc, uid limit v_limit
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
                'uid', t.uid, 'name', t.name, 'avatar', t.avatar, 'month', t.mo, 'day', t.dy, 'until', 0,
                'wishes', (select count(*) from public.birthday_wishes w where w.to_uid = t.uid and w.year = v_year),
                'wished', t.wished, 'reason', t.reason)
              order by t.score desc, t.active desc, t.uid)
         from top t), '[]'::jsonb),
    (select count(*)::int from r),
    (select count(*)::int from r where not r.wished)
  into v_rows, v_total, v_unwished;

  -- Tomorrow: a count only (nobody can be wished yet).
  v_tomorrow := v_today + 1;
  v_tkeys := array[extract(month from v_tomorrow)::int * 100 + extract(day from v_tomorrow)::int];
  if extract(month from v_tomorrow) = 2 and extract(day from v_tomorrow) = 28
     and extract(day from (v_tomorrow + 1)) = 1 then
    v_tkeys := v_tkeys || 229;
  end if;
  select count(*)::int into v_tcount
    from public.user_identity_base b
    left join public.birthday_prefs p on p.uid = b.uid
   where public._birthday_key(b.date_of_birth) = any(v_tkeys)
     and b.uid <> v_uid
     and b.last_activity_ms > v_active
     and public._birthday_public_ok(p.show_public, b.date_of_birth)
     and not public._birthday_blocked(v_uid, b.uid);

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'unwished', v_unwished, 'tomorrow', v_tcount);
end;
$$;
revoke all on function public.list_birthdays_top(date, int) from public, anon;
grant execute on function public.list_birthdays_top(date, int) to authenticated;

-- ---------------------------------------------------------------------
-- wish_all_birthdays: one call for "Wish everyone".
-- ---------------------------------------------------------------------
create or replace function public.wish_all_birthdays(
  p_local_date date default null,
  p_template   text default 'party'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text := public.firebase_uid();
  v_utc      date := public._birthday_today();
  v_today    date;
  v_year     int;
  v_room     int;
  v_sent     int := 0;
  v_unwished int;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_template is null or p_template not in ('hbd', 'party', 'pets', 'cake') then
    raise exception 'bad template' using errcode = '22023';
  end if;
  v_today := case when p_local_date between v_utc - 1 and v_utc + 1 then p_local_date else v_utc end;
  v_year := extract(year from v_today)::int;

  -- Serialise this sender's wish-all calls so a double tap can't pass the
  -- daily limit twice.
  perform pg_advisory_xact_lock(hashtext('birthday_wish_all:' || v_uid));

  -- The same 100-in-24-hours limit as send_birthday_wish.
  v_room := 100 - (select count(*)::int from public.birthday_wishes
                   where from_uid = v_uid and created_at > now() - interval '1 day');

  with todo as (
    select x.uid, x.score, x.active
      from public._birthday_today_ranked(v_uid, v_today) x
     where not exists (select 1 from public.birthday_wishes w
                        where w.from_uid = v_uid and w.to_uid = x.uid and w.year = v_year)
  ), pick as (
    select todo.uid from todo
     order by todo.score desc, todo.active desc, todo.uid
     limit greatest(v_room, 0)
  ), ins as (
    insert into public.birthday_wishes (from_uid, to_uid, year, template)
    select v_uid, pick.uid, v_year, p_template from pick
    on conflict (from_uid, to_uid, year) do nothing
    returning 1
  )
  select (select count(*)::int from ins), (select count(*)::int from todo)
    into v_sent, v_unwished;

  return jsonb_build_object('sent', v_sent, 'left', greatest(v_unwished - v_sent, 0),
                            'limited', v_unwished > v_sent);
end;
$$;
revoke all on function public.wish_all_birthdays(date, text) from public, anon;
grant execute on function public.wish_all_birthdays(date, text) to authenticated;

-- ---------------------------------------------------------------------
-- send_birthday_wish: 036's body, daily limit 50 -> 100.
-- ---------------------------------------------------------------------
create or replace function public.send_birthday_wish(p_to text, p_template text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   text := public.firebase_uid();
  v_dob   text;
  v_show  boolean;
  v_md    int[];
  v_near  date;
  v_year  int;
  v_count int;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_template is null or p_template not in ('hbd', 'party', 'pets', 'cake') then
    raise exception 'bad template' using errcode = '22023';
  end if;
  if p_to is null or p_to = v_uid then
    raise exception 'cannot wish this player' using errcode = 'P0001';
  end if;

  select b.date_of_birth, p.show_public into v_dob, v_show
    from public.user_identity_base b
    left join public.birthday_prefs p on p.uid = b.uid
   where b.uid = p_to;
  if not found or not public._birthday_public_ok(v_show, v_dob) or public._birthday_blocked(v_uid, p_to) then
    raise exception 'cannot wish this player' using errcode = 'P0001';
  end if;

  v_md := public._birthday_md(v_dob);
  v_near := case when v_md is not null then public._birthday_near(v_md[1], v_md[2], public._birthday_today()) end;
  if v_near is null then
    raise exception 'not their birthday' using errcode = 'P0001';
  end if;
  v_year := extract(year from v_near)::int;

  if (select count(*) from public.birthday_wishes
       where from_uid = v_uid and created_at > now() - interval '1 day') >= 100 then
    raise exception 'wish limit reached' using errcode = 'P0001';
  end if;

  insert into public.birthday_wishes (from_uid, to_uid, year, template)
  values (v_uid, p_to, v_year, p_template)
  on conflict (from_uid, to_uid, year) do nothing;
  if not found then
    raise exception 'already wished' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.birthday_wishes where to_uid = p_to and year = v_year;
  return jsonb_build_object('wishes', v_count);
end;
$$;

-- ---------------------------------------------------------------------
-- thank_birthday_wishers: on your birthday, thank everyone who wished you.
-- ---------------------------------------------------------------------
create or replace function public.thank_birthday_wishers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  text := public.firebase_uid();
  v_md   int[];
  v_near date;
  v_n    int;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select public._birthday_md(date_of_birth) into v_md from public.user_identity_base where uid = v_uid;
  v_near := case when v_md is not null then public._birthday_near(v_md[1], v_md[2], public._birthday_today()) end;
  if v_near is null then
    raise exception 'not their birthday' using errcode = 'P0001';
  end if;

  update public.birthday_wishes
     set thanked_at = now()
   where to_uid = v_uid and year = extract(year from v_near)::int and thanked_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('thanked', v_n);
end;
$$;
revoke all on function public.thank_birthday_wishers() from public, anon;
grant execute on function public.thank_birthday_wishers() to authenticated;

-- ---------------------------------------------------------------------
-- birthday_home: as 036, plus thankPending (wishes you got this birthday
-- that you haven't thanked yet; 0 when it isn't your birthday).
-- ---------------------------------------------------------------------
create or replace function public.birthday_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     text := public.firebase_uid();
  v_today   date := public._birthday_today();
  v_keys    int[] := '{}';
  v_d       date;
  v_active  bigint := (extract(epoch from now()) * 1000)::bigint - 30::bigint * 86400000;
  v_md      int[];
  v_near    date;
  v_pending int := 0;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  for v_d in select generate_series(v_today - 1, v_today + 1, interval '1 day')::date loop
    v_keys := v_keys || (extract(month from v_d)::int * 100 + extract(day from v_d)::int);
    if extract(month from v_d) = 2 and extract(day from v_d) = 28
       and extract(day from (v_d + 1)) = 1 then
      v_keys := v_keys || 229;
    end if;
  end loop;

  select public._birthday_md(date_of_birth) into v_md from public.user_identity_base where uid = v_uid;
  v_near := case when v_md is not null then public._birthday_near(v_md[1], v_md[2], v_today) end;
  if v_near is not null then
    select count(*)::int into v_pending
      from public.birthday_wishes
     where to_uid = v_uid and year = extract(year from v_near)::int and thanked_at is null;
  end if;

  return public.get_my_birthday() || jsonb_build_object('thankPending', v_pending, 'today', coalesce((
    select jsonb_agg(jsonb_build_array(x.uid, x.m, x.d))
      from (
        select b.uid, z.md[1] as m, z.md[2] as d
          from public.user_identity_base b
          left join public.birthday_prefs p on p.uid = b.uid
          cross join lateral (select public._birthday_md(b.date_of_birth) as md) z
         where public._birthday_key(b.date_of_birth) = any(v_keys)
           and z.md is not null
           and b.last_activity_ms > v_active
           and public._birthday_public_ok(p.show_public, b.date_of_birth)
           and not public._birthday_blocked(v_uid, b.uid)
         limit 1000
      ) x
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.birthday_home() from public, anon;
grant execute on function public.birthday_home() to authenticated;

-- ---------------------------------------------------------------------
-- birthday_thanks_push_batch (service role only):
--   -> rows {uid: the wisher, from_name: one player who thanked them,
--            others: how many more thanked them in this batch}
-- Claims up to p_limit thanked wishes. A wisher already pushed today gets
-- no second push (the wishes are still claimed, so nothing piles up).
-- ---------------------------------------------------------------------
create or replace function public.birthday_thanks_push_batch(p_limit int)
returns table (uid text, from_name text, others int)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 500), 1), 2000);
begin
  return query
  with due as (
    select w.id
      from public.birthday_wishes w
     where w.thanked_at is not null and w.thank_pushed_at is null
     order by w.thanked_at
     limit v_limit
     for update skip locked
  ), upd as (
    update public.birthday_wishes w
       set thank_pushed_at = now()
      from due
     where w.id = due.id
    returning w.from_uid, w.to_uid
  ), per as (
    select upd.from_uid, min(upd.to_uid) as first_to, count(*)::int as n
      from upd
     group by upd.from_uid
  ), fresh as (
    insert into public.birthday_thank_pushes (uid, day)
    select per.from_uid, public._birthday_today() from per
    on conflict do nothing
    returning birthday_thank_pushes.uid
  )
  select per.from_uid,
         coalesce((select i.display_name from public.user_identity_base i where i.uid = per.first_to), 'Someone'),
         per.n - 1
    from per
    join fresh on fresh.uid = per.from_uid;
end;
$$;
revoke all on function public.birthday_thanks_push_batch(int) from public, anon, authenticated;
