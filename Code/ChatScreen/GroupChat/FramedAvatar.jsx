import { getThemeColors } from '../../Helper/themeColors';
/**
 * FramedAvatar.jsx — Premium Ornamental Profile Frames
 *
 * Each frame has unique SVG artwork: crowns, wings, gems, sparkles,
 * flames, ribbons. Thick gradient-filled borders with dark outlines.
 *
 * Tiers:
 *   Common    → Simple gradient ring
 *   Uncommon  → Gradient ring + sparkle accents
 *   Rare      → Thick ornate border + gem mounts + Lottie
 *   Legendary → Crown/wing decorations + gems + triple ring + Lottie
 *   Exclusive → Full ornamental frame + all effects + Lottie
 */

import React, { useMemo } from 'react';
import { View, Image } from 'react-native';
import Svg, {
  Path,
  Circle as SvgCircle,
  Defs,
  ClipPath,
  Image as SvgImage,
  RadialGradient,
  LinearGradient,
  Stop,
  G,
} from 'react-native-svg';
// ════════════════════════════════════════════════════════════
//  DECORATIVE SVG ELEMENT GENERATORS
//  These create the actual artwork that makes frames look premium
// ════════════════════════════════════════════════════════════

/**
 * Crown decoration — sits on top of the avatar
 * Returns SVG path data for a 3 or 5-pointed crown
 */
const drawCrown = (cx, topY, width, height, points = 3) => {
  const hw = width / 2;
  const baseY = topY + height;
  const peakH = height * 0.9;

  if (points === 5) {
    // 5-pointed ornate crown
    const spacing = width / 4;
    return `M ${cx - hw} ${baseY}
      L ${cx - hw} ${topY + height * 0.5}
      L ${cx - hw + spacing * 0.5} ${topY + peakH * 0.45}
      L ${cx - hw + spacing} ${topY + peakH * 0.7}
      L ${cx - hw + spacing * 1.5} ${topY}
      L ${cx} ${topY + peakH * 0.55}
      L ${cx + hw - spacing * 1.5} ${topY}
      L ${cx + hw - spacing} ${topY + peakH * 0.7}
      L ${cx + hw - spacing * 0.5} ${topY + peakH * 0.45}
      L ${cx + hw} ${topY + height * 0.5}
      L ${cx + hw} ${baseY} Z`;
  }
  // 3-pointed crown
  return `M ${cx - hw} ${baseY}
    L ${cx - hw} ${topY + height * 0.45}
    L ${cx - hw * 0.5} ${topY}
    L ${cx} ${topY + height * 0.4}
    L ${cx + hw * 0.5} ${topY}
    L ${cx + hw} ${topY + height * 0.45}
    L ${cx + hw} ${baseY} Z`;
};

/**
 * Wing decoration — sits on left or right side
 * side: -1 for left, 1 for right
 */
const drawWing = (cx, cy, size, side = 1) => {
  const s = size;
  const x = cx + side * s * 0.1;
  return `M ${x} ${cy}
    Q ${x + side * s * 0.5} ${cy - s * 0.6} ${x + side * s * 0.95} ${cy - s * 0.35}
    Q ${x + side * s * 0.7} ${cy - s * 0.15} ${x + side * s * 0.6} ${cy + s * 0.05}
    Q ${x + side * s * 0.65} ${cy + s * 0.3} ${x + side * s * 0.85} ${cy + s * 0.55}
    Q ${x + side * s * 0.5} ${cy + s * 0.35} ${x} ${cy + s * 0.15} Z`;
};

/**
 * Diamond gem shape — filled gem with highlight
 */
const drawGem = (cx, cy, size) => {
  const s = size;
  return `M ${cx} ${cy - s}
    L ${cx + s * 0.7} ${cy}
    L ${cx} ${cy + s}
    L ${cx - s * 0.7} ${cy} Z`;
};

/**
 * 4-pointed sparkle star
 */
