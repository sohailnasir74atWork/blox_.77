-- =====================================================================
-- 036_birthdays.sql  (2026-10-07)  — Blox Fruits port of Adopt Me's
-- Birthdays (adoptme-jan7 supabase/049 + 050 + 051, combined; see
-- adoptme-jan7/docs/feature-port-reference-2026-10.md section 2).
--
-- Differences from Adopt Me:
--   * No Pet Cards: the birthday gift is STARS. claim_birthday_gift() records
--     the year in birthday_gifts (once per birthday, account >= 30 days, the
--     birthday within a day of today) and returns { stars }; the app then adds
--     them to users/{uid}/dailyStars/starBalance (RTDB, where Blox keeps
--     stars). open_card_pack is not touched.
--   * dob_age_years() / safe_chat_minor_age() are created here (Adopt Me had
--     them from its safe-chat migration); nothing else in Blox uses them.
--   * Date of birth comes from users_private/{uid}/dateOfBirth, mirrored to
--     user_identity_base.date_of_birth by mirrorUsersPrivateToSupabase.
--
-- Cost: the Home card / chat cake read ONE small call (birthday_home, a few
-- KB, cached on the phone for hours); the week list loads only when the
-- Birthdays screen opens; pushes are batched by two scheduled functions.
-- Additive and idempotent: old app builds never call any of this.
-- =====================================================================

do $guard$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'user_identity_base' and column_name = 'date_of_birth') then
    raise exception '036 needs user_identity_base.date_of_birth (029)';
  end if;
end
$guard$;

-- date_of_birth is TEXT ('YYYY-MM-DD') because RTDB stores it that way, so a
-- bare ::date would throw on any malformed row and take the whole insert with
-- it. Unparseable, absent and future dates all return NULL, which reads as
-- "not known to be a minor" at the call sites below.
create or replace function public.dob_age_years(p_dob text)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_date date;
begin
  if p_dob is null or p_dob !~ '^\d{4}-\d{1,2}-\d{1,2}$' then
    return null;
  end if;

  begin
    v_date := p_dob::date;
  exception when others then
    return null;    -- e.g. '2024-13-45' passes the regex but is not a date
  end;

  if v_date > current_date then
    return null;
  end if;

  return extract(year from age(current_date, v_date))::int;
end;
$$;

comment on function public.dob_age_years(text) is
  'Whole years old today from a YYYY-MM-DD string; NULL if absent/unparseable/future.';

-- Keep the threshold in one place. Mirrors MINOR_AGE_THRESHOLD in
-- Code/Helper/ageGate.js.
create or replace function public.safe_chat_minor_age()
returns integer
language sql
immutable
as $$ select 13 $$;


-- ---------------------------------------------------------------------
-- Tables (no client access: SECURITY DEFINER functions only)
-- ---------------------------------------------------------------------
create table if not exists public.birthday_prefs (
  uid          text primary key,
  show_public  boolean not null default false,
  asked_at     timestamptz,               -- we asked once ("Show it?" / Not now)
  updated_at   timestamptz not null default now()
);
create index if not exists birthday_prefs_shown_idx on public.birthday_prefs (uid) where show_public;

create table if not exists public.birthday_gifts (
  uid        text not null,
  year       int  not null,               -- the birthday's year, not the open date's
  opened_at  timestamptz not null default now(),
  primary key (uid, year)
);

create table if not exists public.birthday_wishes (
  id          bigserial primary key,
  from_uid    text not null,
  to_uid      text not null,
  year        int  not null,
  template    text not null check (template in ('hbd', 'party', 'pets', 'cake')),
  created_at  timestamptz not null default now(),
  unique (from_uid, to_uid, year)
);
create index if not exists birthday_wishes_to_idx on public.birthday_wishes (to_uid, year);
create index if not exists birthday_wishes_from_idx on public.birthday_wishes (from_uid, created_at);

