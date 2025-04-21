import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, FlatList, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator, TextInput, Alert, Platform } from 'react-native';
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
import firestore from '@react-native-firebase/firestore';
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
  const formatName = (name) => {
    let formattedName = name.replace(/^\+/, '');
    formattedName = formattedName.replace(/\s+/g, '-');
    return formattedName;
  };




  const [selectedFilters, setSelectedFilters] = useState([]);

  useEffect(() => {
    // console.log(localState.isPro, 'from trade model'); // ✅ Check if isPro is updated
    setIsProStatus(localState.isPro); // ✅ Force update state and trigger re-render
  }, [localState.isPro]);

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
              item.name.toLowerCase().includes(lowerCaseQuery)
            );
        }

        if (selectedFilters.includes("wants")) {
          matchesAnyFilter =
            matchesAnyFilter ||
            trade.wantsItems?.some((item) =>
              item.name.toLowerCase().includes(lowerCaseQuery)
            );
        }

        if (selectedFilters.includes("myTrades")) {
          matchesAnyFilter = matchesAnyFilter || trade.userId === user.id;
        }

        const { deal } = getTradeDeal(trade.hasTotal, trade.wantsTotal);
        const tradeLabel = deal?.label || "trade.unknown_deal"; // Fallback to avoid undefined


        if (selectedFilters.includes("fairDeal")) {
          matchesAnyFilter = matchesAnyFilter || tradeLabel === "trade.fair_deal";
        }

        if (selectedFilters.includes("riskyDeal")) {
          matchesAnyFilter = matchesAnyFilter || tradeLabel === "trade.risky_deal";
        }

        if (selectedFilters.includes("bestDeal")) {
          matchesAnyFilter = matchesAnyFilter || tradeLabel === "trade.best_deal";
        }

        if (selectedFilters.includes("decentDeal")) {
          matchesAnyFilter = matchesAnyFilter || tradeLabel === "trade.decent_deal";
        }

        if (selectedFilters.includes("weakDeal")) {
          matchesAnyFilter = matchesAnyFilter || tradeLabel === "trade.weak_deal";
        }

        if (selectedFilters.includes("greatDeal")) {
          matchesAnyFilter = matchesAnyFilter || tradeLabel === "trade.great_deal";
        }

        return matchesAnyFilter; // Show if it matches at least one selected filter
      })
    );
  }, [searchQuery, trades, selectedFilters]);



  const getTradeDeal = (hasTotal, wantsTotal) => {
    if (hasTotal.value <= 0) {
      return { label: "trade.unknown_deal", color: "#8E8E93" }; // ⚠️ Unknown deal (invalid input)
    }

    const tradeRatio = wantsTotal.value / hasTotal.value;
    let deal;

    if (tradeRatio >= 0.05 && tradeRatio <= 0.6) {
      deal = { label: "trade.best_deal", color: "#34C759" }; // ✅ Best Deal
    } else if (tradeRatio > 0.6 && tradeRatio <= 0.75) {
      deal = { label: "trade.great_deal", color: "#32D74B" }; // 🟢 Great Deal
    } else if (tradeRatio > 0.75 && tradeRatio <= 1.25) {
      deal = { label: "trade.fair_deal", color: "#FFCC00" }; // ⚖️ Fair Deal
    } else if (tradeRatio > 1.25 && tradeRatio <= 1.4) {
      deal = { label: "trade.decent_deal", color: "#FF9F0A" }; // 🟠 Decent Deal
    } else if (tradeRatio > 1.4 && tradeRatio <= 1.55) {
      deal = { label: "trade.weak_deal", color: "#D65A31" }; // 🔴 Weak Deal
    } else {
      deal = { label: "trade.risky_deal", color: "#7D1128" }; // ❌ Risky Deal (Missing in your original code)
    }

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

  // console.log(trades)

  // import firestore from '@react-native-firebase/firestore'; // Ensure this import

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


  // const captureAndSave = async () => {
  //   if (!viewRef.current) {
  //     console.error('View reference is undefined.');
  //     return;
  //   }

  //   try {
  //     // Capture the view as an image
  //     const uri = await captureRef(viewRef.current, {
  //       format: 'png',
  //       quality: 0.8,
  //     });

  //     // Generate a unique file name
  //     const timestamp = new Date().getTime(); // Use the current timestamp
  //     const uniqueFileName = `screenshot_${timestamp}.png`;

  //     // Determine the path to save the screenshot
  //     const downloadDest = Platform.OS === 'android'
  //       ? `${RNFS.ExternalDirectoryPath}/${uniqueFileName}`
  //       : `${RNFS.DocumentDirectoryPath}/${uniqueFileName}`;

  //     // Save the captured image to the determined path
  //     await RNFS.copyFile(uri, downloadDest);

  //     // console.log(`Screenshot saved to: ${downloadDest}`);

  //     return downloadDest;
  //   } catch (error) {
  //     console.error('Error capturing screenshot:', error);
  //     // Alert.alert(t("home.alert.error"), t("home.screenshot_error"));
  //     showMessage({
  //       message: t("home.alert.error"),
  //       description: t("home.screenshot_error"),
  //       type: "danger",
  //     });
  //   }
  // };

  // const proceedWithScreenshotShare = async () => {
  //   triggerHapticFeedback('impactLight');
  //   try {
  //     const filePath = await captureAndSave();

  //     if (filePath) {
  //       const shareOptions = {
  //         title: t("home.screenshot_title"),
  //         url: `file://${filePath}`,
  //         type: 'image/png',
  //       };

  //       Share.open(shareOptions)
  //         .then((res) => console.log('Share Response:', res))
  //         .catch((err) => console.log('Share Error:', err));
  //     }
  //   } catch (error) {
  //     // console.log('Error sharing screenshot:', error);
  //   }
  // };

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

  // useEffect(() => {
  //   const unsubscribe = firestore()
  //     .collection('trades_new')
  //     .orderBy('timestamp', 'desc')
  //     .limit(PAGE_SIZE)
  //     .onSnapshot(snapshot => {
  //       const newTrades = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  //       setTrades(newTrades);
  //       setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
  //       setHasMore(snapshot.docs.length === PAGE_SIZE);
  //     }, error => console.error('🔥 Firestore error:', error));

  //   return () => unsubscribe(); // ✅ Unsubscribing on unmount
  // }, []);



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




  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchInitialTrades();
    setRefreshing(false);
  };

  const handleLoginSuccess = () => {
    setIsSigninDrawerVisible(false);
  };


  const renderTrade = ({ item, index }) => {
    const { deal, tradeRatio } = getTradeDeal(item.hasTotal, item.wantsTotal);
    const tradePercentage = Math.abs(((tradeRatio - 1) * 100).toFixed(0));

    const isProfit = tradeRatio > 1; // Profit if trade ratio > 1
    const neutral = tradeRatio === 1; // Exactly 1:1 trade
    const formattedTime = item.timestamp ? dayjs(item.timestamp.toDate()).fromNow() : "Anonymous";

    // if ((index + 1) % 10 === 0 && !isProStatus) {
    //   return <MyNativeAdComponent />;
    // }
    // Function to group items and count duplicates
    const groupItems = (items) => {
      const grouped = {};
      items.forEach(({ name, type }) => {
        const key = `${name}-${type}`;
        if (grouped[key]) {
          grouped[key].count += 1;
        } else {
          grouped[key] = { name, type, count: 1 };
        }
      });
      return Object.values(grouped);
    };

    // Group and count duplicate items
    const groupedHasItems = groupItems(item.hasItems || []);
    const groupedWantsItems = groupItems(item.wantsItems || []);

    const handleChatNavigation = async () => {

      const callbackfunction = () => {
        if (!user?.id) {
          setIsSigninDrawerVisible(true);
          return;
        }
        mixpanel.track("Inbox Trade");
        navigation.navigate('PrivateChatTrade', {
          selectedUser: {
            senderId: item.userId,
            sender: item.traderName,
            avatar: item.avatar,
          },
          item,
        });
      };

      try {
        // const isOnline = await isUserOnline(item.userId)


        if (!localState.isPro) { InterstitialAdManager.showAd(callbackfunction); }
        else { callbackfunction() }


      } catch (error) {
        console.error('Error navigating to PrivateChat:', error);
        Alert.alert('Error', 'Unable to navigate to the chat. Please try again later.');
      }
    };

    return (
      <View style={[styles.tradeItem, item.isFeatured && { backgroundColor: isDarkMode ? '#34495E' : 'rgba(245, 222, 179, 0.6)' }]}>
        {item.isFeatured && <View style={styles.tag}></View>}


        <View style={styles.tradeHeader}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }} onPress={handleChatNavigation}>
            <Image source={{ uri: item.avatar }} style={styles.itemImageUser} />

            <View style={{ justifyContent: 'center', marginLeft: 10 }}>
              <Text style={styles.traderName}>
                {item.traderName}{' '}
                {item.isPro &&
                  <Icon
                    name="checkmark-done-circle"
                    size={14}
                    color={config.colors.hasBlockGreen}
                  />}
                {item.rating ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, backgroundColor: '#FFD700', borderRadius: 5, paddingHorizontal: 4, paddingVertical: 2, marginLeft: 5 }}>
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

          <View style={{ flexDirection: 'row' }}>
            {/* {(groupedHasItems.length > 0 && groupedWantsItems.length > 0) &&  <View style={[styles.dealContainer, { backgroundColor: deal.color }]}>
              <Text style={styles.dealText}>

                {t(deal.label)}
              </Text>

            </View>} */}
 <FontAwesome
        name='message'
         size={18}
              color={config.colors.primary}
              onPress={handleChatNavigation}
        solid={false}
      />
            {/* <Icon
              name="chatbox-outline"
              size={18}
              color={config.colors.secondary}
              onPress={handleChatNavigation}
            /> */}
          </View>
        </View>
        {/* Trade Items */}
        <View style={styles.tradeDetails}>
          {/* Has Items */}
          <View style={styles.itemList}>
            {groupedHasItems.length > 0 ? (
              groupedHasItems.map((hasItem, index) => (
                <View key={`${hasItem.name}-${hasItem.type}`} style={{ justifyContent: 'center', alignItems: 'center' }}>
                  <Image
                    source={{
                      uri: hasItem.type === 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(hasItem.name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(hasItem.name)}_Icon.webp`,
                    }}
                    style={[styles.itemImage, { backgroundColor: hasItem.type === 'p' ? '#FFCC00' : '' }]}
                  />
                  <Text style={styles.names}>
                    {hasItem.name}{hasItem.type === 'p' && " (P)"}
                  </Text>
                  {hasItem.count > 1 && (
                    <View style={styles.tagcount}>
                      <Text style={styles.tagcounttext}>{hasItem.count}</Text>
                    </View>
                  )}
                </View>
              ))
            ) : (
              <TouchableOpacity style={styles.dealContainerSingle} onPress={handleChatNavigation}>
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
            {groupedWantsItems.length > 0 ? (
              groupedWantsItems.map((wantnItem, index) => (
                <View key={`${wantnItem.name}-${wantnItem.type}`} style={{ justifyContent: 'center', alignItems: 'center' }}>
                  <Image
                    source={{
                      uri: wantnItem.type === 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(wantnItem.name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(wantnItem.name)}_Icon.webp`,
                    }}
                    style={[styles.itemImage, { backgroundColor: wantnItem.type === 'p' ? '#FFCC00' : '' }]}
                  />
                  <Text style={styles.names}>
                    {wantnItem.name}{wantnItem.type === 'p' && " (P)"}
                  </Text>
                  {wantnItem.count > 1 && (
                    <View style={styles.tagcount}>
                      <Text style={styles.tagcounttext}>{wantnItem.count}</Text>
                    </View>
                  )}
                </View>
              ))
            ) : (
              <TouchableOpacity style={styles.dealContainerSingle} onPress={handleChatNavigation}>
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

      </View>
    );
  };

  if (loading) {
    return <ActivityIndicator style={styles.loader} size="large" color="#007BFF" />;
  }


  return (
    <View style={styles.container}>
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
      padding: 10,
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
      alignSelf: 'center'
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
      fontWeight: 'Lato-Bold',
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

  });

export default TradeList;