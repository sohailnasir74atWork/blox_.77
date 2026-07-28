import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, FlatList, TextInput, Image, Keyboard, Pressable, Platform, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import ViewShot from 'react-native-view-shot';
import { useGlobalState } from '../GlobelStats';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import config from '../Helper/Environment';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../Helper/HepticFeedBack';
import { getDatabase, ref, get, update } from '@react-native-firebase/database';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalState } from '../LocalGlobelStats';
import SignInDrawer from '../Firebase/SigninDrawer';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../Translation/LanguageProvider';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import ShareTradeModal from '../Trades/SharetradeModel';
import TradeCompletion from '../Engagement/TradeCompletion';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import { addDoc, collection, serverTimestamp, doc, getDoc } from '@react-native-firebase/firestore';
import SubscriptionScreen from '../SettingScreen/OfferWall';

const HomeScreen = ({ selectedTheme }) => {
  const { theme, user, proGranted, proTagBought, firestoreDB, single_offer_wall, currentUserEmail, appdatabase, strikeInfo, isAdmin, reload, isUserBlocked } = useGlobalState();
  const tradesCollection = collection(firestoreDB, 'trades_new_upgrade');
  const MAX_ITEMS_PER_SIDE = 4;
  const initialItems = [null, null, null, null];
  const [hasItems, setHasItems] = useState(initialItems);
  const [fruitRecords, setFruitRecords] = useState([]);
  const [wantsItems, setWantsItems] = useState(initialItems);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedSection, setSelectedSection] = useState(null);
  const [pickerTab, setPickerTab] = useState('all'); // 'all' | 'mine' — item picker source
  const [searchText, setSearchText] = useState('');
  const [hasTotal, setHasTotal] = useState({ price: 0, value: 0 });
  const [wantsTotal, setWantsTotal] = useState({ price: 0, value: 0 });
  const [showTradeCompletion, setShowTradeCompletion] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const { localState } = useLocalState();
  const [modalVisible, setModalVisible] = useState(false);
  const [description, setDescription] = useState('');
  const [robloxUsername, setRobloxUsername] = useState('');
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
  const insets = useSafeAreaInsets();
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
    setRobloxUsername(user?.robloxUsername || '');
    setModalVisible(true);
  };

  const handleCreateTrade = async () => {
    if (isSubmitting) {
      return;
    }

    if (!robloxUsername.trim()) {
      showErrorMessage(
        t("home.alert.error"),
        t('trade.roblox_required', { defaultValue: 'Please enter your Roblox username to post a trade.' })
      );
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

      // Block banned users from creating trades (admins exempt). Defer expiry
      // to the server-time-validated `isUserBlocked` flag so a clock-rolled
      // device can't slip past — strikeInfo is used only for the message.
      if (isUserBlocked && !isAdmin) {
        const { bannedUntil } = strikeInfo || {};

        if (bannedUntil === 'permanent') {
          showErrorMessage(
            t("home.alert.error"),
            "You are permanently banned from creating trades."
          );
          setIsSubmitting(false);
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
            `You are banned from creating trades for ${timeLeftText} more minute(s).`
          );
          setIsSubmitting(false);
          return;
        }

        showErrorMessage(t("home.alert.error"), "You are currently banned from creating trades.");
        setIsSubmitting(false);
        return;
      }

      // ✅ MIGRATED: Fetch rating from Firestore user_ratings_summary instead of RTDB
      let userRating = null;
      let ratingCount = 0;

      if (user?.id && firestoreDB) {
        try {
          const summaryRef = doc(firestoreDB, 'user_ratings_summary', user.id);
          const summarySnap = await getDoc(summaryRef);

          if (summarySnap?.exists()) {
            const summaryData = summarySnap.data();
            userRating = summaryData?.averageRating || null;
            ratingCount = summaryData?.count || 0;
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
        robloxUsername: robloxUsername.trim(),
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
          showSuccessCallback();
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

        // Save Roblox username to user profile if new/changed
        if (robloxUsername.trim() && robloxUsername.trim() !== user?.robloxUsername) {
          try {
            update(ref(appdatabase, `users/${user.id}`), { robloxUsername: robloxUsername.trim() });
          } catch (e) {
            console.error('Error saving roblox username:', e);
          }
        }

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

            if (!localState?.isPro) {
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

  // ── Always keep slots in pairs, expand by 2 only when current capacity is full ──
  const withTrailingSlots = (items) => {
    const filledCount = items.filter(Boolean).length;
    // Start at 4. Expand capacity by 2 each time all current slots are filled.
    let capacity = 4;
    while (capacity < MAX_ITEMS_PER_SIDE && filledCount >= capacity) {
      capacity += 2;
    }
    const result = items.filter(Boolean);
    while (result.length < capacity) result.push(null);
    return result;
  };

  const selectItem = (item) => {
    triggerHapticFeedback('impactLight');
    const currentItems = selectedSection === 'has' ? [...hasItems] : [...wantsItems];
    const filledCount = currentItems.filter(Boolean).length;
    if (filledCount >= MAX_ITEMS_PER_SIDE) {
      showErrorMessage(t('home.alert.error'), `Maximum ${MAX_ITEMS_PER_SIDE} items allowed per side.`);
      closeDrawer();
      return;
    }
    const newItem = { ...item, usePermanent: false };
    const nextEmptyIndex = currentItems.indexOf(null);
    if (nextEmptyIndex !== -1) {
      currentItems[nextEmptyIndex] = newItem;
    } else {
      currentItems.push(newItem);
    }
    const finalItems = withTrailingSlots(currentItems);
    if (selectedSection === 'has') {
      setHasItems(finalItems);
      updateTotal(newItem, 'has', true, true);
    } else {
      setWantsItems(finalItems);
      updateTotal(newItem, 'wants', true, true);
    }
    closeDrawer();
  };

  const handleCellPress = (index, isHas) => {
    const items = isHas ? hasItems : wantsItems;
    const item = items[index];

    if (item) {
      // Remove item: compact, then restore 2 trailing empty slots
      triggerHapticFeedback('impactLight');
      const section = isHas ? 'has' : 'wants';
      const updatedItems = [...items];
      updatedItems[index] = null;
      const finalItems = withTrailingSlots(updatedItems);
      if (isHas) setHasItems(finalItems);
      else setWantsItems(finalItems);
      updateTotal(item, section, false, true);
    } else {
      // Tap on empty slot — open picker
      const filledCount = items.filter(Boolean).length;
      if (filledCount >= MAX_ITEMS_PER_SIDE) {
        showErrorMessage(t('home.alert.error'), `Maximum ${MAX_ITEMS_PER_SIDE} items allowed per side.`);
        return;
      }
      triggerHapticFeedback('impactLight');
      setSelectedSection(isHas ? 'has' : 'wants');
      setIsDrawerVisible(true);
    }
  };


  const filteredData = fruitRecords.filter((item) =>
    item.Name.toLowerCase().includes(searchText.toLowerCase())
  );

  // ── "My Items" picker tab ──
  // Re-price the user's saved inventory (localState.ownedFruits, shape
  // { name, type: 'f'|'p'|'gamepass', ... }) against the current calculator
  // catalog (fruitRecords), so values/prices match the rest of the calculator.
  const ownedPickerItems = useMemo(() => {
    const owned = Array.isArray(localState.ownedFruits) ? localState.ownedFruits : [];
    if (owned.length === 0 || fruitRecords.length === 0) return [];
    return owned
      .map((f) => {
        const wantPerm = f?.type === 'p';
        const name = (f?.name || '').toLowerCase();
        const match = fruitRecords.find(
          (r) =>
            (r.Name || '').toLowerCase() === name &&
            (wantPerm ? r.Type === 'p' : r.Type === 'n')
        );
        if (match) return match;
        // Fallback if the fruit isn't in the current catalog.
        if (!f?.name) return null;
        return {
          Name: f.name,
          Value: wantPerm ? (f.permValue ?? f.value ?? 0) : (f.value ?? 0),
          Type: wantPerm ? 'p' : 'n',
          Price: f.beli || 0,
        };
      })
      .filter((it) => it && it.Name);
  }, [localState.ownedFruits, fruitRecords]);

  const filteredOwnedData = ownedPickerItems.filter((item) =>
    item.Name.toLowerCase().includes(searchText.toLowerCase())
  );

  // Open the picker on the "My Items" tab when the user has an inventory,
  // otherwise fall back to "All".
  useEffect(() => {
    if (isDrawerVisible) {
      setPickerTab(ownedPickerItems.length > 0 ? 'mine' : 'all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDrawerVisible]);

  const profitLoss = wantsTotal.value - hasTotal.value;
  const isProfit = profitLoss >= 0;
  const neutral = profitLoss === 0;

  // Pre-selected rating for the Log Trade sheet. Note the journal schema uses
  // 'loss', while handleCreateTrade's own getTradeStatus says 'lose' — keep this
  // one on the journal's spelling or every logged loss lands unlabelled.
  const loggedTradeResult = neutral ? 'fair' : (profitLoss > 0 ? 'win' : 'loss');

  const profitPercentage = hasTotal.value > 0
    ? ((profitLoss / hasTotal.value) * 100).toFixed(0)
    : 0;

  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const lastFilledIndexHas = hasItems.reduce((lastIndex, item, index) => (item ? index : lastIndex), -1);
  const lastFilledIndexWant = wantsItems.reduce((lastIndex, item, index) => (item ? index : lastIndex), -1);

  // ── Shared item-picker renderers (used by both layout variants) ──
  const getDemandString = (item) => {
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
    return demandString;
  };

  const renderPickerCell = (item, variant) => {
    const demandString = getDemandString(item);
    const blockStyle = variant === 'alt' ? styles.altDrawerItem : styles.itemBlock;
    const bg = item.Type === 'p'
      ? '#e1a900'
      : (variant === 'alt'
          ? (isDarkMode ? '#152642' : '#e8f0fe')
          : (isDarkMode ? '#34495E' : '#CCCCFF'));
    const textColor = item.Type === 'p'
      ? 'black'
      : (variant === 'alt' ? (isDarkMode ? 'white' : '#1a1a2e') : (isDarkMode ? 'white' : 'black'));
    return (
      <TouchableOpacity style={[blockStyle, { backgroundColor: bg }]} onPress={() => selectItem(item)}>
        <>
          {demandString !== '0/10' && (
            <Text style={styles.demandBadgeText}>{demandString}</Text>
          )}
          <Image
            source={{ uri: item.Type !== 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.Name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(item.Name)}_Icon.webp` }}
            style={[styles.itemImageOverlay]}
          />
          <Text style={[styles.itemText, { color: textColor }]}>${Number(item.Value)?.toLocaleString()}</Text>
          <Text style={[styles.itemText, { color: textColor }]}>{item.Type === 'p' && 'Perm'} {item.Name}</Text>
        </>
      </TouchableOpacity>
    );
  };

  const renderPickerTabs = () => (
    <View style={styles.pickerTabRow}>
      <TouchableOpacity
        style={[styles.pickerTab, pickerTab === 'mine' && styles.pickerTabActive]}
        onPress={() => { triggerHapticFeedback('impactLight'); setPickerTab('mine'); }}
        activeOpacity={0.85}
      >
        <Text style={[styles.pickerTabText, pickerTab === 'mine' && styles.pickerTabTextActive]}>
          {t('home.picker_my_items', { defaultValue: 'My Items' })}{ownedPickerItems.length ? ` (${ownedPickerItems.length})` : ''}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.pickerTab, pickerTab === 'all' && styles.pickerTabActive]}
        onPress={() => { triggerHapticFeedback('impactLight'); setPickerTab('all'); }}
        activeOpacity={0.85}
      >
        <Text style={[styles.pickerTabText, pickerTab === 'all' && styles.pickerTabTextActive]}>
          {t('home.picker_all', { defaultValue: 'All' })}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderMyItemsEmpty = () => (
    <View style={styles.pickerEmpty}>
      <Text style={styles.pickerEmptyText}>
        {t('home.picker_empty', { defaultValue: 'No items in your inventory yet.\nAdd fruits from My Stuff to see them here.' })}
      </Text>
      <TouchableOpacity style={styles.pickerEmptyBtn} onPress={() => setPickerTab('all')} activeOpacity={0.85}>
        <Text style={styles.pickerEmptyBtnText}>{t('home.picker_browse_all', { defaultValue: 'Browse all items' })}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderPickerList = (variant) => (
    <>
      {renderPickerTabs()}
      <FlatList
        onScroll={() => Keyboard.dismiss()}
        onTouchStart={() => Keyboard.dismiss()}
        keyboardShouldPersistTaps="handled"
        data={pickerTab === 'mine' ? filteredOwnedData : filteredData}
        keyExtractor={(item, index) => `${item.Name}-${item.Type}-${index}`}
        renderItem={({ item }) => renderPickerCell(item, variant)}
        numColumns={3}
        contentContainerStyle={styles.flatListContainer}
        columnWrapperStyle={styles.columnWrapper}
        ListEmptyComponent={pickerTab === 'mine' ? renderMyItemsEmpty() : null}
        initialNumToRender={12}
        maxToRenderPerBatch={9}
        windowSize={5}
        updateCellsBatchingPeriod={100}
      />
    </>
  );

  // ── Alternate (non-Noman) layout ──
  if (!config.isNoman) {
    return (
      <>
        <GestureHandlerRootView>
          <View style={styles.container} key={language}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <ViewShot ref={viewRef} style={styles.screenshotView}>

                {/* Hero profit/loss card */}
                <View style={styles.altHeroCard}>
                  <View style={styles.altHeroTop}>
                    <View style={styles.altHeroIconWrap}>
                      <Icon
                        name={isProfit ? 'trending-up' : (neutral ? 'remove' : 'trending-down')}
                        size={28}
                        color={'white'}
                      />
                    </View>
                    <View style={{ flex: 1, marginLeft: 14 }}>
                      <Text style={styles.altHeroLabel}>
                        {isProfit ? t('home.profit') : (neutral ? 'Even' : t('home.loss'))}
                      </Text>
                      <Text style={styles.altHeroAmount}>
                        ${formatValue(Math.abs(profitLoss))}
                      </Text>
                    </View>
                    <View style={styles.altHeroPercentBadge}>
                      <Text style={styles.altHeroPercentText}>{profitPercentage}%</Text>
                    </View>
                  </View>
                  {/* Quick stats row inside hero */}
                  <View style={styles.altHeroStatsRow}>
                    <View style={styles.altHeroStat}>
                      <Text style={styles.altHeroStatLabel}>ME Value</Text>
                      <Text style={styles.altHeroStatVal}>{formatValue(hasTotal.value || 0)}</Text>
                    </View>
                    <View style={[styles.altHeroStatDivider]} />
                    <View style={styles.altHeroStat}>
                      <Text style={styles.altHeroStatLabel}>YOU Value</Text>
                      <Text style={styles.altHeroStatVal}>{formatValue(wantsTotal.value || 0)}</Text>
                    </View>
                    <View style={[styles.altHeroStatDivider]} />
                    <View style={styles.altHeroStat}>
                      <Text style={styles.altHeroStatLabel}>ME Price</Text>
                      <Text style={styles.altHeroStatVal}>${formatValue(hasTotal.price || 0)}</Text>
                    </View>
                    <View style={[styles.altHeroStatDivider]} />
                    <View style={styles.altHeroStat}>
                      <Text style={styles.altHeroStatLabel}>YOU Price</Text>
                      <Text style={styles.altHeroStatVal}>${formatValue(wantsTotal.price || 0)}</Text>
                    </View>
                  </View>
                </View>

                {/* ME Section */}
                <View style={styles.altSectionHeader}>
                  <View style={styles.altSectionDot} />
                  <Text style={styles.altSectionTitle}>ME</Text>
                  <View style={{ flex: 1 }} />
                  <View style={styles.altSectionBadge}>
                    <Text style={styles.altSectionBadgeText}>Demand: {aggregateDemand.buy || '0/10'}</Text>
                  </View>
                </View>
                <View style={styles.altItemGrid}>
                  {hasItems.map((item, index) => (
                    <TouchableOpacity
                      key={index}
                      style={[
                        styles.altItemCard,
                        item?.Type === 'p' && styles.altItemCardPerm,
                      ]}
                      onPress={() => handleCellPress(index, true)}
                    >
                      {item ? (
                        <>
                          {(() => {
                            const itemKey = item.Name.replace(/[^a-zA-Z0-9]/g, '_');
                            const demand = demandData[itemKey];
                            const demandString = demand?.demand || '0/10';
                            return demandString !== '0/10' ? (
                              <View style={styles.altDemandChip}>
                                <Text style={[styles.altDemandText, item.Type === 'p' && { color: '#3a2a00' }]}>{demandString}</Text>
                              </View>
                            ) : null;
                          })()}
                          <Image
                            source={{ uri: item.Type !== 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.Name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(item.Name)}_Icon.webp` }}
                            style={styles.altItemImage}
                          />
                          <View style={styles.altItemInfo}>
                            <Text style={[styles.altItemName, { color: item.Type === 'p' ? '#3a2a00' : (isDarkMode ? '#fff' : '#1a1a2e') }]} numberOfLines={1}>{item.Name}</Text>
                            <Text style={[styles.altItemValue, { color: item.Type === 'p' ? '#5a4a00' : config.colors.secondary }]}>
                              {(() => {
                                const value = item.usePermanent
                                  ? (Number(item.Permanent) === 0 ? 0 : Number(item.Permanent))
                                  : (Number(item.Value) === 0 ? 0 : Number(item.Value));
                                return value === 0 ? 'N/A' : formatValue(value);
                              })()}
                            </Text>
                          </View>
                        </>
                      ) : (
                        index === lastFilledIndexHas + 1 && (
                          <View style={styles.altAddBtn}>
                            <View style={styles.altAddCircle}>
                              <Icon name="add" size={20} color={config.colors.hasBlockGreen} />
                            </View>
                          </View>
                        )
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
                {/* Divider with circular reset */}
                <View style={styles.altDividerRow}>
                  <View style={styles.altDividerLine} />
                  <TouchableOpacity style={styles.altDividerIcon} onPress={resetState} activeOpacity={0.7}>
                    <Icon name="refresh" size={18} color="white" />
                  </TouchableOpacity>
                  <View style={styles.altDividerLine} />
                </View>

                {/* YOU Section */}
                <View style={styles.altSectionHeader}>
                  <View style={[styles.altSectionDot, { backgroundColor: config.colors.wantBlockRed }]} />
                  <Text style={[styles.altSectionTitle, { color: config.colors.wantBlockRed }]}>YOU</Text>
                  <View style={{ flex: 1 }} />
                  <View style={[styles.altSectionBadge, { backgroundColor: config.colors.wantBlockRed }]}>
                    <Text style={styles.altSectionBadgeText}>Demand: {aggregateDemand.sale || '0/10'}</Text>
                  </View>
                </View>
                <View style={styles.altItemGrid}>
                  {wantsItems.map((item, index) => (
                    <TouchableOpacity
                      key={index}
                      style={[
                        styles.altItemCard,
                        item?.Type === 'p' && styles.altItemCardPerm,
                      ]}
                      onPress={() => handleCellPress(index, false)}
                    >
                      {item ? (
                        <>
                          {(() => {
                            const itemKey = item.Name.replace(/[^a-zA-Z0-9]/g, '_');
                            const demand = demandData[itemKey];
                            const demandString = demand?.demand || '0/10';
                            return demandString !== '0/10' ? (
                              <View style={styles.altDemandChip}>
                                <Text style={[styles.altDemandText, item.Type === 'p' && { color: '#3a2a00' }]}>{demandString}</Text>
                              </View>
                            ) : null;
                          })()}
                          <Image
                            source={{ uri: item.Type !== 'p' ? `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(item.Name)}_Icon.webp` : `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatName(item.Name)}_Icon.webp` }}
                            style={styles.altItemImage}
                          />
                          <View style={styles.altItemInfo}>
                            <Text style={[styles.altItemName, { color: item.Type === 'p' ? '#3a2a00' : (isDarkMode ? '#fff' : '#1a1a2e') }]} numberOfLines={1}>{item.Name}</Text>
                            <Text style={[styles.altItemValue, { color: item.Type === 'p' ? '#5a4a00' : config.colors.secondary }]}>
                              {(() => {
                                const value = item.usePermanent
                                  ? (Number(item.Permanent) === 0 ? 0 : Number(item.Permanent))
                                  : (Number(item.Value) === 0 ? 0 : Number(item.Value));
                                return value === 0 ? 'N/A' : formatValue(value);
                              })()}
                            </Text>
                          </View>
                        </>
                      ) : (
                        index === lastFilledIndexWant + 1 && (
                          <View style={styles.altAddBtn}>
                            <View style={[styles.altAddCircle, { borderColor: config.colors.wantBlockRed }]}>
                              <Icon name="add" size={20} color={config.colors.wantBlockRed} />
                            </View>
                          </View>
                        )
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
                {/* ── Add More button: shows when all current slots have items ── */}
                {/* Removed the explicit "Add More Items" button */}

                <TouchableOpacity
                  style={styles.altUpdatedRow}
                  onPress={handleRefresh}
                  disabled={refreshing}
                  activeOpacity={0.7}
                >
                  {refreshing ? (
                    <ActivityIndicator size="small" color={config.colors.secondary} style={{ marginRight: 6 }} />
                  ) : (
                    <Icon name="time-outline" size={13} color={isDarkMode ? '#556' : '#99a'} style={{ marginRight: 6 }} />
                  )}
                  <Text style={[styles.altUpdatedText, { color: isDarkMode ? '#556' : '#99a' }]}>
                    {refreshing ? 'Updating...' : `Updated ${getLastUpdatedText()}`}
                  </Text>
                  {!refreshing && (
                    <Icon name="refresh-outline" size={13} color={config.colors.secondary} style={{ marginLeft: 6 }} />
                  )}
                </TouchableOpacity>
              </ViewShot>

              {/* Action buttons */}
              <View style={styles.altActionRow}>
                <TouchableOpacity style={styles.altCreateBtn} onPress={() => handleCreateTradePress('create')} activeOpacity={0.85}>
                  <Icon name="paper-plane-outline" size={16} color="white" />
                  <Text style={styles.altBtnText}>{t('home.create_trade')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.altShareBtn} onPress={() => handleCreateTradePress('share')} activeOpacity={0.85}>
                  <Icon name="share-social-outline" size={16} color="white" />
                  <Text style={styles.altBtnText}>{t('home.share_trade')}</Text>
                </TouchableOpacity>
              </View>

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
                  <View style={[styles.drawerContainer, { backgroundColor: isDarkMode ? '#0d1f3c' : 'white', paddingBottom: Math.max(insets.bottom, 16) }]}>
                    <View style={{
                      flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10,
                    }}>
                      <TextInput
                        style={styles.searchInput}
                        placeholder={t('home.search_placeholder')}
                        value={searchText}
                        onChangeText={setSearchText}
                        placeholderTextColor={isDarkMode ? '#8899aa' : '#888'}
                      />
                      <TouchableOpacity onPress={closeDrawer} style={styles.closeButton}>
                        <Text style={styles.closeButtonText}>{t('home.close')}</Text>
                      </TouchableOpacity>
                    </View>
                    {renderPickerList('alt')}
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
                  <View style={[styles.drawerContainer, { backgroundColor: isDarkMode ? '#0d1f3c' : 'white', paddingBottom: Math.max(insets.bottom, 16) }]}>
                    <Text style={styles.modalMessage}>
                      {t("home.trade_description")}
                    </Text>
                    <Text style={styles.modalMessagefooter}>
                      {t("home.trade_description_hint")}
                    </Text>
                    <TextInput
                      style={styles.input}
                      placeholder={t("home.write_description")}
                      placeholderTextColor={isDarkMode ? '#999' : '#888'}
                      maxLength={40}
                      value={description}
                      onChangeText={setDescription}
                    />
                    <TextInput
                      style={[styles.input, { marginTop: 8 }]}
                      placeholder={t('trade.roblox_username_placeholder', { defaultValue: 'Roblox Username (required)' })}
                      placeholderTextColor={isDarkMode ? '#999' : '#888'}
                      maxLength={30}
                      value={robloxUsername}
                      onChangeText={setRobloxUsername}
                      autoCapitalize="none"
                      autoCorrect={false}
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
        {(!localState.isPro && !proGranted) && <BannerAdComponent collapsible />}
      </>
    );
  }

  // ── Original (Noman) layout ──
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
              <TouchableOpacity style={styles.middleTradeButton} onPress={() => setShowTradeCompletion(true)}>
                <Icon name="book-outline" size={16} color="white" style={{ padding: 4 }} />
                <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>Log Trade</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.shareTradeButton} onPress={() => handleCreateTradePress('share')}>
                <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>{t('home.share_trade')}</Text>
                <Icon name="share-outline" size={18} color="white" style={{ padding: 4 }} />
              </TouchableOpacity>
            </View>
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
                <View style={[styles.drawerContainer, { backgroundColor: isDarkMode ? '#3B404C' : 'white', paddingBottom: Math.max(insets.bottom, 16) }]}>
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
                  {renderPickerList('default')}
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
                <View style={[styles.drawerContainer, { backgroundColor: isDarkMode ? '#3B404C' : 'white', paddingBottom: Math.max(insets.bottom, 16) }]}>
                  <Text style={styles.modalMessage}>
                    {t("home.trade_description")}
                  </Text>
                  <Text style={styles.modalMessagefooter}>
                    {t("home.trade_description_hint")}
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder={t("home.write_description")}
                    placeholderTextColor={isDarkMode ? '#999' : '#888'}
                    maxLength={40}
                    value={description}
                    onChangeText={setDescription}
                  />
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    placeholder={t('trade.roblox_username_placeholder', { defaultValue: 'Roblox Username (required)' })}
                    placeholderTextColor={isDarkMode ? '#999' : '#888'}
                    maxLength={30}
                    value={robloxUsername}
                    onChangeText={setRobloxUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
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
        <TradeCompletion
          visible={showTradeCompletion}
          onClose={() => setShowTradeCompletion(false)}
          db={appdatabase}
          uid={user?.id}
          isDarkMode={isDarkMode}
          hasItems={hasItems}
          wantsItems={wantsItems}
          tradeResult={loggedTradeResult}
          firestoreDB={firestoreDB}
        />
      </GestureHandlerRootView>
      {(!localState.isPro && !proGranted) && <BannerAdComponent collapsible />}
    </>
  );
};

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? config.colors.backgroundDark : config.colors.backgroundLight,
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
    // ── "My Items" / "All" picker tabs ──
    pickerTabRow: {
      flexDirection: 'row',
      backgroundColor: isDarkMode ? 'rgba(255,255,255,0.06)' : '#eef1f6',
      borderRadius: 10,
      padding: 3,
      marginBottom: 10,
    },
    pickerTab: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pickerTabActive: {
      backgroundColor: config.colors.primary,
    },
    pickerTabText: {
      fontSize: 13,
      fontWeight: '600',
      color: isDarkMode ? '#b8c2d0' : '#5b6472',
    },
    pickerTabTextActive: {
      color: 'white',
      fontWeight: '700',
    },
    pickerEmpty: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 32,
      paddingHorizontal: 20,
    },
    pickerEmptyText: {
      fontSize: 13,
      textAlign: 'center',
      color: isDarkMode ? '#b8c2d0' : '#5b6472',
      marginBottom: 14,
    },
    pickerEmptyBtn: {
      backgroundColor: config.colors.primary,
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 8,
    },
    pickerEmptyBtnText: {
      color: 'white',
      fontWeight: '700',
      fontSize: 13,
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
    // Three-up pill: Create | Log | Share. flex:1 rather than minWidth:120 so the
    // third button still fits on narrow phones.
    createtrade: {
      alignSelf: 'stretch',
      justifyContent: 'center',
      flexDirection: 'row',
      paddingHorizontal: 16,
      gap: 1,
    },
    createtradeButton: {
      backgroundColor: config.colors.hasBlockGreen,
      flex: 1,
      padding: 5,
      justifyContent: 'center',
      flexDirection: 'row',
      borderTopStartRadius: 20,
      borderBottomStartRadius: 20,
      alignItems: 'center'
    },
    middleTradeButton: {
      backgroundColor: '#10B981',
      flex: 1,
      padding: 5,
      justifyContent: 'center',
      flexDirection: 'row',
      alignItems: 'center'
    },
    shareTradeButton: {
      backgroundColor: config.colors.wantBlockRed,
      flex: 1,
      padding: 5,
      flexDirection: 'row',
      justifyContent: 'center',
      borderTopEndRadius: 20,
      borderBottomEndRadius: 20,
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
    // ── Alternate (non-Noman) styles ──
    altHeroCard: {
      backgroundColor: config.colors.primary,
      borderRadius: 20,
      padding: 18,
      marginBottom: 16,
      shadowColor: config.colors.primary,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
      elevation: 8,
    },
    altHeroTop: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 14,
    },
    altHeroIconWrap: {
      width: 48,
      height: 48,
      borderRadius: 14,
      backgroundColor: 'rgba(255,255,255,0.18)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    altHeroLabel: {
      color: 'rgba(255,255,255,0.7)',
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    altHeroAmount: {
      color: 'white',
      fontSize: 26,
      fontWeight: '800',
      marginTop: 2,
    },
    altHeroPercentBadge: {
      backgroundColor: 'rgba(255,255,255,0.2)',
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    altHeroPercentText: {
      color: 'white',
      fontWeight: 'bold',
      fontSize: 16,
    },
    altHeroStatsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 6,
    },
    altHeroStat: {
      flex: 1,
      alignItems: 'center',
    },
    altHeroStatLabel: {
      color: 'rgba(255,255,255,0.55)',
      fontSize: 9,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    altHeroStatVal: {
      color: 'white',
      fontSize: 12,
      fontWeight: 'bold',
      marginTop: 2,
    },
    altHeroStatDivider: {
      width: 1,
      height: 24,
      backgroundColor: 'rgba(255,255,255,0.15)',
    },
    altSectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 10,
      marginTop: 6,
    },
    altSectionDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: config.colors.hasBlockGreen,
      marginRight: 8,
    },
    altSectionTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: config.colors.hasBlockGreen,
      letterSpacing: 0.5,
    },
    altSectionBadge: {
      backgroundColor: config.colors.hasBlockGreen,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    altSectionBadgeText: {
      color: 'white',
      fontSize: 10,
      fontWeight: 'bold',
    },
    altItemGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginBottom: 4,
      // minHeight: 62,
    },
    altItemCard: {
      width: '48%',
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDarkMode ? '#152238' : '#ffffff',
      borderRadius: 14,
      padding: 10,
      marginBottom: 10,
      minHeight: 62,
      position: 'relative',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDarkMode ? 0.3 : 0.08,
      shadowRadius: 6,
      elevation: 3,
      borderWidth: 1,
      borderColor: isDarkMode ? '#1e3354' : '#eef2f6',
    },
    altItemCardPerm: {
      backgroundColor: '#FFF3CC',
      borderColor: '#e1a900',
    },
    altItemImage: {
      width: 40,
      height: 40,
      borderRadius: 10,
      marginRight: 10,
    },
    altItemInfo: {
      flex: 1,
    },
    altItemName: {
      fontSize: 12,
      fontWeight: '700',
    },
    altItemValue: {
      fontSize: 11,
      fontWeight: '600',
      marginTop: 3,
    },
    altDemandChip: {
      position: 'absolute',
      top: -4,
      right: -4,
      backgroundColor: config.colors.secondary,
      borderRadius: 8,
      paddingHorizontal: 6,
      paddingVertical: 2,
      zIndex: 10,
    },
    altDemandText: {
      color: 'white',
      fontSize: 8,
      fontWeight: 'bold',
    },
    altAddBtn: {
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      // paddingVertical: 8,
    },
    altAddCircle: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: config.colors.hasBlockGreen,
      borderStyle: 'dashed',
      justifyContent: 'center',
      alignItems: 'center',
      // marginBottom: 4,
    },
    altAddText: {
      fontSize: 10,
      fontWeight: '600',
    },
    // ── Add More Items button ──
    addMoreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 4,
      marginTop: 6,
      marginBottom: 2,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderStyle: 'dashed',
      backgroundColor: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      gap: 8,
    },
    addMoreCircle: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1.5,
      justifyContent: 'center',
      alignItems: 'center',
    },
    addMoreText: {
      flex: 1,
      fontSize: 12,
      fontWeight: '700',
    },
    addMoreCount: {
      fontSize: 10,
      fontWeight: '600',
      color: isDarkMode ? '#556' : '#aab',
    },

    altDividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: 10,
    },
    altDividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: isDarkMode ? '#1e3354' : '#e0e6ee',
    },
    altDividerIcon: {
      backgroundColor: config.colors.secondary,
      borderRadius: 20,
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'center',
      marginHorizontal: 14,
      shadowColor: config.colors.secondary,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 4,
    },
    altUpdatedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 10,
      marginBottom: 6,
    },
    altUpdatedText: {
      fontSize: 11,
      fontWeight: '500',
    },
    altActionRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 12,
      marginBottom: 8,
      gap: 10,
    },
    altCreateBtn: {
      // flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: config.colors.hasBlockGreen,
      padding: 14,
      borderRadius: 14,
      shadowColor: config.colors.hasBlockGreen,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 4,
    },
    altShareBtn: {
      // flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: config.colors.secondary,
      padding: 14,
      borderRadius: 14,
      shadowColor: config.colors.secondary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 4,
    },
    altBtnText: {
      color: 'white',
      fontSize: 13,
      fontWeight: 'bold',
      marginLeft: 8,
    },
    altDrawerItem: {
      width: '32%',
      height: 110,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 12,
      marginBottom: 10,
      position: 'relative',
    },
  });

export default HomeScreen;
