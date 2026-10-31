-- 059_sea_beast_raid.sql — Sea Beast Raid: the daily community boss (2026-10-31, Phase 1 step 2)
--
-- One boss per UTC day for the whole app. Players raid it from the WebView
-- game (Code/Raid); every raid goes through functions/raid (service role),
-- which validates the damage against the loadout formula and pays bounty,
-- chest, rank-up, streak and boss-crate rewards. PRO time is NOT stored here
-- as the source of truth: the function writes RTDB users/{uid}/purchases/
-- raid_pro (title 'Pro Membership (Weekly)', expiresAt), which the app already
-- treats as Pro; pro_until below is the mirror the game shows.
--
--   raid_days     one row per day: boss, hp, raiders, kill time
--   raid_players  one row per player: bounty, rank, streak, frames, title, pro mirror, caps
--   raid_rounds   one row per raid: the ticket, what the game reported, what was paid
--
-- Nothing here is reachable by anon / authenticated: RLS on, all grants
-- revoked, every function revoked from PUBLIC, anon and authenticated.
-- The functions are the only caller (SUPABASE_SERVICE_ROLE_KEY).
--
-- Apply:  npx supabase@2.120.0 db query --linked -f supabase/059_sea_beast_raid.sql
-- Test:   node scripts/raid/test059.mjs   (PGlite, no network)
begin;

-- ---------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------
create table if not exists public.raid_days (
  day        date primary key,
  boss_id    text not null,
  hp_max     bigint not null check (hp_max > 0),
  hp_left    bigint not null check (hp_left >= 0),
  raiders    int not null default 0,          -- distinct players who started a raid
  rounds     int not null default 0,          -- raids started
  killed_at  timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.raid_days is 'Sea Beast Raid: the shared boss of each UTC day (functions/raid only)';

create table if not exists public.raid_players (
  uid               text primary key,
  bounty            bigint not null default 0,
  rank              text not null default 'rookie',
  streak            int not null default 0,
  last_raid_day     date,
  streak_reward_day date,
  frames            text[] not null default '{}',
  title             text,
  pro_until         timestamptz,              -- mirror of the RTDB raid_pro grant
  pro_week_start    date,                      -- rolling 7-day window for the rewarded-PRO cap
  pro_week_ms       bigint not null default 0,
  ad_unlocked_day   date,                      -- rewarded ad watched today → raids 2–4
  crate_day         date,                      -- boss crate claimed for this day
  raids_total       int not null default 0,
  best_dmg          bigint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.raid_players is 'Sea Beast Raid: per-player progression (functions/raid only)';

create table if not exists public.raid_rounds (
  id           bigserial primary key,
  ticket       text not null unique,          -- uuid from the function, handed to the game
  uid          text not null,
  day          date not null,
  boss_id      text not null,
  loadout      jsonb not null default '{}'::jsonb,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  dmg          bigint not null default 0,     -- what was paid (capped)
  dmg_claimed  bigint not null default 0,     -- what the game reported
  hits         int not null default 0,
  dodged       int not null default 0,
  best_combo   int not null default 0,
  ulted        int not null default 0,
  secs         int not null default 0,
  bounty       bigint not null default 0,
  chest        text,
  pro_ms       bigint not null default 0,
  valid        boolean                        -- null = never finished (abandoned)
);
comment on table public.raid_rounds is 'Sea Beast Raid: one row per raid; the ticket is the anti-replay key';
create index if not exists idx_raid_rounds_day_uid on public.raid_rounds (day, uid);
create index if not exists idx_raid_rounds_uid_open on public.raid_rounds (uid) where finished_at is null;

alter table public.raid_days    enable row level security;
alter table public.raid_players enable row level security;
alter table public.raid_rounds  enable row level security;
revoke all on table public.raid_days    from public, anon, authenticated;
revoke all on table public.raid_players from public, anon, authenticated;
revoke all on table public.raid_rounds  from public, anon, authenticated;
revoke all on sequence public.raid_rounds_id_seq from public, anon, authenticated;

-- Rank thresholds (functions/raid/logic.js RANKS): rookie 0, pirate 1M, captain 5M, warlord 20M, emperor 75M, king 250M.
create or replace function public._raid_rank(b bigint)
returns text language sql immutable as $$
  select case when b >= 250000000 then 'king' when b >= 75000000 then 'emperor' when b >= 20000000 then 'warlord'
              when b >= 5000000 then 'captain' when b >= 1000000 then 'pirate' else 'rookie' end;
$$;

-- ---------------------------------------------------------------------
-- json shapes
-- ---------------------------------------------------------------------
create or replace function public._raid_day_json(d public.raid_days)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'day', to_char(d.day, 'YYYY-MM-DD'), 'bossId', d.boss_id, 'hpMax', d.hp_max, 'hpLeft', d.hp_left,
    'raiders', d.raiders, 'rounds', d.rounds,
    'killed', d.killed_at is not null,
    'killedAt', case when d.killed_at is null then null else (extract(epoch from d.killed_at) * 1000)::bigint end
  );
$$;

create or replace function public._raid_player_json(p public.raid_players)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'uid', p.uid, 'bounty', p.bounty, 'rank', p.rank, 'streak', p.streak,
    'lastRaidDay', to_char(p.last_raid_day, 'YYYY-MM-DD'),
    'streakRewardDay', to_char(p.streak_reward_day, 'YYYY-MM-DD'),
    'frames', to_jsonb(p.frames), 'title', p.title,
    'proUntil', case when p.pro_until is null then 0 else (extract(epoch from p.pro_until) * 1000)::bigint end,
    'proWeekStart', to_char(p.pro_week_start, 'YYYY-MM-DD'), 'proWeekMs', p.pro_week_ms,
    'adUnlockedDay', to_char(p.ad_unlocked_day, 'YYYY-MM-DD'),
    'crateDay', to_char(p.crate_day, 'YYYY-MM-DD'),
    'raidsTotal', p.raids_total, 'bestDmg', p.best_dmg
  );
