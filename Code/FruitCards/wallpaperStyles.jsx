/**
 * wallpaperStyles.jsx — the Wallpaper Studio designs (adoptme PET_CARDS_PLAN.md §2.7; Blox: FRUIT_CARDS_PLAN.md).
 *
 * Built on what already works in the More tab's wallpapers (the most
 * downloaded ones are one big pet peeking up from the bottom over a themed
 * pattern, top kept clear for the clock) and adds what a static picture
 * can't: the player's own pets, live values and weekly trends.
 *
 * Each style draws the wallpaper at its real size in points:
 *   phone 430×932 (saved 1290×2796) · desktop 1280×720 (saved 3840×2160)
 * Everything is code: gradients, motifs, glows, grids, glass panels. Painted
 * backdrops (WB-*) from the CDN replace the gradient when uploaded
 * (PET_CARDS_ART_PROMPTS.md §11.7).
 */

import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import FruitCard from './FruitCard';
import RarityGem from './RarityGem';
import { RARITY_STYLE } from './cardConfig';
import { paintFor, assetUri, fruitImageUrl } from './cardArt';
import { formatCompact, matchPalette } from './cardMath';

// Value-led styles (poster, board) come last: values are opt-in (CardWallpaper.jsx).
export const WP_STYLES = ['peek', 'squad', 'neon', 'scrapbook', 'pattern', 'cards', 'poster', 'board'];
export const WP_MAX_PETS = { peek: 1, poster: 1, board: 6, squad: 5, neon: 3, scrapbook: 4, pattern: 6, cards: 5 };
export const WP_STYLE_ICON = { peek: '👀', poster: '📊', board: '🏆', squad: '👯', neon: '🌆', scrapbook: '📸', pattern: '🔁', cards: '🃏' };
export const WP_MOTIFS = ['none', 'crystals', 'candy', 'stars', 'hearts', 'bubbles', 'snow', 'paws', 'notes', 'sparkles'];
export const WP_MOTIF_ICON = { none: '⊘', crystals: '💎', candy: '🍬', stars: '⭐', hearts: '💗', bubbles: '🫧', snow: '❄️', paws: '🐾', notes: '🎵', sparkles: '✨' };

