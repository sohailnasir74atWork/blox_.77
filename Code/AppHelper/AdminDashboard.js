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
  Keyboard
} from 'react-native';

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
} from '@react-native-firebase/firestore';

import { unbanUserWithEmail, banUserwithEmail, setUserStrike } from '../ChatScreen/utils';
import { useGlobalState } from '../GlobelStats';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';

const decodeEmail = (encoded) => (encoded ? encoded.replace(/\(dot\)/g, '.') : '');
const BAD_KEYS = new Set(['undefined', 'onloaduser', '', null, undefined]);
const DEFAULT_AVATAR = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';

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

  // Tabs
  const [activeTab, setActiveTab] = useState('banned');

  // Banned Data
  const [bannedUsers, setBannedUsers] = useState([]);
  const [loadingBanned, setLoadingBanned] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastBannedKey, setLastBannedKey] = useState(null);
  const [lastBannedTime, setLastBannedTime] = useState(null);
  const [hasMoreBanned, setHasMoreBanned] = useState(true);

  // Search Data
  const [searchQuery, setSearchQuery] = useState('');
  const [bannedSearchQuery, setBannedSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Modal
  const [selectedUser, setSelectedUser] = useState(null);

  // User Details
  const [userDetails, setUserDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Reviews
  const [reviews, setReviews] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [hasMoreReviews, setHasMoreReviews] = useState(true);
  const [lastReviewKey, setLastReviewKey] = useState(null); // Firestore doc snapshot cursor

  // Strike History
  const [strikeHistory, setStrikeHistory] = useState([]);

  // ─────────────────────────────────────────────
  // Fetch Banned Users (Paginated)
  const fetchBannedUsers = useCallback(async (reset = false) => {
    if ((!reset && !hasMoreBanned) || loadingBanned) return;

    setLoadingBanned(true);
    try {
      const limitSize = 10;
      const bannedRef = ref(db, 'banned_users_by_email');

      // 1) SEARCH MODE
      if (bannedSearchQuery.trim().length >= 1) {
        if (reset) setBannedUsers([]);

        const q = query(
          bannedRef,
          orderByChild('displayName'),
          startAt(bannedSearchQuery),
          endAt(bannedSearchQuery + '\uf8ff'),
          limitToFirst(limitSize)
        );

        const snapshot = await get(q);

        if (!snapshot.exists()) {
          if (reset) setBannedUsers([]);
          setHasMoreBanned(false);
        } else {
          const list = [];
          snapshot.forEach((child) => {
            const encodedEmail = child.key;
            if (BAD_KEYS.has(encodedEmail)) return;
            const entry = child.val();
            list.push({
              isBanned: true,
              email: decodeEmail(encodedEmail),
              encodedEmail,
              reason: entry?.reason ?? '—',
              strikeCount: entry?.strikeCount ?? 0,
              bannedUntil: entry?.bannedUntil ?? null,
              displayName: entry?.displayName || 'Unknown',
              avatar: getAvatarSafe(entry),
              bannedBy: entry?.bannedBy || null,
              bannedAt: entry?.bannedAt ?? null,
              id: entry?.userId || null
            });
          });
          setBannedUsers(list);
          setHasMoreBanned(false);
        }
        return;
      }

      // 2) PAGINATION MODE (Newest first by bannedAt)
      let q;
      if (reset) {
        setBannedUsers([]);
        setLastBannedTime(null);
        setLastBannedKey(null);
        setHasMoreBanned(true);
        q = query(bannedRef, orderByChild('bannedAt'), limitToLast(limitSize));
      } else {
        if (lastBannedKey === null) return;
        q = query(
          bannedRef,
          orderByChild('bannedAt'),
          endAt(lastBannedTime, lastBannedKey),
          limitToLast(limitSize + 1)
        );
      }

      const snapshot = await get(q);
      if (!snapshot.exists()) {
        if (reset) setBannedUsers([]);
        setHasMoreBanned(false);
        return;
      }

      const list = [];
      snapshot.forEach((child) => {
        const encodedEmail = child.key;
        if (BAD_KEYS.has(encodedEmail)) return;
        const entry = child.val();
        list.push({
          isBanned: true,
          email: decodeEmail(encodedEmail),
          encodedEmail,
          reason: entry?.reason ?? '—',
          strikeCount: entry?.strikeCount ?? 0,
          bannedUntil: entry?.bannedUntil ?? null,
          displayName: entry?.displayName || 'Unknown',
          avatar: getAvatarSafe(entry),
          bannedBy: entry?.bannedBy || null,
          bannedAt: entry?.bannedAt ?? null,
          id: entry?.userId || null
        });
      });

      let sortedList = list.reverse();
      if (!reset && lastBannedKey) {
        sortedList = sortedList.filter((item) => item.encodedEmail !== lastBannedKey);
      }
      if (sortedList.length === 0) {
        setHasMoreBanned(false);
        return;
      }

      const oldestItem = sortedList[sortedList.length - 1];
      setLastBannedTime(oldestItem.bannedAt);
      setLastBannedKey(oldestItem.encodedEmail);

      const effectiveLimit = reset ? limitSize : limitSize + 1;
      setHasMoreBanned(snapshot.numChildren() >= effectiveLimit);

      setBannedUsers((prev) => {
        if (reset) return sortedList;

        const existing = new Set(prev.map((u) => u.encodedEmail));
        const newUnique = sortedList.filter((u) => !existing.has(u.encodedEmail));
        if (newUnique.length === 0) {
          setHasMoreBanned(false);
          return prev;
        }
        return [...prev, ...newUnique];
      });
    } catch (err) {
      console.error('Fetch banned error:', err);
    } finally {
      setLoadingBanned(false);
      setRefreshing(false);
    }
  }, [db, bannedSearchQuery, lastBannedTime, lastBannedKey, hasMoreBanned, loadingBanned]);

  useEffect(() => {
    fetchBannedUsers(true);
  }, [bannedSearchQuery]);

  const onRefresh = () => {
    setRefreshing(true);
    setHasMoreBanned(true);
    fetchBannedUsers(true);
  };

  const loadMoreBanned = () => {
    if (!loadingBanned && hasMoreBanned && !bannedSearchQuery) {
      fetchBannedUsers(false);
    }
  };

  // ─────────────────────────────────────────────
  // Search Users (RTDB)
  const handleSearch = async () => {
    // ✅ Sanitize: strip emojis, symbols, and special chars — keep only letters, numbers, spaces, underscores, dots
    const sanitized = searchQuery.replace(/[^\w\s.@-]/gi, '').trim();

    if (!sanitized) {
      Alert.alert('Invalid Search', 'Please enter letters or numbers to search.');
      return;
    }

    if (sanitized.length < 3) {
      Alert.alert('Optimization', 'Please enter at least 3 characters to search efficiently.');
      return;
    }

    Keyboard.dismiss();
    setLoadingSearch(true);
    setHasSearched(true);
    setSearchResults([]);

    try {
      const q = query(
        ref(db, 'users'),
        orderByChild('displayName'),
        startAt(sanitized),
        endAt(sanitized + '\uf8ff'),
        limitToFirst(20)
      );

      const snapshot = await get(q);

      if (snapshot.exists()) {
        const data = snapshot.val();
        const results = Object.values(data).map((u) => ({
          isBanned: false,
          id: u.id,
          displayName: u.displayName || u.userName || 'Unknown',
          email: u.email,
          avatar: getAvatarSafe(u),
          robloxUsername: u.robloxUsername,
          isAdmin: u.admin || false,
          isModerator: u.isModerator || false
        }));
        setSearchResults(results);
      } else {
        setSearchResults([]);
      }
    } catch (err) {
      console.error('Search error:', err);
      Alert.alert('Search Failed', "Indexing required on 'users' -> 'displayName'.");
    } finally {
      setLoadingSearch(false);
    }
  };

  // ─────────────────────────────────────────────
  // Actions
  const handleUnban = async (userItem) => {
    const email = userItem.email || decodeEmail(userItem.encodedEmail);
    if (!email) return;

    try {
      const success = await unbanUserWithEmail(email);
      if (success) {
        setSelectedUser(null);
        fetchBannedUsers(true);
        if (activeTab === 'search') {
          setSearchResults((prev) => prev.map((u) => (u.email === email ? { ...u, isBanned: false } : u)));
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
      fetchBannedUsers(true);
      setSearchResults((prev) => prev.map((u) => (u.email === userItem.email ? { ...u, isBanned: true } : u)));
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
      fetchBannedUsers(true);
      if (activeTab === 'search') {
        setSearchResults((prev) => prev.map((u) => (u.email === userItem.email ? { ...u, isBanned: true } : u)));
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

      if (summarySnap.exists) {
        const s = summarySnap.data();
        rating = parseRatingSafe(s?.averageRating);
        ratingCount = typeof s?.count === 'number' ? s.count : Number(s?.count) || 0;
      }

      // ✅ fallback if summary missing OR empty
      if (!summarySnap.exists || ratingCount === 0) {
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
          setStrikeHistory([{
            id: 'current',
            strikeCount: data.strikeCount,
            reason: data.reason || '—',
            timestamp: data.bannedAt || null,
            appliedBy: data.bannedBy?.displayName || null,
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

  // Handle selection
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

  // Render Item (fix avatar)
  const renderItem = ({ item }) => {
    let isBanned = item.isBanned;
    let banInfo = null;

    if (activeTab === 'search') {
      const foundBan = bannedUsers.find((b) => b.email === item.email);
      if (foundBan) {
        isBanned = true;
        banInfo = foundBan;
      }
    } else {
      banInfo = item;
    }

    const merged = { ...item, ...(banInfo || {}), isBanned };
    const avatarUri = getAvatarSafe(merged);

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => handleSelectUser(merged)}
        style={[
          styles.card,
          { backgroundColor: isDark ? '#1e293b' : '#FFFFFF', borderColor: isDark ? '#334155' : '#F2F2F7' }
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
    <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#F2F2F7', paddingTop: 16 }]}>
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
      </View>

      {activeTab === 'search' && (
        <View style={styles.searchContainer}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by display name..."
            placeholderTextColor={isDark ? '#666' : '#999'}
            style={[styles.searchInput, { backgroundColor: isDark ? '#1e293b' : '#FFF', color: isDark ? '#FFF' : '#000' }]}
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
          <View style={styles.searchContainer}>
            <TextInput
              value={bannedSearchQuery}
              onChangeText={setBannedSearchQuery}
              placeholder="Search banned users..."
              placeholderTextColor={isDark ? '#666' : '#999'}
              style={[styles.searchInput, { backgroundColor: isDark ? '#1e293b' : '#FFF', color: isDark ? '#FFF' : '#000' }]}
            />
            <View style={styles.searchBtn}>
              <Ionicons name="search" size={20} color="#FFF" />
            </View>
          </View>

          {loadingBanned && !refreshing && bannedUsers.length === 0 ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={bannedUsers}
              keyExtractor={(item) => item.encodedEmail}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDark ? '#FFF' : '#000'} />}
              contentContainerStyle={styles.listContent}
              renderItem={renderItem}
              onEndReached={loadMoreBanned}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                loadingBanned && hasMoreBanned ? (
                  <ActivityIndicator size="small" color="#007AFF" style={{ marginVertical: 20 }} />
                ) : null
              }
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="shield-checkmark-outline" size={48} color={isDark ? '#333' : '#CCC'} />
                  <Text style={[styles.emptyText, { color: isDark ? '#666' : '#999' }]}>
                    {bannedSearchQuery ? 'No matching users found' : 'No banned users'}
                  </Text>
                </View>
              }
            />
          )}
        </View>
      ) : (
        loadingSearch ? (
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
        )
      )}

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

                {userDetails?.isPro && (
                  <View style={[styles.proBadge]}>
                    <Ionicons name="star" size={12} color="#FFD700" />
                    <Text style={{ color: '#FFD700', fontWeight: 'bold', marginLeft: 4 }}>PRO</Text>
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

              {/* Stats */}
              {loadingDetails ? (
                <ActivityIndicator size="small" color="#007AFF" style={{ marginBottom: 16 }} />
              ) : userDetails && (
                <View style={[styles.statsSection, { backgroundColor: isDark ? '#1e293b' : '#FFF' }]}>
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
                      <View key={review.id} style={[styles.reviewCard, { backgroundColor: isDark ? '#1e293b' : '#FFF' }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                          <Ionicons name="star" size={14} color="#FFD700" />
                          <Text style={{ color: isDark ? '#FFF' : '#000', marginLeft: 4, fontWeight: '600' }}>
                            {ratingVal || 0}
                          </Text>
                          <Text style={{ color: isDark ? '#666' : '#999', marginLeft: 'auto', fontSize: 11 }}>
                            {dateText || '—'}
                          </Text>
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
    backgroundColor: '#1e293b',
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

  loadMoreBtn: { alignItems: 'center', paddingVertical: 10 }
});

export default AdminDashboard;
