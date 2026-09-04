# blox-web — Firebase (RTDB + Firestore) cost-driver audit

Codebase: `/Volumes/Sohail/AI_Projects/RunningWebsites/blox-web` (Next.js 16, `firebase` web SDK 12, project `fruiteblocks`).
Sibling app checked for split-brain: `/Volumes/Sohail/AI_Projects/RunningApps/Blox_Fruit` (RN, Supabase cut-over per `HANDOFF.md`).
Read-only audit; no files modified. All paths below are relative to `blox-web/` unless absolute.

## 0. Headline findings

- **No Supabase in the website.** No dependency, no import, no URL. The only non-SDK backend calls are unauthenticated Firestore REST `runQuery` POSTs (server ISR helpers in `src/lib/data/*.ts` + one client call in `GroupsList.tsx`) and one dead RTDB REST helper (`src/lib/data/imageBase.ts`, never imported).
- **Two whole-subtree RTDB reads dominate egress risk:** `users` (entire tree, ~142k users) read on every desktop chat-room mount for signed-in users (`src/lib/firebase/database.ts:118`), and `calcData` (entire node) read by the stock page SSR and the orphan `/api/stock` route (`src/app/[locale]/(main)/stock/page.tsx:54`, `src/app/api/stock/route.ts:9`).
- **Firestore:** a 30 s `setInterval` poll on `/trades` (`src/components/trades/TradeList.tsx:88`) and an uncached 8-read N+1 on the homepage (`src/components/home/TopRatedTrades.tsx:42-64`) are the volume drivers. No `onSnapshot` listeners are live.
- **Split-brain confirmed.** The RN app reads *and writes* public chat, DMs, group messages, chat metadata and group metadata in Supabase only (`Blox_Fruit/HANDOFF.md:12,95-125`, `Code/Supabase/chatBackend.js:1-6`, `privateMessagesBackend.js:1-8`, `featureFlags.js: SUPABASE_READS_ENABLED = true`). The website still reads/writes the RTDB paths (`chat_*_upgrade`, `private_messages`, `group_messages`, `chat_meta_data`, `group_meta_data`). Web users never see app messages; web DMs/group messages never reach the app (not mirrored, no push); web metadata writes DO get mirrored by still-deployed Cloud Functions, producing inbox rows in the app whose bodies do not exist. Every web message also costs 1-N Cloud Function invocations.
- **Every signed-in visitor holds an RTDB websocket on every page** (presence + ban listener mounted in the root `Providers`), contributing to concurrent connections even on pages that never touch RTDB.
- Could not measure node sizes: the REST probe (`curl .../calcData.json`, `users.json?shallow=true`) was blocked by the permission classifier. Sizes are flagged "unmeasured" where relevant; a 30-second `firebase database:profile` or a shallow REST curl will settle #1 vs #2.

Rules context (from `Blox_Fruit/database.rules.json`, assumed deployed): `users` `.read: true` (whole tree readable by anyone); `presence` `.read: "auth != null"`; `calcData`, `chat_meta_data`, `private_messages`, `group_messages`, `group_meta_data`, `activeGroupChats`, `api`, `server`, `free_translation`, `banned_users_by_email` all `.read: true`; `chat_*_upgrade` `.read: "auth != null"`; `chat_new_upgrade/$message_id` `.write: false`; `deletionRequests` has no rule (write denied).

---

## 1. RTDB READS

