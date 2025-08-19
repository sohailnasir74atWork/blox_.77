<<<<<<< HEAD
import React, {  useCallback } from 'react';
import {  Image, StyleSheet, TouchableOpacity, View } from 'react-native';
=======
import React, { useCallback } from 'react';
import { Image, TouchableOpacity, View } from 'react-native';
>>>>>>> f99f5c4 (hh)
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
<<<<<<< HEAD
import { DesignStack } from '../Design/DesignNavigation';
import { useGlobalState } from '../GlobelStats';
import LinearGradient from 'react-native-linear-gradient';
=======
import BouncingCartIcon from './CartIcon';
import TopLevelStockComponent from '../StockScreen/StockNavigator';
import RewardCenterScreen from '../SettingScreen/RewardCenter';
<<<<<<< HEAD
>>>>>>> f99f5c4 (hh)
=======
import DesignStack from '../Design/DesignNavigation';
import { useGlobalState } from '../GlobelStats';
>>>>>>> 7d3c677 (updated to api level 35 before)



const Tab = createBottomTabNavigator();
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SettingsScreen from '../SettingScreen/Setting';

const CalcStack = createNativeStackNavigator();

function CreateTradeWithHeaderGradient(props) {
  // const headerHeight = useHeaderHeight();
  // const insets = useSafeAreaInsets();
  const gradientHeight = 110;

  return (
    <View style={{ flex: 1 , backgroundColor:'#192f5d'}}>
      {/* Gradient behind the transparent header */}
      <LinearGradient
        colors={['#4c669f', '#3b5998', '#192f5d']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: gradientHeight }}
        pointerEvents="none"
      />
      {/* Push content below the header */}
      <View style={{ height: 110 }} />
      <TimerScreen selectedTheme={props.selectedTheme} {...props} />
    </View>
  );
}

function CalculatorStackScreen({ selectedTheme, isAdmin, navigation }) {
  return (
    <CalcStack.Navigator
      screenOptions={{
        headerTransparent: true,
        headerStyle: { backgroundColor: 'transparent' },
        headerTitleStyle: { color: 'white', fontSize: 24, fontFamily: 'Lato-Bold' },
        headerTintColor: 'white',
      }}
    >
      <CalcStack.Screen
        name="CreateTradeInner"
        options={{
          title: 'Live Stock',
          headerTitleAlign: 'center',
         
        }}
      >
        {() => <CreateTradeWithHeaderGradient selectedTheme={selectedTheme} />}
      </CalcStack.Screen>
    </CalcStack.Navigator>
  );
}


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
<<<<<<< HEAD
<<<<<<< HEAD
  const { isAdmin } = useGlobalState();
=======
=======
  const {isAdmin, } = useGlobalState()

