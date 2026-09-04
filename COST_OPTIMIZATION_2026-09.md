# Cost Optimization Audit — Blox Fruit — 2026-09-03

Covers **both consumers of the same backend**: the React Native app
(`RunningApps/Blox_Fruit`) and the Next.js site (`RunningWebsites/blox-web`).
Firebase project `fruiteblocks`, Supabase project `jaimyhmanefvrijvjzxl`
(ap-southeast-1, Pro plan, Micro compute).

Everything in §0–§2 is **measured** (Cloud Monitoring, a live RTDB profile,
Firestore aggregation counts, live rules, deployed function sources). §3
(Supabase) is **not measured** — no token or CLI exists on this machine; it lists
exactly what to pull from the dashboard and the SQL to run. Raw data and the
two code audits are in `docs/cost-audit-2026-09/`; the measurement scripts are
in `scripts/cost/` (see §6 to re-run).

---

## 0. Measured baseline — Firebase

Cloud Monitoring, 30 days (2026-08-04 → 2026-09-03). Daily numbers are flat all
month (`docs/cost-audit-2026-09/daily-30d.txt`): this is steady state, not a spike.

| Meter | 30-day measured | Free allowance | Unit price | ≈ Billed / month |
|---|---:|---|---|---:|
| RTDB egress (billed bytes incl. protocol overhead) | **70.6 GB** (payload only 18.8 GB) | 10 GB | $1 / GB | **≈ $61** |
| Firestore document reads | **76.5 M** (99.9% QUERY) | 50k / day | $0.06 / 100k | **≈ $45** |
| Cloud Functions v1: 8.8 M invocations, ≈0.93 M GHz-s, ≈0.6 M GB-s, 5.5 GB egress | | 2 M / 200k / 400k / 5 GB | | ≈ $10 |
| Cloud Run (`fruitCrashController` v2): 348k billable vCPU-s | | 180k | $0.000024 / s | ≈ $4 |
| Cloud Scheduler: 15 jobs (4 orphaned) | | 3 | $0.10 / job | ≈ $1.2 |
| Firestore writes 0.74 M, deletes 43k | | 20k / day | $0.18 / 100k | < $1 |
| RTDB storage 0.78 GB · Logging 7.3 GB | | 1 GB · 50 GB | | $0 |
| **Total metered** | | | | **≈ $122 / month** |

Confirm against Billing → Reports (SKU view). The billing account
`0113EC-D15F0A-C4F031` also carries project `saleforec-10ce7`; make sure that is
yours and in use.

**Scale markers.** `/users` = **203,497** records (avg 685 B, max 82 KB, 137 MB
total). RTDB avg **209** concurrent connections. Firestore avg 95 connections,
20 snapshot listeners. Per day: **8.5 M** RTDB listen ops + 8.4 M unlisten,
0.7 M sets, 110k onDisconnect, 2.5 M Firestore doc reads, ~22k app cold starts
(derived). Firestore root collections: `trades_new` 916k docs (legacy),
`trades_new_upgrade` 375k, `reviews` 98k, `notifications` 78k, `following` 71k,
`subscriptions` 41k, `group_join_requests` 29k, `designPosts` 29k,
`group_invitations` 25k, `designPosts_upgrade` 24k, `statuses` 20k,
`user_ratings_summary` 19k, `groups` 1k (28 total).

**Where the money is: RTDB egress and Firestore reads (~$106 of ~$122).**
Functions are 8.8 M invocations for ~$10 — big volume, small dollars.

### The RTDB egress is operation count, not data

Billed bytes are 3.75× payload bytes. The live 5-minute profile
(`docs/cost-audit-2026-09/profile-analysis.txt`, 93,474 ops = **312 ops/s**)
shows why — almost everything is a tiny `get()`:

| Op (5 min) | Count | → / day |
|---|---:|---:|
| listener-listen (one-shot reads) | 44,070 | 12.7 M |
| listener-unlisten | 43,578 | 12.6 M |
| realtime-write | 2,593 | 0.75 M |
| listener-broadcast | 1,906 | 0.55 M |
| on-disconnect-put | 435 | 0.13 M |
| concurrent-connect | 308 | 89k |

Top read paths (share of all listens): `users/$uid/shop/activeItems` **23%**,
`users/$uid/lastGameWinAt` **21%**, `users/$uid/hasRecentGameWin` **19%**, then
15 individual role/identity leaves (`isPro`, `isModerator`, `isTrusted`,
`isGrinder`, `isRaider`, `isSeniorMod`, `admin`, `isBabyMod`, `fcmToken`,
`displayName`, `avatar`, `flage`, `topBadge`, `createdAt`, `badges`) at ~1.5%
each ≈ **24%** together. Single clients were observed issuing 600+ of each of the
top three in 90 seconds. Total payload of every listen in the window: 2.4 MB.

(One 137 MB REST read of `/users` inside the window was **my own** sampling
request — `curl/8.7.1` from this Mac — and is excluded everywhere. ~$0.14.)

---

## 1. Findings — Firebase (ranked by $ saved ÷ effort)

### F1 — Three per-user RTDB lookups in `profileCache` are 64% of all RTDB reads  ≈ −$35–40/mo
**Severity: high · Effort: small · Risk: low**

`getOrFetchProfile` / `warmProfileCache` (`Code/Helper/profileCache.js:126,156-157,250-252`)
already pull identity/roles/roblox/cosmetics from Supabase in one batched call per
20 uids — then issue **three separate RTDB `get()`s per uid** for
`shop/activeItems`, `hasRecentGameWin`, `lastGameWinAt`. Every public-chat page
(`Trader.jsx:334,812,889`), every message-list update (`MessagesList.jsx:321`,
effect on `[messages]`), the trades list (`Trades.jsx:952`, 30 posters), the inbox
(`InboxScreen.jsx:232`, 15 chats) and every new public message from an uncached
sender (`Trader.jsx:537`) warm fresh uids; the MMKV cache TTL is 30 min.

**Fix.** The mirror CF already writes `profile_frame / chat_text_color /
trade_card_bg / profile_banner / chat_bubble_bg` into `user_cosmetics`
(`mirrorCosmetics` in the deployed `mirrorUsersToSupabase`), so read cosmetics
from the Supabase batch you already have and delete the RTDB `shop/activeItems`
read. Add `last_game_win_at bigint` to `user_identity` (one column + add
`lastGameWinAt` to `IDENTITY_KEYS` in the CF) and drop both game-win reads —
`hasRecentGameWin` is derived from `lastGameWinAt` (24 h window) in
`resolveProfile` already. Result: 0 RTDB ops per profile fetch (−3) ⇒ ≈ −8 M RTDB
ops/day ⇒ ≈ −60% of RTDB listen/unlisten volume.

