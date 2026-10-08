-- =====================================================================
-- 038_birthday_emails.sql  (Blox Fruits, 2026-10-08; port of Adopt Me 055)
-- Birthday EMAIL, owner's call: one email on the day to each player whose
-- birthday it is, nothing else. Sent through Brevo by the
-- notifyBirthdayEmails Cloud Function, which also skips anyone who turned
-- email off (RTDB email_prefs/{uid}.optIn === false) or has no address.
--
--   birthday_email_batch(p_limit) (service role only): claims up to p_limit
--   players whose birthday is TODAY (UTC) and who are 13 or older, once per
--   birthday year, and returns { r_uid, r_name, r_gift }. Claiming marks
--   them, so a retried or crashed run never emails anyone twice.
--     r_gift = the account is at least 30 days old, i.e. the once-a-year
--              15-star birthday gift is waiting (same rule as
--              _birthday_gift_year / claim_birthday_gift, 036).
--   Under-13s are never returned: no email to children, whatever else is set.
--
-- Uses 036's expression index on _birthday_key(date_of_birth). 29 Feb
-- birthdays are celebrated on 28 Feb in non-leap years, as everywhere else.
-- Run after 036. Idempotent. Old app builds never call any of this.
-- =====================================================================

create table if not exists public.birthday_emails (
  uid      text not null,
  year     int  not null,
  sent_at  timestamptz not null default now(),
  primary key (uid, year)
);
alter table public.birthday_emails enable row level security;
revoke all on table public.birthday_emails from anon, authenticated;

create or replace function public.birthday_email_batch(p_limit int)
returns table (r_uid text, r_name text, r_gift boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today  date := public._birthday_today();
  v_year   int  := extract(year from v_today)::int;
  v_keys   int[] := array[extract(month from v_today)::int * 100 + extract(day from v_today)::int];
  v_new_ms bigint := (extract(epoch from now()) * 1000)::bigint - 30::bigint * 86400000;
begin
  -- 28 Feb in a non-leap year also celebrates 29 Feb birthdays.
  if extract(month from v_today) = 2 and extract(day from v_today) = 28
     and extract(day from (v_today + 1)) = 1 then
    v_keys := v_keys || 229;
  end if;

  return query
  with due as (
    select b.uid, b.display_name, b.created_at_ms
      from public.user_identity_base b
      cross join lateral (select public._birthday_md(b.date_of_birth) as md) z
     where public._birthday_key(b.date_of_birth) = any(v_keys)
       and z.md is not null
       and public._birthday_on(v_year, z.md[1], z.md[2]) = v_today
       and coalesce(public.dob_age_years(b.date_of_birth) >= 13, false)
       and not exists (select 1 from public.birthday_emails e
                        where e.uid = b.uid and e.year = v_year)
     limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ), claimed as (
    insert into public.birthday_emails (uid, year)
    select due.uid, v_year from due
    on conflict do nothing
    returning birthday_emails.uid
  )
  select c.uid, d.display_name, (d.created_at_ms is null or d.created_at_ms <= v_new_ms)
    from claimed c
    join due d on d.uid = c.uid;
end;
$$;

revoke all on function public.birthday_email_batch(int) from public, anon, authenticated;

-- Retention: a claim only matters within its birthday year.
select cron.schedule(
  'birthday-emails-retention',
  '37 4 2 1 *',
  $$ delete from public.birthday_emails where year < extract(year from now())::int - 1; $$
)
where not exists (select 1 from cron.job where jobname = 'birthday-emails-retention');
