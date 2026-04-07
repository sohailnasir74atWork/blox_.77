import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';

const ThemeHeader = ({ title, rightContent, leftContent, showBack = false }) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  // Mirrors HomeTabScreen gradient colors precisely for light & dark mode
  const heroGradient = isDarkMode
    ? ['#1a1035', '#2d1b69', '#1a1035']
    : [config.colors.primary, '#4f46e5', '#6366f1'];

  return (
    <LinearGradient
      colors={heroGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.heroBanner,
        { paddingTop: insets.top + 4 }
      ]}
    >
      <View style={styles.heroContent}>
        <View style={styles.leftGroup}>
          {showBack && (
            <TouchableOpacity onPress={() => navigation?.goBack?.()} activeOpacity={0.8} style={styles.backBtn}>
              <Icon name="chevron-back" size={22} color="#fff" />
            </TouchableOpacity>
          )}
          {leftContent}
          <Text style={styles.heroTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <View style={styles.rightGroup}>
          {rightContent}
        </View>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  heroBanner: {
    paddingBottom: 8,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  heroContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 36,
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  backBtn: {
    padding: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -0.5,
    flexShrink: 1,
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});

export default ThemeHeader;