create table if not exists public.birthday_pushes (
  uid      text not null,
  year     int  not null,
  sent_at  timestamptz not null default now(),
  primary key (uid, year)
);

alter table public.birthday_prefs  enable row level security;
alter table public.birthday_gifts  enable row level security;
alter table public.birthday_wishes enable row level security;
alter table public.birthday_pushes enable row level security;
revoke all on table public.birthday_prefs  from anon, authenticated;
revoke all on table public.birthday_gifts  from anon, authenticated;
revoke all on table public.birthday_wishes from anon, authenticated;
revoke all on table public.birthday_pushes from anon, authenticated;
revoke all on sequence public.birthday_wishes_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------
-- Date helpers
-- ---------------------------------------------------------------------

-- 'YYYY-MM-DD' -> {month, day}, or NULL if absent / not a real date.
create or replace function public._birthday_md(p_dob text)
returns int[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_date date;
begin
  if p_dob is null or p_dob !~ '^\d{4}-\d{1,2}-\d{1,2}$' then
    return null;
  end if;
  begin
    v_date := p_dob::date;
  exception when others then
    return null;
  end;
  return array[extract(month from v_date)::int, extract(day from v_date)::int];
end;
$$;

-- The date a (month, day) birthday falls on in p_year; 29 Feb -> 28 Feb in
-- non-leap years.
create or replace function public._birthday_on(p_year int, p_month int, p_day int)
returns date
language sql
immutable
as $$
  select make_date(p_year, p_month,
    least(p_day, extract(day from (make_date(p_year, p_month, 1) + interval '1 month - 1 day'))::int));
$$;

-- Days from p_from to the next birthday on or after it (0 = p_from itself).
create or replace function public._birthday_days_from(p_month int, p_day int, p_from date)
returns int
language plpgsql
immutable
as $$
declare
  v_next date := public._birthday_on(extract(year from p_from)::int, p_month, p_day);
begin
  if v_next < p_from then
    v_next := public._birthday_on(extract(year from p_from)::int + 1, p_month, p_day);
  end if;
  return v_next - p_from;
end;
$$;

-- The birthday date within one day of p_today (UTC), or NULL. Covers every
-- time zone's "today": a player's birthday can be UTC yesterday, today or
-- tomorrow while it is their local today.
create or replace function public._birthday_near(p_month int, p_day int, p_today date)
returns date
language sql
immutable
as $$
  select case when public._birthday_days_from(p_month, p_day, p_today - 1) <= 2
              then p_today - 1 + public._birthday_days_from(p_month, p_day, p_today - 1) end;
$$;

create or replace function public._birthday_today()
returns date
language sql
stable
as $$ select (now() at time zone 'utc')::date $$;

-- Visible to other players: opted in and 13 or older.
create or replace function public._birthday_public_ok(p_show boolean, p_dob text)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(p_show, false)
     and coalesce(public.dob_age_years(p_dob) >= public.safe_chat_minor_age(), false);
$$;

create or replace function public._birthday_blocked(p_a text, p_b text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks
     where (uid = p_a and blocked_uid = p_b) or (uid = p_b and blocked_uid = p_a)
  );
$$;

-- The year of the caller's birthday if it is "today" (±1 day) and the
-- account is at least 30 days old; NULL otherwise. Does not look at
-- birthday_gifts: claim_birthday_gift()'s insert is what makes it once a year.
create or replace function public._birthday_gift_year(p_uid text)
returns int
language plpgsql
stable
set search_path = public
as $$
declare
  v_dob     text;
  v_created bigint;
  v_md      int[];
  v_near    date;
begin
  select date_of_birth, created_at_ms into v_dob, v_created
    from public.user_identity_base where uid = p_uid;
  v_md := public._birthday_md(v_dob);
  if v_md is null then return null; end if;
  if v_created is not null
     and v_created > (extract(epoch from now()) * 1000 - 30::bigint * 86400000) then
    return null;                               -- account younger than 30 days
  end if;
  v_near := public._birthday_near(v_md[1], v_md[2], public._birthday_today());
  return extract(year from v_near)::int;       -- NULL when not near
end;
$$;

revoke all on function public._birthday_md(text) from public, anon, authenticated;
revoke all on function public._birthday_on(int, int, int) from public, anon, authenticated;
revoke all on function public._birthday_days_from(int, int, date) from public, anon, authenticated;
revoke all on function public._birthday_near(int, int, date) from public, anon, authenticated;
revoke all on function public._birthday_today() from public, anon, authenticated;
revoke all on function public._birthday_public_ok(boolean, text) from public, anon, authenticated;
revoke all on function public._birthday_blocked(text, text) from public, anon, authenticated;
revoke all on function public._birthday_gift_year(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- get_my_birthday:
--   -> {month, day, show, asked, minor, giftReady, giftOpened, wishCount,
--       wishes: [{name, avatar, template}]}   (no year, no age)
-- ---------------------------------------------------------------------
create or replace function public.get_my_birthday()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    text := public.firebase_uid();
  v_dob    text;
  v_md     int[];
  v_minor  boolean;
  p        public.birthday_prefs;
  v_near   date;
  v_year   int;
  v_gift   int;
  v_opened boolean := false;
  v_count  int := 0;
  v_wishes jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select date_of_birth into v_dob from public.user_identity_base where uid = v_uid;
  v_md := public._birthday_md(v_dob);
  if v_md is null then
    return jsonb_build_object('month', null, 'day', null, 'show', false, 'asked', false, 'minor', false,
      'giftReady', false, 'giftOpened', false, 'wishCount', 0, 'wishes', '[]'::jsonb);
  end if;

  v_minor := coalesce(public.dob_age_years(v_dob) < public.safe_chat_minor_age(), false);
  select * into p from public.birthday_prefs where uid = v_uid;

  v_near := public._birthday_near(v_md[1], v_md[2], public._birthday_today());
  if v_near is not null then
    v_year := extract(year from v_near)::int;
    v_opened := exists (select 1 from public.birthday_gifts where uid = v_uid and year = v_year);
    select count(*) into v_count from public.birthday_wishes where to_uid = v_uid and year = v_year;
    select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(i.display_name, 'Player'), 'avatar', i.avatar,
                                                 'template', w.template) order by w.created_at desc), '[]'::jsonb)
      into v_wishes
      from (select * from public.birthday_wishes
             where to_uid = v_uid and year = v_year
             order by created_at desc limit 50) w
      left join public.user_identity_base i on i.uid = w.from_uid;
  end if;
  v_gift := public._birthday_gift_year(v_uid);

  return jsonb_build_object(
    'month', v_md[1], 'day', v_md[2],
    'show', coalesce(p.show_public, false) and not v_minor,
    'asked', p.asked_at is not null,
    'minor', v_minor,
    'giftReady', v_gift is not null and not exists (select 1 from public.birthday_gifts where uid = v_uid and year = v_gift),
    'giftOpened', v_opened,
    'wishCount', v_count,
    'wishes', v_wishes
  );
