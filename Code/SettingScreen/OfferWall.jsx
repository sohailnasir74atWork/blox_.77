// OfferWall.jsx — Blox Fruit Values Pro (custom paywall)
//
// Replaces the RevenueCatUI paywall (react-native-purchases-ui) with a screen
// built on react-native-purchases only, ported from the Adopt Me app. The
// props and the two-step flow are the same as before, so every caller works
// unchanged:
//
//   oneWallOnly (remote flag)  → only the discounted 'paywallrc' offering
//   showoffer                  → 'default' first; closing it without buying
//                                shows the 'paywallrc' discount once
//   neither                    → 'default' only
//
// Every price and discount is computed from live store prices, never
// hardcoded, so it stays true in every currency.
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, Modal, TouchableOpacity, Image,
  StyleSheet, StatusBar, ActivityIndicator,
  Dimensions, Linking, ScrollView, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Defs, LinearGradient as SvgLinear, RadialGradient as SvgRadial, Stop, Rect, Circle,
} from 'react-native-svg';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../LocalGlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import { showSuccessMessage } from '../Helper/MessageHelper';
import {
  getPaywallOfferings, purchasePaywallPackage, restorePaywallPurchases,
  OFFERING_MAIN, OFFERING_DISCOUNT,
} from './PayWall';

const { width, height } = Dimensions.get('window');
const SMALL = height < 700;

// ── Palette ──
const INK = '#07111F';
const BLUE = '#3B82F6';
const CYAN = '#22D3EE';
const GOLD = '#FFC93C';
const GOLD_DEEP = '#FF9F1C';
const PINK = '#FF4D8D';
const TEXT = '#FFFFFF';
const TEXT_SUB = 'rgba(255,255,255,0.72)';
const TEXT_MUTE = 'rgba(255,255,255,0.46)';
const GLASS = 'rgba(255,255,255,0.06)';
const GLASS_LINE = 'rgba(255,255,255,0.10)';

const TERMS_URL = 'https://bloxfruitscalc.com/terms';
const PRIVACY_URL = 'https://bloxfruitscalc.com/privacy-policy/';

// Every line is a real gate in the code:
//   no ads      → banner / interstitial / feed ads skip Pro (HomeScreen, Trades, IntAd)
//   boost       → Trades.jsx handleMakeFeatureTrade is Pro-only (or a paid feature)
//   badge       → assets/pro.png beside the name on trades and posts
//   translate   → MessagesList: Pro is unlimited, free is 5 a day
//   mystery     → HomeTabScreen premium game
const BENEFITS = [
  { key: 'noads', icon: 'close-circle', tint: PINK, title: 'No ads', desc: 'No banners, no pop-ups, no ads between trades.' },
  { key: 'boost', icon: 'rocket', tint: BLUE, title: 'Boost your trades', desc: 'Feature your trades at the top of the feed.' },
  { key: 'badge', image: require('../../assets/pro.png'), tint: GOLD, title: 'Pro badge', desc: 'Shown next to your name on trades and posts.' },
];
const EXTRAS = ['Unlimited chat translation', 'Mystery Fruit game'];