// Colour backdrops, light and dark: layered gradients (a soft light source
// over a base), never a flat two-colour fade. `accent` tints glows, motifs
// and titles; `dark` picks white or ink text.
const W = (a) => `radial-gradient(ellipse 70% 42% at ${a}, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 70%)`;
export const WP_GRADIENTS = {
  // ── light ──
  cotton: { tone: 'light', dark: false, accent: '#FF6FB5', css: `${W('20% 15%')}, radial-gradient(ellipse 60% 40% at 85% 80%, rgba(255,182,222,0.7) 0%, rgba(255,182,222,0) 70%), linear-gradient(165deg, #FFD6EC 0%, #E9D9FF 50%, #C7E7FF 100%)` },
  peach: { tone: 'light', dark: false, accent: '#FF6B57', css: 'radial-gradient(circle at 80% 18%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 35%), linear-gradient(170deg, #FFE9DC 0%, #FFC9AE 50%, #FFA294 100%)' },
  mint: { tone: 'light', dark: false, accent: '#16A383', css: `${W('30% 20%')}, linear-gradient(170deg, #F2FFF8 0%, #C9F5E2 50%, #9FE6CF 100%)` },
  lavender: { tone: 'light', dark: false, accent: '#8B5CF6', css: `${W('75% 20%')}, linear-gradient(170deg, #F5F0FF 0%, #DCCBFF 50%, #BFA6F7 100%)` },
  lemonade: { tone: 'light', dark: false, accent: '#E08A00', css: 'radial-gradient(circle at 75% 15%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 30%), linear-gradient(175deg, #FFF9D1 0%, #FFE98A 45%, #A8E6FF 100%)' },
  sky: { tone: 'light', dark: false, accent: '#2E9BF0', css: 'radial-gradient(ellipse 45% 12% at 25% 30%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 70%), radial-gradient(ellipse 50% 14% at 75% 48%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 70%), radial-gradient(ellipse 40% 10% at 35% 70%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 70%), linear-gradient(180deg, #7CC6FF 0%, #B9E2FF 55%, #EAF7FF 100%)' },
  sakura: { tone: 'light', dark: false, accent: '#E0457B', css: `${W('20% 25%')}, linear-gradient(170deg, #FFF3F7 0%, #FFD1E3 55%, #F7A8C8 100%)` },
  honey: { tone: 'light', dark: false, accent: '#C98A00', css: 'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 45%), linear-gradient(170deg, #FFF9EA 0%, #FFE3A3 50%, #F5C25C 100%)' },
  rainbow: { tone: 'light', dark: false, accent: '#FF6FB5', css: `${W('50% 30%')}, linear-gradient(165deg, #FFD1DC 0%, #FFE5B4 20%, #FFF7B3 38%, #C8F7C5 56%, #BDE0FE 74%, #E2C6FF 100%)` },
  cloud: { tone: 'light', dark: false, accent: '#6C8EFF', css: 'radial-gradient(ellipse 80% 35% at 50% 100%, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 70%), radial-gradient(ellipse 50% 12% at 70% 25%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 70%), linear-gradient(180deg, #D6E9FF 0%, #F1F7FF 60%, #FFFFFF 100%)' },
  icecream: { tone: 'light', dark: false, accent: '#FF5C8A', css: `${W('50% 45%')}, linear-gradient(180deg, #FFD3E0 0%, #FFF1D6 50%, #CDF5E4 100%)` },
  sunrise: { tone: 'light', dark: false, accent: '#FF7A59', css: 'radial-gradient(circle at 50% 75%, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 35%), linear-gradient(180deg, #FFD6A5 0%, #FFB4A2 45%, #FFC8DD 100%)' },
  // ── dark ──
  galaxy: { tone: 'dark', dark: true, accent: '#B98BFF', css: 'radial-gradient(ellipse 80% 50% at 30% 30%, rgba(155,93,229,0.55) 0%, rgba(155,93,229,0) 70%), radial-gradient(ellipse 70% 45% at 75% 70%, rgba(0,187,249,0.4) 0%, rgba(0,187,249,0) 70%), linear-gradient(180deg, #0B0423 0%, #1B0F45 55%, #050314 100%)' },
  midnight: { tone: 'dark', dark: true, accent: '#9CB2FF', css: 'radial-gradient(ellipse 60% 35% at 50% 25%, rgba(120,140,255,0.35) 0%, rgba(120,140,255,0) 70%), linear-gradient(180deg, #050816 0%, #141B4D 60%, #0B0F2E 100%)' },
  neon: { tone: 'dark', dark: true, accent: '#FF2BD6', css: 'radial-gradient(ellipse 60% 40% at 20% 20%, rgba(255,43,214,0.45) 0%, rgba(255,43,214,0) 70%), radial-gradient(ellipse 60% 40% at 80% 80%, rgba(34,228,255,0.4) 0%, rgba(34,228,255,0) 70%), linear-gradient(170deg, #12002B 0%, #1E0538 55%, #07001A 100%)' },
  vault: { tone: 'dark', dark: true, accent: '#FFC94A', css: 'radial-gradient(ellipse 60% 40% at 50% 35%, rgba(255,201,74,0.4) 0%, rgba(255,201,74,0) 70%), radial-gradient(ellipse 70% 40% at 20% 85%, rgba(200,140,255,0.3) 0%, rgba(200,140,255,0) 70%), linear-gradient(180deg, #07040F 0%, #1C0F33 50%, #2E1A52 100%)' },
  emerald: { tone: 'dark', dark: true, accent: '#4DFFB0', css: 'radial-gradient(ellipse 60% 40% at 30% 25%, rgba(80,255,180,0.3) 0%, rgba(80,255,180,0) 70%), linear-gradient(170deg, #032B22 0%, #0B4D3B 50%, #021A14 100%)' },
  ruby: { tone: 'dark', dark: true, accent: '#FF5A78', css: 'radial-gradient(ellipse 60% 40% at 70% 25%, rgba(255,90,120,0.4) 0%, rgba(255,90,120,0) 70%), linear-gradient(170deg, #2B0410 0%, #5E0B24 50%, #1A020A 100%)' },
  obsidian: { tone: 'dark', dark: true, accent: '#FFD27A', css: 'radial-gradient(ellipse 55% 35% at 50% 30%, rgba(255,210,100,0.35) 0%, rgba(255,210,100,0) 70%), linear-gradient(180deg, #0B0A08 0%, #1C1710 55%, #0A0805 100%)' },
  ocean: { tone: 'dark', dark: true, accent: '#5FE3FF', css: 'radial-gradient(ellipse 70% 40% at 50% 0%, rgba(120,230,255,0.35) 0%, rgba(120,230,255,0) 70%), linear-gradient(180deg, #053B5E 0%, #062A4A 50%, #020E1F 100%)' },
  aurora: { tone: 'dark', dark: true, accent: '#50FFAA', css: 'radial-gradient(ellipse 80% 25% at 40% 25%, rgba(80,255,170,0.45) 0%, rgba(80,255,170,0) 70%), radial-gradient(ellipse 70% 22% at 65% 35%, rgba(160,100,255,0.4) 0%, rgba(160,100,255,0) 70%), linear-gradient(180deg, #020617 0%, #0B1A33 60%, #050B18 100%)' },
  volcano: { tone: 'dark', dark: true, accent: '#FF7A2E', css: 'radial-gradient(ellipse 70% 35% at 50% 100%, rgba(255,90,20,0.6) 0%, rgba(255,90,20,0) 70%), linear-gradient(180deg, #0A0505 0%, #2A0B06 55%, #4A1205 100%)' },
  royal: { tone: 'dark', dark: true, accent: '#9BD7FF', css: 'radial-gradient(ellipse 60% 40% at 25% 20%, rgba(155,215,255,0.35) 0%, rgba(155,215,255,0) 70%), linear-gradient(170deg, #1B2A6B 0%, #2B1F6B 50%, #120A3A 100%)' },
  cocoa: { tone: 'dark', dark: true, accent: '#FFE2B8', css: 'radial-gradient(ellipse 60% 40% at 50% 25%, rgba(255,226,184,0.3) 0%, rgba(255,226,184,0) 70%), linear-gradient(170deg, #5A3220 0%, #3E2216 55%, #22120B 100%)' },
};
export const WP_LIGHT = Object.keys(WP_GRADIENTS).filter((k) => WP_GRADIENTS[k].tone === 'light');
export const WP_DARK = Object.keys(WP_GRADIENTS).filter((k) => WP_GRADIENTS[k].tone === 'dark');
export const WP_SCENES = ['sea_day', 'sea_sunset', 'sea_island', 'sea_night', 'beast_dusk', 'logia_storm', 'vault', 'sea_snow'];
const SCENE_ACCENT = (id) => (id === 'vault' ? '#FFC94A' : id === 'sea_night' || id === 'logia_storm' ? '#9CB2FF' : '#FFD166');

/** Background descriptor ({ type: 'gradient' | 'scene' | 'match', … }) → { css, image, accent, dark } */
export const resolveBackground = (bg) => {
  // "Match my fruit": colours from the lead fruit (bg.colors, fruitColors.json).
  if (bg?.type === 'match') return { ...matchPalette(bg.colors, bg.tone), image: null };
  if (bg?.type === 'scene') {
    return { css: paintFor(bg.id), image: assetUri(`WB-${bg.id.toUpperCase().replace(/_/g, '-')}`), accent: SCENE_ACCENT(bg.id), dark: true };
  }
  const g = WP_GRADIENTS[bg?.id] || WP_GRADIENTS.cotton;
  return { css: g.css, image: assetUri(`WB-${String(bg?.id || 'cotton').toUpperCase()}`), accent: g.accent, dark: g.dark };
};

