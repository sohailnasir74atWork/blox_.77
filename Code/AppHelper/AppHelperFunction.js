// themes.js
import { DefaultTheme, DarkTheme } from '@react-navigation/native';
import { AppOpenAd, AdEventType } from 'react-native-google-mobile-ads';
import InAppReview from 'react-native-in-app-review';
import { AdsConsent, AdsConsentStatus } from 'react-native-google-mobile-ads';
import { getDatabase } from '@react-native-firebase/database';
import DeviceInfo from 'react-native-device-info';
import { Alert } from 'react-native';
import { Platform } from 'react-native';


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


export const checkForUpdate = async (updateLocalState, updateCount, lastVersion) => {
  try {
    const versionPath = `appVersions/${Platform.OS}`;
    const snapshot = await getDatabase().ref(versionPath).once("value");

    if (snapshot.exists()) {
      const latestVersion = snapshot.val();
      const currentVersion = DeviceInfo.getVersion();

      if (latestVersion !== currentVersion) {
        if (lastVersion !== latestVersion) {
          updateLocalState("updateCount", 0); // Reset count
          updateLocalState("lastVersion", latestVersion);
        }

        if (updateCount < 2) {
          showUpdateAlert();
          updateLocalState("updateCount", updateCount + 1);
        }
      }
    }
  } catch (error) {
    console.error("Error checking for updates:", error);
  }
};

// Function to Show Update Alert
const showUpdateAlert = () => {
  Alert.alert(
    "🚀 Update Available!",
    "A new version is available! Update now for the best experience. 🌟",
    [
      { text: "Remind Me Later", style: "cancel" },
      { text: "Update Now 🚀", onPress: openStore },
    ],
    { cancelable: false }
  );
};

// Function to Open App Store
const openStore = () => {
  const storeUrl =
    Platform.OS === "ios"
      ? "https://apps.apple.com/us/app/app-name/id6737775801"
      : `https://play.google.com/store/apps/details?id=${DeviceInfo.getBundleId()}`;

  Linking.openURL(storeUrl).catch((err) =>
    console.error("Failed to open store:", err)
  );
};