const PLAN_ORDER = { LIFETIME: 0, ANNUAL: 1, SIX_MONTH: 2, THREE_MONTH: 3, TWO_MONTH: 4, MONTHLY: 5, WEEKLY: 6 };
const MONTHS_IN_PERIOD = { WEEKLY: 0.2301, MONTHLY: 1, TWO_MONTH: 2, THREE_MONTH: 3, SIX_MONTH: 6, ANNUAL: 12 };
const PLAN_LABEL = {
  WEEKLY: 'Weekly', MONTHLY: 'Monthly', TWO_MONTH: '2 Months', THREE_MONTH: '3 Months',
  SIX_MONTH: '6 Months', ANNUAL: 'Yearly', LIFETIME: 'Lifetime',
};
const BILLED_LABEL = {
  WEEKLY: 'billed weekly', MONTHLY: 'billed monthly', TWO_MONTH: 'billed every 2 months',
  THREE_MONTH: 'billed every 3 months', SIX_MONTH: 'billed every 6 months', ANNUAL: 'billed yearly',
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

const Backdrop = () => (
  <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
    <Defs>
      <SvgRadial id="glowTop" cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor={BLUE} stopOpacity="0.55" />
        <Stop offset="1" stopColor={BLUE} stopOpacity="0" />
      </SvgRadial>
      <SvgRadial id="glowBottom" cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor={CYAN} stopOpacity="0.25" />
        <Stop offset="1" stopColor={CYAN} stopOpacity="0" />
      </SvgRadial>
    </Defs>
    <Rect x="0" y="0" width="100%" height="100%" fill={INK} />
    <Circle cx={width * 0.5} cy={height * 0.05} r={width * 0.85} fill="url(#glowTop)" />
    <Circle cx={width * 0.1} cy={height * 0.62} r={width * 0.7} fill="url(#glowBottom)" />
  </Svg>
);

const sortPackages = (offering) =>
  (offering?.availablePackages || []).slice().sort(
    (a, b) => (PLAN_ORDER[a.packageType] ?? 9) - (PLAN_ORDER[b.packageType] ?? 9)
  );

const SubscriptionScreen = ({ visible, onClose, track, showoffer, oneWallOnly }) => {
  const insets = useSafeAreaInsets();
  const { refreshCustomerInfo } = useLocalState();
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();

  const [offerings, setOfferings] = useState(null); // { default, paywallrc }
  const [stage, setStage] = useState(OFFERING_MAIN); // which offering is on screen
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const shownDiscountRef = useRef(false);

  // ── Open: load offerings, pick the first wall ──
  useEffect(() => {
    if (!visible) return undefined;
    let alive = true;
    shownDiscountRef.current = false;
    setSelectedPkg(null);
    setStage(oneWallOnly ? OFFERING_DISCOUNT : OFFERING_MAIN);
    getPaywallOfferings().then((o) => { if (alive) setOfferings(o); });
    return () => { alive = false; };
  }, [visible, oneWallOnly]);

  // The offering actually shown, with the same fallbacks as the old flow.
  const offering = useMemo(() => {
    if (!offerings) return null;
    return stage === OFFERING_DISCOUNT
      ? (offerings[OFFERING_DISCOUNT] || offerings[OFFERING_MAIN])
      : (offerings[OFFERING_MAIN] || offerings[OFFERING_DISCOUNT]);
  }, [offerings, stage]);
  const isDiscount = !!offering && offering.identifier === OFFERING_DISCOUNT;

  // ── Pricing ──
  // Main wall: each plan vs. the priciest per-month rate (monthly), as Adopt
  // Me does. Discount wall: each plan vs. the same plan on the main offering,
  // which is what the discount actually is.
  const plans = useMemo(() => {
    const list = sortPackages(offering);
    const monthlyRate = (p) => {
      const months = MONTHS_IN_PERIOD[p.packageType];
      const price = p.product?.price;
      return months && price > 0 ? price / months : null;
    };
    const mainByType = {};
    for (const p of sortPackages(offerings?.[OFFERING_MAIN])) mainByType[p.packageType] = p;
    const rates = list.map(monthlyRate).filter((r) => r != null);
    const anchorRate = rates.length ? Math.max(...rates) : null;

    return list.map((pkg) => {
      const price = pkg.product?.price;
      const rate = monthlyRate(pkg);
      let compareAt = null;
      if (isDiscount) {
        const regular = mainByType[pkg.packageType]?.product?.price;
        if (regular > 0) compareAt = regular;
      } else if (anchorRate && MONTHS_IN_PERIOD[pkg.packageType]) {
        compareAt = anchorRate * MONTHS_IN_PERIOD[pkg.packageType];
      }
      const pct = (compareAt && price > 0 && compareAt > price) ? Math.round((1 - price / compareAt) * 100) : 0;
      const savings = pct >= 5 ? pct : 0;
      return { pkg, rate, savings, saved: savings ? compareAt - price : 0, compareAt: savings ? compareAt : null };
    });
  }, [offering, offerings, isDiscount]);

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

  const finish = useCallback(() => {
    refreshCustomerInfo?.().catch?.(() => {});
    onClose?.();
  }, [onClose, refreshCustomerInfo]);

  // Closing the main wall shows the discount once (old two-wall flow).
  const handleClose = useCallback(() => {
    if (loading) return;
    if (stage === OFFERING_MAIN && showoffer && !oneWallOnly && !shownDiscountRef.current && offerings?.[OFFERING_DISCOUNT]) {
      shownDiscountRef.current = true;
      setSelectedPkg(null);
      setStage(OFFERING_DISCOUNT);
      return;
    }
    finish();
  }, [loading, stage, showoffer, oneWallOnly, offerings, finish]);

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
      showSuccessMessage(t('alert.success', { defaultValue: 'Success' }), t('paywall.welcome_pro', { defaultValue: 'Welcome to Pro!' }));
      finish();
    } else if (!r.cancelled) {
      // Alert, not a flash message: those render underneath a full-screen Modal.
      Alert.alert(t('alert.error', { defaultValue: 'Error' }), t('paywall.purchase_failed', { defaultValue: 'Purchase failed. Please try again.' }));
    }
  }, [selectedPkg, loading, triggerHapticFeedback, finish, t]);

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

  const ctaSubtitle = (() => {
    const price = selectedPkg?.product?.priceString;
    if (!price) return null;
    if (selectedPkg.packageType === 'LIFETIME') return `${price} once. No subscription.`;
    const billed = BILLED_LABEL[selectedPkg.packageType] || '';
    return `${price} ${billed}. Renews automatically, cancel anytime.`.replace(/\s+\./, '.');
  })();

  return (
    <Modal visible={!!visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={handleClose}>
      <View style={s.container}>
        <StatusBar barStyle="light-content" />
        <Backdrop />

        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.scrollContent, { paddingTop: insets.top + 14 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.hero}>
            <View style={s.heroRing}>
              <Image source={require('../../assets/pro.png')} style={s.heroImage} resizeMode="contain" />
            </View>
            {isDiscount && (
              <View style={s.offerTag}>
                <Text style={s.offerTagText}>{t('paywall.special_offer', { defaultValue: 'SPECIAL OFFER' })}</Text>
              </View>
            )}
            <Text style={s.title}>{t('paywall.title', { defaultValue: 'Blox Fruit Values Pro' })}</Text>
            <Text style={s.subtitle}>
              {isDiscount
                ? t('paywall.subtitle_offer', { defaultValue: 'The same Pro, for less. This price is only on this screen.' })
                : t('paywall.subtitle', { defaultValue: 'Trade faster, with no ads in your way.' })}
            </Text>
          </View>

          <View style={s.card}>
            {BENEFITS.map((b, i) => (
              <View key={b.key} style={[s.benefit, i > 0 && s.benefitDivider]}>
                <View style={[s.benefitIcon, { backgroundColor: b.tint + '26' }]}>
                  {b.image
                    ? <Image source={b.image} style={s.benefitBadge} resizeMode="contain" />
                    : <Icon name={b.icon} size={19} color={b.tint} />}
                </View>
                <View style={s.benefitText}>
                  <Text style={s.benefitTitle}>{t(`paywall.${b.key}_title`, { defaultValue: b.title })}</Text>
                  <Text style={s.benefitDesc}>{t(`paywall.${b.key}_desc`, { defaultValue: b.desc })}</Text>
                </View>
              </View>
            ))}
            <View style={s.extrasRow}>
              <Icon name="add-circle" size={13} color={TEXT_MUTE} />
              <Text style={s.extras} numberOfLines={2}>{EXTRAS.join(' · ')}</Text>
            </View>
          </View>
        </ScrollView>

        <View style={[s.closeWrap, { top: insets.top + 10 }]} pointerEvents="box-none">
          <TouchableOpacity
            onPress={handleClose}
            style={s.closeBtn}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            accessibilityLabel="Close"
          >
            <Icon name="close" size={19} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
        </View>

        <View style={[s.dock, { paddingBottom: DOCK_PAD + insets.bottom }]}>
          {plans.length > 0 ? (
            <>
              <View style={s.tiles}>
                {plans.map(({ pkg, rate, savings, compareAt }, i) => {
                  const isSelected = selectedPkg?.identifier === pkg.identifier;
                  const isBest = recommended?.identifier === pkg.identifier && savings > 0;
                  const showPerMonth = rate != null && pkg.packageType !== 'MONTHLY' && pkg.packageType !== 'LIFETIME';
                  return (
                    <TouchableOpacity
                      key={pkg.identifier || i}
                      onPress={() => handleSelect(pkg)}
                      activeOpacity={0.9}
                      style={[s.tile, isSelected && s.tileOn]}
                    >
                      {savings > 0 && (
                        <View style={[s.saveTag, isSelected && s.saveTagOn]}>
                          <Text style={[s.saveTagText, isSelected && s.saveTagTextOn]}>-{savings}%</Text>
                        </View>
                      )}
                      {isBest && <Text style={s.bestLabel}>BEST DEAL</Text>}
                      <Text style={[s.tilePlan, isSelected && s.tilePlanOn]} numberOfLines={1}>
                        {PLAN_LABEL[pkg.packageType] || pkg.product?.title || pkg.identifier}
                      </Text>
                      <Text style={[s.tilePrice, isSelected && s.tilePriceOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                        {pkg.product?.priceString || '—'}
                      </Text>
                      <Text style={[s.tilePerMonth, isSelected && s.tilePerMonthOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                        {isDiscount && compareAt
                          ? `was ${formatMoney(pkg, compareAt)}`
                          : (showPerMonth ? `${formatMoney(pkg, rate)}/mo` : ' ')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {!!selectedPlan && selectedPlan.savings > 0 && (
                <View style={s.savingsBar}>
                  <Text style={s.savingsText} numberOfLines={1}>
                    You save {formatMoney(selectedPlan.pkg, selectedPlan.saved)}
                  </Text>
                </View>
              )}
            </>
          ) : (
            <View style={s.loadingWrap}>
              {offerings
                ? <Text style={s.loadingText}>{t('paywall.unavailable', { defaultValue: 'Plans are unavailable right now. Check your connection.' })}</Text>
                : <><ActivityIndicator size="small" color={GOLD} /><Text style={s.loadingText}>Loading plans…</Text></>}
            </View>
          )}

          <TouchableOpacity
            style={[s.cta, (loading || !selectedPkg) && s.ctaOff]}
            onPress={handlePurchase}
            disabled={loading || !selectedPkg}
            activeOpacity={0.9}
          >
            <Svg style={StyleSheet.absoluteFill}>
              <Defs>
                <SvgLinear id="ctaGrad" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor={GOLD} />
                  <Stop offset="1" stopColor={GOLD_DEEP} />
                </SvgLinear>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#ctaGrad)" />
            </Svg>
            {loading ? (
              <ActivityIndicator size="small" color={INK} />
            ) : (
              <View style={s.ctaInner}>
                <Text style={s.ctaText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                  {t('paywall.cta', { defaultValue: 'Get Pro' })}
                </Text>
                <Icon name="arrow-forward" size={19} color={INK} style={s.ctaArrow} />
              </View>
            )}
          </TouchableOpacity>

          {!!ctaSubtitle && <Text style={s.ctaSub} numberOfLines={2}>{ctaSubtitle}</Text>}

          <View style={s.footer}>
            <TouchableOpacity onPress={handleRestore} disabled={restoring} hitSlop={FOOTER_SLOP}>
              {restoring
                ? <ActivityIndicator size="small" color={GOLD} />
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

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: INK },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 10 },

  hero: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: SMALL ? 10 : 14 },
  heroRing: {
    width: SMALL ? 88 : 104, height: SMALL ? 88 : 104, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroImage: { width: SMALL ? 52 : 62, height: SMALL ? 52 : 62 },
  offerTag: {
    marginTop: 12, backgroundColor: PINK, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 4,
  },
  offerTagText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: {
    color: TEXT, fontSize: SMALL ? 28 : 32, fontWeight: '900', letterSpacing: -1,
    marginTop: 10, textAlign: 'center',
  },
  subtitle: {
    color: TEXT_SUB, fontSize: 13.5, fontWeight: '600', lineHeight: 18,
    marginTop: 6, textAlign: 'center',
  },

  card: {
    marginHorizontal: 18, backgroundColor: GLASS, borderRadius: 24,
    borderWidth: 1, borderColor: GLASS_LINE, paddingHorizontal: 14, paddingVertical: 4,
  },
  benefit: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  benefitDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' },
  benefitIcon: {
    width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 13,
  },
  benefitBadge: { width: 23, height: 23 },
  benefitText: { flex: 1 },
  benefitTitle: { color: TEXT, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  benefitDesc: { color: TEXT_SUB, fontSize: 12, fontWeight: '500', lineHeight: 16, marginTop: 2 },
  extrasRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', paddingVertical: 9,
  },
  extras: { flex: 1, color: TEXT_MUTE, fontSize: 11.5, fontWeight: '600', lineHeight: 16 },

  closeWrap: { position: 'absolute', right: 16, zIndex: 10, elevation: 10 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center',
  },

  dock: {
    paddingHorizontal: 16, paddingTop: 14, borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(4,10,20,0.92)',
  },
  tiles: { flexDirection: 'row', gap: 9, marginTop: 7 },
  tile: {
    flex: 1, minWidth: 0, borderRadius: 20, borderWidth: 2, borderColor: 'rgba(255,255,255,0.13)',
    backgroundColor: 'rgba(255,255,255,0.05)', paddingTop: 13, paddingBottom: 11, paddingHorizontal: 6,
    alignItems: 'center',
  },
  tileOn: {
    borderColor: GOLD, backgroundColor: 'rgba(255,201,60,0.13)', shadowColor: GOLD,
    shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  saveTag: {
    position: 'absolute', top: -9, alignSelf: 'center', backgroundColor: PINK,
    paddingHorizontal: 8, paddingVertical: 2.5, borderRadius: 999,
  },
  saveTagOn: { backgroundColor: GOLD },
  saveTagText: { color: '#fff', fontSize: 9.5, fontWeight: '900', letterSpacing: 0.3 },
  saveTagTextOn: { color: INK },
  bestLabel: { color: GOLD, fontSize: 8.5, fontWeight: '900', letterSpacing: 0.7, marginBottom: 2 },
  tilePlan: { color: TEXT_SUB, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.2 },
  tilePlanOn: { color: TEXT },
  tilePrice: { color: TEXT, fontSize: 21, fontWeight: '900', letterSpacing: -0.7, marginTop: 3 },
  tilePriceOn: { color: GOLD },
  tilePerMonth: { color: TEXT_MUTE, fontSize: 10.5, fontWeight: '700', marginTop: 2 },
  tilePerMonthOn: { color: TEXT_SUB },

  savingsBar: {
    marginTop: 9, alignSelf: 'center', backgroundColor: 'rgba(255,201,60,0.14)',
    borderWidth: 1, borderColor: 'rgba(255,201,60,0.3)', borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 5, maxWidth: '100%',
  },
  savingsText: { color: GOLD, fontSize: 12, fontWeight: '800', textAlign: 'center' },

  loadingWrap: { alignItems: 'center', paddingVertical: 26 },
  loadingText: { color: TEXT_MUTE, fontSize: 12, fontWeight: '600', marginTop: 8, textAlign: 'center' },

  cta: {
    height: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    marginTop: 11, shadowColor: GOLD_DEEP, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5, shadowRadius: 14, elevation: 9,
  },
  ctaOff: { opacity: 0.55 },
  ctaInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18 },
  ctaText: { color: INK, fontSize: 18, fontWeight: '900', letterSpacing: -0.2, flexShrink: 1 },
  ctaArrow: { marginLeft: 8 },
  ctaSub: { color: TEXT_MUTE, fontSize: 11.5, fontWeight: '600', textAlign: 'center', marginTop: 9 },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 9, gap: 8, flexWrap: 'wrap',
  },
  footerLink: { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '600', textDecorationLine: 'underline' },
  footerDot: { color: 'rgba(255,255,255,0.22)', fontSize: 11 },
});

export default SubscriptionScreen;
