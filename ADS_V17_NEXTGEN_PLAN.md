# Ads: react-native-google-mobile-ads 17.2 + Next-Gen SDK (Blox → Adopt Me → MM2)

Started 2026-10-12. Blox Fruit is done on branch `ads-v17-nextgen` (not merged,
not released). Adopt Me and MM2 follow the porting guides at the end of this
file. Keep this file current as each app moves.

## 0. Status and decisions

| | Blox Fruit | Adopt Me | MM2 |
|---|---|---|---|
| Library | 17.2.0 (branch `ads-v17-nextgen`) | 16.5.0 | 16.5.0 |
| Android SDK | Next-Gen 1.4.0 (`app.json` `android_sdk: "nextgen"`) | classic 25.4.0 | classic 25.4.0 |
| iOS SDK | Google iOS SDK 13.6.0 (no Next-Gen exists for iOS) | 13.5.0 | 13.5.0 |
| Full-screen loading | shared `fullscreenSource.js` (pools on Next-Gen) | 3 custom singletons | 3 custom singletons |

**Owner decisions still open** (none blocks testing; the first blocks a
Next-Gen *release*):

1. **Age data — decided 2026-10-12 (owner): not used for ads.**
   - The app's date-of-birth data is not read or sent for ads, and ad
     loading never waits for an age.
   - Every request goes out T-rated and not child-directed, as before, and
     Google applies its own protections to accounts it knows are children or
     teens.
   - Known trade-off: Google's publisher policy forbids personalised ads to
     users "known by you to be under 13". The apps hold DOBs for Birthdays,
     so that knowledge exists even if it isn't used.
   - Related open point: Play lists `play-services-ads` 19+ (classic) as a
     Families self-certified ads SDK. The Next-Gen artifact was not listed
     (checked 2026-10-12). The target audience is 13+.
2. **Placements that the policy research flags** (section 6). Not changed,
   because each one costs revenue.
3. **AdMob console — done 2026-10-12.**
   - Account: AdMob how2techxyz@gmail.com, `pub-5740215782746766`.
   - Impression-level ad revenue: already On.
   - Firebase: both Blox apps (Android `~2511096424`, iOS `~6566725656`) are now linked to Firebase `fruiteblocks`. The owner added how2techxyz@gmail.com as Editor there.
   - Effect: GA4 gets AdMob's automatic `ad_impression` with value. The app's `ad_paid` is a separate custom event, so revenue is not double-counted.
   - Audit (all match the code): ad unit IDs, 1/min caps on interstitial and app open, and iOS US mediation groups (AdMob + PubMatic bidding, no SDK needed).

## 1. Why

- Google made the Next-Gen Android SDK the preferred SDK on 2026-07-06 and
  put the classic SDK in maintenance mode: 25.x is deprecated 2027-06-30 and
  sunset 2028-06-30 (at sunset Play blocks releases). Next-Gen 1.x is
  supported to Q1 2028 / Q2 2029.
- react-native-google-mobile-ads added Next-Gen as an Android build option in
  17.1.0 (2026-09-23) and plans it as the default in v18. 17.2.0 (2026-09-25)
  is the current release. Next-Gen is three weeks old in the library: no
  public production reports yet, so roll out in stages (section 5).
- The same Google SDK (Android 25.4.0) sits under 16.5 and 17.2 classic, so
  the library upgrade alone does not change fill or eCPM. The gains come from
  Google's preloader (Next-Gen), the bug fixes below, and revenue telemetry.

## 2. What the audit found (all three apps, 2026-10-12)

All three apps share the same ad architecture: `Code/Ads/{init,ads,adPolicy,
adVisibility,bannerAds,FeedBannerAd,consentOptions}.js` plus three static
singletons (`IntAd.js`, `openApp.js`, `RewardedAdManager.js`) that each
re-implemented warm-up, retry, expiry and wait-polling. Policy constants in
`adPolicy.js` are identical across the apps.

**Bugs found in all three apps** (fixed in Blox; still present in Adopt Me
and MM2):

