import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../Helper/Environment';
import { useTranslation } from 'react-i18next';

export const FilterMenu = ({ selectedFilters, setSelectedFilters, analytics, platform }) => {
  const { t } = useTranslation();

  // We ONLY toggle "myTrades" from the menu.
  const toggleFilter = (filterKey) => {
    setSelectedFilters((prevFilters) =>
      prevFilters.includes(filterKey)
        ? prevFilters.filter((f) => f !== filterKey)      // remove myTrades
        : [...prevFilters, filterKey]                     // add myTrades
    );
  };

  // Only show My Trades in the menu
  const filterOptions = [
    { key: "myTrades", label: t("trade.filter_my_trades") },
  ];

  return (
    <View style={styles.container}>
      <Menu>
        <MenuTrigger>
          <Icon name="filter" size={24} color={styles.icon.color} />
        </MenuTrigger>
        <MenuOptions customStyles={{ optionsContainer: styles.menuOptions }}>
          {filterOptions.map(({ key, label }) => (
            <MenuOption key={key} onSelect={() => toggleFilter(key)} closeOnSelect={false}>
              <View style={styles.menuRow}>
                <Text style={[styles.menuOptionText, selectedFilters.includes(key) && styles.selectedText]}>
                  {label}
                </Text>
                {selectedFilters.includes(key) && (
                  <Icon name="checkmark" size={16} color={config.colors.hasBlockGreen} />
                )}
              </View>
            </MenuOption>
          ))}
        </MenuOptions>
      </Menu>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'flex-end', margin: 10 },
  icon: { color: 'grey' },
  menuOptions: {
    paddingHorizontal: 10,
    backgroundColor: 'white',
    borderRadius: 8,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  menuRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  menuOptionText: { fontSize: 16, color: 'black', paddingVertical: 10, fontFamily: 'Lato-Regular' },
  selectedText: { color: config.colors.hasBlockGreen, fontFamily: 'Lato-Bold' },
});
