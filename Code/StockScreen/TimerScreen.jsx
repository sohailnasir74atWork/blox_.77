import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Image, Switch, TouchableOpacity, Alert, RefreshControl, ActivityIndicator } from 'react-native';
import { useGlobalState } from '../GlobelStats';
import Icon from 'react-native-vector-icons/Ionicons';
import FruitSelectionDrawer from './FruitSelectionDrawer';
import SigninDrawer from '../Firebase/SigninDrawer';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import config from '../Helper/Environment';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import { requestPermission } from '../Helper/PermissionCheck';
import { useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showWarningMessage } from '../Helper/MessageHelper';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import { get, getDatabase, ref } from '@react-native-firebase/database';
import ValueScreen from '../ValuesScreen/ValueScreen';
import LinearGradient from 'react-native-linear-gradient';
import SelectWeatherDrawer from './SelectWeatherdrwer';


const TimerScreen = ({ selectedTheme }) => {
<<<<<<< HEAD
  const { user, updateLocalStateAndDatabase, theme, reload } = useGlobalState();
=======
  const { user, updateLocalStateAndDatabase, theme,  reload , stockNotifierPurchase, proGranted} = useGlobalState();
>>>>>>> f99f5c4 (hh)
  const [hasAdBeenShown, setHasAdBeenShown] = useState(false);
  const [fruitRecords, setFruitRecords] = useState([]);
  const [isDrawerVisible, setDrawerVisible] = useState(false);
  const [isDrawerVisibleWeather, setDrawerVisibleWeather] = useState(false);
  const [isSigninDrawerVisible, setisSigninDrawerVisible] = useState(false);
  const { t } = useTranslation();
  const [eggStock, setEggStock] = useState([]);
  const [eventStock, setEventStock] = useState([]);
  const [gearStock, setGearStock] = useState([]);
  const [seedStock, setSeedStock] = useState([]);
  const [cosmeticStock, setCosmeticStock] = useState([]);
  const [stockItems, setStockItems] = useState([]);
  const [allWeather, setallWeather] = useState([]);

console.log(stockItems)


  const [weatherLoading, setWeatherLoading] = useState(false);
  // const [lastSeenLoading, setLastSeenLoading] = useState(false);
  const [weatherData, setWeatherData] = useState(null);
  // const [eggStockLastSeen, setEggStockLastSeen] = useState([]);
  // const [eventStockLastSeen, setEventStockLastSeen] = useState([]);
  // const [gearStockLastSeen, setGearStockLastSeen] = useState([]);
  // const [seedStockLastSeen, setSeedStockLastSeen] = useState([]);
  const [activeTab, setActiveTab] = useState('Stock');




  const isFocused = useIsFocused();
  const [currentTime, setCurrentTime] = useState(Date.now());
  const { triggerHapticFeedback } = useHaptic();
  const { localState } = useLocalState()

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000); // update every second
    return () => clearInterval(interval);
  }, []);

  const isDarkMode = theme === 'dark';

  useEffect(() => {
    if (!user?.id) return;
    if (!user?.isSelectedReminderEnabled) return;

    const fetchData = async () => {
      try {
        const [dataRes] = await Promise.all([
          fetch("https://stock-item-select.b-cdn.net/", {
            method: "GET",
            cache: "no-store",
          }),
        ]);

        const dataJson = await dataRes.json();
        const data = dataJson || {};

        const list = Object.entries(data).map(([id, v]) => ({
          id,
          ...v,
        }));

        setStockItems(list);
      } catch (err) {
        console.error("Error fetching stock items:", err);
      }
    };

    fetchData();
  }, [user?.id, user?.isSelectedReminderEnabled]);

  

  useEffect(() => {
    if (!isFocused) return;
  
    if (activeTab === 'Stock') {
      const stockRef = getDatabase().ref('/stock_elv');

  
      const listener = stockRef.on('value', (snapshot) => {
        const stockData = snapshot.val();
        // console.log(stockData);
  
        if (!Array.isArray(stockData)) return;
  
        const seedStock = [];
        const gearStock = [];
        const eggStock = [];
        const eventStock = [];
        const cosmeticStock = [];
  
        stockData.forEach(item => {
          switch (item.category) {
            case 'seed':
              seedStock.push(item);
              break;
            case 'gear':
              gearStock.push(item);
              break;
            case 'egg':
              eggStock.push(item);
              break;
            case 'eventshop':
              eventStock.push(item);
              break;
            case 'cosmetic':
              cosmeticStock.push(item);
              break;
            default:
              break;
          }
        });
  
        setSeedStock(seedStock);
        setGearStock(gearStock);
        setEggStock(eggStock);
        setEventStock(eventStock);
        setCosmeticStock(cosmeticStock);

      });
  
      return () => stockRef.off('value', listener);
    }
    if (activeTab === 'Weather') {
     if(allWeather.length===0){ const db = getDatabase();
      const stockRef = ref(db, '/all_weathers');
    
      get(stockRef).then((snapshot) => {
        if (snapshot.exists()) {
          const allWeatherData = snapshot.val();
          setallWeather(Object.values(allWeatherData)); 
        } else {
          console.log("No data available");
        }
      }).catch((error) => {
        console.error("Error fetching weather data:", error);
      });}
    
      fetchWeatherData();
    }
    // if (activeTab === 'Last Seen') {
    //   fetchLastSeenData();
    // }
  }, [isFocused, activeTab]);
  
