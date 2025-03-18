import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView } from 'react-native';
import { useGlobalState } from '../GlobelStats';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../Helper/Environment';

const RewardRulesModal = ({ visible, onClose }) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';

  return (
    <Modal transparent  animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBackground}>
        <View style={[styles.modalContainer, { backgroundColor: isDarkMode ? '#222' : 'white' }]}>
          
          {/* Header with Close Button */}
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: isDarkMode ? 'white' : 'black' }]}>
              🎉 Reward Rules
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close-circle" size={28} color={isDarkMode ? '#bbb' : '#333'} />
            </TouchableOpacity>
          </View>

          {/* Scrollable Content */}
          <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollContainer}>
            <Text style={[styles.modalText, { color: isDarkMode ? '#ccc' : '#333' }]}>
              1. A giveaway happens <Text style={styles.highlightedText}>every week</Text>.{"\n\n"}
              2. Everyone gets <Text style={styles.highlightedText}>2 entry slots max</Text> per giveaway.{"\n\n"}
              3. <Text style={styles.highlightedText}>Pro users</Text> are auto-entered—no action needed.{"\n\n"}
              4. <Text style={styles.highlightedText}>Free users</Text> must earn entry tickets by collecting points through rewarded ads.{"\n\n"}
              5. Rewards include <Text style={styles.highlightedText}>Robux or Fruits</Text>.{"\n\n"}
              6. Winners are chosen randomly—<Text style={styles.highlightedText}>no disputes</Text>.{"\n\n"}
              7. Claim rewards within <Text style={styles.highlightedText}>5 days</Text> of the announcement.{"\n\n"}
              8. Fake accounts or cheating will lead to <Text style={styles.highlightedText}>disqualification</Text>.
            </Text>
          </ScrollView>

          {/* Close Button */}
          <TouchableOpacity
            style={[styles.closeButton, { backgroundColor: config.colors.primary }]}
            onPress={onClose}
          >
            <Text style={[styles.closeButtonText, { color: isDarkMode ? 'white' : 'white' }]}>
              Got It!
            </Text>
          </TouchableOpacity>
          
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  modalContainer: {
    width: '98%',
    maxHeight: '90%',
    padding: 20,
    borderRadius: 15,
    alignItems: 'center',
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'Lato-Bold',
  },
  scrollContainer: {
    width: '100%',
    marginBottom: 15,
  },
  modalText: {
    fontSize: 14,
    textAlign: 'left',
    fontFamily: 'Lato-Regular',
    lineHeight: 24,
  },
  highlightedText: {
    fontWeight: 'bold',
    color: config.colors.primary,
  },
  closeButton: {
    width: '100%',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontFamily: 'Lato-Bold',
  },
});

export default RewardRulesModal;