- **B1. Interstitial stuck for the session.** `_dropIfExpired()` (55 min) and
  the 5 s show watchdog call `load()` on the same still-loaded instance. The
  library ignores `load()` on an ad it counts as loaded, so `isLoading` stays
  true forever and no interstitial shows until the next launch.
- **B2.** On Android 16.5 never reported a failed present. Only the 5 s and
  10 s watchdogs caught it (17.x emits `ERROR` with `phase: 'show'`).
- **B3. Rewarded:** no expiry. A failed present was reported as "closed early"
  (wrong "Ad skipped" messages). It also reloaded immediately after every show
  and preloaded for Pro users.
- **B4.** The modal-transition guard is dead in Blox and MM2:
  `noteModalTransition` is never called. Adopt Me wires it
  (`Code/Helper/modalPresentation.js`).
- **B5.** Buying Pro mid-session never stopped the app-open manager, the warm
  interstitial or their timers.
- **B6. Late shows:** wait-loops present 3 s (interstitial) or 12 s (rewarded)
  after the tap, even if the user has left the screen.
- **No revenue telemetry:** no paid-event listener anywhere. The only ad
  event is `launch_ad`.
- **Child audience (not acted on, owner decision §0.1):** every request is
  T-rated and personalised. All three apps store date of birth and know who
  is under 13 (Blox
  `isUnder13Dob`, Adopt Me `ageGate.js`, MM2 `EmailOptInGate`). That knowledge
  was never used for ads (Google publisher policy: no personalised ads to
  users known to be under 13).
- **App-open after our own trips out:** photo picker, share sheet, sign-in,
  Play update screen and links. Only the store purchase (and in Blox the
  notification prompt) opted out.
- **App-open over a re-shown UMP form:** a returning user's launch ad loads in
  parallel with this session's consent refresh.
- **Dead legacy code** that would throw unhandled rejections under 17.2's
  `show()` contract: `AppHelperFunction.handleUserConsent` (all apps),
  `loadAppOpenAd` / `initializeAds` (Adopt Me, MM2), and Blox's
  `RewardedAd.js` / `SecondRewardedad.js`.

**Per-app differences**

| | Blox | Adopt Me | MM2 |
|---|---|---|---|
| Consent | `gatherAdsConsent` in App.js → `openAdsGate` | `gatherConsent()` inside `ensureAdsInitialized`; `adsGate.js` new/uncommitted | manual `requestInfoUpdate` / `showForm` in App.js |
| Banners wait for consent + init | yes (`useAdsReady`) | **no**: banners request before UMP and before `setRequestConfiguration` | anchored yes; **FeedBannerAd no** |
| iOS ATT order | UMP → ATT (primer) | **UMP can start before ATT** (`start()` before the idle ATT step) | ATT → UMP, no primer |
| Banner wrapper `collapsable={false}` | yes | yes (04aa038) | **no** |
| Mediation | none | Facebook + Unity commented out on Android; iOS pods still linked | none |
| Extra interstitial triggers | DM 2nd partner, daily rewards, wallpaper load-more, scammer search/report | wallpaper load-more, scammer search/report, rating submit | ArrowGame hint / every 5th level, design-post "message" |
| Rewarded flows | Trades boost, mini-game rounds, MysteryEgg | Trades boost, MysteryEgg, 4 mini-games, QuizBattle, TradeShowdown | Trades boost, MysteryEgg |

## 3. Target design (as built in Blox)

```
Code/Ads/
  init.js              consent gate → setRequestConfiguration (T, not child-directed) → initialize()
  fullscreenSource.js NEW  where a full-screen ad comes from: 'pool' (Next-Gen AdPools) or 'instance'
  adTelemetry.js  NEW  Crashlytics breadcrumbs + GA4 `ad_paid` revenue event
  leaveAppGuard.js NEW wraps picker / share / sign-in / Linking so our own trips skip the app-open ad
  IntAd.js / openApp.js / RewardedAdManager.js   WHEN to show (caps, windows, Pro); ads come from a source
  adPolicy.js          + APP_OPEN_EXPIRY_MS, USE_SDK_PRELOADER
```

