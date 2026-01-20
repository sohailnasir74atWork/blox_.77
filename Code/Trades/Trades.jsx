import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { View, FlatList, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator, TextInput, Alert, Platform, Animated } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';
import { useNavigation } from '@react-navigation/native';
import ReportTradePopup from './ReportTradePopUp';
import SignInDrawer from '../Firebase/SigninDrawer';
import { useLocalState } from '../LocalGlobelStats';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import SubscriptionScreen from '../SettingScreen/OfferWall';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import StyledUsernamePreview from '../SettingScreen/Store/StyledName';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';
import { isUserOnline } from '../ChatScreen/utils';
import { useHaptic } from '../Helper/HepticFeedBack';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  Timestamp,
  where,
  query,
  startAfter,
  updateDoc,
} from '@react-native-firebase/firestore';

// Initialize dayjs plugins
dayjs.extend(relativeTime);
const iconMap = {
  "camping": require("../../assets/Icons/camping.png"),
  "dinamite": require("../../assets/Icons/dinamite.png"),
  "fire": require("../../assets/Icons/fire.png"),
  "grenade": require("../../assets/Icons/grenade.png"),
  "handheld-game": require("../../assets/Icons/handheld-game.png"),
  "paw-print": require("../../assets/Icons/paw-print.png"),
  "play": require("../../assets/Icons/play.png"),
  "shooting-star": require("../../assets/Icons/shooting-star.png"),
  "smile": require("../../assets/Icons/smile.png"),
  "symbol": require("../../assets/Icons/symbol.png"),
  "treasure-map": require("../../assets/Icons/treasure-map.png"),
};



