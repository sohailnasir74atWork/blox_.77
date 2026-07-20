import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  TextInput,
  Pressable,
  Keyboard,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import { useTranslation } from 'react-i18next';

const FruitSelectionDrawer = ({ visible, onClose, onSelect, data, selectedTheme }) => {
  const [searchText, setSearchText] = useState('');
  const [selectedItems, setSelectedItems] = useState([]);
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      setSearchText('');
    }
  }, [visible]);

  const handleSelect = (item) => {
    if (selectedItems?.some((selected) => selected.name === item.name)) {
      setSelectedItems(selectedItems?.filter((selected) => selected.name !== item.name));
    } else {
      setSelectedItems([...selectedItems, item]);
    }
    onSelect({ name: item.name });
  };

  const handleSearchChange = (text) => {
    setSearchText(text);
  };

  const filteredData = data.filter((item) =>
    item.name.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <Pressable style={styles.modalOverlay} onPress={onClose} />
      <View style={[styles.drawer, { backgroundColor: isDarkMode ? '#1e293b' : '#ffffff', paddingBottom: Math.max(insets.bottom, 20) }]}>
        {/* Handle bar */}
        <View style={styles.handleBar}>
          <View style={[styles.handle, { backgroundColor: isDarkMode ? '#475569' : '#cbd5e1' }]} />
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>{t("stock.select_fruit")}</Text>

        {/* Search + Close */}
        <View style={styles.header}>
          <View style={[styles.searchWrap, { backgroundColor: isDarkMode ? '#334155' : '#f1f5f9' }]}>
            <Icon name="search" size={18} color={isDarkMode ? '#94a3b8' : '#94a3b8'} />
            <TextInput
              style={[styles.searchInput, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}
              placeholder="Search fruits..."
              placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
              value={searchText}
              onChangeText={handleSearchChange}
              onSubmitEditing={Keyboard.dismiss}
            />
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Icon name="close" size={20} color="white" />
          </TouchableOpacity>
        </View>

        {/* Fruit Grid */}
        <FlatList
          showsVerticalScrollIndicator={false}
          data={filteredData}
          keyExtractor={(item) => item.name}
          renderItem={({ item }) => {
            const isSelected = selectedItems?.some((selected) => selected.name === item.name);
            return (
              <TouchableOpacity
                style={[
                  styles.itemBlock,
                  { backgroundColor: isDarkMode ? '#273548' : '#f8fafc' },
                  isSelected && {
                    borderWidth: 2,
                    borderColor: config.colors.hasBlockGreen,
                    backgroundColor: isDarkMode ? '#1e3a2f' : '#ecfdf5',
                  },
                ]}
                onPress={() => handleSelect(item)}
                activeOpacity={0.7}
              >
                <Image
                  source={{
                    uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${item.name.replace(
                      /^\+/,
                      ''
                    ).replace(/\s+/g, '-')}_Icon.webp`,
                  }}
                  style={styles.icon}
                />
                <Text style={[styles.itemName, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]} numberOfLines={1}>{item.name}</Text>
                <View style={[styles.valueBadge, { backgroundColor: config.colors.hasBlockGreen }]}>
                  <Text style={styles.valueText}>{Number(item.value).toLocaleString()}</Text>
                </View>
                {isSelected && (
                  <View style={styles.checkMark}>
                    <Icon name="checkmark-circle" size={18} color={config.colors.hasBlockGreen} />
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
          numColumns={3}
          contentContainerStyle={styles.flatListContainer}
          columnWrapperStyle={styles.columnWrapper}
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={5}
          updateCellsBatchingPeriod={100}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  drawer: {
    paddingHorizontal: 12,
    paddingBottom: 20,
    height: 450,
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
    }),
  },
  handleBar: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 44,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    marginLeft: 8,
    paddingVertical: 0,
  },
  closeButton: {
    backgroundColor: config.colors.wantBlockRed,
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flatListContainer: {
    paddingBottom: 10,
  },
  columnWrapper: {
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  itemBlock: {
    width: '31.5%',
    borderRadius: 16,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 110,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    marginBottom: 6,
  },
  itemName: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  valueBadge: {
    borderRadius: 8,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  valueText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '700',
  },
  checkMark: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
});

export default FruitSelectionDrawer;
