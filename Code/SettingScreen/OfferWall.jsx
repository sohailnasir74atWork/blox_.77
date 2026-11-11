// OfferWall.jsx — Blox Fruit Values Pro (custom paywall)
//
// Replaces the RevenueCatUI paywall (react-native-purchases-ui) with a screen
// built on react-native-purchases only, ported from the Adopt Me app.
//
// TWO STEPS (owner, 2026-11-10 — replaces the 2026-10-11 "one wall" call):
//   1. the full-price wall, offering 'pro_full' ($9.99 / $19.99 / $49.99,
//      3-day free trial for new subscribers), falling back to 'default';
//   2. closed without buying → the SAME screen turns into a one-time offer,
//      'pro_offer' (50% off), shown once per install, never again.
// See proOfferings.js. The old 'paywallrc' offering is not used. Callers
// still pass `showoffer` and `oneWallOnly`; both are ignored.
//
// The screen says one thing at a time, top to bottom (layout the owner
// approved on the MM2 build, 2026-11-10; the three apps share it):
//   1. the title — the free trial when this person can have one,
//   2. one picture of the boost: their own trade card, Pro badge, "on top",
//   3. one line of benefits,
//   4. the plans side by side, one button, one line saying what is charged.
// No benefit list, no per-month or "you save" lines: each extra line made the
// wall read as rushed.
//
// It LOOKS LIKE ONBOARDING, on purpose: it is the third of the three first-run
// steps (OnBoardingScreen.js), on onboarding's own background, with the same
// logo, progress bar and trade card (onboardingKit.js), and its button is
// onboarding's Continue button: same colour (config.colors.hasBlockGreen),
// same corners, same word.
//
// Every price and discount is computed from live store prices, never
// hardcoded, so it stays true in every currency.
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, Modal, TouchableOpacity, Image,
  StyleSheet, StatusBar, ActivityIndicator, Platform,
  Dimensions, Linking, ScrollView, Alert, Animated, Easing, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient as SvgRadial, Stop, Rect, Circle } from 'react-native-svg';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../LocalGlobelStats';
import { useGlobalState } from '../GlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import { showSuccessMessage } from '../Helper/MessageHelper';
import {
  paywallPlacement, trackPaywallView, trackPaywallClose, trackProPurchase,
  trackPurchaseStart, trackPurchaseFail,
} from '../Helper/growthAnalytics';
import config from '../Helper/Environment';
import { purchasePaywallPackage, restorePaywallPurchases } from './PayWall';
import {
  loadWallOfferings, fullWallPackages, exitWallPackages, isNewPricing,
  trialEligibility, matchByPeriod, EXIT_OFFER_SHOWN_KEY, EXIT_OFFER_TRIGGER,
} from './proOfferings';
import {
  unitFor, isCompact, FONT_CAP, MAX_COLUMN, ProgressBar, TradeCard, MY_TRADE_ITEMS, OTHER_TRADES,
} from '../AppHelper/onboardingKit';

const { width, height } = Dimensions.get('window');

// The logo onboarding shows (OnBoardingScreen.js picks it the same way).
const LOGO = config.isNoman ? require('../../assets/icon.webp') : require('../../assets/appstore.png');
const PRO_BADGE = require('../../assets/pro.png');

const TERMS_URL = 'https://bloxfruitscalc.com/terms';
const PRIVACY_URL = 'https://bloxfruitscalc.com/privacy-policy/';

// Seconds before the × appears. Nothing is shown in its place while it waits;
// it simply appears. Owner's call (2026-11-10): 7 s on the full-price wall
// wherever it opens (onboarding and in-app), 3 s on the one-time offer.
const CLOSE_DELAY_ONBOARDING = 7;
const CLOSE_DELAY = 7;
// The one-time offer follows a close the person already chose; 3 s is enough
// to read it without feeling trapped a second time.
const CLOSE_DELAY_EXIT = 3;

// ── Palette ──
const BRAND = '#29AB87';   // config.colors.hasBlockGreen — onboarding's Continue button
const ACCENT = '#3E8BFC';  // config.colors.secondary
const GOLD = '#FFC93C';    // the Pro badge (assets/pro.png)

// '#RRGGBB' + alpha → '#RRGGBBAA'
const tint = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