| # | file:line | path | op | filter / limit | trigger | listener cleaned up? | flag |
|---|---|---|---|---|---|---|---|
| 1 | `src/lib/firebase/auth.ts:83` (via `src/lib/hooks/useFirebaseAuth.ts:59`) | `users/{uid}` | `get` | whole node | `onAuthStateChanged` — once per page load / hard reload for every signed-in visitor, all pages | n/a | Full user blob (coins, purchases, cosmetics, shop, checkin, blocked_users...). The app split this into 8 Supabase tables because it is large. |
| 2 | `src/lib/firebase/database.ts:559`, `:569`, `:543` (via `useFirebaseAuth.ts:77-81`) | `api`, `free_translation`, `server` | `get` x3 | whole nodes (tiny) | after sign-in; localStorage cache 1 h | n/a | Fine. (`api` node is a key readable by anyone — not a cost issue.) |
| 3 | `src/lib/firebase/database.ts:47` (via `src/lib/hooks/usePresence.ts:13`, mounted in `src/components/providers/Providers.tsx:30`) | `.info/connected` | `onValue` | — | mount, every signed-in visitor, every page | yes (`database.ts:65`) | Opens and holds the RTDB websocket for the whole session site-wide → **concurrent connections**. |
| 4 | `src/lib/hooks/useBanStatus.ts:63-65` (via `BanGuard`, `Providers.tsx:44`) | `banned_users_by_email/{email}` | `onValue` | single node | mount, every signed-in visitor, every page | yes (`:96`) | Small payload; second reason the socket never closes. |
| 5 | `src/lib/hooks/useImageBase.ts:13` → `database.ts:528` | `image_url` | `get` | tiny | first `MessageBubble` mount per page load (module-level cache) | n/a | Fine. |
| 6 | `src/lib/firebase/database.ts:106` (via `src/components/chat/OnlineUsers.tsx:21`) | `presence` | `get` | **whole node, no query** | mount of `OnlineUsers` = desktop `/chat/[roomId]` (`src/app/[locale]/(main)/chat/[roomId]/ChatRoomPageClient.tsx:39`) | n/a | Rules require auth → anonymous throws (caught) and skips #7. App instead uses `orderByValue().equalTo(true)` (index exists). |
| 7 | `src/lib/firebase/database.ts:118` (same caller) | `users` | `get` | **WHOLE SUBTREE (~142k users)** | same as #6, signed-in desktop users only | n/a | **Worst single read in the site.** Pulls every user object to render ≤50 names. `users` is `.read: true` so it succeeds. |
| 8 | `src/lib/firebase/searchUsers.ts:47-56` (via `src/components/chat/UserSearch.tsx:32`) | `users` | `get(query)` | `orderByChild('displayName')`, `startAt/endAt`, `limitToFirst(15)`, run for 2 case variants | 400 ms debounce per keystroke / Enter | n/a | Indexed and bounded (≤30 full user objects). OK. |
| 9 | `src/lib/firebase/database.ts:154-163` (via `src/components/chat/ChatRoom.tsx:31`) | `chat_new_upgrade` / `chat_{lang}_upgrade` (community) or `group_messages/{gid}/messages` | `get(query)` | `orderByKey`, `limitToLast(20)` | `ChatRoom` mount + every channel switch (`ChatPageClient.tsx:39-45`) | n/a | Rules need auth → anonymous `/chat` visitors: promise rejects unhandled, skeleton forever, socket still opened. App no longer writes here. |
| 10 | `src/lib/firebase/database.ts:158` | same | `get(query)` | `endAt(lastKey)`, `limitToLast(20)` | scroll-to-top pagination (`ChatRoom.tsx:66`) | n/a | OK. |
| 11 | `src/lib/firebase/database.ts:183-189` (via `ChatRoom.tsx:44`) | same | `onValue` | `limitToLast(1)` | mount / channel switch, open while room visible | yes (`ChatRoom.tsx:51`) | Only fires for web-originated messages now. |
| 12 | `src/components/chat/ChatRoomList.tsx:58-59` | `group_meta_data/{uid}` | `onValue` | whole per-user subtree | mount (desktop `/chat` always; mobile "Groups" tab) | yes (`:106`) | App writes go to Supabase → data is stale/partial. |
| 13 | `src/lib/firebase/database.ts:470` (via `src/components/chat/Inbox.tsx:30`) | `chat_meta_data/{uid}` | `onValue` | whole per-user subtree (one row per partner ever chatted; 1.07M rows project-wide) | mount (desktop `/chat` always; mobile "Inbox" tab) | yes (`:35`) | Large for active traders; stale vs app. |
| 14 | `src/lib/firebase/chatAvailability.ts:47-48` (via `src/components/chat/PrivateChatRoom.tsx:67-70`) | `users/{uid}/chatOffTrade`, `users/{uid}/chatOffGeneral` for both users | `get` x4 | leaf | DM open | n/a | Fine (deliberately leaf reads). |
| 15 | `src/lib/firebase/database.ts:334-343` (via `PrivateChatRoom.tsx:113`) | `private_messages/{chatKey}/messages` | `get(query)` | `orderByKey`, `limitToLast(20)` | DM open (DM page, `TradeCard` sheet, `TopTradersLeaderboard` sheet) | n/a | App no longer writes here. |
| 16 | `src/lib/firebase/database.ts:362-366` (via `PrivateChatRoom.tsx:127`) | `private_messages/{chatKey}/messages` | `onValue` | `limitToLast(1)` | DM open | yes (`:133`) | |
| 17 | `src/lib/firebase/database.ts:430` | `users/{otherUserId}/activeChat` | `get` | leaf | every DM send | n/a | App never writes this field (it uses `/activeChats/{uid}`), so receiver is always "not in chat". |
| 18 | `src/lib/firebase/database.ts:252` | `activeGroupChats/{gid}` | `get` | node | every group-room send | n/a | Tiny. |
| 19 | `src/lib/firebase/database.ts:33` (via `src/app/[locale]/(main)/chat/dm/[userId]/DMPageClient.tsx:25` and `src/app/[locale]/(main)/profile/[userId]/PublicProfileClient.tsx:29`) | `users/{uid}` | `get` | whole node | DM page mount, public profile mount | n/a | Full user blob again, to show name + avatar. |
| 20 | `src/app/[locale]/(main)/stock/page.tsx:54` | `calcData` | `get` (server, client SDK from Node) | **whole node** | SSR, ISR `revalidate = 300`, rendered separately for each of 10 locales → up to 2,880 renders/day | n/a | Page uses only `calcData/test` + `calcData/mirage`; node also holds `live/*`, `meta` (`Blox_Fruit/functions/checkStockUpdates.example.js:44-53`) and whatever the app's calculator stores there (`Blox_Fruit/Code/GlobelStats.js:642` reads the same node as "calc data"). **Size unmeasured.** |
| 21 | `src/app/api/stock/route.ts:9` | `calcData` | `get` (server) | **whole node** | every HTTP request, `force-dynamic`, zero caching | n/a | **Orphan**: no caller in this repo, the RN app, or any sibling repo — but publicly reachable. |
| 22 | `src/lib/data/imageBase.ts:15` | `image_url.json` (REST) | `fetch` | tiny | dead code (never imported) | — | Delete. |

