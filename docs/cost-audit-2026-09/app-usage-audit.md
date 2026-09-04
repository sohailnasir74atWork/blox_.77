# Blox_Fruit client app — Firebase (RTDB + Firestore) & Supabase usage audit

Scope: `/Volumes/Sohail/AI_Projects/RunningApps/Blox_Fruit` — `App.js`, `index.js`, `Code/**`. Read-only. Cloud Functions not audited.
All Supabase kill-switches are ON (`Code/Supabase/featureFlags.js:18-24`, `SUPABASE_READS_ENABLED = true`), so the "Supabase path" branches are the live code and the "RTDB fallback" branches only run on a Supabase miss/error.

Measured (30 d): RTDB 70.6 GB egress (18.8 GB payload), ~250 M one-shot reads (~96/s), 20.2 M sets, 3.3 M onDisconnect, 1.2 M updates, 209 avg connections. Firestore 76.5 M reads (~2.5 M/day, almost all QUERY), 740 K writes, ~20 listeners, ~95 connections. `/users/{uid}` written ~95 K/day.

Terminology: "cold start" = `onAuthStateChanged` resolving a user (`GlobelStats.js:412`), which is what flips `user.id` from null and fires every `[user?.id]` effect. Bottom tabs are lazy, so HomeTab mounts at start; Chat/Trade/Designs/Stock/Calculator mount on first visit and stay mounted.

---

## 0. Confirmation of the `_st` server-time probe (same pattern as adoptme-jan7)

`Code/Helper/serverTime.js:27-61` — `getServerTime(db, uid, forceProbe)`: `set(users/{uid}/_st, serverTimestamp())` then `get()` it back (1 write + 1 one-shot read, both under `/users/{uid}` so both fire `mirrorUsersToSupabase` + `syncModRoster`). 30 s cache is skipped whenever `forceProbe=true`.

| Caller | file:line | force? | Trigger | Frequency |
|---|---|---|---|---|
| `checkDailyStreak` | `Code/ChatScreen/GroupChat/badgeUtils.js:443` ← `Code/AppHelper/MainTabs.js:45` | **true** | MainTabs effect `[user?.id, appdatabase]` | **every cold start** (all users) |
| `getStarStatus` | `Code/Engagement/starUtils.js:49` ← `Code/HomeTab/HomeTabScreen.jsx:171` | **true** | HomeTab effect `[user?.id, appdatabase]` | **every cold start** (all users) — fires within ms of the one above; pure duplicate |
| `getStarStatus` | `starUtils.js:49` ← `Code/SettingScreen/BadgesScreen.js:289` and `Code/Engagement/DailyStarRewards.js:40` (rendered inside BadgesScreen:490) | true | BadgesScreen mount | per BadgesScreen open (×2 probes, both components call it) |
| `claimDailyStar` → `getStarStatus` | `starUtils.js:102` | true | user claims star | per claim |
| `MysteryEgg` load | `Code/Engagement/MysteryEgg.js:477` | true | screen mount, only if `shop/stats/lastEggAdAt` exists | per MysteryEgg open |
| `MysteryEgg` ad hatch | `MysteryEgg.js:676`, `:821` | true | after rewarded ad | per ad |
| `DailyCheckIn` mount | `Code/SettingScreen/RewardComponenet/Checkin.js:38` | false (30 s cache) | RewardCenter mount (RewardCenter route not found in App.js/MainTabs — may be unreachable) | per mount |
| `DailyCheckIn` claim | `Checkin.js:162` | true | after ad | per claim |
| Email-ban gate | `Code/GlobelStats.js:763` | false | ban listener fire + AppState `active` | only users with numeric `bannedUntil` |
| Device-ban gate | `GlobelStats.js:835` | false | same | only device-banned users |
| Ban countdown refresh | `Code/HomeTab/HomeTabScreen.jsx:196` | **true** | mount + **setInterval 60 s** + AppState active | banned users only — 1 set + 1 get per minute while app open |
| `useBanStatus` / `checkBanStatus` | `Code/ChatScreen/utils.js:1074`, `:1124` | false | focus / action | banned users only |

Net: **2 `_st` writes + 2 `_st` reads per cold start for every user**, plus per-screen extras. Combined with the other unconditional per-launch `/users/{uid}` writes (section 2.1) this is the bulk of the 95 K/day.

---

## 1. RTDB READS

Column key — Op: `onValue` (persistent listener), `get` (one-shot = listen+unlisten pair). Detach: whether the listener is cleaned up on unmount. "Big node" flags nodes whose whole subtree is downloaded.

### 1.1 App start / provider level (runs for every user every cold start)

| file:line | Path | Op | Trigger | Detach | Notes |
|---|---|---|---|---|---|
| `Code/GlobelStats.js:305` | `users/{uid}` (**whole subtree**) | get | `handleUserLogin` on every auth resolve | n/a | **Big node**: pulls shop/inventory/ownedItems/activeItems/stats, dailyStars, xp, checkin, submissions, badges, counters, blocked_users, purchases, fruitCrash, streak, `_st`… Largest payload read per launch. Only role flags + displayName/email are actually needed here. |
| `GlobelStats.js:452-454` | `api`, `single_offer_wall`, `free_translation` | get ×3 | mount (`[]`) | n/a | 3 tiny ops per launch; could be one node. |
| `GlobelStats.js:642` | `calcData` (**whole**) | get | `fetchStockData` at mount; re-read if >5 min since last (`lastCalcDataFetch`); forced by `reload()` (`ValueScreen.jsx:75`, `TimerScreen.jsx:129`, `HomeScreen.jsx:108` pull-to-refresh) | n/a | Big node (all stock calc data). Most launches exceed the 5-min TTL → effectively per launch + per pull-to-refresh. |
| `GlobelStats.js:676` | `previousStock` (whole) | get | same, 1 h TTL, forced by `reload()` | n/a | Big node. |
| `GlobelStats.js:1030` | `server` | get | mount, 3 h TTL | n/a | |
| `GlobelStats.js:776` | `banned_users_by_email/{email}` | **onValue** | `[currentUserEmail, appdatabase, user?.id]` | yes | 1 persistent listener/user; re-subscribes when `user.id` resolves (2 listen/unlisten pairs per launch). |
| `GlobelStats.js:856` | `banned_devices/{fp}` | **onValue** | `[appdatabase, user?.id]` | yes | 1 persistent listener/user; re-subscribes on user.id change. |
| `GlobelStats.js:983` | `.info/connected` | **onValue** | presence effect `[user?.id, appdatabase, localState?.showOnlineStatus, isUserBlocked, isAdmin]` | yes | Re-subscribes whenever `isAdmin` flips after login (effect deps) → cleanup + re-arm. |
| `Code/Globelhelper.js:47` | `users/{uid}/fcmToken` | get | `registerForNotifications` — called **3× per cold start**: `GlobelStats.js:387`, `:400` (effect on user.id), `:417` | n/a | 3 identical reads per launch; plus 1.5 s retry loop up to 3× on iOS if APNS not ready. |
| `Code/ChatScreen/GroupChat/badgeUtils.js:439` | `users/{uid}/streak` | get | `checkDailyStreak` ← `MainTabs.js:45` | n/a | per cold start |
| `Code/Helper/serverTime.js:41` | `users/{uid}/_st` | get | see §0 | n/a | 2× per cold start |
| `Code/Engagement/starUtils.js:43` | `users/{uid}/dailyStars` | get | `getStarStatus` ← `HomeTabScreen.jsx:171` | n/a | per cold start |
| `Code/Helper/cosmeticsCache.js:91` | `users/{uid}/shop/activeItems` | get | `syncMyCosmetics(force=true)` ← `MainTabs.js:46` | n/a | per cold start (force bypasses 10-min TTL) |
| `Code/Engagement/shopUtils.js:219` | `users/{uid}/shop/activeItems` | get | `getActiveCosmetics` ← `HomeTabScreen.jsx:131` **useFocusEffect** | n/a | **Every time Home tab regains focus** (every tab switch back to Home). Duplicates the read above; also issues `set(...null)` for expired items. |
| `HomeTabScreen.jsx:141` | `users/{uid}/xp` | **onValue** | `[user?.id, appdatabase]` | yes | 1 persistent listener/user for the whole session. |

Per cold start one-shot RTDB reads ≈ **17** (+3 listeners) for every user, before any interaction. At ~20–24 K cold starts/day (derived from the 95 K/day `/users` writes ÷ ~4 unconditional writes/launch) that is only ~0.4 M reads/day ≈ **5 % of the measured 8.3 M/day**. The remaining ~95 % is interaction-driven fan-out (§1.2–1.4).

### 1.2 Per-user profile fan-out (N+1 / per-field reads) — the dominant read class

