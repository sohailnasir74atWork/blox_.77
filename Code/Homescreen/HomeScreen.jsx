import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, FlatList, TextInput, Image, Alert, useColorScheme, Keyboard, Pressable, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { InterstitialAd, AdEventType, TestIds, BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import getAdUnitId from '../Ads/ads';
import ViewShot, { captureRef } from 'react-native-view-shot';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { useGlobalState } from '../GlobelStats';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import config from '../Helper/Environment';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../Helper/HepticFeedBack';
import { getDatabase, ref, push, get, set } from '@react-native-firebase/database';
import { useLocalState } from '../LocalGlobelStats';
import SignInDrawer from '../Firebase/SigninDrawer';
import { useNavigation } from '@react-navigation/native';
import firestore from '@react-native-firebase/firestore';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../Translation/LanguageProvider';
import i18n from '../../i18n';
import { logEvent } from '@react-native-firebase/analytics';
import  { showMessage } from 'react-native-flash-message';
import DeviceInfo from 'react-native-device-info';


const bannerAdUnitId = getAdUnitId('banner');
const interstitialAdUnitId = getAdUnitId('interstitial');
const interstitial = InterstitialAd.createForAdRequest(interstitialAdUnitId);

const HomeScreen = ({ selectedTheme }) => {
  const { theme, user, updateLocalStateAndDatabase, analytics, appdatabase } = useGlobalState();
  const tradesCollection = useMemo(() => firestore().collection('trades_new'), []);
  const initialItems = [null, null, null, null];
  const [hasItems, setHasItems] = useState(initialItems);
  const [fruitRecords, setFruitRecords] = useState([]);
  const [wantsItems, setWantsItems] = useState(initialItems);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedSection, setSelectedSection] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [hasTotal, setHasTotal] = useState({ price: 0, value: 0 });
  const [wantsTotal, setWantsTotal] = useState({ price: 0, value: 0 });
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isShowingAd, setIsShowingAd] = useState(false);
  const [isAdVisible, setIsAdVisible] = useState(true);
  const { triggerHapticFeedback } = useHaptic();
  const { localState } = useLocalState()
  const [modalVisible, setModalVisible] = useState(false);
  const [description, setDescription] = useState('');
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { language, changeLanguage } = useLanguage();
  const [showNotification, setShowNotification] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  


  const platform = Platform.OS.toLowerCase();

  const { t } = useTranslation();
  const CURRENT_APP_VERSION = DeviceInfo.getVersion();

  useEffect(() => {
    const checkForUpdate = async () => {
      try {
        const database = getDatabase();
        const platformKey = Platform.OS === "ios" ? "ios_app_version" : (config.isNoman ? "noman_app_version" : 'waqas_app_version');
        const versionRef = ref(database, platformKey);
        const snapshot = await get(versionRef);
        // console.log(snapshot.val(), CURRENT_APP_VERSION)

        if (snapshot.exists() && snapshot.val().app_version !== CURRENT_APP_VERSION) {
          setShowNotification(true);
        } else {
          setShowNotification(false);
        }
      } catch (error) {
        console.error("🔥 Error checking for updates:", error);
      }
    };
    checkForUpdate();
  }, []);
  const pinnedMessagesRef = useMemo(() => ref(appdatabase, 'pin_messages'), []);

  useEffect(() => {
    const loadPinnedMessages = async () => {
      try {
        const snapshot = await pinnedMessagesRef.once('value');
        if (snapshot.exists()) {
          const data = snapshot.val();
          const parsedPinnedMessages = Object.entries(data).map(([key, value]) => ({
            firebaseKey: key, // Use the actual Firebase key here
            ...value,
          }));
          setPinnedMessages(parsedPinnedMessages); // Store the parsed messages with the Firebase key
        } else {
          setPinnedMessages([]); // No pinned messages
        }
      } catch (error) {
        console.error('Error loading pinned messages:', error);
        Alert.alert(t('home.alert.error'), 'Could not load pinned messages. Please try again.');
      }
    };

    loadPinnedMessages();
  }, [pinnedMessagesRef]);
  // Run this once when the app starts
  useEffect(() => {
    logEvent(analytics, `${platform}_${language}`);
  })
  const onClose = () => { setShowNotification(false) }
  const onClosePinMessage = (index) => {
    setPinnedMessages((prevMessages) => prevMessages.filter((_, i) => i !== index));
  };
  const isDarkMode = theme === 'dark'
  const viewRef = useRef();

  const resetState = () => {
    triggerHapticFeedback('impactLight');
    setSelectedSection(null);
    setHasTotal({ price: 0, value: 0 });
    setWantsTotal({ price: 0, value: 0 });
    setIsAdLoaded(false);
    setIsShowingAd(false);
    setHasItems([null, null, null, null]);
    setWantsItems([null, null, null, null]);
  };
  const resetTradeState = () => {
    setHasItems([null, null, null, null]);
    setWantsItems([null, null, null, null]);
    setHasTotal({ price: 0, value: 0 });
    setWantsTotal({ price: 0, value: 0 });
    setDescription("");  // ✅ Reset description field
    setSelectedSection(null);
    setModalVisible(false); // ✅ Close modal after successful trade
  };

  const navigation = useNavigation()

  // useEffect(() => {
  //   // console.log("Language changed:", i18n.language);
  // }, [i18n.language]);

  const handleCreateTradePress = async () => {
    logEvent(analytics, `${platform}_submit_trade`);
    if (!user.id) {
      setIsSigninDrawerVisible(true)
      return;
    }
    if (hasItems.filter(Boolean).length === 0 || wantsItems.filter(Boolean).length === 0) {
      // Alert.alert(t("home.alert.error"), t("home.alert.missing_items_error"));
      showMessage({
        message: t("home.alert.error"),
        description: t("home.alert.missing_items_error"),
        type: "danger",
      });

    
      
      return;



    }
    const tradeRatio = wantsTotal.value / hasTotal.value;

    if (tradeRatio < 0.05) {
      showMessage({
        message: t("home.unfair_trade"),
        description: t('home.unfair_trade_description'),
        type: "danger",
      });

      return;
    }

    if (tradeRatio > 1.95) {
      showMessage({
        message: t('home.invalid_trade'),
        description: t('home.invalid_trade_description'),
        type: "danger",
      });

      return;
    }

    setModalVisible(true)
  };







  const handleCreateTrade = async () => {
    if (isSubmitting) return; // Prevent duplicate submissions
    setIsSubmitting(true);
    logEvent(analytics, `${platform}_create_trade`);

    const userPoints = user?.points || 0;
    const userId = user?.id;
    const database = getDatabase();
    const freeTradeRef = ref(database, `freeTradeUsed/${userId}`);

    try {
      // 🔍 Check if user has used the free trade
      const snapshot = await get(freeTradeRef);
      const hasUsedFreeTrade = snapshot.exists() && snapshot.val();

      // if (developmentMode) {
      //   const hasUsedFreeTradeSize = JSON.stringify(hasUsedFreeTrade).length / 1024;
      //   // console.log(`🚀 free trade data data: ${hasUsedFreeTradeSize.toFixed(2)} KB`);
      // }


      // ✅ Prepare trade object
      let newTrade = {
        userId: user?.id || "Anonymous",
        traderName: user?.displayName || "Anonymous",
        avatar: user?.avatar || null,
        isPro: localState.isPro,
        isFeatured: false,
        hasItems: hasItems.filter(item => item && item.Name).map(item => ({ name: item.Name, type: item.Type })),
        wantsItems: wantsItems.filter(item => item && item.Name).map(item => ({ name: item.Name, type: item.Type })),
        hasTotal: { price: hasTotal?.price || 0, value: hasTotal?.value || 0 },
        wantsTotal: { price: wantsTotal?.price || 0, value: wantsTotal?.value || 0 },
        description: description || "",
        timestamp: firestore.FieldValue.serverTimestamp(),
      };

      // 🔥 Default Empty Trade Object
      const resetNewTrade = {
        userId: null,
        traderName: null,
        avatar: null,
        isPro: null,
        hasItems: [],
        wantsItems: [],
        hasTotal: null,
        wantsTotal: null,
        description: null,
        timestamp: null,
      };

      // ❌ Prevent Empty Trades from Being Submitted
      if (JSON.stringify(newTrade) === JSON.stringify(resetNewTrade)) {
        // Alert.alert("Error", t("home.alert.trade_empty_error"));
        showMessage({
          message: t("home.alert.error"),
          description: t("home.alert.trade_empty_error"),
          type: "danger",
        });
        setIsSubmitting(false);
        return;
      }

      // ✅ Trade Submission Logic
      const submitTrade = async () => {
        await tradesCollection.add(newTrade);
        Object.assign(newTrade, resetNewTrade); // Reset after submission
        setModalVisible(false); // Close modal
        // Alert.alert("Success", "Trade submitted successfully!");
      };

      // 🔹 If user is Pro → Direct submission
      if (localState.isPro) {
        await submitTrade();
        // Alert.alert(t("home.alert.success"), t("home.alert.trade_posted"));
        showMessage({
          message: t("home.alert.success"),
          description: t("home.alert.trade_posted"),
          type: "success",
        });
      }
      // 🔹 If user has a free trade → Use it
      else if (!hasUsedFreeTrade) {
        await set(freeTradeRef, true); // Mark free trade as used
        showInterstitialAd(async () => await submitTrade());
        // Alert.alert(t("home.alert.success"), t("home.alert.free_trade_used"));
        showMessage({
          message: t("home.alert.success"),
          description: t("home.alert.free_trade_used"),
          type: "success",
        });
      }
      // 🔹 If user has enough points → Deduct and submit
      else if (userPoints >= 200) {
        const updatedPoints = userPoints - 200;
        await updateLocalStateAndDatabase('points', updatedPoints); // Deduct points
        showInterstitialAd(async () => await submitTrade());
        // Alert.alert("Success", `${t("home.trade_posted_points")} ${updatedPoints}.`);
        showMessage({
          message: t("home.alert.success"),
          description: `${t("home.trade_posted_points")} ${updatedPoints}.`,
          type: "success",
        });
      }
      // 🔹 If user lacks points → Show error message
      else {
        Alert.alert(
          t("home.alert.insufficient_points"),
          t("home.alert.insufficient_points_message"),
          [
            { text: t("settings.get_points"), onPress: () => { setModalVisible(false); navigation.navigate('Setting'); } },
            { text: t("home.cancel"), style: 'cancel' },
          ]
        );
      }
    } catch (error) {
      console.error("🔥 Error creating trade:", error);
      // Alert.alert(t("home.alert.error"), t("home.alert.unable_to_create_trade"));
      showMessage({
        message: t("home.alert.error"),
        description: t("home.alert.unable_to_create_trade"),
        type: "danger",
      });
    } finally {
      setIsSubmitting(false); // Reset submission state
    }
  };


  const adjustedData = (fruitRecords) => {
    let transformedData = [];
    fruitRecords.forEach((fruit) => {
      if (!fruit.Name) return; // Skip invalid entries
      if (fruit.Permanent && fruit.Value) {
        transformedData.push({ Name: `${fruit.Name}`, Value: fruit.Permanent, Type: 'p', Price: fruit.Biliprice });
        transformedData.push({ Name: `${fruit.Name}`, Value: fruit.Value, Type: 'n', Price: fruit.Biliprice });
      } else if (fruit.Permanent || fruit.Value) {
        // If only one exists, keep it as is
        transformedData.push({ Name: fruit.Name, Value: fruit.Value || fruit.Permanent });
      }
    });

    return transformedData;
  };



  useEffect(() => {
    if (localState.data) {
      let parsedData = localState.data;

      // ✅ Ensure `localState.data` is always an object
      if (typeof localState.data === 'string') {
        try {
          parsedData = JSON.parse(localState.data); // ✅ Convert string to object
          // console.log("🛠️ Parsed JSON localState.data:", parsedData);
        } catch (error) {
          // console.error("❌ Failed to parse localState.data:", error);
          return; // Stop execution if parsing fails
        }
      } else {
        // console.log("🛠️ localState.data is already an object:", parsedData);
      }

      // ✅ Ensure `parsedData` is a valid object before using it
      if (parsedData && typeof parsedData === 'object' && Object.keys(parsedData).length > 0) {
        const formattedData = adjustedData(Object.values(parsedData));
        // console.log("🚀 Adjusted Data Before Setting:", formattedData);
        setFruitRecords(formattedData);
      } else {
        console.warn("⚠️ localState.data is empty or invalid, resetting fruitRecords.");
        setFruitRecords([]);
      }
    }
  }, [localState.data]);

  useEffect(() => {
    interstitial.load();

    const onAdLoaded = () => setIsAdLoaded(true);
    const onAdClosed = () => {
      setIsAdLoaded(false);
      setIsShowingAd(false);
      interstitial.load(); // Reload ad for the next use
    };
    const onAdError = (error) => {
      setIsAdLoaded(false);
      setIsShowingAd(false);
      console.error('Ad Error:', error);
    };

    const loadedListener = interstitial.addAdEventListener(AdEventType.LOADED, onAdLoaded);
    const closedListener = interstitial.addAdEventListener(AdEventType.CLOSED, onAdClosed);
    const errorListener = interstitial.addAdEventListener(AdEventType.ERROR, onAdError);

    return () => {
      loadedListener();
      closedListener();
      errorListener();
    };
  }, []);

  const showInterstitialAd = (callback) => {
    if (isAdLoaded && !isShowingAd && !localState.isPro) {
      setIsShowingAd(true);
      try {
        interstitial.show();
        interstitial.addAdEventListener(AdEventType.CLOSED, callback);
      } catch (error) {
        console.error('Error showing interstitial ad:', error);
        setIsShowingAd(false);
        callback(); // Proceed with fallback in case of error
      }
    } else {
      callback(); // If ad is not loaded, proceed immediately
    }
  };

  const openDrawer = (section) => {
    const wantsItemCount = wantsItems.filter((item) => item !== null).length;
    triggerHapticFeedback('impactLight');
    if (section === 'wants' && wantsItemCount === 1 && !isShowingAd) {
      showInterstitialAd(() => {
        setSelectedSection(section);
        setIsDrawerVisible(true);
      });
    } else {
      // Open drawer without showing the ad
      setSelectedSection(section);
      setIsDrawerVisible(true);

    }
  };


  const closeDrawer = () => {
    setIsDrawerVisible(false);
  };

  const updateTotal = (item, section, add = true, isNew = false) => {
    // console.log(item);

    // Only update price if item.Type is NOT "p"
    const priceChange =  add
      ? (item.Price ?? 0)  // If item.Price is undefined/null, default to 0
      : -(item.Price ?? 0);
  

    // Update value only if item.Type isNew
    const valueChange = isNew
      ? (add ? (isNaN(item.Value) ? 0 : item.Value) : -(isNaN(item.Value) ? 0 : item.Value))
      : 0;

    if (section === 'has') {
      setHasTotal((prev) => ({
        price: prev.price + priceChange,
        value: prev.value + valueChange,
      }));
    } else {
      setWantsTotal((prev) => ({
        price: prev.price + priceChange,
        value: prev.value + valueChange,
      }));
    }
  };


  const formatName = (name) => {
    let formattedName = name.replace(/^\+/, '');
    formattedName = formattedName.replace(/\s+/g, '-');
    return formattedName;
  }
  const selectItem = (item) => {
    // console.log(item)
    triggerHapticFeedback('impactLight');
    const newItem = { ...item, usePermanent: false };
    const updateItems = selectedSection === 'has' ? [...hasItems] : [...wantsItems];
    const nextEmptyIndex = updateItems.indexOf(null);
    if (nextEmptyIndex !== -1) {
      updateItems[nextEmptyIndex] = newItem;
    } else {
      updateItems.push(newItem);
    }
    if (selectedSection === 'has') {
      setHasItems(updateItems);
      updateTotal(newItem, 'has', true, true);
    } else {
      setWantsItems(updateItems);
      updateTotal(newItem, 'wants', true, true);
    }
    closeDrawer();

  };

  const removeItem = (index, isHas) => {
    triggerHapticFeedback('impactLight');
    const section = isHas ? 'has' : 'wants';
    const items = isHas ? hasItems : wantsItems;
    const updatedItems = [...items];
    const item = updatedItems[index];

    if (item) {
      updatedItems[index] = null;
      const filteredItems = updatedItems.filter((item, i) => item !== null || i < 4);
      if (isHas) setHasItems(filteredItems);
      else setWantsItems(filteredItems);
      updateTotal(item, section, false, true);
    }
  };

  const filteredData = fruitRecords.filter((item) =>
    item.Name.toLowerCase().includes(searchText.toLowerCase())
  );


  // console.log(filteredData)
  const profitLoss = wantsTotal.price - hasTotal.price;
  const isProfit = profitLoss >= 0;
  const neutral = profitLoss === 0;


  const captureAndSave = async () => {
    if (!viewRef.current) {
      console.error('View reference is undefined.');
      return;
    }

    try {
      // Capture the view as an image
      const uri = await captureRef(viewRef.current, {
        format: 'png',
        quality: 0.8,
      });

      // Generate a unique file name
      const timestamp = new Date().getTime(); // Use the current timestamp
      const uniqueFileName = `screenshot_${timestamp}.png`;

      // Determine the path to save the screenshot
      const downloadDest = Platform.OS === 'android'
        ? `${RNFS.ExternalDirectoryPath}/${uniqueFileName}`
        : `${RNFS.DocumentDirectoryPath}/${uniqueFileName}`;

      // Save the captured image to the determined path
      await RNFS.copyFile(uri, downloadDest);

      // console.log(`Screenshot saved to: ${downloadDest}`);

      return downloadDest;
    } catch (error) {
      console.error('Error capturing screenshot:', error);
      // Alert.alert(t("home.alert.error"), t("home.screenshot_error"));
      showMessage({
        message: t("home.alert.error"),
        description: t("home.screenshot_error"),
        type: "danger",
      });
    }
  };



  const proceedWithScreenshotShare = async () => {
    triggerHapticFeedback('impactLight');
    logEvent(analytics, `${platform}_screenshot_share`);
    if (hasItems.filter(Boolean).length === 0 || wantsItems.filter(Boolean).length === 0) {
      // Alert.alert(t("home.alert.error"), t("home.alert.missing_items_error"));
      showMessage({
        message: t("home.alert.error"),
        description: t("home.alert.missing_items_error"),
        type: "danger",
      });
      return;
    }
    try {
      const filePath = await captureAndSave();

      if (filePath) {
        const shareOptions = {
          title: t("home.screenshot_title"),
          url: `file://${filePath}`,
          type: 'image/png',
        };

        Share.open(shareOptions)
          .then((res) => console.log('Share Response:', res))
          .catch((err) => console.log('Share Error:', err));
      }
    } catch (error) {
      // console.log('Error sharing screenshot:', error);
    }
  };

  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  return (
    <>
      <GestureHandlerRootView>

        <View style={styles.container} key={language}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {showNotification && <View style={[styles.notification]}>
              <Text style={styles.text}>A new update is available! Please update your app.</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeButtonNotification}>
                <Icon name="close-outline" size={18} color="white" />
                {/* <Text>ssssefrrevrvtvtvrvrvrvervrvervrevrmrelxjferofmerihxoerghorgorhforxmzhrzgroh,gmrhzrhzgmrmhmzrhmzirhmmirmhzizrhzmizrzmzrhohhg</Text> */}
              </TouchableOpacity>
            </View>}
            {pinnedMessages.length > 0 && pinnedMessages.map((message, index) => (
              <View key={index} style={styles.notification}>
                <Text style={styles.text}>{message.text}</Text>
                <TouchableOpacity onPress={() => onClosePinMessage(index)} style={styles.closeButtonNotification}>
                  <Icon name="close-outline" size={18} color="white" />
                </TouchableOpacity>
              </View>
            ))}



            <ViewShot ref={viewRef} style={styles.screenshotView}>
              <View style={styles.summaryContainer}>
                <View style={[styles.summaryBox, styles.hasBox]}>
                  <Text style={[styles.summaryText]}>{t('home.you')}</Text>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', height: 1, alignSelf: 'center' }} />
                  <Text style={styles.priceValue}>{t('home.price')}: ${hasTotal.price?.toLocaleString()}</Text>
                  <Text style={styles.priceValue}>{t('home.value')}: {hasTotal.value?.toLocaleString()}</Text>
                </View>
                <View style={[styles.summaryBox, styles.wantsBox]}>
                  <Text style={styles.summaryText}>{t('home.them')}</Text>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', height: 1, alignSelf: 'center' }} />
                  <Text style={styles.priceValue}>{t('home.price')}: ${wantsTotal.price?.toLocaleString()}</Text>
                  <Text style={styles.priceValue}>{t('home.value')}: {wantsTotal.value?.toLocaleString()}</Text>
                </View>
              </View>
              <View style={styles.profitLossBox}>
                <Text style={[styles.profitLossText, { color: selectedTheme.colors.text }]}>
                  {isProfit ? t('home.profit') : t('home.loss')}:
                </Text>
                <Text style={[styles.profitLossValue, { color: isProfit ? config.colors.hasBlockGreen : config.colors.wantBlockRed }]}>
                  ${Math.abs(profitLoss).toLocaleString()}
                </Text>
                {!neutral && <Icon
                  name={isProfit ? 'arrow-up-outline' : 'arrow-down-outline'}
                  size={20}
                  color={isProfit ? config.colors.hasBlockGreen : config.colors.wantBlockRed}
                  style={styles.icon}
                />}
              </View>

              <Text style={[styles.sectionTitle, { color: selectedTheme.colors.text }]}>{t('home.you')}</Text>
              <View style={styles.itemRow}>
                {/* <TouchableOpacity onPress={() => { openDrawer('has') }} style={styles.addItemBlock}>
                  <Icon name="add-circle" size={40} color="white" />
                  <Text style={styles.itemText}>{t('home.add_item')}</Text>
                </TouchableOpacity> */}
                {hasItems?.map((item, index) => (
                  <TouchableOpacity key={index} style={[styles.addItemBlockNew, { backgroundColor: config.colors.primary }]} onPress={() => { openDrawer('has') }} disabled={item !== null}>
                    {item ? (
                      <>
                        <Image
                          source={{ uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.Name)}_Icon.webp` }}
                          style={[styles.itemImageOverlay,
                          { backgroundColor: item.Type === 'p' ? '#FFCC00' : '' }
                          ]}
                        />
                        <Text style={[styles.itemText, { color: 'white' }]}>${item.usePermanent ? item.Permanent?.toLocaleString() : item.Value?.toLocaleString()}</Text>
                        <Text style={[styles.itemText, { color: 'white' }]}>{item.Name}</Text>
                        {item.Type === 'p' && <Text style={styles.perm}>P</Text>}
                        <TouchableOpacity onPress={() => removeItem(index, true)} style={styles.removeButton}>
                          <Icon name="close-outline" size={20} color="white" />
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <Icon name="add-circle" size={30} color="white" />
                        <Text style={styles.itemText}>{t('home.add_item')}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.divider}>
                <Image
                  source={require('../../assets/reset.png')} // Replace with your image path
                  style={{ width: 20, height: 20, tintColor: 'white' }} // Customize size and color
                  onTouchEnd={resetState} // Add event handler
                />
              </View>

              <Text style={[styles.sectionTitle, { color: selectedTheme.colors.text }]}>{t('home.them')}</Text>
              <View style={styles.itemRow}>
                {/* <TouchableOpacity onPress={() => { openDrawer('wants'); }} style={styles.addItemBlockNew}>
                  <Icon name="add-circle" size={40} color="white" />
                  <Text style={styles.itemText}>{t('home.add_item')}</Text>
                </TouchableOpacity> */}
                {wantsItems?.map((item, index) => (
                  <TouchableOpacity key={index} style={[styles.addItemBlockNew, { backgroundColor: config.colors.primary }]} onPress={() => { openDrawer('wants'); }} disabled={item !== null}>
                    {item ? (
                      <>
                        <Image
                          source={{ uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.Name)}_Icon.webp` }}
                          style={[styles.itemImageOverlay, { backgroundColor: item?.Type === 'p' ? '#FFCC00' : config.colors.primary }]}
                        />
                        <Text style={[styles.itemText, { color: 'white' }]}>${item.usePermanent ? item.Permanent?.toLocaleString() : item.Value?.toLocaleString()}</Text>
                        <Text style={[styles.itemText, { color: 'white' }]}>{item.Name}</Text>
                        {item.Type === 'p' && <Text style={styles.perm}>P</Text>}
                        <TouchableOpacity onPress={() => removeItem(index, false)} style={styles.removeButton}>
                          <Icon name="close-outline" size={20} color="white" />
                        </TouchableOpacity>
                      </>

                    ) : (
                      <>
                        <Icon name="add-circle" size={30} color="white" />
                        <Text style={styles.itemText}>{t('home.add_item')}</Text>
                      </>
                      // <Text style={styles.itemPlaceholder}>{t('home.empty')}</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </ViewShot>
            <View style={styles.createtrade} >
              <TouchableOpacity style={styles.createtradeButton} onPress={handleCreateTradePress}><Text style={{ color: 'white' }}>{t('home.create_trade')}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.shareTradeButton} onPress={proceedWithScreenshotShare}><Text style={{ color: 'white' }}>{t('home.share_trade')}</Text></TouchableOpacity></View>
          </ScrollView>
          <Modal
            visible={isDrawerVisible}
            transparent={true}
            animationType="slide"
            onRequestClose={closeDrawer}
          >
            <Pressable style={styles.modalOverlay} onPress={closeDrawer} />
            <ConditionalKeyboardWrapper>
              <View>

                <View style={[styles.drawerContainer, { backgroundColor: isDarkMode ? '#3B404C' : 'white' }]}>

                  <View style={{
                    flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10,
                  }}

                  >

                    <TextInput
                      style={styles.searchInput}
                      placeholder={t('home.search_placeholder')}
                      value={searchText}
                      onChangeText={setSearchText}
                      placeholderTextColor={selectedTheme.colors.text}

                    />
                    <TouchableOpacity onPress={closeDrawer} style={styles.closeButton}>
                      <Text style={styles.closeButtonText}>{t('home.close')}</Text>
                    </TouchableOpacity></View>
                  <FlatList
                    onScroll={() => Keyboard.dismiss()}
                    onTouchStart={() => Keyboard.dismiss()}
                    keyboardShouldPersistTaps="handled" // Ensures taps o

                    data={filteredData}
                    keyExtractor={(item) => item.Name}
                    renderItem={({ item }) => (
                      <TouchableOpacity style={[styles.itemBlock, { backgroundColor: config.colors.primary }]} onPress={() => selectItem(item)}>
                        <>
                          <Image
                            source={{ uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.Name)}_Icon.webp` }}
                            style={[styles.itemImageOverlay, { backgroundColor: item.Type === 'p' ? '#FFCC00' : '' }]}
                          />
                          <Text style={[[styles.itemText, { color: 'white' }]]}>${item.Value?.toLocaleString()}</Text>
                          <Text style={[[styles.itemText, { color: 'white' }]]}>{item.Name}</Text>
                          {item.Type === 'p' && <Text style={styles.perm}>P</Text>}
                        </>
                      </TouchableOpacity>
                    )}
                    numColumns={3}
                    contentContainerStyle={styles.flatListContainer}
                    columnWrapperStyle={styles.columnWrapper}

                  />
                </View>
              </View>
            </ConditionalKeyboardWrapper>
          </Modal>
          <Modal
            visible={modalVisible}
            transparent
            animationType="slide"
            onRequestClose={() => setModalVisible(false)} // Close modal on request
          >
            <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)} />
            <ConditionalKeyboardWrapper>
              <View>
                <View style={[styles.drawerContainer, { backgroundColor: isDarkMode ? '#3B404C' : 'white' }]}>
                  <Text style={styles.modalMessage}>
                    {t("home.trade_description")}
                  </Text>
                  <Text style={styles.modalMessagefooter}>
                    {t("home.trade_description_hint")}
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder={t("home.write_description")}
                    maxLength={40}
                    value={description}
                    onChangeText={setDescription}
                  />
                  <View style={styles.buttonContainer}>
                    <TouchableOpacity
                      style={[styles.button, styles.cancelButton]}
                      onPress={() => setModalVisible(false)}
                    >
                      <Text style={styles.buttonText}>{t('home.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, styles.confirmButton]}
                      onPress={handleCreateTrade}
                      disabled={isSubmitting}
                    >
                      <Text style={styles.buttonText}>{isSubmitting ? t('home.submit') : t('home.confirm')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </ConditionalKeyboardWrapper>
          </Modal>

          <SignInDrawer
            visible={isSigninDrawerVisible}
            onClose={() => setIsSigninDrawerVisible(false)}
            selectedTheme={selectedTheme}
            message={t("home.alert.sign_in_required")}

          />
        </View>
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
}
const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
      paddingBottom: 5
    },

    summaryContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 20,
    },
    summaryBox: {
      width: '48%',
      padding: 10,
      borderRadius: 10,
    },
    hasBox: {
      backgroundColor: config.colors.hasBlockGreen,
    },
    wantsBox: {
      backgroundColor: config.colors.wantBlockRed,
    },
    summaryText: {
      fontSize: 18,
      color: 'white',
      textAlign: 'center',
      fontFamily: 'Lato-Bold',

    },
    priceValue: {
      color: 'white',
      textAlign: 'center',
      marginTop: 5,
      fontFamily: 'Lato-Bold',

    },
    sectionTitle: {
      fontSize: 16,
      marginBottom: 10,
      fontFamily: 'Lato-Bold',

    },
    itemRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginBottom: 10,

    },
    addItemBlockNew: {
      width: '48%',
      height: 100,
      backgroundColor: config.colors.secondary,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 10,
      marginBottom: 5,
    },
    addItemBlock: {
      width: '32%',
      height: 100,
      backgroundColor: config.colors.secondary,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 10,
      marginBottom: 10,
    },
    itemBlock: {
      width: '32%',
      height: 110,
      backgroundColor: config.colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 10,
      marginBottom: 10,
      position: 'relative',
      ...(!config.isNoman && {
        borderWidth: 5,
        borderColor: config.colors.hasBlockGreen,
      }),
    },

    itemText: {
      color: 'white',
      textAlign: 'center',
      fontFamily: 'Lato-Bold',
      fontSize: 14
    },
    itemPlaceholder: {
      color: '#CCC',
      textAlign: 'center',
    },
    removeButton: {
      position: 'absolute',
      top: 1,
      right: 1,
      backgroundColor: config.colors.wantBlockRed,
      borderRadius: 50,
    },
    divider: {
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: config.colors.primary,
      margin: 'auto',
      borderRadius: 24,
      padding: 5,
    },
    drawerContainer: {
      borderTopLeftRadius: 10,
      borderTopRightRadius: 10,
      paddingHorizontal: 10,
      paddingTop: 20,
      maxHeight: 400,
      overflow: 'hidden',
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
    },

    drawerTitle: {
      fontSize: 18,
      textAlign: 'center',
      fontFamily: 'Lato-Bold'
    },
    profitLossBox: { flexDirection: 'row', justifyContent: 'center', marginVertical: 10, alignItems: 'center' },
    profitLossText: { fontSize: 16, fontFamily: 'Lato-Bold' },
    profitLossValue: { fontSize: 16, marginLeft: 5, fontFamily: 'Lato-Bold' },
    modalOverlay: {
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      flex: 1,
    },
    searchInput: {
      width: '75%',
      borderColor: 'grey',
      borderWidth: 1,
      borderRadius: 5,
      height: 48,
      borderColor: '#333',
      borderWidth: 1,
      borderRadius: 5,
      paddingHorizontal: 10,
      backgroundColor: '#fff',
      color: '#000',
    },
    closeButton: {
      backgroundColor: config.colors.wantBlockRed,
      padding: 10,
      borderRadius: 5,
      width: '22%',
      alignItems: 'center',
      justifyContent: 'center'
    },
    closeButtonText: {
      color: 'white',
      textAlign: 'center',
      fontFamily: 'Lato-Regular',
      fontSize: 12
    },
    flatListContainer: {
      justifyContent: 'space-between',
      paddingBottom: 20
    },
    columnWrapper: {
      flex: 1,
      justifyContent: 'space-around',
    },
    itemImageOverlay: {
      width: 50,
      height: 50,
      borderRadius: 5,
    },
    switchValue: {
      backgroundColor: 'lightgreen',
      flexDirection: 'row',
      paddingVertical: 0,
      paddingHorizontal: 10,
      borderRadius: 20,
      margin: 5,
      alignItems: 'center'
    },
    switchValueText: {
      fontSize: 10,
      padding: 3,
      fontFamily: 'Lato-Regular',
      color: 'black'

    },
    captureButton: { backgroundColor: '#3E8BFC', padding: 10, borderRadius: 8, alignItems: 'center', marginTop: 20, alignSelf: 'center' },
    captureButtonText: { color: 'white', fontFamily: 'Lato-Bold', fontSize: 14 },
    captureView: { backgroundColor: '#fff', padding: 10, borderRadius: 10 },

    screenshotView: {
      padding: 10,
      flex: 1,
      paddingVertical: 10
    },
    float: {
      position: 'absolute',
      right: 5,
      bottom: 5,
      // width:40,
      zIndex: 1,
      // height:40,
      // backgroundColor:'red'

    },
    titleText: {
      fontFamily: 'Lato-Regular',
      fontSize: 10
    },
    loaderContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    loaderText: {
      fontSize: 16,
      fontFamily: 'Lato-Bold',
    },
    noDataContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#f9f9f9',
    },
    noDataText: {
      fontSize: 16,
      color: 'gray',
      fontFamily: 'Lato-Bold',
    },
    createtrade: {
      alignSelf: 'center',
      justifyContent: 'center',
      flexDirection: 'row'
    },
    createtradeButton: {
      backgroundColor: config.colors.hasBlockGreen,
      alignSelf: 'center',
      padding: 10,
      justifyContent: 'center',
      flexDirection: 'row',
      minWidth: 120,
      borderTopStartRadius: 20,
      borderBottomStartRadius: 20,
      marginRight: 1
    },
    shareTradeButton: {
      backgroundColor: config.colors.wantBlockRed,
      alignSelf: 'center',
      padding: 10,
      flexDirection: 'row',
      justifyContent: 'center',
      minWidth: 120,
      borderTopEndRadius: 20,
      borderBottomEndRadius: 20,
      marginLeft: 1
    },

    modalMessage: {
      fontSize: 12,
      marginBottom: 4,
      color: isDarkMode ? 'white' : 'black',
      fontFamily: 'Lato-Regular'
    },
    modalMessagefooter: {
      fontSize: 10,
      marginBottom: 10,
      color: isDarkMode ? 'grey' : 'grey',
      fontFamily: 'Lato-Regular'
    },
    input: {
      width: '100%',
      height: 40,
      borderColor: 'gray',
      borderWidth: 1,
      borderRadius: 5,
      paddingHorizontal: 10,
      marginBottom: 20,
      color: isDarkMode ? 'white' : 'black',
      fontFamily: 'Lato-Ragular'
    },
    buttonContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
      marginBottom: 10,
      paddingHorizontal: 20

    },
    button: {
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 5,
    },
    cancelButton: {
      backgroundColor: config.colors.wantBlockRed,
    },
    confirmButton: {
      backgroundColor: config.colors.hasBlockGreen,
    },
    buttonText: {
      color: 'white',
      fontSize: 14,
      fontWeight: 'bold',
    },

    perm: {
      position: 'absolute',
      top: 2,
      left: 10,
      color: 'lightgrey',
      fontFamily: 'Lato-Bold',
      color: 'white',
    },
    notification: {
      justifyContent: "space-between",
      padding: 12,
      paddingTop: 20,
      backgroundColor: config.colors.secondary,
      marginHorizontal: 10,
      marginTop: 10,
      borderRadius: 8
    },
    text: {
      color: "white",
      fontSize: 12,
      fontFamily: "Lato-Regular",
      lineHeight: 12
    },
    closeButtonNotification: {
      marginLeft: 10,
      padding: 5,
      position: 'absolute',
      top: 0,
      right: 0
    },

  });

export default HomeScreen