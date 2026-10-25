-- =====================================================================
-- 057 — Fruit Cards (blox, jaimyhmanefvrijvjzxl), 2026-10-25
--
-- A free collectible card album of Blox Fruits fruits and skins
-- (FRUIT_CARDS_PLAN.md). Port of Adopt Me's Pet Cards: adoptme-jan7
-- supabase/037 + 043 + 044 + 048 merged into one file, with Blox rarities
-- and finish names:
--   rarity  common · uncommon · rare · legendary · mythical · limited (skins)
--   finish  classic · foil · awakened · holo · gilded · aura · fullart
--   fusion  4 classic -> 1 awakened, 4 awakened -> 1 aura
--
-- Rules the schema enforces:
--   * Packs are EARNED, never bought: two free packs per UTC day, up to two
--     a day for stars (stars live in RTDB and are spent by the client, the
--     same trust model as the daily star features; the cap bounds any
--     forgery), and bonus packs (7-day streak) granted server-side.
--   * The server rolls every card (random()), so collections, serial numbers
--     and scores shown on profiles can't be forged.
--   * Only cards with art on the CDN (card_catalog.hd_ready) can be pulled.
--   * Odds live in card_sets.odds and are returned to the app for display.
--
-- Fairness: new-card bias, top-tier pity (8 packs), Holo+ pity (12 packs),
-- shards from duplicates, crafting of missing Classic cards, fusion.
-- Fixed from Pet Cards: the fallback pick no longer repeats a card inside
-- one pack when the pool has another card of that rarity.
--
-- Visibility: user_cosmetics.card_score / card_count / card_showcase ride
-- along with the cosmetics row every profile already loads (no extra reads).
--
-- Cost: no realtime. cards_state when the hub opens, open_card_pack per
-- pack (1-4 a day), get_card_collection when the album opens (cached),
-- the catalogue is read once a day. Run after 056. Idempotent.
-- Signed-in players only: every function is revoked from PUBLIC/anon
-- (new functions in public default to PUBLIC; see Adopt Me 043).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.card_catalog (
  key         text primary key check (key ~ '^[a-z0-9]{1,60}$'),   -- normalized item name
  name        text not null,
  rarity      text not null check (rarity in ('common', 'uncommon', 'rare', 'legendary', 'mythical', 'limited')),
  no          int  not null unique check (no > 0),                  -- collector number; never reused
  family      text,                                                 -- 'natural' | 'beast' | 'logia' | 'skin' | 'item'
  sets        text[] not null default '{}',                         -- card_sets ids besides 'all'
  bg          text,                                                 -- art background override
  hd_ready    boolean not null default false,                       -- 1024 px art is on the CDN
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);
create index if not exists card_catalog_sets_idx on public.card_catalog using gin (sets);

create table if not exists public.card_sets (
  id          text primary key check (id ~ '^[a-z0-9_]{1,40}$'),
  kind        text not null check (kind in ('pack', 'page')),  -- pack: has its own pack; page: album page only
  theme       text not null default 'sea',
  names       jsonb not null default '{}'::jsonb,              -- fallback names {"en": "..."}; the app has i18n
  sort        int  not null default 100,
  starts_at   timestamptz,
  ends_at     timestamptz,                                     -- the PACK retires; cards stay craftable
  odds        jsonb not null default '{}'::jsonb,              -- overrides of _cards_default_odds()
  reward      jsonb not null default '{}'::jsonb,              -- {"shards":50,"frame":"...","wallpaper":"..."}
  active      boolean not null default true
);

create table if not exists public.card_collection (
  uid          text not null,
  card_key     text not null,
  finish       text not null check (finish in ('classic', 'foil', 'awakened', 'holo', 'gilded', 'aura', 'fullart')),
  count        int  not null default 1 check (count > 0),
  first_at     timestamptz not null default now(),
  best_serial  int,
  primary key (uid, card_key, finish)
);

create table if not exists public.card_wallet (
  uid           text primary key,
  shards        int  not null default 0 check (shards >= 0),
  pity_top      int  not null default 0,    -- packs since the last top-tier (Limited) card
  pity_holo     int  not null default 0,    -- packs since the last Holo-or-better
  free_day      int  not null default -1,   -- UTC day number of the last free pack
  free_count    int  not null default 0,    -- free packs opened on free_day (2 a day)
  star_day      int  not null default -1,
  star_count    int  not null default 0,    -- star packs opened on star_day
  streak        int  not null default 0,    -- consecutive days with a free pack
  bonus_packs   int  not null default 0 check (bonus_packs >= 0),
  packs_opened  int  not null default 0,
  unique_cards  int  not null default 0,
  score         int  not null default 0,
  completed     text[] not null default '{}',  -- set ids completed (rewards paid)
  updated_at    timestamptz not null default now()
);

