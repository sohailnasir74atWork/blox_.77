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
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from './Code/SettingScreen/Setting';
import { useGlobalState } from './Code/GlobelStats';
import { useLocalState } from './Code/LocalGlobelStats';
import { AdsConsent, AdsConsentStatus } from 'react-native-google-mobile-ads';
import MainTabs from './Code/AppHelper/MainTabs';
import Icon from 'react-native-vector-icons/Ionicons';
import {
  MyDarkTheme,
  MyLightTheme,
  requestReview,
} from './Code/AppHelper/AppHelperFunction';
import getAdUnitId from './Code/Ads/ads';
import OnboardingScreen from './Code/AppHelper/OnBoardingScreen';
import { useTranslation } from 'react-i18next';
import RewardCenterScreen from './Code/SettingScreen/RewardCenter';
import RewardRulesModal from './Code/SettingScreen/RewardRulesModel';
import InterstitialAdManager from './Code/Ads/IntAd';
import AppOpenAdManager from './Code/Ads/openApp';
import RNBootSplash from "react-native-bootsplash";
import SystemNavigationBar from 'react-native-system-navigation-bar';



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
  const { theme } = useGlobalState();
  const { t } = useTranslation();

  const selectedTheme = useMemo(() => {
    if (!theme && !localState.warnedAboutTheme) {
      console.warn("⚠️ Theme not found! Falling back to Light Theme.");
      updateLocalState('warnedAboutTheme', true); // Prevent future warnings
    }
    return theme === 'dark' ? MyDarkTheme : MyLightTheme;
  }, [theme]);


  const { localState, updateLocalState } = useLocalState();
  const [chatFocused, setChatFocused] = useState(true);
  const [modalVisibleChatinfo, setModalVisibleChatinfo] = useState(false)
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    InterstitialAdManager.init();
  }, []);



  useEffect(() => {
    const listener = Appearance.addChangeListener(({ colorScheme }) => {
      if (theme === 'system') {
        setNavigationBarAppearance(colorScheme);
      }
    });

    return () => listener.remove();
  }, [theme]);


  useEffect(() => {
    let isMounted = true;
    let unsubscribe;

    const initializeAds = async () => {
      try {
        await AppOpenAdManager.init();
      } catch (error) {
        console.error('❌ Error initializing ads:', error);
      }
    };

    const handleAppStateChange = async (state) => {
      if (!isMounted) return;

      try {
        if (state === 'active' && !localState?.isPro) {
          await AppOpenAdManager.showAd();
        }
      } catch (error) {
        console.error('❌ Error showing ad:', error);
      }
    };

    initializeAds();
    unsubscribe = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      isMounted = false;
      if (unsubscribe) {
        unsubscribe.remove();
      }
      AppOpenAdManager.cleanup();
    };
  }, [localState?.isPro]);



  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1E88E5" />
      </View>
    );
  }




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
            <Stack.Screen
              name="Reward"
              options={{
                title: "Reward Center",
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
                headerRight: () => (
                  <TouchableOpacity onPress={() => setModalVisible(true)} style={{ marginRight: 16 }}>
                    <Icon name="information-circle-outline" size={24} color={selectedTheme.colors.text} />
                  </TouchableOpacity>
                ),
              }}
            >
              {() => <RewardCenterScreen selectedTheme={selectedTheme} />}
            </Stack.Screen>

            {/* Move this outside of <Stack.Navigator> */}


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
        {modalVisible && (
          <RewardRulesModal visible={modalVisible} onClose={() => setModalVisible(false)} selectedTheme={selectedTheme} />
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

export default function AppWrapper() {
  const { localState, updateLocalState } = useLocalState();
  const { theme } = useGlobalState();
  useEffect(() => {
    if (localState.isAppReady) {
      InteractionManager.runAfterInteractions(() => {
        RNBootSplash.hide({ fade: true });
      });
    }
  }, [localState.isAppReady]);

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
    return <OnboardingScreen onFinish={handleSplashFinish} selectedTheme={selectedTheme} />;
  }

  return <App />
}