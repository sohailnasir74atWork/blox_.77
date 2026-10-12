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
import { useTranslation } from 'react-i18next';

const GroupsGuideModal = ({ visible, onClose }) => {
  const { theme } = useGlobalState();
  const { t } = useTranslation();
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
              {t('chat.groups_guide.title')}
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
                {t('chat.groups_guide.how_to_create_title')}
              </Text>
              <Text style={[styles.sectionText, { color: isDarkMode ? '#D1D5DB' : '#4B5563' }]}>
                {t('chat.groups_guide.how_to_create_body')}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.section}>
              <View style={styles.iconContainer}>
                <Icon name="information-circle" size={24} color={config.colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : '#000' }]}>
                {t('chat.groups_guide.rules_title')}
              </Text>
              <Text style={[styles.sectionText, { color: isDarkMode ? '#D1D5DB' : '#4B5563' }]}>
                • <Text style={styles.boldText}>{t('chat.groups_guide.rule_group_limit_label')}</Text> {t('chat.groups_guide.rule_group_limit_body')}{'\n\n'}
                • <Text style={styles.boldText}>{t('chat.groups_guide.rule_min_members_label')}</Text> {t('chat.groups_guide.rule_min_members_body')}{'\n\n'}
                • <Text style={styles.boldText}>{t('chat.groups_guide.rule_max_members_label')}</Text> {t('chat.groups_guide.rule_max_members_body')}{'\n\n'}
                • <Text style={styles.boldText}>{t('chat.groups_guide.rule_group_admin_label')}</Text> {t('chat.groups_guide.rule_group_admin_body')}{'\n\n'}
                • <Text style={styles.boldText}>{t('chat.groups_guide.rule_admin_transfer_label')}</Text> {t('chat.groups_guide.rule_admin_transfer_body')}{'\n\n'}
                • <Text style={styles.boldText}>{t('chat.groups_guide.rule_leaving_label')}</Text> {t('chat.groups_guide.rule_leaving_body')}{'\n\n'}
                • <Text style={styles.boldText}>{t('chat.groups_guide.rule_invitations_label')}</Text> {t('chat.groups_guide.rule_invitations_body')}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.section}>
              <View style={styles.iconContainer}>
                <Icon name="chatbubbles" size={24} color={config.colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : '#000' }]}>
                {t('chat.groups_guide.features_title')}
              </Text>
              <Text style={[styles.sectionText, { color: isDarkMode ? '#D1D5DB' : '#4B5563' }]}>
                {t('chat.groups_guide.features_body')}
              </Text>
            </View>
          </ScrollView>

          {/* Close Button */}
          <TouchableOpacity
            style={[styles.gotItButton, { backgroundColor: config.colors.primary }]}
            onPress={onClose}
          >
            <Text style={styles.gotItButtonText}>{t('chat.groups_guide.got_it')}</Text>
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
      fontWeight: 'bold',
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
      fontWeight: 'bold',
      marginBottom: 12,
    },
    sectionText: {
      fontSize: 14,

      lineHeight: 22,
    },
    boldText: {
      fontWeight: 'bold',
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
      fontWeight: 'bold',
    },
  });

export default GroupsGuideModal;

