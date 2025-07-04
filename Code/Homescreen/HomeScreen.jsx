import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, FlatList, TextInput, Image, Keyboard, Pressable, Platform } from 'react-native';
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
  const initialItems = [null, null, null, null, null, null];
  const [hasItems, setHasItems] = useState(initialItems);
  const [fruitRecords, setFruitRecords] = useState([]);
  const [wantsItems, setWantsItems] = useState(initialItems);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedSection, setSelectedSection] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [hasTotal, setHasTotal] = useState({ price: 0, value: 0 });
  const [wantsTotal, setWantsTotal] = useState({ price: 0, value: 0 });
  const { triggerHapticFeedback } = useHaptic();
  const { localState } = useLocalState()
  const [modalVisible, setModalVisible] = useState(false);
  const [description, setDescription] = useState('');
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { language } = useLanguage();
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [lastTradeTime, setLastTradeTime] = useState(null); // 🔄 Store last trade timestamp locally
  const [openShareModel, setOpenShareModel] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [type, setType] = useState(null); // 🔄 Store last trade timestamp locally
  const [selectedPetType, setSelectedPetType] = useState('All');
  const [isItemDetailsModalVisible, setItemDetailsModalVisible] = useState(false);  // To control the visibility of the modal
  const [selectedItemDetails, setSelectedItemDetails] = useState(null);  // Stores the selected item with additional data
  const [weight, setWeight] = useState('');  // Stores the weight input
  const [age, setAge] = useState('');  // Stores the age input
  const [units, setUnits] = useState(1);  // Stores the age input
  const [selectedMutations, setSelectedMutations] = useState([]);





  const { t } = useTranslation();
  const CATEGORIES =
    ['All', 'Pet', 'Gear', 'Fruit'];
  // const pinnedMessagesRef = useMemo(() => ref(appdatabase, 'pin_messages'), []);




  const handleLoginSuccess = () => {
    setIsSigninDrawerVisible(false);
  };


  const isDarkMode = theme === 'dark'
  const viewRef = useRef();

  const resetState = () => {
    triggerHapticFeedback('impactLight');
    setSelectedSection(null);
    setHasTotal({ price: 0, value: 0 });
    setWantsTotal({ price: 0, value: 0 });
    setHasItems([null, null, null, null, null, null]);
    setWantsItems([null, null, null, null, null, null]);
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
    // const tradeRatio = wantsTotal.value / hasTotal.value;

    // if (
    //   tradeRatio < 0.05 &&
    //   hasItems.filter(Boolean).length > 0 &&
    //   wantsItems.filter(Boolean).length > 0 && type !== 'share'
    // ) {
    //   showErrorMessage(
    //     t("home.unfair_trade"),
    //     t('home.unfair_trade_description')
    //   );
    //   return;
    // }


    // if (tradeRatio > 1.95 && type !== 'share' &&
    //   hasItems.filter(Boolean).length > 0 &&
    //   wantsItems.filter(Boolean).length > 0) {
    //   showErrorMessage(
    //     t('home.invalid_trade'),
    //     t('home.invalid_trade_description')
    //   );
    //   return;
    // }

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
        hasItems: hasItems,
        wantsItems: wantsItems,
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

  const handleMutationSelect = (mutation) => {
    if (selectedMutations.includes(mutation)) {
      setSelectedMutations(selectedMutations.filter(item => item !== mutation));
    } else {
      setSelectedMutations([...selectedMutations, mutation]);
    }
  };

  const adjustedData = (fruitRecords) => {
    let transformedData = [];

    fruitRecords.forEach((fruit) => {
      if (!fruit.name) return; // Skip invalid entries


      // ✅ If both permValue & value exist (permValue must be valid)
      if (fruit.id !== undefined) {
        transformedData.push({
          Name: formatNameNew(fruit.name),
          Value: fruit.value || 1,
          Image: fruit.picture,
          Type: fruit.category,
          Tier: fruit.tier,
        })


        // console.log(`⚠️ Only Normal found for ${formatNameNew(fruit.name)}: ${fruit.value}`);
      } else {
        console.warn(`🚨 No valid values found for ${formatNameNew(fruit.name)}, skipping!`);
      }
    });

    return transformedData;
  };


  const formatNameNew = (name) => {
    const formattedName = name
      .split('_')                           // Split on underscore
      .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize each word
      .join(' ');                           // Join with space
  
    // If the formatted name length is greater than 5 characters, truncate it and add "..."
    if (formattedName.length > 15) {
      return formattedName.slice(0, 15) + '...';  // Truncate to 5 characters and append '...'
    }
    
    return formattedName;  // Return the formatted name if it's 5 characters or less
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

  // console.log(fruitRecords, localState.data)
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

  // const updateTotal = (section) => {
  //   let totalValue = 0;

  //   // Calculate total value for the section (has or wants)
  //   const items = section === 'has' ? hasItems : wantsItems;

  //   // Loop through each item to calculate total
  //   items.forEach(item => {
  //     if (item !== null) {
  //       totalValue += item.Value || 0; // Add value to total, ensuring it's a number
  //     }
  //   });

  //   // Update the total state
  //   if (section === 'has') {
  //     setHasTotal((prev) => ({
  //       ...prev,
  //       value: totalValue,  // Set new value for hasTotal
  //       price: totalValue,  // Set price, if applicable
  //     }));
  //   } else {
  //     setWantsTotal((prev) => ({
  //       ...prev,
  //       value: totalValue,  // Set new value for wantsTotal
  //       price: totalValue,  // Set price, if applicable
  //     }));
  //   }
  // };





  const selectItem = (item) => {
    setSelectedItemDetails(item);  // Set the selected item
    setItemDetailsModalVisible(true); // Show the modal for input
    setIsDrawerVisible(false);  // Close the drawer
  };

  // Update Total function
  const updateTotal = (section) => {
    let totalValue = 0;

    // Calculate total value for the section (has or wants)
    const items = section === 'has' ? hasItems : wantsItems;

    // Loop through each item to calculate total
    items.forEach(item => {
      if (item !== null) {
        totalValue += item.Value * item.units || 0; // Sum the value of each item (ignoring null)
      }
    });

    // Update the total state
    if (section === 'has') {
      setHasTotal({ value: totalValue }); // Update hasTotal state
    } else {
      setWantsTotal({ value: totalValue }); // Update wantsTotal state
    }

    // console.log(`Updated total for ${section}:`, totalValue);
  };

  useEffect(() => {
    // Trigger total update whenever hasItems or wantsItems change
    if (selectedSection === 'has') {
      updateTotal('has');
    } else if (selectedSection === 'wants') {
      updateTotal('wants');
    }
  }, [hasItems, wantsItems]); // Trigger when hasItems or wantsItems change

  // Item submission function
  const handleItemDetailsSubmit = () => {
    if (!selectedItemDetails) {
      console.error("No item selected.");
      return;
    }



    const updatedItem = {
      ...selectedItemDetails,
      weight: weight,
      age: age,
      units: units || 1,
      Mutations: selectedMutations,
    };

    // console.log("Selected Section:", selectedSection);
    // console.log("Updated Item:", updatedItem);

    if (selectedSection === 'has') {
      const updatedHasItems = [...hasItems];
      const emptyIndex = updatedHasItems.findIndex(item => item === null); // Find the first empty slot

      // console.log("Updated Has Items (before adding):", updatedHasItems);
      // console.log("First empty index in hasItems:", emptyIndex);

      if (emptyIndex !== -1) {
        updatedHasItems[emptyIndex] = updatedItem; // Place the selected item in the first available slot
      }

      setHasItems(updatedHasItems); // Update hasItems state
    } else if (selectedSection === 'wants') {
      const updatedWantsItems = [...wantsItems];
      const emptyIndex = updatedWantsItems.findIndex(item => item === null); // Find the first empty slot

      // console.log("Updated Wants Items (before adding):", updatedWantsItems);
      // console.log("First empty index in wantsItems:", emptyIndex);

      if (emptyIndex !== -1) {
        updatedWantsItems[emptyIndex] = updatedItem; // Place the selected item in the first available slot
      }

      setWantsItems(updatedWantsItems); // Update wantsItems state
    }
    setAge('')
    setUnits('')
    setWeight('')
    setSelectedMutations([])
    setItemDetailsModalVisible(false); // Close the modal after submitting
  };





  const removeItem = (index, isHas) => {
    triggerHapticFeedback('impactLight');
    const items = isHas ? hasItems : wantsItems;
    const updatedItems = [...items];

    updatedItems[index] = null;  // Reset the slot to null (empty)

    if (isHas) {
      setHasItems(updatedItems);
      updateTotal('has');  // Recalculate hasTotal
    } else {
      setWantsItems(updatedItems);
      updateTotal('wants');  // Recalculate wantsTotal
    }
  };

  const filteredData = fruitRecords
    .filter((item) =>
      item.Name.toLowerCase().includes(searchText.toLowerCase()) // Filter by search text
    )
    .filter((item) =>
      selectedPetType === 'All' || item.Type === selectedPetType.toLowerCase() // Filter by selected category
    );
  const handleCategoryChange = (category) => {
    setSelectedPetType(category);
  };
  // console.log(selectedPetType)
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



            <ViewShot ref={viewRef} style={styles.screenshotView}>
              {config.isNoman && <View style={styles.summaryContainer}>
                <View style={[styles.summaryBox, styles.hasBox]}>
                  <Text style={[styles.summaryText]}>{t('home.you')}</Text>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', height: 1, alignSelf: 'center' }} />
                  <Text style={styles.priceValue}>{t('home.value')}: {hasTotal.value?.toLocaleString()}</Text>

                </View>
                <View style={[styles.summaryBox, styles.wantsBox]}>
                  <Text style={styles.summaryText}>{t('home.them')}</Text>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', height: 1, alignSelf: 'center' }} />
                  <Text style={styles.priceValue}>{t('home.value')}: {wantsTotal.value?.toLocaleString()}</Text>

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


                {hasItems?.map((item, index) => (
                  <TouchableOpacity key={index} style={[styles.addItemBlockNew, { backgroundColor: item?.Type === 'p' ? '#FFD700' : isDarkMode ? '#34495E' : '#B2C6D5' }]} onPress={() => { openDrawer('has') }} disabled={item !== null}>
                    {item ? (
                      <>
                        {item.Type === 'fruit' && item.Mutations.length > 0 && (
                          <View style={{
                            position: 'absolute',
                            left: 2,
                            top: 2,
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            {item.Mutations.slice(0, 3).map((mutation, index) => (
                              <View style={{
                                backgroundColor: config.colors.secondary,
                                paddingLeft: 3,
                                paddingVertical: 1,
                                borderRadius: 20,
                                marginBottom: 2,
                                justifyContent: 'center',
                                alignItems: 'center'
                              }} key={index}>
                                <Text style={{
                                  color: 'white',
                                  fontWeight: 'Lato-Regular',
                                  fontSize: 6,
                                  alignSelf: 'center'
                                }}>
                                  {mutation.charAt(0)}  {/* Display only the first character */}
                                </Text>
                              </View>
                            ))}

                            {/* Check if there are more than 3 mutations */}
                            {item.Mutations.length > 3 && (
                              <View style={{
                                backgroundColor: config.colors.secondary,
                                paddingLeft: 2,
                                // paddingVertical: 1,
                                borderRadius: 20,
                                marginBottom: 2,
                                justifyContent: 'center',
                                alignItems: 'center'
                              }}>
                                <Text style={{
                                  color: 'white',
                                  fontWeight: 'bold',
                                  fontSize: 9,
                                  alignSelf: 'center'
                                }}>
                                  + {/* Display "+" if there are more than 3 mutations */}
                                </Text>
                              </View>
                            )}
                          </View>
                        )}

                        <Image
                          source={{ uri: item.Image }}
                          style={[styles.itemImageOverlay,

                          ]}
                        />
                        {/* <Text style={[styles.itemText, { color: isDarkMode ? 'white' : 'black' }
                        ]}>{!item.Value ? "Special" : `${Number(item.Value).toLocaleString()}`}</Text> */}
                        <Text style={[styles.itemText, { color: isDarkMode ? 'white' : 'black' }
                        ]}> {item.units}x {item.Name}</Text>


                        <View style={{ height: 45, width: '100%', borderBottomRightRadius: 8, borderBottomLeftRadius: 8, justifyContent: 'flex-end' }}>

                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingHorizontal: 5, paddingVertical: 2, }}>
                            <Text style={[styles.itemText2
                            ]}>{formatNameNew(item.Tier)}</Text>
                            <Text style={[styles.itemText2
                            ]}>{formatNameNew(item.Type)}</Text>



                          </View>
                          {(item.age || item.weight) && item.Type !== 'gear' && <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingHorizontal: 5, paddingVertical: 2 }}>
                            {item.weight && <Text style={[styles.itemText2
                            ]}>{item.weight} kg</Text>}
                            {item.age && <Text style={[styles.itemText2
                            ]}> {item.Type === 'pet' ? 'Age' : 'Price'} {item.age}</Text>}



                          </View>}
                          {/* {item?.Type === '' && <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 5, paddingVertical: 2 }}>
                            <Text style={[styles.itemText2
                            ]}>200 Kg</Text>
                            <Text style={[styles.itemText2
                            ]}>Age: 3</Text>



                          </View>} */}


                        </View>
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
                {wantsItems?.map((item, index) => (
                  <TouchableOpacity key={index} style={[styles.addItemBlockNew, { backgroundColor: item?.Type === 'p' ? '#FFD700' : isDarkMode ? '#34495E' : '#B2C6D5' }]} onPress={() => { openDrawer('wants') }} disabled={item !== null}>
                    {item ? (
                      <>
                        {item.Type === 'fruit' && item.Mutations.length > 0 && (
                          <View style={{
                            position: 'absolute',
                            left: 2,
                            top: 2,
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            {item.Mutations.slice(0, 3).map((mutation, index) => (
                              <View style={{
                                backgroundColor: config.colors.secondary,
                                paddingLeft: 3,
                                paddingVertical: 1,
                                borderRadius: 20,
                                marginBottom: 2,
                                justifyContent: 'center',
                                alignItems: 'center'
                              }} key={index}>
                                <Text style={{
                                  color: 'white',
                                  fontWeight: 'Lato-Regular',
                                  fontSize: 6,
                                  alignSelf: 'center'
                                }}>
                                  {mutation.charAt(0)}  {/* Display only the first character */}
                                </Text>
                              </View>
                            ))}

                            {/* Check if there are more than 3 mutations */}
                            {item.Mutations.length > 3 && (
                              <View style={{
                                backgroundColor: config.colors.secondary,
                                paddingLeft: 2,
                                // paddingVertical: 1,
                                borderRadius: 20,
                                marginBottom: 2,
                                justifyContent: 'center',
                                alignItems: 'center'
                              }}>
                                <Text style={{
                                  color: 'white',
                                  fontWeight: 'bold',
                                  fontSize: 9,
                                  alignSelf: 'center'
                                }}>
                                  + {/* Display "+" if there are more than 3 mutations */}
                                </Text>
                              </View>
                            )}
                          </View>
                        )}

                        <Image
                          source={{ uri: item.Image }}
                          style={[styles.itemImageOverlay,

                          ]}
                        />
                        {/* <Text style={[styles.itemText, { color: isDarkMode ? 'white' : 'black' }
                        ]}>{!item.Value ? "Special" : `${Number(item.Value).toLocaleString()}`}</Text> */}
                        <Text style={[styles.itemText, { color: isDarkMode ? 'white' : 'black' }
                        ]}> {item.units} x {item.Name}</Text>


                        <View style={{ height: 45, width: '100%', borderBottomRightRadius: 8, borderBottomLeftRadius: 8, justifyContent: 'flex-end' }}>

                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingHorizontal: 5, paddingVertical: 2, }}>
                            <Text style={[styles.itemText2
                            ]}>{formatNameNew(item.Tier)}</Text>
                            <Text style={[styles.itemText2
                            ]}>{formatNameNew(item.Type)}</Text>



                          </View>
                          {(item.age || item.weight) && item.Type !== 'gear' && <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingHorizontal: 5, paddingVertical: 2 }}>
                            {item.weight && <Text style={[styles.itemText2
                            ]}>{item.weight} kg</Text>}
                            {item.age && <Text style={[styles.itemText2
                            ]}> {item.Type === 'pet' ? 'Age' : 'Price'} {item.age}</Text>}



                          </View>}
                          {/* {item?.Type === '' && <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 5, paddingVertical: 2 }}>
                            <Text style={[styles.itemText2
                            ]}>200 Kg</Text>
                            <Text style={[styles.itemText2
                            ]}>Age: 3</Text>



                          </View>} */}


                        </View>
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
                    )}
                  </TouchableOpacity>
                ))}



              </View>

            </ViewShot>
            <View style={styles.createtrade} >
              <TouchableOpacity style={styles.createtradeButton} onPress={() => handleCreateTradePress('create')}><Text style={{ color: 'white', fontSize:12, fontFamily:'Lato-Bold'  }}>{t('home.create_trade')}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.shareTradeButton} onPress={() => handleCreateTradePress('share')}><Text style={{ color: 'white', fontSize:12, fontFamily:'Lato-Bold' }}>{t('home.share_trade')}</Text></TouchableOpacity></View>
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
                <View style={styles.drawerHeader}>
                  <TextInput
                    style={styles.searchInput}
                    placeholder={t('home.search_placeholder')}
                    value={searchText}
                    onChangeText={setSearchText}
                    placeholderTextColor={isDarkMode ? 'lightgrey' : 'grey'}
                    />
                  <TouchableOpacity onPress={closeDrawer} style={styles.closeButton}>
                    <Text style={styles.closeButtonText}>{t('home.close')}</Text>
                  </TouchableOpacity>
                </View>

                <View style={[styles.drawerContent]}>
                  {/* Category List */}
                  <View style={styles.categoryList}>
                    {CATEGORIES.map((category) => (
                      <TouchableOpacity
                        key={category}
                        style={[
                          styles.categoryButton,
                          selectedPetType === category && styles.categoryButtonActive
                        ]}
                        onPress={() => handleCategoryChange(category)} // Update selected category
                      >
                        <Text
                          style={[
                            styles.categoryButtonText,
                            selectedPetType === category && styles.categoryButtonTextActive
                          ]}
                        >
                          {category}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.gridContainer}>

                    {/* FlatList without ScrollView */}
                    <FlatList
                      data={filteredData} // Using the filtered data
                      keyExtractor={(item) => item.Name}
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          style={[
                            styles.itemBlock,
                            { backgroundColor: item.Type === 'p' ? '#FFD700' : isDarkMode ? '#34495E' : '#B2C6D5' }
                          ]}
                          onPress={() => selectItem(item)}
                        >
                          <Image
                            source={{ uri: item.Image }}
                            style={[styles.itemImageOverlay]}
                          />
                          <Text style={[
                            styles.itemText,
                            { color: isDarkMode ? 'white' : 'black' }
                          ]}>
                            {!item.Value ? "Special" : `${Number(item.Value).toLocaleString()}`}
                          </Text>
                          <Text style={[
                            styles.itemText,
                            { color: isDarkMode ? 'white' : 'black' }
                          ]}>
                            {item.Name}
                          </Text>
                        </TouchableOpacity>
                      )}
                      numColumns={3}
                      contentContainerStyle={styles.flatListContainer}
                      columnWrapperStyle={styles.columnWrapper}
                    /></View>
                </View>
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
                    style={[styles.input, {width:'100%'}]}
                    placeholder={t("home.write_description")}
                    maxLength={40}
                    value={description}
                    onChangeText={setDescription}
                    placeholderTextColor={isDarkMode ? 'lightgrey' : 'grey'}

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
          <Modal
            visible={isItemDetailsModalVisible}
            transparent={true}
            animationType="slide"
            onRequestClose={() => setItemDetailsModalVisible(false)} // Close modal on request
          >
            <Pressable style={styles.modalOverlay} onPress={() => setItemDetailsModalVisible(false)} />
            <ConditionalKeyboardWrapper>
              <View>
            <View style={[styles.drawerContainer, { backgroundColor: isDarkMode ? '#3B404C' : 'white' }]}>
              <Text style={styles.modalMessage}>Enter Item Details</Text>

              {/* Display the selected item image */}
              <Image
                source={{ uri: selectedItemDetails?.Image }}
                style={{ width: 100, height: 100, alignSelf: 'center' }}
              />

              {/* Input fields for weight, age, and units */}
              <View style={styles.inputRow}>
               {selectedItemDetails?.Type !== 'gear' && <TextInput
                  style={styles.input}
                  placeholder="Weight (kg)"
                  keyboardType="numeric"
                  value={weight}
                  onChangeText={setWeight}  // Update weight state
                  placeholderTextColor={isDarkMode ? 'lightgrey' : 'grey'}
                />}
                 {selectedItemDetails?.Type !== 'gear' && <TextInput
                  style={styles.input}
                  placeholder={selectedItemDetails?.Type === 'fruit' ? "Price" : "Age (years)"}
                  keyboardType="numeric"
                  value={age}
                  onChangeText={setAge}  // Update age state
                  placeholderTextColor={isDarkMode ? 'lightgrey' : 'grey'}

                />}
                <TextInput
                  style={[styles.input, {width : selectedItemDetails?.Type == 'gear' ? '90%' : '33%'}]}
                  placeholder="1 x Unit"
                  value={units}
                  keyboardType="numeric"
                  onChangeText={setUnits}  // Update units state
                  placeholderTextColor={isDarkMode ? 'lightgrey' : 'grey'}

                />
              </View>

              {/* Show mutations if the item type is fruit */}
              {selectedItemDetails?.Type === 'fruit' && (
                <View style={styles.mutationContainer}>
                  {['Gold', 'Rainbow', 'Wet', 'Chilled', 'Frozen', 'Shocked',
                    'Chocolate', 'Moonlit', 'Bloodlit', 'Zombified', 'Celestial',
                    'Disco', 'Plasma', 'Twisted', 'Pollinated', 'Honey Glazed',
                    'Voidtouched'].map((mutation, index) => (
                      <TouchableOpacity
                        key={index}
                        style={[
                          styles.mutationButton,
                          selectedMutations.includes(mutation) && styles.mutationButtonSelected
                        ]}
                        onPress={() => handleMutationSelect(mutation)}
                      >
                        <Text style={styles.mutationButtonText}>{mutation}</Text>
                      </TouchableOpacity>
                    ))}
                </View>
              )}

              {/* Submit Button */}
              <View style={styles.buttonContainer}>
                <TouchableOpacity
                  style={[styles.button, styles.cancelButton]}
                  onPress={() => setItemDetailsModalVisible(false)}  // Close modal without saving
                >
                  <Text style={styles.buttonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.confirmButton]}
                  onPress={handleItemDetailsSubmit}  // Handle the submit action
                >
                  <Text style={styles.buttonText}>Submit</Text>
                </TouchableOpacity>
              </View>
            </View></View>
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
      {!localState.isPro && <BannerAdComponent />}

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
      fontSize: 14,
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
      fontSize: 14,

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
      width: '33%',
      height: 100,
      backgroundColor: isDarkMode ? '#34495E' : '#B2C6D5', // Dark: darker contrast, Light: White
      borderWidth: Platform.OS === 'android' ? 0 : 1,
      borderColor: 'lightgrey',
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 4,
      marginBottom: 2,

    },

    addItemBlock: {
      width: '32%',
      height: 85,
      backgroundColor: isDarkMode ? '#34495E' : '#B2C6D5', // Dark: darker contrast, Light: White
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 10,
      marginBottom: 10,
    },
    itemBlock: {
      width: '32%',
      height: 80,
      backgroundColor: isDarkMode ? '#34495E' : '#B2C6D5', // Dark: darker contrast, Light: White
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 10,
      marginBottom: 2,
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
      fontSize: 10
    },
    itemText2: {
      color: isDarkMode ? 'white' : 'black',
      textAlign: 'center',
      fontFamily: 'Lato-Bold',
      fontSize: 9
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
      maxHeight: 500,
      overflow: 'hidden',
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
    },
    drawerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    gridContainer: {
      flex: 1,
      maxHeight: 500,
      paddingBottom: 80,
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
      // height: 48,
      height: 40,
      borderColor: 'gray',
      borderWidth: 1,
      borderRadius: 5,
      paddingHorizontal: 10,
      color: isDarkMode ? 'white' : 'black',
      fontFamily: 'Lato-Ragular'
    },
    closeButton: {
      backgroundColor: config.colors.wantBlockRed,
      padding: 10,
      borderRadius: 5,
      width: '22%',
      alignItems: 'center',
      justifyContent: 'center',
      height: 40
    },
    closeButtonText: {
      color: 'white',
      textAlign: 'center',
      fontFamily: 'Lato-Regular',
      fontSize: 12
    },
    flatListContainer: {
      justifyContent: 'space-between',
      paddingBottom: 20,
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


    screenshotView: {
      padding: 10,
      flex: 1,
      // paddingVertical: 10,
    },




    createtrade: {
      alignSelf: 'center',
      justifyContent: 'center',
      flexDirection: 'row'
    },
    createtradeButton: {
      backgroundColor: config.colors.hasBlockGreen,
      alignSelf: 'center',
      padding: 8,
      justifyContent: 'center',
      flexDirection: 'row',
      minWidth: 100,
      borderTopStartRadius: 20,
      borderBottomStartRadius: 20,
      marginRight: 1
    },
    shareTradeButton: {
      backgroundColor: config.colors.wantBlockRed,
      alignSelf: 'center',
      padding: 8,
      flexDirection: 'row',
      justifyContent: 'center',
      minWidth: 100,
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



    text: {
      color: "white",
      fontSize: 12,
      fontFamily: "Lato-Regular",
      lineHeight: 12
    },

    drawerContent: {
      flex: 1,
      flexDirection: 'row',
    },
    categoryList: {
      width: '20%',
      paddingRight: 12,
    },
    categoryButton: {
      marginVertical: 4,
      paddingVertical: 6,
      paddingHorizontal: 12,
      backgroundColor: '#B2C6D5',
      borderRadius: 12,
      alignItems: 'center',
    },
    categoryButtonActive: {
      backgroundColor: config.colors.primary,
    },
    categoryButtonText: {
      fontSize: 10,
      fontFamily: 'Lato-Bold',
      color: 'black',
    },
    categoryButtonTextActive: {
      color: '#fff',
    },
    inputRow: {
      flexDirection: 'row',
      justifyContent: 'space-evenly',
      width: '100%',
      marginBottom: 10, // Space between the row and the next element
    },

    input: {
      height: 40,
      borderColor: 'gray',
      borderWidth: 1,
      borderRadius: 5,
      paddingHorizontal: 10,
      marginBottom: 20,
      color: isDarkMode ? 'white' : 'black',
      fontFamily: 'Lato-Regular',
      width:'32%'
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
    mutationContainer: {
      marginBottom: 20,
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-around'
    },
    mutationTitle: {
      fontSize: 16,
      marginBottom: 10,
    },
    mutationButton: {
      paddingHorizontal: 10,
      paddingVertical: 3,
      marginBottom: 5,
      borderRadius: 20,
      marginRight: 5,
      backgroundColor: '#ccc',
    },
    mutationButtonSelected: {
      backgroundColor: config.colors.hasBlockGreen,
    },
    mutationButtonText: {
      textAlign: 'center',
      color: 'white',
      fontSize: 10
    },
  });

export default HomeScreen