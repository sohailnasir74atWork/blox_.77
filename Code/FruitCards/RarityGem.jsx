/**
 * RarityGem — the rarity mark on every card, drawn in code (sharp at any size).
 * Each rarity has its own SHAPE as well as colour, so colour-blind players can
 * still tell them apart: Common round, Uncommon square, Rare diamond,
 * Legendary tall rhombus, Mythical eight-point star, Limited star in a ring.
 */

import React, { memo } from 'react';
import { View } from 'react-native';
import { RARITY_STYLE } from './cardConfig';

const facet = (rs) => `linear-gradient(135deg, #FFFFFF 0%, ${rs.light} 22%, ${rs.base} 50%, ${rs.dark} 100%)`;
const sparkle = 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 30%)';

function RarityGem({ rarity, size = 18, glow = false }) {
  const rs = RARITY_STYLE[rarity] || RARITY_STYLE.common;
  const ring = Math.max(1, size * 0.08);
  const shadow = glow ? `0 0 ${size * 0.5}px ${rs.glow}` : `0 ${size * 0.06}px ${size * 0.14}px rgba(0,0,0,0.35)`;
  const fill = { backgroundImage: `${sparkle}, ${facet(rs)}`, borderWidth: ring, borderColor: 'rgba(255,255,255,0.85)', boxShadow: shadow };

  if (rarity === 'mythical' || rarity === 'limited') {
    const ringed = rarity === 'limited';
    const s = size * (ringed ? 0.6 : 0.74);
    const sq = { position: 'absolute', width: s, height: s, left: (size - s) / 2, top: (size - s) / 2, borderRadius: s * 0.12, ...fill };
    return (
      <View style={{ width: size, height: size }}>
        {ringed ? <View style={{ position: 'absolute', width: size, height: size, borderRadius: size, borderWidth: Math.max(1, size * 0.1), borderColor: rs.base, boxShadow: shadow }} /> : null}
        <View style={[sq, { transform: [{ rotate: '45deg' }] }]} />
        <View style={[sq, { boxShadow: undefined }]} />
        <View style={{ position: 'absolute', width: size * 0.3, height: size * 0.3, left: size * 0.35, top: size * 0.35, borderRadius: size, backgroundColor: 'rgba(255,255,255,0.55)' }} />
      </View>
    );
  }
  if (rarity === 'legendary') {
    const s = size * 0.7;
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={[{ width: s, height: s, borderRadius: s * 0.1, transform: [{ scaleX: 0.72 }, { rotate: '45deg' }] }, fill]} />
      </View>
    );
  }
  if (rarity === 'rare') {
    const s = size * 0.72;
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={[{ width: s, height: s, borderRadius: s * 0.14, transform: [{ rotate: '45deg' }] }, fill]} />
      </View>
    );
  }
  if (rarity === 'uncommon') {
    const s = size * 0.8;
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={[{ width: s, height: s, borderRadius: s * 0.22 }, fill]} />
      </View>
    );
  }
  const s = size * 0.84;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[{ width: s, height: s, borderRadius: s }, fill]} />
    </View>
  );
}

export default memo(RarityGem);
