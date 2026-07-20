# Blox Fruit ⇐ adoptme-jan7 — Gap Analysis & Upgrade Roadmap

> **For future agents.** This file is the canonical record of what the reference project
> **adoptme-jan7** (`/Volumes/Sohail/AI_Projects/adoptme-jan7/`) does better than this app, and
> the plan to close the gap. Both apps are the **same codebase lineage**; adoptme is the hardened
> upstream. Most items below are **direct file ports**, not new design.
>
> Produced 2026-06-03 by a 26-agent cross-project analysis with an adversarial verification pass
> (every high/critical finding was re-checked against the live Blox source). 41 findings, 19
> high/critical confirmed, 1 rejected (see §6 TradeCompletion).
>
> **Status legend:** ✅ done · 🚧 in progress · ⬜ not started

---

## How to use this doc
- Each finding has: **severity**, **effort**, the **Blox file** to change, the **adoptme file** to copy/mirror, and a concrete recommendation.
- File paths are absolute. Blox = `/Volumes/Sohail/AI_Projects/Blox_Fruit`, Ref = `/Volumes/Sohail/AI_Projects/adoptme-jan7`.
- Before "adding" anything, verify it doesn't already exist in Blox under a different name (the TradeCompletion finding was a false positive — see §6).
- **Do NOT regress** the one place Blox is ahead: the inline-adaptive feed banner (see §3).

---

## Priority roadmap

### ✅ Day 1 — quick wins — DONE (2026-06-03, branch `api53`, not yet committed)
| # | Fix | Sev | File | Status |
|---|-----|-----|------|--------|
| 1 | Root StatusBar: drop `translucent`/`backgroundColor` (old-device header bug) | 🔴 CRIT | `App.js` | ✅ done |
| 2 | Interstitial 60s global cooldown | 🔴 CRIT | `Code/Ads/IntAd.js` | ✅ done |
| 3 | `safeCompressImage` crash guard (7 call sites) | 🔴 CRIT | `Code/Helper/safeCompressImage.js` + sites | ✅ done |
| 4 | Narrow `select('*')` → column constants | 🔴 HIGH | 4 Supabase backends | ✅ done |
| 5 | Public-chat composite load-more cursor | 🔴 HIGH | `chatBackend.js` + `Trader.jsx` | ✅ done |
| 6 | Moderation admin/mod bypass + link allowlist | 🔴 HIGH | `ContentModeration.js` + 3 inputs | ✅ done |