### 3.1 Full-screen sources (`fullscreenSource.js`)

- **Pool mode** is used when `getAdCapabilities().backend === 'android-next-gen'`
  and the format's `fullscreenPreloadFormats` value is `'supported'`. That
  covers app open, interstitial and rewarded on Next-Gen. Each format gets
  `AdPools.create({ poolId: 'blox-<format>', formats: [fmt], bufferSize: 1 })`
  after consent and init. Google's preloader fills, retries, refills after
  every `poll()` and refreshes before expiry. The app-wide cap is 6; we use
  3 at most.
- **Instance mode** covers iOS, where the library marks preloading
  `experimental` and Google's iOS preloader is beta, and classic Android. One
  warm instance is kept, with a **new instance for every show** (fixes B1),
  backoff 1/2/4 s, one no-fill retry after 60 s, and expiry (interstitial and
  rewarded 55 min, app open 4 h − 5 min).
- Both modes hand the caller a loaded, fresh ad. The caller owns it, attaches
  OPENED / CLOSED / ERROR / PAID, shows it, and calls `destroy()` afterwards.
- `reset()` runs on Pro
  (cleanup / stop). If pool creation fails, that format falls back to
  instance mode for the session.
- Kill switches:
  - `adPolicy.USE_SDK_PRELOADER = false` → instance mode everywhere.
  - `app.json` `android_sdk: "classic"` → classic SDK. Nothing else changes.

### 3.2 Audience

- No per-user age signal (owner decision §0.1).
- Request config, the same for everyone: `maxAdContentRating: T`, TFCD
  false, TFUA false. It is set before `initialize()`.
- Play: Blox target audience 13+, content rating Everyone / PEGI 3 (checked
  2026-10-12).

### 3.3 No library patches (owner decision, 2026-10-12)

The library is used exactly as published.

**Known behaviour.** On Android Next-Gen, 17.2.0 starts Google's SDK when the
library's native module is first used. That is at app start, before this
session's UMP consent form, because `ReactNativeGoogleMobileAdsModule.kt` has
`init { startInitializationIfNeeded() }`. The classic SDK and iOS start only
from our `initialize()`.

**Unchanged.** No ad is requested before consent:
- the managers and banners wait for `ensureAdsInitialized()`, which waits for
  consent;
- our request configuration is still set before any request.

**Watch.** The library's own `NextGenMobileAdsGate` comment says Next-Gen
"does not self-initialize", so this may change upstream. Re-check on every
library upgrade. A second library bug, which doesn't affect us because we
don't send age signals: both Android backends match `ageRestrictedTreatment`
only in uppercase while the JS enum sends lowercase.

### 3.4 Telemetry (`adTelemetry.js`)

- `ad_paid` GA4 event per paid impression: `ad_format`, `placement`,
  `value`, `currency`, `precision`, `ad_source`, `ad_unit_name`. It is
  deliberately **not** `ad_impression`: with AdMob linked, Firebase logs that
  itself, and a manual one would double-count revenue.
- Crashlytics log lines `ads: …` for init, load, loaded, error, take, opened,
  closed, failed and reset. These are for the libhwui SIGSEGV after
  launch (issue c87e678d) and the Fabric crashes.

### 3.5 Other changes in Blox

- `leaveAppGuard.js`: wraps `Linking.openURL`, RN `Share.share`, image-picker
  `launchImageLibrary` / `launchCamera`, react-native-share `open` /
  `shareSingle`, `GoogleSignin.signIn` and `appleAuth.performRequest` once at
  startup. Each call skips the next app-open return for 2 min.
  `InAppUpdateCheck.js` does the same before Play's update screen.
- Launch app-open waits for this session's consent refresh
  (`isConsentFlowActive` / `whenConsentFlowIdle` in `init.js`) and never
  presents over the UMP form.