### F2 — `/users` (203k records, emails + FCM tokens) is world-readable; 79/105 nodes world-writable  (risk cap)
**Severity: critical · Effort: rules edit · Risk: old builds reading other users' RTDB profile**

Live rules (`/.settings/rules.json`, identical to repo `database.rules.json`):
`users: { ".read": true, "$userId": { ".read": true } }`. Verified with an
unauthenticated `curl` returning `email`, `fcmToken`, `deviceId`, `online`. One
anonymous `GET /users.json` = 137 MB = $0.14 with no rate limit, plus PII for every
user; FCM tokens allow pushes to arbitrary users. 83 of 105 top-level nodes are
`.read: true`, 79 are `.write: true` (including `calcData`, `previousStock`,
`feedRanking`, `mods`, `tradeStats`, `leader_board`, `chat_meta_data`,
`private_messages`, `xlsData`).

**Fix (console → Realtime Database → Rules, then keep `database.rules.json` in sync):**
```json
"users": {
  ".read": false,
  "$userId": { ".read": "auth != null", ".write": "<existing self-write rule>" }
}
```
The app reads other users' public fields from Supabase `user_*` now; notification
CFs use the Admin SDK and bypass rules. Then set `.write: false` on every
CF-owned node (`calcData`, `previousStock`, `notifications`, `monitor`,
`feedRanking`, `mods`, `leader_board`, `tradeStats`) and `auth != null` on the
rest. The website's whole-`users` read (W1) must be fixed first or it breaks.

### F3 — Server-time probe + two unconditional writes hit `users/{uid}` on every launch → 190k CF invocations/day  ≈ −$7/mo
**Severity: medium · Effort: small · Risk: none**

Same bug as adoptme F1, worse: `getServerTime` (`Code/Helper/serverTime.js:40-41`)
writes `serverTimestamp()` to `users/${uid}/_st` and reads it back. It is called
with `forceProbe=true` **twice per cold start for every user** —
`checkDailyStreak` (`badgeUtils.js:443` ← `MainTabs.js:45`) and `getStarStatus`
(`starUtils.js:49` ← `HomeTabScreen.jsx:171`) — plus BadgesScreen ×2, MysteryEgg,
claims, and a **60 s loop for banned users** (`HomeTabScreen.jsx:196-205`).
`GlobelStats.js:383` (`deviceId` update) and `:496` (`isPro` set, same value) add
two more unconditional `/users` writes per launch.

Profile: 261 `_st` writes / 5 min ≈ 75k/day = **79% of the 95k/day
`mirrorUsersToSupabase` invocations** (2.85 M/mo, 512 MB, all no-ops) — and the
identical count on **`syncModRoster`** (2.85 M/mo), which the deployed
`mirrorUsersToSupabase` already absorbed (`mirrorModsRoster`; its own header says
"delete the old trigger").

**Fix.** Probe at `_serverTime/${uid}` (+ rule `".write": true, ".read": "auth != null"`),
share the 30 s cache (`forceProbe=false` for the two launch callers), write
`deviceId`/`isPro` only when they differ from the `users/{uid}` snapshot already
fetched at `GlobelStats.js:305`, and `firebase functions:delete syncModRoster`.
−5.7 M invocations/mo, −~570k GB-s.

### F4 — RTDB per-field profile fallback fires ~200k times/day, 15 reads each  ≈ −$10–12/mo
**Severity: medium · Effort: small · Risk: none**

`profileCache.js:181-195` falls back to 15 leaf `get()`s when Supabase returns no
`user_identity` row (or errors / JWT race). Profile: ~700 fallbacks / 5 min ≈ 10k
reads / 5 min ≈ **24% of RTDB listens**. `/users` has 203k records; only 142k were
backfilled (HANDOFF) and `mirrorIdentity` only writes on an identity-field change,
so ~60k users have no row. The same 5–15× fallback pattern exists in
`OnlineUsersList.jsx:221-266`, `PrivateChatHeader.jsx:93-125`, `BottomDrawer.jsx:302-354`.

**Fix.** Re-run `scripts/backfill-users-to-supabase.js` for uids without a
`user_identity` row, and make every fallback read `users/${uid}` **once** (1 op,
~600 B) instead of 15 leaves. Log when a fallback triggers so a Supabase outage
is visible instead of silently multiplying RTDB reads.

### F5 — `GlobalGroupInviteToast` polls Firestore every 45 s for every client, all session  ≈ −$8–15/mo
**Severity: high (Firestore) · Effort: small · Risk: none**

Root-mounted (`index.js:103`). Two `getDocs` queries every 45 s
(`GlobalGroupInviteToast.jsx:148-154,200` on `group_invitations`; `:234-246,303` on
`fruitGuessingGame_userInvites/{me}/invites`) plus both again on every foreground.
An empty result still bills one read. 3,840 reads/day per always-open client; with
95–209 concurrently connected clients that is **0.4–0.8 M reads/day = 15–30% of
all Firestore reads**, and the interval is not AppState-gated (Android keeps JS
timers running in background).

**Fix.** One `onSnapshot` on `group_invitations where invitedUserId==me AND
status==pending` (idle listener = 0 reads, delivers only on change) or an FCM data
message on invite creation; delete the second poll (the pet-game invite system is
dead code per the audit). At minimum gate on `AppState==='active'` and use 5 min.

### F6 — Trades / Design / Chat / Home focus refetches  ≈ −$10–15/mo (Firestore) and ≈ −$5 (RTDB)
**Severity: medium · Effort: medium · Risk: low**

| Where | What | Per event |
|---|---|---|
| `Trades.jsx:877-921,318-323,952` | 20 + 10 trades + `following` (≤200) + 90 RTDB profile gets, on mount, every filter toggle, every pull-to-refresh | ≤230 reads + 90 ops |
| `DesignMainScreen.js:234-268` + `StatusFeed.js:351-397,293` | 5 posts + `following` 200 + 60 + 40 statuses per first open | ≈300 reads |
| `HomeTabScreen.jsx:112-133` | `user_profiles/{me}` lookup **and** `users/{uid}/shop/activeItems` RTDB get (+ expiry `set(null)`) on **every Home focus** | 2 reads + 1 op |
| `CommunityChatHeader.jsx:38-84` | invitations query + join-request count on every Chat focus | 2+ |
| `GroupsScreen.jsx:162-250` | 3 unbounded `onSnapshot`s re-attached on every Groups focus (each attach re-bills the result set) | ~3+ |
| `NotificationFeed.js:66-84` | 20 docs on every focus, restarts from top | 20 |
| `BottomDrawer.jsx:1140-1754` | ~8–10 reads per profile-drawer open | 8–10 |

