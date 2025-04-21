import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Image, Switch, TouchableOpacity, Alert, RefreshControl } from 'react-native';
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


const TimerScreen = ({ selectedTheme }) => {
  const { user, updateLocalStateAndDatabase, theme,  reload } = useGlobalState();
  const [hasAdBeenShown, setHasAdBeenShown] = useState(false);
  const [fruitRecords, setFruitRecords] = useState([]);
  const [isDrawerVisible, setDrawerVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false); // State for pull-to-refresh
  const [isSigninDrawerVisible, setisSigninDrawerVisible] = useState(false);
  const [isAdVisible, setIsAdVisible] = useState(true);
  const [normalStock, setNormalStock] = useState([]);
  const [mirageStock, setmirageStock] = useState([]);
  const [prenormalStock, setPreNormalStock] = useState([]);
  const [premirageStock, setPremirageStock] = useState([]);
  const { t } = useTranslation();
  // const platform = Platform.OS.toLowerCase();


  const isFocused = useIsFocused();
  const [currentTime, setCurrentTime] = useState(Date.now());
  const { triggerHapticFeedback } = useHaptic();
  const { localState } = useLocalState()
  const intervalRef = useRef(null); // Store interval reference


  const isDarkMode = theme === 'dark';



  const parseJSONSafely = (data) => {
    try {
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (error) {
      console.error("❌ JSON parse error:", error, "Raw data:", data);
      return {};
    }
  };
  
  useEffect(() => {
    const newFruitRecords = parseJSONSafely(localState?.data);
    const newNormalStock = parseJSONSafely(localState?.normalStock);
    const newMirageStock = parseJSONSafely(localState?.mirageStock);
    const newPreNormalStock = parseJSONSafely(localState?.prenormalStock);
    const newPreMirageStock = parseJSONSafely(localState?.premirageStock);
  
    setFruitRecords((prev) => (JSON.stringify(prev) !== JSON.stringify(newFruitRecords) ? Object.values(newFruitRecords) : prev));
    setNormalStock((prev) => (JSON.stringify(prev) !== JSON.stringify(newNormalStock) ? Object.values(newNormalStock) : prev));
    setmirageStock((prev) => (JSON.stringify(prev) !== JSON.stringify(newMirageStock) ? Object.values(newMirageStock) : prev));
    setPreNormalStock((prev) => (JSON.stringify(prev) !== JSON.stringify(newPreNormalStock) ? Object.values(newPreNormalStock) : prev));
    setPremirageStock((prev) => (JSON.stringify(prev) !== JSON.stringify(newPreMirageStock) ? Object.values(newPreMirageStock) : prev));
  }, [localState.data, localState.normalStock, localState.mirageStock, localState.prenormalStock, localState.premirageStock]);
  


  const openDrawer = () => {
    triggerHapticFeedback('impactLight');

    const callbackfunction = () => {
      setHasAdBeenShown(true); // Mark the ad as shown
      setDrawerVisible(true);
    };
    if (!hasAdBeenShown && !localState.isPro) {
      InterstitialAdManager.showAd(callbackfunction);
    }
    else {
      callbackfunction()

    }

  }

  const handleLoginSuccess = () => {
    setisSigninDrawerVisible(false);
  };

  const closeDrawer = () => setDrawerVisible(false);

  const handleFruitSelect = async (fruit) => {
    triggerHapticFeedback('impactLight');

    const selectedFruits = user.selectedFruits || []; // Ensure `selectedFruits` is always an array
    const isAlreadySelected = selectedFruits.some((item) => item.name === fruit.name);
    mixpanel.track("Select Fruit", {fruit:fruit.name});


    // ✅ Prevent duplicate selection
    if (isAlreadySelected) {
      showWarningMessage(t("settings.notice"), t("stock.already_selected"));
      return;
    }

    // ✅ Restriction: Free users can select up to 3 fruits, Pro users have no limit
    if (!localState.isPro && selectedFruits.length >= 4) {
      Alert.alert(
        "Selection Limit Reached",
        "You can only select up to 4 fruits as a free user. Upgrade to Pro to select more.",
        [{ text: "OK", onPress: () => { } }]
      );
      return;
    }

    // ✅ Add selected fruit
    const updatedFruits = [...selectedFruits, fruit];
    await updateLocalStateAndDatabase('selectedFruits', updatedFruits);

    showSuccessMessage(t("home.alert.success"), t("stock.fruit_selected"));

    // ✅ Ensure drawer closes after updates
    setTimeout(() => {
      closeDrawer();
    }, 300);
  };


  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await reload(); // Re-fetch stock data
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleRemoveFruit = (fruit) => {
    triggerHapticFeedback('impactLight');
    const selectedFruits = user.selectedFruits || []; // Ensure `selectedFruits` is always an array

    // Remove the selected fruit and update state/database
    const updatedFruits = selectedFruits.filter((item) => item.name !== fruit.name);
    updateLocalStateAndDatabase('selectedFruits', updatedFruits);
  };






  const toggleSwitch = async () => {
    // updateLocalStateAndDatabase('owner', true)

    try {
      const permissionGranted = await requestPermission();
      if (!permissionGranted) return;

      if (user.id == null) {
        setisSigninDrawerVisible(true);
      } else {
        const currentValue = user.isReminderEnabled;


        // Optimistically update the UI
        updateLocalStateAndDatabase('isReminderEnabled', !currentValue);
      }
    } catch (error) {
      // console.error('Error handling notification permission or sign-in:', error);
      // Alert.alert('Error', 'Something went wrong while processing your request.');
    }
  };

  const toggleSwitch2 = async () => {
    try {
      const permissionGranted = await requestPermission();
      if (!permissionGranted) return;

      if (user?.id == null) {
        setisSigninDrawerVisible(true);
      } else {
        const currentValue = user.isSelectedReminderEnabled;
        // Optimistically update the UI
        updateLocalStateAndDatabase('isSelectedReminderEnabled', !currentValue);
      }
    } catch (error) {
      // console.error('Error handling notification permission or sign-in:', error);
      // Alert.alert('Error', 'Something went wrong while processing your request.');

    }
  };

  // console.log(normalTimer)


  // Format time utility
  const formatTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate time left for stock resets
  const calculateTimeLeft = (intervalHours) => {
    const now = currentTime;
    let nextReset = new Date();
    nextReset.setHours(1, 0, 0, 0); // Base reset at 1 AM

    while (nextReset <= now) {
      nextReset.setHours(nextReset.getHours() + intervalHours);
    }
    return Math.floor((nextReset - now) / 1000);
  };

  const normalInterval = 4; // Normal stock resets every 4 hours
  const mirageInterval = 2; // Mirage stock resets every 2 hours

  const normalTimer = useMemo(() => formatTime(calculateTimeLeft(normalInterval)), [currentTime]);
  const mirageTimer = useMemo(() => formatTime(calculateTimeLeft(mirageInterval)), [currentTime]);



  useEffect(() => {
    if (!isFocused) {
      clearInterval(intervalRef.current); // ✅ Ensure old intervals are cleared
      return;
    }

    intervalRef.current = setInterval(() => {
      setCurrentTime(Date.now()); // ✅ Update time without forcing full re-render
    }, 1000);

    return () => clearInterval(intervalRef.current); // ✅ Cleanup interval on unmount
  }, [isFocused]);



  
  // Render FlatList Item
  const renderItem = ({ item, index, isLastItem }) => {
    return (
      <View
        style={[
          styles.itemContainer,
          isLastItem && { borderBottomWidth: 0 }, // Remove bottom border for the last item
        ]}
      >
        <Image
          source={{
            uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${item.Normal.replace(/^\+/, '').replace(/\s+/g, '-')}_Icon.webp`,
          }}
          style={styles.icon}
        />
        <Text style={[styles.name, { color: selectedTheme.colors.text }]}>{item.Normal}</Text>
        <Text style={styles.price}>{item.price}</Text>
        <Text style={styles.robux}>{item.value}</Text>
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
          <ScrollView
            contentContainerStyle={styles.scrollViewContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
            }
          >
            <View style={{ backgroundColor: config.colors.secondary, padding: 5, borderRadius: 10, marginVertical: 10 }}>
              <Text style={[styles.description]}>
                {t("stock.description")}
              </Text></View>
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

              <View style={config.isNoman ? styles.row2 : styles.row}>
                <Text style={[styles.title]}>{t("stock.selected_fruit_notification")} {'\n'}
                  <Text style={styles.footer}>
                    {t("stock.selected_fruit_notification_description")}
                  </Text>
                </Text>
                <View style={styles.rightSide}>
                  <Switch value={user.isSelectedReminderEnabled} onValueChange={toggleSwitch2} />
                  <TouchableOpacity
                    onPress={openDrawer}
                    style={styles.selectedContainericon}
                    disabled={!user.isSelectedReminderEnabled}
                  >
                    <Icon name="add" size={24} color="white" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
            <View style={styles.listContentSelected}>
              {user.selectedFruits?.map((item) => (
                <View key={item.name || item.Name} style={styles.selectedContainer}>
                  <Image
                    source={{
                      uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${item.name?.replace(/^\+/, '')
                        .replace(/\s+/g, '-') || item.Name?.replace(/^\+/, '')
                        .replace(/\s+/g, '-')}_Icon.webp`,
                    }}
                    style={styles.iconselected}
                  />
                  <Text style={[styles.fruitText, { color: selectedTheme.colors.text }]}>{item.name || item.Name}</Text>
                  <TouchableOpacity onPress={() => handleRemoveFruit(item)}>
                    <Icon name="close-circle" size={24} color={config.colors.wantBlockRed} style={styles.closeIcon} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            {/* <MyNativeAdComponent/> */}

            {/* <View> */}
            {/* Normal Stock Section */}
            <View>
              <View style={styles.headerContainer}>
                <Text style={[styles.title, { color: selectedTheme.colors.text }]}>  {t("stock.normal_stock")}</Text>
                <Text style={[styles.timer, { color: selectedTheme.colors.text }]}>
                  {t("stock.reset_in")}: <Text style={styles.time}>{normalTimer}</Text>
                </Text>
              </View>

              <View style={styles.stockContainer}>
                {normalStock.length > 0 && normalStock[0]?.value === "Fetching..." ? (
                  <Text style={styles.loadingText}>  {t("stock.fetching_data")}</Text>
                ) : (
                  normalStock.length > 0 &&
                  normalStock.map((item, index) => {
                    const isLastItem = index === normalStock.length - 1;
                    return (
                      <View key={item.id || index}>
                        {renderItem({ item, index, isLastItem })}
                      </View>
                    );
                  })
                )}
              </View>
              {/* {!localState.isPro && <MyNativeAdComponent />} */}


              {/* Mirage Stock Section */}
              <View style={styles.headerContainer}>
                <Text style={[styles.title, { color: selectedTheme.colors.text }]}>  {t("stock.mirage_stock")}</Text>
                <Text style={[styles.timer, { color: selectedTheme.colors.text }]}>
                  {t("stock.reset_in")}: <Text style={styles.time}>{mirageTimer}</Text>
                </Text>
              </View>
              <View style={styles.stockContainer}>
                {mirageStock.length > 0 && mirageStock[0]?.value === "Fetching..." ? (
                  <Text style={styles.loadingText}>{t("stock.fetching_data")}</Text>
                ) : (
                  mirageStock.length > 0 &&
                  mirageStock.map((item, index) => {
                    const isLastItem = index === mirageStock.length - 1;
                    return (
                      <View key={item.id || index}>
                        {renderItem({ item, index, isLastItem })}
                      </View>
                    );
                  })
                )}
              </View>


            </View>
            <TouchableOpacity style={styles.preContrefresh} onPress={handleRefresh}>
              <Text style={styles.pre}>REFRESH</Text>
            </TouchableOpacity>
            <View style={styles.preCont}>
              <Text style={styles.pre}>  {t("stock.previous_stock")}</Text>
            </View>


            {/* <View> */}
            {/* Normal Stock Section */}
            <View>
              <View style={styles.headerContainerpre}>
                <Text style={[styles.title, { color: selectedTheme.colors.text }]}>{t("stock.normal_stock")}</Text>
                <Text style={[styles.timer, { color: selectedTheme.colors.text }]}>
                  <Text style={styles.time}>00:00</Text>
                </Text>
              </View>

              <View style={styles.stockContainerpre}>
                {prenormalStock.length > 0 && prenormalStock.map((item, index) => {
                  const isLastItem = index === prenormalStock.length - 1;
                  return (
                    <View key={item.id || index}>
                      {renderItem({ item, index, isLastItem })}
                    </View>
                  );
                })}
              </View>

              {/* Mirage Stock Section */}
              <View style={styles.headerContainerpre}>
                <Text style={[styles.title, { color: selectedTheme.colors.text }]}>{t("stock.mirage_stock")}</Text>
                <Text style={[styles.timer, { color: selectedTheme.colors.text }]}>
                  <Text style={styles.time}>00:00</Text>
                </Text>
              </View>
              <View style={styles.stockContainerpre}>
                {premirageStock.length > 0 && premirageStock.map((item, index) => {
                  const isLastItem = index === premirageStock.length - 1;
                  return (
                    <View key={item.id || index}>
                      {renderItem({ item, index, isLastItem })}
                    </View>
                  );
                })}
              </View>
            </View>

            <FruitSelectionDrawer
              visible={isDrawerVisible}
              onClose={closeDrawer}
              onSelect={handleFruitSelect}
              data={fruitRecords}
              selectedTheme={selectedTheme}
            />

            <SigninDrawer
              visible={isSigninDrawerVisible}
              onClose={handleLoginSuccess}
              selectedTheme={selectedTheme}
              message={t("stock.signin_required_message")}
               screen='Stock'
            />
          </ScrollView>
        </View>
       

      </GestureHandlerRootView>

      {!localState.isPro && <BannerAdComponent/>}

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
      flex: 1, paddingHorizontal: 10, backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
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
      width: !config.isNoman ? '100%' : '100%',
      justifyContent: !config.isNoman ? 'center' : 'space-between',
      alignItems: 'center',
      padding: 10,
      paddingVertical: 10,
      borderColor: isDarkMode ? '#333333' : '#cccccc',
      borderBottomWidth: 1
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
    title: { fontSize: 14, fontFamily: 'Lato-Bold', color: isDarkMode ? 'white' : 'black' },
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
      backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
      padding: 10,
      borderRadius: 10
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
    preContrefresh:{
      justifyContent: 'center',
      flex: 1,
      padding: 20,
      backgroundColor: config.colors.hasBlockGreen,
      borderRadius: 10,
      margin: 10,
    },
    pre: {
      color: 'white',
      alignSelf: 'center',
      fontFamily: 'Lato-Bold'
    },
    footer: {
      fontFamily: 'Lato-Regular',
      fontSize: 8,
      lineHeight: 12,
      // width: 100, // Ensures the text stays within this width
      overflow: 'hidden', // Prevents text from overflowing outside the container
      flexWrap: 'wrap', // This ensures the text wraps when it exceeds maxWidth
      textAlign: 'left', // Adjust alignment as needed
    }
    ,
    loadingText: {
      fontFamily: 'Lato-Bold',
      fontSize: 14,
      alignSelf: 'center',
      color: config.colors.hasBlockGreen
    }
  });

export default TimerScreen;