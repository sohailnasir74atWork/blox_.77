import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, FlatList, TextInput, Image, Keyboard, Pressable, Platform, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import ViewShot from 'react-native-view-shot';
import { useGlobalState } from '../GlobelStats';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import config from '../Helper/Environment';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../Helper/HepticFeedBack';
import { getDatabase, ref, get } from '@react-native-firebase/database';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalState } from '../LocalGlobelStats';
import SignInDrawer from '../Firebase/SigninDrawer';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../Translation/LanguageProvider';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import ShareTradeModal from '../Trades/SharetradeModel';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import { addDoc, collection, serverTimestamp, doc, getDoc } from '@react-native-firebase/firestore';
import SubscriptionScreen from '../SettingScreen/OfferWall';

const HomeScreen = ({ selectedTheme }) => {
  const { theme, user, proGranted, proTagBought, firestoreDB, single_offer_wall, currentUserEmail, appdatabase, strikeInfo, isAdmin, reload } = useGlobalState();
  const tradesCollection = collection(firestoreDB, 'trades_new');
  const initialItems = [null, null, null, null];
  const [hasItems, setHasItems] = useState(initialItems);
  const [fruitRecords, setFruitRecords] = useState([]);
  const [wantsItems, setWantsItems] = useState(initialItems);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedSection, setSelectedSection] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [hasTotal, setHasTotal] = useState({ price: 0, value: 0 });
  const [wantsTotal, setWantsTotal] = useState({ price: 0, value: 0 });
  const { triggerHapticFeedback } = useHaptic();
  const { localState } = useLocalState();
  const [modalVisible, setModalVisible] = useState(false);
  const [description, setDescription] = useState('');
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { language } = useLanguage();
  const [lastTradeTime, setLastTradeTime] = useState(null);
  const [openShareModel, setOpenShareModel] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [type, setType] = useState(null);
  const [showofferwall, setShowofferwall] = useState(false);
  const [demandData, setDemandData] = useState({}); // { itemKey: { buy: count, sale: count } }
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedTime, setLastUpdatedTime] = useState(new Date());
  const { t } = useTranslation();

  const isDarkMode = theme === 'dark';
  const viewRef = useRef();
  const timeoutRefs = useRef({});
  const rafRefs = useRef({});
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      Object.values(timeoutRefs.current).forEach(id => {
        if (id) clearTimeout(id);
      });
      timeoutRefs.current = {};
      Object.values(rafRefs.current).forEach(id => {
        if (id) cancelAnimationFrame(id);
      });
      rafRefs.current = {};
    };
  }, []);

  const handleLoginSuccess = () => {
    setIsSigninDrawerVisible(false);
  };

  // ✅ Format last updated time as relative string
  const getLastUpdatedText = useCallback(() => {
    const now = new Date();
    const diffMs = now - lastUpdatedTime;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'Just now';
    if (diffMins === 1) return '1 min ago';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours === 1) return '1 hour ago';
    if (diffHours < 24) return `${diffHours} hours ago`;
    return lastUpdatedTime.toLocaleDateString();
  }, [lastUpdatedTime]);

  // ✅ Hard refresh values - reloads data from CDN/Firebase
  const handleRefresh = useCallback(async () => {
    if (refreshing || !isMountedRef.current) return;

    triggerHapticFeedback('impactLight');
    setRefreshing(true);

    try {
      await reload(); // Re-fetch values data from CDN/Firebase
      // ✅ Check if component is still mounted before updating state
      if (!isMountedRef.current) return;
      // ✅ Update last refreshed time
      setLastUpdatedTime(new Date());
      // ✅ Show success message when values are reloaded
      showSuccessMessage('Success', 'Values have been reloaded');
    } catch (error) {
      console.error('Error refreshing values:', error);
      if (!isMountedRef.current) return;
      showErrorMessage('Error', 'Failed to reload values. Please try again.');
    } finally {
      if (isMountedRef.current) {
        setRefreshing(false);
      }
    }
  }, [reload, refreshing, triggerHapticFeedback]);

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
    setDescription("");
    setSelectedSection(null);
    setModalVisible(false);
  };

  const handleCreateTradePress = async (type) => {
    if (!user?.id && type === 'create') {
      setIsSigninDrawerVisible(true);
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
      setType('create');
    } else {
      setType('share');
    }
    setModalVisible(true);
  };

  const handleCreateTrade = async () => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      if (!user?.id || !currentUserEmail) {
        showErrorMessage(
          t("home.alert.error"),
          "Please sign in to create a trade."
        );
        setIsSubmitting(false);
        return;
      }

      // ✅ Admins are exempt from blocking
      if (strikeInfo && !isAdmin) {
        const { strikeCount, bannedUntil } = strikeInfo;
        const now = Date.now();

        if (bannedUntil === 'permanent') {
          showErrorMessage(
            t("home.alert.error"),
            "You are permanently banned from creating trades."
          );
          setIsSubmitting(false);
          return;
        }

        if (typeof bannedUntil === 'number' && now < bannedUntil) {
          const totalMinutes = Math.ceil((bannedUntil - now) / 60000);
          const hours = Math.floor(totalMinutes / 60);
          const minutes = totalMinutes % 60;
          const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

          showErrorMessage(
            t("home.alert.error"),
            `You are banned from creating trades for ${timeLeftText} more minute(s).`
          );
          setIsSubmitting(false);
          return;
        }
      }

      // ✅ Admins are exempt from blocking
      if (strikeInfo && !isAdmin) {
        const { strikeCount, bannedUntil } = strikeInfo;
        const now = Date.now();

        if (bannedUntil === 'permanent') {
          showErrorMessage(
            t("home.alert.error"),
            "You are permanently banned from creating trades."
          );
          setIsSubmitting(false);
          return;
        }

        if (typeof bannedUntil === 'number' && now < bannedUntil) {
          const totalMinutes = Math.ceil((bannedUntil - now) / 60000);
          const hours = Math.floor(totalMinutes / 60);
          const minutes = totalMinutes % 60;
          const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

          showErrorMessage(
            t("home.alert.error"),
            `You are banned from creating trades for ${timeLeftText} more minute(s).`
          );
          setIsSubmitting(false);
          return;
        }
      }

      // ✅ MIGRATED: Fetch rating from Firestore user_ratings_summary instead of RTDB
      let userRating = null;
      let ratingCount = 0;

      if (user?.id && firestoreDB) {
        try {
          const summaryRef = doc(firestoreDB, 'user_ratings_summary', user.id);
          const summarySnap = await getDoc(summaryRef);

          if (summarySnap.exists) {
            const summaryData = summarySnap.data();
            userRating = summaryData.averageRating || null;
            ratingCount = summaryData.count || 0;
          }
        } catch (error) {
          console.error('Error fetching rating from Firestore:', error);
          // Fallback to null/0 if Firestore fails
        }
      }
      const timestamp = serverTimestamp();
      const nowMs = Date.now();

      const hasRecentWin =
        typeof user?.lastGameWinAt === 'number' &&
        nowMs - user.lastGameWinAt <= 24 * 60 * 60 * 1000;

      const styleObj =
        (user?.purchases &&
          Object.values(user.purchases).find(p => p?.id === 9 && p.style)?.style) ?? {};

      const iconArr =
        (user?.purchases &&
          Object.values(user.purchases).find(p => p?.id === 10 && Array.isArray(p.icons))?.icons) ?? [];

      // ✅ Create indexed arrays for server-side search - OPTIMIZED: Store only full names + words (not prefixes)
      // Prefixes are generated on search side to reduce storage costs
      const createSearchTokens = (itemName) => {
        const name = itemName.toLowerCase().trim();
        const tokens = [name]; // Full name for exact match

        // Split into words and add each word as a token (for partial word matching)
        const words = name.split(/\s+/).filter(w => w.length > 0);
        tokens.push(...words);

        // ✅ OPTIMIZED: Don't store prefixes here - they're generated on search side
        // This reduces storage costs significantly (from ~10-20 tokens/item to ~2-3 tokens/item)

        return [...new Set(tokens)]; // Remove duplicates
      };

      const hasItemNames = hasItems
        .filter(item => item && item.Name)
        .flatMap(item => createSearchTokens(item.Name));

      const wantsItemNames = wantsItems
        .filter(item => item && item.Name)
        .flatMap(item => createSearchTokens(item.Name));

      // ✅ Calculate trade status and convert to single letter: 'w' (win), 'l' (lose), 'f' (fair)
      const getTradeStatus = (hasTotal, wantsTotal) => {
        if (hasTotal.value <= 0 && wantsTotal.value <= 0) return 'fair';
        if (hasTotal.value > wantsTotal.value) return 'lose';
        if (hasTotal.value < wantsTotal.value) return 'win';
        return 'fair';
      };
      const tradeStatus = getTradeStatus(hasTotal, wantsTotal);
      const statusLetter = tradeStatus === 'win' ? 'w' : tradeStatus === 'lose' ? 'l' : 'f';

      const newTrade = {
        userId: user?.id || "Anonymous",
        traderName: user?.displayName || "Anonymous",
        avatar: user?.avatar || null,
        isPro: localState?.isPro || false,
        isProGranted: proGranted || false,
        isFeatured: false,
        hasItems: hasItems.filter(item => item && item.Name).map(item => ({ name: item.Name, type: item.Type, value: item.Value })),
        wantsItems: wantsItems.filter(item => item && item.Name).map(item => ({ name: item.Name, type: item.Type, value: item.Value })),
        hasItemNames, // ✅ Indexed array for server-side search (lowercase)
        wantsItemNames, // ✅ Indexed array for server-side search (lowercase)
        hasTotal: { price: hasTotal?.price || 0, value: hasTotal?.value || 0 },
        wantsTotal: { price: wantsTotal?.price || 0, value: wantsTotal?.value || 0 },
        description: description || "",
        timestamp: timestamp,
        status: statusLetter, // ✅ Trade status: 'w' (win), 'l' (lose), 'f' (fair)
        rating: userRating ?? null,
        ratingCount: ratingCount || 0,
        style: styleObj || {},
        icons: iconArr || [],
        proTagBought: proTagBought || false,
        flage: user?.flage || null,
        robloxUsername: user?.robloxUsername || null,
        robloxUsernameVerified: user?.robloxUsernameVerified || false,
        hasRecentGameWin: hasRecentWin || false,
        lastGameWinAt: user?.lastGameWinAt || null,
      };

      if (type === 'share') {
        const showSuccessCallback = () => {
          showSuccessMessage(
            t("home.alert.success"),
            "Your trade has been share successfully!"
          );
        };
        setModalVisible(false);
        setTimeout(() => {
          setSelectedTrade(newTrade);
          setOpenShareModel(true);
          mixpanel.track("Start Sharing");
          if (!localState.isPro && !proGranted) {
            InterstitialAdManager.showAd(showSuccessCallback, showSuccessCallback);
          } else {
            showSuccessCallback();
          }
        }, 300);
      } else {
        const now = Date.now();
        const COOLDOWN_MS = 120000;
        if (lastTradeTime && (now - lastTradeTime) < COOLDOWN_MS) {
          const secondsLeft = Math.ceil((COOLDOWN_MS - (now - lastTradeTime)) / 1000);
          const minutesLeft = Math.floor(secondsLeft / 60);
          const remainingSeconds = secondsLeft % 60;
          const timeMessage = minutesLeft > 0
            ? `${minutesLeft} minute${minutesLeft === 1 ? '' : 's'} and ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`
            : `${secondsLeft} second${secondsLeft === 1 ? '' : 's'}`;
          showErrorMessage(
            t("home.alert.error"),
            `Please wait ${timeMessage} before creating a new trade.`
          );
          setIsSubmitting(false);
          return;
        }

        await addDoc(tradesCollection, newTrade);
        setModalVisible(false);
        resetTradeState();

        const callbackfunction = () => {
          if (!isMountedRef.current) return;
          showSuccessMessage(
            t("home.alert.success"),
            "Your trade has been posted successfully!"
          );
        };

        setLastTradeTime(now);
        mixpanel.track("Trade Created", { user: user?.id });

        const rafKey1 = `createTrade_raf_${Date.now()}_1`;
        const timeoutKey1 = `createTrade_timeout_${Date.now()}_1`;
        const rafKey2 = `createTrade_raf_${Date.now()}_2`;
        const timeoutKey2 = `createTrade_timeout_${Date.now()}_2`;

        rafRefs.current[rafKey1] = requestAnimationFrame(() => {
          if (!isMountedRef.current) return;

          timeoutRefs.current[timeoutKey1] = setTimeout(() => {
            if (!isMountedRef.current) return;

            if (!localState.isPro && !proGranted) {
              rafRefs.current[rafKey2] = requestAnimationFrame(() => {
                if (!isMountedRef.current) return;

                timeoutRefs.current[timeoutKey2] = setTimeout(() => {
                  if (!isMountedRef.current) return;

                  try {
                    InterstitialAdManager.showAd(callbackfunction);
                  } catch (err) {
                    console.warn('[AdManager] Failed to show ad:', err);
                    callbackfunction();
                  }
                  delete timeoutRefs.current[timeoutKey2];
                }, 400);
              });
            } else {
              callbackfunction();
            }
            delete timeoutRefs.current[timeoutKey1];
          }, 500);
        });
      }
    } catch (error) {
      console.error("Error creating trade:", error);
      showErrorMessage(
        t("home.alert.error"),
        "Something went wrong while posting the trade."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const adjustedData = (fruitRecords) => {
    const transformedData = [];

    fruitRecords.forEach((fruit) => {
      if (!fruit.name) return;

      const permValueInvalid = fruit.permValue === 0 || fruit.permValue === "0" || fruit.permValue === "N/A";
      const notperavailable = fruit.rarity == 'gamepass';

      if (fruit.permValue !== undefined && fruit.value !== undefined) {
        if (!notperavailable) {
          transformedData.push({
            Name: fruit.name,
            Value: permValueInvalid ? 0 : fruit.permValue,
            Type: 'p',
            Price: 0
          });
        }

        transformedData.push({
          Name: fruit.name,
          Value: fruit.value,
          Type: 'n',
          Price: fruit.beli || 0
        });
      } else if (fruit.permValue !== undefined) {
        transformedData.push({
          Name: fruit.name,
          Value: permValueInvalid ? 0 : fruit.permValue,
          Type: 'p',
          Price: 0
        });
      } else if (fruit.value !== undefined) {
        transformedData.push({
          Name: fruit.name,
          Value: fruit.value,
          Type: 'n',
          Price: fruit.beli || 0
        });
      } else {
        console.warn(`No valid values found for ${fruit.name}, skipping!`);
      }
    });

    return transformedData;
  };

  useEffect(() => {
    let isMounted = true;

    const parseAndSetData = () => {
      if (!localState.data) return;

      try {
        let parsedData = localState.data;

        if (typeof localState.data === 'string') {
          parsedData = JSON.parse(localState.data);
        }

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
        console.error("Error parsing data:", error);
        if (isMounted) {
          setFruitRecords([]);
        }
      }
    };

    parseAndSetData();

    return () => {
      isMounted = false;
    };
  }, [localState.data]);

  const openDrawer = (section) => {
    triggerHapticFeedback('impactLight');
    setSelectedSection(section);
    setIsDrawerVisible(true);
  };

  const closeDrawer = () => {
    setIsDrawerVisible(false);
  };

  const updateTotal = (item, section, add = true, isNew = false) => {
    const price = Number(item.Price) || 0;
    const value = Number(item.Value) || 0;
    const priceChange = add ? price : -price;
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
  };

  const formatValue = (value) => {
    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(1)}B`;
    } else if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    } else if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`;
    } else {
      return value.toLocaleString();
    }
  };

  // ✅ Get demand for items from localState.data (already in "10/10" format)
  const fetchDemandForItems = useCallback(() => {
    if (!localState.data) {
      setDemandData({});
      return;
    }

    const allItems = [...hasItems, ...wantsItems].filter(Boolean);
    if (allItems.length === 0) {
      setDemandData({});
      return;
    }

    // Parse localState.data if it's a string
    let parsedData = localState.data;
    if (typeof localState.data === 'string') {
      try {
        parsedData = JSON.parse(localState.data);
      } catch (error) {
        console.error('Error parsing localState.data:', error);
        setDemandData({});
        return;
      }
    }

    // Convert parsedData to array if it's an object
    const dataArray = Array.isArray(parsedData) ? parsedData : Object.values(parsedData || {});

    const demandMap = {};

    allItems.forEach((item) => {
      if (!item?.Name) return;

      // Find the original item from data by matching name
      const originalItem = dataArray.find(
        (dataItem) =>
          dataItem?.name &&
          dataItem.name.toLowerCase() === item.Name.toLowerCase()
      );

      if (originalItem) {
        // Get demand from original item
        // For normal items (Type === 'n'), use demand
        // For permanent items (Type === 'p'), use permDemand
        const demandString = item.Type === 'p'
          ? (originalItem.permDemand || '0/10')
          : (originalItem.demand || '0/10');

        const itemKey = item.Name.replace(/[^a-zA-Z0-9]/g, '_');
        demandMap[itemKey] = {
          demand: demandString, // Store as string like "10/10"
        };
      }
    });

    setDemandData(demandMap);
  }, [hasItems, wantsItems, localState.data]);

  // ✅ Fetch demand when items change or screen is focused
  useEffect(() => {
    fetchDemandForItems();
  }, [fetchDemandForItems]);

  useFocusEffect(
    useCallback(() => {
      fetchDemandForItems();
    }, [fetchDemandForItems])
  );

  // ✅ Calculate aggregate demand as average (not sum) - keeps it in "X/10" format
  const aggregateDemand = useMemo(() => {
    const allItems = [...hasItems, ...wantsItems].filter(Boolean);
    const hasDemands = [];
    const wantsDemands = [];

    allItems.forEach((item) => {
      if (!item?.Name) return;
      const itemKey = item.Name.replace(/[^a-zA-Z0-9]/g, '_');
      const demand = demandData[itemKey];
      if (demand?.demand) {
        // Parse "10/10" format
        const [numerator, denominator] = demand.demand.split('/').map(Number);
        if (numerator && denominator) {
          // Check if item is in hasItems or wantsItems
          const isHasItem = hasItems.some(hasItem => hasItem?.Name === item.Name);
          if (isHasItem) {
            hasDemands.push({ numerator, denominator });
          } else {
            wantsDemands.push({ numerator, denominator });
          }
        }
      }
    });

    // Calculate average demand (not sum) - keeps result in "X/10" format
    const calculateAggregate = (fractions) => {
      if (fractions.length === 0) return '0/10';

      // Calculate average numerator (sum of numerators / count)
      let sumNumerator = 0;
      fractions.forEach(({ numerator }) => {
        sumNumerator += numerator;
      });

      // Average numerator
      const avgNumerator = Math.round(sumNumerator / fractions.length);

      // Return in "X/10" format (assuming all denominators are 10)
      return `${avgNumerator}/10`;
    };

    return {
      buy: calculateAggregate(hasDemands),
      sale: calculateAggregate(wantsDemands),
    };
  }, [hasItems, wantsItems, demandData]);

  const selectItem = (item) => {
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

  const handleCellPress = (index, isHas) => {
    const items = isHas ? hasItems : wantsItems;
    const item = items[index];

    if (item) {
      triggerHapticFeedback('impactLight');
      const section = isHas ? 'has' : 'wants';
      const updatedItems = [...items];
      updatedItems[index] = null;
      const filteredItems = updatedItems.filter((item, i) => item !== null || i < 4);
      if (isHas) setHasItems(filteredItems);
      else setWantsItems(filteredItems);
      updateTotal(item, section, false, true);
    } else {
      triggerHapticFeedback('impactLight');
      setSelectedSection(isHas ? 'has' : 'wants');
      setIsDrawerVisible(true);
    }
  };

  const filteredData = fruitRecords.filter((item) =>
    item.Name.toLowerCase().includes(searchText.toLowerCase())
  );

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
                  <Text style={[styles.summaryText]}>ME</Text>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', height: 1, alignSelf: 'center' }} />
                  <Text style={styles.priceValue}>{t('home.value')}: {formatValue(hasTotal.value || 0)}</Text>
                  <Text style={styles.priceValue}>{t('home.price')}: ${formatValue(hasTotal.price || 0)}</Text>
                  {/* ✅ Aggregate Demand for Has Items */}
                  <Text style={styles.priceValue}>Demand: {aggregateDemand.buy || '0/10'}</Text>
                </View>
                <View style={[styles.summaryBox, styles.wantsBox]}>
                  <Text style={styles.summaryText}>YOU</Text>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', height: 1, alignSelf: 'center' }} />
                  <Text style={styles.priceValue}>{t('home.value')}: {formatValue(wantsTotal.value || 0)}</Text>
                  <Text style={styles.priceValue}>{t('home.price')}: ${formatValue(wantsTotal.price || 0)}</Text>
                  {/* ✅ Aggregate Demand for Wants Items */}
                  <Text style={styles.priceValue}>Demand: {aggregateDemand.sale || '0/10'}</Text>
                </View>
              </View>}
              <View style={styles.profitLossBox}>
                <Text style={[styles.profitLossText, { color: selectedTheme.colors.text }]}>
                  {isProfit ? t('home.profit') : t('home.loss')}:
                </Text>
                <Text style={[styles.profitLossValue, { color: isProfit ? config.colors.hasBlockGreen : config.colors.wantBlockRed }]}>
                  ${formatValue(Math.abs(profitLoss))} ({profitPercentage}%)
                </Text>
                {!neutral && <Icon
                  name={isProfit ? 'arrow-up-outline' : 'arrow-down-outline'}
                  size={20}
                  color={isProfit ? config.colors.hasBlockGreen : config.colors.wantBlockRed}
                  style={styles.icon}
                />}
                {/* ✅ Refresh Button */}

              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={styles.itemRow}>
                  {hasItems?.map((item, index) => {
                    const isLastColumn = (index + 1) % 2 === 0;
                    const isLastRow = index >= hasItems.length - 2;
                    return (
                      <TouchableOpacity
                        key={index}
                        style={[
                          styles.addItemBlockNew,
                          item?.Type === 'p' && { backgroundColor: '#e1a900' },
                          isLastColumn && { borderRightWidth: 0 },
                          isLastRow && { borderBottomWidth: 0 }
                        ]}
                        onPress={() => handleCellPress(index, true)}
                      >
                        {item ? (
                          <>
                            {/* ✅ Demand Badge - Top Left Corner */}
                            {(() => {
                              const itemKey = item.Name.replace(/[^a-zA-Z0-9]/g, '_');
                              const demand = demandData[itemKey];
                              const demandString = demand?.demand || '0/10';
                              // Only show if demand is not "0/10"
                              return demandString !== '0/10' ? (
                                <Text style={styles.demandBadgeText}>{demandString}</Text>
                              ) : null;
                            })()}
                            <Image
                              source={{ uri: item.Type !== 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.Name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(item.Name)}_Icon.webp` }}
                              style={[styles.itemImageOverlay]}
                            />
                            <Text style={[styles.itemText, styles.fruitValueText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'white' : 'black') }]}>
                              {(() => {
                                const value = item.usePermanent
                                  ? (Number(item.Permanent) === 0 ? 0 : Number(item.Permanent))
                                  : (Number(item.Value) === 0 ? 0 : Number(item.Value));
                                return value === 0 ? 'N/A' : formatValue(value);
                              })()}
                            </Text>
                            <Text style={[styles.itemText, styles.fruitNameText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'white' : 'black') }]}>
                              {item.Name}
                            </Text>
                          </>
                        ) : (
                          index === lastFilledIndexHas + 1 && (
                            <Icon
                              name="add-circle"
                              size={30}
                              color={isDarkMode ? "#fdf7e5" : '#fdf7e5'}
                            />
                          )
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.itemRow}>
                  {wantsItems?.map((item, index) => {
                    const isLastColumn = (index + 1) % 2 === 0;
                    const isLastRow = index >= wantsItems.length - 2;
                    return (
                      <TouchableOpacity
                        key={index}
                        style={[
                          styles.addItemBlockNew,
                          item?.Type === 'p' && { backgroundColor: '#e1a900' },
                          isLastColumn && { borderRightWidth: 0 },
                          isLastRow && { borderBottomWidth: 0 }
                        ]}
                        onPress={() => handleCellPress(index, false)}
                      >
                        {item ? (
                          <>
                            {/* ✅ Demand Badge - Top Left Corner */}
                            {(() => {
                              const itemKey = item.Name.replace(/[^a-zA-Z0-9]/g, '_');
                              const demand = demandData[itemKey];
                              const demandString = demand?.demand || '0/10';
                              // Only show if demand is not "0/10"
                              return demandString !== '0/10' ? (
                                <Text style={styles.demandBadgeText}>{demandString}</Text>
                              ) : null;
                            })()}
                            <Image
                              source={{ uri: item.Type !== 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.Name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(item.Name)}_Icon.webp` }}
                              style={[styles.itemImageOverlay]}
                            />
                            <Text style={[styles.itemText, styles.fruitValueText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'white' : 'black') }]}>
                              {(() => {
                                const value = item.usePermanent
                                  ? (Number(item.Permanent) === 0 ? 0 : Number(item.Permanent))
                                  : (Number(item.Value) === 0 ? 0 : Number(item.Value));
                                return value === 0 ? 'N/A' : formatValue(value);
                              })()}
                            </Text>
                            <Text style={[styles.itemText, styles.fruitNameText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'white' : 'black') }]}>
                              {item.Name}
                            </Text>
                          </>
                        ) : (
                          index === lastFilledIndexWant + 1 && (
                            <Icon
                              name="add-circle"
                              size={30}
                              color={isDarkMode ? "#fdf7e5" : '#fdf7e5'}
                            />
                          )
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Last Updated Section */}
              <TouchableOpacity
                style={styles.lastUpdatedContainer}
                onPress={handleRefresh}
                disabled={refreshing}
                activeOpacity={0.7}
              >
                <View style={styles.lastUpdatedContent}>
                  {refreshing ? (
                    <ActivityIndicator size="small" color={config.colors.primary} style={{ marginRight: 6 }} />
                  ) : (
                    <Icon name="time-outline" size={14} color={isDarkMode ? '#aaa' : '#888'} style={{ marginRight: 6 }} />
                  )}
                  <Text style={[styles.lastUpdatedText, { color: isDarkMode ? '#aaa' : '#666' }]}>
                    {refreshing ? 'Updating...' : `Updated ${getLastUpdatedText()}`}
                  </Text>
                  {!refreshing && (
                    <Icon name="refresh-outline" size={14} color={config.colors.primary} style={{ marginLeft: 6 }} />
                  )}
                </View>
              </TouchableOpacity>



              <View style={styles.divider}>
                <Image
                  source={require('../../assets/reset.png')}
                  style={{ width: 18, height: 18, tintColor: 'white' }}
                  onTouchEnd={resetState}
                />
              </View>
              {!config.isNoman && <View style={styles.summaryContainer}>
                <View style={[styles.summaryBox, styles.hasBox]}>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', alignSelf: 'center' }} />
                  <View style={{ justifyContent: 'space-between', flexDirection: 'row' }}>
                    <Text style={styles.priceValue}>{t('home.value')}:</Text>
                    <Text style={styles.priceValue}>{formatValue(hasTotal.value || 0)}</Text>
                  </View>
                  <View style={{ justifyContent: 'space-between', flexDirection: 'row' }}>
                    <Text style={styles.priceValue}>{t('home.price')}:</Text>
                    <Text style={styles.priceValue}>${formatValue(hasTotal.price || 0)}</Text>
                  </View>
                  {/* ✅ Aggregate Demand for Has Items */}
                  <View style={{ justifyContent: 'space-between', flexDirection: 'row', marginTop: 5 }}>
                    <Text style={styles.priceValue}>Demand:</Text>
                    <Text style={styles.priceValue}>{aggregateDemand.buy || '0/10'}</Text>
                  </View>
                </View>
                <View style={[styles.summaryBox, styles.wantsBox]}>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', alignSelf: 'center' }} />
                  <View style={{ justifyContent: 'space-between', flexDirection: 'row' }}>
                    <Text style={styles.priceValue}>{t('home.value')}:</Text>
                    <Text style={styles.priceValue}>{formatValue(wantsTotal.value || 0)}</Text>
                  </View>
                  <View style={{ justifyContent: 'space-between', flexDirection: 'row' }}>
                    <Text style={styles.priceValue}>{t('home.price')}:</Text>
                    <Text style={styles.priceValue}>${formatValue(wantsTotal.price || 0)}</Text>
                  </View>
                  {/* ✅ Aggregate Demand for Wants Items */}
                  <View style={{ justifyContent: 'space-between', flexDirection: 'row', marginTop: 5 }}>
                    <Text style={styles.priceValue}>Demand:</Text>
                    <Text style={styles.priceValue}>{aggregateDemand.sale || '0/10'}</Text>
                  </View>
                </View>
              </View>}
            </ViewShot>
            <View style={styles.createtrade}>
              <TouchableOpacity style={styles.createtradeButton} onPress={() => handleCreateTradePress('create')}>
                <Icon name="enter-outline" size={18} color="white" style={{ padding: 4 }} />
                <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>{t('home.create_trade')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.shareTradeButton} onPress={() => handleCreateTradePress('share')}>
                <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>{t('home.share_trade')}</Text>
                <Icon name="share-outline" size={18} color="white" style={{ padding: 4 }} />
              </TouchableOpacity>
            </View>
            {!localState.isPro && <View style={styles.createtradeAds}>
              <TouchableOpacity
                style={styles.removeAdsButton}
                activeOpacity={0.9}
                onPress={() => { setShowofferwall(true); }}
              >
                <View style={styles.removeAdsContent}>
                  <View style={styles.crownWrapper}>
                    <Image
                      source={require('../../assets/pro.png')}
                      style={{ width: 20, height: 20 }}
                      resizeMode="contain"
                    />
                  </View>
                  <View style={styles.removeAdsTextWrapper}>
                    <Text style={styles.removeAdsTitle}>Remove Ads</Text>
                  </View>
                </View>
              </TouchableOpacity>
            </View>}
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
                  }}>
                    <TextInput
                      style={styles.searchInput}
                      placeholder={t('home.search_placeholder')}
                      value={searchText}
                      onChangeText={setSearchText}
                      placeholderTextColor={isDarkMode ? 'white' : 'black'}
                    />
                    <TouchableOpacity onPress={closeDrawer} style={styles.closeButton}>
                      <Text style={styles.closeButtonText}>{t('home.close')}</Text>
                    </TouchableOpacity>
                  </View>
                  <FlatList
                    onScroll={() => Keyboard.dismiss()}
                    onTouchStart={() => Keyboard.dismiss()}
                    keyboardShouldPersistTaps="handled"
                    data={filteredData}
                    keyExtractor={(item) => item.Name}
                    renderItem={({ item }) => {
                      // ✅ Get demand for this item from localState.data
                      let demandString = '0/10';
                      if (localState.data) {
                        try {
                          let parsedData = localState.data;
                          if (typeof localState.data === 'string') {
                            parsedData = JSON.parse(localState.data);
                          }
                          const dataArray = Array.isArray(parsedData) ? parsedData : Object.values(parsedData || {});
                          const originalItem = dataArray.find(
                            (dataItem) =>
                              dataItem?.name &&
                              dataItem.name.toLowerCase() === item.Name.toLowerCase()
                          );
                          if (originalItem) {
                            demandString = item.Type === 'p'
                              ? (originalItem.permDemand || '0/10')
                              : (originalItem.demand || '0/10');
                          }
                        } catch (error) {
                          // Silently fail, use default
                        }
                      }

                      return (
                        <TouchableOpacity style={[styles.itemBlock, { backgroundColor: item.Type === 'p' ? '#e1a900' : isDarkMode ? '#34495E' : '#CCCCFF' }]} onPress={() => selectItem(item)}>
                          <>
                            {/* ✅ Demand Badge - Top Left Corner (same as grid) */}
                            {demandString !== '0/10' && (
                              <Text style={styles.demandBadgeText}>{demandString}</Text>
                            )}
                            <Image
                              source={{ uri: item.Type !== 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.Name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(item.Name)}_Icon.webp` }}
                              style={[styles.itemImageOverlay]}
                            />
                            <Text style={[[styles.itemText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'white' : 'black') }
                            ]]}>${Number(item.Value)?.toLocaleString()}</Text>
                            <Text style={[[styles.itemText, { color: item.Type === 'p' ? 'black' : (isDarkMode ? 'white' : 'black') }
                            ]]}>{item.Type === 'p' && 'Perm'} {item.Name}</Text>
                          </>
                        </TouchableOpacity>
                      );
                    }}
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
            onRequestClose={() => setModalVisible(false)}
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
        <SubscriptionScreen visible={showofferwall} onClose={() => setShowofferwall(false)} track='Remove Ads' oneWallOnly={single_offer_wall} />
      </GestureHandlerRootView>
      {(!localState.isPro && !proGranted) && <BannerAdComponent />}
    </>
  );
};

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
      width: '48%',
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
      fontWeight: 'bold',
    },
    priceValue: {
      color: 'white',
      textAlign: 'center',
      marginTop: 5,
      fontWeight: 'bold',
    },
    itemRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      width: '49%',
      alignItems: 'center',
      marginBottom: 5,
      borderWidth: 1,
      borderColor: isDarkMode ? '#6b7f8f' : '#1a237e',
      borderRadius: 4,
      overflow: 'hidden',
    },
    addItemBlockNew: {
      width: '50%',
      height: 80,
      backgroundColor: isDarkMode ? '#34495E' : '#CCCCFF',
      justifyContent: 'center',
      alignItems: 'center',
      position: 'relative',
      borderRightWidth: 1,
      borderBottomWidth: 1,
      borderColor: isDarkMode ? '#6b7f8f' : '#1a237e',
    },
    itemBlock: {
      width: '32%',
      height: 110,
      backgroundColor: isDarkMode ? '#34495E' : '#CCCCFF',
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
      fontWeight: 'bold',
      fontSize: 12
    },
    fruitNameText: {
      fontSize: 8,
    },
    fruitValueText: {
      fontSize: 8,
    },
    divider: {
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: config.colors.primary,
      margin: 'auto',
      borderRadius: 12,
      padding: 5,
    },
    lastUpdatedContainer: {
      alignSelf: 'center',
      paddingVertical: 8,
      paddingHorizontal: 16,
      marginVertical: 4,
    },
    lastUpdatedContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    lastUpdatedText: {
      fontSize: 12,

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
    profitLossBox: { flexDirection: 'row', justifyContent: 'center', marginVertical: 0, alignItems: 'center', paddingBottom: 10 },
    profitLossText: { fontSize: 14, fontWeight: 'bold' },
    profitLossValue: { fontSize: 14, marginLeft: 5, fontWeight: 'bold' },
    modalOverlay: {
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      flex: 1,
    },
    searchInput: {
      width: '75%',
      borderColor: '#333',
      borderWidth: 1,
      borderRadius: 5,
      height: 48,
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
    screenshotView: {
      padding: 10,
      flex: 1,
    },
    createtrade: {
      alignSelf: 'center',
      justifyContent: 'center',
      flexDirection: 'row'
    },
    createtradeButton: {
      backgroundColor: config.colors.hasBlockGreen,
      alignSelf: 'center',
      padding: 5,
      justifyContent: 'center',
      flexDirection: 'row',
      minWidth: 120,
      borderTopStartRadius: 20,
      borderBottomStartRadius: 20,
      marginRight: 1,
      alignItems: 'center'
    },
    shareTradeButton: {
      backgroundColor: config.colors.wantBlockRed,
      alignSelf: 'center',
      padding: 5,
      flexDirection: 'row',
      justifyContent: 'center',
      minWidth: 120,
      borderTopEndRadius: 20,
      borderBottomEndRadius: 20,
      marginLeft: 1,
      alignItems: 'center'
    },
    modalMessage: {
      fontSize: 12,
      marginBottom: 4,
      color: isDarkMode ? 'white' : 'black',

    },
    modalMessagefooter: {
      fontSize: 10,
      marginBottom: 10,
      color: isDarkMode ? 'grey' : 'grey',

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
      fontWeight: 'bold'
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
    createtradeAds: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    removeAdsButton: {
      borderRadius: 999,
      paddingVertical: 5,
      paddingHorizontal: 10,
      backgroundColor: '#fbbf24',
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
      marginTop: 20
    },
    removeAdsContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    crownWrapper: {
      width: 25,
      height: 25,
      borderRadius: 12,
      backgroundColor: '#fde68a',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 8,
    },
    removeAdsTextWrapper: {
      flexDirection: 'column',
    },
    removeAdsTitle: {
      color: '#1f2933',
      fontSize: 12,
      fontWeight: 'bold',
    },
    demandBadgeText: {
      position: 'absolute',
      top: 2,
      left: 2,
      paddingTop: 2,
      paddingLeft: 2,
      color: isDarkMode ? 'white' : 'black',
      fontSize: 8, // Match fruit name font size
      fontWeight: 'bold',
      zIndex: 10,
    },
    refreshButtonContainer: {
      // position: 'absolute',
      // left: 0,
      // bottom: 0,
    },
    refreshButton: {
      // width: 30,
      // height: 30,
      // borderRadius: 15,
      // alignItems: 'center',
      // justifyContent: 'center',
    },
  });

export default HomeScreen;
