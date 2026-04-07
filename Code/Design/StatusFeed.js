/**
 * StatusFeed.js
 * Instagram/WhatsApp Stories-style horizontal status bubbles.
 *
 * Features:
 * - Horizontal scrollable avatar bubbles with gradient ring for unviewed
 * - Create status: text + image (uploaded to Bunny CDN)
 * - View status: fullscreen stories-style viewer with auto-play
 * - Background themes for text statuses
 * - Polls with live voting
 * - Instant chat/DM button
 * - Delete own statuses
 * - 24h auto-expiry via Firestore expiresAt
 *
 * ── Cost Optimizations ──
 * - MMKV cache for statuses (5-min TTL) and following list (30-min TTL)
 * - Paginated following statuses (chunks of 30 IDs, load more on scroll)
 * - Random seed for global statuses (10 max, fair rotation)
 * - Local-first post/delete (no Firestore re-fetch)
 * - Skip duplicate markViewed writes
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image, Animated,
  StyleSheet, Dimensions, Modal, TextInput, Alert, ScrollView, ActivityIndicator,
  StatusBar, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  collection, query, where, orderBy, limit, getDocs, startAfter,
  addDoc, serverTimestamp, Timestamp, doc, updateDoc, arrayUnion, arrayRemove, deleteDoc,
} from '@react-native-firebase/firestore';
import { launchImageLibrary } from 'react-native-image-picker';
import { Image as CompressorImage } from 'react-native-compressor';
import RNFS from 'react-native-fs';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import { addXP, XP_ACTIONS } from '../Engagement/xpUtils';
import InterstitialAdManager from '../Ads/IntAd';
import SwipeableBottomDrawer from '../Helper/SwipeableBottomDrawer';
import { useLocalState } from '../LocalGlobelStats';
import { useGlobalState } from '../GlobelStats';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';


const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BUBBLE_SIZE = 64;
const STATUS_EXPIRY_MS = 24 * 60 * 60 * 1000;

// ── Cache config ──
let statusCache;
try {
  const { createMMKV } = require('react-native-mmkv');
  statusCache = createMMKV({ id: 'status-feed-cache' });
} catch (e) {
  console.warn('[StatusFeed] MMKV init failed, using fallback:', e?.message);
  statusCache = {
    getString: () => undefined,
    set: () => {},
    getNumber: () => undefined,
    delete: () => {},
  };
}
const STATUS_CACHE_TTL = 5 * 60 * 1000;
const FOLLOWING_CACHE_TTL = 30 * 60 * 1000;
const FOLLOWING_CHUNK_SIZE = 30;
const GLOBAL_STATUS_LIMIT = 10;

// ── Cache helpers ──
const getCachedJSON = (key) => {
  try {
    const raw = statusCache.getString(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const setCachedJSON = (key, val) => {
  try { statusCache.set(key, JSON.stringify(val)); } catch {}
};
const isCacheValid = (key, ttl) => {
  const ts = statusCache.getNumber(`${key}_ts`);
  return ts && (Date.now() - ts) < ttl;
};
const setCacheTimestamp = (key) => {
  statusCache.set(`${key}_ts`, Date.now());
};

// ── Ring colors ──
const RING_SEEN = '#94A3B8';

// ── Story auto-play duration (ms) ──
const STORY_DURATION = 5000;

// ── Background themes for text-only statuses ──
const STATUS_THEMES = [
  { id: 'none', label: 'None', colors: null, textColor: null },
  { id: 'sunset', label: '🌅', colors: ['#F97316', '#EC4899'], textColor: '#fff' },
  { id: 'ocean', label: '🌊', colors: ['#0EA5E9', '#6366F1'], textColor: '#fff' },
  { id: 'forest', label: '🌲', colors: ['#10B981', '#065F46'], textColor: '#fff' },
  { id: 'galaxy', label: '🌌', colors: ['#7C3AED', '#1E1B4B'], textColor: '#fff' },
  { id: 'candy', label: '🍬', colors: ['#F472B6', '#A78BFA'], textColor: '#fff' },
  { id: 'midnight', label: '🌙', colors: ['#1E293B', '#0F172A'], textColor: '#E2E8F0' },
  { id: 'fire', label: '🔥', colors: ['#EF4444', '#F59E0B'], textColor: '#fff' },
  { id: 'neon', label: '💜', colors: ['#A855F7', '#06B6D4'], textColor: '#fff' },
];

// ── Shimmer Placeholder ──
const ShimmerPlaceholder = ({ style }) => {
  const shimmerAnim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View
      style={[
        { backgroundColor: '#CBD5E1', justifyContent: 'center', alignItems: 'center' },
        style,
        { opacity: shimmerAnim },
      ]}
    >
      <ActivityIndicator size="small" color="#94A3B8" />
    </Animated.View>
  );
};

// ── Image with loading shimmer ──
const LoadingImage = ({ source, style, resizeMode = 'cover', borderRadius }) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <View style={[style, { overflow: 'hidden', borderRadius: borderRadius || style?.borderRadius || 0 }]}>
      {!loaded && (
        <ShimmerPlaceholder
          style={[StyleSheet.absoluteFill, { borderRadius: borderRadius || style?.borderRadius || 0 }]}
        />
      )}
      <Image
        source={source}
        style={[style, { position: loaded ? 'relative' : 'absolute', opacity: loaded ? 1 : 0 }]}
        resizeMode={resizeMode}
        onLoad={() => setLoaded(true)}
      />
    </View>
  );
};

// Bunny CDN config (same as rest of app)
const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

// Base64 decoder (no atob in RN)
const base64ToBytes = (base64) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = base64.replace(/[\r\n]+/g, '');
  let output = [];
  let i = 0;
  while (i < str.length) {
    const enc1 = chars.indexOf(str.charAt(i++));
    const enc2 = chars.indexOf(str.charAt(i++));
    const enc3 = chars.indexOf(str.charAt(i++));
    const enc4 = chars.indexOf(str.charAt(i++));
    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;
    output.push(chr1);
    if (enc3 !== 64) output.push(chr2);
    if (enc4 !== 64) output.push(chr3);
  }
  return Uint8Array.from(output);
};

const DEFAULT_AVATAR = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';

// ── Helper: group raw status docs by userId ──
const groupStatuses = (rawStatuses, myId, tAnon) => {
  const grouped = {};
  rawStatuses.forEach(s => {
    if (!grouped[s.userId]) {
      grouped[s.userId] = {
        userId: s.userId,
        userName: s.userName || tAnon,
        userAvatar: s.userAvatar || null,
        statuses: [],
        hasUnviewed: false,
      };
    }
    grouped[s.userId].statuses.push(s);
    if (!s.viewedBy?.includes(myId)) {
      grouped[s.userId].hasUnviewed = true;
    }
  });
  return grouped;
};

// ── Serialize Firestore Timestamps for MMKV cache ──
const serializeStatus = (s) => ({
  ...s,
  createdAt: s.createdAt?.toDate ? { _seconds: Math.floor(s.createdAt.toDate().getTime() / 1000) } : s.createdAt,
  expiresAt: s.expiresAt?.toDate ? { _seconds: Math.floor(s.expiresAt.toDate().getTime() / 1000) } : s.expiresAt,
});

const deserializeTimestamp = (ts) => {
  if (!ts) return null;
  if (ts._seconds) return { toDate: () => new Date(ts._seconds * 1000) };
  return ts;
};

const deserializeStatus = (s) => ({
  ...s,
  createdAt: deserializeTimestamp(s.createdAt),
  expiresAt: deserializeTimestamp(s.expiresAt),
});


const StatusFeed = ({ user, firestoreDB, appdatabase, isDarkMode, onRequireSignIn }) => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { isAdmin } = useGlobalState();
  const isAdminOrMod = isAdmin || !!user?.isModerator;
  const insets = useSafeAreaInsets();
  const [statuses, setStatuses] = useState(() => {
    const cached = getCachedJSON('statuses_grouped');
    return cached ? cached.map(g => ({ ...g, statuses: g.statuses.map(deserializeStatus) })) : [];
  });
  const [followingIds, setFollowingIds] = useState(() => getCachedJSON('following_ids') || []);
  const [viewingStatus, setViewingStatus] = useState(null);
  const [drawerUser, setDrawerUser] = useState(null);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [showCreator, setShowCreator] = useState(false);
  const [caption, setCaption] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [selectedThemeId, setSelectedThemeId] = useState('none');
  const [isPollMode, setIsPollMode] = useState(false);
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [storyIndex, setStoryIndex] = useState(0);
  const storyTimerRef = useRef(null);
  const pressTimestampRef = useRef(0);
  const storyProgressAnim = useRef(new Animated.Value(0)).current;

  const followingChunkRef = useRef(0);
  const allFollowingLoadedRef = useRef(false);
  const viewedLocallyRef = useRef(new Set());

  // ── Fetch who I follow ──
  useEffect(() => {
    if (!user?.id || !firestoreDB) return;
    if (isCacheValid('following_ids', FOLLOWING_CACHE_TTL) && followingIds.length > 0) return;

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
        setCachedJSON('following_ids', ids);
        setCacheTimestamp('following_ids');
      } catch (err) {
        console.warn('[StatusFeed] Error fetching following list:', err?.message);
      }
    })();
  }, [user?.id, firestoreDB]);

  // ── Upload image to Bunny CDN ──
  const uploadToBunny = useCallback(async (imagePath) => {
    try {
      const localPath = imagePath.startsWith('file://') ? imagePath.replace('file://', '') : imagePath;
      const base64 = await RNFS.readFile(localPath, 'base64');
      const bytes = base64ToBytes(base64);
      const fileName = `status_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
      const remotePath = `statuses/${fileName}`;

      const response = await fetch(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`, {
        method: 'PUT',
        headers: {
          AccessKey: BUNNY_ACCESS_KEY,
          'Content-Type': 'image/jpeg',
        },
        body: bytes,
      });

      if (!response.ok) throw new Error('Upload failed');
      return `${BUNNY_CDN_BASE}/${remotePath}`;
    } catch (err) {
      console.warn('[StatusFeed] Bunny upload error:', err?.message);
      return null;
    }
  }, []);

  // ── Fetch global random statuses ──
  const fetchGlobalRandom = useCallback(async () => {
    if (!firestoreDB) return [];
    try {
      const rand = Math.random();
      const now = Timestamp.now();
      const nowMillis = now.toMillis();

      const q1 = query(
        collection(firestoreDB, 'statuses'),
        where('randomSeed', '>=', rand),
        orderBy('randomSeed', 'asc'),
        limit(15),
      );
      let snap = await getDocs(q1);
      let results = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => s.expiresAt?.toMillis() > nowMillis);

      if (results.length < 10) {
        const q2 = query(
          collection(firestoreDB, 'statuses'),
          where('randomSeed', '<', rand),
          orderBy('randomSeed', 'desc'),
          limit(15 - results.length),
        );
        const snap2 = await getDocs(q2);
        const moreResults = snap2.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(s => s.expiresAt?.toMillis() > nowMillis);
        results = results.concat(moreResults);
      }

      if (results.length === 0) {
        const fallbackQ = query(
          collection(firestoreDB, 'statuses'),
          where('expiresAt', '>', now),
          orderBy('expiresAt', 'desc'),
          limit(15),
        );
        const fbSnap = await getDocs(fallbackQ);
        results = fbSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        for (let i = results.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [results[i], results[j]] = [results[j], results[i]];
        }
      }

      return results.slice(0, 15);
    } catch (err) {
      console.warn('[StatusFeed] Global random fetch error:', err?.message);
      return [];
    }
  }, [firestoreDB]);

  // ── Fetch following statuses (paginated) ──
  const fetchFollowingChunk = useCallback(async (chunkIndex) => {
    if (!firestoreDB || !user?.id || followingIds.length === 0) return [];

    const idsToQuery = [user.id];
    const start = chunkIndex * FOLLOWING_CHUNK_SIZE;
    const chunk = followingIds.slice(start, start + FOLLOWING_CHUNK_SIZE);

    if (chunkIndex > 0 && chunk.length === 0) {
      allFollowingLoadedRef.current = true;
      return [];
    }

    const combined = [...new Set([...idsToQuery, ...chunk])].slice(0, 30);

    try {
      const now = Timestamp.now();
      const q = query(
        collection(firestoreDB, 'statuses'),
        where('userId', 'in', combined),
        where('expiresAt', '>', now),
      );
      const snap = await getDocs(q);
      const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (chunk.length < FOLLOWING_CHUNK_SIZE) {
        allFollowingLoadedRef.current = true;
      }
      return results;
    } catch (err) {
      console.warn('[StatusFeed] Following chunk fetch error:', err?.message);
      return [];
    }
  }, [firestoreDB, user?.id, followingIds]);

  // ── Main fetch: combines following + global ──
  const fetchStatuses = useCallback(async (force = false) => {
    if (!firestoreDB) return;
    if (!force && isCacheValid('statuses_grouped', STATUS_CACHE_TTL) && statuses.length > 0) return;

    try {
      followingChunkRef.current = 0;
      allFollowingLoadedRef.current = false;

      const followingResults = await fetchFollowingChunk(0);
      followingChunkRef.current = 1;

      const globalResults = await fetchGlobalRandom();

      const followingSet = new Set([user?.id, ...followingIds]);
      const myAndFollowing = followingResults;
      const globalOnly = globalResults
        .filter(s => !followingSet.has(s.userId))
        .slice(0, GLOBAL_STATUS_LIMIT);

      const allRaw = [...myAndFollowing, ...globalOnly];
      const grouped = groupStatuses(allRaw, user?.id, t('status_feed.anonymous', { defaultValue: 'Anonymous' }));

      const arr = Object.values(grouped);
      arr.sort((a, b) => {
        if (a.userId === user?.id) return -1;
        if (b.userId === user?.id) return 1;
        const aF = followingIds.includes(a.userId);
        const bF = followingIds.includes(b.userId);
        if (aF && !bF) return -1;
        if (!aF && bF) return 1;
        return 0;
      });

      setStatuses(arr);

      const serialized = arr.map(g => ({
        ...g,
        statuses: g.statuses.map(serializeStatus),
      }));
      setCachedJSON('statuses_grouped', serialized);
      setCacheTimestamp('statuses_grouped');
    } catch (err) {
      console.warn('[StatusFeed] fetch error:', err?.message);
    }
  }, [firestoreDB, user?.id, followingIds, fetchFollowingChunk, fetchGlobalRandom, statuses.length]);

  useEffect(() => { fetchStatuses(); }, [fetchStatuses]);

  // ── Load more following statuses ──
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || allFollowingLoadedRef.current || !firestoreDB) return;
    setLoadingMore(true);
    try {
      const moreResults = await fetchFollowingChunk(followingChunkRef.current);
      followingChunkRef.current += 1;

      if (moreResults.length > 0) {
        const moreGrouped = groupStatuses(moreResults, user?.id, t('status_feed.anonymous', { defaultValue: 'Anonymous' }));
        setStatuses(prev => {
          const existingMap = {};
          prev.forEach(g => { existingMap[g.userId] = g; });
          Object.values(moreGrouped).forEach(g => {
            if (existingMap[g.userId]) {
              const existingIds = new Set(existingMap[g.userId].statuses.map(s => s.id));
              const newStatuses = g.statuses.filter(s => !existingIds.has(s.id));
              existingMap[g.userId] = {
                ...existingMap[g.userId],
                statuses: [...existingMap[g.userId].statuses, ...newStatuses],
                hasUnviewed: existingMap[g.userId].hasUnviewed || g.hasUnviewed,
              };
            } else {
              existingMap[g.userId] = g;
            }
          });

          const merged = Object.values(existingMap);
          merged.sort((a, b) => {
            if (a.userId === user?.id) return -1;
            if (b.userId === user?.id) return 1;
            const aF = followingIds.includes(a.userId);
            const bF = followingIds.includes(b.userId);
            if (aF && !bF) return -1;
            if (!aF && bF) return 1;
            return 0;
          });

          const serialized = merged.map(g => ({
            ...g,
            statuses: g.statuses.map(serializeStatus),
          }));
          setCachedJSON('statuses_grouped', serialized);
          setCacheTimestamp('statuses_grouped');
          return merged;
        });
      }
    } catch (err) {
      console.warn('[StatusFeed] Load more error:', err?.message);
    }
    setLoadingMore(false);
  }, [loadingMore, firestoreDB, fetchFollowingChunk, user?.id, followingIds]);

  // ── Pick image ──
  const handlePickImage = useCallback(async () => {
    if (!user?.id) { onRequireSignIn?.(); return; }
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.8,
        selectionLimit: 1,
        maxWidth: 1920,
        maxHeight: 1920,
      });
      if (result.didCancel) return;
      if (result.errorCode) {
        Alert.alert('Error', result.errorMessage || 'Failed to pick image');
        return;
      }
      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      let finalUri = asset.uri;
      try {
        const compressPromise = CompressorImage.compress(asset.uri, {
          maxWidth: 1200,
          quality: 0.7,
          returnableOutputType: 'uri',
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Compression timeout')), 5000)
        );
        finalUri = await Promise.race([compressPromise, timeoutPromise]);
      } catch (compErr) {
        console.warn('[StatusFeed] Compression skipped:', compErr?.message);
      }

      setSelectedImage({ ...asset, uri: finalUri });
      setShowCreator(true);
    } catch (err) {
      console.error('[StatusFeed] Image picker crash:', err);
      Alert.alert('Error', 'Failed to pick image');
    }
  }, [user?.id, onRequireSignIn]);

  // ── Post status (local-first) ──
  const { localState } = useLocalState();

  const handlePostStatus = useCallback(async () => {
    if (!user?.id || !firestoreDB) return;
    const hasContent = caption.trim() || selectedImage;
    const hasValidPoll = isPollMode && pollOptions.filter(o => o.trim()).length >= 2;
    if (!hasContent && !hasValidPoll) {
      Alert.alert('Empty Status', 'Please add some text, an image, or create a poll.');
      return;
    }

    const doUpload = async () => {
      setUploading(true);
      try {
        let imageUrl = null;
        if (selectedImage?.uri) {
          imageUrl = await uploadToBunny(selectedImage.uri);
          if (!imageUrl) {
            Alert.alert('Upload Failed', 'Could not upload image. Please try again.');
            setUploading(false);
            return;
          }
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + STATUS_EXPIRY_MS);

        const selectedTheme = STATUS_THEMES.find(th => th.id === selectedThemeId);
        const hasTheme = !imageUrl && selectedTheme?.colors;
        const validPollOpts = isPollMode ? pollOptions.filter(o => o.trim()) : [];
        const isPoll = validPollOpts.length >= 2;
        let statusType = 'text';
        if (imageUrl) statusType = 'image';
        else if (isPoll) statusType = 'poll';
        else if (hasTheme) statusType = 'themed_text';

        const docData = {
          userId: user.id,
          userName: user.displayName || 'Anonymous',
          caption: caption.trim() || '',
          imageUrl: imageUrl || null,
          createdAt: serverTimestamp(),
          expiresAt: Timestamp.fromDate(expiresAt),
          viewedBy: [],
          type: statusType,
          randomSeed: Math.random(),
          ...(user.avatar ? { userAvatar: user.avatar } : {}),
          ...(hasTheme ? { themeId: selectedThemeId } : {}),
          ...(isPoll ? {
            pollOptions: validPollOpts,
            pollVotes: validPollOpts.reduce((acc, _, i) => ({ ...acc, [i]: [] }), {}),
          } : {}),
        };

        const docRef = await addDoc(collection(firestoreDB, 'statuses'), docData);

        addXP(appdatabase, user.id, XP_ACTIONS.POST_STATUS);

        // Local-first: inject into state
        const newStatus = {
          ...docData,
          id: docRef.id,
          createdAt: { toDate: () => now },
          expiresAt: { toDate: () => expiresAt },
        };
        setStatuses(prev => {
          const updated = [...prev];
          const myGroupIdx = updated.findIndex(g => g.userId === user.id);
          if (myGroupIdx >= 0) {
            updated[myGroupIdx] = {
              ...updated[myGroupIdx],
              statuses: [...updated[myGroupIdx].statuses, newStatus],
            };
          } else {
            updated.unshift({
              userId: user.id,
              userName: user.displayName || 'Anonymous',
              userAvatar: user.avatar || null,
              statuses: [newStatus],
              hasUnviewed: false,
            });
          }
          const serialized = updated.map(g => ({
            ...g,
            statuses: g.statuses.map(serializeStatus),
          }));
          setCachedJSON('statuses_grouped', serialized);
          setCacheTimestamp('statuses_grouped');
          return updated;
        });

        setCaption('');
        setSelectedImage(null);
        setSelectedThemeId('none');
        setIsPollMode(false);
        setPollOptions(['', '']);
        setShowCreator(false);
      } catch (err) {
        console.warn('[StatusFeed] post error:', err?.message);
        Alert.alert('Error', 'Failed to post status');
      }
      setUploading(false);
    };

    await doUpload();

    if (!localState.isPro) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          try { InterstitialAdManager.showAd(() => {}); } catch (err) {}
        }, 400);
      });
    }
  }, [user, firestoreDB, appdatabase, caption, selectedImage, uploadToBunny, localState.isPro, isPollMode, pollOptions, selectedThemeId]);

  // ── Delete status ──
  const handleDeleteStatus = useCallback(async (statusId) => {
    if (!firestoreDB || !statusId) return;
    Alert.alert('Delete Status', 'Are you sure you want to delete this status?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(firestoreDB, 'statuses', statusId));
            setViewingStatus(null);
            setStatuses(prev => {
              const updated = prev.map(g => ({
                ...g,
                statuses: g.statuses.filter(s => s.id !== statusId),
              })).filter(g => g.statuses.length > 0 || g.userId === user?.id);
              const serialized = updated.map(g => ({
                ...g,
                statuses: g.statuses.map(serializeStatus),
              }));
              setCachedJSON('statuses_grouped', serialized);
              setCacheTimestamp('statuses_grouped');
              return updated;
            });
          } catch (err) {
            Alert.alert('Error', 'Failed to delete status');
          }
        },
      },
    ]);
  }, [firestoreDB, user?.id]);

  // ── Mark viewed ──
  const markViewed = useCallback(async (statusId) => {
    if (!user?.id || !firestoreDB) return;
    if (viewedLocallyRef.current.has(statusId)) return;
    viewedLocallyRef.current.add(statusId);
    try {
      await updateDoc(doc(firestoreDB, 'statuses', statusId), {
        viewedBy: arrayUnion(user.id),
      });
    } catch {}
  }, [user?.id, firestoreDB]);

  const handleViewStatus = useCallback((group) => {
    setStoryIndex(0);
    setViewingStatus(group);
    if (group.statuses?.length > 0 && user?.id) {
      group.statuses.forEach(s => {
        if (!s.viewedBy?.includes(user.id)) markViewed(s.id);
      });
      setStatuses(prev => {
        const updated = prev.map(g => {
          if (g.userId !== group.userId) return g;
          return {
            ...g,
            hasUnviewed: false,
            statuses: g.statuses.map(s => ({
              ...s,
              viewedBy: s.viewedBy?.includes(user.id) ? s.viewedBy : [...(s.viewedBy || []), user.id],
            })),
          };
        });
        const serialized = updated.map(g => ({
          ...g,
          statuses: g.statuses.map(serializeStatus),
        }));
        setCachedJSON('statuses_grouped', serialized);
        return updated;
      });
    }
  }, [markViewed, user?.id]);

  const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '🔥', '👏'];

  // ── React to a status ──
  const handleReaction = useCallback(async (statusId, emoji) => {
    if (!user?.id) {
      stopStoryTimer();
      setViewingStatus(null);
      setTimeout(() => onRequireSignIn?.(), 300);
      return;
    }
    if (!firestoreDB) return;
    try {
      await updateDoc(doc(firestoreDB, 'statuses', statusId), {
        [`reactions.${user.id}`]: emoji,
      });
      setViewingStatus(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          statuses: prev.statuses.map(s => {
            if (s.id !== statusId) return s;
            return { ...s, reactions: { ...(s.reactions || {}), [user.id]: emoji } };
          }),
        };
      });
    } catch (err) {
      console.warn('[StatusFeed] reaction error:', err?.message);
    }
  }, [user?.id, firestoreDB]);

  // ── Follow / Unfollow toggle ──
  const handleFollowToggle = useCallback(async (targetUserId) => {
    if (!user?.id) {
      stopStoryTimer();
      setViewingStatus(null);
      setTimeout(() => onRequireSignIn?.(), 300);
      return;
    }
    if (!firestoreDB || !targetUserId || user.id === targetUserId) return;

    setFollowLoading(true);
    const isCurrentlyFollowing = followingIds.includes(targetUserId);

    try {
      if (isCurrentlyFollowing) {
        const followSnap = await getDocs(
          query(
            collection(firestoreDB, 'following'),
            where('followerId', '==', user.id),
            where('followingId', '==', targetUserId),
          )
        );
        await Promise.all(followSnap.docs.map(d => deleteDoc(doc(firestoreDB, 'following', d.id))));
        const updated = followingIds.filter(id => id !== targetUserId);
        setFollowingIds(updated);
        setCachedJSON('following_ids', updated);
        setCacheTimestamp('following_ids');
      } else {
        await addDoc(collection(firestoreDB, 'following'), {
          followerId: user.id,
          followingId: targetUserId,
          createdAt: serverTimestamp(),
        });
        const updated = [...followingIds, targetUserId];
        setFollowingIds(updated);
        setCachedJSON('following_ids', updated);
        setCacheTimestamp('following_ids');
      }
    } catch (err) {
      console.warn('[StatusFeed] follow toggle error:', err?.message);
    }
    setFollowLoading(false);
  }, [user?.id, firestoreDB, followingIds]);

  const textColor = isDarkMode ? '#e2e8f0' : '#1e293b';
  const subtextColor = isDarkMode ? '#94a3b8' : '#64748b';

  // ── Poll vote handler ──
  const handlePollVote = useCallback(async (statusId, optionIndex) => {
    if (!user?.id) {
      stopStoryTimer();
      setViewingStatus(null);
      setTimeout(() => onRequireSignIn?.(), 300);
      return;
    }
    if (!firestoreDB) return;
    try {
      const updates = {};
      updates[`pollVotes.${optionIndex}`] = arrayUnion(user.id);
      await updateDoc(doc(firestoreDB, 'statuses', statusId), updates);
      setViewingStatus(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          statuses: prev.statuses.map(s => {
            if (s.id !== statusId) return s;
            const updatedVotes = { ...(s.pollVotes || {}) };
            Object.keys(updatedVotes).forEach(k => {
              if (Array.isArray(updatedVotes[k])) {
                updatedVotes[k] = updatedVotes[k].filter(uid => uid !== user.id);
              }
            });
            updatedVotes[optionIndex] = [...(updatedVotes[optionIndex] || []), user.id];
            return { ...s, pollVotes: updatedVotes };
          }),
        };
      });
    } catch (err) {
      console.warn('[StatusFeed] poll vote error:', err?.message);
    }
  }, [user?.id, firestoreDB]);

  // ── Story auto-play controls ──
  const startStoryTimer = useCallback((index, total) => {
    if (storyTimerRef.current) clearTimeout(storyTimerRef.current);
    storyProgressAnim.setValue(0);
    Animated.timing(storyProgressAnim, {
      toValue: 1,
      duration: STORY_DURATION,
      useNativeDriver: false,
    }).start();
    storyTimerRef.current = setTimeout(() => {
      if (index < total - 1) {
        setStoryIndex(index + 1);
      } else {
        setViewingStatus(null);
      }
    }, STORY_DURATION);
  }, [storyProgressAnim]);

  const stopStoryTimer = useCallback(() => {
    if (storyTimerRef.current) clearTimeout(storyTimerRef.current);
    storyProgressAnim.stopAnimation();
  }, [storyProgressAnim]);

  useEffect(() => {
    if (viewingStatus?.statuses?.length > 0) {
      startStoryTimer(storyIndex, viewingStatus.statuses.length);
    }
    return () => { if (storyTimerRef.current) clearTimeout(storyTimerRef.current); };
  }, [storyIndex, viewingStatus?.userId]);

  // ── Open profile drawer from status ──
  const handleChatFromStatus = useCallback(() => {
    if (!user?.id) {
      stopStoryTimer();
      setViewingStatus(null);
      setTimeout(() => onRequireSignIn?.(), 300);
      return;
    }
    if (!viewingStatus?.userId) return;
    stopStoryTimer();
    const profileUser = {
      senderId: viewingStatus.userId,
      sender: viewingStatus.userName || 'User',
      avatar: viewingStatus.userAvatar || DEFAULT_AVATAR,
    };
    setDrawerUser(profileUser);
    setViewingStatus(null);
    setTimeout(() => setIsDrawerVisible(true), 400);
  }, [user?.id, viewingStatus]);

  const handleStartChatFromDrawer = useCallback(() => {
    if (!drawerUser) return;
    setIsDrawerVisible(false);
    setTimeout(() => {
      try {
        const rootNav = navigation.getParent() || navigation;
        rootNav.navigate('PrivateChatRoot', {
          selectedUser: {
            senderId: drawerUser.senderId,
            sender: drawerUser.sender,
            avatar: drawerUser.avatar,
          },
        });
      } catch (e) {
        console.warn('[StatusFeed] Chat navigation failed:', e?.message);
      }
    }, 300);
  }, [drawerUser, navigation]);

  // ── Themed background renderer ──
  const renderThemedBg = (themeId, children, style) => {
    const thm = STATUS_THEMES.find(th => th.id === themeId);
    if (!thm?.colors) return children;
    return (
      <View style={[{ borderRadius: 12, overflow: 'hidden', position: 'relative' }, style]}>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: '50%', backgroundColor: thm.colors[0] }} />
        <View style={{ position: 'absolute', top: '50%', left: 0, right: 0, bottom: 0, backgroundColor: thm.colors[1] }} />
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.1)' }} />
        <View style={{ position: 'relative', zIndex: 1 }}>
          {children}
        </View>
      </View>
    );
  };

  // ── Render bubble ──
  const renderBubble = useCallback(({ item }) => {
    const isMe = item.userId === user?.id;
    const hasUnviewed = item.hasUnviewed;
    const hasStatuses = item.statuses.length > 0;
    const ringStyle = hasUnviewed
      ? styles.bubbleRingUnseen
      : hasStatuses
        ? [styles.bubbleRingSeen, { borderColor: isDarkMode ? '#475569' : RING_SEEN }]
        : { borderColor: isDarkMode ? '#334155' : '#e2e8f0' };

    return (
      <TouchableOpacity
        style={styles.bubbleWrap}
        onPress={() => isMe && item.statuses.length === 0 ? setShowCreator(true) : handleViewStatus(item)}
        activeOpacity={0.7}
      >
        {hasUnviewed ? (
          <View style={styles.gradientRingOuter}>
            <View style={styles.gradientRingMiddle}>
              <View style={[styles.gradientRingInner, { backgroundColor: isDarkMode ? '#0f172a' : '#fff' }]}>
                <LoadingImage
                  source={{ uri: item.userAvatar || DEFAULT_AVATAR }}
                  style={styles.bubbleAvatar}
                  borderRadius={(BUBBLE_SIZE - 4) / 2}
                />
              </View>
            </View>
          </View>
        ) : (
          <View style={[styles.bubbleRing, ringStyle]}>
            <LoadingImage
              source={{ uri: item.userAvatar || DEFAULT_AVATAR }}
              style={styles.bubbleAvatar}
              borderRadius={(BUBBLE_SIZE - 4) / 2}
            />
          </View>
        )}
        {isMe && (
          <View style={styles.addBadge}>
            <FontAwesome name="plus" size={8} color="#FFF" solid />
          </View>
        )}
        <Text style={[styles.bubbleName, { color: subtextColor }]} numberOfLines={1}>
          {isMe ? 'You' : (item.userName || '').split(' ')[0]}
        </Text>
      </TouchableOpacity>
    );
  }, [user?.id, isDarkMode, handleViewStatus, subtextColor]);

  // Build data
  const feedData = useMemo(() => {
    if (!user?.id) return statuses;
    const myIndex = statuses.findIndex(s => s.userId === user.id);
    if (myIndex === -1) {
      return [
        { userId: user.id, userName: 'You', userAvatar: user.avatar, statuses: [], hasUnviewed: false },
        ...statuses,
      ];
    }
    if (myIndex === 0) return statuses;
    const reordered = [...statuses];
    const [myGroup] = reordered.splice(myIndex, 1);
    reordered.unshift(myGroup);
    return reordered;
  }, [statuses, user]);

  if (feedData.length === 0) {
    return (
      <View style={[styles.container, { borderBottomColor: isDarkMode ? '#1e293b' : 'rgba(0,0,0,0.05)' }]}>
        <View style={styles.listContent}>
          <View style={{ height: BUBBLE_SIZE + 24 }} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { borderBottomColor: isDarkMode ? '#1e293b' : 'rgba(0,0,0,0.05)' }]}>
      <FlatList
        data={feedData}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.userId}
        renderItem={renderBubble}
        contentContainerStyle={styles.listContent}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loadingMore ? (
          <View style={{ width: 50, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="small" color={isDarkMode ? '#94A3B8' : '#64748B'} />
          </View>
        ) : null}
      />

      {/* ── Stories-Style Viewer Modal ── */}
      {viewingStatus && (() => {
        const currentStatus = viewingStatus.statuses[storyIndex] || viewingStatus.statuses[0];
        if (!currentStatus) return null;
        const isMyStatus = currentStatus.userId === user?.id;
        const totalStatuses = viewingStatus.statuses.length;
        const reactionEntries = Object.entries(currentStatus.reactions || {});
        const myReaction = currentStatus.reactions?.[user?.id];
        const reactionCounts = {};
        reactionEntries.forEach(([, emoji]) => {
          reactionCounts[emoji] = (reactionCounts[emoji] || 0) + 1;
        });
        const statusTheme = STATUS_THEMES.find(th => th.id === currentStatus.themeId);
        const isThemedText = currentStatus.type === 'themed_text' && statusTheme?.colors;
        const isPollType = currentStatus.type === 'poll' && currentStatus.pollOptions;

        const pollTotalVotes = isPollType
          ? Object.values(currentStatus.pollVotes || {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0)
          : 0;
        const myVoteIndex = isPollType
          ? Object.entries(currentStatus.pollVotes || {}).findIndex(([, arr]) => Array.isArray(arr) && arr.includes(user?.id))
          : -1;

        return (
        <Modal visible={true} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { stopStoryTimer(); setViewingStatus(null); }}>
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            {/* Progress bars */}
            <View style={{ flexDirection: 'row', gap: 3, paddingHorizontal: 10, paddingTop: 50, zIndex: 20 }}>
              {viewingStatus.statuses.map((_, i) => (
                <View key={i} style={{ flex: 1, height: 2.5, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2, overflow: 'hidden' }}>
                  {i < storyIndex ? (
                    <View style={{ width: '100%', height: '100%', backgroundColor: '#fff' }} />
                  ) : i === storyIndex ? (
                    <Animated.View style={{
                      height: '100%', backgroundColor: '#fff', borderRadius: 2,
                      width: storyProgressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                    }} />
                  ) : null}
                </View>
              ))}
            </View>

            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, zIndex: 20 }}>
              <Image
                source={{ uri: viewingStatus.userAvatar || DEFAULT_AVATAR }}
                style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)' }}
              />
              <Text style={{ flex: 1, color: '#fff', fontSize: 14, fontWeight: '700', marginLeft: 10 }} numberOfLines={1}>
                {viewingStatus.userName}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginRight: 10 }}>
                {currentStatus.createdAt?.toDate ? getTimeAgo(currentStatus.createdAt.toDate()) : ''}
              </Text>
              {/* Follow button */}
              {user?.id && viewingStatus.userId !== user.id && (
                <TouchableOpacity
                  onPress={() => handleFollowToggle(viewingStatus.userId)}
                  disabled={followLoading}
                  activeOpacity={0.7}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20, marginRight: 8,
                    ...(followingIds.includes(viewingStatus.userId)
                      ? { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' }
                      : { backgroundColor: '#3B82F6' }),
                    ...(followLoading ? { opacity: 0.5 } : {}),
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>
                    {followingIds.includes(viewingStatus.userId) ? 'Following' : 'Follow'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => { stopStoryTimer(); setViewingStatus(null); }} style={{ padding: 6 }}>
                <Text style={{ fontSize: 20, color: '#fff', fontWeight: '300' }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Content area */}
            <TouchableOpacity
              activeOpacity={1}
              onPressIn={() => { stopStoryTimer(); pressTimestampRef.current = Date.now(); }}
              onPressOut={() => {
                if (Date.now() - (pressTimestampRef.current || 0) > 300) {
                  startStoryTimer(storyIndex, totalStatuses);
                }
              }}
              onPress={(e) => {
                const x = e.nativeEvent.locationX;
                if (x < SCREEN_WIDTH * 0.3) {
                  if (storyIndex > 0) setStoryIndex(storyIndex - 1);
                  else startStoryTimer(storyIndex, totalStatuses);
                } else if (x > SCREEN_WIDTH * 0.7) {
                  if (storyIndex < totalStatuses - 1) setStoryIndex(storyIndex + 1);
                  else { stopStoryTimer(); setViewingStatus(null); }
                } else {
                  startStoryTimer(storyIndex, totalStatuses);
                }
              }}
              style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 }}
            >
              {currentStatus.imageUrl && (
                <LoadingImage
                  source={{ uri: currentStatus.imageUrl }}
                  style={{ width: SCREEN_WIDTH - 32, height: SCREEN_HEIGHT * 0.5, borderRadius: 16 }}
                  resizeMode="cover"
                  borderRadius={16}
                />
              )}

              {isThemedText && !currentStatus.imageUrl && renderThemedBg(
                currentStatus.themeId,
                <View style={{ paddingVertical: 50, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
                  <Text style={{ fontSize: 22, fontWeight: '700', color: statusTheme.textColor, textAlign: 'center', lineHeight: 32 }}>
                    {currentStatus.caption}
                  </Text>
                </View>,
                { width: SCREEN_WIDTH - 32 }
              )}

              {isPollType && (
                <View style={{ width: SCREEN_WIDTH - 32, padding: 20, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  {currentStatus.caption ? (
                    <Text style={{ fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 16, textAlign: 'center' }}>
                      {currentStatus.caption}
                    </Text>
                  ) : null}
                  {currentStatus.pollOptions.map((opt, i) => {
                    const votes = Array.isArray(currentStatus.pollVotes?.[i]) ? currentStatus.pollVotes[i].length : 0;
                    const pct = pollTotalVotes > 0 ? Math.round((votes / pollTotalVotes) * 100) : 0;
                    const isMyVote = myVoteIndex === i;
                    const hasVoted = myVoteIndex >= 0;
                    return (
                      <TouchableOpacity
                        key={i}
                        onPress={() => !hasVoted && handlePollVote(currentStatus.id, i)}
                        activeOpacity={hasVoted ? 1 : 0.7}
                        style={{
                          marginBottom: 8, borderRadius: 12, overflow: 'hidden',
                          borderWidth: isMyVote ? 2 : 1,
                          borderColor: isMyVote ? '#3B82F6' : 'rgba(255,255,255,0.15)',
                          backgroundColor: 'rgba(255,255,255,0.05)',
                        }}
                      >
                        {hasVoted && (
                          <View style={{
                            position: 'absolute', top: 0, left: 0, bottom: 0,
                            width: `${pct}%`, backgroundColor: isMyVote ? '#3B82F620' : 'rgba(255,255,255,0.08)',
                            borderRadius: 12,
                          }} />
                        )}
                        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 }}>
                          <Text style={{ flex: 1, fontSize: 14, fontWeight: isMyVote ? '700' : '500', color: '#fff' }}>
                            {opt}
                          </Text>
                          {hasVoted && (
                            <Text style={{ fontSize: 13, fontWeight: '700', color: isMyVote ? '#3B82F6' : 'rgba(255,255,255,0.6)' }}>
                              {pct}%
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {pollTotalVotes > 0 && (
                    <Text style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                      {pollTotalVotes} {pollTotalVotes === 1 ? 'vote' : 'votes'}
                    </Text>
                  )}
                </View>
              )}

              {!currentStatus.imageUrl && !isThemedText && !isPollType && currentStatus.caption ? (
                <Text style={{ fontSize: 20, fontWeight: '600', color: '#fff', textAlign: 'center', lineHeight: 30, paddingHorizontal: 20 }}>
                  {currentStatus.caption}
                </Text>
              ) : null}

              {currentStatus.imageUrl && currentStatus.caption ? (
                <Text style={{ fontSize: 15, color: '#fff', marginTop: 12, textAlign: 'center', lineHeight: 22 }}>
                  {currentStatus.caption}
                </Text>
              ) : null}
            </TouchableOpacity>

            {/* Bottom bar */}
            <View style={{ paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 20) + 20, zIndex: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {currentStatus.viewedBy?.length > 0 && (
                    <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                      👁 {currentStatus.viewedBy.length}
                    </Text>
                  )}
                  {reactionEntries.length > 0 && (
                    <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                      {Object.keys(reactionCounts).map(e => `${e}${reactionCounts[e] > 1 ? reactionCounts[e] : ''}`).join(' ')}
                    </Text>
                  )}
                </View>
                {totalStatuses > 1 && (
                  <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                    {storyIndex + 1}/{totalStatuses}
                  </Text>
                )}
              </View>

              {!isMyStatus && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ flexDirection: 'row', flex: 1, gap: 4 }}>
                    {REACTION_EMOJIS.map(emoji => (
                      <TouchableOpacity
                        key={emoji}
                        onPress={() => { stopStoryTimer(); handleReaction(currentStatus.id, emoji); setTimeout(() => startStoryTimer(storyIndex, totalStatuses), 400); }}
                        style={{
                          paddingHorizontal: 8, paddingVertical: 6, borderRadius: 20,
                          backgroundColor: myReaction === emoji ? '#3B82F630' : 'rgba(255,255,255,0.1)',
                          borderWidth: myReaction === emoji ? 1.5 : 0,
                          borderColor: '#3B82F6',
                        }}
                      >
                        <Text style={{ fontSize: 16 }}>{emoji}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity
                    onPress={() => { stopStoryTimer(); handleChatFromStatus(); }}
                    activeOpacity={0.8}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 6,
                      backgroundColor: '#3B82F6', paddingHorizontal: 16, paddingVertical: 10,
                      borderRadius: 24,
                    }}
                  >
                    <FontAwesome name="paper-plane" size={12} color="#fff" solid />
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Chat</Text>
                  </TouchableOpacity>
                </View>
              )}

              {isMyStatus && (
                <View style={{ gap: 8 }}>
                  {(currentStatus.viewedBy?.length > 0 || reactionEntries.length > 0) && (
                    <Text style={{ fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.5)' }}>
                      👁 {currentStatus.viewedBy?.length || 0} views  •  {reactionEntries.length} reactions
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                    <TouchableOpacity
                      onPress={() => { stopStoryTimer(); setViewingStatus(null); setShowCreator(true); }}
                      style={[styles.deleteBtn, { backgroundColor: 'rgba(59,130,246,0.2)' }]}
                    >
                      <FontAwesome name="plus" size={12} color="#3B82F6" solid />
                      <Text style={[styles.deleteText, { color: '#3B82F6' }]}>New</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { stopStoryTimer(); handleDeleteStatus(currentStatus.id); }}
                      style={styles.deleteBtn}
                    >
                      <FontAwesome name="trash" size={12} color="#EF4444" />
                      <Text style={styles.deleteText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {!isMyStatus && isAdminOrMod && (
                <View style={{ alignItems: 'flex-end', marginTop: 6 }}>
                  <TouchableOpacity
                    onPress={() => { stopStoryTimer(); handleDeleteStatus(currentStatus.id); }}
                    style={[styles.deleteBtn, { backgroundColor: '#FEE2E230' }]}
                  >
                    <FontAwesome name="shield" size={10} color="#F59E0B" solid />
                    <FontAwesome name="trash" size={12} color="#EF4444" />
                    <Text style={styles.deleteText}>Mod Delete</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </Modal>
        );
      })()}

      {/* ── Status Creator Modal ── */}
      <Modal visible={showCreator} transparent animationType="slide" onRequestClose={() => setShowCreator(false)}>
        <KeyboardAvoidingView
          style={styles.creatorOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <SwipeableBottomDrawer onClose={() => { setShowCreator(false); setCaption(''); setSelectedImage(null); setSelectedThemeId('none'); setIsPollMode(false); setPollOptions(['', '']); }} isDarkMode={isDarkMode} style={[styles.creatorCard, { backgroundColor: isDarkMode ? '#1e293b' : '#FFF', paddingBottom: Math.max(insets.bottom, 20) + 10 }]}>
            <View style={styles.creatorHeader}>
              <Text style={[styles.creatorTitle, { color: textColor }]}>New Status</Text>
              <TouchableOpacity onPress={() => { setShowCreator(false); setCaption(''); setSelectedImage(null); setSelectedThemeId('none'); setIsPollMode(false); setPollOptions(['', '']); }}>
                <Text style={{ fontSize: 18, color: subtextColor }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Image preview */}
            {selectedImage?.uri && (
              <View style={styles.imagePreviewWrap}>
                <Image source={{ uri: selectedImage.uri }} style={styles.imagePreview} resizeMode="cover" />
                <TouchableOpacity style={styles.removeImageBtn} onPress={() => setSelectedImage(null)}>
                  <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>✕</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Add image / Poll toggle */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {!selectedImage && !isPollMode && (
                <TouchableOpacity
                  style={[styles.addImageBtn, { flex: 1, height: 50, backgroundColor: isDarkMode ? '#0f172a' : '#f1f5f9' }]}
                  onPress={handlePickImage}
                >
                  <FontAwesome name="image" size={16} color={subtextColor} />
                  <Text style={{ color: subtextColor, fontSize: 12, marginLeft: 6 }}>Add Photo</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.addImageBtn, {
                  flex: 1, height: 50,
                  backgroundColor: isPollMode ? '#3B82F615' : (isDarkMode ? '#0f172a' : '#f1f5f9'),
                  borderColor: isPollMode ? '#3B82F6' : (isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
                }]}
                onPress={() => { setIsPollMode(!isPollMode); if (!isPollMode) { setSelectedImage(null); setSelectedThemeId('none'); } }}
              >
                <Text style={{ fontSize: 16 }}>📊</Text>
                <Text style={{ color: isPollMode ? '#3B82F6' : subtextColor, fontSize: 12, fontWeight: isPollMode ? '700' : '500', marginLeft: 6 }}>Poll</Text>
              </TouchableOpacity>
            </View>

            {/* Poll options */}
            {isPollMode && (
              <View style={{ marginBottom: 12 }}>
                {pollOptions.map((opt, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                    <TextInput
                      style={[styles.creatorInput, {
                        flex: 1, minHeight: 40, marginBottom: 0,
                        color: textColor,
                        backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc',
                        borderColor: isDarkMode ? '#334155' : '#e2e8f0',
                      }]}
                      placeholder={`Option ${i + 1}`}
                      placeholderTextColor={subtextColor}
                      maxLength={60}
                      value={opt}
                      onChangeText={(text) => {
                        const updated = [...pollOptions];
                        updated[i] = text;
                        setPollOptions(updated);
                      }}
                    />
                    {pollOptions.length > 2 && (
                      <TouchableOpacity
                        onPress={() => setPollOptions(pollOptions.filter((_, j) => j !== i))}
                        style={{ padding: 8, marginLeft: 4 }}
                      >
                        <Text style={{ color: '#EF4444', fontSize: 14, fontWeight: '700' }}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                {pollOptions.length < 4 && (
                  <TouchableOpacity
                    onPress={() => setPollOptions([...pollOptions, ''])}
                    style={{ alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, backgroundColor: isDarkMode ? '#0f172a' : '#f1f5f9', borderWidth: 1, borderColor: isDarkMode ? '#334155' : '#e2e8f0' }}
                  >
                    <Text style={{ color: subtextColor, fontSize: 12, fontWeight: '600' }}>+ Add Option</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Theme selector */}
            {!selectedImage && !isPollMode && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: subtextColor, marginBottom: 8 }}>Background Theme</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {STATUS_THEMES.map((thm) => (
                    <TouchableOpacity
                      key={thm.id}
                      onPress={() => setSelectedThemeId(thm.id)}
                      style={{
                        width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
                        borderWidth: selectedThemeId === thm.id ? 2.5 : 1,
                        borderColor: selectedThemeId === thm.id ? '#3B82F6' : (isDarkMode ? '#334155' : '#e2e8f0'),
                        ...(thm.colors
                          ? { backgroundColor: thm.colors[0] }
                          : { backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc' }),
                      }}
                    >
                      <Text style={{ fontSize: thm.colors ? 16 : 11, color: thm.colors ? '#fff' : subtextColor }}>
                        {thm.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Theme preview */}
            {!selectedImage && !isPollMode && selectedThemeId !== 'none' && (() => {
              const previewTheme = STATUS_THEMES.find(th => th.id === selectedThemeId);
              if (!previewTheme?.colors) return null;
              return renderThemedBg(
                selectedThemeId,
                <View style={{ paddingVertical: 24, paddingHorizontal: 16, alignItems: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: previewTheme.textColor, textAlign: 'center' }}>
                    {caption.trim() || "What's on your mind?"}
                  </Text>
                </View>,
                { marginBottom: 12 }
              );
            })()}

            <TextInput
              style={[styles.creatorInput, {
                color: textColor,
                backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc',
                borderColor: isDarkMode ? '#334155' : '#e2e8f0',
              }]}
              placeholder={isPollMode ? 'Ask a question...' : "What's on your mind?"}
              placeholderTextColor={subtextColor}
              multiline
              maxLength={200}
              value={caption}
              onChangeText={setCaption}
            />

            <TouchableOpacity
              style={[styles.creatorPostBtn, uploading && { opacity: 0.5 }]}
              onPress={handlePostStatus}
              disabled={uploading}
            >
              {uploading ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator size="small" color="#FFF" />
                  <Text style={styles.creatorPostText}>Uploading...</Text>
                </View>
              ) : (
                <Text style={styles.creatorPostText}>Post Status</Text>
              )}
            </TouchableOpacity>
          </SwipeableBottomDrawer>
        </KeyboardAvoidingView>
      </Modal>

      {/* Profile BottomDrawer */}
      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={() => setIsDrawerVisible(false)}
        startChat={handleStartChatFromDrawer}
        selectedUser={drawerUser}
        bannedUsers={[]}
      />
    </View>
  );
};

const getTimeAgo = (date) => {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    gap: 4,
  },
  bubbleWrap: { alignItems: 'center', width: 72 },
  bubbleRing: {
    width: BUBBLE_SIZE + 4, height: BUBBLE_SIZE + 4,
    borderRadius: (BUBBLE_SIZE + 4) / 2,
    borderWidth: 2.5, borderColor: '#e2e8f0',
    alignItems: 'center', justifyContent: 'center',
  },
  bubbleRingUnseen: { borderColor: '#F59E0B', borderWidth: 2.5 },
  bubbleRingSeen: { borderColor: '#94A3B8', borderWidth: 2 },
  gradientRingOuter: {
    width: BUBBLE_SIZE + 6, height: BUBBLE_SIZE + 6,
    borderRadius: (BUBBLE_SIZE + 6) / 2,
    backgroundColor: '#EC4899',
    alignItems: 'center', justifyContent: 'center',
  },
  gradientRingMiddle: {
    width: BUBBLE_SIZE + 4, height: BUBBLE_SIZE + 4,
    borderRadius: (BUBBLE_SIZE + 4) / 2,
    backgroundColor: '#F59E0B',
    alignItems: 'center', justifyContent: 'center',
  },
  gradientRingInner: {
    width: BUBBLE_SIZE, height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
  },
  bubbleAvatar: {
    width: BUBBLE_SIZE - 4, height: BUBBLE_SIZE - 4,
    borderRadius: (BUBBLE_SIZE - 4) / 2,
  },
  addBadge: {
    position: 'absolute', bottom: 18, right: 8,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#3B82F6',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FFF',
  },
  bubbleName: { fontSize: 10, fontWeight: '500', marginTop: 3, textAlign: 'center' },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 8, alignSelf: 'flex-end',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 6, backgroundColor: '#FEE2E2',
  },
  deleteText: { color: '#EF4444', fontSize: 11, fontWeight: '600' },
  // Creator
  creatorOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  creatorCard: { padding: 20 },
  creatorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  creatorTitle: { fontSize: 18, fontWeight: '700' },
  imagePreviewWrap: { position: 'relative', marginBottom: 12 },
  imagePreview: { width: '100%', height: 200, borderRadius: 12 },
  removeImageBtn: {
    position: 'absolute', top: 8, right: 8,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  addImageBtn: {
    flexDirection: 'row',
    height: 80, borderRadius: 12, marginBottom: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)', borderStyle: 'dashed',
  },
  creatorInput: {
    borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15,
    minHeight: 80, textAlignVertical: 'top', marginBottom: 16,
  },
  creatorPostBtn: {
    backgroundColor: '#3B82F6', paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 12, alignItems: 'center',
  },
  creatorPostText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
});

export default React.memo(StatusFeed);
