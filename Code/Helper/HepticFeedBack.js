import { useCallback } from 'react';
import HapticFeedback from 'react-native-haptic-feedback';
import { useLocalState } from '../LocalGlobelStats';

export const useHaptic = () => {
  const { localState } = useLocalState(); // Access global state
  const isHaptic = localState?.isHaptic;

  // Function to trigger haptic feedback. Stable while the setting is unchanged:
  // ChatStack passes it into memoized screen render functions.
  const triggerHapticFeedback = useCallback((type = 'impactLight') => {
    if (!isHaptic) return; // Exit if haptics are disabled or not defined

    const options = {
      enableVibrateFallback: true, // Fallback to vibration if haptics aren't supported
      ignoreAndroidSystemSettings: true, // Respect system-level haptic settings
    };

    HapticFeedback.trigger(type, options);
  }, [isHaptic]);

  return { triggerHapticFeedback };
};