- `App.js`:
  - Pro from either source (`isPro || proGranted`) stops the app-open
    manager and the warm interstitial immediately.
- Rewarded:
  - A failed present → `onAdUnavailable` (not "closed early").
  - One show at a time.
  - A 400 ms grace after CLOSED for a late iOS `EARNED_REWARD`.
  - A tap on "watch ad" requests a fresh ad even inside the no-fill hold.
- Code review (2026-10-12, before the first build) found and fixed:
  - instance mode ignored the 60 s no-fill hold;
  - `start()` gave up for the session when the Pro state was stale at launch;
  - `reset()` did not cancel in-flight loads or pool creation (now an epoch
    check);
  - callbacks could run twice when they threw (now a two-argument `then`);
  - the watchdog destroyed an ad that might still be opening.
- **Launch app-open ad timing (found on the emulator 2026-10-12, also live in
  production builds):**
  - UMP only reports consent stored by an earlier session (`canRequestAds`)
    once this session's refresh has been *requested*. Before that it always
    says false. The old code checked first, so every returning user's launch
    ad waited for the full refresh and missed its window (`launch_ad` outcome
    `not_loaded`). `init.js` now starts one shared `requestInfoUpdate()` and
    then reads the stored consent; `gatherAdsConsent` reuses that refresh.
  - The launch-ad decision and the app-open manager now start at JS load for
    returning non-Pro users past onboarding (bottom of `openApp.js`), not in
    the first screen's effect.
  - Emulator debug build: the app-open request went from about 10.5 s to
    0.5 s after JS start, and the launch ad showed over Home.
- Not done: cancelling a waiting show when its screen goes away (B6).
  `takeWithin` has an `isCancelled` hook, but no caller passes one yet.
- All `show()` calls handle 17.2's rejecting promise. Android `ERROR`
  `phase: 'show'` ends a show at once instead of waiting for the watchdog.
- Removed dead code: `Code/SettingScreen/RewardComponenet/{Checkin,ThreeAds,
  SecondRewardedad}.js`, `Code/SettingScreen/RewardScreens/RewardedAd.js`,
  and `AppHelperFunction.handleUserConsent`.

## 4. Verification

### 4.1 Build and smoke test (emulator, test ads)

Dev builds force Pro (`Code/LocalGlobelStats.js` `DEV_FORCE_PRO`). Set it to
`false` locally to see test ads, and **never commit that**. Test ad units come
from `__DEV__` (`ads.js`).

- [ ] Android debug build with `android_sdk: nextgen`; `getAdCapabilities().backend === 'android-next-gen'`
- [ ] logcat: no ad request before the UMP flow finishes (SDK init itself starts at launch on Next-Gen, §3.3)
- [ ] Crashlytics `ads:` lines show `pool created` for interstitial / app_open (rewarded on first prepare)
- [ ] Interstitial via a natural break (tab switch after 60 s) and via an action (post a trade); callback always runs
- [ ] App-open on return after ≥ 10 s; none after picking a photo / sharing
- [ ] Rewarded: MysteryEgg free spin and Trades boost grant once; closing early grants nothing
- [ ] Banners load; `ad_paid` arrives in GA4 DebugView (test ads may report value 0)
- [ ] iOS simulator build (classic iOS SDK 13.6.0, instance mode) runs the same checks
- [ ] Classic fallback: `android_sdk: "classic"` builds and runs (instance mode on Android)

### 4.2 Results

**2026-10-12, Android emulator (Pixel 9 API 35 image, arm64), debug build,
Next-Gen 1.4.0, test ad units:**
- ✅ Builds with `android_sdk: nextgen`.
- ✅ Next-Gen pools in use: app-open and interstitial requests at the same
  instant right after init. The pool refilled immediately after the
  interstitial was taken.
- ✅ Library starts the SDK at launch, which is expected without a patch
  (§3.3): `getconfig/pubsetting` and SDK core files are fetched before
  consent. No ad request before consent.
