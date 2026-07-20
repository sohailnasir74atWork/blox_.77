import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  StatusBar,
  Animated,
  ActivityIndicator,
  TouchableOpacity,
  Appearance,
  Platform,

} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from './Code/SettingScreen/Setting';
import { useGlobalState } from './Code/GlobelStats';
import { useLocalState } from './Code/LocalGlobelStats';
import { AdsConsent, AdsConsentStatus } from 'react-native-google-mobile-ads';
import { requestTrackingPermission, getTrackingStatus } from 'react-native-tracking-transparency';
import AttPrimer from './Code/AppHelper/AttPrimer';
import { ensureAdsInitialized } from './Code/Ads/init';
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
// AppOpenAdManager is lazy-required inside requestIdleCallback (below) so the
// ad manager stays off the critical startup path — matches adoptme-jan7.
import RNBootSplash from "react-native-bootsplash";
import SystemNavigationBar from 'react-native-system-navigation-bar';
import AdminUnbanScreen from './Code/AppHelper/AdminDashboard';
import SocialDashboard from './Code/AppHelper/SocialDashboard';
import CustomTopTabs from './Code/ValuesScreen/TopTabs';
import LeaderboardScreen from './Code/ChatScreen/GroupChat/LeaderboardScreen';
import PrivateChatScreen from './Code/ChatScreen/PrivateChat/PrivateChat';
import PrivateChatHeader from './Code/ChatScreen/PrivateChat/PrivateChatHeader';
import { checkForUpdate } from './Code/AppHelper/InAppUpdateCheck';
import SubscriptionScreen from './Code/SettingScreen/OfferWall';
import AnalyticsScreen from './Code/Analytics/AnalyticsScreen';
import TradeJournal from './Code/Engagement/TradeJournal';
import MyCosmeticsScreen from './Code/Engagement/MyCosmeticsScreen';
import MysteryEggScreen from './Code/Engagement/MysteryEgg';
import FruitCrashScreen from './Code/Engagement/FruitCrash';
import GameHubScreen from './Code/Engagement/GameHub';
import GameScreen from './Code/Engagement/GameScreen';
import BadgesScreen from './Code/SettingScreen/BadgesScreen';
import GuidesScreen from './Code/SettingScreen/GuidesScreen';
import NotificationFeed from './Code/Engagement/NotificationFeed';
import ModsScreen from './Code/Engagement/ModsScreen';

// Wrapper for MyStuffScreen — feeds global state into TradeJournal
const MyStuffScreenWrapper = () => {
  const { firestoreDB, appdatabase, user, theme } = useGlobalState();
  return (
    <TradeJournal
      firestoreDB={firestoreDB}
      db={appdatabase}
      uid={user?.id}
      isDarkMode={theme === 'dark'}
    />
  );
};

// Wrapper for PrivateChat used from root stack (SocialDashboard → Chat)
const PrivateChatRootWrapper = (props) => {
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, paddingBottom: insets.bottom }}>
      <PrivateChatScreen
        {...props}
        bannedUsers={[]}
        isDrawerVisible={isDrawerVisible}
        setIsDrawerVisible={setIsDrawerVisible}
        noTabBar={true}
      />
    </View>
  );
};



const Stack = createNativeStackNavigator();
const setNavigationBarAppearance = (theme) => {
  if (theme === 'dark') {
    SystemNavigationBar.setNavigationColor('#000000', 'light', 'navigation');
  } else {
    SystemNavigationBar.setNavigationColor('#FFFFFF', 'dark', 'navigation');
  }
};

// const adUnitId = getAdUnitId('openapp');

// Module-level singleton for the ATT request. Native lib (0.1.2) can resolve
// its promise twice if the system dialog is interrupted by a scene transition;
// caching the in-flight promise + short-circuiting on already-determined
// statuses ensures requestTrackingPermission is reached at most once per
// app session, even if the caller is invoked multiple times.
let _attPromise = null;
async function ensureAttRequested(beforePrompt) {
  if (_attPromise) return _attPromise;
  _attPromise = (async () => {
    try {
      const status = await getTrackingStatus().catch(() => 'unavailable');
      if (status !== 'not-determined') return status;
      // First launch only: show our own priming screen explaining WHY we
      // ask before triggering Apple's one-shot system dialog. A higher
      // opt-in rate here directly lifts iOS eCPM (IDFA → personalised ads +
      // clean SKAdNetwork attribution). The primer is informational only,
      // so a failure/skip must never block the real prompt — hence the
      // swallow. beforePrompt resolves when the user taps "Continue".
      if (typeof beforePrompt === 'function') {
        try { await beforePrompt(); } catch {}
      }
      return await requestTrackingPermission();
    } catch {
      return 'unavailable';
    }
  })();
  return _attPromise;
}

