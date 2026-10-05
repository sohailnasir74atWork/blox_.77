# Ban enforcement handoff (2026-10-05)

## The bug

Moderators reported a user (`azCX0LrXMIYKwicyZyuuYrXSA4E3`) they could not ban, who kept coming back on other accounts.

**Cause.** Every ban was keyed by email and written from the moderator's phone. Three things broke it:

- **Deleted accounts.** Settings → Delete Account removes `users/{uid}`, `users_private/{uid}` and the Auth user. Every ban path then stops at "email not found" and writes nothing.
  - That user's Auth account no longer exists.
  - No ban record for them was ever written.
  - 18 of 100 sampled banned uids are also gone from Auth.
- **Phone sign-in.** These accounts have no email, so they could never be banned.
- **Weak device bans.** A device ban needed a `deviceId` that only about 11% of ban records carried. `users/{uid}/deviceId` was also public, and any signed-in user could write it.

On top of that:

- `banned_users_by_email` and `banned_devices` were writable by any signed-in user, so a banned user could delete their own ban.
- Supabase accepted messages from banned users. Bans were checked only by the app.

## What changed

| Area | Change |
|---|---|
| `functions/banEnforcement.js` (new) | Single `applyBan`/`liftBan` core.<br>**`modSanction`** (HTTPS, staff ID token): ban, mute, unban or list linked accounts **by uid**. Works with no email and for deleted accounts. Same hierarchy as the app.<br>**`syncEmailBan`**: every existing email-ban write also reaches the server (uid ban, every device, Supabase).<br>**`indexDeviceAccount`** / **`indexLegacyDeviceAccount`**: maintain `device_accounts` and `account_devices`, and auto-ban a new account on a banned device. The legacy one also moves the public `users/{uid}/deviceId` into `users_private`.<br>**`banCheckOnSignup`**: re-bans a returning email, including one known only as a hash from a deleted account.<br>**`tombstoneDeletedAccount`**: `deleted_accounts/{uid}` = sha256(email), phone, devices. No plaintext email.<br>Permanent bans also disable the Auth account and revoke its sessions. Unban re-enables it. |
| `supabase/030_banned_senders.sql` (new) | `banned_senders` table (service role only).<br>BEFORE INSERT trigger on `messages`, `private_messages` and `group_messages` raises `SENDER_BANNED`. |
| `database.rules.json` | Ban nodes are staff-write only. Nobody can write a ban on their own uid or email.<br>`users/{uid}/deviceId` can be written by its owner only, and must be a valid id.<br>`users_private/{uid}/deviceId` is allowed.<br>New server-only nodes: `banned_uids`, `device_accounts`, `account_devices`, `deleted_accounts`, `banned_email_hashes`. |
| App | **`GlobelStats.js`**: stamps the device into `users_private`, and adds a `banned_uids/{uid}` listener that feeds `isUserBlocked` and `strikeInfo`.<br>**`BottomDrawer.jsx`**: strike, mute and unban fall back to the server when there is no email. New **Linked accounts** chip (list, copy IDs, perm-ban all). Stopped recreating ghost `users/{uid}` nodes.<br>**`AdminDashboard.js`**: same server fallback.<br>New **`Helper/modSanction.js`**. |
| Also | `mirrorUsersToSupabase.js`: a deviceId-only first write no longer nulls the mirrored email.<br>`reviewIntegrity.js`: reads the private deviceId.<br>`scripts/backfill-ban-enforcement.js` (new). |

## Verified

- **Emulators:** 53/53 end-to-end checks pass on Auth + RTDB + Functions under `demo-fruiteblocks`. Test script: session scratchpad `bantest/test.js`. They cover:
  - the rules;
  - device indexing and the legacy move;
  - uid bans and hierarchy (not staff, outranked, self);
  - no-downgrade;
  - ban evasion on the same device;
  - linked accounts;
  - unban cascade;
  - the email path syncing to the server;
  - JMD → admin not escalated;
  - the deleted-account case;
  - re-registered email;
  - phone accounts;
  - Auth disable and re-enable.
- **Supabase:** trigger tested on PGlite, 12/12 (permanent, temporary, expired and clean senders on all three tables). Re-running the migration is safe.
- **Backfill dry run on production** (read-only): 3,264 records, 972 active (951 permanent), 364 device ids to index, 112 with no userId (looked up by email on `--write`).
- **Lint:** no new errors in the changed app files.

**Not done:** nothing is deployed, the app was not run on a device, and Supabase was not tested against the live project.

## Deploy status (2026-10-05)