- ✅ Guest onboarding → offer wall → Home. Bottom banner (test 320x50) loads;
  Calculator banner shows in its fixed slot.
- ✅ Natural-break interstitial on a tab switch after 60 s. Closed → back on
  Calculator; no app-open stacked after it.
- ✅ App-open on return after 70 s away.
- ✅ Launch app-open on a returning launch (after the timing fixes in §3.5).
- ✅ Leave-app guard wrapped all 8 functions at runtime (dev log).
- ⚠️ Rewarded (signed in, MysteryEgg free spin): Google's demo rewarded unit
  returned **no-fill** on this emulator on both backends (Next-Gen pool,
  Next-Gen single instance and classic single instance), with the SDK
  reporting `googleMobileAds/no-fill`. So this is the test unit or the
  environment, not our code: the button falls back to "unavailable". Re-test on
  a real device, or with a test device ID on the live unit, before release.
- ⏳ `ad_paid` in GA4 DebugView: not checked (test ads can report 0).
- iOS simulator: the first builds failed to link (`VTT for
  facebook::react::BaseViewProps` undefined, from RNGestureHandler and
  RNGoogleMobileAds).
  - Cause: a `pod update` without the app's usual state left the **release**
    flavor of React Native 0.87's prebuilt core in `Pods/React-Core-prebuilt`
    (24 MB, C++ symbols hidden) instead of the debug flavor (139 MB, symbols
    exported).
  - Fix: plain `LANG=en_US.UTF-8 pod install` (prebuilt is the 0.87 default)
    restores the debug flavor. Check before an iOS build:
    `ls -l ios/Pods/React-Core-prebuilt/React.xcframework/ios-arm64_x86_64-simulator/React.framework/React`
    should be about 139 MB for Debug.
  - Don't build with `-destination generic/...` (it also builds x86_64);
    use the simulator id.
  - The next build then crashed at launch in dyld: `Symbol not found:
    facebook::hermes::cdp::CDPDebugAPI::addConsoleMessage`, referenced from
    `React.framework`, expected in `hermesvm.framework`. Cause: the same
    flavor mix-up in `Pods/hermes-engine/destroot` (release Hermes, no
    debugger symbols, next to the debug React core). Fix, with React Native's
    own script:
    `printf Release > ios/Pods/hermes-engine/.last_build_configuration` then
    `node node_modules/react-native/sdks/hermes-engine/utils/replace_hermes_version.js -c Debug -r <hermes version from Podfile.lock> -p "$PWD/ios/Pods"`.
    (Without the first line the script assumes the Pods copy is already Debug
    and does nothing.) Check: `nm -gU` on the simulator `hermesvm` binary
    lists `CDPDebugAPI17addConsoleMessage`.

**2026-10-12, iOS simulator (iPhone 17 Pro), debug build, classic iOS SDK
13.6.0, test ad units:**
- ✅ Instance mode on iOS, as designed: `app_open instance loaded` and
  `interstitial instance loaded` about 1.5 s after JS start.
- ✅ Launch app-open over Home on each cold start (bundle cached); "Continue
  to app" closes it.
- ✅ Bottom banner (test ad) on Home.
- ✅ Leave-app guard wrapped all 8 functions; consent from last session usable.
- ⚠️ Rewarded: Google's demo rewarded unit is **no-fill on iOS too**, also
  with keywords removed and with max rating MA, so it is the demo unit from
  this network, not the request. Production says rewarded fills: AdMob, last
  7 days, Blox Android 54,180 requests at 80.6% match rate (1,957
  impressions, $2.19 eCPM); Blox iOS 6,838 at 89.7% (263, $7.84). Rewarded
  is checked on real devices from the internal testing build instead.
- Note for 4.4: Blox Android rewarded shows ~1 impression per 22 matched
  requests (the old code warmed rewarded often). Compare that show rate on
  the new build.
- JS logs: React Native 0.87 doesn't print `console.log` to Metro or the
  iOS system log. Attach to Metro's `/json/list` debugger socket (send
  `Origin: http://localhost:<port>`) and enable `Runtime` to read them.