function App() {
  const { theme, single_offer_wall } = useGlobalState();
  const { t } = useTranslation();
  const { localState, updateLocalState } = useLocalState();

  const [chatFocused, setChatFocused] = useState(true);
  const [modalVisibleChatinfo, setModalVisibleChatinfo] = useState(false)
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [showofferwall, setShowofferwall] = useState(false);
  // ATT priming pre-prompt (iOS). The resolver ref lets the async consent
  // flow await the user tapping "Continue" before Apple's system dialog fires.
  const [attPrimerVisible, setAttPrimerVisible] = useState(false);
  const attPrimerResolveRef = React.useRef(null);

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
    if (theme === 'dark') {
      setNavigationBarAppearance('dark');
    } else if (theme === 'light') {
      setNavigationBarAppearance('light');
    } else if (theme === 'system') {
      setNavigationBarAppearance(Appearance.getColorScheme());
    }

    const listener = Appearance.addChangeListener(({ colorScheme }) => {
      if (theme === 'system') {
        setNavigationBarAppearance(colorScheme);
      }
    });

    return () => listener.remove();
  }, [theme]);


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

  // Shows the ATT primer and resolves once the user taps "Continue", so the
  // consent flow can then trigger Apple's real tracking dialog.
  const showAttPrimer = useCallback(
    () => new Promise((resolve) => {
      attPrimerResolveRef.current = resolve;
      setAttPrimerVisible(true);
    }),
    [],
  );
  const handleAttPrimerContinue = useCallback(() => {
    setAttPrimerVisible(false);
    const resolve = attPrimerResolveRef.current;
    attPrimerResolveRef.current = null;
    if (resolve) resolve();
  }, []);

  const handleUserConsent = useCallback(async () => {
    try {
      // Request ATT once per app session (iOS). Guarded inside
      // ensureAttRequested: skips if already determined, and shares an
      // in-flight promise so the library's known double-resolve bug (when the
      // system dialog is interrupted by a scene transition) can't fire twice.
      if (Platform.OS === 'ios') {
        await ensureAttRequested(showAttPrimer);
      }

      const consentInfo = await AdsConsent.requestInfoUpdate();

      // Config-before-init: setRequestConfiguration (maxAdContentRating 'T',
      // child-treatment flag) THEN initialize(), via the single shared promise
      // every ad manager also awaits. Previously this was a bare
      // MobileAds().initialize() with no config, so the first (highest-value)
      // impressions served at AdMob's default 'G' ceiling and lower eCPM.
      await ensureAdsInitialized();
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
  }, [saveConsentStatus, showAttPrimer]);

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
    <View style={{ flex: 1 }}>
      <Animated.View style={{ flex: 1 }}>
        <NavigationContainer theme={selectedTheme}>
          {/* Edge-to-edge: backgroundColor/translucent are ignored by the OS here, and
              forcing them conflicted with the window on some older devices (whole-screen
              shift / wrong header inset). Only barStyle (icon color) is set; all spacing
              comes from useSafeAreaInsets on each screen. */}
          <StatusBar
            barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
          />

          <Stack.Navigator screenOptions={{ animation: 'fade', animationDuration: 200 }}>
            <Stack.Screen name="Home" options={{ headerShown: false }}>
              {renderMainTabs}
            </Stack.Screen>

            <Stack.Screen name="FruitValuesStack" options={{
              headerShown: false,
              animation: 'fade',
              animationDuration: 250,
            }}>
              {() => <CustomTopTabs selectedTheme={selectedTheme} />}
            </Stack.Screen>

            <Stack.Screen name="LeaderboardStack" options={{ headerShown: false }}>
              {() => <LeaderboardScreen selectedTheme={selectedTheme} />}
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
              name="Analytics"
              options={{
                title: 'Market Analytics',
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
                headerTitleStyle: { fontWeight: 'bold' },
              }}
            >
              {() => <AnalyticsScreen />}
            </Stack.Screen>

            <Stack.Screen
              name="SocialDashboardScreen"
              options={{
                title: 'Friends',
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
                headerTitleStyle: { fontWeight: 'bold' },
              }}
              component={SocialDashboard}
            />

            <Stack.Screen
              name="PrivateChatRoot"
              options={({ route }) => ({
                headerTitle: route.params?.selectedUser ? () => (
                  <PrivateChatHeader
                    selectedUser={route.params?.selectedUser}
                    selectedTheme={selectedTheme}
                    bannedUsers={[]}
                    isDrawerVisible={route.params?._drawerVisible || false}
                    setIsDrawerVisible={(v) => {}}
                  />
                ) : '',
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
                headerTitleStyle: { fontWeight: 'bold' },
              })}
            >
              {(props) => <PrivateChatRootWrapper {...props} />}
            </Stack.Screen>

            <Stack.Screen
              name="MyStuffScreen"
              options={{
                headerShown: false,
                animation: 'fade',
              }}
              component={MyStuffScreenWrapper}
            />

            <Stack.Screen
              name="CosmeticsScreen"
              options={{ headerShown: false, animation: 'fade' }}
              component={MyCosmeticsScreen}
            />

            <Stack.Screen
              name="MysteryEggScreen"
              options={{ headerShown: false, animation: 'fade' }}
              component={MysteryEggScreen}
            />

            <Stack.Screen
              name="FruitCrashScreen"
              options={{ headerShown: false, animation: 'fade' }}
              component={FruitCrashScreen}
            />

            <Stack.Screen
              name="GameHubScreen"
              options={{ headerShown: false, animation: 'fade' }}
              component={GameHubScreen}
            />

            <Stack.Screen
              name="GameScreen"
              options={{ headerShown: false, animation: 'fade' }}
              component={GameScreen}
            />

            <Stack.Screen
              name="BadgesScreen"
              options={{ headerShown: false, animation: 'fade' }}
              component={BadgesScreen}
            />

            <Stack.Screen
              name="GuidesScreen"
              options={{ headerShown: false, animation: 'fade' }}
              component={GuidesScreen}
            />

            <Stack.Screen
              name="NotificationFeedScreen"
              options={{ headerShown: false, animation: 'fade' }}
              component={NotificationFeed}
            />

            <Stack.Screen
              name="ModsScreen"
              options={{ headerShown: false, animation: 'fade' }}
              component={ModsScreen}
            />

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
        {/* ATT priming pre-prompt (iOS) — shown once before Apple's system
            tracking dialog to lift opt-in, which lifts iOS eCPM. */}
        <AttPrimer
          visible={attPrimerVisible}
          onContinue={handleAttPrimerContinue}
          isDarkMode={theme === 'dark'}
        />
      </Animated.View>
    </View>
  );
}

