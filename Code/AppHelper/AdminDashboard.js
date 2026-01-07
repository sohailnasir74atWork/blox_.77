import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Button,
  Alert,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { getDatabase, ref, get, set } from '@react-native-firebase/database';
import { unbanUserWithEmail } from '../ChatScreen/utils';
import { useGlobalState } from '../GlobelStats';

const decodeEmail = (encoded) => encoded.replace(/\(dot\)/g, '.');
const encodeEmail = (email) => email.replace(/\./g, '(dot)');

const BAD_KEYS = new Set(['undefined', 'onloaduser', '', null, undefined]);

const AdminUnbanScreen = () => {
  const { theme } = useGlobalState();
  const isDark = theme === 'dark';

  // ✅ Unified ban system - only one list now
  const [bans, setBans] = useState([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const db = useMemo(() => getDatabase(), []);

  const fetchNode = useCallback(async (path) => {
    const snapshot = await get(ref(db, path));
    if (!snapshot.exists()) return [];
    const data = snapshot.val() ?? {};
    return Object.keys(data)
      .filter((k) => !BAD_KEYS.has(k))
      .map((encodedEmail) => ({
        encodedEmail,
        decodedEmail: decodeEmail(encodedEmail),
        reason: data[encodedEmail]?.reason ?? '—',
        strikeCount: data[encodedEmail]?.strikeCount ?? 0,
      }));
  }, [db]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      // ✅ Use unified database path
      const banList = await fetchNode('banned_users_by_email');
      setBans(banList);
    } catch (err) {
      console.error('Failed to fetch bans:', err);
      Alert.alert('Error', 'Could not load banned users.');
    } finally {
      setLoading(false);
    }
  }, [fetchNode]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchAll();
    } finally {
      setRefreshing(false);
    }
  };

  const handleUnbanEmailNode = async (decodedEmail) => {
    try {
      await unbanUserWithEmail(decodedEmail);
      await fetchAll();
    } catch (err) {
      console.error('Unban failed (email node):', err);
      Alert.alert('Error', 'Could not unban user.');
    }
  };

  const filteredBans = useMemo(() => {
    if (!searchQuery.trim()) return bans;
    const q = searchQuery.toLowerCase();
    return bans.filter((u) => u.decodedEmail.toLowerCase().includes(q));
  }, [bans, searchQuery]);

  const handleUnban = (user) => {
    handleUnbanEmailNode(user.decodedEmail);
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: isDark ? '#000' : '#fff' }]}>
        <ActivityIndicator size="large" color={isDark ? '#fff' : '#000'} />
        <Text style={{ color: isDark ? '#fff' : '#000', marginTop: 8 }}>
          Loading banned users...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
      {/* Search */}
      <TextInput
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search by email"
        placeholderTextColor={isDark ? '#aaa' : '#666'}
        style={[
          styles.searchInput,
          {
            backgroundColor: isDark ? '#222' : '#eee',
            color: isDark ? '#fff' : '#000',
            borderColor: isDark ? '#444' : '#ccc',
          },
        ]}
      />

      {/* List */}
      {filteredBans.length === 0 ? (
        <Text style={{ color: isDark ? '#fff' : '#000', textAlign: 'center', marginTop: 20 }}>
          No banned users found.
        </Text>
      ) : (
        <FlatList
          data={filteredBans}
          keyExtractor={(item) => item.encodedEmail}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={isDark ? '#fff' : '#000'}
            />
          }
          contentContainerStyle={{ paddingBottom: 100 }}
          renderItem={({ item }) => (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: isDark ? '#111' : '#fafafa',
                  borderColor: isDark ? '#333' : '#ddd',
                },
              ]}
            >
              <Text style={[styles.email, { color: isDark ? '#fff' : '#000' }]}>
                {item.decodedEmail}
              </Text>
              <Text style={[styles.reason, { color: isDark ? '#ccc' : '#555' }]}>
                Reason: {item.reason ?? '—'}
              </Text>
              <Text style={[styles.strike, { color: isDark ? '#aaa' : '#888' }]}>
                Strikes: {item.strikeCount ?? 0}
              </Text>
              <Button title="Unban" color="#e53935" onPress={() => handleUnban(item)} />
            </View>
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabsRow: { flexDirection: 'row', marginBottom: 12 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  searchInput: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  card: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  email: { fontWeight: 'bold', fontSize: 16, marginBottom: 2 },
  reason: {},
  strike: { marginBottom: 8 },
});

export default AdminUnbanScreen;
