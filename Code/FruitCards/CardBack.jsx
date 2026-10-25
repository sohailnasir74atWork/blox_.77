/**
 * CardBack — the back of a card. Uses the painted back from the CDN
 * (CB-STANDARD / CB-SKINS…) when it exists; otherwise a designed back drawn
 * in code: lacquered field, inset gold lines and a Devil Fruit crest.
 */

import React, { memo } from 'react';
import { View, Image } from 'react-native';
import { assetUri } from './cardArt';

const BACKS = {
  sea:     { asset: 'CB-STANDARD', field: ['#04142B', '#0B3A66', '#03101F'], gold: '#E9C46A', dot: 'rgba(233,196,106,0.10)' },
  skins:   { asset: 'CB-SKINS', field: ['#12061F', '#2E1A52', '#0C0618'], gold: '#FFC94A', dot: 'rgba(255,201,74,0.10)' },
  gold:    { asset: 'CB-GOLD', field: ['#B8860B', '#F7D774', '#A16207'], gold: '#FFF7D6', dot: 'rgba(255,255,255,0.12)' },
  pro:     { asset: 'CB-PRO', field: ['#05060A', '#1B2233', '#05060A'], gold: '#7DE3F5', dot: 'rgba(125,227,245,0.10)' },
};

/** A Devil Fruit: round body with swirl rings, a stem and a leaf. */
function Fruit({ size, color }) {
  const body = size * 0.78;
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: 'absolute', left: (size - body) / 2, top: size - body, width: body, height: body, borderRadius: body, borderWidth: Math.max(1, size * 0.07), borderColor: color }}>
        <View style={{ position: 'absolute', left: body * 0.18, top: body * 0.2, width: body * 0.5, height: body * 0.5, borderRadius: body, borderWidth: Math.max(1, size * 0.05), borderColor: color, opacity: 0.8 }} />
        <View style={{ position: 'absolute', left: body * 0.36, top: body * 0.36, width: body * 0.24, height: body * 0.24, borderRadius: body, backgroundColor: color, opacity: 0.8 }} />
      </View>
      <View style={{ position: 'absolute', left: size * 0.47, top: size * 0.02, width: size * 0.07, height: size * 0.24, borderRadius: size, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: size * 0.52, top: size * 0.04, width: size * 0.3, height: size * 0.14, borderRadius: size, backgroundColor: color, transform: [{ rotate: '-24deg' }] }} />
    </View>
  );
}

function CardBack({ width, theme = 'sea', glow = null }) {
  const b = BACKS[theme] || BACKS.sea;
  const h = width * 1.4;
  const u = width / 100;
  const uri = assetUri(b.asset);
  const crest = width * 0.42;
  return (
    <View
      style={{
        width, height: h, borderRadius: u * 4.6, overflow: 'hidden',
        backgroundImage: `radial-gradient(circle at 50% 50%, ${b.field[1]} 0%, ${b.field[0]} 55%, ${b.field[2]} 100%)`,
        boxShadow: glow ? `0 0 ${u * 9}px ${glow}` : `0 ${u * 1.5}px ${u * 4}px rgba(0,0,0,0.35)`,
      }}
    >
      {uri ? (
        <Image resizeMethod="resize" source={{ uri }} style={{ position: 'absolute', width, height: h }} resizeMode="cover" />
      ) : (
        <>
          <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundImage: `radial-gradient(circle at 20% 15%, ${b.dot} 0%, rgba(0,0,0,0) 30%), radial-gradient(circle at 80% 85%, ${b.dot} 0%, rgba(0,0,0,0) 30%)` }} />
          <View style={{ position: 'absolute', left: u * 4.5, top: u * 4.5, right: u * 4.5, bottom: u * 4.5, borderRadius: u * 3, borderWidth: Math.max(1, u * 0.7), borderColor: b.gold }} />
          <View style={{ position: 'absolute', left: u * 7, top: u * 7, right: u * 7, bottom: u * 7, borderRadius: u * 2, borderWidth: Math.max(0.5, u * 0.3), borderColor: b.gold, opacity: 0.6 }} />
          <View style={{ position: 'absolute', left: (width - crest) / 2, top: (h - crest) / 2, width: crest, height: crest, borderRadius: crest, borderWidth: Math.max(1, u * 0.9), borderColor: b.gold, alignItems: 'center', justifyContent: 'center', backgroundImage: `radial-gradient(circle at 50% 40%, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 70%)` }}>
            <View style={{ position: 'absolute', width: crest * 0.84, height: crest * 0.84, borderRadius: crest, borderWidth: Math.max(0.5, u * 0.3), borderColor: b.gold, opacity: 0.7 }} />
            <Fruit size={crest * 0.5} color={b.gold} />
          </View>
        </>
      )}
      {/* sheen */}
      <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundImage: 'linear-gradient(125deg, rgba(255,255,255,0) 35%, rgba(255,255,255,0.16) 50%, rgba(255,255,255,0) 65%)' }} />
    </View>
  );
}

export default memo(CardBack);
