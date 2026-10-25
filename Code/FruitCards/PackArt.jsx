/**
 * PackArt — a sealed booster pack. Uses the painted pack (P-SEA /
 * P-SKINS …) when uploaded; otherwise draws a foil pouch: crimped seals,
 * printed scene, emblem and title band. The title is always real text.
 *
 * `topOffset` / `topRotate` (Animated) let PackOpening tear the top seal off.
 */

import React, { memo } from 'react';
import { View, Text, Image, Animated, StyleSheet } from 'react-native';
import { themeOf } from './cardConfig';
import { assetUri, paintFor } from './cardArt';

const PACK_ASSET = { sea: 'P-SEA', beast: 'P-BEAST', logia: 'P-LOGIA', skins: 'P-SKINS', winter: 'P-WINTER' };
const SCENE = { sea: 'sea_sunset', beast: 'beast_dusk', logia: 'logia_storm', skins: 'vault', winter: 'sea_snow' };
const EMBLEM = { sea: '🍎', beast: '🐉', logia: '⚡', skins: '✨', winter: '❄️' };

function Crimp({ width, color, flip }) {
  const n = 22;
  const s = width / n;
  return (
    <View style={{ flexDirection: 'row', height: s * 0.7, overflow: 'hidden', transform: flip ? [{ scaleY: -1 }] : undefined }}>
      {Array.from({ length: n }).map((_, i) => (
        <View key={i} style={{ width: s, height: s, backgroundColor: color, transform: [{ translateY: s * 0.35 }, { rotate: '45deg' }, { scale: 0.72 }] }} />
      ))}
    </View>
  );
}

function PackArt({ width, theme = 'sea', title, subtitle, topOffset, topRotate, glow }) {
  const th = themeOf(theme);
  const h = width * 1.5;
  const u = width / 100;
  const uri = assetUri(PACK_ASSET[theme] || PACK_ASSET.sea);
  const sealH = h * 0.12;
  const foil = `linear-gradient(120deg, ${th.packA} 0%, ${th.packB} 55%, ${th.packA} 100%)`;
  const sheen = 'linear-gradient(115deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.35) 45%, rgba(255,255,255,0) 60%)';
  const titleBand = !title ? null : (
    <View style={{ position: 'absolute', left: u * 8, right: u * 8, top: h * 0.62, paddingVertical: u * 3, borderRadius: u * 3, backgroundColor: 'rgba(8,6,20,0.62)', alignItems: 'center', borderWidth: Math.max(1, u * 0.5), borderColor: 'rgba(255,255,255,0.35)' }}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: u * 8.5, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.5, paddingHorizontal: u * 3 }}>{title}</Text>
      {subtitle ? <Text style={{ fontSize: u * 4.6, fontWeight: '800', color: th.accent, marginTop: u, letterSpacing: 1.5 }}>{subtitle}</Text> : null}
    </View>
  );

  if (uri) {
    return (
      <View style={{ width, height: h, boxShadow: glow ? `0 0 ${u * 10}px ${glow}` : undefined }}>
        <Image resizeMethod="resize" source={{ uri }} style={{ width, height: h }} resizeMode="contain" />
        {titleBand}
      </View>
    );
  }

  return (
    <View style={{ width, height: h, boxShadow: glow ? `0 0 ${u * 10}px ${glow}` : `0 ${u * 3}px ${u * 8}px rgba(0,0,0,0.45)`, borderRadius: u * 3 }}>
      {/* body */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: sealH * 0.85, bottom: sealH * 0.85, borderRadius: u * 2.5, overflow: 'hidden', backgroundImage: foil }}>
        <View style={{ position: 'absolute', left: u * 5, right: u * 5, top: u * 5, height: h * 0.5, borderRadius: u * 3, overflow: 'hidden', backgroundImage: paintFor(SCENE[theme] || SCENE.sea) }}>
          <View style={[StyleSheet.absoluteFill, { backgroundImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.35) 100%)' }]} />
        </View>
        {/* emblem */}
        <View style={{ position: 'absolute', left: width / 2 - u * 15, top: h * 0.2, width: u * 30, height: u * 30, borderRadius: u * 15, alignItems: 'center', justifyContent: 'center', backgroundImage: `radial-gradient(circle at 50% 40%, #FFFFFF 0%, ${th.accent} 45%, rgba(0,0,0,0) 72%)` }}>
          <Text style={{ fontSize: u * 16 }}>{EMBLEM[theme] || EMBLEM.sea}</Text>
        </View>
        <View style={[StyleSheet.absoluteFill, { backgroundImage: sheen }]} />
      </View>
      {/* top seal (tears off) */}
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: sealH, transform: [{ translateY: topOffset || 0 }, { rotate: topRotate || '0deg' }] }}>
        <View style={{ flex: 1, borderTopLeftRadius: u * 2.5, borderTopRightRadius: u * 2.5, backgroundImage: foil, overflow: 'hidden' }}>
          <View style={[StyleSheet.absoluteFill, { backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 70%)' }]} />
        </View>
        <Crimp width={width} color={th.packA} />
      </Animated.View>
      {/* bottom seal */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: sealH }}>
        <Crimp width={width} color={th.packA} flip />
        <View style={{ flex: 1, borderBottomLeftRadius: u * 2.5, borderBottomRightRadius: u * 2.5, backgroundImage: foil }} />
      </View>
      {titleBand}
    </View>
  );
}

export default memo(PackArt);
