/**
 * MessageActionDrawer.jsx
 * Long-press sheet for a public-chat message (ported from adoptme-jan7):
 *   reaction row → Copy / Reply / Translate / Report → staff actions.
 *
 * Every action is optional — pass null to hide its row. Staff handlers are
 * expected to do their own rank checks + audit logging (MessagesList routes
 * them through staffActionsRef).
 */

import React, { useMemo, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SwipeableBottomDrawer from '../../Helper/SwipeableBottomDrawer';

// Keep in sync with the CHECK constraint in supabase/035_message_reactions.sql.
export const REACTION_EMOJIS = ['❤️', '🔥', '😍', '💀', '🎯'];

const ActionRow = ({ icon, label, onPress, danger, styles, iconColor }) => (
  <TouchableOpacity style={styles.actionRow} activeOpacity={0.6} onPress={onPress}>
    <Icon name={icon} size={20} color={danger ? '#EF4444' : iconColor} />
    <Text style={[styles.actionText, danger && styles.dangerText]}>{label}</Text>
  </TouchableOpacity>
);

const MessageActionDrawer = ({
  visible,
  message,
  onClose,
  onReaction,
  onCopy,
  onReply,
  onTranslate,
  onReport,
  onDelete,
  onDeleteAll,
  onPinMessage,
  isStaff,
  userId,
  isDarkMode,
  allowSelfDelete = true,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const iconColor = isDarkMode ? '#e2e8f0' : '#334155';

  const myReaction = message?.reactions && userId ? message.reactions[userId] || null : null;

  const reactionCounts = useMemo(() => {
    const counts = {};
    Object.values(message?.reactions || {}).forEach((emoji) => {
      counts[emoji] = (counts[emoji] || 0) + 1;
    });
    return counts;
  }, [message?.reactions]);

  const handleEmojiTap = useCallback((emoji) => {
    onClose();
    if (onReaction && message) onReaction(message, emoji);
  }, [onReaction, message, onClose]);

  // Close first, then act — opening the report popup / an Alert while this
  // Modal is still animating out freezes iOS.
  const run = useCallback((action) => {
    onClose();
    if (typeof action === 'function') setTimeout(() => action(message), 250);
  }, [onClose, message]);

  if (!visible || !message) return null;

  const isOwn = !!userId && message.senderId === userId;
  const showSelfDelete = allowSelfDelete && !isStaff && isOwn && !!onDelete;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={onClose}>
        <SwipeableBottomDrawer
          onClose={onClose}
          isDarkMode={isDarkMode}
          style={[styles.drawer, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
        >
          {/* Swallow taps on the sheet's empty areas so they don't close it. */}
          <View onStartShouldSetResponder={() => true}>
            {!!message.text && (
              <Text style={styles.preview} numberOfLines={2}>{message.text}</Text>
            )}

            {onReaction && (
              <>
                <View style={styles.emojiRow}>
                  {REACTION_EMOJIS.map((emoji) => {
                    const isActive = myReaction === emoji;
                    const count = reactionCounts[emoji] || 0;
                    return (
                      <TouchableOpacity
                        key={emoji}
                        onPress={() => handleEmojiTap(emoji)}
                        activeOpacity={0.7}
                        style={[styles.emojiBtn, isActive && styles.emojiBtnActive]}
                      >
                        <Text style={styles.emojiText}>{emoji}</Text>
                        {count > 0 && (
                          <Text style={[styles.emojiCount, isActive && styles.emojiCountActive]}>{count}</Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.divider} />
              </>
            )}

            <View style={styles.actionsList}>
              {!!message.text && onCopy && (
                <ActionRow styles={styles} iconColor={iconColor} icon="copy-outline" label={t('chat.copy', { defaultValue: 'Copy' })} onPress={() => run(onCopy)} />
              )}
              {!!userId && onReply && (
                <ActionRow styles={styles} iconColor={iconColor} icon="arrow-undo-outline" label={t('chat.reply', { defaultValue: 'Reply' })} onPress={() => run(onReply)} />
              )}
              {!!message.text && onTranslate && (
                <ActionRow styles={styles} iconColor={iconColor} icon="language-outline" label={t('chat.translate', { defaultValue: 'Translate' })} onPress={() => run(onTranslate)} />
              )}
              {!isOwn && onReport && (
                <ActionRow styles={styles} iconColor={iconColor} icon="flag-outline" label={t('chat.report', { defaultValue: 'Report' })} onPress={() => run(onReport)} />
              )}

              {isStaff && (onPinMessage || onDelete || onDeleteAll) && (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.sectionLabel}>{t('chat.staff_actions', { defaultValue: 'Staff actions' })}</Text>
                  {onPinMessage && (
                    <ActionRow styles={styles} iconColor={iconColor} icon="pin-outline" label={t('chat.pin_this_message', { defaultValue: 'Pin Message' })} onPress={() => run(onPinMessage)} />
                  )}
                  {onDelete && (
                    <ActionRow styles={styles} iconColor={iconColor} icon="trash-outline" label={t('chat.delete', { defaultValue: 'Delete' })} danger onPress={() => run(onDelete)} />
                  )}
                  {onDeleteAll && !isOwn && (
                    <ActionRow styles={styles} iconColor={iconColor} icon="trash-bin-outline" label={t('chat.delete_all', { defaultValue: 'Delete All From User' })} danger onPress={() => run(onDeleteAll)} />
                  )}
                </>
              )}

              {showSelfDelete && (
                <>
                  <View style={styles.divider} />
                  <ActionRow styles={styles} iconColor={iconColor} icon="trash-outline" label={t('chat.delete', { defaultValue: 'Delete' })} danger onPress={() => run(onDelete)} />
                </>
              )}
            </View>
          </View>
        </SwipeableBottomDrawer>
      </Pressable>
    </Modal>
  );
};

const getStyles = (isDark) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    drawer: {
      backgroundColor: isDark ? '#1e293b' : '#ffffff',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingTop: 4,
      maxHeight: '75%',
    },
    preview: {
      fontSize: 13,
      lineHeight: 18,
      color: isDark ? '#94a3b8' : '#64748b',
      paddingHorizontal: 24,
      paddingTop: 4,
      paddingBottom: 8,
    },
    emojiRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 20,
      paddingVertical: 8,
    },
    emojiBtn: {
      width: 52,
      height: 52,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: isDark ? '#0f172a' : '#f1f5f9',
    },
    emojiBtnActive: {
      backgroundColor: isDark ? '#1e3a5f' : '#dbeafe',
      borderWidth: 2,
      borderColor: isDark ? '#3b82f6' : '#60a5fa',
    },
    emojiText: {
      fontSize: 24,
    },
    emojiCount: {
      fontSize: 10,
      color: isDark ? '#94a3b8' : '#64748b',
      fontWeight: '700',
      marginTop: 1,
    },
    emojiCountActive: {
      color: isDark ? '#93c5fd' : '#2563eb',
    },
    divider: {
      height: 1,
      backgroundColor: isDark ? '#334155' : '#e2e8f0',
      marginHorizontal: 16,
      marginVertical: 6,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      color: isDark ? '#64748b' : '#94a3b8',
      paddingHorizontal: 16,
      paddingTop: 4,
    },
    actionsList: {
      paddingHorizontal: 8,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 13,
      paddingHorizontal: 16,
      gap: 14,
      borderRadius: 10,
    },
    actionText: {
      fontSize: 15,
      fontWeight: '500',
      color: isDark ? '#e2e8f0' : '#334155',
    },
    dangerText: {
      color: '#EF4444',
    },
  });

export default React.memo(MessageActionDrawer);
