// OnBoardingScreen.js — the three first-run steps (Blox Fruits).
//
//   1. what the app does   three fruits and what they are worth
//   2. your trade          a trade feed, yours third in the list; sign in
//   3. the offer           OfferWall: the same trade on top, with Pro
//
// One story and one skeleton (onboardingKit.js): progress bar, title, one
// picture, one button. Step 2 shows the trade where it sits today; step 3
// shows the same trade on top — the only thing that changed is Pro. Owner
// approved the flow on the MM2 build on 2026-11-10; this is the same screen
// with this app's fruits, colour and wording.
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar, Image,
  Animated, Easing, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import SignInDrawer from '../Firebase/SigninDrawer';
import SubscriptionScreen from '../SettingScreen/OfferWall';
import config from '../Helper/Environment';
import {
  unitFor, isCompact, FONT_CAP, MAX_COLUMN, kitColors,
  ProgressBar, TradeCard, ValueRow,
  VALUE_ROW_ITEMS, MY_TRADE_ITEMS, OTHER_TRADES, liveSampleValues,
} from './onboardingKit';

const LOGO = config.isNoman ? require('../../assets/icon.webp') : require('../../assets/appstore.png');
const STEPS = 3;
// This screen's own backgrounds (not the app surface); the offer wall uses
// the same two, so step 3 does not change colour.
const BG_DARK = '#0f172a';
const BG_LIGHT = '#f2f2f7';

