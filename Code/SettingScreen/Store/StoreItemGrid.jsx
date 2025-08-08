import React from 'react';
import { FlatList } from 'react-native';
import StoreItemCard from './StoreItemCard';

const StoreItemGrid = ({ items, onItemPress, isDark, styles }) => (
  <FlatList
    data={items}
    keyExtractor={(item) => item?.id}
    renderItem={({ item }) => (
      <StoreItemCard item={item} onPress={onItemPress} isDark={isDark} styles={styles} />
    )}
    numColumns={2}
    columnWrapperStyle={{ justifyContent: 'space-between' }}
    showsVerticalScrollIndicator={false}
  />
);

export default StoreItemGrid; 