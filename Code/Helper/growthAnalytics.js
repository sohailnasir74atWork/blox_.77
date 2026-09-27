import {getAnalytics, logEvent} from '@react-native-firebase/analytics';

// Uses the app's existing Analytics collection settings. No item names,
// search strings, emails, or account identifiers are sent by these events.
export const trackGrowthEvent = (event, params = {}) => {
  try {
    Promise.resolve(logEvent(getAnalytics(), event, params)).catch(() => {});
  } catch {
    // Measurement must never block the calculator or onboarding.
  }
};