**Fix.** Cache `following` in MMKV (1 h, as StatusFeed does); keep feeds in memory
across tab switches; use mount-scoped `useEffect` instead of `useFocusEffect` for
cheap-to-keep listeners; read cosmetics from `cosmeticsCache.getMyCosmetics()`;
badge counts from the shared chat-meta stream instead of re-querying.

### F7 — Presence / active-chat lifecycle churn is most of the 700k sets + 110k onDisconnect per day  (≈ −$3–5/mo)
Profile writes/5 min: `activeChats/$uid` 812 (+412 onDisconnect, 798 broadcasts),
`presence/$uid` 449, `private_messages/$key/lastRead|unread` 842. `setActiveChat`
(`utils.js:539-547`) does 2 sets + 1 onDisconnect on **every focus and every
foreground** of a chat; the presence effect (`GlobelStats.js:879-1013`) re-runs
when `isAdmin/isUserBlocked/showOnlineStatus` resolve after login (cleanup
`set(false)` → `set(true)` → re-arm). Arm onDisconnect once per connection, write
`activeChats` only on focus change, move the deps to refs.

### F8 — Whole-node reads for one field (payload egress)  (≈ −$3–5/mo)
`GlobelStats.js:305` reads the entire `users/{uid}` subtree on every auth resolve
(shop inventory, submissions, counters, purchases…); `PrivateChat.jsx:117`,
`BadgesScreen.js:292`, `gameInviteSystem.js:33`, `groupUtils.js:190,320,810`,
`Setting.jsx:1403,1463` read other users' whole nodes; `calcData`/`previousStock`
are re-read on every pull-to-refresh (`reload()`), `fruitCrash/leaderboard` (all
players ever) per mount + tab, `like_counter` whole node, `news` polled every 5 min,
and a broad `users` `limitToFirst(500)` search fallback (`OnlineUsersList.jsx:470`,
`SocialDashboard.js:347,462`, `AdminDashboard.js:630`) that ships 500 full records
per search. Read only needed leaves; server-maintained top-N docs; `limit()` everywhere.

### F9 — Functions housekeeping  ≈ −$5/mo
- `fruitCrashController` (Cloud Run v2, every minute, 14 ms of work) bills 8 s per
  run = 97 h/month ≈ $4. Redeploy as a v1 pub/sub function like the others.
- Four orphaned Cloud Scheduler jobs fire into **deleted** topics:
  `sendScheduledPromoMessageMM2` (1 min), `sendScheduledUpdate` (1 min),
  `sendScheduledPromoMessageSailor` (5 min), `sendScheduledPromoMessage` (paused).
  `gcloud scheduler jobs delete <name> --location us-central1 --project fruiteblocks`.
- `checkStockUpdates`: headless Chrome at 1 GB, 5,760 runs/mo × 19 s = 12% of all
  function compute, 56 crashes + 15 timeouts. Content diff already confirms a
  rotation, so `0-30/4` halves it.
- `notifyPrivateMessage` = 2.8 M webhook calls/mo (one per Supabase
  `private_messages` insert), 395 ms each — the single largest function cost (~$4).
  It does a Supabase read + RTDB `fcmToken` read + FCM send; batch nothing, but do
  skip the CF when the recipient is in the chat (`activeChats`) — most sends are.
- `registerForNotifications` runs 3× per launch (`GlobelStats.js:387,400,417`).

### W — Website (`blox-web`, Firebase only; no Supabase)
Full table in `docs/cost-audit-2026-09/web-usage-audit.md`.

- **W1 — whole `users` tree (137 MB) read on every desktop chat-room mount by a
  signed-in visitor** (`src/lib/firebase/database.ts:118`, `getOnlineUsersWithData`)
  after a whole-`presence` read. Not seen in the 5-min profile window, so it is
  rare — but each hit is $0.14 and it is what F2's rule change would break. Query
  `presence` `orderByValue().equalTo(true)` (indexed) then leaf-read ≤50 users, or
  use Supabase `user_identity`.
- **W2 — `TradeList.tsx:88` polls Firestore every 30 s**, also in hidden tabs
  (28,800 reads/day per tab). Gate on visibility, ≥2 min.
- **W3 — homepage `TopRatedTrades.tsx:42-64`**: 8 uncached reads per view (N+1).
  Serve from the existing ISR `fetchTopTradersServer()`.
- **W4 — every signed-in visitor holds an RTDB socket on every page**
  (`Providers.tsx:29-30`: presence + ban listener) and rewrites `presence` on every
  tab switch (`database.ts:54-62`). Mount only on `/chat*`.
- **W5 — split-brain chat**: the site still reads/writes RTDB `chat_*_upgrade`,
  `private_messages`, `group_messages`, `chat_meta_data`, `group_meta_data`; the app
  is Supabase-only, so web DMs never reach app users (no mirror, no push) while web
  meta writes are mirrored and create empty inbox rows in the app. Web
  `users/{uid}/activeChat` writes (`database.ts:458/462`) fire
  `mirrorUsersToSupabase` twice per DM view. Port web chat to the Supabase tables
  or remove it.
- `calcData` is 1.9 KB, so the SSR `/stock` reads and the orphan `/api/stock` route
  are noise (delete the route anyway). `GroupsList.tsx:44` fetches 200 groups to show 12.

---

## 2. Savings summary (Firebase)

| Fix | Meter | ≈ Saving / month |
|---|---|---:|
| F1 profile extras → Supabase | RTDB egress | $35–40 |
| F4 fallback → 1 read + backfill | RTDB egress | $10–12 |
| F5 invite polling → listener | Firestore reads | $8–15 |
| F6 focus refetches | Firestore reads + RTDB | $12–18 |
| F3 probe + duplicate CF | Functions | $6–8 |
| F9 Cloud Run + orphans + stock cadence | Functions/Run/Scheduler | $5–6 |
| F7 + F8 lifecycle churn, whole-node reads | RTDB | $6–10 |
| W2 + W3 website polling / N+1 | Firestore reads | $2–5 |
| S1 realtime fan-out + meta echo + channel churn | Supabase realtime | $40–50 |
| S2 chat-meta delta load, batched profiles, retention | Supabase egress | $15–20 |
| S5 reindex + vacuum | Supabase disk | $1 |
| **Total** | | **≈ $140–190 of ≈ $246 (Firebase $122 + Supabase $124)** |

