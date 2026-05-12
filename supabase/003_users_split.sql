-- =====================================================================
-- 003_users_split.sql — Phase 4
--
-- Split mirror of RTDB /users/{uid} into purpose-scoped Supabase tables.
-- Goal: take the /users full-fetch hot path off RTDB by giving clients
-- narrow tables to read from instead.
--
-- Backward compat (same pattern as Phases 1–3):
--   * RTDB stays the SOURCE OF TRUTH for /users. The app keeps writing
--     to /users/{uid} unchanged, so OLD APP VERSIONS keep working
--     forever, and existing CFs (notifyTradeAccept, syncModRoster,
--     etc.) keep firing.
--   * mirrorUsersToSupabase CF tails RTDB writes and fans relevant
--     fields out to the 8 narrow tables here.
--   * NEW clients SUBSCRIBE / READ here for profile data.
--
-- THIS PHASE IS DELIBERATELY NARROW:
--   Out of scope (stay on RTDB):
--     * fcmToken — every notification CF reads it; migrating it would
--       silence pushes
--     * Economy fields: rewardPoints, coins, xp, dailyStars
--     * purchases (RevenueCat-linked map; deferred until economy phase)
--     * cosmetics / shop subtree (write-heavy, deferred)
--     * checkin (small, low-cost)
--     * selectedFruits (game state)
--     * online, lastactivity (presence — would need rewrite of
--       presence flow)
--
-- DELIBERATE NAMING CHANGES (mirror CF translates RTDB→Supabase):
--   * RTDB has BOTH `admin` and `isAdmin` (both used in the codebase,
--     see GlobelStats.js line 316). We canonicalise to `is_admin`
--     here; mirror CF reads either RTDB key and writes the same column.
--   * RTDB `lastactivity` (sic, typo'd) → Supabase `last_activity_ms`
--   * Everything else: snake_case in Supabase, camelCase in RTDB,
--     mirror translates both directions.
--
-- Auth: depends on public.firebase_uid() from 000_init.sql.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. user_identity
--    Hot read path: chat headers, profile drawer, message attribution.
--    Written rarely (sign-up + occasional profile edit).
-- ---------------------------------------------------------------------
create table if not exists public.user_identity (
  uid               text primary key,
  display_name      text,
  avatar            text,                       -- avatar URL
  email             text,
  is_block          boolean not null default false,    -- mirrors RTDB `isBlock`
  created_at_ms     bigint,                     -- mirrors RTDB createdAt
  last_activity_ms  bigint,                     -- mirrors RTDB lastactivity (sic)
  online            boolean not null default false,
  os                text,                       -- 'ios' | 'android' (set on sign-in)
  updated_at        timestamptz not null default now()
);

-- displayName / avatar lookups by uid are the dominant read; pkey covers it.
-- Add a btree on display_name for chat search by name.
create index if not exists idx_user_identity_display_name
  on public.user_identity (display_name);


-- ---------------------------------------------------------------------
-- 2. user_roblox
--    Read in chat drawer (BottomDrawer, OnlineUsersList,
--    PrivateChatHeader). Mirrors fields under /users/{uid} that
--    relate to Roblox account verification.
-- ---------------------------------------------------------------------
create table if not exists public.user_roblox (
  uid                          text primary key,
  roblox_username              text,
  roblox_user_id               text,        -- string in RTDB; preserve
  roblox_username_verified     boolean not null default false,
  updated_at                   timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 3. user_roles
--    Boolean role flags. Source of truth is still RTDB (admin tools,
--    syncModRoster CF write to RTDB). Mirror CF propagates here.
--    Clients READ these for chat badge rendering and permission gates.
--
--    Note Blox-Fruit-specific extras vs adoptme: is_grinder + is_raider.
-- ---------------------------------------------------------------------
create table if not exists public.user_roles (
  uid               text primary key,
  is_admin          boolean not null default false,
  is_moderator      boolean not null default false,
  is_baby_mod       boolean not null default false,
  is_trusted        boolean not null default false,
  is_cmsr           boolean not null default false,
  is_grinder        boolean not null default false,    -- Blox-Fruit-specific
  is_raider         boolean not null default false,    -- Blox-Fruit-specific
  updated_at        timestamptz not null default now()
);

-- "Who has role X" queries (mod roster, trusted user lists). Sparse
-- partial indexes — only index rows where the flag is true so we don't
-- waste space on the 99% of users who have no role.
create index if not exists idx_user_roles_moderators
  on public.user_roles (uid) where is_moderator = true;
create index if not exists idx_user_roles_trusted
  on public.user_roles (uid) where is_trusted = true;
create index if not exists idx_user_roles_cmsr
  on public.user_roles (uid) where is_cmsr = true;
create index if not exists idx_user_roles_admin
  on public.user_roles (uid) where is_admin = true;
create index if not exists idx_user_roles_grinder
  on public.user_roles (uid) where is_grinder = true;
create index if not exists idx_user_roles_raider
  on public.user_roles (uid) where is_raider = true;


-- ---------------------------------------------------------------------
-- 4. user_cosmetics
--    Display-time cosmetic state read by every chat message render.
--    NOTE: full /users/{uid}/cosmetics + shop subtrees stay on RTDB.
--    This table is the SLIM cosmetic state used by chat header badges
--    (just is_pro + top_badge for now). Active items / inventory stay
--    on RTDB and are deferred to a future phase.
-- ---------------------------------------------------------------------
create table if not exists public.user_cosmetics (
  uid             text primary key,
  top_badge       text,
  is_pro          boolean not null default false,
  updated_at      timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 5. user_notifications
--    fcmToken stays on RTDB (notification CFs depend on it being
--    there). The other fields move; CFs that need them will eventually
--    read from here in a future phase, but for now both paths coexist
--    via mirror.
--
--    notification_settings is JSONB because new push types add new
--    keys regularly — flat columns would mean a migration per toggle.
-- ---------------------------------------------------------------------
create table if not exists public.user_notifications (
  uid                       text primary key,
  is_token_invalid          boolean not null default false,
  mute_trade_notifs         boolean not null default false,
  notification_settings     jsonb,             -- { notifyMessages, notifyGroupMessages, ... }
  updated_at                timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 6. user_settings
--    Reminder + future user-controlled toggles. Read by the reminder
--    background flow.
-- ---------------------------------------------------------------------
create table if not exists public.user_settings (
  uid                              text primary key,
  is_reminder_enabled              boolean not null default false,
  is_selected_reminder_enabled     boolean not null default false,
  updated_at                       timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 7. user_badges
--    Relational so "who has badge X" leaderboard queries are cheap.
--    Each row = one earned badge. metadata holds badge-specific extras
--    (e.g. tier, count) without forcing a column per badge type.
-- ---------------------------------------------------------------------
create table if not exists public.user_badges (
  uid           text not null,
  badge_id      text not null,
  earned_at_ms  bigint,                       -- ms epoch
  metadata      jsonb,                        -- badge-specific extras
  primary key (uid, badge_id)
);

-- Leaderboard / showcase: "show me everyone with badge X".
create index if not exists idx_user_badges_by_badge
  on public.user_badges (badge_id);


-- ---------------------------------------------------------------------
-- 8. user_blocks
--    (uid, blocked_uid) pairs. Replaces RTDB
--    /users/{uid}/blocked_users/{blockedUid} = true. blocked_at gives
--    us "recently blocked" sort if we ever want it.
-- ---------------------------------------------------------------------
create table if not exists public.user_blocks (
  uid             text not null,           -- the blocker
  blocked_uid     text not null,           -- the blocked
  blocked_at_ms   bigint,
  primary key (uid, blocked_uid)
);

-- "Am I blocked by user X?" — needed by chat send guards.
create index if not exists idx_user_blocks_by_blocked
  on public.user_blocks (blocked_uid);


-- =====================================================================
-- Row Level Security
-- =====================================================================
-- Read access mirrors what RTDB exposes today (every authed user can
-- read another user's basic profile so chat / drawer renders work).
-- Tighter scope on settings + notifications + blocks: those are personal.
--
-- ALL WRITES are service-role only (mirror CF). No client-write policies.
-- Service role bypasses RLS so no insert/update/delete policies needed.
-- =====================================================================

alter table public.user_identity      enable row level security;
alter table public.user_roblox        enable row level security;
alter table public.user_roles         enable row level security;
alter table public.user_cosmetics     enable row level security;
alter table public.user_notifications enable row level security;
alter table public.user_settings      enable row level security;
alter table public.user_badges        enable row level security;
alter table public.user_blocks        enable row level security;

-- Public-readable (matches RTDB read access at users root).
create policy "user_identity readable by any authed user"
  on public.user_identity for select
  using (public.firebase_uid() is not null);

create policy "user_roblox readable by any authed user"
  on public.user_roblox for select
  using (public.firebase_uid() is not null);

create policy "user_roles readable by any authed user"
  on public.user_roles for select
  using (public.firebase_uid() is not null);

create policy "user_cosmetics readable by any authed user"
  on public.user_cosmetics for select
  using (public.firebase_uid() is not null);

create policy "user_badges readable by any authed user"
  on public.user_badges for select
  using (public.firebase_uid() is not null);

-- Owner-only (personal data).
create policy "user_settings readable by owner"
  on public.user_settings for select
  using (uid = public.firebase_uid());

create policy "user_notifications readable by owner"
  on public.user_notifications for select
  using (uid = public.firebase_uid());

create policy "user_blocks readable by owner"
  on public.user_blocks for select
  using (uid = public.firebase_uid());


-- =====================================================================
-- Realtime publication
-- =====================================================================
-- Clients subscribe to changes on identity / roles / cosmetics / badges
-- so chat re-renders when someone changes display name, claims a new
-- badge, etc. Settings/notifications are owner-read; we still publish
-- them so a user's other devices stay in sync.
--
-- Replica identity FULL is needed so the realtime payload contains the
-- old row on UPDATE/DELETE (otherwise the listener can't reconcile).
-- =====================================================================

alter table public.user_identity      replica identity full;
alter table public.user_roblox        replica identity full;
alter table public.user_roles         replica identity full;
alter table public.user_cosmetics     replica identity full;
alter table public.user_notifications replica identity full;
alter table public.user_settings      replica identity full;
alter table public.user_badges        replica identity full;
alter table public.user_blocks        replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_identity') then
    alter publication supabase_realtime add table public.user_identity; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_roblox') then
    alter publication supabase_realtime add table public.user_roblox; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_roles') then
    alter publication supabase_realtime add table public.user_roles; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_cosmetics') then
    alter publication supabase_realtime add table public.user_cosmetics; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_notifications') then
    alter publication supabase_realtime add table public.user_notifications; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_settings') then
    alter publication supabase_realtime add table public.user_settings; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_badges') then
    alter publication supabase_realtime add table public.user_badges; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_blocks') then
    alter publication supabase_realtime add table public.user_blocks; end if;
end $$;
