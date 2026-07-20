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
