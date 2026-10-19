import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Text,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
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
  serverTimestamp,
  updateDoc,
  deleteDoc,
  onSnapshot,
  addDoc,
  writeBatch,
  deleteField,

} from '@react-native-firebase/firestore';
import { ref as dbRef, get } from '@react-native-firebase/database';

import { useGlobalState, modGateText } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { bannerAware, FLOATING_BUTTON_ICON_SIZE, FLOATING_BUTTON_RIGHT, aboveBanner } from '../Helper/floatingButtonLayout';
import { useBannerHeight } from '../Ads/bannerHeight';
import PostCard from './componenets/PostCard';
import UploadModal from './componenets/UploadModal';
import SignInDrawer from '../Firebase/SigninDrawer';
import config from '../Helper/Environment';
import { Platform } from 'react-native';
import { getMyCosmetics } from '../Helper/cosmeticsCache';
import { getCachedFollowingIds, setCachedFollowingIds } from '../Helper/followingCache';
import { showMessage } from 'react-native-flash-message';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import FeedBannerAd from '../Ads/FeedBannerAd';
import { useFeedAdGate, FEED_AD_VIEWABILITY } from '../Ads/feedAdGate';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import PostsHeader from './componenets/PostsHeader';
import PollCard from './componenets/PollCard';
import { fetchActivePolls as sbFetchActivePolls } from '../Supabase/pollsBackend';
import { awardBadge, incrementAndCheckBadge, REACTION_BADGE_THRESHOLDS } from '../ChatScreen/GroupChat/badgeUtils';