| file:line | Path(s) | Op | Trigger | Multiplicity |
|---|---|---|---|---|
| `Code/Helper/profileCache.js:127,157,158` (`getOrFetchProfile`, Supabase path) | `users/{uid}/shop/activeItems`, `users/{uid}/hasRecentGameWin`, `users/{uid}/lastGameWinAt` | get ×3 | any uncached uid (30-min MMKV TTL) | **3 RTDB one-shots per uid even when the profile came from Supabase** (the 2 game-win gets at :156-166 are fire-and-forget extras). |
| `profileCache.js:181-195` (RTDB fallback) | 15 separate fields under `users/{uid}/…` | get ×15 | Supabase miss (user not mirrored, JWT race, network blip) | 15 one-shots per uid |
| `profileCache.js:249-256` (`warmProfileCache`) | same 3 per uid | get ×3 × ≤20 uids | every warm call | up to 60 one-shots per call |
| `profileCache.js:418,425` (`seedCurrentUser`) | `users/{me}/avatar`, `users/{me}/shop/activeItems` | get ×1-2 | **useFocusEffect** in `PrivateChat.jsx:261`; mount in `GroupChatScreen.jsx:121`; Trader mount | per private-chat focus |
| Callers of `warmProfileCache`: `Code/Trades/Trades.jsx:952` (all poster uids of 30 trades → up to 90 gets per Trades open / refresh / filter change), `Code/ChatScreen/GroupChat/Trader.jsx:334,812,889` (10 senders per page/refresh), `Code/ChatScreen/GroupChat/MessagesList.jsx:321` (effect deps `[messages]` — re-evaluates on **every incoming message**; any uid whose 30-min cache expired triggers 3 gets), `Code/ChatScreen/GroupChat/InboxScreen.jsx:232` (15 displayed chats → 45 gets) | | | | |
| `Trader.jsx:537-541` | via `getOrFetchProfile` | get ×3 (+4 Supabase) | **per new public-chat message** from an uncached sender | per message |
| `Code/ChatScreen/GroupChat/OnlineUsersList.jsx:196-197` | `users/{uid}/lastGameWinAt`, `isPlaying` | get ×2 per user | modal open, batches of 5 | + 14 gets/user on Supabase miss (`:225-238`) |
| `OnlineUsersList.jsx:315` | `presence` (query `orderByValue().equalTo(true)`) | get | modal open | returns all online uids (~200 keys) |
| `Code/ChatScreen/PrivateChat/PrivateChat.jsx:117` | `users/{selectedUserId}` (**whole subtree of the other user**) | get | `[selectedUserId, appdatabase]` — every private chat open | Big node for 4 role flags + avatar + name. |
| `Code/ChatScreen/chatAvailability.js:36-37` | `users/{uid}/chatOffTrade`, `chatOffGeneral` | get ×2 | every private chat open (`PrivateChat.jsx:198`) | |
| `PrivateChat.jsx:501` | `private_messages/{chatId}/trade` | get | chat open without trade item | |
| `Code/ChatScreen/PrivateChat/PrivateChatHeader.jsx:67-68` | `users/{uid}/lastGameWinAt`, `profileFrame` | get ×2 (+3 Supabase) | every private chat open | + 12 gets on Supabase miss (`:96-107`) |
| `Code/ChatScreen/utils.js:493` (`isUserOnline`) | `presence/{uid}` | get | profile-drawer open from Trader (`:191,:239`), PrivateChat (`:110`), Trades (`Trades.jsx:1227`), PostCard (`:109`), Leaderboard (`:141/:201`), GroupChat (`:957`) | 10-s cache |
| `utils.js:523` (`useOnlineStatus`) | `presence/{uid}` | **onValue** via **useFocusEffect** | `PrivateChatHeader.jsx:185` | re-subscribed on every focus; detached on blur |
| `utils.js:1386` (`useOtherLastRead`) | `private_messages/{chat}/lastRead/{other}` | **onValue** | `PrivateChat.jsx:231` | detached on unmount |
| `utils.js:61-65` (`fetchTargetRoles`) | 5 role fields under `users/{uid}` | get ×5 | every moderation action (ban/mute/strike/role change) | |
| `utils.js:128` | `users/{uid}/deviceId` | get | ban actions | |
| `Code/ChatScreen/GroupChat/BottomDrawer.jsx:271,274` | `users/{uid}/flage`, `lastGameWinAt` | get ×2 (+3 Supabase) | every profile drawer open | + 13 gets on Supabase miss (`:303-338`) |
| `BottomDrawer.jsx:929,931` + `xpUtils.js:137` | `users/{uid}/badges`, `createdAt`, `xp` | get ×3 | drawer open | |
| `BottomDrawer.jsx:982` → `shopUtils.js:219` | `users/{uid}/shop/activeItems` | get | drawer open (other user) | |
| `BottomDrawer.jsx:1363-1364` | `users/{uid}/createdAt` (again), `rewardPoints` | get ×2 | `loadDetails` | `createdAt` read twice per drawer |
| `BottomDrawer.jsx:1585` | `users/{reviewerId}` (whole) | get | delete-review action | |
| `Code/AppHelper/SocialDashboard.js:134-138` | 5 fields per friend | get ×5 × N | Friends screen mount + refresh | N+1 |
| `SocialDashboard.js:288,316-320,347,402,431-435,462` / `OnlineUsersList.jsx:422-471` / `AdminDashboard.js:522-630,1176-1214` | `users` queries: `orderByChild('displayName')` prefix ×4 variants `limitToFirst(30)` **plus broad `limitToFirst(500)` scan of `/users`** | get | search text ≥2 chars (each search) | **Massive payload** — 500 full user records per search fallback. |
| `Code/SettingScreen/Setting.jsx:1403-1404,1463-1464` | `users/{uid}` (whole) per review row | get ×N | reviews modals open | N+1 whole-node |
| `Setting.jsx:1699-1700,1750-1751` | `users/{uid}/displayName`,`avatar` per follower | get ×2N | followers modal | |
| `Setting.jsx:990,992` | `users/{me}/createdAt`, `rewardPoints` | get ×2 | Setting mount | |
| `Code/ChatScreen/GroupChat/GroupsScreen.jsx:555-556,843,896` | `users/{creator}/displayName`,`avatar` | get per group | group info / "all groups" tab + paging | |
| `Code/ChatScreen/GroupChat/GroupChatScreen.jsx:180` | `presence/{memberId}` | get ×5 per batch | members modal | |
| `GroupChatScreen.jsx:289-290` | `users/{invited}/displayName`,`avatar` | get ×2 | members modal (creator) | |
| `Code/ChatScreen/utils/groupUtils.js:190,320,810` | `users/{uid}` (whole) per member | get ×N | create group / invite / add members | N+1 whole-node |
| `groupUtils.js:608,1564,1620` | `groups/{groupId}` (legacy RTDB) | get | leave/delete group | |
| `Code/ValuesScreen/PetGuessingGame/utils/gameInviteSystem.js:33` | `users/{uid}` (whole) | get | game win award | whole node to read one number |
| `gameInviteSystem.js:734` | `presence` query (all online) | get | invite modal | |
| `gameInviteSystem.js:765-767` | `displayName`,`avatar`,`isPlaying` per online user | get ×3N | invite modal batches (`InviteUsersModal.jsx:95,140,163`) | N+1 |
| `Code/Engagement/{QuickDraw:172,SafeCracker:118,MemoryMatch:236,SpotTheFake:138}.js` | `users/{me}/displayName`,`avatar` | get ×2 | every game end with a new best | user object already has both |
| `Code/ChatScreen/PrivateChat/BlockUserList.jsx:61-62` | per blocked uid ×2 | get | block list open | |

### 1.3 Per-screen / per-action reads (own data, feature nodes)