end;
$$;

-- ---------------------------------------------------------------------
-- set_birthday_visibility: "Show my birthday" on/off. Also records that we
-- asked. Under-13s are always stored as hidden.
-- ---------------------------------------------------------------------
create or replace function public.set_birthday_visibility(p_show boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  text := public.firebase_uid();
  v_dob  text;
  v_show boolean;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select date_of_birth into v_dob from public.user_identity_base where uid = v_uid;
  v_show := coalesce(p_show, false)
        and coalesce(public.dob_age_years(v_dob) >= public.safe_chat_minor_age(), false);

  insert into public.birthday_prefs (uid, show_public, asked_at, updated_at)
  values (v_uid, v_show, now(), now())
  on conflict (uid) do update
     set show_public = excluded.show_public, asked_at = now(), updated_at = now();

  return jsonb_build_object('show', v_show, 'asked', true);
end;
$$;

-- ---------------------------------------------------------------------
-- list_birthdays: shown, 13+, unblocked players whose birthday is within
-- p_days (0..31) of today, plus yesterday/tomorrow slack for time zones.
--   -> [{uid, name, avatar, month, day, wishes, wished}]
-- ---------------------------------------------------------------------
create or replace function public.list_birthdays(p_days int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   text := public.firebase_uid();
  v_today date := public._birthday_today();
  v_days  int  := least(greatest(coalesce(p_days, 7), 0), 31);
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'uid', x.uid, 'name', x.name, 'avatar', x.avatar, 'month', x.m, 'day', x.d,
             'wishes', (select count(*) from public.birthday_wishes w where w.to_uid = x.uid and w.year = x.y),
             'wished', exists (select 1 from public.birthday_wishes w
                                where w.from_uid = v_uid and w.to_uid = x.uid and w.year = x.y))
           order by x.until, x.name)
      from (
        select b.uid, coalesce(b.display_name, 'Player') as name, b.avatar,
               md[1] as m, md[2] as d,
               public._birthday_days_from(md[1], md[2], v_today - 1) as until,
               extract(year from (v_today - 1 + public._birthday_days_from(md[1], md[2], v_today - 1)))::int as y
          from public.birthday_prefs p
          join public.user_identity_base b on b.uid = p.uid
          cross join lateral (select public._birthday_md(b.date_of_birth) as md) z
         where p.show_public
           and z.md is not null
           and public._birthday_public_ok(p.show_public, b.date_of_birth)
           and not public._birthday_blocked(v_uid, b.uid)
           and public._birthday_days_from(md[1], md[2], v_today - 1) <= v_days + 2
         order by 6, 2
         limit 200
      ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- get_public_birthday: {month, day} for one profile, or NULL.
-- ---------------------------------------------------------------------
create or replace function public.get_public_birthday(p_uid text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid text := public.firebase_uid();
  v_dob text;
  v_show boolean;
  v_md  int[];
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_uid is null then return null; end if;

  select b.date_of_birth, p.show_public into v_dob, v_show
    from public.user_identity_base b
    left join public.birthday_prefs p on p.uid = b.uid
   where b.uid = p_uid;

  if p_uid <> v_uid then
    if not public._birthday_public_ok(v_show, v_dob) or public._birthday_blocked(v_uid, p_uid) then
      return null;
    end if;
  end if;
  v_md := public._birthday_md(v_dob);
  if v_md is null then return null; end if;
  return jsonb_build_object('month', v_md[1], 'day', v_md[2]);
end;
$$;

-- ---------------------------------------------------------------------
-- send_birthday_wish: one fixed wish per sender per birthday.
--   -> {wishes: total wishes the player has for this birthday}
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
       where from_uid = v_uid and created_at > now() - interval '1 day') >= 50 then
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
-- birthday_push_batch (service role only, for functions/notifyBirthdays.js):
-- claims up to p_limit players whose birthday is TODAY (UTC) and who have
-- not had this year's birthday push, and returns their uids. Claiming marks
-- them, so a crashed run never pushes anyone twice.
-- ---------------------------------------------------------------------
create or replace function public.birthday_push_batch(p_limit int)
returns setof text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public._birthday_today();
  v_year  int  := extract(year from v_today)::int;
begin
  return query
  with due as (
    select b.uid
      from public.user_identity_base b
      cross join lateral (select public._birthday_md(b.date_of_birth) as md) z
     where z.md is not null
       and public._birthday_on(v_year, z.md[1], z.md[2]) = v_today
       and (b.created_at_ms is null
            or b.created_at_ms <= extract(epoch from now()) * 1000 - 30::bigint * 86400000)
       and not exists (select 1 from public.birthday_pushes s where s.uid = b.uid and s.year = v_year)
     limit least(greatest(coalesce(p_limit, 500), 1), 2000)
  ), claimed as (
    insert into public.birthday_pushes (uid, year)
    select uid, v_year from due
    on conflict do nothing
    returning uid
  )
  select uid from claimed;
end;
$$;

-- ---------------------------------------------------------------------
-- Grants: client RPCs for signed-in players; the batch for the server only.
-- ---------------------------------------------------------------------
revoke all on function public.get_my_birthday() from public, anon;
revoke all on function public.set_birthday_visibility(boolean) from public, anon;
revoke all on function public.list_birthdays(int) from public, anon;
revoke all on function public.get_public_birthday(text) from public, anon;
revoke all on function public.send_birthday_wish(text, text) from public, anon;
grant execute on function public.get_my_birthday() to authenticated;
grant execute on function public.set_birthday_visibility(boolean) to authenticated;
grant execute on function public.list_birthdays(int) to authenticated;
grant execute on function public.get_public_birthday(text) to authenticated;
grant execute on function public.send_birthday_wish(text, text) to authenticated;
revoke all on function public.birthday_push_batch(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- claim_birthday_gift: the stars gift (Blox). -> { stars }
-- ---------------------------------------------------------------------
create or replace function public.claim_birthday_gift()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid  text := public.firebase_uid();
  v_year int;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  v_year := public._birthday_gift_year(v_uid);
  if v_year is null then
    raise exception 'birthday gift not available' using errcode = 'P0001';
  end if;
  insert into public.birthday_gifts (uid, year) values (v_uid, v_year)
  on conflict (uid, year) do nothing;
  if not found then
    raise exception 'birthday gift not available' using errcode = 'P0001';
  end if;
  return jsonb_build_object('stars', 15);
end;
$$;
revoke all on function public.claim_birthday_gift() from public, anon;
grant execute on function public.claim_birthday_gift() to authenticated;

-- ===== from Adopt Me 050 (shown by default, one edit, key index) =====
create table if not exists public.birthday_edits (
  uid        text primary key,
  old_dob    text not null,
  new_dob    text not null,
  edited_at  timestamptz not null default now()
);
alter table public.birthday_edits enable row level security;
revoke all on table public.birthday_edits from anon, authenticated;

-- ---------------------------------------------------------------------
-- month * 100 + day ("2010-10-07" -> 1007), or NULL. Immutable, for the
-- index below.
-- ---------------------------------------------------------------------
create or replace function public._birthday_key(p_dob text)
returns int
language sql
immutable
set search_path = public
as $$
  select case when md is null then null else md[1] * 100 + md[2] end
    from (select public._birthday_md(p_dob) as md) z;
$$;
revoke all on function public._birthday_key(text) from public, anon, authenticated;

create index if not exists user_identity_base_birthday_key_idx
  on public.user_identity_base (public._birthday_key(date_of_birth));

-- ---------------------------------------------------------------------
-- Shown unless the player chose Hide (NULL = no choice = shown), and only
-- if 13 or older. get_public_birthday and send_birthday_wish use this.
-- ---------------------------------------------------------------------
create or replace function public._birthday_public_ok(p_show boolean, p_dob text)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(p_show, true)
     and coalesce(public.dob_age_years(p_dob) >= public.safe_chat_minor_age(), false);
$$;

-- ---------------------------------------------------------------------
-- get_my_birthday: as 049, plus show defaults to true and canEdit.
-- ---------------------------------------------------------------------
create or replace function public.get_my_birthday()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    text := public.firebase_uid();
  v_dob    text;
  v_md     int[];
  v_minor  boolean;
  p        public.birthday_prefs;
  v_near   date;
  v_year   int;
  v_gift   int;
  v_opened boolean := false;
  v_count  int := 0;
  v_wishes jsonb := '[]'::jsonb;
  v_can_edit boolean;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  v_can_edit := not exists (select 1 from public.birthday_edits where uid = v_uid);
  select date_of_birth into v_dob from public.user_identity_base where uid = v_uid;
  v_md := public._birthday_md(v_dob);
  if v_md is null then
    return jsonb_build_object('month', null, 'day', null, 'show', false, 'asked', false, 'minor', false,
      'giftReady', false, 'giftOpened', false, 'wishCount', 0, 'wishes', '[]'::jsonb, 'canEdit', false);
  end if;

  v_minor := coalesce(public.dob_age_years(v_dob) < public.safe_chat_minor_age(), false);
  select * into p from public.birthday_prefs where uid = v_uid;

  v_near := public._birthday_near(v_md[1], v_md[2], public._birthday_today());
  if v_near is not null then
    v_year := extract(year from v_near)::int;
    v_opened := exists (select 1 from public.birthday_gifts where uid = v_uid and year = v_year);
    select count(*) into v_count from public.birthday_wishes where to_uid = v_uid and year = v_year;
    select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(i.display_name, 'Player'), 'avatar', i.avatar,
                                                 'template', w.template) order by w.created_at desc), '[]'::jsonb)
      into v_wishes
      from (select * from public.birthday_wishes
             where to_uid = v_uid and year = v_year
             order by created_at desc limit 50) w
      left join public.user_identity_base i on i.uid = w.from_uid;
  end if;
  v_gift := public._birthday_gift_year(v_uid);

  return jsonb_build_object(
    'month', v_md[1], 'day', v_md[2],
    'show', coalesce(p.show_public, true) and not v_minor,            -- 050: on by default
    'asked', p.asked_at is not null,
    'minor', v_minor,
    'giftReady', v_gift is not null and not exists (select 1 from public.birthday_gifts where uid = v_uid and year = v_gift),
    'giftOpened', v_opened,
    'wishCount', v_count,
    'wishes', v_wishes,
    'canEdit', v_can_edit                                              -- 050
  );