F1 + F3 + F5 + F9-orphans are one-day changes and cover about half of that.

---

## 3. Supabase — measured from invoice NOQSGF-00009 (Jul 28 – Aug 27, 2026)

Supabase bills the **organization**, summing both projects against one quota:
`jaimyhmanefvrijvjzxl` = Blox Fruit, `kvtbtzhtcaanhjblyick` = adoptme-chat.
Total **$124.04**.

| Line | Blox Fruit | adoptme-chat | Org total | Included | Net charge |
|---|---:|---:|---:|---|---:|
| Pro plan | | | | | $25.00 |
| Compute (Micro, 744 h each) | $10.00 | $10.00 | $20.00 | $10 credit | $10.00 |
| **Realtime messages** | **27,050,455 (87%)** | ~4.1 M | **31,187,237** | 5 M | **$67.50** (32 packages × $2.50 − $12.50) |
| **Egress** | **251.8 GB** | 229.7 GB | 481.4 GB | 250 GB | **$20.82** |
| Third-Party MAU | **49,772** | ~23.8k | **73,535** | 100k | $0.00 |
| Realtime peak connections | 363 | ~88 | 451 | 500 | $0.00 |
| Disk (GB-hours over 8 GB) | 4,182 GB-h ≈ 5.6 GB over | 0 | | 8 GB/project | $0.72 |
| Cached egress / storage | | | | | $0.01 |

So the earlier MAU worry is **not** current cost (26k headroom org-wide, but every
user counts, so growth will hit it). The database was then measured directly on
2026-09-03 through the Management API (`pg_stat_statements` covers the last 18
days; raw output in `docs/cost-audit-2026-09/supabase-diag*.txt`, script in
`scripts/cost/supabase_diag.py`).

**DB facts.** 8.7 GB (just over the 8 GB included). `private_messages` 5.1 GB
(1.9 GB heap + **3.2 GB indexes = 1,191 B of index per 709 B row**, bloated by the
retention purge's 6.9 M deletes), `chat_meta_data` 1.5 GB / 2.65 M rows,
`messages` 1.05 GB / 2.0 M rows (public chat, no retention since May),
`net._http_response` **642 MB for 28k rows** (pg_net webhook log, never
vacuumed). Retention cron `purge_private_messages('30 days', 5000)` runs every
minute and keeps up (oldest private message = 30 days). Traffic: ~85k private
messages/day, ~15k public messages/day (**97.6k of the last 7 days' 105k are in
`chat_new_upgrade`**), ~700 group messages/day.

### S1 — Realtime messages: 27 M/month ≈ $58 — public-room fan-out, then meta echo
Live `realtime.subscription` at 22:22 PKT: 108 bindings on `messages` from 29 users
(105 of them on `chat_new_upgrade`), 240 on `chat_meta_data` from 51 users, 219 on
`group_meta_data`, 111 on `private_messages`, 96 on `pinned_messages`. Each app
channel registers three bindings (INSERT/UPDATE/DELETE), so 3 rows = 1 channel,
and **41 of 41 chat-meta users had more than one** (162 rows ÷ 41 = 4 ⇒ ~1.3
channels each). Bindings are created and destroyed **~890k times a day** (16 M
inserts + 16 M deletes in 18 days; median subscription age 2 min) — the "shared,
session-long" chat-meta channel is in practice re-created constantly (foreground
refresh, `bannedUsers` identity re-subscribe, the rejoin sweep). 99 bindings
belong to **anon** tokens (Firebase JWT not yet resolved) that can never receive a
row but still cost a subscription.

Cost model: `chat_new_upgrade` ≈ 14k INSERTs/day × 20–100 live subscriber channels
= **0.3–1.4 M deliveries/day** — the bulk of the 900k/day billed. `chat_meta_data`
UPDATEs (232k/day; every private message touches both sides, `resetUnreadCount`
on every chat focus and blur) × online owners × 1.3 channels adds ~100k/day.

Fixes, in payoff order:
1. **Public room**: pause the room subscription after 60 s idle instead of 3 min,
   and subscribe to `INSERT` only (soft-deletes/edits can ride the existing
   gap-fill query on focus). Or drop realtime for `chat_new_upgrade` altogether
   and poll `loadMessagesSince` every 3–5 s while the room is on screen — REST
   requests are unmetered, so 35 viewers polling is ≈ 18 GB/month of egress (~$2)
   versus ≈ 15 M messages (~$37).
2. **Meta channels**: one binding with `event: '*'` instead of three (cuts the
   per-change RLS query — currently 35 % of all DB time, see S3 — by 3×); never
   re-create the shared channel on `bannedUsers` changes; skip
   `resetUnreadCount` when `unread_count` is already 0; do not subscribe until the
   Firebase JWT has resolved (kills the anon bindings).
3. Target: **≤ 8 M messages/month ⇒ ≈ −$45.**

### S2 — Egress 252 GB/month ≈ $22 — four roughly equal sources
| Source | Evidence (18 days) | ≈ GB/month |
|---|---|---:|
| Full chat-list load `loadChatMeta` (`.range()` pages of 1000) | 709,801 calls, **98 ms mean, 7.9 s max, 69,868 s total = #2 DB-time consumer**; p90 owner has 84 rows, p99 502, max 3,252 | 30–40 |
| Realtime payloads (REPLICA IDENTITY FULL ⇒ old + new row per UPDATE) | 27 M deliveries × ~1 KB | 30–35 |
| Per-uid profile lookups: `user_roles` / `user_roblox` / `user_cosmetics` **11.5 M calls each**, `user_identity` 7.2 M, + 4.2 M batched each | ≈ 2.5 M REST requests/day, 4 round trips per profile | 30 + header overhead |
| `private_messages` / `messages` page loads | 3.9 M + 1.9 M calls | 40–50 |

Fixes: persist the chat-meta cursor in MMKV so a session loads only the delta
(`loadChatMetaSince` already exists) and cap the cold load to the 50 most recent
rows; collapse the 4 per-uid profile requests into the existing batch call (or one
view) and raise the profile TTL to 24 h; add a public-chat retention (nothing
older than 30 days is ever paged). ≈ **−100 GB ⇒ back under the org's 250 GB
⇒ −$20.**

