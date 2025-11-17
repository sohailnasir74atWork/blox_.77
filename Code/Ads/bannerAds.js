import React, { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';

const BannerAdComponent = ({ adType = 'banner', visible = true, requestOptions }) => {
  const unitId = getAdUnitId(adType);
  const [reloadKey, setReloadKey] = useState(0);
  const retryTimer = useRef(null);

  const scheduleRetry = useCallback(() => {
    if (retryTimer.current) return;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      setReloadKey((k) => k + 1); // remounts BannerAd -> reloads
    }, 15000); // 15s backoff; adjust as you like
  }, []);

  if (!visible) return null;

  return (
    <View style={{ width: '100%', alignItems: 'center' }}>
      <BannerAd
        key={reloadKey}
        unitId={unitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={requestOptions /* e.g., { requestNonPersonalizedAdsOnly: false } */}
        onAdLoaded={() => {
          if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
        }}
        onAdFailedToLoad={(err) => {
          // keep it mounted; let SDK retry and also schedule our own retry
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
