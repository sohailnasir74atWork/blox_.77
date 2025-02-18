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
  },
  android: {
    banner: config.andriodBanner,       
    interstitial: config.andriodIntestial, 
    rewarded:config.andriodRewarded,
    openapp:config.andriodOpenApp,

  },
  ios: {
    banner: config.IOsBanner,      
    interstitial: config.IOsIntestial, 
    rewarded:config.IOsRewarded,
    openapp:config.IOsOpenApp,
  },
  
};

const getAdUnitId = (type) => {
  const os = Platform.OS;
  if (developmentMode) 
    return adUnits.test[type];
  return adUnits[os][type]; 
};

export default getAdUnitId;