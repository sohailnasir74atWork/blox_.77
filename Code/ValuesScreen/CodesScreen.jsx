import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage } from '../Helper/MessageHelper';
import config from '../Helper/Environment';

const CodesScreen = () => {
  const { theme } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const isDarkMode = theme === 'dark';
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();
  const [codesData, setCodesData] = useState([]);

  useEffect(() => {
    if (localState.codes) {
      try {
        const parsedCodes = typeof localState.codes === 'string'
          ? JSON.parse(localState.codes)
          : localState.codes;

        if (typeof parsedCodes !== 'object' || parsedCodes === null) {
          throw new Error('Parsed codes is not a valid object');
        }

        const extractedCodes = Object.values(parsedCodes);
        setCodesData(extractedCodes.length > 0 ? extractedCodes : []);
      } catch (error) {
        console.error("Error parsing codes:", error);
        setCodesData([]);
      }
    }
  }, [localState.codes]);

  const normalizedCodes =
    Array.isArray(codesData) && codesData.length === 1 && Array.isArray(codesData[0])
      ? codesData[0]
      : codesData;

  // "Mark used" (2026-11-20, Blox suggestion 11-15: hide a code once entered so
  // nobody types the same one twice). Stored on the device; used codes sink to
  // the bottom, dimmed and struck through. Tapping again undoes it.
  const usedSet = useMemo(
    () => new Set(Array.isArray(localState.usedCodes) ? localState.usedCodes : []),
    [localState.usedCodes],
  );
  const toggleUsed = useCallback((code) => {
    triggerHapticFeedback('impactLight');
    const next = new Set(usedSet);
    if (next.has(code)) next.delete(code); else next.add(code);
    updateLocalState('usedCodes', [...next]);
  }, [usedSet, triggerHapticFeedback, updateLocalState]);
  const sortedCodes = useMemo(() => {
    const list = Array.isArray(normalizedCodes) ? normalizedCodes.filter(Boolean) : [];
    return [...list.filter((c) => !usedSet.has(c.code)), ...list.filter((c) => usedSet.has(c.code))];
  }, [normalizedCodes, usedSet]);

  const copyToClipboard = (code) => {
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code);
    showSuccessMessage(t("value.copy"), t("value.copy_success"));
  };

  const renderCodeItem = ({ item }) => {
    const used = usedSet.has(item.code);
    return (
    <View style={[styles.codeItem, { backgroundColor: isDarkMode ? '#1e293b' : '#fff' }, used && styles.codeItemUsed]}>
      <View style={styles.codeHeader}>
        <Icon name={used ? 'checkmark-circle' : 'gift-outline'} size={20} color={used ? '#10B981' : config.colors.primary} />
        <Text style={[styles.codeText, { color: isDarkMode ? '#fff' : '#000' }, used && styles.codeTextUsed]}>
          {item.code}
        </Text>
      </View>
      <Text style={[styles.rewardText, { color: isDarkMode ? '#aaa' : '#666' }]}>
        {item.reward}
      </Text>
      <View style={styles.buttonRow}>
      <TouchableOpacity
        onPress={() => copyToClipboard(item.code)}
        style={styles.copyButton}
        activeOpacity={0.7}
      >
        <Icon name="copy-outline" size={16} color="#fff" />
        <Text style={styles.copyButtonText}>{t("value.copy") || "Copy"}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => toggleUsed(item.code)}
        style={[styles.usedButton, used && styles.usedButtonOn]}
        activeOpacity={0.7}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: used }}
      >
        <Icon name={used ? 'arrow-undo-outline' : 'checkmark-done-outline'} size={16} color={used ? '#fff' : '#10B981'} />
        <Text style={[styles.usedButtonText, used && { color: '#fff' }]}>
          {used
            ? t('values.codes_screen.used', { defaultValue: 'Used' })
            : t('values.codes_screen.mark_used', { defaultValue: 'Mark used' })}
        </Text>
      </TouchableOpacity>
      </View>
    </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Icon name="code-slash-outline" size={60} color={isDarkMode ? '#555' : '#ccc'} />
      <Text style={[styles.emptyText, { color: isDarkMode ? '#888' : '#666' }]}>
        {t('values.codes_screen.no_codes')}
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: isDarkMode ? '#0f172a' : '#f5f5f5' }]}>
      <FlatList
        data={sortedCodes}
        keyExtractor={(item, index) => `${item?.code || ''}-${index}`}
        renderItem={renderCodeItem}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmptyState}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContainer: {
    padding: 12,
    paddingBottom: 40,
    flexGrow: 1,
  },
  codeItem: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  codeText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  rewardText: {
    fontSize: 14,

    marginBottom: 12,
    marginLeft: 30,
  },
  codeItemUsed: { opacity: 0.6 },
  codeTextUsed: { textDecorationLine: 'line-through' },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 30 },
  usedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#10B981',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  usedButtonOn: { backgroundColor: '#10B981' },
  usedButtonText: { color: '#10B981', fontSize: 14, fontWeight: 'bold', marginLeft: 6 },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: config.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  copyButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 6,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 16,

    marginTop: 12,
  },
});

export default CodesScreen;
