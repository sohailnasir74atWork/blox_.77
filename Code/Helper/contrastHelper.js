/**
 * contrastHelper.js — Ensures cosmetic text colors are readable on backgrounds
 * 📅 2026-03-16: Created to fix contrast issues between chatTextColor & chatBubbleBg
 * 📅 2026-03-16: Added RainbowText for per-character multi-color text rendering
 *
 * Usage:
 *   import { getSafeTextColor, RainbowText } from '../Helper/contrastHelper';
 *   const safeColor = getSafeTextColor(textColor, bgColor);
 *   <RainbowText colors={[...]} style={textStyle}>{text}</RainbowText>
 */

import React from 'react';
import { Text } from 'react-native';

/**
 * Renders each character of children text in cycling colors from a colors array.
 * Spaces keep the color of the previous character for visual continuity.
 * Memoized to prevent re-renders during fast FlatList scrolling.
 * Falls back to first color for very long messages (>500 chars) to avoid perf issues.
 */
export const RainbowText = React.memo(({ children, colors, style }) => {
  if (!children || !colors || colors.length === 0) {
    return <Text style={style}>{children}</Text>;
  }

  const text = typeof children === 'string' ? children : String(children);

  // Safety: for very long messages, just use the first color
  if (text.length > 500) {
    return <Text style={[style, { color: colors[0] }]}>{text}</Text>;
  }

  let colorIndex = 0;

  return (
    <Text style={style}>
      {text.split('').map((char, i) => {
        if (char !== ' ') {
          const color = colors[colorIndex % colors.length];
          colorIndex++;
          return <Text key={i} style={{ color }}>{char}</Text>;
        }
        return <Text key={i}>{char}</Text>;
      })}
    </Text>
  );
});

// Color arrays for special multi-color text cosmetics
const SPECIAL_TEXT_COLORS = {
  rainbow: ['#FF3B5C', '#FF9500', '#FFD60A', '#4CD964', '#4DA6FF', '#BF5AF2'],
  candy: ['#FF6B9D', '#BF5AF2', '#FF3B5C', '#FF9500'],
};

/**
 * Returns true if the chatTextColor is a special multi-color type
 */
export const isMultiColorText = (chatTextColor) => {
  return chatTextColor === 'rainbow' || chatTextColor === 'candy';
};

/**
 * Returns the colors array for a special text color, or null
 */
export const getMultiColorPalette = (chatTextColor) => {
  return SPECIAL_TEXT_COLORS[chatTextColor] || null;
};

// Parse hex color to RGB
const hexToRgb = (hex) => {
  if (!hex || typeof hex !== 'string') return null;
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (hex.length !== 6) return null;
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
  };
};

// Relative luminance (WCAG formula)
const getLuminance = ({ r, g, b }) => {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

// Contrast ratio between two colors (1:1 to 21:1)
const getContrastRatio = (rgb1, rgb2) => {
  const l1 = getLuminance(rgb1);
  const l2 = getLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

// Darken a color by a factor (0-1)
const darkenColor = ({ r, g, b }, factor) => {
  const f = 1 - factor;
  return `#${Math.round(r * f).toString(16).padStart(2, '0')}${Math.round(g * f).toString(16).padStart(2, '0')}${Math.round(b * f).toString(16).padStart(2, '0')}`;
};

// Lighten a color by a factor (0-1)
const lightenColor = ({ r, g, b }, factor) => {
  return `#${Math.round(r + (255 - r) * factor).toString(16).padStart(2, '0')}${Math.round(g + (255 - g) * factor).toString(16).padStart(2, '0')}${Math.round(b + (255 - b) * factor).toString(16).padStart(2, '0')}`;
};

/**
 * Returns a readable text color given the desired text color and background.
 * If contrast is already good (>= 3:1), returns the original text color.
 * Otherwise, darkens or lightens the text color until it's readable.
 *
 * @param {string} textColor - Hex color for text (e.g. '#FF453A')
 * @param {string} bgColor - Hex color for background (e.g. '#FFD1DC')
 * @returns {string} - Safe hex color to use for text
 */
export const getSafeTextColor = (textColor, bgColor) => {
  if (!textColor || !bgColor || textColor === 'rainbow' || textColor === 'candy') return textColor;

  const textRgb = hexToRgb(textColor);
  const bgRgb = hexToRgb(bgColor);
  if (!textRgb || !bgRgb) return textColor;

  const ratio = getContrastRatio(textRgb, bgRgb);
  if (ratio >= 3) return textColor; // Already readable

  // Decide whether to darken or lighten based on background luminance
  const bgLuminance = getLuminance(bgRgb);
  const isLightBg = bgLuminance > 0.5;

  // Try progressively adjusting until we hit 3:1 contrast
  for (let step = 0.1; step <= 0.9; step += 0.1) {
    const adjusted = isLightBg ? darkenColor(textRgb, step) : lightenColor(textRgb, step);
    const adjustedRgb = hexToRgb(adjusted);
    if (adjustedRgb && getContrastRatio(adjustedRgb, bgRgb) >= 3) {
      return adjusted;
    }
  }

  // Fallback: use black or white
  return isLightBg ? '#1e293b' : '#f1f5f9';
};
