-- =====================================================================
-- 001_public_chat.sql — Phase 1
--
-- Mirror of RTDB public chat (15 channels under chat_*_upgrade) and
-- /pin_messages into Supabase. Lets clients move the live chat reads
-- (which dominate egress) off RTDB.
--
-- Backward compat:
--   * RTDB stays the source of truth — the app keeps writing to
--     chat_<lang>_upgrade as today, so old app versions still see each
--     other's messages and existing CFs (none for public chat today)
--     would still fire.
--   * mirrorPublicChatToSupabase CF tails RTDB writes and inserts here.
--   * New clients SUBSCRIBE here for the message stream.
--   * Both old and new clients see each other because all writes still
--     fan into RTDB.
--
-- Field shape mirrors what Trader.jsx writes (line 671):
--   { text, timestamp, senderId, replyTo, fruits, gif, OS }
-- Sender name / avatar / badges / cosmetics are resolved client-side
-- via profileCache on render — NOT stored on the message — so the
-- schema is much slimmer than a "snapshot every field" approach.
--
-- Auth: depends on public.firebase_uid() from 000_init.sql.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. rooms — one row per channel. Seeded with the 15 channels from
--    Trader.jsx CHANNELS array. Adding/removing channels only requires
--    inserting/deleting rows here (no schema change).
-- ---------------------------------------------------------------------
create table if not exists public.rooms (
  id          text primary key,                  -- 'chat_new_upgrade', 'chat_es_upgrade', ...
  label       text not null,                     -- display label
  language    text,                              -- ISO code or null for non-language channels
  category    text not null,                     -- 'core' | 'language'
  created_at  timestamptz not null default now()
);

-- Seed rooms (matches CHANNELS in Code/ChatScreen/GroupChat/Trader.jsx).
-- Re-running the migration is idempotent thanks to do-nothing.
insert into public.rooms (id, label, language, category) values
  ('chat_new_upgrade',     'English',     'en', 'core'),
  ('chat_raid_upgrade',    'Raids',       null, 'core'),
  ('chat_help_upgrade',    'Help',        null, 'core'),
  ('chat_playing_upgrade', 'Playing',     null, 'core'),
  ('chat_es_upgrade',      'Español',     'es', 'language'),
  ('chat_ar_upgrade',      'Arabic',      'ar', 'language'),
  ('chat_pt_upgrade',      'Português',   'pt', 'language'),
  ('chat_fr_upgrade',      'Français',    'fr', 'language'),
  ('chat_de_upgrade',      'Deutsch',     'de', 'language'),
  ('chat_tr_upgrade',      'Türkçe',      'tr', 'language'),
  ('chat_ru_upgrade',      'Русский',     'ru', 'language'),
  ('chat_id_upgrade',      'Indonesia',   'id', 'language'),
  ('chat_ja_upgrade',      '日本語',       'ja', 'language'),
  ('chat_ko_upgrade',      '한국어',       'ko', 'language'),
  ('chat_ph_upgrade',      'Filipino',    null, 'language')
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 2. messages — single table for all public-chat messages across rooms.
--
-- Field names mirror the RTDB document Trader.jsx writes (line 671) so
-- the client backend module can stay a thin transport adapter without a
-- data-model rewrite.
--
-- We DO NOT snapshot sender profile fields here. profileCache resolves
-- name/avatar/badges/cosmetics on render — same behaviour as RTDB today.
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  -- rtdb_key preserves the RTDB push-id used as the row key in
  -- chat_<lang>_upgrade/{key}. Useful for: (a) idempotent backfill
  -- ("have we already mirrored this key?"), (b) cross-referencing the
  -- mirror CF logs against RTDB during incident triage. UNIQUE per
  -- room so backfill re-runs are no-ops.
  rtdb_key        text,
  room_id         text not null references public.rooms(id) on delete cascade,

  sender_id       text not null,                  -- Firebase UID
  text            text,                           -- nullable when message is a GIF/fruit-only post
  gif             text,                           -- gif/emoji URL (was `gif` in RTDB)
  fruits          jsonb not null default '[]'::jsonb,
  reply_to        jsonb,                          -- { id, text } or null

  os              text,                           -- 'ios' | 'android' | null

  -- created_at mirrors RTDB serverTimestamp(); the mirror CF coerces
  -- the numeric ms epoch into a timestamptz on write.
  created_at      timestamptz not null default now()
);

