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
import { modLoadPrivateChat as sbLoadPrivateMessages } from '../Supabase/privateMessagesBackend';
import { adminListUserChats } from '../Supabase/chatMetaBackend';
import {
  fetchAllPolls as sbFetchAllPolls,
  createPoll as sbCreatePoll,
  deletePoll as sbDeletePoll,
  setPollActive as sbSetPollActive,
} from '../Supabase/pollsBackend';

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
  addDoc,
  Timestamp,
  updateDoc,
} from '@react-native-firebase/firestore';

import {
  applySanction,
  liftSanction,
  getCurrentStrikeCount,
  getSanctionStatus,
  getModPermissions,
  canLiftSanction,
  fetchUserRoles,
  isCurrentUserOwner,
  isMuteRecordCompat,
  getStaffRank,
  STAFF_RANK,
} from '../ChatScreen/utils';
import { getUserEmail, findUsersByEmail, normalizeEmail } from '../Helper/privateProfile';
import { canRemoveReview, canDeleteReviews, deleteReviewAndSummary } from '../Helper/reviewModeration';
import {
  sanctionErrorText,
  describeSanctionResult,
  logModAction,
  nextStrikeCount,
  strikeDurationLabel,
  strikeStep,
  formatMuteMinutes,
  mutePresetsFor,
  PENDING_PERM_DAYS,
} from '../Helper/modSanction';
import { translateMany } from '../Helper/chatTranslate';
import { getDeviceLanguage } from '../../i18n';
import { encodeEmailKey } from '../Helper/banKeys';
import { useGlobalState } from '../GlobelStats';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';
import ReviewIntegrityTab from './ReviewIntegrityTab';
import ModLogTab from './ModLogTab';
import WordFilterTab from './WordFilterTab';
import PermBanRequestsTab from './PermBanRequestsTab';
import TranslatableText from './TranslatableText';
import ReportsTab from './ReportsTab';
import StaffAccessTab from './StaffAccessTab';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';
import AdminNewsTab from './AdminNewsTab';
import ModActionModal from './ModActionModal';
import ModHistoryList from './ModHistoryList';
import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import { safeCompressImage } from '../Helper/safeCompressImage';

// Poll images upload through the server (uploadImage); the app holds no storage key.
import { uploadImage, UPLOAD_KIND } from '../Helper/imageUpload';

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

const timeAgo = (v) => {
  const ms = toMillisSafe(v);
  if (!ms) return '';
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
};

const ACCENT = '#0A84FF';

// Dashboard sections. `admin`: admins only; `staffAdmin`: staff managers
// only; `senior`: Senior Mod and up. Plain Mods get the report queue, the
// chat viewer and the banned list (owner decision 2026-10-19); JMDs have no
// dashboard at all.
const SECTIONS = [
  { key: 'queue', label: 'Reports', icon: 'flag', tabs: [
    { key: 'reports', label: 'Queue' },
    { key: 'chatViewer', label: 'Chat viewer' },
    { key: 'permRequests', label: 'Perm-ban requests', admin: true },
  ] },
  { key: 'users', label: 'Users', icon: 'people', tabs: [
    { key: 'search', label: 'Find user', senior: true },
    { key: 'userChats', label: 'User chats', admin: true },
    { key: 'banned', label: 'Banned' },
    { key: 'banStats', label: 'Ban stats', senior: true },
  ] },
  { key: 'content', label: 'Content', icon: 'albums', tabs: [
    { key: 'polls', label: 'Polls', senior: true },
    { key: 'statusFeed', label: 'Statuses', senior: true },
    { key: 'news', label: 'News', admin: true },
    // Blocklist editor; supabase/049 checks Senior Mod+ on the server too.
    { key: 'wordFilter', label: 'Word filter', senior: true },
  ] },
  { key: 'audit', label: 'Audit', icon: 'document-text', tabs: [
    // The staff activity log; supabase/047 gates its rpcs the same way.
    { key: 'modLog', label: 'Mod log', senior: true },
    { key: 'reviewIntegrity', label: 'Reviews', senior: true },
  ] },
  { key: 'staff', label: 'Staff', icon: 'key', tabs: [
    { key: 'staffAccess', label: 'Staff access', staffAdmin: true },
  ] },
];

