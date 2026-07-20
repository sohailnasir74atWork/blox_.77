-- 019: composite index for the chat-meta delta sync (OPTIONAL but recommended)
--
-- The client's re-sync path (foreground / reconnect / late-joiner) now runs:
--
--   select ... from chat_meta_data
--   where owner_uid = $1 and updated_at > $2
--   order by updated_at asc
--   limit 1000;
--
-- (see Code/Supabase/chatMetaBackend.js → loadChatMetaSince)
--
-- Today this is served by idx_chat_meta_owner (owner_uid only): Postgres
-- finds the owner's rows, then filters + sorts them in memory. Fine for
-- typical users; for heavy users with thousands of chat rows this composite
-- index lets the whole query run as one ordered index scan instead.
--
-- Purely additive — no schema, RLS, or behavior change. Safe to run any
-- time in the SQL editor.

create index if not exists idx_chat_meta_owner_updated
  on public.chat_meta_data (owner_uid, updated_at);
