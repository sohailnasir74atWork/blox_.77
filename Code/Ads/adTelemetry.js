// Ad telemetry: Crashlytics breadcrumbs for every ad step, and one GA4 event
// per paid impression.
//
// Why (2026-10-12 ads audit): no format logged its paid event, so the app
// could not say what a placement earns, and Crashlytics could not tell what
// the ad code was doing when the libhwui SIGSEGV hit right after launch
// (crash reports only showed a `launch_ad` breadcrumb).
//
// Revenue goes to GA4 as `ad_paid`, NOT `ad_impression`: when AdMob is linked
// to Firebase, Analytics logs `ad_impression` itself, and a second manual one
// would double-count ad revenue. `value` + `currency` make it a valued event,
// and `placement` is what the automatic event cannot tell us.
import { getCrashlytics, log as crashlyticsLog } from '@react-native-firebase/crashlytics';
import { trackGrowthEvent } from '../Helper/growthAnalytics';

// One line in the next crash report's logs. Cheap; never throws.
export function adLog(message) {
  try {
    crashlyticsLog(getCrashlytics(), `ads: ${message}`);
  } catch (_) {}
}

// PaidEvent: { value, currency, precision, valueMicros?, responseInfo? }.
// iOS never sends valueMicros, so `value` is the fallback.
export function logAdRevenue(format, placement, paid, adUnitId) {
  try {
    if (!paid) return;
    const micros = paid.valueMicros != null ? Number(paid.valueMicros) : NaN;
    const value = Number.isFinite(micros) ? micros / 1e6 : Number(paid.value) || 0;
    trackGrowthEvent('ad_paid', {
      ad_format: format,
      placement: String(placement || 'unknown').slice(0, 40),
      value,
      currency: paid.currency || 'USD',
      precision: Number(paid.precision) || 0,
      ad_source: paid.responseInfo?.loadedAdapterResponse?.adSourceName || 'unknown',
      ad_unit_name: String(adUnitId || '').slice(-20),
    });
  } catch (_) {}
}