const OnboardingScreen = ({ onFinish, selectedTheme }) => {
  const [screenIndex, setScreenIndex] = useState(0);
  const [openSignin, setOpenSignin] = useState(false);
  const { theme, user, single_offer_wall } = useGlobalState();
  const { localState } = useLocalState();
  const { t } = useTranslation();
  const isDarkMode = theme === 'dark' || selectedTheme === 'dark';

  // The app is edge to edge and onboarding sits directly under the root
  // SafeAreaProvider, so these are the window's real insets.
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const u = unitFor(winW);
  const compact = isCompact(winH);
  const C = kitColors(isDarkMode);
  const s = useMemo(() => makeStyles(u, compact, C), [u, compact, isDarkMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNext = () => {
    if (screenIndex === 0) {
      setScreenIndex(1);
    } else if (screenIndex === 1) {
      user?.id ? setScreenIndex(2) : setOpenSignin(true);
    } else {
      onFinish();
    }
  };

  // Every first-run path ends on the offer wall: values → your trade (sign in
  // or guest) → offer wall → home. The wall's own close button calls onFinish.
  const handleGuest = () => {
    trackGrowthEvent('onboarding_guest_continue');
    setScreenIndex(2);
  };

  // The sheet closes for a sign-in and for a plain dismiss alike. Either way
  // the person stays on step 2: signed in, it now greets them by name and its
  // button reads Continue.
  const handleLoginSuccess = () => {
    setOpenSignin(false);
  };

  // ── Each step slides in from the side it comes from ──
  const enter = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [screenIndex, enter]);
  const slide = {
    opacity: enter,
    transform: [{ translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }],
  };

  // The trade the story follows: yours when signed in, a sample trader's when not.
  const signedIn = !!user?.id;
  const myName = (signedIn && user?.displayName) ? user.displayName : t('paywall.sample_name');
  const myAvatar = signedIn ? (user?.avatar || null) : null;
  const values = useMemo(() => liveSampleValues(localState), [localState?.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (screenIndex === 2) {
    return (
      <SubscriptionScreen
        visible
        onClose={onFinish}
        track="On Boarding"
        progress={{ step: 3, total: STEPS }}
        oneWallOnly={single_offer_wall}
        showoffer={!single_offer_wall}
      />
    );
  }

  const first = screenIndex === 0;
  const welcome = t('app.onboarding.welcome_user', { name: user?.displayName || t('app.onboarding.anonymous') });

  return (
    <GestureHandlerRootView style={s.root}>
      <View style={[s.container, { backgroundColor: isDarkMode ? BG_DARK : BG_LIGHT }]}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

        <View style={[s.page, { paddingTop: insets.top + s.pagePad.top, paddingBottom: Math.max(insets.bottom, 10) + s.pagePad.bottom }]}>
          <ProgressBar step={screenIndex + 1} total={STEPS} u={u} isDark={isDarkMode} />

          <Animated.View style={[s.body, slide]}>
            <View style={s.head}>
              <Image resizeMethod="resize" source={LOGO} style={s.logo} resizeMode="contain" />
              <Text style={s.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={FONT_CAP}>
                {first ? t('first.values_title') : t('first.trade_title')}
              </Text>
              <Text style={s.sub} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP}>
                {first ? t('first.values_sub') : (signedIn ? welcome : t('first.trade_sub'))}
              </Text>
            </View>

            {first ? (
              <View style={s.art}>
                {VALUE_ROW_ITEMS.map((item) => (
                  <ValueRow key={item.name} u={u} isDark={isDarkMode} item={item} value={values[item.name] || item.snapshot} />
                ))}
              </View>
            ) : (
              <View style={s.art}>
                {OTHER_TRADES.map((tr) => (
                  <TradeCard key={tr.name} u={u} isDark={isDarkMode} compact={compact} dense variant="other" name={tr.name} items={tr.items} />
                ))}
                <TradeCard
                  u={u}
                  isDark={isDarkMode}
                  compact={compact}
                  variant="mine"
                  name={myName}
                  avatar={myAvatar}
                  items={MY_TRADE_ITEMS}
                />
              </View>
            )}
          </Animated.View>

          <View style={s.actions}>
            {/* Store-facing honesty line: this is a companion app. */}
            {first && (
              <Text style={s.note} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP}>{t('first.utility_note')}</Text>
            )}
            <TouchableOpacity style={s.button} onPress={handleNext} activeOpacity={0.9} accessibilityRole="button">
              <Text style={s.buttonText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={FONT_CAP}>
                {!first && !signedIn ? t('first.signin') : t('first.continue')}
              </Text>
            </TouchableOpacity>
            {!first && !signedIn && (
              <TouchableOpacity style={s.buttonOutline} onPress={handleGuest} activeOpacity={0.9} accessibilityRole="button">
                <Text style={s.buttonOutlineText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={FONT_CAP}>
                  {t('first.continue_guest', { defaultValue: 'Continue as Guest' })}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <SignInDrawer visible={openSignin} onClose={handleLoginSuccess} selectedTheme={selectedTheme} screen="On Boarding" />
      </View>
    </GestureHandlerRootView>
  );
};

const BRAND = config.colors.hasBlockGreen;

const makeStyles = (u, compact, C) => {
  const z = (n) => Math.round(n * u * 2) / 2;
  return {
    pagePad: { top: z(14), bottom: z(10) },
    ...StyleSheet.create({
      root: { flex: 1 },
      container: { flex: 1 },
      // One centred column; a tablet does not stretch it edge to edge.
      page: { flex: 1, width: '100%', maxWidth: MAX_COLUMN, alignSelf: 'center', paddingHorizontal: z(20) },
      // Head and picture share the free height equally, so a tall phone has no
      // empty band and a short one no squeeze.
      body: { flex: 1, justifyContent: 'space-evenly' },

      head: { alignItems: 'center' },
      logo: { width: z(compact ? 60 : 88), height: z(compact ? 60 : 88), borderRadius: z(16) },
      title: {
        color: C.TEXT,
        fontSize: z(27),
        lineHeight: z(33),
        fontWeight: '900',
        letterSpacing: -0.5,
        textAlign: 'center',
        marginTop: z(compact ? 8 : 14),
        alignSelf: 'stretch',
      },
      sub: {
        color: C.TEXT_SUB,
        fontSize: z(15),
        lineHeight: z(21),
        fontWeight: '500',
        textAlign: 'center',
        marginTop: z(6),
      },

      art: { gap: z(compact ? 8 : 10) },

      actions: { alignItems: 'stretch' },
      note: {
        color: C.TEXT_MUTE,
        fontSize: z(11.5),
        lineHeight: z(16),
        fontWeight: '500',
        textAlign: 'center',
        marginBottom: z(10),
      },
      button: {
        height: z(54),
        borderRadius: z(13),
        backgroundColor: BRAND,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: z(18),
      },
      buttonText: { color: '#FFFFFF', fontSize: z(17.5), fontWeight: '800' },
      buttonOutline: {
        height: z(50),
        borderRadius: z(13),
        borderWidth: 2,
        borderColor: BRAND,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: z(18),
        marginTop: z(10),
      },
      buttonOutlineText: { color: C.BRAND_TEXT, fontSize: z(16), fontWeight: '800' },
    }),
  };
};

export default OnboardingScreen;
