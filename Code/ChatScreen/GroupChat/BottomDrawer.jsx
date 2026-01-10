import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Image,
  ActivityIndicator,
  ScrollView,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';
import Icon from 'react-native-vector-icons/Ionicons';
import { getStyles } from '../../SettingScreen/settingstyle';
import { useLocalState } from '../../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import { mixpanel } from '../../AppHelper/MixPenel';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
} from '@react-native-firebase/firestore';
import { ref, get } from '@react-native-firebase/database';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

// Initialize dayjs plugins
dayjs.extend(relativeTime);

const REVIEWS_PAGE_SIZE = 3; // how many reviews per page

// ✅ Helper function to format fruit names for image URLs
const formatName = (name) => {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/^\+/, '').replace(/\s+/g, '-');
};

// Helper function to format trade item names
const formatTradeName = (name) => {
  if (!name || typeof name !== 'string') return '';
  let formattedName = name.replace(/^\+/, '');
  formattedName = formattedName.replace(/\s+/g, '-');
  return formattedName;
};

// Helper function to format values
const formatTradeValue = (value) => {
  if (!value || typeof value !== 'number') return '0';
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

// Helper function to group items
const groupTradeItems = (items) => {
  if (!Array.isArray(items)) return [];
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

// Helper function to get trade deal
const getTradeDeal = (hasTotal, wantsTotal) => {
  if (!hasTotal || !hasTotal.value || hasTotal.value <= 0) {
    return { deal: { label: "trade.unknown_deal", color: "#8E8E93" }, tradeRatio: 0 };
  }

  const tradeRatio = wantsTotal?.value ? wantsTotal.value / hasTotal.value : 0;
  let deal;

  if (tradeRatio >= 0.05 && tradeRatio <= 0.6) {
    deal = { label: "trade.best_deal", color: "#34C759" };
  } else if (tradeRatio > 0.6 && tradeRatio <= 0.75) {
    deal = { label: "trade.great_deal", color: "#32D74B" };
  } else if (tradeRatio > 0.75 && tradeRatio <= 1.25) {
    deal = { label: "trade.fair_deal", color: "#FFCC00" };
  } else if (tradeRatio > 1.25 && tradeRatio <= 1.4) {
    deal = { label: "trade.decent_deal", color: "#FF9F0A" };
  } else if (tradeRatio > 1.4 && tradeRatio <= 1.55) {
    deal = { label: "trade.weak_deal", color: "#D65A31" };
  } else {
    deal = { label: "trade.risky_deal", color: "#7D1128" };
  }

  return { deal, tradeRatio };
};

const ProfileBottomDrawer = ({
  isVisible,
  toggleModal,
  startChat,
  selectedUser,
  isOnline,
  bannedUsers,
  fromPvtChat,
}) => {
  const { theme, firestoreDB, appdatabase } = useGlobalState();
  const { updateLocalState } = useLocalState();
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();

  const isDarkMode = theme === 'dark';
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const selectedUserId = selectedUser?.senderId || selectedUser?.id || null;
  const userName = selectedUser?.sender || null;
  const avatar = selectedUser?.avatar || null;

  // 🔒 ban state - ✅ Safety check for array
  const isBlock = Array.isArray(bannedUsers) && bannedUsers.includes(selectedUserId);

  // ⭐ rating summary (from Firestore user_ratings_summary - MIGRATED)
  const [ratingSummary, setRatingSummary] = useState(null);
  const [loadingRating, setLoadingRating] = useState(false);
  const [userBio, setUserBio] = useState(null);

  // joined text
  const [createdAtText, setCreatedAtText] = useState(null);

  // 💰 user points and game wins
  const [userPoints, setUserPoints] = useState(null);
  const [gameWins, setGameWins] = useState(null);

  // 📝 reviews list (from Firestore /reviews where toUserId == selectedUserId)
  const [reviews, setReviews] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [lastReviewDoc, setLastReviewDoc] = useState(null);
  const [hasMoreReviews, setHasMoreReviews] = useState(false);

  // 🐾 pets (owned + wishlist) from Firestore doc /reviews/{userId}
  const [ownedPets, setOwnedPets] = useState([]);
  const [wishlistPets, setWishlistPets] = useState([]);
  const [loadingPets, setLoadingPets] = useState(false);

  // 💼 trades list (from Firestore /trades_new where userId == selectedUserId)
  const [trades, setTrades] = useState([]);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [lastTradeDoc, setLastTradeDoc] = useState(null);
  const [hasMoreTrades, setHasMoreTrades] = useState(false);

  // toggle details
  const [loadDetails, setLoadDetails] = useState(false);

  // ✅ State for fetched user data (roblox username, verified status, etc.)
  const [userData, setUserData] = useState(null);



  // ✅ OPTIMIZED: Fetch user data from Firebase only for missing fields
  // This minimizes Firebase reads and reduces costs
  useEffect(() => {
    if (!selectedUserId || !appdatabase) return;

    let isMounted = true;

    const fetchUserData = async () => {
      try {
        // ✅ OPTIMIZED: Only fetch fields that are NOT already in selectedUser
        // This reduces Firebase reads from 6 potential reads to only what's missing
        const fieldsToFetch = [];
        
        // Check each field and only add to fetch list if missing
        if (!selectedUser?.robloxUsername) {
          fieldsToFetch.push({ key: 'robloxUsername', path: `users/${selectedUserId}/robloxUsername` });
        }
        if (!selectedUser?.robloxUserId) {
          fieldsToFetch.push({ key: 'robloxUserId', path: `users/${selectedUserId}/robloxUserId` });
        }
        if (selectedUser?.robloxUsernameVerified === undefined) {
          fieldsToFetch.push({ key: 'robloxUsernameVerified', path: `users/${selectedUserId}/robloxUsernameVerified` });
        }
        if (selectedUser?.isPro === undefined) {
          fieldsToFetch.push({ key: 'isPro', path: `users/${selectedUserId}/isPro` });
        }
        if (!selectedUser?.lastGameWinAt) {
          fieldsToFetch.push({ key: 'lastGameWinAt', path: `users/${selectedUserId}/lastGameWinAt` });
        }
        if (!selectedUser?.flage) {
          fieldsToFetch.push({ key: 'flage', path: `users/${selectedUserId}/flage` }); // ✅ Only fetch if missing
        }
        
        // ✅ If all fields are already available, skip Firebase read entirely (0 reads = $0 cost)
        if (fieldsToFetch.length === 0) {
          setUserData(null);
          return;
        }

        // ✅ Fetch only missing fields in parallel (minimal reads, maximum efficiency)
        const snapshots = await Promise.all(
          fieldsToFetch.map(({ path }) => get(ref(appdatabase, path)).catch(() => null))
        );
        
        if (!isMounted) return;
        
        // ✅ Extract values and build result object
        const fetchedData = {};
        fieldsToFetch.forEach(({ key }, index) => {
          const snap = snapshots[index];
          if (snap?.exists()) {
            fetchedData[key] = snap.val();
          } else if (key === 'robloxUsernameVerified') {
            fetchedData[key] = false; // Default for boolean
          } else {
            fetchedData[key] = null;
          }
        });

        setUserData(fetchedData);
      } catch (error) {
        console.error('Error fetching user data in BottomDrawer:', error);
        if (isMounted) setUserData(null);
      }
    };

    fetchUserData();

    return () => {
      isMounted = false;
    };
  }, [selectedUserId, selectedUser?.robloxUsername, selectedUser?.robloxUserId, selectedUser?.flage, selectedUser?.isPro, selectedUser?.lastGameWinAt, appdatabase]);

  // ✅ Merge selectedUser with fetched userData
  const mergedUser = useMemo(() => {
    if (!userData) return selectedUser;
    return {
      ...selectedUser,
      robloxUsername: selectedUser?.robloxUsername || userData.robloxUsername,
      robloxUserId: selectedUser?.robloxUserId || userData.robloxUserId,
      robloxUsernameVerified: selectedUser?.robloxUsernameVerified !== undefined 
        ? selectedUser.robloxUsernameVerified 
        : userData.robloxUsernameVerified,
      isPro: selectedUser?.isPro !== undefined ? selectedUser.isPro : userData.isPro,
      lastGameWinAt: selectedUser?.lastGameWinAt !== undefined 
        ? selectedUser.lastGameWinAt 
        : userData.lastGameWinAt, // ✅ Game win timestamp
      flage: selectedUser?.flage !== undefined 
        ? selectedUser.flage 
        : userData.flage, // ✅ Flag/flag emoji
    };
  }, [selectedUser, userData]);

  // ─────────────────────────────────────────────
  // Clipboard
  const copyToClipboard = (code) => {
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code);
    showSuccessMessage(t('value.copy'), 'Copied to Clipboard');
    mixpanel.track('Code UserName', { UserName: code });
  };

  // ─────────────────────────────────────────────
  // Open Roblox Profile
  const handleOpenRobloxProfile = useCallback(async () => {
    const robloxUsername = mergedUser?.robloxUsername;
    const robloxUserId = mergedUser?.robloxUserId;
    
    if (!robloxUsername && !robloxUserId) {
      return;
    }

    triggerHapticFeedback('impactLight');

    try {
      // Construct URLs
      let robloxAppUrl = null;
      let robloxWebUrl = null;

      if (robloxUserId) {
        // Use userId for app deep link (most reliable)
        robloxAppUrl = `roblox://users/${robloxUserId}`;
        // Use search URL format for web (works with username)
        robloxWebUrl = robloxUsername 
          ? `https://www.roblox.com/search/users?keyword=${encodeURIComponent(robloxUsername)}`
          : `https://www.roblox.com/users/${robloxUserId}`;
      } else if (robloxUsername) {
        // Use search URL format with username
        robloxWebUrl = `https://www.roblox.com/search/users?keyword=${encodeURIComponent(robloxUsername)}`;
      }

      if (!robloxWebUrl) {
        Alert.alert('Error', 'Could not open Roblox profile. Missing username or user ID.');
        return;
      }

      // Try to open in Roblox app first (only if we have userId)
      if (robloxAppUrl) {
        try {
          const canOpenApp = await Linking.canOpenURL(robloxAppUrl);
          if (canOpenApp) {
            await Linking.openURL(robloxAppUrl);
            return; // Successfully opened in app
          }
        } catch (appError) {
          // console.log('Could not open in Roblox app, falling back to browser:', appError);
        }
      }

      // Fallback to browser with search URL
      await Linking.openURL(robloxWebUrl);
    } catch (error) {
      console.error('Error opening Roblox profile:', error);
      Alert.alert('Error', 'Could not open Roblox profile. Please try again.');
    }
  }, [mergedUser?.robloxUsername, mergedUser?.robloxUserId, triggerHapticFeedback]);

  // ✅ Memoize formatCreatedAt
  const formatCreatedAt = useCallback((timestamp) => {
    if (!timestamp) return null;

    const now = Date.now();
    const diffMs = now - timestamp;

    if (diffMs < 0) return null;

    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;

    const years = Math.floor(months / 12);
    return `${years} year${years === 1 ? '' : 's'} ago`;
  }, []);

  // ✅ Memoize getTimestampMs
  const getTimestampMs = useCallback((ts) => {
    if (!ts) return null;

    // Firestore Timestamp instance
    if (typeof ts.toDate === 'function') {
      return ts.toDate().getTime();
    }

    // { seconds, nanoseconds }
    if (typeof ts.seconds === 'number') {
      return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6);
    }

    // already a number?
    if (typeof ts === 'number') return ts;

    return null;
  }, []);
  
  // ─────────────────────────────────────────────
  // Ban / Unban
  const handleBanToggle = async () => {
    if (!selectedUserId) return;

    const action = isBlock ? t('chat.unblock') : t('chat.block');

    Alert.alert(
      `${action}`,
      `${t('chat.are_you_sure')} ${action.toLowerCase()} ${userName}?`,
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: action,
          style: 'destructive',
          onPress: async () => {
            try {
              let updatedBannedUsers;

              // ✅ Safety check for array
              const currentBanned = Array.isArray(bannedUsers) ? bannedUsers : [];
              if (isBlock) {
                updatedBannedUsers = currentBanned.filter(
                  (id) => id !== selectedUserId,
                );
              } else {
                updatedBannedUsers = [...currentBanned, selectedUserId];
              }

              await updateLocalState('bannedUsers', updatedBannedUsers);

              setTimeout(() => {
                showSuccessMessage(
                  t('home.alert.success'),
                  isBlock
                    ? `${userName} ${t('chat.user_unblocked')}`
                    : `${userName} ${t('chat.user_blocked')}`,
                );
              }, 100);
            } catch (error) {
              console.error('❌ Error toggling ban status:', error);
            }
          },
        },
      ],
    );
  };
