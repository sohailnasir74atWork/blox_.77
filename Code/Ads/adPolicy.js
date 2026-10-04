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
// Launch (cold-start) app-open ad: returning users only, at most once per 4 h,
// and only if it is ready while the splash is still up.
export const COLD_START_MIN_GAP_MS = 4 * 60 * 60 * 1000;
export const COLD_START_BUDGET_MS = 3000;

// Two different full-screen formats are never shown within this gap of each
// other (interstitial after app-open, rewarded then interstitial…). Each
// manager already caps itself; this is the cross-format rule they lacked.
export const CROSS_FORMAT_GAP_MS = 60 * 1000;

// An app-open ad needs the user to have genuinely LEFT: a 5-second flick to
// Roblox and back is not a new session. Quick switches never get an ad.
export const APP_OPEN_MIN_BACKGROUND_MS = 30 * 1000;

// "No fill" is not a transient failure — the auction had nothing for this
// user/geo right now — so the 1→16s exponential retry the managers used to
// run just burned 5 more requests for the same answer. After a no-fill, one
// retry this much later, then wait for the next real user signal.
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

// react-native-google-mobile-ads reports AdMob's ERROR_CODE_NO_FILL as
// `code: 'error-code-no-fill'` (iOS and Android alike).
export const isNoFillError = (err) =>
  /no-fill/i.test(String((err && (err.code || err.message)) || ''));