// console.log(allWeather)




  const openDrawer = () => {
    triggerHapticFeedback('impactLight');
  
    // 🔒 Alert if user is not signed in
    if (!user?.id) {
      // Alert.alert(
      //   "Sign In Required",
      //   "Please sign in to select fruits for reminders.",
      //   [{ text: "OK", onPress: () => setisSigninDrawerVisible(true) }]
      // );
      setisSigninDrawerVisible(true);
      return;
    }
  
    // ⚠️ Alert if reminders are not enabled
    if (!user?.isSelectedReminderEnabled) {
      Alert.alert(
        "Enable Reminder First",
        "Please enable the reminder toggle to select fruits.",
        [{ text: "OK" }]
      );
      return;
    }
  
    const callbackfunction = () => {
      setHasAdBeenShown(true); // Mark the ad as shown
      setDrawerVisible(true);
    };
<<<<<<< HEAD
  
    if (!hasAdBeenShown && !localState.isPro) {
=======
    if (!hasAdBeenShown && (!localState.isPro && proGranted)) {
>>>>>>> f99f5c4 (hh)
      InterstitialAdManager.showAd(callbackfunction);
    } else {
      callbackfunction();
    }
  };
  const openDrawerWeather = () => {
    triggerHapticFeedback('impactLight');
  
    // 🔒 Alert if user is not signed in
    if (!user?.id) {
      // Alert.alert(
      //   "Sign In Required",
      //   "Please sign in to select fruits for reminders.",
      //   [{ text: "OK", onPress: () => setisSigninDrawerVisible(true) }]
      // );
      setisSigninDrawerVisible(true);
      return;
    }
  
    // ⚠️ Alert if reminders are not enabled
    if (!user?.isSelectedReminderEnabled) {
      Alert.alert(
        "Enable Reminder First",
        "Please enable the reminder toggle to select fruits.",
        [{ text: "OK" }]
      );
      return;
    }
  
    const callbackfunction = () => {
      setHasAdBeenShown(true); // Mark the ad as shown
      setDrawerVisibleWeather(true);
    };
  
    if (!hasAdBeenShown && !localState.isPro) {
      InterstitialAdManager.showAd(callbackfunction);
    } else {
      callbackfunction();
    }
  };
  

  useEffect(() => {
    // always a safe array
    const safeStock = Array.isArray(stockItems) ? stockItems : [];
  
    if (localState?.data) {
      try {
        const parsed = typeof localState.data === 'string'
          ? JSON.parse(localState.data)
          : localState.data;
  
        if (parsed == null || typeof parsed !== 'object') {
          throw new Error('Parsed data is not a valid object/array');
        }
  
        const parsedList = Array.isArray(parsed) ? parsed : Object.values(parsed);
  
        // ✅ put stock items FIRST, then the parsed list
        const combined = [...safeStock, ...parsedList];
  
        setFruitRecords(combined);
      } catch (err) {
        console.error("❌ Error parsing data:", err, "📝 Raw Data:", localState.data);
        // show only stock items if parsing fails
        setFruitRecords(safeStock);
      }
    } else {
      // if no localState.data yet, show only stock items
      setFruitRecords(safeStock);
    }
  }, [localState?.data, stockItems]);
  

  const handleLoginSuccess = () => {
    setisSigninDrawerVisible(false);
  };

  const closeDrawer = () => setDrawerVisible(false);
  const closeDrawerWeather = () => setDrawerVisibleWeather(false);


  const handleFruitSelect = async (fruit) => {
    triggerHapticFeedback('impactLight');

    const selectedFruits = user.selectedFruits || []; // Ensure `selectedFruits` is always an array
    const isAlreadySelected = selectedFruits.some((item) => item.name === fruit.name);
    mixpanel.track("Select Fruit", { fruit: fruit.name });


    // ✅ Prevent duplicate selection
    if (isAlreadySelected) {
      showWarningMessage(t("settings.notice"), t("stock.already_selected"));
      return;
    }

    // ✅ Restriction: Free users can select up to 3 fruits, Pro users have no limit
    if ((!localState.isPro && proGranted && !stockNotifierPurchase) && selectedFruits.length >= 2) {
      Alert.alert(
        "Selection Limit Reached",
        "You can only select up to 2 fruits as a free user. Upgrade to Pro or purchse notifier to select more.",
        [{ text: "OK", onPress: () => { } }]
      );
      return;
    }

    // ✅ Add selected fruit
    const updatedFruits = [...selectedFruits, fruit];
    // console.log(selectedFruits)
    await updateLocalStateAndDatabase('selectedFruits', updatedFruits);

    showSuccessMessage(t("home.alert.success"), t("stock.fruit_selected"));

    // ✅ Ensure drawer closes after updates
    setTimeout(() => {
      closeDrawer();
    }, 300);
  };
  const handleSelectWeather = async (fruit) => {
    triggerHapticFeedback('impactLight');

    const selectedWeather = user.selectedWeather || []; // Ensure `selectedFruits` is always an array
    const isAlreadySelected = selectedWeather.some((item) => item === fruit);
    // mixpanel.track("Select Fruit", { fruit: fruit.name });


    // ✅ Prevent duplicate selection
    if (isAlreadySelected) {
      showWarningMessage(t("settings.notice"), t("stock.already_selected"));
      return;
    }

    // ✅ Restriction: Free users can select up to 3 fruits, Pro users have no limit
    if (!localState.isPro && selectedWeather.length >= 3) {
      Alert.alert(
        "Selection Limit Reached",
        "You can only select up to 3 Weathers as a free user. Upgrade to Pro to select more.",
        [{ text: "OK", onPress: () => { } }]
      );
      return;
    }

    // ✅ Add selected fruit
    const updatedWeather = [...selectedWeather, fruit];
    // console.log(selectedFruits)
    await updateLocalStateAndDatabase('selectedWeather', updatedWeather);

    showSuccessMessage(t("home.alert.success"), t("stock.fruit_selected"));

    // ✅ Ensure drawer closes after updates
    setTimeout(() => {
      closeDrawer();
    }, 300);
  };




  const handleRemoveFruit = (fruit) => {
    triggerHapticFeedback('impactLight');
    const selectedFruits = user.selectedFruits || []; // Ensure `selectedFruits` is always an array

    // Remove the selected fruit and update state/database
    const updatedFruits = selectedFruits.filter((item) => item.name !== fruit.name);
    updateLocalStateAndDatabase('selectedFruits', updatedFruits);
  };
  const handleRemoveWeather = (fruit) => {
    triggerHapticFeedback('impactLight');
    const selectedWeather = user.selectedWeather || []; // Ensure `selectedFruits` is always an array

    // Remove the selected fruit and update state/database
    const updatedweather = selectedWeather.filter((item) => item !== fruit);
    updateLocalStateAndDatabase('selectedWeather', updatedweather);
  };

  const fetchWeatherData = async () => {
    setWeatherLoading(true);
    try {
      const snapshot = await getDatabase().ref('/weather_elv_new').once('value');
      const data = snapshot.val();
      // console.log(data)
      // const cleaned = Object.values(data || {}).filter(item => typeof item === 'object' && item.weather_name);
      // console.log(cleaned)
      setWeatherData(data);
    } catch (error) {
      console.error("❌ Failed to fetch weather data:", error);
    } finally {
      setWeatherLoading(false);
    }
  };
  // const fetchLastSeenData = async () => {
  //   setLastSeenLoading(true);
  //   try {
  //     const snapshot = await getDatabase().ref('/last_seen').once('value');
  //     const data = snapshot.val() || {};


  //     setEggStockLastSeen(Array.isArray(data.egg_stock) ? data.egg_stock : []);
  //     setEventStockLastSeen(Array.isArray(data.event_stock) ? data.event_stock : []);
  //     setGearStockLastSeen(Array.isArray(data.gear_stock) ? data.gear_stock : []);
  //     setSeedStockLastSeen(Array.isArray(data.seeds_stock) ? data.seeds_stock : []);

  //     // console.log("✅ Last seen data loaded", {
  //     //   egg: data.egg_stock?.length,
  //     //   event: data.event_stock?.length,
  //     //   gear: data.gear_stock?.length,
  //     //   seed: data.seeds_stock?.length,
  //     // });
  //   } catch (error) {
  //     console.error("❌ Failed to fetch last seen data:", error);
  //   } finally {
  //     setLastSeenLoading(false);
  //   }
  // };

  // console.log(eggStockLastSeen, eventStockLastSeen, gearStockLastSeen)



  // const toggleSwitch = async () => {
  //   // updateLocalStateAndDatabase('owner', true)

  //   try {
  //     const permissionGranted = await requestPermission();
  //     if (!permissionGranted) return;

  //     if (user.id == null) {
  //       setisSigninDrawerVisible(true);
  //     } else {
  //       const currentValue = user.isReminderEnabled;


  //       // Optimistically update the UI
  //       updateLocalStateAndDatabase('isReminderEnabled', !currentValue);
  //     }
  //   } catch (error) {
  //     // console.error('Error handling notification permission or sign-in:', error);
  //     // Alert.alert('Error', 'Something went wrong while processing your request.');
  //   }
  // };

  const toggleSwitch2 = useCallback(async () => {
    const permissionGranted = await requestPermission();
    if (!permissionGranted) return;
  
    if (!user?.id) {
      setisSigninDrawerVisible(true);
      return;
    }
  
    setTimeout(() => {
      updateLocalStateAndDatabase('isSelectedReminderEnabled', !user.isSelectedReminderEnabled);
    }, 100);
  }, [user?.id, user?.isSelectedReminderEnabled]);
  

  // console.log(normalTimer)
  // const ValueScreen = () => {
  //   return (
  //     <View style={{ flex: 1, backgroundColor: 'blue', justifyContent: 'center', alignItems: 'center' }}>
  //       <Text style={{ color: 'white' }}>Value Screen</Text>
  //     </View>
  //   );
  // };
// console.log(user.selectedFruits)

  const getTimeLeft = (intervalMinutes) => {
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
  
    const totalSeconds = minutes * 60 + seconds;
    const nextInterval = Math.ceil(totalSeconds / (intervalMinutes * 60)) * (intervalMinutes * 60);
  
    const remainingSeconds = nextInterval - totalSeconds;
  
    const h = Math.floor(remainingSeconds / 3600);
    const m = Math.floor((remainingSeconds % 3600) / 60);
    const s = remainingSeconds % 60;
  
    if (h > 0) {
      return `${h}h ${m}m`;
    } else {
      return `${m}m ${s}s`;
    }
  };


  const GradientContainer = ({ isNoman, children, style }) => {
    if (!isNoman) {
      return (
        <LinearGradient
          colors={['#4c669f', '#3b5998', '#192f51']} // Gradient colors
          style={style}
        >
          {children}
        </LinearGradient>
      );
    } else {
      return <View style={style}>{children}</View>;
    }
  };

  const formatName = (name) => {
    if(!name) return
    return name
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };




  const renderWeatherCards = (items) => {
    // console.log('item', items)
    // return items.map((item, idx) => {
      const localTime = items.lastUpdated
        ? new Date(items.lastUpdated).toLocaleString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          day: '2-digit',
          month: 'short',
        })
        : 'Unknown';

      return (
        <GradientContainer isNoman={config.isNoman} style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical:10, backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff', padding:5, borderRadius:4, marginHorizontal:2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 4 }}>
              {/* <Image source={{ uri: item.icon }} style={{ width: 40, height: 40, marginRight: 6 }} /> */}
              <View style={{alignItems:"flex-start"}}>
            
            <Text style={{ fontSize: 14, color: !isDarkMode ? 'black' : '#ffffff', fontFamily:'Lato-Bold', lineHeight:16 }}>{formatName(items.type)}</Text>
            <Text
              style={{
                fontSize: 10,
                color: 'white',
                backgroundColor: items.active
                  ? 'lightpink'
                  : config.colors.inactive || '#999', // fallback if inactive color is not defined
                paddingHorizontal: 6,
                // paddingVertical: 1,
                borderRadius: 6,
              
                overflow: 'hidden', // ensures background applies only to text area
                // marginLeft: 10
              }}
            >
              {items.active ? 'Active' : 'Inactive'}
            </Text>
            </View>
          </View>
          <Text style={{ fontSize: 12,color: !isDarkMode ? 'black' : '#ffffff', fontFamily:'Lato-Regular' }}>Last seen at {localTime}</Text>
        </GradientContainer>
      );
    // });
  };



  // Render FlatList Item
  const renderStockItems = (title, items, stock) => {
    return (
     
      <View style={{ marginBottom: 10 }}>
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <Text style={[styles.title, { marginVertical: 5 }]}>{title}</Text>
  
          {stock && (
            <Text style={{
              fontSize: 10,
              textAlign: 'center',
              color: 'white',
              backgroundColor: config.colors.hasBlockGreen,
              paddingHorizontal: 3,
              paddingVertical: 1,
              borderRadius: 3
            }}>
           {`Time Left: ${
  title.toLowerCase().includes('egg') || title.toLowerCase().includes('event')
    ? getTimeLeft(30)
    : title.toLowerCase().includes('cosmetic')
    ? getTimeLeft(240)
    : getTimeLeft(5)
}`}


            </Text>
          )}
        </View>
  
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          {items.map((item, index) => (
            <GradientContainer
            isNoman={config.isNoman}
              key={item.id + index || index}
              style={{
                width: '49%',
                backgroundColor: isDarkMode  ? '#1e1e1e' : '#ffffff',
                borderRadius: 5,
                alignItems: 'center',
                padding: 4,
                marginVertical: 2,
                flexDirection: 'row',
              }}
            >
              <Image
                source={{ uri: item.icon }}
                style={{ width: 50, height: 50, borderRadius: 5, marginRight: 5 }}
              />
              <View>
                <Text style={{ fontSize: 14, color: selectedTheme.colors.text, fontFamily: 'Lato-Bold', lineHeight: 16 }}>
                {formatName(item.display_name).length > 15 ? formatName(item.display_name).slice(0, 15) + '...' : formatName(item.display_name)}                </Text>
  
                {stock ? (
                  <Text style={{ fontSize: 12, color: config.isNoman ? config.colors.secondary : 'lightpink', fontWeight: 'bold' }}>
                    {item.quantity} Units
                  </Text>
                ) : (
                  <Text style={{ fontSize: 12, color: config.isNoman ? config.colors.secondary : 'lightpink', fontWeight: 'bold' }}>
                    {(() => {
                      const totalSeconds = item.last_seen_int_seconds || 0;
                      const hours = Math.floor(totalSeconds / 3600);
                      const minutes = Math.floor((totalSeconds % 3600) / 60);
                      const seconds = totalSeconds % 60;
                      return `${hours}h ${minutes}m ${seconds}s`;
                    })()}
                  </Text>
                )}
              </View>
            </GradientContainer>
          ))}
        </View>
      </View>
    );
  };
  




  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  // console.log(state.premirageStock)
  // console.log(localState.normalStock, localState.mi)
  return (
    <>
      <GestureHandlerRootView>
        <View style={styles.container}>
<<<<<<< HEAD
         
=======
          <ScrollView
            contentContainerStyle={styles.scrollViewContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
            }
          >
>>>>>>> f99f5c4 (hh)
            {/* <View style={{ backgroundColor: config.colors.secondary, padding: 5, borderRadius: 10, marginVertical: 10 }}>
              <Text style={[styles.description]}>
                {t("stock.description")}
              </Text></View> */}
<<<<<<< HEAD
           <View style={styles.reminderContainer}>
  <GradientContainer isNoman={config.isNoman} style={styles.row}>
    <View style={config.isNoman ? styles.row2 : styles.row}>
      <View>
        <Text style={[styles.title, {alignSelf: !config.isNoman && 'center' }]}>
          {activeTab === 'Stock' ? 'Selected Fruit Notifier':'Selected Weather Notifier'}
        </Text>
        <Text style={styles.footer}>
        {activeTab === 'Stock' ? t("stock.selected_fruit_notification_description") : 'You will be notified when selected weather become active'}
        </Text>
      </View>
      <View style={styles.rightSide}>
        <TouchableOpacity
          onPress={toggleSwitch2}
          style={{
            padding: 3,
            borderRadius: 20,
            backgroundColor: user.isSelectedReminderEnabled
              ? config.colors.hasBlockGreen
              : '#ccc',
          }}
        >
          <Icon
            name={user.isSelectedReminderEnabled ? "notifications" : "notifications-off"}
            size={20}
            color="white"
          />
        </TouchableOpacity>
=======
            <View style={styles.reminderContainer}>
              <View style={styles.row}>
                <Text style={styles.title}>{t("stock.stock_updates")}</Text>
                <View style={styles.rightSide}>
                  <Switch value={user.isReminderEnabled} onValueChange={toggleSwitch} />
                  <Icon
                    name={user.isReminderEnabled ? "notifications" : "notifications-outline"}
                    size={24}
                    color={user.isReminderEnabled ? config.colors.hasBlockGreen : config.colors.primary}
                    style={styles.iconNew}
                  />
                </View>
              </View>
>>>>>>> f99f5c4 (hh)

        <TouchableOpacity
          onPress={activeTab === 'Stock' ? openDrawer : openDrawerWeather}
          style={styles.selectedContainericon}
        >
          <Icon name="add" size={24} color="white" />
        </TouchableOpacity>
      </View>
    </View>
  </GradientContainer>
</View>

          
            {/* <MyNativeAdComponent/> */}

            {/* <View> */}
            {/* Normal Stock Section */}
            <View style={{flex:1}}>


              {/* {!localState.isPro && <MyNativeAdComponent />} */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-around',  backgroundColor: isDarkMode? '#34495E' : 'white', padding: 5, borderRadius:4 }}>
                {['Stock', 'Weather'].map(tab => (
                  <TouchableOpacity
                    key={tab}
                    onPress={() => setActiveTab(tab)}
                    style={{
                      backgroundColor: activeTab === tab ? config.colors.hasBlockGreen : (isDarkMode? '#34495E' : 'white'),
                      paddingVertical: 6,
                      paddingHorizontal: 16,
                      borderRadius: 5,
                      width: '50%',
                    }}
                  >
                    <Text style={{ color: activeTab === tab ? 'white' : 'lightgrey', fontWeight: 'bold', textAlign: 'center' }}>{tab}</Text>
                  </TouchableOpacity>
                ))}
              </View>


              {activeTab === 'Stock' && (
  <>
    <View style={styles.listContentSelected}>
              {user.selectedFruits?.map((item) => (
                
                <GradientContainer key={item.name} style={styles.selectedContainer} isNoman={config.isNoman}>
                  <Image
                    source={{
                      uri: item.picture,
                    }}
                    style={styles.iconselected}
                  />
                  <Text style={[styles.fruitText, { color: selectedTheme.colors.text }]}>{formatName(item.name)}</Text>
                  <TouchableOpacity onPress={() => handleRemoveFruit(item)}>
                    <Icon name="close-circle" size={24} color={'#ff4d6d'}  />
                  </TouchableOpacity>
                </GradientContainer>
              ))}
            </View>
    {(eggStock.length === 0 &&
      eventStock.length === 0 &&
      gearStock.length === 0 &&
      cosmeticStock.length === 0 &&
      seedStock.length === 0) ? (
      <ActivityIndicator
        size="small"
        color={config.colors.hasBlockGreen}
        style={{ marginTop: 10 }}
      />
    ) : (
      <ScrollView showsVerticalScrollIndicator={false}>
        {renderStockItems("Egg Stock", eggStock, true)}
        {renderStockItems("Event Stock", eventStock, true)}
        {renderStockItems("Gear Stock", gearStock, true)}
        {renderStockItems("Seed Stock", seedStock, true)}
        {renderStockItems("Cosmetic Stock", cosmeticStock, true)}
        </ScrollView>
    )}
  </>
)}


{activeTab === 'Weather' && (
  <>
    {weatherLoading ? (
      <ActivityIndicator
        size="small"
        color={config.colors.hasBlockGreen}
        style={{ marginTop: 10 }}
      />
    ) : (
      weatherData && (
        <ScrollView showsVerticalScrollIndicator={false}>
          {user.selectedWeather && <View style={styles.listContentSelected}>
              {user.selectedWeather?.map((item, index) => (
                
                <GradientContainer key={`${item}_&{index}`} style={styles.selectedContainer} isNoman={config.isNoman}>
                 
                  <Text style={[styles.fruitText, { color: selectedTheme.colors.text }]}>{item}</Text>
                  <TouchableOpacity onPress={() => handleRemoveWeather(item)}>
                    <Icon name="close-circle" size={24} color={'#ff4d6d'}  />
                  </TouchableOpacity>
                </GradientContainer>
              ))}
            </View>}
          {renderWeatherCards(weatherData)}
        </ScrollView>
      )
    )}
  </>
)}

{activeTab === 'Values' && (
        <View style={{ flex: 1 }}>
          <ValueScreen />
        </View>
      )}




            </View>






            {/* <View> */}
            {/* Normal Stock Section */}

            <FruitSelectionDrawer
              visible={isDrawerVisible}
              onClose={closeDrawer}
              onSelect={handleFruitSelect}
              data={fruitRecords}
              selectedTheme={selectedTheme}
            />

        <SelectWeatherDrawer
              visible={isDrawerVisibleWeather}
              onClose={closeDrawerWeather}
              onSelect={handleSelectWeather}
              data={allWeather}
              selectedTheme={selectedTheme}
            />      

            <SigninDrawer
              visible={isSigninDrawerVisible}
              onClose={handleLoginSuccess}
              selectedTheme={selectedTheme}
              message={t("stock.signin_required_message")}
              screen='Stock'
            />
        </View>


      </GestureHandlerRootView>

<<<<<<< HEAD
      {!localState.isPro && <BannerAdComponent />}
=======
      {(!localState.isPro && proGranted) && <BannerAdComponent/>}
>>>>>>> f99f5c4 (hh)

      {/* {!localState.isPro && <View style={{ alignSelf: 'center' }}>
        {isAdVisible && (
          <BannerAd
            unitId={bannerAdUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            onAdLoaded={() => setIsAdVisible(true)}
            onAdFailedToLoad={() => setIsAdVisible(false)}
            requestOptions={{
              requestNonPersonalizedAdsOnly: true,
            }}
          />
        )}
      </View>} */}
    </>



  );
};
const getStyles = (isDarkMode, user) =>
  StyleSheet.create({
    container: {
      flex: 1, paddingHorizontal: 10, backgroundColor: isDarkMode ? '#192f5d' : '#f2f2f7',
    },
    description: { fontSize: 14, lineHeight: 18, marginVertical: 10, fontFamily: 'Lato-Regular', color: 'white' },
    headerContainer: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10, paddingHorizontal: 10 },
    headerContainerpre: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10, paddingHorizontal: 10, opacity: .3 },

    timer: { fontSize: 16, fontFamily: 'Lato-Bold' },
    time: { fontSize: 16, fontFamily: 'Lato-Bold' },
    itemContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      borderColor: isDarkMode ? '#333333' : '#cccccc',
      borderBottomWidth: 1,
      marginBottom: !config.isNoman ? 10 : 0,

      ...(!config.isNoman && {
        borderWidth: 1,
        borderColor: config.colors.hasBlockGreen,
        padding: 5
      }),
    },

    icon: { width: 50, height: 50, borderRadius: 5, marginRight: 10 },
    name: { fontSize: 16, flex: 1, fontFamily: 'Lato-Bold' },
    price: { fontSize: 14, backgroundColor: config.colors.hasBlockGreen, padding: 5, borderRadius: 5, color: 'white' },
    robux: { fontSize: 14, backgroundColor: config.colors.hasBlockGreen, padding: 5, borderRadius: 5, color: 'white', marginLeft: 10 },
    stockContainer: {
      backgroundColor: config.colors.primary,
      padding: 10,
      borderRadius: 10,
      backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',


    },
    stockContainerpre: {
      backgroundColor: config.colors.primary,
      padding: 10,
      borderRadius: 10,
      backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
      opacity: .3


    },
    row: {
      flexDirection: !config.isNoman ? 'column' : 'row',
      // width: !config.isNoman ? '100%' : '100%',
      justifyContent: !config.isNoman ? 'center' : 'space-between',
      alignItems: 'center',
      // padding: 10,
      paddingVertical: config.isNoman ? 0 : 5,
      borderColor: isDarkMode ? '#333333' : '#cccccc',
      borderBottomWidth: config.isNoman ? 1: 0,
      // backgroundColor:'red',
      borderRadius:10

    },
    row2: {
      flexDirection: !config.isNoman ? 'column' : 'row',
      width: !config.isNoman ? '100%' : '100%',
      justifyContent: !config.isNoman ? 'center' : 'space-between',
      alignItems: 'center',
      padding: 10,
      paddingVertical: 10,
      overflow: 'hidden', // Prevents text from overflowing outside the container
      flexWrap: 'wrap', // This ensures the text wraps when it exceeds maxWidth

    },
    title: { fontSize: 14, fontFamily: 'Lato-Bold', color: isDarkMode ? 'white' : 'black', lineHeight: 16,  },
    rightSide: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: !config.isNoman ? 20 : 0
    },
    iconNew: {
      marginLeft: 10,
    },
    peopleIcon: {
      marginRight: 15,
    },
    selectedContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
      borderRadius: 20,
      paddingVertical: 1,
      paddingHorizontal: 5,
      marginVertical: 2,
      marginRight: 5, // Add spacing between items
    },
    selectedContainericon: {
      // flexDirection: 'column',
      alignItems: 'center',
      backgroundColor: user?.isSelectedReminderEnabled ? config.colors.hasBlockGreen : config.colors.primary,
      borderRadius: 20,
      marginLeft: 10
    },
    listContentSelected: {
      flexDirection: 'row',
      flexWrap: "wrap",
      marginVertical: 10,

    }
    , fruitText: {
      fontSize: 10,
      color: 'white',
      textAlign: 'center',
      paddingHorizontal: 5,
      alignItems: 'center'
    },
    iconselected: {
      width: 30,
      height: 30
    },
    reminderContainer: {
      flexDirection: 'column',
<<<<<<< HEAD
      // backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
      marginTop: 10,
=======
      backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
      padding: 10,
      borderRadius: 10,
      marginTop:10
>>>>>>> f99f5c4 (hh)
    },
    preCont: {
      justifyContent: 'center',
      flex: 1,
      padding: 20,
      backgroundColor: config.colors.secondary,
      borderRadius: 10,
      margin: 10,
      opacity: .3
    },

    pre: {
      color: 'white',
      alignSelf: 'center',
      fontFamily: 'Lato-Bold'
    },
    footer: {
      fontFamily: 'Lato-Regular',
      color:isDarkMode ? 'white' : 'black',
      fontSize: 8,
      lineHeight: 12,
      // width: 100, // Ensures the text stays within this width
      overflow: 'hidden', // Prevents text from overflowing outside the container
      flexWrap: 'wrap', // This ensures the text wraps when it exceeds maxWidth
      // textAlign: 'center', // Adjust alignment as needed
    }
    ,
    loadingText: {
      fontFamily: 'Lato-Bold',
      fontSize: 14,
      alignSelf: 'center',
      color: config.colors.hasBlockGreen
    },
    gradientBackground: {
      // flex: 1,
      // padding: 20,
      // borderRadius: 10,
    },
    regularBackground: {
      flex: 1,
      backgroundColor: '#f0f0f0',  // Solid background when isNoman is false
      padding: 20,
      borderRadius: 10,
    },
  });

export default TimerScreen;