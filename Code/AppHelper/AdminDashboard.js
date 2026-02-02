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
import { getDatabase, ref, get, query, orderByChild, startAt, endAt, limitToFirst } from '@react-native-firebase/database';
import { unbanUserWithEmail, banUserwithEmail } from '../ChatScreen/utils';
import { useGlobalState } from '../GlobelStats';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';

const decodeEmail = (encoded) => encoded ? encoded.replace(/\(dot\)/g, '.') : '';

const BAD_KEYS = new Set(['undefined', 'onloaduser', '', null, undefined]);

const AdminDashboard = () => {
  const { theme, user: currentUser, isAdmin, isModerator } = useGlobalState();
  const isDark = theme === 'dark';
  const db = useMemo(() => getDatabase(), []);
  const navigation = useNavigation();

  // Tabs: 'banned' or 'search'
  const [activeTab, setActiveTab] = useState('banned');

  // ... (rest of state definitions remain the same)

  // Banned Data
  const [bannedUsers, setBannedUsers] = useState([]);
  const [loadingBanned, setLoadingBanned] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Search Data
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Modal
  const [selectedUser, setSelectedUser] = useState(null);

  // ─────────────────────────────────────────────
  // Fetch Banned Users
  const fetchBannedUsers = useCallback(async () => {
    setLoadingBanned(true);
    try {
      const snapshot = await get(ref(db, 'banned_users_by_email'));
      if (!snapshot.exists()) {
        setBannedUsers([]);
        return;
      }
      const data = snapshot.val() ?? {};
      const list = Object.keys(data)
        .filter((k) => !BAD_KEYS.has(k))
        .map((encodedEmail) => {
          const entry = data[encodedEmail];
          return {
            isBanned: true,
            email: decodeEmail(encodedEmail),
            encodedEmail,
            reason: entry?.reason ?? '—',
            strikeCount: entry?.strikeCount ?? 0,
            bannedUntil: entry?.bannedUntil ?? null,
            displayName: entry?.displayName || 'Unknown',
            avatar: entry?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
            bannedBy: entry?.bannedBy || null,
            bannedAt: entry?.bannedAt || null,
            id: entry?.userId || null
          };
        });
      setBannedUsers(list.reverse()); // Newest first
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Could not load banned users.');
    } finally {
      setLoadingBanned(false);
      setRefreshing(false);
    }
  }, [db]);

  useEffect(() => {
    fetchBannedUsers();
  }, [fetchBannedUsers]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchBannedUsers();
  };

  // ─────────────────────────────────────────────
  // Search Users (from 'users' node)
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    // ✅ Optimization: Prevent short queries that might scan too much
    if (searchQuery.length < 3) {
      Alert.alert("Optimization", "Please enter at least 3 characters to search efficiently.");
      return;
    }

    Keyboard.dismiss();
    setLoadingSearch(true);
    setHasSearched(true);
    setSearchResults([]);

    try {
      // ✅ Optimization: Limit to 20 results to prevent large filtering
      const q = query(
        ref(db, 'users'),
        orderByChild('displayName'),
        startAt(searchQuery),
        endAt(searchQuery + "\uf8ff"),
        limitToFirst(20)
      );

      // ✅ Race condition / Timeout handle (manual) could be added here if needed
      const snapshot = await get(q);

      if (snapshot.exists()) {
        const data = snapshot.val();
        const results = Object.values(data).map(u => ({
          isBanned: false,
          id: u.id,
          displayName: u.displayName || u.userName || 'Unknown',
          email: u.email,
          avatar: u.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
          robloxUsername: u.robloxUsername,
          isAdmin: u.admin || false,
          isModerator: u.isModerator || false,
        }));
        setSearchResults(results);
      } else {
        setSearchResults([]);
      }
    } catch (err) {
      console.error("Search error:", err);
      // ✅ Clear error message guiding the user to the root cause
      Alert.alert(
        "Search Failed / Slow",
        "If this takes too long, you MUST add this rule to your Firebase Console:\n\n" +
        "\"users\": {\n  \".indexOn\": [\"displayName\"]\n}"
      );
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
        fetchBannedUsers(); // Refresh list
        // Update search result item state if in search mode
        if (activeTab === 'search') {
          setSearchResults(prev => prev.map(u => u.email === email ? { ...u, isBanned: false } : u));
        }
      }
    } catch (err) {
      Alert.alert('Error', 'Could not unban user.');
    }
  };

  const handleBan = async (userItem) => {
    if (!userItem.email) {
      Alert.alert("Error", "User has no email associated.");
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

    // Assuming we are Admin if we are on this screen
    const success = await banUserwithEmail(userItem.email, isAdmin, userItem.id, userInfo, bannerInfo);
    if (success) {
      setSelectedUser(null);
      fetchBannedUsers(); // Refresh banned list
      // Optimistic update
      setSearchResults(prev => prev.map(u => u.email === userItem.email ? { ...u, isBanned: true } : u));
    }
  };

  // ─────────────────────────────────────────────
  // Render
  const renderItem = ({ item }) => {
    // Check if this search candidate is strictly banned (cross-reference bannedUsers list)
    // For search tab, 'item.isBanned' might not be populated from the search query itself.
    // Let's deduce it.
    let isBanned = item.isBanned;
    let banInfo = null;

    if (activeTab === 'search') {
      const foundBan = bannedUsers.find(b => b.email === item.email);
      if (foundBan) {
        isBanned = true;
        banInfo = foundBan;
      }
    } else {
      banInfo = item;
    }

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => setSelectedUser({ ...item, ...banInfo, isBanned })} // Merge active data with ban data
        style={[styles.card, { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF', borderColor: isDark ? '#2C2C2E' : '#F2F2F7' }]}
      >
        <Image source={{ uri: item.avatar }} style={styles.avatar} />
        <View style={styles.cardContent}>
          <Text style={[styles.name, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
            {item.displayName}
          </Text>
          <Text style={[styles.email, { color: isDark ? '#8E8E93' : '#666' }]} numberOfLines={1}>
            {item.email || item.decodedEmail}
          </Text>
        </View>

        <View style={styles.actionContainer}>
          {isBanned ? (
            <View style={styles.bannedBadge}>
              <Text style={styles.bannedText}>BANNED</Text>
            </View>
          ) : (
            <View style={styles.activeBadge}>
              <Text style={styles.activeText}>ACTIVE</Text>
            </View>
          )}
          <Ionicons name="ellipsis-vertical" size={20} color={isDark ? '#555' : '#CCC'} style={{ marginLeft: 8 }} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#F2F2F7' }]}>

      {/* Search Header */}
      <View style={[styles.header, { backgroundColor: isDark ? '#000' : '#F2F2F7', flexDirection: 'row', alignItems: 'center' }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 12 }}>
          <Ionicons name="arrow-back" size={28} color={isDark ? '#FFF' : '#000'} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: isDark ? '#FFF' : '#000' }]}>User Management</Text>
      </View>

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
        loadingBanned ? (
          <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={bannedUsers}
            keyExtractor={(item) => item.encodedEmail}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDark ? '#FFF' : '#000'} />}
            contentContainerStyle={styles.listContent}
            renderItem={renderItem}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="shield-checkmark-outline" size={48} color={isDark ? '#333' : '#CCC'} />
                <Text style={[styles.emptyText, { color: isDark ? '#666' : '#999' }]}>No banned users</Text>
              </View>
            }
          />
        )
      ) : (
        // Search Results
        loadingSearch ? (
          <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.id || item.email}
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

      {/* User Details / Action Modal */}
      <Modal
        visible={!!selectedUser}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setSelectedUser(null)}
      >
        <View style={[styles.modalContainer, { backgroundColor: isDark ? '#000' : '#F2F2F7' }]}>
          {selectedUser && (
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={{ fontSize: 18, fontWeight: '600', color: isDark ? '#FFF' : '#000' }}>User Details</Text>
                <TouchableOpacity onPress={() => setSelectedUser(null)} style={styles.modalCloseBtn}>
                  <Ionicons name="close-circle" size={28} color={isDark ? '#555' : '#CCC'} />
                </TouchableOpacity>
              </View>

              <View style={{ alignItems: 'center', marginVertical: 20 }}>
                <Image source={{ uri: selectedUser.avatar }} style={styles.avatarLarge} />
                <Text style={[styles.modalName, { color: isDark ? '#FFF' : '#000' }]}>{selectedUser.displayName}</Text>
                <Text style={[styles.modalEmail, { color: isDark ? '#AAA' : '#666' }]}>{selectedUser.email || selectedUser.decodedEmail}</Text>

                {selectedUser.isBanned && (
                  <View style={[styles.infoBadge, { backgroundColor: '#FF3B3015' }]}>
                    <Text style={{ color: '#FF3B30', fontWeight: 'bold' }}>
                      {selectedUser.strikeCount} Strike(s) • {selectedUser.reason}
                    </Text>
                  </View>
                )}
              </View>

              {selectedUser.isBanned ? (
                <TouchableOpacity style={styles.largeButtonUnban} onPress={() => handleUnban(selectedUser)}>
                  <Text style={styles.buttonText}>Unban User</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.largeButtonBan} onPress={() => handleBan(selectedUser)}>
                  <Text style={styles.buttonText}>Ban User</Text>
                </TouchableOpacity>
              )}

              {selectedUser.bannedBy && (
                <View style={[styles.bannedByBox, { backgroundColor: isDark ? '#1C1C1E' : '#FFF' }]}>
                  <Text style={{ color: '#888', fontSize: 12, marginBottom: 5 }}>BANNED BY</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Image source={{ uri: selectedUser.bannedBy.avatar }} style={styles.avatarTiny} />
                    <Text style={{ color: isDark ? '#FFF' : '#000', marginLeft: 8, fontWeight: '500' }}>
                      {selectedUser.bannedBy.displayName}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16 },
  headerTitle: { fontSize: 28, fontWeight: '800' },
  tabContainer: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 16 },
  tab: { marginRight: 16, paddingBottom: 8, borderBottomWidth: 2, borderColor: 'transparent' },
  activeTab: { borderColor: '#007AFF' },
  tabText: { fontSize: 16, fontWeight: '600' },
  activeTabText: { color: '#007AFF' },
  searchContainer: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 10 },
  searchInput: { flex: 1, height: 44, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  searchBtn: { width: 44, height: 44, backgroundColor: '#007AFF', borderRadius: 10, marginLeft: 8, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: 16, paddingBottom: 80 },

  // Card Styles
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

  // Modal Styles
  modalContainer: { flex: 1 },
  modalContent: { padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalCloseBtn: { padding: 4 },
  avatarLarge: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#DDD', marginBottom: 16 },
  modalName: { fontSize: 24, fontWeight: 'bold', marginBottom: 4 },
  modalEmail: { fontSize: 14, marginBottom: 16 },
  infoBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  largeButtonBan: { backgroundColor: '#FF3B30', width: '100%', height: 50, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  largeButtonUnban: { backgroundColor: '#34C759', width: '100%', height: 50, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  buttonText: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  bannedByBox: { padding: 16, borderRadius: 12, marginTop: 20 },
  avatarTiny: { width: 24, height: 24, borderRadius: 12 },

  emptyState: { alignItems: 'center', marginTop: 60, opacity: 0.7 },
  emptyText: { marginTop: 16, fontSize: 16 }
});

export default AdminDashboard;