Dead exports in `src/lib/firebase/database.ts` / `firestore.ts` with zero callers (cost nothing today, but are footguns): `onPresenceChange` (:71), `onAllPresenceChange` (:80, whole-`presence` listener), `getOnlineUsersOnce` (:91), `onChatMessages` (:491, `limitToLast(50)` listener), `sendChatMessage` (:511), `onGroupMetaData` (:298), `onTradesSnapshot` (`firestore.ts:69`), `getUserReview` (:194), `updateTrade` (:127), `updateUserInRTDB` (`auth.ts:95`).

## 2. RTDB WRITES

| # | file:line | path | op | trigger | notes / downstream cost |
|---|---|---|---|---|---|
| 1 | `src/lib/firebase/database.ts:49-50` | `presence/{uid}` = `true`; `onDisconnect(presence/{uid}).set(false)` | `set` + `onDisconnect` | every (re)connect of `.info/connected`, every signed-in visitor, every page | Same path/shape the app uses (`GlobelStats.js:883`) — consistent. Re-armed on every reconnect. |
| 2 | `src/lib/firebase/database.ts:54-62` | `presence/{uid}` | `set true/false` | **every `visibilitychange`** (tab switch) | Unthrottled write per focus/blur. |
| 3 | `src/lib/firebase/database.ts:67` | `presence/{uid}` = `false` | `set` | unmount / sign-out | |
| 4 | `src/lib/firebase/auth.ts:92` (via `useFirebaseAuth.ts:64`) | `users/{uid}` | `set` whole object | first sign-in only | Fires `mirrorUsersToSupabase` CF. Writes `online:false`, `lastactivity:null` once; **no heartbeat, no `lastactivity` updates anywhere.** |
| 5 | `src/lib/firebase/database.ts:38` (via `src/components/profile/EditProfileModal.tsx:63`) | `users/{uid}` | `update` | user action | Fires `mirrorUsersToSupabase`. |
| 6 | `src/lib/firebase/database.ts:458`, `:462` (via `PrivateChatRoom.tsx:139-140`) | `users/{uid}/activeChat` | `set chatKey` / `set null` | **every DM open and close** | Writes into the `users` row → 2 `mirrorUsersToSupabase` invocations per DM view, for a field only the website reads (#17 above). |
| 7 | `src/lib/firebase/database.ts:290`, `:294` (via `ChatRoom.tsx:57-58`) | `activeGroupChats/{roomId}/{uid}` | `set true` / `set null` | every room open/close, including community rooms | Tiny. |
| 8 | `src/lib/firebase/database.ts:214-224` (via `src/components/chat/MessageInput.tsx:43`) | `chat_{lang}_upgrade/{pushKey}` | `push` + `set` (`serverTimestamp`) | community send | Rules: `chat_new_upgrade/$message_id .write: false` → **English-channel sends from web are PERMISSION_DENIED**; other 14 channels allowed. Allowed sends are mirrored to Supabase by `mirrorPublicChatMessageToSupabase` (1 CF each), so app users do see them. |
| 9 | `src/lib/firebase/database.ts:233` | `group_messages/{gid}/messages/{ts}` | `set` | group send | **Not mirrored** → invisible to app. |
| 10 | `src/lib/firebase/database.ts:276` | `/` multi-path `update` of `group_meta_data/{member}/{gid}/{5 leaves}` for every member | `update` | group send | N member rows → N `mirrorGroupMetaToSupabase` invocations; app inbox shows a preview for a body it cannot load. |
| 11 | `src/lib/firebase/database.ts:283` | `group_meta_data/{member}/{gid}/unreadCount` | `set(increment(1))` | group send, per inactive member | +1 write and +1 CF per member. |
| 12 | `src/lib/firebase/database.ts:427` | `private_messages/{chatKey}/messages/{ts}` | `set` | DM send | **Not mirrored, no push** (notify CF moved to a Supabase webhook, `HANDOFF.md:189-194`). App never sees it. |
| 13 | `src/lib/firebase/database.ts:434`, `:445` | `chat_meta_data/{me}/{other}`, `chat_meta_data/{other}/{me}` | `update` (+`increment`) | DM send | Mirrored by `mirrorChatMetaToSupabase` (2 CF invocations) → app inbox row appears with an empty conversation. |
| 14 | `src/lib/firebase/database.ts:581`, `:586` | message paths | `remove` | user delete | |
| 15 | `src/app/[locale]/(main)/delete-account/page.tsx:36-37` | `deletionRequests/{push}` | `push` + `set` | user action | No rule for this path → write denied; nothing in the app reads it either. |

## 3. FIRESTORE reads / writes

Client SDK (counts as query document reads):

| # | file:line | collection | op | filter / orderBy / limit | trigger | flag |
|---|---|---|---|---|---|---|
| 1 | `src/lib/firebase/firestore.ts:56-57` `getTrades` | `trades_new_upgrade` | `getDocs` | `orderBy timestamp desc`, `limit 10` (+`where status`/`userId`, `startAfter`) | `TradeList.tsx:65` initial (when no SSR data / filter change), **`:88` every 30 s**, `:147`/`:177` load more; `ProfileTrades.tsx:20` | 10 reads per call; see §5. |
| 2 | `src/components/home/TopRatedTrades.tsx:42-46` | `user_ratings_summary` | `getDocs` | `orderBy count desc`, `limit 5` | **homepage mount** (`src/app/[locale]/(main)/page.tsx:323`), client-side, every visitor, no cache | Highest-traffic page. |
| 3 | `src/components/home/TopRatedTrades.tsx:63-64` | `trades_new_upgrade` | `getDocs` x3 | `where userId ==`, `orderBy timestamp desc`, `limit 1` | same | N+1 enrich → **8 reads per homepage view**. An ISR'd server equivalent already exists (`src/lib/data/topTraders.ts`) but is not used here. |
| 4 | `src/components/trades/TopTradersLeaderboard.tsx:205-206` | `user_ratings_summary` | `getDocs` | `orderBy count desc`, `limit 10` | first "Load More" click — re-fetches page 1 only to obtain a cursor | 10 wasted reads. |
| 5 | `TopTradersLeaderboard.tsx:214-215` | `user_ratings_summary` | `getDocs` | `limit 10`, `startAfter` | Load More | |
| 6 | `TopTradersLeaderboard.tsx:44-49` | `trades_new_upgrade` | `getDocs` x10 | `where userId`, `orderBy`, `limit 1` | per Load More | N+1 (~30 reads per click total). |
| 7 | `src/components/trades/CreateTradeForm.tsx:105` | `user_ratings_summary/{uid}` | `getDoc` | — | trade submit | Fine. |
| 8 | `src/lib/firebase/firestore.ts:100`, `:108` | `trades_new_upgrade`, `user_activity` | `addDoc` x2 | — | trade submit | |
| 9 | `firestore.ts:132`, `:136` | `trades_new_upgrade/{id}`, `designPosts_upgrade/{id}` | `deleteDoc` | — | user action | |
| 10 | `firestore.ts:158-159` `getPosts` | `designPosts_upgrade` | `getDocs` | `orderBy createdAt desc`, `limit 10` (+`where userId` / `array-contains tag`, `startAfter`) | `PostFeed.tsx:91` filter change, `:114`/`:122` load more | OK. |
| 11 | `firestore.ts:172` `getPostById` | `designPosts_upgrade/{id}` | `getDoc` | — | **SERVER** `src/app/[locale]/(main)/feed/[id]/page.tsx:20` (`generateMetadata`) **and** `:50` (page) | 2 reads per render, no `React.cache()`, no `revalidate` export. |
| 12 | `firestore.ts:88-89` `getTradeById` | `trades_new_upgrade/{id}` | `getDoc` | — | **SERVER** `src/app/[locale]/(main)/trades/[id]/page.tsx:18` and `:48` | Same pattern. |
| 13 | `firestore.ts:183-188` `getComments` | `designPosts_upgrade/{id}/comments` | `getDocs` | `orderBy timestamp asc`, `limit 20` | `CommentsSection.tsx:41` mount (client, per post-detail view) | OK. |
| 14 | `src/components/feed/CommentsSection.tsx:56-60` | comments `addDoc` + post `updateDoc(increment)` | write x2 | — | comment send | |
| 15 | `src/components/feed/PostCard.tsx:69`, `:76` | `designPosts_upgrade/{id}` `likes.{uid}` | `updateDoc` | — | like toggle | |
| 16 | `src/components/feed/CreatePostModal.tsx:120` | `designPosts_upgrade` | `addDoc` | — | post create | |
| 17 | `src/components/profile/ProfilePosts.tsx:21-27` | **`posts`** (wrong collection; rest of site + app use `designPosts_upgrade`, and it orders by `timestamp` not `createdAt`) | `getDocs` | `where userId`, `orderBy timestamp`, `limit 12` | profile "Posts" tab | Returns nothing — cheap but broken. |
| 18 | `firestore.ts:224` `getUserRatingSummary` | `user_ratings_summary/{uid}` | `getDoc` | — | `ProfileRatingSummary.tsx:51` (Reviews tab) | **Not per trade card** — `TradeCard`/`TradeDetail` display `trade.rating`/`ratingCount` baked into the trade doc. No N+1 there. |
| 19 | `firestore.ts:300-306` `getUserReviews` | `reviews` | `getDocs` | `where toUserId`, `orderBy updatedAt desc`, `limit 20` | Reviews tab | OK. |
| 20 | `firestore.ts:235` `getMyReviewForUser` | `reviews/{to}_{from}` | `getDoc` | — | **every DM open** (`PrivateChatRoom.tsx:88`) + `RateUserModal` open | 1 read per DM view. |
| 21 | `firestore.ts:243-244` `updateUserRatingSummary` | `reviews` | `getDocs` | `where toUserId ==` — **NO LIMIT** | after every review submit | Scans every review the trader has ever received. |
| 22 | `firestore.ts:272`, `:276` `submitReview` | `reviews/{id}` | `getDoc` + `setDoc` | — | review submit | |
| 23 | `src/components/scammer/ScammerDatabase.tsx:138-151` | `scammerSummaries` | `getDocs` | `orderBy reportCount desc, updatedAt desc`, `limit 15` (+`where status`, `startAfter`) | `/scammer` mount (`:131-136`), filter change (`:218`), load more | OK. |
| 24 | `ScammerDatabase.tsx:191-199` | `scammerSummaries` | `getDocs` | prefix `where` on `reportedUsername_lc`, `orderBy`, `limit 15` | Enter / Search button (`:430`, `:441`) | OK. |
| 25 | `ScammerDatabase.tsx:236` | `scammerDetails/{id}` | `getDoc` | — | tap (in-memory cached) | OK. |
| 26 | `ScammerDatabase.tsx:329-382` | `userRateLimits/{uid}` (`tx.get`), `scammerSummaries` (`getDocs where == limit 1`), `tx.set` summary/detail/rate-limit | transaction | report submit | OK. |
| 27 | `src/lib/firebase/database.ts:240` | `groups/{gid}` | `getDoc` | — | per group-room send | OK. |

Firestore REST (`firestore.googleapis.com/v1/.../documents:runQuery`, **no Authorization header** — relies on public read rules):

| # | file:line | collection | limit | trigger | caching |
|---|---|---|---|---|---|
| 28 | `src/lib/data/trades.ts:89` | `trades_new_upgrade` | 12, `select` fields | `/trades` page (`revalidate = 300`), per locale | `next.revalidate: 300` + page ISR → ≤ 12 reads x 10 locales / 5 min |
| 29 | `src/lib/data/topTraders.ts:31` + `:75` | `user_ratings_summary` (11) + `trades_new_upgrade` x10 (limit 1) | 21 reads per render | `/top-traders` (`revalidate = 600`), per locale | ISR 600 |
| 30 | `src/lib/data/groups.ts:42` | `groups` `where isActive` | 12 | `/chat` page (`revalidate = 1800`), per locale | ISR 1800 |
| 31 | `src/lib/data/posts.ts:58` | `designPosts_upgrade` | 5 | `/feed` (`revalidate = 600`), per locale | ISR 600 |
| 32 | **`src/components/chat/GroupsList.tsx:44` (CLIENT)** | `groups` `where isActive` | **`limit: 200`, no cursor** | each "Load More Groups" click (`:81-99`) | none — up to 200 reads per click to display 12 |

Listeners: no live `onSnapshot` anywhere (`onTradesSnapshot` is defined at `firestore.ts:69` but unused). Good.

## 4. SERVER-SIDE (per request vs cached)

| file | backend touched | runs | caching / revalidate |
|---|---|---|---|
| `src/middleware.ts` | none (next-intl only) | per request | — |
| `src/app/api/stock/route.ts:9` | RTDB `get(calcData)` whole node | **per request** | `export const dynamic = 'force-dynamic'`, **no cache at all**; orphan endpoint (no caller anywhere) |
| `src/app/api/health/route.ts` | CDN `data.json` only | Docker `HEALTHCHECK` every 30 s (`Dockerfile:59`, `docker-compose.yml`), `deploy.sh:30` | `fetch` `revalidate: 3600` — no Firebase |
| `src/app/api/analytics/route.ts`, `api/codes/route.ts`, `api/value-changes/route.ts` | Bunny CDN only, with `?cb=Date.now()` cache-buster | per request, `force-dynamic` | value-changes declares `revalidate: 3600` but the `cb` param defeats it — CDN egress, not Firebase |
| `src/app/api/indexnow/route.ts` | CDN + IndexNow | manual POST | — |
| `src/app/[locale]/(main)/stock/page.tsx:54` | RTDB `get(calcData)` whole node via client SDK in Node | ISR `revalidate = 300`, separately per locale (10) | page cache only; nothing dedupes across locales |
| `src/app/[locale]/(main)/trades/[id]/page.tsx:18`, `:48` | Firestore `getDoc` x2 (metadata + page, no `React.cache()`) | on demand per (locale, id) | **no `revalidate` export** → static-on-demand, cached until redeploy (or per request if next-intl marks it dynamic); either way 2 reads per render |
| `src/app/[locale]/(main)/feed/[id]/page.tsx:20`, `:50` | Firestore `getDoc` x2 | same | same |
| `src/app/[locale]/(main)/trades/page.tsx:36` | Firestore REST | ISR 300 | Data Cache 300 |
| `src/app/[locale]/(main)/top-traders/page.tsx:28` | Firestore REST x11 | ISR 600 | Data Cache 600 |
| `src/app/[locale]/(main)/chat/page.tsx:37` | Firestore REST | ISR 1800 | Data Cache 1800 |
| `src/app/[locale]/(main)/feed/page.tsx:37` | Firestore REST | ISR 600 | Data Cache 600 |
| `sitemap.ts`, `robots.ts`, `manifest.ts`, `/`, `/values*`, `/calculator`, `/codes`, `/analytics`, `/news`, `/guides/*`, `/blog/*`, `/compare/*` | CDN or static only | ISR 3600–86400 | no Firebase |
| `src/lib/firebase/config.ts:32-34` | `getAuth/getFirestore/getDatabase` created eagerly at import and shared by the server bundle | once per Node process | after the first server `get()` the RTDB SDK keeps a persistent websocket → 1 concurrent connection per process (`ecosystem.config.js` `instances: 1`; 1 container). Negligible count, but each server `get()` is a listen+unlisten pair on the one-shot-read meter. |

No cron, no scheduled revalidation, no `unstable_cache` / `'use cache'`. Nothing in `deploy/`, `deploy.sh`, or `public/sw.js` polls `/api/stock`.

## 5. TIMERS & POLLING

| file:line | mechanism | period | hits backend? | lifecycle |
|---|---|---|---|---|
| `src/components/trades/TradeList.tsx:27`, `:88-90` | `setInterval` → `getTrades({}, 10)` | **30 s** | **Firestore, 10 reads per tick** | cleared on unmount / filter change (`:92-94`, `:102`); **no visibility gate** — keeps polling in background tabs (28,800 reads/day per forgotten tab) |
| `src/lib/firebase/database.ts:54-62` | `visibilitychange` → `set(presence/{uid})` | per tab focus/blur | RTDB write | removed on cleanup |
| `src/lib/hooks/useBanStatus.ts:103` | `setInterval` | 60 s | no (local countdown text) | cleared |
| `src/components/stock/StockDisplay.tsx:51` | `setInterval` | 1 s | no (local countdown) | cleared |
| `src/components/chat/UserSearch.tsx:53` | `setTimeout` debounce | 400 ms | RTDB indexed query per keystroke pause | cleared |
| `src/components/scammer/ScammerDatabase.tsx:218` | `setTimeout` | 50 ms once | Firestore page fetch on filter change | — |
| `Dockerfile:59` / `docker-compose.yml` | `HEALTHCHECK` → `/api/health` | 30 s | CDN only (cached 1 h) | — |
| `public/sw.js` | network-first SW | — | no background sync / periodic sync | — |
| `AdSlot`, `ExtensionInstallPrompt`, `PWAInstallBanner`, `CookieConsent`, `CodesDisplay`, `CreateTradeForm` | `setTimeout` | UI only | no | — |

No timer touches RTDB reads. The only RTDB polling-like behaviour is the presence write on tab switches.

## 6. TOP 10 SUSPECTED COST DRIVERS (ranked)

| # | driver | evidence | meter hit | one-line fix |
|---|---|---|---|---|
| 1 | **Whole `users` subtree read to render an online list** | `src/lib/firebase/database.ts:118` ← `OnlineUsers.tsx:21` ← desktop `/chat/[roomId]` (`ChatRoomPageClient.tsx:39`); `users` `.read: true`; ~142k users (`Blox_Fruit/HANDOFF.md` backfill count); reached by every signed-in user who clicks the "Community Chat" card (`ChatRoomList.tsx:135` → `/chat/community`) | **RTDB egress** (dominant), RTDB one-shot reads | Query `presence` with `orderByValue().equalTo(true)` (index exists), then `get(users/{uid}/displayName)` etc. for ≤50 ids — or read `user_identity` from Supabase like the app, or drop the widget. |
| 2 | **Whole `calcData` node on `/stock` SSR (x10 locales) and orphan `/api/stock`** | `stock/page.tsx:54` (ISR 300 → ≤2,880 full reads/day), `api/stock/route.ts:9` (force-dynamic, per request, no caller); page needs only `test` + `mirage` children; node also carries `live/*`, `meta`, and the app's calculator payload (`GlobelStats.js:642`) — **size unmeasured** | RTDB egress + reads | Read `calcData/test` and `calcData/mirage` only (or REST `calcData/test.json`), fetch once per revalidate window via `unstable_cache` shared across locales, delete or ISR `/api/stock`. Measure first: `curl -s -o /dev/null -w '%{size_download}' https://fruiteblocks-default-rtdb.firebaseio.com/calcData.json`. |
| 3 | **30 s Firestore poll on `/trades`** | `TradeList.tsx:88` — 10 docs / 30 s / open tab, runs while hidden | **Firestore reads** | Gate on `document.visibilityState === 'visible'`, lengthen to ≥2 min, or poll an ISR'd `/api/trades` (the SSR data is already 5-min fresh). |
| 4 | **Homepage `TopRatedTrades` N+1 client fetch** | `TopRatedTrades.tsx:42-64` — 8 uncached reads per homepage view on the highest-traffic page (`page.tsx:323`) | Firestore reads | Render from `fetchTopTradersServer()` (`src/lib/data/topTraders.ts`, REST + ISR 600) as props; denormalise `traderName`/`avatar` onto `user_ratings_summary` to remove the per-trader trade query. |
| 5 | **Site-wide RTDB socket for every signed-in visitor** | `Providers.tsx:29-30` → `database.ts:47` (`.info/connected`) + `useBanStatus.ts:65`; presence write churn on every tab switch (`database.ts:54-62`) | **RTDB concurrent connections** (+ writes) | Mount presence/ban listeners only on `/chat*` routes (or lazily on first chat interaction); replace the ban listener with a one-shot `get` re-checked on send. |
| 6 | **Split-brain chat on RTDB paths the app abandoned** | writes `database.ts:214-224` (`chat_*_upgrade`), `:233/:276/:283` (`group_messages` + `group_meta_data` fan-out), `:427/:434/:445` (`private_messages` + `chat_meta_data`); listeners `:189`, `:366`, `ChatRoomList.tsx:59`, `Inbox.tsx:30`. App is Supabase-only for all five (`HANDOFF.md:12,95-125`; `Code/Supabase/chatBackend.js:1-6`; `privateMessagesBackend.js:1-8`; `featureFlags.js`). Mirror CFs still deployed (`functions/index.js:34-39`) so each web send costs 1–N invocations; `private_messages`/`group_messages` are not mirrored and trigger no push; web readers never see app messages; English channel sends are also blocked by rules (`chat_new_upgrade/$message_id .write:false`). | RTDB reads/egress/connections, CF invocations, RTDB storage growth | Port web chat to the Supabase tables (Firebase-ID-token third-party auth, as the app does) or remove the chat UI; at minimum stop `users/{uid}/activeChat` writes (`database.ts:458/462` — 2 `mirrorUsersToSupabase` invocations per DM view for a field nobody else reads). |
| 7 | **Full `users/{uid}` node reads** | `auth.ts:83` (every signed-in page load), `database.ts:33` (DM page + public profile). The app split this blob into 8 narrow Supabase tables for exactly this reason; `chatAvailability.ts:41-42` already comments that the node "is large". | RTDB egress | Read leaves (`displayName`, `avatar`, `isPro`, `flage`, `robloxUsername*`, `lastGameWinAt`, `isBlock`) or Supabase `user_identity`. |
| 8 | **Whole-subtree `chat_meta_data/{uid}` and `group_meta_data/{uid}` listeners on `/chat`** | `Inbox.tsx:30` → `database.ts:470`; `ChatRoomList.tsx:59`; initial snapshot = every partner row ever (1.07M rows project-wide) | RTDB egress + connections | `orderByChild('timestamp')` + `limitToLast(30)` (add `.indexOn`), or Supabase. |
| 9 | **Client-side REST `limit: 200` groups query** | `GroupsList.tsx:44` per "Load More" click, unauthenticated from the browser, sliced to 12 client-side | Firestore reads | Cursor pagination (`orderBy memberCount desc`, `startAfter`, `limit 12`) — needs a composite index. |
| 10 | **Double `getDoc` per trade/post detail render + small per-view reads** | `trades/[id]/page.tsx:18,48` and `feed/[id]/page.tsx:20,50` (metadata + page, no `React.cache()`, no `revalidate`); `PrivateChatRoom.tsx:88` `getMyReviewForUser` on every DM open; `firestore.ts:243` unbounded `reviews` scan per review submit | Firestore reads | Wrap `getTradeById`/`getPostById` in `React.cache()` and add `export const revalidate`; lazy-load the "has rated" check only when the Rate pill is eligible; maintain `user_ratings_summary` with `increment` instead of rescanning. |

### Which meter the website plausibly explains

- **RTDB egress (70.6 GB/mo):** #1 and #2 are each capable of producing the whole figure on their own (a 142k-user tree at ~1–3 KB each is 150–400 MB per hit; a multi-MB `calcData` x 2,880 renders/day is tens of GB). #7/#8 are steady contributors. Measure `users.json?shallow=true` key count and `calcData.json` size to rank them.
- **RTDB one-shot reads (~250M/mo) and ~209 concurrent connections:** the website's per-visitor read count is small, so it is unlikely to be the majority of the 250M; the site-wide socket (#5) plus every open chat tab is a real share of the concurrent-connection number.
- **Firestore reads (76.5M/mo):** #3 (polling) and #4 (homepage N+1) are the website's largest, followed by #9 and #10.

### Not verifiable from the repo
- Actual node sizes (REST probe blocked by the permission classifier during this audit).
- Whether the deployed RTDB/Firestore rules match `Blox_Fruit/database.rules.json` (Firestore rules are console-only; treat the rules file as indicative).
- Traffic split by page/locale (needed to convert per-hit costs into monthly totals).
