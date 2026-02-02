import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from './Code/SettingScreen/Setting';
import { useGlobalState } from './Code/GlobelStats';
import { useLocalState } from './Code/LocalGlobelStats';
import { AdsConsent, AdsConsentStatus, MobileAds } from 'react-native-google-mobile-ads';
import MainTabs from './Code/AppHelper/MainTabs';
import Icon from 'react-native-vector-icons/Ionicons';
import {
  MyDarkTheme,
  MyLightTheme,
  requestReview,
} from './Code/AppHelper/AppHelperFunction';
import OnboardingScreen from './Code/AppHelper/OnBoardingScreen';
import { useTranslation } from 'react-i18next';
import RewardRulesModal from './Code/SettingScreen/RewardRulesModel';
import InterstitialAdManager from './Code/Ads/IntAd';
import AppOpenAdManager from './Code/Ads/openApp';
import RNBootSplash from "react-native-bootsplash";
import SystemNavigationBar from 'react-native-system-navigation-bar';
import AdminUnbanScreen from './Code/AppHelper/AdminDashboard';
import { checkForUpdate } from './Code/AppHelper/InAppUpdateCheck';
import SubscriptionScreen from './Code/SettingScreen/OfferWall';



const Stack = createNativeStackNavigator();
const setNavigationBarAppearance = (theme) => {
  if (theme === 'dark') {
    SystemNavigationBar.setNavigationColor('#000000', 'light', 'navigation');
  } else {
    SystemNavigationBar.setNavigationColor('#FFFFFF', 'dark', 'navigation');
  }
};

// const adUnitId = getAdUnitId('openapp');

function App() {
  const { theme, single_offer_wall } = useGlobalState();
  const { t } = useTranslation();
  const { localState, updateLocalState } = useLocalState();

  const [chatFocused, setChatFocused] = useState(true);
  const [modalVisibleChatinfo, setModalVisibleChatinfo] = useState(false)
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [showofferwall, setShowofferwall] = useState(false);

  // ✅ Fixed: Use ref to prevent infinite loop when updating warnedAboutTheme
  const warnedAboutThemeRef = React.useRef(false);
  const selectedTheme = useMemo(() => {
    if (!theme && !warnedAboutThemeRef.current && !localState?.warnedAboutTheme) {
      warnedAboutThemeRef.current = true;
      updateLocalState('warnedAboutTheme', true);
    }
    return theme === 'dark' ? MyDarkTheme : MyLightTheme;
  }, [theme, localState?.warnedAboutTheme]); // ✅ Removed updateLocalState from deps


  useEffect(() => {
    InterstitialAdManager.init();
    checkForUpdate()
    // initAds()
  }, []);



  useEffect(() => {
    const listener = Appearance.addChangeListener(({ colorScheme }) => {
      if (theme === 'system') {
        setNavigationBarAppearance(colorScheme);
      }
    });

    return () => listener.remove();
  }, [theme]);


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



  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1E88E5" />
      </View>
    );
  }




  // ✅ Fixed: Use ref to track if reviewCount was updated to prevent infinite loop
  const reviewCountUpdatedRef = React.useRef(false);
  useEffect(() => {
    // ✅ Only update reviewCount once on mount, not on every reviewCount change
    if (!reviewCountUpdatedRef.current) {
      const { reviewCount } = localState || {};
      if (reviewCount !== undefined) {
        reviewCountUpdatedRef.current = true;
        updateLocalState('reviewCount', Number(reviewCount) + 1);
      }
    }
  }, []); // ✅ Empty deps - only run once on mount

  // ✅ Separate useEffect for review request - only runs when reviewCount changes
  useEffect(() => {
    const { reviewCount } = localState || {};
    if (reviewCount && reviewCount % 6 === 0 && reviewCount > 0) {
      try {
        requestReview();
      } catch (error) {
        // ✅ Silently handle errors to prevent crashes
      }
    }
    // if (reviewCount && reviewCount % 15 === 0 && reviewCount > 0) {
    //   setShowofferwall(true);
    // }
  }, [localState?.reviewCount]); // ✅ Only depend on reviewCount, not updateLocalState

  // ✅ Memoize saveConsentStatus to prevent recreation - use ref to avoid dependency
  const updateLocalStateRef = React.useRef(updateLocalState);
  React.useEffect(() => {
    updateLocalStateRef.current = updateLocalState;
  }, [updateLocalState]);

  const saveConsentStatus = useCallback((status) => {
    updateLocalStateRef.current('consentStatus', status);
  }, []); // ✅ Empty deps - uses ref instead

  const handleUserConsent = useCallback(async () => {
    try {
      const consentInfo = await AdsConsent.requestInfoUpdate();
      await MobileAds().initialize();
      // await MobileAds().openAdInspector();

      if (
        consentInfo.status === AdsConsentStatus.OBTAINED ||
        consentInfo.status === AdsConsentStatus.NOT_REQUIRED
      ) {
        saveConsentStatus(consentInfo.status);
        return;
      }

      if (consentInfo.isConsentFormAvailable && consentInfo.isRequestLocationInEeaOrUnknown) {
        const formResult = await AdsConsent.showForm();
        saveConsentStatus(formResult.status);
      }
    } catch (error) {
      // Silently handle consent errors
    }
  }, [saveConsentStatus]);

  // Handle Consent
  useEffect(() => {
    handleUserConsent();
  }, [handleUserConsent]);

  // Memoize screen render functions to prevent unnecessary re-renders
  const renderMainTabs = useCallback(() => (
    <MainTabs
      selectedTheme={selectedTheme}
      setChatFocused={setChatFocused}
      chatFocused={chatFocused}
      setModalVisibleChatinfo={setModalVisibleChatinfo}
      modalVisibleChatinfo={modalVisibleChatinfo}
    />
  ), [selectedTheme, chatFocused, modalVisibleChatinfo]);

  const renderAdminScreen = useCallback(() => (
    <AdminUnbanScreen selectedTheme={selectedTheme} />
  ), [selectedTheme]);

  const renderSettingsScreen = useCallback(() => (
    <SettingsScreen selectedTheme={selectedTheme} />
  ), [selectedTheme]);

  const handleCloseModal = useCallback(() => {
    setModalVisible(false);
  }, []);

  const handleCloseOfferWall = useCallback(() => {
    setShowofferwall(false);
  }, []);

  const handleInfoPress = useCallback(() => {
    setModalVisible(true);
  }, []);

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
              {renderMainTabs}
            </Stack.Screen>


            <Stack.Screen
              name="Admin"
              options={{
                title: "Admin Dashboard",
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
                headerRight: () => (
                  <TouchableOpacity onPress={handleInfoPress} style={{ marginRight: 16 }}>
                    <Icon name="information-circle-outline" size={24} color={selectedTheme.colors.text} />
                  </TouchableOpacity>
                ),
              }}
            >
              {renderAdminScreen}
            </Stack.Screen>

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

            {/* Move this outside of <Stack.Navigator> */}


            <Stack.Screen
              name="Setting"
              options={{
                title: t('tabs.settings'),
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
              }}
            >
              {renderSettingsScreen}
            </Stack.Screen>

          </Stack.Navigator>
          {/* <AppUpdateChecker /> */}
        </NavigationContainer>
        {modalVisible && (
          <RewardRulesModal visible={modalVisible} onClose={handleCloseModal} selectedTheme={selectedTheme} />
        )}
        <SubscriptionScreen visible={showofferwall} onClose={handleCloseOfferWall} track='Home' showoffer={!single_offer_wall} oneWallOnly={single_offer_wall} />
      </Animated.View>
    </SafeAreaView>
  );
}

