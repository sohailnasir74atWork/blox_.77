/**
 * cardIcons — the tiny Fruit Cards UI icons as images (no emoji glyphs, so they
 * look the same on every phone and keyboard font). Drawn by
 * adoptme-jan7 scripts/pet-cards/make-icons.mjs (copied) at 1x/2x/3x; Metro picks the scale.
 *
 *   <CardIcon name="pin" size={16} />
 */

import React from 'react';
import { Image } from 'react-native';

export const ICONS = {
  pin:    require('../../assets/fruit-cards/icons/pin.png'),      // show on profile
  pinOff: require('../../assets/fruit-cards/icons/pin_off.png'),  // remove from profile
  share:  require('../../assets/fruit-cards/icons/share.png'),
  score:  require('../../assets/fruit-cards/icons/score.png'),    // collector score
  cards:  require('../../assets/fruit-cards/icons/cards.png'),    // Fruit Cards section
};

export default function CardIcon({ name, size = 18, style }) {
  const source = ICONS[name];
  if (!source) return null;
  return <Image resizeMethod="resize" source={source} style={[{ width: size, height: size }, style]} resizeMode="contain" />;
}
