import HapticFeedback from 'react-native-haptic-feedback';
import { useLocalState } from '../LocalGlobelStats';

export const useHaptic = () => {
  const { localState } = useLocalState(); // Access global state

  // Function to trigger haptic feedback
  const triggerHapticFeedback = (type = 'impactLight') => {
    if (!localState?.isHaptic) return; // Exit if haptics are disabled or not defined

    const options = {
      enableVibrateFallback: true, // Fallback to vibration if haptics aren't supported
      ignoreAndroidSystemSettings: true, // Respect system-level haptic settings
    };

    HapticFeedback.trigger(type, options);
  };

  return { triggerHapticFeedback };
};
