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
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import { getThemeColors } from '../../Helper/themeColors';
import config from '../../Helper/Environment';
import Icon from 'react-native-vector-icons/Ionicons';
import { getStyles } from '../../SettingScreen/settingstyle';
import { useLocalState } from '../../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import { mixpanel } from '../../AppHelper/MixPenel';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FramedAvatar from './FramedAvatar';
import BadgeShowcase from './BadgeShowcase';
import CompactPortfolio from './CompactPortfolio';
import ProfilePostsSection from './ProfilePostsSection';
import RoleBadges from '../../Design/componenets/RoleBadges';
import { getCachedProfile } from '../../Helper/profileCache';
import { computeBadges } from './badgeUtils';
import XPBar from '../../Engagement/XPBar';
import { getUserXP } from '../../Engagement/xpUtils';
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
  setDoc,
  deleteDoc,
  serverTimestamp,
  getCountFromServer,
  writeBatch,
} from '@react-native-firebase/firestore';
import { ref, get, set, remove } from '@react-native-firebase/database';
import { getRoblox, getRoles, getCosmetics } from '../../Supabase/userBackend';
import { SUPABASE_USERS_ENABLED } from '../../Supabase/featureFlags';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { banUserwithEmail, unbanUserWithEmail, setUserStrike, checkBanStatus, makeModerator, removeModerator, muteUser, makeBabyMod, removeBabyMod, canModerate } from '../utils'; // ✅ Import moderator utils
import { getAuth } from '@react-native-firebase/auth';

// Initialize dayjs plugins
dayjs.extend(relativeTime);

const REVIEWS_PAGE_SIZE = 3; // how many reviews per page
const FILTERED_REVIEWS_PAGE_SIZE = 5; // more per page when star filter is active
const STAR_OPTIONS = [null, 5, 4, 3, 2, 1]; // null = All

