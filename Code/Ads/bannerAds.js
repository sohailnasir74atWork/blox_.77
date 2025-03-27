import React, { useState } from 'react';
import { View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads'; // update path to your ads config

const BannerAdComponent = ({ adType = 'banner', visible = true }) => {
  const [isAdVisible, setIsAdVisible] = useState(true);
  const unitId = getAdUnitId(adType);

  if (!visible || !isAdVisible) return null;

  return (
    <View style={{ alignItems: 'center' }}>
      <BannerAd
        unitId={unitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        // requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdLoaded={() => {
        //   console.log('[BannerAd] Loaded ✅');
          setIsAdVisible(true);
        }}
        onAdFailedToLoad={(error) => {
        //   console.log('[BannerAd] Failed to load ❌', error);
          setIsAdVisible(false);
        }}
      />
    </View>
  );
};

export default BannerAdComponent;
