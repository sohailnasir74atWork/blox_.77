import React, { useCallback, useMemo, useEffect } from 'react';
import { TouchableOpacity, View, Text, Image } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import HomeScreen from '../Homescreen/HomeScreen';
import HomeTabScreen from '../HomeTab/HomeTabScreen';
import ValueScreen from '../ValuesScreen/ValueScreen';
import { ChatStack } from '../ChatScreen/ChatNavigator';
import { TradeStack } from '../Trades/TradeNavigator';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import BouncingCartIcon from './CartIcon';
import { MoreStack } from '../More/MoreNavigator';
import DesignStack from '../Design/DesignNavigation';
import ThemeHeader from '../Design/componenets/ThemeHeader';
import { useGlobalState } from '../GlobelStats';
import { checkDailyStreak } from '../ChatScreen/GroupChat/badgeUtils';
import { syncMyCosmetics } from '../Helper/cosmeticsCache';
import InterstitialAdManager from '../Ads/IntAd';
import { NATURAL_BREAK } from '../Ads/adPolicy';

// Natural-break interstitial: leaving one tab for another is the standard
// "between screens" moment. The manager applies every cap (Pro, warm-up,
// per-session ceiling, 3-minute gap since ANY full-screen ad) and never waits
// for a fill, so the switch itself is never delayed. Pressing the already
// active tab (scroll-to-top) and entering Chat are not breaks.
const tabScreenListeners = ({ navigation, route }) => ({
  tabPress: () => {
    if (navigation.isFocused()) return;
    if (NATURAL_BREAK.EXCLUDED_TABS.includes(route.name)) return;
    InterstitialAdManager.showAtNaturalBreak(`tab:${route.name}`);
  },
});
const Tab = createBottomTabNavigator();

// Glossy tab images from scripts/app-icons/make-icons.mjs: colour when
// selected, soft grey otherwise. Routes without an image keep the font icon.
const TAB_IMAGES = {
  HomeTab: [require('../../assets/tab-icons/home.png'), require('../../assets/tab-icons/home-off.png')],
  Calculator: [require('../../assets/tab-icons/calculator.png'), require('../../assets/tab-icons/calculator-off.png')],
  Trade: [require('../../assets/tab-icons/trade.png'), require('../../assets/tab-icons/trade-off.png')],
  Designs: [require('../../assets/tab-icons/feed.png'), require('../../assets/tab-icons/feed-off.png')],
  Chat: [require('../../assets/tab-icons/chat.png'), require('../../assets/tab-icons/chat-off.png')],
  More: [require('../../assets/tab-icons/more.png'), require('../../assets/tab-icons/more-off.png')],
};
const TAB_IMAGE_STYLE = { width: 24, height: 24 };
const TAB_IMAGE_STYLE_FOCUSED = { width: 24, height: 24, transform: [{ scale: 1.08 }] };

const AnimatedTabIcon = React.memo(({ routeName, iconName, color, size, focused }) => {
  const images = TAB_IMAGES[routeName];
  if (images) {
    return (
      <Image resizeMethod="resize"
        source={focused ? images[0] : images[1]}
        style={focused ? TAB_IMAGE_STYLE_FOCUSED : TAB_IMAGE_STYLE}
        resizeMode="contain"
      />
    );
  }
  return (
    <FontAwesome
      name={iconName}
      size={size}
      color={color}
      solid={focused}
    />
  );
});


