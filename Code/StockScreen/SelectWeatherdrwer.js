import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';

const SelectWeatherDrawer = ({ visible, onClose, onSelect, data = [] }) => {
    const {theme} = useGlobalState()
    const isDarkMode = theme === 'dark'
  const renderItem = ({ item, index }) => (
    <TouchableOpacity
      style={styles.chip}
      onPress={() => { onSelect?.(item); onClose?.(); }}
      activeOpacity={0.8}
    >
      <Text style={styles.chipText}>{item}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={[styles.sheet, {backgroundColor: isDarkMode ? '#3B404C' : 'white'}]}>
        <View style={styles.header}>
          <Text style={styles.title}>Select Weather</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeTxt}>Close</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={data}
          keyExtractor={(item, idx) => `${item}-${idx}`}
          renderItem={renderItem}
          numColumns={3}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: '#111',
    paddingTop: 14,
    paddingHorizontal: 12,
    paddingBottom: 18,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { fontSize: 16, fontWeight: '600', color: '#fff' },
  closeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#333',
    borderRadius: 8,
  },
  closeTxt: { color: '#fff', fontWeight: '600' },
  container: { paddingBottom: 8 },
  row: { justifyContent: 'space-between', marginBottom: 10 },
  chip: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: config.colors.primary,
    alignItems: 'center',
  },
  chipText: { color: '#ddd', fontSize: 12, fontWeight: '600' },
});

export default SelectWeatherDrawer;
