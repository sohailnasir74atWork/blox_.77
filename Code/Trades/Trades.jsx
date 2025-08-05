import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, FlatList, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator, TextInput, Alert, Platform, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';
import { useNavigation } from '@react-navigation/native';
import { FilterMenu } from './tradeHelpers';
import ReportTradePopup from './ReportTradePopUp';
import SignInDrawer from '../Firebase/SigninDrawer';
import { useLocalState } from '../LocalGlobelStats';
import firestore, { count } from '@react-native-firebase/firestore';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import SubscriptionScreen from '../SettingScreen/OfferWall';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';


// Initialize dayjs plugins
dayjs.extend(relativeTime);


const TradeList = ({ route }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdVisible, setIsAdVisible] = useState(true);
  const { selectedTheme } = route.params
  const { user, analytics, updateLocalStateAndDatabase, appdatabase } = useGlobalState()
  const [trades, setTrades] = useState([]);
  const [filteredTrades, setFilteredTrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [showofferwall, setShowofferwall] = useState(false);
  const [remainingFeaturedTrades, setRemainingFeaturedTrades] = useState([]);
  const [openShareModel, setOpenShareModel] = useState(false);



  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isReportPopupVisible, setReportPopupVisible] = useState(false);
  const PAGE_SIZE = 20;
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const { localState, updateLocalState } = useLocalState()
  const navigation = useNavigation()
  const { theme } = useGlobalState()
  const [isProStatus, setIsProStatus] = useState(localState.isPro);
  const { t } = useTranslation();
  const platform = Platform.OS.toLowerCase();
  const isDarkMode = theme === 'dark'
  const [dialogVisible, setDialogVisible] = useState(false); // Modal visibility

 



  const [selectedFilters, setSelectedFilters] = useState(['has']);

  useEffect(() => {
    // console.log(localState.isPro, 'from trade model'); // ✅ Check if isPro is updated
    setIsProStatus(localState.isPro); // ✅ Force update state and trigger re-render
  }, [localState.isPro]);

  const formatNameNew = (name) => {
    if (!name) return
    const formattedName = name
      .split('_')                           // Split on underscore
      .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize each word
      .join(' ');                           // Join with space
  
    // If the formatted name length is greater than 5 characters, truncate it and add "..."
    if (formattedName.length > 10) {
      return formattedName.slice(0, 10) + '...';  // Truncate to 5 characters and append '...'
    }
    
    return formattedName;  // Return the formatted name if it's 5 characters or less
  };
  const TradeDetailsModal = ({ onClose, item }) => {
    const navigation = useNavigation();
    const { user } = useGlobalState();
    const { localState } = useLocalState();
  
    const groupedHasItems = item?.hasItems || [];
    const groupedWantsItems = item?.wantsItems || [];
  
    const renderItem = (item) => {
      if (!item) return null;
  
      return (
        <View style={styles.itemCard}>
          <Image source={{ uri: item?.Image }} style={styles.itemImage} />
          <Text style={styles.itemName}>
            {item?.units}x {formatNameNew(item?.Name)}
          </Text>
          {(item?.age || item?.weight) && (
            <View style={styles.itemDetailsRow}>
              <Text style={styles.itemDetail}>{item?.age && `Age: ${item.age}`}</Text>
              <Text style={styles.itemDetail}>{item?.weight && `Weight: ${item.weight}`}</Text>
            </View>
          )}
          {(item?.Tier || item?.Type) && (
            <View style={styles.itemDetailsRow}>
              <Text style={styles.itemDetail}>{item?.Tier && formatNameNew(item?.Tier)}</Text>
              <Text style={styles.itemDetail}>{item?.Type && formatNameNew(item?.Type)}</Text>
            </View>
          )}
          {item?.Mutations?.length > 0 && (
            <View style={styles.mutationContainer}>
              {item.Mutations.map((mutation, index) => (
                <View key={index} style={styles.mutationTag}>
                  <Text style={styles.mutationText}>{mutation}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      );
    };
  
    const checkIfAllItemsAreNull = (items) => {
      return items.every(
        (item) => !item || item?.Name === undefined || item?.Name === ''
      );
    };
  
    const handleChatNavigation = async () => {
      const callbackfunction = () => {
        if (!user?.id) {
          // Alert.alert('Sign In Required', 'Please sign in to chat.');
          setIsSigninDrawerVisible(true)
          return;
        }
        mixpanel.track('Inbox Trade');
        navigation.navigate('PrivateChatTrade', {
          selectedUser: {
            senderId: item?.userId,
            sender: item?.traderName,
            avatar: item?.avatar,
          },
          item,
        });
      };
  
      try {
        if (!localState.isPro) {
          InterstitialAdManager.showAd(callbackfunction);
        } else {
          callbackfunction();
        }
      } catch (error) {
        console.error('Error navigating to PrivateChat:', error);
        Alert.alert('Error', 'Unable to open chat. Try again later.');
      }
    };
  
    return (
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}></Text>
          <TouchableOpacity onPress={onClose}>
            <Icon name="close-circle" size={24} color={'#e74c3c'} />
          </TouchableOpacity>
        </View>
  
        <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
          <View style={styles.modalBody}>
            <Text style={styles.modalSubTitle}>Has Items</Text>
            {checkIfAllItemsAreNull(groupedHasItems) ? (
              <View style={styles.emptyOfferContainer}>
                <Text style={styles.emptyOfferText}>Give Offer</Text>
              </View>
            ) : (
              <View style={styles.gridContainer}>
                {groupedHasItems.filter(Boolean).map((item, index) => (
                  <View key={item?.Name + index} style={styles.gridItem}>
                    {renderItem(item)}
                  </View>
                ))}
              </View>
            )}
  
            <Text style={styles.modalSubTitle}>Wants Items</Text>
            {checkIfAllItemsAreNull(groupedWantsItems) ? (
              <View style={styles.emptyOfferContainer}>
                <Text style={styles.emptyOfferText}>Give Offer</Text>
              </View>
            ) : (
              <View style={styles.gridContainer}>
                {groupedWantsItems.filter(Boolean).map((item, index) => (
                  <View key={item?.Name + index} style={styles.gridItem}>
                    {renderItem(item)}
                  </View>
                ))}
              </View>
            )}
          </View>
  
          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.chatButton} onPress={handleChatNavigation}>
              <Text style={styles.chatButtonText}>Chat with Trade</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  };
  
  
  useEffect(() => {
    const lowerCaseQuery = searchQuery.trim().toLowerCase();

    setFilteredTrades(
      trades.filter((trade) => {
        // If no filters selected, show all trades
        if (selectedFilters.length === 0) return true;

        let matchesAnyFilter = false;

        if (selectedFilters.includes("has")) {
          matchesAnyFilter =
            matchesAnyFilter ||
            trade.hasItems?.some((item) =>
              item?.Name.toLowerCase().includes(lowerCaseQuery)
            );
        }

        if (selectedFilters.includes("wants")) {
          matchesAnyFilter =
            matchesAnyFilter ||
            trade.wantsItems?.some((item) =>
              item?.Name.toLowerCase().includes(lowerCaseQuery)
            );
        }

        if (selectedFilters.includes("myTrades")) {
          matchesAnyFilter = matchesAnyFilter || trade.userId === user.id;
        }

      

      

       

     

        

      

       

        return matchesAnyFilter; // Show if it matches at least one selected filter
      })
    );
  }, [searchQuery, trades, selectedFilters]);



  const getTradeDeal = (hasTotal, wantsTotal) => {
    // if (hasTotal.value <= 0) {
    //   return { label: "trade.unknown_deal", color: "#8E8E93" }; // ⚠️ Unknown deal (invalid input)
    // }

    const tradeRatio = wantsTotal.value / hasTotal.value;
    let deal;

  

    return { deal, tradeRatio };
  };
  // console.log(localState.featuredCount, 'featu')
  const handleDelete = useCallback((item) => {
    Alert.alert(
      t("trade.delete_confirmation_title"),
      t("trade.delete_confirmation_message"),
      [
        { text: t("trade.cancel"), style: "cancel" },
        {
          text: t("trade.delete"),
          style: "destructive",
          onPress: async () => {
            try {
              const tradeId = item.id.startsWith("featured-") ? item.id.replace("featured-", "") : item.id;

              await firestore().collection("trades_new").doc(tradeId).delete();

              if (item.isFeatured) {
                const currentFeaturedData = localState.featuredCount || { count: 0, time: null };
                const newFeaturedCount = Math.max(0, currentFeaturedData.count - 1);

                await updateLocalState("featuredCount", {
                  count: newFeaturedCount,
                  time: currentFeaturedData.time,
                });
              }

              setTrades((prev) => prev.filter((trade) => trade.id !== item.id));
              setFilteredTrades((prev) => prev.filter((trade) => trade.id !== item.id));

              showSuccessMessage(t("trade.delete_success"), t("trade.delete_success_message"));

            } catch (error) {
              console.error("🔥 [handleDelete] Error deleting trade:", error);
              showErrorMessage(t("trade.delete_error"), t("trade.delete_error_message"));
            }
          },
        },
      ]
    );
  }, [t, localState.featuredCount]);







  // console.log(isProStatus, 'from trade model')

  const handleMakeFeatureTrade = async (item) => {
    if (!isProStatus) {
      Alert.alert(
        t("trade.feature_pro_only_title"),
        t("trade.feature_pro_only_message"),
        [
          { text: t("trade.cancel"), style: "cancel" },
          {
            text: t("trade.upgrade"),
            onPress: () => setShowofferwall(true),
          },
        ]
      );
      return;
    }

    try {
      // 🔐 Check from Firestore how many featured trades user already has
      const oneDayAgo = firestore.Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
      const featuredSnapshot = await firestore()
        .collection("trades_new")
        .where("userId", "==", user.id)
        .where("isFeatured", "==", true)
        .where("featuredUntil", ">", oneDayAgo)
        .get();

      if (featuredSnapshot.size >= 2) {
        Alert.alert(
          "Limit Reached",
          "You can only feature 2 trades every 24 hours."
        );
        return;
      }

      // ✅ Proceed with confirmation
      Alert.alert(
        t("trade.feature_confirmation_title"),
        t("trade.feature_confirmation_message"),
        [
          { text: t("trade.cancel"), style: "cancel" },
          {
            text: t("feature"),
            onPress: async () => {
              try {
                await firestore().collection("trades_new").doc(item.id).update({
                  isFeatured: true,
                  featuredUntil: firestore.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
                });

                const newFeaturedCount = (localState.featuredCount?.count || 0) + 1;
                updateLocalState("featuredCount", {
                  count: newFeaturedCount,
                  time: new Date().toISOString(),
                });

                setTrades((prev) =>
                  prev.map((trade) =>
                    trade.id === item.id ? { ...trade, isFeatured: true } : trade
                  )
                );
                setFilteredTrades((prev) =>
                  prev.map((trade) =>
                    trade.id === item.id ? { ...trade, isFeatured: true } : trade
                  )
                );

                showSuccessMessage(t("trade.feature_success"), t("trade.feature_success_message"));
              } catch (error) {
                console.error("🔥 Error making trade featured:", error);
                showErrorMessage(t("trade.feature_error"), t("trade.feature_error_message"));
              }
            },
          },
        ]
      );
    } catch (err) {
      console.error("❌ Error checking featured trades:", err);
      Alert.alert("Error", "Unable to verify your featured trades. Try again later.");
    }
  };





  const formatValue = (value) => {
    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(1)}B`; // Billions
    } else if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`; // Millions
    } else if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`; // Thousands
    } else {
      return value.toLocaleString(); // Default formatting
    }
  };
  const fetchMoreTrades = useCallback(async () => {
    if (!hasMore || !lastDoc) return;

    try {
      // ✅ Fetch more normal trades
      const normalTradesQuery = await firestore()
        .collection('trades_new')
        .where('isFeatured', '==', false)
        .orderBy('timestamp', 'desc')
        .startAfter(lastDoc)
        .limit(PAGE_SIZE)
        .get();

      const newNormalTrades = normalTradesQuery.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      if (newNormalTrades.length === 0) {
        setHasMore(false); // ✅ Stop pagination if no more trades exist
        return;
      }

      // ✅ Get **2 more** featured trades if available
      const newFeaturedTrades = remainingFeaturedTrades.splice(0, 3);
      setRemainingFeaturedTrades([...remainingFeaturedTrades]); // ✅ Update remaining featured

      // ✅ Merge & maintain balance
      const mergedTrades = mergeFeaturedWithNormal(newFeaturedTrades, newNormalTrades);

      setTrades((prevTrades) => [...prevTrades, ...mergedTrades]);
      setLastDoc(normalTradesQuery.docs[normalTradesQuery.docs.length - 1]); // ✅ Update last doc
      setHasMore(newNormalTrades.length === PAGE_SIZE);
    } catch (error) {
      console.error('❌ Error fetching more trades:', error);
    }
  }, [lastDoc, hasMore, remainingFeaturedTrades]);



  useEffect(() => {
    const resetFeaturedDataIfExpired = async () => {
      const currentFeaturedData = localState.featuredCount || { count: 0, time: null };

      if (!currentFeaturedData.time) return; // ✅ If no time exists, do nothing

      const featuredTime = new Date(currentFeaturedData.time).getTime();
      const currentTime = Date.now();
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

      if (currentTime - featuredTime >= TWENTY_FOUR_HOURS) {
        // console.log("⏳ 24 hours passed! Resetting featuredCount and time...");

        await updateLocalState("featuredCount", { count: 0, time: null });

        // console.log("✅ Featured data reset successfully.");
      }
    };

    resetFeaturedDataIfExpired(); // ✅ Runs once on app load

  }, []); // ✅ Runs only on app load







  const handleEndReached = () => {
    if (!hasMore || loading) return; // ✅ Prevents unnecessary calls
    if (!user?.id) {
      setIsSigninDrawerVisible(true);
    }
    else { fetchMoreTrades(); }
  };

 

  const fetchInitialTrades = useCallback(async () => {
    setLoading(true);
    try {
      // ✅ Fetch latest normal trades
      const normalTradesQuery = await firestore()
        .collection('trades_new')
        .orderBy('isFeatured')
        .where('isFeatured', '!=', true) // Get only non-featured trades
        .orderBy('timestamp', 'desc')
        .limit(PAGE_SIZE)
        .get();

      const normalTrades = normalTradesQuery.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // ✅ Fetch only valid featured trades (NOT expired)
      const featuredQuerySnapshot = await firestore()
        .collection('trades_new')
        .where('isFeatured', '==', true)
        .where('featuredUntil', '>', firestore.Timestamp.now()) // ✅ Only fetch active featured trades
        .orderBy('featuredUntil', 'desc')
        .get();

      let featuredTrades = [];
      if (!featuredQuerySnapshot.empty) {
        featuredTrades = featuredQuerySnapshot.docs.map((doc) => ({
          id: `featured-${doc.id}`, // ✅ Unique keys for featured trades
          ...doc.data(),
        }));
      }
      // console.log('✅ Featured trades:', featuredTrades.length);

      // ✅ Keep some featured trades aside for future loadMore()
      setRemainingFeaturedTrades(featuredTrades);

      // ✅ Merge trades but **reserve** featured trades for later
      const mergedTrades = mergeFeaturedWithNormal(
        featuredTrades.splice(0, 3), // ✅ Only use first 2 featured
        normalTrades
      );

      // ✅ Update state
      setTrades(mergedTrades);
      setLastDoc(normalTradesQuery.docs[normalTradesQuery.docs.length - 1]); // ✅ Save last doc for pagination
      setHasMore(normalTrades.length === PAGE_SIZE);
    } catch (error) {
      console.error('❌ Error fetching trades:', error);
    } finally {
      setLoading(false);
    }
  }, []);


  
  const mergeFeaturedWithNormal = (featuredTrades, normalTrades) => {
    // Input validation
    if (!Array.isArray(featuredTrades) || !Array.isArray(normalTrades)) {
      console.warn('⚠️ Invalid input: featuredTrades or normalTrades is not an array');
      return [];
    }

    let result = [];
    let featuredIndex = 0;
    let normalIndex = 0;
    const featuredCount = featuredTrades.length;
    const normalCount = normalTrades.length;
    const MAX_ITERATIONS = 1000; // Safety limit
    let iterationCount = 0;

    // Add first 4 featured trades (if available)
    for (let i = 0; i < 4 && featuredIndex < featuredCount; i++) {
      result.push(featuredTrades[featuredIndex]);
      featuredIndex++;
    }

    // Merge in the format of 4 normal trades, then 4 featured trades
    while (normalIndex < normalCount && iterationCount < MAX_ITERATIONS) {
      iterationCount++;

      // Insert up to 4 normal trades
      for (let i = 0; i < 4 && normalIndex < normalCount; i++) {
        result.push(normalTrades[normalIndex]);
        normalIndex++;
      }

      // Insert up to 4 featured trades (if available)
      for (let i = 0; i < 4 && featuredIndex < featuredCount; i++) {
        result.push(featuredTrades[featuredIndex]);
        featuredIndex++;
      }
    }

    if (iterationCount >= MAX_ITERATIONS) {
      console.warn('⚠️ Maximum iterations reached in mergeFeaturedWithNormal');
    }

    return result;
  };

  
  useEffect(() => {
    fetchInitialTrades();
    // updateLatest50TradesWithoutIsFeatured()

    if (!user?.id) {
      setTrades((prev) => prev.slice(0, PAGE_SIZE)); // Keep only 20 trades for logged-out users
    }
  }, [user?.id]);


  const renderTextWithUsername = (description) => {
    const parts = description.split(/(@\w+)/g); // Split text by @username pattern

    return parts.map((part, index) => {
      if (part.startsWith('@')) {
        const username = part.slice(1); // Remove @
        return (
          <TouchableOpacity
            style={styles.descriptionclick}
            key={index}
            onPress={() => {
              Clipboard.setString(username);
              // Alert.alert("Copied!", `Username "${username}" copied.`);
            }}
          >
            <Text style={styles.descriptionclick}>{part}</Text>
          </TouchableOpacity>
        );
      } else {
        return <Text key={index} style={styles.description}>{part}</Text>;
      }
    });
  };


  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);


  const handleTradePress = useCallback((item) => {
    setSelectedTrade(item);  // Set the selected trade
    setDialogVisible(true);   // Show the modal
  }, []);

  const handleCloseDialog = useCallback(() => {
    setDialogVisible(false);  // Close modal
  }, []);


  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchInitialTrades();
    setRefreshing(false);
  };

  const handleLoginSuccess = () => {
    setIsSigninDrawerVisible(false);
  };


  const renderTrade = ({ item, index }) => {
    const {  tradeRatio } = getTradeDeal(item.hasTotal, item.wantsTotal);
    const tradePercentage = Math.abs(((tradeRatio - 1) * 100).toFixed(0));

    const isProfit = tradeRatio > 1; // Profit if trade ratio > 1
    const neutral = tradeRatio === 1; // Exactly 1:1 trade
    const formattedTime = item.timestamp ? dayjs(item.timestamp.toDate()).fromNow() : "Anonymous";

    // if ((index + 1) % 10 === 0 && !isProStatus) {
    //   return <MyNativeAdComponent />;
    // }
    // Function to group items and count duplicates
    // const groupItems = (items) => {
    //   console.log(items)
     
    //   items.forEach(({ Name, Tier, Type, Image, Mutations, age, units, weight }) => {
       
    //       { Name, Tier, Type, Image, Mutations, age, units, weight};
        
    //   });
    //   return Object.values(grouped);
    // };
    // console.log('item', item)

    // Group and count duplicate items
    const groupedHasItems = item.hasItems || [];
    const groupedWantsItems = item.wantsItems || [];
    // console.log(groupedHasItems)

  

    return (
      <>
      <View style={[styles.tradeItem, item.isFeatured && { backgroundColor: isDarkMode ? '#34495E' : 'rgba(245, 222, 179, 0.6)' }]}>
         

        {item.isFeatured && <View style={styles.tag}></View>}
       
        <View style={styles.tradeHeader}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }} onPress={() => handleTradePress(item)}>
            <Image source={{ uri: item.avatar }} style={styles.itemImageUser} />

            <View style={{ justifyContent: 'center', marginLeft: 10 }}>
              <Text style={styles.traderName}>
                {item.traderName}{' '}
                {item.isPro &&
                  <Image
                  source={require('../../assets/pro.png')} 
                  style={{ width: 14, height: 14 }} 
                />
                  }
                {item.rating ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, backgroundColor: '#ffb300', borderRadius: 5, paddingHorizontal: 4, paddingVertical: 2, marginLeft: 5 }}>
                    <Icon name="star" size={8} color="white" style={{ marginRight: 4 }} />
                    <Text style={{ fontSize: 8, color: 'white' }}>{parseFloat(item.rating).toFixed(1)}({item.ratingCount})</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, backgroundColor: '#888', borderRadius: 5, paddingHorizontal: 2, paddingVertical: 1, marginLeft: 5 }}>
                    <Icon name="star-outline" size={8} color="white" style={{ marginRight: 4 }} />
                    <Text style={{ fontSize: 8, color: 'white' }}>N/A</Text>
                  </View>
                )}


              </Text>

              {/* Rating Info */}


              <Text style={styles.tradeTime}>{formattedTime}</Text>
            </View>
          </TouchableOpacity>

          <View>
            {/* {(groupedHasItems.length > 0 && groupedWantsItems.length > 0) &&  <View style={[styles.dealContainer, { backgroundColor: deal.color }]}>
              <Text style={styles.dealText}>

                {t(deal.label)}
              </Text>

            </View>} */}
 <FontAwesome
        name='square-arrow-up-right'
         size={24}
              color={config.colors.primary}
              onPress={() => handleTradePress(item)}
        solid={false}
      />
            {/* <Icon
              name="chatbox-outline"
              size={18}
              color={config.colors.secondary}
              onPress={() => handleTradePress(item)}
            /> */}
          </View>
        </View>
        {/* Trade Items */}
        <View style={styles.tradeDetails}>
          {/* Has Items */}
          <View style={styles.itemList}>
  {groupedHasItems.some(item => item !== null) ? (
    groupedHasItems.map((hasItem, index) => (
      <View key={index} style={{ justifyContent: 'center', alignItems: 'center' }}>
        {hasItem ? (  // Check if hasItem is not null
          <>
            <Image
              source={{
                uri: hasItem?.Image,
              }}
              style={[styles.itemImage]}
            />
            <Text style={styles.names}>
              {formatNameNew(hasItem?.Name)}
            </Text>
          </>
        ) : (
          null // Display a message if the item is null
        )}
      </View>
    ))
  ) : (
    <TouchableOpacity style={styles.dealContainerSingle} onPress={() => handleTradePress(item)}>
      <Text style={styles.dealText}>Give offer</Text>
    </TouchableOpacity>
  )}
</View>


          {/* Transfer Icon */}
          <View style={styles.transfer}>
            <Image source={require('../../assets/transfer.png')} style={styles.transferImage} />
          </View>
          {/* Wants Items */}
          <View style={styles.itemList}>
          {/* {console.log('want item', groupedWantsItems)} */}
            {groupedWantsItems.some(item => item !== null)  ? (
              groupedWantsItems.map((wantItem, index) => (
                <View key={index} style={{ justifyContent: 'center', alignItems: 'center' }}>

        {wantItem ? (  // Check if hasItem is not null
          <>
            <Image
              source={{
                uri: wantItem?.Image,
              }}
              style={[styles.itemImage]}
            />
            <Text style={styles.names}>
              {formatNameNew(wantItem?.Name)}
            </Text>
          </>
        ) : (
          null // Display a message if the item is null
        )}
      </View>
              ))
            ) : (
              <TouchableOpacity style={styles.dealContainerSingle} onPress={() => handleTradePress(item)}>
                <Text style={styles.dealText}>Give offer</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <View style={styles.tradeTotals}>
          {groupedHasItems.length > 0 && <Text style={[styles.priceText, styles.hasBackground]}>
            {t("trade.price_has")} {formatValue(item.hasTotal.value)}
          </Text>}
          <View style={styles.transfer}>
            {(groupedHasItems.length > 0 && groupedWantsItems.length > 0) && <Text style={[styles.priceTextProfit, { color: !isProfit ? config.colors.hasBlockGreen : config.colors.wantBlockRed }]}>
              {tradePercentage}% {!neutral && (
                <Icon
                  name={isProfit ? 'arrow-down-outline' : 'arrow-up-outline'}
                  size={10}
                  color={isProfit ? config.colors.wantBlockRed : config.colors.hasBlockGreen}
                  style={styles.icon}
                />
              )}
            </Text>}
          </View>
          {groupedWantsItems.length > 0 && <Text style={[styles.priceText, styles.wantBackground]}>
            {t("trade.price_want")} {formatValue(item.wantsTotal.value)}
          </Text>}
        </View>

        {/* Description */}
        {item.description && <Text style={styles.description}>{renderTextWithUsername(item.description)}
        </Text>}
        {item.userId === user.id && (<View style={styles.footer}>
          {!item.isFeatured && <Icon
            name="rocket"
            size={24}
            color={config.colors.primary}
            onPress={() => handleMakeFeatureTrade(item)}
            style={{ marginRight: 20 }}
          />}

          <Icon
            name="close-circle"
            size={24}
            color={config.colors.wantBlockRed}
            style={{ marginRight: 20 }}
            onPress={() => handleDelete(item)}
          />
          <Icon
            name="share-social"
            size={24}
            color={config.colors.primary}
            onPress={() => {
              setSelectedTrade(item); // ✅ Set the selected trade
              setOpenShareModel(true); // ✅ Then open the modal
            }}
          />



        </View>)}
        {/* <ShareTradeModal
          visible={openShareModel}
          onClose={() => setOpenShareModel(false)}
          tradeData={selectedTrade}
        /> */}

      </View></>
    );
  };

  if (loading) {
    return <ActivityIndicator style={styles.loader} size="large" color="#007BFF" />;
  }


  return (
    <View style={styles.container}>
       {dialogVisible && selectedTrade && (
        <TradeDetailsModal
          onClose={handleCloseDialog}  // Close modal
          item={selectedTrade}  // Pass selected trade data
        />
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
     
        <TextInput
          style={styles.searchInput}
          placeholder={t("trade.search_placeholder")}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor={isDarkMode ? 'white' : '#aaa'}
        />
        <FilterMenu selectedFilters={selectedFilters} setSelectedFilters={setSelectedFilters} analytics={analytics} platform={platform} />
      </View>
      <FlatList
        data={filteredTrades}
        renderItem={renderTrade}
        keyExtractor={(item) => item.isFeatured ? `featured-${item.id}` : item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20 }}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.2}
        removeClippedSubviews={true} // 🚀 Reduce memory usage
        initialNumToRender={10} // 🔹 Render fewer items at start
        maxToRenderPerBatch={10} // 🔹 Load smaller batches
        updateCellsBatchingPeriod={50} // 🔹 Reduce updates per frame
        windowSize={5} // 🔹 Keep only 5 screens worth in memory
        refreshing={refreshing} // Add Pull-to-Refresh
        onRefresh={handleRefresh} // Attach Refresh Handler
      />




      <ReportTradePopup
        visible={isReportPopupVisible}
        trade={selectedTrade}
        onClose={() => setReportPopupVisible(false)}
      />

      <SignInDrawer
        visible={isSigninDrawerVisible}
        onClose={handleLoginSuccess}
        selectedTheme={selectedTheme}
        message={t("trade.signin_required_message")}
        screen='Trade'

      />
     
      {!localState.isPro && <BannerAdComponent />}

      {/* {!isProStatus && <View style={{ alignSelf: 'center' }}>
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
      <SubscriptionScreen visible={showofferwall} onClose={() => setShowofferwall(false)} track='Trade' />

    </View>
  );
};
const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 8,
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
      flex: 1,
    },
    tradeItem: {
      padding: 5,
      marginBottom: 10,
      // marginHorizontal: 10,
      backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',

      borderRadius: 10, // Smooth rounded corners
      borderWidth: !config.isNoman ? 3 : 0,
      borderColor: config.colors.hasBlockGreen,
    },

    searchInput: {
      height: 40,
      borderColor: isDarkMode ? config.colors.primary : 'white',
      backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',

      borderWidth: 1,
      borderRadius: 5,
      marginVertical: 8,
      paddingHorizontal: 10,
      color: isDarkMode ? 'white' : 'black',
      flex: 1,
      borderRadius: 10, // Ensure smooth corners
      // shadowColor: '#000', // Shadow color for iOS
      // shadowOffset: { width: 0, height: 0 }, // Positioning of the shadow
      // shadowOpacity: 0.2, // Opacity for iOS shadow
      // shadowRadius: 2, // Spread of the shadow
      // elevation: 2, // Elevation for Android (4-sided shadow)
    },
    tradeHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      // marginBottom: 10,
      // paddingBottom: 10,
      // borderBottomWidth: 1,
      borderColor: 'lightgrey',
      color: isDarkMode ? 'white' : "black",
    },
    traderName: {
      fontFamily: 'Lato-Bold',
      fontSize: 8,
      color: isDarkMode ? 'white' : "black",

    },
    tradeTime: {
      fontSize: 8,
      color: isDarkMode ? 'lightgrey' : "grey",
      // color: 'lightgrey'

    },
    tradeDetails: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      color: isDarkMode ? 'white' : "black",


    },
    itemList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-evenly',
      width: "45%",
      paddingVertical: 15,
      alignSelf: 'center',
    },
    itemImage: {
      width: 30,
      height: 30,
      // marginRight: 5,
      // borderRadius: 25,
      marginVertical: 5,
      borderRadius: 5
      // padding:10

    },
    itemImageUser: {
      width: 20,
      height: 20,
      // marginRight: 5,
      borderRadius: 15,
      marginRight: 5,
      backgroundColor: 'white'
    },
    transferImage: {
      width: 15,
      height: 15,
      // marginRight: 5,
      borderRadius: 5,
    },
    tradeTotals: {
      flexDirection: 'row',
      justifyContent: 'center',
      // marginTop: 10,
      width: '100%'

    },
    priceText: {
      fontSize: 8,
      fontFamily: 'Lato-Regular',
      color: '#007BFF',
      // width: '40%',
      textAlign: 'center', // Centers text within its own width
      alignSelf: 'center', // Centers within the parent container
      color: isDarkMode ? 'white' : "white",
      marginHorizontal: 'auto',
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 6
    },
    priceTextProfit: {
      fontSize: 10,
      lineHeight: 14,
      fontFamily: 'Lato-Regular',
      // color: '#007BFF',
      // width: '40%',
      textAlign: 'center', // Centers text within its own width
      alignSelf: 'center', // Centers within the parent container
      // color: isDarkMode ? 'white' : "grey",
      // marginHorizontal: 'auto',
      // paddingHorizontal: 4,
      // paddingVertical: 2,
      // borderRadius: 6
    },
    hasBackground: {
      backgroundColor: config.colors.hasBlockGreen,
    },
    wantBackground: {
      backgroundColor: config.colors.wantBlockRed,
    },
    tradeActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },

    transfer: {
      // width: '10%',
      justifyContent: 'center',
      alignItems: 'center'
    },
    actionButtons: {
      flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
      borderColor: 'lightgrey', marginTop: 10, paddingTop: 10
    },
    description: {
      color: isDarkMode ? 'lightgrey' : "grey",
      fontFamily: 'Lato-Regular',
      fontSize: 10,
      marginTop: 5,
      lineHeight: 12
    },
    descriptionclick: {
      color: config.colors.secondary,
      fontFamily: 'Lato-Regular',
      fontSize: 10,
      // marginTop: 5,
      // lineHeight:12

    },
    loader: {
      flex: 1
    },
    dealContainer: {
      paddingVertical: 1,
      paddingHorizontal: 6,
      borderRadius: 6,
      alignSelf: 'center',
      marginRight: 10
    },
    dealContainerSingle: {
      paddingVertical: 5,
      paddingHorizontal: 6,
      borderRadius: 6,
      alignSelf: 'center',
      // height:30,
      // marginRight: 10,
      backgroundColor: 'black',
      justifyContent: 'center',
      alignItems: 'center'
    },
    dealText: {
      color: 'white',
      fontFamily: 'Lato-Bold',
      fontSize: 8,
      textAlign: 'center',
      alignItems: 'center',
      justifyContent: 'center'
      // backgroundColor:'black'

    },
    names: {
      fontFamily: 'Lato-Bold',
      fontSize: 8,
      color: isDarkMode ? 'white' : "black",
      marginTop: -3
    },
    tagcount: {
      position: 'absolute',
      backgroundColor: 'purple',
      top: -1,
      left: -1,
      borderRadius: 50,
      paddingHorizontal: 3,
      paddingBottom: 2

    },
    tagcounttext: {
      color: 'white',
      fontFamily: 'Lato-Bold',
      fontSize: 10
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'center',
      borderTopWidth: 1,
      borderColor: 'lightgrey',
      paddingHorizontal: 30,
      paddingTop: 5,
      marginTop: 10
    },
    tag: {
      backgroundColor: config.colors.hasBlockGreen,
      position: 'absolute',
      top: 0,
      left: 0,
      height: 15, // Increased height for a better rounded effect
      width: 15,  // Increased width for proportion
      borderTopLeftRadius: 10,  // Increased to make it more curved
      borderBottomRightRadius: 30, // Further increased for more curve
    }
,
modalContainer: {
  backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 1000,
  padding: 10,

},
modalHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
},
modalTitle: {
  fontSize: 18,
  fontFamily: 'bold',
  color: isDarkMode ? 'white' : "black",
},
modalBody: {
  marginTop: 10,
},
modalSubTitle: {
  fontSize: 16,
  fontFamily: 'Lato-Bold',
  marginVertical: 10,

  color: isDarkMode ? 'white' : "black",
},
itemCard: {
  // width: '33%',
  justifyContent: 'center',
  alignItems:'center'

  
},
itemImage: {
  width: 50,
  height: 50,
  borderRadius: 5,
},
itemName: {
  fontSize: 12,
  fontFamily: 'bold',
  textAlign: 'center',
  marginBottom: 5,
  color: isDarkMode ? 'white' : "black",
},
itemDetail: {
  fontSize: 9,
  // color: '#888',
  textAlign: 'center',
  color: isDarkMode ? 'white' : "black",
},
columnWrapper: {
  // justifyContent: 'space-between',
  width:'99%',
},
modalFooter: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  marginTop: 20,
  // position:'absolute',
 
  width:'100%',
},
chatButton: {
  backgroundColor: config.colors.hasBlockGreen,
  padding: 10,
  borderRadius: 3,
  flex: 1,
  alignItems: 'center',
  marginLeft:5
  // margin:5
},
closeButton: {
  backgroundColor: '#e74c3c',
  padding: 10,
  borderRadius: 3,
  flex: 1,
  alignItems: 'center',
  marginRight:5
  // margin:5

},
chatButtonText: {
  color: 'white',
  fontFamily: 'Lato-Bold',
  color: isDarkMode ? 'white' : "white"
},
closeButtonText: {
  color: 'white',
  fontFamily: 'Lato-Bold'
},
mutationTag: {
  backgroundColor: config.colors.hasBlockGreen, // Change to the desired color
  paddingVertical: 1,
  paddingHorizontal: 4,
  margin: 2,
  borderRadius: 20,
  alignItems: 'center',
  justifyContent: 'center',
},
mutationText: {
  fontSize: 7,
  color: 'white', // Text color inside the pill
  fontFamily: 'Lato-Bold',
},
emptyOfferContainer: {
  alignItems: 'center',
  justifyContent: 'center',
  padding: 5,
  borderRadius: 4,
  // marginTop: 10,
  width:120,
  borderWidth:1,
  // marginHorizontal:'auto'
  borderColor:config.colors.secondary
},
emptyOfferText: {
  fontSize: 16,
  color: isDarkMode ? 'white' : "black",
  fontFamily: 'Lato-Bold',
},
gridContainer: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  // justifyContent: 'space-between',
  width:'100%',
  // alignItems:'flex-start'
},
gridItem: {
  width: '33%',
  marginBottom: 1,
  marginLeft: 1,
  // padding: 10,
  backgroundColor: isDarkMode ? '#34495E' : '#f5f5f5',
  borderRadius: 4,
  justifyContent: 'flex-start',
  // alignItems: 'center',
  borderWidth:1,
  borderColor:isDarkMode ? 'grey' : config.colors.secondary
},
itemDetailsRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  width: '95%',
},
mutationContainer: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  justifyContent: 'center',
  marginTop: 5,
},

  });

export default TradeList;