// Small deterministic random, so the preview and the saved file match.
const rng = (seed) => {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
};

// ── Shared pieces ──────────────────────────────────────────────────────────

function Backdrop({ bg }) {
  return (
    <>
      <View style={[StyleSheet.absoluteFill, { backgroundImage: bg.css }]} />
      {bg.image ? <Image resizeMethod="resize" source={{ uri: bg.image }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
    </>
  );
}

function PawShape({ size, color, opacity }) {
  const toe = size * 0.22;
  return (
    <View style={{ width: size, height: size, opacity }}>
      {[[0.1, 0.32], [0.3, 0.1], [0.54, 0.1], [0.74, 0.32]].map(([x, y], i) => (
        <View key={i} style={{ position: 'absolute', left: x * size, top: y * size, width: toe, height: toe * 1.2, borderRadius: toe, backgroundColor: color }} />
      ))}
      <View style={{ position: 'absolute', left: size * 0.22, top: size * 0.46, width: size * 0.56, height: size * 0.44, borderRadius: size * 0.24, backgroundColor: color }} />
    </View>
  );
}

function Crystal({ w, h, accent }) {
  const half = w / 2;
  const tri = (style) => <View style={{ width: 0, height: 0, ...style }} />;
  return (
    <View>
      <View style={{ flexDirection: 'row' }}>
        {tri({ borderLeftWidth: half, borderBottomWidth: h * 0.38, borderLeftColor: 'transparent', borderBottomColor: 'rgba(255,255,255,0.92)' })}
        {tri({ borderRightWidth: half, borderBottomWidth: h * 0.38, borderRightColor: 'transparent', borderBottomColor: `${accent}EE` })}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {tri({ borderLeftWidth: half, borderTopWidth: h * 0.62, borderLeftColor: 'transparent', borderTopColor: `${accent}CC` })}
        {tri({ borderRightWidth: half, borderTopWidth: h * 0.62, borderRightColor: 'transparent', borderTopColor: `${accent}77` })}
      </View>
    </View>
  );
}

/** The themed pattern behind the pet (the More-tab wallpapers' signature). */
function Motifs({ kind, w, h, accent, dark, seed = 13, density = 1 }) {
  if (!kind || kind === 'none') return null;
  const r = rng(seed);
  const cols = 4;
  const rows = Math.round((h / w) * cols * 1.1 * density);
  const cell = w / cols;
  const light = dark ? 'rgba(255,255,255,' : 'rgba(255,255,255,';
  const out = [];
  const palette = ['#FF5C8A', '#3BA8FF', '#4CD964', '#FFC93C', '#B455F6', '#FF8A3D'];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (r() < 0.25) continue;
      const x = col * cell + r() * cell * 0.6 + (row % 2 ? cell * 0.3 : 0) - cell * 0.15;
      const y = row * (h / rows) + r() * (h / rows) * 0.5;
      const s = cell * (0.22 + r() * 0.3);
      const rot = Math.round(r() * 60 - 30);
      const k = `${row}-${col}`;
      const a = 0.35 + r() * 0.45;
      if (kind === 'candy') {
        const c = palette[Math.floor(r() * palette.length)];
        out.push(<View key={k} style={{ position: 'absolute', left: x, top: y, width: s, height: s, borderRadius: s, backgroundImage: `radial-gradient(circle at 35% 30%, #FFFFFF 0%, ${c} 22%, ${c} 60%, rgba(0,0,0,0.25) 100%)`, boxShadow: `0 ${s * 0.08}px ${s * 0.2}px rgba(0,0,0,0.2)` }} />);
      } else if (kind === 'crystals') {
        // A faceted gem: four border-triangles, lit top-left, shaded bottom-right.
        const gw = s * 0.62;
        out.push(
          <View key={k} style={{ position: 'absolute', left: x, top: y, opacity: 0.65 + a * 0.35, transform: [{ rotate: `${rot * 0.5}deg` }] }}>
            <Crystal w={gw} h={gw * 2.3} accent={accent} />
          </View>,
        );
      } else if (kind === 'bubbles') {
        out.push(<View key={k} style={{ position: 'absolute', left: x, top: y, width: s, height: s, borderRadius: s, borderWidth: Math.max(1.5, s * 0.06), borderColor: `${light}${a})`, backgroundImage: `radial-gradient(circle at 32% 28%, ${light}0.7) 0%, ${light}0) 30%)` }} />);
      } else if (kind === 'paws') {
        out.push(<View key={k} style={{ position: 'absolute', left: x, top: y, transform: [{ rotate: `${rot}deg` }] }}><PawShape size={s} color={accent} opacity={a} /></View>);
      } else {
        const glyph = { stars: '★', hearts: '♥', snow: '❄', notes: '♪', sparkles: '✦' }[kind] || '✦';
        out.push(<Text key={k} style={{ position: 'absolute', left: x, top: y, fontSize: s * 1.1, color: r() > 0.5 ? accent : `${light}0.9)`, opacity: a, transform: [{ rotate: `${rot}deg` }] }}>{glyph}</Text>);
      }
    }
  }
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>{out}</View>;
}

function Sparkles({ w, h, color = '#FFFFFF', count = 22, seed = 7, top = 0 }) {
  const r = rng(seed);
  const items = [];
  for (let i = 0; i < count; i++) {
    const size = 4 + r() * 12;
    const x = r() * w;
    const y = top + r() * (h - top);
    items.push(r() > 0.5 ? (
      <Text key={i} style={{ position: 'absolute', left: x, top: y, fontSize: size * 1.5, color, opacity: 0.55 + r() * 0.45 }}>✦</Text>
    ) : (
      <View key={i} style={{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size, backgroundImage: `radial-gradient(circle at 50% 50%, ${color} 0%, rgba(255,255,255,0) 70%)` }} />
    ));
  }
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>{items}</View>;
}

