import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StatusBar,
  SafeAreaView,
  Animated,
  ActivityIndicator,
  AppState,
  TouchableOpacity,
  Appearance,
  InteractionManager,
  Platform,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from './Code/SettingScreen/Setting';
import { useGlobalState } from './Code/GlobelStats';
import { useLocalState } from './Code/LocalGlobelStats';
import { AdsConsent, AdsConsentStatus } from 'react-native-google-mobile-ads';
import MainTabs from './Code/AppHelper/MainTabs';
import Icon from 'react-native-vector-icons/Ionicons';
import { getTrackingStatus, requestTrackingPermission } from 'react-native-tracking-transparency';
import {
  MyDarkTheme,
  MyLightTheme,
  requestReview,
} from './Code/AppHelper/AppHelperFunction';
import getAdUnitId from './Code/Ads/ads';
import OnboardingScreen from './Code/AppHelper/OnBoardingScreen';
import { useTranslation } from 'react-i18next';
// import RewardCenterScreen from './Code/SettingScreen/RewardCenter';
// import RewardRulesModal from './Code/SettingScreen/RewardRulesModel';
import InterstitialAdManager from './Code/Ads/IntAd';
import AppOpenAdManager from './Code/Ads/openApp';
import RNBootSplash from "react-native-bootsplash";
import SystemNavigationBar from 'react-native-system-navigation-bar';
<<<<<<< HEAD
import AdminUnbanScreen from './Code/AppHelper/AdminDashboard.js';
import { checkForUpdate } from './Code/AppHelper/InAppUpdateChecker.js';
import config from './Code/Helper/Environment.js';
=======
import CoinStore from './Code/SettingScreen/Store/Store';
<<<<<<< HEAD
import AppUpdateChecker from './Code/AppHelper/InAppUpdateChecker';
<<<<<<< HEAD
>>>>>>> f99f5c4 (hh)
=======
import AdminUnbanScreen from './Code/AppHelper/AdminDashboard';
import { checkForUpdate } from './Code/AppHelper/InAppUpdateCheck';
>>>>>>> 7d3c677 (updated to api level 35 before)
=======
// import AppUpdateChecker from './Code/AppHelper/InAppUpdateChecker';
import AdminUnbanScreen from './Code/AppHelper/AdminDashboard';
import { checkForUpdate } from './Code/AppHelper/InAppUpdateCheck';
// import { initAds } from './Code/Ads/Adinit';
>>>>>>> 6ff4a10 (commit)



const Stack = createNativeStackNavigator();
const setNavigationBarAppearance = (theme) => {
  if (theme === 'dark') {
    SystemNavigationBar.setNavigationColor('#000000', 'light', 'navigation');
    SystemNavigationBar.setBarMode('dark');
  } else {
    SystemNavigationBar.setNavigationColor('#FFFFFF', 'dark', 'navigation');
    SystemNavigationBar.setBarMode('light');
  }
};

function App() {
  const { theme} = useGlobalState();
  const { t } = useTranslation();

  const selectedTheme = useMemo(() => {
    if (!theme && !localState.warnedAboutTheme) {
      console.warn("⚠️ Theme not found! Falling back to Light Theme.");
      updateLocalState('warnedAboutTheme', true); // Prevent future warnings
    }
    return theme === 'dark' ? MyDarkTheme : MyLightTheme;
  }, [theme]);
 
  const adShownRef = useRef(false); // useRef to persist across renders


  const { localState, updateLocalState } = useLocalState();
  const [chatFocused, setChatFocused] = useState(true);
  const [modalVisibleChatinfo, setModalVisibleChatinfo] = useState(false)
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    InterstitialAdManager.init();
    checkForUpdate()
<<<<<<< HEAD
<<<<<<< HEAD


=======
>>>>>>> 7d3c677 (updated to api level 35 before)
=======
    // initAds()
>>>>>>> 6ff4a10 (commit)
  }, []);



  useEffect(() => {
    setNavigationBarAppearance(theme); // Apply nav bar color on theme change
  }, [theme]);


<<<<<<< HEAD
  
=======
  // useEffect(() => {
  //   let isMounted = true;
  //   let unsubscribe;

  //   const initializeAds = async () => {
  //     try {
  //       await AppOpenAdManager.init();
  //     } catch (error) {
  //       console.error('❌ Error initializing ads:', error);
  //     }
  //   };

  //   const handleAppStateChange = async (state) => {
  //     if (!isMounted) return;

  //     try {
  //       if (state === 'active' && !localState?.isPro) {
  //         await AppOpenAdManager.showAd();
  //       }
  //     } catch (error) {
  //       console.error('❌ Error showing ad:', error);
  //     }
  //   };

  //   initializeAds();
  //   unsubscribe = AppState.addEventListener('change', handleAppStateChange);

  //   return () => {
  //     isMounted = false;
  //     if (unsubscribe) {
  //       unsubscribe.remove();
  //     }
  //     AppOpenAdManager.cleanup();
  //   };
  // }, [localState?.isPro]);