const TradeList = ({ route }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInHas, setSearchInHas] = useState(true); // ✅ Search in "ME" side (hasItems)
  const [searchInWants, setSearchInWants] = useState(true); // ✅ Search in "YOU" side (wantsItems)
  const [isSearching, setIsSearching] = useState(false); // ✅ Loading state for search
  const [isSearchMode, setIsSearchMode] = useState(false); // ✅ Track if we're in search mode
  const [searchLastDoc, setSearchLastDoc] = useState(null); // ✅ Pagination cursor for search
  const [searchHasMore, setSearchHasMore] = useState(true); // ✅ More results available for search
  const SEARCH_PAGE_SIZE = 5; // ✅ Fetch 5 items at a time for search
  const { selectedTheme } = route.params
  const { user, analytics, single_offer_wall, proGranted } = useGlobalState()
  const [trades, setTrades] = useState([]);
  const [filteredTrades, setFilteredTrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [showofferwall, setShowofferwall] = useState(false);
  const [remainingFeaturedTrades, setRemainingFeaturedTrades] = useState([]);
  const [openShareModel, setOpenShareModel] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [bannedUsers, setBannedUsers] = useState([]);
  const [isOnline, setIsOnline] = useState(false);
  const [isAtTop, setIsAtTop] = useState(true);
  const flatListRef = useRef(null);
  const scrollButtonOpacity = useMemo(() => new Animated.Value(0), []);
  const { triggerHapticFeedback } = useHaptic();
  // Check if user has featured listing purchase
  const purchasesArr = Array.isArray(user?.purchases)
  ? user.purchases
  : Object.values(user?.purchases || {});

const now = Date.now();

const isFeaturedPurchase = purchasesArr.some((purchase) => {
  if (purchase?.id !== "4" || !purchase?.title) return false;
  if (purchase?.expiresAt && now > purchase.expiresAt) return false; // Expired
  return true;
});




  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isReportPopupVisible, setReportPopupVisible] = useState(false);
  const PAGE_SIZE = 20;
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const { localState, updateLocalState } = useLocalState()
  const navigation = useNavigation()
  const { theme , firestoreDB} = useGlobalState()
  const [isProStatus, setIsProStatus] = useState(localState.isPro || proGranted);
  const { t } = useTranslation();
  const platform = Platform.OS.toLowerCase();
  const isDarkMode = theme === 'dark'
  const formatName = (name) => {
    let formattedName = name.replace(/^\+/, '');
    formattedName = formattedName.replace(/\s+/g, '-');
    return formattedName;
  };



  const [selectedFilters, setSelectedFilters] = useState([]); // ✅ Default: no filters (show all)
  useEffect(() => {
    setIsProStatus(localState.isPro || proGranted); // ✅ Force update state and trigger re-render
  }, [localState.isPro, proGranted]);

  // ✅ Client-side filtering for non-search scenarios (filters, banned users)
  useEffect(() => {
    const bannedUsersList = Array.isArray(bannedUsers) ? bannedUsers : [];

    setFilteredTrades(
      trades.filter((trade) => {
        // ✅ Filter out trades from blocked users
        if (bannedUsersList.includes(trade.userId)) {
          return false;
        }

        // ✅ If no filters selected, show all trades
        if (selectedFilters.length === 0) {
          return true;
        }

        // ✅ Separate filter types
        const statusFilters = selectedFilters.filter(f => ['win', 'lose', 'fair'].includes(f));
        const hasMyTradesFilter = selectedFilters.includes("myTrades");

        // ✅ Check status filter match
        let matchesStatus = true;
        if (statusFilters.length > 0) {
          const statusMap = { win: 'w', lose: 'l', fair: 'f' };
          const statusValues = statusFilters.map(f => statusMap[f]);
          matchesStatus = trade.status && statusValues.includes(trade.status);
        }

        // ✅ Check myTrades filter match
        let matchesMyTrades = true;
        if (hasMyTradesFilter) {
          matchesMyTrades = trade.userId === user?.id;
        }

        // ✅ All selected filters must match (AND logic)
        return matchesStatus && matchesMyTrades;
      })
    );
  }, [trades, selectedFilters, user?.id, bannedUsers]);


  useEffect(() => {
    if (!user?.id) return;
    setBannedUsers(localState.bannedUsers)

  }, [user?.id, localState.bannedUsers]);
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

              await deleteDoc(doc(firestoreDB, "trades_new", tradeId));


              if (item.isFeatured) {
                const currentFeaturedData = localState.featuredCount || { count: 0, time: null };
                const newFeaturedCount = Math.max(0, currentFeaturedData.count - 1);

                await updateLocalState("featuredCount", {
                  count: newFeaturedCount,
                  time: currentFeaturedData.time,
                });
              }

              setTrades((prev) => prev.filter((trade) => trade.id !== item.id));

              showSuccessMessage(t("trade.delete_success"), t("trade.delete_success_message"));

            } catch (error) {
              console.error("🔥 [handleDelete] Error deleting trade:", error);
              showErrorMessage(t("trade.delete_error"), t("trade.delete_error_message"));
            }
          },
        },
      ]
    );
  }, [t, localState.featuredCount, firestoreDB]);








  const handleMakeFeatureTrade = async (item) => {
    if (!isProStatus && !isFeaturedPurchase) {
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
      const oneDayAgo = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
      const featuredSnapshot = await getDocs(
        query(
          collection(firestoreDB, "trades_new"),
          where("userId", "==", user.id),
          where("isFeatured", "==", true),
          where("featuredUntil", ">", oneDayAgo)
        )
      );

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
                await updateDoc(
                  doc(firestoreDB, "trades_new", item.id),
                  {
                    isFeatured: true,
                    featuredUntil: Timestamp.fromDate(
                      new Date(Date.now() + 24 * 60 * 60 * 1000)
                    ),
                  }
                );

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
    // ✅ OPTIMIZED: Prevent duplicate calls and check conditions
    if (!hasMore) {
      return;
    }
    if (!lastDoc) {
      return;
    }
    if (loadingMore) {
      return;
    }
    if (!firestoreDB) {
      return;
    }

    setLoadingMore(true);
    try {
      // ✅ Get status filters and map to status values
      const statusFilters = selectedFilters.filter(f => ['win', 'lose', 'fair'].includes(f));
      const statusValues = statusFilters.length > 0 
        ? statusFilters.map(f => ({ win: 'w', lose: 'l', fair: 'f' }[f]))
        : null;

      // ✅ Build query for more normal trades
      let normalQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('isFeatured', '!=', true), // ✅ Match initial query structure
        orderBy('isFeatured'), // ✅ Required: first orderBy must match inequality field
        orderBy('timestamp', 'desc'), // ✅ Then order by timestamp
        startAfter(lastDoc),
        limit(PAGE_SIZE)
      );

      // ✅ Add status filter if status filters are selected
      if (statusValues && statusValues.length > 0) {
        normalQuery = query(
          collection(firestoreDB, 'trades_new'),
          where('isFeatured', '!=', true),
          where('status', 'in', statusValues),
          orderBy('isFeatured'),
          orderBy('timestamp', 'desc'),
          startAfter(lastDoc),
          limit(PAGE_SIZE)
        );
      }

      const normalTradesQuerySnap = await getDocs(normalQuery);

      const newNormalTrades = normalTradesQuerySnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
  
      if (newNormalTrades.length === 0) {
        setHasMore(false);
        setLoadingMore(false);
        return;
      }

      // ✅ FIX: Get more featured trades if available, but prevent duplicates
      // Check which featured trades are already in the current trades list
      const existingFeaturedIds = new Set(
        trades.filter(t => t.isFeatured).map(t => t.id)
      );
      
      // Filter out featured trades that are already shown
      const availableFeatured = remainingFeaturedTrades.filter(
        ft => !existingFeaturedIds.has(ft.id)
      );
      
      const newFeaturedTrades = availableFeatured.slice(0, 3); // ✅ Get up to 3 new featured
      const updatedRemainingFeatured = availableFeatured.slice(3); // ✅ Get remaining after first 3
      setRemainingFeaturedTrades(updatedRemainingFeatured);

      // ✅ Merge & maintain balance
      const mergedTrades = mergeFeaturedWithNormal(newFeaturedTrades, newNormalTrades);

      setTrades((prevTrades) => {
        // ✅ FIX: Deduplicate trades by id to prevent duplicates
        const existingIds = new Set(prevTrades.map(t => t.id));
        const newUniqueTrades = mergedTrades.filter(t => !existingIds.has(t.id));
        return [...prevTrades, ...newUniqueTrades];
      });
      
      // ✅ Update lastDoc only if we have normal trades (for pagination)
      if (normalTradesQuerySnap.docs.length > 0) {
        const newLastDoc = normalTradesQuerySnap.docs[normalTradesQuerySnap.docs.length - 1];
        setLastDoc(newLastDoc);
        const newHasMore = normalTradesQuerySnap.docs.length === PAGE_SIZE;
        setHasMore(newHasMore);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error('Error fetching more trades:', error);
      // ✅ If error is about missing index, log helpful message
      if (error.code === 'failed-precondition') {
        console.warn('⚠️ Firestore index required. Please create composite index for: status + timestamp');
      }
      // ✅ Don't set hasMore to false on error - allow retry
    } finally {
      setLoadingMore(false);
    }
  }, [lastDoc, hasMore, remainingFeaturedTrades, firestoreDB, loadingMore, trades.length, selectedFilters]);



  useEffect(() => {
    const resetFeaturedDataIfExpired = async () => {
      const currentFeaturedData = localState.featuredCount || { count: 0, time: null };

      if (!currentFeaturedData.time) return; // ✅ If no time exists, do nothing

      const featuredTime = new Date(currentFeaturedData.time).getTime();
      const currentTime = Date.now();
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

      if (currentTime - featuredTime >= TWENTY_FOUR_HOURS) {
        await updateLocalState("featuredCount", { count: 0, time: null });
      }
    };

    resetFeaturedDataIfExpired(); // ✅ Runs once on app load

  }, []); // ✅ Runs only on app load


  const selectedUser = {
    senderId: selectedTrade?.userId,
    sender: selectedTrade?.traderName,
    avatar: selectedTrade?.avatar,
    flage: selectedTrade?.flage || null,
  }
  const handleChatNavigation2 = async () => {
    

    const callbackfunction = () => {
      mixpanel.track("Inbox Trade");
      navigation.navigate('PrivateChatTrade', {
        selectedUser: selectedUser,
        item:selectedTrade,
        
      });
    };

    try {


      callbackfunction();


    } catch (error) {
      console.error('Error navigating to PrivateChat:', error);
      Alert.alert('Error', 'Unable to navigate to the chat. Please try again later.');
    }
  };





  const handleEndReached = () => {
    if (loading || isSearching) return; // ✅ Prevents unnecessary calls
    // ✅ Handle search pagination
    if (isSearchMode && searchHasMore) {
      if (!searchLastDoc) return;
      handleSearchTrades(true); // Load more search results
      return;
    }
    // ✅ Normal pagination
    if (!hasMore || !lastDoc || loadingMore) return;
    fetchMoreTrades();
  };

  // ✅ Firestore search - uses indexed fields (hasItemNames/wantsItemNames) for new trades
  const handleSearchTrades = useCallback(async (isLoadMore = false) => {
    const searchTerm = searchQuery.trim();
    if (!searchTerm) {
      setIsSearchMode(false);
      setSearchLastDoc(null);
      setSearchHasMore(true);
      fetchInitialTrades();
      return;
    }

    if (!searchInHas && !searchInWants) {
      Alert.alert('Search Error', 'Please select at least one search option (ME side or YOU side)');
      return;
    }

    setIsSearching(true);
    try {
      const searchTermLower = searchTerm.toLowerCase().trim();
      
      // ✅ Get status filters
      const statusFilters = selectedFilters.filter(f => ['win', 'lose', 'fair'].includes(f));
      const statusValues = statusFilters.length > 0 
        ? statusFilters.map(f => ({ win: 'w', lose: 'l', fair: 'f' }[f]))
        : null;

      const allResults = new Map();
      let lastDocSnapshot = isLoadMore ? searchLastDoc : null;

      // ✅ Search in ME side (hasItemNames) - SERVER-SIDE filtering
      // Requires composite index: hasItemNames (array-contains) + timestamp (desc)
      if (searchInHas) {
        try {
          const hasQuery = lastDocSnapshot
            ? query(
                collection(firestoreDB, 'trades_new'),
                where('hasItemNames', 'array-contains', searchTermLower),
                orderBy('timestamp', 'desc'),
                startAfter(lastDocSnapshot),
                limit(SEARCH_PAGE_SIZE)
              )
            : query(
                collection(firestoreDB, 'trades_new'),
                where('hasItemNames', 'array-contains', searchTermLower),
                orderBy('timestamp', 'desc'),
                limit(SEARCH_PAGE_SIZE)
              );

          const hasSnapshot = await getDocs(hasQuery);
          hasSnapshot.docs?.forEach((docSnap) => {
            if (!allResults.has(docSnap.id)) {
              allResults.set(docSnap.id, { id: docSnap.id, ...docSnap.data(), _doc: docSnap });
            }
          });
        } catch (error) {
          console.error('❌ hasItemNames search error:', error.message);
          // If index missing, show link to create it
          if (error.message?.includes('index')) {
            console.log('📌 Create index at:', error.message.match(/https:\/\/[^\s]+/)?.[0]);
          }
        }
      }

      // ✅ Search in YOU side (wantsItemNames) - SERVER-SIDE filtering
      // Requires composite index: wantsItemNames (array-contains) + timestamp (desc)
      if (searchInWants) {
        try {
          const wantsQuery = lastDocSnapshot
            ? query(
                collection(firestoreDB, 'trades_new'),
                where('wantsItemNames', 'array-contains', searchTermLower),
                orderBy('timestamp', 'desc'),
                startAfter(lastDocSnapshot),
                limit(SEARCH_PAGE_SIZE)
              )
            : query(
                collection(firestoreDB, 'trades_new'),
                where('wantsItemNames', 'array-contains', searchTermLower),
                orderBy('timestamp', 'desc'),
                limit(SEARCH_PAGE_SIZE)
              );

          const wantsSnapshot = await getDocs(wantsQuery);
          wantsSnapshot.docs?.forEach((docSnap) => {
            if (!allResults.has(docSnap.id)) {
              allResults.set(docSnap.id, { id: docSnap.id, ...docSnap.data(), _doc: docSnap });
            }
          });
        } catch (error) {
          console.error('❌ wantsItemNames search error:', error.message);
          if (error.message?.includes('index')) {
            console.log('📌 Create index at:', error.message.match(/https:\/\/[^\s]+/)?.[0]);
          }
        }
      }

      // ✅ Convert to array and sort by timestamp
      let searchedTrades = Array.from(allResults.values())
        .sort((a, b) => {
          const aTime = a.timestamp?.toMillis() || 0;
          const bTime = b.timestamp?.toMillis() || 0;
          return bTime - aTime;
        });

      // ✅ Apply status filter if needed
      if (statusValues && statusValues.length > 0) {
        searchedTrades = searchedTrades.filter(t => statusValues.includes(t.status));
      }

      // ✅ Get last doc for pagination
      if (searchedTrades.length > 0) {
        const lastTrade = searchedTrades[searchedTrades.length - 1];
        lastDocSnapshot = lastTrade._doc || null;
      }

      // ✅ Remove _doc from trades before setting state
      searchedTrades = searchedTrades.map(({ _doc, ...trade }) => trade);

      // ✅ Update state
      if (isLoadMore) {
        setTrades((prev) => {
          const combined = [...prev, ...searchedTrades];
          const unique = Array.from(new Map(combined.map(t => [t.id, t])).values());
          return unique.sort((a, b) => {
            const aTime = a.timestamp?.toMillis() || 0;
            const bTime = b.timestamp?.toMillis() || 0;
            return bTime - aTime;
          });
        });
      } else {
        setTrades(searchedTrades);
        setIsSearchMode(true);
      }

      // ✅ Update pagination state
      setSearchLastDoc(lastDocSnapshot);
      setSearchHasMore(searchedTrades.length >= SEARCH_PAGE_SIZE);
      
    } catch (error) {
      console.error('❌ Error searching trades:', error);
      Alert.alert('Search Error', 'Failed to search trades. Please try again.');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, searchInHas, searchInWants, selectedFilters, firestoreDB, searchLastDoc]);

  const fetchInitialTrades = useCallback(async () => {
    setLoading(true);
    try {
      // ✅ Get status filters (win, lose, fair) and map to status values (w, l, f)
      const statusFilters = selectedFilters.filter(f => ['win', 'lose', 'fair'].includes(f));
      const statusValues = statusFilters.length > 0 
        ? statusFilters.map(f => ({ win: 'w', lose: 'l', fair: 'f' }[f]))
        : null;

      // ✅ OPTIMIZED: Fetch featured and normal trades in parallel (faster loading)
      const now = Timestamp.now();
      
      // ✅ Build query for normal trades
      let normalQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('isFeatured', '!=', true),
        orderBy('isFeatured'), // ✅ Required: first orderBy must match inequality field
        orderBy('timestamp', 'desc'), // ✅ Then order by timestamp
        limit(PAGE_SIZE)
      );

      // ✅ Add status filter if status filters are selected
      if (statusValues && statusValues.length > 0) {
        normalQuery = query(
          collection(firestoreDB, 'trades_new'),
          where('isFeatured', '!=', true),
          where('status', 'in', statusValues),
          orderBy('isFeatured'),
          orderBy('timestamp', 'desc'),
          limit(PAGE_SIZE)
        );
      }

      // ✅ Build query for featured trades
      let featuredQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('isFeatured', '==', true),
        where('featuredUntil', '>', now),
        orderBy('featuredUntil', 'desc'),
        limit(10) // ✅ Limit featured trades to reduce reads
      );

      // ✅ Add status filter to featured trades if status filters are selected
      if (statusValues && statusValues.length > 0) {
        featuredQuery = query(
          collection(firestoreDB, 'trades_new'),
          where('isFeatured', '==', true),
          where('featuredUntil', '>', now),
          where('status', 'in', statusValues),
          orderBy('featuredUntil', 'desc'),
          limit(10)
        );
      }

      const [featuredQuerySnapshot, normalTradesQuerySnap] = await Promise.all([
        getDocs(featuredQuery),
        getDocs(normalQuery),
      ]);

      let featuredTrades = [];
      if (!featuredQuerySnapshot.empty) {
        featuredTrades = featuredQuerySnapshot.docs.map((docSnap) => ({
          id: `featured-${docSnap.id}`,
          ...docSnap.data(),
        }));
      }

      // ✅ Keep some featured trades aside for future loadMore() (fix: don't mutate)
      const allFeaturedTrades = [...featuredTrades]; // Copy array
      setRemainingFeaturedTrades(allFeaturedTrades);
  
      const normalTrades = normalTradesQuerySnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));

      // ✅ Merge trades but **reserve** featured trades for later (fix: use slice)
      const featuredToUse = featuredTrades.slice(0, 3); // ✅ Use slice instead of splice
      const mergedTrades = mergeFeaturedWithNormal(featuredToUse, normalTrades);

      // ✅ FIX: Deduplicate initial trades (shouldn't be needed, but safety check)
      const uniqueMergedTrades = mergedTrades.filter((trade, index, self) => 
        index === self.findIndex(t => t.id === trade.id)
      );

      // ✅ Update state
      setTrades(uniqueMergedTrades);
      
      // ✅ OPTIMIZED: Set lastDoc only if we have normal trades (critical for pagination)
      if (normalTradesQuerySnap.docs.length > 0) {
        const lastDocSnapshot = normalTradesQuerySnap.docs[normalTradesQuerySnap.docs.length - 1];
        setLastDoc(lastDocSnapshot);
        const initialHasMore = normalTrades.length === PAGE_SIZE;
        setHasMore(initialHasMore);
      } else {
        // ✅ If no normal trades initially, check if there are more featured trades
        // If featured trades exist, we still might have more normal trades to load
        setLastDoc(null);
        const fallbackHasMore = featuredTrades.length > 0 || normalTrades.length > 0;
        setHasMore(fallbackHasMore);
      }
    } catch (error) {
      console.error('Error fetching initial trades:', error);
    } finally {
      setLoading(false);
    }
  }, [firestoreDB, selectedFilters]);


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

    if (!user?.id) {
      setTrades((prev) => prev.slice(0, PAGE_SIZE)); // Keep only 20 trades for logged-out users
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]); // ✅ Only depend on user.id

  const closeProfileDrawer = async () => {
    setIsDrawerVisible(false);
  };
  const handleOpenProfile = async(item)=>{
    if (!user?.id) {
      setIsSigninDrawerVisible(true);
      return;
    }
    setSelectedTrade(item)

    try {
      const online = await isUserOnline(item?.userId);
      setIsOnline(online);
    } catch (error) {
      console.error('Error checking online status:', error);
      setIsOnline(false);
    }
    setIsDrawerVisible(true)
  }

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
    // ✅ Reset search when refreshing
    if (searchQuery.trim()) {
      setSearchQuery('');
      setIsSearchMode(false);
      setSearchLastDoc(null);
      setSearchHasMore(true);
    }
    setHasMore(true); // ✅ Reset hasMore
    setLastDoc(null); // ✅ Reset lastDoc
    setRemainingFeaturedTrades([]); // ✅ Reset featured trades
    await fetchInitialTrades();
    setRefreshing(false);
    setIsAtTop(true); // ✅ Reset scroll position
  };

  // ✅ Scroll to top handler
  const handleScrollToTop = useCallback(() => {
    if (!flatListRef?.current) return;
    
    triggerHapticFeedback('impactLight');
    
    try {
      // Scroll to index 0 (top of list)
      flatListRef.current.scrollToIndex({
        index: 0,
        animated: true,
        viewPosition: 0,
      });
      setIsAtTop(true);
    } catch (error) {
      // Fallback: scroll to offset 0
      flatListRef.current.scrollToOffset({ offset: 0, animated: true });
      setIsAtTop(true);
    }
  }, [flatListRef, triggerHapticFeedback]);

  // ✅ Animate scroll button visibility
  useEffect(() => {
    Animated.timing(scrollButtonOpacity, {
      toValue: isAtTop ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isAtTop, scrollButtonOpacity]);

  const handleLoginSuccess = () => {
    setIsSigninDrawerVisible(false);
  };


  // ✅ OPTIMIZED: Helper function to group items (no hooks - can be called from renderTrade)
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

  const renderTrade = ({ item, index }) => {
    const { deal, tradeRatio } = getTradeDeal(item.hasTotal, item.wantsTotal);
    const tradePercentage = Math.abs(((tradeRatio - 1) * 100).toFixed(0));

    const isProfit = tradeRatio > 1; // Profit if trade ratio > 1
    const neutral = tradeRatio === 1; // Exactly 1:1 trade
    const formattedTime = item.timestamp ? dayjs(item.timestamp.toDate()).fromNow() : "Anonymous";

    // ✅ OPTIMIZED: Group items (no hooks - just regular function calls)
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
            flage: item?.flage || null,
          },
          item,
        });
      };

      try {
        // const isOnline = await isUserOnline(item.userId)


        callbackfunction();


      } catch (error) {
        console.error('Error navigating to PrivateChat:', error);
        Alert.alert('Error', 'Unable to navigate to the chat. Please try again later.');
      }
    };

    return (
      <View style={[styles.tradeItem, item.isFeatured && { backgroundColor: isDarkMode ? '#34495E' : 'rgba(245, 222, 179, 0.6)' }]}>
        {item.isFeatured && <View style={styles.tag}></View>}

        <View style={styles.tradeHeader}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex:1  }} onPress={()=>handleOpenProfile(item)}>
            <Image 
              source={{ uri: item.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }} 
              style={styles.itemImageUser}
            />

            <View style={{  marginLeft: 5 }}>
              <View style={styles.traderName}>
              {(item?.style && Object.keys(item?.style).length > 0) ? (
    <StyledUsernamePreview
      text={item.traderName}
      variant={item.style.variant}
      options={item.style}
      fontSize={14}
      lineHeight={16}
      marginVertical={0}
    />
  ) : (
    <Text style={styles.traderName}>{item.traderName}</Text>
  )}
  {item?.isPro && (
    <Image
      source={require('../../assets/pro.png')}
      style={{ width: 10, height: 10, marginRight: 5 }}
    />
  )}
  {item?.robloxUsernameVerified && (
    <Image
      source={require('../../assets/verification.png')}
      style={{ width: 10, height: 10, marginRight: 5 }}
    />
  )}
  {(() => {
    const hasRecentWin =
      !!item?.hasRecentGameWin ||
      (typeof item?.lastGameWinAt === 'number' &&
        Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000);
    return hasRecentWin ? (
      <Image
        source={require('../../assets/trophy.webp')}
        style={{ width: 10, height: 10, marginRight: 5 }}
      />
    ) : null;
  })()}
  {(item?.isProGranted || item.proTagBought) && (
    <Image
      source={require('../../assets/progranted.png')}
      style={{ width: 16, height: 16, marginLeft: 2 }}
    />
  )}
  {Array.isArray(item.icons) && item.icons.slice(0, 4).map(iconKey => (
    <Image
      key={iconKey}
      source={iconMap[iconKey]}
      style={{ width: 16, height: 16, marginLeft: 4, resizeMode: 'contain' }}
    />
  ))}
                {item.rating ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center',  backgroundColor: '#ffb300', borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1, marginLeft: 5 }}>
                    <Icon name="star" size={8} color="white" style={{ marginRight: 4 }} />
                    <Text style={{ fontSize: 8, color: 'white' }}>{parseFloat(item.rating).toFixed(1)}({item.ratingCount})</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center',  backgroundColor: '#888', borderRadius: 5, paddingHorizontal: 2, paddingVertical: 1, marginLeft: 5 }}>
                    <Icon name="star-outline" size={8} color="white" style={{ marginRight: 4 }} />
                    <Text style={{ fontSize: 8, color: 'white' }}>N/A</Text>
                  </View>
                )}


              </View>

              {/* Rating Info */}


              <Text style={styles.tradeTime}>{formattedTime}</Text>
            </View>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', }}>
            {/* {(groupedHasItems.length > 0 && groupedWantsItems.length > 0) &&  <View style={[styles.dealContainer, { backgroundColor: deal.color }]}>
              <Text style={styles.dealText}>

                {t(deal.label)}
              </Text>

            </View>} */}
 <FontAwesome
        name='message'
         size={18}
              color={config.colors.primary}
              onPress={()=>handleOpenProfile(item)}

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
                    resizeMode="contain"
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
              <TouchableOpacity style={styles.dealContainerSingle} onPress={()=>handleOpenProfile(item)}>
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
                    resizeMode="contain"
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
            ME {formatValue(item.hasTotal.value)}
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
            YOU {formatValue(item.wantsTotal.value)}
          </Text>}
        </View>

        {/* Description */}
        {item.description && <Text style={styles.description}>{renderTextWithUsername(item.description)}
        </Text>}
        {item.userId === user.id && (<View style={styles.footer}>
          {!item.isFeatured &&
                <TouchableOpacity  onPress={() => handleMakeFeatureTrade(item)} style={[styles.boost, {backgroundColor:'purple'}]}>
                <Text
                 
                 
                  
                 
                  style={{  color:'white', fontFamily:'Lato-Regular' }}
                >BOOST IT</Text>
                </TouchableOpacity>}
       <TouchableOpacity  onPress={() => handleDelete(item)} style={[styles.boost, {backgroundColor:'black'}]}>
       <Text
                 
                 
                 color={config.colors.secondary}
                
                 style={{ color:'white', fontFamily:'Lato-Regular' }}
               >DELETE IT</Text>
                </TouchableOpacity>

              

        </View>)}
        {/* <ShareTradeModal
          visible={openShareModel}
          onClose={() => setOpenShareModel(false)}
          tradeData={selectedTrade}
        /> */}

      </View>
    );
  };

  // ✅ OPTIMIZED: Show skeleton loader instead of blank screen
  if (loading && trades.length === 0) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={styles.loader} size="large" color="#007BFF" />
        <Text style={[styles.loadingText, { color: isDarkMode ? 'white' : 'black' }]}>
          Loading trades...
        </Text>
      </View>
    );
  }


  return (
    <View style={styles.container}>
      {/* ✅ Modern Search Container */}
      <View style={[styles.searchContainer, { backgroundColor: isDarkMode ? '#1e1e1e' : '#fff' }]}>
        <View style={styles.searchInputContainer}>
          <TextInput
            style={[styles.searchInput, { color: isDarkMode ? '#fff' : '#000' }]}
            placeholder={t("trade.search_placeholder") || "Search items..."}
            placeholderTextColor={isDarkMode ? '#888' : '#666'}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={() => {
              setSearchLastDoc(null);
              setSearchHasMore(true);
              handleSearchTrades(false);
            }}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity 
              onPress={() => {
                setSearchQuery('');
                setIsSearchMode(false);
                setSearchLastDoc(null);
                setSearchHasMore(true);
                fetchInitialTrades();
              }} 
              style={styles.clearSearchButton}
            >
              <Icon name="close-circle" size={20} color={isDarkMode ? '#999' : '#666'} />
            </TouchableOpacity>
          )}
          {/* ✅ Search Button - Inside input container on right side */}
          <TouchableOpacity
            style={[
              styles.searchButtonInline,
              { 
                backgroundColor: searchQuery.trim() ? config.colors.primary : (isDarkMode ? '#333' : '#ddd'),
                opacity: searchQuery.trim() && !isSearching ? 1 : 0.6
              }
            ]}
            onPress={() => {
              // ✅ Reset pagination for new search
              setSearchLastDoc(null);
              setSearchHasMore(true);
              handleSearchTrades(false);
            }}
            disabled={!searchQuery.trim() || isSearching}
            activeOpacity={0.8}
          >
            {isSearching ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Icon name="search" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>

        {/* ✅ Search Options Checkboxes */}
        {searchQuery.length > 0 && (
          <View style={styles.searchOptionsContainer}>
            <TouchableOpacity
              style={[styles.checkboxContainer, !searchInHas && styles.checkboxUnchecked]}
              onPress={() => {
                triggerHapticFeedback('impactLight');
                // ✅ Ensure at least one checkbox is always checked
                if (!searchInHas && !searchInWants) {
                  setSearchInWants(true);
                }
                setSearchInHas(!searchInHas);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, searchInHas && styles.checkboxChecked]}>
                {searchInHas && <Icon name="checkmark" size={14} color="#fff" />}
              </View>
              <Text style={[styles.checkboxLabel, { color: isDarkMode ? '#fff' : '#000' }]}>
                Search in ME side
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.checkboxContainer, !searchInWants && styles.checkboxUnchecked]}
              onPress={() => {
                triggerHapticFeedback('impactLight');
                // ✅ Ensure at least one checkbox is always checked
                if (!searchInHas && !searchInWants) {
                  setSearchInHas(true);
                }
                setSearchInWants(!searchInWants);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, searchInWants && styles.checkboxChecked]}>
                {searchInWants && <Icon name="checkmark" size={14} color="#fff" />}
              </View>
              <Text style={[styles.checkboxLabel, { color: isDarkMode ? '#fff' : '#000' }]}>
                Search in YOU side
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      <FlatList
        ref={flatListRef}
        data={isSearchMode ? trades : filteredTrades}
        renderItem={renderTrade}
        keyExtractor={(item, index) => {
          // ✅ FIX: Featured trades already have 'featured-' prefix in their id
          // Use the id directly, or add index for uniqueness
          if (item.id) {
            return item.id;
          }
          // Fallback: use index if id is missing
          return `trade-${index}`;
        }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20, flexGrow: 1 }}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        removeClippedSubviews={false} // ✅ FIX: Disable to prevent blank spaces during scrolling
        initialNumToRender={15} // ✅ FIX: Render more items initially for smoother scrolling
        maxToRenderPerBatch={10} // ✅ FIX: Larger batches for better rendering performance
        updateCellsBatchingPeriod={50} // ✅ FIX: More frequent updates for smoother experience
        windowSize={10} // ✅ FIX: Larger window size to keep more items in memory
        refreshing={refreshing} // Add Pull-to-Refresh
        onRefresh={handleRefresh} // Attach Refresh Handler
        onScroll={({ nativeEvent }) => {
          const { contentOffset } = nativeEvent;
          // ✅ Check if user is at top (within 60px from top)
          const atTop = contentOffset.y <= 60;
          setIsAtTop(atTop);
        }}
        scrollEventThrottle={16}
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={config.colors.primary} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          !loading && filteredTrades.length === 0 ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 }}>
              <Text style={[styles.loadingText, { color: isDarkMode ? 'white' : 'black' }]}>
                No trades found
              </Text>
            </View>
          ) : null
        }
      />
      {/* ✅ Scroll to Top Button */}
      {!isAtTop && (
        <Animated.View
          style={[
            styles.scrollToTopButton,
            {
              opacity: scrollButtonOpacity,
              transform: [
                {
                  scale: scrollButtonOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.8, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <TouchableOpacity
            onPress={handleScrollToTop}
            activeOpacity={0.8}
            style={styles.scrollToTopTouchable}
          >
            <Icon
              name="chevron-up-circle"
              size={48}
              color={config.colors.primary}
            />
          </TouchableOpacity>
        </Animated.View>
      )}




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
      <SubscriptionScreen visible={showofferwall} onClose={() => setShowofferwall(false)} track='Trade'   oneWallOnly={single_offer_wall}      />
      <ProfileBottomDrawer
          isVisible={isDrawerVisible}
          toggleModal={closeProfileDrawer}  
          startChat={handleChatNavigation2}
          selectedUser={selectedUser}
          isOnline={isOnline}
          bannedUsers={bannedUsers}
        />
      {(!localState.isPro && !proGranted) && <BannerAdComponent />}
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
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      borderWidth: 0,
      marginVertical: 8,
      paddingHorizontal: 10,
      color: isDarkMode ? 'white' : '#1a1a1a',
      flex: 1,
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
    flexDirection:'row',
    alignItems:'baseline'

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
      width: 25,
      height: 25,
      // marginRight: 5,
      borderRadius: 15,
      // marginRight: 5,
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
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    loadingText: {
      marginTop: 10,
      fontSize: 14,
      fontFamily: 'Lato-Regular',
      textAlign: 'center',
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
      justifyContent: 'flex-start',
      borderTopWidth: 1,
      backgroundColor:'#F5A327',
      // paddingHorizontal: 30,
      paddingTop: 5,
      marginTop: 10,
      borderTopColor:config.colors.hasBlockGreen
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
    },
    boost:{
      justifyContent:'flex-start', paddingVertical:2, paddingHorizontal:5, borderRadius:3, alignItems:'center', margin:4
    },
    scrollToTopButton: {
      position: 'absolute',
      bottom: 60, // Position above the bottom ad banner
      right: 8,
      zIndex: 1000,
      elevation: 8, // For Android shadow
      shadowColor: '#000', // For iOS shadow
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
    },
    scrollToTopTouchable: {
      borderRadius: 28,
      // backgroundColor: isDarkMode ? 'rgba(30, 30, 30, 0.9)' : 'rgba(255, 255, 255, 0.9)',
      // padding: 4,
      justifyContent: 'center',
      alignItems: 'center',
    },
    searchContainer: {
      padding: 6,
      borderRadius: 12,
      marginVertical: 8,
      // shadowColor: '#000',
      // shadowOffset: { width: 0, height: 2 },
      // shadowOpacity: 0.3,
      // shadowRadius: 4,
      // elevation: 3,
    },
    searchInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDarkMode ? '#2a2a2a' : '#f0f0f0',
      borderRadius: 10,
      paddingHorizontal: 6,
      borderWidth: 1.5,
      borderColor: isDarkMode ? '#444' : '#c5c5c5',
    },
    searchIcon: {
      marginRight: 8,
    },
    clearSearchButton: {
      padding: 4,
      marginLeft: 8,
    },
    searchOptionsContainer: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      // marginBottom: 10,
      paddingVertical: 8,
    },
    checkboxContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: isDarkMode ? '#2a2a2a' : '#e8e8e8',
      borderWidth: isDarkMode ? 0 : 1,
      borderColor: isDarkMode ? 'transparent' : '#d0d0d0',
    },
    checkboxUnchecked: {
      opacity: 0.6,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 4,
      borderWidth: 2,
      borderColor: config.colors.primary,
      marginRight: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    checkboxChecked: {
      backgroundColor: config.colors.primary,
      borderColor: config.colors.primary,
    },
    checkboxLabel: {
      fontSize: 13,
      fontFamily: 'Lato-Regular',
    },
    searchButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 10,
      marginTop: 4,
    },
    searchButtonInline: {
      width: 40,
      height: 40,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 8,
    },
    searchButtonText: {
      color: '#fff',
      fontSize: 15,
      fontFamily: 'Lato-Bold',
    },

  });

export default TradeList;