### S3 — Database load: Realtime's RLS check is 35 % of all DB time
`SELECT wal->>… ` (Realtime evaluating RLS per subscription per change): 5.05 M
calls, **126,070 s** in 18 days, 25 ms each. Plus the subscription-churn query
(16 M calls, 10,461 s) and the full chat-meta load (69,868 s). On a Micro (2 vCPU,
1 GB) this is what will force a compute upgrade first. S1's fixes (fewer
bindings, no churn) cut it directly.

### S4 — The cosmetics / roles mirror is silently broken
`user_cosmetics` and `user_roles` have had **0 inserts and 0 updates in 18 days**
(`user_identity`: 231k updates). `user_cosmetics` only has `top_badge`, `is_pro`
— the columns `mirrorCosmetics` writes (`profile_frame`, `chat_text_color`, …)
do not exist, so every upsert fails and Pro/top-badge changes never reach the
app. F1's fix (read cosmetics from Supabase) needs `004_users_split` columns
applied first; that also un-breaks the badge display.

### S5 — Disk: reclaim ~2.5 GB, drop below the 8 GB included
`reindex index concurrently` the six `private_messages` indexes (3.2 GB → ~1.2
GB) and `vacuum full net._http_response` (642 MB → ~10 MB), both via the
Management API `database/query` endpoint (SQL editor wraps in a transaction and
cannot run them). Add `messages` retention (e.g. 60 days). −$0.72/month, but
mostly RAM/IO headroom on the Micro.

### S6 — Compute
Two Micro instances, one credit: $10 net. Nothing to cut unless a project is
retired. Watch S3 — a forced upgrade to Small is +$5/month.

### What to pull next

**Known from code (kept for context).** Pro plan ($25) + Micro compute (covered by the $10 credit).
Every signed-in user attaches a Firebase ID token to every Supabase call, and
`GlobelStats.js:552` calls the `set_last_activity` RPC for **every** user every 6 h
— so **Third-Party MAU ≈ app MAU**, not "chat users". Pro includes 100,000
Third-Party MAU, then **$0.00325 per user** ([pricing doc](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users-third-party)).
With 203k registered users and ~22k cold starts/day, MAU of 150–300k is plausible
⇒ **$160–650/month**, which would dwarf everything else in this document.

Other meters with a plausible overage:
- **Realtime messages** (5 M included, $2.50/M): each public-chat INSERT is
  delivered — and billed — once per focused subscriber in that room
  (`chatBackend.js:228-249`), across 15 rooms; plus `resetUnreadCount` on every chat
  focus/blur echoes an UPDATE to the user's own meta channel.
- **Realtime peak connections** (500 included, $10/1000): chat-tab users hold 2
  channels (`chat_meta_data`, `group_meta_data`) all session plus 1–2 per open room.
- **Egress** (250 GB): `loadChatMeta` pages the **whole** chat list (1000/page) on
  first subscribe per session (`chatMetaBackend.js:63-84`) and `loadChatMetaSince`
  on every foreground/Inbox mount; `chat_meta_data` has 1.07 M rows.
- **Disk** (8 GB, $0.125/GB): `chat_meta_data` + `private_messages` (retention
  only added in 026 on 2026-08-19) — check dead-tuple % too (adoptme hit 73%).

1. ~~Usage page for the Blox project~~ — received (numbers above). Still useful:
   the "Egress >" detail page (Database vs Realtime split) and the "Realtime
   Messages >" daily chart.
2. ~~Latest invoice~~ — received (above).
3. ~~Personal access token~~ — received and stored at `~/.supabase/access-token`
   (chmod 600). **Revoke it in Account → Access Tokens when the follow-up work is
   done**; it was pasted in chat.

**If Third-Party MAU is the cost:** the lever is to stop attaching the Firebase
token to requests that do not need it. Public-read tables (`user_identity`,
`user_roles`, `user_cosmetics`, `user_roblox`, `messages`, `pinned_messages`,
`polls`) can be read with the publishable key alone (RLS `select` for `anon`), so
users who only browse never count; only users who write (chat, votes, username)
would. Move `set_last_activity` to a CF-side write from the RTDB `lastActivity`
mirror instead of a client RPC.

---

## 4. Order of work

1. **Day 1, no app release needed:** F2 rules (after W1), F3 `syncModRoster`
   delete, F9 orphan schedulers + `fruitCrashController` as v1, Supabase Usage page.
2. **Next app build:** F1 (cosmetics from `user_cosmetics`, `last_game_win_at`
   column + CF key), F3 probe path + conditional `deviceId`/`isPro`, F4 single-node
   fallback + backfill, F5 listener instead of polling, F6 `following` cache +
   Home-focus reads.
3. **Website deploy:** W1, W2, W3, W4; decide W5.
4. **Then re-measure** (§6) — expect RTDB listens −80%, `/users` writes −90%,
   Firestore reads −40–50%.

---

## 4a. Backward-compatibility review (app is in production; old builds must keep working)

Rule applied to every item: **server-side changes are additive only**; anything
that removes or renames a field, path, table column or rule an existing build
uses is out. Client-side fixes ship in the next build, so old builds keep paying
their share until they update — estimates below are at full adoption.