export default function AppWrapper() {
  const { localState, updateLocalState } = useLocalState();
  const { theme, proGranted } = useGlobalState();

  useEffect(() => {
    if (localState.isAppReady) {
      requestIdleCallback(() => {
        RNBootSplash.hide({ fade: true });
      });
    }
  }, [localState.isAppReady]);

  // App Open ad lifecycle. start() registers the AppState listener so the ad
  // shows on every genuine background→foreground return (frequency-capped,
  // Pro-gated via MMKV, de-duped against other full-screen ads), not just once
  // per app lifetime. start() is idempotent; the manager re-checks isPro at
  // show time so a mid-session purchase still suppresses the ad.
  //
  // Deferred to requestIdleCallback with a lazy require (adoptme pattern) so
  // loading + initialising the ad manager never competes with first paint.
  useEffect(() => {
    if (!localState.showOnBoardingScreen && !localState.isPro) {
      const id = requestIdleCallback(() => {
        try {
          const AppOpenAdManager = require('./Code/Ads/openApp').default;
          AppOpenAdManager.start();
        } catch (_) {}
      });
      return () => cancelIdleCallback(id);
    }
  }, [localState.showOnBoardingScreen, localState.isPro]);

  // ✅ Tear down the AppState listener + warm ad on unmount.
  useEffect(() => {
    return () => {
      try { require('./Code/Ads/openApp').default.stop(); } catch (_) {}
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