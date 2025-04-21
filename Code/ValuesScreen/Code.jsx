import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  FlatList,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../Helper/HepticFeedBack';
import { t } from 'i18next';
import { showSuccessMessage } from '../Helper/MessageHelper';
import { mixpanel } from '../AppHelper/MixPenel';

const CodesDrawer = ({ isVisible, toggleModal, codes }) => {
  // Flatten codes if necessary
  const { theme, analytics } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const { triggerHapticFeedback } = useHaptic();
  const platform = Platform.OS.toLowerCase();


  const normalizedCodes =
    Array.isArray(codes) && codes.length === 1 && Array.isArray(codes[0])
      ? codes[0]
      : codes;

  // Function to copy the code to the clipboard
  const copyToClipboard = (code) => {
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code); // Copies the code to the clipboard
    showSuccessMessage(t("value.copy"), t("value.copy_success"));
    mixpanel.track("Code Copy", {Code:code});

  };

  const renderCodeItem = ({ item }) => (
    <View style={styles.codeItem}>
      <Text style={styles.codeText}>[{item.code}]</Text>
      <View style={styles.rewardContainer}>
        <Text style={styles.rewardText}>Reward: {item.reward}</Text>
        <TouchableOpacity
          onPress={() => copyToClipboard(item.code)}
          style={styles.copyButton}
        >
          <Icon name="copy-outline" size={20} color="#007BFF" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const styles = getStyles(isDarkMode);

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isVisible}
      onRequestClose={toggleModal}
    >
      {/* Overlay */}
      <Pressable style={styles.overlay} onPress={toggleModal} />

      {/* Drawer */}
      <View style={styles.drawer}>
        <FlatList
          data={normalizedCodes}
          keyExtractor={(item, index) => index.toString()}
          renderItem={renderCodeItem}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
        />
          
      </View>
    </Modal>
  );
};

export const getStyles = (isDarkMode) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    drawer: {
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
      borderTopLeftRadius: 15,
      borderTopRightRadius: 15,
      padding: 20,
      position: 'absolute',
      bottom: 0,
      width: '100%',
      maxHeight: '60%',
    },
    headerText: {
      fontSize: 20,
      fontFamily: 'Lato-Bold',
      marginBottom: 10,
      textAlign: 'center',
    },
    listContainer: {
      paddingBottom: 20,
    },
    codeItem: {
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#ddd',
      alignItems: 'center',
    },
    codeText: {
      fontSize: 16,
      fontFamily: 'Courier', // Monospaced font
      textAlign: 'center',
      marginBottom: 5,
      color: isDarkMode ? '#fff' : '#000',
    },
    rewardContainer: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    rewardText: {
      fontSize: 14,
      color: '#555',
      marginRight: 10,
      textAlign: 'center',
      color: isDarkMode ? '#fff' : '#000',
    },
    copyButton: {
      padding: 5,
    },
  });

export default CodesDrawer;