/** A pet cut-out (bottom-centre at x,y) with optional glow, outline and floor shadow. */
// Saved files are 3x the layout (1290/430, 3840/1280). The 2048 art used to be
// taken for pets drawn over ~366 pt; one decoded 2048 image is 16 MB and a
// wallpaper holds several, which evicted the Home screen's own images and
// left it stuttering after a visit (2026-10-03). 1024 is the cap now: a pet
// at 400 pt lands at 1200 px in the 4K file, a scale-up nobody will see.
// CDN art when the manifest lists the fruit, else the Values screen icon (cardArt.fruitImageUrl).
const artFor = (p, size) => fruitImageUrl(p, size > 160 ? 1024 : 512);

function Pet({ pet, size, x, y, glow, glowColor, shadow = true, outline = null }) {
  const uri = artFor(pet, size);
  return (
    <View style={{ position: 'absolute', left: x - size / 2, top: y - size, width: size, height: size }}>
      {shadow ? <View style={{ position: 'absolute', left: size * 0.18, width: size * 0.64, bottom: -size * 0.04, height: size * 0.12, backgroundImage: 'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 100%)' }} /> : null}
      {glow ? <Image resizeMethod="resize" source={{ uri }} blurRadius={Math.max(4, Math.round(size / 16))} tintColor={glowColor} style={{ position: 'absolute', left: -size * 0.04, top: -size * 0.04, width: size * 1.08, height: size * 1.08, opacity: 0.9 }} resizeMode="contain" /> : null}
      {outline ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].map(([dx, dy], i) => (
        <Image resizeMethod="resize" key={i} source={{ uri }} tintColor={outline} style={{ position: 'absolute', left: dx * size * 0.012, top: dy * size * 0.012, width: size, height: size }} resizeMode="contain" />
      )) : null}
      <Image resizeMethod="resize" source={{ uri }} style={{ width: size, height: size }} resizeMode="contain" />
    </View>
  );
}

/** ▲ 12% / ▼ 4% pill from the weekly value change. */
function Trend({ pct, size = 14 }) {
  if (pct == null || !Number.isFinite(pct) || pct === 0) return null;
  const up = pct > 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: size * 0.6, paddingVertical: size * 0.2, borderRadius: size, backgroundColor: up ? 'rgba(34,197,94,0.92)' : 'rgba(239,68,68,0.92)' }}>
      <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: size }}>{up ? '▲' : '▼'} {Math.abs(Math.round(pct))}%</Text>
    </View>
  );
}

/** A small sticker-like value tag. */
function ValueTag({ value, pct, size = 14, rotate = 0, light = true }) {
  if (value == null) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.4, paddingHorizontal: size * 0.7, paddingVertical: size * 0.35, borderRadius: size * 0.9, backgroundColor: light ? 'rgba(255,255,255,0.92)' : 'rgba(12,8,28,0.78)', borderWidth: 1.5, borderColor: light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.18)', boxShadow: '0 6px 14px rgba(0,0,0,0.25)', transform: [{ rotate: `${rotate}deg` }] }}>
      <Text style={{ fontSize: size * 0.72, fontWeight: '900', color: light ? '#7A6A95' : 'rgba(255,255,255,0.7)', letterSpacing: 1 }}>VALUE</Text>
      <Text style={{ fontSize: size * 1.15, fontWeight: '900', color: light ? '#2A1840' : '#FFFFFF' }}>{formatCompact(value)}</Text>
      <Trend pct={pct} size={size * 0.7} />
    </View>
  );
}

function Title({ text, sub, w, y, color, accent, size = 34 }) {
  if (!text) return null;
  return (
    <View style={{ position: 'absolute', left: 0, width: w, top: y, alignItems: 'center', paddingHorizontal: 24 }}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: size, fontWeight: '900', color, letterSpacing: size * 0.08, textShadowColor: accent, textShadowRadius: size * 0.35, textShadowOffset: { width: 0, height: 0 } }}>
        {text.toUpperCase()}
      </Text>
      {sub ? <Text style={{ marginTop: 4, fontSize: size * 0.38, fontWeight: '800', color, opacity: 0.85, letterSpacing: 2 }}>{sub}</Text> : null}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

// 1. Peek-a-boo: the More tab's most-downloaded layout, made personal.
function Peek({ F, pets, bg, o, L }) {
  const p = pets[0];
  const phone = F.h > F.w;
  const size = phone ? F.w * 1.18 : F.h * 1.05;
  const cx = phone ? F.w / 2 : F.w * 0.68;
  const rs = RARITY_STYLE[p.rarity] || RARITY_STYLE.common;
  return (
    <>
      <Backdrop bg={bg} />
      <Motifs kind={o.motif} w={F.w} h={F.h} accent={bg.accent} dark={bg.dark} />
      <View style={{ position: 'absolute', left: cx - size * 0.62, top: F.h - size * 0.95, width: size * 1.24, height: size * 1.24, borderRadius: size, backgroundImage: `radial-gradient(circle at 50% 50%, ${bg.dark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.6)'} 0%, rgba(255,255,255,0) 65%)` }} />
      {o.sparkles ? <Sparkles w={F.w} h={F.h} color="#FFFFFF" count={14} top={phone ? F.h * 0.3 : 0} /> : null}
      {/* the pet rises from the bottom edge: only head and shoulders show */}
      <Pet pet={p} size={size} x={cx} y={F.h + size * 0.3} glow={o.glow} glowColor={rs.glow} shadow={false} />
      {o.values && p.values?.r != null ? (
        <View style={{ position: 'absolute', left: phone ? F.w * 0.06 : F.w * 0.08, top: phone ? F.h * 0.36 : F.h * 0.4 }}>
          <ValueTag value={p.values.r} pct={p.trend} size={phone ? 16 : 22} rotate={-6} light={!bg.dark} />
        </View>
      ) : null}
      {o.title ? (
        <Text style={{ position: 'absolute', left: phone ? 0 : F.w * 0.06, width: phone ? F.w : F.w * 0.4, top: phone ? F.h * 0.3 : F.h * 0.22, textAlign: phone ? 'center' : 'left', fontSize: phone ? 30 : 56, fontWeight: '900', color: bg.dark ? '#FFFFFF' : '#2A1840', letterSpacing: 3, textShadowColor: bg.accent, textShadowRadius: 12 }}>
          {p.name.toUpperCase()}
        </Text>
      ) : null}
    </>
  );
}

