// themes.js
import { DefaultTheme, DarkTheme } from '@react-navigation/native';
import { AppOpenAd, AdEventType } from 'react-native-google-mobile-ads';
import InAppReview from 'react-native-in-app-review';
import { AdsConsent, AdsConsentStatus } from 'react-native-google-mobile-ads';


export const MyLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#f2f2f7',
    text: 'black',
    primary: '#3E8BFC',
  },
};

export const MyDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#121212',
    text: 'white',
    primary: '#BB86FC',
  },
};


// adHelper.js

export const initializeAds = async () => {
  await mobileAds().initialize();
};


export const loadAppOpenAd = async (
  adUnitId,
  lastAdShownTime,
  adCooldown,
  setLastAdShownTime,
  setIsAdLoaded,
  isPro
) => {
  if (isPro) return; // Return immediately if the user is Pro

  const now = Date.now();
  if (now - lastAdShownTime < adCooldown) return; // Ensure cooldown is respected

  try {
    const appOpenAd = AppOpenAd.createForAdRequest(adUnitId);

    appOpenAd.addAdEventListener(AdEventType.LOADED, () => {
      setIsAdLoaded(true); // Mark ad as loaded
      appOpenAd.show();
      setLastAdShownTime(Date.now());
      setIsAdLoaded(false); // Reset ad loaded state
    });

    appOpenAd.addAdEventListener(AdEventType.ERROR, (error) => {
      console.error('Ad Error:', error);
      setIsAdLoaded(false);
    });

    await appOpenAd.load(); // Load the ad
  } catch (error) {
    console.error('Error loading App Open Ad:', error);
    setIsAdLoaded(false);
  }
};


// reviewHelper.js

export const requestReview = () => {
  if (InAppReview.isAvailable()) {
    InAppReview.RequestInAppReview()
      .then(() => console.log('In-App review flow completed'))
      .catch((error) => console.error('In-App review error:', error));
  }
};


// consentHelper.js

export const handleUserConsent = async (setConsentStatus, setLoading) => {
  try {
    const consentInfo = await AdsConsent.requestInfoUpdate();
    if (consentInfo.isConsentFormAvailable) {
      if (consentInfo.status === AdsConsentStatus.REQUIRED) {
        const formResult = await AdsConsent.showForm();
        setConsentStatus(formResult.status);
      } else {
        setConsentStatus(consentInfo.status);
      }
    }
  } catch (error) {
    console.error('Error handling consent:', error);
  } finally {
    setLoading(false);
  }
};
