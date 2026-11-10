// CounterOfferBanner — the slim strip above the calculator grids while a
// counter offer is being edited (2026-11-05, features LOG "Counter offer").
//
// Shared file: identical in Adopt Me, Blox and MM2. Neutral chip colours from
// Homescreen/SlotActionSheet.jsx; the screen's primary button carries the
// main action, so this strip stays quiet.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

const CounterOfferBanner = ({ name, onCancel, isDarkMode }) => {
  const { t } = useTranslation();
  const bg = isDarkMode ? '#1f2937' : '#f1f5f9';
  const text = isDarkMode ? '#f1f5f9' : '#0f172a';
  const neutral = isDarkMode ? '#e2e8f0' : '#334155';
  const cancelBg = isDarkMode ? '#334155' : '#ffffff';
  return (
    <View style={[styles.wrap, { backgroundColor: bg }]}>
      <Icon name="swap-horizontal" size={16} color={neutral} />
      <Text style={[styles.title, { color: text }]} numberOfLines={1}>
        {t('counter_offer.banner_title', { name: name || '', defaultValue: 'Counter offer to {{name}}' })}
      </Text>
      <TouchableOpacity
        style={[styles.cancel, { backgroundColor: cancelBg }]}
        onPress={onCancel}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        activeOpacity={0.75}
      >
        <Text style={[styles.cancelText, { color: neutral }]}>{t('counter_offer.banner_cancel', { defaultValue: 'Cancel' })}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 12, marginTop: 8, marginBottom: 4,
    paddingLeft: 12, paddingRight: 6, paddingVertical: 6, borderRadius: 14,
  },
  title: { flex: 1, fontSize: 14, fontWeight: '700' },
  cancel: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  cancelText: { fontSize: 12, fontWeight: '700' },
});

export default CounterOfferBanner;