$$;

-- ---------------------------------------------------------------------
-- raid_state: today's boss (created on first call), the player (created on
-- first call), raids started today and the player's damage share today.
-- ---------------------------------------------------------------------
create or replace function public.raid_state(p_uid text, p_day date, p_boss text, p_hp_max bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.raid_days;
  p public.raid_players;
  v_used int;
  v_share bigint;
  v_rounds_today int;
begin
  insert into public.raid_days (day, boss_id, hp_max, hp_left)
  values (p_day, p_boss, p_hp_max, p_hp_max)
  on conflict (day) do nothing;
  select * into d from public.raid_days where day = p_day;

  insert into public.raid_players (uid) values (p_uid) on conflict (uid) do nothing;
  select * into p from public.raid_players where uid = p_uid;

  select count(*), coalesce(sum(dmg), 0) into v_used, v_share
    from public.raid_rounds where uid = p_uid and day = p_day;
  v_rounds_today := v_used;

  return jsonb_build_object(
    'day', public._raid_day_json(d),
    'player', public._raid_player_json(p),
    'raidsUsed', v_used,
    'share', v_share,
    'hasRoundToday', v_rounds_today > 0
  );
end
$$;

-- Yesterday's raiders, for the boss HP formula (0 when there was no day row).
create or replace function public.raid_prev_raiders(p_day date)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select raiders from public.raid_days where day = p_day - 1), 0);
$$;

