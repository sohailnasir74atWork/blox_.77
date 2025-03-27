import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  StatusBar,
  SafeAreaView,
  Animated,
  ActivityIndicator,
  AppState,
  TouchableOpacity,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from './Code/SettingScreen/Setting';
import {  useGlobalState } from './Code/GlobelStats';
import {  useLocalState } from './Code/LocalGlobelStats';
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

const Stack = createNativeStackNavigator();
const adUnitId = getAdUnitId('openapp');

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
    AppOpenAdManager.init();

    const unsubscribe = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !localState?.isPro) {
        AppOpenAdManager.showAd(); // Show on app foreground
      }
    });

    return () => {
      unsubscribe.remove();
      AppOpenAdManager.cleanup();
    };
  }, []);



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

  // Handle Consent
  useEffect(() => {
    handleUserConsent();
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

  return <App />;
}