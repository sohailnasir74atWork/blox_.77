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
} from 'react-native';
import { getDatabase, ref, get, query, orderByChild, startAt, endAt, limitToFirst } from '@react-native-firebase/database';
import { collection, getDocs, query as firestoreQuery, where } from '@react-native-firebase/firestore';
import { useGlobalState } from '../GlobelStats';
import { useNavigation } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';
import FramedAvatar from '../ChatScreen/GroupChat/FramedAvatar';
import config from '../Helper/Environment';
import { useTranslation } from 'react-i18next';

// ✅ Constants for optimization
const FRIEND_PAGE_SIZE = 15;
const SEARCH_LIMIT = 15;
const FIRESTORE_IN_BATCH_SIZE = 10; // Smaller batch for better cost efficiency

// ✅ Sanitize search query — strip chars invalid in Firebase RTDB queries
const sanitizeSearchQuery = (q) => q.replace(/[.#$\[\]\/\\]/g, '');

// ✅ Helper: check if a string looks like a Firebase user ID (not a display name)
const looksLikeUserId = (val) => {
    if (!val || typeof val !== 'string') return false;
    return val.length >= 15 && /^[a-zA-Z0-9]+$/.test(val);
};

// ✅ Memoized User Card to prevent re-renders
const UserCard = memo(({ item, isDark, isFollowing, onPress }) => (
    <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        style={[styles.card, { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF', borderColor: isDark ? '#2C2C2E' : '#F2F2F7' }]}
    >
        <FramedAvatar avatarUri={item.avatar} frame={item.profileFrame || null} isDarkMode={isDark} avatarSize={48} />
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



const SocialDashboard = () => {
    const { theme, user: currentUser, appdatabase, firestoreDB } = useGlobalState();
    const { t } = useTranslation();
    const navigation = useNavigation();
    const isDark = theme === 'dark';
    const db = useMemo(() => appdatabase || getDatabase(), [appdatabase]);

    // Tabs: 'friends' or 'search'
    const [activeTab, setActiveTab] = useState('friends');

    // ✅ Refs for preventing duplicate fetches
    const friendIdsCacheRef = useRef('');
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
                    const [displayNameSnap, avatarSnap, robloxUsernameSnap, robloxVerifiedSnap, profileFrameSnap] = await Promise.all([
                        get(ref(db, `users/${friendId}/displayName`)),
                        get(ref(db, `users/${friendId}/avatar`)),
                        get(ref(db, `users/${friendId}/robloxUsername`)),
                        get(ref(db, `users/${friendId}/robloxUsernameVerified`)),
                        get(ref(db, `users/${friendId}/profileFrame`)),
                    ]);

                    return {
                        id: friendId,
                        displayName: displayNameSnap.val() || 'Unknown',
                        avatar: avatarSnap.val() || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                        robloxUsername: robloxUsernameSnap.val() || null,
                        robloxUsernameVerified: robloxVerifiedSnap.val() || false,
                        profileFrame: profileFrameSnap.val() || null,
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

    // ✅ Initial fetch - only friends on mount
    useEffect(() => {
        fetchFriends();
    }, [fetchFriends]);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchFriends(true);
    }, [fetchFriends]);

    // ─────────────────────────────────────────────
    // ✅ Memoized Set for O(1) lookup
    const friendIdSet = useMemo(() => new Set(friendIds), [friendIds]);

    // ✅ Handle Friend Search (Server Side) — robust: symbols, case-insensitive
    const handleFriendSearch = useCallback(async () => {
        const raw = searchQuery.trim();
        if (!raw) {
            setIsFriendSearchActive(false);
            setFriendSearchResults([]);
            return;
        }

        setLoadingFriendSearch(true);
        setIsFriendSearchActive(true);
        setFriendSearchResults([]);

        try {
            const seen = new Set();
            const results = [];

            if (looksLikeUserId(raw)) {
                // ── ID SEARCH: direct lookup by Firebase user key ──
                const userSnap = await get(ref(db, `users/${raw}`));
                if (!isMounted.current) return;
                if (userSnap.exists()) {
                    const u = userSnap.val();
                    const id = raw;
                    if (friendIdSet.has(id)) {
                        seen.add(id);
                        results.push({
                            id,
                            displayName: u.displayName || u.userName || 'Unknown',
                            avatar: u.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                            robloxUsername: u.robloxUsername,
                            robloxUsernameVerified: u.robloxUsernameVerified,
                            profileFrame: u.profileFrame || null,
                        });
                    }
                }
            } else {
                // ── NAME SEARCH: multiple case variants + client-side filter ──
                const lower = raw.toLowerCase();
                const upperFirst = lower.charAt(0).toUpperCase() + lower.slice(1);
                const allUpper = raw.toUpperCase();
                const variants = [...new Set([lower, upperFirst, allUpper, raw])];

                for (const v of variants) {
                    if (seen.size >= 50) break;
                    try {
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
                            snapshot.forEach((child) => {
                                const id = child.key;
                                const u = child.val();
                                if (!friendIdSet.has(id) || seen.has(id)) return;
                                seen.add(id);
                                results.push({
                                    id,
                                    displayName: u.displayName || u.userName || 'Unknown',
                                    avatar: u.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                                    robloxUsername: u.robloxUsername,
                                    robloxUsernameVerified: u.robloxUsernameVerified,
                                });
                            });
                        }
                    } catch (variantErr) {
                        console.warn(`Friend search variant "${v}" failed:`, variantErr.message);
                    }
                }

                // Fallback: client-side contains match for symbol names
                if (results.length < 10 && lower.length >= 2) {
                    try {
                        const broadQ = query(ref(db, 'users'), orderByChild('displayName'), limitToFirst(500));
                        const broadSnap = await get(broadQ);
                        if (!isMounted.current) return;
                        if (broadSnap.exists()) {
                            broadSnap.forEach((child) => {
                                if (seen.size >= 50) return;
                                const id = child.key;
                                const u = child.val();
                                if (!friendIdSet.has(id) || seen.has(id)) return;
                                const name = (u.displayName || u.userName || '').toLowerCase();
                                if (name.includes(lower)) {
                                    seen.add(id);
                                    results.push({
                                        id,
                                        displayName: u.displayName || u.userName || 'Unknown',
                                        avatar: u.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                                        robloxUsername: u.robloxUsername,
                                        robloxUsernameVerified: u.robloxUsernameVerified,
                                    });
                                }
                            });
                        }
                    } catch (broadErr) {
                        console.warn('Broad friend search failed:', broadErr.message);
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
    // ✅ Search Users (Find Users tab) — robust: symbols, case-insensitive
    const handleSearch = useCallback(async () => {
        const raw = searchQuery.trim();
        if (!raw) return;

        setLoadingSearch(true);
        setHasSearched(true);
        setSearchResults([]);

        try {
            const seen = new Set();
            const results = [];

            if (looksLikeUserId(raw)) {
                // ── ID SEARCH: direct lookup by Firebase user key ──
                const userSnap = await get(ref(db, `users/${raw}`));
                if (!isMounted.current) return;
                if (userSnap.exists()) {
                    const u = userSnap.val();
                    const id = raw;
                    if (id !== currentUser?.id) {
                        seen.add(id);
                        results.push({
                            id,
                            displayName: u.displayName || u.userName || 'Unknown',
                            avatar: u.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                            robloxUsername: u.robloxUsername,
                            robloxUsernameVerified: u.robloxUsernameVerified,
                            profileFrame: u.profileFrame || null,
                        });
                    }
                }
            } else {
                // ── NAME SEARCH: multiple case variants + client-side filter ──
                const lower = raw.toLowerCase();
                const upperFirst = lower.charAt(0).toUpperCase() + lower.slice(1);
                const allUpper = raw.toUpperCase();
                const variants = [...new Set([lower, upperFirst, allUpper, raw])];
                const limitSize = 50;

                for (const v of variants) {
                    if (seen.size >= 50) break;
                    try {
                        const q = query(
                            ref(db, 'users'),
                            orderByChild('displayName'),
                            startAt(v),
                            endAt(v + "\uf8ff"),
                            limitToFirst(limitSize)
                        );
                        const snapshot = await get(q);
                        if (!isMounted.current) return;
                        if (snapshot.exists()) {
                            snapshot.forEach((child) => {
                                const id = child.key;
                                const u = child.val();
                                if (id === currentUser?.id || seen.has(id)) return;
                                seen.add(id);
                                results.push({
                                    id,
                                    displayName: u.displayName || u.userName || 'Unknown',
                                    avatar: u.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                                    robloxUsername: u.robloxUsername,
                                    robloxUsernameVerified: u.robloxUsernameVerified,
                                });
                            });
                        }
                    } catch (variantErr) {
                        console.warn(`Search variant "${v}" failed:`, variantErr.message);
                    }
                }

                // Fallback: client-side contains match for symbol names
                if (results.length < 10 && lower.length >= 2) {
                    try {
                        const broadQ = query(ref(db, 'users'), orderByChild('displayName'), limitToFirst(500));
                        const broadSnap = await get(broadQ);
                        if (!isMounted.current) return;
                        if (broadSnap.exists()) {
                            broadSnap.forEach((child) => {
                                if (seen.size >= 50) return;
                                const id = child.key;
                                const u = child.val();
                                if (id === currentUser?.id || seen.has(id)) return;
                                const name = (u.displayName || u.userName || '').toLowerCase();
                                if (name.includes(lower)) {
                                    seen.add(id);
                                    results.push({
                                        id,
                                        displayName: u.displayName || u.userName || 'Unknown',
                                        avatar: u.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                                        robloxUsername: u.robloxUsername,
                                        robloxUsernameVerified: u.robloxUsernameVerified,
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
            console.error("Search error:", err);
            Alert.alert("Search Failed", err.message || "Could not search users.");
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
            profileFrame: user.profileFrame || null,
        });
        setIsDrawerVisible(true);
    }, []);

    // ✅ Real-time follow/unfollow handler — updates friends list & search results instantly
    const handleFollowChange = useCallback((userId, isNowFollowing) => {
        if (isNowFollowing) {
            // Add to friendIds
            setFriendIds(prev => prev.includes(userId) ? prev : [...prev, userId]);
            // Add user to friends list from selectedUser or search results
            const userInfo = searchResults.find(u => u.id === userId) || friendSearchResults.find(u => u.id === userId);
            if (userInfo) {
                setFriends(prev => prev.some(f => f.id === userId) ? prev : [userInfo, ...prev]);
            }
        } else {
            // Remove from friendIds
            setFriendIds(prev => prev.filter(id => id !== userId));
            // Remove from friends list
            setFriends(prev => prev.filter(f => f.id !== userId));
            // Remove from friend search results too
            setFriendSearchResults(prev => prev.filter(f => f.id !== userId));
        }
    }, [searchResults, friendSearchResults]);

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



    // ✅ Stable key extractors
    const keyExtractor = useCallback((item) => item.id, []);

    // ✅ Friends List Footer
    const FriendListFooter = useCallback(() => {
        if (!loadingMoreFriends || isFriendSearchActive) return null; // No loader in search mode
        return <ActivityIndicator style={{ marginVertical: 16 }} color={config.colors.primary} />;
    }, [loadingMoreFriends, isFriendSearchActive]);

    return (
        <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#F2F2F7' }]}>

            {/* Tabs */}
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
                        💛 Following
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
                        🔍 Discover
                    </Text>
                </TouchableOpacity>
            </View>


            {/* 💛 Following Tab */}
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

            {/* 🔍 Discover Tab */}
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
                }}
                startChat={() => {
                    if (selectedUser) {
                        setIsDrawerVisible(false);
                        // Small delay so drawer close animation finishes before navigation
                        setTimeout(() => {
                            navigation.navigate('PrivateChatRoot', {
                                selectedUser: {
                                    senderId: selectedUser.senderId,
                                    sender: selectedUser.sender,
                                    avatar: selectedUser.avatar,
                                },
                            });
                        }, 300);
                    }
                }}
                selectedUser={selectedUser}
                isOnline={false}
                bannedUsers={[]}
                fromPvtChat={false}
                onFollowChange={handleFollowChange}
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



    emptyState: { alignItems: 'center', marginTop: 60, opacity: 0.7, paddingHorizontal: 20 },
    emptyText: { marginTop: 16, fontSize: 16, textAlign: 'center' },

    // Load More Button
    loadMoreBtn: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 24, marginVertical: 16 },
    loadMoreText: { color: config.colors.primary, fontSize: 14, fontWeight: '600' },
});

export default SocialDashboard;
