// FeedBannerAd — the in-feed ad slot (Designs feed, Trades list).
//
// Replaces NativeAdCard. The native units earned $0.13–0.35 eCPM at 0.1% CTR
// with 25–65% fill (AdMob, Sep 2026) — no better than a plain banner for a lot
// more code. Google's INLINE adaptive banner is the format built for
// scrolling content: it takes the full card width and lets the auction pick a
// taller creative (up to MAX_HEIGHT) when one bids higher, which is where the
// eCPM uplift over a 320x50 comes from.
//
// Same props as the card it replaces (`adKey`, `isDarkMode`) so the feed code
// only swapped the import. The slot is zero-height until an ad fills, so an
// unfilled slot costs the list nothing, and the library's <BannerAd> sizes
// itself from the SDK's onAdLoaded/onSizeChange events — the wrapper only
// adds the card gutter once something is on screen.
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';
import { useLocalState } from '../LocalGlobelStats';

// Horizontal gutter the feed cards use, so the ad lines up with content.
const CARD_GUTTER = 12;
// Inline adaptive banners default to the device height as their ceiling; a
// feed row should never be that tall.
const MAX_HEIGHT = 250;
// One fresh request after a failed first load, then leave the slot alone.
const RETRY_MS = 30000;

const npaRequiredFor = (status) =>
  status !== 'OBTAINED' && status !== 'NOT_REQUIRED';

const FeedBannerAd = ({ adKey, isDarkMode = false }) => {
  const { width: screenWidth } = useWindowDimensions();
  const { localState } = useLocalState();
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const retriedRef = useRef(false);
  const retryTimer = useRef(null);

  const unitId = getAdUnitId('feedBanner');
  const width = Math.max(200, Math.floor(screenWidth - CARD_GUTTER * 2));

  const requestOptions = useMemo(
    () => ({
      requestNonPersonalizedAdsOnly: npaRequiredFor(localState?.consentStatus),
    }),
    [localState?.consentStatus],
  );

  const handleAdLoaded = useCallback(() => setLoaded(true), []);

  const handleAdFailedToLoad = useCallback(() => {
    setLoaded(false);
    if (retriedRef.current || retryTimer.current) return;
    retriedRef.current = true;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      setReloadKey((k) => k + 1);
    }, RETRY_MS);
  }, []);

  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  // A different slot: start its retry budget fresh.
  useEffect(() => {
    retriedRef.current = false;
  }, [adKey]);

  if (localState?.isPro) return null;

  return (
    <View
      style={
        loaded
          ? {
              alignSelf: 'center',
              marginVertical: 6,
              borderRadius: 12,
              overflow: 'hidden',
              backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
            }
          : { height: 0, overflow: 'hidden' }
      }
    >
      <BannerAd
        key={`${adKey}-${reloadKey}`}
        unitId={unitId}
        size={BannerAdSize.INLINE_ADAPTIVE_BANNER}
        width={width}
        maxHeight={MAX_HEIGHT}
        requestOptions={requestOptions}
        onAdLoaded={handleAdLoaded}
        onAdFailedToLoad={handleAdFailedToLoad}
      />
    </View>
  );
};

export default React.memo(FeedBannerAd);
