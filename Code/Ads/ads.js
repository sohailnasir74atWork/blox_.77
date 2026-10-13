// AdConfig.js

import { Platform } from 'react-native';
import {  TestIds } from 'react-native-google-mobile-ads';
import config from '../Helper/Environment';


export const developmentMode = __DEV__;

const adUnits = {
  test: {
    banner: TestIds.BANNER,
    interstitial: TestIds.INTERSTITIAL,
    rewarded:TestIds.REWARDED,
    openapp:TestIds.APP_OPEN,
    native:'ca-app-pub-3940256099942544/2247696110',
    reward_int:TestIds.REWARDED_INTERSTITIAL,
    feedBanner: TestIds.BANNER,
    tradePost: TestIds.INTERSTITIAL,
    feedPost: TestIds.INTERSTITIAL,
  },
  android: {
    banner: config.andriodBanner,       
    interstitial: config.andriodIntestial, 
    rewarded:config.andriodRewarded,
    openapp:config.andriodOpenApp,
    native:config.andriodNative,
    reward_int:config.andriodRewarded_int,
    // In-feed inline banner (FeedBannerAd.jsx). Falls back to the anchored
    // banner unit until a dedicated unit exists for this platform — any
    // banner-format unit serves inline sizes; only the reporting differs.
    feedBanner: config.andriodFeedBanner || config.andriodBanner,
    // Dedicated interstitial units for the post placements (PostAd.js), so
    // AdMob reports them apart from the shared interstitial. Fall back to
    // the shared unit until a dedicated one is filled in.
    tradePost: config.andriodTradePostInterstitial || config.andriodIntestial,
    feedPost: config.andriodFeedPostInterstitial || config.andriodIntestial,
  },
  ios: {
    banner: config.IOsBanner,      
    interstitial: config.IOsIntestial, 
    rewarded:config.IOsRewarded,
    openapp:config.IOsOpenApp,
    native:config.IOsNative,
    reward_int:config.andriodRewarded_int_ios,
    feedBanner: config.IOsFeedBanner || config.IOsBanner,
    tradePost: config.IOsTradePostInterstitial || config.IOsIntestial,
    feedPost: config.IOsFeedPostInterstitial || config.IOsIntestial,
  },
  
};

const getAdUnitId = (type) => {
  const os = Platform.OS;
  if (developmentMode) 
    return adUnits.test[type];
  return adUnits[os][type]; 
};

export default getAdUnitId;