import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { View, Platform } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';
import { npaRequiredFor } from './consent';
import { useLocalState } from '../LocalGlobelStats';
import { useAdsReady } from './init';
import useIsAdFree from './useIsAdFree';

// Bottom banners are the standard fixed 320x50 BANNER (owner decision,
// 2026-10-05): no anchored-adaptive height.
const BannerAdComponent = ({
  adType = 'banner',
  visible = true,
  // Collapsible banner, Android only: main screens pass it, chat screens never
  // do (their input bar sits right above the banner, and the expanded first
  // impression would cover it). See requestOptions below.
  collapsible = false,
}) => {
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
  const isCollapsible = collapsible && Platform.OS === 'android';
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
    <View style={containerStyle}>
      <BannerAd
        key={reloadKey}
        unitId={unitId}
        size={BannerAdSize.BANNER}
        requestOptions={requestOptions}
        onAdLoaded={handleAdLoaded}
        onAdFailedToLoad={handleAdFailedToLoad}
      />
    </View>
  );
};

export default BannerAdComponent;