// Default gradient banner colors
const DEFAULT_BANNER = ['#64748b', '#94a3b8', '#cbd5e1'];

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
  onFollowChange,
}) => {
  const { theme, firestoreDB, appdatabase, isAdmin, user, isModerator: isGlobalModerator, isBabyMod: isGlobalBabyMod } = useGlobalState(); // ✅ Get isAdmin, user, and role flags
  const { updateLocalState } = useLocalState();
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();
  const insets = useSafeAreaInsets();

  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const selectedUserId = selectedUser?.senderId || selectedUser?.id || null;
  // ✅ Resolve from message (old format) → profileCache (slim format) → default
  const cachedProfile = getCachedProfile(selectedUserId);
  const userName = selectedUser?.sender || cachedProfile?.displayName || null;
  const avatar = selectedUser?.avatar || cachedProfile?.avatar || null;

  // 🔒 ban state - ✅ Safety check for array
  const isBlock = Array.isArray(bannedUsers) && bannedUsers.includes(selectedUserId);

  // ⭐ rating summary (from Firestore user_ratings_summary - MIGRATED)
  const [ratingSummary, setRatingSummary] = useState(null);
  const [loadingRating, setLoadingRating] = useState(false);
  const [userBio, setUserBio] = useState(null);

  // 👥 Follower Count
  const [followersCount, setFollowersCount] = useState(0);

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
  const [starFilter, setStarFilter] = useState(null); // null = All, 1-5 = specific star

  // 🐾 pets (owned + wishlist) from Firestore doc /reviews/{userId}
  const [ownedPets, setOwnedPets] = useState([]);
  const [wishlistPets, setWishlistPets] = useState([]);
  const [loadingPets, setLoadingPets] = useState(false);
  const [showModTools, setShowModTools] = useState(false);

  // ✅ Admin Reason Modal States
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [reasonActionType, setReasonActionType] = useState(null);
  const [adminReason, setAdminReason] = useState('');

  // 💼 trades list (from Firestore /trades_new_upgrade where userId == selectedUserId)
  const [trades, setTrades] = useState([]);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [lastTradeDoc, setLastTradeDoc] = useState(null);
  const [hasMoreTrades, setHasMoreTrades] = useState(false);

  // toggle details
  const [loadDetails, setLoadDetails] = useState(false);

  // ✅ State for fetched user data (roblox username, verified status, etc.)
  const [userData, setUserData] = useState(null);
  // ✅ State for ban status (fetched dynamically)
  const [isBanned, setIsBanned] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  // ✅ NEW: Badges, XP, Cosmetics, Posts
  const [savedBadges, setSavedBadges] = useState({});
  const [userCreatedAtMs, setUserCreatedAtMs] = useState(0);
  const [xpData, setXpData] = useState({ total: 0, level: 1 });
  const [activeCosmetics, setActiveCosmetics] = useState({ profileFrame: null, chatTextColor: null });

  // ✅ Posts section
  const [posts, setPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [lastPostDoc, setLastPostDoc] = useState(null);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const POSTS_PAGE_SIZE = 3;



  // ✅ OPTIMIZED: Fetch user data from Firebase only for missing fields
  // This minimizes Firebase reads and reduces costs
  useEffect(() => {
    if (!selectedUserId || !appdatabase) return;

    let isMounted = true;

    const fetchUserData = async () => {
      try {
        // ── Supabase path ────────────────────────────────────────────
        // 3 batched lookups (roblox, roles, cosmetics) cover 11 of the
        // 13 fields. lastGameWinAt + flage stay on RTDB (not migrated
        // this phase — flage isn't in user_identity, lastGameWinAt is
        // gameplay state we kept off the migration). Net: 13 RTDB
        // reads → 3 Supabase + up to 2 RTDB reads.
        if (SUPABASE_USERS_ENABLED) {
          const [roblox, roles, cos, flageSnap, lastGameWinAtSnap] = await Promise.all([
            getRoblox(selectedUserId),
            getRoles(selectedUserId),
            getCosmetics(selectedUserId),
            !selectedUser?.flage
              ? get(ref(appdatabase, `users/${selectedUserId}/flage`)).catch(() => null)
              : Promise.resolve(null),
            !selectedUser?.lastGameWinAt
              ? get(ref(appdatabase, `users/${selectedUserId}/lastGameWinAt`)).catch(() => null)
              : Promise.resolve(null),
          ]);

          if (roblox || roles || cos) {
            if (!isMounted) return;
            setUserData({
              robloxUsername: roblox?.robloxUsername ?? null,
              robloxUserId: roblox?.robloxUserId ?? null,
              robloxUsernameVerified: !!roblox?.robloxUsernameVerified,
              isPro: !!cos?.isPro,
              lastGameWinAt: lastGameWinAtSnap?.exists() ? lastGameWinAtSnap.val() : null,
              flage: flageSnap?.exists() ? flageSnap.val() : null,
              isModerator: !!roles?.isModerator,
              isAdmin: !!roles?.isAdmin,
              isBabyMod: !!roles?.isBabyMod,
              isTrusted: !!roles?.isTrusted,
              isGrinder: !!roles?.isGrinder,
              isRaider: !!roles?.isRaider,
            });
            return;
          }
        }

        // ── RTDB fallback (original conditional fan-out) ─────────────
        const fieldsToFetch = [];

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
          fieldsToFetch.push({ key: 'flage', path: `users/${selectedUserId}/flage` });
        }
        fieldsToFetch.push({ key: 'isModerator', path: `users/${selectedUserId}/isModerator` });
        fieldsToFetch.push({ key: 'isAdmin', path: `users/${selectedUserId}/admin` });
        fieldsToFetch.push({ key: 'isBabyMod', path: `users/${selectedUserId}/isBabyMod` });
        fieldsToFetch.push({ key: 'isTrusted', path: `users/${selectedUserId}/isTrusted` });
        fieldsToFetch.push({ key: 'isGrinder', path: `users/${selectedUserId}/isGrinder` });
        fieldsToFetch.push({ key: 'isRaider', path: `users/${selectedUserId}/isRaider` });

        if (fieldsToFetch.length === 0) {
          setUserData(null);
          return;
        }

        const snapshots = await Promise.all(
          fieldsToFetch.map(({ path }) => get(ref(appdatabase, path)).catch(() => null))
        );

        if (!isMounted) return;

        const fetchedData = {};
        fieldsToFetch.forEach(({ key }, index) => {
          const snap = snapshots[index];
          if (snap?.exists()) {
            fetchedData[key] = snap.val();
          } else if (key === 'robloxUsernameVerified') {
            fetchedData[key] = false;
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

  // ✅ Fetch ban status
  useEffect(() => {
    if (selectedUser?.email) {
      checkBanStatus(selectedUser.email).then(status => setIsBanned(status.isBanned));
    }
  }, [selectedUser?.email]);

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
      isModerator: userData?.isModerator || false,
      isBabyMod: userData?.isBabyMod || false,
      isTrusted: userData?.isTrusted || false,
      isGrinder: userData?.isGrinder || false,
      isRaider: userData?.isRaider || false,
      isAdmin: userData?.isAdmin || false,
    };
  }, [selectedUser, userData]);

  // ─────────────────────────────────────────────
  // Clipboard
  const copyToClipboard = (code) => {
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code);
    showSuccessMessage(t('value.copy'), t('chat.copied_to_clipboard'));
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
        Alert.alert(t('chat.error'), t('chat.roblox_missing_info'));
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
      Alert.alert(t('chat.error'), t('chat.roblox_open_error'));
    }
  }, [mergedUser?.robloxUsername, mergedUser?.robloxUserId, triggerHapticFeedback]);

  // ✅ Memoize formatCreatedAt
  const formatCreatedAt = useCallback((timestamp) => {
    if (!timestamp) return null;

    const now = Date.now();
    const diffMs = now - timestamp;

    if (diffMs < 0) return null;

    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return t('chat.just_now');
    if (minutes < 60) return t(minutes === 1 ? 'chat.mins_ago' : 'chat.mins_ago_plural', { count: minutes });

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t(hours === 1 ? 'chat.hours_ago' : 'chat.hours_ago_plural', { count: hours });

    const days = Math.floor(hours / 24);
    if (days < 30) return t(days === 1 ? 'chat.days_ago' : 'chat.days_ago_plural', { count: days });

    const months = Math.floor(days / 30);
    if (months < 12) return t(months === 1 ? 'chat.months_ago' : 'chat.months_ago_plural', { count: months });

    const years = Math.floor(months / 12);
    return t(years === 1 ? 'chat.years_ago' : 'chat.years_ago_plural', { count: years });
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
  // Ban / Unban Logic (Admin)
  const getTargetEmail = async () => {
    let targetEmail = null;
    const authUser = getAuth().currentUser;
    if (authUser && authUser.uid === selectedUserId) targetEmail = authUser.email;
    if (!targetEmail) {
      try {
        const userSnap = await get(ref(appdatabase, `users/${selectedUserId}`));
        if (userSnap.exists()) {
          const d = userSnap.val();
          targetEmail = d.email || d.userEmail || null;
        }
      } catch (_) { }
    }
    return targetEmail || selectedUser?.email || null;
  };

  const handleSetStrike = async (strikeCount) => {
    const targetEmail = await getTargetEmail();
    if (!targetEmail) {
      Alert.alert(t('chat.error'), t('chat.email_not_found'));
      return;
    }
    // Strict hierarchy: caller rank must exceed target rank. utils.js
    // re-checks against fresh RTDB roles; this is the UX-friendly early
    // bail so we don't open the reason modal for a guaranteed-no-op.
    const callerRoles = { isAdmin, isModerator: isGlobalModerator, isBabyMod: isGlobalBabyMod };
    const targetRoles = {
      isAdmin: !!mergedUser?.isAdmin,
      isModerator: !!mergedUser?.isModerator,
      isBabyMod: !!mergedUser?.isBabyMod,
    };
    if (!canModerate(callerRoles, targetRoles)) {
      Alert.alert(t('chat.permission_denied'), t('chat.mod_cannot_ban'));
      return;
    }
    // Open reason modal instead of executing immediately
    setReasonActionType({ type: 'strike', value: strikeCount, email: targetEmail });
    setAdminReason('');
    toggleModal(); // close profile drawer
    setShowReasonModal(true); // open reason modal
  };

  const handleUnbanUser = async () => {
    let targetEmail = null;

    // 1️⃣ Try Auth (if unbanning self)
    const currentUser = getAuth().currentUser;
    if (currentUser && currentUser.uid === selectedUserId) {
      targetEmail = currentUser.email;
    }

    // 2️⃣ Try Firebase Realtime Database
    if (!targetEmail) {
      try {
        const userRef = ref(appdatabase, `users/${selectedUserId}`);
        const userSnap = await get(userRef);

        if (userSnap.exists()) {
          const userData = userSnap.val();

          if (userData.email) {
            targetEmail = userData.email;
          } else if (userData.userEmail) {
            targetEmail = userData.userEmail;
          }
        }
      } catch (err) {
        console.error("Error fetching user data for unban:", err);
      }
    }

    // 3️⃣ Fallback to prop
    if (!targetEmail && selectedUser?.email) {
      targetEmail = selectedUser.email;
    }

    if (!targetEmail) {
      Alert.alert(t('chat.error'), t('chat.email_not_found_unban'));
      return;
    }

    Alert.alert(
      t('chat.unban_user'),
      t('chat.unban_confirm', { name: userName }),
      [
        { text: t('chat.cancel'), style: "cancel" },
        {
          text: t('chat.unban'),
          onPress: async () => {
            const success = await unbanUserWithEmail(targetEmail, true);
            if (success) setIsBanned(false);
          }
        }
      ]
    );
  };

  const handlePromoteModerator = () => {
    Alert.alert(
      t('chat.promote_to_mod'),
      t('chat.promote_confirm', { name: userName }),
      [
        { text: t('chat.cancel'), style: "cancel" },
        {
          text: t('chat.promote'), onPress: async () => {
            const success = await makeModerator(selectedUserId, { isAdmin, isModerator: isGlobalModerator, isBabyMod: isGlobalBabyMod });
            if (success) {
              setUserData(prev => ({ ...prev, isModerator: true }));
            }
          }
        }
      ]
    );
  };

  const handleDemoteModerator = () => {
    Alert.alert(
      t('chat.remove_mod'),
      t('chat.remove_mod_confirm', { name: userName }),
      [
        { text: t('chat.cancel'), style: "cancel" },
        {
          text: t('chat.remove'), style: "destructive", onPress: async () => {
            const success = await removeModerator(selectedUserId, { isAdmin, isModerator: isGlobalModerator, isBabyMod: isGlobalBabyMod });
            if (success) {
              setUserData(prev => ({ ...prev, isModerator: false }));
            }
          }
        }
      ]
    );
  };

  const handleMakeJMD = () => {
    Alert.alert(
      'Promote to JMD',
      `Are you sure you want to make ${userName} a Junior Mod?`,
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: t('chat.promote'), onPress: async () => {
            const success = await makeBabyMod(selectedUserId, { isAdmin, isModerator: isGlobalModerator, isBabyMod: isGlobalBabyMod });
            if (success) {
              setUserData(prev => ({ ...prev, isBabyMod: true }));
              Alert.alert('Success', 'User is now a JMD.');
            }
          }
        }
      ]
    );
  };

  const handleRemoveJMD = () => {
    Alert.alert(
      'Remove JMD',
      `Are you sure you want to remove ${userName}'s JMD status?`,
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: t('chat.remove'), style: 'destructive', onPress: async () => {
            const success = await removeBabyMod(selectedUserId, { isAdmin, isModerator: isGlobalModerator, isBabyMod: isGlobalBabyMod });
            if (success) {
              setUserData(prev => ({ ...prev, isBabyMod: false }));
              Alert.alert('Success', 'JMD privileges removed.');
            }
          }
        }
      ]
    );
  };

  const handleMakeTrusted = () => {
    Alert.alert(
      'Make Trusted',
      `Assign Trusted status to ${userName}?`,
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: 'Confirm', onPress: async () => {
            try {
              await set(ref(appdatabase, `users/${selectedUserId}/isTrusted`), true);
              setUserData(prev => ({ ...prev, isTrusted: true }));
              Alert.alert('Success', 'User is now Trusted.');
            } catch (error) {
              Alert.alert('Error', 'Failed to update status.');
            }
          }
        }
      ]
    );
  };

  const handleRemoveTrusted = () => {
    Alert.alert(
      'Remove Trusted',
      `Remove Trusted status from ${userName}?`,
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            try {
              await set(ref(appdatabase, `users/${selectedUserId}/isTrusted`), null);
              setUserData(prev => ({ ...prev, isTrusted: false }));
              Alert.alert('Success', 'Trusted status removed.');
            } catch (error) {
              Alert.alert('Error', 'Failed to update status.');
            }
          }
        }
      ]
    );
  };

  const handleMakeGrinder = () => {
    Alert.alert(
      'Make Grinder',
      `Assign Grinder status to ${userName}?`,
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: 'Assign', onPress: async () => {
            try {
              await set(ref(appdatabase, `users/${selectedUserId}/isGrinder`), true);
              setUserData(prev => ({ ...prev, isGrinder: true }));
              Alert.alert('Success', 'User is now Grinder.');
            } catch (error) {
              Alert.alert('Error', 'Failed to update status.');
            }
          }
        }
      ]
    );
  };

  const handleRemoveGrinder = () => {
    Alert.alert(
      'Remove Grinder',
      `Remove Grinder status from ${userName}?`,
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            try {
              await set(ref(appdatabase, `users/${selectedUserId}/isGrinder`), null);
              setUserData(prev => ({ ...prev, isGrinder: false }));
              Alert.alert('Success', 'Grinder status removed.');
            } catch (error) {
              Alert.alert('Error', 'Failed to update status.');
            }
          }
        }
      ]
    );
  };

  const handleMakeRaider = () => {
    Alert.alert(
      'Make Raider',
      `Assign Raider status to ${userName}?`,
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: 'Assign', onPress: async () => {
            try {
              await set(ref(appdatabase, `users/${selectedUserId}/isRaider`), true);
              setUserData(prev => ({ ...prev, isRaider: true }));
              Alert.alert('Success', 'User is now Raider.');
            } catch (error) {
              Alert.alert('Error', 'Failed to update status.');
            }
          }
        }
      ]
    );
  };

  const handleRemoveRaider = () => {
    Alert.alert(
      'Remove Raider',
      `Remove Raider status from ${userName}?`,
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            try {
              await set(ref(appdatabase, `users/${selectedUserId}/isRaider`), null);
              setUserData(prev => ({ ...prev, isRaider: false }));
              Alert.alert('Success', 'Raider status removed.');
            } catch (error) {
              Alert.alert('Error', 'Failed to update status.');
            }
          }
        }
      ]
    );
  };

  const handleMuteUser = async (minutes) => {
    const targetEmail = await getTargetEmail();
    if (!targetEmail) {
      Alert.alert(t('chat.error'), t('chat.email_not_found'));
      return;
    }
    const callerRoles = { isAdmin, isModerator: isGlobalModerator, isBabyMod: isGlobalBabyMod };
    const targetRoles = {
      isAdmin: !!mergedUser?.isAdmin,
      isModerator: !!mergedUser?.isModerator,
      isBabyMod: !!mergedUser?.isBabyMod,
    };
    if (!canModerate(callerRoles, targetRoles)) {
      Alert.alert(t('chat.permission_denied'), t('chat.mod_cannot_ban'));
      return;
    }
    // Open reason modal instead of executing immediately
    setReasonActionType({ type: 'mute', value: minutes, email: targetEmail });
    setAdminReason('');
    toggleModal(); // close profile drawer
    setShowReasonModal(true); // open reason modal
  };

  // ✅ Confirm admin action from reason modal
  const confirmAdminAction = async () => {
    if (!reasonActionType) return;
    setShowReasonModal(false);

    const bannerInfo = {
      id: user?.id,
      displayName: user?.userName || user?.displayName || 'Admin',
      avatar: user?.avatar,
      // Caller role flags — utils.js gates strike/mute against these.
      isAdmin: !!isAdmin,
      isModerator: !!isGlobalModerator,
      isBabyMod: !!isGlobalBabyMod,
    };
    const userInfo = {
      id: selectedUserId,
      displayName: mergedUser?.displayName || mergedUser?.sender || userName,
      avatar: mergedUser?.avatar,
      // Target role flags as a fallback; utils.js will still re-fetch
      // from RTDB so a stale mergedUser can't bypass the gate.
      isAdmin: !!mergedUser?.isAdmin,
      isModerator: !!mergedUser?.isModerator,
      isBabyMod: !!mergedUser?.isBabyMod,
    };
    const actionEmail = reasonActionType.email;
    if (!actionEmail) {
      Alert.alert(t('chat.error'), t('chat.email_not_found'));
      setReasonActionType(null);
      return;
    }

    const finalReason = adminReason.trim() !== '' ? adminReason.trim() : undefined;

    if (reasonActionType.type === 'strike') {
      const strikeCount = reasonActionType.value;
      const isStaff = isAdmin || isGlobalModerator;
      const success = await setUserStrike(actionEmail, strikeCount, selectedUserId, isStaff, bannerInfo, userInfo, isStaff, finalReason);
      if (success) setIsBanned(true);
    } else if (reasonActionType.type === 'mute') {
      const minutes = reasonActionType.value;
      const success = await muteUser(actionEmail, minutes, userInfo, bannerInfo, true, finalReason);
      if (success) setIsBanned(true);
    }

    setReasonActionType(null);
  };

  // ✅ Fetch badges, XP, and cosmetics
  useEffect(() => {
    if (!selectedUserId || !appdatabase) return;
    let isMounted = true;

    const fetchBadgesAndXP = async () => {
      try {
        const [badgesSnap, xp, createdSnap] = await Promise.all([
          get(ref(appdatabase, `users/${selectedUserId}/badges`)),
          getUserXP(appdatabase, selectedUserId),
          get(ref(appdatabase, `users/${selectedUserId}/createdAt`)),
        ]);

        if (!isMounted) return;

        if (badgesSnap?.exists()) {
          setSavedBadges(badgesSnap.val() || {});
        } else {
          setSavedBadges({});
        }

        setXpData(xp || { total: 0, level: 1 });

        if (createdSnap?.exists()) {
          const raw = createdSnap.val();
          const ts = typeof raw === 'number' ? raw : Date.parse(raw);
          if (!Number.isNaN(ts)) {
            setUserCreatedAtMs(ts);
            setCreatedAtText(formatCreatedAt(ts));
          }
        } else if (selectedUserId) {
          // ✅ User has no createdAt — write it once
          const now = Date.now();
          set(ref(appdatabase, `users/${selectedUserId}/createdAt`), now).catch(() => {});
          setUserCreatedAtMs(now);
          setCreatedAtText(formatCreatedAt(now));
        }
      } catch (err) {
        console.warn('[BottomDrawer] badges/XP fetch error:', err);
      }
    };

    fetchBadgesAndXP();

    // Fetch cosmetics
    const isOwnProfile = user?.id && (selectedUserId === user.id || selectedUserId === user.senderId);
    if (isOwnProfile) {
      try {
        const { getMyCosmetics } = require('../../Helper/cosmeticsCache');
        setActiveCosmetics(getMyCosmetics());
      } catch { /* fallback */ }
    } else {
      setActiveCosmetics({
        profileFrame: selectedUser?.profileFrame || null,
        chatTextColor: selectedUser?.chatTextColor || null,
        tradeCardBg: null,
        profileBanner: null,
      });
      const fetchOtherCosmetics = async () => {
        try {
          const { getActiveCosmetics } = require('../../Engagement/shopUtils');
          const cosmetics = await getActiveCosmetics(appdatabase, selectedUserId);
          if (isMounted) setActiveCosmetics(cosmetics);
        } catch { /* graceful fallback */ }
      };
      fetchOtherCosmetics();
    }

    return () => { isMounted = false; };
  }, [selectedUserId, appdatabase, user?.id]);

  // ─────────────────────────────────────────────
  // Admin: Delete ALL user data (ported from adoptme-jan7, adapted to
  // this app's collections). Covers Firebase RTDB + Firestore. Supabase
  // rows (chat/message mirrors, user_* tables) are NOT deletable from the
  // client — RLS only allows writes to your own rows — so they are left
  // as-is; the RTDB users/{uid} removal stops the mirror CF from
  // refreshing them.
  const [deletingUser, setDeletingUser] = useState(false);

  const handleDeleteUserData = useCallback(async () => {
    if (!selectedUserId || !firestoreDB || !appdatabase) return;
    if (!isAdmin) return; // admin only

    const targetName = mergedUser?.displayName || mergedUser?.sender || selectedUser?.sender || 'this user';

    const confirmStep1 = () => new Promise((resolve, reject) => {
      Alert.alert(
        '⚠️ Delete User Data',
        `This will permanently delete ALL data for "${targetName}" (${selectedUserId}).\n\nThis includes:\n• Profile & user node\n• All reviews (given & received)\n• All trades\n• All posts\n• Followers/following\n• Chat metadata (legacy)\n• Group invites/requests\n• Trade journal, stats, saved trades\n\nThis action CANNOT be undone.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: reject },
          { text: 'Continue', style: 'destructive', onPress: resolve },
        ]
      );
    });

    const confirmStep2 = () => new Promise((resolve, reject) => {
      Alert.alert(
        '🔴 Final Confirmation',
        `Are you ABSOLUTELY sure you want to delete all data for "${targetName}"?`,
        [
          { text: 'Cancel', style: 'cancel', onPress: reject },
          { text: 'DELETE EVERYTHING', style: 'destructive', onPress: resolve },
        ]
      );
    });

    try {
      await confirmStep1();
      await confirmStep2();

      setDeletingUser(true);

      const uid = selectedUserId;
      const errors = [];

      // ── 1. RTDB: remove user nodes ──────────────────────────
      const rtdbPaths = [
        `users/${uid}`,           // profile, xp, shop, roles, badges
        `presence/${uid}`,        // online status
        `chat_meta_data/${uid}`,  // legacy RTDB chat metadata
        `group_meta_data/${uid}`, // legacy RTDB group metadata
        `activeChats/${uid}`,     // active chat session tracking
        `savedTrades/${uid}`,     // saved/accepted trade refs
        `tradeJournal/${uid}`,    // completed trade history
        `tradeStats/${uid}`,      // trade win/loss stats
        `reward/${uid}`,          // reward center data
      ];
      for (const path of rtdbPaths) {
        try { await remove(ref(appdatabase, path)); }
        catch (e) { errors.push(`RTDB ${path}: ${e.message}`); }
      }

      // ── 2. Firestore: delete docs where the user matches ─────
      const deleteQueryDocs = async (collectionName, field, value) => {
        try {
          const q = query(collection(firestoreDB, collectionName), where(field, '==', value));
          const snap = await getDocs(q);
          if (snap.empty) return 0;
          const CHUNK = 450; // writeBatch limit is 500 ops
          for (let i = 0; i < snap.docs.length; i += CHUNK) {
            const batch = writeBatch(firestoreDB);
            snap.docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
            await batch.commit();
          }
          return snap.size;
        } catch (e) {
          errors.push(`Firestore ${collectionName}[${field}]: ${e.message}`);
          return 0;
        }
      };

      const deleteSingleDoc = async (collectionName, docId) => {
        try { await deleteDoc(doc(firestoreDB, collectionName, docId)); }
        catch (e) { errors.push(`Firestore ${collectionName}/${docId}: ${e.message}`); }
      };

      // Reviews (given / received / profile doc with fruits+bio)
      await deleteQueryDocs('reviews', 'fromUserId', uid);
      await deleteQueryDocs('reviews', 'toUserId', uid);
      await deleteSingleDoc('reviews', uid);

      // Profile + summary docs
      await deleteSingleDoc('user_ratings_summary', uid);
      await deleteSingleDoc('user_profiles', uid);
      await deleteSingleDoc('game_stats', uid);
      await deleteSingleDoc('cosmetics_inventory', uid);

      // Trades
      await deleteQueryDocs('trades_new_upgrade', 'userId', uid);

      // Following (both directions)
      await deleteQueryDocs('following', 'followerId', uid);
      await deleteQueryDocs('following', 'followingId', uid);

      // Notifications (this app keys by toUid/fromUid)
      await deleteQueryDocs('notifications', 'toUid', uid);
      await deleteQueryDocs('notifications', 'fromUid', uid);

      // Feed posts
      await deleteQueryDocs('designPosts_upgrade', 'userId', uid);

      // Group invitations + join requests
      await deleteQueryDocs('group_invitations', 'invitedUserId', uid);
      await deleteQueryDocs('group_invitations', 'invitedBy', uid);
      await deleteQueryDocs('group_join_requests', 'userId', uid);

      setDeletingUser(false);

      if (errors.length > 0) {
        console.warn('[DeleteUser] Partial errors:', errors);
        Alert.alert(
          'Deletion Complete (with warnings)',
          `User data for "${targetName}" has been deleted.\n\n${errors.length} non-critical error(s) occurred. Check console for details.`
        );
      } else {
        Alert.alert('✅ User Deleted', `All data for "${targetName}" has been permanently removed.`);
      }

      toggleModal();
    } catch (e) {
      setDeletingUser(false);
      if (e?.message) {
        console.error('[DeleteUser] Error:', e);
        Alert.alert('Error', `Failed to delete user data: ${e.message}`);
      }
    }
  }, [selectedUserId, firestoreDB, appdatabase, isAdmin, mergedUser, selectedUser, toggleModal]);

  // ✅ Check if current user is following this user (Firestore)
  useEffect(() => {
    if (!user?.id || !selectedUserId || !firestoreDB || user.id === selectedUserId) {
      setIsFollowing(false);
      return;
    }

    const checkFollowStatus = async () => {
      try {
        const followSnapshot = await getDocs(
          query(
            collection(firestoreDB, 'following'),
            where('followerId', '==', user.id),
            where('followingId', '==', selectedUserId)
          )
        );
        setIsFollowing(!followSnapshot.empty);
      } catch (err) {
        console.error('Error checking follow status:', err);
        setIsFollowing(false);
      }
    };

    checkFollowStatus();
  }, [user?.id, selectedUserId, firestoreDB]);

  // ✅ Follow / Unfollow toggle (Firestore)
  const handleFollowToggle = useCallback(async () => {
    if (!user?.id || !selectedUserId || !firestoreDB || user.id === selectedUserId) return;

    setFollowLoading(true);
    try {
      if (isFollowing) {
        const followSnapshot = await getDocs(
          query(
            collection(firestoreDB, 'following'),
            where('followerId', '==', user.id),
            where('followingId', '==', selectedUserId)
          )
        );

        if (!followSnapshot.empty) {
          const batch = firestoreDB.batch ? firestoreDB.batch() : null;
          if (batch) {
            followSnapshot.docs.forEach(docSnap => batch.delete(docSnap.ref));
            await batch.commit();
          } else {
            await Promise.all(followSnapshot.docs.map(docSnap =>
              deleteDoc(doc(firestoreDB, 'following', docSnap.id))
            ));
          }
        }
        setIsFollowing(false);
        setFollowersCount(prev => Math.max(0, prev - 1));
        triggerHapticFeedback('impactLight');
        onFollowChange?.(selectedUserId, false);
      } else {
        await setDoc(doc(collection(firestoreDB, 'following')), {
          followerId: user.id,
          followingId: selectedUserId,
          createdAt: serverTimestamp(),
        });
        setIsFollowing(true);
        setFollowersCount(prev => prev + 1);
        triggerHapticFeedback('notificationSuccess');
        onFollowChange?.(selectedUserId, true);
      }
    } catch (err) {
      console.error('Error toggling follow:', err);
      Alert.alert(t('chat.error'), t('chat.follow_error'));
    } finally {
      setFollowLoading(false);
    }
  }, [user?.id, selectedUserId, firestoreDB, isFollowing, triggerHapticFeedback]);

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
      setFollowersCount(0);
      setOwnedPets([]);
      setWishlistPets([]);
      setReviews([]);
      setStarFilter(null);
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
      // Reset new state
      setSavedBadges({});
      setUserCreatedAtMs(0);
      setXpData({ total: 0, level: 1 });
      setActiveCosmetics({ profileFrame: null, chatTextColor: null });
      setPosts([]);
      setLastPostDoc(null);
      setHasMorePosts(false);
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
        const [reviewsSnap, createdSnap, rewardPointsSnap, reviewDocSnap, countSnapshot] = await Promise.all([
          getDocs(reviewsQuery),
          get(ref(appdatabase, `users/${selectedUserId}/createdAt`)),
          get(ref(appdatabase, `users/${selectedUserId}/rewardPoints`)),
          getDoc(doc(firestoreDB, 'reviews', selectedUserId)), // ✅ Load bio from Firestore
          getCountFromServer(query(collection(firestoreDB, 'following'), where('followingId', '==', selectedUserId))).catch(() => null),
        ]);

        if (!isMounted) return;

        // ✅ Set Follower Count
        if (countSnapshot && typeof countSnapshot.data === 'function') {
          setFollowersCount(countSnapshot.data().count || 0);
        }

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
        setUserBio(bioValue || t('chat.default_bio'));

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

  const loadReviews = useCallback(async (reset = false, ratingFilter = null) => {
    if (!firestoreDB || !selectedUserId) return;

    // ✅ Prevent duplicate calls using ref (avoids dependency issues)
    if (isLoadingRef.current) return;

    isLoadingRef.current = true;
    setLoadingReviews(true);
    try {
      // ✅ Use larger page size when a star filter is active
      const pageSize = ratingFilter ? FILTERED_REVIEWS_PAGE_SIZE : REVIEWS_PAGE_SIZE;

      // ✅ Build query constraints based on filter
      const constraints = [
        collection(firestoreDB, 'reviews'),
        where('toUserId', '==', selectedUserId),
      ];

      // ⭐ Add rating filter if active
      if (ratingFilter) {
        constraints.push(where('rating', '==', ratingFilter));
      }

      constraints.push(orderBy('updatedAt', 'desc'));

      if (!reset && lastReviewDocRef.current) {
        constraints.push(startAfter(lastReviewDocRef.current));
      }

      constraints.push(limit(pageSize + 1)); // Fetch one extra to check if more exist

      const q = query(...constraints);
      const snap = await getDocs(q);

      // ✅ Check if we got more than page size (means there are more reviews)
      const hasMoreResults = snap.docs.length > pageSize;
      const docsToUse = snap.docs.slice(0, pageSize);

      const batch = docsToUse.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      setReviews((prev) => (reset ? batch : [...prev, ...batch]));

      const newLastDoc = docsToUse[docsToUse.length - 1] || null;
      lastReviewDocRef.current = newLastDoc;
      setLastReviewDoc(newLastDoc);
      setHasMoreReviews(hasMoreResults);
    } catch (err) {
      console.error('Reviews load error:', err);
      // If composite index is missing, Firestore throws failed-precondition
      // You need to create a composite index: reviews (toUserId ASC, rating ASC, updatedAt DESC)
      if (err?.code === 'failed-precondition') {
        console.error('⚠️ Firestore composite index required for reviews: toUserId + rating + updatedAt. Check the error message for the creation link.');
      }
      if (reset) setReviews([]);
      setHasMoreReviews(false);
    } finally {
      isLoadingRef.current = false;
      setLoadingReviews(false);
    }
  }, [firestoreDB, selectedUserId]);

  // initial reviews load when opening details
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;
    // reset pagination when details open
    lastReviewDocRef.current = null;
    setLastReviewDoc(null);
    setHasMoreReviews(false);
    setStarFilter(null); // Reset filter when opening new profile
    loadReviews(true, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, selectedUserId, loadDetails]);

  // ⭐ Re-fetch reviews when star filter changes
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;
    lastReviewDocRef.current = null;
    setLastReviewDoc(null);
    setHasMoreReviews(false);
    setReviews([]);
    loadReviews(true, starFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starFilter]);

  // ✅ Memoize handleLoadMoreReviews
  const handleLoadMoreReviews = useCallback(() => {
    if (!hasMoreReviews || loadingReviews) return;
    loadReviews(false, starFilter);
  }, [hasMoreReviews, loadingReviews, loadReviews, starFilter]);

  // ─────────────────────────────────────────────
  // Delete review (admin/mod only)
  const handleDeleteReview = useCallback(async (review) => {
    if (!review?.id || !selectedUserId) return;

    // Moderators cannot delete reviews from other mods/admins
    if (!isAdmin && isGlobalModerator && review.fromUserId) {
      try {
        const reviewerSnap = await get(ref(appdatabase, `users/${review.fromUserId}`));
        if (reviewerSnap.exists()) {
          const reviewerData = reviewerSnap.val();
          if (reviewerData?.isModerator || reviewerData?.admin) {
            Alert.alert('Restricted', 'Moderators cannot delete reviews from other moderators or admins.');
            return;
          }
        }
      } catch (err) {
        console.warn('Error checking reviewer status:', err);
      }
    }

    Alert.alert(
      'Delete Review',
      `Delete this review${review.userName ? ` by ${review.userName}` : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const reviewRef = doc(firestoreDB, 'reviews', review.id);
              const ratingToRemove = Number(review?.rating) || 0;

              await deleteDoc(reviewRef);

              // Update ratings summary
              const summaryRef = doc(firestoreDB, 'user_ratings_summary', selectedUserId);
              const summarySnap = await getDoc(summaryRef);

              if (summarySnap.exists()) {
                const s = summarySnap.data();
                const oldAvg = s?.averageRating || 0;
                const oldCount = s?.count || 0;

                if (oldCount <= 1) {
                  await setDoc(summaryRef, { averageRating: 0, count: 0 }, { merge: true });
                } else {
                  const newCount = oldCount - 1;
                  const newAvg = ((oldAvg * oldCount) - ratingToRemove) / newCount;
                  await setDoc(summaryRef, {
                    averageRating: parseFloat(newAvg.toFixed(2)),
                    count: newCount,
                  }, { merge: true });
                }
              }

              setReviews(prev => prev.filter(r => r.id !== review.id));
            } catch (err) {
              console.warn('Delete review error:', err);
              Alert.alert('Error', 'Could not delete review.');
            }
          },
        },
      ]
    );
  }, [selectedUserId, isAdmin, isGlobalModerator, appdatabase, firestoreDB]);

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
          collection(firestoreDB, 'trades_new_upgrade'),
          where('userId', '==', selectedUserId),
          orderBy('timestamp', 'desc'),
          startAfter(lastTradeDoc),
          limit(limitSize + 1), // Fetch one extra to check if more exist
        );
      } else {
        q = query(
          collection(firestoreDB, 'trades_new_upgrade'),
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
  // Load posts (paged)
  const loadPosts = useCallback(async (reset = false) => {
    if (!firestoreDB || !selectedUserId) return;
    if (loadingPosts) return;

    setLoadingPosts(true);
    try {
      const limitSize = POSTS_PAGE_SIZE;
      let q;
      if (!reset && lastPostDoc) {
        q = query(
          collection(firestoreDB, 'designPosts_upgrade'),
          where('userId', '==', selectedUserId),
          orderBy('createdAt', 'desc'),
          startAfter(lastPostDoc),
          limit(limitSize + 1),
        );
      } else {
        q = query(
          collection(firestoreDB, 'designPosts_upgrade'),
          where('userId', '==', selectedUserId),
          orderBy('createdAt', 'desc'),
          limit(limitSize + 1),
        );
      }

      const snap = await getDocs(q);
      const hasMoreResults = snap.docs.length > limitSize;
      const docsToUse = snap.docs.slice(0, limitSize);

      const batch = docsToUse.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      setPosts((prev) => (reset ? batch : [...prev, ...batch]));
      const newLastDoc = docsToUse[docsToUse.length - 1] || null;
      setLastPostDoc(newLastDoc);
      setHasMorePosts(hasMoreResults);
    } catch (err) {
      console.error('Posts load error:', err);
      if (reset) setPosts([]);
      setHasMorePosts(false);
    } finally {
      setLoadingPosts(false);
    }
  }, [firestoreDB, selectedUserId, lastPostDoc, loadingPosts]);

  // Initial posts load when opening details
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;
    setLastPostDoc(null);
    setHasMorePosts(false);
    loadPosts(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, selectedUserId, loadDetails]);

  const handleLoadMorePosts = useCallback(() => {
    if (!hasMorePosts || loadingPosts) return;
    loadPosts(false);
  }, [hasMorePosts, loadingPosts, loadPosts]);

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
    if (!pet || typeof pet !== 'object' || !pet.name) return null;

    const valueType = (pet.valueType || pet.type || 'n').toLowerCase();
    const imageUrl = `https://bloxfruitscalc.com/wp-content/uploads/2024/${valueType === 'n' ? '09' : '08'}/${formatName(pet.name)}_Icon.webp`;

    // Rarity colors
    let rarityBg = '#2ecc71'; // Normal green
    let rarityLabel = 'N';
    if (valueType === 'p') { rarityBg = '#FFCC00'; rarityLabel = 'P'; }
    if (valueType === 'm') { rarityBg = '#9b59b6'; rarityLabel = 'M'; }

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
        {/* Rarity badge */}
        <View
          style={{
            position: 'absolute',
            right: 1,
            bottom: 1,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <View
            style={{
              paddingHorizontal: 3,
              paddingVertical: 1,
              borderRadius: 999,
              backgroundColor: rarityBg,
            }}
          >
            <Text style={{ fontSize: 7, fontWeight: '700', color: '#fff' }}>
              {rarityLabel}
            </Text>
          </View>
        </View>
      </View>
    );
  }, [isDarkMode]);

  // ✅ Value lookup for portfolio
  const lookupPetValue = useCallback((pet) => {
    if (!pet?.name) return Number(pet?.value) || 0;
    return Number(pet?.value) || 0;
  }, []);

  // ✅ Render trade item
  const renderTradeItem = useCallback((trade) => {
    const { deal, tradeRatio } = getTradeDeal(trade.hasTotal, trade.wantsTotal);
    const tradePercentage = Math.abs(((tradeRatio - 1) * 100).toFixed(0));
    const isProfit = tradeRatio > 1;
    const neutral = tradeRatio === 1;
    const formattedTime = trade.timestamp ? dayjs(trade.timestamp.toDate()).fromNow() : t('chat.unknown_time');

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

  // ✅ Render post item
  const renderPostItem = useCallback((post) => {
    const timeLabel = post.createdAt ? dayjs(post.createdAt.toDate ? post.createdAt.toDate() : post.createdAt).fromNow() : t('chat.just_now');
    const images = Array.isArray(post.imageUrl) ? post.imageUrl : (post.imageUrl ? [post.imageUrl] : []);
    const likeCount = post.likes ? Object.keys(post.likes).length : 0;
    const tags = Array.isArray(post.selectedTags) ? post.selectedTags : [];

    const getTagColor = (tag) => {
      switch ((tag || '').toLowerCase()) {
        case 'scam alert': return '#FF3B30';
        case 'looking for trade': return '#34C759';
        case 'discussion': return '#5AC8FA';
        case 'real or fake': return '#AF52DE';
        case 'need help': return '#FF9500';
        case 'misc': case 'misc.': return '#8E8E93';
        default: return config.colors.primary;
      }
    };

    return (
      <View
        key={post.id}
        style={{
          backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
          borderRadius: 12,
          marginBottom: 8,
          borderWidth: 1,
          borderColor: isDarkMode ? '#1e293b' : '#e5e7eb',
          overflow: 'hidden',
        }}
      >
        {images.length > 0 && (
          <Image
            source={{ uri: images[0] }}
            style={{ width: '100%', height: 140, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
            resizeMode="cover"
          />
        )}
        <View style={{ padding: 10 }}>
          {tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {tags.map((tag, idx) => (
                <View key={idx} style={{
                  paddingHorizontal: 7, paddingVertical: 2,
                  borderRadius: 999, backgroundColor: getTagColor(tag),
                }}>
                  <Text style={{ fontSize: 9, color: '#fff', fontWeight: '700' }}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
          {!!post.desc && (
            <Text
              style={{ fontSize: 12, lineHeight: 17, color: c.text, marginBottom: 6 }}
              numberOfLines={3}
            >
              {post.desc}
            </Text>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 10, color: c.textMuted }}>{timeLabel}</Text>
            {likeCount > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Icon name="heart" size={10} color="#EF4444" />
                <Text style={{ fontSize: 10, fontWeight: '600', color: c.textSecondary }}>{likeCount}</Text>
              </View>
            )}
            {post.commentCount > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Icon name="chatbubble-outline" size={10} color={c.textMuted} />
                <Text style={{ fontSize: 10, fontWeight: '600', color: c.textSecondary }}>{post.commentCount}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  }, [isDarkMode, c]);

  // Banner gradient from cosmetics
  const activeBannerGradient = activeCosmetics?.profileBanner?.gradient;
  const bannerColor = activeBannerGradient?.[0] || DEFAULT_BANNER[0];
  const bannerColorEnd = activeBannerGradient?.[2] || DEFAULT_BANNER[2];

  // ─────────────────────────────────────────────
  return (
    <>
    <Modal
      animationType="slide"
      transparent={true}
      visible={isVisible}
      onRequestClose={toggleModal}
    >
      {/* Overlay */}
      <Pressable style={styles.overlay} onPress={toggleModal} />

      {/* Drawer Content */}
      <View>
        <View style={[styles.drawer, { padding: 0, overflow: 'hidden' }]}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 480 }}
            contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
          >
            {/* ═══ GRADIENT BANNER ═══ */}
            <View style={{
              height: 90,
              backgroundColor: bannerColor,
              overflow: 'hidden',
              position: 'relative',
            }}>
              {/* Drag Handle */}
              <View style={{ alignItems: 'center', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.4)', marginTop: 8 }} />
              </View>

              {/* Decorative gradient circles */}
              <View style={{
                position: 'absolute', top: -20, right: -20,
                width: 80, height: 80, borderRadius: 40,
                backgroundColor: bannerColorEnd, opacity: 0.3,
              }} />
              <View style={{
                position: 'absolute', bottom: -15, left: 30,
                width: 50, height: 50, borderRadius: 25,
                backgroundColor: '#ffffff', opacity: 0.1,
              }} />
              <View style={{
                position: 'absolute', top: 10, left: -10,
                width: 60, height: 60, borderRadius: 30,
                backgroundColor: bannerColorEnd, opacity: 0.2,
              }} />

              {/* PRO badge on banner */}
              {mergedUser?.isPro && (
                <View style={{
                  position: 'absolute', top: 12, right: 14,
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  paddingHorizontal: 10, paddingVertical: 4,
                  borderRadius: 999,
                }}>
                  <Image source={require('../../../assets/pro.png')} style={{ width: 11, height: 11 }} />
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 }}>Pro</Text>
                </View>
              )}

              {/* Ban/Block icon on banner */}
              <TouchableOpacity onPress={handleBanToggle} style={{
                position: 'absolute', top: 12, left: 14,
                padding: 6, borderRadius: 999,
                backgroundColor: 'rgba(255,255,255,0.15)',
              }}>
                <Icon name={isBlock ? 'shield-checkmark-outline' : 'ban-outline'} size={16} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* ═══ CONTENT AREA (below banner) ═══ */}
            <View style={{ backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff', paddingHorizontal: 16, paddingBottom: 4 }}>

            {/* Avatar overlapping banner */}
            <View style={{ alignItems: 'center', marginTop: -36, zIndex: 10 }}>
              <View style={{ position: 'relative' }}>
                <FramedAvatar
                  avatarUri={avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
                  frame={activeCosmetics?.profileFrame}
                  isDarkMode={isDarkMode}
                  avatarSize={72}
                />
                {/* Online/Offline Indicator */}
                <View style={{
                  position: 'absolute', bottom: 2, right: 2,
                  width: 14, height: 14, borderRadius: 7,
                  backgroundColor: isOnline ? '#10B981' : '#9CA3AF',
                  borderWidth: 2.5,
                  borderColor: isDarkMode ? '#1e1e1e' : '#ffffff',
                  zIndex: 11,
                }} />
              </View>
            </View>

            {/* Username + badges centered below avatar */}
            <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text
                  style={[styles.drawerSubtitleUser, { flexShrink: 1, textAlign: 'center' }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {userName}{' '}
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
              {/* Role Badge Pills */}
              <RoleBadges userItem={mergedUser} style={{ alignSelf: 'center', marginTop: 4, marginBottom: 4 }} />

              {/* Roblox Badge */}
              {mergedUser?.robloxUsername ? (
                <View style={{
                  backgroundColor: mergedUser?.robloxUsernameVerified ? '#4CAF50' : '#FFA500',
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 4,
                  marginTop: 4,
                }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '600' }}>
                    {mergedUser?.robloxUsernameVerified ? '✓ Verified' : '⚠ Unverified'}
                  </Text>
                </View>
              ) : (
                <View style={{
                  backgroundColor: '#9CA3AF',
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 4,
                  marginTop: 4,
                }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '600' }}>
                    No Roblox ID
                  </Text>
                </View>
              )}

              {/* User ID (copyable) */}
              {selectedUserId && (
                <TouchableOpacity
                  onPress={() => copyToClipboard(selectedUserId)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                  activeOpacity={0.7}
                >
                  <Icon name="finger-print-outline" size={12} color={isDarkMode ? '#6b7280' : '#9ca3af'} />
                  <Text style={{
                    fontSize: 11,
                    color: isDarkMode ? '#6b7280' : '#9ca3af',
                    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                  }}>
                    {selectedUserId}
                  </Text>
                  <Icon name="copy-outline" size={11} color={isDarkMode ? '#6b7280' : '#9ca3af'} />
                </TouchableOpacity>
              )}
            </View>

            {/* ═══ STATS STRIP ═══ */}
            {loadDetails && !loadingRating && (
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                marginTop: 4, marginHorizontal: 0,
                paddingVertical: 10,
                borderTopWidth: 1, borderBottomWidth: 1,
                borderColor: isDarkMode ? '#1e293b' : '#f1f5f9',
              }}>
                {/* Rating */}
                {ratingSummary ? (
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: c.textMuted }}>Rating</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                      <Text style={{ fontSize: 12, color: '#fbbf24' }}>★</Text>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>{ratingSummary.value.toFixed(1)}</Text>
                      <Text style={{ fontSize: 10, fontWeight: '600', color: c.textMuted }}>({ratingSummary.count})</Text>
                    </View>
                  </View>
                ) : (
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: c.textMuted }}>Rating</Text>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: c.textMuted, marginTop: 3 }}>—</Text>
                  </View>
                )}
                {/* Followers */}
                <View style={{ flex: 1, alignItems: 'center', borderLeftWidth: 1, borderColor: c.border }}>
                  <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: c.textMuted }}>Followers</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                    <Icon name="people" size={12} color="#8b5cf6" />
                    <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>{followersCount || 0}</Text>
                  </View>
                </View>
                {/* XP */}
                {userPoints !== null && userPoints > 0 && (
                  <View style={{ flex: 1, alignItems: 'center', borderLeftWidth: 1, borderColor: c.border }}>
                    <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: c.textMuted }}>XP</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                      <Text style={{ fontSize: 12 }}>⚡</Text>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>{Number(userPoints).toLocaleString()}</Text>
                    </View>
                  </View>
                )}
                {/* Wins */}
                {gameWins !== null && gameWins > 0 && (
                  <View style={{ flex: 1, alignItems: 'center', borderLeftWidth: 1, borderColor: c.border }}>
                    <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: c.textMuted }}>Wins</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                      <Text style={{ fontSize: 12 }}>🏆</Text>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>{gameWins}</Text>
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* Joined date */}
            {createdAtText && (
              <View style={{ alignItems: 'center', marginTop: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="calendar-outline" size={11} color={c.textMuted} />
                  <Text style={{ fontSize: 10, color: c.textMuted, fontWeight: '500' }}>
                    Joined {createdAtText}
                  </Text>
                </View>
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
                  {t('chat.bio')}
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    color: isDarkMode ? '#e5e7eb' : '#111827',
                    lineHeight: 18,
                  }}
                >
                  {userBio || t('chat.default_bio')}
                </Text>
              </View>
            )}

            {/* 🏅 Badge Showcase */}
            {loadDetails && (
              <View style={{ marginTop: 8 }}>
                <BadgeShowcase
                  isDarkMode={isDarkMode}
                  t={t}
                  earnedBadges={computeBadges({ createdAt: userCreatedAtMs }, savedBadges)}
                  activeFrame={activeCosmetics?.profileFrame?.id}
                  avatarUri={avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
                />
              </View>
            )}

            {/* ⭐ XP & Level Progress */}
            {loadDetails && (
              <View style={{ marginTop: 8 }}>
                <XPBar xp={xpData.total} isDarkMode={isDarkMode} />
              </View>
            )}

            {/* 🐾 Portfolio section (Compact) */}
            {loadDetails && (
              <View style={{ marginTop: 8 }}>
                <CompactPortfolio
                  ownedPets={ownedPets}
                  wishlistPets={wishlistPets}
                  isDarkMode={isDarkMode}
                  t={t}
                  loadingPets={loadingPets}
                  renderPetBubble={renderPetBubble}
                  lookupPetValue={lookupPetValue}
                />
              </View>
            )}



            {/* 📝 Reviews section */}
            {loadDetails && <View
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

              {/* ⭐ Star Filter Pills */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginBottom: 8 }}
                contentContainerStyle={{ gap: 6 }}
              >
                {STAR_OPTIONS.map((star) => {
                  const isActive = starFilter === star;
                  const label = star === null ? 'All' : `${star}★`;
                  return (
                    <TouchableOpacity
                      key={star === null ? 'all' : star}
                      onPress={() => setStarFilter(star)}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: 999,
                        borderWidth: 1,
                        backgroundColor: isActive
                          ? (isDarkMode ? 'rgba(251,191,36,0.2)' : 'rgba(251,191,36,0.15)')
                          : (isDarkMode ? '#1e293b' : '#fff'),
                        borderColor: isActive ? '#fbbf24' : (isDarkMode ? '#334155' : '#e2e8f0'),
                      }}
                    >
                      {star !== null && (
                        <Text style={{ fontSize: 10, color: isActive ? '#fbbf24' : (isDarkMode ? '#9ca3af' : '#6b7280') }}>
                          ★
                        </Text>
                      )}
                      <Text style={{
                        fontSize: 11,
                        fontWeight: isActive ? '700' : '600',
                        color: isActive
                          ? (isDarkMode ? '#fbbf24' : '#b45309')
                          : (isDarkMode ? '#9ca3af' : '#6b7280'),
                      }}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

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
                              {rev.userName || t('chat.anonymous')}
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
                            {(isAdmin || isGlobalModerator) && selectedUserId !== user?.id && (
                              <TouchableOpacity
                                onPress={() => handleDeleteReview(rev)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              >
                                <Icon name="trash-outline" size={14} color="#EF4444" />
                              </TouchableOpacity>
                            )}
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

            {/* 📸 Posts section */}
            {loadDetails && (
              <View style={{ marginTop: 8 }}>
                <ProfilePostsSection
                  isDarkMode={isDarkMode}
                  t={t}
                  posts={posts}
                  loadingPosts={loadingPosts}
                  hasMorePosts={hasMorePosts}
                  handleLoadMorePosts={handleLoadMorePosts}
                  renderPostItem={renderPostItem}
                />
              </View>
            )}

            {/* ═══ ACTION BUTTONS (Premium Pill Style) ═══ */}
            <View style={{ marginTop: 10, marginBottom: 10, paddingHorizontal: 0, gap: 7 }}>
              {/* Top row: Chat + Follow */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {/* Chat Action */}
                {!fromPvtChat && (
                  <TouchableOpacity
                    onPress={handleStartChat}
                    activeOpacity={0.85}
                    style={{
                      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      gap: 7, paddingVertical: 10, borderRadius: 12,
                      backgroundColor: bannerColor,
                      shadowColor: bannerColor, shadowOffset: { width: 0, height: 5 },
                      shadowOpacity: 0.35, shadowRadius: 10, elevation: 6,
                    }}
                  >
                    <View style={{
                      position: 'absolute', top: 1.5, left: 1.5, right: 1.5, bottom: 1.5,
                      borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
                    }} />
                    <Icon name="chatbubble" size={18} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                      {t('chat.start_chat')}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Follow/Unfollow Action */}
                {!fromPvtChat && user?.id !== selectedUserId && (
                  <TouchableOpacity
                    onPress={handleFollowToggle}
                    disabled={followLoading}
                    activeOpacity={0.85}
                    style={{
                      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      gap: 7, paddingVertical: 10, borderRadius: 12,
                      backgroundColor: isFollowing
                        ? (isDarkMode ? '#1e293b' : '#f1f5f9')
                        : (isDarkMode ? '#059669' : '#10b981'),
                      borderWidth: isFollowing ? 1.5 : 0,
                      borderColor: isFollowing ? c.border : 'transparent',
                      shadowColor: isFollowing ? (isDarkMode ? '#000' : '#94a3b8') : '#10b981',
                      shadowOffset: { width: 0, height: isFollowing ? 3 : 5 },
                      shadowOpacity: isFollowing ? 0.15 : 0.35,
                      shadowRadius: isFollowing ? 6 : 10,
                      elevation: isFollowing ? 3 : 6,
                    }}
                  >
                    {!isFollowing && (
                      <View style={{
                        position: 'absolute', top: 1.5, left: 1.5, right: 1.5, bottom: 1.5,
                        borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
                      }} />
                    )}
                    {followLoading ? (
                      <ActivityIndicator size="small" color={isFollowing ? c.textSecondary : '#fff'} />
                    ) : (
                      <>
                        <Icon
                          name={isFollowing ? 'person-remove' : 'person-add'}
                          size={18}
                          color={isFollowing ? c.textSecondary : '#fff'}
                        />
                        <Text style={{
                          fontSize: 13, fontWeight: '700',
                          color: isFollowing ? c.textSecondary : '#fff',
                        }}>
                          {isFollowing ? t('chat.unfollow') : t('chat.follow')}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>

              {/* Second row: Roblox + View Profile */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {/* Roblox Profile */}
                {mergedUser?.robloxUsername && (
                  <TouchableOpacity
                    onPress={handleOpenRobloxProfile}
                    activeOpacity={0.85}
                    style={{
                      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      gap: 7, paddingVertical: 9, borderRadius: 12,
                      backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
                      borderWidth: 1.5, borderColor: c.border,
                      shadowColor: isDarkMode ? '#000' : '#94a3b8',
                      shadowOffset: { width: 0, height: 3 },
                      shadowOpacity: 0.12, shadowRadius: 6, elevation: 3,
                    }}
                  >
                    <Icon name="game-controller" size={16} color={isDarkMode ? '#60a5fa' : '#2563eb'} />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: isDarkMode ? '#60a5fa' : '#2563eb' }}>Roblox</Text>
                  </TouchableOpacity>
                )}

                {/* View Profile */}
                {!loadDetails && (
                  <TouchableOpacity
                    onPress={() => setLoadDetails(true)}
                    activeOpacity={0.85}
                    style={{
                      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      gap: 7, paddingVertical: 9, borderRadius: 12,
                      backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
                      borderWidth: 1.5, borderColor: c.border,
                      shadowColor: isDarkMode ? '#000' : '#94a3b8',
                      shadowOffset: { width: 0, height: 3 },
                      shadowOpacity: 0.12, shadowRadius: 6, elevation: 3,
                    }}
                  >
                    <Icon name="person" size={16} color={isDarkMode ? '#e2e8f0' : '#475569'} />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: isDarkMode ? '#e2e8f0' : '#475569' }}>
                      View Detail Profile
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* ═══ MOD TOOLS (Collapsible Toggle) ═══ */}
            {/* Self-target guard: a JMD/mod must not see mod tools on their
                own profile — that's how the self-mute "reset" trick worked. */}
            {(isAdmin || isGlobalModerator || isGlobalBabyMod) && selectedUserId !== user?.id && (
              <View style={{ marginBottom: 8 }}>
                <TouchableOpacity
                  onPress={() => setShowModTools(prev => !prev)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    paddingVertical: 8, gap: 6,
                    backgroundColor: showModTools
                      ? (isDarkMode ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)')
                      : (isDarkMode ? 'rgba(100,116,139,0.15)' : 'rgba(100,116,139,0.08)'),
                    borderRadius: 10,
                  }}
                >
                  <Icon name={showModTools ? 'shield' : 'shield-outline'} size={16}
                    color={showModTools ? '#EF4444' : c.textSecondary} />
                  <Text style={{
                    fontSize: 12, fontWeight: '600',
                    color: showModTools ? '#EF4444' : c.textSecondary,
                  }}>
                    {showModTools ? t('chat.hide_mod_tools') : t('chat.mod_tools')}
                  </Text>
                </TouchableOpacity>

                {showModTools && (() => {
                  const isJMDOnly = isGlobalBabyMod && !isAdmin && !isGlobalModerator;
                  const modBg = isDarkMode ? '#1e293b' : '#f8fafc';
                  const modBorder = isDarkMode ? '#334155' : '#e2e8f0';
                  const dimColor = isDarkMode ? '#94a3b8' : '#64748b';

                  const Chip = ({ label, color = '#6366f1', onPress }) => (
                    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
                      style={{
                        paddingVertical: 6, paddingHorizontal: 11, borderRadius: 8,
                        backgroundColor: color + '18', borderWidth: 1, borderColor: color + '40',
                      }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color }}>{label}</Text>
                    </TouchableOpacity>
                  );

                  return (
                    <View style={{
                      marginTop: 8, backgroundColor: modBg, borderRadius: 14,
                      borderWidth: 1, borderColor: modBorder, padding: 14,
                    }}>
                      {/* Role Badge */}
                      <Text style={{
                        fontSize: 10, fontWeight: '700', color: dimColor,
                        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
                      }}>
                        {isAdmin ? 'Admin Tools' : isGlobalModerator ? 'Moderator Tools' : 'Junior Mod Tools'}
                      </Text>

                      {/* ── Section: Mute ── */}
                      <View style={{ marginBottom: 12 }}>
                        <Text style={{ fontSize: 10, color: dimColor, fontWeight: '600', marginBottom: 6 }}>
                          Mute{isJMDOnly ? ' (max 2h)' : ''}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                          {(isJMDOnly ? [5, 10, 20, 30, 60, 120] : [5, 10, 20, 30, 60, 1440]).map(m => (
                            <Chip
                              key={m}
                              label={m >= 1440 ? '1 day' : m >= 60 ? `${m / 60}h` : `${m}m`}
                              color="#7c3aed"
                              onPress={() => handleMuteUser(m)}
                            />
                          ))}
                        </View>
                      </View>

                      {/* ── Section: Strikes (Admin & Mod only) ── */}
                      {!isJMDOnly && (
                        <View style={{ marginBottom: 12 }}>
                          <Text style={{ fontSize: 10, color: dimColor, fontWeight: '600', marginBottom: 6 }}>Strikes</Text>
                          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                            <Chip label={`${t('chat.strike_1')} (3h)`} color="#f97316" onPress={() => handleSetStrike(1)} />
                            <Chip label={`${t('chat.strike_2')} (3d)`} color="#ef4444" onPress={() => handleSetStrike(2)} />
                            <Chip label={`${t('chat.strike_3')} (Perm)`} color="#dc2626" onPress={() => handleSetStrike(3)} />
                          </View>
                        </View>
                      )}

                      {/* ── Divider ── */}
                      {!isJMDOnly && (
                        <View style={{ height: 1, backgroundColor: modBorder, marginBottom: 12 }} />
                      )}

                      {/* ── Section: Unban ── */}
                      {!isJMDOnly && isBanned && (
                        <View style={{ marginBottom: 12 }}>
                          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                            <Chip label={t('chat.unban_user_btn') || 'Unban'} color="#10b981" onPress={handleUnbanUser} />
                          </View>
                        </View>
                      )}

                      {/* ── Section: Role Management (Admin & Mod only, not JMD) ── */}
                      {!isJMDOnly && (
                        <View>
                          <Text style={{ fontSize: 10, color: dimColor, fontWeight: '600', marginBottom: 6 }}>Manage Roles</Text>
                          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                            {/* Make/Remove Mod - Admin Only */}
                            {isAdmin && (
                              <Chip
                                label={mergedUser?.isModerator ? t('chat.remove_mod_btn') || 'Remove Mod' : t('chat.make_mod') || 'Make Mod'}
                                color={mergedUser?.isModerator ? '#f59e0b' : '#3b82f6'}
                                onPress={mergedUser?.isModerator ? handleDemoteModerator : handlePromoteModerator}
                              />
                            )}
                            {/* Make/Remove JMD - Admin & Mod */}
                            <Chip
                              label={mergedUser?.isBabyMod ? 'Remove JMD' : 'Make JMD'}
                              color={mergedUser?.isBabyMod ? '#f59e0b' : '#3b82f6'}
                              onPress={mergedUser?.isBabyMod ? handleRemoveJMD : handleMakeJMD}
                            />
                            {/* Make/Remove Trusted - Admin & Mod */}
                            <Chip
                              label={mergedUser?.isTrusted ? 'Remove Trusted' : 'Make Trusted'}
                              color={mergedUser?.isTrusted ? '#f59e0b' : '#10b981'}
                              onPress={mergedUser?.isTrusted ? handleRemoveTrusted : handleMakeTrusted}
                            />
                            {/* Make/Remove Grinder - Admin & Mod */}
                            <Chip
                              label={mergedUser?.isGrinder ? 'Remove Grinder' : 'Make Grinder'}
                              color={mergedUser?.isGrinder ? '#f59e0b' : '#06B6D4'}
                              onPress={mergedUser?.isGrinder ? handleRemoveGrinder : handleMakeGrinder}
                            />
                            {/* Make/Remove Raider - Admin & Mod */}
                            <Chip
                              label={mergedUser?.isRaider ? 'Remove Raider' : 'Make Raider'}
                              color={mergedUser?.isRaider ? '#f59e0b' : '#DC2626'}
                              onPress={mergedUser?.isRaider ? handleRemoveRaider : handleMakeRaider}
                            />
                          </View>
                        </View>
                      )}

                      {/* ── Section: Danger Zone (Admin only) ── */}
                      {isAdmin && (
                        <View style={{ marginTop: 12 }}>
                          <View style={{ height: 1, backgroundColor: modBorder, marginBottom: 12 }} />
                          <Text style={{ fontSize: 10, color: '#dc2626', fontWeight: '700', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
                            Danger Zone
                          </Text>
                          <TouchableOpacity
                            onPress={handleDeleteUserData}
                            disabled={deletingUser}
                            activeOpacity={0.7}
                            style={{
                              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                              paddingVertical: 10, borderRadius: 10,
                              backgroundColor: '#dc262618',
                              borderWidth: 1, borderColor: '#dc262650',
                              opacity: deletingUser ? 0.6 : 1,
                            }}
                          >
                            {deletingUser ? (
                              <ActivityIndicator size="small" color="#dc2626" />
                            ) : (
                              <Icon name="trash" size={14} color="#dc2626" />
                            )}
                            <Text style={{ fontSize: 12, fontWeight: '700', color: '#dc2626' }}>
                              {deletingUser ? 'Deleting all data…' : 'Delete Profile (ALL DATA)'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })()}
              </View>
            )}

            </View>{/* end CONTENT AREA */}
          </ScrollView>
        </View>
      </View>
    </Modal>

    {/* ═══ Admin Reason Modal - standalone, shown after profile drawer closes ═══ */}
    <Modal visible={showReasonModal} transparent animationType="fade" onRequestClose={() => setShowReasonModal(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable onPress={() => setShowReasonModal(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', backgroundColor: isDarkMode ? '#1e293b' : '#ffffff', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: isDarkMode ? '#334155' : '#e2e8f0' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 10 }}>
              {reasonActionType?.type === 'strike' && `Apply Strike ${reasonActionType.value}`}
              {reasonActionType?.type === 'mute' && `Mute User for ${reasonActionType.value >= 1440 ? '1 day' : reasonActionType.value >= 60 ? `${reasonActionType.value / 60}h` : `${reasonActionType.value}m`}`}
            </Text>
            <Text style={{ fontSize: 12, color: isDarkMode ? '#94a3b8' : '#64748b', marginBottom: 15 }}>
              Please provide a reason for this action (optional). This will be visible in the Admin Dashboard.
            </Text>
            <TextInput
              style={{
                backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc',
                color: c.text,
                borderRadius: 10,
                padding: 12,
                minHeight: 80,
                borderWidth: 1,
                borderColor: isDarkMode ? '#334155' : '#e2e8f0',
                textAlignVertical: 'top',
                fontSize: 14,
              }}
              placeholder="e.g. Scammer, inappropriate language, spamming..."
              placeholderTextColor={isDarkMode ? '#475569' : '#94a3b8'}
              multiline
              value={adminReason}
              onChangeText={setAdminReason}
              autoFocus
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <TouchableOpacity
                onPress={() => { setShowReasonModal(false); setReasonActionType(null); }}
                style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: isDarkMode ? '#334155' : '#e2e8f0' }}
              >
                <Text style={{ color: c.text, fontWeight: '600' }}>{t('chat.cancel') || 'Cancel'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmAdminAction}
                style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#ef4444' }}
              >
                <Text style={{ color: '#fff', fontWeight: '600' }}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
    </>
  );
};

export default ProfileBottomDrawer;