**What shipped (exact changes):**
1. **`App.js`** — root `<StatusBar>` reduced to `barStyle` only (dropped `backgroundColor="transparent"` + `translucent={true}`); explanatory comment added so it isn't reintroduced.
2. **`Code/Ads/IntAd.js`** — added `static COOLDOWN_MS = 60000` + `lastShownAt`; `showAd()` runs the caller callback immediately when inside the cooldown; `showAdA`/`showAdB` stamp `lastShownAt` before `.show()`. (Minimal version — did NOT pull in `init.js`/`adVisibility.js`; those are Week-1 §3.3/§3.8.)
3. **`Code/Helper/safeCompressImage.js`** (new, copied verbatim) — swapped all 7 raw `CompressorImage.compress()` sites: UploadModal, StatusFeed, ScammerDatabaseScreen, AdminDashboard, Setting, PrivateMessageInput, GroupMessageInput. `grep CompressorImage Code/` now returns only `safeCompressImage.js`.
4. **4 Supabase backends** — added `CHAT_META_COLS` / `PRIVATE_MSG_COLS` / `GROUP_MSG_COLS` / `GROUP_META_COLS` (each derived from that backend's *own* `fromXRow` mapper, NOT copied from adoptme, since the schemas could differ) and replaced `.select('*')` in the load funcs (+ the private idempotency fetch). Realtime is unaffected — Postgres sends the full row on the wire regardless of `.select()`.
5. **`chatBackend.js` + `Trader.jsx`** — `loadMessages` now accepts a composite `before:{createdAt,id}` cursor (backward-compatible; keeps `beforeMs`). `Trader.jsx` carries the real Supabase uuid as `_sbId` on each loaded message and passes `before:{createdAt, id:_sbId}`, falling back to `beforeMs` only for RTDB-fallback rows (see ⚠️ below).
6. **`ContentModeration.js` + 3 inputs** — re-added `ALLOWED_LINK_PATTERNS` + `isAllowedLink`, and `validateContent(text, {skipLinkCheck, skipAll})`. Each input computes `canBypassModeration = !!isAdmin || (!!user?.isModerator && !user?.isBabyMod)`; public/private pass `skipAll`, group also gates YouTube/TikTok via the allowlist for everyone.

> **⚠️ Lesson for future ports — Blox's chat layer DIVERGED from adoptme; do NOT blind-copy adoptme chat code.**
> Blox's public chat kept a legacy `rtdbKey` correlation: its `fromMessageRow` exposes `rtdbKey`, state stores `id = rtdbKey || uuid`, and there's a `softDeleteMessageByRtdbKey` transition-window system. **adoptme dropped rtdbKey entirely** (`grep -c rtdb` on adoptme `Code/Supabase/chatBackend.js` = `0`). That's why Fix 5 needed the `_sbId` adaptation instead of a verbatim copy — this is a Blox divergence, **not** an adoptme bug. Blox's Supabase chat cutover ran later/differently (2026-05-07). **Diff against Blox before porting any chat code.** This matters most for the Week-2 §4.1 realtime-recovery work, which rewrites the same `Trader.jsx` message model.

---

## What's left

### Week 1 — cost + revenue (✅ DONE 2026-06-04, branch `api53`, not yet committed)
- ✅ `lastActivity` → 6h-throttled Supabase RPC (kills RTDB write **and** mirror-CF fan-out). §1.1 / §2.3
- ✅ Shared `chat_meta` realtime subscription (stop double-billing). §2.1
- ✅ Presence cleanup Cloud Function. §1.2
- ✅ App-Open ad lifecycle manager (fires on every foreground, not once/lifetime). §3.2
- ✅ Ad init config-before-load (`maxAdContentRating:'T'`) + NPA/consent gating + ATT primer + `isPro` gating. §3.3–§3.6

**What shipped (exact changes):**
1. **§2.1 shared chat_meta** — appended `subscribeToChatMetaShared` (ref-counted multiplexer) to `chatMetaBackend.js`; swapped `ChatNavigator.js` + `InboxScreen.jsx` from `subscribeToChatMeta` → `subscribeToChatMetaShared`. One underlying realtime channel now fans out to both consumers (was billed twice). Group_meta left as-is (not double-billed in Blox — only ChatNavigator consumes it).
2. **§3.2 App-Open** — replaced `Code/Ads/openApp.js` with the lifecycle manager (`start()`/`stop()`, AppState bg→fg, `AD_EXPIRY_MS=4h`, `MIN_INTERVAL_MS=2min`, MMKV `isPro` gate, `adVisibility` de-dup, 10s watchdog). Added `Code/Ads/adVisibility.js`. `App.js`: `initAndShow()`→`start()`, `cleanup()`→`stop()`.
3. **§3.3–§3.6 ad init/consent/ATT/NPA/Pro** — added `Code/Ads/init.js` (`ensureAdsInitialized`: setRequestConfiguration `maxAdContentRating:'T'` → initialize, shared promise). `IntAd.init()` now awaits it before load, and sets the `adVisibility` flag while an interstitial is on screen. Added `Code/AppHelper/AttPrimer.jsx` + module-level `ensureAttRequested` in `App.js`; `handleUserConsent` now runs ATT (iOS) and `ensureAdsInitialized()` instead of a bare `MobileAds().initialize()`. Added `Code/Ads/consent.js` (`npaRequired`/`npaRequiredFor`) and replaced the hardcoded `requestNonPersonalizedAdsOnly:false` in `AdaptiveFeedBanner.tsx`, `NativeAdPool.ts`, `bannerAds.js` with consent-derived NPA. `isPro` gating lives in `openApp.js` (MMKV `isPro` key, confirmed Blox-persisted).
4. **§1.1 lastActivity** — added `supabase/016_user_last_activity.sql` (`set_last_activity()` RPC, server clock) + `setLastActivity()` in `userBackend.js`. `GlobelStats.js`: the per-launch mount write is now **local-only** (`updateLocalState`, no RTDB → no mirror CF) to preserve the stock-cache throttle that reads `localState.lastActivity`; a **separate** 6h-throttled effect calls the Supabase RPC, throttle persisted via new `lastActivitySyncedAt` MMKV key (added to `LocalGlobelStats`).
5. **§1.2 presence cleanup** — added `functions/clearPresenceNode.js` (v1 pubsub, every 20 min, `presence` node `.remove()`); exported from `functions/index.js`.

> **⚠️ Lesson — Blox conflated `lastActivity` (don't blind-copy the adoptme heartbeat effect).**
> adoptme's 6h heartbeat effect *replaces* the mount write of `lastActivity`. In Blox, `fetchStockData` (`GlobelStats.js`) reads `localState.lastActivity` as its **stock-cache freshness anchor**, so converting that single field to a 6h cadence would have silently changed stock-refresh behaviour. Fix kept the local mount write for the stock throttle and added the Supabase heartbeat as a *separate* effect with its own `lastActivitySyncedAt` key. `user.lastActivity` (global object) is written-but-never-read — safe to stop writing.

> **⚙️ Deploy / DB steps NOT yet run (code-only this pass):**
> - Apply `supabase/016_user_last_activity.sql` to the Supabase project.
> - `firebase deploy --only functions:clearPresenceNode` (confirm RTDB rules keep `presence` `.indexOn:[".value"]`).
> - iOS: verify `NSUserTrackingUsageDescription` is in Info.plist (ATT primer needs it).

### Week 2 — reliability + retention (🚧 partial — 2026-06-04, branch `api53`, not committed)
- ✅ Public-chat realtime recovery + gap-fill + send retry queue. §4.1 (optimistic-bubble UI deferred — see note)
- ✅ Native-ad manager rewrite (keyed cache, request throttle, no-fill fix). §3.7
- ⏭️ Chat streaks (Supabase re-impl). §6.4 — **SKIPPED by user (not wanted)**
- ⏭️ Date-of-birth age gate. §6.3 — **SKIPPED by user**
- ✅ `.range()` pagination on meta loads. §2.4

**What shipped (exact changes):**
1. **§2.4 .range() pagination** — `loadChatMeta` (`chatMetaBackend.js`) and `loadGroupMeta` (`groupMetaBackend.js`) now page via `.range()` ordered by `timestamp_ms` / `last_message_timestamp_ms` DESC, so heavy users no longer silently lose chats past Supabase's 1000-row `max_rows` cap.
2. **§4.1 public-chat realtime recovery** — `chatBackend.js`: added `ensureRealtimeAuth`, `resetRealtimeAndAuth`, `loadMessagesSince` (forward composite cursor). `Trader.jsx`: added `newestCursorRef` (advanced on every ingested row + seeded from initial load), `gapFillSince`/`scheduleGapFill`, an `onStatus` handler (SUBSCRIBED-after-error → gap-fill + flush retries; CHANNEL_ERROR/TIMED_OUT → exp-backoff → `resetRealtimeAndAuth` → `resubKey` bump → resubscribe, capped at 5), an `ensureRealtimeAuth()` pre-flight before subscribe, and an offline **send-retry queue** (`retryQueueRef` + `flushRetryQueue`, idempotent on `clientMsgId`, capped at 3 attempts). Grafted onto Blox's existing `validateMessage`/`rtdbKey`/`_sbId` model (NOT a blind copy — see ⚠️ in the Week-1 section). Live rows now also carry `_sbId`, so load-more uses the gap-free composite cursor.
3. **§3.7 native-ad rewrite** — added `Code/Ads/NativeAdManager.js` (one cached `NativeAd` per stable slot key, global 1.5s inter-request throttle to kill the AdMob no-fill, 50min expiry, `MAX_CACHE=12`, Pro-gate + consent NPA via `./consent`, `ensureAdsInitialized` await, PAID forwarding) and `Code/Ads/NativeAdCard.jsx` (full native surface, **correct `callToAction`** field, Sponsored badge, collapses to 0 height until filled). `DesignMainScreen.js` feed now renders `<NativeAdCard adKey={item.id} …>` per `ad-N` slot instead of `SingleNativeAd`, with a `releaseByPrefix('ad-')` cleanup on unmount. Also fixed the `ad.cta`→`ad.callToAction` + `NativeAssetType.CTA`→`CALL_TO_ACTION` bug in the (dead) `NativeFeedAd.tsx`.
   - **Feed ads were silently OFF:** `DesignMainScreen` called `interleaveAds(filteredBase, false)`, so no feed ad ever rendered. Fixed to `!localState?.isPro` (matches adoptme — native ad every `AD_FREQUENCY`=5 posts for non-Pro).
   - **Trades screen native ads added** to match adoptme's second placement: `Trades.jsx` now interleaves a `trade-ad-N` `NativeAdCard` every 8 trades for non-Pro users (`tradesWithAds` useMemo, ad-row handling in both `renderTrade`/`renderTradeAlt`, `releaseByPrefix('trade-ad-')` cleanup).
   - Native ad-unit IDs confirmed present for the active `isNoman` build on both Android + iOS. (Latent: the non-Noman build's `IOsNative` is `''` — fill in before shipping that variant.)

> **⚠️ §4.1 scope note — optimistic-send bubble deferred.** The receive-side recovery (the "chat silently freezes / stops receiving forever" class) and an offline send-retry queue are done. The optimistic-placeholder UI (show your message instantly with a pending state, upgrade on echo) was NOT done — it needs the clientMsgId-keyed message-model changes the ref uses, which is a larger rewrite that warrants on-device testing. Current behaviour on a failed send: input clears, a "will send when you're back online" toast shows, and the message auto-replays (idempotent) on reconnect. **QA this offline-send UX**, plus: reconnect after airplane-mode toggle backfills missed messages; fast scroll-up still pages without gaps; native ad slots fill (or collapse cleanly) and don't show "only the first ad".

> **⚠️ §3.7 reality vs. doc.** The doc assumed the broken `NativeAdPool` was serving the feed. It wasn't — the feed used `SingleNative.tsx` (an *adaptive banner* mislabeled "native"). The swap therefore changes the feed ad **from a banner to a true native ad**; validate fill/eCPM since native fills lower than banner for new units (unfilled slots collapse to nothing). `SingleNative.tsx` / `NativeAdPool.ts` / `NativeFeedAd.tsx` remain in the repo, now unused, if a revert is needed.

### Backlog — remaining findings not yet scheduled
(✅ done in the 2026-07-09 wave: §1.3, §2.5a, §2.6, §3.10-as-removal, §3.12-partial, plus the post-doc background-disconnect + publication-cleanup items — see Changelog.)
§1.4 lastActivity ms-epoch · §2.5 stage (b) Supabase lastRead RPC · §3.9 PAID analytics · §3.12 remainder (GameIntAd/NativeAds/SingleNative/Adinit removal) · §4.4 group/private reconnect gap-fill + reactions (now slightly MORE valuable given the deliberate background disconnect) · §4.5 MessageHelper toast dedup · §4.6 last-read model · §5.3 ThemeHeader audit · §6.5 TradeJournal XP award (the ONLY real bit of the rejected TradeCompletion finding) · §6.6 DailyQuiz/SpinWheel · §6.7 analyticsDataHelper maps · §6.8 UserBadgePill · §6.9 small utils

---

## Testing & verification

### Already verified (static)
- **ESLint** on all 17 changed files + the new helper: **no parsing errors, no new errors** (pre-existing warnings only — App.js hook-order, AdminDashboard unused imports). Re-run: `npx eslint <files>`.
- **grep guards:** `grep -rn "CompressorImage" Code/` → only `safeCompressImage.js`; `canBypassModeration` present in all 3 inputs; `COOLDOWN_MS` + `lastShownAt` in IntAd; `isAllowedLink`/`validateContent` options in ContentModeration; `_sbId` + composite `before` in Trader/chatBackend.

### Manual QA before release (per fix)
1. **Old-device header (§5.1)** — build a release APK and run on a pre-Android-12 device (or an old emulator, e.g. API 28) in **both light and dark theme**. Verify: no whole-screen vertical shift, header sits correctly under the status bar on Home, Chat (custom `ThemeHeader`), and Calculator tabs. Toggle theme → status-bar icon color flips, no layout jump. Also sanity-check a modern edge-to-edge device (API 34+).
2. **Interstitial cooldown (§3.1)** — trigger two ad-eligible actions within 60s (e.g. send a chat message, then open the scammer DB). Expected: only the **first** shows an interstitial; the second proceeds with **no** ad and **no** blocked UI. After 60s, the next action shows an ad again. Confirm Pro users still behave as before (gating unchanged this pass).
3. **safeCompressImage (§6.1)** — on **iOS**, upload images through each of the 7 flows (group photo, private photo, status post, scammer evidence, settings avatar, admin upload, UploadModal). Include a HEIC photo and a screenshot from the Photos library (`ph://`). Expected: **no crash**; on a compress failure the original image still uploads. On Android, confirm normal compression still works.
4. **Supabase column narrowing (§2.2)** — open the inbox (chat + group lists), a 1:1 chat (scroll to load older), and a group chat. Verify messages, names, avatars, unread badges, mute state, fruits, reply-to, images all render identically (no missing field). Optionally watch the network panel — payloads should be smaller, behavior unchanged.
5. **Public-chat load-more cursor (§4.2)** — in a busy public room, scroll up repeatedly to page through history. Expected: **no gaps and no duplicates** across page boundaries, including where many messages share a timestamp. Specifically page back far enough to hit **legacy (pre-2026-05-07) messages** — they must still load (the `_sbId` path) and not throw / stop pagination early. New messages arriving live should still append.
6. **Moderation bypass (§4.3)** — as a **normal user**: a YouTube or TikTok link posts in group chat but a random `http://...` link is rejected; profanity still blocked. As an **admin or full moderator** (`isModerator && !isBabyMod`): can post any link / flagged text in public, group, and private. As a **baby mod**: still filtered (no bypass). Verify both the normal send and the private-chat **template** send path.

### Smoke test
`npx react-native run-android` (or `run-ios`), then: open app on old + new device, send a public + private + group message (with and without an image), scroll chat history, trigger an interstitial twice, and confirm no crashes in `adb logcat` / Xcode console.

---

## §1 — Firebase RTDB cost

**Already good:** presence is a separate `presence/{uid}` node with `onDisconnect` + indexed `equalTo(true)` query; Blox's OnlineUsersList is *more* optimized than adoptme. Remaining levers:

### 1.1 ✅ DONE — 🔴 HIGH — `lastActivity` heartbeat writes RTDB on every launch AND fires the mirror CF
- **Blox:** `Code/GlobelStats.js:519-522` writes `lastActivity` via `updateLocalStateAndDatabase` on every mount, no throttle. `lastactivity` is in the mirror CF `IDENTITY_KEYS` (`functions/mirrorUsersToSupabase.js:83`), so every heartbeat = 1 RTDB write + 1 Cloud Function invocation + 1 Supabase upsert.
- **Ref:** routes heartbeat straight to Supabase `set_last_activity()` RPC, 6h-throttled, persisted locally. `Code/GlobelStats.js:577-599`, `Code/Supabase/userBackend.js:49-66`, `supabase/018_user_last_activity.sql`.
- **Do:** add migration `016_user_last_activity.sql`; export `setLastActivity()` from `Code/Supabase/userBackend.js`; replace the GlobelStats useEffect with the 6h-throttled version (no RTDB write); optionally drop `lastactivity` from mirror CF IDENTITY_KEYS. Also switch the value to `Date.now()` ms-epoch (see 1.4).
- **Impact:** removes the single largest avoidable CF-invocation class (1 per active user per heartbeat).

### 1.2 ✅ DONE — 🟡 MED — No presence-cleanup Cloud Function
- **Blox:** sets `presence/{uid}=false` on disconnect (`Code/GlobelStats.js:882,937,983`) but never removes it → node + `.value` index grow with every user ever. No scheduled cleanup CF.
- **Ref:** `functions/clearPresenceNode.js` — pubsub every 20min does `database.ref('presence').remove()`; live clients re-arm onDisconnect.
- **Do:** copy `clearPresenceNode.js`, export from `functions/index.js`, deploy. Confirm RTDB rules keep `presence` `.indexOn:[".value"]` (`PRESENCE_RULES.json:82-87`). Note: Blox `database.rules.json` referenced in firebase.json is **not in the repo** — check Firebase console.

### 1.3 ✅ DONE — 🟡 MED — HDwallpaper live `onValue` on shared global nodes
- **Blox:** `Code/ValuesScreen/HDwallpaper.js:53,77` keep `onValue` on whole `pic_numbers` (static) and `like_counter` (shared global) → every like by anyone re-broadcasts the whole node to every viewer.
- **Ref:** one-time `get()` on mount (`HDwallpaper.js:53,72`); local optimistic update for the user's own like.
- **Do:** replace both `onValue` useEffects with `get()`; keep the local `setLikeData` optimistic update.

### 1.4 🟢 LOW — `lastActivity` stored as ISO string, not ms-epoch
- **Blox:** `new Date().toISOString()` at `GlobelStats.js:521`. **Ref:** `Date.now()` ms number; readers tolerate both during transition.
- **Do:** switch to `Date.now()` when doing 1.1; keep `typeof prev === 'number' ? prev : new Date(prev).getTime()` guard for one release.

---

## §2 — Supabase cost

**Already good:** autovacuum tuning, per-call channel topic suffixes, foreground reconnect, scoped realtime filters, no reactions realtime. Missing the post-invoice wave:

### 2.1 ✅ DONE — 🔴 CRITICAL — Duplicate `chat_meta` realtime channel (double-billed)
- **Blox:** `Code/ChatScreen/ChatNavigator.js:116` and `Code/ChatScreen/GroupChat/InboxScreen.jsx:121` each call `subscribeToChatMeta(user.id,…)` → two live channels for the same uid; every update billed twice. No `subscribeToChatMetaShared` exists.
- **Ref:** ref-counted multiplexer `subscribeToChatMetaShared` (`Code/Supabase/chatMetaBackend.js:385`) / `subscribeToGroupMetaShared` (`groupMetaBackend.js:174`); one underlying subscription fanned to N consumers.
- **Do:** port `subscribeToChatMetaShared` into `chatMetaBackend.js`, swap ChatNavigator + InboxScreen to it. **Verification note:** `group_meta` is **not** double-billed in Blox today (only ChatNavigator:213 consumes it; InboxScreen does not) — porting the group shared variant is forward-insurance, zero present-day saving.
- **Impact:** ~halves the dominant realtime line whenever the inbox is open.

### 2.2 ✅ DONE — 🔴 HIGH — `select('*')` on every hot read
- **Blox:** `loadChatMeta` (`chatMetaBackend.js:44`), `loadPrivateMessages` (`privateMessagesBackend.js:87`), `loadGroupMessages` (`groupMessagesBackend.js:94`), `loadGroupMeta` (`groupMetaBackend.js:44`) all use `.select('*')`. No `*_COLS` constants.
- **Ref:** `CHAT_META_COLS`/`PRIVATE_MSG_COLS`/`GROUP_MSG_COLS` constants, select only mapped columns.
- **Do:** add column constants, replace `.select('*')`. (Public-chat `chatBackend.js:71` also uses `*` but adoptme does too — lower priority.)

### 2.3 🔴 HIGH — heartbeat via RTDB + mirror CF — same root cause as §1.1 (fix once).

### 2.4 ✅ DONE — 🟡 MED — No `.range()` pagination → silent 1000-row truncation
- **Blox:** `loadChatMeta` (`chatMetaBackend.js:40`) and `loadGroupMeta` (`groupMetaBackend.js:40`) do a single unpaginated `select` with no `.order()` → heavy users lose old chats non-deterministically (Supabase `max_rows` 1000 default, `.limit()` does not override).
- **Ref:** `.range(from,from+PAGE-1)` while-loop ordered by timestamp desc (`chatMetaBackend.js:59`, `groupMetaBackend.js:55`).
- **Do:** port the `.range()` loop + `.order(...)`. Combine with 2.2.

### 2.5 ✅ stage (a) DONE / stage (b) ⬜ — 🟡 MED — Read receipts unthrottled + not on Supabase
- **Blox:** `Code/ChatScreen/utils.js:1212` `updateLastRead` does an unthrottled RTDB `set()` per received message; `utils.js:1228` opens an RTDB `onValue` per open chat.
- **Ref:** leading+trailing debounce (`LAST_READ_DEBOUNCE_MS=4000`, `utils.js:1017`), flush-on-blur, partner lastRead folded onto the shared chat_meta stream; backed by `set_chat_last_read` RPC + `supabase/017_chat_lastread.sql`.
- **Do (staged):** (a) cheap — add leading/trailing debounce + flush-on-blur around the existing RTDB write. (b) larger — port 017 RPC + columns, refold `useOtherLastRead` onto `subscribeToChatMetaShared`.

### 2.6 ✅ DONE (deploy pending) — 🟡 MED — Ghost `chat_meta` rows (no mirror-CF guard)
- **Blox:** `functions/mirrorChatMetaToSupabase.js` has no guard against mirroring nodes that hold only sub-leaves → phantom "Anonymous" rows + egress bloat (~10% in adoptme). No cleanup migration.
- **Ref:** parent-node-has-meaningful-fields guard (`mirrorChatMetaToSupabase.js:55`) + one-shot `supabase/019_cleanup_ghost_chat_meta.sql`.
- **Do:** add the guard (skip when chatId/lastMessage/timestamp/receiverId all absent) + port 019 DELETE.

### 2.7 🟢 LOW — No forward gap-fill loaders (`loadMessagesSince`)
- **Ref:** `loadMessagesSince` (`chatBackend.js:184`), `loadPrivateMessagesSince`, `loadGroupMessagesSince` — composite-cursor forward queries for reconnect backfill. **Blox has none.** Needed by §4.1.

---

## §3 — Ad revenue / Ads architecture

adoptme's whole `Code/Ads/` folder is revenue-hardened; Blox sits at a leakier checkpoint. Porting adoptme's Ads folder wholesale is the single highest-ROI ad change.

### 3.1 ✅ DONE — 🔴 CRITICAL — No global interstitial frequency cap
- **Blox:** `Code/Ads/IntAd.js` `showAd()` has no cooldown; 13 call sites → back-to-back ads, fatigue churn, AdMob serving-limit risk.
- **Ref:** static `lastShownAt=0`, `COOLDOWN_MS=60000`; inside window, skip ad + run callback (`IntAd.js:46,159,241,272`).
- **Do:** add cooldown (Day-1 fix #2). ~10 lines.

### 3.2 ✅ DONE — 🔴 CRITICAL — App-Open ad shows once per app lifetime
- **Blox:** `Code/Ads/openApp.js` uses `hasShownOnce`; shown once at first LOADED, no reload/AppState/expiry/cap/Pro/de-dup. Call site `App.js:456-466` `initAndShow()` on mount.
- **Ref:** full lifecycle manager — AppState bg→fg, `AD_EXPIRY_MS=4h`, `MIN_INTERVAL_MS=2min`, `isProUser()` gate, `isFullScreenAdVisible()` de-dup, 10s watchdog (`openApp.js:11-14,70-83,163-207`).
- **Do:** port `openApp.js` wholesale (needs `adVisibility.js` §3.8); replace `initAndShow()` with `start()`. Blox already has the openApp unit IDs in `Environment.js`.
- **Impact:** likely the single biggest revenue lift (App-Open is highest-eCPM format).

### 3.3 ✅ DONE — 🔴 HIGH — No config-before-load init; `maxAdContentRating:'PG'` not `'T'`
- **Blox:** no `init.js`; `IntAd.js:73-74` loads with no await; `App.js:197` bare `MobileAds().initialize()` with no `setRequestConfiguration`; stale `Adinit.js` sets 'PG' and is never imported (`App.js:120` commented out).
- **Ref:** `Code/Ads/init.js` `ensureAdsInitialized()` shared promise → `setRequestConfiguration({maxAdContentRating:'T'})` THEN `initialize()`; every loader awaits it.
- **Do:** add `init.js`, have every manager await `ensureAdsInitialized()` before `.load()`, call in `App.js` consent flow; delete/fix `Adinit.js`.

### 3.4 ✅ DONE — 🔴 HIGH — No NPA/consent gating
- **Blox:** `AdaptiveFeedBanner.tsx:78-80`, `NativeAdPool.ts:34`, `bannerAds.js` hardcode `requestNonPersonalizedAdsOnly:false`; managers send no consent-aware options. Blox DOES persist `consentStatus` (`LocalGlobelStats.js:38`) but never reads it for ads.
- **Ref:** `npaRequiredFor(status)` forces NPA only outside OBTAINED/NOT_REQUIRED; banner/native read persisted consentStatus.
- **Do:** port `npaRequired` helper; compute `requestNonPersonalizedAdsOnly` from `consentStatus`.

### 3.5 ✅ DONE — 🔴 HIGH — No iOS ATT primer (dependency installed, never called)
- **Blox:** depends on `react-native-tracking-transparency ^0.1.2` but never imports/calls `requestTrackingPermission`; no primer. No IDFA → lower iOS eCPM + degraded SKAdNetwork.
- **Ref:** `Code/AppHelper/AttPrimer.jsx` (guideline-5.1.1-compliant pre-prompt) + `App.js:46-67` `ensureAttRequested(showAttPrimer)`.
- **Do:** copy `AttPrimer.jsx`, wire `ensureAttRequested()` into `App.js` before ad init (iOS only). Verify `NSUserTrackingUsageDescription` in Info.plist.

### 3.6 ✅ DONE — 🔴 HIGH — No `isPro` gating inside ad managers
- **Blox:** zero `isPro` checks in `Code/Ads/`; only `App.js:457` gates the initial openApp call. Pro users still get App-Open/native ads.
- **Ref:** `openApp.js`/`NativeAdManager.js` read `storage.getBoolean('isPro')` and bail at top of show path.
- **Do:** shared MMKV `isProUser()` helper, gate top of every manager's show path.

### 3.7 ✅ DONE — 🔴 HIGH — Fragile native-ad pool → AdMob no-fill
- **Blox:** `Code/Ads/NativeAdPool.ts:60-95` fires up to 4 `createForAdRequest` with no inter-request gap → rate-limited no-fill ("only first native renders"); `NativeFeedAd.tsx:49-53` destroys ad on unmount (FlatList churn); `:111-112` uses wrong `ad.cta` field (SDK is `callToAction`). No expiry/Pro/consent.
- **Ref:** `Code/Ads/NativeAdManager.js` keyed cache (one NativeAd per stable slot key), `MIN_REQUEST_GAP_MS=1500`, `MAX_AGE_MS`, `MAX_CACHE=12`, Pro/NPA gating; `NativeAdCard.jsx` collapses to 0 height until filled.
- **Do:** replace NativeAdPool + NativeFeedAd with `NativeAdManager` + `NativeAdCard`, interleave by stable item id (`adKey={item.id}`). Fix `ad.cta`→`callToAction`.

### 3.8 🟡 MED — No `adVisibility` de-dup flag
- **Blox:** no `Code/Ads/adVisibility.js`; IntAd/Rewarded never set visibility → upgraded App-Open could stack on interstitial.
- **Ref:** `adVisibility.js` shared flag; ship with §3.2.

### 3.9 🟡 MED — No impression-level (PAID) revenue analytics
- **Ref:** `NativeAdManager.setOnPaid(fn)` forwards `NativeAdEventType.PAID`. **Blox:** none — per-placement eCPM unmeasurable.
- **Do:** wire PAID listeners → existing analytics as `ad_impression` revenue event.

### 3.10 🟡 MED — Banner remounts a fresh ad on load; no collapsible
- **Blox:** `bannerAds.js:24-72` renders a *different* `<BannerAd>` once loaded (destroys the loaded ad — ~half of loads never become impressions); no collapsible format.
- **Ref:** mount-once + toggle wrapper height, `networkExtras.collapsible` (~2-3x static eCPM), first-load-only retry (`bannerAds.js:84-108`).
- **Do:** replace `bannerAds.js` with mount-once + collapsible (NPA from consentStatus). **Keep** AdaptiveFeedBanner for in-feed inline (see 3.11).

### 3.11 🟢 LOW — Blox is AHEAD: inline-adaptive feed banner (DO NOT REGRESS)
- `Code/Ads/AdaptiveFeedBanner.tsx:53-55` supports `INLINE_ADAPTIVE_BANNER` with width measurement; adoptme only has ANCHORED. Keep it; merge adoptme's NPA/collapsible logic into it rather than deleting.

### 3.12 ✅ partial (reward_int removed) — 🟢 LOW — Dead/broken ad files
- `Code/Ads/reward_int.js:5,49` hardcodes TestIds + references undefined `unsubscribeError` (latent unmount crash); `RewardCenter.js:14` imports wrong name `RewardedIntAd`. `GameIntAd.js` duplicates adB; `NativeAds.js`/`SingleNative.tsx` are extra native paths.
- **Do:** delete or fix `reward_int.js` + its import; consolidate native loading; remove `GameIntAd.js`.

---

## §4 — Chat reliability & bug reduction

**Already at parity:** private chat uses atomic `sendPrivateChatMeta` RPC + optimistic placeholders. Gaps:

### 4.1 ✅ DONE (optimistic-bubble UI deferred) — 🔴 CRITICAL — Public chat has no realtime recovery / gap-fill / send retry
- **Blox:** `Code/ChatScreen/GroupChat/Trader.jsx:471-507` subscribes with onInsert/onUpdate/onDelete but **no `onStatus`**; no `loadMessagesSince`; send at `:864-899` is bare `await sbSendMessage` (no optimistic row, no retry). When the socket wedges (network blip, background, cold-start auth race), chat silently and permanently stops receiving; sent messages can vanish.
- **Ref:** `chatBackend.js:36-59` `ensureRealtimeAuth`/`resetRealtimeAndAuth` (refresh Firebase JWT → `realtime.setAuth` → reconnect); `:184-204` `loadMessagesSince`; `Trader.jsx:634-679` onStatus (SUBSCRIBED → debounced gapfill + flush retry; ERROR/TIMEOUT → backoff + reset + resubscribe); `:1026-1072` optimistic send + retry queue.
- **Do:** port the helpers to `chatBackend.js`; add `newestCursorRef`, `gapFillSince()`, `scheduleGapFill()`, `retryQueueRef`/`flushRetryQueue()`, `resubKey` + onStatus wiring to Trader.jsx; convert send to optimistic.
- **Impact:** kills the entire "chat froze / my message disappeared" 1-star class on the highest-traffic screen.

### 4.2 ✅ DONE — 🔴 HIGH — Load-more cursor is timestamp-only → permanent scroll-back holes
- **Blox:** `chatBackend.js:67-86` `loadMessages({beforeMs})` uses `q.lt('created_at', iso)`; `Trader.jsx:556-563` passes `beforeMs: oldest.timestamp`. Messages sharing a millisecond are skipped. **Blox's own private/group backends already use the correct composite `{createdAt,id}` cursor** — just copy.
- **Do (Day-1 fix #5):** change `loadMessages` to `before:{createdAt,id}` with the OR-clause (`created_at.lt.X,and(created_at.eq.X,id.lt.Y)`) matching `privateMessagesBackend.js:91-108`; update `Trader.jsx` handleLoadMore.

### 4.3 ✅ DONE — 🔴 HIGH — Moderation blocks moderators; no link allowlist
- **Blox:** `Code/Helper/ContentModeration.js:178` `validateContent(text)` has no options param, no `isAllowedLink`; all 3 inputs call it with no bypass → admins/mods can't post links/warnings.
- **Ref:** `validateContent(text,{skipLinkCheck,skipAll})` + `ALLOWED_LINK_PATTERNS`/`isAllowedLink` (YouTube/TikTok); inputs compute `canBypassModeration = isAdmin || (isModerator && !isBabyMod)`.
- **Do (Day-1 fix #6):** re-add allowlist + options to `validateContent`; pass `canBypassModeration` in GroupMessageInput/MessageInput/PrivateMessageInput.

### 4.4 🟡 MED — Group messages lack reconnect gap-fill, atomic meta fan-out, reactions
- **Blox:** `groupMessagesBackend.js` has `loadGroupMessages` only (no `...Since`/fanout/reactions); `GroupChatScreen.jsx` no onStatus.
- **Ref:** `loadGroupMessagesSince`, `fanoutGroupMessageMeta` RPC, `toggleGroupReaction`.
- **Do:** mirror §4.1 for groups after public chat lands; reactions optional (need 011/012 RPCs).

### 4.5 🟡 MED — Flash-message dedup can stick; null desc renders 'undefined'
- **Blox:** `Code/Helper/MessageHelper.js` clears the visible lock only inside onShow's setTimeout (never reconciled if dismissed early → toasts silently stop); keys with raw `${description}`.
- **Ref:** `clearVisibleMessageTimeout` ref + onHide reconciliation, `normalizedDescription`, `duration+500` buffer, unique id `msg-${key}-${now}`.
- **Do:** replace with adoptme's `MessageHelper.js` (self-contained, drop-in).

### 4.6 🟢 LOW — No read-receipt / last-read model (unread can drift)
- **Ref:** `setChatLastRead` + `subscribeToChatLastRead` (017 RPC), admin list/delete-pair helpers. Optional/feature-tier.

---

## §5 — Old-device header / safe-area

### 5.1 ✅ DONE — 🔴 CRITICAL — Root StatusBar forces translucent + transparent bg
- **Blox:** `App.js:256-260` `<StatusBar barStyle backgroundColor="transparent" translucent={true} />`. On older/edge-to-edge Android this shifts the whole window / mis-reports `insets.top` — the reported header bug.
- **Ref:** `App.js:332-336` reduced to `<StatusBar barStyle={...} />` only, with a comment explaining the whole-screen-shift. Git history (`42505fa`→`d22775e`) shows the props were deliberately stripped as the fix.
- **Do (Day-1 fix #1):** drop both props, keep `barStyle`, copy the explanatory comment. JS-only, no native rebuild.

### 5.2 🟡 MED — HomeTabScreen imperative StatusBar bg (no change needed)
- `Code/HomeTab/HomeTabScreen.jsx:123-131,306` is **byte-identical to adoptme** — do NOT modify. It just needs 5.1 to land; then `insets.top + 12` resolves correctly.

### 5.3 🟢 LOW — Custom ThemeHeader is an extra inset-dependent surface
- Blox added `Code/Design/componenets/ThemeHeader.jsx` (`paddingTop: insets.top + 4`), used for Calculator (`MainTabs.js:164-169`) and group chat (`ChatNavigator.js:310`). adoptme has none (uses native header + `headerStatusBarHeight: insets.top`). Keep it (deliberate visual upgrade) but verify on an old device after 5.1; it's the safe-area authority where `header:` is overridden.

---

## §6 — Significant features & helpers

### 6.1 ✅ DONE — 🔴 CRITICAL — Raw image compressor, no crash guard
- **Blox:** calls `CompressorImage.compress()` raw in 7 flows: `GroupMessageInput.jsx:125`, `PrivateMessageInput.jsx:132`, `Design/StatusFeed.js:536`, `ValuesScreen/ScammerDatabaseScreen.js:336`, `SettingScreen/Setting.jsx:636`, `AppHelper/AdminDashboard.js:1405` (+ UploadModal). iOS NSException on bad URI = uncatchable crash.
- **Ref:** `Code/Helper/safeCompressImage.js` preflights URI, always returns `{uri, compressed, reason}`.
- **Do (Day-1 fix #3):** copy verbatim, swap 7 call sites to `const {uri:out} = await safeCompressImage(uri, opts)`.

### 6.2 🔴 HIGH — No iOS ATT primer (= §3.5). Port `AttPrimer.jsx`.

### 6.3 🔴 HIGH — No date-of-birth age gate
- **Blox:** no DOB capture anywhere → COPPA/App-Store risk for a social+chat+upload app.
- **Ref:** `Code/AppHelper/DateOfBirthModal.js` (one-time 3-step picker, validation).
- **Do:** port, show once at onboarding (`OnBoardingScreen.js`), persist (Supabase profile post-cutover), gate chat/ads.

### 6.4 🔴 HIGH — No chat streaks
- **Ref:** `Code/Helper/StreakHelper.js` (`streaks/{sortedUidPair}`, same-day/yesterday/reset), consumed in InboxScreen/PrivateChat.
- **Do:** re-implement the algorithm against **Supabase** (chat cut over 2026-05-07 — see HANDOFF.md), surface count in private-chat header. UTC day-boundary, ≥2 display threshold.

### 6.5 ❌ REJECTED — "TradeCompletion.js missing" is a FALSE POSITIVE
- The completion flow **already exists** inside `Code/Engagement/TradeJournal.js`: rating selector (`RESULT_META` ~L43), `updateTradeStats()` (~L363, writes `tradeStats/{uid}`), `handleComplete()` (~L608, pushes `tradeJournal/{uid}`, auto-updates owned inventory). It's already Blox-adapted (name+type 'f', no Adopt Me pet keys). **Do NOT port `TradeCompletion.js`.**
- Only genuine delta: `handleComplete()` doesn't award XP — add a 2-line `addXP()` call (xpUtils already exported).

### 6.6 🟡 MED — Daily-return games (DailyQuiz, SpinWheel)
- **Blox:** GameHub routes arcade games only; no daily quiz/spin. **Ref:** `DailyQuiz.js`/`SpinWheel.js` server-time gated, XP + rewarded-ad.
- **Do:** port `SpinWheel.js` (content-neutral) first; port `DailyQuiz.js` with **Blox Fruits** question bank. Needs `GameSoundService.js` (6.9). Add `daily_quiz`/`spin_wheel` translation keys.

### 6.7 🟡 MED — `analyticsDataHelper.js` is a fetch-only stub
- **Blox:** `Code/Helper/analyticsDataHelper.js:34-60` downloads diff.json, returns `undefined` on cache hit (latent bug); no demand/hot maps. **Ref:** builds `demandMap`/`hotMap`, exports `getDemandScore`/`getHotStatus`/`normalizeName` (~260 lines).
- **Do:** port the buildMaps layer, keep Blox CDN URL + 4h cache, adapt parsing to Blox diff schema; render demand/hot badges.

### 6.8 🟡 MED — No shared role/badge pill (`UserBadgePill.jsx` + `shimmerDriver.js`)
- **Do:** port both; align TYPES/HAS predicates to Blox role flags; replace inline badges with `<UserRolePills user={u}/>`.

### 6.9 🟢 LOW — Small portable utilities
- `navigationService.js` (navigate outside container — for toasts/notifications), `searchHelper.js` (acronym fuzzy match), `GameSoundService.js` (needed by 6.6). Port as-is.

---

## Changelog
- **2026-07-09** — **Cost/cleanup wave 3** (ported from adoptme's post-invoice optimizations, `COST_OPTIMIZATION_2026-07.md` / `supabase-cost-optimization.md` in the ref repo — items that postdate this doc's original analysis):
  1. **Background realtime disconnect** (`Code/Supabase/client.js`) — the single biggest realtime saving in adoptme's audit. Socket disconnects after 20s backgrounded, reconnects on foreground; channels rejoin automatically and public-chat onStatus→gap-fill + chat_meta foreground refresh backfill the blur window. Verified against installed realtime-js: socket close fires CHANNEL_ERROR into per-channel callbacks (same as adoptme; identical recovery paths). Note: adoptme's private/group screens also have NO gap-fill — the port is at exact parity; §4.4 remains the follow-up.
  2. **Public-chat column narrowing** (`chatBackend.js`) — `MSG_COLS`/`PINNED_COLS` derived from Blox's OWN mappers (keeps `rtdb_key` — do NOT copy adoptme's list); applied to loadMessages, loadMessagesSince, loadPinnedMessages (both join sides), sendMessage insert-return + idempotency fetch, pinMessage. adoptme has since narrowed these too (the old "adoptme also uses `*`" note in §2.2 is stale).
  3. **§1.3** HDwallpaper `onValue`→one-shot `get()` on `pic_numbers` + `like_counter`; own-like stays optimistic via `items` state. Trade-off: others' likes not live while on screen (same as adoptme).
  4. **§2.5 stage (a)** read-receipt coalescing (`Code/ChatScreen/utils.js`) — 4s leading+trailing window keyed per chat, `flushLastRead` on PrivateChat blur (before the back-ad early returns). Storage stays on the SAME RTDB path old builds read — write frequency only; fully backward compatible. Stage (b) (Supabase 017-style RPC + fold onto chat_meta stream) still open.
  5. **§2.6** ghost-row guard in `functions/mirrorChatMetaToSupabase.js` (skip when chatId/lastMessage/timestamp/receiverId all absent; skip-only — did NOT port adoptme's derived chat_id write) + one-shot `supabase/018_cleanup_ghost_chat_meta.sql`.
  6. **Realtime publication cleanup** `supabase/017_realtime_publication_cleanup.sql` — drops all 8 never-subscribed `user_*` tables from `supabase_realtime` + resets replica identity to default (Blox has no message_reactions; polls were never published). Verified via grep: only the 6 chat tables have client subscriptions.
  7. **§3.10 collapsible banner REMOVED** from `bannerAds.js` — adoptme shipped it and then deliberately removed it 2026-07-09 (expanded first impression covered content above bottom-anchored slots). Do not reintroduce; this supersedes the older "add collapsible" recommendation below.
  8. **§3.12 partial** — deleted `Code/Ads/reward_int.js` (undefined `unsubscribeError` unmount crash + module-level `createForAdRequest` at import time on a hardcoded TestIds unit) and its dead `RewardedIntAd` import in RewardCenter.js; also fixed RewardCenter's pre-existing missing `showSuccessMessage` import (latent crash on claim). `GameIntAd.js`/`NativeAds.js`/`SingleNative.tsx`/`Adinit.js` left in place (kept for revert per §3.7 note).
  9. Verified `NSUserTrackingUsageDescription` present in `ios/bloxfruitevalues/Info.plist` (Week-1 pending item — closed).
  - ESLint on all changed files: no new errors (remaining errors/warnings pre-exist: client.js atob/Buffer in the role-claim decoder, PrivateChat exhaustive-deps, utils.js no-shadow).
  - **⚙️ Deploy steps for this wave:** apply `supabase/017_realtime_publication_cleanup.sql`; deploy `firebase deploy --only functions:mirrorChatMetaToSupabase` FIRST, then apply `supabase/018_cleanup_ghost_chat_meta.sql`. (016 + clearPresenceNode from Week-1 still pending if not yet run.)
  - **Manual QA:** background app >20s on Android with public chat open → return → missed messages backfill within ~1s; same flow in a private/group chat → messages sent during background do NOT appear until reload (pre-existing §4.4 gap, unchanged by this wave — on iOS this was always the case); read receipt lands ≤4s during bursts and immediately on leaving the chat; banners still fill (now non-collapsible); wallpaper likes still count; RewardCenter claim shows the success toast.
- **2026-06-04 (pm)** — **Week-2 partial**: §2.4 `.range()` meta pagination, §4.1 public-chat realtime recovery + gap-fill + offline send-retry (optimistic bubble deferred), §3.7 native-ad rewrite (`NativeAdManager`/`NativeAdCard`, feed swapped from banner→native). §6.3 age gate and §6.4 chat streaks **skipped at user's request**. New files: `Code/Ads/{NativeAdManager.js,NativeAdCard.jsx}`. ESLint: no parsing errors, no new errors. Pending: on-device QA (reconnect backfill, offline-send UX, native fill vs. banner).
- **2026-06-04** — **Week-1 (cost + revenue) implemented and statically verified** on branch `api53` (not yet committed): §2.1 shared chat_meta subscription, §3.2 App-Open lifecycle manager, §3.3–§3.6 ad init/ATT/NPA/Pro gating, §1.1 lastActivity 6h Supabase RPC, §1.2 presence cleanup CF. New files: `Code/Ads/{init,adVisibility,consent}.js`, `Code/AppHelper/AttPrimer.jsx`, `supabase/016_user_last_activity.sql`, `functions/clearPresenceNode.js`. ESLint: no parsing errors, no new errors (one new exhaustive-deps fixed by adding the stable `updateLocalState` dep). **Pending: apply migration 016, deploy `clearPresenceNode`, verify iOS `NSUserTrackingUsageDescription`, and on-device QA** (App-Open on bg→fg, ATT primer first-launch, NPA in EEA, inbox unread not double-counting, stock list still refreshes).
- **2026-06-03** — Doc created from 26-agent analysis. **Day-1 quick wins (§5.1, §3.1, §6.1, §2.2, §4.2, §4.3) implemented and statically verified** (ESLint clean, no parsing/new errors) on branch `api53` (not yet committed). Added per-fix "What shipped" detail, the Blox chat-divergence ⚠️ lesson (rtdbKey), a "What's left" breakdown (Week 1 / Week 2 / backlog), and a **Testing & verification** section with manual QA steps per fix. Manual on-device QA still pending.