// 2. Value Poster: a stat poster for one pet.
function Poster({ F, pets, bg, o, L }) {
  const p = pets[0];
  const phone = F.h > F.w;
  const rs = RARITY_STYLE[p.rarity] || RARITY_STYLE.common;
  const size = phone ? F.w * 0.82 : F.h * 0.82;
  const cx = phone ? F.w / 2 : F.w * 0.3;
  const base = phone ? F.h * 0.7 : F.h * 0.9;
  const v = p.values || {};
  const panel = phone
    ? { left: F.w * 0.06, width: F.w * 0.88, top: F.h * 0.71 }
    : { left: F.w * 0.55, width: F.w * 0.39, top: F.h * 0.22 };
  return (
    <>
      <Backdrop bg={bg} />
      <Motifs kind={o.motif} w={F.w} h={F.h} accent={bg.accent} dark={bg.dark} seed={29} density={0.7} />
      <View style={{ position: 'absolute', left: cx - size * 0.7, top: base - size * 1.15, width: size * 1.4, height: size * 1.4, borderRadius: size, backgroundImage: `radial-gradient(circle at 50% 50%, ${rs.glow}AA 0%, ${rs.glow}22 45%, rgba(0,0,0,0) 70%)` }} />
      {o.glow ? Array.from({ length: 12 }).map((_, i) => (
        <View key={i} style={{ position: 'absolute', left: cx - size * 0.02, top: base - size * 1.12, width: size * 0.04, height: size * 1.1, opacity: 0.22, backgroundImage: `linear-gradient(180deg, rgba(255,255,255,0) 0%, ${rs.glow} 50%, rgba(255,255,255,0) 100%)`, transform: [{ rotate: `${i * 15}deg` }] }} />
      )) : null}
      {o.sparkles ? <Sparkles w={F.w} h={F.h} top={phone ? F.h * 0.3 : 0} seed={17} /> : null}
      <Pet pet={p} size={size} x={cx} y={base} glow={o.glow} glowColor={rs.glow} />
      <View style={{ position: 'absolute', ...panel, padding: phone ? 16 : 26, borderRadius: phone ? 24 : 32, backgroundColor: 'rgba(12,8,30,0.62)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.22)', boxShadow: '0 16px 40px rgba(0,0,0,0.35)' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <RarityGem rarity={p.rarity} size={phone ? 22 : 34} glow />
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ flex: 1, fontSize: phone ? 26 : 44, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 }}>{p.name}</Text>
          <Trend pct={p.trend} size={phone ? 13 : 20} />
        </View>
        <Text style={{ color: rs.glow, fontWeight: '900', fontSize: phone ? 12 : 18, letterSpacing: 2, marginTop: 4 }}>{L.rarity(p.rarity).toUpperCase()}</Text>
        <View style={{ flexDirection: 'row', marginTop: phone ? 12 : 20 }}>
          {[['value', v.r], ['perm', v.p], ['demand', v.d]].map(([k, val], i) => (
            <View key={k} style={{ flex: i === 0 ? 1.3 : 1 }}>
              <Text style={{ color: 'rgba(255,255,255,0.65)', fontWeight: '900', fontSize: phone ? 11 : 16, letterSpacing: 1.5 }}>{L.stat(k).toUpperCase()}</Text>
              <Text style={{ color: i === 0 ? rs.glow : '#FFFFFF', fontWeight: '900', fontSize: i === 0 ? (phone ? 34 : 56) : (phone ? 22 : 36) }}>{val == null ? '—' : typeof val === 'string' ? val : formatCompact(val)}</Text>
            </View>
          ))}
        </View>
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: phone ? 10 : 14, fontWeight: '700', marginTop: 8 }}>{L.asOf}</Text>
      </View>
    </>
  );
}

// 3. Top Values board.
function Board({ F, pets, bg, o, L }) {
  const phone = F.h > F.w;
  const list = pets.slice(0, phone ? 6 : 8);
  const medal = ['#FFD23F', '#D9DEE6', '#E3995B'];
  const colW = phone ? F.w * 0.88 : F.w * 0.42;
  const rowH = phone ? 72 : 96;
  const startY = phone ? F.h * 0.31 : F.h * 0.22;
  return (
    <>
      <Backdrop bg={bg} />
      <Motifs kind={o.motif} w={F.w} h={F.h} accent={bg.accent} dark={bg.dark} seed={41} density={0.6} />
      {o.sparkles ? <Sparkles w={F.w} h={F.h} seed={23} count={14} /> : null}
      <Title text={L.boardTitle} sub={L.boardSub} w={F.w} y={phone ? startY - 86 : F.h * 0.04} color={bg.dark ? '#FFFFFF' : '#2A1840'} accent={bg.accent} size={phone ? 34 : 46} />
      {list.map((p, i) => {
        const col = phone ? 0 : Math.floor(i / 4);
        const row = phone ? i : i % 4;
        const left = phone ? (F.w - colW) / 2 : F.w * 0.06 + col * (colW + F.w * 0.04);
        const rs = RARITY_STYLE[p.rarity] || RARITY_STYLE.common;
        return (
          <View key={p.key} style={{ position: 'absolute', left, top: startY + row * (rowH + 10), width: colW, height: rowH, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderRadius: rowH / 2.6, backgroundColor: i < 3 ? 'rgba(14,8,32,0.72)' : 'rgba(14,8,32,0.55)', borderWidth: i < 3 ? 2 : 1.5, borderColor: i < 3 ? medal[i] : 'rgba(255,255,255,0.16)', boxShadow: '0 8px 20px rgba(0,0,0,0.22)' }}>
            <Text style={{ width: rowH * 0.5, textAlign: 'center', fontSize: rowH * 0.36, fontWeight: '900', color: i < 3 ? medal[i] : '#FFFFFF' }}>{i + 1}</Text>
            <View style={{ width: rowH * 0.86, height: rowH * 0.86, borderRadius: rowH, marginHorizontal: 8, backgroundImage: `radial-gradient(circle at 50% 40%, ${rs.glow} 0%, ${rs.base} 55%, ${rs.dark} 100%)`, alignItems: 'center', justifyContent: 'center' }}>
              <Image resizeMethod="resize" source={{ uri: fruitImageUrl(p, 512) }} style={{ width: rowH * 0.8, height: rowH * 0.8 }} resizeMode="contain" />
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: '#FFFFFF', fontWeight: '900', fontSize: rowH * 0.24 }}>{p.name}</Text>
              <Text style={{ color: rs.glow, fontWeight: '800', fontSize: rowH * 0.15, letterSpacing: 1 }}>{L.rarity(p.rarity).toUpperCase()}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: rowH * 0.3 }}>{formatCompact(p.values?.r)}</Text>
              <Trend pct={p.trend} size={rowH * 0.14} />
            </View>
          </View>
        );
      })}
      <Text style={{ position: 'absolute', left: 0, width: F.w, top: phone ? startY + 6 * (rowH + 10) + 6 : F.h * 0.9, textAlign: 'center', color: bg.dark ? 'rgba(255,255,255,0.65)' : 'rgba(42,24,64,0.6)', fontSize: phone ? 11 : 14, fontWeight: '700' }}>{L.asOf}</Text>
    </>
  );
}

