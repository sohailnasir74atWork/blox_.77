import React, { useState, useMemo, useRef, useEffect, useCallback, useContext } from 'react';
import { View, Platform, useWindowDimensions } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';
import { npaRequiredFor } from './consent';
import { useLocalState } from '../LocalGlobelStats';
import { useAdsReady } from './init';
import { reportBannerHeight } from './bannerHeight';
import useIsAdFree from './useIsAdFree';
import { logAdRevenue } from './adTelemetry';

// Bottom banners are anchored adaptive (owner decision, 2026-10-13; they were
// a fixed 320x50 BANNER from 2026-10-05).

// Focus of the screen this banner sits in, from the focus/blur events (port of
// Adopt Me / MM2). useIsFocused() flipped in the same render that brings a tab
// back, so the collapsible banner re-mounted while react-native-screens was
// re-attaching the screen — and the adaptive banner resizes right after mount.
// That is the suspected cause of 4.0.25 (174)'s top crash, Fabric addViewAt
// "Unable to find view for viewState" on HomeTab (Ops/bugs/LOG.md, 2026-10-17).
// The 'focus' event fires once the tab is back, so the banner mounts one commit
// later. Without a navigation context the banner counts as focused.
const useScreenFocused = () => {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => (navigation ? navigation.isFocused() : true));
  useEffect(() => {
    if (!navigation) return undefined;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => { offFocus(); offBlur(); };
  }, [navigation]);
  return focused;
};