create table if not exists public.card_serials (
  card_key     text not null,
  finish       text not null,
  last_serial  int  not null default 0,
  primary key (card_key, finish)
);

create table if not exists public.card_pulls (
  id          bigserial primary key,
  uid         text not null,
  set_id      text not null,
  card_key    text not null,
  finish      text not null,
  serial      int,
  source      text not null,
  is_new      boolean not null,
  created_at  timestamptz not null default now()
);
create index if not exists card_pulls_uid_idx on public.card_pulls (uid, created_at desc);
create index if not exists card_pulls_created_idx on public.card_pulls (created_at) where serial is null;

alter table public.card_catalog    enable row level security;
alter table public.card_sets       enable row level security;
alter table public.card_collection enable row level security;
alter table public.card_wallet     enable row level security;
alter table public.card_serials    enable row level security;
alter table public.card_pulls      enable row level security;
revoke all on table public.card_catalog    from anon, authenticated;
revoke all on table public.card_sets       from anon, authenticated;
revoke all on table public.card_collection from anon, authenticated;
revoke all on table public.card_wallet     from anon, authenticated;
revoke all on table public.card_serials    from anon, authenticated;
revoke all on table public.card_pulls      from anon, authenticated;
revoke all on sequence public.card_pulls_id_seq from anon, authenticated;

-- Profiles show the collection with the cosmetics row they already load.
alter table public.user_cosmetics add column if not exists card_score    int not null default 0;
alter table public.user_cosmetics add column if not exists card_count    int not null default 0;
alter table public.user_cosmetics add column if not exists card_showcase jsonb;

-- ---------------------------------------------------------------------
-- Rules as data (kept in step with Code/FruitCards/cardConfig.js)
-- ---------------------------------------------------------------------
create or replace function public._cards_default_odds()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'slot',   jsonb_build_object('common', 22, 'uncommon', 20, 'rare', 14, 'legendary', 20, 'mythical', 14, 'limited', 10),
    'hit',    jsonb_build_object('legendary', 40, 'mythical', 35, 'limited', 25),
    'finish', jsonb_build_object('classic', 72, 'foil', 14, 'awakened', 8, 'holo', 4,
                                 'gilded', 1.4, 'aura', 0.5, 'fullart', 0.1),
    'bias', 0.45,            -- chance a pull is taken from the player's missing cards
    'pity_top', 8,           -- a Limited in the hit slot if none in this many packs
    'pity_holo', 12          -- Holo or better if none in this many packs
  );
$$;

create or replace function public._cards_odds(p_set text)
returns jsonb language sql stable set search_path = public as $$
  select public._cards_default_odds() || coalesce((select odds from public.card_sets where id = p_set), '{}'::jsonb);
$$;

create or replace function public._cards_rarity_points(r text)
returns int language sql immutable as $$
  select case r when 'common' then 1 when 'uncommon' then 2 when 'rare' then 4
                when 'legendary' then 8 when 'mythical' then 16 when 'limited' then 24 else 0 end;
$$;

create or replace function public._cards_finish_mult(f text)
returns int language sql immutable as $$
  select case f when 'classic' then 1 when 'foil' then 2 when 'awakened' then 3 when 'holo' then 5
                when 'gilded' then 10 when 'aura' then 20 when 'fullart' then 40 else 1 end;
$$;

create or replace function public._cards_dupe_shards(r text)
returns int language sql immutable as $$
  select case r when 'common' then 5 when 'uncommon' then 10 when 'rare' then 25
                when 'legendary' then 50 when 'mythical' then 100 when 'limited' then 150 else 0 end;
$$;

create or replace function public._cards_craft_cost(r text)
returns int language sql immutable as $$
  select case r when 'common' then 40 when 'uncommon' then 80 when 'rare' then 200
                when 'legendary' then 400 when 'mythical' then 1000 when 'limited' then 1500 else null end;
$$;

create or replace function public._cards_fuse_target(f text)
returns text language sql immutable as $$
  select case f when 'classic' then 'awakened' when 'awakened' then 'aura' end;
$$;

create or replace function public._cards_today()
returns int language sql stable as $$
  select floor(extract(epoch from now()) / 86400)::int;
$$;

-- Weighted pick from a {name: weight} object.
create or replace function public._cards_weighted(p_weights jsonb)
returns text language plpgsql volatile as $$
declare
  total numeric := 0;
  r numeric;
  k text;
  w numeric;
  last_k text;