// 4. Squad: a group shot.
function Squad({ F, pets, bg, o, L }) {
  const phone = F.h > F.w;
  const n = pets.length;
  const order = [0, -1, 1, -2, 2];
  const big = phone ? F.w * (n <= 2 ? 0.62 : n === 3 ? 0.56 : 0.48) : F.h * (n <= 3 ? 0.62 : 0.56);
  const base = phone ? F.h * 0.78 : F.h * 0.84;
  const gap = phone ? F.w * (n <= 2 ? 0.3 : n === 3 ? 0.28 : 0.18) : F.w * (n <= 3 ? 0.2 : 0.15);
  const ink = bg.dark ? '#FFFFFF' : '#2A1840';
  const placed = pets.map((p, i) => {
    const slot = n === 2 ? (i === 0 ? -0.5 : 0.5) : order[i];
    const depth = Math.abs(slot);
    return { p, slot, depth, size: big * (1 - depth * 0.2), y: base - depth * big * 0.12 };
  }).sort((a, b) => b.depth - a.depth);
  return (
    <>
      <Backdrop bg={bg} />
      <Motifs kind={o.motif} w={F.w} h={F.h} accent={bg.accent} dark={bg.dark} seed={5} density={0.8} />
      <View style={{ position: 'absolute', left: -F.w * 0.1, width: F.w * 1.2, top: base - big * 0.1, height: big * 0.5, backgroundImage: `radial-gradient(ellipse 50% 50% at 50% 50%, ${bg.accent}66 0%, rgba(0,0,0,0) 70%)` }} />
      {o.sparkles ? <Sparkles w={F.w} h={F.h} top={phone ? F.h * 0.3 : 0} seed={11} /> : null}
      {placed.map(({ p, slot, size, y }) => (
        <React.Fragment key={p.key}>
          <Pet pet={p} size={size} x={F.w / 2 + slot * gap} y={y} glow={o.glow} glowColor={(RARITY_STYLE[p.rarity] || RARITY_STYLE.common).glow} />
          {o.values ? (
            <View style={{ position: 'absolute', left: F.w / 2 + slot * gap - 60, width: 120, top: y + 6, alignItems: 'center' }}>
              <ValueTag value={p.values?.r} pct={p.trend} size={phone ? (n >= 4 ? 9.5 : 11) : 15} light={!bg.dark} />
            </View>
          ) : null}
        </React.Fragment>
      ))}
      {o.title ? <Title text={L.squad} sub={L.squadSub} w={F.w} y={phone ? F.h * 0.865 : F.h * 0.05} color={ink} accent={bg.accent} size={phone ? 36 : 48} /> : null}
    </>
  );
}

