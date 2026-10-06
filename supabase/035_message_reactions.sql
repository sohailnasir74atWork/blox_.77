-- =====================================================================
-- 035_message_reactions.sql (2026-10-06) — APPLIED 2026-10-06 (SQL editor)
--
-- Emoji reactions on public-chat messages. Ported from adoptme-jan7
-- (supabase/schema.sql message_reactions + 021 publication cleanup).
--
-- Shape: one row per (message, user). The client folds rows into the
-- `msg.reactions = { [userId]: emoji }` map the UI already renders
-- (chatBackend.js loadReactionsFor / toggleReaction).
--
-- NOT in the realtime publication, on purpose: the table has no room_id,
-- so a channel couldn't scope broadcasts and every reaction would fan out
-- to every connected user (adoptme hit its realtime quota that way).
-- Your own reactions are optimistic; other users' show up on load, load
-- more and pull-to-refresh.
--
-- The client ships with CHAT_REACTIONS_ENABLED (Code/Supabase/featureFlags.js);
-- apply this migration BEFORE releasing a build with it on, or reactions
-- will fail to save (the app reverts the optimistic emoji on failure).
-- =====================================================================

create table if not exists public.message_reactions (
  message_id  uuid not null references public.messages(id) on delete cascade,
  user_id     text not null,                     -- Firebase UID
  emoji       text not null,
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id),
  -- Same five the action drawer offers (MessageActionDrawer.jsx); stops a
  -- crafted request from storing arbitrary text under someone's message.
  constraint message_reactions_emoji_allowed
    check (emoji in ('❤️', '🔥', '😍', '💀', '🎯'))
);

-- loadReactionsFor() reads `where message_id in (...)` — the PK covers it.

alter table public.message_reactions enable row level security;

drop policy if exists "reactions read all"   on public.message_reactions;
drop policy if exists "reactions insert own" on public.message_reactions;
drop policy if exists "reactions update own" on public.message_reactions;
drop policy if exists "reactions delete own" on public.message_reactions;

create policy "reactions read all"
  on public.message_reactions for select
  using (true);

create policy "reactions insert own"
  on public.message_reactions for insert
  with check (user_id = public.firebase_uid());

create policy "reactions update own"
  on public.message_reactions for update
  using (user_id = public.firebase_uid())
  with check (user_id = public.firebase_uid());

create policy "reactions delete own"
  on public.message_reactions for delete
  using (user_id = public.firebase_uid());