// console.log(selectedUser)
  // ─────────────────────────────────────────────
  // Start chat
  const handleStartChat = () => {
    if (startChat) startChat();
  };

  // Reset when drawer closes
  useEffect(() => {
    if (!isVisible) {
      setLoadDetails(false);
      setRatingSummary(null);
      setUserBio(null);
      setOwnedPets([]);
      setWishlistPets([]);
      setReviews([]);
      lastReviewDocRef.current = null;
      isLoadingRef.current = false;
      setLastReviewDoc(null);
      setHasMoreReviews(false);
      setCreatedAtText(null);
      setUserPoints(null);
      setGameWins(null);
      setUserData(null); // ✅ Clear fetched user data
      setTrades([]);
      setLastTradeDoc(null);
      setHasMoreTrades(false);
    }
  }, [isVisible]);
  
  // ─────────────────────────────────────────────
  // Load rating summary + joined
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;

    let isMounted = true;

    const loadRatingSummary = async () => {
      setLoadingRating(true);
      try {
        // ✅ Fetch review count and average from Firestore reviews collection
        const reviewsQuery = query(
          collection(firestoreDB, 'reviews'),
          where('toUserId', '==', selectedUserId),
        );
        
        // ✅ OPTIMIZED: Fetch only rewardPoints field instead of full user object
        const [reviewsSnap, createdSnap, rewardPointsSnap, reviewDocSnap] = await Promise.all([
          getDocs(reviewsQuery),
          get(ref(appdatabase, `users/${selectedUserId}/createdAt`)),
          get(ref(appdatabase, `users/${selectedUserId}/rewardPoints`)),
          getDoc(doc(firestoreDB, 'reviews', selectedUserId)), // ✅ Load bio from Firestore
        ]);

        if (!isMounted) return;

        // ✅ Calculate rating summary from Firestore reviews
        if (reviewsSnap && !reviewsSnap.empty) {
          const reviews = reviewsSnap.docs.map(doc => doc.data());
          const validRatings = reviews.filter(r => typeof r.rating === 'number' && r.rating > 0);
          const count = validRatings.length;
          const sum = validRatings.reduce((acc, r) => acc + r.rating, 0);
          const averageValue = count > 0 ? sum / count : 0;
          
          setRatingSummary({
            value: averageValue,
            count: count,
          });
        } else {
          setRatingSummary(null);
        }

        // ✅ Load bio from Firestore reviews/{userId}
        let bioValue = null;
        if (reviewDocSnap.exists) { // ✅ Firestore: exists is a property, not a function
          const reviewData = reviewDocSnap.data();
          if (reviewData.bio && typeof reviewData.bio === 'string' && reviewData.bio.trim()) {
            bioValue = reviewData.bio.trim();
          }
        }
        // ✅ Set bio value (use default if not found or empty)
        setUserBio(bioValue || 'Hi there, I am new here');

        if (createdSnap.exists()) {
          const raw = createdSnap.val();
          let ts = typeof raw === 'number' ? raw : Date.parse(raw);
          if (!Number.isNaN(ts)) {
            setCreatedAtText(formatCreatedAt(ts));
          } else {
            setCreatedAtText(null);
          }
        } else {
          setCreatedAtText(null);
        }

        // ✅ Load user points (RTDB) - using optimized fetch
        if (rewardPointsSnap?.exists()) {
          setUserPoints(rewardPointsSnap.val() || 0);
        } else {
          setUserPoints(0);
        }

        // ✅ Load game wins (Firestore game_stats)
        if (firestoreDB && selectedUserId) {
          const statsDoc = await getDoc(doc(firestoreDB, 'game_stats', selectedUserId));
          if (statsDoc.exists) {
            const stats = statsDoc.data() || {};
            setGameWins(stats.fruitGameWins || 0); // ✅ Changed from petGameWins to fruitGameWins
          } else {
            setGameWins(0);
          }
        } else {
          setGameWins(0);
        }
      } catch (err) {
        // console.log('Rating load error:', err);
        if (isMounted) {
          setRatingSummary(null);
          setCreatedAtText(null);
          setUserPoints(null);
          setGameWins(null);
        }
      } finally {
        if (isMounted) setLoadingRating(false);
      }
    };

    loadRatingSummary();

    return () => {
      isMounted = false;
    };
  }, [isVisible, selectedUserId, loadDetails, appdatabase, firestoreDB, formatCreatedAt]);

  // ─────────────────────────────────────────────
  // Load pets
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;

    let isMounted = true;

    const loadPets = async () => {
      setLoadingPets(true);
      try {
        const reviewDocSnap = await getDoc(
          doc(firestoreDB, 'reviews', selectedUserId),
        );

        if (!isMounted) return;

        if (reviewDocSnap.exists) {
          const data = reviewDocSnap.data() || {};
          setOwnedPets(Array.isArray(data.ownedPets) ? data.ownedPets : []);
          setWishlistPets(
            Array.isArray(data.wishlistPets) ? data.wishlistPets : [],
          );
        } else {
          setOwnedPets([]);
          setWishlistPets([]);
        }
      } catch (err) {
        // console.log('Pets load error:', err);
        if (isMounted) {
          setOwnedPets([]);
          setWishlistPets([]);
        }
      } finally {
        if (isMounted) setLoadingPets(false);
      }
    };

    loadPets();

    return () => {
      isMounted = false;
    };
  }, [isVisible, selectedUserId, loadDetails, firestoreDB]);

  // ─────────────────────────────────────────────
  // Load reviews (paged) — ✅ Memoized with useCallback
  // ✅ Use refs to track state and avoid dependency issues
  const lastReviewDocRef = useRef(null);
  const isLoadingRef = useRef(false);
  
  const loadReviews = useCallback(async (reset = false) => {
    if (!firestoreDB || !selectedUserId) return;
    
    // ✅ Prevent duplicate calls using ref (avoids dependency issues)
    if (isLoadingRef.current) {
      // console.log('🔄 [BottomDrawer] Already loading reviews, skipping...');
      return;
    }

    isLoadingRef.current = true;
    setLoadingReviews(true);
    try {
      // ✅ Fetch one extra document to check if there are more reviews
      // This prevents showing "load more" when there's exactly REVIEWS_PAGE_SIZE reviews
      let q;
      if (!reset && lastReviewDocRef.current) {
        q = query(
          collection(firestoreDB, 'reviews'),
          where('toUserId', '==', selectedUserId),
          orderBy('updatedAt', 'desc'),
          startAfter(lastReviewDocRef.current),
          limit(REVIEWS_PAGE_SIZE + 1), // ✅ Fetch one extra to check if more exist
        );
      } else {
        q = query(
          collection(firestoreDB, 'reviews'),
          where('toUserId', '==', selectedUserId),
          orderBy('updatedAt', 'desc'),
          limit(REVIEWS_PAGE_SIZE + 1), // ✅ Fetch one extra to check if more exist
        );
      }

      const snap = await getDocs(q);

      // ✅ Check if we got more than page size (means there are more reviews)
      const hasMoreResults = snap.docs.length > REVIEWS_PAGE_SIZE;
      
      // ✅ Only take REVIEWS_PAGE_SIZE documents (discard the extra one)
      const docsToUse = snap.docs.slice(0, REVIEWS_PAGE_SIZE);
      
      const batch = docsToUse.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
        };
      });

      setReviews((prev) => (reset ? batch : [...prev, ...batch]));

      // ✅ Use the last document from the actual batch (not the extra one)
      const newLastDoc = docsToUse[docsToUse.length - 1] || null;
      lastReviewDocRef.current = newLastDoc;
      setLastReviewDoc(newLastDoc);
      
      // ✅ Fix: hasMoreReviews is true only if we got more results than page size
      // This accurately detects if there are more reviews without false positives
      setHasMoreReviews(hasMoreResults);
    } catch (err) {
      // console.log('Reviews load error:', err);
      if (reset) setReviews([]);
      setHasMoreReviews(false);
    } finally {
      isLoadingRef.current = false;
      setLoadingReviews(false);
    }
  }, [firestoreDB, selectedUserId]); // ✅ Removed loadingReviews from deps to prevent re-renders

  // initial reviews load when opening details
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;
    // reset pagination when details open
    lastReviewDocRef.current = null;
    setLastReviewDoc(null);
    setHasMoreReviews(false);
    loadReviews(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, selectedUserId, loadDetails]); // ✅ Removed loadReviews from deps to prevent re-renders

  // ✅ Memoize handleLoadMoreReviews
  const handleLoadMoreReviews = useCallback(() => {
    if (!hasMoreReviews || loadingReviews) return;
    loadReviews(false);
  }, [hasMoreReviews, loadingReviews, loadReviews]);

  // ─────────────────────────────────────────────
  // Load trades (paged) — ✅ Initially show 1, then load 2 by 2
  const INITIAL_TRADES_SIZE = 1; // Show 1 trade initially
  const LOAD_MORE_TRADES_SIZE = 2; // Load 2 trades at a time when loading more
  
  const loadTrades = useCallback(async (reset = false) => {
    if (!firestoreDB || !selectedUserId) return;
    if (loadingTrades) return;

    setLoadingTrades(true);
    try {
      // Determine the limit based on whether it's initial load or load more
      const limitSize = reset ? INITIAL_TRADES_SIZE : LOAD_MORE_TRADES_SIZE;
      
      let q;
      if (!reset && lastTradeDoc) {
        q = query(
          collection(firestoreDB, 'trades_new'),
          where('userId', '==', selectedUserId),
          orderBy('timestamp', 'desc'),
          startAfter(lastTradeDoc),
          limit(limitSize + 1), // Fetch one extra to check if more exist
        );
      } else {
        q = query(
          collection(firestoreDB, 'trades_new'),
          where('userId', '==', selectedUserId),
          orderBy('timestamp', 'desc'),
          limit(limitSize + 1), // Fetch one extra to check if more exist
        );
      }

      const snap = await getDocs(q);

      // Check if we got more than page size
      const hasMoreResults = snap.docs.length > limitSize;
      
      // Only take limitSize documents (discard the extra one)
      const docsToUse = snap.docs.slice(0, limitSize);
      
      const batch = docsToUse.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      setTrades((prev) => (reset ? batch : [...prev, ...batch]));

      const newLastDoc = docsToUse[docsToUse.length - 1] || null;
      setLastTradeDoc(newLastDoc);
      setHasMoreTrades(hasMoreResults);
    } catch (err) {
      console.error('Trades load error:', err);
      if (reset) setTrades([]);
      setHasMoreTrades(false);
    } finally {
      setLoadingTrades(false);
    }
  }, [firestoreDB, selectedUserId, lastTradeDoc, loadingTrades]);

  // Initial trades load when opening details
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;
    setLastTradeDoc(null);
    setHasMoreTrades(false);
    loadTrades(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, selectedUserId, loadDetails]);

  // ✅ Memoize handleLoadMoreTrades
  const handleLoadMoreTrades = useCallback(() => {
    if (!hasMoreTrades || loadingTrades) return;
    loadTrades(false);
  }, [hasMoreTrades, loadingTrades, loadTrades]);

  // ─────────────────────────────────────────────
  // Helpers for rendering - ✅ Memoized

  const renderStars = useCallback((value) => {
    const rounded = Math.round(value || 0);
    const full = '★'.repeat(Math.min(rounded, 5));
    const empty = '☆'.repeat(Math.max(0, 5 - rounded));
    return (
      <Text style={{ color: '#FFD700', fontSize: 14, fontWeight: '600' }}>
        {full}
        <Text style={{ color: '#999' }}>{empty}</Text>
      </Text>
    );
  }, []);

  const renderPetBubble = useCallback((pet, index) => {
    // ✅ Safety checks
    if (!pet || typeof pet !== 'object' || !pet.name) return null;

    // ✅ Use the same image URL format as in Setting.jsx
    const imageUrl = `https://bloxfruitscalc.com/wp-content/uploads/2024/${pet.type === 'n' ? '09' : '08'}/${formatName(pet.name)}_Icon.webp`;

    return (
      <View
        key={`${pet.id || pet.name || index}-${index}`}
        style={{
          width: 42,
          height: 42,
          marginRight: 6,
          borderRadius: 10,
          overflow: 'hidden',
          backgroundColor: isDarkMode ? '#0f172a' : '#e5e7eb',
        }}
      >
        <Image
          source={{ uri: imageUrl }}
          style={{ width: '100%', height: '100%' }}
          defaultSource={{ uri: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
        />
      </View>
    );
  }, [isDarkMode]);

  // ✅ Render trade item
  const renderTradeItem = useCallback((trade) => {
    const { deal, tradeRatio } = getTradeDeal(trade.hasTotal, trade.wantsTotal);
    const tradePercentage = Math.abs(((tradeRatio - 1) * 100).toFixed(0));
    const isProfit = tradeRatio > 1;
    const neutral = tradeRatio === 1;
    const formattedTime = trade.timestamp ? dayjs(trade.timestamp.toDate()).fromNow() : "Unknown";

    const groupedHasItems = groupTradeItems(trade.hasItems || []);
    const groupedWantsItems = groupTradeItems(trade.wantsItems || []);

    return (
      <View
        key={trade.id}
        style={{
          backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
          borderRadius: 12,
          padding: 10,
          marginBottom: 10,
          borderWidth: 1,
          borderColor: isDarkMode ? '#1f2937' : '#e5e7eb',
        }}
      >
        {/* Trade Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              {trade.isFeatured && (
                <View style={{
                  backgroundColor: config.colors.hasBlockGreen,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 4,
                  marginRight: 6,
                }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '600' }}>FEATURED</Text>
                </View>
              )}
              <Text style={{ fontSize: 10, color: isDarkMode ? '#9ca3af' : '#6b7280' }}>
                {formattedTime}
              </Text>
            </View>
            {(groupedHasItems.length > 0 && groupedWantsItems.length > 0) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <View style={{
                  backgroundColor: deal.color,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  marginRight: 8,
                }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>
                    {t(deal.label) || deal.label}
                  </Text>
                </View>
                <Text style={{
                  fontSize: 11,
                  color: !isProfit ? config.colors.hasBlockGreen : config.colors.wantBlockRed,
                  fontWeight: '600'
                }}>
                  {tradePercentage}% {!neutral && (
                    <Icon
                      name={isProfit ? 'arrow-down-outline' : 'arrow-up-outline'}
                      size={10}
                      color={isProfit ? config.colors.wantBlockRed : config.colors.hasBlockGreen}
                    />
                  )}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Trade Items */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
          {/* Has Items */}
          <View style={{ flex: 1, alignItems: 'center', marginRight: 4 }}>
            <Text style={{ fontSize: 9, fontWeight: '600', color: isDarkMode ? '#9ca3af' : '#6b7280', marginBottom: 4 }}>
              ME
            </Text>
            {groupedHasItems.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 3 }}>
                {groupedHasItems.slice(0, 2).map((hasItem) => (
                  <View key={`${hasItem.name}-${hasItem.type}`} style={{ alignItems: 'center', marginBottom: 2 }}>
                    <Image
                      source={{
                        uri: hasItem.type === 'p' 
                          ? `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatTradeName(hasItem.name)}_Icon.webp` 
                          : `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatTradeName(hasItem.name)}_Icon.webp`,
                      }}
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        backgroundColor: hasItem.type === 'p' ? '#FFCC00' : 'transparent',
                      }}
                      resizeMode="contain"
                    />
                    <Text style={{ fontSize: 7, color: isDarkMode ? '#d1d5db' : '#4b5563', marginTop: 1 }}>
                      {hasItem.name}{hasItem.type === 'p' && " (P)"}
                    </Text>
                    {hasItem.count > 1 && (
                      <View style={{
                        position: 'absolute',
                        top: -2,
                        right: -2,
                        backgroundColor: 'purple',
                        borderRadius: 6,
                        minWidth: 12,
                        height: 12,
                        justifyContent: 'center',
                        alignItems: 'center',
                        paddingHorizontal: 1,
                      }}>
                        <Text style={{ color: '#fff', fontSize: 7, fontWeight: '600' }}>{hasItem.count}</Text>
                      </View>
                    )}
                  </View>
                ))}
                {groupedHasItems.length > 2 && (
                  <Text style={{ fontSize: 8, color: isDarkMode ? '#9ca3af' : '#6b7280' }}>
                    +{groupedHasItems.length - 2}
                  </Text>
                )}
              </View>
            ) : (
              <Text style={{ fontSize: 9, color: isDarkMode ? '#6b7280' : '#9ca3af', fontStyle: 'italic' }}>
                No items
              </Text>
            )}
            {groupedHasItems.length > 0 && trade.hasTotal && (
              <Text style={{
                fontSize: 8,
                fontWeight: '600',
                color: config.colors.hasBlockGreen,
                marginTop: 3,
                backgroundColor: config.colors.hasBlockGreen + '20',
                paddingHorizontal: 4,
                paddingVertical: 1,
                borderRadius: 3,
              }}>
                {formatTradeValue(trade.hasTotal.value)}
              </Text>
            )}
          </View>

          {/* Transfer Icon */}
          <View style={{ justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 }}>
            <Image 
              source={require('../../../assets/transfer.png')} 
              style={{ width: 16, height: 16, opacity: 0.6 }} 
            />
          </View>

          {/* Wants Items */}
          <View style={{ flex: 1, alignItems: 'center', marginLeft: 4 }}>
            <Text style={{ fontSize: 9, fontWeight: '600', color: isDarkMode ? '#9ca3af' : '#6b7280', marginBottom: 4 }}>
              YOU
            </Text>
            {groupedWantsItems.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 3 }}>
                {groupedWantsItems.slice(0, 2).map((wantnItem) => (
                  <View key={`${wantnItem.name}-${wantnItem.type}`} style={{ alignItems: 'center', marginBottom: 2 }}>
                    <Image
                      source={{
                        uri: wantnItem.type === 'p' 
                          ? `https://bloxfruitscalc.com/wp-content/uploads/2024/08/${formatTradeName(wantnItem.name)}_Icon.webp` 
                          : `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatTradeName(wantnItem.name)}_Icon.webp`,
                      }}
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        backgroundColor: wantnItem.type === 'p' ? '#FFCC00' : 'transparent',
                      }}
                      resizeMode="contain"
                    />
                    <Text style={{ fontSize: 7, color: isDarkMode ? '#d1d5db' : '#4b5563', marginTop: 1 }}>
                      {wantnItem.name}{wantnItem.type === 'p' && " (P)"}
                    </Text>
                    {wantnItem.count > 1 && (
                      <View style={{
                        position: 'absolute',
                        top: -2,
                        right: -2,
                        backgroundColor: 'purple',
                        borderRadius: 6,
                        minWidth: 12,
                        height: 12,
                        justifyContent: 'center',
                        alignItems: 'center',
                        paddingHorizontal: 1,
                      }}>
                        <Text style={{ color: '#fff', fontSize: 7, fontWeight: '600' }}>{wantnItem.count}</Text>
                      </View>
                    )}
                  </View>
                ))}
                {groupedWantsItems.length > 2 && (
                  <Text style={{ fontSize: 8, color: isDarkMode ? '#9ca3af' : '#6b7280' }}>
                    +{groupedWantsItems.length - 2}
                  </Text>
                )}
              </View>
            ) : (
              <Text style={{ fontSize: 9, color: isDarkMode ? '#6b7280' : '#9ca3af', fontStyle: 'italic' }}>
                No items
              </Text>
            )}
            {groupedWantsItems.length > 0 && trade.wantsTotal && (
              <Text style={{
                fontSize: 8,
                fontWeight: '600',
                color: config.colors.wantBlockRed,
                marginTop: 3,
                backgroundColor: config.colors.wantBlockRed + '20',
                paddingHorizontal: 4,
                paddingVertical: 1,
                borderRadius: 3,
              }}>
                {formatTradeValue(trade.wantsTotal.value)}
              </Text>
            )}
          </View>
        </View>

        {/* Description */}
        {trade.description && (
          <Text style={{
            fontSize: 10,
            color: isDarkMode ? '#d1d5db' : '#4b5563',
            marginTop: 6,
            paddingTop: 6,
            borderTopWidth: 1,
            borderTopColor: isDarkMode ? '#1f2937' : '#e5e7eb',
          }}>
            {trade.description}
          </Text>
        )}
      </View>
    );
  }, [isDarkMode, t]);

  // ─────────────────────────────────────────────
  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isVisible}
      onRequestClose={toggleModal}
    >
      {/* Overlay */}
      <Pressable style={styles.overlay} onPress={toggleModal} />

      {/* Drawer Content */}
      <View style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View style={styles.drawer}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 480 }}
            contentContainerStyle={{ paddingBottom: 16 }}
          >
            {/* HEADER: user row */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <View style={{ flexDirection: 'row', flex: 1, marginRight: 8 }}>
                {/* Avatar with Online Indicator - matches OnlineUsersList.jsx structure */}
                <View style={{ position: 'relative', marginRight: 12 }}>
                  <Image
                    source={{
                      uri: avatar
                        ? avatar
                        : 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                    }}
                    style={styles.profileImage2}
                  />
                  {/* Online/Offline Indicator - attached to avatar bottom-right */}
                  <View
                    style={{
                      position: 'absolute',
                      bottom: 1,
                      right: 1,
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: isOnline ? '#10B981' : '#9CA3AF', // Green for online, gray for offline
                      borderWidth: 2,
                      borderColor: isDarkMode ? '#1F2937' : '#FFFFFF',
                      zIndex: 10, // Ensure it's above the image
                    }}
                  />
                </View>

                <View style={{ justifyContent: 'center', flex: 1, marginRight: 8 }}>
                  {/* Username Row */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Text 
                      style={[styles.drawerSubtitleUser, { flexShrink: 1 }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {userName}{' '}
                      {mergedUser?.isPro && (
                        <Image
                          source={require('../../../assets/pro.png')}
                          style={{ width: 10, height: 10 }}
                        />
                      )}{' '}
                      {mergedUser?.flage || selectedUser?.flage || ''}
                      {(() => {
                        const hasRecentWin =
                          !!mergedUser?.hasRecentGameWin ||
                          (typeof mergedUser?.lastGameWinAt === 'number' &&
                            Date.now() - mergedUser.lastGameWinAt <= 24 * 60 * 60 * 1000);
                        return hasRecentWin ? (
                          <Image
                            source={require('../../../assets/trophy.webp')}
                            style={{ width: 10, height: 10, marginLeft: 4 }}
                          />
                        ) : null;
                      })()}
                    </Text>
                    <Icon
                      name="copy-outline"
                      size={16}
                      color="#007BFF"
                      style={{ marginLeft: 8 }}
                      onPress={() => copyToClipboard(userName)}
                    />
                  </View>
                  <View style={{ alignItems: 'flex-start', justifyContent: 'center' }}>
                  {/* Roblox Badge */}
                  {mergedUser?.robloxUsername ? (
                    <View style={{ 
                      backgroundColor: mergedUser?.robloxUsernameVerified ? '#4CAF50' : '#FFA500', 
                      paddingHorizontal: 6, 
                      paddingVertical: 2, 
                      borderRadius: 4,
                      marginBottom: 4,
                      marginTop: 2,
                    }}>
                      <Text style={{ 
                        color: '#FFFFFF', 
                        fontSize: 9, 
                        fontWeight: '600' 
                      }}>
                        {mergedUser?.robloxUsernameVerified ? '✓ Verified' : '⚠ Unverified'}
                      </Text>
                    </View>
                  ) : (
                    <View style={{ 
                      backgroundColor: '#9CA3AF', 
                      paddingHorizontal: 6, 
                      paddingVertical: 2, 
                      borderRadius: 4,
                      marginVertical: 4,
                    }}>
                      <Text style={{ 
                        color: '#FFFFFF', 
                        fontSize: 9, 
                        fontWeight: '600' 
                      }}>
                        No Roblox ID
                      </Text>
                    </View>
                  )}
                </View>
                </View>

                {/* Right Side: Badges */}
           
              </View>

              {/* Ban/Unban Icon */}
              <TouchableOpacity onPress={handleBanToggle}>
                <Icon
                  name={isBlock ? 'shield-checkmark-outline' : 'ban-outline'}
                  size={30}
                  color={
                    isBlock
                      ? config.colors.hasBlockGreen
                      : config.colors.wantBlockRed
                  }
                />
              </TouchableOpacity>
            </View>

            {/* ⭐ Rating summary - Below profile picture section */}
            {loadDetails && (
              <View style={{ marginBottom: 12, marginTop: 8 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  {loadingRating ? (
                    <ActivityIndicator
                      size="small"
                      color={config.colors.primary}
                    />
                  ) : ratingSummary ? (
                    <>
                      {renderStars(ratingSummary.value)}
                      <Text
                        style={{
                          marginLeft: 6,
                          fontSize: 12,
                          color: isDarkMode ? '#e5e7eb' : '#4b5563',
                        }}
                      >
                        {ratingSummary.value.toFixed(1)} / 5 ·{' '}
                        {ratingSummary.count} rating
                        {ratingSummary.count === 1 ? '' : 's'}
                      </Text>
                    </>
                  ) : (
                    <Text
                      style={{
                        fontSize: 12,
                        color: isDarkMode ? '#9ca3af' : '#6b7280',
                      }}
                    >
                      Not rated yet
                    </Text>
                  )}

                  {!loadingRating && createdAtText && (
                    <Text
                      style={{
                        fontSize: 10,
                        backgroundColor:  '#16A34A',
                        paddingHorizontal: 5,
                        borderRadius: 4,
                        paddingVertical: 1,
                        color: 'white',
                        marginLeft: 5,
                      }}
                    >
                      Joined {createdAtText}
                    </Text>
                  )}
                </View>

                {/* 💰 Points and Game Wins */}
                {!loadingRating && (userPoints !== null || gameWins !== null) && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      marginTop: 4,
                    }}
                  >
                    {userPoints !== null && userPoints > 0 && (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          backgroundColor: isDarkMode ? '#1e293b' : '#f0f9ff',
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: isDarkMode ? '#334155' : '#bae6fd',
                        }}
                      >
                        <Icon name="diamond" size={14} color="#10B981" />
                        <Text
                          style={{
                            fontSize: 11,
                            fontFamily: 'Lato-Bold',
                            color: isDarkMode ? '#10B981' : '#059669',
                            marginLeft: 4,
                          }}
                        >
                          {Number(userPoints).toLocaleString()} pts
                        </Text>
                      </View>
                    )}
                    {gameWins !== null && gameWins > 0 && (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          backgroundColor: isDarkMode ? '#1e293b' : '#fef3c7',
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: isDarkMode ? '#334155' : '#fde68a',
                        }}
                      >
                        <Icon name="trophy" size={12} color="#F59E0B" />
                        <Text
                          style={{
                            fontSize: 11,
                            fontFamily: 'Lato-Bold',
                            color: isDarkMode ? '#F59E0B' : '#D97706',
                            marginLeft: 4,
                          }}
                        >
                          {gameWins}x win
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            )}
     {/* 📝 Bio Section */}
     {loadDetails && (
              <View
                style={{
                  borderRadius: 12,
                  padding: 12,
                  backgroundColor: isDarkMode ? '#0f172a' : '#f3f4f6',
                  marginBottom: 12,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '500',
                    marginBottom: 6,
                    color: isDarkMode ? '#9ca3af' : '#6b7280',
                  }}
                >
                  Bio
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    color: isDarkMode ? '#e5e7eb' : '#111827',
                    lineHeight: 18,
                  }}
                >
                  {userBio || 'Hi there, I am new here'}
                </Text>
              </View>
            )}
            
            {/* 🐾 Pets section */}
           {loadDetails && <View
              style={{
                borderRadius: 12,
                padding: 10,
                backgroundColor: isDarkMode ? '#0f172a' : '#f3f4f6',
                marginBottom: 12,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '600',
                  marginBottom: 6,
                  color: isDarkMode ? '#e5e7eb' : '#111827',
                }}
              >
                Pets
              </Text>

              {loadingPets ? (
                <ActivityIndicator size="small" color={config.colors.primary} />
              ) : (
                <>
                  {/* Owned */}
                  <View style={{ marginBottom: 8 }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        marginBottom: 4,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '500',
                          color: isDarkMode ? '#e5e7eb' : '#111827',
                        }}
                      >
                        Owned Pets
                      </Text>
                    </View>

                    {ownedPets.length === 0 ? (
                      <Text
                        style={{
                          fontSize: 11,
                          color: isDarkMode ? '#9ca3af' : '#6b7280',
                        }}
                      >
                        No pets listed.
                      </Text>
                    ) : (
                      <ScrollView
  horizontal
  showsHorizontalScrollIndicator={false}
  contentContainerStyle={{ paddingRight: 6 }}
>
  <View style={{ flexDirection: 'row' }}>
    {ownedPets.map((pet, index) => renderPetBubble(pet, index))}

    
      
  
  </View>
</ScrollView>

                    )}
                  </View>

                  {/* Wishlist */}
                  <View>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        marginBottom: 4,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '500',
                          color: isDarkMode ? '#e5e7eb' : '#111827',
                        }}
                      >
                        Wishlist
                      </Text>
                    </View>

                    {wishlistPets.length === 0 ? (
                      <Text
                        style={{
                          fontSize: 11,
                          color: isDarkMode ? '#9ca3af' : '#6b7280',
                        }}
                      >
                        No wishlist pets yet.
                      </Text>
                    ) : (
                      <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ paddingRight: 6 }}
                    >
                      <View style={{ flexDirection: 'row' }}>
                        {wishlistPets.map((pet, index) => renderPetBubble(pet, index))}
                          </View>
                          </ScrollView>
                    )}
                  </View>
                </>
              )}
            </View>}
           


            {/* 📝 Reviews section */}
           {loadDetails &&  <View
              style={{
                borderRadius: 12,
                padding: 10,
                backgroundColor: isDarkMode ? '#020617' : '#f3f4f6',
                marginBottom: 16,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '600',
                  marginBottom: 6,
                  color: isDarkMode ? '#e5e7eb' : '#111827',
                }}
              >
                Recent Reviews
              </Text>

              {loadingReviews && reviews.length === 0 ? (
                <ActivityIndicator
                  size="small"
                  color={config.colors.primary}
                />
              ) : reviews.length === 0 ? (
                <Text
                  style={{
                    fontSize: 11,
                    color: isDarkMode ? '#9ca3af' : '#6b7280',
                  }}
                >
                  No reviews yet.
                </Text>
              ) : (
                <>
                  {reviews.map((rev) => {
                    const tsMs = getTimestampMs(
                      rev.updatedAt || rev.createdAt,
                    );
                    const timeLabel = tsMs ? formatCreatedAt(tsMs) : null;

                    return (
                      <View
                        key={rev.id}
                        style={{
                          paddingVertical: 4,
                          paddingHorizontal: 4,
                          borderBottomWidth: 1,
                          borderBottomColor: isDarkMode
                            ? '#1f2937'
                            : '#e5e7eb',
                        }}
                      >
                        <View
                          style={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            marginBottom: 4,
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{
                                fontSize: 12,
                                fontWeight: '600',
                                color: isDarkMode ? '#e5e7eb' : '#111827',
                                marginBottom: 2,
                              }}
                            >
                              {rev.userName || 'Anonymous'}
                            </Text>
                            {!!rev?.review && (
                              <Text
                                style={{
                                  fontSize: 11,
                                  color: isDarkMode ? '#d1d5db' : '#4b5563',
                                  lineHeight: 16,
                                }}
                              >
                                {rev.review}
                              </Text>
                            )}
                            {rev?.edited && (
                              <Text
                                style={{
                                  fontSize: 10,
                                  color: isDarkMode ? '#9ca3af' : '#9ca3af',
                                  marginTop: 2,
                                }}
                              >
                                Edited
                              </Text>
                            )}
                          </View>

                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            {timeLabel && (
                              <Text
                                style={{
                                  fontSize: 10,
                                  color: isDarkMode ? '#9ca3af' : '#9ca3af',
                                }}
                              >
                                {timeLabel}
                              </Text>
                            )}
                            {renderStars(rev?.rating || 0)}
                          </View>
                        </View>
                      </View>
                    );
                  })}

                  {hasMoreReviews && !loadingReviews && (
                    <TouchableOpacity
                      onPress={handleLoadMoreReviews}
                      style={{
                        marginTop: 8,
                        alignSelf: 'center',
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: isDarkMode ? '#4b5563' : '#d1d5db',
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          color: isDarkMode ? '#e5e7eb' : '#111827',
                        }}
                      >
                        Load more reviews
                      </Text>
                    </TouchableOpacity>
                  )}

                  {loadingReviews && hasMoreReviews && (
                    <ActivityIndicator
                      size="small"
                      color={config.colors.primary}
                      style={{ marginTop: 6, alignSelf: 'center' }}
                    />
                  )}
                </>
              )}
            </View>}

            {/* 💼 Trades section */}
            {loadDetails && (
              <View
                style={{
                  borderRadius: 12,
                  padding: 10,
                  backgroundColor: isDarkMode ? '#020617' : '#f3f4f6',
                  marginBottom: 16,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    marginBottom: 6,
                    color: isDarkMode ? '#e5e7eb' : '#111827',
                  }}
                >
                  Recent Trades
                </Text>

                {loadingTrades && trades.length === 0 ? (
                  <ActivityIndicator
                    size="small"
                    color={config.colors.primary}
                  />
                ) : trades.length === 0 ? (
                  <Text
                    style={{
                      fontSize: 11,
                      color: isDarkMode ? '#9ca3af' : '#6b7280',
                    }}
                  >
                    No trades yet.
                  </Text>
                ) : (
                  <>
                    {trades.map((trade) => renderTradeItem(trade))}

                    {hasMoreTrades && !loadingTrades && (
                      <TouchableOpacity
                        onPress={handleLoadMoreTrades}
                        style={{
                          marginTop: 8,
                          alignSelf: 'center',
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: isDarkMode ? '#4b5563' : '#d1d5db',
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            color: isDarkMode ? '#e5e7eb' : '#111827',
                          }}
                        >
                          Load more trades
                        </Text>
                      </TouchableOpacity>
                    )}

                    {loadingTrades && hasMoreTrades && (
                      <ActivityIndicator
                        size="small"
                        color={config.colors.primary}
                        style={{ marginTop: 6, alignSelf: 'center' }}
                      />
                    )}
                  </>
                )}
              </View>
            )}

            {/* View details button */}
            {!loadDetails && (
              <TouchableOpacity
                style={styles.saveButtonProfile}
                onPress={() => setLoadDetails(true)}
              >
                <Text
                  style={[
                    styles.saveButtonTextProfile,
                    { color: isDarkMode ? 'white' : 'black' },
                  ]}
                >
                  View Detail Profile
                </Text>
              </TouchableOpacity>
            )}

            {/* Roblox Profile Button */}
            {mergedUser?.robloxUsername && (
              <TouchableOpacity 
                style={[styles.saveButton, { 
                  backgroundColor: isDarkMode ? '#4A90E2' : '#007AFF',
                  marginBottom: 8,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                }]} 
                onPress={handleOpenRobloxProfile}
              >
                <Icon 
                  name="game-controller-outline" 
                  size={16} 
                  color="#FFFFFF" 
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.saveButtonText, { color: '#FFFFFF' }]}>
                  View Roblox Profile
                </Text>
              </TouchableOpacity>
            )}

            {/* Start chat button */}
            {!fromPvtChat && (
              <TouchableOpacity style={styles.saveButton} onPress={handleStartChat}>
                <Text style={styles.saveButtonText}>
                  {t('chat.start_chat')}
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default ProfileBottomDrawer;
