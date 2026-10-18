/**
 * TranslateTip — one-time "long-press (or tap) a message to translate it" strip
 * for the chats (2026-10-18: players asked for a translator that already sits
 * in the message menu). It goes at the TOP of the chat, in the layout flow:
 * never an overlay and never next to the banner under the input.
 *
 * Once per install: the first chat opened shows it, and the MMKV flag
 * (showTranslateTip) is cleared right then, so it stays for this app session
 * only — until the X or the first Translate (MessagesList / PrivateMessageList) hides it.
 * `gesture` says what opens the menu on that screen: 'long' (MessageActionDrawer
 * on long-press, public chat) or 'tap' (the popup menu in private chat).
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';

// 'unknown' until the first chat mounts this session, then 'show' or 'hidden'.
let sessionState = 'unknown';
const listeners = new Set();

/** Hide the tip everywhere for the rest of this session. */
export const hideTranslateTip = () => {
  if (sessionState === 'hidden') return;
  sessionState = 'hidden';
  listeners.forEach((l) => l());
};

const TranslateTip = ({ gesture = 'long' }) => {
  const { t } = useTranslation();
  const { theme } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const [visible, setVisible] = useState(() => {
    if (sessionState === 'unknown') sessionState = localState?.showTranslateTip ? 'show' : 'hidden';
    return sessionState === 'show';
  });

  useEffect(() => {
    const hide = () => setVisible(false);
    listeners.add(hide);
    return () => { listeners.delete(hide); };
  }, []);

  // Seen once is enough: clear the stored flag as soon as it is on screen.
  useEffect(() => {
    if (visible && localState?.showTranslateTip) updateLocalState('showTranslateTip', false);
  }, [visible, localState?.showTranslateTip, updateLocalState]);

  if (!visible) return null;
  const dark = theme === 'dark';
  const fg = dark ? '#C4B5FD' : '#5B21B6';
  return (
    <View style={[styles.tip, dark ? styles.tipDark : styles.tipLight]}>
      <Icon name="language-outline" size={16} color={fg} />
      <Text style={[styles.text, { color: fg }]}>
        {t(gesture === 'tap' ? 'chat.translate_tip_tap' : 'chat.translate_tip_long')}
      </Text>
      <TouchableOpacity onPress={hideTranslateTip} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('trade.notifier.close')}>
        <Icon name="close" size={16} color={fg} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  tip: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 10, marginTop: 6, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  tipLight: { backgroundColor: '#EDE9FE' },
  tipDark: { backgroundColor: 'rgba(124,58,237,0.18)' },
  text: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 17 },
});

export default TranslateTip;