const AdminDashboardScreen = () => {
  const { theme, user: currentUser, isAdmin, isSeniorMod, isModerator, isBabyMod, isUserBlocked, currentUserEmail, api } = useGlobalState();
  const isDark = theme === 'dark';
  const db = useMemo(() => getDatabase(), []);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  // Normalized caller email used by every handler to refuse self-targeting.
  const callerEmailLc = (currentUserEmail || currentUser?.email || '').toLowerCase().trim();
  const isSelf = (e) => !!e && callerEmailLc && e.toLowerCase().trim() === callerEmailLc;

  // Tabs — grouped into sections (see SECTIONS); the report queue opens first.
  const [activeTab, setActiveTab] = useState('reports');

  // ── Status Feed (admin moderation) ──
  const STATUS_PAGE_SIZE = 10;
  const [statusList, setStatusList] = useState([]);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusLoadingMore, setStatusLoadingMore] = useState(false);
  const [statusHasMore, setStatusHasMore] = useState(true);
  const statusCursorRef = React.useRef(null);
  const [statusProfileUser, setStatusProfileUser] = useState(null);

  const fetchStatusFeed = useCallback(async (reset = false) => {
    try {
      const fdb = getFirestore();
      if (reset) {
        setStatusLoading(true);
        statusCursorRef.current = null;
        setStatusHasMore(true);
      } else {
        if (!statusHasMore || statusLoadingMore) return;
        setStatusLoadingMore(true);
      }

      let q = firestoreQuery(
        collection(fdb, 'statuses'),
        orderBy('createdAt', 'desc'),
        limit(STATUS_PAGE_SIZE),
      );
      if (!reset && statusCursorRef.current) {
        q = firestoreQuery(
          collection(fdb, 'statuses'),
          orderBy('createdAt', 'desc'),
          startAfter(statusCursorRef.current),
          limit(STATUS_PAGE_SIZE),
        );
      }

      const snap = await getDocs(q);
      const docs = snap.docs;
      const items = docs.map(d => ({ id: d.id, ...d.data() }));

      if (docs.length > 0) {
        statusCursorRef.current = docs[docs.length - 1];
      }
      if (docs.length < STATUS_PAGE_SIZE) setStatusHasMore(false);

      setStatusList(prev => {
        const merged = reset ? items : [...prev, ...items];
        const seen = new Set();
        return merged.filter(s => {
          if (!s.id || seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });
      });
    } catch (err) {
      console.warn('[AdminDashboard] fetchStatusFeed error:', err?.message);
    } finally {
      setStatusLoading(false);
      setStatusLoadingMore(false);
    }
  }, [statusHasMore, statusLoadingMore]);

  const handleAdminDeleteStatus = useCallback((statusId) => {
    Alert.alert('Delete Status', 'Delete this status permanently?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const fdb = getFirestore();
            await deleteDoc(doc(fdb, 'statuses', statusId));
            setStatusList(prev => prev.filter(s => s.id !== statusId));
          } catch (err) {
            Alert.alert('Error', 'Failed to delete status.');
          }
        },
      },
    ]);
  }, []);

  useEffect(() => {
    if (activeTab === 'statusFeed' && statusList.length === 0) {
      fetchStatusFeed(true);
    }
  }, [activeTab]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Banned Data — single fetch, client-side filtering
  const [allBannedUsers, setAllBannedUsers] = useState([]); // full list
  const [loadingBanned, setLoadingBanned] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bannedSearchQuery, setBannedSearchQuery] = useState('');
  const [strikeFilter, setStrikeFilter] = useState('all'); // 'all' | '1' | '2' | '3+' | 'mute'

  // Ban Summary Stats (computed from allBannedUsers)
  const [banSummary, setBanSummary] = useState(null); // { total, muted, byMod: { modName: count } }
  const banStats = useMemo(() => {
    const out = { muted: 0, s1: 0, s2: 0, perm: 0 };
    allBannedUsers.forEach((u) => {
      if (u.type === 'mute') out.muted += 1;
      else if (u.strikeCount === 1) out.s1 += 1;
      else if (u.strikeCount === 2) out.s2 += 1;
      else if (u.strikeCount >= 3) out.perm += 1;
    });
    return out;
  }, [allBannedUsers]);

  // ─────────────────────────────────────────────
  // Helper: check if a string looks like a Firebase user ID (not a display name)
  const looksLikeUserId = (val) => {
    if (!val || typeof val !== 'string') return false;
    return val.length >= 15 && /^[a-zA-Z0-9]+$/.test(val);
  };

  // ─────────────────────────────────────────────
  // Fetch ALL banned users once — builds list + summary in one pass
  const fetchingBannedRef = React.useRef(false);
  const fetchAllBanned = useCallback(async () => {
    if (fetchingBannedRef.current) return;
    fetchingBannedRef.current = true;
    setLoadingBanned(true);
    try {
      const bannedRef = ref(db, 'banned_users_by_email');
      // Server-side uid bans (functions/banEnforcement.js). Most mirror an
      // email record above; the rest — phone sign-ins, deleted accounts,
      // alts caught on a banned device — exist ONLY here.
      const [snapshot, uidSnap] = await Promise.all([
        get(bannedRef),
        get(ref(db, 'banned_uids')).catch(() => null),
      ]);

      if (!snapshot.exists() && !uidSnap?.exists()) {
        setAllBannedUsers([]);
        setBanSummary({ total: 0, muted: 0, byMod: {} });
        return;
      }

      const list = [];
      const now = Date.now();
      let total = 0;
      let muted = 0;
      const byModId = {};
      const idsToResolve = new Set();

      snapshot.forEach((child) => {
        const encodedEmail = child.key;
        if (BAD_KEYS.has(encodedEmail)) return;
        const entry = child.val();
        const sc = entry?.strikeCount || 0;
        // Mutes are listed too (Mute filter); a mute keeps the strike count,
        // so `type` (or the legacy reason prefix) decides, not strikeCount.
        const type = isMuteRecordCompat(entry) ? 'mute' : 'ban';

        // Skip records that are not active
        const until = entry?.bannedUntil;
        if (until !== 'permanent' && !(typeof until === 'number' && until > now)) return;
        if (type === 'ban' && sc < 1) return;

        const rawBannedBy = typeof entry?.bannedBy === 'string'
          ? entry.bannedBy
          : entry?.bannedBy?.displayName || entry?.bannedBy?.uid || 'Unknown';

        list.push({
          isBanned: true,
          type,
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

        if (type === 'mute') muted++;
        else total++;
        byModId[rawBannedBy] = (byModId[rawBannedBy] || 0) + 1;
        if (looksLikeUserId(rawBannedBy)) {
          idsToResolve.add(rawBannedBy);
        }
      });

      // uid-only bans and mutes: not tied to an email record, still active.
      const listedIds = new Set(list.map((u) => u.id).filter(Boolean));
      const uidOnly = [];
      uidSnap?.forEach?.((child) => {
        const uid = child.key;
        const entry = child.val() || {};
        if (entry.emailKey || listedIds.has(uid)) return;
        const type = isMuteRecordCompat(entry) ? 'mute' : 'ban';
        if (type === 'ban' && (entry.strikeCount || 0) < 1) return;
        const until = entry.bannedUntil;
        if (until !== 'permanent' && !(typeof until === 'number' && until > now)) return;
        uidOnly.push({ uid, entry, type });
      });
      const uidNames = await Promise.all(uidOnly.map(({ uid }) =>
        get(ref(db, `users/${uid}/displayName`)).then((s2) => s2.val()).catch(() => null)
      ));
      uidOnly.forEach(({ uid, entry, type }, i) => {
        const by = entry.bannedByUid || (entry.linkedFrom ? 'Auto (linked account)' : 'Server');
        list.push({
          isBanned: true,
          type,
          email: null,
          encodedEmail: null,
          reason: entry.reason ?? '—',
          strikeCount: entry.strikeCount || 0,
          bannedUntil: entry.bannedUntil ?? null,
          displayName: uidNames[i] || 'Deleted / no-email account',
          avatar: null,
          bannedBy: by,
          bannedAt: entry.bannedAt ?? null,
          id: uid,
          uidOnly: true,
        });
        if (type === 'mute') muted++;
        else total++;
        byModId[by] = (byModId[by] || 0) + 1;
        if (looksLikeUserId(by)) idsToResolve.add(by);
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
      setBanSummary({ total, muted, byMod });
    } catch (err) {
      console.error('Fetch banned error:', err);
    } finally {
      setLoadingBanned(false);
      setRefreshing(false);
      fetchingBannedRef.current = false;
    }
  }, [db]);

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

    // Apply strike / mute filter (strike filters show bans only)
    if (strikeFilter === 'mute') {
      list = list.filter((u) => u.type === 'mute');
    } else if (strikeFilter === '1') {
      list = list.filter((u) => u.type !== 'mute' && u.strikeCount === 1);
    } else if (strikeFilter === '2') {
      list = list.filter((u) => u.type !== 'mute' && u.strikeCount === 2);
    } else if (strikeFilter === '3+') {
      list = list.filter((u) => u.type !== 'mute' && u.strikeCount >= 3);
    }

    // Apply search (name + email)
    const q = bannedSearchQuery.trim().toLowerCase();
    if (q.length >= 1) {
      list = list.filter((u) => {
        const name = (u.displayName || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        // A pasted uid finds uid-only bans (deleted / phone accounts) too.
        return name.includes(q) || email.includes(q) || (u.id || '').toLowerCase() === q;
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
  // Chat viewer "Translate all": message id → translation (staff: no limit).
  const [chatTranslations, setChatTranslations] = useState({});
  const [translatingAll, setTranslatingAll] = useState(false);
  useEffect(() => { setChatTranslations({}); }, [chatMessages]);
  const translateAllMessages = useCallback(async () => {
    const withText = chatMessages.filter((m) => m?.text);
    if (!withText.length || translatingAll) return;
    setTranslatingAll(true);
    const out = await translateMany(withText.map((m) => m.text), { apiKey: api, targetLang: getDeviceLanguage() });
    setTranslatingAll(false);
    const next = {};
    withText.forEach((m, i) => { if (out[i]) next[m.id] = out[i]; });
    if (!Object.keys(next).length) Alert.alert('Translate', 'Could not translate these messages. Try again.');
    setChatTranslations(next);
  }, [chatMessages, translatingAll, api]);
  const autoLoadedChatRef = React.useRef(null);

  // Admin-only inbox lookup for one user (ported from Adopt Me).
  const USER_CHATS_PAGE_SIZE = 20;
  const [userChatsInput, setUserChatsInput] = useState('');
  const [userChatsTarget, setUserChatsTarget] = useState(null);
  const [userChatsResults, setUserChatsResults] = useState([]);
  const [userChatsList, setUserChatsList] = useState([]);
  const [userChatsSearching, setUserChatsSearching] = useState(false);
  const [userChatsLoading, setUserChatsLoading] = useState(false);
  const [userChatsLoadingMore, setUserChatsLoadingMore] = useState(false);
  const [userChatsHasMore, setUserChatsHasMore] = useState(true);
  const [userChatsBulkLoading, setUserChatsBulkLoading] = useState(false);
  const userChatsOffsetRef = React.useRef(0);

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
            isAdmin: u.admin || u.isAdmin || false, isSeniorMod: u.isSeniorMod || false, isModerator: u.isModerator || false, isBabyMod: u.isBabyMod || false,
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
            isAdmin: u.admin || u.isAdmin || false, isSeniorMod: u.isSeniorMod || false, isModerator: u.isModerator || false, isBabyMod: u.isBabyMod || false,
          });
        }

        // Then the email field: indexed prefix query on users_private (staff
        // read), then each match's profile. Replaces orderByChild('email') on
        // /users, which had no index and downloaded the whole node.
        if (results.length === 0) {
          const matches = await findUsersByEmail(db, email, 10);
          const snaps = await Promise.all(matches.map(({ uid }) => get(ref(db, `users/${uid}`)).catch(() => null)));
          matches.forEach(({ uid, email: matchEmail }, i) => {
            const snap = snaps[i];
            if (BAD_KEYS.has(uid) || !snap?.exists()) return;
            const u = snap.val();
            const id = u.id || uid;
            if (seen.has(id)) return;
            seen.add(id);
            results.push({
              isBanned: false, id,
              displayName: u.displayName || u.userName || 'Unknown',
              email: matchEmail, avatar: getAvatarSafe(u),
              robloxUsername: u.robloxUsername,
              isAdmin: u.admin || u.isAdmin || false, isSeniorMod: u.isSeniorMod || false, isModerator: u.isModerator || false, isBabyMod: u.isBabyMod || false,
            });
          });
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
                  isAdmin: u.admin || u.isAdmin || false, isSeniorMod: u.isSeniorMod || false, isModerator: u.isModerator || false, isBabyMod: u.isBabyMod || false,
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
                    isAdmin: u.admin || u.isAdmin || false, isSeniorMod: u.isSeniorMod || false, isModerator: u.isModerator || false, isBabyMod: u.isBabyMod || false,
                  });
                }
              });
            }
          } catch (broadErr) {
            console.warn('Broad search failed:', broadErr.message);
          }
        }
      }

      // Emails moved to users_private (round 2), so /users records stop
      // carrying them after the PII migration. Fill in the missing ones (one
      // small staff-only leaf read per row) so the email column, ban badges
      // and the ban/strike/mute actions keep working.
      // users_private first: the legacy users/{uid}/email leaf can be written
      // by any signed-in user, so it is only the fallback for records the
      // migration hasn't reached.
      const withEmails = await Promise.all(results.slice(0, 50).map(async (r) => {
        const priv = await getUserEmail(db, r.id, { legacy: false });
        return { ...r, email: priv || normalizeEmail(r.email) || undefined };
      }));
      setSearchResults(withEmails);
    } catch (err) {
      console.error('Search error:', err);
      Alert.alert('Search Failed', err.message || 'An unexpected error occurred.');
    } finally {
      setLoadingSearch(false);
    }
  };

  // ✅ Active ban/mute for a search row (email record). Expired records are
  // ignored; `type` tells a mute from a ban.
  const checkUserBanStatus = useCallback(async (email) => {
    if (!email || !db) return null;

    try {
      const encodedEmail = encodeEmailKey(email);
      const snapshot = await get(ref(db, `banned_users_by_email/${encodedEmail}`));
      if (!snapshot.exists()) return null;
      const banData = snapshot.val() || {};
      const until = banData.bannedUntil;
      const active = until === 'permanent' || (typeof until === 'number' && until > Date.now());
      if (!active) return null;
      return {
        ...banData,
        isBanned: true,
        type: isMuteRecordCompat(banData) ? 'mute' : 'ban',
        email,
        encodedEmail,
      };
    } catch (err) {
      console.error('Error checking ban status:', err);
      return null;
    }
  }, [db]);

  // Rows from name/ID search, the chat viewer or a status post may not carry
  // an email (it lives in users_private since round 2). Resolve it from there
  // so the owner check and legacy email-only rows still work.
  const withEmail = async (userItem) => {
    if (!userItem || userItem.email || !userItem.id) return userItem;
    const email = await getUserEmail(db, userItem.id);
    return email ? { ...userItem, email } : userItem;
  };

  // ─────────────────────────────────────────────
  // Moderation. Every action opens the reason prompt (ModActionModal) and
  // then goes to the server by uid (utils.applySanction / liftSanction). The
  // permission checks only hide buttons the server would refuse
  // (contract §2): strict rank, staff targets Senior Mod+, JMD = mute ≤ 1
  // day + unmute, strike 3 below Admin = 30 days + a permanent-ban request,
  // lifts need the original banner's rank.
  const callerRoles = useMemo(() => ({
    isAdmin: !!isAdmin,
    isSeniorMod: !!isSeniorMod,
    isModerator: !!isModerator,
    isBabyMod: !!isBabyMod,
    isOwner: isCurrentUserOwner(),
  }), [isAdmin, isSeniorMod, isModerator, isBabyMod]);
  const canManageStaffAccess = getStaffRank(callerRoles) >= STAFF_RANK.admin;
  const isSeniorPlus = getStaffRank(callerRoles) >= STAFF_RANK.seniorMod;

  // ── Layout: 5 sections, each with its own sub-tabs ──
  const ui = useMemo(() => (isDark
    ? { bg: '#000', surface: '#111113', chip: '#1C1C1E', border: '#232326', text: '#FFF', sub: '#8E8E93' }
    : { bg: '#F2F2F7', surface: '#FFF', chip: '#E9E9EE', border: '#E5E5EA', text: '#000', sub: '#6B6B70' }), [isDark]);
  const roleBadge = isAdmin
    ? { label: 'Admin', color: '#FF3B30' }
    : isSeniorMod
      ? { label: 'Sr Mod', color: '#5E5CE6' }
      : isModerator
        ? { label: 'Mod', color: '#0A84FF' }
        : { label: 'JMod', color: '#BF5AF2' };
  const visibleSections = useMemo(() => SECTIONS
    .map((sec) => ({
      ...sec,
      tabs: sec.tabs.filter((t) => (!t.admin || isAdmin) && (!t.senior || isSeniorPlus) && (!t.staffAdmin || canManageStaffAccess)),
    }))
    .filter((sec) => sec.tabs.length > 0), [isAdmin, isSeniorPlus, canManageStaffAccess]);
  const currentSection = visibleSections.find((sec) => sec.tabs.some((t) => t.key === activeTab)) || visibleSections[0];
  const currentSubTabs = currentSection.tabs;
  // A tab the rank can't see (role just changed) falls back to the first one.
  useEffect(() => {
    if (!visibleSections.some((sec) => sec.tabs.some((t) => t.key === activeTab))) setActiveTab(visibleSections[0].tabs[0].key);
  }, [visibleSections, activeTab]);
  // Each section remembers the sub-tab you were on.
  const lastSubTabRef = React.useRef({});
  useEffect(() => { lastSubTabRef.current[currentSection.key] = activeTab; }, [activeTab, currentSection.key]);
  const selectSection = useCallback((sec) => {
    const remembered = lastSubTabRef.current[sec.key];
    setActiveTab(sec.tabs.some((t) => t.key === remembered) ? remembered : sec.tabs[0].key);
  }, []);

  const [selectedRoles, setSelectedRoles] = useState(null);
  const [selectedSanction, setSelectedSanction] = useState(null);
  const [selectedBannerRoles, setSelectedBannerRoles] = useState(null);
  const [modAction, setModAction] = useState(null); // { kind, value, userItem }
  const selectedIdRef = React.useRef(null);

  // Fresh roles + current sanction for the user in the detail sheet.
  const loadSelectedModeration = useCallback(async (userItem, email) => {
    const key = userItem?.id || email || null;
    selectedIdRef.current = key;
    setSelectedRoles(null);
    setSelectedSanction(null);
    setSelectedBannerRoles(null);
    if (!key) return;
    try {
      const [roles, status] = await Promise.all([
        userItem?.id ? fetchUserRoles(userItem.id) : Promise.resolve(null),
        getSanctionStatus(userItem?.id || null, email || null),
      ]);
      const bannerRoles = status.active && status.bannedByUid ? await fetchUserRoles(status.bannedByUid) : null;
      if (selectedIdRef.current !== key) return;
      setSelectedRoles(roles || {
        isAdmin: !!userItem?.isAdmin,
        isSeniorMod: !!userItem?.isSeniorMod,
        isModerator: !!userItem?.isModerator,
        isBabyMod: !!userItem?.isBabyMod,
        isOwner: userItem?.owner === true,
      });
      setSelectedSanction(status);
      setSelectedBannerRoles(bannerRoles);
    } catch (err) {
      console.warn('[AdminDashboard] load moderation status failed:', err?.message);
      if (selectedIdRef.current === key) {
        setSelectedRoles({ isOwner: userItem?.owner === true });
        setSelectedSanction({ active: false, type: null, strikeCount: 0 });
      }
    }
  }, []);

  const selectedPerms = useMemo(
    () => getModPermissions(callerRoles, selectedRoles || {}),
    [callerRoles, selectedRoles]
  );
  // Strike 3 below Admin = 30 days + a request (server decides; labels follow).
  const ladder = { permanentAllowed: selectedPerms.canPermaban };
  const canLiftSelected = !!(
    selectedSanction?.active &&
    canLiftSanction(callerRoles, selectedRoles || {}, selectedSanction.type, selectedBannerRoles)
  );

  const isSelfItem = (u) => !!u && ((u.id && u.id === currentUser?.id) || isSelf(u.email));

  const openModAction = async (item, action) => {
    const userItem = await withEmail(item);
    if (!userItem?.id && !userItem?.email) {
      Alert.alert('Error', 'This user has no ID or email.');
      return;
    }
    if (isSelfItem(userItem)) {
      Alert.alert('Permission Denied', 'You cannot moderate yourself.');
      return;
    }
    setModAction({ ...action, userItem });
  };

  // Ban = the next strike on the ladder, read from the one server counter.
  const handleBan = async (item) => {
    const userItem = await withEmail(item);
    const strikeCount = nextStrikeCount(await getCurrentStrikeCount(userItem?.id, userItem?.email));
    await openModAction(userItem, { kind: 'strike', value: strikeCount });
  };

  const handleSetStrike = (item, strikeCount) => openModAction(item, { kind: 'strike', value: strikeCount });

  const handleMuteUser = (item, minutes) => {
    if (selectedPerms.maxMuteMinutes && minutes > selectedPerms.maxMuteMinutes) {
      Alert.alert('Permission Denied', sanctionErrorText('rank_limit'));
      return;
    }
    openModAction(item, { kind: 'mute', value: minutes });
  };

  // Unban or unmute (whichever is active) — server only, no direct delete.
  const handleUnban = (item) => {
    const type = selectedSanction?.type || item?.type || 'ban';
    openModAction(item, { kind: type === 'mute' ? 'unmute' : 'unban' });
  };

  const confirmModAction = async ({ reason, evidence }) => {
    const a = modAction;
    if (!a?.userItem) return true;
    const u = a.userItem;
    let r;
    if (a.kind === 'unban' || a.kind === 'unmute') {
      if (!u.id) {
        Alert.alert('Error', 'This record has no user ID, so the server cannot lift it.');
        return false;
      }
      r = await liftSanction({ action: a.kind, targetUid: u.id, reason });
    } else {
      r = await applySanction({
        action: a.kind,
        targetUid: u.id || null,
        email: u.email || null,
        strikeCount: a.kind === 'strike' ? a.value : undefined,
        minutes: a.kind === 'mute' ? a.value : undefined,
        reason,
        evidence,
        userInfo: { id: u.id, displayName: u.displayName, avatar: u.avatar, ...(selectedRoles || {}) },
        bannerInfo: {
          id: currentUser?.id,
          displayName: currentUser?.userName || currentUser?.displayName || 'Staff',
          avatar: currentUser?.avatar,
          ...callerRoles,
        },
      });
    }
    if (!r.ok) {
      Alert.alert('Error', sanctionErrorText(r.error));
      return false; // keep the prompt open
    }
    const detail = describeSanctionResult(r);
    if (a.kind === 'unban') Alert.alert('User Unbanned', 'Ban has been lifted.');
    else if (a.kind === 'unmute') Alert.alert('User Unmuted', 'Mute has been lifted.');
    else if (a.kind === 'mute') Alert.alert('User Muted', `Muted for ${formatMuteMinutes(a.value)}.`);
    else Alert.alert('Strike Applied', `Strike ${a.value} applied (${strikeDurationLabel(a.value, ladder)}). ${detail}`.trim());

    // Refresh the sheet, the banned list and the search row's cached status.
    loadSelectedModeration(u, u.email);
    fetchAllBanned();
    if (u.email) {
      setUserBanStatus((prev) => {
        const next = { ...prev };
        delete next[u.email];
        return next;
      });
    }
    return true;
  };

  const modActionTitle = (a) => {
    if (!a) return '';
    const name = a.userItem?.displayName || a.userItem?.email || 'this user';
    if (a.kind === 'strike') return `Strike ${a.value} (${strikeDurationLabel(a.value, ladder)}) — ${name}`;
    if (a.kind === 'mute') return `Mute ${name} for ${formatMuteMinutes(a.value)}`;
    if (a.kind === 'unmute') return `Unmute ${name}`;
    return `Unban ${name}`;
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
      // Rows opened from the Reports tab carry only a uid — fill in the name.
      if (userData) {
        setSelectedUser((prev) => (prev && prev.id === userId && !prev.displayName
          ? { ...prev, displayName: userData.displayName || userData.userName || 'Unknown', avatar: prev.avatar || userData.avatar }
          : prev));
      }

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
  // Delete a Review (Admin can delete any, Mod cannot delete mod/admin reviews)
  const handleDeleteReview = useCallback(async (review) => {
    if (!review?.id || !selectedUser?.id) return;

    // Staff may only delete a review left by someone STRICTLY below them
    // (same ladder as every other moderation action, fresh RTDB roles).
    if (!(await canRemoveReview(review.fromUserId, callerRoles, currentUser?.id, selectedUser.id))) {
      Alert.alert('Restricted', 'Only admins can delete reviews, and not reviews left by staff at or above your rank.');
      return;
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
              // Get the rating before deleting so we can update the summary
              const ratingToRemove = parseRatingSafe(review?.rating);

              // Delete the review and update the ratings summary
              await deleteReviewAndSummary(getFirestore(), {
                id: review.id,
                toUserId: selectedUser.id,
                rating: ratingToRemove,
              });

              // Remove from local state
              setReviews((prev) => prev.filter((r) => r.id !== review.id));
              logModAction('review_delete', selectedUser.id, {
                reviewId: review.id,
                reviewerUid: review.fromUserId || null,
                rating: ratingToRemove,
              });

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
  }, [selectedUser, fetchUserDetails, callerRoles, currentUser?.id]);

  const handleSelectUser = useCallback(async (userItem) => {
    setSelectedUser(userItem);
    setUserDetails(null);
    setReviews([]);
    setHasMoreReviews(true);
    setLastReviewKey(null);

    if (userItem.id) {
      fetchUserDetails(userItem.id);
      fetchReviews(userItem.id, true);
    }
    // No email on the row → look it up in users_private (staff read) so the
    // details header, owner check and moderation history still work.
    let email = userItem.email;
    if (!email && userItem.id) {
      email = await getUserEmail(db, userItem.id);
      if (email) setSelectedUser((prev) => (prev && prev.id === userItem.id ? { ...prev, email } : prev));
    }
    loadSelectedModeration(userItem, email || null);
  }, [db, fetchUserDetails, fetchReviews, loadSelectedModeration]);

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
          isSeniorMod: u.isSeniorMod || false,
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
        const encoded = encodeEmailKey(raw);
        // Try banned_users_by_email for userId
        const banSnap = await get(ref(db, `banned_users_by_email/${encoded}/userId`));
        if (banSnap.exists()) {
          const uid = banSnap.val();
          const userSnap = await get(ref(db, `users/${uid}`));
          if (userSnap.exists()) addUser({ ...userSnap.val(), id: uid });
        }
        // Also search users_private by email (indexed, staff read) — the old
        // orderByChild('email') on /users had no index.
        const matches = await findUsersByEmail(db, raw, 5);
        await Promise.all(matches.map(async ({ uid, email }) => {
          const userSnap = await get(ref(db, `users/${uid}`));
          if (userSnap.exists()) addUser({ ...userSnap.val(), id: uid, email });
        }));
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

      const matches = results.slice(0, 8);
      setResults(matches);
      return matches;
    } catch (err) {
      console.error('Chat user search error:', err);
      setResults([]);
      return [];
    } finally {
      setSearching(false);
    }
  }, [db]);

  const fetchUserChats = useCallback(async (target, reset = false) => {
    if (!isAdmin || !target?.id) return;
    if (reset) {
      setUserChatsLoading(true);
      userChatsOffsetRef.current = 0;
      setUserChatsHasMore(true);
    } else {
      if (!userChatsHasMore || userChatsLoadingMore || userChatsLoading) return;
      setUserChatsLoadingMore(true);
    }
    try {
      const rows = await adminListUserChats(target.id, reset ? 0 : userChatsOffsetRef.current, USER_CHATS_PAGE_SIZE);
      const items = (rows || []).map((row) => ({
        partnerId: row.partnerId,
        chatId: row.chatId,
        lastMessage: row.lastMessage || '',
        timestamp: row.timestamp || 0,
        unreadCount: row.unreadCount || 0,
        partnerName: row.receiverName || 'Unknown',
        partnerAvatar: row.receiverAvatar || DEFAULT_AVATAR,
      })).filter((row) => row.partnerId);
      userChatsOffsetRef.current = (reset ? 0 : userChatsOffsetRef.current) + (rows || []).length;
      setUserChatsHasMore((rows || []).length === USER_CHATS_PAGE_SIZE);
      setUserChatsList((previous) => reset ? items : [...previous, ...items]);
    } catch (err) {
      console.warn('[AdminDashboard] fetchUserChats failed:', err?.message);
      Alert.alert('Could not load chats', err?.message || 'The admin chat lookup failed.');
    } finally {
      setUserChatsLoading(false);
      setUserChatsLoadingMore(false);
    }
  }, [isAdmin, userChatsHasMore, userChatsLoadingMore, userChatsLoading]);

  // Temporary admin audit path: bulk-read recent messages for the first 50
  // conversations and write them only to the app cache for local review.
  const exportRecentUserChatsForReview = useCallback(async () => {
    if (!isAdmin || !userChatsTarget?.id || userChatsBulkLoading) return;
    setUserChatsBulkLoading(true);
    const pageSize = 20;
    try {
      const rows = [];
      for (let offset = 0; offset < 60 && rows.length < 50; offset += pageSize) {
        const page = await adminListUserChats(userChatsTarget.id, offset, pageSize);
        if (!page.length) break;
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      const targets = rows.slice(0, 50).filter((row) => row.partnerId);
      const conversations = [];
      for (let start = 0; start < targets.length; start += 4) {
        const chunk = targets.slice(start, start + 4);
        conversations.push(...await Promise.all(chunk.map(async (row) => {
          const chatId = row.chatId || [userChatsTarget.id, row.partnerId].sort().join('_');
          const messages = await sbLoadPrivateMessages(chatId, { limit: 200 });
          return {
            partnerId: row.partnerId,
            partnerName: row.receiverName || null,
            chatId,
            lastMessage: row.lastMessage || null,
            timestamp: row.timestamp || 0,
            messages: (messages || []).map((message) => ({
              senderId: message.senderId,
              timestamp: message.timestamp || null,
              text: message.text || '',
              imageUrl: message.imageUrl || null,
              gif: message.gif || null,
              fruits: message.fruits || null,
              deleted: !!message.deleted,
            })),
          };
        })));
      }
      const path = `${RNFS.CachesDirectoryPath}/blox_admin_dm_review.json`;
      await RNFS.writeFile(path, JSON.stringify({
        target: { id: userChatsTarget.id, displayName: userChatsTarget.displayName },
        exportedAt: new Date().toISOString(),
        conversationCount: conversations.length,
        conversations,
      }), 'utf8');
      Alert.alert('Review data ready', `Loaded ${conversations.length} conversations for local review.`);
    } catch (err) {
      console.warn('[AdminDashboard] bulk DM review export failed:', err?.message);
      Alert.alert('Could not load review data', err?.message || 'The bulk chat read failed.');
    } finally {
      setUserChatsBulkLoading(false);
    }
  }, [isAdmin, userChatsTarget, userChatsBulkLoading]);

  const selectUserChatsTarget = useCallback((target) => {
    setUserChatsResults([]);
    setUserChatsInput('');
    setUserChatsTarget(target);
    setUserChatsList([]);
    userChatsOffsetRef.current = 0;
    fetchUserChats(target, true);
  }, [fetchUserChats]);

  const loadUserChatsForInput = useCallback(async () => {
    const raw = userChatsInput.trim();
    if (!raw) { Alert.alert('Search user', 'Enter a name, email, or user ID.'); return; }
    Keyboard.dismiss();
    setUserChatsSearching(true);
    try {
      const matches = await searchChatUser(raw, 1);
      if (!matches.length) {
        setUserChatsResults([]);
        Alert.alert('Not found', 'No user matches that name, email, or ID.');
      } else if (matches.length === 1) {
        selectUserChatsTarget(matches[0]);
      } else {
        setUserChatsResults(matches);
      }
    } finally {
      setUserChatsSearching(false);
    }
  }, [userChatsInput, searchChatUser, selectUserChatsTarget]);

  const clearUserChatsTarget = useCallback(() => {
    setUserChatsTarget(null);
    setUserChatsInput('');
    setUserChatsResults([]);
    setUserChatsList([]);
    userChatsOffsetRef.current = 0;
    setUserChatsHasMore(true);
  }, []);

  const openChatFromUserChats = useCallback((entry) => {
    if (!userChatsTarget?.id || !entry?.partnerId) return;
    setChatPerson1(userChatsTarget);
    setChatPerson2({
      id: entry.partnerId,
      displayName: entry.partnerName || 'Unknown',
      avatar: entry.partnerAvatar || DEFAULT_AVATAR,
    });
    setChatSearch1(''); setChatSearch2('');
    setChatResults1([]); setChatResults2([]);
    setSelectedReport(null);
    setChatMessages([]);
    autoLoadedChatRef.current = null;
    setActiveTab('chatViewer');
  }, [userChatsTarget]);

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
      // Supabase returns newest-first; the rest of this dashboard
      // expects ascending order, so reverse before storing.
      const rows = await sbLoadPrivateMessages(chatKey, { limit: 50 });
      const msgs = (rows || []).slice().reverse();
      setChatMessages(msgs);
    } catch (err) {
      console.error('Chat load error:', err);
      Alert.alert('Error', `Could not load chat: ${err?.message || 'unknown error'}`);
    } finally {
      setLoadingChat(false);
    }
  }, [chatPerson1, chatPerson2]);

  useEffect(() => {
    const chatKey = chatPerson1?.id && chatPerson2?.id
      ? [chatPerson1.id, chatPerson2.id].sort().join('_')
      : null;
    if (activeTab === 'chatViewer' && isAdmin && !selectedReport && chatKey && !chatMessages.length && !loadingChat && autoLoadedChatRef.current !== chatKey) {
      autoLoadedChatRef.current = chatKey;
      loadChat();
    }
  }, [activeTab, isAdmin, selectedReport, chatPerson1?.id, chatPerson2?.id, chatMessages.length, loadingChat, loadChat]);

  // ─────────────────────────────────────────────
  // Reported Chats — fetch from Firestore (for mods)
  const fetchChatReports = useCallback(async () => {
    setLoadingReports(true);
    try {
      const firestoreDB = getFirestore();
      const reportsRef = collection(firestoreDB, 'chat_reports');
      // Order by createdAt only (single-field → uses Firestore's automatic
      // index). Previously this also filtered `where('chatConsent','==',true)`,
      // which combined with the orderBy REQUIRES a composite index that was
      // never created — so the query threw FAILED_PRECONDITION and mods saw an
      // empty list. Every report is written with chatConsent:true anyway
      // (Scamwarning.js), so we filter it client-side instead of in the query.
      const q = firestoreQuery(reportsRef, orderBy('createdAt', 'desc'), limit(30));
      const snapshot = await getDocs(q);
      const list = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => r.chatConsent === true);
      setChatReports(list);
    } catch (err) {
      // Surface the real reason (missing index, insufficient permissions, …)
      // instead of leaving mods staring at a silent empty list.
      console.error('Fetch chat reports error:', err);
      Alert.alert('Could not load reports', err?.message || 'Unknown error while loading reported chats.');
    } finally {
      setLoadingReports(false);
    }
  }, []);

  useEffect(() => {
    // Every non-admin staff member (Senior Mods too) gets the reported-chat
    // list here; admins reach the same reports from the Reports tab.
    if (activeTab === 'chatViewer' && !isAdmin) fetchChatReports();
  }, [activeTab, isAdmin, fetchChatReports]);

  // Load chat from a report (mod clicks a reported chat)
  const loadChatFromReport = useCallback(async (report) => {
    setSelectedReport(report);
    setLoadingChat(true);
    setChatMessages([]);
    // Set person info from the report
    setChatPerson1({ id: report.reportedBy, displayName: report.reporterName || report.reportedBy });
    setChatPerson2({ id: report.reportedUser, displayName: report.reportedUserName || report.reportedUser });

    try {
      const rows = await sbLoadPrivateMessages(report.chatKey, { limit: 50 });
      const msgs = (rows || []).slice().reverse();
      setChatMessages(msgs);
    } catch (err) {
      console.error('Chat load from report error:', err);
      Alert.alert('Error', `Could not load reported chat: ${err?.message || 'unknown error'}`);
    } finally {
      setLoadingChat(false);
    }
  }, []);

  // Mark report as reviewed
  // movedFrom = a report about staff, moved to chat_reports_restricted (functions/reportRouting.js).
  const markReportReviewed = useCallback(async (reportId, movedFrom) => {
    try {
      const firestoreDB = getFirestore();
      await updateDoc(doc(firestoreDB, movedFrom ? 'chat_reports_restricted' : 'chat_reports', reportId), { status: 'reviewed' });
      setChatReports(prev => prev.map(r => r.id === reportId ? { ...r, status: 'reviewed' } : r));
      Alert.alert('Done', 'Report marked as reviewed.');
    } catch (err) {
      console.error('Mark reviewed error:', err);
    }
  }, []);

  // Delete report
  const deleteChatReport = useCallback(async (reportId, movedFrom) => {
    Alert.alert('Delete Report', 'Are you sure you want to delete this report?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            const firestoreDB = getFirestore();
            await deleteDoc(doc(firestoreDB, movedFrom ? 'chat_reports_restricted' : 'chat_reports', reportId));
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
  // Polls Management (Supabase-native — see supabase/015_polls.sql)
  const fetchPolls = useCallback(async () => {
    setLoadingPolls(true);
    try {
      const list = await sbFetchAllPolls(10);
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
      await sbCreatePoll({
        question: q,
        optionTexts: opts,
        imageUrl: pollImageUrl.trim() || null,
        createdBy: currentUser?.id || null,
      });
      setPollQuestion('');
      setPollOptions(['', '']);
      setPollImageUrl('');
      Alert.alert('Success', 'Poll created!');
      fetchPolls();
    } catch (err) {
      console.error('Create poll error:', err);
      // Show the real Supabase error. An RLS denial ("new row violates
      // row-level security policy") means the account isn't an admin in
      // user_roles; a missing-relation error means migration 015_polls.sql
      // hasn't been applied to this project.
      Alert.alert('Could not create poll', err?.message || 'Unknown error.');
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
                imageUri = (await safeCompressImage(imageUri, {
                  maxWidth: 1024, quality: 0.7, returnableOutputType: 'uri',
                })).uri;
              } catch (e) { console.warn('Compression failed, using original:', e); }
            }

            // Upload through the server (stored under polls/ as before)
            const cdnUrl = await uploadImage(imageUri, UPLOAD_KIND.poll);
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
            await sbDeletePoll(pollId);
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
      await sbSetPollActive(pollItem.id, !pollItem.active);
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
        const foundBan = allBannedUsers.find((b) => (item.email && b.email === item.email) || (item.id && b.id === item.id));
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
      // Cache "not banned" too (false), or every render re-reads the record.
      checkUserBanStatus(item.email).then((banData) => {
        setUserBanStatus((prev) => ({
          ...prev,
          [item.email]: banData || false,
        }));
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
        <Image resizeMethod="resize" source={{ uri: avatarUri }} style={styles.avatar} />
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
            <View style={[styles.bannedBadge, merged.type === 'mute' && { backgroundColor: '#7C3AED' }]}>
              <Text style={styles.bannedText}>
                {merged.type === 'mute' ? 'MUTED' : `BANNED${merged.strikeCount ? ` · S${merged.strikeCount}` : ''}`}
              </Text>
            </View>
          ) : (
            <View style={styles.activeBadge}><Text style={styles.activeText}>ACTIVE</Text></View>
          )}
          <Ionicons name="ellipsis-vertical" size={20} color={isDark ? '#555' : '#CCC'} style={{ marginLeft: 8 }} />
        </View>
      </TouchableOpacity>
    );
  };

  // ✅ Banned admins/mods must not be able to operate the dashboard at all.
  // The button is also hidden upstream — this is the inside-the-room defense
  // in case anything (deep link, stale stack) lands them here. It sits after
  // every hook: returning before them changed the hook count between renders
  // (crash when isUserBlocked flipped while the dashboard was open).
  if (isUserBlocked) {
    return (
      <View style={{ flex: 1, backgroundColor: isDark ? '#0f172a' : '#f8fafc', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: isDark ? '#f1f5f9' : '#0f172a', marginBottom: 8, textAlign: 'center' }}>
          Dashboard Locked
        </Text>
        <Text style={{ fontSize: 13, color: isDark ? '#94a3b8' : '#64748b', textAlign: 'center', marginBottom: 16 }}>
          Your account is currently restricted. Contact a senior admin to lift the restriction — you cannot moderate while banned.
        </Text>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, backgroundColor: '#3b82f6' }}
        >
          <Text style={{ color: '#fff', fontWeight: '600' }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: ui.bg }]}>
      {/* Header: back, title, role */}
      <View style={[styles.header, { borderBottomColor: ui.border, backgroundColor: ui.surface, paddingTop: insets.top + 6 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.headerBack, { backgroundColor: ui.chip }]} hitSlop={8}>
            <Ionicons name="chevron-back" size={20} color={ui.text} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={[styles.headerTitle, { color: ui.text }]} numberOfLines={1}>Mod Panel</Text>
            <Text style={{ color: ui.sub, fontSize: 11.5 }} numberOfLines={1}>
              {currentSection.label} · {currentSubTabs.find((x) => x.key === activeTab)?.label || ''}
            </Text>
          </View>
          <View style={[styles.roleChip, { backgroundColor: `${roleBadge.color}22` }]}>
            <Ionicons name="shield-checkmark" size={12} color={roleBadge.color} />
            <Text style={{ color: roleBadge.color, fontSize: 11.5, fontWeight: '800', marginLeft: 4 }}>{roleBadge.label}</Text>
          </View>
        </View>

        {/* Sections — every one fits on screen, no sideways scrolling */}
        <View style={styles.sectionBar}>
          {visibleSections.map((sec) => {
            const on = sec.key === currentSection.key;
            return (
              <TouchableOpacity
                key={sec.key}
                onPress={() => selectSection(sec)}
                activeOpacity={0.8}
                style={[styles.sectionItem, on && { backgroundColor: `${ACCENT}1F` }]}
              >
                <Ionicons name={on ? sec.icon : `${sec.icon}-outline`} size={19} color={on ? ACCENT : ui.sub} />
                <Text style={{ fontSize: 11, fontWeight: on ? '800' : '600', color: on ? ACCENT : ui.sub, marginTop: 2 }} numberOfLines={1}>
                  {sec.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Sub-tabs of the current section (segmented control) */}
      {currentSubTabs.length > 1 && (
        <View style={[styles.segment, { backgroundColor: ui.chip }]}>
          {currentSubTabs.map((tab) => {
            const on = tab.key === activeTab;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.8}
                style={[styles.segmentItem, on && [styles.segmentItemOn, { backgroundColor: ui.surface }]]}
              >
                <Text style={{ fontSize: 12.5, fontWeight: on ? '800' : '600', color: on ? ui.text : ui.sub }} numberOfLines={1}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {currentSubTabs.length <= 1 && <View style={{ height: 10 }} />}

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

          {/* Strike / Mute Filter Pills */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 10, gap: 8 }}>
            {[
              { key: 'all', label: 'All' },
              { key: '1', label: 'Strike 1' },
              { key: '2', label: 'Strike 2' },
              { key: '3+', label: 'Permanent' },
              { key: 'mute', label: 'Muted' },
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
          </ScrollView>

          {loadingBanned && !refreshing && allBannedUsers.length === 0 ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={filteredBannedUsers}
              keyExtractor={(item) => item.encodedEmail || `uid-${item.id}`}
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
      ) : activeTab === 'banStats' ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ui.text} />}
        >
          {!banSummary ? (
            <ActivityIndicator size="small" color={ACCENT} style={{ marginTop: 30 }} />
          ) : (
            <>
              <View style={styles.statGrid}>
                {[
                  { label: 'Restricted', value: banSummary.total, color: '#FF3B30', icon: 'shield' },
                  { label: 'Muted', value: banStats.muted, color: '#BF5AF2', icon: 'volume-mute' },
                  { label: 'Strike 1', value: banStats.s1, color: '#FF9F0A', icon: 'alert-circle' },
                  { label: 'Strike 2', value: banStats.s2, color: '#FF6B00', icon: 'warning' },
                  { label: 'Permanent', value: banStats.perm, color: '#FF3B30', icon: 'ban' },
                  { label: 'Moderators', value: Object.keys(banSummary.byMod).length, color: ACCENT, icon: 'people' },
                ].map((c) => (
                  <View key={c.label} style={[styles.statCard, { backgroundColor: ui.surface, borderColor: ui.border }]}>
                    <View style={[styles.statIcon, { backgroundColor: `${c.color}1F` }]}>
                      <Ionicons name={c.icon} size={16} color={c.color} />
                    </View>
                    <Text style={{ fontSize: 22, fontWeight: '800', color: ui.text, marginTop: 8 }}>{c.value}</Text>
                    <Text style={{ fontSize: 11.5, color: ui.sub, fontWeight: '600' }}>{c.label}</Text>
                  </View>
                ))}
              </View>

              <Text style={[styles.sectionLabel, { color: ui.sub }]}>Actions by moderator</Text>
              <View style={[styles.listCard, { backgroundColor: ui.surface, borderColor: ui.border }]}>
                {Object.entries(banSummary.byMod).length === 0 ? (
                  <Text style={{ color: ui.sub, padding: 14 }}>No actions yet.</Text>
                ) : Object.entries(banSummary.byMod)
                  .sort(([, x], [, y]) => y - x)
                  .map(([modName, count], i, arr) => (
                    <View
                      key={modName}
                      style={{
                        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11,
                        borderBottomWidth: i === arr.length - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: ui.border,
                      }}
                    >
                      <Text style={{ width: 22, color: ui.sub, fontSize: 12, fontWeight: '700' }}>{i + 1}</Text>
                      <Text style={{ flex: 1, color: ui.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{modName}</Text>
                      <View style={{ backgroundColor: '#FF3B301A', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 }}>
                        <Text style={{ color: '#FF3B30', fontSize: 13, fontWeight: '800' }}>{count}</Text>
                      </View>
                    </View>
                  ))}
              </View>
            </>
          )}
        </ScrollView>
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
      ) : activeTab === 'userChats' && isAdmin ? (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
            <Text style={{ color: ui.sub, fontSize: 11, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Target user</Text>
            {userChatsTarget ? (
              <>
                <View style={[styles.selectedPersonCard, { backgroundColor: ui.surface, borderColor: ui.border }]}>
                  <Image resizeMethod="resize" source={{ uri: userChatsTarget.avatar }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#DDD' }} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: ui.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{userChatsTarget.displayName}</Text>
                    <Text style={{ color: ui.sub, fontSize: 11 }} numberOfLines={1}>{userChatsTarget.email || userChatsTarget.id}</Text>
                  </View>
                  <TouchableOpacity onPress={clearUserChatsTarget} style={{ padding: 4 }}>
                    <Ionicons name="close-circle" size={22} color={ui.sub} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  onPress={exportRecentUserChatsForReview}
                  disabled={userChatsBulkLoading}
                  style={{ alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', backgroundColor: '#5856D6', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, marginTop: 8 }}
                >
                  {userChatsBulkLoading ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="download-outline" size={16} color="#FFF" />}
                  <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700', marginLeft: 5 }}>{userChatsBulkLoading ? 'Loading 50 chats…' : 'Load 50 chats for review'}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.searchContainer}>
                <TextInput
                  value={userChatsInput}
                  onChangeText={setUserChatsInput}
                  placeholder="Name, email, or user ID..."
                  placeholderTextColor={ui.sub}
                  style={[styles.searchInput, { backgroundColor: ui.surface, color: ui.text, borderColor: ui.border }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={loadUserChatsForInput}
                />
                <TouchableOpacity style={[styles.searchBtn, { backgroundColor: '#34C759' }]} onPress={loadUserChatsForInput} disabled={userChatsSearching}>
                  {userChatsSearching ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="search" size={20} color="#FFF" />}
                </TouchableOpacity>
              </View>
            )}
            {userChatsResults.length > 0 && (
              <View style={[styles.chatDropdown, { backgroundColor: ui.surface, borderColor: ui.border }]}>
                {userChatsResults.map((u) => (
                  <TouchableOpacity key={u.id} onPress={() => selectUserChatsTarget(u)} style={[styles.chatDropdownItem, { borderBottomColor: ui.border }]}>
                    <Image resizeMethod="resize" source={{ uri: u.avatar }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#DDD' }} />
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={{ color: ui.text, fontSize: 14, fontWeight: '500' }} numberOfLines={1}>{u.displayName}</Text>
                      <Text style={{ color: ui.sub, fontSize: 11 }} numberOfLines={1}>{u.email || u.id}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          {userChatsLoading && userChatsList.length === 0 ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={userChatsList}
              keyExtractor={(item) => item.partnerId}
              contentContainerStyle={styles.listContent}
              onEndReachedThreshold={0.3}
              onEndReached={() => {
                if (userChatsTarget && userChatsHasMore && !userChatsLoadingMore && !userChatsLoading) fetchUserChats(userChatsTarget, false);
              }}
              ListEmptyComponent={(
                <View style={styles.emptyState}>
                  <Ionicons name="chatbubbles-outline" size={48} color={ui.sub} />
                  <Text style={[styles.emptyText, { color: ui.sub }]}>{userChatsTarget ? 'No private chats for this user' : 'Search a name, email, or user ID to view their private chats'}</Text>
                </View>
              )}
              ListFooterComponent={userChatsLoadingMore ? <ActivityIndicator size="small" color="#007AFF" style={{ marginVertical: 12 }} /> : null}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => openChatFromUserChats(item)} style={[styles.listCard, { backgroundColor: ui.surface, borderColor: ui.border, flexDirection: 'row', alignItems: 'center', padding: 12, marginHorizontal: 16, marginBottom: 8 }]}>
                  <Image resizeMethod="resize" source={{ uri: item.partnerAvatar }} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#DDD' }} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: ui.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{item.partnerName}</Text>
                    <Text style={{ color: ui.sub, fontSize: 13, marginTop: 3 }} numberOfLines={1}>{item.lastMessage || '—'}</Text>
                    <Text style={{ color: ui.sub, fontSize: 11, marginTop: 3 }}>{item.timestamp ? timeAgo(item.timestamp) : ''}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={ui.sub} />
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      ) : activeTab === 'chatViewer' ? (
        <View style={{ flex: 1 }}>

          {/* ── ADMIN: Free search (unless viewing a report from the Reports tab) ── */}
          {isAdmin && !selectedReport ? (
            <>
              <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 10 }}>
                {/* Both people picked: one compact row (names, View) instead of
                    two cards and a full-width button, so the conversation gets
                    the screen. Tap a name to swap that person out. */}
                {chatPerson1 && chatPerson2 ? (
                  <View style={[styles.pairBar, { backgroundColor: isDark ? '#1C1C1E' : '#FFF', borderColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
                    {[[chatPerson1, 1], [chatPerson2, 2]].map(([p, n]) => (
                      <React.Fragment key={n}>
                        {n === 2 ? <Ionicons name="swap-horizontal" size={16} color={isDark ? '#555' : '#BBB'} style={{ marginHorizontal: 4 }} /> : null}
                        <TouchableOpacity
                          style={styles.pairPerson}
                          onPress={() => {
                            if (n === 1) { setChatPerson1(null); setChatSearch1(''); setChatResults1([]); } else { setChatPerson2(null); setChatSearch2(''); setChatResults2([]); }
                            setChatMessages([]);
                          }}
                        >
                          <Image resizeMethod="resize" source={{ uri: p.avatar }} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#DDD' }} />
                          <Text style={{ color: isDark ? '#FFF' : '#000', fontSize: 13.5, fontWeight: '600', marginLeft: 6, flexShrink: 1 }} numberOfLines={1}>{p.displayName}</Text>
                        </TouchableOpacity>
                      </React.Fragment>
                    ))}
                    <TouchableOpacity onPress={loadChat} disabled={loadingChat} style={styles.pairView}>
                      <Ionicons name="chatbubbles" size={14} color="#FFF" />
                      <Text style={{ color: '#FFF', fontSize: 12.5, fontWeight: '800', marginLeft: 4 }}>View</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                  {/* Person 1 */}
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ color: isDark ? '#888' : '#666', fontSize: 11, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Person 1</Text>
                    {chatPerson1 ? (
                      <View style={[styles.selectedPersonCard, { backgroundColor: isDark ? '#1C1C1E' : '#FFF', borderColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
                        <Image resizeMethod="resize" source={{ uri: chatPerson1.avatar }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#DDD' }} />
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
                                <Image resizeMethod="resize" source={{ uri: u.avatar }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#DDD' }} />
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
                        <Image resizeMethod="resize" source={{ uri: chatPerson2.avatar }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#DDD' }} />
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
                                <Image resizeMethod="resize" source={{ uri: u.avatar }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#DDD' }} />
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
                  </>
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
                        onPress={() => markReportReviewed(selectedReport.id, selectedReport.movedFrom)}
                        style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#34C759', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
                      >
                        <Ionicons name="checkmark-circle" size={16} color="#FFF" />
                        <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700', marginLeft: 4 }}>Mark Reviewed</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => deleteChatReport(selectedReport.id, selectedReport.movedFrom)}
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
              {!loadingChat && chatMessages.some((m) => m?.text) && (
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 2 }}>
                  <TouchableOpacity onPress={translateAllMessages} disabled={translatingAll} style={{ flexDirection: 'row', alignItems: 'center', padding: 4 }}>
                    {translatingAll ? <ActivityIndicator size="small" /> : <Ionicons name="language-outline" size={14} color="#007AFF" />}
                    <Text style={{ color: '#007AFF', fontSize: 12, fontWeight: '600', marginLeft: 4 }}>Translate all</Text>
                  </TouchableOpacity>
                </View>
              )}
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
                          <TranslatableText
                            text={item.text}
                            isDark={isDark}
                            translation={chatTranslations[item.id] || null}
                            style={{ color: isDark ? '#FFF' : '#000', fontSize: 14, lineHeight: 20 }}
                          />
                        ) : null}
                        {item.imageUrl ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                            <Ionicons name="image-outline" size={14} color="#007AFF" />
                            <Text style={{ color: '#007AFF', fontSize: 12, marginLeft: 4 }}>Image</Text>
                          </View>
                        ) : null}
                        {item.gif ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                            <Ionicons name="happy-outline" size={14} color="#007AFF" />
                            <Text style={{ color: '#007AFF', fontSize: 12, marginLeft: 4 }}>Sticker</Text>
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
              <Image resizeMethod="resize" source={{ uri: pollImageUrl }} style={{ width: '100%', height: 120, borderRadius: 10, marginBottom: 6, backgroundColor: '#DDD' }} resizeMode="cover" />
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
      ) : activeTab === 'statusFeed' ? (
        <View style={{ flex: 1 }}>
          {statusLoading && statusList.length === 0 ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={statusList}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
              refreshControl={
                <RefreshControl
                  refreshing={statusLoading}
                  onRefresh={() => fetchStatusFeed(true)}
                  tintColor={isDark ? '#FFF' : '#000'}
                />
              }
              onEndReached={() => fetchStatusFeed(false)}
              onEndReachedThreshold={0.4}
              ListEmptyComponent={
                <Text style={{ color: isDark ? '#888' : '#666', textAlign: 'center', marginTop: 40 }}>
                  No statuses found.
                </Text>
              }
              ListFooterComponent={
                statusLoadingMore ? (
                  <ActivityIndicator size="small" color="#007AFF" style={{ marginVertical: 12 }} />
                ) : !statusHasMore && statusList.length > 0 ? (
                  <Text style={{ color: isDark ? '#555' : '#AAA', textAlign: 'center', fontSize: 11, marginTop: 8 }}>
                    End of feed
                  </Text>
                ) : null
              }
              renderItem={({ item }) => {
                const created = timeAgo(item.createdAt);
                const viewers = Array.isArray(item.viewedBy) ? item.viewedBy.length : 0;
                return (
                  <View style={{
                    backgroundColor: isDark ? '#1C1C1E' : '#FFF',
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 10,
                    borderWidth: 1,
                    borderColor: isDark ? '#2C2C2E' : '#E5E5EA',
                  }}>
                    {/* Header: avatar + name + date */}
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setStatusProfileUser({
                        senderId: item.userId,
                        id: item.userId,
                        sender: item.userName,
                        avatar: item.userAvatar,
                      })}
                      style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}
                    >
                      <Image resizeMethod="resize"
                        source={{ uri: item.userAvatar || DEFAULT_AVATAR }}
                        style={{ width: 36, height: 36, borderRadius: 18, marginRight: 10 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: isDark ? '#FFF' : '#000', fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
                          {item.userName || 'Unknown'}
                        </Text>
                        <Text style={{ color: isDark ? '#888' : '#666', fontSize: 11 }}>
                          {created} • {item.type || 'text'} • 👁 {viewers}
                        </Text>
                      </View>
                      <Ionicons name="person-circle-outline" size={20} color={isDark ? '#666' : '#999'} />
                    </TouchableOpacity>

                    {/* Caption */}
                    {!!item.caption && (
                      <Text style={{ color: isDark ? '#DDD' : '#333', fontSize: 13, marginBottom: 8 }} numberOfLines={4}>
                        {item.caption}
                      </Text>
                    )}

                    {/* Image */}
                    {!!item.imageUrl && (
                      <Image resizeMethod="resize"
                        source={{ uri: item.imageUrl }}
                        style={{ width: '100%', height: 160, borderRadius: 8, marginBottom: 8, backgroundColor: isDark ? '#000' : '#EEE' }}
                        resizeMode="cover"
                      />
                    )}

                    {/* Poll preview */}
                    {Array.isArray(item.pollOptions) && item.pollOptions.length > 0 && (
                      <View style={{ marginBottom: 8 }}>
                        {item.pollOptions.map((opt, i) => (
                          <Text key={i} style={{ color: isDark ? '#AAA' : '#555', fontSize: 12 }}>• {opt}</Text>
                        ))}
                      </View>
                    )}

                    {/* Actions */}
                    <View style={{ flexDirection: 'row', marginTop: 4 }}>
                      <TouchableOpacity
                        onPress={() => handleAdminDeleteStatus(item.id)}
                        style={{
                          flexDirection: 'row', alignItems: 'center',
                          backgroundColor: '#FF3B3020',
                          paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                        }}
                      >
                        <Ionicons name="trash-outline" size={14} color="#FF3B30" />
                        <Text style={{ color: '#FF3B30', fontSize: 12, fontWeight: '600', marginLeft: 4 }}>Delete</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          Clipboard.setString(item.userId || '');
                          Alert.alert('Copied', 'User ID copied.');
                        }}
                        style={{
                          flexDirection: 'row', alignItems: 'center',
                          backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7',
                          paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginLeft: 8,
                        }}
                      >
                        <Ionicons name="copy-outline" size={14} color={isDark ? '#AAA' : '#666'} />
                        <Text style={{ color: isDark ? '#AAA' : '#666', fontSize: 12, fontWeight: '600', marginLeft: 4 }}>Copy ID</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>
      ) : activeTab === 'reviewIntegrity' ? (
        <ReviewIntegrityTab isDark={isDark} currentUser={currentUser} callerRoles={callerRoles} />
      ) : activeTab === 'modLog' ? (
        <ModLogTab isDark={isDark} />
      ) : activeTab === 'wordFilter' && isSeniorPlus ? (
        <WordFilterTab isDark={isDark} currentUser={currentUser} />
      ) : activeTab === 'permRequests' && isAdmin ? (
        <PermBanRequestsTab isDark={isDark} onOpenUser={(u) => handleSelectUser(u)} />
      ) : activeTab === 'reports' ? (
        <ReportsTab
          isDark={isDark}
          onViewUser={(u) => setStatusProfileUser(u)}
          onSanctionUser={(u) => handleSelectUser(u)}
          onViewChat={(report) => { setActiveTab('chatViewer'); loadChatFromReport(report); }}
        />
      ) : activeTab === 'news' && isAdmin ? (
        <AdminNewsTab
          db={db}
          uid={currentUser?.id}
          C={isDark
            ? { surface: '#1C1C1E', fieldBg: '#2C2C2E', border: '#2C2C2E', text: '#FFF', textMuted: '#AAA', textFaint: '#666' }
            : { surface: '#FFF', fieldBg: '#FFF', border: '#E5E5EA', text: '#000', textMuted: '#666', textFaint: '#999' }}
          accent="#007AFF"
          danger="#FF3B30"
        />
      ) : activeTab === 'staffAccess' && canManageStaffAccess ? (
        <StaffAccessTab isDark={isDark} />
      ) : null}
      {/* Staff tool: no ad, just clear the system nav bar. */}
      <ScreenBottomBanner background={isDark ? '#000' : '#F2F2F7'} ad={false} />

      {/* Status profile drawer (admin moderation) */}
      <ProfileBottomDrawer
        isVisible={!!statusProfileUser}
        toggleModal={() => setStatusProfileUser(null)}
        startChat={() => {
          // Lets staff DM either side of a report (reported user or reporter).
          const u = statusProfileUser;
          setStatusProfileUser(null);
          const uid = u?.senderId || u?.id;
          if (!uid) return;
          navigation.navigate('PrivateChat', {
            selectedUser: { senderId: uid, sender: u?.sender || u?.displayName || 'User', avatar: u?.avatar || null },
          });
        }}
        selectedUser={statusProfileUser || {}}
        isOnline={false}
        bannedUsers={[]}
        fromPvtChat={false}
        onFollowChange={() => {}}
      />

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
                <Image resizeMethod="resize" source={{ uri: getAvatarSafe(selectedUser) }} style={styles.avatarLarge} />
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

                {/* Current sanction (server uid record, then email record) */}
                {!selectedSanction ? (
                  <ActivityIndicator size="small" color="#007AFF" style={{ marginTop: 8 }} />
                ) : (
                  <View style={[styles.infoBadge, {
                    marginTop: 8,
                    backgroundColor: selectedSanction.active
                      ? (selectedSanction.type === 'mute' ? '#7C3AED15' : '#FF3B3015')
                      : '#34C75915',
                  }]}>
                    <Text style={{
                      fontWeight: 'bold', textAlign: 'center',
                      color: selectedSanction.active ? (selectedSanction.type === 'mute' ? '#7C3AED' : '#FF3B30') : '#34C759',
                    }}>
                      {selectedSanction.active
                        ? `${selectedSanction.type === 'mute' ? 'Muted' : 'Banned'} ${selectedSanction.bannedUntil === 'permanent' ? 'permanently' : `until ${new Date(selectedSanction.bannedUntil).toLocaleString()}`}`
                        : 'No active sanction'}
                      {` • ${selectedSanction.strikeCount || 0}/3 strikes`}
                      {selectedSanction.active && selectedSanction.pendingPermanent ? ' • permanent ban waiting for an Admin' : ''}
                    </Text>
                    {selectedSanction.active && !!selectedSanction.reason && (
                      <Text style={{ color: isDark ? '#CCC' : '#333', fontSize: 12, textAlign: 'center', marginTop: 2 }}>
                        {selectedSanction.reason}{selectedSanction.bannedByName ? ` — ${selectedSanction.bannedByName}` : ''}
                      </Text>
                    )}
                  </View>
                )}
              </View>

              {/* Unban / Unmute / Ban Actions — only what the server will accept */}
              {selectedRoles && !isSelfItem(selectedUser) && (
                <View style={{ marginTop: 20, marginBottom: 16 }}>
                  {!selectedPerms.outranks ? (
                    <Text style={{ color: isDark ? '#888' : '#666', textAlign: 'center' }}>
                      You can't moderate this user (same or higher rank).
                    </Text>
                  ) : !selectedPerms.canMute ? (
                    <Text style={{ color: isDark ? '#888' : '#666', textAlign: 'center', marginBottom: 12 }}>
                      Staff members can only be sanctioned by a Senior Mod or higher.
                    </Text>
                  ) : null}
                  {canLiftSelected && (
                    <TouchableOpacity
                      style={[styles.actionButton, { backgroundColor: '#34C759' }]}
                      onPress={() => handleUnban(selectedUser)}
                    >
                      <Ionicons name="checkmark-circle-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
                      <Text style={styles.buttonText}>{selectedSanction?.type === 'mute' ? 'Unmute User' : 'Unban User'}</Text>
                    </TouchableOpacity>
                  )}
                  {selectedPerms.canStrike && !(selectedSanction?.active && selectedSanction.type === 'ban') && (
                    <TouchableOpacity
                      style={[styles.actionButton, { backgroundColor: '#FF3B30' }]}
                      onPress={() => handleBan(selectedUser)}
                    >
                      <Ionicons name="ban-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
                      <Text style={styles.buttonText}>
                        Ban User (Strike {nextStrikeCount(selectedSanction?.strikeCount)})
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

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
                          {canDeleteReviews(callerRoles) && (
                            <TouchableOpacity
                              onPress={() => handleDeleteReview(review)}
                              style={{ marginLeft: 10, padding: 4 }}
                            >
                              <Ionicons name="trash-outline" size={16} color="#FF3B30" />
                            </TouchableOpacity>
                          )}
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

              {/* Moderation history (audit log: strikes, mutes, lifts, deletes…) */}
              <View style={styles.sectionContainer}>
                <ModHistoryList
                  uid={selectedUser.id || null}
                  email={selectedUser.email || null}
                  isDark={isDark}
                  title="Moderation History"
                />
              </View>

              {/* Mute Buttons — each opens the reason prompt (which is also the
                  confirm step and blocks double taps) */}
              {selectedRoles && !isSelfItem(selectedUser) && selectedPerms.canMute && (
              <View style={{ marginTop: 16 }}>
                <Text style={{ color: isDark ? '#888' : '#666', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>
                  Mute User (chat only, keeps strikes{selectedPerms.maxMuteMinutes ? `, max ${formatMuteMinutes(selectedPerms.maxMuteMinutes)}` : ''})
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {mutePresetsFor(selectedPerms).map((m) => (
                    <TouchableOpacity
                      key={m}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: m < 60 ? '#5856D6' : '#AF52DE' }}
                      onPress={() => handleMuteUser(selectedUser, m)}
                    >
                      <Ionicons name="volume-mute" size={14} color="#FFF" />
                      <Text style={[styles.buttonText, { fontSize: 13 }]}>{formatMuteMinutes(m)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', marginBottom: 8 }}>
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
              )}

              {/* Strike Buttons (Mod and up) */}
              {selectedRoles && !isSelfItem(selectedUser) && selectedPerms.canStrike && (
              <View style={{ marginTop: 16 }}>
                <Text style={{ color: isDark ? '#888' : '#666', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>
                  Apply Strike (choose severity)
                </Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                  {[1, 2, 3].map((n) => (
                    <TouchableOpacity
                      key={n}
                      style={[styles.strikeButton, { backgroundColor: n === 1 ? '#FF9500' : n === 2 ? '#FF6B00' : '#FF3B30' }]}
                      onPress={() => handleSetStrike(selectedUser, n)}
                    >
                      <Text style={styles.buttonText}>Strike {n}</Text>
                      <Text style={{ color: '#fff', fontSize: 10 }}>
                        {n === 3 && !selectedPerms.canPermaban ? `${PENDING_PERM_DAYS} days + Admin review` : strikeStep(n).label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              )}

              <View style={{ height: 40 }} />
            </ScrollView>
          )}

          {/* Reason prompt for every action (nested in this sheet's Modal) */}
          <ModActionModal
            visible={!!modAction}
            isDark={isDark}
            title={modActionTitle(modAction)}
            subtitle={
              modAction?.kind === 'mute' ? 'Chat only — they can still trade and post. Their strike count is kept.'
                : modAction?.kind === 'strike' ? (modAction.value !== 3 ? 'Blocks the whole app for the duration and clears their recent public messages.'
                  : selectedPerms.canPermaban ? 'Permanent ban: chat, trades, posts and everything else.'
                    : `Bans the whole app for ${PENDING_PERM_DAYS} days now. Admins get a request to make it permanent.`)
                  : 'Removes it everywhere (email, account, devices, chat).'
            }
            confirmLabel={modAction?.kind === 'unban' ? 'Unban' : modAction?.kind === 'unmute' ? 'Unmute' : 'Confirm'}
            confirmColor={modAction?.kind === 'unban' || modAction?.kind === 'unmute' ? '#34C759' : '#FF3B30'}
            allowEvidence={['strike', 'mute', 'linked'].includes(modAction?.kind)}
            onCancel={() => setModAction(null)}
            onConfirm={confirmModAction}
          />
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 12, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
  headerBack: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  roleChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  sectionBar: { flexDirection: 'row', marginTop: 8, gap: 4 },
  sectionItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, borderRadius: 10 },
  segment: { flexDirection: 'row', marginHorizontal: 12, marginTop: 10, marginBottom: 10, padding: 3, borderRadius: 10 },
  segmentItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 7, borderRadius: 8 },
  segmentItemOn: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  statCard: { width: '31.5%', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginBottom: 10 },
  statIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { fontSize: 11.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 10, marginBottom: 8, marginLeft: 4 },
  listCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },

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
  pairBar: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingLeft: 8, paddingRight: 6, borderRadius: 12, borderWidth: 1 },
  pairPerson: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  pairView: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#007AFF', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, marginLeft: 6 },
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

// JMDs and regular users never get the dashboard (the chat header only shows
// its button to Mod and up); this also covers any other way in.
const AdminDashboard = (props) => {
  const { theme, isAdmin, isSeniorMod, isModerator } = useGlobalState();
  if (isAdmin || isSeniorMod || isModerator || isCurrentUserOwner()) return <AdminDashboardScreen {...props} />;
  const isDark = theme === 'dark';
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: isDark ? '#000' : '#F2F2F7' }}>
      <Ionicons name="shield-outline" size={40} color={isDark ? '#555' : '#BBB'} />
      <Text style={{ color: isDark ? '#AAA' : '#666', marginTop: 12, textAlign: 'center' }}>The mod dashboard is for Mods and above.</Text>
    </View>
  );
};

export default AdminDashboard;
