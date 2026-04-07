// ✅ FIX ALL (AdminDashboard) — makes Reviews + Dates + Rating Summary ALWAYS correct
// WHAT THIS FIXES:
// 1) "Invalid Date" -> Firestore Timestamp / {_seconds} / {seconds} / number / string all supported
// 2) "No comment" -> uses real saved field: review (fallback comment/text)
// 3) Rating shows 0.0 (0 reviews) even when reviews exist ->
//    - tries Firestore summary user_ratings_summary/{userId}
//    - if missing OR count=0 -> computes rating+count directly from reviews as fallback
// 4) "5 star always" -> removes `|| 5` bug and parses rating as number safely
//
// Drop-in replace your AdminDashboard file with this one.

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Alert,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  RefreshControl,
  Image,
  Modal,
  ScrollView,
  Keyboard,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getDatabase,
  ref,
  get,
  query,
  orderByChild,
  startAt,
  endAt,
  limitToFirst,
  limitToLast,
  onValue,
} from '@react-native-firebase/database';

import {
  getFirestore,
  collection,
  getDocs,
  query as firestoreQuery,
  where,
  orderBy,
  limit,
  startAfter,
  doc,
  getDoc,
  deleteDoc,
  setDoc,
  addDoc,
  Timestamp,
  updateDoc,
} from '@react-native-firebase/firestore';

import { unbanUserWithEmail, banUserwithEmail, setUserStrike, muteUser } from '../ChatScreen/utils';
import { useGlobalState } from '../GlobelStats';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import { Image as CompressorImage } from 'react-native-compressor';

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

const base64ToBytes = (base64) => {
  if (!base64 || typeof base64 !== 'string') throw new Error('Invalid base64 input');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = base64.replace(/[\r\n]+/g, '');
  let output = [];
  let i = 0;
  while (i < str.length) {
    const enc1 = chars.indexOf(str.charAt(i++));
    const enc2 = chars.indexOf(str.charAt(i++));
    const enc3 = chars.indexOf(str.charAt(i++));
    const enc4 = chars.indexOf(str.charAt(i++));
    if (enc1 === -1 || enc2 === -1 || enc3 === -1 || enc4 === -1) throw new Error('Invalid base64 character');
    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;
    if (enc3 !== 64) output.push(chr1, chr2);
    else output.push(chr1);
    if (enc4 !== 64 && enc3 !== 64) output.push(chr3);
  }
  return Uint8Array.from(output);
};

const decodeEmail = (encoded) => (encoded ? encoded.replace(/\(dot\)/g, '.') : '');
const BAD_KEYS = new Set(['undefined', 'onloaduser', '', null, undefined]);
const DEFAULT_AVATAR = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';

// ✅ Sanitize search query — strip chars invalid in Firebase RTDB queries
const sanitizeSearchQuery = (q) => q.replace(/[.#$\[\]\/\\]/g, '');

// ✅ Timestamp/date helpers (Fix "Invalid Date")
const toMillisSafe = (v) => {
  if (!v) return null;

  // Firestore Timestamp instance
  if (typeof v?.toMillis === 'function') return v.toMillis();

  // Firestore Timestamp-like plain object
  const seconds = v?.seconds ?? v?._seconds;
  const nanos = v?.nanoseconds ?? v?._nanoseconds ?? 0;
  if (typeof seconds === 'number') {
    return Math.round(seconds * 1000 + nanos / 1e6);
  }

  // millis number
  if (typeof v === 'number') return v;

  // string date
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }

  return null;
};

const formatDateSafe = (v) => {
  const ms = toMillisSafe(v);
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleDateString();
  } catch {
    return '';
  }
};

const parseRatingSafe = (r) => {
  const n = typeof r === 'number' ? r : Number(r);
  if (Number.isNaN(n)) return 0;
  return n;
};

const getAvatarSafe = (obj) => obj?.avatar || DEFAULT_AVATAR;

