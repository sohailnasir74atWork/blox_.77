// OfferWall.jsx — Blox Fruit Values Pro (custom paywall)
//
// Replaces the RevenueCatUI paywall (react-native-purchases-ui) with a screen
// built on react-native-purchases only, ported from the Adopt Me app.
//
// ONE wall, one offering ('default'). Owner's call (2026-10-11): no second
// discount wall, and the discounted 'paywallrc' offering is no longer shown.
// Callers still pass `showoffer` and `oneWallOnly`; both are ignored.
//
// It LOOKS LIKE ONBOARDING, on purpose. The first-run flow is welcome → sign
// in → this wall, and a dark storefront at step three read as leaving the app.
// So it follows the app theme on onboarding's own background, shows the same
// logo, and its button is onboarding's Continue button: same colour
// (config.colors.hasBlockGreen), same corners, same word. The MM2 and Adopt
// Me walls are this same screen in their own brand colour.
//
// Every price and discount is computed from live store prices, never
// hardcoded, so it stays true in every currency.
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, Modal, TouchableOpacity, Image,
  StyleSheet, StatusBar, ActivityIndicator,
  Dimensions, Linking, ScrollView, Alert, Animated, Easing,
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
} from '../Helper/growthAnalytics';
import config from '../Helper/Environment';
import {
  getPaywallOfferings, purchasePaywallPackage, restorePaywallPurchases, OFFERING_MAIN,
} from './PayWall';

const { width, height } = Dimensions.get('window');
const SMALL = height < 700;

// The logo onboarding shows (OnBoardingScreen.js picks it the same way).
const LOGO = config.isNoman ? require('../../assets/icon.webp') : require('../../assets/appstore.png');

const TERMS_URL = 'https://bloxfruitscalc.com/terms';
const PRIVACY_URL = 'https://bloxfruitscalc.com/privacy-policy/';

// Seconds before the × appears. Nothing is shown in its place while it waits;
// it simply appears. Owner's call (2026-10-11): 7 s on the first-run wall at
// the end of onboarding, 5 s everywhere else.
const CLOSE_DELAY_ONBOARDING = 7;
const CLOSE_DELAY = 5;

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
  });

// Every line is a real gate in the code:
//   no ads      → banner / interstitial / feed ads skip Pro (HomeScreen, Trades, IntAd)
//   boost       → Trades.jsx handleMakeFeatureTrade is Pro-only (or a paid feature)
//   badge       → assets/pro.png beside the name on trades and posts
//   translate   → MessagesList: Pro is unlimited, free is 5 a day
//   mystery     → HomeTabScreen premium game
const BENEFITS = [
  { key: 'noads', icon: 'close-circle', tint: BRAND, title: 'No ads', desc: 'No banners, no pop-ups, no ads between trades.' },
  { key: 'boost', icon: 'rocket', tint: ACCENT, title: 'Boost your trades', desc: 'Feature your trades at the top of the feed.' },
  { key: 'badge', image: require('../../assets/pro.png'), tint: GOLD, title: 'Pro badge', desc: 'Shown next to your name on trades and posts.' },
];
// Translation keys; translated where rendered.
const EXTRAS = ['settings.offer_wall.extra_translation', 'settings.offer_wall.extra_mystery'];

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

// Rebuild a price string at a different amount, keeping the store's currency
// symbol: Hermes' Intl often prints the ISO code ("PKR 550.00") where the
// store's own priceString says "Rs 550.00", so the code is swapped back.
const formatMoney = (pkg, amount) => {
  const currency = pkg?.product?.currencyCode;
  const priceString = pkg?.product?.priceString || '';
  const symbol = priceString.replace(/[\d\s.,]/g, '').trim();
  if (currency) {
    try {
      const out = new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
      return symbol && out.includes(currency) ? out.replace(currency, symbol).replace(/\s+/g, ' ').trim() : out;
    } catch (e) { /* fall through */ }
  }
  const value = amount.toFixed(2);
  if (!symbol) return value;
  const firstDigit = priceString.search(/\d/);
  const symbolIndex = priceString.indexOf(symbol[0]);
  return (firstDigit !== -1 && symbolIndex > firstDigit) ? `${value} ${symbol}` : `${symbol}${value}`;
};

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

const sortPackages = (offering) =>
  (offering?.availablePackages || []).slice().sort(
    (a, b) => (PLAN_ORDER[a.packageType] ?? 9) - (PLAN_ORDER[b.packageType] ?? 9)
  );

