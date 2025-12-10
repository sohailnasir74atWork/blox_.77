import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useGlobalState } from '../../GlobelStats';

export default function ScamSafetyBox() {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  return (
    <View style={styles.box}>
      <Text style={styles.title}>⚠️ Scam Safety</Text>
      <Text style={styles.item}>🤔 Too good = scam</Text>
      <Text style={styles.item}>🙅 Don’t share personal info</Text>
      <Text style={styles.item}>🔗 Don’t tap unknown links</Text>
      <Text style={styles.item}>💰 Double-check values</Text>
    </View>
  );
}

const getStyles = (isDark) =>
  StyleSheet.create({
    box: {
      padding: 4,
      margin: 4,
      borderRadius: 12,
      borderWidth: 1,
      backgroundColor: isDark ? '#0B1220' : '#FFF7ED', 
      borderColor: isDark ? '#334155' : '#FDBA74',    
    },
    title: {
      fontSize: 11,
      fontWeight: '800',
      color: isDark ? '#FDE68A' : '#9A3412',            
      marginBottom: 6,
    },
    item: {
      fontSize: 9,
      color: isDark ? '#E2E8F0' : '#7C2D12',           
    //   marginTop: 2,
    },
  });
