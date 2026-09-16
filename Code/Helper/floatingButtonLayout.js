/**
 * floatingButtonLayout.js — one standard height for the app's floating
 * bottom-right round buttons.
 *
 * Three screens put a 48–60px round button in the bottom-right corner: the
 * feed's "+" post FAB, the trades list's scroll-to-top, and the community
 * chat's scroll-to-bottom. They drifted to three different offsets (80, 150,
 * and 80-in-a-different-reference-frame), so the button visibly jumped as you
 * moved between tabs. Every one of them now derives its offset from here.
 *
 * The gap is measured from whatever furniture sits at the bottom of that
 * screen, NOT blindly from the screen edge — that distinction is the whole
 * reason they never agreed:
 *
 *   Feed / Trades      Chat
 *   [  button  ]       [  button  ]
 *   [  banner  ]       [ message input ]
 *                      [    banner     ]
 *
 * On the feed and trades the banner ad is the last thing above the tab bar, so
 * the button clears the banner (ABOVE_BANNER). On chat the message input sits
 * between the list and the banner, so the button clears the input instead
 * (ABOVE_CHAT_INPUT) — putting it at ABOVE_BANNER there would park it on top
 * of the text field.
 */

// Height reserved for the anchored adaptive banner. Matches the spacer views
// the screens already use (`bannerBottomPos + 60`). Note the collapsible
// format makes the FIRST impression taller than this; the buttons sit above
// the ad in z-order, which is the behaviour the feed FAB already established.
export const BANNER_HEIGHT = 60;

// Breathing room between the button's bottom edge and the furniture below it.
export const FLOATING_BUTTON_GAP = 20;

// Height of the chat's message input row (MessageInput). The chat button is
// positioned against the wrapper that contains the input, so it has to clear
// the input's own height before the gap applies.
export const CHAT_INPUT_HEIGHT = 56;

/** Bottom offset for a floating button on a screen whose banner is flush at the bottom. */
export const ABOVE_BANNER = BANNER_HEIGHT + FLOATING_BUTTON_GAP; // 80

/** Bottom offset for the chat's scroll button, measured from the message-input wrapper. */
export const ABOVE_CHAT_INPUT = CHAT_INPUT_HEIGHT + FLOATING_BUTTON_GAP; // 76

/**
 * Bottom offset on a screen with NO banner ad — the groups screen, for one.
 *
 * The tab bar is docked in the layout flow (the reason every screen sets
 * `bannerBottomPos = 0`: "screen bottom == tab bar top"), so an offset here is
 * already measured from the tab bar's top edge. With no banner to clear there
 * is nothing to add, and the gap alone is the whole offset — using
 * ABOVE_BANNER on such a screen reserves 60dp for an ad that is not there and
 * leaves the button visibly stranded.
 */
export const ABOVE_TAB_BAR = FLOATING_BUTTON_GAP; // 20

/**
 * Glyph size for all three buttons. They were 48 (chat), 48 (trades) and 44
 * (feed's "+"), so the feed's read as the odd one out.
 *
 * This is the single dial for how big they all are: change it here and all
 * three follow. 48 is kept because it is what the two scroll buttons already
 * used, so they don't shift — if the result still looks too big, drop this to
 * 44 (or 40) and every screen tracks it.
 */
export const FLOATING_BUTTON_ICON_SIZE = 48;

/**
 * Distance from the right screen edge. Was 8 on the scroll buttons but 10 on
 * the feed's FAB — and because that FAB also sat in a 60x60 box around a 44px
 * glyph, its centre ended up 8px further in than the others. Every button now
 * uses a box exactly the size of its glyph plus this inset, so all three
 * centres line up vertically as you switch tabs.
 */
export const FLOATING_BUTTON_RIGHT = 8;

/**
 * Pro-aware wrapper around the ABOVE_* constants.
 *
 * Pro members see no banner ad, so every offset that reserves BANNER_HEIGHT
 * leaves them staring at a 60dp gap with nothing in it. Pass the base offset
 * for the screen and whether this viewer is Pro:
 *
 *   bottom: bannerAware(ABOVE_BANNER, isPro)   // feed / trades
 *
 * Only use this where the banner is genuinely inside the same reference frame
 * as the button. On a screen whose button is positioned against a wrapper that
 * does NOT contain the banner, there is nothing to subtract and the base
 * offset is already correct.
 */
export const bannerAware = (base, isPro) =>
  isPro ? Math.max(FLOATING_BUTTON_GAP, base - BANNER_HEIGHT) : base;

/**
 * Offset for the group chat's scroll button on apps where the button's wrapper
 * holds the list, the banner AND the message composer (Adopt Me and Blox
 * Fruits are built this way; MM2's chat wrapper excludes the banner, which is
 * why it uses ABOVE_CHAT_INPUT directly).
 *
 * TUNED, NOT DERIVED: 106 reproduces the ~105 these buttons have shipped with
 * for a long time and which looks right on device. Deriving it from a nominal
 * composer height put it ~23px too high.
 */
export const ABOVE_CHAT_INPUT_AND_BANNER = 106;

export default {
  BANNER_HEIGHT,
  bannerAware,
  ABOVE_CHAT_INPUT_AND_BANNER,
  ABOVE_TAB_BAR,
  FLOATING_BUTTON_GAP,
  CHAT_INPUT_HEIGHT,
  ABOVE_BANNER,
  ABOVE_CHAT_INPUT,
  FLOATING_BUTTON_ICON_SIZE,
  FLOATING_BUTTON_RIGHT,
};