export default function AppWrapper() {
  const { localState, updateLocalState } = useLocalState();
  const { theme, proGranted } = useGlobalState();

  useEffect(() => {
    if (localState.isAppReady) {
      InteractionManager.runAfterInteractions(() => {
        RNBootSplash.hide({ fade: true });
      });
    }
  }, [localState.isAppReady]);

  // ✅ Fixed: Add proper cleanup for AppOpenAdManager to prevent memory leaks
  useEffect(() => {
    if (!localState.showOnBoardingScreen && !localState.isPro) {
      AppOpenAdManager.initAndShow();
    }

    // ✅ Cleanup on unmount or when dependencies change
    return () => {
      // Only cleanup if component is unmounting, not on dependency changes
      // AppOpenAdManager.cleanup(); // Uncomment if you want to cleanup on dependency changes
    };
  }, [localState.showOnBoardingScreen, localState.isPro]);

  // ✅ Add cleanup on component unmount
  useEffect(() => {
    return () => {
      AppOpenAdManager.cleanup();
    };
  }, []);

  const selectedTheme = useMemo(() => {
    if (!theme) {
      // console.warn("⚠️ Theme not found! Falling back to Light Theme.");
    }
    return theme === 'dark' ? MyDarkTheme : MyLightTheme;
  }, [theme]);

  // ✅ Memoize handleSplashFinish to prevent recreation - use ref to avoid dependency
  const updateLocalStateRef = React.useRef(updateLocalState);
  React.useEffect(() => {
    updateLocalStateRef.current = updateLocalState;
  }, [updateLocalState]);

  const handleSplashFinish = useCallback(() => {
    updateLocalStateRef.current('showOnBoardingScreen', false);
  }, []); // ✅ Empty deps - uses ref instead

  if (localState.showOnBoardingScreen) {
    return <OnboardingScreen onFinish={handleSplashFinish} selectedTheme={selectedTheme} />;
  }

  return <App />;
}