// Light status-bar icons while an always-dark page is focused — the Fruit
// Cards screens are dark in both app themes, so the light theme's black status
// icons vanished on them. Goes through a StatusBar stack entry: App.js's own
// <StatusBar> re-applies its style on every render, which overwrote a plain
// setBarStyle.
//
// Smaller than Adopt Me's hook of the same name: Blox has no
// react-native-system-navigation-bar, so the Android nav bar is left to the
// app theme (edge-to-edge on Android 15 draws the page under it anyway).
import { useCallback } from 'react';
import { StatusBar } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

export default function useDarkSystemBars(color) {
  useFocusEffect(useCallback(() => {
    const entry = StatusBar.pushStackEntry({ barStyle: 'light-content', animated: true });
    return () => StatusBar.popStackEntry(entry);
  }, []));
  // `color` (the page's top colour) is accepted for parity with Adopt Me's hook.
  return color;
}
