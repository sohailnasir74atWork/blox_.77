# Blox Fruit — Engineering Handoff

**Last updated**: 2026-05-08 by previous agent session
**For**: The next agent picking up work on this repo

This document is the single entry point for what's been done, what's mid-flight, and what's next. Read this first — then dig into linked detail docs as needed.

---

## TL;DR — What's the state of the world?

1. **RTDB → Supabase migration**: 100% of chat is Supabase-native end-to-end (reads + writes). Public chat, chat metadata, group metadata, private message bodies, group message bodies all migrated. **Old app builds are explicitly broken** for chat (per user direction, "don't care about old users") — they keep reading RTDB which no longer receives writes for these tables.
2. **Notification CFs**: rewritten as Supabase-Database-Webhook → HTTPS handlers ([functions/notifyNewMessages.example.js](functions/notifyNewMessages.example.js)). Renamed to `notifyPrivateMessage` + `notifyGroupNewMessage` (the legacy `notifyNewMessage` RTDB-trigger CF stays untouched to avoid trigger-type conflict on deploy).
3. **Role-claim backfill**: in progress in background (`scripts/set-supabase-role-claim.js`). 251k Auth users total; ~77k have the claim, ~174k still pending. Throttled to ~12 QPS due to Firebase Auth's quota; the script grinds for ~3–4 more hours unbacked.
4. **chat_meta_data write path rewritten**: client-side parallel upserts replaced by a single SECURITY DEFINER RPC ([supabase/011_send_private_chat_meta.sql](supabase/011_send_private_chat_meta.sql)). Originated from a `42501 RLS` rejection on the receiver-side row during smoke testing 2026-05-07; root cause was inconclusive (policy logic looked correct, JWT/role claim verified) so the fix bypasses RLS entirely and self-validates via `firebase_uid()`. Side benefits: atomic two-sided write (no half-write race) + folds the `increment_chat_unread` round-trip into the same call.
5. **Device-ban hardening (iOS)**: [Code/Helper/deviceFingerprint.js](Code/Helper/deviceFingerprint.js) now stashes the iOS fingerprint in Keychain (`react-native-keychain`). Keychain items survive app uninstall by Apple's design, so the "delete every vendor app + reinstall = fresh IDFV" bypass (~60s evasion) no longer works. Existing iOS bans carry forward without RTDB migration because first-launch seeds the Keychain with the current IDFV. Wiped only by full "Erase All Content and Settings" or new physical device — both accepted per product call. Android path unchanged (ANDROID_ID via DeviceInfo).
6. **Ban card UX**: [Code/HomeTab/HomeTabScreen.jsx:374-486](Code/HomeTab/HomeTabScreen.jsx#L374-L486) now distinguishes direct bans from associated-device bans. New `deviceBanInfo` in [Code/GlobelStats.js](Code/GlobelStats.js) carries the originating email/userId from `banned_devices/{fp}` so the card can show "This device is linked to a banned account ({email}). Signing in with a different email won't restore access." for users who tried the email-rotate evasion.
7. **Build cut**: versionCode 134 / versionName 3.8.9 AAB built earlier, then superseded by **versionCode 135 / versionName 3.8.10** (Keychain + ban-card patch). Both at `android/app/build/outputs/bundle/release/app-release.aab` — overwritten by latest build. Not yet uploaded to Play Console.
8. **Outstanding before ship**: apply migration 011 in Supabase ✅ (done), configure 2 Supabase webhooks, deploy the new notification CFs, smoke test end-to-end, upload AAB. v130 crash regression mitigations from prior session still apply.

---

## Repository layout (what's where)

```
Blox_Fruit/
├── HANDOFF.md                                ← you are here
├── SUPABASE_MIGRATION.md                     ← deep dive on the RTDB→Supabase migration
├── CLAUDE.md                                 ← project-level instructions for AI agents
├── .firebaserc                               ← Firebase project: fruiteblocks
├── .secrets/                                 ← gitignored
│   └── play-sa-key.json                      ← Play Console service account
├── serviceAccount.json                       ← gitignored — Firebase admin SA (for backfill scripts)
├── supabase/
│   ├── 000_init.sql                          ← firebase_uid() helper (Phase 0)
│   ├── 001_public_chat.sql                   ← rooms, messages, pinned_messages (Phase 1)
│   ├── 002_chat_metadata.sql                 ← chat_meta_data, group_meta_data (Phases 2+3)
│   ├── 003_users_split.sql                   ← 8 user_* tables (Phase 4)
│   ├── 004_fix_messages_unique_index.sql     ← hotfix for ON CONFLICT
│   ├── 005_client_msg_id.sql                 ← idempotent send key on public.messages
│   ├── 006_message_moderation.sql            ← deleted/deleted_at/deleted_by/report_count on public.messages
│   ├── 007_meta_writable_by_owner.sql        ← chat/group_meta_data RLS opened for client writes
│   ├── 008_meta_rpcs.sql                     ← increment_chat_unread / increment_group_unread (race-free)
│   ├── 009_private_messages.sql              ← Phase 5: private_messages table + RLS + realtime
│   ├── 010_group_messages.sql                ← Phase 5: group_messages table + is_group_member() helper
│   └── 011_send_private_chat_meta.sql        ← SECURITY DEFINER pair-write RPC (replaces parallel upserts)
├── functions/
│   ├── _supabaseAdmin.js                     ← shared service-role client
│   ├── mirrorPublicChatToSupabase.js         ← 3 CFs: message create / delete / pin (now mostly idle since clients write Supabase directly)
│   ├── mirrorChatMetaToSupabase.js           ← idle for new builds; still triggers on any RTDB writes from old builds
│   ├── mirrorGroupMetaToSupabase.js          ← same
│   ├── mirrorUsersToSupabase.js              ← still active (users still on RTDB)
│   ├── notifyTradeAccept.js                  ← pre-existing
│   ├── syncModRoster.js                      ← pre-existing
│   ├── notifyNewMessages.example.js          ← NOT deployed from here; copy into the deployment that owns notification CFs
│   └── index.js                              ← exports the 8 CFs above
├── scripts/
│   ├── backfill-public-chat-to-supabase.js   ← skipped per user (history not needed)
│   ├── backfill-chat-meta-to-supabase.js     ← ✅ ran, 1.07M + 7.9k rows
│   ├── backfill-users-to-supabase.js         ← ✅ ran, 142,146 users → 8 tables
│   ├── play-fetch.js                         ← Play Console vitals + reviews
│   ├── play-summary.js                       ← per-version dashboard
│   └── play-reply.js                         ← review reply drafting (dry-run by default)
├── analytics/<YYYY-MM-DD>/                   ← gitignored; CSV outputs from play-fetch.js
└── Code/Supabase/                            ← Supabase client code
    ├── client.js                             ← auth-aware Supabase client
    ├── featureFlags.js                       ← KILL SWITCH for reads (writes have no fallback now)
    ├── uuid.js                               ← tiny UUIDv4 for client_msg_id
    ├── chatBackend.js                        ← public chat reads + writes (send/pin/unpin/delete/report)
    ├── chatMetaBackend.js                    ← chat_meta_data reads + writes (sendPrivateChatMeta/setChatMuted/etc.)
    ├── groupMetaBackend.js                   ← group_meta_data reads + writes (fanOutGroupMessage/upsertGroupMetaRow/etc.)
    ├── userBackend.js                        ← Phase 4 reads (8 tables; users still on RTDB for writes)
    ├── privateMessagesBackend.js             ← Phase 5: private_messages reads + writes + report
    └── groupMessagesBackend.js               ← Phase 5: group_messages reads + writes + report
```

---

## Active integrations (credentials, infra)

| Service | Identifier | Notes |
|---|---|---|
| Firebase project | `fruiteblocks` | RTDB + Auth + FCM + Functions + Crashlytics |
| Supabase project | `jaimyhmanefvrijvjzxl.supabase.co` | ap-southeast-1 (Singapore), t4g.micro instance, **Pro plan** |
| Supabase keys | publishable in `Code/Helper/Environment.js`, service-role in Firebase secrets | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set as Firebase secrets |
| Play Console SA | `quality-test@quality-blox.iam.gserviceaccount.com` | Already invited to Blox Fruit Play Console — confirmed working |
| Android package | `com.bloxfruitevalues` (noman) | other variant: `com.bloxfruitstock` (waqas) |
| iOS app id | `id6737775801` | |
| Sibling reference project | `/Volumes/Sohail/AI_Projects/adoptme-jan7/` | Source of all the migration patterns. Read `RTDB_MIGRATION_HANDOFF.md` there for context. |

---

## Migration status (Supabase)

### Chat ecosystem — Supabase end-to-end (reads + writes)
| Subsystem | Supabase table(s) | Reads | Writes | Notes |
|---|---|---|---|---|
| Public chat | `messages`, `pinned_messages`, `rooms` | Supabase | Supabase | `client_msg_id` for idempotent retry; soft-delete; report counter |
| Chat metadata (1-on-1) | `chat_meta_data` | Supabase | Supabase | Two-sided RLS via `(owner_uid OR partner_uid) = firebase_uid()`; atomic `increment_chat_unread()` RPC |
| Group metadata | `group_meta_data` | Supabase | Supabase | Member fan-out via `fanOutGroupMessage()` + `increment_group_unread()` RPC |
| Private message bodies | `private_messages` | Supabase | Supabase | Phase 5; participant-only RLS; soft-delete; report |
| Group message bodies | `group_messages` | Supabase | Supabase | Phase 5; member-scoped RLS via `is_group_member()` SECURITY DEFINER fn |

### Mirror CFs — now mostly idle but kept running
The four mirror CFs (`mirrorPublicChatToSupabase`, `mirrorChatMetaToSupabase`, `mirrorGroupMetaToSupabase`, `mirrorUsersToSupabase`) are still deployed but only fire if any RTDB writes still happen on those paths. New app builds skip RTDB entirely for chat — only `mirrorUsersToSupabase` still does meaningful work because users/{uid} is still RTDB-first.

### Backfill row counts (one-time historical loads)
| Table | Rows backfilled |
|---|---|
| `chat_meta_data` | 1,073,868 |
| `group_meta_data` | 7,941 |
| `user_identity` (and 7 sibling user_*) | 142,146 each |
| `messages` (public chat) | skipped (forward-only) |
| `private_messages`, `group_messages` | not backfilled (forward-only — old conversations remain on RTDB and are invisible to new builds) |

### Out of scope — stays on RTDB FOREVER (or until a future phase)
- `users/{uid}/*` — entire user tree still RTDB-write (only reads are migrated)
- `users/{uid}/fcmToken` — every notification CF reads it; migrating would silence pushes
- `users/{uid}/email` — read by notification CF + ban flow
- `users/{uid}/notifyMessages`, `notifyGroupMessages` — mute prefs (notification CFs)
- `users/{uid}/coins`, `rewardPoints`, `xp`, `purchases` — economy fields (atomic counter risk)
- `users/{uid}/cosmetics`, `users/{uid}/shop/*` — write-heavy
- `users/{uid}/checkin`, `selectedFruits`, `online`, `lastactivity`, `lastGameWinAt`, `hasRecentGameWin`, `flage`, `profileFrame`
- `private_messages/{chatId}/trade` — trade subtree, separate feature
- `private_messages/{chatKey}/lastRead/*`, `unread/*` — read receipts (different from chat_meta_data)
- `buy_posts/*`, `sell_posts/*` — trade posts
- `saved_trades/*`
- `egg_shop/*`
- `fruitCrash/*` — real-time game state
- `calcData/*`, `notifications/*`, `monitor/*` — stock scraper paths (CF-owned)
- `gameInvites/*`, `gameRooms/*` — pet guessing game
- `banned_users/*`, `.info/connected`
- All Firestore collections (scammer DB, groups, reviews, etc.)

### Supabase auth — `role: "authenticated"` custom claim
**REQUIRED** for Realtime to work. Supabase Realtime (Firebase Third-Party Auth) rejects any JWT that doesn't have a `role` claim with `InvalidJWTToken: Fields role and exp are required` — REST still works without it, but realtime channels never deliver events.

- New users: `functions/setSupabaseRoleClaim.js` — runs on `auth.user().onCreate`. Must be deployed.
- Existing users: `scripts/set-supabase-role-claim.js` — one-time backfill, throttled to `CONCURRENCY=3, INTER_BATCH_SLEEP_MS=250` (~12 QPS) to stay under Firebase Auth's `setCustomUserClaims` quota. Idempotent.

**Backfill status (as of 2026-05-07)**: 251,032 Auth users total; ~77k done (skipped + updated combined); ~174k pending. Script is running in background — let it grind for ~3–4h. To speed up, request a quota bump in [GCP Console → Quotas](https://console.cloud.google.com/iam-admin/quotas) on `identitytoolkit.googleapis.com` (then bump `CONCURRENCY` back up).

### Wired client files (Supabase-native — writes too)
After the 2026-05-07 cut-over, every chat-related write goes to Supabase. The kill-switch only covers reads now (writes have no fallback path).

| File | What it touches |
|---|---|
| `Code/Helper/profileCache.js` | races Supabase identity/roles/cosmetics/roblox + RTDB shop |
| `Code/ChatScreen/ChatNavigator.js` | chat_meta + group_meta listeners; blocked-user unread reset → Supabase |
| `Code/ChatScreen/GroupChat/InboxScreen.jsx` | chat list, bell mute toggle, swipe-delete chat — all Supabase |
| `Code/ChatScreen/GroupChat/Trader.jsx` | public chat: send + pin + unpin + delete + bulk delete + load + realtime |
| `Code/ChatScreen/GroupChat/GroupChatScreen.jsx` | group chat: send + delete + bulk + load + realtime + focus unread reset |
| `Code/ChatScreen/GroupChat/GroupsScreen.jsx` | group mute toggle + load |
| `Code/ChatScreen/PrivateChat/PrivateChat.jsx` | private chat: send + delete + bulk + load + realtime + focus unread reset; chat_meta two-sided upsert via `send_private_chat_meta` RPC (atomic, depends on migration 011) |
| `Code/ChatScreen/PrivateChat/PrivateChatHeader.jsx` | admin "delete all" → Supabase |
| `Code/ChatScreen/utils/groupUtils.js` | sendGroupMessage body + meta fan-out, group create / accept invite / leave / kick / delete, rename / avatar fan-outs |
| `Code/ChatScreen/utils.js` | handleDeleteLast300Messages → softDeleteMessagesBySender |
| `Code/ChatScreen/ReportPopUp.jsx` | private + public report flows → Supabase report_count + soft-delete |
| `Code/AppHelper/AdminDashboard.js` | mod chat viewer reads private_messages from Supabase |

### Kill switch (reads only)
`Code/Supabase/featureFlags.js`. Flipping `SUPABASE_READS_ENABLED` to `false` reverts read paths to RTDB. **Writes have no fallback** post-cutover — writing to RTDB would no longer match where reads come from in any modern build. If you need to fully kill Supabase, flip the flag AND ship the prior build that still wrote to RTDB.

Per-feature flags: `SUPABASE_PUBLIC_CHAT_ENABLED`, `SUPABASE_CHAT_META_ENABLED`, `SUPABASE_GROUP_META_ENABLED`, `SUPABASE_USERS_ENABLED`.

### Operational lessons baked in (from adoptme-jan7 post-mortem)
1. **JWT timing on cold-start**: `client.js` waits on `_authReady` (handles RN Firebase's double `onAuthStateChanged` fire — null first, real user 1–3s later)
2. **App-state reconnect**: `client.js` calls `supabase.realtime.connect()` when app returns from background
3. **Channel topic suffix**: every realtime subscription suffixes the topic with `${Date.now()}-${Math.random()}` — supabase-js returns the existing channel for duplicate topics
4. **REPLICA IDENTITY FULL**: every realtime-published table sets this — without it, UPDATE payloads omit unchanged columns and DELETE filters on non-PK columns silently fail
5. **Mirror CF lag bypass**: `resetUnreadCount()` writes direct to Supabase for instant badge clear (1–2s mirror CF lag would otherwise show stale count)
6. **Autovacuum tuning**: high-churn upsert tables (chat_meta, group_meta) have `autovacuum_vacuum_scale_factor = 0.01` — adoptme hit a disk-IO incident at 73% dead rows on default settings
7. **VACUUM via Management API**: SQL editor can't run VACUUM (transaction wrapping). Use `https://api.supabase.com/v1/projects/{ref}/database/query` with the Personal Access Token.

---

## Mute notifications feature

### What was added
- **Bell icon in `InboxScreen.jsx`** — `notifications-outline` (gray, default) ↔ `notifications-off` (red, muted)
- **`handleToggleMute()` callback** — writes to `chat_meta_data/{user.id}/{otherUserId}/muted` (RTDB, source of truth). Mirror CF syncs to Supabase. UI updates via realtime listener.
- **`muted` field passed through** in both Supabase + RTDB chat listeners
- **`notifyNewMessage` CF updated** to skip notifications when `chatData.muted === true`. Code delivered to user; deployed by user.

### Mute is per-side
If A mutes their conversation with B, A doesn't get pushes from B but B's chat with A is unaffected. The flag lives under `chat_meta_data/{A}/{B}/muted`, not `chat_meta_data/{B}/{A}/muted`.

### Notification CF code (post-cutover, 2026-05-07)
The legacy `notifyNewMessage` was an RTDB-onCreate trigger reading mute from RTDB. Both inputs (the trigger AND the mute flag) are gone now (clients no longer write to /private_messages or chat_meta_data on RTDB). It's been replaced by a Supabase-Database-Webhook → HTTPS handler.

**Code template**: [functions/notifyNewMessages.example.js](functions/notifyNewMessages.example.js) (one file, two exports). Lives in **this** repo for reference but is **deployed from the user's other CF deployment** at `/Volumes/Sohail/cloud functions/Firebase Stock/functions/`. They paste the contents into that `index.js` and run `firebase deploy --only functions:notifyPrivateMessage,functions:notifyGroupNewMessage`.

**Renames**:
- `notifyNewMessage` (RTDB-trigger, legacy) → still exists, no longer fires for new messages, kept to avoid the trigger-type-change deploy error
- `notifyPrivateMessage` (HTTPS, new) ← the active path for private push
- `notifyGroupNewMessage` (HTTPS, new) ← active path for group push

**Webhook secret**: `SUPABASE_WEBHOOK_SECRET` is set in Firebase Secret Manager on `fruiteblocks` (version 1, set 2026-05-07). The value is in the agent's chat history at the time of setup; same value goes in the `x-webhook-secret` header on both Supabase webhooks. If you need to rotate, do it in both places at once or pushes will start 401-ing.

**Webhook config still pending in Supabase Dashboard** (see "Action items still pending" section).

## Device + email ban system

### How a ban propagates
When you ban an email via [Code/ChatScreen/utils.js](Code/ChatScreen/utils.js) (`banUserwithEmail` / `setUserStrike`), two RTDB writes happen:
1. `banned_users_by_email/{encodedEmail}` — primary record (timed or `'permanent'`)
2. `banned_devices/{deviceId}` — mirror via `mirrorBanToDevice()`. Carries the originating `email` and `userId` so the ban-card UI can explain *why* the device is locked when the user signs in with a different email.

`users/{uid}/deviceId` is stamped on auth at [GlobelStats.js:372](Code/GlobelStats.js#L372) so admin actions can find a user's device. `unbanUserWithEmail` reads back the mirrored `deviceId` from the email-ban entry and clears `banned_devices/{deviceId}` too.

### Listener
[GlobelStats.js:691-762](Code/GlobelStats.js#L691-L762) runs two parallel `onValue` subscriptions:
- email path → `_isEmailBanned` + `strikeInfo`
- device path → `_isDeviceBanned` + `deviceBanInfo`

`isUserBlocked = _isEmailBanned || _isDeviceBanned` is the single boolean every consumer (Chat, Trades, Comments, Reports, Home) reads. `strikeInfo` and `deviceBanInfo` are both exposed via context so the Home ban card can pick the right copy.

### iOS device fingerprint — Keychain-backed (2026-05-08)
[Code/Helper/deviceFingerprint.js](Code/Helper/deviceFingerprint.js) on iOS:
1. Reads from Keychain (`com.bloxfruitevalues.deviceFingerprint`, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`).
2. If empty (first launch since install), seeds with the current IDFV — keeping any pre-existing `banned_devices/{IDFV}` entry valid for that user.
3. On all subsequent launches the Keychain value wins. Reinstalling the app — or even uninstalling EVERY app from this Team ID and reinstalling — preserves it. iOS only wipes Keychain on full "Erase All Content and Settings" or moving to a different physical device.

Android still uses `DeviceInfo.getUniqueId()` (ANDROID_ID) directly. ANDROID_ID survives uninstall/reinstall; resets on factory reset / app data clear (Android 8+) — accepted tradeoff.

### Ban card UI (HomeTabScreen)
Three render cases at [Code/HomeTab/HomeTabScreen.jsx:374-486](Code/HomeTab/HomeTabScreen.jsx#L374-L486):
1. **Direct ban** (`strikeInfo` populated) — "Account Permanently/Temporarily Banned" + reason.
2. **Associated-device ban** (only `deviceBanInfo` populated, e.g. user signed in with a fresh email) — "Device Permanently/Temporarily Restricted" + "Why you are seeing this: This device is linked to a banned account ({email})." — surfaces the originating email so the user understands the email-rotate evasion didn't work.
3. **Both** → direct ban wins (it's the primary signal for the current account).

### What this stack defeats
- ✅ Lazy email rotation (banned_devices catches it)
- ✅ Single-app uninstall + reinstall (IDFV survives)
- ✅ Uninstalling every vendor app + reinstalling on iOS (Keychain survives — the ~60s evasion is now closed)
- ✅ Cross-email enforcement (mirror)
- ❌ Factory reset / "Erase All Content and Settings" — accepted
- ❌ Different physical device — accepted

### Stronger options (not implemented)
- **Apple DeviceCheck** — 2 bits of Apple-managed state per device, survives factory reset. Closes everything except a different physical iPhone. Requires Apple Dev Portal capability + .p8 key + iOS native bridge + CF validator. ~1-2 days of work. Not done; current Keychain approach is sufficient per product call.
- **Play Integrity / Firebase App Check** — Android equivalent. Same status: not done.

---

### Group push fan-out (notifyGroupNewMessage)
Reads memberIds from Firestore `groups/{groupId}`, pulls each member's mute flag from Supabase `group_meta_data` in one round-trip, then `sendEachForMulticast` over the surviving fcmTokens (read from RTDB, still source of truth for tokens). Sender is excluded.

### Known issue — sender display name shows "Someone" on first message between two users
[functions/notifyNewMessages.example.js:138](functions/notifyNewMessages.example.js#L138) reads `senderName` from `chatRow.receiver_name` on the **receiver's** `chat_meta_data` row. Two race/ordering issues:
1. The `private_messages` insert fires the webhook (and thus the CF) BEFORE the client's `send_private_chat_meta` RPC has finished writing the receiver-side row, so on the very first send the lookup returns null and the push falls back to "Someone".
2. Subsequent sends are fine because the receiver-side row exists by then.

**Suggested fix**: have the CF read `displayName` + `photoURL` from RTDB `/users/{senderId}` (which is still the source of truth for user fields) instead of going through `chat_meta_data`. This eliminates the race and is consistent with how the same CF already reads `fcmToken` from RTDB at line 130.

---

## Play Console analytics

### Scripts (in `scripts/`)
- `play-fetch.js` — pulls vitals (crash, ANR, slow starts, wakeups), reviews (last ~7 days), error issues, anomalies, install reports. Writes CSVs to `analytics/<YYYY-MM-DD>/`.
- `play-summary.js` — prints per-version weighted dashboard from the CSVs.
- `play-reply.js` — drafts replies to unanswered reviews. Dry-run by default; `--post` to actually post.

### Run it
```bash
node scripts/play-fetch.js          # default package: com.bloxfruitevalues
PLAY_PACKAGE=com.bloxfruitstock node scripts/play-fetch.js  # other variant
node scripts/play-summary.js        # after fetch
node scripts/play-reply.js          # dry-run, prints drafts
node scripts/play-reply.js --post   # actually post replies
```

### First-run findings (2026-05-06)
- v130 (latest, 137k user-days) regressed badly: **0.70% crash rate (3.7× v113), 0.90% ANR (5.6× v113)**. Top error issues are in `analytics/2026-05-06/error_issues.csv` — investigate top crashers by `errorReportCount`.
- 13 recent reviews: 8★5 / 2★3 / 3★1. Worst is a moderation complaint (admin abuse claim).
- Install reports failed — SA needs `Storage Object Viewer` on `pubsite_prod_<dev-id>` Cloud Storage bucket. Not blocking.

### One-time setup that's already done
- SA `quality-test@quality-blox.iam.gserviceaccount.com` invited to Blox Fruit Play Console
- Play Android Developer API + Play Developer Reporting API enabled in `quality-blox` GCP project

### One-time setup that's still pending
- Storage Object Viewer on the `pubsite_prod_*` bucket (for daily install/uninstall CSVs) — not blocking analytics pipeline

---

## Action items still pending (post-2026-05-07 cutover)

These are the unfinished steps blocking the migration build from shipping. Do them in order.

### 1. Apply the new SQL migrations in Supabase SQL editor — partially done
Run each file's contents, in order. Idempotent — safe to re-run.
- [x] `supabase/005_client_msg_id.sql` (2026-05-07)
- [x] `supabase/006_message_moderation.sql` (2026-05-07)
- [x] `supabase/007_meta_writable_by_owner.sql` (2026-05-07) — opened `chat_meta_data` to client writes
- [x] `supabase/008_meta_rpcs.sql` (2026-05-07)
- [x] `supabase/009_private_messages.sql` (2026-05-07)
- [x] `supabase/010_group_messages.sql` (2026-05-07)
- [x] **`supabase/011_send_private_chat_meta.sql`** (2026-05-07) — SECURITY DEFINER pair-write RPC. Required for 3.8.9+ builds. Verified live via `select proname from pg_proc where proname = 'send_private_chat_meta';` returning 1 row.

### 2. Deploy the new notification CFs ✅ DONE (2026-05-08)
The user runs `firebase deploy` from `/Volumes/Sohail/cloud functions/Firebase Stock/functions/` after pasting [functions/notifyNewMessages.example.js](functions/notifyNewMessages.example.js) into that deployment's `index.js`.
- [x] Deployed `notifyPrivateMessage` + `notifyGroupNewMessage` (verified via `firebase functions:list`; both v1 HTTPS in us-central1, nodejs22)
- [x] `ensureRoleClaim` and `setSupabaseRoleClaim` also confirmed deployed
- The legacy RTDB-triggered `notifyNewMessage` stays deployed as a no-op (renaming the new one to `notifyPrivateMessage` avoids the trigger-type-change conflict).

### 3. Configure 2 Supabase Database Webhooks (Dashboard-only, no CLI)
Dashboard → **Database** → **Webhooks** → New webhook, twice:

**Webhook 1 — Private**
- Name: `notify-new-private-message`
- Table: `public.private_messages`
- Event: INSERT
- URL: the deployed `notifyPrivateMessage` CF URL
- Header: `x-webhook-secret` = the value of Firebase secret `SUPABASE_WEBHOOK_SECRET`

**Webhook 2 — Group**
- Name: `notify-new-group-message`
- Table: `public.group_messages`
- URL: deployed `notifyGroupNewMessage` CF URL
- Same `x-webhook-secret` header

### 4. Smoke test in dev build
- [ ] Send a public chat message → row in `public.messages` with `client_msg_id` set, `rtdb_key` null
- [ ] Pin/unpin → rows appear/disappear in `pinned_messages`
- [ ] Send a private message → both `chat_meta_data` rows update, `unread_count` bumps by 1 on receiver, push lands
- [ ] Send a group message → every member's `group_meta_data.last_message` updates, every non-sender's `unread_count` bumps, push fans out
- [ ] Mute a chat / group → next send: no push, others still get one
- [ ] Admin "delete all from user" in public + private + group → rows flip `deleted = true`
- [ ] Report a private + public message twice → second report soft-deletes
- [ ] Check Cloud Function logs for `notifyPrivateMessage` / `notifyGroupNewMessage`

### 5. Wait for role-claim backfill to finish (~3–4h from 2026-05-07)
Currently running in background via the throttled script. Without the claim, those users can't use Realtime (REST works but channels never deliver events). Track progress with the count script in [scripts/](scripts/) or just `tail -f` the running script's output. Roughly 174k still pending at last check.

If you need it faster, request a quota bump on `identitytoolkit.googleapis.com → setCustomUserClaims` in [GCP Console → Quotas](https://console.cloud.google.com/iam-admin/quotas), then bump `CONCURRENCY` in `scripts/set-supabase-role-claim.js` from 3 to ~50.

### 6. Bump version + ship release build
- [x] Bumped Android version to **versionCode 135 / versionName 3.8.10** in [android/app/build.gradle](android/app/build.gradle) (2026-05-08; was 134/3.8.9, superseded by Keychain + ban-card improvements)
- [x] Built signed AAB at `android/app/build/outputs/bundle/release/app-release.aab` (Crashlytics mapping uploaded automatically) (2026-05-08)
- [ ] iOS Info.plist version bump + `pod install` (required because `react-native-keychain` was added) + IPA build. iOS currently at MARKETING_VERSION 6.9.6 / CURRENT_PROJECT_VERSION 85
- [ ] Upload AAB to Play Console (recommend staged rollout 10% first)
- **Old users** stop seeing new chats from new users (chat list, private bodies, group bodies). Per user direction, "don't care about old users". Force-update prompt on the old build is recommended but not implemented.

---

## Outstanding work / next agent priorities

### 1. Investigate v130 crash + ANR regression — HIGH (partial mitigation in place)
v130 vs v128 vs v113 crash rates suggest a regression introduced around v126 (not v130 specifically — v130 just has more daily users). Top error issues + sample report IDs are in `analytics/<latest>/error_issues.csv`. Cross-reference with Crashlytics dashboard for stack traces.

**Mitigation applied 2026-05-06:** `patches/react-native+0.83.4.patch` ports the `ReactViewGroup.getChildDrawingOrder()` fix from adoptme-jan7. The unpatched version throws `IndexOutOfBoundsException` when children are added/removed during the draw pass, which surfaces as `libreactnative.so / google::logging_fail() / SIGABRT` — the top crash in error_issues.csv (425 reports / 270 distinct users, v126→v130). Patch is applied via the `postinstall` script (`patch-package`); next `npm install` will apply it. Verify in next release.

**`ReactTextView.<init>` / `ReactClippingViewManager.removeViewAt` ANR cluster — partial mitigation 2026-05-06:**
The dominant ANR pattern (~840+ reports across ~13 issues) was MessagesList re-rendering every visible chat row on every new message. Three FlatList anti-patterns at [MessagesList.jsx:706-712](Code/ChatScreen/GroupChat/MessagesList.jsx#L706-L712):
1. `data={[...new Map(...).values()]}` — new array reference per render
2. `renderItem={({item, index}) => renderMessage(...)}` — fresh arrow function per render
3. `renderMessage` depended on `messages` (used for `messages[index+1]` date-header lookup), so every new message recreated the callback and forced a full row tear-down

Fix: `dataItems` and `dateHeaderById` are now memoized once per `messages` change (id-keyed lookup replaces the index walk), `renderItem` is a stable `useCallback` reference, and `keyExtractor` no longer mixes id+index. Net effect: when a single new message arrives, FlatList re-renders only the new row, not all 15 visible rows. This should cut the dominant ANR cluster substantially.

**Other top issues NOT mitigated yet** (need Crashlytics stack traces):
- `SurfaceMountingManager.getViewState / RetryableMountingLayerException` (401 reports / 87 users, v126→v130) — Fabric mounting race; second-biggest crash family. Worth disabling new arch on a test build to see if it disappears.
- `NativeAnimated.connectAnimatedNodes` JSApplicationIllegalArgumentException (51 reports / 31 users) — Animated API misuse, likely a stale node reference after unmount
- `MainApplication.onCreate` ANRs during FCM RECEIVE (~62 reports) — push-driven cold-start is too slow; defer non-critical RN modules
- AdMob lifecycle ANRs (`com.google.android.gms.ads.internal.util.ca/q` on SCREEN_ON/OFF) — ad init/teardown blocking main thread on screen state changes
- `JsonMapper.parseJson` OOM (4 reports, v130) — likely a large RTDB snapshot blowing the heap; with the Supabase migration this will improve as RTDB reads drop

### 2. Ship the migration build (see "Action items still pending" above for the full ship checklist)

### 3. Future RTDB → Supabase phases
The chat ecosystem is fully migrated. What remains on RTDB intentionally:
- `users/{uid}/*` writes (cosmetics, coins, rewardPoints, fcmToken, email, presence) — atomic counter concerns + notification CFs depend on RTDB shape
- `private_messages/{chatId}/trade` — separate trade-request feature, not chat
- `private_messages/{chatKey}/lastRead/*`, `unread/*` — read receipts, lower priority
- `gameInvites/`, `gameRooms/`, `fruitCrash/`, etc. — game state, defer indefinitely

### 4. Fill in `versionName` map in `play-summary.js` for labeled tables.

---

## Post-ship monitoring (first 48 hrs after release)

| Where | What to watch |
|---|---|
| Firebase Console → Functions → Logs | `notifyPrivateMessage` / `notifyGroupNewMessage` errors. 401s = webhook secret mismatch; 500s = real bugs. Mirror CFs should go quiet (very few RTDB writes). |
| Supabase Dashboard → Database → Webhooks | Delivery dashboard for both webhooks: failure rate should be < 1% |
| Supabase Dashboard → Database → Reports | Disk IO % (t4g.micro budget), dead-tuple % on chat_meta_data + group_meta_data + private_messages + group_messages (target < 5%), connection count, realtime subscribers |
| Firebase → Database → Usage | RTDB egress should drop substantially within hours — only `users/*` writes + read-receipts subpaths still active |
| Crashlytics | Any new RN-side errors mentioning `supabase`, `chatBackend`, `chatMetaBackend`, `groupMetaBackend`, `privateMessagesBackend`, `groupMessagesBackend` |
| Play Console (or `play-fetch.js`) | Crash rate / ANR rate for the new version vs v130 |

**If chat itself breaks**: flip `SUPABASE_READS_ENABLED = false` only reverts reads — writes have no fallback. To fully revert, ship the prior build that still wrote to RTDB. There is no in-place hotfix path.

**If notifications break**: webhook misconfig is the most common cause. Verify `x-webhook-secret` matches `SUPABASE_WEBHOOK_SECRET` in both places; check delivery history for the failing webhook.

---

## Quick reference — common commands

```bash
# Run the migration backfill scripts (idempotent, can re-run safely)
export SUPABASE_URL=https://jaimyhmanefvrijvjzxl.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<from Firebase secrets>
node scripts/backfill-chat-meta-to-supabase.js
node scripts/backfill-users-to-supabase.js

# Sanity-check Supabase row counts
SUPABASE_SERVICE_ROLE_KEY=<key> node -e "
const { createClient } = require('@supabase/supabase-js');
const s = createClient('https://jaimyhmanefvrijvjzxl.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const tables = ['user_identity','user_roblox','user_roles','user_cosmetics','user_notifications','user_settings','user_badges','user_blocks','chat_meta_data','group_meta_data','messages','pinned_messages'];
(async () => { for (const t of tables) { const { count } = await s.from(t).select('*', { count: 'exact', head: true }); console.log(t.padEnd(22), count?.toLocaleString()); }})();
"

# VACUUM via Management API (no CLI needed)
PAT='<personal-access-token>'
curl -sS -X POST "https://api.supabase.com/v1/projects/jaimyhmanefvrijvjzxl/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -d '{"query":"VACUUM ANALYZE public.<table>;"}'

# Check mirror CF logs
firebase functions:log --only mirrorChatMetaToSupabase,mirrorGroupMetaToSupabase,mirrorUsersToSupabase,mirrorPublicChatMessageToSupabase,mirrorPublicChatMessageDeleteToSupabase,mirrorPublicChatPinToSupabase --lines 100

# Deploy a single function
firebase deploy --only functions:<name>

# Fetch Play Console analytics
node scripts/play-fetch.js && node scripts/play-summary.js
```

---

## Important warnings for the next agent

### DO NOT
- **Don't migrate `users/{uid}/fcmToken` or `email` to Supabase.** The notification CFs read them from RTDB.
- **Don't delete the legacy `notifyNewMessage` RTDB-trigger CF.** It's a no-op after the cutover, but deleting it would force a deploy reorder. Just leave it.
- **Don't put the service role key or webhook secret in client code.** Server-side only.
- **Don't change the renamed CF names** (`notifyPrivateMessage`, `notifyGroupNewMessage`) without also updating the Supabase webhook URLs.

### DO
- Read `SUPABASE_MIGRATION.md` for the migration's "why".
- Read the sibling project (`/Volumes/Sohail/AI_Projects/adoptme-jan7/`) for the canonical pattern reference and the full post-mortem of the same migration done previously.
- Check Cloud Function logs (`firebase functions:log`) before assuming Supabase is at fault.
- When adding a new RTDB→Supabase path: add the table to `supabase/`, write the backend module in `Code/Supabase/`, wire UI consumers, add per-feature flag if needed.

### Sharp edges encountered during the 2026-05-07 cutover
- **`functions.runWith is not a function`**: newer firebase-functions versions split v1/v2 APIs. The mirror CFs use `require('firebase-functions/v1')` — the new notification CFs do too. If you copy paste from old docs that just `require('firebase-functions')`, you'll hit this.
- **"Changing from background-triggered to HTTPS not allowed"**: hit when redeploying `notifyNewMessage` as HTTPS over the existing RTDB-onCreate version. Worked around by renaming to `notifyPrivateMessage`. Same trap will hit anyone doing similar trigger-type swaps.
- **Identity Toolkit quota on `setCustomUserClaims`**: ~10 QPS per project sustained. Looser concurrency in the role-claim script triggers retry storms. Tuned to `CONCURRENCY=3, INTER_BATCH_SLEEP_MS=250` (~12 QPS) in `scripts/set-supabase-role-claim.js`.

---

## Open questions for the user (not blocking)

1. Has the new build with all the migration code been shipped to Play / App Store yet?
2. Was the v130 crash regression a known issue, or is it new since this analysis?
3. Should we set up a weekly cron to run `play-fetch.js` + alert on regressions?
4. Do you want a force-update prompt on old builds, since chat is now broken for them?

---

## Memory notes (auto-memory system)

The auto-memory system at `/Users/apple/.claude/projects/-Volumes-Sohail-AI-Projects-Blox-Fruit/memory/` has these entries:
- `project_reference.md` — adoptme-jan7 is the sibling reference
- `feedback_simple_first.md` — check styles before adding state for layout bugs
- `project_supabase_migration.md` — RTDB→Supabase mirror-CF pattern, see SUPABASE_MIGRATION.md

Next agent should update or add memories as project state evolves.
