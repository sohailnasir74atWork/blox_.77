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
} from 'react-native';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import { useTranslation } from 'react-i18next';
const FruitSelectionDrawer = ({ visible, onClose, onSelect, data, selectedTheme }) => {
  const [searchText, setSearchText] = useState('');
  const [selectedItems, setSelectedItems] = useState([]);
  const { theme } = useGlobalState()
  const isDarkMode = theme === 'dark';
  const { t } = useTranslation();


  // Clear search text and reset selected items when the modal opens
  useEffect(() => {
    if (visible) {
      setSearchText('');
    }
  }, [visible]);

  const handleSelect = (item) => {
    // Add or remove the item from the selected list
    if (selectedItems?.some((selected) => selected.name === item.name)) {
      setSelectedItems(selectedItems?.filter((selected) => selected.name !== item.name));
    } else {
      setSelectedItems([...selectedItems, item]);
    }
    onSelect(item); // Notify parent about the selection
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
      <Pressable style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View style={[styles.drawer, { backgroundColor: isDarkMode ? '#3B404C' : 'white' }]}>
          <Text style={[styles.title, { color: selectedTheme.colors.text }]}>{t("stock.select_fruit")}</Text>
          <View style={styles.header}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search..."
              placeholderTextColor={isDarkMode ? '#ccc' : '#666'}
              value={searchText}
              onChangeText={handleSearchChange}
              onSubmitEditing={Keyboard.dismiss}
            />
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closetext}>{t("home.close")}</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            showsVerticalScrollIndicator={false}
            data={filteredData}
            keyExtractor={(item) => item.name}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.itemBlock,
                  selectedItems?.some((selected) => selected.name === item.name) && styles.selectedItem,
                ]}
                onPress={() => handleSelect(item)}
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
                <Text style={styles.itemText}>{item.name}</Text>
                <Text style={styles.itemText}>{Number(item.value).toLocaleString()}</Text>
              </TouchableOpacity>
            )}
            numColumns={3}
            contentContainerStyle={styles.flatListContainer}
            columnWrapperStyle={styles.columnWrapper}
          />
        </View>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  drawer: {
    paddingHorizontal: 10,
    paddingTop: 20,
    height: 400,
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 18, fontFamily: 'Lato-Bold' },
  itemBlock: {
    width: '32%',
    height: 110,
    backgroundColor: config.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
    marginBottom: 10,
  },
  flatListContainer: {
    justifyContent: 'space-between',
  },
  columnWrapper: {
    flex: 1,
    justifyContent: 'space-around',
  },
  icon: { width: 40, height: 40, alignSelf: 'center' },
  itemText: { fontSize: 16, color: 'white' },
  searchInput: {
    width: '77%',
    borderWidth: 1,
    borderRadius: 5,
    height: 48,
    borderColor: '#333',
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    color: '#000',
    marginVertical: 10,
  },
  closeButton: {
    backgroundColor: config.colors.wantBlockRed,
    padding: 10,
    borderRadius: 5,
    width: '22%',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    marginVertical: 10,
  },
  closetext: {
    color: 'white',
  },
  selectedItem: {
    borderWidth: 2,
    borderColor: 'green',
  },
});

export default FruitSelectionDrawer;