| file:line | Path | Op | Trigger | Detach |
|---|---|---|---|---|
| `Code/Trades/Trades.jsx:336` | `savedTrades/{uid}` | **onValue** | Trades tab mount `[user?.id]` | yes |
| `Code/Trades/tradeHelpers.js:80,130,181` | `savedTrades/{uid}`, `.../lastPingAt` | get | save/ping/Saved filter | |
| `Code/Trades/Notifier.js:82,120` | `notifier/buy/{uid}`, `notifier/sale/{uid}` | **onValue ×2** | Notifier screen mount | yes |
| `Notifier.js:99,135` | `notifier_index/{mode}/{itemKey}/{uid}` **per saved item** | get ×N | **inside each onValue callback** (initial + every change) | N reads per listener fire; 10 items → 20 gets per open |
| `Code/Trades/Server.js:54` | `users_server` query `orderByChild('expiresAt').startAt(now)` | **onValue** | Server screen mount | yes |
| `Server.js:66` | `server` | get | mount | |
| `Code/Engagement/FruitCrash.jsx:195` | `users/{uid}/fruitCrash` | get | mount | |
| `FruitCrash.jsx:207` | `fruitCrash/currentRound` | **onValue** | mount | yes — delivery rate = server write cadence (not audited; if the CF writes per tick this fans out to every player) |
| `FruitCrash.jsx:285-286` | `fruitCrash/cashouts` `orderByChild('cashedAt').limitToLast(12)` | **onValue** | mount | yes — every cashout by any player re-delivers 12 rows to every viewer |
| `FruitCrash.jsx:297` | `fruitCrash/leaderboard` (**whole**, all players ever) | get | mount + every switch to leaderboard tab | sorts client-side to 30 |
| `Code/Engagement/xpUtils.js:115` | `users/{uid}/xp/total` | get | inside `addXP` for ≥10 XP (`FruitCrash:340`, `TradeCompletion:113`, `starUtils:117`, `StatusFeed:682`, `PrivateChat:378`) | 1 read per XP award |
| `xpUtils.js:137` | `users/{uid}/xp` | get | BadgesScreen, MysteryEgg, BottomDrawer | |
| `badgeUtils.js:350,356,394,461,468,499,560,578` | `users/{uid}/counters/*`, `users/{uid}/badges/*` | get | per message/reaction/review/trade/follow event (MMKV short-circuit once earned) | |
| `Code/Engagement/MysteryEgg.js:474` + `starUtils:136` + `shopUtils:285,349,361` + `cosmeticsCache:91` | `shop/stats/lastEggAdAt`, `dailyStars`, `shop/stats`, `shop/ownedItems`, `shop/activeItems` ×2 | get ×6 | MysteryEgg mount; stats+inventory re-read after every purchase (`:543-546`) | |
| `Code/Engagement/shopUtils.js:24,128` | `xp/total`, `shop/activeItems/{type}` | get | purchase | |
| `starUtils.js:160` | `dailyStars/starBalance` | get | spend | |
| `Code/Engagement/TradeJournal.js:150,160,189` | `tradeStats/{uid}`, `tradeJournal/{uid}` (`limitToLast(5)` paged) | get | MyStuff screen focus | |
| `Code/Engagement/TradeCompletion.js:117` | `tradeStats/{uid}` | get | trade save | |
| `Code/Engagement/NotificationFeed.js:113` | `users/{uid}/muteTradeNotifs` | get | **useFocusEffect** | per focus |
| `Code/SettingScreen/BadgesScreen.js:292` | `users/{uid}` (**whole**) | get | mount | whole node for badges/createdAt |
| `Code/ValuesScreen/News.js:196` | `news` (**whole**) | get | mount + **focus + setInterval 5 min while focused** | polling |
| `Code/ValuesScreen/HDwallpaper.js:52,72` | `pic_numbers`, `like_counter` (**whole**, all wallpapers' like maps) | get | mount | big node |
| `Code/SettingScreen/Store/Store.js:51,52,67` | `background`, `hd`, `storeItems` | get ×3 | mount | |
| `Code/Engagement/ModsScreen.js:140-144` | `mods`, `mod_votes_summary`, `mod_votes_by_user/{uid}` | get ×3 | mount + refresh | |
| `Code/SettingScreen/RewardCenter.js:34` / `RewardProfile.js:28` / `SocialMedia.js:50` | `winners`, `reward/{uid}`, `users/{uid}/submissions` | get | mount | |
| `Code/Design/DesignMainScreen.js:347` | `feedRanking/{hot\|trending}` | get | Hot/Trending sort tap (then N Firestore lookups) | |
| `Code/ValuesScreen/PetGuessingGame/components/GameResults.jsx:55,77` | `users/{uid}/rewardPoints` | get + **onValue** | results screen | yes |
| `Code/ChatScreen/GroupChat/Trader.jsx:845` | `users/{uid}/isBlock` | **onValue** | Chat tab mount `[user?.id]` | yes |
| `Trader.jsx:308,470,726` | `chat_*` rooms (RTDB fallback only) | get / onValue | only if Supabase load returns empty | dormant |
| `Code/ChatScreen/ChatNavigator.js:124-159,225-244` / `InboxScreen.jsx:146-186` | `chat_meta_data/{uid}`, `group_meta_data/{uid}` child listeners | onChildAdded/Changed/Removed | RTDB fallback only (flags on) | dormant |
| `utils.js:1087` (`useBanStatus`) | `banned_users_by_email/{email}` | **onValue** via useFocusEffect | screens using the hook | re-subscribed per focus |
| `AdminDashboard.js:319,379,1014,1050,1187,1190` / `AdminReport.js:57-58` / `RewardComponenet/Admin.js:25` | `banned_users_by_email` (whole), `submissions`, `news/polls`, `news_feedback`, per-user lookups | get | admin screens | admin-only |
| `Code/Trades/ReportTradePopUp.js:79` | `tradeReports` | push | report | write |

### 1.4 What plausibly produces ~96 one-shot reads/s (≈ 1 read / 2 s / connected client)

Cold-start reads are ~5 %. The op count is dominated by the **per-field profile pattern**: the app reads a user as 2–15 separate leaf `get()`s instead of one node, and does so on every list/feed/chat/drawer surface, gated only by a 30-min MMKV TTL. Budget sketch (order of magnitude; instrument to confirm):

| Source | Reads per event | Events/day (guess) | Reads/day |
|---|---|---|---|
| Cold start (§1.1) | 17 | 22 K | 0.4 M |
| Home tab re-focus (`HomeTabScreen.jsx:131` activeItems) | 1 | 22 K × ~20 | 0.4 M |
| Trades feed open/refresh/filter → `warmProfileCache` 30 posters × 3 | ≤90 | 15 K | ≤1.3 M |
| Public chat: initial warm 10×3, + 3 per uncached new-message sender, + `MessagesList` re-warm on TTL expiry | 30 + ~3/msg | 6 K sessions × ~20 | ~0.5 M |
| Private chat open (whole user node + 2 availability + 2 header + presence + trade + seed) | ~8 | 40 K | 0.3 M |
| Profile drawer open (~8 RTDB) | 8 | 40 K | 0.3 M |
| Inbox open (15 × 3) | 45 | 15 K | 0.7 M |
| Online-users modal (presence + 2/user, 14 on miss) | 11–75 | 10 K | 0.1–0.7 M |
| XP / badge counters / game ends / MysteryEgg / journal | 1–8 | 50 K | 0.2 M |
| `fruitCrash/leaderboard` per mount+tab, `news` poll, wallpapers `like_counter`, `calcData` on every pull-to-refresh | 1 (big payload) | 30 K | 0.03 M (but heavy egress) |

The per-field fan-out plus per-focus repeats can reasonably reach several million/day; the remaining gap is best closed by adding a client-side sampled counter around `get()` (path prefix + screen) for a day. Note the egress shape (18.8 GB payload inside 70.6 GB) is itself diagnostic: ~75 % of RTDB bytes are frame overhead from tiny listen/unlisten pairs, i.e. exactly this pattern.

---

## 2. RTDB WRITES

### 2.1 Writes to `/users/{uid}/…` (each fires `mirrorUsersToSupabase` + `syncModRoster`)

| file:line | Path | Op | Trigger | Frequency |
|---|---|---|---|---|
| `Code/Helper/serverTime.js:40` | `users/{uid}/_st` | set | `checkDailyStreak` (MainTabs:45) **and** `getStarStatus` (HomeTab:171), both `force=true` | **2 per cold start, every user** (+ BadgesScreen ×2, MysteryEgg, claims, banned-user 60 s timer) |
| `Code/GlobelStats.js:383` | `users/{uid}` `{deviceId}` | update | `handleUserLogin`, unconditional after fingerprint | **1 per cold start** |
| `GlobelStats.js:496` | `users/{uid}/isPro` | set | effect `[user?.id, localState?.isPro]`, unconditional (writes same value) | **1 per cold start** + on Pro change |
| `badgeUtils.js:458` | `users/{uid}/streak` | set | `checkDailyStreak` when date changed | 1/day/user |
| `badgeUtils.js:463,470` | `users/{uid}/badges/onFire|streakMaster` | set | streak thresholds | rare |
| `Code/Globelhelper.js:62-63` | `users/{uid}/fcmToken`, `isTokenInvalid` | set ×2 | only when token differs | rare (but read 3×/launch) |
| `GlobelStats.js:318,350,363` | `isAdmin`, `displayName`, `email` | update | heal-on-login conditions | rare |
| `GlobelStats.js:374` | `users/{uid}` | set (whole) | new user | once |
| `GlobelStats.js:209,235` (`updateLocalStateAndDatabase`) | `users/{uid}` `{…}` | update | any caller: `rewardPoints`,`isBlock`,`fcmToken`,`email`,`isPro` immediate; others 500 ms debounced | per action (Checkin claim writes `coins`,`lastRewardtime`,`checkin` — `Checkin.js:183`) |
| `xpUtils.js:105,120` | `users/{uid}/xp/total` (increment), `xp/level` | update ×2 | every `addXP` ≥10 (trade save, status post, review, star claim, FruitCrash cashout) | 2 writes per XP event |
| `starUtils.js:108,142,167` / `shopUtils.js:114` / `MysteryEgg.js:705,853` | `users/{uid}/dailyStars` | update | claim / spend / seed / ad-hatch | per action |
| `shopUtils.js:33,175,195,199,231-267,413,430` / `MysteryEgg.js:687,832` | `users/{uid}/shop/*` (activeItems, inventory push, ownedItems push, stats, `stats/lastEggAdAt`) | update/push/set | purchase, activate, expiry cleanup **inside `getActiveCosmetics` (runs on every Home focus + drawer open)** | per action; expiry `set(null)` can fire on read paths |
| `badgeUtils.js:349,358,396,513,562,580,322` | `users/{uid}/counters/{name}` (increment), `users/{uid}/badges/{id}` | set | per message / reaction / review / trade / follow event | 1–2 per event |
| `FruitCrash.jsx:339` | `users/{uid}/fruitCrash/{totalRounds,lastPlayedDate,bestMultiplier}` + `fruitCrash/cashouts/{uid}` | multi-path update | every cashout | + `addXP` (2 more) |
| `gameInviteSystem.js:41` | `users/{uid}` `{rewardPoints,lastGameWinAt}` | update | game win | |
| `PrivateChat.jsx:253` | `users/{uid}` `{rewardPoints}` | update | points award | |
| `HomeScreen.jsx:360` | `users/{uid}` `{robloxUsername}` | update | trade create when changed | |
| `NotificationFeed.js:266` | `users/{uid}/muteTradeNotifs` | set | toggle | |
| `PrivateChatHeader.jsx:230,232` | `users/{uid}/blocked_users/{other}` | set | block toggle | |
| `RewardedAd.js:129` / `MyPurchases.js:84` / `SocialMedia.js:161` / `Admin.js:48,76` | `coins`,`lastRewardtime`, purchases, `submissions/{task}` | update/set | reward / purchase / submission / admin | |
| `BottomDrawer.jsx:731-836,954` / `utils.js:220-260,1268,1296` / `Setting.jsx:2321` | role flags, `createdAt` backfill, `isBlock`, remove user | set/update/remove | mod actions / account delete | |

Per cold start: **4 unconditional writes** (`_st` ×2, `deviceId`, `isPro`) + `streak` once/day. 95 K/day ÷ ~4.3 ≈ **22 K cold starts/day**, i.e. the probe + deviceId + isPro account for essentially all of the `/users` write volume and the CF invocations.

### 2.2 Other RTDB writes (sets/updates/push/onDisconnect)

| file:line | Path | Op | Trigger | Frequency |
|---|---|---|---|---|
| `GlobelStats.js:964` | `presence/{uid}` = true | set | `updatePresence` on `.info/connected` true, AppState `active`, effect (re)run; 30 s throttle | 1–2 per cold start, +1 per foreground (after throttle), +1 per RTDB reconnect |
| `GlobelStats.js:896,1010` | `presence/{uid}` = false | set | AppState background/inactive, disconnect, blocked, **effect cleanup** (deps include `isAdmin`,`isUserBlocked`,`showOnlineStatus` → cleanup+re-run once per login as roles resolve) | +1 per background, +1 per effect re-run |
| `GlobelStats.js:908-909` | `presence/{uid}` | **onDisconnect.set(false)** | `armOnDisconnect` on first online per effect instance; effect re-runs re-arm (cancel at :948/:1005 then re-arm) | 1–2 per cold start + per re-run |
| `Code/ChatScreen/utils.js:545-547` (`setActiveChat`) | `activeChats/{uid}` = chatId, `private_messages/{chat}/unread/{uid}` = 0 | set ×2 + **onDisconnect.remove** | `useActiveChatLifecycle` (`utils.js:614`): **every focus** of PrivateChat (`PrivateChat.jsx:271`) / GroupChat (`GroupChatScreen.jsx:510`) **and every AppState `active`** while on the screen | 2 sets + 1 onDisconnect per focus/foreground; `clearActiveChat` (`:562`) 1 set on blur/background |
| `utils.js:577-578` (`setActiveGroupChat`) | `activeGroupChats/{group}/{uid}` = true | set + **onDisconnect.remove** | same lifecycle for group chats | +1 set +1 onDisconnect per focus/foreground; clear on blur |
| `Code/ChatScreen/PrivateChat/ClearactiveChats.js:22,9` | `activeChats/{uid}` | update / remove | legacy hook (useFocusEffect) if still used | |
| `utils.js:1329` (`_fireLastRead`) | `private_messages/{chat}/lastRead/{uid}` | set | leading+trailing edge, 4 s window, per incoming partner message + focus + flush on blur | ≤2 per 4 s per open chat |
| `Notifier.js:113,148,181,185,204-205` | `notifier/{mode}/{uid}/{key}`, `notifier_index/{mode}/{key}/{uid}` | set / multi-update / remove | select/remove item; **backfill update inside every onValue fire** | |
| `Server.js:128,167,192` | `users_server` | push / set / remove | submit / vote / delete | |
| `tradeHelpers.js:98,112,114,159` | `savedTrades/{uid}/{trade}`, `tradeAcceptors/…` | set / remove | save / unsave / ping | |
| `TradeCompletion.js:100,120` / `TradeJournal.js:170,219-244` | `tradeJournal/{uid}` push, `tradeStats/{uid}` set | push/set | trade save / edit / delete | |
| `HDwallpaper.js:140` | `like_counter/{id}` | update | like | |
| `News.js:237` | `news_feedback` | push | feedback | |
| `Store.js:195,231,378` / `MyPurchases.js:89` | `storeItems/{id}`, `withdrawals/{uid}/{id}` | update/set | purchases | |
| `ReportTradePopUp.js:87` | `tradeReports` | push | report | |
| `ModsScreen.js:240` | multi-path `mod_votes_*` | update | vote | |
| `groupUtils.js:611,664,1623` / `BottomDrawer.jsx:1051` | `groups/{id}`, `group_meta_data/{uid}/{group}`, 9 user paths | remove/set null | leave/delete group / admin delete-user | |
| `utils.js:188,195,1011` / `AdminHeader.jsx:71` | `banned_devices/{id}`, `banned_users_by_email/{email}` | set/update | ban/unban | |
| `SocialMedia.js:160` / `Admin.js:53,81` | `submissions/{task}` | set/remove | | |
| `ChatNavigator.js:136` / `InboxScreen.jsx:159` | `chat_meta_data/{uid}/{partner}` `{unreadCount:0}` | update | RTDB fallback only | dormant |

**What produces ~700 K sets/day and 3.3 M onDisconnect/month (~110 K/day):**
- `/users` slice: ~95 K/day (`_st` ×2, `isPro`, `deviceId`-as-update, streak, plus XP/badge/shop actions).
- Presence churn: per cold start 2–3 `presence` sets (true, false-on-cleanup, true again after role effect re-run) plus 1 per foreground/background transition and per RTDB reconnect (iOS kills the socket in background → `.info/connected` flaps → `forceOffline` + re-`set(true)`). With ~22 K launches and several fg/bg cycles each this is easily 100–200 K sets/day.
- Chat lifecycle: `setActiveChat` = 2 sets + 1 onDisconnect on **every focus and every foreground** of a private chat; group chat = 3 sets + 2 onDisconnects; `clearActiveChat` = 1 set on blur/background. Tens of thousands of chat opens/day × 3–5 sets = 150–300 K sets/day, and this is the only place besides presence that arms onDisconnect, so it is the likely source of most of the 110 K/day onDisconnect ops (presence contributes ~1.5 × launches ≈ 35 K/day).
- `lastRead` sets (bounded by 4 s window per chat), `notifier_index` backfill, FruitCrash cashouts, XP double-writes fill the rest.

---

## 3. FIRESTORE

Column key — Listener: `onSnapshot`; One-shot: `getDocs` (QUERY) / `getDoc` (LOOKUP) / `getCountFromServer` (1 read).

| file:line | Collection & constraints | Limit | Kind | Trigger / screen | Detach |
|---|---|---|---|---|---|
| `Code/ValuesScreen/GlobalGroupInviteToast.jsx:148-154` | `group_invitations` where invitedUserId==me, status==pending | **NO LIMIT** | getDocs | **root-mounted (`index.js:103`) — every 45 s (`setInterval`, `:200`) + immediately on mount + every AppState `active`** | interval cleared on unmount only (never, it is root) |
| `GlobalGroupInviteToast.jsx:234-246` | `fruitGuessingGame_userInvites/{me}/invites` where status==pending | NO LIMIT | getDocs | **same: every 45 s + foreground** (`:303`) | |
| `Code/Trades/Trades.jsx:877-921` (`fetchInitialTrades`) | `trades_new_upgrade` where isFeatured!=true orderBy isFeatured,timestamp desc (+ status in) | 20 | getDocs | Trades tab mount `[user?.id]` (runs when user null **and** again when uid resolves if tab mounted early), filter change (`:1196`), pull-to-refresh (`:1266`), search clear (`:725`) | |
| `Trades.jsx:898-916` | `trades_new_upgrade` where isFeatured==true, featuredUntil>now orderBy featuredUntil (+status in) | 10 | getDocs | same (parallel) | |
| `Trades.jsx:537-559` (`fetchMoreTrades`) | same normal query + startAfter | 20/page | getDocs | scroll | |
| `Trades.jsx:318-323` | `following` where followerId==me | 200 | getDocs | Trades mount `[user?.id]` (not cached) | |
| `Trades.jsx:434-441` | `trades_new_upgrade` where userId==me, isFeatured==true, featuredUntil>24h ago | NO LIMIT | getDocs | Feature-trade button | |
| `Trades.jsx:753-800` | `trades_new_upgrade` array-contains hasItemNames / wantsItemNames orderBy timestamp | 5 each | getDocs ×2 | search + paging | |
| `Trades.jsx:983-989` / `:1047-1054` | `trades_new_upgrade` where userId==me / userId in ≤30, timestamp>7d | 50 | getDocs | My/Following filter | |
| `Trades.jsx:1015` | `trades_new_upgrade/{id}` | 1 per saved | getDoc ×N | Saved filter | |
| `Code/HomeTab/HomeTabScreen.jsx:117-118` | `user_profiles/{me}` (fallback `reviews/{me}`) | 1–2 | getDoc | **useFocusEffect — every Home focus** | |
| `Code/Design/DesignMainScreen.js:234-240` | `designPosts_upgrade` orderBy createdAt | 5 | getDocs | Feed tab mount, `latest` sort, refresh | |
| `DesignMainScreen.js:430-438` / `:422-428` | same + startAfter (+ tag array-contains) | 10 | getDocs | scroll | |
| `DesignMainScreen.js:263-268` | `following` where followerId==me | 200 | getDocs | Feed mount `[user?.id]` (not cached) | |
| `DesignMainScreen.js:304-320` | `designPosts_upgrade` where userId in ≤30 orderBy createdAt | 5 | getDocs | Following filter + paging | |
| `DesignMainScreen.js:125-141` | `designPosts_upgrade` where userId==me (+tag) orderBy createdAt | **NO LIMIT** | getDocs | My Posts filter | |
| `DesignMainScreen.js:192-199` | `designPosts_upgrade` array-contains tag | 5 | getDocs | tag tap | |
| `DesignMainScreen.js:363-367` | `designPosts_upgrade/{id}` ×N (N = `feedRanking` length) | N lookups | getDoc | Hot/Trending sort | |
| `Code/Design/StatusFeed.js:351-357` | `statuses` where expiresAt>now orderBy expiresAt desc | 60 | getDocs | Feed mount, 1 h MMKV TTL (`:431`), identity change | |
| `StatusFeed.js:390-397` | `statuses` where userId in ≤30, expiresAt>now | 40 | getDocs | same + load-more chunks | |
| `StatusFeed.js:293-298` | `following` where followerId==me | 200 | getDocs | 1 h TTL | |
| `StatusFeed.js:859-863` | `following` where followerId==me, followingId==X | NO LIMIT | getDocs | follow action | |
| `Code/ChatScreen/GroupChat/GroupsScreen.jsx:162-168` | `group_invitations` where invitedUserId==me, status==pending | NO LIMIT | **onSnapshot** | **useFocusEffect** | detached on blur |
| `GroupsScreen.jsx:204-210` | `group_join_requests` where creatorId==me, status==pending | NO LIMIT | **onSnapshot** | useFocusEffect | detached on blur |
| `GroupsScreen.jsx:244-250` | `group_join_requests` where requesterId==me, status==pending | NO LIMIT | **onSnapshot** | useFocusEffect | detached on blur |
| `GroupsScreen.jsx:123-125` | `groups` where isActive==true | count | getCountFromServer | mount | |
| `GroupsScreen.jsx:528` | `groups/{id}` | 1 | getDoc | info modal | |
| `groupUtils.js:1716-1731` (`getAllGroups`) | `groups` orderBy createdAt (+startAfter) | 10 / 15 | getDocs | "All groups" tab (`GroupsScreen.jsx:827,882`) + search text change | |
| `Code/ChatScreen/GroupChat/CommunityChatHeader.jsx:38-44` | `group_invitations` where invitedUserId==me, status==pending | NO LIMIT | getDocs | **useFocusEffect — every Chat tab focus** | |
| `CommunityChatHeader.jsx:78-84` | `group_join_requests` where creatorId==me, status==pending | count | getCountFromServer | every Chat tab focus | |
| `Code/ChatScreen/GroupChat/GroupChatScreen.jsx:129-130` | `groups/{groupId}` | 1 doc | **onSnapshot** | group chat mount | yes |
| `GroupChatScreen.jsx:106` → `groupUtils.js:1021-1026` | `group_invitations` where groupId, invitedUserId, status | NO LIMIT | getDocs | group chat mount | |
| `GroupChatScreen.jsx:253-258` | `group_invitations` where groupId==g, status==pending | NO LIMIT | getDocs | members modal (creator) | |
| `Code/ChatScreen/GroupChat/BottomDrawer.jsx:1140-1146` | `following` where followerId==me, followingId==X | NO LIMIT | getDocs | **every drawer open** | |
| `BottomDrawer.jsx:1361-1366` | `user_ratings_summary/{X}`, `reviews/{X}`, count(`following` where followingId==X) | 3 reads | getDoc ×2 + count | `loadDetails` | |
| `BottomDrawer.jsx:1429` | `game_stats/{X}` | 1 | getDoc | loadDetails | |
| `BottomDrawer.jsx:1488-1507` | `reviews` where toUserId==X (+rating) orderBy updatedAt | page+1 | getDocs | loadDetails + paging + star filter | |
| `BottomDrawer.jsx:1669-1685` | `trades_new_upgrade` where userId==X orderBy timestamp | 2 / 3 | getDocs | loadDetails + paging | |
| `BottomDrawer.jsx:1739-1754` | `designPosts_upgrade` where userId==X orderBy createdAt | 4 | getDocs | loadDetails + paging | |
| `BottomDrawer.jsx:1058-1059` | many collections where field==uid | NO LIMIT | getDocs ×N | admin delete-user | admin |
| `BottomDrawer.jsx:1623` | `user_ratings_summary/{X}` | 1 | getDoc | delete review | |
| `Code/ChatScreen/PrivateChat/PrivateChat.jsx:161` | `reviews/{X_me}` | 1 | getDoc | every private chat open | |
| `PrivateChat.jsx:298,303` | `reviews/{X_me}`, `user_ratings_summary/{X}` | 2 | getDoc | rating submit | |
| `Code/ChatScreen/utils/ratingSummaryHelper.js:39-44` | `reviews` where toUserId==X | **NO LIMIT (all reviews of target)** | getDocs | every review create/edit (`PrivateChat.jsx:36`, `Setting.jsx:2215`) | |
| `ratingSummaryHelper.js:103,218` | `reviews` (entire collection) | NO LIMIT | getDocs | backfill/diagnostic (dev/admin) | |
| `Code/SettingScreen/Setting.jsx:989,991` | `user_ratings_summary/{me}`, `reviews/{me}` | 2 | getDoc | Setting mount (+ setDoc default bio if missing) | |
| `Setting.jsx:1389-1394,1449-1454,1511-1516,1581-1586` | `reviews` where from/toUserId==me orderBy updatedAt | 5 then 20 | getDocs | review modals | |
| `Setting.jsx:1649-1654,1781-1786` | `trades_new_upgrade` where userId==me | 3 / 10 | getDocs | my-trades modal | |
| `Setting.jsx:1685-1691,1736-1742` | `following` where followingId==me orderBy createdAt | 3 | getDocs | followers modal | |
| `Setting.jsx:1336` | `reviews/{…}` | 1 | getDoc | edit review | |
| `Code/Engagement/NotificationFeed.js:66-84` | `notifications` where toUid==me orderBy createdAt (+startAfter) | 20 | getDocs | **useFocusEffect** (refresh from top on every focus) | |
| `NotificationFeed.js:175-180` | `notifications` where toUid==me | 500 | getDocs + batch delete | Clear all | |
| `NotificationFeed.js:121-…` | mark-read writes | ≤20 | updateDoc | after load | |
| `Code/AppHelper/SocialDashboard.js:179-184` | `following` where followerId==me | **NO LIMIT** | getDocs | Friends screen mount + refresh | |
| `Code/Engagement/{QuickDraw:68,SafeCracker:73,MemoryMatch:98,SpotTheFake:83}.js` | `games/{me}` | 1 | getDoc | game modal open | |
| same files `:161,:107,:222,:126` + `:178,:124,:242,:144` + `updateLeaderboardCache.js:50,84` | `games/{me}`, `game_scores/{g}/scores/{me}`, `game_leaderboard_cache/{g}` | 1 read + 3 writes | setDoc/getDoc | game end | |
| `Code/Engagement/GameLeaderboard.js:93-147` | `game_leaderboard_cache/{g}` (fallback `game_scores` limit 20, legacy `games` limit 20) | 1 / 20 | getDoc/getDocs | leaderboard tab | |
| `Code/ChatScreen/GroupChat/LeaderboardModal.jsx:70` / `LeaderboardScreen.jsx:84` | `leaderboard_cache/top50` | 1 | getDoc | 2-day MMKV TTL | |
| `Code/Engagement/TradeJournal.js:131` / `TradeCompletion.js:143` | `user_profiles/{me}` | 1 | getDoc | MyStuff focus / trade save (+updateDoc) | |
| `Code/Engagement/GameActivityBanner.js:47` | `games/{me}` | 1 | getDoc | **component is never imported — dead** | |
| `Code/ValuesScreen/PetGuessingGame/utils/gameInviteSystem.js:571` (`listenToUserInvites`) | `…/userInvites/{me}/invites` where status==pending | NO LIMIT | **onSnapshot** | only via `components/GlobalInviteToast.jsx:28` — **not imported anywhere (dead)**; the polling toast above replaced it | |
| `gameInviteSystem.js:811` (`listenToGameRoom`) | `fruitGuessingGame_rooms/{room}` | 1 doc | **onSnapshot** | in-game (`PetGuessingGameScreen.jsx:106`) | yes |
| `gameInviteSystem.js:697-703` (`isUserInActiveGame`) | `fruitGuessingGame_rooms` where status==playing | NO LIMIT | getDocs | exported, no caller found (dead) | |
| `gameInviteSystem.js:*` (rooms CRUD, `awardGameWin:48-57`) | `fruitGuessingGame_rooms/{id}`, `game_stats/{uid}` | 1 | getDoc/setDoc/updateDoc | in-game actions | |
| `Code/ValuesScreen/ScammerDatabaseScreen.js:182-192,223-232,277,442-446` | `scammerSummaries` orderBy reportCount,updatedAt (+status) / prefix search / `scammerDetails/{id}` | 15 / 1 | getDocs/getDoc | screen mount, filter, search, scroll | |
| `Code/Design/componenets/CommentsModal.js:57-60` | `designPosts_upgrade/{post}/comments` orderBy createdAt | 100 | **onSnapshot** | comments modal open | yes |
| `Code/ChatScreen/PrivateChat/Scamwarning.js:64-69` | `chat_reports` where chatKey, reportedBy, status | NO LIMIT | getDocs | report | |
| `Code/AppHelper/AdminDashboard.js:227-241,874-876,950-976,1270-1278` | `statuses` paged, `reviews` where toUserId (NO LIMIT), `reviews` paged, `chat_reports` limit 30 | | getDocs | admin | admin |
| `groupUtils.js` (create/invite/accept/leave/join flows) | `groups`, `group_invitations`, `group_join_requests` — several NO-LIMIT `where groupId==g` scans (`:624,637,1593,1676,1689`) | | getDocs/runTransaction | per group action | |
| `Code/ValuesScreen/PetGuessingGame/utils/gameInviteSystem.js:255-289,317-325` | invites subcollection | NO LIMIT | getDocs | invite send | |

### 3.1 Ranked likely contributors to ~2.5 M QUERY reads/day

1. **`GlobalGroupInviteToast` polling** (`GlobalGroupInviteToast.jsx:200,303`): 2 queries every 45 s per signed-in client (an empty result still bills 1 read) + 2 per foreground. 3 840 reads/day/always-open client. With 95–209 concurrently connected clients that is **0.37–0.8 M reads/day (15–30 %)** and it never stops while the app process is alive (the interval is not AppState-gated; Android keeps JS timers running in background).
2. **Trades feed** (`Trades.jsx:877-921` + `:318` + `:537`): 30 reads per open, re-fetched on every filter toggle and pull-to-refresh, + `following` up to 200 docs per mount, + 20 per scroll page. Likely **10–15 %**.
3. **Design tab** (`DesignMainScreen.js:234,263` + `StatusFeed.js:351,390,293`): up to 5 + 200 + 60 + 40 ≈ 300 reads on first open per hour (StatusFeed has a 1 h TTL; DesignMainScreen's `following` and posts do not). **~10 %**.
4. **Chat tab focus churn**: `CommunityChatHeader.jsx:38-44` (query) + `:84` (count) on every Chat tab focus; `GroupsScreen.jsx:162-250` three `onSnapshot` re-attached on every Groups focus (each attach re-bills the result set). **~5 %**.
5. **Profile drawer** (`BottomDrawer.jsx:1140,1361-1366,1429,1488,1669,1739`): 1 query + 2 lookups + 1 count + 1 lookup + 3 paged queries ≈ 8–10 reads per drawer open. **~5–10 %**.
6. **`HomeTabScreen.jsx:117` per-focus `user_profiles` lookup** — LOOKUP not QUERY, but 1–2 reads on every return to Home. **~5 % of total reads.**
7. **`ratingSummaryHelper.updateUserRatingSummary`** (`:39-44`): full scan of every review the target ever received on each review create/edit — O(reviews) per rating. Small event count, large per-event cost.
8. **`NotificationFeed.js:66-84`**: 20 reads on every focus (restarts from top).
9. **Private chat open** (`PrivateChat.jsx:161`): 1 lookup per open; rating flow +2.
10. **Unbounded `following`/invitation/join-request queries** (`SocialDashboard.js:179`, `Trades.jsx:434`, `DesignMainScreen.js:125`, `groupUtils.js:624/637/1593/1676/1689`, `Scamwarning.js:64`) — no `limit()`; cost scales with the user's data.
11. Firestore **writes** (740 K/mo): per-game-end 3 setDoc + cache rewrite (`updateLeaderboardCache.js:84` rewrites the whole 20-entry cache doc), `Setting.jsx:1006-1025` default-bio `setDoc` on mount when missing, notifications mark-read, trades/posts/statuses/reviews/follows, group RPC-like transactions.

Listener budget (~20 avg): `GroupsScreen` ×3 per focused user, `GroupChatScreen` ×1 per open group, `CommentsModal`, in-game room. All detach on blur/unmount.

---

## 4. SUPABASE

### 4.1 REST queries (`.from()` / `.rpc()`)

| file:line | Table / RPC | Select | Filters | Limit | Caller / trigger |
|---|---|---|---|---|---|
| `Code/Supabase/userBackend.js:60-64` `getIdentity` | `user_identity` | 9 cols | uid | 1 (`maybeSingle`) | `profileCache.getOrFetchProfile:123` per uncached uid |
| `userBackend.js:132-136` `getRoles` / `:146-150` `getCosmetics` / `:219-223` `getRoblox` | `user_roles` / `user_cosmetics` / `user_roblox` | explicit cols | uid | 1 | `getOrFetchProfile:124-126` (4 round trips per uid), `BottomDrawer.jsx:267-269` (3 per drawer open), `PrivateChatHeader.jsx:64-66` (3 per chat open) |
| `userBackend.js:383-408` `_batchByUid` (identity/roles/cosmetics/roblox batches) | 4 tables | explicit cols | `uid in (≤200)` | chunked | `warmProfileCache:244-247` (4 queries per warm: Trades open, chat page, inbox), `OnlineUsersList.jsx:168-173` (4 per batch) |
| `userBackend.js:172-177` `getUsersByRole` | `user_roles` (+identity batch) | uid | role==true | 100 | Leaderboard role tabs |
| `userBackend.js:264,279,302-305,321-324,352-355` | `user_settings`, `user_notifications`, `user_blocks`, `user_badges` | | uid | — | exported; no hot callers found |
| `userBackend.js:86` `setLastActivity` | **rpc `set_last_activity`** | | | | `GlobelStats.js:552` — once per 6 h per user (MMKV throttle) → **every active user is a Supabase Third-Party-Auth MAU** |
| `Code/Supabase/chatBackend.js:122-151` `loadMessages` | `messages` | 12 cols | room_id, deleted=false, cursor | 10 (`INITIAL_PAGE_SIZE`/`PAGE_SIZE`) | `Trader.jsx:420` room switch/mount, `:775` load-more, `:873` pull-to-refresh |
| `chatBackend.js:160-181` `loadMessagesSince` | `messages` | 12 cols | room_id, deleted, since cursor | 60 | `Trader.jsx:613` gap-fill on **every `SUBSCRIBED`** (incl. the first → 1 extra query per focus/resubscribe) |
| `chatBackend.js:186-209` `loadPinnedMessages` | `pinned_messages` join `messages` | | room_id | none | `Trader.jsx:918` every focus + every pin event |
| `chatBackend.js:326-351,356-452` | `messages` insert/update/select | | | | send, soft-delete, report, bulk delete |
| `chatBackend.js:460-489` | `pinned_messages` insert/delete | | | | mod actions |
| `Code/Supabase/chatMetaBackend.js:63-84` `loadChatMeta` | `chat_meta_data` | 10 cols | owner_uid | **paged 1000 via `.range()` until exhausted (whole chat list)** | first subscribe per session (`subscribeToChatMeta:361`), `fullRefresh` when no cursor |
| `chatMetaBackend.js:94-110` `loadChatMetaSince` | `chat_meta_data` | 10 cols | owner_uid, updated_at>cursor | 1000 | **every foreground** (`:405-411`), every reconnect (`:514`), every late-joiner attach (`:535`, i.e. every Inbox mount) |
| `chatMetaBackend.js:120-129` `resetUnreadCount` | `chat_meta_data` update | | owner,partner | | every private chat **focus** (`PrivateChat.jsx:710`) + blur if partner sent (`:735`); blocked-partner rows on every upsert (`ChatNavigator.js:102`, `InboxScreen.jsx:103`) |
| `chatMetaBackend.js:240` `sendPrivateChatMeta` / `:207` `increment_chat_unread` | **rpc** | | | | per private message |
| `chatMetaBackend.js:254-274` | `chat_meta_data` update/delete | | | | mute / delete chat |
| `Code/Supabase/groupMetaBackend.js:53-74` `loadGroupMeta` | `group_meta_data` | 13 cols | user_id | paged 1000 | Chat tab mount (`ChatNavigator.js:216`) |
| `groupMetaBackend.js:80-87` `resetGroupUnreadCount` | update | | user,group | | every group chat focus + blur (`GroupChatScreen.jsx:523,529`) |
| `groupMetaBackend.js:163` `fanout_group_message_meta` | **rpc** | | | | per group message |
| `groupMetaBackend.js:132-135,178-183,191-196,218-221` | upsert/update/delete | | | | create/mute/leave/rename |
| `Code/Supabase/groupMessagesBackend.js:96-118` `loadGroupMessages` | `group_messages` | 18 cols | group_id, deleted, cursor | 10 | group chat mount / paging / refresh |
| `groupMessagesBackend.js:182` `send_group_message` | **rpc** | | | | per message |
| `Code/Supabase/privateMessagesBackend.js:101-126` `loadPrivateMessages` | `private_messages` | 12 cols | chat_id, deleted, cursor | 10 | chat open / paging / refresh |
| `privateMessagesBackend.js:209-243` | insert (+select on conflict) | | | | per message |
| `Code/Supabase/pollsBackend.js:76-91` `fetchActivePolls` + `:110-124` `fetchMyVotes` | `polls`, `poll_votes` | explicit | active, user_id in | 3 | Design tab mount (`DesignMainScreen.js:89-100`) — 2 queries |
| `pollsBackend.js:213-236` / `:238-258` / `:136` | `poll_comments` paged 2, insert, `cast_poll_vote` rpc | | | | poll interactions |
| `Code/Supabase/usernameBackend.js:34` | `claim_username` rpc | | | | username claim |
| `Code/Supabase/client.js:96-111` | `ensureRoleClaim` CF fetch + forced `getIdToken(true)` | | | | once per launch if claim missing |

`select('*')` is not used anywhere on hot paths (all explicit column lists). Third-party auth: `client.js:141-151` attaches a Firebase ID token to every request, so every signed-in user who touches any Supabase call (heartbeat RPC alone guarantees it) counts as an MAU.

### 4.2 Realtime channels (`.channel()` / `postgres_changes`)

| file:line | Table | Filter | Events | Opened | Closed |
|---|---|---|---|---|---|
| `chatMetaBackend.js:317-359` (via `subscribeToChatMetaShared:413`) | `chat_meta_data` | `owner_uid=eq.{me}` | INSERT/UPDATE/DELETE | Chat tab first mount (`ChatNavigator.js:116`), shared with Inbox (`InboxScreen.jsx:125`) via ref-count | last consumer detaches (ChatStack stays mounted → lives all session). Re-created when `bannedUsers` state identity changes (`ChatNavigator.js:166` deps) |
| `groupMetaBackend.js:242-284` | `group_meta_data` | `user_id=eq.{me}` | I/U/D | Chat tab mount (`ChatNavigator.js:216`) | session; same `bannedUsers`-dep churn |
| `chatBackend.js:228-249` `subscribeToMessages` | `messages` | `room_id=eq.{room}` | I/U/D | Trader focused & not idle-paused (`Trader.jsx:517-747`) | blur, 3-min idle (`:143`), room switch, `resubKey` bump |
| `chatBackend.js:266-287` `subscribeToPinned` | `pinned_messages` | `room_id=eq.{room}` | I/U/D | Trader focus (`:930`) | blur |
| `privateMessagesBackend.js:150-171` | `private_messages` | `chat_id=eq.{chat}` | I/U/D | PrivateChat focused (`PrivateChat.jsx:846`) | blur/unmount |
| `groupMessagesBackend.js:133-154` | `group_messages` | `group_id=eq.{group}` | I/U/D | GroupChat focused & member (`GroupChatScreen.jsx:494`) | blur/unmount |
| `client.js:185-244` | socket | | | reconnect + dead-channel rejoin on foreground | disconnect 20 s after background |

Every subscription carries a row filter — no unfiltered table subscriptions. Cost notes: the public room (`messages` per room) is inherently a fan-out (each INSERT delivered to every focused subscriber = billed message each); the per-user meta channels receive one event per unread bump/reset, and because `resetUnreadCount` is called on every chat focus/blur, each chat visit generates 1–2 UPDATE events echoed back to the user's own meta channel(s). Background disconnect + idle pause are already in place.

---

## 5. TIMERS & POLLING (backend-touching only)

| file:line | Interval / event | Backend call | Population |
|---|---|---|---|
| `Code/ValuesScreen/GlobalGroupInviteToast.jsx:200` | `setInterval` **45 s** + AppState `active` (`:210`) | Firestore `getDocs(group_invitations …)` | every signed-in client, whole session (root mount) |
| `GlobalGroupInviteToast.jsx:303` | `setInterval` **45 s** + AppState `active` (`:312`) | Firestore `getDocs(fruitGuessingGame_userInvites/{me}/invites …)` (+ `deleteDoc` per expired) | same |
| `Code/ValuesScreen/News.js:221` | `setInterval` **5 min** while focused + on focus (`:217`) + mount (`:210`) | RTDB `get('news')` whole node | News screen viewers |
| `Code/HomeTab/HomeTabScreen.jsx:202-205` | `setInterval` **60 s** + AppState active | RTDB `set`+`get` `users/{uid}/_st` (forced) | **banned users only** |
| `Code/GlobelStats.js:989-993` | AppState change | RTDB `set(presence/{uid})` true/false (30 s throttle), onDisconnect arm | all users |
| `GlobelStats.js:783,860` | AppState active | `getServerTime` probe | banned users only |
| `Code/ChatScreen/utils.js:630-633` (`useActiveChatLifecycle`) | AppState change while on a chat screen | RTDB 2–3 sets + 1–2 onDisconnect on `active`; 1–2 sets on background | chat viewers |
| `Code/Supabase/client.js:185-244` | AppState: background +20 s → `realtime.disconnect()`; active → `connect()` + 2 s rejoin sweep | Supabase socket | all with channels |
| `Code/Supabase/chatMetaBackend.js:405-411` | AppState active | Supabase `loadChatMetaSince` (REST) per live shared entry | users who opened Chat tab |
| `Code/ValuesScreen/PetGuessingGame/PetGuessingGameScreen.jsx:459` | `setInterval` 5 s during a game | Firestore `endGameDueToTimeout` write only on timeout | in-game |
| `PetGuessingGameScreen.jsx:479-487` | AppState background during own turn | Firestore end-game write | in-game |
| `Code/GlobelStats.js:546-555` | on `user.id` | Supabase `set_last_activity` RPC, 6 h throttle | all users |
| `GlobelStats.js:224` | 500 ms debounce | RTDB `update(users/{uid})` batched non-critical fields | |
| `utils.js:1341` | 4 s coalesce | RTDB `set(lastRead)` | private chat |
| Local-only timers (no backend): FruitCrash 250 ms/100 ms tickers (`FruitCrash.jsx:233,247`), Checkin 1 s countdown, TimerScreen 1 s, RewardTimer, PetSelectionRound, MemoryMatch, ad managers' `checkInterval`s. |

Focus-driven refetches (not timers but behave like polling under tab switching): `HomeTabScreen.jsx:112-133` (Firestore lookup + RTDB activeItems per Home focus), `CommunityChatHeader.jsx:30-100` (query + count per Chat focus), `GroupsScreen.jsx:154-272` (3 onSnapshot per Groups focus), `NotificationFeed.js:107-118` (20 docs + 1 RTDB per focus), `PrivateChat.jsx:261,704` + `PrivateChatHeader.jsx:185` + `useActiveChatLifecycle` (seed read, unread reset, presence listener, 2 sets + onDisconnect per focus), `Trader.jsx:908-939` (pinned load + channel per focus), `TradeJournal.js:100` / `HomeScreen.jsx:617` (local).

---

## 6. TOP 10 SUSPECTED COST DRIVERS (ranked)

| # | Driver | Evidence | Est. share | One-line fix |
|---|---|---|---|---|
| 1 | **Per-field profile fan-out to RTDB (N+1, 2–15 `get()` per user)** — `profileCache.getOrFetchProfile/warmProfileCache` still do 3 RTDB gets per uid on the Supabase path; whole-node `users/{uid}` reads for one field; OnlineUsersList / PrivateChatHeader / BottomDrawer / SocialDashboard / utils.fetchTargetRoles per-field gets | `Code/Helper/profileCache.js:127,156-158,181-195,249-256`; `PrivateChat.jsx:117`; `OnlineUsersList.jsx:196-238`; `PrivateChatHeader.jsx:67-107`; `BottomDrawer.jsx:271-338,929-931,1363-1364`; `SocialDashboard.js:134-138`; `utils.js:61-65`; `Setting.jsx:1403,1463`; `gameInviteSystem.js:33,765-767` | Largest slice of the 250 M one-shot reads and of the ~52 GB protocol-overhead egress (tiny listen/unlisten pairs) — plausibly 40–60 % of RTDB ops | Move `shop/activeItems`, `hasRecentGameWin`, `lastGameWinAt`, `flage`, `profileFrame` into the Supabase mirror (or a single RTDB `users/{uid}/public` leaf) so a profile is 1 batched Supabase query and 0 RTDB gets; drop the fire-and-forget game-win gets. |
| 2 | **Server-time probe on `users/{uid}/_st` ×2 per cold start (+ deviceId + isPro unconditional writes)** → ~95 K/day `/users` writes → 2 CF invocations each | `serverTime.js:40-41`; `badgeUtils.js:443` ← `MainTabs.js:45`; `starUtils.js:49` ← `HomeTabScreen.jsx:171`; `GlobelStats.js:383,496`; `HomeTabScreen.jsx:196-202` (60 s loop for banned) | ~100 % of the 95 K/day `/users` writes; ~15 % of all RTDB sets; 190 K CF invocations/day | Probe once per launch at a path outside `/users` (e.g. `_st/{uid}`) with `forceProbe=false` sharing the 30 s cache; write `deviceId`/`isPro` only when changed (read them from the `users/{uid}` snapshot already fetched at `GlobelStats.js:305`). |
| 3 | **`GlobalGroupInviteToast` 45 s Firestore polling (2 queries) for every client, all session** | `GlobalGroupInviteToast.jsx:148-154,200,234-246,303` | 15–30 % of 2.5 M Firestore reads/day | Replace with a single `onSnapshot` on `group_invitations` (delivers only on change; idle listener costs 0 reads) or push via FCM data message; at minimum gate the interval on `AppState === 'active'` and raise to 5 min. |
| 4 | **Presence + active-chat lifecycle churn (sets + onDisconnect)** — presence effect re-runs on role resolution, `set(false)` on cleanup, per fg/bg/reconnect; `setActiveChat` 2 sets + onDisconnect on every chat focus and every foreground | `GlobelStats.js:879-1013`; `utils.js:539-641`; `PrivateChat.jsx:271`; `GroupChatScreen.jsx:510` | Most of the 20 M sets not under `/users` and most of the 3.3 M onDisconnect ops | Remove `isAdmin/isUserBlocked/showOnlineStatus` from the presence effect deps (read via refs); arm onDisconnect once per connection; write `activeChats` only on focus change (not on every AppState flip) and let the single `onDisconnect` handle disconnects. |
| 5 | **Whole-`users/{uid}` subtree read on every auth resolve** (shop inventory, checkin, submissions, badges, counters, purchases…) + `calcData`/`previousStock` whole-node re-reads on every pull-to-refresh | `GlobelStats.js:305,642,676`; `reload()` callers `ValueScreen.jsx:75`, `TimerScreen.jsx:129`, `HomeScreen.jsx:108`; also `BadgesScreen.js:292`, `PrivateChat.jsx:117`, `gameInviteSystem.js:33` | Big share of the 18.8 GB payload egress | Read only the fields login needs (`displayName,email,role flags`) or keep a slim `users/{uid}/profile` leaf; cache `calcData` under an ETag/version key instead of forcing on refresh. |
| 6 | **Home tab per-focus reads**: `getActiveCosmetics` RTDB get (+ expiry `set(null)`) and Firestore `user_profiles` lookup on every return to Home | `HomeTabScreen.jsx:112-133`; `shopUtils.js:219-269` | ~5 % RTDB one-shots, ~5 % Firestore reads | Read once per session (MMKV `cosmeticsCache` already exists — use `getMyCosmetics()`), refetch on explicit invalidation. |
| 7 | **Trades feed refetch + profile warm** — 30 Firestore reads + `following` (≤200) + `warmProfileCache` (≤90 RTDB gets) per open/filter/refresh | `Trades.jsx:318-323,877-921,952,1182-1214,1266-1290` | ~10–15 % Firestore reads; ~15 % RTDB one-shots | Cache `following` in MMKV (1 h TTL like StatusFeed), keep the feed in memory across tab switches, embed `tradeCardBg/profileFrame` on the trade doc at write time so no per-poster lookups are needed. |
| 8 | **Chat/Groups focus churn on Firestore & Supabase** — `CommunityChatHeader` query+count per Chat focus, `GroupsScreen` 3 listeners re-attached per focus, `resetUnreadCount` REST update on every chat focus/blur + `loadChatMetaSince` per foreground/late-joiner, `loadPinnedMessages` + gap-fill query per Trader focus | `CommunityChatHeader.jsx:30-100`; `GroupsScreen.jsx:154-272`; `PrivateChat.jsx:704-739`; `GroupChatScreen.jsx:514-533`; `chatMetaBackend.js:120-129,405-411,535`; `Trader.jsx:610-627,908-939` | ~5–10 % Firestore reads; a large share of Supabase REST + realtime echo messages | Keep badge counts in the shared chat-meta stream instead of re-querying; reset unread only when `unread_count>0`; use `useEffect` (mount-scoped) rather than `useFocusEffect` for listeners that are cheap to keep. |
| 9 | **Notifier index backfill inside `onValue`** and other per-row loops: N `notifier_index` gets per listener fire; `GroupsScreen` per-creator gets; `Setting` review modals whole-user gets; `groupUtils` whole-user gets per member; `Notifier` multi-path update | `Notifier.js:82-153`; `GroupsScreen.jsx:840-856,893-909`; `Setting.jsx:1399-1423,1459-1480`; `groupUtils.js:188-198,808-818` | few % but pure waste | Write the index at item-add time only (already done at `:185`); denormalise creator name onto the group doc; use `warmProfileCache`/Supabase batch. |
| 10 | **Unbounded / whole-node reads on secondary screens**: `users` broad `limitToFirst(500)` search scans, `fruitCrash/leaderboard` whole node per mount + tab, `like_counter` whole node, `news` 5-min poll, `ratingSummaryHelper` full review scan per rating, no-`limit()` `following`/invitation queries | `OnlineUsersList.jsx:470`; `SocialDashboard.js:347,462,179`; `AdminDashboard.js:630`; `FruitCrash.jsx:297`; `HDwallpaper.js:72`; `News.js:221`; `ratingSummaryHelper.js:39-44`; `Trades.jsx:434`; `groupUtils.js:624,637,1593,1676,1689` | Payload-heavy (egress) rather than op-heavy | Add `limit()` everywhere; keep `fruitCrash/leaderboard` as a server-maintained top-30 doc; index search server-side (Supabase `ilike`); maintain rating summary incrementally (already computed inline at `PrivateChat.jsx:308-316` — drop the re-scan). |

Honourable mentions: `registerForNotifications` called 3× per launch (`GlobelStats.js:387,400,417` → 3 `fcmToken` reads); `addXP` does read-after-write + second update (`xpUtils.js:105-122` — compute level from `increment` result or via a CF); `ChatNavigator`/`InboxScreen` resubscribe Supabase channels whenever `bannedUsers` array identity changes (`ChatNavigator.js:166`, `InboxScreen.jsx:195`); dead code still shipping Firestore/RTDB calls (`GameActivityBanner.js`, `PetGuessingGame/components/GlobalInviteToast.jsx`, `isUserInActiveGame`); RTDB-fallback branches (`Trader.jsx:467-497,722-747`, `ChatNavigator.js:123-166,224-270`, `InboxScreen.jsx:145-195`, `profileCache.js:176-223`, `OnlineUsersList.jsx:221-266`, `PrivateChatHeader.jsx:93-125`, `BottomDrawer.jsx:302-354`) silently kick in on any Supabase error/JWT race and multiply RTDB reads 5–15× for that session — worth logging when they trigger.
