import React, { useCallback } from 'react';
import { Image, TouchableOpacity, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Ionicons';
import HomeScreen from '../Homescreen/HomeScreen';
import ValueScreen from '../ValuesScreen/ValueScreen';
import TimerScreen from '../StockScreen/TimerScreen';
import { ChatStack } from '../ChatScreen/ChatNavigator';
import { TradeStack } from '../Trades/TradeNavigator';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import BouncingCartIcon from './CartIcon';
import TopLevelStockComponent from '../StockScreen/StockNavigator';
import RewardCenterScreen from '../SettingScreen/RewardCenter';



const Tab = createBottomTabNavigator();

const AnimatedTabIcon = React.memo(({ iconName, color, size }) => {



  return (
    <FontAwesome
      name={iconName}
      size={size}
      color={color}
      solid={true}
    />
  );
});


const MainTabs = React.memo(({ selectedTheme, chatFocused, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo }) => {
  const { t } = useTranslation();
  
  const getTabIcon = useCallback((routeName, focused) => {

    const icons = {
      Calculator: ['house', 'house'], // Solid icons look same for focused/unfocused
      Stock: ['cart-shopping', 'cart-shopping'],
      Trade: ['handshake', 'handshake'],
      Chat: ['envelope', 'envelope'],
      Values: ['sack-dollar', 'sack-dollar'],
    };

    return icons[routeName] ? (focused ? icons[routeName][0] : icons[routeName][1]) : 'alert-circle-outline';
  }, []);


  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => (
          <AnimatedTabIcon
            focused={focused}
            iconName={getTabIcon(route.name)}
            color={config.colors.primary}
            size={18}
          />
        ),
        tabBarButton: (props) => {
          const { children, onPress } = props;
          const isSelected = props['aria-selected'];

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
          height: 50,
          backgroundColor: selectedTheme.colors.background,
        },
        tabBarLabelStyle: {
          fontSize: 9, // 👈 Your custom label font size
          fontFamily: 'Lato-Bold', // Optional: Custom font family
        },
        tabBarActiveTintColor: config.colors.primary,
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
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {/* <TouchableOpacity style={{ marginRight: 12 }} onPress={() => navigation.navigate('Store')}>
                <BouncingCartIcon />
              </TouchableOpacity> */}
          
              {/* <TouchableOpacity onPress={() => navigation.navigate('Reward')}>
                <Image
                  source={require('../../assets/trophy.webp')}
                  style={{ width: 20, height: 20, marginRight: 16 }}
                />
              </TouchableOpacity> */}
          
              <TouchableOpacity onPress={() => navigation.navigate('Setting')} style={{ marginRight: 16 }}>
                <Icon
                  name="settings"
                  size={24}
                  color={selectedTheme.colors.text}
                />
              </TouchableOpacity>
            </View>
          )
          ,
        })}
      >
        {() => <HomeScreen selectedTheme={selectedTheme} />}
      </Tab.Screen>

      <Tab.Screen
        name="Stock"
        options={{
          title: 'Stocks', // Translation applied here
        }}
      >
        {() => <TopLevelStockComponent selectedTheme={selectedTheme} />}
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
            maxWidth: 4,
            height: 8,
            borderRadius: 4,
            fontSize: 10,
            // backgroundColor: 'red',
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
          title: 'Rewards', // Translation applied here
        }}
      >
        {() => <RewardCenterScreen selectedTheme={selectedTheme} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
});

export default MainTabs;
