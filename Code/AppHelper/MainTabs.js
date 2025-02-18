import React, { useRef, useEffect, useMemo } from 'react';
import { Animated } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Ionicons';
import HomeScreen from '../Homescreen/HomeScreen';
import ValueScreen from '../ValuesScreen/ValueScreen';
import TimerScreen from '../StockScreen/TimerScreen';
import { ChatStack } from '../ChatScreen/ChatNavigator';
import SettingsScreen from '../SettingScreen/Setting';
import config from '../Helper/Environment';
import TradeList from '../Trades/Trades';
import { TradeStack } from '../Trades/TradeNavigator';
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
    const getTabIcon = (routeName, focused) => {
      switch (routeName) {
        case 'Calculator':
          return focused
            ? config.isNoman
              ? 'home'
              : 'calculator'
            : config.isNoman
              ? 'home-outline'
              : 'calculator-outline';
        case 'Values':
          return focused
            ? config.isNoman
              ? 'trending-up'
              : 'pricetags'
            : config.isNoman
              ? 'trending-up-outline'
              : 'pricetags-outline';
        case 'Stock':
          return focused
            ? config.isNoman
              ? 'newspaper'
              : 'notifications'
            : config.isNoman
              ? 'newspaper-outline'
              : 'notifications-outline';
        case 'Chat':
          return focused
            ? config.isNoman
              ? 'chatbubble-ellipses'
              : 'chatbubbles'
            : config.isNoman
              ? 'chatbubble-ellipses-outline'
              : 'chatbubbles-outline';
        case 'Trade':
          return focused
            ? config.isNoman
              ? 'storefront'
              : 'cog'
            : config.isNoman
              ? 'storefront-outline'
              : 'cog-outline';
        default:
          return 'alert-circle-outline';
      }
    };
  
    return (
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color, size }) => (
            <AnimatedTabIcon
              focused={focused}
              iconName={getTabIcon(route.name, focused)} // Ensure `route.name` is passed correctly
              color={color}
              size={size}
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
            headerRight: () => (
              <Icon
                name="settings-outline"
                size={24}
                color={selectedTheme.colors.text}
                style={{ marginRight: 16 }}
                onPress={() => navigation.navigate('Setting')}
              />
            ),
          })}
        >
          {() => <HomeScreen selectedTheme={selectedTheme} />}
        </Tab.Screen>
        <Tab.Screen name="Stock">
          {() => <TimerScreen selectedTheme={selectedTheme} />}
        </Tab.Screen>
        <Tab.Screen
          name="Trade"
          options={{
            headerShown: false,
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
        <Tab.Screen name="Values">
          {() => <ValueScreen selectedTheme={selectedTheme} />}
        </Tab.Screen>
      </Tab.Navigator>
    );
  });
  
  export default MainTabs;
  
