/**
 * CustomBadgeChip — how a custom badge (Code/Helper/customBadges.js) is drawn
 * in Blox: the same solid chip as the role badges in
 * Code/Design/componenets/RoleBadges.jsx, in the badge's own colour, with its
 * white icon (assets/custom-badges) and short name. `CustomGlyph` is the icon
 * alone on a round swatch — the pickers in the editor and the Mod Tools panel
 * use it.
 */

import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

const SIZES = {
  sm: { fs: 8, ic: 10, ph: 4, pv: 1, br: 5, gap: 2, max: 130 },   // chat rows (RoleBadges)
  md: { fs: 11, ic: 14, ph: 8, pv: 3, br: 8, gap: 4, max: 180 },  // lists, Mod Tools
  lg: { fs: 13, ic: 18, ph: 12, pv: 5, br: 10, gap: 6, max: 240 }, // editor preview
};

export const CustomGlyph = React.memo(({ image, color, size = 14, style }) => (
  <View style={[{
    width: size, height: size, borderRadius: size / 2, backgroundColor: color || '#64748B',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.22)',
  }, style]}>
    {image ? <Image source={image} style={{ width: size * 0.74, height: size * 0.74 }} resizeMode="contain" /> : null}
  </View>
));

const CustomBadgeChip = ({ name, image, color, size = 'sm', style }) => {
  const s = SIZES[size] || SIZES.sm;
  return (
    <View style={[styles.chip, { backgroundColor: color || '#64748B', paddingHorizontal: s.ph, paddingVertical: s.pv, borderRadius: s.br, gap: s.gap, maxWidth: s.max }, style]}>
      {image ? <Image source={image} style={{ width: s.ic, height: s.ic }} resizeMode="contain" /> : null}
      <Text style={[styles.text, { fontSize: s.fs }]} numberOfLines={1}>{name}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center' },
  text: { color: '#fff', fontWeight: '700', flexShrink: 1 },
});

export default React.memo(CustomBadgeChip);