const drawSparkle = (cx, cy, outerR, innerR) => {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`;
};

/**
 * Flame lick — single flame shape
 */
const drawFlame = (cx, bottomY, width, height, lean = 0) => {
  const hw = width / 2;
  const topY = bottomY - height;
  return `M ${cx - hw} ${bottomY}
    Q ${cx - hw * 0.3 + lean} ${topY + height * 0.4} ${cx + lean * 0.5} ${topY}
    Q ${cx + hw * 0.3 + lean} ${topY + height * 0.4} ${cx + hw} ${bottomY} Z`;
};

/**
 * Small ribbon/banner at bottom
 */
const drawRibbon = (cx, cy, width, height) => {
  const hw = width / 2;
  const hh = height / 2;
  return `M ${cx - hw * 1.3} ${cy - hh}
    L ${cx - hw} ${cy}
    L ${cx - hw * 1.3} ${cy + hh}
    L ${cx - hw * 0.3} ${cy + hh * 0.6}
    L ${cx} ${cy + hh}
    L ${cx + hw * 0.3} ${cy + hh * 0.6}
    L ${cx + hw * 1.3} ${cy + hh}
    L ${cx + hw} ${cy}
    L ${cx + hw * 1.3} ${cy - hh} Z`;
};

/**
 * Scalloped/ornate circle border (wavy edge)
 */
const scallopedCirclePath = (cx, cy, r, scallops = 16, depth = 0.08) => {
  let d = '';
  const step = (Math.PI * 2) / scallops;
  for (let i = 0; i < scallops; i++) {
    const a1 = i * step;
    const a2 = (i + 1) * step;
    const aMid = (a1 + a2) / 2;
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const cpx = cx + r * (1 + depth) * Math.cos(aMid);
    const cpy = cy + r * (1 + depth) * Math.sin(aMid);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    if (i === 0) d += `M ${x1.toFixed(2)} ${y1.toFixed(2)} `;
    d += `Q ${cpx.toFixed(2)} ${cpy.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)} `;
  }
  d += 'Z';
  return d;
};

// ════════════════════════════════════════════════════════════
//  FRAME DEFINITIONS — decoration configs per frame
// ════════════════════════════════════════════════════════════
const FRAME_DEFS = {
  // ═══ COMMON — simple solid ring ═══
  magma_ring:       { borderWidth: 2.2, gap: 1.2, decorations: [] },
  sea_blue_ring:    { borderWidth: 2.2, gap: 1.2, decorations: [] },
  venom_ring:       { borderWidth: 2.2, gap: 1.2, decorations: [] },
  dark_energy_ring: { borderWidth: 2.2, gap: 1.2, decorations: [] },
  lightning_ring:   { borderWidth: 2.2, gap: 1.2, decorations: [] },
  flame_ring:       { borderWidth: 2.2, gap: 1.2, decorations: [] },

  // ═══ UNCOMMON — sparkle/flame accents, thin ring ═══
  devil_fruit_glow: {
    borderWidth: 2.2,
    gap: 1.2,
    glowOpacity: 0.15,
    decorScale: 0.8,
    decorations: ['sparkles', 'flames'],
    scalloped: false,
  },
  ice_admiral: {
    borderWidth: 2.2,
    gap: 1.2,
    glowOpacity: 0.15,
    decorScale: 0.8,
    decorations: ['sparkles'],
    scalloped: true,
  },
  tidal_surge: {
    borderWidth: 2.2,
    gap: 1.2,
    glowOpacity: 0.15,
    decorScale: 0.8,
    decorations: ['sparkles'],
    scalloped: true,
  },
  shadow_blade: {
    borderWidth: 2.2,
    gap: 1.2,
    glowOpacity: 0.2,
    decorScale: 0.85,
    decorations: ['sparkles', 'flames'],
  },
  haki_aura: {
    borderWidth: 2.2,
    gap: 1.2,
    glowOpacity: 0.15,
    decorScale: 0.8,
    decorations: ['sparkles'],
    scalloped: false,
  },

  // ═══ RARE — slim border, gems, tight double ring ═══
  dragon_scale: {
    borderWidth: 2.5,
    gap: 1.5,
    glowOpacity: 0.4,
    decorScale: 1.2,
    decorations: ['gems', 'sparkles'],
    scalloped: true,
    doubleBorder: true,
    doubleBorderWidth: 1,
  },
  phoenix_flame: {
    borderWidth: 2.5,
    gap: 1.5,
    glowOpacity: 0.45,
    decorScale: 1.2,
    decorations: ['gems', 'sparkles', 'flames'],
    doubleBorder: true,
    doubleBorderWidth: 1,
  },
  spirit_sword: {
    borderWidth: 2.5,
    gap: 1.5,
    glowOpacity: 0.4,
    decorScale: 1.15,
    decorations: ['gems', 'sparkles'],
    scalloped: true,
    doubleBorder: true,
    doubleBorderWidth: 1,
  },
  rumble_storm: {
    borderWidth: 2.5,
    gap: 1.5,
    glowOpacity: 0.4,
    decorScale: 1.15,
    decorations: ['gems', 'sparkles'],
    scalloped: true,
    doubleBorder: true,
    doubleBorderWidth: 1,
  },

  // ═══ LEGENDARY — crowns/flames, compact triple ring, strong glow ═══
  awakened_aura: {
    borderWidth: 3,
    gap: 1.8,
    glowOpacity: 0.65,
    decorScale: 1.6,
    decorations: ['crown5', 'gems', 'sparkles', 'flames'],
    doubleBorder: true,
    doubleBorderWidth: 1.2,
    tripleBorder: true,
    tripleBorderWidth: 0.7,
  },
  pirate_king: {
    borderWidth: 3,
    gap: 1.8,
    glowOpacity: 0.65,
    decorScale: 1.6,
    decorations: ['crown5', 'gems', 'sparkles', 'ribbon'],
    doubleBorder: true,
    doubleBorderWidth: 1.2,
    tripleBorder: true,
    tripleBorderWidth: 0.7,
  },
  sea_emperor: {
    borderWidth: 3.2,
    gap: 2,
    glowOpacity: 0.7,
    decorScale: 1.7,
    decorations: ['crown5', 'gems', 'sparkles', 'ribbon'],
    doubleBorder: true,
    doubleBorderWidth: 1.3,
    tripleBorder: true,
    tripleBorderWidth: 0.7,
    scalloped: true,
  },
  fruit_master: {
    borderWidth: 3,
    gap: 1.8,
    glowOpacity: 0.65,
    decorScale: 1.6,
    decorations: ['sparkles', 'gems', 'flames'],
    doubleBorder: true,
    doubleBorderWidth: 1.2,
    tripleBorder: true,
    tripleBorderWidth: 0.7,
  },

  // ═══ EXCLUSIVE — max decorations, compact rings ═══
  legendary_awakening: {
    borderWidth: 3.5,
    gap: 2,
    glowOpacity: 0.85,
    decorScale: 2.0,
    decorations: ['crown5', 'gems', 'sparkles', 'flames'],
    doubleBorder: true,
    doubleBorderWidth: 1.4,
    tripleBorder: true,
    tripleBorderWidth: 0.8,
  },
  void_dragon: {
    borderWidth: 3.5,
    gap: 2,
    glowOpacity: 0.85,
    decorScale: 2.0,
    decorations: ['crown5', 'gems', 'sparkles', 'flames', 'ribbon'],
    doubleBorder: true,
    doubleBorderWidth: 1.4,
    tripleBorder: true,
    tripleBorderWidth: 0.8,
    scalloped: true,
  },
  mythic_aura: {
    borderWidth: 3.5,
    gap: 2,
    glowOpacity: 0.85,
    decorScale: 2.0,
    decorations: ['crown5', 'gems', 'sparkles', 'flames'],
    doubleBorder: true,
    doubleBorderWidth: 1.4,
    tripleBorder: true,
    tripleBorderWidth: 0.8,
  },

  // ═══ LEVEL REWARD FRAMES ═══
  bounty_hunter: {
    borderWidth: 3,
    gap: 1.8,
    glowOpacity: 0.65,
    decorScale: 1.6,
    decorations: ['sparkles', 'gems', 'flames'],
    doubleBorder: true,
    doubleBorderWidth: 1.2,
    tripleBorder: true,
    tripleBorderWidth: 0.7,
  },
  trade_pirate: {
    borderWidth: 3,
    gap: 1.8,
    glowOpacity: 0.65,
    decorScale: 1.6,
    decorations: ['gems', 'sparkles', 'ribbon'],
    doubleBorder: true,
    doubleBorderWidth: 1.2,
    tripleBorder: true,
    tripleBorderWidth: 0.7,
    scalloped: true,
  },
  sea_legend: {
    borderWidth: 3.5,
    gap: 2,
    glowOpacity: 0.85,
    decorScale: 2.0,
    decorations: ['crown5', 'gems', 'sparkles', 'flames'],
    doubleBorder: true,
    doubleBorderWidth: 1.4,
    tripleBorder: true,
    tripleBorderWidth: 0.8,
  },
};

const DEFAULT_DEF = {
  borderWidth: 2, gap: 1, decorations: [],
};

// Unique ID counter
let _framedAvatarIdCounter = 0;

// ════════════════════════════════════════════════════════════
//  RENDER DECORATIONS — the core of the premium look
// ════════════════════════════════════════════════════════════
const renderDecorations = ({
  decorations, cx, cy, avatarR, borderR, colors, gradId, isDark, scale, decorScale = 1,
}) => {
  if (!decorations || decorations.length === 0) return null;
  const elements = [];
  const primary = colors[0] || '#94a3b8';
  const secondary = colors[1] || primary;
  // Scale factor: avatar size * tier decoration multiplier
  const sf = Math.max(0.5, scale) * decorScale;

  decorations.forEach((dec) => {
    switch (dec) {
      // ── CROWN (3 points) ──
      case 'crown3': {
        const crownW = avatarR * 1.0 * sf;
        const crownH = avatarR * 0.45 * sf;
        const crownTop = cy - borderR - crownH * 0.6;
        const crownPath = drawCrown(cx, crownTop, crownW, crownH, 3);
        elements.push(
          <G key="crown3">
            {/* Crown shadow */}
            <Path d={crownPath} fill={primary} opacity={0.2}
              transform={`translate(0, ${1.5 * sf})`} />
            {/* Crown body */}
            <Path d={crownPath} fill={`url(#${gradId})`}
              stroke={isDark ? '#0f172a' : '#1e293b'} strokeWidth={1.2 * sf}
              strokeLinejoin="round" />
            {/* Crown highlight */}
            <Path d={crownPath} fill="#ffffff" opacity={0.15} />
            {/* Crown tip gems */}
            {[-0.5, 0.5].map((offset, i) => {
              const tipX = cx + offset * crownW * 0.5;
              const tipY = crownTop + 1 * sf;
              return (
                <G key={`ct-${i}`}>
                  <SvgCircle cx={tipX} cy={tipY} r={1.8 * sf} fill="#ffffff" opacity={0.9} />
                  <SvgCircle cx={tipX} cy={tipY} r={1.0 * sf} fill={primary} opacity={0.8} />
                </G>
              );
            })}
            {/* Center gem */}
            <SvgCircle cx={cx} cy={crownTop + crownH * 0.38} r={2 * sf}
              fill={secondary} stroke="#ffffff" strokeWidth={0.5 * sf} />
          </G>
        );
        break;
      }

      // ── CROWN (5 points) ──
      case 'crown5': {
        const crownW = avatarR * 1.2 * sf;
        const crownH = avatarR * 0.55 * sf;
        const crownTop = cy - borderR - crownH * 0.5;
        const crownPath = drawCrown(cx, crownTop, crownW, crownH, 5);
        elements.push(
          <G key="crown5">
            {/* Shadow */}
            <Path d={crownPath} fill={primary} opacity={0.15}
              transform={`translate(0, ${2 * sf})`} />
            {/* Body */}
            <Path d={crownPath} fill={`url(#${gradId})`}
              stroke={isDark ? '#0f172a' : '#1e293b'} strokeWidth={1.3 * sf}
              strokeLinejoin="round" />
            {/* Highlight sheen */}
            <Path d={crownPath} fill="#ffffff" opacity={0.12} />
            {/* 5 tip gems */}
            {[-1.5, -0.5, 0, 0.5, 1.5].map((offset, i) => {
              const tipX = cx + offset * crownW * 0.27;
              const tipY = crownTop + (i === 2 ? crownH * 0.5 : (Math.abs(offset) > 1 ? crownH * 0.4 : 0));
              const gemR = (i === 2 ? 2.2 : 1.6) * sf;
              return (
                <G key={`ct5-${i}`}>
                  <SvgCircle cx={tipX} cy={tipY} r={gemR + 1 * sf}
                    fill={colors[i % colors.length]} opacity={0.3} />
                  <SvgCircle cx={tipX} cy={tipY} r={gemR}
                    fill={colors[i % colors.length]}
                    stroke="#ffffff" strokeWidth={0.4 * sf} />
                  <SvgCircle cx={tipX - 0.4 * sf} cy={tipY - 0.5 * sf} r={gemR * 0.35}
                    fill="#ffffff" opacity={0.7} />
                </G>
              );
            })}
          </G>
        );
        break;
      }

      // ── WINGS ──
      case 'wings': {
        const wingSize = avatarR * 0.7 * sf;
        const leftWing = drawWing(cx - borderR * 0.85, cy - avatarR * 0.1, wingSize, -1);
        const rightWing = drawWing(cx + borderR * 0.85, cy - avatarR * 0.1, wingSize, 1);
        elements.push(
          <G key="wings">
            {/* Wing shadows */}
            <Path d={leftWing} fill={primary} opacity={0.15}
              transform={`translate(${-1 * sf}, ${1.5 * sf})`} />
            <Path d={rightWing} fill={primary} opacity={0.15}
              transform={`translate(${1 * sf}, ${1.5 * sf})`} />
            {/* Wing bodies */}
            <Path d={leftWing} fill={`url(#${gradId})`}
              stroke={isDark ? '#0f172a' : '#1e293b'} strokeWidth={1 * sf}
              strokeLinejoin="round" opacity={0.85} />
            <Path d={rightWing} fill={`url(#${gradId})`}
              stroke={isDark ? '#0f172a' : '#1e293b'} strokeWidth={1 * sf}
              strokeLinejoin="round" opacity={0.85} />
            {/* Wing highlights */}
            <Path d={leftWing} fill="#ffffff" opacity={0.1} />
            <Path d={rightWing} fill="#ffffff" opacity={0.1} />
          </G>
        );
        break;
      }

      // ── GEMS (4 cardinal gem mounts) ──
      case 'gems': {
        const gemSize = Math.max(2.5, avatarR * 0.12) * sf;
        const gemR = borderR + 1 * sf;
        const positions = [
          { x: cx, y: cy - gemR, angle: 0 },         // top
          { x: cx + gemR, y: cy, angle: 90 },         // right
          { x: cx, y: cy + gemR, angle: 180 },        // bottom
          { x: cx - gemR, y: cy, angle: 270 },        // left
        ];
        elements.push(
          <G key="gems">
            {positions.map((pos, i) => {
              const gemPath = drawGem(pos.x, pos.y, gemSize);
              const gemColor = colors[i % colors.length];
              return (
                <G key={`gem-${i}`}>
                  {/* Gem glow */}
                  <SvgCircle cx={pos.x} cy={pos.y} r={gemSize * 1.8}
                    fill={gemColor} opacity={0.2} />
                  {/* Gem shadow */}
                  <Path d={gemPath} fill="#000000" opacity={0.2}
                    transform={`translate(0, ${0.8 * sf})`} />
                  {/* Gem body */}
                  <Path d={gemPath} fill={gemColor}
                    stroke={isDark ? '#0f172a' : '#1e293b'} strokeWidth={0.8 * sf}
                    strokeLinejoin="round" />
                  {/* Gem highlight facet */}
                  <Path
                    d={`M ${pos.x} ${pos.y - gemSize}
                      L ${pos.x + gemSize * 0.3} ${pos.y - gemSize * 0.2}
                      L ${pos.x - gemSize * 0.3} ${pos.y - gemSize * 0.2} Z`}
                    fill="#ffffff" opacity={0.5} />
                  {/* Gem sparkle dot */}
                  <SvgCircle cx={pos.x - gemSize * 0.2} cy={pos.y - gemSize * 0.4}
                    r={gemSize * 0.18} fill="#ffffff" opacity={0.8} />
                </G>
              );
            })}
          </G>
        );
        break;
      }

      // ── SPARKLES (8 small 4-pointed stars) ──
      case 'sparkles': {
        const sparkR = borderR + avatarR * 0.2 * sf;
        const sparkSize = Math.max(1.8, avatarR * 0.08) * sf;
        elements.push(
          <G key="sparkles">
            {Array.from({ length: 8 }).map((_, i) => {
              const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
              const x = cx + sparkR * Math.cos(angle);
              const y = cy + sparkR * Math.sin(angle);
              const sSize = sparkSize * (i % 2 === 0 ? 1 : 0.65);
              const sparkPath = drawSparkle(x, y, sSize, sSize * 0.3);
              const color = colors[i % colors.length];
              return (
                <G key={`sp-${i}`}>
                  {/* Sparkle glow */}
                  <SvgCircle cx={x} cy={y} r={sSize * 1.8}
                    fill={color} opacity={0.15} />
                  {/* Sparkle body */}
                  <Path d={sparkPath} fill={color} opacity={0.85} />
                  {/* Sparkle center dot */}
                  <SvgCircle cx={x} cy={y} r={sSize * 0.25}
                    fill="#ffffff" opacity={0.9} />
                </G>
              );
            })}
          </G>
        );
        break;
      }

      // ── FLAMES (bottom fire licks) ──
      case 'flames': {
        const flameCount = 5;
        const flameArcStart = Math.PI * 0.55;
        const flameArcEnd = Math.PI * 0.95;
        elements.push(
          <G key="flames">
            {Array.from({ length: flameCount }).map((_, i) => {
              const t = i / (flameCount - 1);
              const angle = flameArcStart + t * (flameArcEnd - flameArcStart);
              const fx = cx + borderR * 0.95 * Math.cos(angle);
              const fy = cy + borderR * 0.95 * Math.sin(angle);
              const fh = avatarR * (0.3 + ((i * 7 + 3) % 5) * 0.03) * sf;
              const fw = avatarR * 0.18 * sf;
              const lean = (t - 0.5) * fw * 0.3;
              const flamePath = drawFlame(fx, fy, fw, fh, lean);
              const fColor = colors[i % Math.max(colors.length, 2)];
              return (
                <G key={`fl-${i}`}>
                  <Path d={flamePath} fill={fColor} opacity={0.6}
                    transform={`translate(0, ${1 * sf})`} />
                  <Path d={flamePath} fill={fColor} opacity={0.85} />
                  <Path d={flamePath} fill="#ffffff" opacity={0.08} />
                </G>
              );
            })}
          </G>
        );
        break;
      }

      // ── RIBBON (bottom banner) ──
      case 'ribbon': {
        const ribW = avatarR * 1.1 * sf;
        const ribH = avatarR * 0.22 * sf;
        const ribY = cy + borderR + ribH * 0.4;
        const ribbonPath = drawRibbon(cx, ribY, ribW, ribH);
        elements.push(
          <G key="ribbon">
            <Path d={ribbonPath} fill={primary} opacity={0.15}
              transform={`translate(0, ${1 * sf})`} />
            <Path d={ribbonPath} fill={`url(#${gradId})`}
              stroke={isDark ? '#0f172a' : '#1e293b'} strokeWidth={0.8 * sf}
              strokeLinejoin="round" />
            <Path d={ribbonPath} fill="#ffffff" opacity={0.1} />
          </G>
        );
        break;
      }
    }
  });

  return <>{elements}</>;
};