end;
$$;

-- ---------------------------------------------------------------------
-- list_birthdays: everyone 13+ who has not hidden their birthday, active in
-- the last 30 days, unblocked, birthday within p_days (0..31) of today with
-- a day of slack either side for time zones. Soonest first, then the most
-- recently active.   -> [{uid, name, avatar, month, day, wishes, wished}]
-- ---------------------------------------------------------------------
create or replace function public.list_birthdays(p_days int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    text := public.firebase_uid();
  v_today  date := public._birthday_today();
  v_days   int  := least(greatest(coalesce(p_days, 7), 0), 31);
  v_keys   int[] := '{}';
  v_d      date;
  v_active bigint := (extract(epoch from now()) * 1000)::bigint - 30::bigint * 86400000;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  -- The month/day keys of every date from yesterday to today + days + 1.
  -- 29 Feb birthdays are celebrated on 28 Feb in non-leap years.
  for v_d in select generate_series(v_today - 1, v_today + v_days + 1, interval '1 day')::date loop
    v_keys := v_keys || (extract(month from v_d)::int * 100 + extract(day from v_d)::int);
    if extract(month from v_d) = 2 and extract(day from v_d) = 28
       and extract(day from (v_d + 1)) = 1 then
      v_keys := v_keys || 229;
    end if;
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'uid', x.uid, 'name', x.name, 'avatar', x.avatar, 'month', x.m, 'day', x.d,
             'wishes', (select count(*) from public.birthday_wishes w where w.to_uid = x.uid and w.year = x.y),
             'wished', exists (select 1 from public.birthday_wishes w
                                where w.from_uid = v_uid and w.to_uid = x.uid and w.year = x.y))
           order by x.until, x.active desc)
      from (
        select b.uid, coalesce(b.display_name, 'Player') as name, b.avatar,
               z.md[1] as m, z.md[2] as d, b.last_activity_ms as active,
               public._birthday_days_from(z.md[1], z.md[2], v_today - 1) as until,
               extract(year from (v_today - 1 + public._birthday_days_from(z.md[1], z.md[2], v_today - 1)))::int as y
          from public.user_identity_base b
          left join public.birthday_prefs p on p.uid = b.uid
          cross join lateral (select public._birthday_md(b.date_of_birth) as md) z
         where public._birthday_key(b.date_of_birth) = any(v_keys)
           and z.md is not null
           and b.last_activity_ms > v_active
           and public._birthday_public_ok(p.show_public, b.date_of_birth)
           and not public._birthday_blocked(v_uid, b.uid)
           and public._birthday_days_from(z.md[1], z.md[2], v_today - 1) <= v_days + 2
         order by until, active desc
         limit 200
      ) x
  ), '[]'::jsonb);