>>>>>>> 7d3c677 (updated to api level 35 before)
  
  const getTabIcon = useCallback((routeName, focused) => {
>>>>>>> f99f5c4 (hh)

  const getTabIcon = useCallback((routeName, focused) => {
    const icons = {
<<<<<<< HEAD
      Calculator: config.isNoman ? ['house', 'house'] :['paper-plane', 'paper-plane'], // Solid icons look same for focused/unfocused
      Stock:  config.isNoman ? ['cart-shopping', 'cart-shopping'] : ['bag-shopping', 'bag-shopping'],
      Trade: config.isNoman ? ['handshake', 'handshake'] : ['business-time', 'business-time'],
      Chat: config.isNoman ? ['envelope', 'envelope'] : ['user-group', 'user-group'],
      Values: config.isNoman ? ['chart-simple', 'chart-simple'] : ['chart-simple', 'chart-simple'],
      Settings: config.isNoman ? ['gear', 'gear'] : ['gear', 'gear'],
=======
      Calculator: ['house', 'house'], // Solid icons look same for focused/unfocused
      Stock: ['cart-shopping', 'cart-shopping'],
      Trade: ['handshake', 'handshake'],
      Chat: ['envelope', 'envelope'],
      Values: ['sack-dollar', 'sack-dollar'],
<<<<<<< HEAD
>>>>>>> f99f5c4 (hh)
=======
      Designs: ['chart-simple', 'chart-simple'],
>>>>>>> 7d3c677 (updated to api level 35 before)
    };
    return icons[routeName] ? (focused ? icons[routeName][0] : icons[routeName][1]) : 'alert-circle-outline';
  }, []);
  

<<<<<<< HEAD
  // Sequence of tabs based on isNoman
  const renderTabs = config.isNoman ? (
    <>
=======

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => (
          <AnimatedTabIcon
            focused={focused}
            iconName={getTabIcon(route.name)}
            color={config.colors.primary}
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
>>>>>>> f99f5c4 (hh)
      <Tab.Screen
        name="Calculator"
        options={({ navigation }) => ({
          title: t('tabs.calculator'),
          headerRight: () => (
<<<<<<< HEAD
            <>
              {isAdmin && (
                <TouchableOpacity onPress={() => navigation.navigate('Admin')}>
                  <Image
                    source={require('../../assets/trophy.webp')}
                    style={{ width: 20, height: 20, marginRight: 16 }}
                  />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => navigation.navigate('Setting')} style={{ marginRight: 16 }}>
                <Icon name="settings" size={24} color={selectedTheme.colors.text} />
              </TouchableOpacity>
            </>
          ),
=======
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {/* <TouchableOpacity style={{ marginRight: 12 }} onPress={() => navigation.navigate('Store')}>
                <BouncingCartIcon />
              </TouchableOpacity> */}
          
          {isAdmin && <TouchableOpacity onPress={() => navigation.navigate('Admin')}>
                <Image
                  source={require('../../assets/trophy.webp')} // ✅ Ensure the correct path
                  style={{ width: 20, height: 20, marginRight: 16 }}
                />
              </TouchableOpacity>}
          
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
>>>>>>> f99f5c4 (hh)
        })}
      >
        {() => <HomeScreen selectedTheme={selectedTheme} />}
      </Tab.Screen>

      <Tab.Screen
<<<<<<< HEAD
=======
        name="Stock"
        options={{
          title: 'Stocks', // Translation applied here
        }}
      >
        {() => <TopLevelStockComponent selectedTheme={selectedTheme} />}
      </Tab.Screen>

      <Tab.Screen
>>>>>>> f99f5c4 (hh)
        name="Trade"
        options={{
          headerShown: false,
          title: t('tabs.trade'),
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
        name="Designs"
        options={{
          title: 'Feed', // Translation applied here
          headerShown: false
        }}
      >
        {() => <DesignStack selectedTheme={selectedTheme} />}
      </Tab.Screen>

      <Tab.Screen
        name="Values"
        options={{
          title: 'Feed',
          headerShown: false,
        }}
      >
        {() => <DesignStack selectedTheme={selectedTheme} />}
      </Tab.Screen>

      <Tab.Screen
        name="Chat"
        options={{
          headerShown: false,
          title: t('tabs.chat'),
          tabBarBadge: chatFocused ? '' : null,
          tabBarBadgeStyle: {
            maxWidth: 4,
            height: 8,
            borderRadius: 4,
            fontSize: 10,
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
        name="Stock"
        options={{
<<<<<<< HEAD
          title: t('tabs.stock'),
        }}
      >
        {() => <TimerScreen selectedTheme={selectedTheme} />}
=======
          title: 'Rewards', // Translation applied here
        }}
      >
        {() => <RewardCenterScreen selectedTheme={selectedTheme} />}
>>>>>>> f99f5c4 (hh)
      </Tab.Screen>
    </>
  ) : (
    <>
     <Tab.Screen
  name="Stock"
  options={{
    title: 'Create Trade',
    headerShown: false, // hide tab header; the stack header will show
    
  }}
>
  {({ navigation }) => (
    <CalculatorStackScreen
      selectedTheme={selectedTheme}
      isAdmin={isAdmin}
      navigation={navigation}
    />
  )}
</Tab.Screen>
   
      <Tab.Screen
        name="Trade"
        options={{
          headerShown: false,
          title: 'Trading Feed',
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
        name="Calculator"
        options={{
          title: 'Create Trade',
          headerTitleStyle:{color:'white', fontSize:24, fontFamily:'Lato-Bold'},
          headerBackground: () => (
            // Use Linear Gradient for the header background
            <LinearGradient
            colors={['#4c669f', '#3b5998', '#192f5d']}  // Set gradient colors
            style={styles.headerBackground}  // Apply styles to the gradient
          />
          ),
          headerTitleAlign: 'center', // Center the title in the header
        }}
        
      >
        {() => <HomeScreen selectedTheme={selectedTheme} />}
      </Tab.Screen>
      

      <Tab.Screen
        name="Chat"
        options={{
          headerShown: false,
          title: 'Group Chat',
          tabBarBadge: chatFocused ? '' : null,
          tabBarBadgeStyle: {
            maxWidth: 4,
            height: 8,
            borderRadius: 4,
            fontSize: 10,
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
        name="Settings"
        options={{
          title: 'Setting',
          headerTitleStyle:{color:'white', fontSize:24, fontFamily:'Lato-Bold'},
          headerBackground: () => (
            // Use Linear Gradient for the header background
            <LinearGradient
            colors={['#4c669f', '#3b5998', '#192f5d']}  // Set gradient colors
            style={styles.headerBackground}  // Apply styles to the gradient
          />
          ),
          headerTitleAlign: 'center', // Center the title in the header
        }}
        
      >
        {() => <SettingsScreen selectedTheme={selectedTheme} />}
      </Tab.Screen>

     
    </>
  );

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => (
          <AnimatedTabIcon
            focused={focused}
            iconName={getTabIcon(route.name, focused)}
            color={focused ? config.colors.primary : config.colors.primary}
            size={18}
          />
        ),
        tabBarBackground: () => (
        !config.isNoman && <LinearGradient
          colors={['#192f5d', '#3b5998', '#4c669f']}  
          style={styles.headerBackground}  
        />
        ),
        tabBarButton: (props) => {
          const { accessibilityState, children, onPress } = props;
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
                alignItems: 'center',
              }}
            >
              {children}
            </TouchableOpacity>
          );
        },
        tabBarStyle: {
          backgroundColor: selectedTheme.colors.background,
        },
        tabBarLabelStyle: {
          fontSize: 10, // 👈 Your custom label font size
          fontFamily: 'Lato-Bold',
          color: !config.isNoman ? selectedTheme.colors.text : undefined
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
      {renderTabs}
    </Tab.Navigator>
  );
});
const styles = StyleSheet.create({
  headerBackground: {
    flex: 1,
  },
});
export default MainTabs;