// ════════════════════════════════════════════════════════════
//  FRAMED AVATAR COMPONENT
// ════════════════════════════════════════════════════════════
const FramedAvatar = ({
  avatarUri,
  frame,
  isDarkMode = false,
  avatarSize = 72,
  isOnline,
}) => {
  const c = getThemeColors(isDarkMode);
  const instanceId = useMemo(() => `fa-${++_framedAvatarIdCounter}`, []);
  const def = frame?.id ? (FRAME_DEFS[frame.id] || DEFAULT_DEF) : null;
  const borderColors = frame?.borderColors || [];
  const glowColor = frame?.glowColor || null;
  const primaryColor = borderColors[0] || '#94a3b8';
  // ── No frame: simple circular avatar ──
  if (!frame || !def) {
    const showOnline = isOnline !== undefined && avatarSize >= 40;
    return (
      <View style={{ position: 'relative' }}>
        <View style={{
          width: avatarSize, height: avatarSize,
          borderRadius: avatarSize / 2,
          borderWidth: Math.max(1, avatarSize * 0.028),
          borderColor: c.bg,
          overflow: 'hidden',
          backgroundColor: c.border,
          alignItems: 'center', justifyContent: 'center',
        }}>
          {avatarUri ? (
            <Image
              source={{ uri: avatarUri }}
              style={{ width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }}
            />
          ) : null}
        </View>
        {showOnline && (
          <View style={{
            position: 'absolute', bottom: 0, right: 0,
            width: Math.max(8, avatarSize * 0.22), height: Math.max(8, avatarSize * 0.22),
            borderRadius: Math.max(4, avatarSize * 0.11),
            backgroundColor: isOnline ? '#22c55e' : '#94a3b8',
            borderWidth: Math.max(1, avatarSize * 0.035),
            borderColor: c.bg,
            zIndex: 11,
          }} />
        )}
      </View>
    );
  }

  // ── Scale factor for decorations (1 = 72px avatar) ──
  const scale = avatarSize / 72;
  const avatarR = avatarSize / 2;
  const totalPadding = def.gap + def.borderWidth;

  // Extra room for decorations — scale with decorScale to handle higher tiers
  const ds = def.decorScale || 1;
  const hasLargeProtrusions = def.decorations?.some(d =>
    ['crown3', 'crown5', 'wings', 'flames', 'ribbon'].includes(d));
  const hasSideProtrusions = def.decorations?.some(d =>
    ['gems', 'sparkles'].includes(d));
  const extraPad = hasLargeProtrusions
    ? avatarR * 0.55 * scale * Math.max(1, ds * 0.75)
    : hasSideProtrusions
      ? avatarR * 0.4 * scale * Math.max(1, ds * 0.75)
      : avatarR * 0.15 * scale;
  const svgSize = avatarSize + totalPadding * 2 + extraPad * 2;
  const cx = svgSize / 2;
  const cy = svgSize / 2;

  // Radii
  const innerR = avatarR - 1;
  const borderR = avatarR + def.gap;
  const outerR = borderR + def.borderWidth;
  const tripleR = outerR + 2.5 * scale;

  // Border path (main ring or scalloped)
  const mainBorderPath = def.scalloped
    ? scallopedCirclePath(cx, cy, borderR, Math.round(20 * scale), 0.06)
    : null;

  const showOnline = isOnline !== undefined && avatarSize >= 40;

  // Build gradient stops
  const gradientStops = borderColors.length > 1
    ? borderColors.map((color, i) => ({
        offset: `${(i / (borderColors.length - 1)) * 100}%`,
        color,
      }))
    : [{ offset: '0%', color: primaryColor }, { offset: '100%', color: primaryColor }];

  const gradId = `grad-${instanceId}`;
  const grad2Id = `grad2-${instanceId}`;
  const glowId = `glow-${instanceId}`;
  const clipId = `clip-${instanceId}`;

  // ══════════════════════════════════════════════════
  //  SVG FRAME — pure SVG with decorations
  // ══════════════════════════════════════════════════
  return (
    <View style={{ position: 'relative', overflow: 'visible' }}>
      <Svg width={svgSize} height={svgSize} overflow="visible" style={{ overflow: 'visible' }}>
        <Defs>
          {/* Avatar clip */}
          <ClipPath id={clipId}>
            <SvgCircle cx={cx} cy={cy} r={innerR} />
          </ClipPath>

          {/* Main gradient */}
          <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            {gradientStops.map((s, i) => (
              <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={1} />
            ))}
          </LinearGradient>

          {/* Secondary gradient (reversed) */}
          <LinearGradient id={grad2Id} x1="100%" y1="0%" x2="0%" y2="100%">
            {gradientStops.map((s, i) => (
              <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={0.5} />
            ))}
          </LinearGradient>

          {/* Radial glow — intensity scales with tier */}
          {glowColor && (
            <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
              <Stop offset="25%" stopColor={glowColor} stopOpacity={(def.glowOpacity || 0.3) * 0.9} />
              <Stop offset="50%" stopColor={glowColor} stopOpacity={(def.glowOpacity || 0.3) * 0.5} />
              <Stop offset="80%" stopColor={glowColor} stopOpacity={(def.glowOpacity || 0.3) * 0.15} />
              <Stop offset="100%" stopColor={glowColor} stopOpacity={0} />
            </RadialGradient>
          )}
        </Defs>

        {/* ── Layer 1: Radial glow ── */}
        {glowColor && (
          <SvgCircle cx={cx} cy={cy} r={svgSize / 2 - 1}
            fill={`url(#${glowId})`} />
        )}

        {/* ── Layer 2: Triple ring (outermost dashed) ── */}
        {def.tripleBorder && (
          <SvgCircle cx={cx} cy={cy} r={tripleR}
            stroke={`url(#${grad2Id})`} strokeWidth={(def.tripleBorderWidth || 0.8) * scale}
            fill="none" opacity={0.5}
            strokeDasharray={`${3 * scale},${2 * scale}`}
            strokeLinecap="round" />
        )}

        {/* ── Layer 3: Double border (outer ring) ── */}
        {def.doubleBorder && (
          <SvgCircle cx={cx} cy={cy} r={outerR}
            stroke={`url(#${grad2Id})`} strokeWidth={(def.doubleBorderWidth || 1.5) * scale}
            fill="none" opacity={0.6} />
        )}

        {/* ── Layer 4: Dark outer outline (contrast) ── */}
        <SvgCircle cx={cx} cy={cy}
          r={borderR + def.borderWidth * scale / 2 + 0.3}
          stroke={isDarkMode ? '#0f172a' : '#1e293b'}
          strokeWidth={0.7 * scale}
          fill="none" opacity={0.25} />

        {/* ── Layer 5: Main gradient border ── */}
        {def.scalloped ? (
          <>
            <Path d={mainBorderPath}
              stroke={`url(#${gradId})`}
              strokeWidth={def.borderWidth * scale}
              fill={c.border}
              strokeLinejoin="round" />
            {/* Dark outline on scalloped */}
            <Path d={mainBorderPath}
              stroke={isDarkMode ? '#0f172a' : '#1e293b'}
              strokeWidth={0.5 * scale}
              fill="none" opacity={0.2} />
          </>
        ) : (
          <SvgCircle cx={cx} cy={cy} r={borderR}
            stroke={`url(#${gradId})`}
            strokeWidth={def.borderWidth * scale}
            fill={c.border} />
        )}

        {/* ── Layer 6: Dark inner outline (contrast) ── */}
        <SvgCircle cx={cx} cy={cy}
          r={borderR - def.borderWidth * scale / 2 - 0.3}
          stroke={isDarkMode ? '#0f172a' : '#1e293b'}
          strokeWidth={0.5 * scale}
          fill="none" opacity={0.15} />

        {/* ── Layer 7: Inner white highlight shimmer ── */}
        <SvgCircle cx={cx} cy={cy} r={innerR + 1.5 * scale}
          stroke="#ffffff"
          strokeWidth={0.5 * scale}
          fill="none" opacity={isDarkMode ? 0.08 : 0.2} />

        {/* ── Layer 8: Decorative elements ── */}
        {renderDecorations({
          decorations: def.decorations,
          cx, cy,
          avatarR,
          borderR: outerR + 1,
          colors: borderColors.length > 0 ? borderColors : [primaryColor],
          gradId,
          isDark: isDarkMode,
          scale,
          decorScale: def.decorScale || 1,
        })}

        {/* ── Layer 9: Avatar image ── */}
        {avatarUri ? (
          <SvgImage
            href={{ uri: avatarUri }}
            x={cx - innerR}
            y={cy - innerR}
            width={innerR * 2}
            height={innerR * 2}
            clipPath={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
          />
        ) : (
          <SvgCircle cx={cx} cy={cy} r={innerR}
            fill={isDarkMode ? '#334155' : '#cbd5e1'} />
        )}
      </Svg>

      {/* Online indicator */}
      {showOnline && (
        <View style={{
          position: 'absolute',
          bottom: extraPad * 0.3, right: extraPad * 0.3,
          width: Math.max(8, avatarSize * 0.2),
          height: Math.max(8, avatarSize * 0.2),
          borderRadius: Math.max(4, avatarSize * 0.1),
          backgroundColor: isOnline ? '#22c55e' : '#94a3b8',
          borderWidth: Math.max(1, avatarSize * 0.03),
          borderColor: c.bg,
          zIndex: 11,
        }} />
      )}
    </View>
  );
};

export default React.memo(FramedAvatar);