const SubscriptionScreen = ({ visible, onClose, track }) => {
  const insets = useSafeAreaInsets();
  const { refreshCustomerInfo } = useLocalState();
  const { theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();

  const isDark = theme === 'dark';
  const P = useMemo(() => makePalette(isDark), [isDark]);
  const s = useMemo(() => makeStyles(P), [P]);

  const closeDelay = paywallPlacement(track) === 'onboarding' ? CLOSE_DELAY_ONBOARDING : CLOSE_DELAY;

  const [offerings, setOfferings] = useState(null); // { default, paywallrc }; null while loading
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [canClose, setCanClose] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const riseAnim = useRef(new Animated.Value(28)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const closeFade = useRef(new Animated.Value(0)).current;

  // ── Open: load offerings, log the view ──
  useEffect(() => {
    if (!visible) return undefined;
    let alive = true;
    setSelectedPkg(null);
    trackPaywallView(track);
    getPaywallOfferings().then((o) => { if (alive) setOfferings(o); });
    return () => { alive = false; };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const offering = offerings?.[OFFERING_MAIN] || null;

  // ── Pricing: each plan vs. the priciest per-month rate (monthly) ──
  const plans = useMemo(() => {
    const list = sortPackages(offering);
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
      const compareAt = (anchorRate && months) ? anchorRate * months : null;
      // Anything under 5% reads as a rounding artefact, so it is not claimed.
      const pct = (compareAt && price > 0 && compareAt > price) ? Math.round((1 - price / compareAt) * 100) : 0;
      const savings = pct >= 5 ? pct : 0;
      const saved = savings ? compareAt - price : 0;
      // "Like 6 months free" — the saving in months of the monthly plan.
      // Floored on purpose: better to undersell than to round a claim up.
      const freeMonths = (savings && anchorRate) ? Math.floor(saved / anchorRate) : 0;
      return { pkg, rate, savings, saved, freeMonths };
    });
  }, [offering]);

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

  const selectedPlan = useMemo(
    () => plans.find((p) => p.pkg.identifier === selectedPkg?.identifier) || null,
    [plans, selectedPkg]
  );

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
  }, [visible, closeDelay, closeFade]);

  // ── Entrance ──
  useEffect(() => {
    if (!visible) return;
    fadeAnim.setValue(0);
    riseAnim.setValue(28);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(riseAnim, { toValue: 0, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [visible, fadeAnim, riseAnim]);

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

  const handleClose = useCallback(() => {
    if (loading) return;
    trackPaywallClose(track);
    finish();
  }, [loading, track, finish]);

  const handleSelect = useCallback((pkg) => {
    triggerHapticFeedback('impactLight');
    setSelectedPkg(pkg);
  }, [triggerHapticFeedback]);

  const handlePurchase = useCallback(async () => {
    if (!selectedPkg || loading) return;
    triggerHapticFeedback('impactMedium');
    setLoading(true);
    const r = await purchasePaywallPackage(selectedPkg);
    setLoading(false);
    if (r.pro) {
      trackProPurchase(selectedPkg, track);
      showSuccessMessage(t('alert.success', { defaultValue: 'Success' }), t('paywall.welcome_pro', { defaultValue: 'Welcome to Pro!' }));
      finish();
    } else if (!r.cancelled) {
      // Alert, not a flash message: those render underneath a full-screen Modal.
      Alert.alert(t('alert.error', { defaultValue: 'Error' }), t('paywall.purchase_failed', { defaultValue: 'Purchase failed. Please try again.' }));
    }
  }, [selectedPkg, loading, triggerHapticFeedback, finish, track, t]);

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

  // The line under the button says exactly what is charged, and when.
  const ctaSubtitle = (() => {
    const price = selectedPkg?.product?.priceString;
    if (!price) return null;
    if (selectedPkg.packageType === 'LIFETIME') return t('settings.offer_wall.lifetime_once', { price });
    return t(BILLED_LABEL[selectedPkg.packageType] || 'settings.offer_wall.renews_default', { price });
  })();

  return (
    <Modal visible={!!visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={canClose ? handleClose : undefined}>
      <View style={s.container}>
        <StatusBar barStyle={P.STATUS_STYLE} />
        <Backdrop P={P} />

        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.scrollContent, { paddingTop: insets.top + 18 }]}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: riseAnim }] }}>
            {/* Onboarding's logo, so step three still reads as the same app */}
            <View style={s.hero}>
              <Image resizeMethod="resize" source={LOGO} style={s.logo} resizeMode="contain" />
              <Text style={s.title}>{t('paywall.title', { defaultValue: 'Blox Fruit Values Pro' })}</Text>
              <Text style={s.subtitle}>{t('paywall.subtitle', { defaultValue: 'Trade faster, with no ads in your way.' })}</Text>
            </View>

            <View style={s.card}>
              {BENEFITS.map((b, i) => (
                <View key={b.key} style={[s.benefit, i > 0 && s.benefitDivider]}>
                  <View style={[s.benefitIcon, { backgroundColor: tint(b.tint, 0.15) }]}>
                    {b.image
                      ? <Image resizeMethod="resize" source={b.image} style={s.benefitBadge} resizeMode="contain" />
                      : <Icon name={b.icon} size={19} color={b.tint} />}
                  </View>
                  <View style={s.benefitText}>
                    <Text style={s.benefitTitle}>{t(`paywall.${b.key}_title`, { defaultValue: b.title })}</Text>
                    <Text style={s.benefitDesc}>{t(`paywall.${b.key}_desc`, { defaultValue: b.desc })}</Text>
                  </View>
                </View>
              ))}
              <View style={s.extrasRow}>
                <Icon name="add-circle" size={13} color={P.TEXT_MUTE} />
                <Text style={s.extras} numberOfLines={2}>{EXTRAS.map((k) => t(k)).join(' · ')}</Text>
              </View>
            </View>
          </Animated.View>
        </ScrollView>

        {/* Close — pinned, never scrolls away; absent until the delay ends */}
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

        <View style={[s.dock, { paddingBottom: DOCK_PAD + insets.bottom }]}>
          {plans.length > 0 ? (
            <>
              <View style={s.tiles}>
                {plans.map(({ pkg, rate, savings }, i) => {
                  const isSelected = selectedPkg?.identifier === pkg.identifier;
                  const isBest = plans.length > 1 && recommended?.identifier === pkg.identifier && savings > 0;
                  const showPerMonth = rate != null && pkg.packageType !== 'MONTHLY' && pkg.packageType !== 'LIFETIME';
                  return (
                    <TouchableOpacity
                      key={pkg.identifier || i}
                      onPress={() => handleSelect(pkg)}
                      activeOpacity={0.9}
                      style={[s.tile, isSelected && s.tileOn]}
                    >
                      {savings > 0 && (
                        <View style={s.saveTag}>
                          <Text style={s.saveTagText}>{t('paywall.save', { percent: savings })}</Text>
                        </View>
                      )}
                      {isBest && <Text style={s.bestLabel}>{t('settings.offer_wall.best_deal')}</Text>}
                      <Text style={[s.tilePlan, isSelected && s.tilePlanOn]} numberOfLines={1}>
                        {(PLAN_LABEL[pkg.packageType] && t(PLAN_LABEL[pkg.packageType])) || pkg.product?.title || pkg.identifier}
                      </Text>
                      <Text style={[s.tilePrice, isSelected && s.tilePriceOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                        {pkg.product?.priceString || '—'}
                      </Text>
                      {/* Reserved line so all tiles stay the same height */}
                      <Text style={[s.tilePerMonth, isSelected && s.tilePerMonthOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                        {showPerMonth ? t('settings.offer_wall.per_month', { price: formatMoney(pkg, rate) }) : ' '}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {!!selectedPlan && selectedPlan.savings > 0 && (
                <View style={s.savingsBar}>
                  <Text style={s.savingsText} numberOfLines={1}>
                    {t('settings.offer_wall.you_save', { amount: formatMoney(selectedPlan.pkg, selectedPlan.saved) })}
                    {selectedPlan.freeMonths >= 1
                      ? '  ·  ' + t('paywall.free_months', { count: selectedPlan.freeMonths })
                      : ''}
                  </Text>
                </View>
              )}
            </>
          ) : (
            <View style={s.loadingWrap}>
              {offerings
                ? <Text style={s.loadingText}>{t('paywall.unavailable', { defaultValue: 'Plans are unavailable right now. Check your connection.' })}</Text>
                : <><ActivityIndicator size="small" color={BRAND} /><Text style={s.loadingText}>{t('settings.offer_wall.loading_plans')}</Text></>}
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
                  {/* "Continue", like every onboarding step before it */}
                  <Text style={s.ctaText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                    {t('paywall.cta', { defaultValue: 'Continue' })}
                  </Text>
                  <Icon name="arrow-forward" size={19} color="#FFFFFF" style={s.ctaArrow} />
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>

          {!!ctaSubtitle && <Text style={s.ctaSub} numberOfLines={2}>{ctaSubtitle}</Text>}

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
    </Modal>
  );
};

const DOCK_PAD = 10;
const FOOTER_SLOP = { top: 10, bottom: 10, left: 8, right: 8 };

// Rebuilt whenever the theme flips; memoised by the component.
const makeStyles = (P) => StyleSheet.create({
  container: { flex: 1, backgroundColor: P.BG },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 10 },

  hero: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: SMALL ? 12 : 16 },
  logo: { width: SMALL ? 88 : 104, height: SMALL ? 88 : 104, borderRadius: 18 },
  title: {
    color: P.TEXT, fontSize: SMALL ? 26 : 28, fontWeight: '900', letterSpacing: -0.8,
    marginTop: 12, textAlign: 'center',
  },
  subtitle: {
    color: P.TEXT_SUB, fontSize: 13.5, fontWeight: '600', lineHeight: 18,
    marginTop: 6, textAlign: 'center',
  },

  card: {
    marginHorizontal: 18, backgroundColor: P.CARD, borderRadius: 20,
    borderWidth: 1, borderColor: P.CARD_LINE, paddingHorizontal: 14, paddingVertical: 4,
  },
  benefit: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  benefitDivider: { borderTopWidth: 1, borderTopColor: P.DIVIDER },
  benefitIcon: {
    width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 13,
  },
  benefitBadge: { width: 23, height: 23 },
  benefitText: { flex: 1 },
  benefitTitle: { color: P.TEXT, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  benefitDesc: { color: P.TEXT_SUB, fontSize: 12, fontWeight: '500', lineHeight: 16, marginTop: 2 },
  extrasRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderTopWidth: 1, borderTopColor: P.DIVIDER, paddingVertical: 9,
  },
  extras: { flex: 1, color: P.TEXT_MUTE, fontSize: 11.5, fontWeight: '600', lineHeight: 16 },

  closeWrap: { position: 'absolute', right: 16, zIndex: 10, elevation: 10 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: P.CLOSE_BG,
    alignItems: 'center', justifyContent: 'center',
  },

  dock: {
    paddingHorizontal: 16, paddingTop: 14, borderTopWidth: 1,
    borderTopColor: P.DOCK_LINE, backgroundColor: P.DOCK_BG,
  },
  tiles: { flexDirection: 'row', gap: 9, marginTop: 7 },
  tile: {
    flex: 1, minWidth: 0, borderRadius: 16, borderWidth: 2, borderColor: P.CARD_LINE,
    backgroundColor: P.CARD, paddingTop: 13, paddingBottom: 11, paddingHorizontal: 6,
    alignItems: 'center',
  },
  // No elevation: a translucent fill with an Android shadow shows the shadow
  // through as a dark box. The brand border carries the selection.
  tileOn: { borderColor: BRAND, backgroundColor: P.TILE_ON },
  saveTag: {
    position: 'absolute', top: -9, alignSelf: 'center', backgroundColor: BRAND,
    paddingHorizontal: 8, paddingVertical: 2.5, borderRadius: 999,
  },
  saveTagText: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '900', letterSpacing: 0.3 },
  bestLabel: { color: P.BRAND_TEXT, fontSize: 8.5, fontWeight: '900', letterSpacing: 0.7, marginBottom: 2 },
  tilePlan: { color: P.TEXT_SUB, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.2 },
  tilePlanOn: { color: P.TEXT },
  tilePrice: { color: P.TEXT, fontSize: 21, fontWeight: '900', letterSpacing: -0.7, marginTop: 3 },
  tilePriceOn: { color: P.BRAND_TEXT },
  tilePerMonth: { color: P.TEXT_MUTE, fontSize: 10.5, fontWeight: '700', marginTop: 2 },
  tilePerMonthOn: { color: P.TEXT_SUB },

  savingsBar: {
    marginTop: 9, alignSelf: 'center', backgroundColor: P.TILE_ON,
    borderWidth: 1, borderColor: P.SAVINGS_LINE, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 5, maxWidth: '100%',
  },
  savingsText: { color: P.BRAND_TEXT, fontSize: 12, fontWeight: '800', textAlign: 'center' },

  loadingWrap: { alignItems: 'center', paddingVertical: 26 },
  loadingText: { color: P.TEXT_MUTE, fontSize: 12, fontWeight: '600', marginTop: 8, textAlign: 'center' },

  // Onboarding's Continue button, a little taller
  cta: {
    height: 54, borderRadius: 12, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center',
    marginTop: 11, shadowColor: BRAND, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 4,
  },
  ctaOff: { opacity: 0.55 },
  ctaInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18 },
  ctaText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', flexShrink: 1 },
  ctaArrow: { marginLeft: 8 },
  ctaSub: { color: P.TEXT_MUTE, fontSize: 11.5, fontWeight: '600', textAlign: 'center', marginTop: 9 },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 9, gap: 8, flexWrap: 'wrap',
  },
  footerLink: { color: P.FOOTER, fontSize: 11, fontWeight: '600', textDecorationLine: 'underline' },
  footerDot: { color: P.FOOTER_DOT, fontSize: 11 },
});

export default SubscriptionScreen;
