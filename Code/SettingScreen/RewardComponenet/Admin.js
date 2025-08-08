import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Linking,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import Clipboard from '@react-native-clipboard/clipboard';
import { ref, get, update, set, remove } from '@react-native-firebase/database';
import { useGlobalState } from '../../GlobelStats';

export default function AdminApproveSubmissions({ appdatabase }) {
  const { isAdmin } = useGlobalState();
  const [allSubmissions, setAllSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAllSubmissions = async () => {
      try {
        const snapshot = await get(ref(appdatabase, 'submissions'));
        if (!snapshot.exists()) return setAllSubmissions([]);

        const submissions = Object.entries(snapshot.val()).map(([taskId, data]) => ({
          taskId,
          ...data,
        }));
        setAllSubmissions(submissions);
      } catch (error) {
        console.error('❌ Error fetching submissions:', error);
      } finally {
        setLoading(false);
      }
    };

   if(isAdmin) {fetchAllSubmissions();}
  }, []);

  const handleApprove = async (submission) => {
    try {
      const { userId, taskId, coins = 30 } = submission;

      // Approve in user node
      await update(ref(appdatabase, `users/${userId}/submissions/${taskId}`), {
        status: 'Approved',  // Set status to 'Approved'
      });

      // Remove from admin queue
      await remove(ref(appdatabase, `submissions/${taskId}`));

      // Update coins
      const coinsRef = ref(appdatabase, `users/${userId}/coins`);
      const currentCoinsSnap = await get(coinsRef);
      const newTotal = (currentCoinsSnap.exists() ? currentCoinsSnap.val() : 0) + coins;
      await set(coinsRef, newTotal);

      // Remove from local list and trigger re-render
      setAllSubmissions((prev) => prev.filter((s) => s.taskId !== taskId));

      Alert.alert('✅ Approved', `Granted ${coins} coins to user.`);
    } catch (err) {
      console.error('❌ Error approving submission:', err);
      Alert.alert('Error', 'Failed to approve. Try again.');
    }
  };

  const handleDisapprove = async (submission) => {
    try {
      const { taskId, userId } = submission;

      // Disapprove in user node
      await update(ref(appdatabase, `users/${userId}/submissions/${taskId}`), {
        status: 'Disapproved Resubmit',  // Set status to 'Disapproved Resubmit'
      });

      // Remove from admin queue
      await remove(ref(appdatabase, `submissions/${taskId}`));

      // Remove from local list and trigger re-render
      setAllSubmissions((prev) => prev.filter((s) => s.taskId !== taskId));

      Alert.alert('❌ Disapproved', 'The submission has been disapproved.');
    } catch (err) {
      console.error('❌ Error disapproving submission:', err);
      Alert.alert('Error', 'Failed to disapprove. Try again.');
    }
  };

  const handleLinkPress = async (url) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) Linking.openURL(url);
      else throw new Error();
    } catch {
      Clipboard.setString(url);
      Alert.alert('🔗 Copied', 'Link copied to clipboard.');
    }
  };

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <Text style={styles.user}>👤 User ID: {item.userId}</Text>
      <Text style={styles.platform}>📱 Platform: {item.platform}</Text>
      <TouchableOpacity onPress={() => handleLinkPress(item.link)}>
        <Text style={styles.link}>🔗 {item.link}</Text>
      </TouchableOpacity>
      <View style={styles.statusContainer}>
        {/* Show Approve Button if not already Approved */}
        {item.status !== 'Approved' && (
          <TouchableOpacity style={styles.approveBtn} onPress={() => handleApprove(item)}>
            <Text style={styles.approveText}>Approve</Text>
          </TouchableOpacity>
        )}
        {/* Show Disapprove Button if not already Disapproved */}
        {item.status !== 'Disapproved Resubmit' && (
          <TouchableOpacity style={styles.disapproveBtn} onPress={() => handleDisapprove(item)}>
            <Text style={styles.disapproveText}>Disapprove</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <>
    {isAdmin && <View style={styles.container}>
      <Text style={styles.header}>Admin Approval Panel</Text>
      {loading ? (
        <ActivityIndicator size="large" color="#4b5563" style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={allSubmissions}
          keyExtractor={(item) => item.taskId}
          renderItem={renderItem}
          ListEmptyComponent={<Text style={styles.empty}>No pending submissions.</Text>}
        />
      )}
    </View>}
    
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 14,
    backgroundColor: '#f1f5e9',
  },
  header: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
    color: '#374151',
    marginTop: 10,
  },
  card: {
    backgroundColor: '#dbe7c9',
    padding: 8,
    borderRadius: 12,
    marginBottom: 10,
  },
  user: {
    fontWeight: '600',
    marginBottom: 4,
    color: '#333',
    fontSize: 14,
  },
  platform: {
    fontWeight: '600',
    color: '#4b5563',
    marginBottom: 4,
    fontSize: 14,
  },
  link: {
    color: '#2563eb',
    textDecorationLine: 'underline',
    marginBottom: 6,
    fontSize: 12,
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  approveBtn: {
    backgroundColor: '#10b981',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  approveText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  disapproveBtn: {
    backgroundColor: '#f87171',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  disapproveText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  empty: {
    marginTop: 20,
    textAlign: 'center',
    color: '#6b7280',
    fontSize: 14,
  },
});