begin
  for k, w in select key, value::numeric from jsonb_each_text(p_weights) loop
    if w > 0 then total := total + w; end if;
  end loop;
  if total <= 0 then return null; end if;
  r := random()::numeric * total;
  for k, w in select key, value::numeric from jsonb_each_text(p_weights) loop
    if w > 0 then
      last_k := k;
      r := r - w;
      if r < 0 then return k; end if;
    end if;
  end loop;
  return last_k;   -- rounding at the very top of the range
end
$$;

-- Is this card in the set's pool? ('all' = every card)
create or replace function public._cards_in_set(c public.card_catalog, p_set text)
returns boolean language sql immutable as $$
  select p_set = 'all' or p_set = any(c.sets);
$$;

create or replace function public._cards_ensure_wallet(p_uid text)
returns void language sql set search_path = public as $$
  insert into public.card_wallet (uid) values (p_uid) on conflict (uid) do nothing;
$$;

-- Sets whose every pullable card the player now owns (any finish), not yet paid.
create or replace function public._cards_new_completions(p_uid text, p_keys text[])
returns text[] language plpgsql set search_path = public as $$
declare
  w public.card_wallet;
  s record;
  done text[] := '{}';
  total int;
  owned int;
begin
  select * into w from public.card_wallet where uid = p_uid;
  for s in
    select cs.id from public.card_sets cs
     where cs.active
       and not (cs.id = any(w.completed))
       and (cs.id = 'all' or exists (
             select 1 from public.card_catalog c where c.key = any(p_keys) and cs.id = any(c.sets)))
  loop
    select count(*) into total from public.card_catalog c
     where c.active and c.hd_ready and public._cards_in_set(c, s.id);
    if total = 0 then continue; end if;
    select count(distinct cc.card_key) into owned
      from public.card_collection cc
      join public.card_catalog c on c.key = cc.card_key
     where cc.uid = p_uid and c.active and c.hd_ready and public._cards_in_set(c, s.id);
    if owned >= total then done := done || s.id; end if;
  end loop;
  return done;
end
$$;

-- The card fields every RPC returns.
create or replace function public._cards_card_json(c public.card_catalog)
returns jsonb language sql immutable as $$
  select jsonb_build_object('key', c.key, 'name', c.name, 'rarity', c.rarity, 'no', c.no,
                            'family', c.family, 'sets', to_jsonb(c.sets));
$$;

-- Add one card to a collection: returns {new, newFinish, dupe, shards, serial}.
create or replace function public._cards_add(p_uid text, p_key text, p_finish text, p_set text, p_source text)
returns jsonb language plpgsql set search_path = public as $$
declare
  c public.card_catalog;
  v_had_card boolean;
  v_had_finish boolean;
  v_serial int;
  v_shards int := 0;
  v_points int := 0;
begin
  select * into c from public.card_catalog where key = p_key;
  select exists(select 1 from public.card_collection where uid = p_uid and card_key = p_key) into v_had_card;
  select exists(select 1 from public.card_collection where uid = p_uid and card_key = p_key and finish = p_finish)
    into v_had_finish;

  if p_finish in ('holo', 'gilded', 'aura', 'fullart') then
    insert into public.card_serials (card_key, finish, last_serial) values (p_key, p_finish, 1)
    on conflict (card_key, finish) do update set last_serial = public.card_serials.last_serial + 1
    returning last_serial into v_serial;
  end if;

  insert into public.card_collection (uid, card_key, finish, count, best_serial)
  values (p_uid, p_key, p_finish, 1, v_serial)
  on conflict (uid, card_key, finish) do update
    set count = public.card_collection.count + 1,
        best_serial = case when excluded.best_serial is null then public.card_collection.best_serial
                           else least(coalesce(public.card_collection.best_serial, excluded.best_serial),
                                      excluded.best_serial) end;

  if v_had_finish then
    v_shards := public._cards_dupe_shards(c.rarity) * public._cards_finish_mult(p_finish);
  else
    v_points := public._cards_rarity_points(c.rarity) * public._cards_finish_mult(p_finish);
  end if;

  update public.card_wallet
     set shards = shards + v_shards,
         score = score + v_points,
         unique_cards = unique_cards + case when v_had_card then 0 else 1 end,
         updated_at = now()
   where uid = p_uid;

  insert into public.card_pulls (uid, set_id, card_key, finish, serial, source, is_new)
  values (p_uid, p_set, p_key, p_finish, v_serial, p_source, not v_had_card);

  return public._cards_card_json(c) || jsonb_build_object(
    'finish', p_finish, 'serial', v_serial,
    'new', not v_had_card, 'newFinish', v_had_card and not v_had_finish,
    'dupe', v_had_finish, 'shards', v_shards
  );