### 4.3 Release gates

1. Section 0 decision 1 made.
2. 4.1 all green on Android + iOS.
3. Internal testing track first. Production staged rollout 10% → 50% → 100%
   over about 7 days.

### 4.4 Revenue comparison

- **Compare** the new build against the previous build at the same dates,
  per country tier:
  - AdMob: requests, match rate, show rate, impressions per DAU, eCPM per
    format.
  - GA4: `ad_paid` sum per DAU and per placement.
  - Crashlytics: crash-free users, plus any `ads:`-tagged crash.
- **Roll back** (classic or `USE_SDK_PRELOADER = false` in the next build) if:
  - ARPDAU drops more than 10% for 3+ days at ≥ 50% rollout, or
  - crash-free users fall more than 0.2 pt.

## 5. Rollout order

1. Blox: branch `ads-v17-nextgen` → test (4.1) → internal track → staged
   production.
2. Adopt Me: after Blox has run 7 days at 100% with no regression (porting
   guide 7.1).
3. MM2: same, after Adopt Me (porting guide 7.2).

## 6. Policy items not changed (owner decision)

The policy research (Google AdMob / Play pages, 2026-10-12) flags these. Each
is live in at least one app.

| Item | Rule | Apps | Suggested change |
|---|---|---|---|
| Interstitial right after Send, every 10th chat message | "not when the user is focused on a task"; adPolicy itself excludes Chat from natural breaks | all | remove; chat already has banners |
| Interstitial *before* content (search, load more, share, open DM, upload) | interstitials go at natural breaks, never "shortly after a new page of content has loaded" or blocking the action | all | move after the action completes, or drop |
| Banner directly under a chat input / Send button | "not next to a text chat box" | all (Blox group chat Trader.jsx) | put the banner above the message list, or none in chat |
| Collapsible banners re-expand on every new instance (retry remount, root-stack screens) | collapsible only on static screens, "don't request a collapsible banner for every banner" | Adopt Me, MM2 | one expand per session |
| Fixed 320x50 banners | Google recommends anchored adaptive | all | `ANCHORED_ADAPTIVE_BANNER` (check FAB offsets) |
| App-open on every launch (`COLD_START_MIN_GAP_MS = 0`) | allowed; Google says it works best in apps opened more than once per 4 h | all | keep, watch `launch_ad` outcomes |
| Offer wall close × after 7 s | Families: an offer must be closeable after 5 s *when the user is a child* | all | 5 s |
| Unknown-age users | Families requires a neutral age screen if the target audience includes children; ours is 13+ | all | keep 13+ in Play Console; don't add child-appealing store assets |

## 7. Porting guides

Do the steps in order. Each app has uncommitted work from other sessions:
run `git status` first and commit only your files.

### 7.1 Adopt Me (`/Volumes/Sohail/AI_Projects/RunningApps/adoptme-jan7`)

1. Branch, then `npm install react-native-google-mobile-ads@17.2.0 --save-exact`.
   No library patch (§3.3). Then:
   ```bash
   cd ios && LANG=en_US.UTF-8 pod update Google-Mobile-Ads-SDK RNGoogleMobileAds
   ```
2. Copy from Blox `Code/Ads/`: `fullscreenSource.js`, `adTelemetry.js`,
   `leaveAppGuard.js`. In `fullscreenSource.js`, change `poolId` `blox-` →
   `adoptme-`. No date-of-birth wiring (owner decision §0.1).
3. `adPolicy.js`: add `APP_OPEN_EXPIRY_MS`, `USE_SDK_PRELOADER`,
   and the `reason`-aware `isNoFillError` (identical block).
4. Replace `IntAd.js`, `openApp.js`, `RewardedAdManager.js` with Blox's. The
   public APIs are the same. Re-check:
   - Adopt Me `openApp.js` lacks Blox's `adsInitialized()` guard (no longer
     needed).
   - `RewardedAdManager.showWithCallback` callers: `Code/Engagement/gameAds.js`
     and QuizBattle / TradeShowdown now get `onAdUnavailable` on a failed
     present.
