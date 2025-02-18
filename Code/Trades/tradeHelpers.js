import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../Helper/Environment';

export const FilterMenu = ({ selectedFilters, setSelectedFilters }) => {
  const toggleFilter = (filter) => {
    setSelectedFilters((prevFilters) =>
      prevFilters.includes(filter) ? prevFilters.filter((f) => f !== filter) : [...prevFilters, filter]
    );
  };

  return (
    <View style={styles.container}>
      <Menu>
        <MenuTrigger>
          <Icon name="filter" size={24} color={styles.icon.color} />
        </MenuTrigger>
        <MenuOptions customStyles={{ optionsContainer: styles.menuOptions }}>
          {[
            "Has",
            "Wants",
            "My Trades",
            "Fair Deal",
            "Risky Deal",
            "Best Deal",
            "Decent Deal",
            "Weak Deal",
            "Great Deal"
          ].map((filter) => (
            <MenuOption key={filter} onSelect={() => toggleFilter(filter)} closeOnSelect={false}>
              <View style={styles.menuRow}>
                <Text style={[styles.menuOptionText, selectedFilters.includes(filter) && styles.selectedText]}>
                  {filter}
                </Text>
                {selectedFilters.includes(filter) && <Icon name="checkmark" size={16} color={config.colors.hasBlockGreen} />}
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
