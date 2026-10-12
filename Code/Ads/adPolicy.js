// Ad frequency policy — the knobs that decide HOW OFTEN a user can meet a
// full-screen ad and how the managers behave when AdMob has nothing to serve.
// One file, no logic, so the caps can be tuned (or an experiment run) without
// touching IntAd.js / openApp.js / RewardedAdManager.js. All times in ms.
//
// Why these exist (AdMob report, Sep 4 – Oct 3 2026): interstitials earn
// $2–5 eCPM against $0.15–0.45 for banners, yet only 4–20% of the
// interstitials the apps LOADED were ever shown — the triggers (post a trade,
// 7th chat message, upload…) are rare, so most sessions warmed an ad for
// nothing. The natural-break placement below turns tab switches into the
// standard "between screens" interstitial moment, under caps strict enough
// that a user can never see more than one every few minutes.

export const NATURAL_BREAK = {
  ENABLED: true,
  // Minimum gap since ANY full-screen ad (interstitial, app open, rewarded) —
  // not just since the last natural-break one.
  MIN_GAP_MS: 3 * 60 * 1000,
  // Hard ceiling per app process; a long session is not a reason for more.
  MAX_PER_SESSION: 5,
  // Nothing this soon after launch: the user is still orienting, and the
  // cold-start app-open ad (where enabled) owns that moment anyway.
  SESSION_WARMUP_MS: 60 * 1000,
  // Tabs that never trigger a natural-break ad when pressed: an ad in front
  // of a conversation is the one placement users consistently report.
  EXCLUDED_TABS: ['Chat'],
};

// ── Full-screen ad cadence (one policy for all four apps, 2026-10-04) ──────
// Balanced for revenue first, experience second: ads sit at natural breaks and
// on returns, never stacked, and always a few minutes apart.
// Interstitial: minimum gap between two (effective max(this, POST_SHOW_RELOAD_MS)).
export const INTERSTITIAL_COOLDOWN_MS = 30 * 1000;
// Chat: an interstitial after every Nth message the user sends (pre-loaded at N-1).
export const CHAT_MESSAGES_PER_AD = 10;
// App-open on a return from background: at most once per this window
// (and only after APP_OPEN_MIN_BACKGROUND_MS away).
export const APP_OPEN_MIN_INTERVAL_MS = 5 * 60 * 1000;
// Launch (cold-start) app-open ad: returning users only, shown from the splash
// or not at all. Every launch is eligible (owner decision, 2026-10-07): the
// 4 h gap cut app-open impressions per session by 26–54% in the 2026-10-04
// builds, and app-open is the largest earner. Raise this to space them again.
export const COLD_START_MIN_GAP_MS = 0;
// Launch-ad window (owner decision, 2026-10-07: no longer tied to the splash,
// which now hides as soon as the app is ready). A launch ad that finishes
// loading inside the window shows — over the splash or over Home — unless the
// user has already touched Home; otherwise it is kept for the next return.
// The window runs to the latest of COLD_START_BUDGET_MS from JS start and
// LAUNCH_AD_HOME_GRACE_MS after Home appeared, but never past
// LAUNCH_AD_MAX_MS. (3 s from JS start was spent mostly before the request
// even went out: SDK init plus the consent refresh it used to wait for.)
export const COLD_START_BUDGET_MS = 5000;
export const LAUNCH_AD_HOME_GRACE_MS = 2000;
export const LAUNCH_AD_MAX_MS = 7000;

// Two different full-screen formats are never shown within this gap of each
// other (interstitial after app-open, rewarded then interstitial…). Each
// manager already caps itself; this is the cross-format rule they lacked.
export const CROSS_FORMAT_GAP_MS = 60 * 1000;

// An app-open ad needs the user to have genuinely LEFT: a 5-second flick to
// Roblox and back is not a new session. Quick switches never get an ad.
// 10 s, not 30 s (owner decision, 2026-10-07): checking a trade in Roblox and
// coming back is a real return, and 30 s skipped most of them.
export const APP_OPEN_MIN_BACKGROUND_MS = 10 * 1000;

// "No fill" is not a transient failure — the auction had nothing for this
// user/geo right now — so the 1→16s exponential retry the managers used to
// run just burned 5 more requests for the same answer. After a no-fill, one
// retry this much later, then wait for the next real user signal. Used by the
// interstitial AND app-open managers (app-open ignored it until 2026-10-07, so
// one no-fill left nothing ready for the next return).
export const NO_FILL_RETRY_MS = 60 * 1000;

// AdMob frequency caps (interstitial 1 per minute, app-open 1 per minute,
// set 2026-10-04 as a backstop under the rules in this file) are enforced at
// REQUEST time. Reloading the next ad the instant one closes used to land that
// request inside the cap window, where AdMob answers "frequency cap reached":
// a wasted request, a no-fill in the stats, and no ad ready for the next
// trigger. So the post-show reload waits until the window has passed. The
// managers also treat this as the minimum gap between two shows.
export const POST_SHOW_RELOAD_MS = 65 * 1000;

// Google expires a loaded interstitial after one hour; showing a stale one is
// a silent no-op that still consumes the slot. Treat it as gone a little early.
export const INTERSTITIAL_EXPIRY_MS = 55 * 60 * 1000;

// App-open ads expire 4 h after load (Google); drop ours a little early.
export const APP_OPEN_EXPIRY_MS = 4 * 60 * 60 * 1000 - 5 * 60 * 1000;

// Android on the GMA Next-Gen SDK keeps full-screen ads ready with Google's
// own preloader (react-native-google-mobile-ads AdPools) instead of our
// one-instance warm-up. false = use the instance path everywhere (kill switch;
// see fullscreenSource.js).
export const USE_SDK_PRELOADER = true;

// 17.x reports a no-fill as `reason: 'no-fill' | 'mediation-no-fill'`; the
// deprecated `code` is still 'googleMobileAds/error-code-no-fill' (iOS and
// Android alike).
export const isNoFillError = (err) =>
  /no-fill/i.test(String((err && (err.reason || err.code || err.message)) || ''));
