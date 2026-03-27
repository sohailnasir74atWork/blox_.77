// themes.js
import { DefaultTheme, DarkTheme } from '@react-navigation/native';
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
    background: '#0f172a',
    text: 'white',
    primary: '#BB86FC',
  },
};



// reviewHelper.js

export const requestReview = () => {
  if (InAppReview.isAvailable()) {
    InAppReview.RequestInAppReview()
      .then(() => {/* console.log('In-App review flow completed') */ })
      .catch((error) => {/* console.error('In-App review error:', error) */ });
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