>>>>>>> f99f5c4 (hh)


  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1E88E5" />
      </View>
    );
  }

  useEffect(() => {
    const askPermission = async () => {
      try {
        const status = await getTrackingStatus();
        console.log('Initial tracking status:', status);
  
        if (status === 'not-determined') {
          const newStatus = await requestTrackingPermission();
          console.log('User response:', newStatus);
        }
      } catch (error) {
        console.error('Error requesting tracking permission:', error);
      }
    };
  
    askPermission();
  }, []);


  useEffect(() => {

    const { reviewCount } = localState;
    if (reviewCount % 6 === 0 && reviewCount > 0) {
      requestReview();
    }

    updateLocalState('reviewCount', Number(reviewCount) + 1);
  }, []);

  const saveConsentStatus = (status) => {
    updateLocalState('consentStatus', status);
  };

  const handleUserConsent = async () => {
    try {
      const consentInfo = await AdsConsent.requestInfoUpdate();

      if (
        consentInfo.status === AdsConsentStatus.OBTAINED ||
        consentInfo.status === AdsConsentStatus.NOT_REQUIRED
      ) {
        saveConsentStatus(consentInfo.status);
        return;
      }

      if (consentInfo.isConsentFormAvailable) {
        const formResult = await AdsConsent.showForm();
        saveConsentStatus(formResult.status);
      }
    } catch (error) {
      console.warn("Consent error:", error);
    }
  };


  // Handle Consent
  useEffect(() => {
    handleUserConsent();
  }, []);
  const navRef = useRef();



  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: selectedTheme.colors.background, }}>
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

            
<<<<<<< HEAD
<<<<<<< HEAD
            <Stack.Screen
              name="Admin"
=======
            {/* <Stack.Screen
              name="Reward"
>>>>>>> f99f5c4 (hh)
=======
            <Stack.Screen
              name="Admin"
>>>>>>> 7d3c677 (updated to api level 35 before)
              options={{
                title: "Admin Dashboard",
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
                headerRight: () => (
                  <TouchableOpacity onPress={() => setModalVisible(true)} style={{ marginRight: 16 }}>
                    <Icon name="information-circle-outline" size={24} color={selectedTheme.colors.text} />
                  </TouchableOpacity>
                ),
              }}
            >
<<<<<<< HEAD
<<<<<<< HEAD
              {() => <AdminUnbanScreen selectedTheme={selectedTheme} />}
            </Stack.Screen>
=======
              {() => <RewardCenterScreen selectedTheme={selectedTheme} />}
            </Stack.Screen> */}
=======
              {() => <AdminUnbanScreen selectedTheme={selectedTheme} />}
            </Stack.Screen>
>>>>>>> 7d3c677 (updated to api level 35 before)

            {/* <Stack.Screen
              name="Store"
              options={{
                title: "Coin Store",
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
                headerRight: () => (
                  <TouchableOpacity onPress={() => setModalVisible(true)} style={{ marginRight: 16 }}>
                    <Icon name="information-circle-outline" size={24} color={selectedTheme.colors.text} />
                  </TouchableOpacity>
                ),
              }}
            >
              {() => <CoinStore selectedTheme={selectedTheme} />}
            </Stack.Screen> */}
>>>>>>> f99f5c4 (hh)

            {/* Move this outside of <Stack.Navigator> */}


            <Stack.Screen
              name="Setting"
              options={{
                title: t('tabs.settings'),
                headerStyle: { backgroundColor: !config.isNoman ? '#192f51' : selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
              }}
            >
              {() => <SettingsScreen selectedTheme={selectedTheme} />}
            </Stack.Screen>
          </Stack.Navigator>
          {/* <AppUpdateChecker /> */}
        </NavigationContainer>
       
      </Animated.View>
    </SafeAreaView>
  );
}
export default function AppWrapper() {
  const { localState, updateLocalState } = useLocalState();
<<<<<<< HEAD
  const { theme } = useGlobalState();
  const [adReady, setAdReady] = useState(false);
  const hasShownColdStartAd = useRef(false);
  const appState = useRef(AppState.currentState);

  
  useEffect(() => {
    if (!localState.showOnBoardingScreen) 
   { AppOpenAdManager.initAndShow();}
  }, [localState.isPro]);

  // STEP 3: Hide splash
=======
  const { theme, proGranted } = useGlobalState();
  const hasShownColdStartAd = useRef(false);
  const appState = useRef(AppState.currentState);

  // useEffect(() => {
  //   if (localState.showOnBoardingScreen) return;

  //   // ✅ Android: Show cold start ad only once
  //   if (Platform.OS === 'android' && !hasShownColdStartAd.current) {
  //     AppOpenAdManager.initAndShow();
  //     hasShownColdStartAd.current = true;
  //   }

  //   // ✅ iOS: Listen for background → active transition
  //   if (Platform.OS === 'ios') {
  //     const subscription = AppState.addEventListener('change', nextAppState => {
  //       const wasBackground = appState.current === 'background';
  //       const nowActive = nextAppState === 'active';

  //       appState.current = nextAppState;

  //       if (wasBackground && nowActive && !localState.isPro) {
  //         AppOpenAdManager.initAndShow();
  //       }
  //     });

  //     return () => subscription?.remove();
  //   }

  // }, [localState.isPro]);

  // ✅ Hide splash after UI ready

  useEffect(() => {
    if (!localState.showOnBoardingScreen) 
   { (!localState.isPro && !proGranted) && AppOpenAdManager.initAndShow();}
  }, [localState.isPro, proGranted]);
>>>>>>> f99f5c4 (hh)
  useEffect(() => {
    if (localState.isAppReady) {
      InteractionManager.runAfterInteractions(() => {
        RNBootSplash.hide({ fade: true });
      });
    }
  }, [localState.isAppReady]);

  const selectedTheme = useMemo(() => {
    return theme === 'dark' ? MyDarkTheme : MyLightTheme;
  }, [theme]);

  const handleSplashFinish = () => {
    updateLocalState('showOnBoardingScreen', false);
  };

  // STEP 4: Show onboarding screen
  if (localState.showOnBoardingScreen) {
    return <OnboardingScreen onFinish={handleSplashFinish} selectedTheme={selectedTheme} />;
  }

<<<<<<< HEAD

  return <App />;
}
=======
  return <App />;
}
>>>>>>> f99f5c4 (hh)
