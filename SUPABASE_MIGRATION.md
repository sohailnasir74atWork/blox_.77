# Blox Fruit — RTDB → Supabase Migration

**Reference**: Mirrors the proven pattern from sibling project `adoptme-jan7` (`RTDB_MIGRATION_HANDOFF.md`).

**Status**: 🚧 In progress (started 2026-05-05)

**Supabase project URL**: `https://jaimyhmanefvrijvjzxl.supabase.co`
**Region**: `ap-southeast-1` (Singapore) — good for Asian players
**Instance**: `t4g.micro` — fine for Phases 1–3; watch IO during Phase 4 backfill (upgrade to `t4g.small` for the run, downgrade after if cost matters)

---

## Strategy (same as adoptme)

**RTDB stays the source of truth.** The app keeps writing to RTDB unchanged. Cloud Functions tail RTDB writes and mirror to Supabase. New clients READ from Supabase; old app versions never know Supabase exists. Backward-compatible by construction.

- ✅ **Writes**: stay on RTDB (every CF + every old app version keeps working)
- ✅ **Mirror CFs**: 1–2s lag from RTDB → Supabase
- ✅ **Reads**: new clients read Supabase, fall back to RTDB on miss
- ✅ **Auth**: Firebase Auth + Third-Party Auth (Supabase verifies Firebase ID tokens; no auth migration)
- ✅ **Backfill**: one-time script per phase, idempotent
- ✅ **Reset writes** (e.g. unread count clear): direct Supabase UPDATE for instant UX, mirror CF reconciles later

---

## Scope of this update (locked in 2026-05-05)

| Phase | Feature | Pattern | Tables |
|---|---|---|---|
| 0 | Foundation | — | (auth helper SQL, client.js, _supabaseAdmin.js) |
| 1 | **Public chat** (Trader.jsx — 15 channels: chat_new_upgrade, chat_es_upgrade, …, chat_ph_upgrade + pin_messages) | Mirror CF | `rooms`, `messages`, `message_reactions`, `pinned_messages` |
| 2 | **Private chat metadata** (`/chat_meta_data/{uid}/{partner}`) | Mirror CF | `chat_meta_data` |
| 3 | **Group chat metadata** (`/group_meta_data/{uid}/{groupId}`) | Mirror CF | `group_meta_data` |
| 4 | **Users data split** (`/users/{uid}` → 8 narrow tables) | Mirror CF | `user_identity`, `user_roblox`, `user_roles`, `user_cosmetics`, `user_notifications`, `user_settings`, `user_badges`, `user_blocks` |

---

## Out of scope this update (deferred — leave on RTDB)

These stay on RTDB **forever** or until a future phase:

- `/users/{uid}/fcmToken` — every notification CF reads it directly
- `/users/{uid}/notifyMessages`, `/notifyGroupMessages` — mute prefs (notification CFs)
- `/users/{uid}/coins`, `rewardPoints`, `xp`, `purchases` — economy fields (atomic counter risk)
- `/users/{uid}/cosmetics` (active items) — write-heavy, deferred like adoptme
- `/users/{uid}/checkin` — small, low-cost
- `/users/{uid}/selectedFruits` — game state
- `/private_messages` — full message bodies (Phase 5 in adoptme; not this update)
- `/group_messages` — same
- `chat_*_upgrade/{id}/reactions` (live reactions on public chat) — handled inline with messages
- `/buy_posts`, `/sell_posts` — trade posts (future)
- `/saved_trades` — trade journal (future)
- `/egg_shop` — mystery egg / cosmetics shop (future)
- `/fruitCrash` — real-time game state (high-frequency, low value to migrate)
- `/calcData`, `/notifications`, `/monitor` — stock scraper paths (Cloud Function-owned)
- `/gameInvites`, `/gameRooms` — pet guessing game
- `/banned_users`, `.info/connected` — keep as-is
- **All of Firestore** — scammer DB, groups, groupInvitations, reviews, user_ratings_summary stay on Firestore (separate migration track if ever needed)

