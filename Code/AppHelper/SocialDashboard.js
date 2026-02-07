import React, { useEffect, useState, useMemo, useCallback, useRef, memo } from 'react';
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
} from 'react-native';
import { getDatabase, ref, get, query, orderByChild, startAt, endAt, limitToFirst } from '@react-native-firebase/database';
import { collection, getDocs, query as firestoreQuery, where, orderBy, limit, startAfter, deleteDoc, doc } from '@react-native-firebase/firestore';
import { useGlobalState } from '../GlobelStats';
import { useNavigation } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';
import config from '../Helper/Environment';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

// ✅ Constants for optimization
const ACTIVITY_PAGE_SIZE = 15;
const FRIEND_PAGE_SIZE = 15;
const SEARCH_LIMIT = 15;
const FIRESTORE_IN_BATCH_SIZE = 10; // Smaller batch for better cost efficiency

// ✅ Memoized User Card to prevent re-renders
const UserCard = memo(({ item, isDark, isFollowing, onPress }) => (
    <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        style={[styles.card, { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF', borderColor: isDark ? '#2C2C2E' : '#F2F2F7' }]}
    >
        <Image source={{ uri: item.avatar }} style={styles.avatar} />
        <View style={styles.cardContent}>
            <Text style={[styles.name, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
                {item.displayName}
            </Text>
            {item.robloxUsername && (
                <Text style={[styles.email, { color: isDark ? '#8E8E93' : '#666' }]} numberOfLines={1}>
                    @{item.robloxUsername}
                </Text>
            )}
        </View>

        <View style={styles.actionContainer}>
            {isFollowing ? (
                <View style={styles.followingBadge}>
                    <Text style={styles.followingText}>Following</Text>
                </View>
            ) : (
                <View style={styles.notFollowingBadge}>
                    <Text style={styles.notFollowingText}>Not Following</Text>
                </View>
            )}
            <Ionicons name="chevron-forward" size={20} color={isDark ? '#555' : '#CCC'} style={{ marginLeft: 8 }} />
        </View>
    </TouchableOpacity>
));

// ✅ Memoized Activity Card to prevent re-renders
const ActivityCard = memo(({ item, isDark, onPress }) => {
    const timeAgo = item.createdAt?.toDate ? dayjs(item.createdAt.toDate()).fromNow() : 'recently';
    const activityType = item.type === 'design_post'
        ? 'posted a new design'
        : item.type === 'trade_post'
            ? 'posted a new trade'
            : 'shared an update';

    return (
        <TouchableOpacity
            activeOpacity={0.7}
            onPress={onPress}
            style={[styles.activityCard, { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF', borderColor: isDark ? '#2C2C2E' : '#F2F2F7' }]}
        >
            <Image source={{ uri: item.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }} style={styles.activityAvatar} />
            <View style={styles.activityContent}>
                <Text style={[styles.activityHeader, { color: isDark ? '#FFF' : '#000' }]}>
                    <Text style={styles.activityName}>{item.displayName}</Text> {activityType}
                </Text>
                {item.preview && (
                    <Text style={[styles.activityPreview, { color: isDark ? '#8E8E93' : '#666' }]} numberOfLines={2}>
                        {item.preview}
                    </Text>
                )}
                <Text style={[styles.activityTime, { color: isDark ? '#555' : '#999' }]}>{timeAgo}</Text>
            </View>
            {item.imagePreview && (
                <Image source={{ uri: item.imagePreview }} style={styles.activityImage} />
            )}
        </TouchableOpacity>
    );
});

const SocialDashboard = () => {
    const { theme, user: currentUser, appdatabase, firestoreDB } = useGlobalState();
    useTranslation(); // Keep for i18n context (strings are plain English)
    const navigation = useNavigation();
    const isDark = theme === 'dark';
    const db = useMemo(() => appdatabase || getDatabase(), [appdatabase]);

    // Tabs: 'friends' or 'search' (no activity tracking in this project)
    const [activeTab, setActiveTab] = useState('friends');

    // ✅ Refs for preventing duplicate fetches
    const friendIdsCacheRef = useRef('');
    const activitiesFetchedRef = useRef(false);
    const lastActivityDocRef = useRef(null);
    const isMounted = useRef(true);
    const friendsRef = useRef([]); // ✅ New Ref to track friends

    // Friends Data
    const [friends, setFriends] = useState([]);
    const [friendIds, setFriendIds] = useState([]);
    const [loadingFriends, setLoadingFriends] = useState(true);
    const [loadingMoreFriends, setLoadingMoreFriends] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    // ✅ Friend Search Data (New)
    const [friendSearchResults, setFriendSearchResults] = useState([]);
    const [isFriendSearchActive, setIsFriendSearchActive] = useState(false);
    const [loadingFriendSearch, setLoadingFriendSearch] = useState(false);

    // Activity Data
    const [activities, setActivities] = useState([]);
    const [loadingActivities, setLoadingActivities] = useState(false);
    const [hasMoreActivities, setHasMoreActivities] = useState(true);
    const [loadingMoreActivities, setLoadingMoreActivities] = useState(false);

    // Search Data
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [loadingSearch, setLoadingSearch] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);

    // Profile Drawer
    const [selectedUser, setSelectedUser] = useState(null);
    const [isDrawerVisible, setIsDrawerVisible] = useState(false);

    // ✅ Cleanup on unmount & Update Refs
    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    // ✅ Keep Ref updated
    useEffect(() => {
        friendsRef.current = friends;
    }, [friends]);

    // ─────────────────────────────────────────────
    // ✅ Helper: Fetch User Details Batch from RTDB
    const fetchUsersFromRTDB = useCallback(async (ids) => {
        if (!ids || ids.length === 0) return [];

        const results = await Promise.all(
            ids.map(async (friendId) => {
                try {
                    const [displayNameSnap, avatarSnap, robloxUsernameSnap, robloxVerifiedSnap] = await Promise.all([
                        get(ref(db, `users/${friendId}/displayName`)),
                        get(ref(db, `users/${friendId}/avatar`)),
                        get(ref(db, `users/${friendId}/robloxUsername`)),
                        get(ref(db, `users/${friendId}/robloxUsernameVerified`)),
                    ]);

                    return {
                        id: friendId,
                        displayName: displayNameSnap.val() || 'Unknown',
                        avatar: avatarSnap.val() || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                        robloxUsername: robloxUsernameSnap.val() || null,
                        robloxUsernameVerified: robloxVerifiedSnap.val() || false,
                    };
                } catch (err) {
                    console.error('Error fetching friend data:', err);
                    return null;
                }
            })
        );
        return results.filter(Boolean);
    }, [db]);

    // ─────────────────────────────────────────────
    // ✅ OPTIMIZED: Fetch Friends List from Firestore (Paginated)
    const fetchFriends = useCallback(async (forceRefresh = false) => {
        if (!currentUser?.id || !firestoreDB) {
            setFriends([]);
            setFriendIds([]);
            setLoadingFriends(false);
            return;
        }

        // ✅ Reset Search Mode when refreshing or loading
        if (forceRefresh) {
            setIsFriendSearchActive(false);
            setFriendSearchResults([]);
        }

        // ⚠️ Don't set loading TRUE yet if we might hit cache
        // setLoadingFriends(true); 

        try {
            // Query Firestore for users this person follows
            const followingSnapshot = await getDocs(
                firestoreQuery(
                    collection(firestoreDB, 'following'),
                    where('followerId', '==', currentUser.id)
                )
            );

            if (!isMounted.current) return;

            if (followingSnapshot.empty) {
                setFriends([]);
                setFriendIds([]);
                friendIdsCacheRef.current = '';
                setLoadingFriends(false);
                setRefreshing(false);
                return;
            }

            const followingIds = followingSnapshot.docs.map(doc => doc.data().followingId);
            const idsKey = followingIds.sort().join(',');

            // ✅ Skip fetching if IDs haven't changed (unless force refresh)
            // Use Ref to check length without adding dependency
            if (!forceRefresh && idsKey === friendIdsCacheRef.current && friendsRef.current.length > 0) {
                setLoadingFriends(false);
                setRefreshing(false);
                return;
            }

            // NOW set loading true since we are actually fetching data
            setLoadingFriends(true);

            friendIdsCacheRef.current = idsKey;
            setFriendIds(followingIds);

            // ✅ OPTIMIZED: Fetch only FIRST BATCH of user fields
            const firstBatchIds = followingIds.slice(0, FRIEND_PAGE_SIZE);
            const friendsData = await fetchUsersFromRTDB(firstBatchIds);

            if (!isMounted.current) return;
            setFriends(friendsData);

            // ✅ Reset activities when friends change
            if (forceRefresh) {
                activitiesFetchedRef.current = false;
                lastActivityDocRef.current = null;
                setActivities([]);
                setHasMoreActivities(true);
            }
        } catch (err) {
            console.error('Error fetching friends:', err);
        } finally {
            if (isMounted.current) {
                setLoadingFriends(false);
                setRefreshing(false);
            }
        }
    }, [db, firestoreDB, currentUser?.id, fetchUsersFromRTDB]); // Removed friends.length dependency

    // ✅ NEW: Load More Friends (Pagination)
    const loadMoreFriends = useCallback(async () => {
        if (loadingMoreFriends || loadingFriends || friends.length >= friendIds.length || isFriendSearchActive) return;

        setLoadingMoreFriends(true);
        try {
            const nextBatchIds = friendIds.slice(friends.length, friends.length + FRIEND_PAGE_SIZE);
            if (nextBatchIds.length === 0) return;

            const nextBatchData = await fetchUsersFromRTDB(nextBatchIds);

            if (isMounted.current) {
                setFriends(prev => [...prev, ...nextBatchData]);
            }
        } catch (err) {
            console.error('Error loading more friends:', err);
        } finally {
            if (isMounted.current) {
                setLoadingMoreFriends(false);
            }
        }
    }, [loadingMoreFriends, loadingFriends, friends.length, friendIds, fetchUsersFromRTDB, isFriendSearchActive]);

    // ─────────────────────────────────────────────
    // ✅ OPTIMIZED: Fetch Activity Feed with Pagination
    const fetchActivities = useCallback(async (loadMore = false) => {
        if (!currentUser?.id || !firestoreDB || friendIds.length === 0) {
            setLoadingActivities(false);
            return;
        }

        // ✅ Prevent duplicate initial fetches
        if (!loadMore && activitiesFetchedRef.current) {
            return;
        }

        if (loadMore) {
            setLoadingMoreActivities(true);
        } else {
            setLoadingActivities(true);
        }

        try {
            // ✅ Use smaller batch size for cost efficiency
            const batchSize = FIRESTORE_IN_BATCH_SIZE;
            const allActivities = [];

            // ✅ Only fetch from first batch of friend IDs to limit reads
            const friendBatch = friendIds.slice(0, batchSize);

            let activityQuery = firestoreQuery(
                collection(firestoreDB, 'user_activity'),
                where('userId', 'in', friendBatch),
                orderBy('createdAt', 'desc'),
                limit(ACTIVITY_PAGE_SIZE)
            );

            // ✅ Pagination: use startAfter for load more
            if (loadMore && lastActivityDocRef.current) {
                activityQuery = firestoreQuery(
                    collection(firestoreDB, 'user_activity'),
                    where('userId', 'in', friendBatch),
                    orderBy('createdAt', 'desc'),
                    startAfter(lastActivityDocRef.current),
                    limit(ACTIVITY_PAGE_SIZE)
                );
            }

            const activitySnapshot = await getDocs(activityQuery);

            if (!isMounted.current) return;

            activitySnapshot.docs.forEach(doc => {
                allActivities.push({ id: doc.id, ...doc.data() });
            });

            // ✅ Track last document for pagination
            if (activitySnapshot.docs.length > 0) {
                lastActivityDocRef.current = activitySnapshot.docs[activitySnapshot.docs.length - 1];
            }

            // ✅ Check if more data available
            setHasMoreActivities(activitySnapshot.docs.length >= ACTIVITY_PAGE_SIZE);

            if (loadMore) {
                setActivities(prev => [...prev, ...allActivities]);
            } else {
                setActivities(allActivities);
                activitiesFetchedRef.current = true;
            }

            // ✅ Auto-delete seen activities (As requested: "when seen delete from the data base")
            if (allActivities.length > 0) {
                // Perform deletion in background to not block UI
                Promise.all(allActivities.map(activity =>
                    deleteDoc(doc(firestoreDB, 'user_activity', activity.id))
                )).catch(err => console.error('Error deleting seen activities:', err));
            }
        } catch (err) {
            console.error('Error fetching activities:', err);
        } finally {
            if (isMounted.current) {
                setLoadingActivities(false);
                setLoadingMoreActivities(false);
            }
        }
    }, [firestoreDB, currentUser?.id, friendIds]);

    // ✅ Initial fetch - only friends on mount
    useEffect(() => {
        fetchFriends();
    }, [fetchFriends]);

    // ✅ Lazy load activities only when Activity tab is active AND friends loaded
    useEffect(() => {
        if (activeTab === 'activity' && friendIds.length > 0 && !activitiesFetchedRef.current) {
            fetchActivities();
        }
    }, [activeTab, friendIds.length, fetchActivities]);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        activitiesFetchedRef.current = false;
        lastActivityDocRef.current = null;
        fetchFriends(true); // This also resets search mode
    }, [fetchFriends]);

    // ─────────────────────────────────────────────
    // ✅ Memoized Set for O(1) lookup
    const friendIdSet = useMemo(() => new Set(friendIds), [friendIds]);

    // ✅ NEW: Handle Friend Search (Server Side)
    const handleFriendSearch = useCallback(async () => {
        if (!searchQuery.trim()) {
            setIsFriendSearchActive(false);
            setFriendSearchResults([]);
            return;
        }

        if (searchQuery.length < 3) {
            Alert.alert("Search", "Please enter at least 3 characters.");
            return;
        }

        setLoadingFriendSearch(true);
        setIsFriendSearchActive(true);
        setFriendSearchResults([]);

        try {
            // 1. Search Global Users - case-insensitive via dual query
            const lower = searchQuery.trim().toLowerCase();
            const upperFirst = lower.charAt(0).toUpperCase() + lower.slice(1);
            const variants = lower === upperFirst ? [lower] : [lower, upperFirst];

            const seen = new Set();
            const results = [];

            for (const v of variants) {
                const q = query(
                    ref(db, 'users'),
                    orderByChild('displayName'),
                    startAt(v),
                    endAt(v + "\uf8ff"),
                    limitToFirst(50)
                );
                const snapshot = await get(q);
                if (!isMounted.current) return;
                if (snapshot.exists()) {
                    const data = snapshot.val();
                    for (const [id, u] of Object.entries(data)) {
                        if (!friendIdSet.has(id) || seen.has(id)) continue;
                        seen.add(id);
                        results.push({
                            id,
                            displayName: u.displayName || u.userName || 'Unknown',
                            avatar: u.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                            robloxUsername: u.robloxUsername,
                            robloxUsernameVerified: u.robloxUsernameVerified,
                        });
                    }
                }
            }

            setFriendSearchResults(results);
        } catch (err) {
            console.error("Friend Search error:", err);
            Alert.alert("Search Failed", "Could not search friends.");
        } finally {
            if (isMounted.current) {
                setLoadingFriendSearch(false);
            }
        }
    }, [db, searchQuery, friendIdSet]);

    // ─────────────────────────────────────────────
    // ✅ OPTIMIZED: Search Users (limited results)
    const handleSearch = useCallback(async () => {
        if (!searchQuery.trim()) return;

        if (searchQuery.length < 3) {
            Alert.alert("Search", "Please enter at least 3 characters.");
            return;
        }

        setLoadingSearch(true);
        setHasSearched(true);
        setSearchResults([]);

        try {
            // Case-insensitive search via dual query
            const lower = searchQuery.trim().toLowerCase();
            const upperFirst = lower.charAt(0).toUpperCase() + lower.slice(1);
            const variants = lower === upperFirst ? [lower] : [lower, upperFirst];

            const seen = new Set();
            const results = [];

            for (const v of variants) {
                const q = query(
                    ref(db, 'users'),
                    orderByChild('displayName'),
                    startAt(v),
                    endAt(v + "\uf8ff"),
                    limitToFirst(SEARCH_LIMIT)
                );
                const snapshot = await get(q);
                if (!isMounted.current) return;
                if (snapshot.exists()) {
                    const data = snapshot.val();
                    for (const [id, u] of Object.entries(data)) {
                        if (id === currentUser?.id || seen.has(id)) continue;
                        seen.add(id);
                        results.push({
                            id,
                            displayName: u.displayName || u.userName || 'Unknown',
                            avatar: u.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                            robloxUsername: u.robloxUsername,
                            robloxUsernameVerified: u.robloxUsernameVerified,
                        });
                    }
                }
            }

            setSearchResults(results.slice(0, SEARCH_LIMIT));
        } catch (err) {
            console.error("Search error:", err);
            Alert.alert("Search Failed", "Could not search users.");
        } finally {
            if (isMounted.current) {
                setLoadingSearch(false);
            }
        }
    }, [db, searchQuery, currentUser?.id]);

    // ─────────────────────────────────────────────
    // Open Profile Drawer
    const handleOpenProfile = useCallback((user) => {
        setSelectedUser({
            senderId: user.id,
            sender: user.displayName,
            avatar: user.avatar,
            robloxUsername: user.robloxUsername,
            robloxUsernameVerified: user.robloxUsernameVerified,
        });
        setIsDrawerVisible(true);
    }, []);

    // ─────────────────────────────────────────────
    // ✅ Memoized render functions
    const renderUserCard = useCallback(({ item }) => (
        <UserCard
            item={item}
            isDark={isDark}
            isFollowing={friendIdSet.has(item.id)}
            onPress={() => handleOpenProfile(item)}
        />
    ), [isDark, friendIdSet, handleOpenProfile]);

    const renderActivityCard = useCallback(({ item }) => (
        <ActivityCard
            item={item}
            isDark={isDark}
            onPress={() => handleOpenProfile({ id: item.userId, displayName: item.displayName, avatar: item.avatar })}
        />
    ), [isDark, handleOpenProfile]);

    // ─────────────────────────────────────────────
    // Filter friends based on search (memoized)
    // This is now replaced by handleFriendSearch for the Friends tab, but kept for other potential uses.
    const filteredFriends = useMemo(() => {
        if (!searchQuery.trim()) return friends;
        const q = searchQuery.toLowerCase();
        return friends.filter(u =>
            (u.displayName && u.displayName.toLowerCase().includes(q)) ||
            (u.robloxUsername && u.robloxUsername.toLowerCase().includes(q))
        );
    }, [friends, searchQuery]);

    // ✅ Load More Activities Footer
    const ActivityListFooter = useCallback(() => {
        if (!hasMoreActivities) return null;
        if (loadingMoreActivities) {
            return <ActivityIndicator style={{ marginVertical: 16 }} color={config.colors.primary} />;
        }
        return (
            <TouchableOpacity onPress={() => fetchActivities(true)} style={styles.loadMoreBtn}>
                <Text style={styles.loadMoreText}>Load More</Text>
            </TouchableOpacity>
        );
    }, [hasMoreActivities, loadingMoreActivities, fetchActivities]);

    // ✅ Stable key extractors
    const keyExtractor = useCallback((item) => item.id, []);

    // ✅ Friends List Footer
    const FriendListFooter = useCallback(() => {
        if (!loadingMoreFriends || isFriendSearchActive) return null; // No loader in search mode
        return <ActivityIndicator style={{ marginVertical: 16 }} color={config.colors.primary} />;
    }, [loadingMoreFriends, isFriendSearchActive]);

    return (
        <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#F2F2F7' }]}>

            {/* Tabs (Friends + Find Users only - no activity tracking) */}
            <View style={styles.tabContainer}>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'friends' && styles.activeTab]}
                    onPress={() => {
                        setActiveTab('friends');
                        setSearchQuery('');
                        setIsFriendSearchActive(false);
                    }}
                >
                    <Text style={[styles.tabText, { color: activeTab === 'friends' ? config.colors.primary : (isDark ? '#888' : '#666') }]}>
                        Friends
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'search' && styles.activeTab]}
                    onPress={() => {
                        setActiveTab('search');
                        setSearchQuery('');
                    }}
                >
                    <Text style={[styles.tabText, { color: activeTab === 'search' ? config.colors.primary : (isDark ? '#888' : '#666') }]}>
                        Find Users
                    </Text>
                </TouchableOpacity>
            </View>

            {/* Friends Tab - Updated UI for Search */}
            {activeTab === 'friends' && (
                <View style={{ flex: 1 }}>
                    <View style={styles.searchContainer}>
                        <TextInput
                            value={searchQuery}
                            onChangeText={(text) => {
                                setSearchQuery(text);
                                if (text.trim() === '') {
                                    setIsFriendSearchActive(false); // Reset to pagination when empty
                                }
                            }}
                            placeholder="Search friends..."
                            placeholderTextColor={isDark ? '#666' : '#999'}
                            style={[styles.searchInput, { backgroundColor: isDark ? '#1C1C1E' : '#FFF', color: isDark ? '#FFF' : '#000' }]}
                            returnKeyType="search"
                            onSubmitEditing={handleFriendSearch}
                        />
                        <TouchableOpacity onPress={handleFriendSearch} style={styles.searchBtn}>
                            <Ionicons name="search" size={20} color="#FFF" />
                        </TouchableOpacity>
                    </View>
                    {loadingFriends || loadingFriendSearch ? (
                        <ActivityIndicator size="large" color={config.colors.primary} style={{ marginTop: 40 }} />
                    ) : (
                        <FlatList
                            data={isFriendSearchActive ? friendSearchResults : friends} // ✅ Toggle Data Source
                            keyExtractor={keyExtractor}
                            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDark ? '#FFF' : '#000'} />}
                            contentContainerStyle={styles.listContent}
                            renderItem={renderUserCard}
                            initialNumToRender={10}
                            maxToRenderPerBatch={10}
                            windowSize={5}
                            onEndReached={loadMoreFriends}
                            onEndReachedThreshold={0.5}
                            ListFooterComponent={FriendListFooter}
                            ListEmptyComponent={
                                <View style={styles.emptyState}>
                                    <Ionicons name="people-outline" size={48} color={isDark ? '#333' : '#CCC'} />
                                    <Text style={[styles.emptyText, { color: isDark ? '#666' : '#999' }]}>
                                        {isFriendSearchActive ? 'No friends found with that name' : (searchQuery ? 'No matching friends' : 'No friends yet. Find users to follow!')}
                                    </Text>
                                </View>
                            }
                        />
                    )}
                </View>
            )}

            {/* Search Tab */}
            {activeTab === 'search' && (
                <View style={{ flex: 1 }}>
                    <View style={styles.searchContainer}>
                        <TextInput
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            placeholder="Search users..."
                            placeholderTextColor={isDark ? '#666' : '#999'}
                            style={[styles.searchInput, { backgroundColor: isDark ? '#1C1C1E' : '#FFF', color: isDark ? '#FFF' : '#000' }]}
                            returnKeyType="search"
                            onSubmitEditing={handleSearch}
                        />
                        <TouchableOpacity onPress={handleSearch} style={styles.searchBtn}>
                            <Ionicons name="search" size={20} color="#FFF" />
                        </TouchableOpacity>
                    </View>
                    {loadingSearch ? (
                        <ActivityIndicator size="large" color={config.colors.primary} style={{ marginTop: 40 }} />
                    ) : (
                        <FlatList
                            data={searchResults}
                            keyExtractor={keyExtractor}
                            contentContainerStyle={styles.listContent}
                            renderItem={renderUserCard}
                            initialNumToRender={10}
                            maxToRenderPerBatch={10}
                            windowSize={5}
                            ListEmptyComponent={
                                hasSearched ? (
                                    <View style={styles.emptyState}>
                                        <Text style={[styles.emptyText, { color: isDark ? '#666' : '#999' }]}>No users found.</Text>
                                    </View>
                                ) : (
                                    <View style={styles.emptyState}>
                                        <Ionicons name="search-outline" size={48} color={isDark ? '#333' : '#CCC'} />
                                        <Text style={[styles.emptyText, { color: isDark ? '#666' : '#999' }]}>Search for users to follow</Text>
                                    </View>
                                )
                            }
                        />
                    )}
                </View>
            )}

            {/* Profile Drawer */}
            <ProfileBottomDrawer
                isVisible={isDrawerVisible}
                toggleModal={() => {
                    setIsDrawerVisible(false);
                    // fetchFriends(true); // Don't force refresh blindly on close, cleaner to leave as is or basic refresh
                }}
                startChat={() => {
                    if (selectedUser) {
                        setIsDrawerVisible(false);
                        navigation.navigate('PrivateChat', {
                            selectedUser: {
                                senderId: selectedUser.senderId,
                                sender: selectedUser.sender,
                                avatar: selectedUser.avatar,
                            },
                        });
                    }
                }}
                selectedUser={selectedUser}
                isOnline={false}
                bannedUsers={[]}
                fromPvtChat={false}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, paddingTop: 16 },
    tabContainer: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12 },
    tab: { marginRight: 20, paddingBottom: 8, borderBottomWidth: 2, borderColor: 'transparent' },
    activeTab: { borderColor: config.colors.primary },
    tabText: { fontSize: 15, fontWeight: '600' },
    searchContainer: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 10 },
    searchInput: { flex: 1, height: 44, borderRadius: 10, paddingHorizontal: 12, fontSize: 16, borderWidth: 1, borderColor: '#E5E5EA' },
    searchBtn: { width: 44, height: 44, backgroundColor: config.colors.primary, borderRadius: 10, marginLeft: 8, justifyContent: 'center', alignItems: 'center' },
    listContent: { paddingHorizontal: 16, paddingBottom: 80 },

    // User Card Styles
    card: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, marginBottom: 10, borderWidth: 1 },
    avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#DDD' },
    cardContent: { flex: 1, marginLeft: 12 },
    name: { fontSize: 16, fontWeight: '600' },
    email: { fontSize: 13, marginTop: 2 },
    actionContainer: { flexDirection: 'row', alignItems: 'center' },
    followingBadge: { backgroundColor: config.colors.hasBlockGreen, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
    followingText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
    notFollowingBadge: { backgroundColor: '#8E8E93', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
    notFollowingText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },

    // Activity Card Styles
    activityCard: { flexDirection: 'row', padding: 12, borderRadius: 16, marginBottom: 10, borderWidth: 1 },
    activityAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#DDD' },
    activityContent: { flex: 1, marginLeft: 12 },
    activityHeader: { fontSize: 14 },
    activityName: { fontWeight: '600' },
    activityPreview: { fontSize: 13, marginTop: 4 },
    activityTime: { fontSize: 11, marginTop: 4 },
    activityImage: { width: 50, height: 50, borderRadius: 8, marginLeft: 8 },

    emptyState: { alignItems: 'center', marginTop: 60, opacity: 0.7, paddingHorizontal: 20 },
    emptyText: { marginTop: 16, fontSize: 16, textAlign: 'center' },

    // Load More Button
    loadMoreBtn: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 24, marginVertical: 16 },
    loadMoreText: { color: config.colors.primary, fontSize: 14, fontWeight: '600' },
});

export default SocialDashboard;
