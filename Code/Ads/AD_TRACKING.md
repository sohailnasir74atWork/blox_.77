# Ad tracking (GA4 + Crashlytics)

Added 2026-11-01. Code: `Code/Ads/adTelemetry.js` (`startAdAttempt`, `logAdRevenue`).
Same code in Adopt Me, Blox Fruit and MM2 — change all three together.

## Events

Every time the app decides to show a full-screen ad it opens one **attempt**,
and the attempt ends in exactly one of `ad_shown` / `ad_not_shown`.

| Event | When | Extra params |
|---|---|---|
| `ad_show_request` | the trigger fired (trade posted, review given, …) | — |
| `ad_shown` | the ad reached the screen (OPENED) | `wait_ms` (user's wait for it) |
| `ad_not_shown` | it did not | `reason`, `wait_ms` |
| `ad_clicked` | user tapped a shown ad (once per ad) | — |
| `ad_reward_earned` | rewarded ad completed | — |
| `ad_closed` | shown ad closed | `view_ms`, `clicked` (0/1) |
| `ad_paid` | AdMob paid event: the revenue of one impression | `value`, `currency`, `precision`, `ad_source` |

All carry `ad_format` (interstitial · rewarded · app_open · banner),
`placement`, `ad_unit` (key in `ads.js`) and `ad_unit_id` (the AdMob unit).
Banners only log `ad_paid` (they refresh by themselves; there is no
"attempt"). Names avoid Firebase's reserved `ad_click` / `ad_impression` /
`ad_reward`; Firebase still logs its own `ad_impression` (AdMob link), which has
no placement, so don't sum both.

## Placements

| placement | format · ad_unit | Where |
|---|---|---|
| `trade_post` | interstitial · tradePost | trade posted (HomeScreen) — always shows, outside policy |
| `feed_post` | interstitial · feedPost | design post or status posted — always shows, outside policy |
| `review` | interstitial · reviewPost | REMOVED 2026-11-04 (owner, revenue LOG "Ad diet"); no longer prepared or shown. |
| `trade_completed` | interstitial · interstitial | trade marked completed (TradeCompletion) |
| `daily_reward` | interstitial · interstitial | daily star reward claimed |
| `dm_open` | interstitial · interstitial | opening a 2nd+ DM from a profile (BottomDrawer) |
| `trader_chat` | interstitial · interstitial | every Nth trader-chat message |
| `raid_round` | interstitial / rewarded | raid rounds (interstitial already labelled; rewarded request) |
| `wallpaper_more`, `scammer_search`, `scammer_report` | interstitial · interstitial | those actions |
| `tab:<Route>` | interstitial · interstitial | natural breaks (only counted once past the caps); tab switches REMOVED 2026-11-04 (owner, revenue LOG "Ad diet"). |
| `action` | interstitial · interstitial | any unlabelled call site |
| `trade_feature`, `mystery_egg`, `mystery_egg_free_hatch`, `mini_game`, `reward` | rewarded · rewarded | "watch a video" buttons |
| `launch` / `return` | app_open · openapp | cold start / foreground return (counted at present only) |
| `banner`, `banner_collapsible`, `feed` | banner · banner / feedBanner | revenue only |

## Reasons (`ad_not_shown.reason`)

- `pro` — Pro user, no ads
- `busy` — another show of this manager in flight
- `cooldown` — interstitial 65 s / rewarded cooldown since the last one
- `other_ad` — another full-screen ad on screen or within the cross-format gap
- `no_fill` — AdMob had no ad a moment ago, so no wait
- `not_ready` — no ad loaded within the wait (3 s)
- `load_error` — the load promise failed
- `show_failed:<why>` — an ad was loaded but never reached the screen (`watchdog`, `show-rejected`, …)

## Reading it in GA4 (Blox Fruit: property p464087852 (fruiteblocks))

- **Show rate per placement** = `ad_shown` ÷ `ad_show_request`, by `placement`.
- **Why it didn't show** = `ad_not_shown` count by `placement` × `reason`.
- **Revenue per placement / unit** = `ad_paid` *Event value* by `placement` / `ad_unit`.
- **Trade → ad reconciliation** = `trade_posted` vs `ad_show_request` (trade_post).

Registered in GA4 on 2026-11-01 (all three properties): event-scoped custom
dimensions Ad format (`ad_format`), Ad unit (`ad_unit`), Ad unit ID
(`ad_unit_id`), Ad not shown reason (`reason`), Paid ad source (`ad_source`);
custom metrics Ad wait ms (`wait_ms`), Ad view ms (`view_ms`). `placement`
reuses the existing "Paywall placement" dimension (same param). Reports only
fill from the day a dimension is created.

Verified 2026-11-01 on the iOS simulator (Adopt Me debug build, test units):
app_open `return` logged ad_show_request → ad_shown → ad_paid → ad_closed with
placement/unit/wait_ms/view_ms, and banner ad_paid carried ad_unit/ad_unit_id.

Crashlytics: each outcome is also an `ads:` breadcrumb line.
