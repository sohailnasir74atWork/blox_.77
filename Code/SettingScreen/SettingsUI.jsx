// Building blocks for the grouped Settings list (2026-10-25 redesign):
// a section header + rounded card, and one row type with a single neutral
// icon style. Kept identical across Adopt Me, MM2 and Blox.
import React from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

export const getRowStyles = (c, isDarkMode) => StyleSheet.create({
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: c.textSecondary,
    marginTop: 18,
    marginBottom: 6,
    marginHorizontal: 6,
  },
  card: {
    backgroundColor: c.bgAlt,
    borderRadius: 14,
    overflow: 'hidden',
  },
  // Rows draw a top hairline; this negative margin tucks the first one
  // under the card's clipped edge so only the separators show.
  cardInner: { marginTop: -StyleSheet.hairlineWidth },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: isDarkMode ? '#273449' : '#f1f2f5',
    marginRight: 12,
  },
  iconColor: { color: isDarkMode ? '#cbd5e1' : '#4b5563' },
  label: { fontSize: 15, color: c.text },
  subtitle: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  value: { fontSize: 13, color: c.textSecondary, marginLeft: 8 },
  chevron: { color: c.textMuted },
  note: { fontSize: 12, color: c.textSecondary, marginTop: 6, marginHorizontal: 8, lineHeight: 17 },
  // EmailUpdatesRow / BirthdayVisibilityRow take a `styles` prop with
  // option + optionText; these make them match the rows above.
  legacyText: { fontSize: 15, color: c.text },
  legacyIcon: {
    width: 30,
    height: 30,
    lineHeight: 30,
    textAlign: 'center',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: isDarkMode ? '#273449' : '#f1f2f5',
    marginRight: 12,
  },
});

// Props for EmailUpdatesRow / BirthdayVisibilityRow so they look like SettingsRow.
export const legacyRowProps = (rs) => ({
  styles: { option: rs.row, optionText: rs.legacyText },
  iconStyle: rs.legacyIcon,
  iconColor: rs.iconColor.color,
  iconSize: 17,
});

export const SettingsGroup = ({ title, rs, children, style }) => (
  <View style={style}>
    {title ? <Text style={rs.sectionTitle}>{title}</Text> : null}
    <View style={rs.card}>
      <View style={rs.cardInner}>{children}</View>
    </View>
  </View>
);

export const SettingsRow = ({
  rs, icon, label, subtitle, value, valueStyle, right, onPress, switchValue, onSwitch, chevron, labelStyle, disabled,
}) => {
  const hasSwitch = typeof onSwitch === 'function';
  const body = (
    <>
      {icon ? (
        <View style={rs.icon}>
          <Icon name={icon} size={17} color={rs.iconColor.color} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[rs.label, labelStyle]} numberOfLines={2}>{label}</Text>
        {subtitle ? <Text style={rs.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {value != null && value !== '' ? <Text style={[rs.value, valueStyle]} numberOfLines={1}>{value}</Text> : null}
      {right}
      {hasSwitch ? <Switch value={!!switchValue} onValueChange={onSwitch} disabled={disabled} /> : null}
      {chevron ? <Icon name={chevron === true ? 'chevron-forward' : chevron} size={16} color={rs.chevron.color} style={{ marginLeft: 6 }} /> : null}
    </>
  );
  if (hasSwitch) {
    return (
      <TouchableOpacity activeOpacity={0.7} style={rs.row} onPress={() => onSwitch(!switchValue)} disabled={disabled}>
        {body}
      </TouchableOpacity>
    );
  }
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.7} style={rs.row} onPress={onPress} disabled={disabled}>
        {body}
      </TouchableOpacity>
    );
  }
  return <View style={rs.row}>{body}</View>;
};

// Header for an in-screen sub-page (Privacy and chat, Help, Legal).
export const SubPageHeader = ({ title, onBack, c, color }) => (
  <TouchableOpacity
    onPress={onBack}
    activeOpacity={0.7}
    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 2 }}
  >
    <Icon name="chevron-back" size={22} color={color} />
    <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, marginLeft: 4 }}>{title}</Text>
  </TouchableOpacity>
);
