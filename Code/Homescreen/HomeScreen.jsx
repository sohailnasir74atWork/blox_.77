import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, FlatList, TextInput, Image,  Keyboard, Pressable, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import ViewShot from 'react-native-view-shot';
import { useGlobalState } from '../GlobelStats';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import config from '../Helper/Environment';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../Helper/HepticFeedBack';
import { getDatabase, ref } from '@react-native-firebase/database';
import { useLocalState } from '../LocalGlobelStats';
import SignInDrawer from '../Firebase/SigninDrawer';
import firestore from '@react-native-firebase/firestore';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../Translation/LanguageProvider';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import DeviceInfo from 'react-native-device-info';
import ShareTradeModal from '../Trades/SharetradeModel';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';


const HomeScreen = ({ selectedTheme }) => {
  const { theme, user, analytics, appdatabase } = useGlobalState();
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
  const [isAdVisible, setIsAdVisible] = useState(true);
  const { triggerHapticFeedback } = useHaptic();
  const { localState } = useLocalState()
  const [modalVisible, setModalVisible] = useState(false);
  const [description, setDescription] = useState('');
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { language } = useLanguage();
  const [showNotification, setShowNotification] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [lastTradeTime, setLastTradeTime] = useState(null); // 🔄 Store last trade timestamp locally
  const [openShareModel, setOpenShareModel] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [type, setType] = useState(null); // 🔄 Store last trade timestamp locally
  const platform = Platform.OS.toLowerCase();
  const { t } = useTranslation();
  // const pinnedMessagesRef = useMemo(() => ref(appdatabase, 'pin_messages'), []);



  const CURRENT_APP_VERSION = DeviceInfo.getVersion();
  // useEffect(() => {
  //   let isMounted = true; // ✅ Track mounted state
  //   const checkForUpdate = async () => {
  //     try {
  //       const database = getDatabase();
  //       const platformKey = Platform.OS === "ios" ? "ios_app_version" : (config.isNoman ? "noman_app_version" : 'waqas_app_version');
  //       const versionRef = ref(database, platformKey);
  //       const snapshot = await get(versionRef);
  //       if (snapshot.exists() && snapshot.val().app_version !== CURRENT_APP_VERSION) {
  //         setShowNotification(true);
  //       } else {
  //         setShowNotification(false);
  //       }
  //     } catch (error) {
  //       console.error("🔥 Error checking for updates:", error);
  //     }
  //   };
  //   checkForUpdate();
  //   return () => {
  //     isMounted = false; // ✅ Prevent updates after unmount
  //   };
  // }, []);

  const handleLoginSuccess = () => {
    setIsSigninDrawerVisible(false);
  };

 

  // useEffect(() => {
  //   const loadPinnedMessages = async () => {
  //     try {
  //       const snapshot = await pinnedMessagesRef.once('value');
  //       if (snapshot.exists()) {
  //         const data = snapshot.val();
  //         const parsedPinnedMessages = Object.entries(data).map(([key, value]) => ({
  //           firebaseKey: key, // Use the actual Firebase key here
  //           ...value,
  //         }));
  //         setPinnedMessages(parsedPinnedMessages); // Store the parsed messages with the Firebase key
  //       } else {
  //         setPinnedMessages([]); // No pinned messages
  //       }
  //     } catch (error) {
  //       console.error('Error loading pinned messages:', error);
  //       Alert.alert(t('home.alert.error'), 'Could not load pinned messages. Please try again.');
  //     }
  //   };

  //   loadPinnedMessages();
  //   return () => pinnedMessagesRef.off(); // ✅ Clean up Firebase reference

  // }, [pinnedMessagesRef]);
  // Run this once when the app starts





  // const onClose = () => { setShowNotification(false) }
  // const onClosePinMessage = (index) => {
  //   setPinnedMessages((prevMessages) => prevMessages.filter((_, i) => i !== index));
  // };
  const isDarkMode = theme === 'dark'
  const viewRef = useRef();

  const resetState = () => {
    triggerHapticFeedback('impactLight');
    setSelectedSection(null);
    setHasTotal({ price: 0, value: 0 });
    setWantsTotal({ price: 0, value: 0 });
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

  const handleCreateTradePress = async (type) => {
    if (!user.id & type === 'create') {
      setIsSigninDrawerVisible(true)
      return;
    }
    if (hasItems.filter(Boolean).length === 0 && wantsItems.filter(Boolean).length === 0) {
      showErrorMessage(
        t("home.alert.error"),
        t("home.alert.missing_items_error")
      );
      return;
    }
    if (type === 'create') {
      setType('create')
    } else {
      setType('share')
    }
    const tradeRatio = wantsTotal.value / hasTotal.value;

    if (
      tradeRatio < 0.05 &&
      hasItems.filter(Boolean).length > 0 &&
      wantsItems.filter(Boolean).length > 0 && type !== 'share'
    ) {
      showErrorMessage(
        t("home.unfair_trade"),
        t('home.unfair_trade_description')
      );
      return;
    }


    if (tradeRatio > 1.95 && type !== 'share' &&
      hasItems.filter(Boolean).length > 0 &&
      wantsItems.filter(Boolean).length > 0) {
      showErrorMessage(
        t('home.invalid_trade'),
        t('home.invalid_trade_description')
      );
      return;
    }

    setModalVisible(true)
  };





  const handleCreateTrade = async () => {
    if (isSubmitting) {
      // console.log("🚫 Trade submission blocked: Already submitting.");
      return; // Prevent duplicate submissions
    }

    setIsSubmitting(true);
    // console.log("🚀 Trade submission started...");
    try {
      const database = getDatabase();
      const avgRatingSnap = await ref(database, `averageRatings/${user.id}`).once('value');
      const avgRatingData = avgRatingSnap.val();
      
      const userRating = avgRatingData?.value || null;
      const ratingCount = avgRatingData?.count || 0; // 👈 total users who rated
      

      // ✅ Build new trade object
      let newTrade = {
        userId: user?.id || "Anonymous",
        traderName: user?.displayName || "Anonymous",
        avatar: user?.avatar || null,
        isPro: localState.isPro,
        isFeatured: false,
        hasItems: hasItems.filter(item => item && item.Name).map(item => ({ name: item.Name, type: item.Type, value: item.Value })),
        wantsItems: wantsItems.filter(item => item && item.Name).map(item => ({ name: item.Name, type: item.Type, value: item.Value })),
        hasTotal: { price: hasTotal?.price || 0, value: hasTotal?.value || 0 },
        wantsTotal: { price: wantsTotal?.price || 0, value: wantsTotal?.value || 0 },
        description: description || "",
        timestamp: firestore.FieldValue.serverTimestamp(),
        rating: userRating,
        ratingCount: ratingCount
        
      };
      if (type === 'share') {
        setModalVisible(false); // Close modal
        setSelectedTrade(newTrade);
        setOpenShareModel(true)
        mixpanel.track("Start Sharing");

      } else {

        // console.log("📌 New trade object created:", newTrade);

        // ✅ Check last trade locally before querying Firestore
        const now = Date.now();
        if (lastTradeTime && now - lastTradeTime < 1 * 1 * 60 * 1000) {
          showErrorMessage(
            t("home.alert.error"),
            "Please wait for 1 minut before creating new trade"
          );
          setIsSubmitting(false);
          return;
        }

        // console.log("✅ No duplicate trade found. Proceeding with submission...");

        // ✅ Submit trade
        await tradesCollection.add(newTrade);
        // console.log("🎉 Trade successfully submitted!");

        setModalVisible(false); // Close modal
        const callbackfunction = () => {
          showSuccessMessage(
            t("home.alert.success"),
            "Your trade has been posted successfully!"
          );
        };

        // ✅ Update last trade time locally
        setLastTradeTime(now);
        mixpanel.track("Trade Created", { user: user?.id });

        if (!localState.isPro) {
          InterstitialAdManager.showAd(callbackfunction);
        } else {
          callbackfunction()
        }
      }
    } catch (error) {
      console.error("🔥 Error creating trade:", error);
      showErrorMessage(
        t("home.alert.error"),
        "Something went wrong while posting the trade."
      );
    } finally {
      // console.log("🔄 Resetting submission state...");
      setIsSubmitting(false); // Reset submission state
    }
  };

  const adjustedData = (fruitRecords) => {
    let transformedData = [];

    fruitRecords.forEach((fruit) => {
      if (!fruit.name) return; // Skip invalid entries
// console.log(fruit)
      const permValueInvalid = fruit.permValue === 0 || fruit.permValue === "0" || fruit.permValue === "N/A";
      const notperavailable = fruit.rarity == 'gamepass';

      // ✅ If both permValue & value exist (permValue must be valid)
      if (fruit.permValue !== undefined && fruit.value !== undefined) {
       if(!notperavailable){ transformedData.push({
          Name: fruit.name,
          Value: permValueInvalid ? 0 :fruit.permValue,
          Type: 'p', // Permanent type
          Price: 0
        });}

        transformedData.push({
          Name: fruit.name,
          Value: fruit.value,
          Type: 'n', // Normal type
          Price: fruit.beli || 0
        });

        // console.log(`✅ Added ${fruit.name}: Permanent (${fruit.permValue}), Normal (${fruit.value})`);

      } else if ( fruit.permValue !== undefined) {
        // ✅ If only permValue exists (must be valid)
        transformedData.push({
          Name: fruit.name,
          Value: permValueInvalid ? 0 :fruit.permValue,
          Type: 'p', // Permanent type
          Price: 0
        });

        // console.log(`⚠️ Only Permanent found for ${fruit.name}: ${fruit.permValue}`);

      } else if (fruit.value !== undefined) {
        // ✅ If only value exists
        transformedData.push({
          Name: fruit.name,
          Value: fruit.value,
          Type: 'n', // Normal type
          Price: fruit.beli || 0
        });

        // console.log(`⚠️ Only Normal found for ${fruit.name}: ${fruit.value}`);
      } else {
        console.warn(`🚨 No valid values found for ${fruit.name}, skipping!`);
      }
    });

    return transformedData;
  };




  useEffect(() => {
    let isMounted = true; // Track mounted state

    const parseAndSetData = () => {
      if (!localState.data) return;

      try {
        let parsedData = localState.data;

        // Ensure `localState.data` is always an object
        if (typeof localState.data === 'string') {
          parsedData = JSON.parse(localState.data);
        }

        // Ensure `parsedData` is a valid object before using it
        if (parsedData && typeof parsedData === 'object' && Object.keys(parsedData).length > 0) {
          const formattedData = adjustedData(Object.values(parsedData));
          if (isMounted) {
            setFruitRecords(formattedData);
          }
        } else {
          if (isMounted) {
            setFruitRecords([]);
          }
        }
      } catch (error) {
        console.error("❌ Error parsing data:", error);
        if (isMounted) {
          setFruitRecords([]);
        }
      }
    };

    parseAndSetData();

    return () => {
      isMounted = false; // Cleanup on unmount
    };
  }, [localState.data]);


  const openDrawer = (section) => {
    const wantsItemCount = wantsItems.filter((item) => item !== null).length;
    triggerHapticFeedback('impactLight');

    const callbackfunction = () => {
      setSelectedSection(section);
      setIsDrawerVisible(true);
    };

    if (section === 'wants' && wantsItemCount === 1 && !localState.isPro) {
      InterstitialAdManager.showAd(callbackfunction);
    } else {
      callbackfunction(); // No ad needed
    }
  };



  const closeDrawer = () => {
    setIsDrawerVisible(false);
  };

  const updateTotal = (item, section, add = true, isNew = false) => {
    // console.log(item);

    // Convert `item.Price` and `item.Value` to numbers to prevent string concatenation
    const price = Number(item.Price) || 0; // Ensure it's a number or default to 0
    const value = Number(item.Value) || 0;

    // Only update price if item.Type is NOT "p"
    const priceChange = add ? price : -price;

    // Update value only if item.Type isNew
    const valueChange = isNew ? (add ? value : -value) : 0;

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
  const profitLoss = wantsTotal.value - hasTotal.value;
  const isProfit = profitLoss >= 0;
  const neutral = profitLoss === 0;

  const profitPercentage = hasTotal.value > 0
    ? ((profitLoss / hasTotal.value) * 100).toFixed(0)
    : 0;

  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const lastFilledIndexHas = hasItems.reduce((lastIndex, item, index) => (item ? index : lastIndex), -1);
  const lastFilledIndexWant = wantsItems.reduce((lastIndex, item, index) => (item ? index : lastIndex), -1);



  return (
    <>
      <GestureHandlerRootView>

        <View style={styles.container} key={language}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* {showNotification && <View style={[styles.notification]}>
              <Text style={styles.text}>A new update is available! Please update your app.</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeButtonNotification}>
                <Icon name="close-outline" size={18} color="white" />

              </TouchableOpacity>
            </View>}
            {pinnedMessages.length > 0 && pinnedMessages.map((message, index) => (
              <View key={index} style={styles.notification}>
                <Text style={styles.text}>{message.text}</Text>
                <TouchableOpacity onPress={() => onClosePinMessage(index)} style={styles.closeButtonNotification}>
                  <Icon name="close-outline" size={18} color="white" />
                </TouchableOpacity>
              </View>
            ))} */}



            <ViewShot ref={viewRef} style={styles.screenshotView}>
            {config.isNoman &&  <View style={styles.summaryContainer}>
                <View style={[styles.summaryBox, styles.hasBox]}>
                  <Text style={[styles.summaryText]}>{t('home.you')}</Text>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', height: 1, alignSelf: 'center' }} />
                  <Text style={styles.priceValue}>{t('home.value')}: {hasTotal.value?.toLocaleString()}</Text>
                  <Text style={styles.priceValue}>{t('home.price')}: ${hasTotal.price?.toLocaleString()}</Text>
                </View>
                <View style={[styles.summaryBox, styles.wantsBox]}>
                  <Text style={styles.summaryText}>{t('home.them')}</Text>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', height: 1, alignSelf: 'center' }} />
                  <Text style={styles.priceValue}>{t('home.value')}: {wantsTotal.value?.toLocaleString()}</Text>
                  <Text style={styles.priceValue}>{t('home.price')}: ${wantsTotal.price?.toLocaleString()}</Text>
                </View>
              </View>}
              <View style={styles.profitLossBox}>
                <Text style={[styles.profitLossText, { color: selectedTheme.colors.text }]}>
                  {isProfit ? t('home.profit') : t('home.loss')}:
                </Text>
                <Text style={[styles.profitLossValue, { color: isProfit ? config.colors.hasBlockGreen : config.colors.wantBlockRed }]}>
                  ${Math.abs(profitLoss).toLocaleString()} ({profitPercentage}%)
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

                {config.isNoman && hasItems?.map((item, index) => (
                  <TouchableOpacity key={index} style={[styles.addItemBlockNew, { backgroundColor: item?.Type === 'p' ? '#FFD700' : isDarkMode ? '#34495E' : '#CCCCFF' }]} onPress={() => { openDrawer('has') }} disabled={item !== null}>
                    {item ? (
                      <>
                        <Image
                          source={{ uri: item.Type !== 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.Name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(item.Name)}_Icon.webp` }}
                          style={[styles.itemImageOverlay,

                          ]}
                        />
                        <Text style={[styles.itemText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'white' : 'black') }
                        ]}>{item.usePermanent 
                          ? (Number(item.Permanent) === 0 ? "Special" : Number(item.Permanent).toLocaleString()) 
                          : (Number(item.Value) === 0 ? "Special" : Number(item.Value).toLocaleString())
                        }</Text>
                        <Text style={[styles.itemText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'white' : 'black') }
                        ]}>{item.Type === 'p' && 'Perm'}  {item.Name}</Text>
                        {/* {item.Type === 'p' && <Text style={styles.perm}>P</Text>} */}
                        <TouchableOpacity onPress={() => removeItem(index, true)} style={styles.removeButton}>
                          <Icon name="close-outline" size={18} color="white" />
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        {index === lastFilledIndexHas + 1 && <Icon name="add-circle" size={30} color="grey" />}
                        {index === lastFilledIndexHas + 1 && <Text style={styles.itemText}>{t('home.add_item')}</Text>}
                      </>
                    )}
                  </TouchableOpacity>
                ))}
                    {!config.isNoman && hasItems?.map((item, index) => (
                  <TouchableOpacity key={index} style={[styles.addItemBlockNewNoman,]} onPress={() => { openDrawer('has') }} disabled={item !== null}>
                    {item ? (
                      <>
                      <View style={{backgroundColor:'#1dc226', paddingVertical:6, borderTopLeftRadius:6, borderTopRightRadius:6}}>
                         <Text style={[styles.itemText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'black' : 'black') }
                        ]}>{item.Type === 'p' && 'Perm'}  {item.Name}</Text></View>
                        <Image
                          source={{ uri: item.Type !== 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.Name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(item.Name)}_Icon.webp` }}
                          style={[styles.itemImageOverlayNoman, {alignSelf:'center'}

                          ]}
                        />
                        <View style={{backgroundColor:'#fe01ea', paddingVertical:6, borderBottomLeftRadius:6, borderBottomRightRadius:6}}>
                        <Text style={[styles.itemText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'black' : 'black') }
                        ]}>${item.usePermanent 
                          ? (Number(item.Permanent) === 0 ? "Special" : Number(item.Permanent).toLocaleString()) 
                          : (Number(item.Value) === 0 ? "Special" : Number(item.Value).toLocaleString())
                        }</Text></View>
                     
                        {/* {item.Type === 'p' && <Text style={styles.perm}>P</Text>} */}
                        <TouchableOpacity onPress={() => removeItem(index, true)} style={styles.removeButton}>
                          <Icon name="close-outline" size={18} color="white" />
                        </TouchableOpacity>
                      </>
                    ) : (
                      <View style={{flex:1, justifyContent:'center', alignItems:'center'}}>
                        {index === lastFilledIndexHas + 1 && <Icon name="add-circle" size={30} color={isDarkMode ? "lightgrey" : 'grey' }/>}
                        {index === lastFilledIndexHas + 1 && <Text style={[styles.itemText, {color:isDarkMode ? "lightgrey" : 'grey'}]}>{t('home.add_item')}</Text>}
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.divider}>
                <Image
                  source={require('../../assets/reset.png')} // Replace with your image path
                  style={{ width: 18, height: 18, tintColor: 'white' }} // Customize size and color
                  onTouchEnd={resetState} // Add event handler
                />
              </View>

              <Text style={[styles.sectionTitle, { color: selectedTheme.colors.text }]}>{t('home.them')}</Text>
              <View style={[styles.itemRow, { marginBottom: 0 }]}>
                {/* <TouchableOpacity onPress={() => { openDrawer('wants'); }} style={styles.addItemBlockNew}>
                  <Icon name="add-circle" size={40} color="white" />
                  <Text style={styles.itemText}>{t('home.add_item')}</Text>
                </TouchableOpacity> */}
                {config.isNoman && wantsItems?.map((item, index) => (
                  <TouchableOpacity key={index} style={[styles.addItemBlockNew, { backgroundColor: item?.Type === 'p' ? '#FFD700' : isDarkMode ? '#34495E' : '#CCCCFF' }]} onPress={() => { openDrawer('wants'); }} disabled={item !== null}>
                    {item ? (
                      <>
                        <Image
                          source={{ uri: item.Type !== 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.Name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(item.Name)}_Icon.webp` }}
                          style={[styles.itemImageOverlay]}
                        />
                        <Text style={[styles.itemText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'white' : 'black') }
                        ]}>{item.usePermanent 
                          ? (Number(item.Permanent) === 0 ? "Special" : Number(item.Permanent).toLocaleString()) 
                          : (Number(item.Value) === 0 ? "Special" : Number(item.Value).toLocaleString())
                        }</Text>
                        <Text style={[styles.itemText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'white' : 'black') }
                        ]}>{item.Type === 'p' && 'Perm'} {item.Name}</Text>
                        {/* {item.Type === 'p' && <Text style={styles.perm}>P</Text>} */}
                        <TouchableOpacity onPress={() => removeItem(index, false)} style={styles.removeButton}>
                          <Icon name="close-outline" size={18} color="white" />
                        </TouchableOpacity>
                      </>

                    ) : (
                      <>
                        {index === lastFilledIndexWant + 1 && <Icon name="add-circle" size={30} color="grey" />}
                        {index === lastFilledIndexWant + 1 && <Text style={styles.itemText}>{t('home.add_item')}</Text>}
                      </>
                      // <Text style={styles.itemPlaceholder}>{t('home.empty')}</Text>
                    )}
                  </TouchableOpacity>
                ))}

{!config.isNoman && wantsItems?.map((item, index) => (
                  <TouchableOpacity key={index} style={[styles.addItemBlockNewNoman,]} onPress={() => { openDrawer('wants') }} disabled={item !== null}>
                    {item ? (
                      <>
                      <View style={{backgroundColor:'#1dc226', paddingVertical:6, borderTopLeftRadius:6, borderTopRightRadius:6}}>
                         <Text style={[styles.itemText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'black' : 'black') }
                        ]}>{item.Type === 'p' && 'Perm'}  {item.Name}</Text></View>
                        <Image
                          source={{ uri: item.Type !== 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.Name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(item.Name)}_Icon.webp` }}
                          style={[styles.itemImageOverlayNoman, {alignSelf:'center'}

                          ]}
                        />
                        <View style={{backgroundColor:'#fe01ea', paddingVertical:6, borderBottomLeftRadius:6, borderBottomRightRadius:6}}>
                        <Text style={[styles.itemText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'black' : 'black') }
                        ]}>${item.usePermanent 
                          ? (Number(item.Permanent) === 0 ? "Special" : Number(item.Permanent).toLocaleString()) 
                          : (Number(item.Value) === 0 ? "Special" : Number(item.Value).toLocaleString())
                        }</Text></View>
                     
                        {/* {item.Type === 'p' && <Text style={styles.perm}>P</Text>} */}
                        <TouchableOpacity onPress={() => removeItem(index, false)} style={styles.removeButton}>
                          <Icon name="close-outline" size={18} color="white" />
                        </TouchableOpacity>
                      </>
                    ) : (
                      <View style={{flex:1, justifyContent:'center', alignItems:'center'}}>
                        {index === lastFilledIndexWant + 1 && <Icon name="add-circle" size={30} color={isDarkMode ? "lightgrey" : 'grey'} />}
                        {index === lastFilledIndexWant + 1 && <Text style={[styles.itemText, {color:isDarkMode ? "lightgrey" : 'grey'}]}>{t('home.add_item')}</Text>}
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
              {!config.isNoman &&  <View style={styles.summaryContainer}>
                <View style={[styles.summaryBox, styles.hasBox]}>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', alignSelf: 'center', }} />
                  <View style={{justifyContent:'space-between', flexDirection:'row' }} >
                  <Text style={styles.priceValue}>{t('home.value')}:</Text>
                  <Text style={styles.priceValue}>${hasTotal.value?.toLocaleString()}</Text>
                  </View>
                  <View style={{justifyContent:'space-between', flexDirection:'row' }}>
                  <Text style={styles.priceValue}>{t('home.price')}:</Text>
                  <Text style={styles.priceValue}>${hasTotal.price?.toLocaleString()}</Text>
                  </View>
                </View>
                <View style={[styles.summaryBox, styles.wantsBox]}>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', alignSelf: 'center', }} />
                  <View style={{justifyContent:'space-between', flexDirection:'row' }} >
                  <Text style={styles.priceValue}>{t('home.value')}:</Text>
                  <Text style={styles.priceValue}>${wantsTotal.value?.toLocaleString()}</Text>
                  </View>
                  <View style={{justifyContent:'space-between', flexDirection:'row' }}>
                  <Text style={styles.priceValue}>{t('home.price')}:</Text>
                  <Text style={styles.priceValue}>${wantsTotal.price?.toLocaleString()}</Text>
                  </View>
                </View>
              </View>}
            </ViewShot>
            <View style={styles.createtrade} >
              <TouchableOpacity style={styles.createtradeButton} onPress={() => handleCreateTradePress('create')}><Text style={{ color: 'white' }}>{t('home.create_trade')}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.shareTradeButton} onPress={() => handleCreateTradePress('share')}><Text style={{ color: 'white' }}>{t('home.share_trade')}</Text></TouchableOpacity></View>
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
                      placeholderTextColor={isDarkMode ? 'white' : 'black'}

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
                      <TouchableOpacity style={[styles.itemBlock, { backgroundColor: item.Type === 'p' ? '#FFD700' : isDarkMode ? '#34495E' : '#CCCCFF' }]} onPress={() => selectItem(item)}>
                        <>
                          <Image
                            source={{ uri: item.Type !== 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.Name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(item.Name)}_Icon.webp` }}
                            style={[styles.itemImageOverlay]}
                          />
                          <Text style={[[styles.itemText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'white' : 'black') }
                          ]]}>${Number(item.Value)?.toLocaleString()}</Text>
                          <Text style={[[styles.itemText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'white' : 'black') }
                          ]]}>{item.Type === 'p' && 'Perm'} {item.Name}</Text>
                          {/* {item.Type === 'p' && <Text style={styles.perm}>P</Text>} */}
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
          <ShareTradeModal
            visible={openShareModel}
            onClose={() => setOpenShareModel(false)}
            tradeData={selectedTrade}
          />
          <SignInDrawer
            visible={isSigninDrawerVisible}
            onClose={handleLoginSuccess}
            selectedTheme={selectedTheme}
            screen='Chat'
            message={t("home.alert.sign_in_required")}

          />
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
}
const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
      paddingBottom: 5,
    },

    summaryContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    summaryBox: {
      width: config.isNoman ? '48%' : '49%',
      padding: 5,
      borderRadius: 8,
    },
    hasBox: {
      backgroundColor: config.colors.hasBlockGreen,
    },
    wantsBox: {
      backgroundColor: config.colors.wantBlockRed,
    },
    summaryText: {
      fontSize: 16,
      lineHeight: 20,
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
      fontSize: 14,
      marginBottom: 5,
      fontFamily: 'Lato-Bold',

    },
    itemRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginBottom: 5,

    },
    addItemBlockNew: {
      width: '48%',
      height: config.isNoman ? 80 : 110,
      backgroundColor: isDarkMode ? '#34495E' : '#CCCCFF', // Dark: darker contrast, Light: White
      borderWidth: Platform.OS === 'android' ? 0 : 1,
      borderColor: 'lightgrey',
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 8,
      marginBottom: 5,

    },
    addItemBlockNewNoman: {
      width: '49%',
      height: config.isNoman ? 80 : 110,
      backgroundColor: isDarkMode ? '#2d3337' : '#CCCCFF', // Dark: darker contrast, Light: White
      borderWidth: Platform.OS === 'android' ? 0 : 1,
      borderColor: 'lightgrey',
      justifyContent: 'space-between',
      // alignItems: 'center',
      borderRadius: 8,
      marginBottom: 5,

    },
    addItemBlock: {
      width: '32%',
      height: 85,
      backgroundColor: isDarkMode ? '#34495E' : '#CCCCFF', // Dark: darker contrast, Light: White
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 10,
      marginBottom: 10,
    },
    itemBlock: {
      width: '32%',
      height: 110,
      backgroundColor: isDarkMode ? '#34495E' : '#CCCCFF', // Dark: darker contrast, Light: White
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
      color: isDarkMode ? 'white' : 'black',
      textAlign: 'center',
      fontFamily: 'Lato-Bold',
      fontSize: 12
    },
    itemPlaceholder: {
      color: '#CCC',
      textAlign: 'center',
    },
    removeButton: {
      position: 'absolute',
      top: 2,
      right: 2,
      backgroundColor: config.colors.wantBlockRed,
      borderRadius: 50,
      opacity: .7
    },
    divider: {
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: config.colors.primary,
      margin: 'auto',
      borderRadius: 12,
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
      fontSize: 16,
      textAlign: 'center',
      fontFamily: 'Lato-Bold'
    },
    profitLossBox: { flexDirection: 'row', justifyContent: 'center', marginVertical: 0, alignItems: 'center' },
    profitLossText: { fontSize: 14, fontFamily: 'Lato-Bold' },
    profitLossValue: { fontSize: 14, marginLeft: 5, fontFamily: 'Lato-Bold' },
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
      width: 40,
      height: 40,
      borderRadius: 5,
    },
    itemImageOverlayNoman: {
      width: 50,
      height: 50,
      borderRadius: 5,
    },


    screenshotView: {
      padding: 10,
      flex: 1,
      // paddingVertical: 10,
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
      fontFamily: 'Lato-Bold',
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