| Step | Status |
|---|---|
| 1. Supabase `030_banned_senders.sql` | **NOT RUN.** Needs the owner (SQL editor). Until it's run, functions log "Could not find the table 'public.banned_senders'"; everything else works. |
| 2. Functions | **DEPLOYED.** All 9 succeeded. Live traffic already shows syncEmailBan and indexDeviceAccount working. `modSanction` rejects unauthenticated calls with 401. |
| 3. RTDB rules | **DEPLOYED** via the REST `/.settings/rules.json` PUT, because `firebase deploy` hit a network 403 on the management API. The live rules were identical to HEAD beforehand and equal the file afterwards. |
| 4. Backfill | **RUN** with `--write` and without `--disable-auth`; RTDB only. After step 1, re-run it with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set to fill Supabase. |
| 5. App build | Not built. It also carries the feed, calculator, trades and size changes in the next section. |

## Other app changes in the same working tree (2026-10-05)

All of these are backward compatible: no stored data format or query index changes.

**Feed**
- Images can be saved: a "Save image" button in the viewer, and "Save image" / "Save all images" in the post menu.
  - New `Code/Helper/saveImageToGallery.js`, ported from Adopt Me.
  - JS only; CameraRoll and RNFS are already installed.
- Posts, statuses and reactions use the global `isUserBlocked` check (email, device and uid bans) instead of an email-only `checkBanStatus`.

**Calculator** (`Code/Homescreen/HomeScreen.jsx`)
- The catalogue is parsed once and indexed by name. Before, every picker cell ran `JSON.parse` on 33 KB on every render.
- Search is debounced at 250 ms and the filtered lists are memoised.
- The duplicate focus refetch is gone.
- Keyboard dismiss now happens on drag start instead of on every scroll event.

**Trades** (`Code/Trades/Trades.jsx`)
- Saved-trade refs are read once per focus instead of through a permanent listener.
- The Following feed pages 20 at a time (it was a single 50-read query).
- The profile drawer opens before the presence read returns.
- `windowSize` changed from 7 to 5.

**Global**
- The presence update only creates a new `user` object when `online` actually changed. Before, every connection flap re-rendered every context consumer.

**Size**
- Uninstalled `react-native-reanimated` and `react-native-worklets`, which nothing imports, and removed the babel plugin. Run `pod install` before the iOS build.
- Android now ships 4 icon fonts instead of 19 (`project.ext.vectoricons` in `android/app/build.gradle`). Only Ionicons, FontAwesome and FontAwesome6 are used.
- A release JS bundle builds cleanly (6.97 MB).

**Paywall (custom, replaces react-native-purchases-ui)**
- `Code/SettingScreen/OfferWall.jsx` is now a custom screen built on `react-native-purchases` only, and `PayWall.js` holds the store plumbing. Both are ported from Adopt Me and use Blox Fruit's own copy.
- **Unchanged:** same props, same products, same offerings and the same `pro` entitlement.
- **Same two-wall flow as before:**
  - `oneWallOnly` shows only `paywallrc`.
  - `showoffer` shows `default`; closing it without buying shows `paywallrc` once.
  - Otherwise only `default`.
- The discount wall shows "was" prices taken from the matching `default` package.
- It has Restore purchases, Terms and Privacy links, and the close button shows immediately (as before). Results appear as `Alert`s, because flash messages render under a full-screen Modal.
- `react-native-purchases-ui` is uninstalled and `pod install` has been run. Podfile.lock only lost RevenueCatUI, RNPaywalls, PurchasesHybridCommonUI, RNReanimated and RNWorklets.

**R8 keep rules**
- `android/app/proguard-rules.pro` is replaced by Adopt Me's minimal set (10 `-keep`s), keeping the Room/WorkManager startup fix.
- The old file is in git history.

**Icon fonts**
- `fonts.gradle` never clears its output folder, so all 19 fonts kept shipping from older builds.
- `build.gradle` now deletes that folder before the copy. The APK has 4 fonts.

**Release build measured (assembleRelease, 2026-10-05) against 4.0.12's APK:**

| | 4.0.12 | Now |
|---|---|---|
| APK | 89.8 MB | 73.9 MB |
| dex | 29.1 MB | 15.8 MB |
| classes | 36,251 | 21,281 |
| icon fonts | 3.89 MB | 1.10 MB |
| libreanimated / libworklets | present | gone |

- **Obfuscation:** the mapping-script figure is 42.4% (was 20.3%). About 9.8k of the "kept" names are `com.google.android.gms.internal` classes that ship already obfuscated (`zza…`). Excluding those, it's about 79%.

**Smoke test (release APK on the Pixel9_API35_ARM emulator):**
- Cold start 2.7 s, no FATAL or JS errors in logcat.
- Onboarding, Home, Market Analytics, Calculator, Trade and Feed all load live data.
- AdMob test ads render.
- The paywall loads live Play prices (PKR). "Get Pro" opens the Play billing sheet for `quarterly_wah`; cancelling returns to the wall cleanly.
- Close, Terms and Restore all work.
- Not tested: completing a purchase, sign-in, push notifications, iOS.

