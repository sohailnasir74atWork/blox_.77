import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, FlatList, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator, TextInput, Alert, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import moment from 'moment';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';
import { useNavigation } from '@react-navigation/native';
// import { isUserOnline } from '../ChatScreen/utils';
import { AdEventType, BannerAd, BannerAdSize, InterstitialAd } from 'react-native-google-mobile-ads';
import getAdUnitId from '../Ads/ads';
import { FilterMenu } from './tradeHelpers';
import ReportTradePopup from './ReportTradePopUp';
import SignInDrawer from '../Firebase/SigninDrawer';
import { useLocalState } from '../LocalGlobelStats';
import firestore from '@react-native-firebase/firestore';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTranslation } from 'react-i18next';
import FlashMessage, { showMessage } from 'react-native-flash-message';
import { logEvent } from '@react-native-firebase/analytics';
import MyNativeAdComponent from '../Ads/NativAds';


const bannerAdUnitId = getAdUnitId('banner');
const interstitialAdUnitId = getAdUnitId('interstitial');
const interstitial = InterstitialAd.createForAdRequest(interstitialAdUnitId);
const TradeList = ({ route }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdVisible, setIsAdVisible] = useState(true);
  const { selectedTheme } = route.params
  const { user, analytics } = useGlobalState()
  const [trades, setTrades] = useState([]);
  const [filteredTrades, setFilteredTrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [filterType, setFilterType] = useState('hasItems');
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isShowingAd, setIsShowingAd] = useState(false);
  const [isReportPopupVisible, setReportPopupVisible] = useState(false);
  const PAGE_SIZE = 20;
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const { localState } = useLocalState()
  const navigation = useNavigation()
  const { theme } = useGlobalState()
  const { t } = useTranslation();
  const platform = Platform.OS.toLowerCase();
  const isDarkMode = theme === 'dark'
  const formatName = (name) => {
    let formattedName = name.replace(/^\+/, '');
    formattedName = formattedName.replace(/\s+/g, '-');
    return formattedName;
  };


 
  
  // const handleReportTrade = (trade) => {
  //   setSelectedTrade(trade);
  //   setReportPopupVisible(true);
  // };
  const [selectedFilters, setSelectedFilters] = useState([]);
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

        const tradeLabel = getTradeDeal(trade.hasTotal, trade.wantsTotal).label;

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
  const getTradeDeal = (hasTotal, wantsTotal) => {
    if (!hasTotal?.price || !wantsTotal?.price || hasTotal.price <= 0) {
      return { label: "trade.unknown_deal", color: "#8E8E93" }; // ⚠️ Unknown deal (invalid input)
    }

    const tradeRatio = wantsTotal.price / hasTotal.price;
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

    return deal;
  };


  const handleDelete = useCallback((item) => {
    Alert.alert(
      t("trade.delete_confirmation_title"), // "Confirm Deletion"
      t("trade.delete_confirmation_message"), // "Are you sure you want to delete this trade? This action cannot be undone."
      [
        {
          text: t("trade.cancel"), // "Cancel"
          style: "cancel",
        },
        {
          text: t("trade.delete"), // "Delete"
          onPress: async () => {
            try {
              // Delete the trade from Firestore
              await firestore().collection('trades').doc(item.id).delete();

              // Update local state to remove the deleted trade
              setTrades((prev) => prev.filter((trade) => trade.id !== item.id));
              setFilteredTrades((prev) => prev.filter((trade) => trade.id !== item.id));

              // Alert.alert(t("trade.delete_success"), t("trade.delete_success_message")); 
              showMessage({
                message: t("trade.delete_success"),
                description: t("trade.delete_success_message"),
                type: "success",
              });
              // "Success", "Trade deleted successfully!"
            } catch (error) {
              console.error('🔥 Error deleting trade:', error);
              Alert.alert(t("trade.delete_error"), t("trade.delete_error_message"));
              showMessage({
                message: t("trade.delete_error"),
                description: t("trade.delete_error_message"),
                type: "danger",
              });
              // "Error", "Failed to delete the trade. Please try again."
            }
          },
          style: "destructive", // Red color for destructive action
        },
      ]
    );
  }, [t]);


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
      const querySnapshot = await firestore()
        .collection('trades')
        .orderBy('timestamp', 'desc')
        .startAfter(lastDoc)
        .limit(PAGE_SIZE)
        .get();

      if (!querySnapshot.empty) {
        const newTrades = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setTrades((prevTrades) => [...prevTrades, ...newTrades]);
        setLastDoc(querySnapshot.docs[querySnapshot.docs.length - 1]);
        setHasMore(newTrades.length === PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Error fetching more trades:", error);
    }
  }, [lastDoc, hasMore]);




  const handleEndReached = () => {
    if (!hasMore) {
      return;
    }
    if (!user?.id) {

      setIsSigninDrawerVisible(true);
      return;
    }

    fetchMoreTrades();
  };
  // console.log(trades)

  const fetchInitialTrades = useCallback(async () => {
    setLoading(true);
    try {
      const querySnapshot = await firestore()
        .collection('trades')
        .orderBy('timestamp', 'desc')
        .limit(PAGE_SIZE)
        .get();

      if (!querySnapshot.empty) {
        const tradeList = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setTrades(tradeList);
        setLastDoc(querySnapshot.docs[querySnapshot.docs.length - 1]); // Save last doc for pagination
        setHasMore(tradeList.length === PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Error fetching initial trades:", error);
    } finally {
      setLoading(false);
    }
  }, []);




  useEffect(() => {
    fetchInitialTrades();

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



  const renderTrade = ({ item, index }) => {
    const formattedTime = item.timestamp ? moment(item.timestamp.toDate()).fromNow() : "Anonymous";
    if ((index + 1) % 10 === 0) {
      return <MyNativeAdComponent />;
    }
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

      try {
        // const isOnline = await isUserOnline(item.userId);
        showInterstitialAd(() => {
          if (!user?.id) {
            setIsSigninDrawerVisible(true);
            return;
          }
          navigation.navigate('PrivateChatTrade', {
            selectedUser: {
              senderId: item.userId,
              sender: item.traderName,
              avatar: item.avatar,
            },
            // isOnline,
          });
        });
        logEvent(analytics, `${platform}_trade_screen_nav_to_chat`);


      } catch (error) {
        console.error('Error navigating to PrivateChat:', error);
        Alert.alert('Error', 'Unable to navigate to the chat. Please try again later.');
      }
    };

    return (
      <View style={styles.tradeItem}>

        <View style={styles.tradeHeader}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }} onPress={handleChatNavigation}>
            <Image source={{ uri: item.avatar }} style={styles.itemImageUser} />
            <View style={{ justifyContent: 'center' }}>
              <Text style={styles.traderName}>{item.traderName} {item.isPro && <Icon
                name="checkmark-done-circle"
                size={16}
                color={config.colors.hasBlockGreen}
              />}</Text>
              <Text style={styles.tradeTime}>{formattedTime}</Text>
            </View>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row' }}>
            <View style={[styles.dealContainer, { backgroundColor: getTradeDeal(item.hasTotal, item.wantsTotal).color }]}>
              <Text style={styles.dealText}>
                {t(getTradeDeal(item.hasTotal, item.wantsTotal).label)}
              </Text>

            </View>

            <Icon
              name="chatbox-outline"
              size={18}
              color={config.colors.secondary}
              onPress={handleChatNavigation}
            />
          </View>
        </View>



        {/* Trade Items */}
        <View style={styles.tradeDetails}>
          {/* Has Items */}
          <View style={styles.itemList}>
            {groupedHasItems.map((hasItem, index) => (
              <View key={`${hasItem.name}-${hasItem.type}`} style={{ justifyContent: 'center', alignItems: 'center' }}>
                <Image
                  source={{
                    uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(hasItem.name)}_Icon.webp`,
                  }}
                  style={[styles.itemImage, { backgroundColor: hasItem.type === 'p' ? '#FFCC00' : '' }]}
                />
                <Text style={styles.names}>
                  {hasItem.name}{hasItem.type === 'p' && " (P)"}
                </Text>
                {hasItem.count > 1 && <View style={styles.tagcount}><Text style={styles.tagcounttext}>{hasItem.count}</Text></View>}
              </View>
            ))}
          </View>

          {/* Transfer Icon */}
          <View style={styles.transfer}>
            <Image source={require('../../assets/transfer.png')} style={styles.transferImage} />
          </View>

          {/* Wants Items */}
          <View style={styles.itemList}>
            {groupedWantsItems.map((wantsItem, index) => (
              <View key={`${wantsItem.name}-${wantsItem.type}`} style={{ justifyContent: 'center', alignItems: 'center' }}>
                <Image
                  source={{
                    uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(wantsItem.name)}_Icon.webp`,
                  }}
                  style={[styles.itemImage, { backgroundColor: wantsItem.type === 'p' ? '#FFCC00' : '' }]}
                />
                <Text style={styles.names}>
                  {wantsItem.name}{wantsItem.type === 'p' && " (P)"}
                </Text>
                {wantsItem.count > 1 && <View style={styles.tagcount}><Text style={styles.tagcounttext}>{wantsItem.count}</Text></View>}
              </View>
            ))}
          </View>
        </View>
        <View style={styles.tradeTotals}>
          <Text style={[styles.priceText, styles.hasBackground]}>
            {t("trade.price_has")} {formatValue(item.hasTotal.price)}
          </Text>
          <View style={styles.transfer}>
            {item.userId === user.id && (
              <Icon
                name="trash-outline"
                size={18}
                color={config.colors.wantBlockRed}
                onPress={() => handleDelete(item)}
              />
            )}
          </View>
          <Text style={[styles.priceText, styles.wantBackground]}>
            {t("trade.price_want")} {formatValue(item.wantsTotal.price)}
          </Text>
        </View>

        {/* Description */}
        {item.description && <Text style={styles.description}>{renderTextWithUsername(item.description)}
        </Text>}


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
        keyExtractor={(item) => item.id.toString()}
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
        onClose={() => setIsSigninDrawerVisible(false)}
        selectedTheme={selectedTheme}
        message={t("trade.signin_required_message")}

      />
      {/* <FlashMessage position="top" /> */}

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
      backgroundColor: isDarkMode ? config.colors.primary : 'white',
      borderRadius: 10, // Smooth rounded corners
      borderWidth: !config.isNoman ? 3 : 0,
      borderColor: config.colors.hasBlockGreen,
    },

    searchInput: {
      height: 48,
      borderColor: isDarkMode ? config.colors.primary : 'white',
      backgroundColor: isDarkMode ? config.colors.primary : 'white',
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
      fontSize: 10,
      color: isDarkMode ? 'white' : "black",

    },
    tradeTime: {
      fontSize: 8,
      color: '#666',
      color: 'lightgrey'

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
      width: "40%",
      paddingVertical: 15,
    },
    itemImage: {
      width: 40,
      height: 40,
      // marginRight: 5,
      // borderRadius: 25,
      marginVertical: 5,
      borderRadius: 5
      // padding:10

    },
    itemImageUser: {
      width: 30,
      height: 30,
      // marginRight: 5,
      borderRadius: 15,
      marginRight: 5,
      backgroundColor: 'white'
    },
    transferImage: {
      width: 20,
      height: 20,
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
      fontSize: 10,
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
    // actionText: {
    //   marginLeft: 5,
    //   fontSize: 10,
    //   color: config.colors.hasBlockGreen,
    //   textShadowColor: isDarkMode ? '#000000AA' : '#FFFFFFAA', // Dark Mode: Black shadow, Light Mode: White shadow
    //   textShadowOffset: { width: 1, height: 1 }, // Offset the shadow slightly
    //   textShadowRadius: 3, // Blur effect for the shadow

    // },
    transfer: {
      width: '20%',
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
      marginTop: 5,
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
    dealText: {
      color: 'white',
      fontWeight: 'Lato-Bold',
      fontSize: 10,
      textAlign: 'center',
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
  });

export default TradeList;