const DesignFeedScreen = ({ route }) => {
  // Floating buttons clear the real banner height (Ads/bannerHeight.js).
  const bannerHeight = useBannerHeight();
  const { selectedTheme } = route.params;
  const { appdatabase, user, theme, firestoreDB, isBabyMod, isTrusted, isGrinder, isRaider, isHelper, proGranted, getModGate } = useGlobalState();
  const { localState } = useLocalState();
  const isDarkMode = theme === 'dark';
  const navigation = useNavigation();
  const { t } = useTranslation();

  // Scroll-to-top. The Feed had no such control while Trades and group chat
  // both did — same kind of list, same need.
  const feedListRef = useRef(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const handleFeedScroll = useCallback((e) => {
    setShowScrollTop((e?.nativeEvent?.contentOffset?.y || 0) > 300);
  }, []);
  const handleFeedScrollToTop = useCallback(() => {
    feedListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  const [modalVisible, setModalVisible] = useState(false);
  const [isSigninDrawerVisible, setSigninDrawerVisible] = useState(false);
  const [posts, setPosts] = useState([]);
  const [lastVisibleDoc, setLastVisibleDoc] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterMyPosts, setFilterMyPosts] = useState(false);
  const [myPosts, setMyPosts] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [filterFollowing, setFilterFollowing] = useState(false);
  const [followingIds, setFollowingIds] = useState([]);
  const [followingPosts, setFollowingPosts] = useState([]);
  const [bannedUsers, setBannedUsers] = useState([]);
  const [lastPostTime, setLastPostTime] = useState(null);
  const [isSubmittingPost, setIsSubmittingPost] = useState(false);
  const [activeSort, setActiveSort] = useState('latest');
  const [rankedPosts, setRankedPosts] = useState([]);

  const AD_FREQUENCY = 5;

  // Polls
  const [activePolls, setActivePolls] = useState([]);

  const fetchActivePolls = useCallback(async () => {
    try {
      const polls = await sbFetchActivePolls(user?.id || null, 3);
      setActivePolls(polls || []);
    } catch (err) {
      console.error('[Poll] Fetch polls error:', err);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchActivePolls();
  }, [fetchActivePolls]);

  useEffect(() => {
    // if (!user?.id) return;
    setBannedUsers(localState.bannedUsers)

  }, [localState.bannedUsers]);
  function interleaveAds(items, showAds) {
    if (!showAds) return items;
    const out = [];
    let real = 0;
    for (let i = 0; i < items.length; i++) {
      out.push(items[i]);
      real++;
      if (real > 0 && real % AD_FREQUENCY === 0) {
        out.push({ __type: 'ad', id: `ad-${i}` });
      }
    }
    return out;
  }
  const fetchMyPosts = async (tag = null) => {
    if (!user?.id) return;
    setInitialLoading(true);
    setActiveSort('latest'); // keep sort state coherent with the filter
    try {
      let q = query(
        collection(firestoreDB, 'designPosts_upgrade'),
        where('userId', '==', user.id),
        orderBy('createdAt', 'desc'),
        limit(200)
      );

      if (tag) {
        q = query(
          collection(firestoreDB, 'designPosts_upgrade'),
          where('userId', '==', user.id),
          where('selectedTags', 'array-contains', tag),
          orderBy('createdAt', 'desc'),
          limit(200)
        );

      }

      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setMyPosts(data);
      setHasMore(snapshot.docs.length > 0);
    } catch (err) {
      console.error('Error fetching my posts:', err);
      showMessage({ message: i18next.t('feed.design_main.fetch_my_failed'), type: 'danger' });
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  };

  // Stable callbacks (useCallback) so memo(PostCard) can actually skip
  // re-rendering cards when the screen re-renders — same as Adopt Me.
  const deleteUsersLatestPosts = useCallback(async (userId, n = 15) => {
    if (!userId) throw new Error('userId is required');

    const q = query(
      collection(firestoreDB, 'designPosts_upgrade'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(n)
    );

    const snap = await getDocs(q);
    if (snap.empty) return [];

    const batch = writeBatch(firestoreDB);
    const ids = [];

    snap.docs.forEach(d => {
      batch.delete(d.ref);
      ids.push(d.id);
    });

    await batch.commit();
    return ids;
  }, [firestoreDB]);
  // useEffect(() => {
  //   nativeAdPool.fillIfNeeded();
  //   return () => nativeAdPool.destroyAll();
  // }, []);


  const fetchPostsByTag = async (tag) => {
    try {
      setInitialLoading(true);
      // Tag results render from `posts`, which baseList only shows while
      // activeSort === 'latest' — clear any Hot/Trending sort or the tag
      // tap appears to do nothing.
      setActiveSort('latest');

      const q = query(
        collection(firestoreDB, 'designPosts_upgrade'),
        where('selectedTags', 'array-contains', tag),
        orderBy('createdAt', 'desc'),
        limit(5)
      );

      const snapshot = await getDocs(q);


      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPosts(data);
      setLastVisibleDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 5);
    } catch (err) {
      console.error('Error fetching posts by tag:', err);
      showMessage({ message: i18next.t('feed.design_main.fetch_failed'), type: 'danger' });
    } finally {
      setInitialLoading(false);
    }
  };


  const skeletonArray = useMemo(() => Array.from({ length: 5 }), []);
  const handleDeletePost = useCallback(async (postId) => {
    try {
      await deleteDoc(doc(firestoreDB, 'designPosts_upgrade', postId));
      setPosts(prev => prev.filter(p => p.id !== postId));
      showMessage({ message: i18next.t('feed.design_main.post_deleted'), type: 'success' });
    } catch (err) {
      showMessage({ message: i18next.t('feed.design_main.delete_failed'), type: 'danger' });
    }
  }, [firestoreDB]);



  const fetchInitialPosts = async () => {
    try {
      // Leave any Hot/Trending sort — this IS the "latest" feed. Without
      // this, toggling a filter off while sorted by Hot/Trending kept
      // rendering rankedPosts and the feed looked stuck/empty.
      setActiveSort('latest');
      const q = query(
        collection(firestoreDB, 'designPosts_upgrade'),
        orderBy('createdAt', 'desc'),
        limit(5)
      );

      const snapshot = await getDocs(q);

      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPosts(data);
      setLastVisibleDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 5);
    } catch (err) {
      console.error('Initial load error:', err);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchInitialPosts();
  }, []);

  // ── Fetch who I follow ──
  // Served from MMKV (1 h TTL, keyed by uid); the query only runs when the
  // cache is cold or a follow/unfollow cleared it.
  useEffect(() => {
    if (!user?.id || !firestoreDB) return;
    const cachedIds = getCachedFollowingIds(user.id);
    if (cachedIds !== null) {
      setFollowingIds(cachedIds);
      return;
    }
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
        setCachedFollowingIds(user.id, ids);
      } catch (err) {
        console.warn('[Posts] Error fetching following list:', err?.message);
      }
    })();
  }, [user?.id, firestoreDB]);

  // ── Fetch posts from followed users (PAGINATED) ──
  const lastFollowingDocRef = useRef(null);
  const followingHasMoreRef = useRef(true);

  const fetchFollowingPosts = async (isLoadMore = false) => {
    if (!user?.id || followingIds.length === 0) {
      setFollowingPosts([]);
      setInitialLoading(false);
      return;
    }

    if (isLoadMore && !followingHasMoreRef.current) return;
    if (!isLoadMore) {
      setInitialLoading(true);
      setActiveSort('latest'); // keep sort state coherent with the filter
      lastFollowingDocRef.current = null;
      followingHasMoreRef.current = true;
    } else {
      setLoadingMore(true);
    }

    try {
      const chunk = followingIds.slice(0, 30);
      const PAGE = 5;

      let q;
      if (isLoadMore && lastFollowingDocRef.current) {
        q = query(
          collection(firestoreDB, 'designPosts_upgrade'),
          where('userId', 'in', chunk),
          orderBy('createdAt', 'desc'),
          startAfter(lastFollowingDocRef.current),
          limit(PAGE),
        );
      } else {
        q = query(
          collection(firestoreDB, 'designPosts_upgrade'),
          where('userId', 'in', chunk),
          orderBy('createdAt', 'desc'),
          limit(PAGE),
        );
      }

      const snap = await getDocs(q);
      const newPosts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      lastFollowingDocRef.current = snap.docs[snap.docs.length - 1] || null;
      followingHasMoreRef.current = snap.docs.length === PAGE;
      setHasMore(snap.docs.length === PAGE);

      if (isLoadMore) {
        setFollowingPosts(prev => [...prev, ...newPosts]);
      } else {
        setFollowingPosts(newPosts);
      }
    } catch (err) {
      console.error('[Posts] Error fetching following posts:', err);
    } finally {
      setInitialLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  };

  // ── Fetch ranked posts (Hot / Trending) from RTDB ──
  const fetchRankedPosts = useCallback(async (sortKey) => {
    if (!appdatabase || !firestoreDB) return;
    setInitialLoading(true);
    try {
      const rankingRef = dbRef(appdatabase, `feedRanking/${sortKey}`);
      const snap = await get(rankingRef);

      if (!snap.exists()) {
        setRankedPosts([]);
        setInitialLoading(false);
        return;
      }

      const ranking = snap.val();
      if (!Array.isArray(ranking) || ranking.length === 0) {
        setRankedPosts([]);
        setInitialLoading(false);
        return;
      }

      const postIds = ranking.map(r => r.postId).filter(Boolean);
      const postPromises = postIds.map(id =>
        getDoc(doc(firestoreDB, 'designPosts_upgrade', id))
          .then(d => d.exists() ? { id: d.id, ...d.data() } : null)
          .catch(() => null)
      );

      const fetchedPosts = await Promise.all(postPromises);
      const validPosts = fetchedPosts.filter(Boolean);

      const orderMap = new Map(postIds.map((id, idx) => [id, idx]));
      validPosts.sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));

      setRankedPosts(validPosts);
      setHasMore(false);
    } catch (err) {
      console.warn(`[Feed] Error fetching ${sortKey} posts:`, err?.message);
      setRankedPosts([]);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [appdatabase, firestoreDB]);

  // ── Handle sort mode changes ──
  const handleSortChange = useCallback((sortKey) => {
    setActiveSort(sortKey);
    if (sortKey === 'latest') {
      fetchInitialPosts();
    } else {
      fetchRankedPosts(sortKey);
    }
  }, [fetchInitialPosts, fetchRankedPosts]);

  // PostsHeader is now rendered inline as part of the FlatList ListHeaderComponent

  // ✅ OPTIMIZED: Removed per-post onSnapshot listeners to reduce Firestore reads
  // Real-time updates removed - posts will refresh on manual refresh or when screen refocuses
  // This reduces reads from N listeners (where N = number of posts) to 0 continuous reads
  // Users can manually refresh if they need latest data

  const loadMorePosts = async () => {
    if (loadingMore || !hasMore) return;

    // Following filter has its own pagination
    if (filterFollowing) {
      fetchFollowingPosts(true);
      return;
    }

    // Ranked posts (hot/trending) have no pagination
    if (activeSort !== 'latest') return;

    if (!lastVisibleDoc) return;

    setLoadingMore(true);
    try {
      let q;

      if (selectedTag) {
        q = query(
          collection(firestoreDB, 'designPosts_upgrade'),
          where('selectedTags', 'array-contains', selectedTag),
          orderBy('createdAt', 'desc'),
          startAfter(lastVisibleDoc),
          limit(10)
        );
      } else {
        q = query(
          collection(firestoreDB, 'designPosts_upgrade'),
          orderBy('createdAt', 'desc'),
          startAfter(lastVisibleDoc),
          limit(10)
        );
      }

      const snapshot = await getDocs(q);
      const newPosts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPosts(prev => [...prev, ...newPosts]);
      setLastVisibleDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 10);
    } catch (err) {
      console.error('Pagination load error:', err);
    } finally {
      setLoadingMore(false);
    }
  };


  const handleReaction = useCallback(async (post, emoji) => {
    const userId = user?.id;
    if (!userId) return;
    // Banned users can't react (a mute is chat-only).
    const modGate = getModGate('action');
    if (modGate) {
      const { title, message } = modGateText(modGate, 'react');
      Alert.alert(title, message);
      return;
    }

    const postRef = doc(firestoreDB, 'designPosts_upgrade', post.id);
    const currentReaction = post.reactions?.[userId];
    const hadOldLike = !!post.likes?.[userId];

    // Optimistic local update
    const optimisticUpdate = (p) => {
      if (p.id !== post.id) return p;
      const updatedReactions = { ...(p.reactions || {}) };
      const updatedLikes = { ...(p.likes || {}) };
      if (currentReaction === emoji) {
        delete updatedReactions[userId];
      } else {
        updatedReactions[userId] = emoji;
        if (hadOldLike) delete updatedLikes[userId];
      }
      return { ...p, reactions: updatedReactions, likes: updatedLikes };
    };
    setPosts(prev => prev.map(optimisticUpdate));
    setMyPosts(prev => prev.map(optimisticUpdate));
    setRankedPosts(prev => prev.map(optimisticUpdate));

    try {
      if (currentReaction === emoji) {
        await updateDoc(postRef, {
          [`reactions.${userId}`]: deleteField(),
        });
      } else {
        const updates = {
          [`reactions.${userId}`]: emoji,
        };
        if (hadOldLike) {
          updates[`likes.${userId}`] = deleteField();
        }
        await updateDoc(postRef, updates);

        // 🏅 Badge tracking: reaction count for post author
        if (appdatabase && post.userId && post.userId !== userId) {
          incrementAndCheckBadge(appdatabase, post.userId, 'reactionCount', REACTION_BADGE_THRESHOLDS);
        }
      }
    } catch (error) {
      console.error('Error updating reaction:', error);
      // Revert on failure
      setPosts(prev => prev.map(p => p.id === post.id ? post : p));
      setMyPosts(prev => prev.map(p => p.id === post.id ? post : p));
      setRankedPosts(prev => prev.map(p => p.id === post.id ? post : p));
      showMessage({
        message: i18next.t('home.alert.error'),
        description: i18next.t('feed.design_main.reaction_failed'),
        type: 'danger',
      });
    }
  }, [user?.id, firestoreDB, getModGate]);

  const handleUploadPost = async (desc, imageUrls, selectedTags) => {
    // ✅ Prevent multiple submissions - check if already submitting
    if (isSubmittingPost) {
      return;
    }

    if (!user?.id) return;

    // Second line of defence behind UploadModal's gate: banned users can't post.
    const modGate = getModGate('content');
    if (modGate) {
      const { title, message } = modGateText(modGate, 'post');
      Alert.alert(title, message);
      return;
    }

    // ✅ Set submitting state IMMEDIATELY to prevent duplicate submissions
    setIsSubmittingPost(true);

    try {
      // ✅ 2-minute cooldown check (using Date.now() for accurate comparison)
      const now = Date.now();
      const COOLDOWN_MS = 120000; // 2 minutes
      if (lastPostTime && (now - lastPostTime) < COOLDOWN_MS) {
        const secondsLeft = Math.ceil((COOLDOWN_MS - (now - lastPostTime)) / 1000);
        const minutesLeft = Math.floor(secondsLeft / 60);
        const remainingSeconds = secondsLeft % 60;
        const timeMessage = minutesLeft > 0
          ? i18next.t('feed.design_main.time_min_sec', {
              minutes: i18next.t('feed.design_main.minutes', { count: minutesLeft }),
              seconds: i18next.t('feed.design_main.seconds', { count: remainingSeconds }),
            })
          : i18next.t('feed.design_main.seconds', { count: secondsLeft });
        showMessage({
          message: i18next.t('feed.design_main.cooldown', { time: timeMessage }),
          type: 'danger',
          duration: 3000
        });
        setIsSubmittingPost(false);
        throw new Error('Cooldown period not elapsed'); // ✅ Throw error to prevent clearing form
      }
      // ✅ Tags are mandatory
      if (!selectedTags || (Array.isArray(selectedTags) && selectedTags.length === 0)) {
        showMessage({
          message: i18next.t('feed.design_main.missing_tag'),
          description: i18next.t('feed.design_main.select_tag'),
          type: 'danger',
        });
        setIsSubmittingPost(false);
        throw new Error('Missing tags'); // ✅ Throw error to prevent clearing form
      }

      // Ensure imageUrls is an array (PostCard expects imageUrl as array)
      const imageUrlArray = Array.isArray(imageUrls)
        ? imageUrls.filter(url => url && typeof url === 'string' && url.trim().length > 0)
        : (imageUrls && typeof imageUrls === 'string' && imageUrls.trim().length > 0 ? [imageUrls] : []);

      // ✅ Images are optional - posts can have text only, images only, or both
      // ✅ Tags are always required and must be saved to database
      const post = {
        imageUrl: imageUrlArray.length > 0 ? imageUrlArray : [], // PostCard expects imageUrl as array
        desc: (desc && desc.trim()) || "",
        userId: user?.id || "Anonymous",
        displayName: user?.displayName || "Anonymous",
        avatar: user?.avatar || null,
        createdAt: serverTimestamp(),
        likes: {},
        selectedTags: Array.isArray(selectedTags) && selectedTags.length > 0
          ? selectedTags
          : (selectedTags ? [selectedTags] : ['Discussion']), // ✅ Always ensure tags exist
        // No `email` (round 2): posts are world-readable and nothing reads it
        // back. UploadModal still runs its ban check on the auth email first.
        report: false,
        flage: user?.flage || null,
        isBabyMod: !!isBabyMod,
        isTrusted: !!isTrusted,
        isGrinder: !!isGrinder,
        isRaider: !!isRaider,
        // Helper badge + staff-given title, stamped like the roles above.
        isHelper: !!isHelper,
        customTitle: typeof user?.customTitle === 'string' ? user.customTitle : null,
        profileFrame: getMyCosmetics()?.profileFrame || null,
      };

      await addDoc(collection(firestoreDB, 'designPosts_upgrade'), post);

      // 🏅 Badge tracking: first post
      if (appdatabase && user?.id) {
        awardBadge(appdatabase, user.id, 'firstPost');
      }

      // ✅ Update last post time after successful upload
      setLastPostTime(now);

      // ✅ Refresh feed after posting
      setRefreshing(true);
      await fetchInitialPosts();

      showMessage({
        message: i18next.t('home.alert.success'),
        description: i18next.t('feed.design_main.post_created'),
        type: 'success',
      });
    } catch (error) {
      console.error('Error uploading post:', error);
      // ✅ Only show error message if it's not a validation error (cooldown/tags)
      if (!error.message || (!error.message.includes('Cooldown') && !error.message.includes('tags'))) {
        showMessage({
          message: i18next.t('feed.design_main.upload_failed'),
          description: i18next.t('feed.design_main.upload_failed_body'),
          type: 'danger',
        });
      }
      // ✅ Re-throw error so UploadModal can handle it and prevent form clearing
      throw error;
    } finally {
      // ✅ Always reset submitting state, even if there was an error
      setIsSubmittingPost(false);
    }
  };

  // Feed ad rows load only near the screen (Ads/feedAdGate.js).
  const feedAdGate = useFeedAdGate();
  const renderItem = useCallback(({ item, index }) => {
    if (initialLoading) {
      return <View style={[styles.skeletonPost, isDarkMode && { backgroundColor: '#444' }]} />;
    }
    if (item?.__type === 'ad') {
      // In-feed ad keyed by the stable interleave id (`ad-N`); the slot
      // collapses to zero height until an ad fills.
      return <FeedBannerAd adKey={item.id} isDarkMode={isDarkMode} gate={feedAdGate} />;
    }

    return (
      <PostCard
        item={item}
        userId={user?.id}
        onReaction={handleReaction}
        localState={localState}
        appdatabase={appdatabase}
        onDelete={handleDeletePost}
        onDeleteAll={deleteUsersLatestPosts}

      />
    );
  }, [feedAdGate, initialLoading, isDarkMode, user?.id, handleReaction, localState, appdatabase, handleDeletePost, deleteUsersLatestPosts]);

  // const dataToRender = initialLoading
  //   ? skeletonArray
  //   : filterMyPosts
  //     ? myPosts
  //     : posts;
  const baseList = initialLoading
    ? skeletonArray
    : filterMyPosts
      ? myPosts
      : filterFollowing
        ? followingPosts
        : (activeSort !== 'latest' ? rankedPosts : posts);

  // keep ads; drop banned users' posts
  const filteredBase = useMemo(() => {
    if (initialLoading) return skeletonArray;
    if (!Array.isArray(bannedUsers) || bannedUsers.length === 0) return baseList;
    return baseList.filter(item =>
      item?.__type === 'ad' || !bannedUsers.includes(item?.userId)
    );
  }, [initialLoading, baseList, bannedUsers, skeletonArray]);

  const dataToRender = initialLoading
    ? skeletonArray
    // Interleave an in-feed ad every AD_FREQUENCY posts for non-Pro users
    // (matches adoptme). Was hardcoded `false`, so no feed ad ever rendered.
    : interleaveAds(filteredBase, !(localState?.isPro || proGranted));
  feedAdGate.setData(dataToRender);

  const keyExtractor = useCallback((item, index) =>
    // initialLoading ? `skeleton-${index}` : item?.id || `post-${index}`;
    initialLoading
      ? `skeleton-${index}`
      : item?.__type === 'ad'
        ? item.id
        : `${item?.id}_${index}}` || `post-${index}`, [initialLoading]);

  return (
    <View style={[styles.container, isDarkMode && styles.darkContainer]}>

      {/* ── Filter Bar (outside FlatList to avoid touch conflicts) ── */}
      <PostsHeader
        selectedTag={selectedTag}
        filterMyPosts={filterMyPosts}
        setFilterMyPosts={setFilterMyPosts}
        filterFollowing={filterFollowing}
        setFilterFollowing={setFilterFollowing}
        setSelectedTag={setSelectedTag}
        fetchInitialPosts={fetchInitialPosts}
        fetchMyPosts={fetchMyPosts}
        fetchFollowingPosts={fetchFollowingPosts}
        fetchPostsByTag={fetchPostsByTag}
        activeSort={activeSort}
        onSortChange={handleSortChange}
      />

      <View style={{ flex: 1 }}>
        <FlatList
          ref={feedListRef}
          onScroll={handleFeedScroll}
          scrollEventThrottle={16}
          data={dataToRender}
          onViewableItemsChanged={feedAdGate.onViewableItemsChanged}
          viewabilityConfig={FEED_AD_VIEWABILITY}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 100, flexGrow: 1 }}
          onEndReached={loadMorePosts}
          onEndReachedThreshold={0.5}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            if (activeSort !== 'latest') {
              fetchRankedPosts(activeSort);
            } else {
              fetchInitialPosts();
            }
            fetchActivePolls();
          }}
          ListHeaderComponent={
            activePolls.length > 0 ? (
              <View style={{ paddingHorizontal: 10, paddingTop: 8 }}>
                {activePolls.map((p) => (
                  <PollCard
                    key={p.id}
                    poll={p}
                    user={user}
                    isDarkMode={isDarkMode}
                    onRequireSignIn={() => setSigninDrawerVisible(true)}
                  />
                ))}
              </View>
            ) : null
          }
          ListFooterComponent={
            loadingMore && !initialLoading ? (
              <ActivityIndicator size="small" color={config.colors.primary} style={{ marginVertical: 16 }} />
            ) : null
          }
          ListEmptyComponent={
            !initialLoading && (
              <View style={styles.emptyState}>
                <FontAwesome name="newspaper" size={48} color={isDarkMode ? '#334155' : '#cbd5e1'} />
                <Text style={styles.emptyTitle}>
                  {filterMyPosts ? t('feed.design_main.empty_mine') : filterFollowing ? t('feed.design_main.empty_following') : t('feed.design_main.empty_all')}
                </Text>
                <Text style={styles.emptySubtitle}>{t('feed.design_main.empty_subtitle')}</Text>
              </View>
            )
          }
        />

        {/* ── Scroll to top ── Matches Trades and group chat: same icon, size,
            blue and position, all from Helper/floatingButtonLayout. */}
        {showScrollTop && (
          <TouchableOpacity
            style={[styles.feedScrollTop, { bottom: bannerAware(aboveBanner(bannerHeight), !!(localState?.isPro || proGranted), bannerHeight) }]}
            onPress={handleFeedScrollToTop}
            activeOpacity={0.8}
          >
            <Ionicons name="chevron-up-circle" size={FLOATING_BUTTON_ICON_SIZE} color={'#3b82f6'} />
          </TouchableOpacity>
        )}

        {/* ── FAB ── Sits one row above the scroll button so the two never
            overlap. Keeps the brand colour: creating a post and scrolling are
            different actions and shouldn't look identical. */}
        <TouchableOpacity
          style={[
            styles.fab,
            { bottom: bannerAware(aboveBanner(bannerHeight), !!(localState?.isPro || proGranted), bannerHeight) + (showScrollTop ? FLOATING_BUTTON_ICON_SIZE + 12 : 0) },
          ]}
          onPress={() => user?.id ? setModalVisible(true) : setSigninDrawerVisible(true)}
          activeOpacity={0.85}
        >
          <View style={styles.fabInner}>
            <FontAwesome name="plus" size={20} color={'#fff'} />
          </View>
        </TouchableOpacity>

        <UploadModal
          visible={modalVisible}
          onClose={() => setModalVisible(false)}
          onUpload={handleUploadPost}
          user={user}
        />

        <SignInDrawer
          visible={isSigninDrawerVisible}
          onClose={() => setSigninDrawerVisible(false)}
          selectedTheme={selectedTheme}
          screen="Design"
          message={t('feed.design_main.signin_message')}
        />
        {!(localState.isPro || proGranted) && <BannerAdComponent collapsible />}

      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  darkContainer: {
    backgroundColor: '#0a0f1e',
  },
  fab: {
    position: 'absolute',
    right: FLOATING_BUTTON_RIGHT,
  },
  feedScrollTop: {
    position: 'absolute',
    right: FLOATING_BUTTON_RIGHT,
    zIndex: 1000,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  fabInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: config.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: config.colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  skeletonPost: {
    height: 180,
    marginHorizontal: 12,
    marginVertical: 6,
    backgroundColor: '#e0e0e0',
    borderRadius: 20,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#94a3b8',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748b',
  },
});

export default DesignFeedScreen;