const makePalette = (isDark) => (isDark
  ? {
    BG: '#0f172a',          // config.colors.backgroundDark — onboarding's dark background
    STATUS_STYLE: 'light-content',
    GLOW: 0.24,
    BRAND_TEXT: '#3CCB9F',
    TEXT: '#FFFFFF',        // onboarding title
    TEXT_SUB: '#CCCCCC',    // onboarding body text
    TEXT_MUTE: 'rgba(255,255,255,0.5)',
    CARD: 'rgba(255,255,255,0.06)',
    CARD_LINE: 'rgba(255,255,255,0.10)',
    DIVIDER: 'rgba(255,255,255,0.07)',
    TILE_ON: tint(BRAND, 0.18),
    SAVINGS_LINE: tint(BRAND, 0.45),
    CLOSE_BG: 'rgba(255,255,255,0.10)',
    CLOSE_ICON: 'rgba(255,255,255,0.85)',
    DOCK_BG: 'rgba(15,23,42,0.94)',
    DOCK_LINE: 'rgba(255,255,255,0.08)',
    FOOTER: 'rgba(255,255,255,0.45)',
    FOOTER_DOT: 'rgba(255,255,255,0.25)',
    PIN: '#F2C14E',          // the "on top" pin: gold that reads on the dark card
  }
  : {
    BG: '#f2f2f7',          // config.colors.backgroundLight — onboarding's light background
    STATUS_STYLE: 'dark-content',
    GLOW: 0.14,
    BRAND_TEXT: '#1E8A6C',  // brand darkened so a price in it reads on white
    TEXT: '#000000',
    TEXT_SUB: '#666666',
    TEXT_MUTE: '#8E8E93',
    CARD: '#FFFFFF',
    CARD_LINE: '#E5E5EA',
    DIVIDER: '#EFEFF4',
    TILE_ON: tint(BRAND, 0.10),
    SAVINGS_LINE: tint(BRAND, 0.35),
    CLOSE_BG: 'rgba(0,0,0,0.06)',
    CLOSE_ICON: '#3C3C43',
    DOCK_BG: 'rgba(242,242,247,0.96)',
    DOCK_LINE: '#E5E5EA',
    FOOTER: '#8E8E93',
    FOOTER_DOT: '#C7C7CC',
    PIN: '#946200',
  });

// ── What Pro actually unlocks ──
// The wall names three things, each a real gate in the code:
//   no ads → banner / interstitial / feed ads skip Pro (HomeScreen, Trades, IntAd)
//   boost  → Trades.jsx handleMakeFeatureTrade is Pro-only (or a paid feature)
//   badge  → assets/pro.png beside the name on trades and posts
const BENEFITS = [
  { key: 'short_noads', icon: 'close-circle', tint: BRAND },
  { key: 'short_boost', icon: 'rocket', tint: ACCENT },
  { key: 'short_badge', image: PRO_BADGE, tint: GOLD },
];

const PLAN_ORDER = { LIFETIME: 0, ANNUAL: 1, SIX_MONTH: 2, THREE_MONTH: 3, TWO_MONTH: 4, MONTHLY: 5, WEEKLY: 6 };
const MONTHS_IN_PERIOD = { WEEKLY: 0.2301, MONTHLY: 1, TWO_MONTH: 2, THREE_MONTH: 3, SIX_MONTH: 6, ANNUAL: 12 };
// Translation keys; translated where rendered.
const PLAN_LABEL = {
  WEEKLY: 'settings.offer_wall.plan_weekly', MONTHLY: 'settings.offer_wall.plan_monthly', TWO_MONTH: 'settings.offer_wall.plan_two_month', THREE_MONTH: 'settings.offer_wall.plan_three_month',
  SIX_MONTH: 'settings.offer_wall.plan_six_month', ANNUAL: 'settings.offer_wall.plan_annual', LIFETIME: 'settings.offer_wall.plan_lifetime',
};
// Full "<price> billed … Renews automatically, cancel anytime." sentences.
const BILLED_LABEL = {
  WEEKLY: 'settings.offer_wall.renews_weekly', MONTHLY: 'settings.offer_wall.renews_monthly', TWO_MONTH: 'settings.offer_wall.renews_two_month',
  THREE_MONTH: 'settings.offer_wall.renews_three_month', SIX_MONTH: 'settings.offer_wall.renews_six_month', ANNUAL: 'settings.offer_wall.renews_annual',
};

