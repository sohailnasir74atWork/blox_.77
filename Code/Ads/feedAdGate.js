// feedAdGate — an in-feed ad row asks Google for an ad only when the player is
// about to reach it, not when the list merely prepares the row.
//
// Why (AdMob, 2026-10-14..17): FlatList renders rows several screens ahead of
// the viewport, and every FeedBannerAd it rendered sent a request at once.
// Only 13–26% of feed_inline_banner requests became impressions in the three
// apps (Blox Android 187,095 requests → 25,089 impressions; Adopt Me iOS had
// 26,080 filled ads and 5,249 shown). Revenue LOG 2026-10-18.
//
// How: the list reports its visible rows (onViewableItemsChanged); an ad row
// becomes active once it is visible or within LOOKAHEAD_ROWS after the last
// visible row, so it usually loads a moment before it scrolls in. Active is
// sticky for the life of the screen: scrolling back never re-requests. Only
// the ad row re-renders (useFeedAdActive), never the trade/post rows.
//
// Same file in Adopt Me, MM2 and Blox.
import { useRef, useSyncExternalStore } from 'react';

const LOOKAHEAD_ROWS = 4;

// Stable object: FlatList must not get a new viewabilityConfig per render.
export const FEED_AD_VIEWABILITY = { itemVisiblePercentThreshold: 1 };

const noopSubscribe = () => () => {};

function createFeedAdGate() {
  const active = new Set();
  const listeners = new Set();
  let data = [];

  return {
    setData(next) {
      data = Array.isArray(next) ? next : [];
    },
    isActive: (key) => active.has(key),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Stable function: pass straight to FlatList's onViewableItemsChanged.
    onViewableItemsChanged: ({ viewableItems }) => {
      let first = Infinity;
      let last = -1;
      for (const v of viewableItems || []) {
        if (typeof v?.index !== 'number') continue;
        if (v.index < first) first = v.index;
        if (v.index > last) last = v.index;
      }
      if (last < 0) return;
      let changed = false;
      const end = Math.min(last + LOOKAHEAD_ROWS, data.length - 1);
      for (let i = first; i <= end; i++) {
        const item = data[i];
        if (item?.__type === 'ad' && item.id != null && !active.has(item.id)) {
          active.add(item.id);
          changed = true;
        }
      }
      if (changed) listeners.forEach((listener) => listener());
    },
  };
}

/**
 * One gate per feed list. Pass the list's current `data` every render, or
 * call gate.setData(data) later in the render when the data is built after
 * the row renderer.
 */
export function useFeedAdGate(data) {
  const gateRef = useRef(null);
  if (!gateRef.current) gateRef.current = createFeedAdGate();
  if (data !== undefined) gateRef.current.setData(data);
  return gateRef.current;
}

/** True once the ad row `key` is near the screen. No gate = always true. */
export function useFeedAdActive(gate, key) {
  return useSyncExternalStore(
    gate ? gate.subscribe : noopSubscribe,
    () => (gate ? gate.isActive(key) : true),
  );
}