---

## Key adapted differences vs adoptme-jan7

| Aspect | adoptme | Blox Fruit |
|---|---|---|
| Public chat channels | 10 | **15** (added: raid, help, playing, ar, id, ph) |
| Public chat path | `chat_<lang>` | `chat_<lang>_upgrade` |
| Users `/users/{uid}` extra fields | — | `coins`, `selectedFruits`, `purchases`, `isGrinder`, `isRaider`, `isCMSR`, `checkin` |
| User roles | is_admin, is_moderator, is_baby_mod, is_trusted, is_cmsr | **+ is_grinder, is_raider** |
| Roblox username | yes | yes (same shape) |
| Notification flag prefix | `notifyMessages`, `notifyGroupMessages` | same |
| Mute trade notifs | yes | yes |
| Reminder toggles | yes | yes |
| Badges | yes | yes |
| Blocked users | `/users/{uid}/blocked_users` | same path, same shape |

---

## Repository layout (new directories created by this migration)

```
Blox_Fruit/
├── supabase/
│   ├── 000_init.sql                          # firebase_uid() helper, run-once
│   ├── 001_public_chat.sql                   # Phase 1
│   ├── 002_chat_metadata.sql                 # Phase 2 + 3 (chat_meta + group_meta)
│   └── 003_users_split.sql                   # Phase 4
├── functions/
│   ├── _supabaseAdmin.js                     # shared service-role client
│   ├── mirrorPublicChatToSupabase.js         # Phase 1 (NEW writes only — read backfill is one-shot)
│   ├── mirrorChatMetaToSupabase.js           # Phase 2
│   ├── mirrorGroupMetaToSupabase.js          # Phase 3
│   ├── mirrorUsersToSupabase.js              # Phase 4
│   └── index.js                              # re-exports (UPDATED)
├── scripts/
│   ├── backfill-chat-meta-to-supabase.js     # Phase 2+3 backfill
│   ├── backfill-users-to-supabase.js         # Phase 4 backfill
│   └── backfill-public-chat-to-supabase.js   # Phase 1 backfill (last 30 days only — older messages are dead weight)
├── Code/Supabase/
│   ├── client.js                             # auth-aware Supabase client
│   ├── chatBackend.js                        # Phase 1 reads
│   ├── chatMetaBackend.js                    # Phase 2 reads
│   ├── groupMetaBackend.js                   # Phase 3 reads
│   └── userBackend.js                        # Phase 4 reads
└── SUPABASE_MIGRATION.md                     # this file
```

---

## Deployment checklist (per phase)

### Before any client read swap

1. **Apply schema** — Supabase SQL Editor → paste `supabase/00X_<phase>.sql` → Run
2. **Set Firebase secrets** (once, after Phase 0)
   ```
   firebase functions:secrets:set SUPABASE_URL
   firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
   ```
3. **Deploy mirror CF** for that phase
   ```
   firebase deploy --only functions:mirror<Phase>ToSupabase
   ```
4. **Sanity-check mirror live**: trigger one RTDB write → confirm row appears in Supabase within 2s
5. **Run backfill** (idempotent — safe to re-run)
   ```
   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
     node scripts/backfill-<phase>-to-supabase.js
   ```
6. **Run VACUUM ANALYZE** after backfill (Supabase SQL Editor or CLI):
   ```sql
   VACUUM ANALYZE public.<table>;
   ```
7. **Ship app build** with read swap

### After ship

8. Watch Cloud Function logs for upsert errors (`firebase functions:log --only mirror<Phase>ToSupabase --lines 200`)
9. Watch Supabase dashboard for query latency, dead-tuple % (target < 5%)
10. Monitor RTDB egress dashboard — should drop noticeably as new builds adopt

---

## Operational lessons (carried over from adoptme post-mortem)

These apply automatically — `client.js` and the schemas already encode them:

1. **JWT timing on cold-start**: `client.js` waits on `_authReady` (handles RN Firebase's double `onAuthStateChanged` fire — null first, real user 1–3s later). Without this, Realtime opens with no JWT and rejects with `InvalidJWTToken`.
2. **App-state reconnect**: `client.js` calls `supabase.realtime.connect()` when app returns from background — silent dead WebSockets are common after network switch / OS reclaim.
3. **Channel topic suffix**: every realtime subscription suffixes the topic with `${Date.now()}-${Math.random()}` — supabase-js returns the existing channel for duplicate topics, which causes "cannot add postgres_changes callbacks after subscribe()" when two components subscribe for the same uid.
4. **REPLICA IDENTITY FULL**: every realtime-published table sets this — without it, UPDATE payloads omit unchanged columns and DELETE filters on non-PK columns silently fail.
5. **Mirror CF lag bypass**: for instant UX (clearing unread badge), client writes direct to Supabase too — RTDB write + mirror CF reconciles within 2s. See `resetUnreadCount()` in `chatMetaBackend.js`.
6. **Autovacuum tuning**: high-churn upsert tables (chat_meta, group_meta) get `autovacuum_vacuum_scale_factor = 0.01` (1% threshold). Default 20% is too loose — adoptme hit a disk-IO incident at 73% dead rows. **Run VACUUM ANALYZE manually after each backfill.**
7. **VACUUM in SQL editor doesn't work** (can't run in transactions). Use Supabase CLI:
   ```
   SUPABASE_ACCESS_TOKEN=<pat> npx supabase db query --linked "VACUUM ANALYZE public.<table>;"
   ```
8. **Backfill resilience**: backfill scripts retry transient `fetch failed` errors with exponential backoff (10 retries, ~4 min total). Idempotent upserts make retry safe.

---

## Progress log

### 2026-05-05 — Migration kickoff + all phase code landed
- ✅ Strategy locked in
- ✅ Sibling project (adoptme) reference files read
- ✅ Blox Fruit codebase mapped (50 files touch RTDB; 15 public-chat channels; 18 realtime listeners)
- ✅ Supabase project created (`jaimyhmanefvrijvjzxl`, ap-southeast-1, t4g.micro)
- ✅ **Phase 0 done** — `client.js`, `_supabaseAdmin.js`, `000_init.sql`, deps added
- ✅ **Phase 1 done** — public chat schema, mirror CFs, backfill, `chatBackend.js`
- ✅ **Phase 2 done** — chat_meta_data schema, mirror CF, backfill, `chatMetaBackend.js`
- ✅ **Phase 3 done** — group_meta_data schema, mirror CF, backfill, `groupMetaBackend.js`
- ✅ **Phase 4 done** — users 8-table split, mirror CF, backfill, `userBackend.js`
- ✅ `functions/index.js` updated to export 6 new mirror CFs
- ⏳ Pending: user actions below + component-level read swap

### Pending user actions (BLOCKING — without these the new code is dormant)

#### 1. Get Supabase keys
- [ ] **Publishable (anon) key** — Supabase Dashboard → Project Settings → API → "anon public" → paste into `Code/Helper/Environment.js` (replace `__PASTE_ANON_KEY_HERE__`)
- [ ] **Service role key** — same page → "service_role secret" → keep this private!

#### 2. Configure Third-Party Auth
- [ ] Supabase Dashboard → Authentication → Sign In / Up → Third-Party Auth → **Add Firebase**
- [ ] Paste your Firebase project ID
- [ ] Verify by running `select public.firebase_uid();` in SQL editor — should return null when unauthed

#### 3. Apply SQL schemas in Supabase SQL editor (in order)
- [ ] `supabase/000_init.sql` — `firebase_uid()` helper
- [ ] `supabase/001_public_chat.sql` — Phase 1 tables
- [ ] `supabase/002_chat_metadata.sql` — Phase 2 + 3 tables
- [ ] `supabase/003_users_split.sql` — Phase 4 tables