-- ---------------------------------------------------------------------
-- raid_round_open: hand out a ticket. Any older open round of this player
-- is abandoned (counts as used, pays nothing). p_max = raids allowed today.
-- ---------------------------------------------------------------------
create or replace function public.raid_round_open(p_uid text, p_day date, p_boss text, p_ticket text, p_loadout jsonb, p_max int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_used int;
  v_first boolean;
begin
  perform 1 from public.raid_players where uid = p_uid for update;
  if not found then
    insert into public.raid_players (uid) values (p_uid) on conflict (uid) do nothing;
  end if;

  update public.raid_rounds set finished_at = now(), valid = false
   where uid = p_uid and finished_at is null;

  select count(*) into v_used from public.raid_rounds where uid = p_uid and day = p_day;
  if v_used >= p_max then
    return jsonb_build_object('error', 'capped', 'raidsUsed', v_used);
  end if;
  v_first := v_used = 0;

  insert into public.raid_rounds (ticket, uid, day, boss_id, loadout)
  values (p_ticket, p_uid, p_day, p_boss, coalesce(p_loadout, '{}'::jsonb));

  update public.raid_days
     set rounds = rounds + 1,
         raiders = raiders + case when v_first then 1 else 0 end
   where day = p_day;

  return jsonb_build_object('ticket', p_ticket, 'raidsUsed', v_used + 1);
end
$$;

-- ---------------------------------------------------------------------
-- raid_commit: close the ticket (pays once), take the damage off the boss
-- atomically, write the player's progression. The reward numbers are
-- computed by functions/raid/logic.js from the player row read in the same
-- request; this only persists them. Returns the fresh day + player,
-- killedNow (this round took the boss to 0) and the player's share today.
-- ---------------------------------------------------------------------
create or replace function public.raid_commit(
  p_uid text, p_ticket text,
  p_dmg bigint, p_dmg_claimed bigint, p_valid boolean,
  p_hits int, p_dodged int, p_best int, p_ulted int, p_secs int,
  p_bounty bigint, p_chest text, p_pro_ms bigint,
  p_rank text, p_streak int, p_last_raid_day date, p_streak_reward_day date,
  p_pro_until timestamptz, p_pro_week_start date, p_pro_week_ms bigint
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.raid_rounds;
  d public.raid_days;
  p public.raid_players;
  v_was_alive boolean;
  v_share bigint;
begin
  update public.raid_rounds
     set finished_at = now(), dmg = p_dmg, dmg_claimed = p_dmg_claimed, valid = p_valid,
         hits = p_hits, dodged = p_dodged, best_combo = p_best, ulted = p_ulted, secs = p_secs,
         bounty = p_bounty, chest = p_chest, pro_ms = p_pro_ms
   where ticket = p_ticket and uid = p_uid and finished_at is null
  returning * into r;
  if not found then
    return jsonb_build_object('error', 'no_round');
  end if;

  select (killed_at is null) into v_was_alive from public.raid_days where day = r.day for update;
  update public.raid_days
     set hp_left = greatest(0, hp_left - p_dmg),
         killed_at = case when killed_at is null and hp_left - p_dmg <= 0 then now() else killed_at end
   where day = r.day
  returning * into d;

  update public.raid_players
     set bounty = bounty + p_bounty,
         rank = coalesce(p_rank, rank),
         streak = coalesce(p_streak, streak),
         last_raid_day = coalesce(p_last_raid_day, last_raid_day),
         streak_reward_day = coalesce(p_streak_reward_day, streak_reward_day),
         pro_until = coalesce(p_pro_until, pro_until),
         pro_week_start = coalesce(p_pro_week_start, pro_week_start),
         pro_week_ms = coalesce(p_pro_week_ms, pro_week_ms),
         raids_total = raids_total + 1,
         best_dmg = greatest(best_dmg, p_dmg),
         updated_at = now()
   where uid = p_uid
  returning * into p;

  select coalesce(sum(dmg), 0) into v_share from public.raid_rounds where uid = p_uid and day = r.day;

  return jsonb_build_object(
    'day', public._raid_day_json(d),
    'player', public._raid_player_json(p),
    'killedNow', v_was_alive and d.killed_at is not null,
    'share', v_share
  );
end
$$;

-- ---------------------------------------------------------------------
-- raid_crate_claim: the boss crate, once per player per day, only when the
-- day's boss is dead and the player raided that day. Frame, title and the
-- (cap-adjusted) PRO extension are decided by the function and persisted
-- here; the RTDB writes follow in the same request.
-- ---------------------------------------------------------------------
create or replace function public.raid_crate_claim(
  p_uid text, p_day date, p_frame text, p_title text,
  p_pro_until timestamptz, p_pro_week_start date, p_pro_week_ms bigint, p_bounty bigint
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.raid_days;
  p public.raid_players;
begin
  select * into d from public.raid_days where day = p_day;
  if not found or d.killed_at is null then
    return jsonb_build_object('error', 'alive');
  end if;
  if not exists (select 1 from public.raid_rounds where uid = p_uid and day = p_day) then
    return jsonb_build_object('error', 'no_round');
  end if;
  select * into p from public.raid_players where uid = p_uid for update;
  if not found then
    return jsonb_build_object('error', 'no_round');
  end if;
  if p.crate_day = p_day then
    return jsonb_build_object('error', 'claimed');
  end if;

  update public.raid_players
     set crate_day = p_day,
         bounty = bounty + coalesce(p_bounty, 0),
         rank = case when coalesce(p_bounty, 0) > 0 then public._raid_rank(bounty + p_bounty) else rank end,
         frames = case when p_frame is not null and not (p_frame = any(frames)) then frames || p_frame else frames end,
         title = coalesce(title, p_title),
         pro_until = coalesce(p_pro_until, pro_until),
         pro_week_start = coalesce(p_pro_week_start, pro_week_start),
         pro_week_ms = coalesce(p_pro_week_ms, pro_week_ms),
         updated_at = now()
   where uid = p_uid
  returning * into p;

  return jsonb_build_object('player', public._raid_player_json(p), 'frameNew', p_frame is not null and p_frame = any(p.frames));
end
$$;

-- ---------------------------------------------------------------------
-- raid_rewarded: the app saw the rewarded ad finish → raids 2–4 today.
-- ---------------------------------------------------------------------
create or replace function public.raid_rewarded(p_uid text, p_day date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.raid_players;
begin
  insert into public.raid_players (uid) values (p_uid) on conflict (uid) do nothing;
  update public.raid_players set ad_unlocked_day = p_day, updated_at = now() where uid = p_uid returning * into p;
  return jsonb_build_object('player', public._raid_player_json(p));
end
$$;

-- ---------------------------------------------------------------------
-- leaderboards. Names from user_identity_base (the users mirror); a player
-- without a mirror row shows as 'Pirate'. The function caches these 60 s.
-- ---------------------------------------------------------------------
create or replace function public.raid_leaderboard_today(p_day date, p_limit int)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_json order by value desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
             'uid', t.uid,
             'name', coalesce(nullif(u.display_name, ''), 'Pirate'),
             'value', t.value,
             'rank', coalesce(p.rank, 'rookie')) as row_json,
           t.value
      from (select uid, sum(dmg) as value
              from public.raid_rounds
             where day = p_day and valid is not null
             group by uid
             order by value desc
             limit greatest(1, least(p_limit, 100))) t
      left join public.user_identity_base u on u.uid = t.uid
      left join public.raid_players p on p.uid = t.uid
  ) s;
$$;

create or replace function public.raid_leaderboard_all(p_limit int)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_json order by value desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
             'uid', p.uid,
             'name', coalesce(nullif(u.display_name, ''), 'Pirate'),
             'value', p.bounty,
             'rank', p.rank) as row_json,
           p.bounty as value
      from (select uid, bounty, rank from public.raid_players where bounty > 0
             order by bounty desc limit greatest(1, least(p_limit, 100))) p
      left join public.user_identity_base u on u.uid = p.uid
  ) s;