| Finding | Where the change lives | Old builds keep working? | Notes / what stays for old builds |
|---|---|---|---|
| F1 profile extras → Supabase | app + **additive** schema (`user_identity.last_game_win_at`, `user_cosmetics` cosmetic columns) + one key in the CF key list | ✅ | Old builds keep reading the 3 RTDB leaves (RTDB stays the source of truth, nothing is removed). Saving ramps with adoption. |
| F2 `/users` world-readable | RTDB rules | ⚠️ **only in the staged form below** | Stage 1 (safe for every build): `users.".read": "auth != null"` and `users/$uid.".read": "auth != null"` — blocks anonymous scraping only; all signed-in reads, per-field fallbacks and `orderByChild` searches keep working. **One dependency:** the website's public profile page reads `users/{uid}` while logged out (`blox-web src/lib/firebase/database.ts:33`) — point it at Supabase `user_identity` (anon-readable) or a server route first. Stage 2 (`".read": false` at the root) only after every client search moved to Supabase. Write-locks (`.write: false`) only on nodes no client writes: `calcData`, `previousStock`, `notifications`, `monitor`, `feedRanking`, `mods`, `leader_board` (verified against the app write audit). Leave `chat_meta_data` / `private_messages` / `group_*` writable for `auth != null` — pre-May builds still write them. |
| F3 `_st` probe → `_serverTime/{uid}` | app + one **added** rule | ✅ | Old builds keep writing `users/{uid}/_st` (still allowed). `firebase functions:delete syncModRoster` is safe for all builds — the deployed `mirrorUsersToSupabase` already does its job. |
| F4 fallback → single read + backfill | app + additive data (rows inserted) | ✅ | |
| F5 invite polling → listener | app | ✅ | |
| F6 focus refetches, F7 lifecycle churn, F8 whole-node reads | app | ✅ | |
| F9 Cloud Run → v1, orphan schedulers, stock cadence | server only | ✅ | `fruitCrashController` v2→v1 means delete + recreate the function; RTDB shape unchanged, clients never call it. Do it between rounds (each round is ~45 s). |
| W1–W4 website | web only | ✅ | |
| W5 split-brain web chat | web only | ✅ | Removing web chat affects web users only; app builds unaffected. |
| S1 realtime bindings / churn / idle pause / polling option | app | ✅ | Old builds keep 3 bindings and the 3-min idle window. |
| S1 anon-binding fix (wait for JWT before subscribing) | app | ✅ | |
| S2 chat-meta delta load, batched profiles | app | ✅ | |
| S2 public-chat retention (delete `messages` older than N days) | DB data | ✅ functionally | Old builds page with a cursor; rows that no longer exist simply are not returned. Pick N ≥ 60 days to be safe. **Needs your go-ahead** (it deletes data). |
| S4 add cosmetics columns to `user_cosmetics` | DB schema, additive | ✅ | Old clients select explicit columns; extra columns are invisible to them. |
| S5 `reindex index concurrently` on `private_messages` | DB maintenance | ✅ | Online, no lock on reads/writes. |
| S5 `vacuum full net._http_response` | DB maintenance | ⚠️ brief exclusive lock (seconds) on the webhook log table only | Webhook deliveries queue during the lock; run off-peak, or skip — it is $0.72/month of disk. **Needs your go-ahead.** |
| F9 skip `notifyPrivateMessage` when recipient is in the chat | CF only | ✅ | |

**Adoption lever (compatible):** the app already has version gates
(`noman_app_version`, `ios_version` RTDB nodes + `sp-react-native-in-app-updates`).
A soft "update available" nudge for the build that carries F1/F3/F5/S1 brings
the savings forward without blocking anyone.

## 4b. Change map — where each edit is made

### 1. Supabase
**Dashboard / SQL (additive, safe for old builds)** — new file `supabase/027_cosmetics_columns_game_win.sql`, paste in SQL Editor:
- `alter table public.user_cosmetics add column if not exists profile_frame jsonb, add column if not exists chat_text_color jsonb, add column if not exists trade_card_bg jsonb, add column if not exists profile_banner jsonb, add column if not exists chat_bubble_bg jsonb;` (S4 — un-breaks the mirror)
- `alter table public.user_identity add column if not exists last_game_win_ms bigint;` (F1)
- Maintenance via Management API (`scripts/cost/supabase_diag.py` pattern): `reindex index concurrently` on the six `private_messages` indexes (S5, online). `vacuum full net._http_response` and any `messages` retention cron — **only with go-ahead**.

**Cloud Function (mirror)** — `/Volumes/Sohail/cloud functions/Firebase Stock/functions/index.js` (`mirrorUsersToSupabase`, the deployed copy) and the repo mirror `functions/mirrorUsersToSupabase.js`: add `'lastGameWinAt'` to `IDENTITY_KEYS` and `last_game_win_ms: asNumber(after.lastGameWinAt)` to the identity row. Deploy with `firebase deploy --only functions:mirrorUsersToSupabase`.

**App code (`Code/Supabase/*` and callers)**
- `Code/Supabase/userBackend.js` — `COSMETICS_COLS` + `fromCosmeticsRow` gain the five cosmetic columns; identity columns gain `last_game_win_ms`.
- `Code/Helper/profileCache.js:126,156-157,250-252` — delete the three RTDB `get()`s; take cosmetics from the Supabase row, derive `hasRecentGameWin` from `lastGameWinAt` (24 h). `:37` TTL 30 min → 24 h. `:181-195` fallback → one `get(users/{uid})`.
- `Code/Supabase/chatMetaBackend.js:317-359` and `Code/Supabase/groupMetaBackend.js:242-284` — one `event: '*'` binding instead of INSERT/UPDATE/DELETE (S1/S3).
- `Code/Supabase/chatMetaBackend.js:63-110` — persist the `updated_at` cursor in MMKV; cold start calls `loadChatMetaSince`, full `loadChatMeta` only when no cursor, capped to the newest 50 rows (S2).
- `Code/Supabase/chatMetaBackend.js:120-129` + callers `Code/ChatScreen/PrivateChat/PrivateChat.jsx:710,735` — skip `resetUnreadCount` when `unread_count` is already 0.
- `Code/Supabase/chatBackend.js:228-249` — public room binding INSERT-only; `Code/ChatScreen/GroupChat/Trader.jsx:143` idle pause 3 min → 60 s; optional: poll `loadMessagesSince` (`chatBackend.js:160-181`) every 3–5 s for `chat_new_upgrade` instead of realtime.
- `Code/ChatScreen/ChatNavigator.js:166`, `Code/ChatScreen/GroupChat/InboxScreen.jsx:195` — drop `bannedUsers` from the subscription effect deps (no re-subscribe).
- `Code/Supabase/client.js` — do not open channels until `_authReady` resolved with a user (kills the anon bindings).
- `Code/ChatScreen/GroupChat/BottomDrawer.jsx:267-269`, `Code/ChatScreen/PrivateChat/PrivateChatHeader.jsx:64-66`, `profileCache.js:123-126` — use `getCachedProfile` / the batch call instead of 3–4 single-uid requests.

**Cloud Function (webhook target)** — `notifyPrivateMessage` in the Firebase Stock `index.js`: optional early return when the recipient's `activeChats/{uid}` equals the chat.

