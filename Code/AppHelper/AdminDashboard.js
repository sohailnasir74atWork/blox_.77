import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Button,
  Alert,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  TextInput,
} from 'react-native';
import { getDatabase, ref, get } from '@react-native-firebase/database';
import { unbanUserWithEmail } from '../ChatScreen/utils';
import { useGlobalState } from '../GlobelStats';

const decodeEmail = (encoded) => encoded.replace(/\(dot\)/g, '.');

const AdminUnbanScreen = () => {
  const { theme } = useGlobalState();
  const isDark = theme === 'dark';

  const [bannedUsers, setBannedUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchBannedUsers = async () => {
    try {
      setLoading(true);
      const db = getDatabase();
      const banRef = ref(db, 'banned_users_by_email');
      const snapshot = await get(banRef);

      if (snapshot.exists()) {
        const data = snapshot.val();
        const users = Object.keys(data)
          .filter((key) => key !== 'undefined' && key !== 'onloaduser')
          .map((encodedEmail) => ({
            encodedEmail,
            decodedEmail: decodeEmail(encodedEmail),
            ...data[encodedEmail],
          }));

        setBannedUsers(users);
        setFilteredUsers(users);
      } else {
        setBannedUsers([]);
        setFilteredUsers([]);
      }
    } catch (err) {
      console.error('Failed to fetch banned users:', err);
      Alert.alert('Error', 'Could not load banned users.');
    } finally {
      setLoading(false);
    }
  };

  const handleUnban = async (email) => {
    try {
      await unbanUserWithEmail(email);
      fetchBannedUsers();
    } catch (err) {
      console.error('Unban failed:', err);
    }
  };

  const handleSearch = (text) => {
    setSearchQuery(text);
    const filtered = bannedUsers.filter((user) =>
      user.decodedEmail.toLowerCase().includes(text.toLowerCase())
    );
    setFilteredUsers(filtered);
  };

  useEffect(() => {
    fetchBannedUsers();
  }, []);

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: isDark ? '#000' : '#fff' }]}>
        <ActivityIndicator size="large" color={isDark ? '#fff' : '#000'} />
        <Text style={{ color: isDark ? '#fff' : '#000' }}>Loading banned users...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}>
      <TextInput
        value={searchQuery}
        onChangeText={handleSearch}
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

      {filteredUsers.length === 0 ? (
        <Text style={{ color: isDark ? '#fff' : '#000', textAlign: 'center', marginTop: 20 }}>
          No banned users found.
        </Text>
      ) : (
        <FlatList
          data={filteredUsers}
          keyExtractor={(item) => item.encodedEmail}
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
                Reason: {item.reason}
              </Text>
              <Text style={[styles.strike, { color: isDark ? '#aaa' : '#888' }]}>
                Strikes: {item.strikeCount}
              </Text>
              <Button title="Unban" color="#e53935" onPress={() => handleUnban(item.decodedEmail)} />
            </View>
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
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
  email: {
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 4,
  },
  reason: {
    marginBottom: 2,
  },
  strike: {
    marginBottom: 8,
  },
});

export default AdminUnbanScreen;
