import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const FruitRow = ({ title, rightContent }) => (
  <View style={styles.row}>
    <Text style={styles.title}>{title}</Text>
    <View style={styles.right}>{rightContent}</View>
  </View>
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  title: { fontSize: 16, fontWeight: '600' },
  right: { flexDirection: 'row', alignItems: 'center' },
});

export default FruitRow;