5. `init.js`:
   - Keep Adopt Me's `gatherConsent()` inside `ensureAdsInitialized`, but wrap
     it with Blox's `consentFlow` tracking (`isConsentFlowActive` /
     `whenConsentFlowIdle`).
   - Keep the same request config: T, TFCD false, TFUA false.
   - **Fix the ATT order:** `AppOpenAdManager.start()` (App.js:495) must not
     start UMP before the ATT step (App.js:301-304).
6. **Banners must wait for consent and init.** Add Blox's `useAdsReady` to
   `bannerAds.js`, `FeedBannerAd.jsx` and `ScreenBottomBanner.jsx`. Adopt Me
   banners currently request before UMP and before `setRequestConfiguration`.
7. `App.js`:
   - `installLeaveAppGuard()`.
   - Pro → `AppOpenAdManager.stop()` + `InterstitialAdManager.cleanup()`.
   - Remove the dead `AppHelperFunction` ad code (`initializeAds`,
     `loadAppOpenAd`, `handleUserConsent`).
8. Mediation: if the commented Facebook / Unity adapters come back under
   Next-Gen, each `com.google.ads.mediation:*` dependency must exclude
   `play-services-ads` and `play-services-ads-lite`. iOS pods are unaffected.
   Add both networks to the UMP partner list.
9. `app.json`: `"android_sdk": "nextgen"` (or `"classic"` per decision 1).
10. Verify with section 4.1 and record the results in 4.2.

### 7.2 MM2 (`/Volumes/Sohail/AI_Projects/RunningApps/mm2values`)

1. Same library and pod steps as 7.1 step 1.
2. Same module copies as 7.1 step 2, with `poolId` `mm2-`.
3. Same `adPolicy.js` block and manager replacements as 7.1 steps 3–4. MM2's
   `RewardedAdManager.showForResult` is kept in Blox's version.
4. Consent: MM2 runs `requestInfoUpdate` / `showForm` by hand in
   App.js:154-173. Replace that with Blox's `gatherAdsConsent()` (UMP's
   `gatherConsent`) and `openAdsGate()`.
5. Missing fixes to add:
   - banner wrapper `collapsable={false}` (Adopt Me 04aa038 / Blox 2b9ab6e);
   - `useAdsReady` in `FeedBannerAd.jsx`;
   - wire `noteModalTransition` (Adopt Me `Code/Helper/modalPresentation.js`)
     or drop the dead guard.
6. Clean-up:
   - Remove the 9 unused `IntAd` imports, the native and gameInterstitial
     unit IDs, and `AppHelperFunction` ad code.
   - Reconcile the SKAdNetwork list (Info.plist has 50 entries, app.json 42;
     Info.plist wins).
7. `app.json`: `"android_sdk"` per decision 1. Then verify with 4.1.

## 8. Library watch list (re-check before each app's release)

- No release after 17.2.0 as of 2026-10-12. Fixes on `main` worth taking when
  released:
  - Android: BannerAd stealing BACK, collapsible banner height,
    NativeAdView fixes.
  - iOS: reward emitted before CLOSED (our 400 ms grace covers it) and touch
    recovery after a skipped dismiss.
- PR #905 (open): Next-Gen 1.5.0, iOS SDK 13.10.0 (needed for Xcode 27 /
  iOS 27). You can override earlier via `rootProject.ext['react-native'].versions`
  / `$RNGoogleMobileAdsSDKVersion`, but the library hasn't tested that
  combination.
- #906 `NativeAdView.reloadAd` crash (both backends). We use no native ads.
- #908 / PR #911 iOS SceneDelegate crash in consent forms. Matters once the
  apps move to the UIScene template (Apple requires it from April 2027).
- v18: Next-Gen becomes the default, the positional fullscreen hooks go, and
  `AdError.code` goes. We use neither.
