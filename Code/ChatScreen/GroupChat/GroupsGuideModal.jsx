import React, { useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';

const GroupsGuideModal = ({ visible, onClose }) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';

  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.modalContent, { backgroundColor: isDarkMode ? '#1F2937' : '#FFFFFF' }]}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: isDarkMode ? '#fff' : '#000' }]}>
              Groups Guide
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close-circle" size={28} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView 
            showsVerticalScrollIndicator={false} 
            style={styles.scrollContainer}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.section}>
              <View style={styles.iconContainer}>
                <Icon name="people" size={24} color={config.colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : '#000' }]}>
                How to Create a Group
              </Text>
              <Text style={[styles.sectionText, { color: isDarkMode ? '#D1D5DB' : '#4B5563' }]}>
                1. Go to the main Chat screen and tap the plus icon (+) in the header.{'\n\n'}
                2. Select members from the online users list (you can select multiple users by tapping on them).{'\n\n'}
                3. Tap "Create" or "Add" button at the top (it will show "Create" if you don't have a group, or "Add" if you already have a group).{'\n\n'}
                4. If creating a new group, enter a group name (required, max 50 characters) in the modal that appears.{'\n\n'}
                5. Tap "Create Group" to finalize.{'\n\n'}
                6. Selected members will receive invitations to join your group.
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.section}>
              <View style={styles.iconContainer}>
                <Icon name="information-circle" size={24} color={config.colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : '#000' }]}>
                Important Rules
              </Text>
              <Text style={[styles.sectionText, { color: isDarkMode ? '#D1D5DB' : '#4B5563' }]}>
                • <Text style={styles.boldText}>One Group Limit:</Text> Each user can only be an admin/creator of one group at a time.{'\n\n'}
                • <Text style={styles.boldText}>Minimum Members:</Text> A group must have at least 2 members (including yourself).{'\n\n'}
                • <Text style={styles.boldText}>Maximum Members:</Text> Each group can have up to 15 members.{'\n\n'}
                • <Text style={styles.boldText}>Group Admin:</Text> The creator is the admin. Admins can remove members and make other members admin.{'\n\n'}
                • <Text style={styles.boldText}>Admin Transfer:</Text> If an admin (not creator) makes another member admin, they will revert to a regular member. The creator always remains admin.{'\n\n'}
                • <Text style={styles.boldText}>Leaving Groups:</Text> Members can leave at any time. If an admin/creator leaves, a new admin is randomly selected. If the last member leaves, the group is deleted.{'\n\n'}
                • <Text style={styles.boldText}>Invitations:</Text> Members must accept invitations before they can join.
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.section}>
              <View style={styles.iconContainer}>
                <Icon name="chatbubbles" size={24} color={config.colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : '#000' }]}>
                Group Features
              </Text>
              <Text style={[styles.sectionText, { color: isDarkMode ? '#D1D5DB' : '#4B5563' }]}>
                • Send text messages, images, and pets (up to 18 pets per message).{'\n\n'}
                • See who's online in your group.{'\n\n'}
                • View group members and their roles.{'\n\n'}
                • Receive notifications for new messages when you're not active in the chat.
              </Text>
            </View>
          </ScrollView>

          {/* Close Button */}
          <TouchableOpacity
            style={[styles.gotItButton, { backgroundColor: config.colors.primary }]}
            onPress={onClose}
          >
            <Text style={styles.gotItButtonText}>Got It!</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: {
      width: '90%',
      height: '85%',
      borderRadius: 20,
      padding: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 5,
      justifyContent: 'space-between',
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20,
    },
    modalTitle: {
      fontSize: 24,
      fontFamily: 'Lato-Bold',
    },
    closeButton: {
      padding: 4,
    },
    scrollContainer: {
      flex: 1,
      marginBottom: 20,
    },
    scrollContent: {
      paddingBottom: 10,
    },
    section: {
      marginBottom: 20,
    },
    iconContainer: {
      marginBottom: 12,
    },
    sectionTitle: {
      fontSize: 18,
      fontFamily: 'Lato-Bold',
      marginBottom: 12,
    },
    sectionText: {
      fontSize: 14,
      fontFamily: 'Lato-Regular',
      lineHeight: 22,
    },
    boldText: {
      fontFamily: 'Lato-Bold',
      color: config.colors.primary,
    },
    divider: {
      height: 1,
      backgroundColor: isDarkMode ? '#374151' : '#E5E7EB',
      marginVertical: 20,
    },
    gotItButton: {
      paddingVertical: 14,
      paddingHorizontal: 30,
      borderRadius: 10,
      alignItems: 'center',
      marginTop: 10,
    },
    gotItButtonText: {
      color: '#fff',
      fontSize: 16,
      fontFamily: 'Lato-Bold',
    },
  });

export default GroupsGuideModal;