### 2. Firebase Realtime Database
**Rules** — edit `database.rules.json` in the repo **and** paste into Console → Realtime Database → Rules (rules are not deployed from the repo today):
- `users.".read": "auth != null"`, `users/$userId.".read": "auth != null"` (stage 1); add `"_serverTime": { "$uid": { ".read": "auth != null", ".write": "auth != null && auth.uid === $uid" } }`.
- `.write: false` on `calcData`, `previousStock`, `notifications`, `monitor`, `feedRanking`, `mods`, `leader_board` (CF-owned).
- Before stage 1: `blox-web/src/lib/firebase/database.ts:33` public-profile read must move to Supabase `user_identity` or a server route.

**App code**
- `Code/Helper/serverTime.js:39-41` — probe path `_serverTime/${uid}`.
- `Code/ChatScreen/GroupChat/badgeUtils.js:443`, `Code/Engagement/starUtils.js:49` — `forceProbe=false` for the two launch callers.
- `Code/GlobelStats.js:383` (`deviceId`) and `:496` (`isPro`) — write only when different from the snapshot already read at `:305`.
- `Code/GlobelStats.js:387,400,417` — call `registerForNotifications` once.
- `Code/HomeTab/HomeTabScreen.jsx:131` — `getActiveCosmetics` per focus → `cosmeticsCache.getMyCosmetics()`.
- `Code/GlobelStats.js:879-1013` — presence effect: read `isAdmin/isUserBlocked/showOnlineStatus` via refs, arm `onDisconnect` once per connection.
- `Code/ChatScreen/utils.js:539-641` — `setActiveChat` on focus change only, not on every AppState flip.
- `Code/ChatScreen/GroupChat/OnlineUsersList.jsx:196-238`, `PrivateChatHeader.jsx:67-107`, `BottomDrawer.jsx:271-338` — per-field RTDB reads → cached profile.
- `Code/ValuesScreen/News.js:221`, `Code/Engagement/FruitCrash.jsx:297`, `Code/ValuesScreen/HDwallpaper.js:72`, search scans `OnlineUsersList.jsx:470`, `SocialDashboard.js:347,462` — bound or remove whole-node reads.

**Functions / infra (CLI, no client impact)**
- `firebase functions:delete syncModRoster --project fruiteblocks`.
- `gcloud scheduler jobs delete sendScheduledPromoMessageMM2 | sendScheduledUpdate | sendScheduledPromoMessageSailor | sendScheduledPromoMessage --location us-central1`.
- `fruitCrashController`: source exists only in `gs://gcf-v2-sources-409137828081-us-central1/fruitCrashController/` (copy in `docs/`? no — re-download); add to the Firebase Stock `index.js` as a v1 `pubsub.schedule('every 1 minutes')`, deploy, delete the v2 one between rounds.
- `checkStockUpdates`: `STOCK_CHECK_CRON` in the Firebase Stock `index.js` → `0-30/4 1-23/2 * * *`.

**Website (`RunningWebsites/blox-web`)** — `src/lib/firebase/database.ts:118` (whole `users` read → presence query + ≤50 leaf reads or Supabase), `src/components/Providers.tsx:29-30` (mount presence/ban only on `/chat*`), `database.ts:54-62` (presence write per tab switch), `database.ts:458/462` (`users/{uid}/activeChat` writes → remove).

### 3. Firestore
No rules or index changes; all client code.
- `Code/ValuesScreen/GlobalGroupInviteToast.jsx:148-154,200` — one `onSnapshot` on `group_invitations` instead of the 45 s poll; `:234-246,303` — remove the pet-game invite poll (dead feature).
- `Code/Trades/Trades.jsx:318-323` — cache `following` in MMKV (1 h); `:877-921` — keep the feed in memory across tab switches; `:434` — add `limit()`.
- `Code/Design/DesignMainScreen.js:263-268` — same `following` cache; `:125-141` — add `limit()`.
- `Code/HomeTab/HomeTabScreen.jsx:117-118` — `user_profiles` lookup once per session, not per focus.
- `Code/ChatScreen/GroupChat/CommunityChatHeader.jsx:38-84` — derive invite/join badges from the chat-meta stream or cache 5 min.
- `Code/ChatScreen/GroupChat/GroupsScreen.jsx:162-250` — mount-scoped listeners with `limit()`, not per focus.
- `Code/Engagement/NotificationFeed.js:66-84` — keep the first page in memory across focuses.
- `Code/ChatScreen/GroupChat/BottomDrawer.jsx:1140-1146` — pair check with `limit(1)` and cache.
- `Code/ChatScreen/utils/ratingSummaryHelper.js:39-44` — incremental summary (the inline computation at `PrivateChat.jsx:308-316` already exists); drop the full scan.
- `limit()` on: `Code/AppHelper/SocialDashboard.js:179`, `Code/ChatScreen/utils/groupUtils.js:624,637,1593,1676,1689`, `Code/ChatScreen/PrivateChat/Scamwarning.js:64`.
- Website: `src/components/trades/TradeList.tsx:88` (30 s poll → visibility-gated, ≥2 min), `src/components/home/TopRatedTrades.tsx:42-64` (serve from the ISR `fetchTopTradersServer()`), `src/components/chat/GroupsList.tsx:44` (limit 200 → 12 with cursor), `src/app/[locale]/(main)/trades/[id]/page.tsx:18,48` and `feed/[id]/page.tsx:20,50` (`React.cache()` + `revalidate`).

## 7. Implementation status — 2026-09-04

Everything below is backward compatible: server-side changes are additive or
behaviour-preserving, client changes only reduce frequency/volume, and no path,
field or collection an old build uses was renamed or removed. Nothing is
committed to git — review `git status` in both repos.

### Done and live (server side)
- **Cloud Functions consolidated into `functions/`** (single codebase, Node 22,
  `firebase-functions` v7 with the v1 API). Every module is the latest source
  that was actually deployed (pulled from the GCS source archives), so the
  redeploy was behaviour-preserving except for two intended changes:
  `mirrorUsersToSupabase` now mirrors `lastGameWinAt → user_identity.last_game_win_ms`,
  and `notifyPrivateMessage` runs the newer 2026-07-29 body (active-chat push
  suppression, chat-off doors, `image_urls`). All 23 kept functions redeployed
  in three batches (all "Successful update"); 300/300 webhook calls in the
  first 15 min returned 200, mirror runs all `ok`, no errors in any redeployed
  function. `metro.config.js` block-lists `functions/` and `docs/` so the app
  bundle (AAB/IPA) cannot grow because of server code in the repo. Retired
  sources are in `docs/cost-audit-2026-09/retired-functions/`.
