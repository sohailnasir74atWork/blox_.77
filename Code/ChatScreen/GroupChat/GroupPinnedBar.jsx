/**
 * GroupPinnedBar — pinned messages at the top of a group chat.
 *
 * The strip shows one pin (newest first). Tapping it jumps to that message
 * in the chat and moves the strip on to the next pin, so repeated taps walk
 * through all of them. The list button opens every pin; each row jumps, and
 * the group's creator and staff can unpin from there.
 *
 * Pins live on the group's Firestore doc (groups/{id}.pinnedMessages, newest
 * first, at most MAX_GROUP_PINS), which GroupChatScreen already listens to.
 * Ported from adoptme-jan7; `c` is getThemeColors() (Helper/themeColors).
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const MAX_GROUP_PINS = 5;
const ACCENT = '#8B5CF6';

const preview = (pin, t) => {
  const text = (pin?.text || '').replace(/\s+/g, ' ').trim();
  if (text) return text;
  return pin?.hasImage ? `📷 ${t('chat.photo', { defaultValue: 'Photo' })}` : '…';
};

export default function GroupPinnedBar({ pins, c, canManage, onJump, onUnpin }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);

  // Keep the shown pin valid when pins are added or removed.
  useEffect(() => { if (index >= pins.length) setIndex(0); }, [pins.length, index]);

  if (!pins.length) return null;
  const pin = pins[Math.min(index, pins.length - 1)];

  const tapStrip = () => {
    onJump(pin);
    if (pins.length > 1) setIndex((i) => (i + 1) % pins.length);
  };

  return (
    <>
      <View style={[styles.bar, { backgroundColor: c.bgAlt, borderBottomColor: c.border }]}>
        <TouchableOpacity style={styles.main} onPress={tapStrip} activeOpacity={0.7}>
          <View style={styles.rail}>
            {pins.map((p, i) => (
              <View key={p.id} style={[styles.railDot, { backgroundColor: i === index ? ACCENT : c.border }]} />
            ))}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: ACCENT }]} numberOfLines={1}>
              📌 {pins.length > 1
                ? t('chat.pinned_n_of', { n: Math.min(index, pins.length - 1) + 1, total: pins.length, defaultValue: 'Pinned message {{n}} of {{total}}' })
                : t('chat.pinned_message', { defaultValue: 'Pinned message' })}
            </Text>
            <Text style={[styles.text, { color: c.text }]} numberOfLines={1}>
              {pin.senderName ? <Text style={{ fontWeight: '800' }}>{pin.senderName}: </Text> : null}
              {preview(pin, t)}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setOpen(true)} style={styles.listBtn} hitSlop={8}>
          <Icon name="list" size={20} color={c.textSecondary} />
        </TouchableOpacity>
      </View>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={[styles.sheet, { backgroundColor: c.bgElevated || c.bgAlt, paddingBottom: insets.bottom + 12 }]}>
          <View style={[styles.grabber, { backgroundColor: c.border }]} />
          <Text style={[styles.sheetTitle, { color: c.text }]}>📌 {t('chat.pinned_messages_title', { total: pins.length, defaultValue: 'Pinned messages ({{total}})' })}</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {pins.map((p) => (
              <View key={p.id} style={[styles.row, { borderColor: c.border }]}>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => { setOpen(false); onJump(p); }}>
                  <Text style={[styles.rowName, { color: c.text }]} numberOfLines={1}>{p.senderName || '—'}</Text>
                  <Text style={{ color: c.textSecondary, fontSize: 13.5, lineHeight: 19 }} numberOfLines={3}>{preview(p, t)}</Text>
                  <Text style={{ color: ACCENT, fontSize: 12, fontWeight: '700', marginTop: 4 }}>{t('chat.go_to_message', { defaultValue: 'Go to message' })} ›</Text>
                </TouchableOpacity>
                {canManage ? (
                  <TouchableOpacity onPress={() => onUnpin(p)} style={styles.unpin} hitSlop={8}>
                    <Icon name="close-circle" size={22} color="#EF4444" />
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingLeft: 10 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  rail: { width: 3, marginRight: 10, alignSelf: 'stretch', justifyContent: 'center', gap: 2 },
  railDot: { flex: 1, maxHeight: 30, borderRadius: 2 },
  label: { fontSize: 11.5, fontWeight: '800' },
  text: { fontSize: 13.5, marginTop: 1 },
  listBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 10 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 10 },
  sheetTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  rowName: { fontSize: 13.5, fontWeight: '800', marginBottom: 2 },
  unpin: { paddingLeft: 12 },
});
