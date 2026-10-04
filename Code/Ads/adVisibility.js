// Shared full-screen-ad visibility flag.
//
// The App Open ad fires on every foreground return. Without a shared signal
// it would happily stack on top of (or fire immediately after) an
// interstitial / rewarded ad — e.g. the user closes an interstitial, the app
// never backgrounded, but on iOS a system prompt can bounce app state and
// trigger a stray App Open ad over the closing interstitial.
//
// The ad managers are singletons (plain modules, not React), so a tiny shared
// mutable flag is the simplest correct channel. Interstitial + rewarded set it
// true while their ad is on screen; the App Open manager refuses to show while
// it's true (and sets it itself so the reverse also holds).
const state = { fullScreenAdVisible: false };

export const setFullScreenAdVisible = (visible) => {
  state.fullScreenAdVisible = !!visible;
};

export const isFullScreenAdVisible = () => state.fullScreenAdVisible;

// ── Cross-format spacing ──────────────────────────────────────────────────
//
// Each manager caps ITSELF (interstitial cooldown, app-open interval, rewarded
// cooldown) but none knew about the others, so an interstitial could follow an
// app-open ad seconds later, or a rewarded video chain straight into an
// interstitial. The managers record every ad that actually reached the screen
// here (on OPENED) and consult it before presenting — see CROSS_FORMAT_GAP_MS
// and NATURAL_BREAK.MIN_GAP_MS in adPolicy.js.
let lastFullScreenAd = { at: 0, format: null };

export const markFullScreenAdShown = (format) => {
  lastFullScreenAd = { at: Date.now(), format };
};

// ms since the last full-screen ad of a DIFFERENT format (Infinity if none).
export const msSinceOtherFullScreenAd = (format) =>
  lastFullScreenAd.at && lastFullScreenAd.format !== format
    ? Date.now() - lastFullScreenAd.at
    : Infinity;

// ms since the last full-screen ad of ANY format (Infinity if none).
export const msSinceAnyFullScreenAd = () =>
  lastFullScreenAd.at ? Date.now() - lastFullScreenAd.at : Infinity;

// ── Modal presentation window ─────────────────────────────────────────────
//
// On iOS a React Native <Modal> is not a view in the React tree:
// RCTModalHostView presents a real UIViewController. Full-screen ads are
// presented from the TOPMOST presented controller — see
// `+[RNGoogleMobileAdsCommon currentViewController]`, which walks
// `presentedViewController` down the chain before calling
// `presentFromRootViewController:`.
//
// That means a SETTLED modal is a perfectly good presenter: an interstitial
// fired from inside an open drawer chains normally (root -> drawer -> ad) and
// must NOT be blocked. Refusing to show while any modal is open would throw
// away every interstitial fired from UploadModal, the scammer report sheet,
// the status composer and so on — a large share of interstitial revenue, for
// no benefit.
//
// What UIKit *does* refuse is presenting from a controller that is itself
// mid-transition. The ad then silently fails to appear while the JS side has
// already marked the ad consumed. So the only thing the ad managers need to
// know is when a modal is ANIMATING, and hold the ad for those few hundred
// milliseconds.
//
// The window is a TIMESTAMP, never a counter. A counter that fails to be
// decremented — onDismiss is iOS-only, onShow can be missed when a modal is
// unmounted rather than hidden — would block every ad for the rest of the
// session: a silent, untraceable revenue outage. A timestamp cannot leak; the
// worst case is one short deferral.

// Longest RN modal transition (slide) plus headroom.
const MODAL_ANIMATION_MS = 450;

let modalSettledAt = 0;

// Called when a modal starts animating in or out.
export const noteModalTransition = (ms = MODAL_ANIMATION_MS) => {
  const until = Date.now() + ms;
  if (until > modalSettledAt) modalSettledAt = until;
};

// Deliberately no early-release hook. onShow/onDismiss report that ONE modal
// finished, but the window is global: clearing it when A settles would also
// release it while an unrelated B is still animating. Letting it expire costs
// at most MODAL_ANIMATION_MS of deferral and cannot reintroduce the bug.
export const isModalTransitioning = () => Date.now() < modalSettledAt;

// Run `task` as soon as no modal is mid-transition.
//
// Synchronous when nothing is animating, which is the overwhelmingly common
// case — ad behaviour is then byte-identical to before this guard existed.
// `task` is ALWAYS run exactly once, and never later than ~1s, so a caller
// can safely reserve state before handing work over.
export const whenModalSettled = (task, attempt = 0) => {
  const wait = modalSettledAt - Date.now();
  if (wait <= 0 || attempt >= 2) {
    task();
    return;
  }
  setTimeout(() => whenModalSettled(task, attempt + 1), Math.min(wait, MODAL_ANIMATION_MS) + 16);
};