-- Pagination: newest-first within a room. (created_at, id) cursor so
-- two messages sharing a millisecond don't skip / double-count.
--   select * from messages
--    where room_id = $1 and (created_at, id) < ($2, $3)
--    order by created_at desc, id desc limit $4
create index if not exists idx_messages_room_created
  on public.messages (room_id, created_at desc, id desc);

-- Idempotent backfill: skip rows we've already mirrored.
-- Per-room because RTDB push keys are unique within a sub-tree but not
-- globally unique across rooms.
create unique index if not exists idx_messages_room_rtdb_key
  on public.messages (room_id, rtdb_key)
  where rtdb_key is not null;

-- Moderation: list messages by sender (for ban-and-delete-history flow).
create index if not exists idx_messages_sender
  on public.messages (sender_id);


-- ---------------------------------------------------------------------
-- 3. pinned_messages — references messages instead of copying content.
--
-- RTDB stores full snapshots in /pin_messages/{pushKey}. We normalise
-- to a reference here: the canonical message lives in `messages`,
-- pinned_messages just records "this one is pinned across the app".
-- pinned_at is the only state unique to pinning.
-- ---------------------------------------------------------------------
create table if not exists public.pinned_messages (
  id          uuid primary key default gen_random_uuid(),
  rtdb_key    text,                                  -- the push key under /pin_messages
  message_id  uuid not null references public.messages(id) on delete cascade,
  room_id     text not null references public.rooms(id) on delete cascade,
  pinned_by   text,                                  -- Firebase UID of admin/mod (null if unknown from backfill)
  pinned_at   timestamptz not null default now(),
  unique (rtdb_key)                                  -- idempotent backfill / mirror
);

create index if not exists idx_pinned_room
  on public.pinned_messages (room_id, pinned_at desc);


-- =====================================================================
-- Row Level Security
-- =====================================================================
-- Mirror the original (permissive) RTDB rules:
--   * read: any authed user (matches "everyone reads chat")
--   * insert: own message only (sender_id must match firebase_uid())
--   * update / delete: any authed user (admin gating happens in UI today)
--
-- Service-role bypasses RLS, so the mirror CF and backfill scripts
-- write freely without touching these policies.
-- =====================================================================

alter table public.rooms           enable row level security;
alter table public.messages        enable row level security;
alter table public.pinned_messages enable row level security;

create policy "rooms read all"
  on public.rooms for select
  using (true);

create policy "messages read all"
  on public.messages for select
  using (true);

-- Allow direct client inserts so the new build can write to Supabase
-- (the mirror CF backfills writes from old builds via RTDB). Phase 1
-- ships RTDB-write-only on the client to stay minimum-risk; this
-- policy is here for the eventual cut-over.
create policy "messages insert own"
  on public.messages for insert
  with check (sender_id = public.firebase_uid());

-- Same permissive trust model as the RTDB rules — admin/mod gating
-- lives in the client UI today. Risk accepted: someone could craft
-- an UPDATE/DELETE via direct API call, but that risk already exists
-- on RTDB and the mod tools clean up fast.
create policy "messages update authenticated"
  on public.messages for update
  using (public.firebase_uid() is not null);

create policy "messages delete authenticated"
  on public.messages for delete
  using (public.firebase_uid() is not null);

create policy "pinned read all"
  on public.pinned_messages for select
  using (true);

create policy "pinned insert authenticated"
  on public.pinned_messages for insert
  with check (public.firebase_uid() is not null);

create policy "pinned delete authenticated"
  on public.pinned_messages for delete
  using (public.firebase_uid() is not null);


-- =====================================================================
-- Realtime publication
-- =====================================================================
-- Enable change streams so clients can subscribe to INSERT / UPDATE /
-- DELETE the way they do with onChildAdded today. REPLICA IDENTITY FULL
-- so DELETE filters on non-PK columns (room_id) keep working.
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pinned_messages'
  ) then
    alter publication supabase_realtime add table public.pinned_messages;
  end if;
end $$;

alter table public.messages        replica identity full;
alter table public.pinned_messages replica identity full;