#### 4. Set Firebase secrets (for the mirror CFs)
```bash
firebase functions:secrets:set SUPABASE_URL
# paste: https://jaimyhmanefvrijvjzxl.supabase.co
firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
# paste: <service role key from step 1>
```

#### 5. Install dependencies
```bash
# project root
npm install
# functions
cd functions && npm install
```

#### 6. Deploy mirror CFs
```bash
firebase deploy --only functions:mirrorPublicChatMessageToSupabase,functions:mirrorPublicChatMessageDeleteToSupabase,functions:mirrorPublicChatPinToSupabase,functions:mirrorChatMetaToSupabase,functions:mirrorGroupMetaToSupabase,functions:mirrorUsersToSupabase
```

#### 7. Run backfill scripts (one per phase, idempotent)
```bash
# Set env once:
export SUPABASE_URL=https://jaimyhmanefvrijvjzxl.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Phase 1 — public chat (defaults to last 30 days; override with BACKFILL_DAYS=N)
node scripts/backfill-public-chat-to-supabase.js

# Phase 2 + 3 — chat / group metadata
node scripts/backfill-chat-meta-to-supabase.js

# Phase 4 — users (slowest; expect minutes for 10k+ users)
node scripts/backfill-users-to-supabase.js
```

#### 8. Run VACUUM ANALYZE after backfill (Supabase CLI, not SQL editor)
```bash
SUPABASE_ACCESS_TOKEN=<personal-access-token> npx supabase db query --linked \
  "VACUUM ANALYZE public.messages; VACUUM ANALYZE public.chat_meta_data; VACUUM ANALYZE public.group_meta_data; VACUUM ANALYZE public.user_identity; VACUUM ANALYZE public.user_roblox; VACUUM ANALYZE public.user_roles; VACUUM ANALYZE public.user_cosmetics; VACUUM ANALYZE public.user_notifications; VACUUM ANALYZE public.user_settings; VACUUM ANALYZE public.user_badges; VACUUM ANALYZE public.user_blocks;"
```

#### 9. Smoke test in dev build
- Send a public chat message → confirm it appears in Supabase `messages` table within 2s
- Open a private chat → confirm `chat_meta_data` row updates
- Update profile → confirm `user_identity` row updates
- Check Cloud Function logs for any `[mirror...]` errors

#### 10. (After dev validation) wire components
- See "Component wiring guide" below
- Ship app build to production — old users keep working forever via RTDB

---

## Component wiring guide (Phase 1–4 read swap)

This is the only step that touches user-visible code paths. Each swap is
**additive with RTDB fallback** — if Supabase returns null/empty, the
old RTDB path still runs. So even if the mirror CF is broken, the app
still works.

### Phase 1: public chat (Trader.jsx)
- File: `Code/ChatScreen/GroupChat/Trader.jsx`
- Current pattern: `dbQuery(activeRef, orderByKey(), limitToLast(PAGE_SIZE))` + `onChildAdded(...)`
- Swap to:
  ```js
  import { loadMessages, subscribeToMessages, loadPinnedMessages, subscribeToPinned } from '../../Supabase/chatBackend';

  // Initial load
  const initial = await loadMessages(activeChannel.path, { limit: PAGE_SIZE });

  // Realtime stream
  const unsub = subscribeToMessages(activeChannel.path, {
    onInsert: (msg) => setMessages(prev => [msg, ...prev]),
    onDelete: (id) => setMessages(prev => prev.filter(m => m.id !== id)),
  });
  ```
- Pinned: `loadPinnedMessages(roomId)` + `subscribeToPinned(roomId, ...)` replaces the `onChildAdded(pinnedMessagesRef)` block
- **Writes still go to RTDB** (line 671 `push(chatRef, ...)` unchanged)

