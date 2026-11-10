// SlotActionSheet — what a tap on a FILLED calculator slot opens (2026-11-04,
// features LOG "Calculator UX batch 1"). It used to remove the item at once,
// so one stray tap lost a pick. Now the tap shows the item and up to four
// actions: Details, Add another, Move to the other side, Remove.
//
// Shared file: identical in Adopt Me, Blox and MM2. Game specifics come in as
// props (valueText, badges, which actions exist), never from imports.
import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, Image, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

const ActionButton = ({ icon, label, onPress, color, bg, disabled }) => (
  <TouchableOpacity
    style={[styles.action, { backgroundColor: bg }, disabled && styles.disabled]}
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.75}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <Icon name={icon} size={20} color={color} />
    <Text style={[styles.actionText, { color }]} numberOfLines={2}>{label}</Text>
  </TouchableOpacity>
);

/**
 * @param {object} props
 * @param {boolean} props.visible
 * @param {object|null} props.item       the slot's item (needs .name)
 * @param {string} props.imageUrl
 * @param {string} props.valueText       value already formatted for the active mode
 * @param {Array<{label:string,color:string}>} [props.badges]  variant chips (F, R, N, M, Chroma…)
 * @param {string} props.sideLabel       "Me" / "You" — where the item is now
 * @param {boolean} props.isDarkMode
 * @param {Function} props.onClose
 * @param {Function} props.onRemove
 * @param {Function} props.onMove        move to the other side
 * @param {Function} [props.onAddAnother] omit to hide; disabled when the side is full
 * @param {boolean} [props.canAddAnother]
 * @param {Function} [props.onDetails]   omit to hide
 */
const SlotActionSheet = ({
  visible, item, imageUrl, valueText, badges = [], sideLabel, isDarkMode,
  onClose, onRemove, onMove, onAddAnother, canAddAnother = true, onDetails,
}) => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  if (!item) return null;

  const surface = isDarkMode ? '#1f2937' : '#ffffff';
  const text = isDarkMode ? '#f1f5f9' : '#0f172a';
  const sub = isDarkMode ? '#94a3b8' : '#64748b';
  const chipBg = isDarkMode ? '#334155' : '#f1f5f9';
  const neutral = isDarkMode ? '#e2e8f0' : '#334155';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel={t('slot_sheet.close', { defaultValue: 'Close' })} />
      <View style={[styles.sheet, { backgroundColor: surface, paddingBottom: 16 + insets.bottom }]}>
        <View style={[styles.handle, { backgroundColor: sub + '55' }]} />

        <View style={styles.header}>
          <View style={[styles.imageWrap, { backgroundColor: chipBg }]}>
            {!!imageUrl && <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="contain" />}
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.name, { color: text }]} numberOfLines={1}>{item.name}</Text>
            <View style={styles.metaRow}>
              {badges.map((b) => (
                <View key={b.label} style={[styles.badge, { backgroundColor: b.color }]}>
                  <Text style={styles.badgeText}>{b.label}</Text>
                </View>
              ))}
              {!!sideLabel && <Text style={[styles.side, { color: sub }]}>{sideLabel}</Text>}
            </View>
          </View>
          {!!valueText && (
            <View style={styles.valueBox}>
              <Text style={[styles.valueLabel, { color: sub }]}>{t('slot_sheet.value', { defaultValue: 'Value' })}</Text>
              <Text style={[styles.value, { color: text }]} numberOfLines={1}>{valueText}</Text>
            </View>
          )}
        </View>

        <View style={styles.actions}>
          {onDetails && (
            <ActionButton icon="stats-chart-outline" label={t('slot_sheet.details', { defaultValue: 'Details' })}
              onPress={onDetails} color={neutral} bg={chipBg} />
          )}
          {onAddAnother && (
            <ActionButton icon="duplicate-outline" label={t('slot_sheet.add_another', { defaultValue: 'Add another' })}
              onPress={onAddAnother} disabled={!canAddAnother} color={neutral} bg={chipBg} />
          )}
          <ActionButton icon="swap-horizontal" label={t('slot_sheet.move', { defaultValue: 'Move to other side' })}
            onPress={onMove} color={neutral} bg={chipBg} />
          <ActionButton icon="trash-outline" label={t('slot_sheet.remove', { defaultValue: 'Remove' })}
            onPress={onRemove} color="#dc2626" bg={isDarkMode ? '#7f1d1d55' : '#fee2e2'} />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 16, paddingTop: 8,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  imageWrap: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  image: { width: 46, height: 46 },
  headerText: { flex: 1, marginLeft: 12 },
  name: { fontSize: 16, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  side: { fontSize: 12, marginLeft: 2 },
  valueBox: { alignItems: 'flex-end', marginLeft: 8, maxWidth: '35%' },
  valueLabel: { fontSize: 11 },
  value: { fontSize: 16, fontWeight: '700', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1, minHeight: 64, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, paddingHorizontal: 4,
  },
  actionText: { fontSize: 12, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  disabled: { opacity: 0.4 },
});

export default SlotActionSheet;
