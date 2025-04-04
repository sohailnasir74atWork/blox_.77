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
    native:TestIds.NATIVE,
  },
  android: {
    banner: config.andriodBanner,       
    interstitial: config.andriodIntestial, 
    rewarded:config.andriodRewarded,
    openapp:config.andriodOpenApp,
    native:config.andriodNative,
  },
  ios: {
    banner: config.IOsBanner,      
    interstitial: config.IOsIntestial, 
    rewarded:config.IOsRewarded,
    openapp:config.IOsOpenApp,
    native:config.IOsNative,
  },
  
};

const getAdUnitId = (type) => {
  const os = Platform.OS;
  if (developmentMode) 
    return adUnits.test[type];
  return adUnits[os][type]; 
};

export default getAdUnitId;