$$;

-- Account deletion (mirrorUsersToSupabase deleteAllForUser) — forget the player.
create or replace function public.raid_delete_user(p_uid text)
returns void language sql security definer set search_path = public as $$
  delete from public.raid_rounds where uid = p_uid;
  delete from public.raid_players where uid = p_uid;
$$;

-- Service role only.
revoke execute on function public._raid_day_json(public.raid_days) from public, anon, authenticated;
revoke execute on function public._raid_player_json(public.raid_players) from public, anon, authenticated;
revoke execute on function public.raid_state(text, date, text, bigint) from public, anon, authenticated;
revoke execute on function public.raid_prev_raiders(date) from public, anon, authenticated;
revoke execute on function public.raid_round_open(text, date, text, text, jsonb, int) from public, anon, authenticated;
revoke execute on function public.raid_commit(text, text, bigint, bigint, boolean, int, int, int, int, int, bigint, text, bigint, text, int, date, date, timestamptz, date, bigint) from public, anon, authenticated;
revoke execute on function public.raid_crate_claim(text, date, text, text, timestamptz, date, bigint, bigint) from public, anon, authenticated;
revoke execute on function public._raid_rank(bigint) from public, anon, authenticated;
revoke execute on function public.raid_rewarded(text, date) from public, anon, authenticated;
revoke execute on function public.raid_leaderboard_today(date, int) from public, anon, authenticated;
revoke execute on function public.raid_leaderboard_all(int) from public, anon, authenticated;
revoke execute on function public.raid_delete_user(text) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