// 5. Neon: synthwave grid, glowing outlines (a nod to Awakened fruits).
function Neon({ F, pets, o, L }) {
  const phone = F.h > F.w;
  const horizon = phone ? F.h * 0.6 : F.h * 0.58;
  const sunR = phone ? F.w * 0.36 : F.h * 0.3;
  const colors = ['#FF2BD6', '#22E4FF', '#B4FF39'];
  const n = pets.length;
  const size = phone ? F.w * (n === 1 ? 0.8 : n === 2 ? 0.55 : 0.46) : F.h * (n === 1 ? 0.7 : 0.55);
  const gap = phone ? F.w * 0.3 : F.w * 0.24;
  return (
    <>
      <View style={[StyleSheet.absoluteFill, { backgroundImage: 'linear-gradient(180deg, #0A0118 0%, #2B0548 45%, #5B0E6B 60%, #090014 61%, #05000D 100%)' }]} />
      {o.sparkles ? <Sparkles w={F.w} h={horizon} count={40} seed={3} /> : null}
      <View style={{ position: 'absolute', left: F.w / 2 - sunR, top: horizon - sunR * 1.55, width: sunR * 2, height: sunR * 2, borderRadius: sunR, overflow: 'hidden', backgroundImage: 'linear-gradient(180deg, #FFE45E 0%, #FF8A3D 45%, #FF2BD6 100%)', boxShadow: `0 0 ${Math.round(sunR * 0.5)}px #FF2BD6` }}>
        {[0.55, 0.66, 0.76, 0.85, 0.93].map((t, i) => (
          <View key={t} style={{ position: 'absolute', left: 0, right: 0, top: sunR * 2 * t, height: 3 + i * 2.2, backgroundColor: '#2B0548' }} />
        ))}
      </View>
      {/* perspective floor: rays from the vanishing point + lines that crowd toward the horizon */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: horizon, bottom: 0, overflow: 'hidden', backgroundImage: 'linear-gradient(180deg, rgba(255,43,214,0.25) 0%, rgba(5,0,13,0) 60%)' }}>
        {Array.from({ length: 17 }).map((_, i) => {
          const angle = (i - 8) * 9;                 // degrees from straight down
          const len = (F.h - horizon) / Math.cos((Math.abs(angle) * Math.PI) / 180) + 4;
          return (
            <View key={`v${i}`} style={{ position: 'absolute', left: F.w / 2 - 1, top: 0, width: 2, height: len, backgroundColor: '#FF2BD6', opacity: 0.9, transformOrigin: 'top', transform: [{ rotate: `${-angle}deg` }] }} />
          );
        })}
        {Array.from({ length: 9 }).map((_, i) => {
          const t = (i + 1) / 9;
          return <View key={`h${i}`} style={{ position: 'absolute', left: 0, right: 0, top: (F.h - horizon) * t * t, height: 1.5 + t * 1.5, backgroundColor: '#22E4FF', opacity: 0.35 + t * 0.6 }} />;
        })}
      </View>
      <View style={{ position: 'absolute', left: 0, right: 0, top: horizon - 2, height: 3, backgroundColor: '#FFFFFF', boxShadow: '0 0 14px #FF2BD6' }} />
      {pets.map((p, i) => {
        const slot = n === 1 ? 0 : n === 2 ? (i === 0 ? -0.5 : 0.5) : i - 1;
        const x = F.w / 2 + slot * gap;
        const y = horizon + size * (phone ? 0.42 : 0.3);
        return (
          <React.Fragment key={p.key}>
            <Pet pet={p} size={size} x={x} y={y} glow glowColor={colors[i % 3]} outline={o.glow ? colors[i % 3] : null} shadow={false} />
            {o.values && p.values?.r != null ? (
              <Text style={{ position: 'absolute', left: x - 80, width: 160, top: y + 4, textAlign: 'center', fontSize: phone ? 18 : 24, fontWeight: '900', color: '#FFFFFF', textShadowColor: colors[i % 3], textShadowRadius: 10 }}>
                {formatCompact(p.values.r)}
              </Text>
            ) : null}
          </React.Fragment>
        );
      })}
      {o.title ? <Title text={L.neon} w={F.w} y={phone ? F.h * 0.9 : F.h * 0.05} color="#FFFFFF" accent="#FF2BD6" size={phone ? 40 : 52} /> : null}
    </>
  );
}

// 6. Scrapbook: polaroids, tape and stickers.
function Scrapbook({ F, pets, bg, o, L }) {
  const phone = F.h > F.w;
  const n = pets.length;
  const card = phone ? F.w * (n === 1 ? 0.7 : n === 2 ? 0.56 : 0.44) : F.h * (n <= 2 ? 0.6 : n === 3 ? 0.5 : 0.42);
  const lay = phone
    ? [[[0.5, 0.6, -3]], [[0.36, 0.5, -6], [0.64, 0.74, 6]], [[0.3, 0.46, -6], [0.7, 0.55, 7], [0.42, 0.78, -3]], [[0.29, 0.45, -6], [0.71, 0.49, 7], [0.31, 0.75, 5], [0.7, 0.79, -5]]][Math.min(n, 4) - 1]
    : [[[0.5, 0.55, -3]], [[0.36, 0.52, -6], [0.64, 0.55, 5]], [[0.24, 0.52, -6], [0.5, 0.48, 4], [0.76, 0.54, -5]], [[0.17, 0.52, -6], [0.39, 0.48, 5], [0.61, 0.53, -4], [0.83, 0.49, 7]]][Math.min(n, 4) - 1];
  const stickers = ['💖', '⭐', '✨', '🌈', '🐾', '🎀'];
  const r = rng(31);
  return (
    <>
      <Backdrop bg={bg} />
      <Image resizeMethod="resize" source={require('../../assets/fruit-cards/t_paper.webp')} resizeMode="repeat" style={[StyleSheet.absoluteFill, { opacity: 0.8 }]} />
      <Motifs kind={o.motif} w={F.w} h={F.h} accent={bg.accent} dark={bg.dark} seed={37} density={0.6} />
      {pets.map((p, i) => {
        const [fx, fy, rot] = lay[i % lay.length];  // centre of the photo
        const w = card;
        return (
          <View key={p.key} style={{ position: 'absolute', left: F.w * fx - w / 2, top: F.h * fy - w * 0.55, width: w, padding: w * 0.05, paddingBottom: w * 0.2, backgroundColor: '#FFFDF8', borderRadius: 4, boxShadow: '0 10px 24px rgba(0,0,0,0.28)', transform: [{ rotate: `${rot}deg` }] }}>
            <View style={{ width: w * 0.9, height: w * 0.9, overflow: 'hidden', backgroundImage: paintFor(p.bgId || 'sea_day') }}>
              <Image resizeMethod="resize" source={{ uri: artFor(p, w * 0.78) }} style={{ position: 'absolute', left: w * 0.06, top: w * 0.08, width: w * 0.78, height: w * 0.78 }} resizeMode="contain" />
            </View>
            <Text numberOfLines={1} style={{ position: 'absolute', left: 0, right: 0, bottom: w * 0.05, textAlign: 'center', fontSize: w * 0.072, fontWeight: '800', fontStyle: 'italic', color: '#3B2A4A' }}>
              {p.name}{o.values && p.values?.r != null ? `  ·  ${formatCompact(p.values.r)}` : ''}
            </Text>
            <View style={{ position: 'absolute', left: w * 0.32, top: -w * 0.05, width: w * 0.36, height: w * 0.1, backgroundImage: `linear-gradient(90deg, ${bg.accent}BB 0%, ${bg.accent}77 100%)`, transform: [{ rotate: `${-rot * 1.5}deg` }] }} />
          </View>
        );
      })}
      {o.sparkles ? stickers.map((s) => (
        <Text key={s} style={{ position: 'absolute', left: F.w * (0.05 + r() * 0.8), top: (phone ? F.h * 0.32 : F.h * 0.1) + r() * F.h * 0.55, fontSize: phone ? 34 : 40, transform: [{ rotate: `${Math.round(r() * 40 - 20)}deg` }] }}>{s}</Text>
      )) : null}
      {o.title ? <Title text={L.squad} w={F.w} y={phone ? F.h * 0.9 : F.h * 0.06} color="#3B2A4A" accent="#FFFFFF" size={phone ? 30 : 40} /> : null}
    </>
  );
}