**Follow-ups done the same day (all verified in a release build on the emulator):**
- **Badges:** 18 badge PNGs converted to WebP (`scripts/convert-badges-to-webp.js`), 650 KB down to 272 KB. Badge keys are unchanged.
- **Lato and permissions:**
  - Lato removed from the iOS project (8 pbxproj lines), from `assets/fonts`, and from `react-native.config.js`.
  - `react-native-permissions` uninstalled, with its only users deleted. Those were dead files: `RewardCenter.js`, `Store/Store.js` and `Store/storeUtils.js`. The rest of `Store/` (StyledName, NameDisplayReUser…) is still used and stays.
- **Amazon module:** `purchases-store-amazon` is excluded in `android/app/build.gradle`. It brought 402 `com.amazon.*` classes and is now 0. The RevenueCat project has only Play and App Store apps.
- **Trades:**
  - The main feed and search show the last 7 days only (`isFeatured == false` + `timestamp > now-7d`), using the existing indexes. The live query was checked against production Firestore.
  - Logged-out users get the sign-in drawer instead of a second page, once per visit.
  - Featured trades, My trades, Following and Saved are unchanged.
- **Final release APK: 73.5 MB.**

**Image icons:**
- The 6 bottom tabs and the 6 Home quick actions now use tiny glossy PNGs instead of font icons.
  - Tabs: `assets/tab-icons`, with colour and grey "-off" versions.
  - Quick actions: `assets/home-actions`.
- All are generated by `node scripts/app-icons/make-icons.mjs` at @1x/@2x/@3x, 66 KB in total.
- `MainTabs.js` and `HomeTabScreen.jsx` fall back to the old font icon for any route without an image.
- Checked in light and dark mode on the emulator.
- **Also converted to images:**
  - Mini Games tiles and the Ranks trophy: `assets/game-icons`.
  - Trade header filters (My trades, Following, Saved, Notifier): `assets/trade-icons`, with "-off" versions. Active pills now use a light tint so the coloured image shows.
  - The 14 Settings rows: `assets/settings-icons`, glossy tiles at the same 28 pt.
  - The Facebook row uses a "community" glyph rather than Facebook's logo.

**Bottom banners are a fixed 320x50 `BANNER`:**
- They used to be anchored-adaptive, and most screens also passed `collapsible`, which opened an overlay over half the screen.
- `BannerAdComponent` ignores `collapsible` now, so the call sites are unchanged.
- In-feed ads (`FeedBannerAd`, inline adaptive, up to 250 dp, between trades and posts) are unchanged.

**Build note:** the first local release build after this needs `cd android && ./gradlew clean`. Without it, stale generated PNG badges next to the new WebPs fail `packageReleaseResources` with "Duplicate resources".

**Pre-existing bug, not fixed:** the Mystery Fruit game's "Go to Store" (`HomeTabScreen.jsx:618`) navigates to a `Store` route that is commented out in `App.js`, so it does nothing. It should probably open the paywall.

## Deploy order

1. **Supabase:** run `supabase/030_banned_senders.sql`, one numbered step per query.
2. **Functions:**
   ```
   firebase deploy --only functions:modSanction,functions:syncEmailBan,functions:indexDeviceAccount,functions:indexLegacyDeviceAccount,functions:banCheckOnSignup,functions:tombstoneDeletedAccount,functions:mirrorUsersToSupabase,functions:mirrorUsersPrivateToSupabase,functions:voidReviewsOfDeletedUser,functions:scoreReviewOnWrite --project fruiteblocks
   ```
3. **Rules:** `firebase deploy --only database --project fruiteblocks`. This must go out before the new app build: the build writes `users_private/{uid}/deviceId`, which the current rules reject.
4. **Backfill:** `node scripts/backfill-ban-enforcement.js --write`, with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set. Add `--disable-auth` only if you also want the 951 existing permanent bans signed out.
5. **App:** ship a new build. Old builds keep working: their email and device bans now reach the server through `syncEmailBan`, and their public deviceId is moved by `indexLegacyDeviceAccount`.

## Limits

- **The reported account is already deleted.** It was deleted before any of this existed, so there's no device or email left to ban. What stops them now:
  - any **new** account on a device that a banned account has used;
  - any re-registration with an email that was banned;
  - bans on alts that mods find via **Linked accounts**.
- **Device ids are asserted by the app.** A modified client can send a fake one. Moving them off the public node stops one user from copying another's.
- **The Admin Dashboard's banned list still reads only `banned_users_by_email`.** uid-only bans (phone or deleted accounts) don't appear there yet.