end;
$$;

-- ===== from Adopt Me 051 (birthday_home, wish pushes) =====
create table if not exists public.birthday_wish_pushes (
  uid          text not null,
  year         int  not null,
  first_at     timestamptz not null default now(),
  first_count  int  not null,           -- wishes when the first push went out
  summary_at   timestamptz,
  primary key (uid, year)
);
alter table public.birthday_wish_pushes enable row level security;
revoke all on table public.birthday_wish_pushes from anon, authenticated;
create index if not exists birthday_wishes_created_idx on public.birthday_wishes (created_at);

-- ---------------------------------------------------------------------
-- birthday_home: get_my_birthday() + today: [[uid, month, day], ...]
-- ---------------------------------------------------------------------
create or replace function public.birthday_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    text := public.firebase_uid();
  v_today  date := public._birthday_today();
  v_keys   int[] := '{}';
  v_d      date;
  v_active bigint := (extract(epoch from now()) * 1000)::bigint - 30::bigint * 86400000;
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

  return public.get_my_birthday() || jsonb_build_object('today', coalesce((
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
-- birthday_wish_push_batch (service role only):
--   -> rows {kind 'first'|'summary', uid, from_name, wishes}
-- ---------------------------------------------------------------------
create or replace function public.birthday_wish_push_batch(p_limit int)
returns table (kind text, uid text, from_name text, wishes int)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 500), 1), 2000);
begin
  -- 1. First wish of a birthday: claim, then report who sent it.
  return query
  with fresh as (
    select w.to_uid, w.year, count(*)::int as n, min(w.created_at) as first_at
      from public.birthday_wishes w
     where w.created_at > now() - interval '2 days'
       and not exists (select 1 from public.birthday_wish_pushes s where s.uid = w.to_uid and s.year = w.year)
     group by w.to_uid, w.year
     limit v_limit
  ), claimed as (
    insert into public.birthday_wish_pushes (uid, year, first_count)
    select to_uid, year, n from fresh
    on conflict do nothing
    returning birthday_wish_pushes.uid, birthday_wish_pushes.year, birthday_wish_pushes.first_count
  )
  select 'first'::text, c.uid,
         coalesce((select i.display_name
                     from public.birthday_wishes w
                     left join public.user_identity_base i on i.uid = w.from_uid
                    where w.to_uid = c.uid and w.year = c.year
                    order by w.created_at limit 1), 'Someone'),
         c.first_count
    from claimed c;

  -- 2. Summary, 8 hours after the first push, only if more wishes came in.
  return query
  with due as (
    select s.uid, s.year, (select count(*)::int from public.birthday_wishes w
                            where w.to_uid = s.uid and w.year = s.year) as n
      from public.birthday_wish_pushes s
     where s.summary_at is null
       and s.first_at <= now() - interval '8 hours'
       and s.first_at > now() - interval '2 days'
     limit v_limit
  ), claimed as (
    update public.birthday_wish_pushes s
       set summary_at = now()
      from due
     where s.uid = due.uid and s.year = due.year and s.summary_at is null
       and due.n > s.first_count
    returning s.uid, due.n
  )
  select 'summary'::text, c.uid, null::text, c.n from claimed c;
end;
$$;
revoke all on function public.birthday_wish_push_batch(int) from public, anon, authenticated;