const MainTabs = React.memo(({ selectedTheme, chatFocused, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo }) => {
  const { t } = useTranslation();
  const { user, appdatabase } = useGlobalState();

  // 🔥 Daily login streak check (fire-and-forget)
  useEffect(() => {
    if (user?.id && appdatabase) {
      checkDailyStreak(appdatabase, user.id);
      syncMyCosmetics(appdatabase, user.id, true); // ✅ Sync cosmetics on app start
    }
  }, [user?.id, appdatabase]);

  const getTabIcon = useCallback((routeName, focused) => {

    const icons = {
      HomeTab: ['house', 'house'],
      Calculator: ['calculator', 'calculator'],
      Trade: ['handshake', 'handshake'],
      Chat: ['envelope', 'envelope'],
      Values: ['angles-right', 'angles-right'],
      Designs: ['chart-simple', 'chart-simple'],
      More: ['table-cells-large', 'table-cells-large'],
    };

    return icons[routeName] ? (focused ? icons[routeName][0] : icons[routeName][1]) : 'alert-circle-outline';
  }, []);

  // Memoize screen render functions to prevent unnecessary re-renders
  const renderHomeTabScreen = useCallback(() => (
    <HomeTabScreen selectedTheme={selectedTheme} />
  ), [selectedTheme]);

  const renderHomeScreen = useCallback(() => (
    <HomeScreen selectedTheme={selectedTheme} />
  ), [selectedTheme]);

  // More tab (replaced the Stock tab, owner decision 2026-10-08): the card hub
  // with its own stack, so Stock, Codes and the rest open inside the tab.
  const renderMoreStack = useCallback(() => (
    <MoreStack selectedTheme={selectedTheme} inTab />
  ), [selectedTheme]);

  const renderTradeStack = useCallback(() => (
    <TradeStack
      selectedTheme={selectedTheme}
      setChatFocused={setChatFocused}
      modalVisibleChatinfo={modalVisibleChatinfo}
      setModalVisibleChatinfo={setModalVisibleChatinfo}
    />
  ), [selectedTheme, modalVisibleChatinfo]);

  const renderDesignStack = useCallback(() => (
    <DesignStack selectedTheme={selectedTheme} />
  ), [selectedTheme]);

  const renderChatStack = useCallback(() => (
    <ChatStack
      selectedTheme={selectedTheme}
      setChatFocused={setChatFocused}
      modalVisibleChatinfo={modalVisibleChatinfo}
      setModalVisibleChatinfo={setModalVisibleChatinfo}
    />
  ), [selectedTheme, modalVisibleChatinfo]);


  // Memoize screenOptions to prevent recreation on every render
  const screenOptions = useCallback(({ route }) => ({
    tabBarIcon: ({ focused, color, size }) => (
      <AnimatedTabIcon
        focused={focused}
        routeName={route.name}
        iconName={getTabIcon(route.name)}
        color={focused ? config.colors.secondary : selectedTheme.colors.text}
        size={14}
      />
    ),
    tabBarButton: (props) => {
      const { children, onPress } = props;
      const isSelected = props?.['aria-selected'];

      return (
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.9}
          style={{
            flex: 1,
            backgroundColor: isSelected ? config.colors.primary + '42' : 'transparent',
            borderRadius: 12,
            marginHorizontal: 4,
            marginVertical: 2,
            justifyContent: 'center',
            alignItems: 'center'
          }}
        >
          {children}
        </TouchableOpacity>
      );
    },
    tabBarStyle: {
      // height: 50,
      backgroundColor: selectedTheme.colors.background,
    },
    tabBarLabelStyle: {
      fontSize: 9, // 👈 Your custom label font size
      fontWeight: 'bold', // Optional: Custom font family
    },
    tabBarActiveTintColor: config.colors.secondary,
    tabBarInactiveTintColor: selectedTheme.colors.text,
    headerStyle: {
      backgroundColor: selectedTheme.colors.background,
    },
    headerTintColor: selectedTheme.colors.text,
    headerTitleStyle: { fontWeight: 'bold', fontSize: 24 },
  }), [selectedTheme, getTabIcon]);

  // Memoize Calculator tab options
  const calculatorOptions = useCallback(() => ({
    title: t('tabs.calculator', { defaultValue: 'Calculator' }),
    header: () => (
      <ThemeHeader 
        title={t('tabs.calculator', { defaultValue: 'Calculator' })} 
      />
    ),
  }), [t]);

  return (
    <Tab.Navigator screenOptions={screenOptions} screenListeners={tabScreenListeners}>
      <Tab.Screen
        name="HomeTab"
        options={{
          title: t('tabs.home', { defaultValue: 'Home' }),
          headerShown: false,
        }}
      >
        {renderHomeTabScreen}
      </Tab.Screen>

      <Tab.Screen
        name="Calculator"
        options={calculatorOptions}
      >
        {renderHomeScreen}
      </Tab.Screen>

      <Tab.Screen
        name="Trade"
        options={{
          headerShown: false,
          title: t('tabs.trade'), // Translation applied here
        }}
      >
        {renderTradeStack}
      </Tab.Screen>
      <Tab.Screen
        name="Designs"
        options={{
          title: t('app.main_tabs.feed'), // Translation applied here
          headerShown: false
        }}
      >
        {renderDesignStack}
      </Tab.Screen>

      <Tab.Screen
        name="Chat"
        options={({ route }) => ({
          headerShown: false,
          // The Mod Panel is a full-screen tool: give it the tab bar's space.
          ...(getFocusedRouteNameFromRoute(route) === 'AdminDashboard'
            ? { tabBarStyle: { display: 'none' } }
            : null),
          title: t('tabs.chat'), // Translation applied here
          tabBarBadge: chatFocused ? "" : null,
          tabBarBadgeStyle: {
            maxWidth: 4,
            height: 8,
            borderRadius: 4,
            fontSize: 10,
            // backgroundColor: 'red',
            color: 'white',
          },
        })}
      >
        {renderChatStack}
      </Tab.Screen>

      <Tab.Screen
        name="More"
        options={{
          headerShown: false,
          title: t('tabs.more', { defaultValue: 'More' }),
        }}
      >
        {renderMoreStack}
      </Tab.Screen>

    </Tab.Navigator>
  );
});

export default MainTabs;
