// bannerHeight — the bottom banner's real on-screen height, for anything that
// must sit above it (the feed "+" button, scroll-to-top, chat scroll-to-bottom).
//
// Screens used a fixed 60dp (floatingButtonLayout BANNER_HEIGHT) because the
// anchored adaptive banner was ~50–60dp. react-native-google-mobile-ads 17.3.0
// with the Android Next-Gen SDK 1.5.0 only offers the LARGE anchored size
// (~128dp on a Pixel 9; the 50dp-capped anchored size is gone), so on Android
// the buttons sat on top of the ad. iOS keeps the smaller size. Owner chose the
// large banner (2026-10-18), so the buttons follow the measured height instead.
//
// BannerAdComponent reports its laid-out height once loaded; screens read it
// with useBannerHeight(). Never below BANNER_HEIGHT, so before any ad loads the
// spacing is what it always was. Same file in Adopt Me, MM2 and Blox.
import { useSyncExternalStore } from 'react';
import { BANNER_HEIGHT } from '../Helper/floatingButtonLayout';

let height = BANNER_HEIGHT;
const listeners = new Set();

export function reportBannerHeight(measured) {
  if (!(measured > 0)) return;
  const next = Math.max(BANNER_HEIGHT, Math.round(measured));
  if (next === height) return;
  height = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useBannerHeight = () => useSyncExternalStore(subscribe, () => height);