const AdminDashboard = () => {
  const { theme, user: currentUser, isAdmin, isModerator } = useGlobalState();
  const isDark = theme === 'dark';
  const db = useMemo(() => getDatabase(), []);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  // Tabs
  const [activeTab, setActiveTab] = useState('banned');

  // Banned Data — single fetch, client-side filtering
  const [allBannedUsers, setAllBannedUsers] = useState([]); // full list
  const [loadingBanned, setLoadingBanned] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bannedSearchQuery, setBannedSearchQuery] = useState('');
  const [strikeFilter, setStrikeFilter] = useState('all'); // 'all' | '1' | '2' | '3+'

  // Ban Summary Stats (computed from allBannedUsers)
  const [banSummary, setBanSummary] = useState(null); // { total, byMod: { modName: count } }
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  // ─────────────────────────────────────────────
  // Helper: check if a string looks like a Firebase user ID (not a display name)
  const looksLikeUserId = (val) => {
    if (!val || typeof val !== 'string') return false;
    return val.length >= 15 && /^[a-zA-Z0-9]+$/.test(val);
  };

  // ─────────────────────────────────────────────
  // Fetch ALL banned users once — builds list + summary in one pass
  const fetchAllBanned = useCallback(async () => {
    if (loadingBanned) return;
    setLoadingBanned(true);
    try {
      const bannedRef = ref(db, 'banned_users_by_email');
      const snapshot = await get(bannedRef);

      if (!snapshot.exists()) {
        setAllBannedUsers([]);
        setBanSummary({ total: 0, byMod: {} });
        return;
      }

      const list = [];
      const now = Date.now();
      let total = 0;
      const byModId = {};
      const idsToResolve = new Set();

      snapshot.forEach((child) => {
        const encodedEmail = child.key;
        if (BAD_KEYS.has(encodedEmail)) return;
        const entry = child.val();
        const sc = entry?.strikeCount || 0;

        // Skip 0-strike entries (expired mutes)
        if (sc < 1) return;

        // Skip expired non-permanent bans
        const until = entry?.bannedUntil;
        if (until !== 'permanent' && typeof until === 'number' && until < now) return;

        const rawBannedBy = typeof entry?.bannedBy === 'string'
          ? entry.bannedBy
          : entry?.bannedBy?.displayName || 'Unknown';

        list.push({
          isBanned: true,
          email: decodeEmail(encodedEmail),
          encodedEmail,
          reason: entry?.reason ?? '—',
          strikeCount: sc,
          bannedUntil: until ?? null,
          displayName: entry?.displayName || 'Unknown',
          avatar: getAvatarSafe(entry),
          bannedBy: rawBannedBy,
          bannedAt: entry?.bannedAt ?? null,
          id: entry?.userId || null,
        });

        total++;
        byModId[rawBannedBy] = (byModId[rawBannedBy] || 0) + 1;
        if (looksLikeUserId(rawBannedBy)) {
          idsToResolve.add(rawBannedBy);
        }
      });

      // Sort by most recent first
      list.sort((a, b) => (b.bannedAt || 0) - (a.bannedAt || 0));

      // Batch-resolve mod IDs → display names
      const idToName = {};
      if (idsToResolve.size > 0) {
        const resolvePromises = [...idsToResolve].map(async (uid) => {
          try {
            const userSnap = await get(ref(db, `users/${uid}/displayName`));
            idToName[uid] = userSnap.exists() ? userSnap.val() : uid;
          } catch {
            idToName[uid] = uid;
          }
        });
        await Promise.all(resolvePromises);

        // Resolve IDs in the list items too
        list.forEach((item) => {
          if (idToName[item.bannedBy]) {
            item.bannedByName = idToName[item.bannedBy];
          }
        });
      }

      // Build summary with resolved names
      const byMod = {};
      for (const [key, count] of Object.entries(byModId)) {
        const displayName = idToName[key] || key;
        byMod[displayName] = (byMod[displayName] || 0) + count;
      }

      setAllBannedUsers(list);
      setBanSummary({ total, byMod });
    } catch (err) {
      console.error('Fetch banned error:', err);
    } finally {
      setLoadingBanned(false);
      setRefreshing(false);
    }
  }, [db, loadingBanned]);

  // Load once on mount
  useEffect(() => {
    fetchAllBanned();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchAllBanned();
  };

  // ─────────────────────────────────────────────
  // Client-side filtered + searched banned list
  const filteredBannedUsers = useMemo(() => {
    let list = allBannedUsers;

    // Apply strike filter
    if (strikeFilter === '1') {
      list = list.filter((u) => u.strikeCount === 1);
    } else if (strikeFilter === '2') {
      list = list.filter((u) => u.strikeCount === 2);
    } else if (strikeFilter === '3+') {
      list = list.filter((u) => u.strikeCount >= 3);
    }

    // Apply search (name + email)
    const q = bannedSearchQuery.trim().toLowerCase();
    if (q.length >= 1) {
      list = list.filter((u) => {
        const name = (u.displayName || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    }

    return list;
  }, [allBannedUsers, strikeFilter, bannedSearchQuery]);

  // Search Data (for the "Search DB" tab)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [userBanStatus, setUserBanStatus] = useState({});

  // Modal
  const [selectedUser, setSelectedUser] = useState(null);

  // User Details
  const [userDetails, setUserDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Reviews
  const [reviews, setReviews] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [hasMoreReviews, setHasMoreReviews] = useState(true);
  const [lastReviewKey, setLastReviewKey] = useState(null);

  // Strike History
  const [strikeHistory, setStrikeHistory] = useState([]);

  // Mute
  const [customMuteMinutes, setCustomMuteMinutes] = useState('');

  // Chat Viewer
  const [chatPerson1, setChatPerson1] = useState(null);
  const [chatPerson2, setChatPerson2] = useState(null);
  const [chatSearch1, setChatSearch1] = useState('');
  const [chatSearch2, setChatSearch2] = useState('');
  const [chatResults1, setChatResults1] = useState([]);
  const [chatResults2, setChatResults2] = useState([]);
  const [chatSearching1, setChatSearching1] = useState(false);
  const [chatSearching2, setChatSearching2] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [loadingChat, setLoadingChat] = useState(false);

  // Reported Chats (for mods — consent-based viewing)
  const [chatReports, setChatReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);

  // Polls Management
  const [polls, setPolls] = useState([]);
  const [loadingPolls, setLoadingPolls] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollImageUrl, setPollImageUrl] = useState('');
  const [creatingPoll, setCreatingPoll] = useState(false);
  const [uploadingPollImage, setUploadingPollImage] = useState(false);

  // ─────────────────────────────────────────────
  // Search Users (RTDB) — fool-proof: email, special chars, case-insensitive
  const handleSearch = async () => {
    const raw = searchQuery.trim();
    if (!raw) return;

    Keyboard.dismiss();
    setLoadingSearch(true);
    setHasSearched(true);
    setSearchResults([]);
    setUserBanStatus({});

    try {
      const results = [];
      const seen = new Set();
      const isEmailSearch = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) || raw.includes('(dot)');
      const isIdSearch = looksLikeUserId(raw);

      if (isIdSearch) {
        // ── ID SEARCH: direct lookup by Firebase user key ──
        const userRef = ref(db, `users/${raw}`);
        const userSnap = await get(userRef);
        if (userSnap.exists()) {
          const u = userSnap.val();
          const id = u.id || raw;
          seen.add(id);
          results.push({
            isBanned: false, id,
            displayName: u.displayName || u.userName || 'Unknown',
            email: u.email, avatar: getAvatarSafe(u),
            robloxUsername: u.robloxUsername,
            isAdmin: u.admin || false, isModerator: u.isModerator || false,
          });
        }
      } else if (isEmailSearch) {
        // ── EMAIL SEARCH: exact lookup by encoded key ──
        const email = raw.toLowerCase().trim();
        const encodedEmail = email.replace(/\./g, '(dot)');

        // Direct key lookup first (fastest)
        const directRef = ref(db, `users/${encodedEmail}`);
        const directSnap = await get(directRef);
        if (directSnap.exists()) {
          const u = directSnap.val();
          const id = u.id || encodedEmail;
          seen.add(id);
          results.push({
            isBanned: false, id,
            displayName: u.displayName || u.userName || 'Unknown',
            email: u.email, avatar: getAvatarSafe(u),
            robloxUsername: u.robloxUsername,
            isAdmin: u.admin || false, isModerator: u.isModerator || false,
          });
        }

        // Also search by email field (in case key is different)
        if (results.length === 0) {
          const emailQ = query(
            ref(db, 'users'),
            orderByChild('email'),
            startAt(email),
            endAt(email + '\uf8ff'),
            limitToFirst(10)
          );
          const emailSnap = await get(emailQ);
          if (emailSnap.exists()) {
            emailSnap.forEach((child) => {
              const u = child.val();
              if (BAD_KEYS.has(child.key)) return;
              const id = u.id || child.key;
              if (seen.has(id)) return;
              seen.add(id);
              results.push({
                isBanned: false, id,
                displayName: u.displayName || u.userName || 'Unknown',
                email: u.email, avatar: getAvatarSafe(u),
                robloxUsername: u.robloxUsername,
                isAdmin: u.admin || false, isModerator: u.isModerator || false,
              });
            });
          }
        }
      } else {
        // ── NAME SEARCH: multiple case variants + client-side filter ──
        const lower = raw.toLowerCase();
        const upperFirst = lower.charAt(0).toUpperCase() + lower.slice(1);
        const allUpper = raw.toUpperCase();

        // Deduplicated list of query variants for broader case coverage
        const variants = [...new Set([lower, upperFirst, allUpper, raw])];
        const limitSize = 50;

        for (const v of variants) {
          if (seen.size >= 50) break;
          try {
            const q = query(
              ref(db, 'users'),
              orderByChild('displayName'),
              startAt(v),
              endAt(v + '\uf8ff'),
              limitToFirst(limitSize)
            );
            const snapshot = await get(q);
            if (snapshot.exists()) {
              snapshot.forEach((child) => {
                const u = child.val();
                if (BAD_KEYS.has(child.key)) return;
                const id = u.id || child.key;
                if (seen.has(id)) return;
                seen.add(id);
                results.push({
                  isBanned: false, id,
                  displayName: u.displayName || u.userName || 'Unknown',
                  email: u.email, avatar: getAvatarSafe(u),
                  robloxUsername: u.robloxUsername,
                  isAdmin: u.admin || false, isModerator: u.isModerator || false,
                });
              });
            }
          } catch (variantErr) {
            console.warn(`Search variant "${v}" failed:`, variantErr.message);
          }
        }

        // ── FALLBACK: client-side contains match ──
        // Catches names with leading symbols like ★CoolPlayer★ or 🔥DragonKing
        if (results.length < 10 && lower.length >= 2) {
          try {
            const broadQ = query(ref(db, 'users'), orderByChild('displayName'), limitToFirst(500));
            const broadSnap = await get(broadQ);
            if (broadSnap.exists()) {
              broadSnap.forEach((child) => {
                if (seen.size >= 50) return;
                const u = child.val();
                if (BAD_KEYS.has(child.key)) return;
                const id = u.id || child.key;
                if (seen.has(id)) return;
                const name = (u.displayName || u.userName || '').toLowerCase();
                if (name.includes(lower)) {
                  seen.add(id);
                  results.push({
                    isBanned: false, id,
                    displayName: u.displayName || u.userName || 'Unknown',
                    email: u.email, avatar: getAvatarSafe(u),
                    robloxUsername: u.robloxUsername,
                    isAdmin: u.admin || false, isModerator: u.isModerator || false,
                  });
                }
              });
            }
          } catch (broadErr) {
            console.warn('Broad search failed:', broadErr.message);
          }
        }
      }

      setSearchResults(results.slice(0, 50));
    } catch (err) {
      console.error('Search error:', err);
      Alert.alert('Search Failed', err.message || 'An unexpected error occurred.');
    } finally {
      setLoadingSearch(false);
    }
  };

  // ✅ Check if a user is banned directly from Firebase
  const checkUserBanStatus = useCallback(async (email) => {
    if (!email || !db) return null;

    try {
      const encodeEmail = (em) => em.replace(/\./g, '(dot)');
      const encodedEmail = encodeEmail(email);
      const banRef = ref(db, `banned_users_by_email/${encodedEmail}`);
      const snapshot = await get(banRef);

      if (snapshot.exists()) {
        const banData = snapshot.val();
        return {
          isBanned: true,
          ...banData,
          email,
          encodedEmail,
        };
      }
      return null;
    } catch (err) {
      console.error('Error checking ban status:', err);
      return null;
    }
  }, [db]);

  // ─────────────────────────────────────────────
  // Actions
  const handleUnban = async (userItem) => {
    const email = userItem.email || decodeEmail(userItem.encodedEmail);
    if (!email) return;

    try {
      const success = await unbanUserWithEmail(email);
      if (success) {
        setSelectedUser(null);
        fetchAllBanned();
        if (activeTab === 'search') {
          setSearchResults((prev) => prev.map((u) => (u.email === email ? { ...u, isBanned: false } : u)));
          // ✅ Clear cached ban status for this user
          setUserBanStatus((prev) => {
            const updated = { ...prev };
            delete updated[email];
            return updated;
          });
        }
      }
    } catch (err) {
      Alert.alert('Error', 'Could not unban user.');
    }
  };

  const handleBan = async (userItem) => {
    if (!userItem.email) {
      Alert.alert('Error', 'User has no email associated.');
      return;
    }

    const userInfo = {
      id: userItem.id,
      displayName: userItem.displayName,
      avatar: userItem.avatar,
      email: userItem.email
    };

    const bannerInfo = {
      id: currentUser?.id,
      displayName: currentUser?.userName || 'Admin',
      avatar: currentUser?.avatar
    };

    const isStaff = isAdmin || isModerator;
    const success = await banUserwithEmail(userItem.email, isAdmin, userItem.id, userInfo, bannerInfo, isStaff, isStaff);
    if (success) {
      setSelectedUser(null);
      fetchAllBanned();
      setSearchResults((prev) => prev.map((u) => (u.email === userItem.email ? { ...u, isBanned: true } : u)));
      // ✅ Refresh cached ban status for this user
      checkUserBanStatus(userItem.email).then((banData) => {
        if (banData) {
          setUserBanStatus((prev) => ({
            ...prev,
            [userItem.email]: banData,
          }));
        }
      });
    }
  };

  const handleSetStrike = async (userItem, strikeCount) => {
    if (!userItem.email) {
      Alert.alert('Error', 'User has no email associated.');
      return;
    }

    const bannerInfo = {
      id: currentUser?.id,
      displayName: currentUser?.userName || currentUser?.displayName || 'Admin',
      avatar: currentUser?.avatar
    };
    const userInfo = {
      displayName: userItem.displayName || userItem.sender,
      avatar: userItem.avatar
    };

    // Both Admins and Moderators should see confirmation and success alerts
    const isStaff = isAdmin || isModerator;
    const success = await setUserStrike(userItem.email, strikeCount, userItem.id, isStaff, bannerInfo, userInfo, isStaff);
    if (success) {
      setSelectedUser(null);
      fetchAllBanned();
      if (activeTab === 'search') {
        setSearchResults((prev) => prev.map((u) => (u.email === userItem.email ? { ...u, isBanned: true } : u)));
        // ✅ Refresh cached ban status for this user
        checkUserBanStatus(userItem.email).then((banData) => {
          if (banData) {
            setUserBanStatus((prev) => ({
              ...prev,
              [userItem.email]: banData,
            }));
          }
        });
      }
    }
  };

  const handleMuteUser = async (userItem, minutes) => {
    if (!userItem.email) {
      Alert.alert('Error', 'User has no email associated.');
      return;
    }

    const bannerInfo = {
      id: currentUser?.id,
      displayName: currentUser?.userName || currentUser?.displayName || 'Admin',
      avatar: currentUser?.avatar
    };
    const userInfo = {
      id: userItem.id,
      displayName: userItem.displayName,
      avatar: userItem.avatar,
    };

    const success = await muteUser(userItem.email, minutes, userInfo, bannerInfo, true);
    if (success) {
      setSelectedUser(null);
      fetchAllBanned();
      if (activeTab === 'search') {
        setSearchResults((prev) => prev.map((u) => (u.email === userItem.email ? { ...u, isBanned: true } : u)));
        checkUserBanStatus(userItem.email).then((banData) => {
          if (banData) {
            setUserBanStatus((prev) => ({
              ...prev,
              [userItem.email]: banData,
            }));
          }
        });
      }
    }
  };

  // ─────────────────────────────────────────────
  // ✅ Fallback compute rating summary directly from reviews (Fix rating 0 issue)
  const computeSummaryFromReviews = useCallback(async (firestoreDB, userId) => {
    const reviewsRef = collection(firestoreDB, 'reviews');
    const q = firestoreQuery(reviewsRef, where('toUserId', '==', userId));
    const snap = await getDocs(q);

    let count = 0;
    let sum = 0;

    snap.docs.forEach((d) => {
      const data = d.data();
      const rating = parseRatingSafe(data?.rating);
      if (rating > 0) {
        count++;
        sum += rating;
      }
    });

    return { rating: count ? sum / count : 0, ratingCount: count };
  }, []);

  // ─────────────────────────────────────────────
  // Fetch User Details (RTDB basic + Firestore rating summary with fallback)
  const fetchUserDetails = useCallback(async (userId) => {
    if (!userId) return;
    setLoadingDetails(true);

    try {
      // RTDB: basic info
      const userRef = ref(db, `users/${userId}`);
      const userSnap = await get(userRef);
      const userData = userSnap.exists() ? userSnap.val() : null;

      // Firestore: summary
      const firestoreDB = getFirestore();
      const summaryRef = doc(firestoreDB, 'user_ratings_summary', userId);
      const summarySnap = await getDoc(summaryRef);

      let rating = 0;
      let ratingCount = 0;

      if (summarySnap.exists()) {
        const s = summarySnap.data();
        rating = parseRatingSafe(s?.averageRating);
        ratingCount = typeof s?.count === 'number' ? s.count : Number(s?.count) || 0;
      }

      // ✅ fallback if summary missing OR empty
      if (!summarySnap.exists() || ratingCount === 0) {
        const fallback = await computeSummaryFromReviews(firestoreDB, userId);
        rating = fallback.rating;
        ratingCount = fallback.ratingCount;
      }

      setUserDetails({
        createdAt: userData?.createdAt || null,
        isPro: userData?.isPro || false,
        rating,
        ratingCount,
        robloxUsername: userData?.robloxUsername || null,
      });
    } catch (err) {
      console.error('Error fetching user details:', err);
      setUserDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  }, [db, computeSummaryFromReviews]);

  // ─────────────────────────────────────────────
  // Fetch Reviews (Firestore) — ✅ fixed fields + ✅ fixed dates + ✅ fixed rating parsing
  const fetchReviews = useCallback(async (userId, reset = false) => {
    if (!userId) return;
    if (!reset && !hasMoreReviews) return;

    setLoadingReviews(true);
    try {
      const firestoreDB = getFirestore();
      const reviewsRef = collection(firestoreDB, 'reviews');
      const limitSize = 2;

      let q;
      if (reset) {
        setReviews([]);
        setLastReviewKey(null);
        setHasMoreReviews(true);

        q = firestoreQuery(
          reviewsRef,
          where('toUserId', '==', userId),
          orderBy('createdAt', 'desc'),
          limit(limitSize)
        );
      } else {
        if (!lastReviewKey) return;
        q = firestoreQuery(
          reviewsRef,
          where('toUserId', '==', userId),
          orderBy('createdAt', 'desc'),
          startAfter(lastReviewKey),
          limit(limitSize)
        );
      }

      const snap = await getDocs(q);

      if (snap.empty) {
        if (reset) setReviews([]);
        setHasMoreReviews(false);
        return;
      }

      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setLastReviewKey(snap.docs[snap.docs.length - 1]);
      setHasMoreReviews(snap.docs.length >= limitSize);

      setReviews((prev) => (reset ? list : [...prev, ...list]));
    } catch (err) {
      console.error('Error fetching reviews from Firestore:', err);
    } finally {
      setLoadingReviews(false);
    }
  }, [hasMoreReviews, lastReviewKey]);

  // ─────────────────────────────────────────────
  // Fetch Strike History
  const fetchStrikeHistory = useCallback(async (email) => {
    if (!email) return;
    try {
      const encodedEmail = email.replace(/\./g, '(dot)');
      const bannedRef = ref(db, `banned_users_by_email/${encodedEmail}`);
      const snapshot = await get(bannedRef);

      if (snapshot.exists()) {
        const data = snapshot.val();
        if (data.strikeCount) {
          // Resolve bannedBy: could be a user ID (new) or display name (old)
          let appliedByName = null;
          const rawBannedBy = typeof data.bannedBy === 'string' ? data.bannedBy : data.bannedBy?.displayName || null;

          if (rawBannedBy && looksLikeUserId(rawBannedBy)) {
            try {
              const modSnap = await get(ref(db, `users/${rawBannedBy}/displayName`));
              appliedByName = modSnap.exists() ? modSnap.val() : rawBannedBy;
            } catch {
              appliedByName = rawBannedBy;
            }
          } else {
            appliedByName = rawBannedBy;
          }

          setStrikeHistory([{
            id: 'current',
            strikeCount: data.strikeCount,
            reason: data.reason || '—',
            timestamp: data.bannedAt || null,
            appliedBy: appliedByName,
            bannedUntil: data.bannedUntil || null,
          }]);
        } else {
          setStrikeHistory([]);
        }
      } else {
        setStrikeHistory([]);
      }
    } catch {
      setStrikeHistory([]);
    }
  }, [db]);

  // ─────────────────────────────────────────────
  // Delete a Review (Admin can delete any, Mod cannot delete mod/admin reviews)
  const handleDeleteReview = useCallback(async (review) => {
    if (!review?.id || !selectedUser?.id) return;

    // If current user is a mod (not admin), check if the reviewer is also a mod/admin
    if (!isAdmin && isModerator && review.fromUserId) {
      try {
        const reviewerRef = ref(db, `users/${review.fromUserId}`);
        const reviewerSnap = await get(reviewerRef);
        if (reviewerSnap.exists()) {
          const reviewerData = reviewerSnap.val();
          if (reviewerData?.isModerator || reviewerData?.admin) {
            Alert.alert('Restricted', 'Moderators cannot delete reviews from other moderators or admins.');
            return;
          }
        }
      } catch (err) {
        console.error('Error checking reviewer status:', err);
      }
    }

    Alert.alert(
      'Delete Review',
      `Are you sure you want to delete this review${review.userName ? ` by ${review.userName}` : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const firestoreDB = getFirestore();
              const reviewRef = doc(firestoreDB, 'reviews', review.id);

              // Get the rating before deleting so we can update the summary
              const ratingToRemove = parseRatingSafe(review?.rating);

              // Delete the review document
              await deleteDoc(reviewRef);

              // Update the ratings summary
              const summaryRef = doc(firestoreDB, 'user_ratings_summary', selectedUser.id);
              const summarySnap = await getDoc(summaryRef);

              if (summarySnap.exists()) {
                const s = summarySnap.data();
                const oldAvg = s?.averageRating || 0;
                const oldCount = s?.count || 0;

                if (oldCount <= 1) {
                  // Last review — reset summary
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

              // Remove from local state
              setReviews((prev) => prev.filter((r) => r.id !== review.id));

              // Refresh user details to update displayed rating
              fetchUserDetails(selectedUser.id);

              Alert.alert('Deleted', 'Review has been removed.');
            } catch (err) {
              console.error('Delete review error:', err);
              Alert.alert('Error', 'Could not delete review.');
            }
          },
        },
      ]
    );
  }, [selectedUser, fetchUserDetails, isAdmin, isModerator, db]);

  const handleSelectUser = useCallback(async (userItem) => {
    setSelectedUser(userItem);
    setUserDetails(null);
    setReviews([]);
    setStrikeHistory([]);
    setHasMoreReviews(true);
    setLastReviewKey(null);

    if (userItem.id) {
      fetchUserDetails(userItem.id);
      fetchReviews(userItem.id, true);
    }
    if (userItem.email) {
      fetchStrikeHistory(userItem.email);
    }
  }, [fetchUserDetails, fetchReviews, fetchStrikeHistory]);

  // ─────────────────────────────────────────────
  // Chat Viewer — search users by displayName, email, or user ID
  const searchChatUser = useCallback(async (text, slot) => {
    const setSearching = slot === 1 ? setChatSearching1 : setChatSearching2;
    const setResults = slot === 1 ? setChatResults1 : setChatResults2;

    if (!text || text.trim().length < 1) {
      setResults([]);
      return;
    }

    setSearching(true);
    try {
      const raw = text.trim();
      const seen = new Set();
      const results = [];

      const addUser = (u) => {
        const id = u.id;
        if (!id || seen.has(id) || BAD_KEYS.has(id)) return;
        seen.add(id);
        results.push({
          id,
          displayName: u.displayName || u.userName || 'Unknown',
          avatar: getAvatarSafe(u),
          email: u.email,
          isAdmin: u.admin || false,
          isModerator: u.isModerator || false,
        });
      };

      const isIdSearch = looksLikeUserId(raw);
      const isEmailSearch = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) || raw.includes('(dot)');

      // 1. Direct ID lookup
      if (isIdSearch) {
        const snap = await get(ref(db, `users/${raw}`));
        if (snap.exists()) {
          const u = snap.val();
          addUser({ ...u, id: raw });
        }
      }

      // 2. Email search — look up in banned_users_by_email or scan users/email field
      if (isEmailSearch) {
        const encoded = raw.replace(/\./g, '(dot)');
        // Try banned_users_by_email for userId
        const banSnap = await get(ref(db, `banned_users_by_email/${encoded}/userId`));
        if (banSnap.exists()) {
          const uid = banSnap.val();
          const userSnap = await get(ref(db, `users/${uid}`));
          if (userSnap.exists()) addUser({ ...userSnap.val(), id: uid });
        }
        // Also search users by email field
        const emailQ = query(ref(db, 'users'), orderByChild('email'), startAt(raw), endAt(raw + '\uf8ff'), limitToFirst(5));
        const emailSnap = await get(emailQ);
        if (emailSnap.exists()) {
          Object.entries(emailSnap.val()).forEach(([uid, u]) => addUser({ ...u, id: uid }));
        }
      }

      // 3. DisplayName search (prefix match, case variants)
      if (!isIdSearch && !isEmailSearch) {
        const lower = sanitizeSearchQuery(raw.toLowerCase());
        if (lower) {
          const upperFirst = lower.charAt(0).toUpperCase() + lower.slice(1);
          const variants = lower === upperFirst ? [lower] : [lower, upperFirst];

          for (const v of variants) {
            const q = query(
              ref(db, 'users'),
              orderByChild('displayName'),
              startAt(v),
              endAt(v + '\uf8ff'),
              limitToFirst(10)
            );
            const snapshot = await get(q);
            if (snapshot.exists()) {
              Object.entries(snapshot.val()).forEach(([uid, u]) => addUser({ ...u, id: uid }));
            }
          }
        }
      }

      setResults(results.slice(0, 8));
    } catch (err) {
      console.error('Chat user search error:', err);
    } finally {
      setSearching(false);
    }
  }, [db]);

  // Load Private Chat between two selected users
  const loadChat = useCallback(async () => {
    if (!chatPerson1?.id || !chatPerson2?.id) {
      Alert.alert('Error', 'Please select both users first.');
      return;
    }
    if (chatPerson1.id === chatPerson2.id) {
      Alert.alert('Error', 'Please select two different users.');
      return;
    }

    Keyboard.dismiss();
    setLoadingChat(true);
    setChatMessages([]);

    try {
      const id1 = chatPerson1.id;
      const id2 = chatPerson2.id;
      const chatKey = id1 < id2 ? `${id1}_${id2}` : `${id2}_${id1}`;
      const messagesRef = ref(db, `private_messages/${chatKey}/messages`);
      const q = query(messagesRef, orderByChild('timestamp'), limitToLast(50));
      const snapshot = await get(q);

      if (!snapshot.exists()) {
        setChatMessages([]);
        setLoadingChat(false);
        return;
      }

      const data = snapshot.val();
      const msgs = Object.entries(data)
        .map(([key, value]) => ({ id: key, ...value }))
        .sort((a, b) => (a?.timestamp || 0) - (b?.timestamp || 0));

      setChatMessages(msgs);
    } catch (err) {
      console.error('Chat load error:', err);
      Alert.alert('Error', 'Could not load chat. Check selections and try again.');
    } finally {
      setLoadingChat(false);
    }
  }, [db, chatPerson1, chatPerson2]);

  // ─────────────────────────────────────────────
  // Reported Chats — fetch from Firestore (for mods)
  const fetchChatReports = useCallback(async () => {
    setLoadingReports(true);
    try {
      const firestoreDB = getFirestore();
      const reportsRef = collection(firestoreDB, 'chat_reports');
      const q = firestoreQuery(reportsRef, where('chatConsent', '==', true), orderBy('createdAt', 'desc'), limit(30));
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setChatReports(list);
    } catch (err) {
      console.error('Fetch chat reports error:', err);
    } finally {
      setLoadingReports(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'chatViewer' && !isAdmin && isModerator) fetchChatReports();
  }, [activeTab, isAdmin, isModerator, fetchChatReports]);

  // Load chat from a report (mod clicks a reported chat)
  const loadChatFromReport = useCallback(async (report) => {
    setSelectedReport(report);
    setLoadingChat(true);
    setChatMessages([]);
    // Set person info from the report
    setChatPerson1({ id: report.reportedBy, displayName: report.reporterName || report.reportedBy });
    setChatPerson2({ id: report.reportedUser, displayName: report.reportedUserName || report.reportedUser });

    try {
      const messagesRef = ref(db, `private_messages/${report.chatKey}/messages`);
      const q = query(messagesRef, orderByChild('timestamp'), limitToLast(50));
      const snapshot = await get(q);

      if (!snapshot.exists()) {
        setChatMessages([]);
        setLoadingChat(false);
        return;
      }

      const data = snapshot.val();
      const msgs = Object.entries(data)
        .map(([key, value]) => ({ id: key, ...value }))
        .sort((a, b) => (a?.timestamp || 0) - (b?.timestamp || 0));

      setChatMessages(msgs);
    } catch (err) {
      console.error('Chat load from report error:', err);
      Alert.alert('Error', 'Could not load reported chat.');
    } finally {
      setLoadingChat(false);
    }
  }, [db]);

  // Mark report as reviewed
  const markReportReviewed = useCallback(async (reportId) => {
    try {
      const firestoreDB = getFirestore();
      await updateDoc(doc(firestoreDB, 'chat_reports', reportId), { status: 'reviewed' });
      setChatReports(prev => prev.map(r => r.id === reportId ? { ...r, status: 'reviewed' } : r));
      Alert.alert('Done', 'Report marked as reviewed.');
    } catch (err) {
      console.error('Mark reviewed error:', err);
    }
  }, []);

  // Delete report
  const deleteChatReport = useCallback(async (reportId) => {
    Alert.alert('Delete Report', 'Are you sure you want to delete this report?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            const firestoreDB = getFirestore();
            await deleteDoc(doc(firestoreDB, 'chat_reports', reportId));
            setChatReports(prev => prev.filter(r => r.id !== reportId));
            setSelectedReport(null);
            setChatMessages([]);
            setChatPerson1(null);
            setChatPerson2(null);
          } catch (err) {
            console.error('Delete report error:', err);
            Alert.alert('Error', 'Could not delete report.');
          }
        },
      },
    ]);
  }, []);

  // ─────────────────────────────────────────────
  // Polls Management
  const fetchPolls = useCallback(async () => {
    setLoadingPolls(true);
    try {
      const firestoreDB = getFirestore();
      const pollsRef = collection(firestoreDB, 'polls');
      const q = firestoreQuery(pollsRef, orderBy('createdAt', 'desc'), limit(10));
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPolls(list);
    } catch (err) {
      console.error('Fetch polls error:', err);
    } finally {
      setLoadingPolls(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'polls') fetchPolls();
  }, [activeTab, fetchPolls]);

  const handleCreatePoll = useCallback(async () => {
    const q = pollQuestion.trim();
    const opts = pollOptions.map((o) => o.trim()).filter((o) => o.length > 0);
    if (!q) { Alert.alert('Error', 'Please enter a question.'); return; }
    if (opts.length < 2) { Alert.alert('Error', 'Please add at least 2 options.'); return; }

    // Check max 3 active
    const activeCount = polls.filter((p) => p.active).length;
    if (activeCount >= 3) {
      Alert.alert('Limit Reached', 'Maximum 3 active polls allowed. Deactivate one first.');
      return;
    }

    setCreatingPoll(true);
    try {
      const firestoreDB = getFirestore();
      const pollsRef = collection(firestoreDB, 'polls');
      const newPoll = {
        question: q,
        options: opts.map((text) => ({ text, votes: 0 })),
        totalVotes: 0,
        voters: {},
        active: true,
        createdAt: Timestamp.now(),
        createdBy: currentUser?.id || 'admin',
        imageUrl: pollImageUrl.trim() || null,
      };
      await addDoc(pollsRef, newPoll);
      setPollQuestion('');
      setPollOptions(['', '']);
      setPollImageUrl('');
      Alert.alert('Success', 'Poll created!');
      fetchPolls();
    } catch (err) {
      console.error('Create poll error:', err);
      Alert.alert('Error', 'Could not create poll.');
    } finally {
      setCreatingPoll(false);
    }
  }, [pollQuestion, pollOptions, pollImageUrl, polls, currentUser, fetchPolls]);

  // 🐰 Upload poll image to Bunny CDN
  const handlePickPollImage = useCallback(async () => {
    setUploadingPollImage(true);
    try {
      launchImageLibrary(
        { mediaType: 'photo', selectionLimit: 1, quality: 0.8, maxWidth: 1920, maxHeight: 1920 },
        async (response) => {
          try {
            if (!response || response.didCancel) { setUploadingPollImage(false); return; }
            if (response.errorCode) { setUploadingPollImage(false); return; }
            const asset = response?.assets?.[0];
            if (!asset?.uri) { setUploadingPollImage(false); return; }

            let imageUri = asset.uri;
            // Compress if > 1MB
            const fileSize = asset.fileSize || 0;
            if (fileSize > 1024 * 1024) {
              try {
                imageUri = await CompressorImage.compress(imageUri, {
                  maxWidth: 1024, quality: 0.7, returnableOutputType: 'uri',
                });
              } catch (e) { console.warn('Compression failed, using original:', e); }
            }

            // Upload to Bunny
            const localPath = imageUri.startsWith('file://') ? imageUri.replace('file://', '') : imageUri;
            const base64 = await RNFS.readFile(localPath, 'base64');
            const bytes = base64ToBytes(base64);
            const fileName = `poll_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
            const remotePath = `polls/${fileName}`;

            const res = await fetch(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`, {
              method: 'PUT',
              headers: { AccessKey: BUNNY_ACCESS_KEY, 'Content-Type': 'image/jpeg' },
              body: bytes,
            });

            if (!res.ok) throw new Error('Upload failed');
            const cdnUrl = `${BUNNY_CDN_BASE}/${remotePath}`;
            setPollImageUrl(cdnUrl);
          } catch (err) {
            console.error('Poll image upload error:', err);
            Alert.alert('Error', 'Could not upload image.');
          } finally {
            setUploadingPollImage(false);
          }
        },
      );
    } catch (err) {
      console.error('Image picker launch error:', err);
      setUploadingPollImage(false);
    }
  }, []);

  const handleDeletePoll = useCallback(async (pollId) => {
    Alert.alert('Delete Poll', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            const firestoreDB = getFirestore();
            await deleteDoc(doc(firestoreDB, 'polls', pollId));
            setPolls((prev) => prev.filter((p) => p.id !== pollId));
          } catch (err) {
            Alert.alert('Error', 'Could not delete poll.');
          }
        },
      },
    ]);
  }, []);

  const handleTogglePollActive = useCallback(async (pollItem) => {
    if (!pollItem.active) {
      // Check max 3 before activating
      const activeCount = polls.filter((p) => p.active).length;
      if (activeCount >= 3) {
        Alert.alert('Limit Reached', 'Maximum 3 active polls. Deactivate one first.');
        return;
      }
    }
    try {
      const firestoreDB = getFirestore();
      await updateDoc(doc(firestoreDB, 'polls', pollItem.id), { active: !pollItem.active });
      setPolls((prev) => prev.map((p) => p.id === pollItem.id ? { ...p, active: !p.active } : p));
    } catch (err) {
      Alert.alert('Error', 'Could not update poll.');
    }
  }, [polls]);

  // Render Item (fix avatar)
  const renderItem = ({ item }) => {
    let isBanned = item.isBanned;
    let banInfo = null;

    if (activeTab === 'search') {
      // ✅ Check if ban status was already fetched for this user
      const cachedBan = userBanStatus[item.email];
      if (cachedBan) {
        isBanned = true;
        banInfo = cachedBan;
      } else {
        // Also check in bannedUsers list as fallback
        const foundBan = allBannedUsers.find((b) => b.email === item.email);
        if (foundBan) {
          isBanned = true;
          banInfo = foundBan;
        }
      }
    } else {
      banInfo = item;
    }

    const merged = { ...item, ...(banInfo || {}), isBanned };
    const avatarUri = getAvatarSafe(merged);

    // ✅ If in search tab and not yet checked, check ban status
    if (activeTab === 'search' && item.email && !userBanStatus.hasOwnProperty(item.email) && !isBanned) {
      checkUserBanStatus(item.email).then((banData) => {
        if (banData) {
          setUserBanStatus((prev) => ({
            ...prev,
            [item.email]: banData,
          }));
        }
      });
    }

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => handleSelectUser(merged)}
        style={[
          styles.card,
          { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF', borderColor: isDark ? '#2C2C2E' : '#F2F2F7' }
        ]}
      >
        <Image source={{ uri: avatarUri }} style={styles.avatar} />
        <View style={styles.cardContent}>
          <Text style={[styles.name, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
            {merged.displayName}
          </Text>
          <Text style={[styles.email, { color: isDark ? '#8E8E93' : '#666' }]} numberOfLines={1}>
            {merged.email || merged.decodedEmail || '—'}
          </Text>
        </View>

        <View style={styles.actionContainer}>
          {isBanned ? (
            <View style={styles.bannedBadge}><Text style={styles.bannedText}>BANNED</Text></View>
          ) : (
            <View style={styles.activeBadge}><Text style={styles.activeText}>ACTIVE</Text></View>
          )}
          <Ionicons name="ellipsis-vertical" size={20} color={isDark ? '#555' : '#CCC'} style={{ marginLeft: 8 }} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#F2F2F7', paddingTop: insets.top }]}>
      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'banned' && styles.activeTab, { borderColor: isDark ? '#333' : '#E5E5EA' }]}
          onPress={() => setActiveTab('banned')}
        >
          <Text style={[styles.tabText, activeTab === 'banned' && styles.activeTabText, { color: activeTab === 'banned' ? '#007AFF' : (isDark ? '#888' : '#666') }]}>
            Banned List
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'search' && styles.activeTab, { borderColor: isDark ? '#333' : '#E5E5EA' }]}
          onPress={() => setActiveTab('search')}
        >
          <Text style={[styles.tabText, activeTab === 'search' && styles.activeTabText, { color: activeTab === 'search' ? '#007AFF' : (isDark ? '#888' : '#666') }]}>
            Search DB
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'chatViewer' && styles.activeTab, { borderColor: isDark ? '#333' : '#E5E5EA' }]}
          onPress={() => setActiveTab('chatViewer')}
        >
          <Text style={[styles.tabText, activeTab === 'chatViewer' && styles.activeTabText, { color: activeTab === 'chatViewer' ? '#007AFF' : (isDark ? '#888' : '#666') }]}>
            Chat Viewer
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'polls' && styles.activeTab, { borderColor: isDark ? '#333' : '#E5E5EA' }]}
          onPress={() => setActiveTab('polls')}
        >
          <Text style={[styles.tabText, activeTab === 'polls' && styles.activeTabText, { color: activeTab === 'polls' ? '#007AFF' : (isDark ? '#888' : '#666') }]}>
            Polls
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'search' && (
        <View style={styles.searchContainer}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by display name..."
            placeholderTextColor={isDark ? '#666' : '#999'}
            style={[styles.searchInput, { backgroundColor: isDark ? '#1C1C1E' : '#FFF', color: isDark ? '#FFF' : '#000' }]}
            returnKeyType="search"
            onSubmitEditing={handleSearch}
          />
          <TouchableOpacity onPress={handleSearch} style={styles.searchBtn}>
            <Ionicons name="search" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* Content */}
      {activeTab === 'banned' ? (
        <View style={{ flex: 1 }}>
          {/* Ban Summary Card */}
          {banSummary && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setSummaryExpanded(!summaryExpanded)}
              style={{
                marginHorizontal: 16, marginBottom: 10, padding: 14, borderRadius: 14,
                backgroundColor: isDark ? '#1C1C1E' : '#FFF',
                borderWidth: 1, borderColor: isDark ? '#2C2C2E' : '#E5E5EA',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#FF3B3015', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                    <Ionicons name="shield" size={18} color="#FF3B30" />
                  </View>
                  <View>
                    <Text style={{ fontSize: 20, fontWeight: '800', color: isDark ? '#FFF' : '#000' }}>
                      {banSummary.total}
                    </Text>
                    <Text style={{ fontSize: 11, color: isDark ? '#888' : '#666', fontWeight: '500' }}>
                      Total Banned Users
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, color: '#007AFF', fontWeight: '600', marginRight: 4 }}>
                    {Object.keys(banSummary.byMod).length} Mods
                  </Text>
                  <Ionicons name={summaryExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={isDark ? '#666' : '#999'} />
                </View>
              </View>

              {summaryExpanded && (
                <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: isDark ? '#2C2C2E' : '#F2F2F7' }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: isDark ? '#888' : '#666', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
                    Actions by Moderator
                  </Text>
                  {Object.entries(banSummary.byMod)
                    .sort(([, a], [, b]) => b - a)
                    .map(([modName, count]) => (
                      <View key={modName} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Ionicons name="person-circle" size={20} color={isDark ? '#555' : '#CCC'} style={{ marginRight: 8 }} />
                          <Text style={{ color: isDark ? '#CCC' : '#333', fontSize: 14, fontWeight: '500' }}>{modName}</Text>
                        </View>
                        <View style={{ backgroundColor: '#FF3B3015', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 }}>
                          <Text style={{ color: '#FF3B30', fontSize: 13, fontWeight: '700' }}>{count}</Text>
                        </View>
                      </View>
                    ))}
                </View>
              )}
            </TouchableOpacity>
          )}
          {loadingBanned && !banSummary && allBannedUsers.length === 0 && (
            <ActivityIndicator size="small" color="#007AFF" style={{ marginBottom: 10 }} />
          )}

          <View style={styles.searchContainer}>
            <TextInput
              value={bannedSearchQuery}
              onChangeText={setBannedSearchQuery}
              placeholder="Search by name or email..."
              placeholderTextColor={isDark ? '#666' : '#999'}
              style={[styles.searchInput, { backgroundColor: isDark ? '#1C1C1E' : '#FFF', color: isDark ? '#FFF' : '#000' }]}
            />
            <View style={styles.searchBtn}>
              <Ionicons name="search" size={20} color="#FFF" />
            </View>
          </View>

          {/* Strike Filter Pills */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 10, gap: 8 }}>
            {[
              { key: 'all', label: 'All' },
              { key: '1', label: 'Strike 1' },
              { key: '2', label: 'Strike 2' },
              { key: '3+', label: 'Permanent' },
            ].map((f) => {
              const isActive = strikeFilter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  onPress={() => setStrikeFilter(f.key)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                    backgroundColor: isActive ? '#007AFF' : (isDark ? '#1C1C1E' : '#F2F2F7'),
                    borderWidth: 1, borderColor: isActive ? '#007AFF' : (isDark ? '#2C2C2E' : '#E5E5EA'),
                  }}
                >
                  <Text style={{
                    fontSize: 12, fontWeight: '600',
                    color: isActive ? '#FFF' : (isDark ? '#AAA' : '#666'),
                  }}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {loadingBanned && !refreshing && allBannedUsers.length === 0 ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={filteredBannedUsers}
              keyExtractor={(item) => item.encodedEmail}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDark ? '#FFF' : '#000'} />}
              contentContainerStyle={styles.listContent}
              renderItem={renderItem}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="shield-checkmark-outline" size={48} color={isDark ? '#333' : '#CCC'} />
                  <Text style={[styles.emptyText, { color: isDark ? '#666' : '#999' }]}>
                    {bannedSearchQuery || strikeFilter !== 'all' ? 'No matching users found' : 'No banned users'}
                  </Text>
                </View>
              }
            />
          )}
        </View>
      ) : activeTab === 'search' ? (
        <View style={{ flex: 1 }}>
          {loadingSearch ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item, index) => item.id || item.email || `search-${index}`}
              contentContainerStyle={styles.listContent}
              renderItem={renderItem}
              ListEmptyComponent={
                hasSearched ? (
                  <View style={styles.emptyState}>
                    <Text style={[styles.emptyText, { color: isDark ? '#666' : '#999' }]}>No users found.</Text>
                  </View>
                ) : (
                  <View style={styles.emptyState}>
                    <Ionicons name="search-outline" size={48} color={isDark ? '#333' : '#CCC'} />
                    <Text style={[styles.emptyText, { color: isDark ? '#666' : '#999' }]}>Enter name to search database</Text>
                  </View>
                )
              }
            />
          )}
        </View>
      ) : activeTab === 'chatViewer' ? (
        <View style={{ flex: 1 }}>

          {/* ── ADMIN: Free search (unchanged) ── */}
          {isAdmin ? (
            <>
              <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 10 }}>
                {/* Person 1 */}
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: isDark ? '#888' : '#666', fontSize: 11, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Person 1</Text>
                  {chatPerson1 ? (
                    <View style={[styles.selectedPersonCard, { backgroundColor: isDark ? '#1C1C1E' : '#FFF', borderColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
                      <Image source={{ uri: chatPerson1.avatar }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#DDD' }} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={{ color: isDark ? '#FFF' : '#000', fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{chatPerson1.displayName}</Text>
                        <Text style={{ color: isDark ? '#666' : '#999', fontSize: 11 }} numberOfLines={1}>{chatPerson1.email || chatPerson1.id}</Text>
                      </View>
                      <TouchableOpacity onPress={() => { setChatPerson1(null); setChatSearch1(''); setChatResults1([]); setChatMessages([]); }} style={{ padding: 4 }}>
                        <Ionicons name="close-circle" size={22} color={isDark ? '#555' : '#CCC'} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View>
                      <View style={styles.searchContainer}>
                        <TextInput
                          value={chatSearch1}
                          onChangeText={setChatSearch1}
                          placeholder="Name, email, or user ID..."
                          placeholderTextColor={isDark ? '#666' : '#999'}
                          style={[styles.searchInput, { backgroundColor: isDark ? '#1C1C1E' : '#FFF', color: isDark ? '#FFF' : '#000' }]}
                          autoCapitalize="none"
                          autoCorrect={false}
                          returnKeyType="search"
                          onSubmitEditing={() => searchChatUser(chatSearch1, 1)}
                        />
                        {chatSearching1 ? (
                          <ActivityIndicator size="small" color="#007AFF" style={{ marginLeft: 8 }} />
                        ) : (
                          <TouchableOpacity style={[styles.searchBtn, { backgroundColor: '#5856D6' }]} onPress={() => searchChatUser(chatSearch1, 1)}>
                            <Ionicons name="person-outline" size={18} color="#FFF" />
                          </TouchableOpacity>
                        )}
                      </View>
                      {chatResults1.length > 0 && (
                        <View style={[styles.chatDropdown, { backgroundColor: isDark ? '#1C1C1E' : '#FFF', borderColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
                          {chatResults1.map((u) => (
                            <TouchableOpacity
                              key={u.id}
                              onPress={() => { setChatPerson1(u); setChatSearch1(''); setChatResults1([]); }}
                              style={[styles.chatDropdownItem, { borderBottomColor: isDark ? '#2C2C2E' : '#F2F2F7' }]}
                            >
                              <Image source={{ uri: u.avatar }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#DDD' }} />
                              <View style={{ flex: 1, marginLeft: 8 }}>
                                <Text style={{ color: isDark ? '#FFF' : '#000', fontSize: 14, fontWeight: '500' }} numberOfLines={1}>{u.displayName}</Text>
                                <Text style={{ color: isDark ? '#666' : '#999', fontSize: 11 }} numberOfLines={1}>{u.email || u.id}</Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </View>

                {/* Person 2 */}
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: isDark ? '#888' : '#666', fontSize: 11, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Person 2</Text>
                  {chatPerson2 ? (
                    <View style={[styles.selectedPersonCard, { backgroundColor: isDark ? '#1C1C1E' : '#FFF', borderColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
                      <Image source={{ uri: chatPerson2.avatar }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#DDD' }} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={{ color: isDark ? '#FFF' : '#000', fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{chatPerson2.displayName}</Text>
                        <Text style={{ color: isDark ? '#666' : '#999', fontSize: 11 }} numberOfLines={1}>{chatPerson2.email || chatPerson2.id}</Text>
                      </View>
                      <TouchableOpacity onPress={() => { setChatPerson2(null); setChatSearch2(''); setChatResults2([]); setChatMessages([]); }} style={{ padding: 4 }}>
                        <Ionicons name="close-circle" size={22} color={isDark ? '#555' : '#CCC'} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View>
                      <View style={styles.searchContainer}>
                        <TextInput
                          value={chatSearch2}
                          onChangeText={setChatSearch2}
                          placeholder="Name, email, or user ID..."
                          placeholderTextColor={isDark ? '#666' : '#999'}
                          style={[styles.searchInput, { backgroundColor: isDark ? '#1C1C1E' : '#FFF', color: isDark ? '#FFF' : '#000' }]}
                          autoCapitalize="none"
                          autoCorrect={false}
                          returnKeyType="search"
                          onSubmitEditing={() => searchChatUser(chatSearch2, 2)}
                        />
                        {chatSearching2 ? (
                          <ActivityIndicator size="small" color="#007AFF" style={{ marginLeft: 8 }} />
                        ) : (
                          <TouchableOpacity style={[styles.searchBtn, { backgroundColor: '#AF52DE' }]} onPress={() => searchChatUser(chatSearch2, 2)}>
                            <Ionicons name="person-outline" size={18} color="#FFF" />
                          </TouchableOpacity>
                        )}
                      </View>
                      {chatResults2.length > 0 && (
                        <View style={[styles.chatDropdown, { backgroundColor: isDark ? '#1C1C1E' : '#FFF', borderColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
                          {chatResults2.map((u) => (
                            <TouchableOpacity
                              key={u.id}
                              onPress={() => { setChatPerson2(u); setChatSearch2(''); setChatResults2([]); }}
                              style={[styles.chatDropdownItem, { borderBottomColor: isDark ? '#2C2C2E' : '#F2F2F7' }]}
                            >
                              <Image source={{ uri: u.avatar }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#DDD' }} />
                              <View style={{ flex: 1, marginLeft: 8 }}>
                                <Text style={{ color: isDark ? '#FFF' : '#000', fontSize: 14, fontWeight: '500' }} numberOfLines={1}>{u.displayName}</Text>
                                <Text style={{ color: isDark ? '#666' : '#999', fontSize: 11 }} numberOfLines={1}>{u.email || u.id}</Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </View>

                {/* Load Chat Button */}
                {chatPerson1 && chatPerson2 && (
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#007AFF', height: 46, borderRadius: 14, marginBottom: 0 }]}
                    onPress={loadChat}
                  >
                    <Ionicons name="chatbubbles" size={18} color="#FFF" style={{ marginRight: 8 }} />
                    <Text style={[styles.buttonText, { fontSize: 15 }]}>View Conversation</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            </>
          ) : (
            /* ── MOD: Reported chats list (consent-based) ── */
            <>
              {!selectedReport ? (
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 }}>
                    <Text style={{ color: isDark ? '#FFF' : '#000', fontSize: 16, fontWeight: '700' }}>Reported Chats</Text>
                    <TouchableOpacity onPress={fetchChatReports} style={{ flexDirection: 'row', alignItems: 'center', padding: 6 }}>
                      <Ionicons name="refresh" size={18} color="#007AFF" />
                      <Text style={{ color: '#007AFF', fontSize: 12, fontWeight: '600', marginLeft: 4 }}>Refresh</Text>
                    </TouchableOpacity>
                  </View>
                  {loadingReports ? (
                    <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
                  ) : (
                    <FlatList
                      data={chatReports}
                      keyExtractor={(item) => item.id}
                      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
                      ListEmptyComponent={
                        <View style={styles.emptyState}>
                          <Ionicons name="checkmark-circle-outline" size={48} color={isDark ? '#333' : '#CCC'} />
                          <Text style={[styles.emptyText, { color: isDark ? '#666' : '#999' }]}>No reported chats</Text>
                        </View>
                      }
                      renderItem={({ item: report }) => {
                        const reportTime = report.createdAt?.toDate ? report.createdAt.toDate().toLocaleString() : '';
                        const isReviewed = report.status === 'reviewed';
                        return (
                          <TouchableOpacity
                            onPress={() => loadChatFromReport(report)}
                            style={{
                              backgroundColor: isDark ? '#1C1C1E' : '#FFF',
                              borderRadius: 12, padding: 14, marginBottom: 8,
                              borderWidth: 1, borderColor: isReviewed ? (isDark ? '#2C2C2E' : '#E5E5EA') : (isDark ? 'rgba(255,59,48,0.3)' : 'rgba(255,59,48,0.2)'),
                              opacity: isReviewed ? 0.6 : 1,
                            }}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Ionicons name="flag" size={14} color={isReviewed ? '#888' : '#FF3B30'} />
                                <Text style={{ color: isReviewed ? (isDark ? '#888' : '#999') : '#FF3B30', fontSize: 12, fontWeight: '700', marginLeft: 6 }}>
                                  {report.reason}
                                </Text>
                              </View>
                              <View style={{
                                paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
                                backgroundColor: isReviewed ? (isDark ? '#2C2C2E' : '#E5E5EA') : (isDark ? 'rgba(255,149,0,0.15)' : 'rgba(255,149,0,0.1)'),
                              }}>
                                <Text style={{ fontSize: 10, fontWeight: '600', color: isReviewed ? (isDark ? '#888' : '#999') : '#FF9500' }}>
                                  {isReviewed ? 'Reviewed' : 'Pending'}
                                </Text>
                              </View>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                              <Ionicons name="person-outline" size={12} color={isDark ? '#888' : '#666'} />
                              <Text style={{ color: isDark ? '#CCC' : '#333', fontSize: 13, fontWeight: '500', marginLeft: 6 }}>
                                Reported by: {report.reporterName || report.reportedBy}
                              </Text>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                              <Ionicons name="alert-circle-outline" size={12} color={isDark ? '#888' : '#666'} />
                              <Text style={{ color: isDark ? '#CCC' : '#333', fontSize: 13, fontWeight: '500', marginLeft: 6 }}>
                                Against: {report.reportedUserName || report.reportedUser}
                              </Text>
                            </View>
                            <Text style={{ color: isDark ? '#555' : '#AAA', fontSize: 10, marginTop: 4 }}>{reportTime}</Text>
                          </TouchableOpacity>
                        );
                      }}
                    />
                  )}
                </View>
              ) : (
                /* Mod viewing a reported chat — show back button + mark reviewed */
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 10 }}>
                    <TouchableOpacity
                      onPress={() => { setSelectedReport(null); setChatMessages([]); setChatPerson1(null); setChatPerson2(null); }}
                      style={{ flexDirection: 'row', alignItems: 'center', padding: 6 }}
                    >
                      <Ionicons name="arrow-back" size={20} color="#007AFF" />
                      <Text style={{ color: '#007AFF', fontSize: 14, fontWeight: '600', marginLeft: 4 }}>Back</Text>
                    </TouchableOpacity>
                    <View style={{ flex: 1 }} />
                    {selectedReport.status !== 'reviewed' && (
                      <TouchableOpacity
                        onPress={() => markReportReviewed(selectedReport.id)}
                        style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#34C759', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
                      >
                        <Ionicons name="checkmark-circle" size={16} color="#FFF" />
                        <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700', marginLeft: 4 }}>Mark Reviewed</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => deleteChatReport(selectedReport.id)}
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF3B30', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
                    >
                      <Ionicons name="trash" size={16} color="#FFF" />
                      <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700', marginLeft: 4 }}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                  {/* Report info card */}
                  <View style={{ marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 10, backgroundColor: isDark ? 'rgba(255,59,48,0.08)' : 'rgba(255,59,48,0.04)', borderWidth: 1, borderColor: isDark ? 'rgba(255,59,48,0.2)' : 'rgba(255,59,48,0.1)' }}>
                    <Text style={{ color: isDark ? '#FCA5A5' : '#DC2626', fontSize: 12, fontWeight: '600' }}>
                      Reason: {selectedReport.reason}  |  Reporter: {selectedReport.reporterName}  |  Against: {selectedReport.reportedUserName}
                    </Text>
                  </View>
                </View>
              )}
            </>
          )}

          {/* Chat Messages (shared by both admin & mod views) */}
          {(isAdmin || selectedReport) && (
            <>
              {loadingChat ? (
                <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
              ) : (
                <FlatList
                  data={chatMessages}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={[styles.listContent, { paddingTop: 4 }]}
                  ListEmptyComponent={
                    <View style={styles.emptyState}>
                      <Ionicons name="chatbubbles-outline" size={48} color={isDark ? '#333' : '#CCC'} />
                      <Text style={[styles.emptyText, { color: isDark ? '#666' : '#999' }]}>
                        {chatPerson1 && chatPerson2 ? 'No messages found between these users' : isAdmin ? 'Search and select two users to view their chat' : 'Select a reported chat to view messages'}
                      </Text>
                    </View>
                  }
                  renderItem={({ item }) => {
                    const isPerson1 = item.senderId === chatPerson1?.id;
                    const senderName = isPerson1 ? chatPerson1?.displayName : chatPerson2?.displayName;
                    const time = item.timestamp ? new Date(item.timestamp).toLocaleString() : '';
                    return (
                      <View style={[styles.chatBubble, {
                        backgroundColor: isPerson1 ? (isDark ? '#0A3D62' : '#DCF8C6') : (isDark ? '#1C1C1E' : '#FFF'),
                        alignSelf: isPerson1 ? 'flex-end' : 'flex-start',
                        borderColor: isPerson1 ? (isDark ? '#1A5276' : '#B8E6A0') : (isDark ? '#2C2C2E' : '#E5E5EA'),
                      }]}>
                        <Text style={{ color: isPerson1 ? '#5DADE2' : '#AF52DE', fontSize: 11, fontWeight: '700', marginBottom: 3 }}>
                          {senderName || item.senderId || 'Unknown'}
                        </Text>
                        {item.text ? (
                          <Text style={{ color: isDark ? '#FFF' : '#000', fontSize: 14, lineHeight: 20 }}>{item.text}</Text>
                        ) : null}
                        {item.imageUrl ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                            <Ionicons name="image-outline" size={14} color="#007AFF" />
                            <Text style={{ color: '#007AFF', fontSize: 12, marginLeft: 4 }}>Image</Text>
                          </View>
                        ) : null}
                        {item.fruits && item.fruits.length > 0 ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                            <Ionicons name="paw-outline" size={14} color="#FF9500" />
                            <Text style={{ color: '#FF9500', fontSize: 12, marginLeft: 4 }}>{item.fruits.length} pet(s)</Text>
                          </View>
                        ) : null}
                        <Text style={{ color: isDark ? '#555' : '#AAA', fontSize: 10, marginTop: 4, textAlign: 'right' }}>
                          {time}
                        </Text>
                      </View>
                    );
                  }}
                />
              )}
            </>
          )}
        </View>
      ) : activeTab === 'polls' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          {/* Create Poll Form */}
          <View style={[styles.pollFormCard, { backgroundColor: isDark ? '#1C1C1E' : '#FFF', borderColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
            <Text style={{ color: isDark ? '#FFF' : '#000', fontSize: 16, fontWeight: '700', marginBottom: 12 }}>Create New Poll</Text>

            <TextInput
              value={pollQuestion}
              onChangeText={setPollQuestion}
              placeholder="Poll question..."
              placeholderTextColor={isDark ? '#666' : '#999'}
              style={[styles.pollInput, { backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7', color: isDark ? '#FFF' : '#000' }]}
              multiline
            />

            <Text style={{ color: isDark ? '#888' : '#666', fontSize: 11, fontWeight: '600', marginBottom: 6, marginTop: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Options</Text>
            {pollOptions.map((opt, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <TextInput
                  value={opt}
                  onChangeText={(text) => {
                    const updated = [...pollOptions];
                    updated[i] = text;
                    setPollOptions(updated);
                  }}
                  placeholder={`Option ${i + 1}`}
                  placeholderTextColor={isDark ? '#666' : '#999'}
                  style={[styles.pollInput, { flex: 1, backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7', color: isDark ? '#FFF' : '#000' }]}
                />
                {pollOptions.length > 2 && (
                  <TouchableOpacity
                    onPress={() => setPollOptions(pollOptions.filter((_, ix) => ix !== i))}
                    style={{ padding: 6, marginLeft: 4 }}
                  >
                    <Ionicons name="close-circle" size={20} color="#FF3B30" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {pollOptions.length < 6 && (
              <TouchableOpacity
                onPress={() => setPollOptions([...pollOptions, ''])}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}
              >
                <Ionicons name="add-circle" size={20} color="#007AFF" />
                <Text style={{ color: '#007AFF', marginLeft: 6, fontSize: 13, fontWeight: '500' }}>Add Option</Text>
              </TouchableOpacity>
            )}

            <Text style={{ color: isDark ? '#888' : '#666', fontSize: 11, fontWeight: '600', marginBottom: 6, marginTop: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Image (optional)</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <TextInput
                value={pollImageUrl}
                onChangeText={setPollImageUrl}
                placeholder="Paste URL or upload below"
                placeholderTextColor={isDark ? '#666' : '#999'}
                style={[styles.pollInput, { flex: 1, backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7', color: isDark ? '#FFF' : '#000', marginBottom: 0 }]}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {pollImageUrl ? (
                <TouchableOpacity onPress={() => setPollImageUrl('')} style={{ padding: 6, marginLeft: 4 }}>
                  <Ionicons name="close-circle" size={20} color="#FF3B30" />
                </TouchableOpacity>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={handlePickPollImage}
              disabled={uploadingPollImage}
              style={[styles.actionButton, { backgroundColor: '#007AFF', height: 38, borderRadius: 10, marginBottom: 6 }]}
            >
              {uploadingPollImage ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={16} color="#FFF" style={{ marginRight: 6 }} />
                  <Text style={[styles.buttonText, { fontSize: 13 }]}>Upload from Gallery</Text>
                </>
              )}
            </TouchableOpacity>
            {pollImageUrl ? (
              <Image source={{ uri: pollImageUrl }} style={{ width: '100%', height: 120, borderRadius: 10, marginBottom: 6, backgroundColor: '#DDD' }} resizeMode="cover" />
            ) : null}

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#5856D6', marginTop: 12, height: 46, borderRadius: 14 }]}
              onPress={handleCreatePoll}
              disabled={creatingPoll}
            >
              {creatingPoll ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="add-circle" size={18} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={[styles.buttonText, { fontSize: 15 }]}>Create Poll</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Existing Polls */}
          <Text style={{ color: isDark ? '#FFF' : '#000', fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 12 }}>Existing Polls</Text>

          {loadingPolls ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 20 }} />
          ) : polls.length === 0 ? (
            <Text style={{ color: isDark ? '#666' : '#999', textAlign: 'center', paddingVertical: 20 }}>No polls created yet</Text>
          ) : (
            polls.map((p) => (
              <View key={p.id} style={[styles.pollListCard, { backgroundColor: isDark ? '#1C1C1E' : '#FFF', borderColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <View style={[styles.pollStatusBadge, { backgroundColor: p.active ? '#34C75920' : '#FF3B3020' }]}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.active ? '#34C759' : '#FF3B30', marginRight: 4 }} />
                    <Text style={{ color: p.active ? '#34C759' : '#FF3B30', fontSize: 10, fontWeight: '700' }}>{p.active ? 'ACTIVE' : 'INACTIVE'}</Text>
                  </View>
                  <Text style={{ color: isDark ? '#555' : '#CCC', fontSize: 11, marginLeft: 'auto' }}>
                    {p.totalVotes || 0} votes
                  </Text>
                </View>
                <Text style={{ color: isDark ? '#FFF' : '#000', fontSize: 15, fontWeight: '600', marginBottom: 4 }} numberOfLines={2}>{p.question}</Text>
                <Text style={{ color: isDark ? '#666' : '#999', fontSize: 12, marginBottom: 8 }}>
                  {(p.options || []).map((o) => o.text).join(' • ')}
                </Text>
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity
                    onPress={() => handleTogglePollActive(p)}
                    style={[styles.pollActionBtn, { backgroundColor: p.active ? '#FF950020' : '#34C75920' }]}
                  >
                    <Ionicons name={p.active ? 'pause-circle' : 'play-circle'} size={16} color={p.active ? '#FF9500' : '#34C759'} />
                    <Text style={{ color: p.active ? '#FF9500' : '#34C759', fontSize: 12, fontWeight: '600', marginLeft: 4 }}>
                      {p.active ? 'Deactivate' : 'Activate'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDeletePoll(p.id)}
                    style={[styles.pollActionBtn, { backgroundColor: '#FF3B3020', marginLeft: 8 }]}
                  >
                    <Ionicons name="trash-outline" size={16} color="#FF3B30" />
                    <Text style={{ color: '#FF3B30', fontSize: 12, fontWeight: '600', marginLeft: 4 }}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      ) : null}

      {/* Modal */}
      <Modal
        visible={!!selectedUser}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setSelectedUser(null)}
      >
        <View style={[styles.modalContainer, { backgroundColor: isDark ? '#000' : '#F2F2F7' }]}>
          {selectedUser && (
            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
              <View style={styles.modalHeader}>
                <Text style={{ fontSize: 18, fontWeight: '600', color: isDark ? '#FFF' : '#000' }}>User Details</Text>
                <TouchableOpacity onPress={() => setSelectedUser(null)} style={styles.modalCloseBtn}>
                  <Ionicons name="close-circle" size={28} color={isDark ? '#555' : '#CCC'} />
                </TouchableOpacity>
              </View>

              {/* Header */}
              <View style={{ alignItems: 'center', marginVertical: 20 }}>
                <Image source={{ uri: getAvatarSafe(selectedUser) }} style={styles.avatarLarge} />
                <Text style={[styles.modalName, { color: isDark ? '#FFF' : '#000' }]}>{selectedUser.displayName}</Text>
                <Text style={[styles.modalEmail, { color: isDark ? '#AAA' : '#666' }]}>{selectedUser.email || selectedUser.decodedEmail}</Text>

                {selectedUser.id && (
                  <TouchableOpacity
                    onPress={() => {
                      Clipboard.setString(selectedUser.id);
                      Alert.alert('Copied', 'User ID copied to clipboard.');
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? '#1C1C1E' : '#E5E5EA', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginBottom: 8 }}
                  >
                    <Ionicons name="copy-outline" size={14} color={isDark ? '#AAA' : '#666'} style={{ marginRight: 6 }} />
                    <Text style={{ color: isDark ? '#CCC' : '#333', fontSize: 12 }} numberOfLines={1}>
                      ID: {selectedUser.id}
                    </Text>
                  </TouchableOpacity>
                )}

                {userDetails?.isPro && (
                  <View style={[styles.proBadge]}>
                    <Ionicons name="star" size={12} color="#FFD700" />
                    <Text style={{ color: '#ffb700be', fontWeight: 'bold', marginLeft: 4 }}>PRO</Text>
                  </View>
                )}

                {selectedUser.isBanned && (
                  <View style={[styles.infoBadge, { backgroundColor: '#FF3B3015', marginTop: 8 }]}>
                    <Text style={{ color: '#FF3B30', fontWeight: 'bold' }}>
                      {selectedUser.strikeCount} Strike(s) • {selectedUser.reason}
                    </Text>
                  </View>
                )}
              </View>

              {/* Unban / Ban Actions */}
              <View style={{ marginTop: 20, marginBottom: 16 }}>
                {selectedUser.isBanned ? (
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#34C759' }]}
                    onPress={() => handleUnban(selectedUser)}
                  >
                    <Ionicons name="checkmark-circle-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
                    <Text style={styles.buttonText}>Unban User</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#FF3B30' }]}
                    onPress={() => handleBan(selectedUser)}
                  >
                    <Ionicons name="ban-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
                    <Text style={styles.buttonText}>Ban User</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Stats */}
              {loadingDetails ? (
                <ActivityIndicator size="small" color="#007AFF" style={{ marginBottom: 16 }} />
              ) : userDetails && (
                <View style={[styles.statsSection, { backgroundColor: isDark ? '#1C1C1E' : '#FFF' }]}>
                  {userDetails.createdAt && (
                    <View style={styles.statRow}>
                      <Ionicons name="calendar-outline" size={18} color={isDark ? '#888' : '#666'} />
                      <Text style={{ color: isDark ? '#FFF' : '#000', marginLeft: 10 }}>
                        Member since {new Date(toMillisSafe(userDetails.createdAt) || userDetails.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                      </Text>
                    </View>
                  )}

                  <View style={styles.statRow}>
                    <Ionicons name="star" size={18} color="#FFD700" />
                    <Text style={{ color: isDark ? '#FFF' : '#000', marginLeft: 10 }}>
                      {parseRatingSafe(userDetails.rating).toFixed(2)} ({userDetails.ratingCount || 0} reviews)
                    </Text>
                  </View>

                  {userDetails.robloxUsername && (
                    <View style={styles.statRow}>
                      <Ionicons name="game-controller-outline" size={18} color={isDark ? '#888' : '#666'} />
                      <Text style={{ color: isDark ? '#FFF' : '#000', marginLeft: 10 }}>
                        {userDetails.robloxUsername}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Reviews */}
              <View style={styles.sectionContainer}>
                <Text style={[styles.sectionTitle, { color: isDark ? '#FFF' : '#000' }]}>Reviews</Text>

                {reviews.length === 0 && !loadingReviews ? (
                  <Text style={{ color: isDark ? '#666' : '#999', textAlign: 'center', padding: 16 }}>No reviews yet</Text>
                ) : (
                  reviews.map((review) => {
                    const ratingVal = parseRatingSafe(review?.rating);
                    const reviewText = (review?.review ?? review?.comment ?? review?.text ?? '').toString().trim();
                    const reviewer = (review?.userName ?? review?.reviewerName ?? '').toString().trim();
                    const dateText = formatDateSafe(review?.createdAt) || formatDateSafe(review?.updatedAt) || '';

                    return (
                      <View key={review.id} style={[styles.reviewCard, { backgroundColor: isDark ? '#1C1C1E' : '#FFF' }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                          <Ionicons name="star" size={14} color="#FFD700" />
                          <Text style={{ color: isDark ? '#FFF' : '#000', marginLeft: 4, fontWeight: '600' }}>
                            {ratingVal || 0}
                          </Text>
                          <Text style={{ color: isDark ? '#666' : '#999', marginLeft: 'auto', fontSize: 11 }}>
                            {dateText || '—'}
                          </Text>
                          <TouchableOpacity
                            onPress={() => handleDeleteReview(review)}
                            style={{ marginLeft: 10, padding: 4 }}
                          >
                            <Ionicons name="trash-outline" size={16} color="#FF3B30" />
                          </TouchableOpacity>
                        </View>

                        <Text style={{ color: isDark ? '#CCC' : '#333' }}>
                          {reviewText || 'No comment'}
                        </Text>

                        {!!reviewer && (
                          <Text style={{ color: isDark ? '#888' : '#666', fontSize: 11, marginTop: 4 }}>
                            — {reviewer}
                          </Text>
                        )}
                      </View>
                    );
                  })
                )}

                {loadingReviews && <ActivityIndicator size="small" color="#007AFF" style={{ marginTop: 8 }} />}

                {hasMoreReviews && reviews.length > 0 && !loadingReviews && (
                  <TouchableOpacity style={styles.loadMoreBtn} onPress={() => fetchReviews(selectedUser.id, false)}>
                    <Text style={{ color: '#007AFF', fontWeight: '600' }}>Load More</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Strike History */}
              {strikeHistory.length > 0 && (
                <View style={styles.sectionContainer}>
                  <Text style={[styles.sectionTitle, { color: isDark ? '#FFF' : '#000' }]}>Strike History</Text>
                  {strikeHistory.map((strike) => (
                    <View key={strike.id} style={[styles.strikeCard, { backgroundColor: isDark ? '#2C1C1E' : '#FFF5F5' }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={[
                          styles.strikeBadge,
                          {
                            backgroundColor:
                              strike.strikeCount >= 3 ? '#FF3B30' :
                                strike.strikeCount === 2 ? '#FF6B00' :
                                  '#FF9500'
                          }
                        ]}>
                          <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 11 }}>Strike {strike.strikeCount}</Text>
                        </View>
                        <Text style={{ color: isDark ? '#666' : '#999', marginLeft: 'auto', fontSize: 11 }}>
                          {strike.timestamp ? new Date(strike.timestamp).toLocaleDateString() : ''}
                        </Text>
                      </View>

                      {strike.reason && <Text style={{ color: isDark ? '#CCC' : '#333', marginTop: 6 }}>{strike.reason}</Text>}
                      {strike.appliedBy && <Text style={{ color: isDark ? '#888' : '#666', fontSize: 11, marginTop: 4 }}>By: {strike.appliedBy}</Text>}
                    </View>
                  ))}
                </View>
              )}

              {/* Mute Buttons */}
              <View style={{ marginTop: 16 }}>
                <Text style={{ color: isDark ? '#888' : '#666', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>
                  Mute User (temporary silence, no strike)
                </Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <TouchableOpacity style={[styles.strikeButton, { backgroundColor: '#5856D6' }]} onPress={() => handleMuteUser(selectedUser, 5)}>
                    <Ionicons name="volume-mute" size={16} color="#FFF" />
                    <Text style={[styles.buttonText, { fontSize: 14 }]}>5 min</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.strikeButton, { backgroundColor: '#AF52DE' }]} onPress={() => handleMuteUser(selectedUser, 10)}>
                    <Ionicons name="volume-mute" size={16} color="#FFF" />
                    <Text style={[styles.buttonText, { fontSize: 14 }]}>10 min</Text>
                  </TouchableOpacity>
                  <View style={[styles.strikeButton, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA', justifyContent: 'center' }]}>
                    <TextInput
                      value={customMuteMinutes}
                      onChangeText={setCustomMuteMinutes}
                      placeholder="Min"
                      placeholderTextColor={isDark ? '#666' : '#999'}
                      keyboardType="number-pad"
                      style={{ color: isDark ? '#FFF' : '#000', fontSize: 14, textAlign: 'center', width: '100%', paddingVertical: 0 }}
                      maxLength={4}
                    />
                  </View>
                </View>
                {customMuteMinutes.trim().length > 0 && (
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#5856D6', height: 40, marginBottom: 8 }]}
                    onPress={() => {
                      const mins = parseInt(customMuteMinutes, 10);
                      if (mins > 0) {
                        handleMuteUser(selectedUser, mins);
                        setCustomMuteMinutes('');
                      } else {
                        Alert.alert('Error', 'Enter a valid number of minutes.');
                      }
                    }}
                  >
                    <Ionicons name="volume-mute" size={16} color="#FFF" style={{ marginRight: 6 }} />
                    <Text style={[styles.buttonText, { fontSize: 14 }]}>Mute for {customMuteMinutes} min</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Strike Buttons */}
              <View style={{ marginTop: 16 }}>
                <Text style={{ color: isDark ? '#888' : '#666', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>
                  Apply Strike (choose severity)
                </Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                  <TouchableOpacity style={[styles.strikeButton, { backgroundColor: '#FF9500' }]} onPress={() => handleSetStrike(selectedUser, 1)}>
                    <Text style={styles.buttonText}>Strike 1</Text>
                    <Text style={{ color: '#fff', fontSize: 10 }}>3 hours</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.strikeButton, { backgroundColor: '#FF6B00' }]} onPress={() => handleSetStrike(selectedUser, 2)}>
                    <Text style={styles.buttonText}>Strike 2</Text>
                    <Text style={{ color: '#fff', fontSize: 10 }}>3 days</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.strikeButton, { backgroundColor: '#FF3B30' }]} onPress={() => handleSetStrike(selectedUser, 3)}>
                    <Text style={styles.buttonText}>Strike 3+</Text>
                    <Text style={{ color: '#fff', fontSize: 10 }}>Permanent</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabContainer: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 16 },
  tab: { marginRight: 16, paddingBottom: 8, borderBottomWidth: 2, borderColor: 'transparent' },
  activeTab: { borderColor: '#007AFF' },
  tabText: { fontSize: 16, fontWeight: '600' },
  activeTabText: { color: '#007AFF' },

  searchContainer: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 10 },
  searchInput: { flex: 1, height: 44, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  searchBtn: { width: 44, height: 44, backgroundColor: '#007AFF', borderRadius: 10, marginLeft: 8, justifyContent: 'center', alignItems: 'center' },

  listContent: { paddingHorizontal: 16, paddingBottom: 80 },

  card: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, marginBottom: 10, borderWidth: 1 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#DDD' },
  cardContent: { flex: 1, marginLeft: 12 },
  name: { fontSize: 16, fontWeight: '600' },
  email: { fontSize: 13, marginTop: 2 },
  actionContainer: { flexDirection: 'row', alignItems: 'center' },
  bannedBadge: { backgroundColor: '#FF3B30', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  bannedText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  activeBadge: { backgroundColor: '#34C759', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  activeText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },

  modalContainer: { flex: 1 },
  modalContent: { padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalCloseBtn: { padding: 4 },
  avatarLarge: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#DDD', marginBottom: 16 },
  modalName: { fontSize: 24, fontWeight: 'bold', marginBottom: 4 },
  modalEmail: { fontSize: 14, marginBottom: 16 },

  infoBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },

  buttonText: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 50,
    borderRadius: 12,
    marginBottom: 12,
  },

  emptyState: { alignItems: 'center', marginTop: 60, opacity: 0.7 },
  emptyText: { marginTop: 16, fontSize: 16 },

  strikeButton: {
    flex: 1,
    height: 60,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4
  },

  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 8
  },

  statsSection: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8
  },

  sectionContainer: { marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },

  reviewCard: { padding: 12, borderRadius: 10, marginBottom: 8 },
  strikeCard: { padding: 12, borderRadius: 10, marginBottom: 8 },
  strikeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },

  loadMoreBtn: { alignItems: 'center', paddingVertical: 10 },

  chatBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
    borderWidth: 1,
  },
  selectedPersonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  chatDropdown: {
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
    overflow: 'hidden',
  },
  chatDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
  },
  pollFormCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  pollInput: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 4,
  },
  pollListCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  pollStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  pollActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
});

export default AdminDashboard;
