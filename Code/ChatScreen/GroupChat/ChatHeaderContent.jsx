import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Pressable,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ChatRulesModal from './ChatRuleModel';
import OnlineUsersList from './OnlineUsersList';

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

const ChatHeaderContent = ({
  selectedTheme,
  modalVisibleChatinfo,
  setModalVisibleChatinfo,
  triggerHapticFeedback,
  pinnedMessages,
  onUnpinMessage,
  onlineUsersVisible,
  setOnlineUsersVisible,
}) => {
  const { theme, isAdmin, user } = useGlobalState();
  const isAdminOrMod = isAdmin || !!user?.isModerator;
  const isDarkMode = theme === 'dark';
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [pinMessageOpen, setPinMessageOpen] = useState(false);

  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const renderMessageWithLinks = useCallback((message) => {
    if (!message || typeof message !== 'string') {
      return <Text style={styles.pinnedText}>{''}</Text>;
    }

    const parts = message.split(URL_REGEX);
    return parts.map((part, index) => {
      if (part && (part.startsWith('http://') || part.startsWith('https://'))) {
        return (
          <Text
            key={index}
            style={[styles.pinnedText, { textDecorationLine: 'underline', color: '#6C63FF' }]}
            onPress={() => {
              Linking.openURL(part).catch((error) => {
                console.error('Failed to open URL:', error);
              });
            }}
          >
            {part}
          </Text>
        );
      }
      return <Text key={index} style={styles.pinnedText}>{part}</Text>;
    });
  }, [styles]);

  const uniquePinnedMessages = useMemo(() => {
    if (!Array.isArray(pinnedMessages) || pinnedMessages.length === 0) {
      return [];
    }
    return Array.from(
      new Map(pinnedMessages.map((msg) => [msg?.firebaseKey, msg]).filter(([key]) => key)).values()
    );
  }, [pinnedMessages]);

  return (
    <>
      {/* ── Top Bar: No Spamming + Info ── */}
      <View style={styles.topBar}>
        <Text style={styles.topBarText}>
          No Spamming | No Abuse | Be Civil & Polite
        </Text>
        <TouchableOpacity onPress={() => { setModalVisibleChatinfo(true); triggerHapticFeedback('impactLight'); }}>
          <Icon name="information-circle-outline" size={15} color={config.colors.primary} style={{ marginRight: 10 }} />
        </TouchableOpacity>
      </View>

      {/* ── Pinned Message Preview Strip ── */}
      {uniquePinnedMessages.length > 0 && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setPinMessageOpen(true)}
          style={styles.pinnedStrip}
        >
          <View style={styles.pinnedStripLeft}>
            <View style={styles.pinnedAccent} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                <Icon name="pin" size={11} color={config.colors.primary} style={{ marginRight: 4 }} />
                <Text style={styles.pinnedStripLabel}>{t('chat.pin_message')}</Text>
                {uniquePinnedMessages.length > 1 && (
                  <View style={styles.pinnedBadge}>
                    <Text style={styles.pinnedBadgeText}>{uniquePinnedMessages.length}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.pinnedStripText} numberOfLines={1}>
                {(uniquePinnedMessages[0]?.text || '').replace(/\n/g, ' ')}
              </Text>
            </View>
          </View>
          <Icon name="chevron-forward" size={16} color={isDarkMode ? '#666' : '#bbb'} />
        </TouchableOpacity>
      )}

      {/* ── Pinned Messages Modal (Bottom Sheet Style) ── */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={pinMessageOpen}
        onRequestClose={() => setPinMessageOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setPinMessageOpen(false)} />
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 34 : 20) }]}>
            {/* Handle */}
            <View style={styles.handleBar} />

            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon name="pin" size={20} color={config.colors.primary} style={{ marginRight: 8 }} />
                <Text style={styles.modalTitle}>{t('chat.pin_messages')}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setPinMessageOpen(false)}
                style={styles.closeIcon}
              >
                <Icon name="close" size={20} color={isDarkMode ? '#aaa' : '#666'} />
              </TouchableOpacity>
            </View>

            {/* Pinned Messages List */}
            <ScrollView
              style={{ maxHeight: 400 }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 20 }}
            >
              {uniquePinnedMessages.map((msg, index) => {
                if (!msg || !msg.firebaseKey) return null;

                const pinnedDate = msg.pinnedAt
                  ? new Date(msg.pinnedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                  : '';

                return (
                  <View key={msg.firebaseKey} style={[
                    styles.pinnedCard,
                    index === uniquePinnedMessages.length - 1 && { marginBottom: 0 },
                  ]}>
                    <View style={styles.pinnedCardTop}>
                      <View style={styles.pinnedCardAccent} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={styles.pinnedCardSender}>
                            {msg.sender || 'Anonymous'}
                          </Text>
                          {pinnedDate ? (
                            <Text style={styles.pinnedCardDate}>{pinnedDate}</Text>
                          ) : null}
                        </View>
                        <View style={{ marginTop: 4 }}>
                          <Text style={styles.pinnedCardText}>{renderMessageWithLinks(msg.text || '')}</Text>
                        </View>
                      </View>
                    </View>

                    {isAdminOrMod && (
                      <TouchableOpacity
                        onPress={() => {
                          if (onUnpinMessage && typeof onUnpinMessage === 'function') {
                            onUnpinMessage(msg.firebaseKey);
                          }
                        }}
                        style={styles.unpinBtn}
                      >
                        <Icon name="trash-outline" size={13} color="#fff" style={{ marginRight: 4 }} />
                        <Text style={styles.unpinBtnText}>{t('chat.delete')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            {/* Close Button */}
            <TouchableOpacity
              style={styles.gotItBtn}
              onPress={() => setPinMessageOpen(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.gotItBtnText}>{t('chat.got_it')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ChatRulesModal
        visible={modalVisibleChatinfo}
        onClose={() => setModalVisibleChatinfo(false)}
        isDarkMode={isDarkMode}
      />
      {onlineUsersVisible !== undefined && setOnlineUsersVisible && (
        <OnlineUsersList
          visible={onlineUsersVisible}
          onClose={() => setOnlineUsersVisible(false)}
          mode="view"
        />
      )}
    </>
  );
};

const getStyles = (isDarkMode) => StyleSheet.create({
  // ── Top Bar ──
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 3,
    alignItems: 'center',
    borderBottomWidth: 0.3,
    borderBottomColor: isDarkMode ? '#333' : '#e0e0e0',
  },
  topBarText: {
    fontSize: 9,
    color: isDarkMode ? '#64748b' : '#9ca3b8',
  },

  // ── Pinned Preview Strip ──
  pinnedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: isDarkMode ? 'rgba(139, 92, 246, 0.08)' : 'rgba(139, 92, 246, 0.05)',
    borderBottomWidth: 0.5,
    borderBottomColor: isDarkMode ? '#2a2a2a' : '#eee',
  },
  pinnedStripLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  pinnedAccent: {
    width: 3,
    height: '100%',
    minHeight: 22,
    backgroundColor: config.colors.primary,
    borderRadius: 2,
    marginRight: 10,
  },
  pinnedStripLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: config.colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pinnedBadge: {
    backgroundColor: config.colors.primary,
    borderRadius: 8,
    minWidth: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
    paddingHorizontal: 4,
  },
  pinnedBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  pinnedStripText: {
    fontSize: 13,
    color: isDarkMode ? '#ccc' : '#555',
    marginTop: 1,
  },

  // ── Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: isDarkMode ? '#1a1a2e' : '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: '80%',
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: isDarkMode ? '#444' : '#ddd',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: isDarkMode ? '#2a2a3e' : '#f0f0f0',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: isDarkMode ? '#fff' : '#0f172a',
  },
  closeIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: isDarkMode ? '#2a2a3e' : '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Pinned Message Card ──
  pinnedCard: {
    backgroundColor: isDarkMode ? '#222240' : '#f8f8ff',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: isDarkMode ? '#2e2e4e' : '#ece8ff',
  },
  pinnedCardTop: {
    flexDirection: 'row',
  },
  pinnedCardAccent: {
    width: 3,
    borderRadius: 2,
    backgroundColor: config.colors.primary,
    marginRight: 12,
  },
  pinnedCardSender: {
    fontSize: 13,
    fontWeight: '600',
    color: config.colors.primary,
  },
  pinnedCardDate: {
    fontSize: 11,
    color: isDarkMode ? '#666' : '#bbb',
  },
  pinnedCardText: {
    fontSize: 14,
    color: isDarkMode ? '#f0f0f5' : '#333',
    lineHeight: 20,
  },
  pinnedText: {
    fontSize: 14,
    color: isDarkMode ? '#f0f0f5' : '#333',
    lineHeight: 20,
  },

  // ── Unpin Button ──
  unpinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    backgroundColor: '#EF4444',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    marginTop: 10,
  },
  unpinBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Got It Button ──
  gotItBtn: {
    backgroundColor: config.colors.primary,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  gotItBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default ChatHeaderContent;