// Play returns a trailing ".00" on every whole price — "Rs 550.00" where the
// shop itself says "Rs 550". Strip a separator followed by exactly two zeros
// when no digit follows, so "Rs 1,006.00" keeps its "1,006".
const trimZeroDecimals = (s) => (typeof s === 'string' ? s.replace(/([.,])00(?!\d)/, '') : s);

// ── Background: onboarding's flat colour, one soft brand glow at the top ──
const Backdrop = ({ P }) => (
  <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
    <Defs>
      <SvgRadial id="glowTop" cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor={BRAND} stopOpacity={P.GLOW} />
        <Stop offset="1" stopColor={BRAND} stopOpacity="0" />
      </SvgRadial>
    </Defs>
    <Rect x="0" y="0" width="100%" height="100%" fill={P.BG} />
    <Circle cx={width * 0.5} cy={height * 0.04} r={width * 0.8} fill="url(#glowTop)" />
  </Svg>
);

const sortPackages = (packages) =>
  (packages || []).slice().sort(
    (a, b) => (PLAN_ORDER[a.packageType] ?? 9) - (PLAN_ORDER[b.packageType] ?? 9)
  );

// A free trial on the product, if the store has one: iOS intro price of 0, or
// a free phase on the Play offer. → { count, unit } | null
const storeTrial = (pkg) => {
  const product = pkg?.product;
  const intro = product?.introPrice;
  if (intro && intro.price === 0 && intro.periodNumberOfUnits > 0) {
    return { count: intro.periodNumberOfUnits, unit: String(intro.periodUnit || '').toUpperCase() };
  }
  const freePhase = product?.defaultOption?.freePhase?.billingPeriod;
  if (freePhase && freePhase.value > 0) {
    return { count: freePhase.value, unit: String(freePhase.unit || '').toUpperCase() };
  }
  return null;
};

