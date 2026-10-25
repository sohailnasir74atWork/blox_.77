/**
 * Safe-area insets for content inside a React Native <Modal>.
 *
 * Android draws edge-to-edge (targetSdk 36), and RN turns that on for every
 * Modal window too, so a full-screen modal runs under the status bar and any
 * modal's bottom edge runs under the system navigation bar. useSafeAreaInsets()
 * gives the right numbers there.
 *
 * iOS is the opposite: a Modal is its own view controller over the whole
 * window, outside App.js's padded root SafeAreaView, where useSafeAreaInsets()
 * reads 0. So a modal takes the window's own insets (as OfferWall does).
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets, initialWindowMetrics } from 'react-native-safe-area-context';

/** Insets for anything drawn inside a <Modal> (full-screen or bottom sheet). */
export const useModalWindowInsets = () => {
  const contextInsets = useSafeAreaInsets();
  return (Platform.OS === 'ios' && initialWindowMetrics?.insets) || contextInsets;
};

/**
 * The bottom padding for a modal bottom sheet that has a text input: the
 * nav bar / home indicator height while the keyboard is down, 0 while it is
 * up. The keyboard sits above the nav bar and the keyboard-avoiding wrappers
 * already lift the sheet to its top edge, so keeping the inset while typing
 * would leave a nav-bar-tall gap between the input and the keyboard.
 */
const useNavBarInset = () => {
  const insets = useModalWindowInsets();
  const [keyboardUp, setKeyboardUp] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setKeyboardUp(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return keyboardUp ? 0 : insets.bottom;
};

export default useNavBarInset;
