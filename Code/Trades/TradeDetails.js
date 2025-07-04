import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { Icon } from 'react-native-vector-icons/Ionicons';

// Helper functions to format item names and values directly here
const formatNameNew = (name) => {
  if (!name) return '';
  const formattedName = name
    .split('_') // Split on underscore
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize each word
    .join(' '); // Join with space

  // If the formatted name length is greater than 10 characters, truncate it and add "..."
  if (formattedName.length > 10) {
    return formattedName.slice(0, 10) + '...'; // Truncate to 10 characters and append '...'
  }

  return formattedName; // Return the formatted name if it's 10 characters or less
};

const formatValue = (value) => {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`; // Billions
  } else if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`; // Millions
  } else if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`; // Thousands
  } else {
    return value?.toLocaleString(); // Default formatting
  }
};

const TradeDetails = ({ onClose, handleChatNavigation, groupedHasItems, groupedWantsItems }) => {
  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={true}
      onRequestClose={onClose} // Handle back press to close
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Icon name="close" size={24} color="#fff" />
          </TouchableOpacity>

          <Text style={styles.title}>Trade Details</Text>

          {/* Grouped Has Items */}
          <View style={styles.itemList}>
            <Text style={styles.subtitle}>Has Items:</Text>
            {groupedHasItems.length > 0 ? (
              groupedHasItems.map((hasItem, index) => (
                <View key={index} style={styles.item}>
                  <Image source={{ uri: hasItem?.Image }} style={styles.itemImage} />
                  <Text style={styles.itemName}>{formatNameNew(hasItem?.Name)}</Text>
                  <Text style={styles.itemValue}>{formatValue(hasItem?.Value)}</Text>
                </View>
              ))
            ) : (
              <Text>No items in this trade.</Text>
            )}
          </View>

          {/* Grouped Wants Items */}
          <View style={styles.itemList}>
            <Text style={styles.subtitle}>Wants Items:</Text>
            {groupedWantsItems.length > 0 ? (
              groupedWantsItems.map((wantItem, index) => (
                <View key={index} style={styles.item}>
                  <Image source={{ uri: wantItem?.Image }} style={styles.itemImage} />
                  <Text style={styles.itemName}>{formatNameNew(wantItem?.Name)}</Text>
                  <Text style={styles.itemValue}>{formatValue(wantItem?.Value)}</Text>
                </View>
              ))
            ) : (
              <Text>No items in this trade.</Text>
            )}
          </View>

          {/* Chat Button */}
          <TouchableOpacity style={styles.chatButton} onPress={handleChatNavigation}>
            <Text style={styles.chatText}>Chat with Trader</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)', // Semi-transparent background
  },
  modalContent: {
    width: '80%',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  closeButton: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 5,
    alignSelf: 'flex-start',
  },
  itemList: {
    width: '100%',
    marginBottom: 20,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  itemImage: {
    width: 40,
    height: 40,
    borderRadius: 5,
    marginRight: 10,
  },
  itemName: {
    fontSize: 14,
    flex: 1,
  },
  itemValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#007BFF',
  },
  chatButton: {
    marginTop: 10,
    backgroundColor: '#007BFF',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5,
  },
  chatText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default TradeDetails;