end
$$;

-- Pay set rewards, mirror the profile numbers. Returns the newly completed sets.
create or replace function public._cards_settle(p_uid text, p_keys text[])
returns jsonb language plpgsql set search_path = public as $$
declare
  v_done text[];
  v_shards int := 0;
  w public.card_wallet;
begin
  v_done := public._cards_new_completions(p_uid, p_keys);
  if array_length(v_done, 1) > 0 then
    select coalesce(sum(coalesce((reward ->> 'shards')::int, 0)), 0) into v_shards
      from public.card_sets where id = any(v_done);
    update public.card_wallet
       set completed = completed || v_done, shards = shards + v_shards, updated_at = now()
     where uid = p_uid;
  end if;

  select * into w from public.card_wallet where uid = p_uid;
  insert into public.user_cosmetics (uid, card_score, card_count)
  values (p_uid, w.score, w.unique_cards)
  on conflict (uid) do update set card_score = excluded.card_score, card_count = excluded.card_count;

  return jsonb_build_object('completed', to_jsonb(coalesce(v_done, '{}'::text[])), 'rewardShards', v_shards);
end
$$;

create or replace function public._cards_wallet_json(w public.card_wallet)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'shards', w.shards, 'bonusPacks', w.bonus_packs, 'streak', w.streak,
    'freeReady', w.free_day < public._cards_today() or w.free_count < 2,
    'freeLeft', case when w.free_day = public._cards_today() then greatest(0, 2 - w.free_count) else 2 end,
    'starPacksLeft', greatest(0, 2 - case when w.star_day = public._cards_today() then w.star_count else 0 end),
    'packsOpened', w.packs_opened, 'uniqueCards', w.unique_cards, 'score', w.score,
    'completed', to_jsonb(w.completed),
    'pityTop', w.pity_top, 'pityHolo', w.pity_holo
  );
$$;

-- ---------------------------------------------------------------------
-- cards_state: the Card Hub. Wallet, packs available, sets and odds.
-- ---------------------------------------------------------------------
create or replace function public.cards_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := public.firebase_uid();
  w public.card_wallet;
  v_sets jsonb;
  v_version text;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  perform public._cards_ensure_wallet(v_uid);
  select * into w from public.card_wallet where uid = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'kind', s.kind, 'theme', s.theme, 'names', s.names, 'sort', s.sort,
           'startsAt', s.starts_at, 'endsAt', s.ends_at, 'reward', s.reward,
           'odds', public._cards_odds(s.id),
           'open', s.kind = 'pack' and (s.starts_at is null or s.starts_at <= now())
                                   and (s.ends_at is null or s.ends_at > now()),
           'total', (select count(*) from public.card_catalog c
                      where c.active and c.hd_ready and public._cards_in_set(c, s.id))
         ) order by s.sort, s.id), '[]'::jsonb)
    into v_sets
    from public.card_sets s
   where s.active;

  select coalesce(max(updated_at)::text, '0') || ':' || count(*) into v_version
    from public.card_catalog;

  return jsonb_build_object(
    'wallet', public._cards_wallet_json(w),
    'sets', v_sets,
    'catalogVersion', v_version,
    'now', now(),
    'nextFreeAt', to_timestamp((public._cards_today() + 1) * 86400)
  );
end
$$;

-- ---------------------------------------------------------------------
-- card_catalog_list: the catalogue (the app caches it by catalogVersion).
--   rows: [key, name, rarity, no, family, sets, bg]
-- ---------------------------------------------------------------------
create or replace function public.card_catalog_list()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_array(c.key, c.name, c.rarity, c.no, c.family, to_jsonb(c.sets), c.bg)
                            order by c.no), '[]'::jsonb)
    from public.card_catalog c
   where c.active and c.hd_ready;
$$;

