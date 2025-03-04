import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Image, Switch, TouchableOpacity, Alert, RefreshControl, Platform } from 'react-native';
import { useGlobalState } from '../GlobelStats';
import Icon from 'react-native-vector-icons/Ionicons';
import FruitSelectionDrawer from './FruitSelectionDrawer';
import SigninDrawer from '../Firebase/SigninDrawer';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import { AdEventType, BannerAd, BannerAdSize, InterstitialAd } from 'react-native-google-mobile-ads';
import getAdUnitId from '../Ads/ads';
import config from '../Helper/Environment';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import { requestPermission } from '../Helper/PermissionCheck';
import { useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { logEvent } from '@react-native-firebase/analytics';
import FlashMessage, { showMessage } from 'react-native-flash-message';
import MyNativeAdComponent from '../Ads/NativAds';

const bannerAdUnitId = getAdUnitId('banner');
const interstitialAdUnitId = getAdUnitId('interstitial');
const interstitial = InterstitialAd.createForAdRequest(interstitialAdUnitId);

const TimerScreen = ({ selectedTheme }) => {
  const { user, updateLocalStateAndDatabase, theme, fetchStockData, analytics } = useGlobalState();
  const [hasAdBeenShown, setHasAdBeenShown] = useState(false);
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isShowingAd, setIsShowingAd] = useState(false);
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
  const platform = Platform.OS.toLowerCase();


  const isFocused = useIsFocused();
  const [currentTime, setCurrentTime] = useState(Date.now());
  const { triggerHapticFeedback } = useHaptic();
  const { localState } = useLocalState()
  const intervalRef = useRef(null); // Store interval reference


  const isDarkMode = theme === 'dark';



  useEffect(() => {
    // console.log("🔍 Raw localState:", localState);

    // Initialize variables for parsed values
    let parsedData = {};
    let parsedNormalStock = {};
    let parsedMirageStock = {};
    let parsedPreNormalStock = {};
    let parsedPreMirageStock = {};

    try {
      // Parse JSON values if stored as strings in MMKV
      parsedData = localState.data ? (typeof localState.data === "string" ? JSON.parse(localState.data) : localState.data) : {};
      parsedNormalStock = localState.normalStock ? (typeof localState.normalStock === "string" ? JSON.parse(localState.normalStock) : localState.normalStock) : {};
      parsedMirageStock = localState.mirageStock ? (typeof localState.mirageStock === "string" ? JSON.parse(localState.mirageStock) : localState.mirageStock) : {};
      parsedPreNormalStock = localState.prenormalStock ? (typeof localState.prenormalStock === "string" ? JSON.parse(localState.prenormalStock) : localState.prenormalStock) : {};
      parsedPreMirageStock = localState.premirageStock ? (typeof localState.premirageStock === "string" ? JSON.parse(localState.premirageStock) : localState.premirageStock) : {};
    } catch (error) {
      console.error("❌ Error parsing data from localState:", error);
    }

    // console.log("✅ Parsed Data:", parsedData);
    // console.log("✅ Parsed Normal Stock:", parsedNormalStock);
    // console.log("✅ Parsed Mirage Stock:", parsedMirageStock);
    // console.log("✅ Parsed Previous Normal Stock:", parsedPreNormalStock);
    // console.log("✅ Parsed Previous Mirage Stock:", parsedPreMirageStock);

    // Ensure only valid objects are processed
    setFruitRecords(Object.keys(parsedData).length > 0 ? Object.values(parsedData) : []);
    setNormalStock(Object.keys(parsedNormalStock).length > 0 ? Object.values(parsedNormalStock) : []);
    setmirageStock(Object.keys(parsedMirageStock).length > 0 ? Object.values(parsedMirageStock) : []);
    setPreNormalStock(Object.keys(parsedPreNormalStock).length > 0 ? Object.values(parsedPreNormalStock) : []);
    setPremirageStock(Object.keys(parsedPreMirageStock).length > 0 ? Object.values(parsedPreMirageStock) : []);

  }, [localState.data, localState.normalStock, localState.mirageStock, localState.prenormalStock, localState.premirageStock]);
  // ✅ Effect runs only when these state values change



  const openDrawer = () => {
    triggerHapticFeedback('impactLight');
    if (!hasAdBeenShown) {
      showInterstitialAd(() => {
        setHasAdBeenShown(true); // Mark the ad as shown
        setDrawerVisible(true);
      });
    }
    else {
      setDrawerVisible(true);

    }

  }
  const closeDrawer = () => setDrawerVisible(false);
  const closeDrawerSignin = () => setisSigninDrawerVisible(false);

  const handleFruitSelect = async (fruit) => {
    triggerHapticFeedback('impactLight');
    logEvent(analytics, `${platform}_select_fruit`);

    const userPoints = user.points || 0; // Ensure `points` exists
    const selectedFruits = user.selectedFruits || []; // Ensure `selectedFruits` is always an array
    const isAlreadySelected = selectedFruits.some((item) => item.Name === fruit.Name);

    if (isAlreadySelected) {
      showMessage({
        message: t("settings.notice"),
        description: t("stock.already_selected"),
        type: "warning",
      });
      return;
    }

    if (localState.isPro || selectedFruits.length === 0) {
      // First selection is free for Pro users or first-time selection
      const updatedFruits = [...selectedFruits, fruit];
      await updateLocalStateAndDatabase('selectedFruits', updatedFruits);

      showMessage({
        message: t("home.alert.success"),
        description: t("stock.fruit_selected"),
        type: "success",
      });
    } else if (userPoints >= 50) {
      // Deduct 50 points for additional selections
      const updatedPoints = userPoints - 50;
      await updateLocalStateAndDatabase('points', updatedPoints);

      const updatedFruits = [...selectedFruits, fruit];
      await updateLocalStateAndDatabase('selectedFruits', updatedFruits);

      // Alert.alert(t("home.alert.success"), `${fruit.Name} - ${t("stock.success_selection")}`);
      showMessage({
        message: t("home.alert.success"),
        description: `${fruit.Name} - ${t("stock.success_selection")}`,
        type: "success",
      });
    } else {
      Alert.alert(
        t("stock.insufficient_points"),
        t("stock.insufficient_points_description"),
        [{ text: 'OK', onPress: () => { } }]
      );
    }

    // Ensure drawer closes after updates
    setTimeout(() => {
      closeDrawer();
    }, 300);
  };

  const handleRefresh = async () => {
    logEvent(analytics, `${platform}_stock_refresh`);
    setRefreshing(true);
    try {
      await fetchStockData(); // Re-fetch stock data
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
    const updatedFruits = selectedFruits.filter((item) => item.Name !== fruit.Name);
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
        logEvent(analytics, `${platform}_toggle_switch_stock_notifier`);


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
        logEvent(analytics, `${platform}_toggle_switch_selected_fruit_notifier`);
      }
    } catch (error) {
      // console.error('Error handling notification permission or sign-in:', error);
      // Alert.alert('Error', 'Something went wrong while processing your request.');

    }
  };

  // console.log(state.mirageStock)


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

  const normalTimer = useMemo(() => formatTime(calculateTimeLeft(normalInterval)), []);
  const mirageTimer = useMemo(() => formatTime(calculateTimeLeft(mirageInterval)), []);



  useEffect(() => {
    if (!isFocused) return; // Only run when the screen is focused

    intervalRef.current = setInterval(() => {
      setCurrentTime(Date.now()); // Update time without forcing full re-render
    }, 1000);

    return () => clearInterval(intervalRef.current); // Cleanup interval on unmount
  }, [isFocused]); // Depend only on focus

  //   return { normalTimer, mirageTimer };
  // };

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





  ///////////////

  // console.log(state.mirageStock)


  useEffect(() => {
    interstitial.load();

    const onAdLoaded = () => setIsAdLoaded(true);
    const onAdClosed = () => {
      setIsAdLoaded(false);
      setIsShowingAd(false);
      interstitial.load();
    };
    const onAdError = (error) => {
      setIsAdLoaded(false);
      setIsShowingAd(false);
      console.error('Ad Error:', error);
    };

    interstitial.addAdEventListener(AdEventType.LOADED, onAdLoaded);
    interstitial.addAdEventListener(AdEventType.CLOSED, onAdClosed);
    interstitial.addAdEventListener(AdEventType.ERROR, onAdError);

    return () => {
      interstitial.removeAllListeners(); // Prevent memory leaks
    };
  }, []);

  const showInterstitialAd = useCallback((callback) => {
    if (isAdLoaded && !isShowingAd && !localState.isPro) {
      setIsShowingAd(true);
      try {
        interstitial.show();
        callback(); // Call the function after the ad
      } catch (error) {
        console.error('Error showing interstitial ad:', error);
        setIsShowingAd(false);
        callback();
      }
    } else {
      callback();
    }
  }, [isAdLoaded, isShowingAd, localState.isPro]);
  // console.log(state?.normalStock)
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
            <Text style={[styles.description, { color: selectedTheme.colors.text }]}>
              {t("stock.description")}
            </Text>
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

              <View style={styles.row2}>
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
                <View key={item.Name} style={styles.selectedContainer}>
                  <Image
                    source={{
                      uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${item.Name
                        .replace(/^\+/, '')
                        .replace(/\s+/g, '-')}_Icon.webp`,
                    }}
                    style={styles.iconselected}
                  />
                  <Text style={[styles.fruitText, { color: selectedTheme.colors.text }]}>{item.Name}</Text>
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
              {!localState.isPro && <MyNativeAdComponent />}


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
              onClose={closeDrawerSignin}
              selectedTheme={selectedTheme}
              message={t("stock.signin_required_message")}
            />
          </ScrollView>
        </View>
        {/* <FlashMessage position="top" /> */}

      </GestureHandlerRootView>

      {!localState.isPro && <View style={{ alignSelf: 'center' }}>
        {isAdVisible && (
          <BannerAd
            unitId={bannerAdUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            onAdLoaded={() => setIsAdVisible(true)}
            onAdFailedToLoad={() => setIsAdVisible(false)}
          />
        )}
      </View>}
    </>



  );
};
const getStyles = (isDarkMode, user) =>
  StyleSheet.create({
    container: {
      flex: 1, paddingHorizontal: 10, backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
    },
    description: { fontSize: 14, marginVertical: 10, fontFamily: 'Lato-Regular' },
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