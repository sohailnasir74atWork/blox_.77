import React, { useMemo } from 'react';
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
import { useTranslation } from 'react-i18next';

const ChatRulesModal = ({ visible, onClose, isDarkMode }) => {
  const { t } = useTranslation();
  // ✅ Safety check and memoize rules array
  const rules = useMemo(() => {
    return Array.isArray(rulesen) ? rulesen : [];
  }, []);

  // ✅ Memoize modal background color
  const modalBgColor = useMemo(() =>
    isDarkMode ? '#1e293b' : '#fff',
    [isDarkMode]
  );

  // ✅ Memoize text colors
  const titleColor = useMemo(() =>
    isDarkMode ? '#fff' : '#000',
    [isDarkMode]
  );

  const ruleTextColor = useMemo(() =>
    isDarkMode ? '#ccc' : '#333',
    [isDarkMode]
  );

  // ✅ Validate onClose callback
  const handleClose = () => {
    if (onClose && typeof onClose === 'function') {
      onClose();
    }
  };

  return (
    <Modal animationType="slide" transparent={true} visible={visible} onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.modalContent, { backgroundColor: modalBgColor }]}>
          <Text style={[styles.title, { color: titleColor }]}>{t('chat.chat_rules_modal.title')}</Text>
          <ScrollView style={styles.scroll}>
            {rules.map((rule, index) => {
              // ✅ Safety check for rule
              if (!rule || typeof rule !== 'string') return null;

              return (
                <Text
                  key={index}
                  style={[styles.ruleText, { color: ruleTextColor }]}
                >
                  {index + 1}. {t(`chat.chat_rules_modal.rule_${index + 1}`, { defaultValue: rule })}
                </Text>
              );
            })}
          </ScrollView>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>{t('chat.chat_rules_modal.got_it')}</Text>
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
    fontWeight: 'bold',
    marginBottom: 10,
  },
  scroll: {
    marginBottom: 20,
  },
  ruleText: {
    fontSize: 14,

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
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default ChatRulesModal;
