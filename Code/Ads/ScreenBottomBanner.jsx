/**
 * ScreenBottomBanner — the bottom of a full-screen page (a root-stack screen,
 * no tab bar under it): the banner ad, then a spacer as tall as the system
 * navigation bar, painted in the page's colour.
 *
 * Android draws every screen edge-to-edge (edgeToEdgeEnabled, targetSdk 36),
 * so without this the page runs under the nav buttons. Padding only the end
 * of the scroll content cleared the LAST row, but every row scrolled behind
 * the buttons on the way there. Place it as the page's last child, after the
 * flex:1 list, and drop insets.bottom from the list's own padding.
 *
 * Tab screens don't need it: the tab bar already sits above the nav bar.
 * Leaderboard, Admin and Friends are ALSO mounted inside the Chat tab's stack
 * (ChatNavigator.js), where the tab bar is still showing; there the spacer is
 * skipped (BottomTabBarHeightContext is only set under a tab navigator) so it
 * doesn't leave an empty strip above the tab bar.
 *
 * No Pro check here: BannerAdComponent already renders nothing for ad-free
 * users (either Pro source, via useIsAdFree) and before ads are ready.
 *
 * Plain banner by default. `collapsible` only where the owner chose it (main
 * screens, e.g. Analytics): a collapsible banner's first load expands over
 * half the page, which on every secondary page is too much. `ad={false}`
 * renders the spacer alone (purchase, rewarded-ad and staff pages).
 */

import React, { useContext } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import BannerAdComponent from './bannerAds';

const ScreenBottomBanner = ({ background, ad = true, collapsible = false }) => {
  const insets = useSafeAreaInsets();
  const inTabs = useContext(BottomTabBarHeightContext) !== undefined;
  return (
    <>
      {ad && <BannerAdComponent collapsible={collapsible} />}
      {!inTabs && <View style={{ height: insets.bottom, backgroundColor: background }} />}
    </>
  );
};

export default ScreenBottomBanner;