- **RTDB rules deployed** (`database.rules.json`, identical to live before the
  change): added `_serverTime/{uid}` (self read/write) and set `.write: false`
  on the Cloud-Function-owned nodes `calcData`, `previousStock`, `feedRanking`,
  `mods`, `leader_board`. `/users` read rules unchanged (see F2 — staged).
- **Supabase schema (additive)**: `supabase/027_cosmetics_columns_game_win.sql`
  applied — five cosmetic jsonb columns on `user_cosmetics`,
  `user_identity.last_game_win_ms`, and (found 2026-09-04 while backfilling)
  the four identity columns the deployed mirror has been trying to write since
  July: `decoded_email`, `flag`, `date_of_birth`, `last_profile_edit_ms`.
  **Every `mirrorIdentity` upsert had been failing** ("Could not find the
  'date_of_birth' column"), which is the real reason ~60k users had no identity
  row and why name/avatar changes never reached Supabase (F4). Both mirrors
  (identity + cosmetics) now succeed with no redeploy.

### Done in code (ships with the next app build)
| Finding | Files |
|---|---|
| F1 profile extras — zero RTDB reads on the Supabase path, cosmetics + game-win from the mirror, TTL 60 min | `Code/Helper/profileCache.js`, `Code/Supabase/userBackend.js` |
| F3 probe at `_serverTime/{uid}` (falls back to legacy path if rejected), launch callers share the 30 s cache, `deviceId`/`isPro` written only when changed, `registerForNotifications` once per uid | `Code/Helper/serverTime.js`, `badgeUtils.js`, `starUtils.js`, `Code/GlobelStats.js` |
| F5 invite toast: one `onSnapshot` per query, foreground-only, 5-min poll fallback on error | `Code/ValuesScreen/GlobalGroupInviteToast.jsx` |
| F6 `following` cached 1 h (invalidated on follow/unfollow), Home-focus reads once per 10 min, notification feed + chat header refetch ≤ every 2 min, Groups listeners once per mount with `limit(50)`, `limit()` on all unbounded queries | `Code/Helper/followingCache.js` (new), `Trades.jsx`, `DesignMainScreen.js`, `StatusFeed.js`, `BottomDrawer.jsx`, `HomeTabScreen.jsx`, `NotificationFeed.js`, `CommunityChatHeader.jsx`, `GroupsScreen.jsx`, `SocialDashboard.js`, `groupUtils.js`, `Scamwarning.js` |
| S1 one realtime binding per channel (`event: '*'`), unread resets skip rows already at 0, no channel re-create on banned-list changes, public-room idle pause 90 s | `Code/Supabase/chatMetaBackend.js`, `groupMetaBackend.js`, `chatBackend.js`, `ChatNavigator.js`, `InboxScreen.jsx`, `Trader.jsx` |

Verification: all 32 modified app files parse under the project Babel config;
ESLint error counts per file are identical to HEAD (all remaining errors
pre-exist).

### Website — DEPLOYED 2026-09-04 (`./deploy.sh`, public URL verified; the removed `/api/stock` returns 404)
W1 online list = indexed presence query + ≤50 leaf reads (no whole-`users`
read); W2 trade poll 120 s and only while visible; W3 homepage top traders from
the ISR server fetch (no client Firestore); W4 presence socket only on `/chat*`,
presence writes debounced; W5 `activeChats/{uid}` instead of
`users/{uid}/activeChat` (no more CF fan-out per DM view, and the app's
suppression logic now sees web users); GroupsList limit 12 with cursor; detail
pages `cache()` + `revalidate = 300`; dead `imageBase.ts` and `/api/stock`
removed. `tsc --noEmit` passes.

### Left for you (blocked or needs a decision)
1. ~~Delete the 8 unused functions + 4 orphaned scheduler jobs~~ — DONE 2026-09-04.
   `rebuildSubscriptionsFromRTDB` was stuck in a half-finished gen-2 upgrade and
   needed `gcloud beta functions upgrade --abort` first. Project now has exactly
   the 23 functions in `functions/index.js` and 10 scheduler jobs, all live.
2. ~~Supabase backfill~~ — DONE 2026-09-04 06:5x: `scripts/backfill-cosmetics-gamewin-2026-09.js`
   upserted identity + cosmetics rows for all 203,681 users in 406 s. Coverage
   now: 203,684 identity rows (was 202,273), 967 with a game-win timestamp,
   203,681 cosmetics rows, 1,811 with active cosmetics.
3. F2 stage 1 (`users` reads → `auth != null`): needs the logged-out browsing
   paths checked first (public chat viewers, website public profile).
4. ~~reindex + vacuum~~ — DONE 2026-09-04 via the Management API: the six
   `private_messages` indexes rebuilt online 3.2 GB → 772 MB, `net._http_response`
   642 MB → 8.6 MB, database **8.7 GB → 5.7 GB** (back under the 8 GB included).
5. ~~Ship the app build~~ — signed AAB built 2026-09-04: `android/app/build/outputs/bundle/release/app-release.aab`, versionName 4.0.9 / versionCode 158, 53.2 MB (previous 52.8 MB). Upload to Play, then re-measure (§6).
6. Also fixed 2026-09-04: `mirrorUsersToSupabase.activeItemsChanged` compared cosmetic OBJECTS by identity, so every /users write for a user with a cosmetic re-upserted `user_cosmetics` (11 M needless updates measured on adoptme). Now compares by value; redeployed.

## 5. Not done / caveats
- Dollar figures are computed from metered units × list price; the invoice is the
  truth. Firebase's 10 GB RTDB download allowance may or may not apply on Blaze
  (±$10).
- Firestore has no per-collection read metric; the F5/F6 shares come from code
  frequency × measured connection counts, not from a meter.
- Supabase was not measured at all (see §3).
- The profile window (21:41–21:46 PKT) is an evening peak; day-level averages are
  ~30% lower than the per-day extrapolations quoted from it.

## 6. How to re-measure
```bash
cd scripts/cost
python3 metrics.py 30           # 30-day totals per meter, grouped by function/type
python3 daily.py                # per-day trend table
firebase database:profile -d 300 --raw -o rtdb-profile.json --project fruiteblocks
python3 analyze_profile.py      # per-path op/bytes breakdown + top clients
```
Firestore collection counts: `documents:runAggregationQuery` with a `count`
aggregation (1 read per 1000 docs). Live rules:
`GET https://fruiteblocks-default-rtdb.firebaseio.com/.settings/rules.json?access_token=$(gcloud auth print-access-token)`.
