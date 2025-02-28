import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  StatusBar,
  SafeAreaView,
  Animated,
  ActivityIndicator,
  AppState,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from './Code/SettingScreen/Setting';
import { GlobalStateProvider, useGlobalState } from './Code/GlobelStats';
import { LocalStateProvider, useLocalState } from './Code/LocalGlobelStats';
import { MenuProvider } from 'react-native-popup-menu';
import { AdsConsent, AdsConsentStatus } from 'react-native-google-mobile-ads';
import { AppOpenAd, AdEventType } from 'react-native-google-mobile-ads';
import mobileAds from 'react-native-google-mobile-ads';
import MainTabs from './Code/AppHelper/MainTabs';
import {
  MyDarkTheme,
  MyLightTheme,
  requestReview,
} from './Code/AppHelper/AppHelperFunction';
import getAdUnitId from './Code/Ads/ads';
import OnboardingScreen from './Code/AppHelper/OnBoardingScreen';
import { useTranslation } from 'react-i18next';
import FlashMessage from 'react-native-flash-message';

const Stack = createNativeStackNavigator();
const adUnitId = getAdUnitId('openapp');


function App() {
  const { theme } = useGlobalState();
  const { t } = useTranslation();

  const selectedTheme = useMemo(() => {
    if (!theme) {
      console.warn("⚠️ Theme not found! Falling back to Light Theme.");
    }
    return theme === 'dark' ? MyDarkTheme : MyLightTheme;
  }, [theme]);
  
  const [loading, setLoading] = useState(false);
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const { localState, updateLocalState } = useLocalState();
  const [chatFocused,setChatFocused] = useState(true);
  const [modalVisibleChatinfo, setModalVisibleChatinfo ] = useState(false)
  const adCooldown = 90000; // 2 minutes in milliseconds
  const [lastAdShownTime, setLastAdShownTime] = useState(0);

  // useEffect(() => {
  //   const logCustomAppOpen = async () => {
  //     const analytics = getAnalytics();
  //     logEvent(analytics, 'custom_app_open', {
  //       platform: Platform.OS, // 'ios' or 'android'
  //       timestamp: new Date().toISOString(),
  //     });
  
  //     console.log(`Custom App Open Logged on ${analytics}`);
  //   };
  
  //   logCustomAppOpen();
  // }, []);

  useEffect(() => {
    mobileAds()
      .initialize()
      .then(adapterStatuses => {
        // console.log('AdMob initialized', adapterStatuses);
      })
      .catch(error => {
        // console.error('AdMob failed to initialize:', error);
      });
  }, []);
  useEffect(() => {

    const { reviewCount } = localState;
    if (reviewCount % 6 === 0 && reviewCount > 0) {
      requestReview();
    }

    updateLocalState('reviewCount', Number(reviewCount) + 1);
  }, []);
  useEffect(() => {
    if (localState.consentStatus === 'UNKNOWN' || localState.consentStatus === AdsConsentStatus.REQUIRED) {
      handleUserConsent();
    } else {
      // console.log('Consent status already determined:', localState.consentStatus);
    }
  }, [localState.consentStatus]);  
  const saveConsentStatus = (status) => {
    updateLocalState('consentStatus', status);
  };

  const handleUserConsent = async () => {
    try {
      const consentInfo = await AdsConsent.requestInfoUpdate();
  
      if (consentInfo.isConsentFormAvailable) {
        if (consentInfo.status === AdsConsentStatus.REQUIRED) {
          const formResult = await AdsConsent.showForm();
          saveConsentStatus(formResult.status); // Save consent status
        } else {
          saveConsentStatus(consentInfo.status); // Save existing consent status
        }
      } else {
        // console.log('Consent form is not available.');
      }
    } catch (error) {
      // console.error('Error handling consent:', error);
    }
  };
  
  
  
  // Timeout fallback to avoid infinite loader

  // Handle Consent
  useEffect(() => {
    handleUserConsent();
  }, []);
  const loadAppOpenAd = async () => {
    if (localState.isPro) {
      // console.log('Skipping ad: User is Pro');
      return;
    }
  
    const now = Date.now();
    if (now - lastAdShownTime < adCooldown) {
      // console.log(`Skipping ad: Cooldown active (${((adCooldown - (now - lastAdShownTime)) / 1000).toFixed(0)}s remaining)`);
      return;
    }
  
    // console.log('Attempting to load App Open Ad...');
  
    try {
      const appOpenAd = AppOpenAd.createForAdRequest(adUnitId, {
        requestNonPersonalizedAdsOnly: true, // Change based on consent
      });
  
      appOpenAd.addAdEventListener(AdEventType.LOADED, () => {
        // console.log('Ad Loaded! Showing Ad...');
        setIsAdLoaded(true);
        appOpenAd.show();
        setLastAdShownTime(Date.now()); // Save last shown time
        setIsAdLoaded(false);
      });
  
      appOpenAd.addAdEventListener(AdEventType.ERROR, (error) => {
        console.error('App Open Ad Error:', error);
        setIsAdLoaded(false);
      });
  
      await appOpenAd.load();
    } catch (error) {
      console.error('Error loading App Open Ad:', error);
      setIsAdLoaded(false);
    }
  };



  
  // Handle App State Changes for Ads
  useEffect(() => {
    const handleAppStateChange = (state) => {
      if (state === 'active') {
        loadAppOpenAd();
      }
    };
  
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [lastAdShownTime]); // Depend on lastAdShownTime to enforce cooldown
  

  // Loading Indicator
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1E88E5" />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: selectedTheme.colors.background }}>
      <Animated.View style={{ flex: 1 }}>
        <NavigationContainer theme={selectedTheme}>
          <StatusBar
            barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
            backgroundColor={selectedTheme.colors.background}
          />
          <Stack.Navigator>
            <Stack.Screen name="Home" options={{ headerShown: false }}>
              {() => <MainTabs selectedTheme={selectedTheme} setChatFocused={setChatFocused} chatFocused={chatFocused} setModalVisibleChatinfo={setModalVisibleChatinfo} modalVisibleChatinfo={modalVisibleChatinfo} />}
            </Stack.Screen>
            <Stack.Screen
              name="Setting"
              options={{
                title: t('tabs.settings'),
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
              }}
            >
              {() => <SettingsScreen selectedTheme={selectedTheme} />}
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
      </Animated.View>
      <FlashMessage position="top" />
    </SafeAreaView>
  );
}

export default function AppWrapper() {
  const { localState, updateLocalState } = useLocalState();
  const { theme } = useGlobalState();
  const selectedTheme = useMemo(() => {
    if (!theme) {
      console.warn("⚠️ Theme not found! Falling back to Light Theme.");
    }
    return theme === 'dark' ? MyDarkTheme : MyLightTheme;
  }, [theme]);

  const handleSplashFinish = () => {
    updateLocalState('showOnBoardingScreen', false); // ✅ Set onboarding as finished
  };

  if (localState.showOnBoardingScreen) {
    return <OnboardingScreen onFinish={handleSplashFinish} selectedTheme={selectedTheme}/>;
  }

  return <App />;
}