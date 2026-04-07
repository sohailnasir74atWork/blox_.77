// themeColors.js — Centralized theme color system for the entire app
// Usage: const c = useThemeColors();  then use c.bg, c.text, etc.

import { useGlobalState } from '../GlobelStats';
import { useMemo } from 'react';

const darkPalette = {
  // Backgrounds
  bg: '#0f172a',              // Main screen background
  bgAlt: '#1e293b',           // Cards, sections, inputs
  bgElevated: '#334155',      // Modals, drawers, popovers
  bgAccent: 'rgba(124,111,255,0.08)', // Subtle accent areas

  // Text
  text: '#f1f5f9',            // Primary text
  textSecondary: '#94a3b8',   // Muted text, timestamps
  textMuted: '#64748b',       // Placeholder, disabled
  textInverse: '#0f172a',     // Text on light backgrounds

  // Borders & Dividers
  border: '#334155',          // Standard border (visible on bgAlt cards)
  borderLight: 'rgba(255,255,255,0.06)', // Subtle borders
  borderAccent: '#475569',    // Emphasized borders
  divider: 'rgba(255,255,255,0.06)',

  // Interactive
  cardBg: 'rgba(255,255,255,0.04)',
  cardBorder: 'rgba(255,255,255,0.06)',
  inputBg: '#1e293b',
  inputBorder: '#334155',
  inputText: '#f1f5f9',
  placeholder: '#64748b',

  // Status bar
  statusBar: 'light-content',
  statusBarBg: '#0f172a',

  // Close / overlay
  overlay: 'rgba(0,0,0,0.6)',
  closeBg: 'rgba(255,255,255,0.1)',
  closeIcon: 'rgba(255,255,255,0.7)',

  // Badges & Tags
  tagBg: 'rgba(255,255,255,0.08)',
  tagText: '#94a3b8',
  proBg: '#1e1040',
  proBorder: '#3b2e6e',
  proText: '#FFD93D',

  // Footer / Links
  footerLink: 'rgba(255,255,255,0.35)',
  footerMuted: 'rgba(255,255,255,0.2)',
  footerDot: 'rgba(255,255,255,0.15)',

  // System navigation bar
  navBarBg: '#0f172a',
  navBarStyle: 'light',

  // Shadows (android elevation handled separately)
  shadow: '#000',
  shadowOpacity: 0.3,
};

const lightPalette = {
  // Backgrounds
  bg: '#f8f9fb',              // Main screen background
  bgAlt: '#ffffff',           // Cards, sections, inputs
  bgElevated: '#ffffff',      // Modals, drawers, popovers
  bgAccent: 'rgba(124,111,255,0.05)', // Subtle accent areas

  // Text
  text: '#1a1a2e',            // Primary text
  textSecondary: '#6b7280',   // Muted text, timestamps
  textMuted: '#9ca3b8',       // Placeholder, disabled
  textInverse: '#ffffff',     // Text on dark backgrounds

  // Borders & Dividers
  border: '#e5e7eb',          // Standard border
  borderLight: 'rgba(0,0,0,0.06)', // Subtle borders
  borderAccent: '#d1d5db',    // Emphasized borders
  divider: 'rgba(0,0,0,0.06)',

  // Interactive
  cardBg: '#ffffff',
  cardBorder: 'rgba(0,0,0,0.08)',
  inputBg: '#f3f4f6',
  inputBorder: '#e5e7eb',
  inputText: '#1a1a2e',
  placeholder: '#9ca3b8',

  // Status bar
  statusBar: 'dark-content',
  statusBarBg: '#f8f9fb',

  // Close / overlay
  overlay: 'rgba(0,0,0,0.4)',
  closeBg: 'rgba(0,0,0,0.06)',
  closeIcon: 'rgba(0,0,0,0.5)',

  // Badges & Tags
  tagBg: 'rgba(0,0,0,0.05)',
  tagText: '#6b7280',
  proBg: '#fff8e5',
  proBorder: '#ffcc4d',
  proText: '#8B6914',

  // Footer / Links
  footerLink: 'rgba(0,0,0,0.35)',
  footerMuted: 'rgba(0,0,0,0.2)',
  footerDot: 'rgba(0,0,0,0.12)',

  // System navigation bar
  navBarBg: '#ffffff',
  navBarStyle: 'dark',

  // Shadows
  shadow: '#000',
  shadowOpacity: 0.08,
};

/**
 * Hook: useThemeColors()
 * Returns the full color palette for the current theme.
 * 
 * Example:
 *   const c = useThemeColors();
 *   <View style={{ backgroundColor: c.bg }}>
 *     <Text style={{ color: c.text }}>Hello</Text>
 *   </View>
 */
export const useThemeColors = () => {
  const { theme } = useGlobalState();
  return useMemo(() => (theme === 'dark' ? darkPalette : lightPalette), [theme]);
};

/**
 * Function: getThemeColors(isDarkMode)
 * For components that already have isDarkMode.
 */
export const getThemeColors = (isDark) => isDark ? darkPalette : lightPalette;

export { darkPalette, lightPalette };
