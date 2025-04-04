import React, { useRef, useEffect, useCallback } from 'react';
import { Animated, Image, TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Ionicons';
import HomeScreen from '../Homescreen/HomeScreen';
import ValueScreen from '../ValuesScreen/ValueScreen';
import TimerScreen from '../StockScreen/TimerScreen';
import { ChatStack } from '../ChatScreen/ChatNavigator';
import { TradeStack } from '../Trades/TradeNavigator';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useNavigationState } from '@react-navigation/native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';


const Tab = createBottomTabNavigator();

const AnimatedTabIcon = React.memo(({ focused, iconName, color, size }) => {
  const scaleValue = useRef(new Animated.Value(1)).current;
  
  
  useEffect(() => {
    Animated.spring(scaleValue, {
      toValue: focused ? 1.2 : 1,
      friction: 3,
      useNativeDriver: true,
    }).start();
  }, [focused]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleValue }] }}>
      <Icon name={iconName} size={size} color={color} />
    </Animated.View>
  );
});

const MainTabs = React.memo(({ selectedTheme, chatFocused, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo }) => {
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();

  const withHaptics = () => {
    triggerHapticFeedback('impactLight');
  };

  const currentRouteIndex = useNavigationState((state) => state.index);
  const previousRouteIndex = useRef(currentRouteIndex);
  const hasMounted = useRef(false); // 👈 NEW
  
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true; // 🚫 Skip first tab render
      return;
    }
  
    if (previousRouteIndex.current !== currentRouteIndex) {
      triggerHapticFeedback('impactLight'); // ✅ Trigger only on real tab switch
      previousRouteIndex.current = currentRouteIndex;
    }
  }, [currentRouteIndex, triggerHapticFeedback]);
  



  const getTabIcon = useCallback((routeName, focused) => {
    const isNoman = config.isNoman; // ✅ Extracted to avoid repeated checks

    const icons = {
      Calculator: isNoman ? ['home', 'home-outline'] : ['calculator', 'calculator-outline'],
      Values: isNoman ? ['trending-up', 'trending-up-outline'] : ['pricetags', 'pricetags-outline'],
      Stock: isNoman ? ['newspaper', 'newspaper-outline'] : ['notifications', 'notifications-outline'],
      Chat: isNoman ? ['chatbubble-ellipses', 'chatbubble-ellipses-outline'] : ['chatbubbles', 'chatbubbles-outline'],
      Trade: isNoman ? ['storefront', 'storefront-outline'] : ['cog', 'cog-outline'],
    };

    return icons[routeName] ? (focused ? icons[routeName][0] : icons[routeName][1]) : 'alert-circle-outline';
  }, []);


  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => (
          <AnimatedTabIcon
            focused={focused}
            iconName={getTabIcon(route.name, focused)}
            color={color}
            size={18}
          />
        ),
        tabBarStyle: {
          height: 60,
          backgroundColor: selectedTheme.colors.background,
        },
        tabBarActiveTintColor: selectedTheme.colors.primary,
        tabBarInactiveTintColor: selectedTheme.colors.text,
        headerStyle: {
          backgroundColor: selectedTheme.colors.background,
        },
        headerTintColor: selectedTheme.colors.text,
        headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 24 },
      })}
    >
      <Tab.Screen
        name="Calculator"
        options={({ navigation }) => ({
          title: t('tabs.calculator'), // Translation applied here
          headerRight: () => (
            <>
              <TouchableOpacity onPress={() => navigation.navigate('Reward')}>
                <Image
                  source={require('../../assets/trophy.webp')} // ✅ Ensure the correct path
                  style={{ width: 20, height: 20, marginRight: 16 }}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('Setting')} style={{ marginRight: 16 }}>
              <Icon
                name="settings-outline"
                size={24}
                color={selectedTheme.colors.text}
              />
              </TouchableOpacity>
            </>


          ),
        })}
      >
        {() => <HomeScreen selectedTheme={selectedTheme} />}
      </Tab.Screen>

      <Tab.Screen
        name="Stock"
        options={{
          title: t('tabs.stock'), // Translation applied here
        }}
      >
        {() => <TimerScreen selectedTheme={selectedTheme} />}
      </Tab.Screen>

      <Tab.Screen
        name="Trade"
        options={{
          headerShown: false,
          title: t('tabs.trade'), // Translation applied here
        }}
      >
        {() => (
          <TradeStack
            selectedTheme={selectedTheme}
            setChatFocused={setChatFocused}
            modalVisibleChatinfo={modalVisibleChatinfo}
            setModalVisibleChatinfo={setModalVisibleChatinfo}
          />
        )}
      </Tab.Screen>

      <Tab.Screen
        name="Chat"
        options={{
          headerShown: false,
          title: t('tabs.chat'), // Translation applied here
          tabBarBadge: chatFocused ? "" : null,
          tabBarBadgeStyle: {
            minWidth: 12,
            height: 12,
            borderRadius: 6,
            fontSize: 10,
            backgroundColor: 'red',
            color: 'white',
          },
        }}
      >
        {() => (
          <ChatStack
            selectedTheme={selectedTheme}
            setChatFocused={setChatFocused}
            modalVisibleChatinfo={modalVisibleChatinfo}
            setModalVisibleChatinfo={setModalVisibleChatinfo}
          />
        )}
      </Tab.Screen>

      <Tab.Screen
        name="Values"
        options={{
          title: t('tabs.values'), // Translation applied here
        }}
      >
        {() => <ValueScreen selectedTheme={selectedTheme} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
});

export default MainTabs;
