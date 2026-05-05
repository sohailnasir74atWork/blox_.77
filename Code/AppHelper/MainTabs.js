import React, { useCallback, useMemo, useEffect } from 'react';
import { TouchableOpacity, View, Text, Platform } from 'react-native';
import SystemNavigationBar from 'react-native-system-navigation-bar';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeScreen from '../Homescreen/HomeScreen';
import HomeTabScreen from '../HomeTab/HomeTabScreen';
import ValueScreen from '../ValuesScreen/ValueScreen';
import TimerScreen from '../StockScreen/TimerScreen';
import { ChatStack } from '../ChatScreen/ChatNavigator';
import { TradeStack } from '../Trades/TradeNavigator';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import BouncingCartIcon from './CartIcon';
import TopLevelStockComponent from '../StockScreen/StockNavigator';
import DesignStack from '../Design/DesignNavigation';
import CustomTopTabs from '../ValuesScreen/TopTabs';
import ThemeHeader from '../Design/componenets/ThemeHeader';
import { useGlobalState } from '../GlobelStats';
import { checkDailyStreak } from '../ChatScreen/GroupChat/badgeUtils';
import { syncMyCosmetics } from '../Helper/cosmeticsCache';



const Tab = createBottomTabNavigator();

const AnimatedTabIcon = React.memo(({ iconName, color, size, focused }) => {
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

  // Set Android system navigation bar color to match theme
  useEffect(() => {
    if (Platform.OS === 'android') {
      const isDark = selectedTheme.dark;
      const bg = isDark ? '#0f172a' : '#ffffff';
      SystemNavigationBar.setNavigationColor(bg, isDark ? 'light' : 'dark');
    }
  }, [selectedTheme]);

  const getTabIcon = useCallback((routeName, focused) => {

    const icons = {
      HomeTab: ['house', 'house'],
      Calculator: ['calculator', 'calculator'],
      Stock: ['cart-shopping', 'cart-shopping'],
      Trade: ['handshake', 'handshake'],
      Chat: ['envelope', 'envelope'],
      Values: ['angles-right', 'angles-right'],
      Designs: ['chart-simple', 'chart-simple'],
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

  const renderTopLevelStockComponent = useCallback(() => (
    <TopLevelStockComponent selectedTheme={selectedTheme} />
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

  const renderCustomTopTabs = useCallback(() => (
    <CustomTopTabs selectedTheme={selectedTheme} />
  ), [selectedTheme]);

  // Memoize screenOptions to prevent recreation on every render
  const screenOptions = useCallback(({ route }) => ({
    tabBarIcon: ({ focused, color, size }) => (
      <AnimatedTabIcon
        focused={focused}
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
    header: () => (
      <ThemeHeader 
        title={t('tabs.calculator', { defaultValue: 'Calculator' })} 
      />
    ),
  }), [t]);

  return (
    <Tab.Navigator screenOptions={screenOptions}>
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
        name="Stock"
        options={{
          headerShown: false,
          title: 'Stocks',
        }}
      >
        {renderTopLevelStockComponent}
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
          title: 'Feed', // Translation applied here
          headerShown: false
        }}
      >
        {renderDesignStack}
      </Tab.Screen>

      <Tab.Screen
        name="Chat"
        options={{
          headerShown: false,
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
        }}
      >
        {renderChatStack}
      </Tab.Screen>

    </Tab.Navigator>
  );
});

export default MainTabs;
