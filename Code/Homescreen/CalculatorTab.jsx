// Calculator tab = Calculator | Values (2026-11-04, port of Adopt Me's
// "Calculator UX batch 1"). Values sits one tap from the calculator without a
// 7th bottom tab: the switch replaces the title in the tab's gradient
// ThemeHeader, so it costs no screen height. Before this, Values was only the
// Home tile → FruitValuesStack, a full-screen page that leaves the tab bar.
//
// The calculator stays mounted while Values is shown, so a half-built trade
// survives the trip; Values mounts on demand. Only the visible side renders a
// banner (HomeScreen hideBanner), never two at once.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';
import HomeScreen from './HomeScreen';
import ValueScreen from '../ValuesScreen/ValueScreen';

export const CALC_VIEW = { CALC: 'calc', VALUES: 'values' };

// Drawn on ThemeHeader's gradient: translucent white track, white pill for
// the active side.
export const CalcValuesSwitch = ({ value, onChange }) => {
  const { t } = useTranslation();
  const options = [
    { key: CALC_VIEW.CALC, label: t('tabs.calculator', { defaultValue: 'Calculator' }) },
    { key: CALC_VIEW.VALUES, label: t('tabs.values', { defaultValue: 'Values' }) },
  ];
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {options.map((o) => {
        const active = value === o.key;
        return (
          <TouchableOpacity
            key={o.key}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => onChange(o.key)}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.label, active ? styles.labelActive : styles.labelIdle]} numberOfLines={1}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

// Same page colour and side margin the Values page (MoreNavigator Page) uses.
const pageBg = (isDark) => (isDark ? '#111827' : '#f8fafc');

const CalculatorTab = ({ view, selectedTheme }) => {
  const { theme } = useGlobalState();
  const showValues = view === CALC_VIEW.VALUES;
  const background = pageBg(theme === 'dark');
  return (
    <View style={styles.flex}>
      <View style={[styles.flex, showValues && styles.hidden]}>
        <HomeScreen selectedTheme={selectedTheme} hideBanner={showValues} />
      </View>
      {showValues && (
        <View style={[styles.flex, { backgroundColor: background }]}>
          <View style={styles.body}>
            <ValueScreen selectedTheme={selectedTheme} />
          </View>
          {/* Inside the tab navigator: banner only, no nav-bar spacer. */}
          <ScreenBottomBanner background={background} collapsible />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hidden: { display: 'none' },
  body: { flex: 1, paddingHorizontal: 8 },
  track: { flexDirection: 'row', borderRadius: 18, padding: 3, backgroundColor: 'rgba(255,255,255,0.18)' },
  segment: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 15, minWidth: 96, alignItems: 'center' },
  segmentActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  label: { fontSize: 15, fontWeight: '800' },
  labelActive: { color: config.colors.primary },
  labelIdle: { color: 'rgba(255,255,255,0.88)' },
});

export default CalculatorTab;
