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
  if (__DEV__) console.log(`[ads] ${message}`);
  try {
    crashlyticsLog(getCrashlytics(), `ads: ${message}`);
  } catch (_) {}
}

const label = (v) => String(v || 'unknown').slice(0, 40);

// PaidEvent: { value, currency, precision, valueMicros?, responseInfo? }.
// iOS never sends valueMicros, so `value` is the fallback. `unitKey` is the
// app's name for the unit (ads.js: interstitial, tradePost, …).
export function logAdRevenue(format, placement, paid, adUnitId, unitKey) {
  try {
    if (!paid) return;
    const micros = paid.valueMicros != null ? Number(paid.valueMicros) : NaN;
    const value = Number.isFinite(micros) ? micros / 1e6 : Number(paid.value) || 0;
    trackGrowthEvent('ad_paid', {
      ad_format: format,
      placement: label(placement),
      value,
      currency: paid.currency || 'USD',
      precision: Number(paid.precision) || 0,
      ad_source: paid.responseInfo?.loadedAdapterResponse?.adSourceName || 'unknown',
      ad_unit: label(unitKey || format),
      ad_unit_id: String(adUnitId || '').slice(0, 100),
      ad_unit_name: String(adUnitId || '').slice(-20),
    });
  } catch (_) {}
}

// ── Show funnel (2026-11-01) ──
// ad_paid says what an impression earned; these say whether the ad the app
// meant to show (after a trade, a review, a feed post…) actually reached the
// screen, and if not, why. Each time the app decides to show a full-screen ad
// it opens one attempt, and every attempt ends in exactly one outcome:
//
//   ad_show_request  the trigger fired (trade posted, review given, …)
//   ad_shown         the ad reached the screen (OPENED) — wait_ms = how long
//                    the user waited for it
//   ad_not_shown     it didn't; `reason` says why (see REASONS in
//                    Code/Ads/AD_TRACKING.md)
//
// and a shown ad then logs ad_clicked, ad_reward_earned (rewarded only) and
// ad_closed (view_ms). So shown ÷ request is a placement's show rate, and
// ad_paid summed by placement is what it earns. Names avoid Firebase's
// reserved ad_click / ad_impression / ad_reward. All carry ad_format,
// placement, ad_unit (the ads.js key) and ad_unit_id (the AdMob unit).
export function startAdAttempt(format, placement, unitKey, adUnitId) {
  const base = {
    ad_format: format,
    placement: label(placement),
    ad_unit: label(unitKey || format),
    ad_unit_id: String(adUnitId || '').slice(0, 100),
  };
  const startedAt = Date.now();
  let outcome = null;
  let shownAt = 0;
  let clicked = false;
  let closed = false;
  trackGrowthEvent('ad_show_request', base);
  return {
    placement: base.placement,
    skip(reason) {
      if (outcome) return;
      outcome = 'not_shown';
      const why = label(reason || 'unknown').replace(/[^a-z0-9_:-]+/gi, '_');
      adLog(`${base.ad_unit} ${base.placement} not shown: ${why}`);
      trackGrowthEvent('ad_not_shown', { ...base, reason: why, wait_ms: Date.now() - startedAt });
    },
    shown() {
      if (outcome) return;
      outcome = 'shown';
      shownAt = Date.now();
      trackGrowthEvent('ad_shown', { ...base, wait_ms: shownAt - startedAt });
    },
    clicked() {
      if (outcome !== 'shown' || clicked) return;
      clicked = true;
      trackGrowthEvent('ad_clicked', base);
    },
    rewarded() {
      if (outcome !== 'shown') return;
      trackGrowthEvent('ad_reward_earned', base);
    },
    closed() {
      if (outcome !== 'shown' || closed) return;
      closed = true;
      trackGrowthEvent('ad_closed', { ...base, view_ms: Date.now() - shownAt, clicked: clicked ? 1 : 0 });
    },
    paid(paid) {
      logAdRevenue(format, placement, paid, adUnitId, unitKey);
    },
  };
}