// 7. Pattern: the pets themselves as the pattern, hero in a badge.
function Pattern({ F, pets, bg, o }) {
  const phone = F.h > F.w;
  const cell = phone ? F.w / 3.2 : F.h / 3.4;
  const cols = Math.ceil(F.w / cell) + 2;
  const rows = Math.ceil(F.h / cell) + 2;
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = pets[(r * 3 + c) % pets.length];
      tiles.push(
        <Image resizeMethod="resize" key={`${r}-${c}`} source={{ uri: fruitImageUrl(p, 512) }} resizeMode="contain"
          style={{ position: 'absolute', width: cell * 0.78, height: cell * 0.78, left: c * cell - (r % 2 ? cell / 2 : 0) - cell * 0.4, top: r * cell * 0.92 - cell * 0.4, transform: [{ rotate: `${(r + c) % 2 ? -14 : 12}deg` }] }} />,
      );
    }
  }
  const hero = pets[0];
  const ring = phone ? F.w * 0.62 : F.h * 0.6;
  return (
    <>
      <Backdrop bg={bg} />
      {tiles}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: bg.dark ? 'rgba(10,6,25,0.25)' : 'rgba(255,255,255,0.18)' }]} />
      {o.title ? (
        <View style={{ position: 'absolute', left: F.w / 2 - ring / 2, top: phone ? F.h * 0.55 - ring / 2 : F.h / 2 - ring / 2, width: ring, height: ring, borderRadius: ring, borderWidth: 6, borderColor: '#FFFFFF', backgroundImage: bg.css, alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 30px ${bg.accent}` }}>
          <Image resizeMethod="resize" source={{ uri: artFor(hero, ring * 0.82) }} style={{ width: ring * 0.82, height: ring * 0.82 }} resizeMode="contain" />
        </View>
      ) : null}
      {o.sparkles ? <Sparkles w={F.w} h={F.h} count={18} seed={21} /> : null}
    </>
  );
}

// 8. Card Fan: the cards themselves.
function Cards({ F, pets, bg, o, L }) {
  const phone = F.h > F.w;
  const n = pets.length;
  const cardW = phone ? (n === 1 ? 250 : n === 2 ? 178 : n === 3 ? 152 : 128) : (n === 1 ? 300 : n <= 3 ? 230 : 190);
  const spread = phone ? cardW * 0.62 : cardW * 0.92;
  const centerY = phone ? F.h * 0.6 : F.h * 0.52;
  return (
    <>
      <Backdrop bg={bg} />
      <Motifs kind={o.motif} w={F.w} h={F.h} accent={bg.accent} dark={bg.dark} seed={19} density={0.7} />
      {o.glow ? Array.from({ length: 12 }).map((_, i) => (
        <View key={i} style={{ position: 'absolute', left: F.w / 2 - 12, top: centerY - F.h * 0.45, width: 24, height: F.h * 0.9, opacity: 0.18, backgroundImage: `linear-gradient(180deg, rgba(255,255,255,0) 0%, ${bg.accent} 50%, rgba(255,255,255,0) 100%)`, transform: [{ rotate: `${i * 15}deg` }] }} />
      )) : null}
      {o.sparkles ? <Sparkles w={F.w} h={F.h} seed={9} top={phone ? F.h * 0.3 : 0} /> : null}
      {pets.map((p, i) => {
        const off = i - (n - 1) / 2;
        return (
          <View key={p.key} style={{ position: 'absolute', left: F.w / 2 - cardW / 2 + off * spread, top: centerY - (cardW * 1.4) / 2 + Math.abs(off) * cardW * 0.08, transform: [{ rotate: `${off * (phone ? 9 : 5)}deg` }], zIndex: 10 - Math.abs(Math.round(off)) }}>
            <FruitCard card={p} finish={p.finish} serial={p.serial} width={cardW} total={L.total} />
          </View>
        );
      })}
      {o.title ? <Title text={L.squad} w={F.w} y={phone ? F.h * 0.88 : F.h * 0.05} color={bg.dark ? '#FFFFFF' : '#2A1840'} accent={bg.accent} size={phone ? 28 : 40} /> : null}
    </>
  );
}

const RENDER = { peek: Peek, poster: Poster, board: Board, squad: Squad, neon: Neon, scrapbook: Scrapbook, pattern: Pattern, cards: Cards };

/**
 * The whole wallpaper.
 * pets: [{ key, name, rarity, finish, serial, values: {r,p,d}, trend, bgId }] (fruits; the name is Pet Cards')
 * L: labels { rarity(r), stat(k), squad, squadSub, neon, boardTitle, boardSub, asOf, total, watermark }
 */
export function WallpaperArt({ style, F, pets, background, options, labels }) {
  const Comp = RENDER[style] || Peek;
  const bg = resolveBackground(background);
  return (
    <>
      {pets.length ? <Comp F={F} pets={pets} bg={bg} o={options} L={labels} /> : <Backdrop bg={bg} />}
      {options.watermark ? (
        <Text style={{ position: 'absolute', left: 0, width: F.w, bottom: F.h * 0.022, textAlign: 'center', fontSize: F.h > F.w ? 10 : 13, fontWeight: '800', letterSpacing: 1.5, color: style === 'neon' || bg.dark ? 'rgba(255,255,255,0.55)' : 'rgba(30,20,50,0.45)' }}>
          {labels.watermark}
        </Text>
      ) : null}
    </>
  );
}
