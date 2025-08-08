import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Linking,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import { ref, get, update, set, remove } from '@react-native-firebase/database';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';
import { showMessage } from 'react-native-flash-message';

export default function UserPurchases({ user }) {
  const [activePurchases, setActivePurchases] = useState([]);
  const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [robloxUsername, setRobloxUsername] = useState('');
  const { updateLocalStateAndDatabase, theme, appdatabase } = useGlobalState();
  const isDarkMode = theme === 'dark';

  const now = Date.now();

  useEffect(() => {
    if (user?.purchases && Object.keys(user.purchases).length > 0) {
      const active = [];
      const expired = [];

      Object.values(user.purchases).forEach(purchase => {
        if (purchase) {
          if (purchase.expiresAt > now || purchase.allowed > 0 || (purchase.id === 7 && purchase.total > 0)) {
            active.push(purchase);
          } else {
            expired.push(purchase);
          }
        }
      });

      setActivePurchases(active);
    }
  }, [user?.purchases]);

  const handleWithdraw = async () => {
    // Check if the withdraw amount is valid
    if (parseInt(withdrawAmount) <1) {
      showMessage({
        message: 'Minimum withdrawal amount is 500 Robux.',
        type: 'warning',
        icon: 'warning',
      });
      return;
    }

    // Validate that both fields are filled
    if (!withdrawAmount || !robloxUsername) {
      showMessage({
        message: 'Please enter both withdrawal amount and Roblox username.',
        type: 'warning',
        icon: 'warning',
      });
      return;
    }

    try {
      const currentRobux = user?.purchases[7].total || 0;

      // Ensure user has enough Robux for the withdrawal
      if (currentRobux < withdrawAmount) {
        showMessage({
          message: 'Insufficient Robux balance.',
          type: 'warning',
          icon: 'warning',
        });
        return;
      }

      // Subtract the withdrawal amount from the user's current Robux balance
      const updatedRobuxBalance = currentRobux - parseInt(withdrawAmount);
      await update(ref(appdatabase, `users/${user.id}`), {
        robux: updatedRobuxBalance,
        [`purchases/7/total`]: updatedRobuxBalance, // Update the Robux amount in purchase 7
      });
      const withdrawalId = `withdrawal_${Date.now()}`;
      await set(ref(appdatabase, `withdrawals/${user.id}/${withdrawalId}`), {
        amount: withdrawAmount,
        status: 'Pending', // Status set to 'Pending' for admin approval
        requestedAt: Date.now(),
        robloxUsername: robloxUsername, // Store the Roblox username
      });

      // Success message
      showMessage({
        message: `Withdrawal of ${withdrawAmount} Robux has been requested.`,
        type: 'success',
        icon: 'success',
      });
      setWithdrawModalVisible(false);
    } catch (error) {
      console.error('Error processing withdrawal:', error);
      showMessage({
        message: 'Something went wrong. Please try again.',
        type: 'danger',
        icon: 'danger',
      });
    }
  };

  return (
    <View>
      {/* Active Purchases */}
      <View style={[styles.activePurchaseContainer, { backgroundColor: isDarkMode ? '#1c2541' : config.colors.hasBlockGreen }]}>
        <Text style={[styles.title, { color: isDarkMode ? 'white' : 'black' }]}>MY PURCHASES</Text>

        {activePurchases.length > 0 ? (
          activePurchases.map((purchase, idx) => (
            <View key={purchase.id || idx} style={styles.purchaseItem}>
              <View style={styles.purchaseDetails}>
                <Text style={styles.purchaseTitle}>
                  {purchase?.title || `Item ${purchase?.id}`}
                  {typeof purchase?.total === 'number' && (
                    <Text style={styles.purchaseTotal}>
                      : {purchase?.total}
                    </Text>
                  )}
                </Text>

                {/* Withdraw Button only for Purchase ID 7 */}
                {purchase.id === 7 && (
                  <View style={{justifyContent:"flex-end", alignItems:'flex-end'}}>
                    <TouchableOpacity
                      onPress={() => {
                        // console.log('Opening modal');
                        setWithdrawModalVisible(true);
                      }}
                      
                      style={[styles.withdrawButton, { opacity: user?.purchases[7]?.total < 500 ? 0.5 : 1 }]} // Disabled if robux < 500
                      disabled={user?.purchases[7]?.total < 500}
                    >
                      <Text style={styles.withdrawButtonText}>Request Withdrawal</Text>
                    </TouchableOpacity>
                    {user?.purchases[7]?.total < 500 && (
                      <Text style={styles.soldOutText}>Minimum Robux for withdrawal is 500</Text>
                    )}
                  </View>
                )}

                {/* Cancel Button for All Items Except Purchase ID 7 */}
                {purchase.id !== 7 && (
                  <TouchableOpacity
                    onPress={async () => {
                      showMessage({
                        message: `You have cancelled ${purchase?.title}`,
                        type: 'success',
                        icon: 'success',
                      });

                      // Perform the database update
                      await updateLocalStateAndDatabase({
                        [`purchases/${purchase.id}`]: null,
                      });

                      setActivePurchases((prevPurchases) =>
                        prevPurchases.filter((item) => item.id !== purchase.id)
                      );
                    }}
                    style={styles.cancelButton}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Expiry */}
              {purchase?.expiresAt && (
                <Text style={styles.expiryText}>
                  Expires: {new Date(purchase?.expiresAt).toLocaleString()}
                </Text>
              )}
            </View>
          ))
        ) : (
          <Text style={styles.noActivePurchases}>No active purchase yet</Text>
        )}
      </View>

      {/* Withdrawal Modal */}
      <Modal visible={withdrawModalVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Request Withdrawal</Text>
            <Text style={styles.modalInstruction}>Minimum withdrawal is 500 Robux.</Text>
            <TextInput
              placeholder="Enter withdrawal amount"
              value={withdrawAmount}
              onChangeText={setWithdrawAmount}
              keyboardType="numeric"
              style={styles.input}
            />
            <TextInput
              placeholder="Enter your Roblox username"
              value={robloxUsername}
              onChangeText={setRobloxUsername}
              style={styles.input}
            />
            <TouchableOpacity onPress={handleWithdraw} style={styles.submitButton}>
              <Text style={styles.submitButtonText}>Submit Withdrawal</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setWithdrawModalVisible(false)} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  activePurchaseContainer: {
    borderRadius: 12,
    padding: 8,
    marginBottom: 10,
  },
  title: {
    fontSize: 16,
    fontFamily: 'Lato-Bold',
    marginBottom: 12,
    alignSelf: 'center',
  },
  purchaseItem: {
    paddingVertical: 10,
  },
  purchaseDetails: {
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderColor: '#ccc',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  purchaseTitle: {
    fontFamily: 'Lato-Bold',
    fontSize: 15,
    color: 'white',
  },
  purchaseTotal: {
    fontSize: 13,
    color: '#fff',
    marginTop: 6,
  },
  cancelButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: '#ff6b6b',
    borderRadius: 6,
  },
  cancelButtonText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: 'bold',
    alignSelf: 'center',
  },
  withdrawButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  withdrawButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    alignSelf: 'center',
  },
  soldOutText: {
    fontSize: 12,
    color: 'lightblue', // Red color for sold out
  },
  expiryText: {
    fontSize: 13,
    color: '#d9d9ff',
  },
  noActivePurchases: {
    color: 'white',
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#000000aa',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBox: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 16,
    width: '80%',
    maxHeight: '60%',
  },
  modalTitle: {
    fontFamily: 'Lato-Bold',
    fontSize: 18,
    paddingBottom: 12,
    textAlign: 'center',
  },
  modalInstruction: {
    fontSize: 14,
    color: 'blue',
    marginBottom: 12,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  submitButton: {
    backgroundColor: '#2196F3',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginBottom: 10,
  },
  submitButtonText: {
    color: '#fff',
    fontFamily: 'Lato-Bold',
    fontSize: 16,
    alignSelf:'center'
  },
  cancelButton: {
    backgroundColor: '#FF6347',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignSelf:'center'

  },
  cancelButtonText: {
    color: '#fff',
    fontFamily: 'Lato-Bold',
    fontSize: 16,
  },
});
