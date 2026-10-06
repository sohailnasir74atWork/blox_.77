// Replaces a chat input while the signed-in user is banned or muted, so they
// see why (and for how long) instead of typing a message that then fails.
// Same idea as adoptme-jan7's `isMeBanned` input state. `gate` comes from
// getModGate('chat') in GlobelStats; a 'checking' gate renders nothing (the
// send path shows a short "checking" message instead).
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { modGateText } from '../GlobelStats';

const ChatRestrictedBar = ({ gate, isDarkMode }) => {
  // Re-render every 30s so the "for Xm more" countdown stays current.
  const [, setTick] = useState(0);
  const timed = typeof gate?.info?.bannedUntil === 'number';
  useEffect(() => {
    if (!timed) return;
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, [timed]);

  if (!gate || gate.kind === 'checking') return null;
  const { title, message } = modGateText(gate, 'chat') || {};

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: isDarkMode ? 'rgba(239,68,68,0.12)' : '#FEF2F2',
          borderTopColor: isDarkMode ? 'rgba(239,68,68,0.3)' : '#FECACA',
        },
      ]}
      accessibilityRole="text"
    >
      <Icon name={gate.kind === 'muted' ? 'volume-mute' : 'ban'} size={18} color="#EF4444" />
      <View style={styles.textWrap}>
        <Text style={styles.title}>{title}</Text>
        <Text style={[styles.body, { color: isDarkMode ? '#e5e5e5' : '#374151' }]}>{message}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  textWrap: { flex: 1 },
  title: { fontSize: 13, fontWeight: '700', color: '#EF4444' },
  body: { fontSize: 12, marginTop: 2, lineHeight: 16 },
});

export default ChatRestrictedBar;
