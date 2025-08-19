import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { rulesen } from '../utils';
import config from '../../Helper/Environment';

const ChatRulesModal = ({ visible, onClose, isDarkMode }) => {
  return (
    <Modal animationType="slide" transparent={true} visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#121212' : '#fff' }]}>
          <Text style={[styles.title, { color: isDarkMode ? '#fff' : '#000' }]}>Community Chat Rules</Text>
          <ScrollView style={styles.scroll}>
            {rulesen.map((rule, index) => (
              <Text
                key={index}
                style={[styles.ruleText, { color: isDarkMode ? '#ccc' : '#333' }]}
              >
                {index + 1}. {rule}
              </Text>
            ))}
          </ScrollView>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '95%',
    maxHeight: '80%',
    borderRadius: 12,
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Lato-Bold',
    marginBottom: 10,
  },
  scroll: {
    marginBottom: 20,
  },
  ruleText: {
    fontSize: 14,
    fontFamily: 'Lato-Regular',
    marginBottom: 10,
  },
  closeButton: {
    backgroundColor: config.colors.primary,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeButtonText: {
    color: 'white',
    fontFamily: 'Lato-Bold',
    fontSize: 16,
  },
});

export default ChatRulesModal;
