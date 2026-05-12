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
import RoleBadges from '../Design/componenets/RoleBadges';
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
import { acceptTrade, saveTrade, unsaveTrade } from './tradeHelpers';
import FramedAvatar from '../ChatScreen/GroupChat/FramedAvatar';
import { getCachedProfile, warmProfileCache } from '../Helper/profileCache';
import { ref as dbRef, onValue } from '@react-native-firebase/database';
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
  const { user, analytics, single_offer_wall, proGranted, strikeInfo, isAdmin, appdatabase, isUserBlocked } = useGlobalState()
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
  const [savedTradeRefs, setSavedTradeRefs] = useState({});
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
  const { theme, firestoreDB } = useGlobalState()
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
  const [followingIds, setFollowingIds] = useState([]);
  const isMyTradesActive = selectedFilters.includes('myTrades');
  const isFollowingActive = selectedFilters.includes('following');

  // Filter button press handlers
  const handleMyTradesPress = useCallback(() => {
    triggerHapticFeedback('impactLight');
    if (!user?.id) { setIsSigninDrawerVisible(true); return; }
    setSelectedFilters(prev =>
      prev.includes('myTrades')
        ? prev.filter(f => f !== 'myTrades')
        : [...prev.filter(f => f !== 'following'), 'myTrades']
    );
  }, [user?.id]);

  const handleFollowingPress = useCallback(() => {
    triggerHapticFeedback('impactLight');
    if (!user?.id) { setIsSigninDrawerVisible(true); return; }
    setSelectedFilters(prev =>
      prev.includes('following')
        ? prev.filter(f => f !== 'following')
        : [...prev.filter(f => f !== 'myTrades'), 'following']
    );
  }, [user?.id]);

  useEffect(() => {
    const headerTint = selectedTheme.colors.text;
    const primary = config.colors.primary;
    navigation.setOptions({
      title: t('tabs.trade', { defaultValue: 'Trades' }),
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            onPress={handleMyTradesPress}
            activeOpacity={0.75}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 12,
              backgroundColor: isMyTradesActive ? primary : 'transparent',
              borderWidth: 1,
              borderColor: isMyTradesActive ? primary : headerTint + '55',
              gap: 4,
            }}
          >
            <Icon name={isMyTradesActive ? 'person' : 'person-outline'} size={12} color={isMyTradesActive ? '#fff' : headerTint} />
            <Text style={{ fontSize: 11, fontWeight: '700', color: isMyTradesActive ? '#fff' : headerTint }}>
              {t('trade.my_trades', { defaultValue: 'My Trades' })}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleFollowingPress}
            activeOpacity={0.75}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 12,
              backgroundColor: isFollowingActive ? '#8b5cf6' : 'transparent',
              borderWidth: 1,
              borderColor: isFollowingActive ? '#8b5cf6' : headerTint + '55',
              gap: 4,
            }}
          >
            <Icon name={isFollowingActive ? 'people' : 'people-outline'} size={12} color={isFollowingActive ? '#fff' : headerTint} />
            <Text style={{ fontSize: 11, fontWeight: '700', color: isFollowingActive ? '#fff' : headerTint }}>
              {t('trade.following', { defaultValue: 'Following' })}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Trade Notifier')} activeOpacity={0.8} style={{ padding: 4 }}>
            <Icon name="notifications-outline" size={22} color={headerTint} />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, t, handleMyTradesPress, handleFollowingPress, isMyTradesActive, isFollowingActive, selectedTheme]);

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
        const hasFollowingFilter = selectedFilters.includes("following");

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

        // ✅ Check following filter match
        let matchesFollowing = true;
        if (hasFollowingFilter) {
          matchesFollowing = followingIds.includes(trade.userId);
        }

        // ✅ All selected filters must match (AND logic)
        return matchesStatus && matchesMyTrades && matchesFollowing;
      })
    );
  }, [trades, selectedFilters, user?.id, bannedUsers, followingIds]);


  useEffect(() => {
    if (!user?.id) return;
    setBannedUsers(localState.bannedUsers)

  }, [user?.id, localState.bannedUsers]);

  // ✅ Fetch following IDs for "Following" filter
  useEffect(() => {
    if (!user?.id || !firestoreDB) return;
    (async () => {
      try {
        const q = query(
          collection(firestoreDB, 'following'),
          where('followerId', '==', user.id),
          limit(200),
        );
        const snap = await getDocs(q);
        const ids = snap.docs.map(d => d.data().followingId).filter(Boolean);
        setFollowingIds(ids);
      } catch (err) {
        console.warn('[Trades] Error fetching following list:', err?.message);
      }
    })();
  }, [user?.id, firestoreDB]);

  // Real-time listener for saved/accepted trade refs — stays in sync across screens
  useEffect(() => {
    if (!user?.id || !appdatabase) return;
    const savedRef = dbRef(appdatabase, `savedTrades/${user.id}`);
    const unsubscribe = onValue(savedRef, (snapshot) => {
      setSavedTradeRefs(snapshot.exists() ? snapshot.val() : {});
    });
    return () => unsubscribe();
  }, [user?.id, appdatabase]);

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

              await deleteDoc(doc(firestoreDB, "trades_new_upgrade", tradeId));


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
          collection(firestoreDB, "trades_new_upgrade"),
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
                  doc(firestoreDB, "trades_new_upgrade", item.id),
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
        collection(firestoreDB, 'trades_new_upgrade'),
        where('isFeatured', '!=', true), // ✅ Match initial query structure
        orderBy('isFeatured'), // ✅ Required: first orderBy must match inequality field
        orderBy('timestamp', 'desc'), // ✅ Then order by timestamp
        startAfter(lastDoc),
        limit(PAGE_SIZE)
      );

      // ✅ Add status filter if status filters are selected
      if (statusValues && statusValues.length > 0) {
        normalQuery = query(
          collection(firestoreDB, 'trades_new_upgrade'),
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
      // Block banned users from messaging (admins exempt). Defer expiry to
      // server-time-validated `isUserBlocked` so a clock-rolled device can't
      // slip past — strikeInfo is used only for the message text.
      if (isUserBlocked && !isAdmin) {
        const { bannedUntil } = strikeInfo || {};

        if (bannedUntil === 'permanent') {
          showErrorMessage(
            t("home.alert.error"),
            "You are permanently banned from using this feature."
          );
          return;
        }

        if (typeof bannedUntil === 'number') {
          const remaining = Math.max(0, bannedUntil - Date.now());
          const totalMinutes = Math.ceil(remaining / 60000);
          const hours = Math.floor(totalMinutes / 60);
          const minutes = totalMinutes % 60;
          const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

          showErrorMessage(
            t("home.alert.error"),
            `You are banned from using this feature for ${timeLeftText} more minute(s).`
          );
          return;
        }

        showErrorMessage(t("home.alert.error"), "You are currently banned from using this feature.");
        return;
      }

      mixpanel.track("Inbox Trade");
      navigation.navigate('PrivateChatTrade', {
        selectedUser: selectedUser,
        item: selectedTrade,
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
              collection(firestoreDB, 'trades_new_upgrade'),
              where('hasItemNames', 'array-contains', searchTermLower),
              orderBy('timestamp', 'desc'),
              startAfter(lastDocSnapshot),
              limit(SEARCH_PAGE_SIZE)
            )
            : query(
              collection(firestoreDB, 'trades_new_upgrade'),
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
              collection(firestoreDB, 'trades_new_upgrade'),
              where('wantsItemNames', 'array-contains', searchTermLower),
              orderBy('timestamp', 'desc'),
              startAfter(lastDocSnapshot),
              limit(SEARCH_PAGE_SIZE)
            )
            : query(
              collection(firestoreDB, 'trades_new_upgrade'),
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
        collection(firestoreDB, 'trades_new_upgrade'),
        where('isFeatured', '!=', true),
        orderBy('isFeatured'), // ✅ Required: first orderBy must match inequality field
        orderBy('timestamp', 'desc'), // ✅ Then order by timestamp
        limit(PAGE_SIZE)
      );

      // ✅ Add status filter if status filters are selected
      if (statusValues && statusValues.length > 0) {
        normalQuery = query(
          collection(firestoreDB, 'trades_new_upgrade'),
          where('isFeatured', '!=', true),
          where('status', 'in', statusValues),
          orderBy('isFeatured'),
          orderBy('timestamp', 'desc'),
          limit(PAGE_SIZE)
        );
      }

      // ✅ Build query for featured trades
      let featuredQuery = query(
        collection(firestoreDB, 'trades_new_upgrade'),
        where('isFeatured', '==', true),
        where('featuredUntil', '>', now),
        orderBy('featuredUntil', 'desc'),
        limit(10) // ✅ Limit featured trades to reduce reads
      );

      // ✅ Add status filter to featured trades if status filters are selected
      if (statusValues && statusValues.length > 0) {
        featuredQuery = query(
          collection(firestoreDB, 'trades_new_upgrade'),
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

      // ✅ Warm profile cache for trade poster cosmetics (tradeCardBg)
      const allUserIds = [...new Set([...normalTrades, ...featuredTrades].map(t => t.userId).filter(Boolean))];
      if (appdatabase && allUserIds.length > 0) {
        warmProfileCache(appdatabase, allUserIds);
      }

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

  // ✅ Fetch only current user's trades (for "My Trades" filter)
  const fetchMyTrades = useCallback(async () => {
    if (!user?.id || !firestoreDB) return;
    setLoading(true);
    try {
      const myQuery = query(
        collection(firestoreDB, 'trades_new_upgrade'),
        where('userId', '==', user.id),
        orderBy('timestamp', 'desc'),
        limit(50)
      );
      const snap = await getDocs(myQuery);
      const myTrades = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTrades(myTrades);
      setHasMore(false);
    } catch (e) {
      console.warn('[Trades] fetchMyTrades error:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id, firestoreDB]);

  // ✅ Fetch trades from followed users (for "Following" filter)
  const fetchFollowingTrades = useCallback(async () => {
    if (!user?.id || followingIds.length === 0) {
      setTrades([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const TRADE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
      const sevenDaysAgo = Timestamp.fromMillis(Date.now() - TRADE_MAX_AGE_MS);
      const chunk = followingIds.slice(0, 30); // Firestore 'in' limit
      const followQuery = query(
        collection(firestoreDB, 'trades_new_upgrade'),
        where('userId', 'in', chunk),
        where('timestamp', '>', sevenDaysAgo),
        orderBy('timestamp', 'desc'),
        limit(50)
      );
      const snap = await getDocs(followQuery);
      const followTrades = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTrades(followTrades);
      setHasMore(false);
    } catch (e) {
      console.warn('[Trades] fetchFollowingTrades error:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id, followingIds, firestoreDB]);

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
  //     .collection('trades_new_upgrade')
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

  // ✅ Refetch trades when My Trades / Following filter changes
  useEffect(() => {
    if (selectedFilters.includes('myTrades')) {
      fetchMyTrades();
    } else if (selectedFilters.includes('following')) {
      fetchFollowingTrades();
    } else {
      fetchInitialTrades();
    }
    // Auto-scroll to top on filter change
    if (flatListRef.current) {
      flatListRef.current.scrollToOffset({ offset: 0, animated: true });
    }
  }, [isMyTradesActive, isFollowingActive]);

  const closeProfileDrawer = async () => {
    setIsDrawerVisible(false);
  };
  const handleOpenProfile = async (item) => {
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
    // ✅ Respect active filter on refresh
    if (isMyTradesActive) {
      await fetchMyTrades();
    } else if (isFollowingActive) {
      await fetchFollowingTrades();
    } else {
      await fetchInitialTrades();
    }
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

  // ── Alternate trade card renderer (non-Noman) ──
  const renderTradeAlt = ({ item, index }) => {
    const { deal, tradeRatio } = getTradeDeal(item.hasTotal, item.wantsTotal);
    const tradePercentage = Math.abs(((tradeRatio - 1) * 100).toFixed(0));
    const isProfit = tradeRatio > 1;
    const neutral = tradeRatio === 1;
    const formattedTime = item.timestamp ? dayjs(item.timestamp.toDate()).fromNow() : "Anonymous";
    const groupedHasItems = groupItems(item.hasItems || []);
    const groupedWantsItems = groupItems(item.wantsItems || []);

    const handleChatNavigation = async () => {
      const callbackfunction = () => {
        if (!user?.id) { setIsSigninDrawerVisible(true); return; }
        mixpanel.track("Inbox Trade");
        navigation.navigate('PrivateChatTrade', {
          selectedUser: { senderId: item.userId, sender: item.traderName, avatar: item.avatar, flage: item?.flage || null },
          item,
        });
      };
      try { callbackfunction(); } catch (error) {
        console.error('Error navigating to PrivateChat:', error);
        Alert.alert('Error', 'Unable to navigate to the chat. Please try again later.');
      }
    };

    return (
      <View style={[styles.altTradeCard, item.isFeatured && styles.altTradeCardFeatured, (() => {
        const posterProfile = getCachedProfile(item.userId);
        const bg = posterProfile?.tradeCardBg;
        if (bg) {
          return { backgroundColor: isDarkMode ? (bg.darkColor || bg.color) : bg.color, borderWidth: 1, borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' };
        }
        return null;
      })()]}>
        {item.isFeatured && (
          <View style={styles.altFeaturedRow}>
            <View style={styles.altFeaturedBadge}>
              <Text style={styles.altFeaturedText}>⭐ FEATURED</Text>
            </View>
          </View>
        )}

        {/* Header row */}
        <View style={styles.altTradeHeader}>
          <TouchableOpacity style={styles.altTradeUserRow} onPress={() => handleOpenProfile(item)}>
            <FramedAvatar
              avatarUri={item.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
              frame={getCachedProfile(item.userId)?.profileFrame || null}
              isDarkMode={isDarkMode}
              avatarSize={32}
            />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                {(item?.style && Object.keys(item?.style).length > 0) ? (
                  <StyledUsernamePreview text={item.traderName} variant={item.style.variant} options={item.style} fontSize={13} lineHeight={15} marginVertical={0} />
                ) : (
                  <Text style={styles.altTradeName}>{item.traderName}</Text>
                )}
                <RoleBadges userItem={item} />
                {item?.isPro && <Image source={require('../../assets/pro.png')} style={{ width: 10, height: 10, marginLeft: 4 }} />}
                {item?.robloxUsernameVerified && <Image source={require('../../assets/verification.png')} style={{ width: 10, height: 10, marginLeft: 4 }} />}
                {(() => {
                  const hasRecentWin = !!item?.hasRecentGameWin || (typeof item?.lastGameWinAt === 'number' && Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000);
                  return hasRecentWin ? <Image source={require('../../assets/trophy.webp')} style={{ width: 10, height: 10, marginLeft: 4 }} /> : null;
                })()}
                {(item?.isProGranted || item.proTagBought) && <Image source={require('../../assets/progranted.png')} style={{ width: 14, height: 14, marginLeft: 4 }} />}
                {Array.isArray(item.icons) && item.icons.slice(0, 4).map(iconKey => (
                  <Image key={iconKey} source={iconMap[iconKey]} style={{ width: 14, height: 14, marginLeft: 4, resizeMode: 'contain' }} />
                ))}
              </View>
              <Text style={styles.altTradeTime}>{formattedTime}</Text>
            </View>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {item.rating ? (
              <View style={styles.altRatingPill}>
                <Icon name="star" size={10} color="#fff" />
                <Text style={styles.altRatingText}>{parseFloat(item.rating).toFixed(1)}</Text>
              </View>
            ) : null}
            <TouchableOpacity onPress={() => handleOpenProfile(item)} style={{ marginLeft: 8 }}>
              <FontAwesome name='message' size={18} color={config.colors.primary} solid={false} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Totals bar at top of items */}
        <View style={styles.altTotalsBar}>
          {groupedHasItems.length > 0 && <View style={[styles.altTotalPill, { backgroundColor: config.colors.hasBlockGreen }]}>
            <Text style={styles.altTotalPillText}>ME {formatValue(item.hasTotal.value)}</Text>
          </View>}
          {(groupedHasItems.length > 0 && groupedWantsItems.length > 0) && <Text style={[styles.altPercentText, { color: !isProfit ? config.colors.hasBlockGreen : config.colors.wantBlockRed }]}>
            {tradePercentage}% {!neutral && <Icon name={isProfit ? 'arrow-down-outline' : 'arrow-up-outline'} size={10} color={isProfit ? config.colors.wantBlockRed : config.colors.hasBlockGreen} />}
          </Text>}
          {groupedWantsItems.length > 0 && <View style={[styles.altTotalPill, { backgroundColor: config.colors.wantBlockRed }]}>
            <Text style={styles.altTotalPillText}>YOU {formatValue(item.wantsTotal.value)}</Text>
          </View>}
        </View>

        {/* Items displayed in a unified horizontal scroll-like row */}
        <View style={styles.altItemsRow}>
          <View style={styles.altItemsSection}>
            {groupedHasItems.length > 0 ? groupedHasItems.map((hasItem) => (
              <View key={`${hasItem.name}-${hasItem.type}`} style={styles.altItemBubble}>
                <Image
                  source={{ uri: hasItem.type === 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(hasItem.name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(hasItem.name)}_Icon.webp` }}
                  style={[styles.altItemImg, { backgroundColor: hasItem.type === 'p' ? '#FFCC00' : 'transparent' }]}
                  resizeMode="contain"
                />
                <Text style={styles.altItemLabel}>{hasItem.name}{hasItem.type === 'p' && " (P)"}</Text>
                {hasItem.count > 1 && <View style={styles.altCountBadge}><Text style={styles.altCountText}>{hasItem.count}</Text></View>}
              </View>
            )) : (
              <TouchableOpacity style={styles.altOfferBtn} onPress={() => handleOpenProfile(item)}>
                <Text style={styles.altOfferBtnText}>Give offer</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.altTransferIcon}>
            <Image source={require('../../assets/transfer.png')} style={{ width: 14, height: 14 }} />
          </View>
          <View style={styles.altItemsSection}>
            {groupedWantsItems.length > 0 ? groupedWantsItems.map((wantItem) => (
              <View key={`${wantItem.name}-${wantItem.type}`} style={styles.altItemBubble}>
                <Image
                  source={{ uri: wantItem.type === 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(wantItem.name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(wantItem.name)}_Icon.webp` }}
                  style={[styles.altItemImg, { backgroundColor: wantItem.type === 'p' ? '#FFCC00' : 'transparent' }]}
                  resizeMode="contain"
                />
                <Text style={styles.altItemLabel}>{wantItem.name}{wantItem.type === 'p' && " (P)"}</Text>
                {wantItem.count > 1 && <View style={styles.altCountBadge}><Text style={styles.altCountText}>{wantItem.count}</Text></View>}
              </View>
            )) : (
              <TouchableOpacity style={styles.altOfferBtn} onPress={handleChatNavigation}>
                <Text style={styles.altOfferBtnText}>Give offer</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {item.description && <Text style={styles.description}>{renderTextWithUsername(item.description)}</Text>}
        {item.userId === user.id && (
          <View style={styles.altFooterRow}>
            {!item.isFeatured && <TouchableOpacity onPress={() => handleMakeFeatureTrade(item)} style={styles.altBoostBtn}>
              <Icon name="rocket-outline" size={12} color="white" />
              <Text style={styles.altBoostText}>BOOST</Text>
            </TouchableOpacity>}
            <TouchableOpacity onPress={() => handleDelete(item)} style={styles.altDeleteBtn}>
              <Icon name="trash-outline" size={12} color="white" />
              <Text style={styles.altBoostText}>DELETE</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* Accept/Save buttons for alt layout */}
        {item.userId !== user?.id && (
          <View style={styles.tradeActionRow}>
            <TouchableOpacity
              onPress={async () => {
                if (!user?.id) { setIsSigninDrawerVisible(true); return; }
                triggerHapticFeedback('impactLight');
                const tradeId = item.id;
                if (savedTradeRefs[tradeId]) {
                  try {
                    await unsaveTrade(appdatabase, user.id, tradeId);
                    setSavedTradeRefs(prev => { const n = { ...prev }; delete n[tradeId]; return n; });
                    showSuccessMessage(t('trade.removed', { defaultValue: 'Removed' }), t('trade.trade_unsaved', { defaultValue: 'Trade removed from saved' }));
                  } catch (e) {
                    showErrorMessage(t('home.alert.error'), e?.message || 'Error');
                  }
                } else {
                  try {
                    await saveTrade(appdatabase, user.id, item);
                    setSavedTradeRefs(prev => ({ ...prev, [tradeId]: { type: 'saved' } }));
                    showSuccessMessage(t('trade.saved', { defaultValue: 'Trade Saved!' }), '');
                  } catch (e) {
                    showErrorMessage(t('home.alert.error'), e?.message || 'Error');
                  }
                }
              }}
              style={[styles.tradeSaveBtn, savedTradeRefs[item.id]?.type === 'saved' && { backgroundColor: '#3B82F620' }]}
              activeOpacity={0.75}
            >
              <Icon name={savedTradeRefs[item.id] ? 'bookmark' : 'bookmark-outline'} size={14} color="#3B82F6" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                if (!user?.id) { setIsSigninDrawerVisible(true); return; }
                const tradeId = item.id;
                if (savedTradeRefs[tradeId]?.type === 'accepted') {
                  triggerHapticFeedback('impactLight');
                  return;
                }
                Alert.alert(
                  t('trade.accept_trade', { defaultValue: 'Accept This Trade?' }),
                  t('trade.accept_confirm_guide', { defaultValue: 'Accept this trade? The trader will be notified.' }),
                  [
                    { text: t('chat.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
                    {
                      text: t('trade.yes_accept', { defaultValue: 'Yes, Accept' }),
                      onPress: async () => {
                        triggerHapticFeedback('impactMedium');
                        setSavedTradeRefs(prev => ({ ...prev, [tradeId]: { type: 'accepted' } }));
                        try {
                          await acceptTrade(appdatabase, firestoreDB, user.id, user.displayName || 'Someone', item, { avatar: user.avatar || '', robloxUsername: user.robloxUsername || '' });
                          triggerHapticFeedback('notificationSuccess');
                          showSuccessMessage(t('trade.accepted', { defaultValue: 'Trade Accepted!' }), t('trade.accepted_guide', { defaultValue: 'The trader has been notified!' }));
                        } catch (e) {
                          setSavedTradeRefs(prev => { const next = { ...prev }; delete next[tradeId]; return next; });
                          showErrorMessage(t('home.alert.error'), e?.message || 'Error');
                        }
                      }
                    }
                  ]
                );
              }}
              style={[styles.tradeAcceptBtn, savedTradeRefs[item.id]?.type === 'accepted' && { backgroundColor: '#10B981' }]}
              activeOpacity={0.75}
            >
              <Icon name={savedTradeRefs[item.id]?.type === 'accepted' ? 'checkmark-circle' : 'checkmark'} size={12} color={savedTradeRefs[item.id]?.type === 'accepted' ? '#fff' : '#10B981'} />
              <Text style={[styles.tradeAcceptBtnText, savedTradeRefs[item.id]?.type === 'accepted' && { color: '#fff' }]}>
                {savedTradeRefs[item.id]?.type === 'accepted' ? t('trade.accepted_short', { defaultValue: 'Accepted' }) : t('trade.accept', { defaultValue: 'Accept' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tradeChatBtn2} onPress={handleChatNavigation} activeOpacity={0.8}>
              <Icon name="paper-plane-outline" size={10} color="#fff" />
              <Text style={styles.tradeChatBtnLabel}>Chat</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
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
      <View style={[styles.tradeItem, item.isFeatured && styles.tradeItemFeatured, (() => {
        const posterProfile = getCachedProfile(item.userId);
        const bg = posterProfile?.tradeCardBg;
        if (bg) {
          return { backgroundColor: isDarkMode ? (bg.darkColor || bg.color) : bg.color, borderWidth: 1, borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' };
        }
        return null;
      })()]}>
        {item.isFeatured && (
          <View style={styles.featuredTopRow}>
            <View style={styles.featuredTopLabel}>
              <Text style={styles.featuredTopLabelText}>⭐ Featured</Text>
            </View>
          </View>
        )}

        <View style={styles.tradeHeader}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => handleOpenProfile(item)}>
            <FramedAvatar
              avatarUri={item.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
              frame={getCachedProfile(item.userId)?.profileFrame || null}
              isDarkMode={isDarkMode}
              avatarSize={30}
            />

            <View style={{ marginLeft: 5 }}>
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
                <RoleBadges userItem={item} />
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffb300', borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1, marginLeft: 5 }}>
                    <Icon name="star" size={8} color="white" style={{ marginRight: 4 }} />
                    <Text style={{ fontSize: 8, color: 'white' }}>{parseFloat(item.rating).toFixed(1)}({item.ratingCount})</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#888', borderRadius: 5, paddingHorizontal: 2, paddingVertical: 1, marginLeft: 5 }}>
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
              <TouchableOpacity style={styles.dealContainerSingle} onPress={() => handleOpenProfile(item)}>
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
        {/* ── Social Actions Row ── */}
        <View style={styles.socialActionsRow}>
          {/* Left side: Owner Actions */}
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {item.userId === user?.id && (
              <>
                {!item.isFeatured && (
                  <TouchableOpacity onPress={() => handleMakeFeatureTrade(item)} style={styles.tradeBoostBtn}>
                    <Icon name="rocket-outline" size={11} color="white" />
                    <Text style={styles.tradeBtnText}>BOOST</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => handleDelete(item)} style={styles.tradeDeleteBtn}>
                  <Icon name="trash-outline" size={11} color="white" />
                  <Text style={styles.tradeBtnText}>DELETE</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Right side: Engagement Actions */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {/* Save / Accept — only for other users' trades */}
            {item.userId !== user?.id && (
              <>
                <TouchableOpacity
                  onPress={async () => {
                    if (!user?.id) { setIsSigninDrawerVisible(true); return; }
                    triggerHapticFeedback('impactLight');
                    const tradeId = item.id;
                    if (savedTradeRefs[tradeId]) {
                      try {
                        await unsaveTrade(appdatabase, user.id, tradeId);
                        setSavedTradeRefs(prev => { const n = { ...prev }; delete n[tradeId]; return n; });
                        showSuccessMessage(t('trade.removed', { defaultValue: 'Removed' }), t('trade.trade_unsaved', { defaultValue: 'Trade removed from saved' }));
                      } catch (e) {
                        showErrorMessage(t('home.alert.error'), e?.message || 'Error');
                      }
                    } else {
                      try {
                        await saveTrade(appdatabase, user.id, item);
                        setSavedTradeRefs(prev => ({ ...prev, [tradeId]: { type: 'saved' } }));
                        Alert.alert(
                          '🔖 ' + t('trade.saved', { defaultValue: 'Trade Saved!' }),
                          t('trade.saved_guide', { defaultValue: 'This trade has been saved to My Stuff → Active Trades → Saved tab.\n\nFrom there you can:\n• View the trader\'s Roblox username & copy it\n• Chat with the trader\n• Ping the trader when you\'re ready' }),
                          [{ text: t('trade.got_it', { defaultValue: 'Got it!' }) }]
                        );
                      } catch (e) {
                        showErrorMessage(t('home.alert.error'), e?.message || 'Error');
                      }
                    }
                  }}
                  style={[styles.socialBtn, savedTradeRefs[item.id]?.type === 'saved' && { backgroundColor: '#3B82F620' }]}
                  activeOpacity={0.75}
                >
                  <Icon name={savedTradeRefs[item.id] ? 'bookmark' : 'bookmark-outline'} size={14} color="#3B82F6" />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={async () => {
                    if (!user?.id) { setIsSigninDrawerVisible(true); return; }
                    const tradeId = item.id;
                    if (savedTradeRefs[tradeId]?.type === 'accepted') {
                      triggerHapticFeedback('impactLight');
                      showSuccessMessage('✅', t('trade.already_accepted', { defaultValue: 'Already accepted!' }));
                      return;
                    }
                    Alert.alert(
                      '🤝 ' + t('trade.accept_trade', { defaultValue: 'Accept This Trade?' }),
                      t('trade.accept_confirm_guide', { defaultValue: 'Are you sure you want to accept this trade?\n\nOnce accepted, the trader will be notified. You can find this trade in My Stuff → Active Trades → Accepted tab.' }),
                      [
                        { text: t('chat.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
                        {
                          text: t('trade.yes_accept', { defaultValue: 'Yes, Accept' }),
                          onPress: async () => {
                            triggerHapticFeedback('impactMedium');
                            setSavedTradeRefs(prev => ({ ...prev, [tradeId]: { type: 'accepted' } }));
                            try {
                              await acceptTrade(appdatabase, firestoreDB, user.id, user.displayName || 'Someone', item, { avatar: user.avatar || '', robloxUsername: user.robloxUsername || '' });
                              triggerHapticFeedback('notificationSuccess');
                              Alert.alert(
                                '✅ ' + t('trade.accepted', { defaultValue: 'Trade Accepted!' }),
                                t('trade.accepted_guide', { defaultValue: 'The trader has been notified!\n\nHead to My Stuff → Active Trades → Accepted tab to:\n• Copy the trader\'s Roblox username\n• Chat with them to set up the trade\n• Ping them when you\'re online and ready' }),
                                [{ text: t('trade.got_it', { defaultValue: 'Got it!' }) }]
                              );
                            } catch (e) {
                              setSavedTradeRefs(prev => { const next = { ...prev }; delete next[tradeId]; return next; });
                              showErrorMessage(t('home.alert.error'), e?.message || 'Error');
                            }
                          }
                        }
                      ]
                    );
                  }}
                  style={[styles.tradeAcceptBtn, savedTradeRefs[item.id]?.type === 'accepted' && { backgroundColor: '#10B981' }]}
                  activeOpacity={0.75}
                >
                  <Icon name={savedTradeRefs[item.id]?.type === 'accepted' ? 'checkmark-circle' : 'checkmark'} size={12} color={savedTradeRefs[item.id]?.type === 'accepted' ? '#fff' : '#10B981'} />
                  <Text style={[styles.tradeAcceptBtnText, savedTradeRefs[item.id]?.type === 'accepted' && { color: '#fff' }]}>
                    {savedTradeRefs[item.id]?.type === 'accepted' ? t('trade.accepted_short', { defaultValue: 'Accepted' }) : t('trade.accept', { defaultValue: 'Accept' })}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity style={styles.tradeChatBtn2} onPress={() => handleOpenProfile(item)} activeOpacity={0.8}>
              <Icon name="chatbubble" size={10} color="#fff" />
              <Text style={styles.tradeChatBtnLabel}>{t('feed.chat', { defaultValue: 'Chat' })}</Text>
            </TouchableOpacity>
          </View>
        </View>

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
      {/* ── Compact Search Bar ─────────────────────────────────────────────── */}
      <View style={[
        styles.searchContainer,
        { backgroundColor: isDarkMode ? config.darkColors.surface : '#fff' }
      ]}>
        {/* Input row */}
        <View style={styles.searchInputContainer}>
          <Icon name="search" size={15} color={isDarkMode ? '#94a3b8' : '#999'} style={{ marginLeft: 10, marginRight: 6 }} />
          <TextInput
            style={[styles.searchInput, { color: isDarkMode ? '#f1f5f9' : '#000' }]}
            placeholder={t("trade.search_placeholder") || "Search items…"}
            placeholderTextColor={isDarkMode ? '#64748b' : '#aaa'}
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
              style={{ paddingHorizontal: 6 }}
            >
              <Icon name="close-circle" size={16} color={isDarkMode ? '#64748b' : '#bbb'} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.searchButtonInline,
              {
                backgroundColor: searchQuery.trim() ? config.colors.primary : (isDarkMode ? '#334155' : '#e2e8f0'),
                opacity: searchQuery.trim() && !isSearching ? 1 : 0.65,
              }
            ]}
            onPress={() => {
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
              <Icon name="arrow-forward" size={14} color="#fff" />
            )}
          </TouchableOpacity>
        </View>

        {/* ME / YOU chips — only shown while typing */}
        {searchQuery.length > 0 && (
          <View style={styles.searchOptionsContainer}>
            <TouchableOpacity
              style={[styles.searchChip, searchInHas && styles.searchChipActive]}
              onPress={() => {
                triggerHapticFeedback('impactLight');
                if (!searchInHas && !searchInWants) setSearchInWants(true);
                setSearchInHas(!searchInHas);
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.searchChipText, searchInHas && styles.searchChipTextActive]}>ME side</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.searchChip, searchInWants && styles.searchChipActive]}
              onPress={() => {
                triggerHapticFeedback('impactLight');
                if (!searchInHas && !searchInWants) setSearchInHas(true);
                setSearchInWants(!searchInWants);
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.searchChipText, searchInWants && styles.searchChipTextActive]}>YOU side</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <FlatList
        ref={flatListRef}
        data={isSearchMode ? trades : filteredTrades}
        renderItem={config.isNoman ? renderTrade : renderTradeAlt}
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
        initialNumToRender={10} // ✅ FIX: Reduced to prevent text view overload on low-end devices
        maxToRenderPerBatch={8} // ✅ FIX: Smaller batches to reduce per-frame view creation pressure
        updateCellsBatchingPeriod={100} // ✅ FIX: Spread rendering across more frames
        windowSize={7} // ✅ FIX: Balanced window size
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
      <SubscriptionScreen visible={showofferwall} onClose={() => setShowofferwall(false)} track='Trade' oneWallOnly={single_offer_wall} />
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
      backgroundColor: isDarkMode ? config.colors.backgroundDark : config.colors.backgroundLight,
      flex: 1,
    },
    tradeItem: {
      padding: 10,
      paddingBottom: 10,
      marginBottom: 10,
      backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
      borderRadius: 10,
      borderWidth: 0,
    },
    tradeItemFeatured: {
      borderWidth: 1.5,
      borderColor: '#F59E0B',
      backgroundColor: isDarkMode ? '#1e293b' : '#fffbeb',
    },
    featuredTopRow: {
      marginBottom: 8,
    },
    featuredTopLabel: {
      alignSelf: 'flex-start',
      backgroundColor: '#F59E0B',
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    featuredTopLabelText: {
      color: '#fff',
      fontSize: 9,
      fontWeight: '800',
    },

    searchInput: {
      flex: 1,
      height: 36,
      backgroundColor: 'transparent',
      borderWidth: 0,
      paddingHorizontal: 4,
      fontSize: 13,
      color: isDarkMode ? '#f1f5f9' : '#1a1a1a',
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
      fontWeight: 'bold',
      fontSize: 10,
      color: isDarkMode ? 'white' : "black",
      flexDirection: 'row',
      alignItems: 'baseline'

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

      fontSize: 10,
      marginTop: 5,
      lineHeight: 12
    },
    descriptionclick: {
      color: config.colors.secondary,

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
      fontWeight: 'bold',
      fontSize: 8,
      textAlign: 'center',
      alignItems: 'center',
      justifyContent: 'center'
      // backgroundColor:'black'

    },
    names: {
      fontWeight: 'bold',
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
      fontWeight: 'bold',
      fontSize: 10
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      borderTopWidth: 1,
      backgroundColor: '#F5A327',
      // paddingHorizontal: 30,
      paddingTop: 5,
      marginTop: 10,
      borderTopColor: config.colors.hasBlockGreen
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
    boost: {
      justifyContent: 'flex-start', paddingVertical: 2, paddingHorizontal: 5, borderRadius: 3, alignItems: 'center', margin: 4
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
    // ── Trade card action bar ─────────────────────────────────────────────────
    tradeActionBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 8,
    },
    tradeBoostBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: '#7C3AED',
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    },
    tradeDeleteBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: '#EF4444',
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    },
    tradeBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    tradeChatBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      position: 'absolute',
      bottom: 8,
      right: 8,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: config.colors.primary,
      shadowColor: config.colors.primary,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 4,
    },
    tradeChatBtnLabel: {
      color: '#ffffff',
      fontWeight: '700',
      fontSize: 10,
    },
    // ── Trade action row ──
    socialActionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 8,
    },
    tradeActionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 8,
    },
    tradeSaveBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
      justifyContent: 'center',
      alignItems: 'center',
    },
    socialBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
      justifyContent: 'center',
      alignItems: 'center',
    },
    tradeAcceptBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: isDarkMode ? 'rgba(16,185,129,0.1)' : '#ECFDF5',
    },
    tradeAcceptBtnText: {
      fontSize: 10,
      fontWeight: '700',
      color: '#10B981',
    },
    tradeChatBtn2: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: config.colors.primary,
    },
    tradeChatBtnLabel: {
      color: '#ffffff',
      fontWeight: '700',
      fontSize: 10,
    },
    // ── (end) ─────────────────────────────────────────────────────────────────
    searchContainer: {
      paddingHorizontal: 4,
      paddingVertical: 4,
      marginTop: 4,
      marginBottom: 2,
    },
    searchInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
      borderRadius: 24,
      borderWidth: 1,
      borderColor: isDarkMode ? '#334155' : '#e2e8f0',
      height: 36,
      overflow: 'hidden',
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
      gap: 8,
      paddingTop: 6,
      paddingHorizontal: 6,
    },
    searchChip: {
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: isDarkMode ? '#334155' : '#e2e8f0',
      backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
    },
    searchChipActive: {
      backgroundColor: config.colors.primary,
      borderColor: config.colors.primary,
    },
    searchChipText: {
      fontSize: 11,
      fontWeight: '600',
      color: isDarkMode ? '#94a3b8' : '#666',
    },
    searchChipTextActive: {
      color: '#fff',
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
      fontWeight: 'bold',
    },
    // ── Alternate (non-Noman) styles ──
    altTradeCard: {
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 8,
      marginVertical: 5,
      backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
      borderRadius: 14,
      borderTopWidth: 4,
      borderTopColor: config.colors.primary,
    },
    altTradeCardFeatured: {
      borderWidth: 1.5,
      borderTopWidth: 4,
      borderColor: '#F59E0B',
      borderTopColor: '#F59E0B',
      backgroundColor: isDarkMode ? '#1e293b' : '#fffbeb',
    },
    altFeaturedRow: {
      marginBottom: 8,
    },
    altFeaturedBadge: {
      alignSelf: 'flex-start',
      backgroundColor: '#F59E0B',
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    altFeaturedText: {
      color: 'white',
      fontSize: 8,
      fontWeight: 'bold',
    },
    altTradeHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    altTradeUserRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    altTradeAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: '#eee',
    },
    altTradeName: {
      fontWeight: 'bold',
      fontSize: 13,
      color: isDarkMode ? 'white' : 'black',
    },
    altTradeTime: {
      fontSize: 9,
      color: isDarkMode ? '#aaa' : '#888',
      marginTop: 1,
    },
    altRatingPill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#ffb300',
      borderRadius: 10,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    altRatingText: {
      fontSize: 10,
      color: 'white',
      fontWeight: 'bold',
      marginLeft: 3,
    },
    altTotalsBar: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 8,
      gap: 8,
    },
    altTotalPill: {
      borderRadius: 12,
      paddingVertical: 3,
      paddingHorizontal: 12,
    },
    altTotalPillText: {
      color: 'white',
      fontSize: 10,
      fontWeight: 'bold',
    },
    altPercentText: {
      fontSize: 11,
      fontWeight: 'bold',
    },
    altItemsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingVertical: 6,
    },
    altItemsSection: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      width: '42%',
      gap: 4,
    },
    altItemBubble: {
      justifyContent: 'center',
      alignItems: 'center',
      position: 'relative',
    },
    altItemImg: {
      width: 34,
      height: 34,
      borderRadius: 8,
      marginVertical: 2,
    },
    altItemLabel: {
      fontWeight: 'bold',
      fontSize: 7,
      color: isDarkMode ? 'white' : 'black',
      textAlign: 'center',
    },
    altCountBadge: {
      position: 'absolute',
      top: 0,
      left: -2,
      backgroundColor: config.colors.secondary,
      borderRadius: 8,
      paddingHorizontal: 4,
      paddingVertical: 1,
    },
    altCountText: {
      color: 'white',
      fontWeight: 'bold',
      fontSize: 9,
    },
    altTransferIcon: {
      justifyContent: 'center',
      alignItems: 'center',
      paddingTop: 10,
    },
    altOfferBtn: {
      backgroundColor: config.colors.primary,
      borderRadius: 8,
      paddingVertical: 6,
      paddingHorizontal: 12,
    },
    altOfferBtnText: {
      color: 'white',
      fontWeight: 'bold',
      fontSize: 9,
    },
    altFooterRow: {
      flexDirection: 'row',
      marginTop: 8,
      gap: 8,
    },
    altBoostBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'purple',
      borderRadius: 14,
      paddingVertical: 4,
      paddingHorizontal: 10,
      gap: 4,
    },
    altDeleteBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#333',
      borderRadius: 14,
      paddingVertical: 4,
      paddingHorizontal: 10,
      gap: 4,
    },
    altBoostText: {
      color: 'white',
      fontWeight: 'bold',
      fontSize: 10,
    },
  });

export default TradeList;