// Bottom banner size (owner, 2026-10-18). The Android Next-Gen SDK in
// react-native-google-mobile-ads 17.3.0 only offers the LARGE anchored size
// (~128dp on a Pixel 9), which covered too much of the screen. Android asks
// for a full-width inline adaptive banner capped at BANNER_MAX_HEIGHT instead,
// about the old anchored height. Collapsible still works: Google shows the
// requested size in the collapsed state. iOS keeps the anchored adaptive size.
const BANNER_MAX_HEIGHT = 60;
const BannerAdComponent = ({
  adType = 'banner',
  visible = true,
  // Collapsible banner, Android only: main screens pass it, chat screens never
  // do (their input bar sits right above the banner, and the expanded first
  // impression would cover it). See requestOptions below.
  collapsible = false,
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const { localState } = useLocalState();
  const adFree = useIsAdFree();
  const adsReady = useAdsReady();
  const unitId = getAdUnitId(adType);

  // No-fill retry: a banner's FIRST load can fail (no fill / transient
  // network). The <BannerAd> won't re-request on its own until something
  // forces a remount, so the slot would stay blank for the whole screen
  // visit — a silently lost impression on every such screen. We bump
  // reloadKey (used as the BannerAd `key`) after a delay to force one fresh
  // request. Once an ad has loaded, the SDK's own auto-refresh takes over and
  // we stop interfering, so we never remount a working banner.
  const [reloadKey, setReloadKey] = useState(0);
  const hasEverLoaded = useRef(false);
  // The remount re-runs this handler on the next failure with the timer
  // already cleared, so without this guard the "one" retry became a 30 s loop
  // for the whole screen visit in no-fill geos.
  const retriedOnce = useRef(false);
  const retryTimer = useRef(null);

  const handleAdLoaded = useCallback(() => {
    hasEverLoaded.current = true;
    setIsAdLoaded(true);
  }, []);

  const handleAdFailedToLoad = useCallback(() => {
    setIsAdLoaded(false);
    // Only nudge the first-ever load; let the SDK own refresh failures.
    if (hasEverLoaded.current || retriedOnce.current || retryTimer.current) return;
    retriedOnce.current = true;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      setReloadKey((k) => k + 1);
    }, 30000);
  }, []);

  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  // Stable request options — recomputed only when consent flips so the
  // BannerAd component below doesn't see a new object reference on every
  // render (which would otherwise force a fresh ad request).
  //
  // NPA decided from the persisted UMP consent status (never hardcoded).
  //
  // Collapsible banners are back on Android main screens (owner decision,
  // 2026-10-07; removed 2026-10-05 because the expanded ad opened over half
  // the screen). In the sibling apps, removing them halved what an Android
  // banner impression earned (AdMob, same days, old vs new build: Adopt Me US
  // $0.39 → $0.16, MM2 US $0.99 → $0.42 eCPM). The first request of a session
  // expands until the user collapses it; refreshes are ordinary banners. iOS
  // banners earned the same without it, so iOS stays a plain strip.
  //
  // The expanded ad is drawn ABOVE the app, not inside this screen, so it
  // stayed floating over the next screen the player opened (verified on the
  // emulator, 2026-10-07: Values ▸ More showed the Values list's expanded ad
  // over the hub, and a tap on a hub card clicked the ad). So a collapsible
  // banner is unmounted while its screen is out of focus, which removes the
  // overlay, and once its screen has been left it comes back as a plain
  // banner: it can expand only on the first visit.
  const wantsCollapsible = collapsible && Platform.OS === 'android';
  const isFocused = useScreenFocused();
  const [expandSpent, setExpandSpent] = useState(false);
  useEffect(() => {
    if (wantsCollapsible && !isFocused) {
      setExpandSpent(true);
      setIsAdLoaded(false);
    }
  }, [wantsCollapsible, isFocused]);
  const isCollapsible = wantsCollapsible && !expandSpent;
  const handlePaid = useCallback(
    (paid) => logAdRevenue('banner', isCollapsible ? 'banner_collapsible' : 'banner', paid, unitId),
    [isCollapsible, unitId],
  );
  const requestOptions = useMemo(
    () => ({
      requestNonPersonalizedAdsOnly: npaRequiredFor(localState?.consentStatus),
      ...(isCollapsible ? { networkExtras: { collapsible: 'bottom' } } : {}),
    }),
    [localState?.consentStatus, isCollapsible],
  );

  // Pro (either source) never sees a banner, whatever the call site checked;
  // and nothing mounts — so nothing is requested — before consent + init.
  if (!visible || adFree || !adsReady) return null;
  if (wantsCollapsible && !isFocused) return null;

  // The BannerAd is mounted ONCE and never unmounted while visible. The
  // old code conditionally re-rendered a *different* BannerAd once
  // isAdLoaded flipped — React unmounted the loaded ad and started a
  // fresh request, so roughly half of every banner's load never became
  // an impression. Now we just toggle the wrapper's layout: zero-height
  // while loading (so it reserves no space and doesn't flash an empty
  // box), full-height with the layout container once loaded.
  const containerStyle = isAdLoaded
    ? { alignItems: 'center', justifyContent: 'center' }
    : { height: 0, overflow: 'hidden' };

  return (
    // collapsable={false}: the loaded style is layout-only, so Fabric would
    // flatten this View once the ad loads and re-parent the native ad view —
    // a known trigger for the addViewAt IndexOutOfBounds crash.
    <View
      style={containerStyle}
      collapsable={false}
      // Floating buttons sit above the real height (Ads/bannerHeight.js).
      onLayout={isAdLoaded ? (e) => reportBannerHeight(e.nativeEvent.layout.height) : undefined}
    >
      <BannerAd
        key={reloadKey}
        unitId={unitId}
        // Anchored adaptive, full screen width (owner decision, 2026-10-13,
        // reversing the fixed 320x50 of 2026-10-05): the SDK picks the height per
        // device (about 50-60dp on phones), and adaptive banners usually earn
        // more per impression than the fixed size. The banner sits in normal
        // layout flow, so a taller slot pushes content up instead of covering it.
        {...(Platform.OS === 'android'
          ? {
              size: BannerAdSize.INLINE_ADAPTIVE_BANNER,
              width: Math.floor(screenWidth),
              maxHeight: BANNER_MAX_HEIGHT,
            }
          : { size: BannerAdSize.ANCHORED_ADAPTIVE_BANNER })}
        requestOptions={requestOptions}
        onAdLoaded={handleAdLoaded}
        onAdFailedToLoad={handleAdFailedToLoad}
        onPaid={handlePaid}
      />
    </View>
  );
};

export default BannerAdComponent;