### Phase 2: chat metadata (ChatNavigator.js + InboxScreen.jsx)
- Files: `Code/ChatScreen/ChatNavigator.js` (line 67), `Code/ChatScreen/GroupChat/InboxScreen.jsx` (line 60)
- Current pattern: `onChildAdded(userChatsRef, ...)` on `chat_meta_data/{user.id}`
- Swap to:
  ```js
  import { subscribeToChatMeta, resetUnreadCount } from '../Supabase/chatMetaBackend';

  const unsub = subscribeToChatMeta(user.id, {
    onUpsert: (row) => setChats(prev => upsertById(prev, row, 'partnerId')),
    onRemove: (partnerId) => setChats(prev => prev.filter(c => c.partnerId !== partnerId)),
    onReady: () => setLoading(false),
  });
  ```
- For instant unread clear (chat enter): also call `resetUnreadCount(user.id, partnerId)` alongside the existing RTDB `unreadCount: 0` write

### Phase 3: group metadata (ChatNavigator.js)
- File: `Code/ChatScreen/ChatNavigator.js` (line 136 — userGroupsRef)
- Same pattern as Phase 2 but with `subscribeToGroupMeta` + `resetGroupUnreadCount`

### Phase 4: user profile (profile cache + chat headers + drawer)
- Files: anywhere we currently `get(ref(appdatabase, \`users/${uid}\`))` — e.g.:
  - `Code/Helper/profileCache.js` — central place
  - `Code/ChatScreen/PrivateChat/PrivateChatHeader.jsx`
  - `Code/ChatScreen/GroupChat/OnlineUsersList.jsx`
  - `Code/ChatScreen/GroupChat/BottomDrawer.jsx`
  - `Code/AppHelper/AdminDashboard.js`
- Recommended: update `profileCache.js` to race Supabase + RTDB:
  ```js
  import { getIdentity, getRoles, getCosmetics, getRoblox } from '../Supabase/userBackend';

  // Wave-by-wave: race Supabase, fall back to RTDB on null
  const identity = await getIdentity(uid);
  if (identity) return identity;
  // … existing RTDB path runs as fallback
  ```
- Batch reads: use `getIdentityBatch(uids)`, `getRobloxBatch(uids)` for multi-user fetches (online list, drawer)


## Why this is safe to ship to production

1. **No write-path changes.** Every RTDB write happens exactly as before. Old app versions read RTDB and see new app versions' messages because they go through RTDB first.
2. **Fallback on null.** Every Supabase read returns null on miss/error. Calling code falls back to RTDB.
3. **Gradual user adoption.** Old users on the old build stay on RTDB. New users on the updated build read from Supabase. Both groups see each other because writes still fan into RTDB.
4. **Mirror CF is the only path that's load-bearing in a new way.** If a mirror CF crashes, we lose the staging-to-Supabase pipeline temporarily — but no data loss (RTDB has the truth) and no user impact (clients fall back).

---

## File index (will populate as files land)

### Code (client)
- `Code/Supabase/client.js` — Supabase client, Firebase-auth-aware (Phase 0)
- `Code/Supabase/chatBackend.js` — Phase 1 reads
- `Code/Supabase/chatMetaBackend.js` — Phase 2 reads
- `Code/Supabase/groupMetaBackend.js` — Phase 3 reads
- `Code/Supabase/userBackend.js` — Phase 4 reads

### Cloud Functions (mirrors)
- `functions/_supabaseAdmin.js` — service-role client (Phase 0)
- `functions/mirrorPublicChatToSupabase.js` — Phase 1
- `functions/mirrorChatMetaToSupabase.js` — Phase 2
- `functions/mirrorGroupMetaToSupabase.js` — Phase 3
- `functions/mirrorUsersToSupabase.js` — Phase 4

### Supabase schemas
- `supabase/000_init.sql` — firebase_uid() helper (Phase 0)
- `supabase/001_public_chat.sql` — Phase 1
- `supabase/002_chat_metadata.sql` — Phase 2 + 3
- `supabase/003_users_split.sql` — Phase 4

### Backfill scripts
- `scripts/backfill-public-chat-to-supabase.js` — Phase 1
- `scripts/backfill-chat-meta-to-supabase.js` — Phase 2 + 3
- `scripts/backfill-users-to-supabase.js` — Phase 4