// `progress` ({ step, total }) is passed by onboarding, where this wall is the
// last of the three first-run steps and carries their progress bar.
// `trigger` names the exact spot that opened the wall (growthAnalytics.js).
const SubscriptionScreen = ({ visible, onClose, track, trigger, progress }) => {
  const insets = useSafeAreaInsets();
  const { refreshCustomerInfo, localState, updateLocalState } = useLocalState();
  const { theme, user } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();

  const isDark = theme === 'dark';
  const P = useMemo(() => makePalette(isDark), [isDark]);
  const { width: winW, height: winH } = useWindowDimensions();
  const unit = unitFor(winW);
  const compact = isCompact(winH);
  const s = useMemo(() => makeStyles(P, unit, compact), [P, unit, compact]);

  // 'full' = the full-price wall; 'exit' = the one-time 50% offer it turns
  // into when closed unbought (once per install).
  const [phase, setPhase] = useState('full');
  const isExit = phase === 'exit';
  // What analytics and RevenueCat attributes call this spot.
  const activeTrigger = isExit ? EXIT_OFFER_TRIGGER : trigger;
  // iOS: { productId: eligible for the free trial } (Android: always {}).
  const [eligible, setEligible] = useState({});

  const closeDelay = isExit
    ? CLOSE_DELAY_EXIT
    : (paywallPlacement(track) === 'onboarding' ? CLOSE_DELAY_ONBOARDING : CLOSE_DELAY);

  const [offerings, setOfferings] = useState(null); // offerings.all; null while loading
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [canClose, setCanClose] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const riseAnim = useRef(new Animated.Value(28)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const closeFade = useRef(new Animated.Value(0)).current;

  // ── Open: load offerings. Closed: back to the full-price step, so the next
  // open never starts (or logs a view) as the exit offer. ──
  useEffect(() => {
    if (!visible) { setPhase('full'); return undefined; }
    let alive = true;
    setSelectedPkg(null);
    setPhase('full');
    loadWallOfferings().then((o) => { if (alive) setOfferings(o); });
    return () => { alive = false; };
  }, [visible]);

  // ── Analytics: one view per open, one more when the exit offer appears ──
  useEffect(() => {
    if (visible) trackPaywallView(track, activeTrigger);
  }, [visible, isExit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Full wall: 'pro_full', else 'default'. Exit offer: 'pro_offer'.
  const wallPackages = useMemo(() => {
    if (!offerings) return [];
    return isExit ? exitWallPackages(offerings) : fullWallPackages(offerings, []);
  }, [offerings, isExit]);

  // The full-price plan of each billing period — the exit offer's "was" price.
  const fullByType = useMemo(
    () => (isExit && offerings ? matchByPeriod(fullWallPackages(offerings, []), (p) => p.packageType) : {}),
    [isExit, offerings]
  );

  // iOS trial eligibility for the plans on screen (Android needs none).
  useEffect(() => {
    if (!visible || isExit || !wallPackages.length) return undefined;
    let alive = true;
    trialEligibility(wallPackages).then((m) => { if (alive) setEligible(m); });
    return () => { alive = false; };
  }, [visible, isExit, wallPackages]);

  // ── Pricing: each plan vs. the priciest per-month rate (monthly); on the
  // exit offer, vs. the same plan at full price ──
  const plans = useMemo(() => {
    const list = sortPackages(wallPackages);
    const monthlyRate = (p) => {
      const months = MONTHS_IN_PERIOD[p.packageType];
      const price = p.product?.price;
      return months && price > 0 ? price / months : null;
    };
    const rates = list.map(monthlyRate).filter((r) => r != null);
    const anchorRate = rates.length ? Math.max(...rates) : null;

    return list.map((pkg) => {
      const price = pkg.product?.price;
      const rate = monthlyRate(pkg);
      const months = MONTHS_IN_PERIOD[pkg.packageType];
      // Exit offer: the saving is against the SAME plan at full price, read
      // live from the store — never a made-up "was" price.
      if (isExit) {
        const full = fullByType[pkg.packageType];
        const wasPrice = full?.product?.price;
        const off = (wasPrice > 0 && price > 0 && wasPrice > price) ? Math.round((1 - price / wasPrice) * 100) : 0;
        const savings = off >= 5 ? off : 0;
        return { pkg, rate, savings, saved: savings ? wasPrice - price : 0, freeMonths: 0, wasPkg: savings ? full : null };
      }
      const compareAt = (anchorRate && months) ? anchorRate * months : null;
      // Anything under 5% reads as a rounding artefact, so it is not claimed.
      const pct = (compareAt && price > 0 && compareAt > price) ? Math.round((1 - price / compareAt) * 100) : 0;
      const savings = pct >= 5 ? pct : 0;
      const saved = savings ? compareAt - price : 0;
      // "Like 6 months free" — the saving in months of the monthly plan.
      // Floored on purpose: better to undersell than to round a claim up.
      const freeMonths = (savings && anchorRate) ? Math.floor(saved / anchorRate) : 0;
      return { pkg, rate, savings, saved, freeMonths, wasPkg: null };
    });
  }, [wallPackages, isExit, fullByType]);

  // Best value = biggest real saving; ties go to the longest plan (list is sorted).
  const recommended = useMemo(() => {
    if (!plans.length) return null;
    return plans.reduce((best, p) => (p.savings > best.savings ? p : best), plans[0]).pkg;
  }, [plans]);

  useEffect(() => {
    if (visible && recommended && (!selectedPkg || !plans.some((p) => p.pkg.identifier === selectedPkg.identifier))) {
      setSelectedPkg(recommended);
    }
  }, [visible, recommended, selectedPkg, plans]);

  // ── The × stays hidden for closeDelay seconds, then appears ──
  useEffect(() => {
    if (!visible) return undefined;
    setCanClose(false);
    closeFade.setValue(0);
    const timer = setTimeout(() => {
      setCanClose(true);
      Animated.timing(closeFade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }, closeDelay * 1000);
    return () => clearTimeout(timer);
  }, [visible, isExit, closeDelay, closeFade]);

  // ── Entrance ──
  useEffect(() => {
    if (!visible) return;
    fadeAnim.setValue(0);
    riseAnim.setValue(28);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(riseAnim, { toValue: 0, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [visible, isExit, fadeAnim, riseAnim]);

  // ── CTA breathing ──
  useEffect(() => {
    if (!visible) return undefined;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.025, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [visible, pulseAnim]);

  const finish = useCallback(() => {
    refreshCustomerInfo?.().catch?.(() => {});
    onClose?.();
  }, [onClose, refreshCustomerInfo]);

  // Closing the full-price wall unbought turns it into the one-time offer —
  // once per install, only on the new prices, only if the offer loaded.
  // Closing the offer (or the wall a second time ever) really closes.
  const handleClose = useCallback(() => {
    if (loading) return;
    trackPaywallClose(track, activeTrigger);
    const offerReady = !isExit
      && !localState?.isPro
      && !localState?.[EXIT_OFFER_SHOWN_KEY]
      && isNewPricing(offerings)
      && exitWallPackages(offerings).length > 0;
    if (offerReady) {
      updateLocalState(EXIT_OFFER_SHOWN_KEY, true);
      setSelectedPkg(null);
      setPhase('exit');
      return;
    }
    finish();
  }, [loading, track, activeTrigger, isExit, localState, offerings, updateLocalState, finish]);

  const handleSelect = useCallback((pkg) => {
    triggerHapticFeedback('impactLight');
    setSelectedPkg(pkg);
  }, [triggerHapticFeedback]);

  const handlePurchase = useCallback(async () => {
    if (!selectedPkg || loading) return;
    triggerHapticFeedback('impactMedium');
    setLoading(true);
    trackPurchaseStart(selectedPkg, track, activeTrigger);
    const r = await purchasePaywallPackage(selectedPkg);
    setLoading(false);
    if (!r.pro) trackPurchaseFail(selectedPkg, track, activeTrigger, r.error);
    if (r.pro) {
      trackProPurchase(selectedPkg, track, activeTrigger, r.customerInfo);
      showSuccessMessage(t('alert.success', { defaultValue: 'Success' }), t('paywall.welcome_pro', { defaultValue: 'Welcome to Pro!' }));
      finish();
    } else if (!r.cancelled) {
      // Alert, not a flash message: those render underneath a full-screen Modal.
      Alert.alert(t('alert.error', { defaultValue: 'Error' }), t('paywall.purchase_failed', { defaultValue: 'Purchase failed. Please try again.' }));
    }
  }, [selectedPkg, loading, triggerHapticFeedback, finish, track, activeTrigger, t]);

  const handleRestore = useCallback(async () => {
    if (restoring) return;
    setRestoring(true);
    const r = await restorePaywallPurchases();
    setRestoring(false);
    if (r.pro) {
      showSuccessMessage(t('alert.success', { defaultValue: 'Success' }), t('paywall.restored', { defaultValue: 'Your Pro subscription is restored.' }));
      finish();
    } else {
      Alert.alert(t('paywall.restore_none_title', { defaultValue: 'Nothing to restore' }), t('paywall.restore_none', { defaultValue: 'No active Pro subscription was found for this store account.' }));
    }
  }, [restoring, finish, t]);

  // ── Free trial (pro_full: 3 days, new subscribers only) ──
  // iOS lists the intro offer on every product, eligible or not, so only
  // promise it when Apple confirmed eligibility. Play only returns offers the
  // person can actually get.
  const trial = (() => {
    if (isExit || !selectedPkg) return null;
    if (Platform.OS === 'ios' && eligible[selectedPkg.product?.identifier] !== true) return null;
    const tr = storeTrial(selectedPkg);
    const key = tr && { DAY: 'trial_days', WEEK: 'trial_weeks', MONTH: 'trial_months' }[tr.unit];
    return key ? t(`paywall.${key}`, { count: tr.count }) : null;
  })();

  // The line under the button says exactly what is charged, and when —
  // after the free trial, when there is one.
  const ctaSubtitle = (() => {
    const price = trimZeroDecimals(selectedPkg?.product?.priceString);
    if (!price) return null;
    if (selectedPkg.packageType === 'LIFETIME') return t('settings.offer_wall.lifetime_once', { price });
    const billed = t(BILLED_LABEL[selectedPkg.packageType] || 'settings.offer_wall.renews_default', { price });
    return trial ? `${t('paywall.trial_then', { trial })} ${billed}` : billed;
  })();

  // With a trial the button says so; the one-time offer names the deal.
  const ctaLabel = isExit
    ? t('paywall.exit_cta')
    : (trial ? t('paywall.cta_trial') : t('paywall.cta', { defaultValue: 'Continue' }));

  // Biggest real % off on the exit offer (the title promises no more than this).
  const exitPercent = isExit ? Math.max(0, ...plans.map((p) => p.savings)) : 0;

  // ── Title: the trial when this person can have one, else the plain pitch ──
  const plainTitle = t('paywall.title', { defaultValue: 'Blox Fruit Values Pro' });
  const titleText = isExit
    ? (exitPercent > 0 ? t('paywall.exit_title', { percent: exitPercent }) : plainTitle)
    : (trial ? t('paywall.trial_title', { trial }) : plainTitle);

  // ── The boosted trade: you when signed in, a sample trader when not ──
  const previewName = (user?.id && user?.displayName) ? user.displayName : t('paywall.sample_name');
  const previewAvatar = user?.id ? (user?.avatar || null) : null;

  return (
    <Modal visible={!!visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={canClose ? handleClose : undefined}>
      <View style={s.container}>
        <StatusBar barStyle={P.STATUS_STYLE} />
        <Backdrop P={P} />

        {/* ══ TOP: one title, one picture of the boost, one line of benefits ══ */}
        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.scrollContent, { paddingTop: insets.top + Math.round(14 * unit) }]}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Onboarding's progress bar, in the same place as on steps 1 and 2. */}
          {!!progress && <ProgressBar step={progress.step} total={progress.total} u={unit} isDark={isDark} />}

          {/* Three blocks spread evenly over whatever height the plans leave,
              so a tall phone has no empty band and a short one no squeeze. */}
          <Animated.View style={[s.column, s.spread, { opacity: fadeAnim, transform: [{ translateY: riseAnim }] }]}>
            <View style={s.head}>
              <Image resizeMethod="resize" source={LOGO} style={s.logo} resizeMode="contain" />
              {isExit && (
                <View style={s.exitBadge}>
                  <Text style={s.exitBadgeText} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP}>{t('paywall.exit_badge')}</Text>
                </View>
              )}
              <Text
                style={s.title}
                // One line on both walls: on iPhone the bold system font is wider,
                // and a two-line exit title pushed the benefit labels under the
                // plans (bugs LOG 2026-11-11). It shrinks to fit instead; 0.6
                // leaves room for the longest translation (de/es).
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={isExit ? 0.6 : 0.7}
                maxFontSizeMultiplier={FONT_CAP}
              >
                {titleText}
              </Text>
              <Text style={s.subtitle} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP}>
                {isExit ? t('paywall.exit_subtitle') : t('paywall.boost_caption')}
              </Text>
            </View>

            {/* The feed, with your trade first: the same card onboarding showed
                third in the list, now on top. */}
            <View style={s.feed}>
              <TradeCard
                u={unit}
                isDark={isDark}
                compact={compact}
                variant="pro"
                name={previewName}
                avatar={previewAvatar}
                items={MY_TRADE_ITEMS}
                pinLabel={t('paywall.on_top')}
              />
              {!compact && (
                <TradeCard
                  u={unit}
                  isDark={isDark}
                  dense
                  variant="other"
                  name={OTHER_TRADES[0].name}
                  items={OTHER_TRADES[0].items}
                />
              )}
            </View>

            <View style={s.benefits}>
              {BENEFITS.map((b) => (
                <View key={b.key} style={s.benefit}>
                  <View style={[s.benefitIcon, { backgroundColor: tint(b.tint, 0.15) }]}>
                    {b.image
                      ? <Image resizeMethod="resize" source={b.image} style={s.benefitBadge} resizeMode="contain" />
                      : <Icon name={b.icon} size={s.benefitBadge.width} color={b.tint} />}
                  </View>
                  <Text
                    style={s.benefitLabel}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                    maxFontSizeMultiplier={FONT_CAP}
                  >
                    {t(`paywall.${b.key}`)}
                  </Text>
                </View>
              ))}
            </View>
          </Animated.View>
        </ScrollView>

        {/* ── Close — pinned, never scrolls away; absent until the delay ends ── */}
        {canClose && (
          <View style={[s.closeWrap, { top: insets.top + 10 }]} pointerEvents="box-none">
            <Animated.View style={{ opacity: closeFade }}>
              <TouchableOpacity
                onPress={handleClose}
                style={s.closeBtn}
                hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                accessibilityLabel={t('settings.offer_wall.close')}
              >
                <Icon name="close" size={19} color={P.CLOSE_ICON} />
              </TouchableOpacity>
            </Animated.View>
          </View>
        )}

        {/* ══ BOTTOM: the plans, side by side, then one button ══ */}
        <View style={[s.dock, { paddingBottom: DOCK_PAD + insets.bottom }]}>
          <View style={s.column}>
          {plans.length > 0 ? (
            <View style={s.tiles}>
              {plans.map(({ pkg, savings, wasPkg }, i) => {
                const isSelected = selectedPkg?.identifier === pkg.identifier;
                return (
                  <TouchableOpacity
                    key={pkg.identifier || i}
                    onPress={() => handleSelect(pkg)}
                    activeOpacity={0.9}
                    style={[s.tile, isSelected && s.tileOn]}
                  >
                    <Text
                      style={[s.tilePlan, isSelected && s.tilePlanOn]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.75}
                      maxFontSizeMultiplier={FONT_CAP}
                    >
                      {(PLAN_LABEL[pkg.packageType] && t(PLAN_LABEL[pkg.packageType])) || pkg.product?.title || pkg.identifier}
                    </Text>

                    <Text
                      style={[s.tilePrice, isSelected && s.tilePriceOn]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                      maxFontSizeMultiplier={FONT_CAP}
                    >
                      {trimZeroDecimals(pkg.product?.priceString) || '—'}
                    </Text>

                    {/* One reserved line so all tiles stay the same height: the
                        real saving, or on the one-time offer the real full
                        price, crossed out. */}
                    <Text
                      style={[s.tileNote, wasPkg ? s.wasPrice : s.tileSave]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                      maxFontSizeMultiplier={FONT_CAP}
                    >
                      {wasPkg
                        ? trimZeroDecimals(wasPkg.product?.priceString)
                        : (savings > 0 ? t('paywall.save', { percent: savings }) : ' ')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={s.loadingWrap}>
              {offerings === null ? (
                <>
                  <ActivityIndicator size="small" color={BRAND} />
                  <Text style={s.loadingText}>{t('settings.offer_wall.loading_plans')}</Text>
                </>
              ) : (
                <Text style={s.loadingText}>{t('paywall.unavailable', { defaultValue: 'Plans are unavailable right now. Check your connection.' })}</Text>
              )}
            </View>
          )}

          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              style={[s.cta, (loading || !selectedPkg) && s.ctaOff]}
              onPress={handlePurchase}
              disabled={loading || !selectedPkg}
              activeOpacity={0.9}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <View style={s.ctaInner}>
                  <Text style={s.ctaText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={FONT_CAP}>
                    {ctaLabel}
                  </Text>
                  <Icon name="arrow-forward" size={s.ctaText.fontSize + 2} color="#FFFFFF" style={s.ctaArrow} />
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>

          {!!ctaSubtitle && <Text style={s.ctaSub} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP}>{ctaSubtitle}</Text>}

          <View style={s.footer}>
            <TouchableOpacity onPress={handleRestore} disabled={restoring} hitSlop={FOOTER_SLOP}>
              {restoring
                ? <ActivityIndicator size="small" color={BRAND} />
                : <Text style={s.footerLink}>{t('paywall.restore', { defaultValue: 'Restore purchases' })}</Text>}
            </TouchableOpacity>
            <Text style={s.footerDot}>·</Text>
            <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)} hitSlop={FOOTER_SLOP}>
              <Text style={s.footerLink}>{t('paywall.terms', { defaultValue: 'Terms' })}</Text>
            </TouchableOpacity>
            <Text style={s.footerDot}>·</Text>
            <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)} hitSlop={FOOTER_SLOP}>
              <Text style={s.footerLink}>{t('paywall.privacy', { defaultValue: 'Privacy' })}</Text>
            </TouchableOpacity>
          </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const DOCK_PAD = 10;
const FOOTER_SLOP = { top: 10, bottom: 10, left: 8, right: 8 };

// Rebuilt when the theme or the screen size changes; memoised by the
// component. `u` scales every size (see unitFor); `compact` is a short screen.
const makeStyles = (P, u, compact) => {
  const z = (n) => Math.round(n * u * 2) / 2;
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: P.BG },

  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: z(4) },
  // One centred column; a tablet does not stretch it edge to edge.
  column: { width: '100%', maxWidth: MAX_COLUMN, alignSelf: 'center', paddingHorizontal: z(20) },
  // The top blocks share the free height equally (and never touch).
  spread: { flexGrow: 1, justifyContent: 'space-evenly', rowGap: z(compact ? 10 : 16) },

  // ── Head: logo, title, one line under it ──
  head: { alignItems: 'center' },
  logo: { width: z(compact ? 52 : 72), height: z(compact ? 52 : 72), borderRadius: z(14) },
  title: {
    color: P.TEXT,
    fontSize: z(28),
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: z(compact ? 6 : 12),
    alignSelf: 'stretch',
  },
  subtitle: {
    color: P.TEXT_SUB,
    fontSize: z(14.5),
    fontWeight: '500',
    lineHeight: z(20),
    marginTop: z(6),
    textAlign: 'center',
  },

  feed: { gap: z(compact ? 8 : 10) },

  // ── Benefits: three icons in a row, one short label each ──
  benefits: { flexDirection: 'row', justifyContent: 'space-between' },
  benefit: { flex: 1, alignItems: 'center', paddingHorizontal: z(4) },
  benefitIcon: {
    width: z(compact ? 42 : 52),
    height: z(compact ? 42 : 52),
    borderRadius: z(16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitBadge: { width: z(compact ? 22 : 27), height: z(compact ? 22 : 27) },
  benefitLabel: {
    color: P.TEXT,
    fontSize: z(13.5),
    fontWeight: '800',
    marginTop: z(7),
    textAlign: 'center',
    alignSelf: 'stretch',
  },

  // ── Close ──
  closeWrap: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    elevation: 10, // Android: keep the tap target above the ScrollView
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: P.CLOSE_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ══ Dock ══
  dock: { paddingTop: z(6) },

  // ── Plans, side by side ──
  tiles: { flexDirection: 'row', gap: z(9) },
  tile: {
    flex: 1,
    minWidth: 0,
    borderRadius: z(14),
    borderWidth: 2,
    borderColor: P.CARD_LINE,
    backgroundColor: P.CARD,
    paddingVertical: z(compact ? 9 : 12),
    paddingHorizontal: z(5),
    alignItems: 'center',
  },
  // No elevation: a translucent fill with an Android shadow shows the shadow
  // through as a dark box. The brand border carries the selection.
  tileOn: { borderColor: BRAND, backgroundColor: P.TILE_ON },
  tilePlan: { color: P.TEXT_SUB, fontSize: z(12.5), fontWeight: '800' },
  tilePlanOn: { color: P.TEXT },
  tilePrice: {
    color: P.TEXT,
    fontSize: z(20),
    fontWeight: '800',
    letterSpacing: -0.4,
    marginTop: z(3),
  },
  tilePriceOn: { color: P.BRAND_TEXT },
  tileNote: { color: P.TEXT_MUTE, fontSize: z(11.5), fontWeight: '800', marginTop: z(3) },
  tileSave: { color: P.BRAND_TEXT },
  wasPrice: { textDecorationLine: 'line-through' },

  // ── One-time offer: the badge over the title ──
  exitBadge: {
    alignSelf: 'center',
    backgroundColor: GOLD,
    paddingHorizontal: z(13),
    paddingVertical: z(4),
    borderRadius: 999,
    marginTop: z(10),
  },
  exitBadgeText: { color: '#1A1300', fontSize: z(11.5), fontWeight: '800', letterSpacing: 0.6 },

  // ── Loading / unavailable ──
  loadingWrap: { alignItems: 'center', paddingVertical: z(26), paddingHorizontal: z(12) },
  loadingText: { color: P.TEXT_MUTE, fontSize: z(12.5), fontWeight: '500', marginTop: z(8), textAlign: 'center' },

  // ── CTA: onboarding's Continue button, a little taller ──
  cta: {
    height: z(54),
    borderRadius: z(13),
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: z(compact ? 10 : 14),
    shadowColor: BRAND,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  ctaOff: { opacity: 0.55 },
  ctaInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: z(18) },
  ctaText: { color: '#FFFFFF', fontSize: z(17.5), fontWeight: '800', flexShrink: 1 },
  ctaArrow: { marginLeft: z(8) },
  ctaSub: {
    color: P.TEXT_MUTE,
    fontSize: z(12),
    fontWeight: '500',
    textAlign: 'center',
    marginTop: z(9),
  },

  // ── Footer ──
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: z(8),
    gap: z(8),
    flexWrap: 'wrap',
  },
  footerLink: {
    color: P.FOOTER,
    fontSize: z(11.5),
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  footerDot: { color: P.FOOTER_DOT, fontSize: z(11.5) },
  });
};

export default SubscriptionScreen;