-- ---------------------------------------------------------------------
-- open_card_pack: check the source, roll 3 cards, store them.
--   p_source: 'free' (2 a day) | 'stars' (2 a day) | 'bonus'
-- ---------------------------------------------------------------------
create or replace function public.open_card_pack(p_set text, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     text := public.firebase_uid();
  s         public.card_sets;
  w         public.card_wallet;
  v_today   int := public._cards_today();
  v_odds    jsonb;
  v_streak_bonus boolean := false;
  v_slot    int;
  v_rarity  text;
  v_finish  text;
  v_key     text;
  v_got_top  boolean := false;
  v_got_holo boolean := false;
  v_cards   jsonb := '[]'::jsonb;
  v_keys    text[] := '{}';
  v_tries   int;
  v_order   text[];
  v_settle  jsonb;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_source not in ('free', 'stars', 'bonus') then
    raise exception 'bad source' using errcode = '22023';
  end if;

  select * into s from public.card_sets where id = p_set and active and kind = 'pack';
  if not found or (s.starts_at is not null and s.starts_at > now())
               or (s.ends_at is not null and s.ends_at <= now()) then
    raise exception 'pack not available' using errcode = 'P0001';
  end if;

  perform public._cards_ensure_wallet(v_uid);
  select * into w from public.card_wallet where uid = v_uid for update;   -- one pack at a time

  if p_source = 'free' then
    if w.free_day >= v_today and w.free_count >= 2 then
      raise exception 'free pack already opened today' using errcode = 'P0001';
    end if;
    if w.free_day < v_today then
      -- First free pack of the day. The streak counts days, not packs.
      w.streak := case when w.free_day = v_today - 1 then w.streak + 1 else 1 end;
      w.free_day := v_today;
      w.free_count := 1;
      if w.streak % 7 = 0 then
        w.bonus_packs := w.bonus_packs + 1;
        v_streak_bonus := true;
      end if;
    else
      w.free_count := w.free_count + 1;
    end if;
  elsif p_source = 'stars' then
    if w.star_day <> v_today then
      w.star_day := v_today;
      w.star_count := 0;
    end if;
    if w.star_count >= 2 then
      raise exception 'star pack limit reached' using errcode = 'P0001';
    end if;
    w.star_count := w.star_count + 1;
  else
    if w.bonus_packs <= 0 then
      raise exception 'no bonus packs' using errcode = 'P0001';
    end if;
    w.bonus_packs := w.bonus_packs - 1;
  end if;

  update public.card_wallet
     set streak = w.streak, free_day = w.free_day, free_count = w.free_count, bonus_packs = w.bonus_packs,
         star_day = w.star_day, star_count = w.star_count,
         packs_opened = packs_opened + 1, updated_at = now()
   where uid = v_uid;

  v_odds := public._cards_odds(p_set);

  for v_slot in 1..3 loop
    -- Rarity: slot 3 is the hit slot; top-tier pity forces it.
    if v_slot = 3 and not v_got_top and w.pity_top + 1 >= (v_odds ->> 'pity_top')::int then
      v_rarity := 'limited';
    else
      v_rarity := public._cards_weighted(case when v_slot = 3 then v_odds -> 'hit' else v_odds -> 'slot' end);
    end if;

    -- If the set has no pullable card of that rarity, walk to the nearest one.
    v_order := case v_rarity
      when 'common'    then array['common', 'uncommon', 'rare', 'legendary', 'mythical', 'limited']
      when 'uncommon'  then array['uncommon', 'common', 'rare', 'legendary', 'mythical', 'limited']
      when 'rare'      then array['rare', 'uncommon', 'legendary', 'common', 'mythical', 'limited']
      when 'legendary' then array['legendary', 'rare', 'mythical', 'uncommon', 'limited', 'common']
      when 'mythical'  then array['mythical', 'legendary', 'limited', 'rare', 'uncommon', 'common']
      else                  array['limited', 'mythical', 'legendary', 'rare', 'uncommon', 'common'] end;
    v_key := null;
    for v_tries in 1..6 loop
      v_rarity := v_order[v_tries];
      -- New-card bias: pick from the cards the player doesn't own yet.
      if random() < (v_odds ->> 'bias')::numeric then
        select c.key into v_key from public.card_catalog c
         where c.active and c.hd_ready and c.rarity = v_rarity and public._cards_in_set(c, p_set)
           and not (c.key = any(v_keys))
           and not exists (select 1 from public.card_collection cc where cc.uid = v_uid and cc.card_key = c.key)
         order by random() limit 1;
      end if;
      if v_key is null then
        -- Prefer a card not already in this pack (Pet Cards could repeat one here).
        select c.key into v_key from public.card_catalog c
         where c.active and c.hd_ready and c.rarity = v_rarity and public._cards_in_set(c, p_set)
         order by (c.key = any(v_keys)), random() limit 1;
      end if;
      exit when v_key is not null;
    end loop;
    if v_key is null then
      raise exception 'no cards in this pack yet' using errcode = 'P0001';
    end if;
    if v_rarity = 'limited' then v_got_top := true; end if;

    -- Finish: Holo+ pity forces at least Holo on the hit slot.
    if v_slot = 3 and not v_got_holo and w.pity_holo + 1 >= (v_odds ->> 'pity_holo')::int then
      v_finish := public._cards_weighted((v_odds -> 'finish') - 'classic' - 'foil' - 'awakened');
    else
      v_finish := public._cards_weighted(v_odds -> 'finish');
    end if;
    if v_finish in ('holo', 'gilded', 'aura', 'fullart') then v_got_holo := true; end if;

    v_cards := v_cards || public._cards_add(v_uid, v_key, v_finish, p_set, p_source);
    v_keys := v_keys || v_key;
  end loop;

  update public.card_wallet
     set pity_top  = case when v_got_top  then 0 else pity_top + 1 end,
         pity_holo = case when v_got_holo then 0 else pity_holo + 1 end
   where uid = v_uid;

  v_settle := public._cards_settle(v_uid, v_keys);
  select * into w from public.card_wallet where uid = v_uid;

  return jsonb_build_object(
    'cards', v_cards,
    'wallet', public._cards_wallet_json(w),
    'streakBonus', v_streak_bonus,
    'completed', v_settle -> 'completed',
    'rewardShards', v_settle -> 'rewardShards'
  );
end
$$;

-- ---------------------------------------------------------------------
-- craft_card: shards -> a Classic copy of a card the player doesn't own.
-- ---------------------------------------------------------------------
create or replace function public.craft_card(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  text := public.firebase_uid();
  c      public.card_catalog;
  w      public.card_wallet;
  v_cost int;
  v_card jsonb;
  v_settle jsonb;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select * into c from public.card_catalog where key = p_key and active and hd_ready;
  if not found then
    raise exception 'unknown card' using errcode = '22023';
  end if;

  perform public._cards_ensure_wallet(v_uid);
  select * into w from public.card_wallet where uid = v_uid for update;
  if exists (select 1 from public.card_collection where uid = v_uid and card_key = p_key) then
    raise exception 'already owned' using errcode = 'P0001';
  end if;
  v_cost := public._cards_craft_cost(c.rarity);
  if w.shards < v_cost then
    raise exception 'not enough shards' using errcode = 'P0001';
  end if;
  update public.card_wallet set shards = shards - v_cost where uid = v_uid;

  v_card := public._cards_add(v_uid, p_key, 'classic', 'craft', 'craft');
  v_settle := public._cards_settle(v_uid, array[p_key]);
  select * into w from public.card_wallet where uid = v_uid;
  return jsonb_build_object('card', v_card, 'wallet', public._cards_wallet_json(w),
                            'completed', v_settle -> 'completed', 'rewardShards', v_settle -> 'rewardShards');
end
$$;

-- ---------------------------------------------------------------------
-- fuse_card: 4 copies of (p_key, p_from) -> 1 copy in the next finish.
--   4 Classic -> 1 Awakened, 4 Awakened -> 1 Mythic Aura.
-- Fused cards never get a serial (serials stay a pack-only brag) and pay no
-- duplicate shards. A finish used up to 0 copies loses its points.
--   -> {"card": {key, name, …, finish, serial: null, fused: true, newFinish},
--       "left": copies of p_from still owned, "wallet": {…}}
-- ---------------------------------------------------------------------
create or replace function public.fuse_card(p_key text, p_from text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    text := public.firebase_uid();
  v_to     text := public._cards_fuse_target(p_from);
  c        public.card_catalog;
  w        public.card_wallet;
  v_have   int;
  v_left   int;
  v_had_to boolean;
  v_serial int;
  v_points int := 0;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if v_to is null then
    raise exception 'cannot fuse' using errcode = '22023';
  end if;
  select * into c from public.card_catalog where key = p_key;
  if not found then
    raise exception 'unknown card' using errcode = '22023';
  end if;

  perform public._cards_ensure_wallet(v_uid);
  -- The wallet row lock serialises one player's card changes (packs, crafts, fusions).
  select * into w from public.card_wallet where uid = v_uid for update;
  select count into v_have from public.card_collection
   where uid = v_uid and card_key = p_key and finish = p_from for update;
  if coalesce(v_have, 0) < 4 then
    raise exception 'not enough copies' using errcode = 'P0001';
  end if;

  v_left := v_have - 4;
  if v_left = 0 then
    delete from public.card_collection where uid = v_uid and card_key = p_key and finish = p_from;
    v_points := v_points - public._cards_rarity_points(c.rarity) * public._cards_finish_mult(p_from);
  else
    update public.card_collection set count = v_left
     where uid = v_uid and card_key = p_key and finish = p_from;
  end if;

  select exists(select 1 from public.card_collection where uid = v_uid and card_key = p_key and finish = v_to)
    into v_had_to;
  insert into public.card_collection (uid, card_key, finish, count) values (v_uid, p_key, v_to, 1)
  on conflict (uid, card_key, finish) do update set count = public.card_collection.count + 1
  returning best_serial into v_serial;
  if not v_had_to then
    v_points := v_points + public._cards_rarity_points(c.rarity) * public._cards_finish_mult(v_to);
  end if;

  update public.card_wallet set score = score + v_points, updated_at = now() where uid = v_uid;
  insert into public.card_pulls (uid, set_id, card_key, finish, serial, source, is_new)
  values (v_uid, 'fuse', p_key, v_to, null, 'fuse', false);

  -- A showcased copy that was used up now shows its fused card instead.
  if v_left = 0 then
    update public.user_cosmetics
       set card_showcase = (
         select jsonb_agg(case when e ->> 'k' = p_key and e ->> 'f' = p_from
                               then e || jsonb_build_object('f', v_to, 's', v_serial)
                               else e end
                          order by ord)
           from jsonb_array_elements(card_showcase) with ordinality as t(e, ord))
     where uid = v_uid
       and card_showcase @> jsonb_build_array(jsonb_build_object('k', p_key, 'f', p_from));
  end if;

  perform public._cards_settle(v_uid, array[p_key]);   -- mirrors the score onto the profile
  select * into w from public.card_wallet where uid = v_uid;
  return jsonb_build_object(
    'card', public._cards_card_json(c) || jsonb_build_object(
      'finish', v_to, 'serial', null, 'fused', true,
      'new', false, 'newFinish', not v_had_to, 'dupe', v_had_to, 'shards', 0),
    'left', v_left,
    'wallet', public._cards_wallet_json(w));
end
$$;

-- ---------------------------------------------------------------------
-- get_card_collection: compact owned list. Other players' albums are
-- readable on purpose (showing off is the point); nothing personal is in it.
--   -> {"cards": {"<key>": [["holo", 2, 42], ["classic", 1, null]]}, "score":…, "uniqueCards":…,
--       "showcase": [<set_card_showcase entries>]}
-- ---------------------------------------------------------------------
create or replace function public.get_card_collection(p_uid text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  text := public.firebase_uid();
  v_who  text;
  v_cards jsonb;
  w public.card_wallet;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  v_who := coalesce(nullif(p_uid, ''), v_uid);

  select coalesce(jsonb_object_agg(card_key, finishes), '{}'::jsonb) into v_cards
    from (select card_key,
                 jsonb_agg(jsonb_build_array(finish, count, best_serial) order by first_at) as finishes
            from public.card_collection where uid = v_who group by card_key) t;
  select * into w from public.card_wallet where uid = v_who;

  return jsonb_build_object('cards', v_cards,
                            'score', coalesce(w.score, 0), 'uniqueCards', coalesce(w.unique_cards, 0),
                            'completed', to_jsonb(coalesce(w.completed, '{}'::text[])),
                            'showcase', coalesce((select card_showcase from public.user_cosmetics where uid = v_who),
                                                 '[]'::jsonb));
end
$$;

-- ---------------------------------------------------------------------
-- set_card_showcase: up to 3 owned cards on the profile, in the given order.
--   p_cards = [{"k": "kitsune", "f": "aura"}, …]
-- Each stored entry carries the catalog fields the profile drawer needs to
-- draw the card without another read:
--   {"k", "f", "s" (best serial), "n" (name), "r" (rarity), "no", "fa" (family), "sets", "bg"}
-- Unowned pairs are dropped; a card appears once (its first finish wins).
-- ---------------------------------------------------------------------
create or replace function public.set_card_showcase(p_cards jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := public.firebase_uid();
  v_out jsonb := '[]'::jsonb;
  e jsonb;
  v_entry jsonb;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_cards) <> 'array' or jsonb_array_length(p_cards) > 3 then
    raise exception 'up to 3 cards' using errcode = '22023';
  end if;
  for e in select value from jsonb_array_elements(p_cards) loop
    if jsonb_typeof(e) <> 'object' or v_out @> jsonb_build_array(jsonb_build_object('k', e ->> 'k')) then
      continue;
    end if;
    select jsonb_build_object('k', cc.card_key, 'f', cc.finish, 's', cc.best_serial,
                              'n', c.name, 'r', c.rarity, 'no', c.no, 'fa', c.family,
                              'sets', to_jsonb(c.sets), 'bg', c.bg)
      into v_entry
      from public.card_collection cc
      join public.card_catalog c on c.key = cc.card_key
     where cc.uid = v_uid and cc.card_key = e ->> 'k' and cc.finish = e ->> 'f';
    if found then
      v_out := v_out || v_entry;
    end if;
  end loop;
  insert into public.user_cosmetics (uid, card_showcase) values (v_uid, v_out)
  on conflict (uid) do update set card_showcase = excluded.card_showcase;
  return v_out;
end
$$;

-- ---------------------------------------------------------------------
-- delete_user_cards: account deletion (service role only). Pet Cards never
-- removed card rows when an account was deleted; serial provenance in
-- card_pulls is kept, with the uid blanked.
-- ---------------------------------------------------------------------
create or replace function public.delete_user_cards(p_uid text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.card_collection where uid = p_uid;
  delete from public.card_wallet where uid = p_uid;
  delete from public.card_pulls where uid = p_uid and serial is null;
  update public.card_pulls set uid = 'deleted' where uid = p_uid;
  update public.user_cosmetics set card_score = 0, card_count = 0, card_showcase = null where uid = p_uid;
end
$$;

-- ---------------------------------------------------------------------
-- Grants: every card function is revoked from PUBLIC/anon; only the six
-- player RPCs + fuse_card are callable, and only when signed in.
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (p.proname like '\_cards\_%' or p.proname in
            ('cards_state', 'card_catalog_list', 'open_card_pack', 'craft_card', 'fuse_card',
             'get_card_collection', 'set_card_showcase', 'delete_user_cards'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

grant execute on function public.cards_state()                  to authenticated;
grant execute on function public.card_catalog_list()            to authenticated;
grant execute on function public.open_card_pack(text, text)     to authenticated;
grant execute on function public.craft_card(text)               to authenticated;
grant execute on function public.fuse_card(text, text)          to authenticated;
grant execute on function public.get_card_collection(text)      to authenticated;
grant execute on function public.set_card_showcase(jsonb)       to authenticated;

-- ---------------------------------------------------------------------
-- Sets. Membership lives in card_catalog.sets (written by
-- scripts/fruit-cards/sync-card-catalog.js from data.json types and names).
-- ---------------------------------------------------------------------
insert into public.card_sets (id, kind, theme, names, sort, odds, reward) values
  ('all', 'pack', 'sea', '{"en": "All Fruits"}', 20, '{}',
   '{"shards": 3000, "frame": "fruit_master", "back": "gold", "wallpaper": "sea"}')
on conflict (id) do nothing;

insert into public.card_sets (id, kind, theme, names, sort, reward) values
  ('natural',  'page', 'sea',    '{"en": "Natural Fruits"}',  100, '{"shards": 150, "wallpaper": "natural"}'),
  ('beast',    'page', 'beast',  '{"en": "Beast Den"}',       110, '{"shards": 150, "wallpaper": "beast"}'),
  ('logia',    'page', 'logia',  '{"en": "Elementals"}',      120, '{"shards": 150, "wallpaper": "logia"}'),
  ('mythical', 'page', 'sea',    '{"en": "Mythical Hoard"}',  130, '{"shards": 200, "frame": "mythical"}'),
  ('limited',  'page', 'skins',  '{"en": "Limited Vault"}',   140, '{"shards": 400, "frame": "limited"}'),
  ('skin_dragon',    'page', 'skins', '{"en": "Dragon Skins"}',    200, '{"shards": 50}'),
  ('skin_kitsune',   'page', 'skins', '{"en": "Kitsune Skins"}',   210, '{"shards": 50}'),
  ('skin_pain',      'page', 'skins', '{"en": "Pain Skins"}',      220, '{"shards": 50}'),
  ('skin_lightning', 'page', 'skins', '{"en": "Lightning Skins"}', 230, '{"shards": 50}'),
  ('skin_diamond',   'page', 'skins', '{"en": "Diamond Skins"}',   240, '{"shards": 50}'),
  ('skin_eagle',     'page', 'skins', '{"en": "Eagle Skins"}',     250, '{"shards": 50}'),
  ('skin_bomb',      'page', 'skins', '{"en": "Bomb Skins"}',      260, '{"shards": 50}')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Retention (pg_cron). Pulls with a serial are provenance: kept forever.
-- ---------------------------------------------------------------------
select cron.schedule(
  'fruit-cards-retention',
  '23 4 * * *',
  $$ delete from public.card_pulls where serial is null and created_at < now() - interval '30 days'; $$
)
where not exists (select 1 from cron.job where jobname = 'fruit-cards-retention');
