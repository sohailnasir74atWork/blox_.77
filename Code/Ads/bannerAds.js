import React, { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';

const BannerAdComponent = ({ adType = 'banner', visible = true, requestOptions }) => {
  const unitId = getAdUnitId(adType);
  const [reloadKey, setReloadKey] = useState(0);
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const retryTimer = useRef(null);

  const scheduleRetry = useCallback(() => {
    if (retryTimer.current) return;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      setIsAdLoaded(false); // Hide before retry
      setReloadKey((k) => k + 1); // remounts BannerAd -> reloads
    }, 15000); // 15s backoff; adjust as you like
  }, []);

  if (!visible) return null;

  // Only render when ad is loaded (prevents reserving space when ad fails)
  if (!isAdLoaded) {
    // Render BannerAd hidden (no space reserved) to attempt loading
    return (
      <View style={{ height: 0, overflow: 'hidden' }}>
        <BannerAd
          key={reloadKey}
          unitId={unitId}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          requestOptions={requestOptions}
          onAdLoaded={() => {
            setIsAdLoaded(true);
            if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
          }}
          onAdFailedToLoad={(err) => {
            setIsAdLoaded(false);
            // console.log('Banner failed', err);
            scheduleRetry();
          }}
          onAdOpened={() => {}}
          onAdClosed={() => {}}
          onAdImpression={() => {}}
        />
      </View>
    );
  }

  // Ad loaded successfully - render with container
  return (
    <View style={{ width: '100%', alignItems: 'center' }}>
      <BannerAd
        key={reloadKey}
        unitId={unitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={requestOptions /* e.g., { requestNonPersonalizedAdsOnly: false } */}
        onAdLoaded={() => {
          setIsAdLoaded(true);
          if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
        }}
        onAdFailedToLoad={(err) => {
          setIsAdLoaded(false);
          // console.log('Banner failed', err);
          scheduleRetry();
        }}
        onAdOpened={() => {}}
        onAdClosed={() => {}}
        onAdImpression={() => {}}
      />
    </View>
  );
};

export default BannerAdComponent;
