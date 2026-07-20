-- =====================================================================
-- 018_cleanup_ghost_chat_meta.sql
-- (ported from adoptme-jan7 019_cleanup_ghost_chat_meta.sql)
--
-- One-shot cleanup for ghost rows in chat_meta_data. Companion to the
-- ghost-row guard added to functions/mirrorChatMetaToSupabase.js —
-- deploy the guarded CF FIRST, then run this, or new ghosts can appear
-- between the delete and the deploy.
--
-- BACKGROUND
-- ----------
-- mirrorChatMetaToSupabase fires on every write to
-- /chat_meta_data/{ownerUid}/{partnerUid} in RTDB. Before the guard it
-- happily mirrored writes where the parent RTDB node only held a
-- sub-leaf (e.g. a stray lastRead or mirror marker) — those reads
-- returned an object with NO chatId / lastMessage / timestamp /
-- receiverId, and the CF upserted a Supabase row with all the
-- meaningful fields null.
--
-- Inbox UI (InboxScreen.jsx) falls back to 'Anonymous' / 'No messages
-- yet' for nulls, so each ghost row renders as a phantom conversation
-- with a stranger. In adoptme ~10% of chat_meta_data was ghosts.
--
-- SAFE TO RE-RUN. The patched mirror CF won't recreate ghosts, so a
-- one-shot DELETE is enough.
-- =====================================================================

-- Belt-and-suspenders: only target rows where ALL three identifying
-- fields are null. A row missing one but not the others would be data
-- corruption worth investigating, not a partial-write ghost.
delete from public.chat_meta_data
 where chat_id      is null
   and timestamp_ms is null
   and last_message is null;
