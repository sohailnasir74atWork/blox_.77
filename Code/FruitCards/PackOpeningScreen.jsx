/**
 * PackOpeningScreen — the moment (adoptme PET_CARDS_PLAN.md §2.2; Blox: FRUIT_CARDS_PLAN.md).
 *
 *   sealed  → swipe across the top seal (or tap the button) to tear it
 *   opening → the server rolls the cards (open_card_pack); the seal flies off
 *   reveal  → one card at a time: tap to flip. Rare cards glow first
 *             ("the tease"); Legendary/Gilded get rays + flash; Mega/Full Art
 *             get rays, flash, sparkles and the heavy haptic
 *   summary → all three, what was new, shards, serials; share the best pull
 *
 * Star packs: stars (RTDB) are spent first and refunded if the server says no,
 * the same pattern as Mystery Egg.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Easing, PanResponder, useWindowDimensions,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ref, update, increment } from '@react-native-firebase/database';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import { getStarBalance, spendStars } from '../Engagement/starUtils';
import PackArt from './PackArt';
import FruitCard from './FruitCard';
import CardBack from './CardBack';
import CardShine from './CardShine';
import CardShareSheet from './CardShareSheet';
import CardIcon from './cardIcons';
import { openPack, errorKey, peekCardsState } from './cardsApi';
import { bestPull, revealTier } from './cardMath';
import { RARITY_STYLE, STAR_PACK_COST, themeOf, FINISH_STYLE } from './cardConfig';
import useDarkSystemBars from '../Helper/useDarkSystemBars';

const INK = '#F4ECFF';
const MUTED = 'rgba(244,236,255,0.65)';

function Rays({ color, size, visible }) {
  const spin = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: visible ? 1 : 0, duration: 380, useNativeDriver: true }).start();
    if (!visible) return undefined;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 16000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [visible, spin, fade]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', width: size, height: size, opacity: fade, transform: [{ rotate }] }}>
      {Array.from({ length: 14 }).map((_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute', left: size / 2 - size * 0.035, top: 0, width: size * 0.07, height: size,
            backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0) 0%, ${color} 50%, rgba(0,0,0,0) 100%)`,
            opacity: i % 2 ? 0.35 : 0.6,
            transform: [{ rotate: `${(i * 180) / 14}deg` }],
          }}
        />
      ))}
      <View style={{ position: 'absolute', left: size * 0.25, top: size * 0.25, width: size * 0.5, height: size * 0.5, borderRadius: size, backgroundImage: `radial-gradient(circle at 50% 50%, ${color} 0%, rgba(0,0,0,0) 70%)`, opacity: 0.8 }} />
    </Animated.View>
  );
}

function Sparkles({ run, color }) {
  const p = useRef(new Animated.Value(0)).current;
  const parts = useMemo(() => Array.from({ length: 18 }).map((_, i) => ({
    a: (i / 18) * Math.PI * 2 + Math.random() * 0.3, d: 120 + Math.random() * 140, s: 6 + Math.random() * 10,
  })), []);
  useEffect(() => {
    if (!run) return;
    p.setValue(0);
    Animated.timing(p, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [run, p]);
  if (!run) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: 1, height: 1 }}>
      {parts.map((q, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute', width: q.s, height: q.s, borderRadius: 2, backgroundColor: i % 3 ? color : '#FFFFFF',
            opacity: p.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
            transform: [
              { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(q.a) * q.d] }) },
              { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(q.a) * q.d] }) },
              { rotate: '45deg' },
              { scale: p.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.2, 1.2, 0.4] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

export default function PackOpeningScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { params } = useRoute();
  const insets = useSafeAreaInsets();
  const { width: W, height: Hs } = useWindowDimensions();
  const { appdatabase, user } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();

  const setId = params?.setId || 'all';
  const source = params?.source || 'free';
  const theme = themeOf(params?.theme);
  useDarkSystemBars(theme.stage[0]);
  const st = peekCardsState();
  const set = st?.sets?.find((s) => s.id === setId);
  // Collector numbers count across every card (the "All Pets" set).
  const total = st?.sets?.find((s) => s.id === 'all')?.total || null;

  const [phase, setPhase] = useState('sealed');
  const [result, setResult] = useState(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [charging, setCharging] = useState(false);
  const [fx, setFx] = useState(0);
  const [share, setShare] = useState(null);
  const [errKey, setErrKey] = useState(null);

  const tear = useRef(new Animated.Value(0)).current;      // 0..1 drag progress
  const sealY = useRef(new Animated.Value(0)).current;
  const sealR = useRef(new Animated.Value(0)).current;
  const packY = useRef(new Animated.Value(0)).current;
  const packShake = useRef(new Animated.Value(0)).current;
  const flip = useRef(new Animated.Value(0)).current;
  const tease = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const cardIn = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);

  const cards = result?.cards || [];
  const card = cards[index];
  const tier = revealTier(card);
  const cw = Math.min(W - 80, 320);
  const packW = Math.min(W * 0.55, 230);

  const doOpen = useCallback(async () => {
    if (busy.current || phase !== 'sealed') return;
    busy.current = true;
    setPhase('opening');
    triggerHapticFeedback('impactMedium');
    Animated.parallel([
      // The seal rides on the pack, which later slides down by Hs: fly far enough up to stay gone.
      Animated.timing(sealY, { toValue: -Hs * 1.8, duration: 650, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(sealR, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.loop(Animated.sequence([
        Animated.timing(packShake, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(packShake, { toValue: -1, duration: 60, useNativeDriver: true }),
      ]), { iterations: 4 }),
    ]).start();

    let spent = false;
    try {
      if (source === 'stars') {
        const bal = await getStarBalance(appdatabase, user?.id);
        if (bal < STAR_PACK_COST) {
          throw new Error(t('fruit_cards.need_stars', { cost: STAR_PACK_COST, balance: bal }));
        }
        const r = await spendStars(appdatabase, user?.id, STAR_PACK_COST);
        if (!r.success) throw new Error(r.error || 'stars');
        spent = true;
      }
      const data = await openPack(setId, source);
      setResult(data);
      trackGrowthEvent('card_pack_open', { set: setId, source });
      (data.cards || []).forEach((c) => trackGrowthEvent('card_pull', { rarity: c.rarity, finish: c.finish }));
      (data.completed || []).forEach((s) => trackGrowthEvent('card_set_complete', { set: s }));
      Animated.timing(packY, { toValue: Hs, duration: 520, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
        setPhase('reveal');
        cardIn.setValue(0);
        Animated.spring(cardIn, { toValue: 1, friction: 7, tension: 50, useNativeDriver: true }).start();
      });
    } catch (e) {
      if (spent && appdatabase && user?.id) {
        update(ref(appdatabase, `users/${user.id}/dailyStars`), { starBalance: increment(STAR_PACK_COST) }).catch(() => {});
      }
      const k = errorKey(e);
      setErrKey(k === 'generic' && e?.message && source === 'stars' ? e.message : `fruit_cards.err.${k}`);
      setPhase('error');
    } finally {
      busy.current = false;
    }
  }, [phase, source, setId, appdatabase, user?.id, t, triggerHapticFeedback, Hs, sealY, sealR, packShake, packY, cardIn]);

  // Star packs: say "not enough stars" before the pack is shown, not after it tears.
  useEffect(() => {
    if (source !== 'stars') return undefined;
    let live = true;
    (appdatabase && user?.id ? getStarBalance(appdatabase, user.id) : Promise.resolve(0)).then((bal) => {
      if (live && bal < STAR_PACK_COST) {
        setErrKey(t('fruit_cards.need_stars', { cost: STAR_PACK_COST, balance: bal }));
        setPhase('error');
      }
    }).catch(() => {});
    return () => { live = false; };
  }, [source, appdatabase, user?.id, t]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_, g) => {
      const v = Math.min(1, Math.abs(g.dx) / (packW * 0.8));
      tear.setValue(v);
      if (Math.round(v * 10) !== Math.round((v - 0.02) * 10)) triggerHapticFeedback('impactLight');
    },
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dx) > packW * 0.55 || (Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6)) {
        tear.setValue(1);
        doOpen();
      } else {
        Animated.spring(tear, { toValue: 0, useNativeDriver: false }).start();
      }
    },
  }), [packW, tear, doOpen, triggerHapticFeedback]);

  // The tease: a rare card's back glows before it turns.
  useEffect(() => {
    if (phase !== 'reveal' || flipped || !card) return undefined;
    tease.setValue(0);
    if (tier < 1) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(tease, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(tease, { toValue: 0.35, duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [phase, index, flipped, card, tier, tease]);

  const doFlip = useCallback(() => {
    if (!card || flipped || charging) return;
    const turn = () => {
      triggerHapticFeedback(tier >= 3 ? 'impactHeavy' : tier >= 2 ? 'notificationSuccess' : tier >= 1 ? 'impactMedium' : 'impactLight');
      Animated.timing(flip, { toValue: 1, duration: tier >= 2 ? 560 : 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      setTimeout(() => setFlipped(true), tier >= 2 ? 280 : 210);
      if (tier >= 2) {
        setFx(tier);
        flash.setValue(0);
        Animated.sequence([
          Animated.timing(flash, { toValue: tier >= 3 ? 0.95 : 0.7, duration: 120, useNativeDriver: true }),
          Animated.timing(flash, { toValue: 0, duration: 520, useNativeDriver: true }),
        ]).start();
      }
    };
    if (tier >= 2) {
      // Hold the suspense a beat longer for the big ones.
      setCharging(true);
      triggerHapticFeedback('impactLight');
      setTimeout(() => { setCharging(false); turn(); }, 750);
    } else {
      turn();
    }
  }, [card, flipped, charging, tier, flip, flash, triggerHapticFeedback]);

  const next = useCallback(() => {
    if (index >= cards.length - 1) {
      setPhase('summary');
      setFx(0);
      if (result?.completed?.length) triggerHapticFeedback('notificationSuccess');
      return;
    }
    setFx(0);
    setFlipped(false);
    flip.setValue(0);
    cardIn.setValue(0);
    setIndex(index + 1);
    Animated.spring(cardIn, { toValue: 1, friction: 7, tension: 50, useNativeDriver: true }).start();
  }, [index, cards.length, flip, cardIn, result, triggerHapticFeedback]);

  const wallet = result?.wallet;
  const again = wallet ? (wallet.freeReady ? 'free' : wallet.bonusPacks > 0 ? 'bonus' : wallet.starPacksLeft > 0 ? 'stars' : null) : null;
  const best = bestPull(cards);
  const glow = card ? (RARITY_STYLE[card.rarity] || RARITY_STYLE.common).glow : '#fff';

  const backRotate = flip.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '90deg', '90deg'] });
  const frontRotate = flip.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-90deg', '-90deg', '0deg'] });
  const enter = {
    opacity: cardIn,
    transform: [
      { translateY: cardIn.interpolate({ inputRange: [0, 1], outputRange: [Hs * 0.25, 0] }) },
      { scale: cardIn.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
    ],
  };

  const badges = (c) => (
    <View style={styles.badges}>
      {c.new ? <Badge text={t('fruit_cards.badge_new')} color="#22C55E" /> : null}
      {c.newFinish ? <Badge text={t('fruit_cards.badge_new_finish')} color="#38BDF8" /> : null}
      {c.dupe ? <Badge text={`+${c.shards} 💠`} color="#64748B" /> : null}
      {c.serial != null ? <Badge text={`#${String(c.serial).padStart(4, '0')}`} color="#D4A017" /> : null}
    </View>
  );

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom, backgroundImage: `radial-gradient(ellipse 80% 55% at 50% 42%, ${theme.stage[2]} 0%, ${theme.stage[1]} 45%, ${theme.stage[0]} 100%)` }]}>
      <View style={[styles.top, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Icon name="close" size={26} color={INK} />
        </TouchableOpacity>
        {phase === 'reveal' ? <Text style={styles.counter}>{index + 1} / {cards.length}</Text> : <View />}
        <View style={{ width: 26 }} />
      </View>

      {/* spotlight */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundImage: 'radial-gradient(ellipse 45% 35% at 50% 38%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 100%)' }]} />

      {(phase === 'sealed' || phase === 'opening') ? (
        <View style={styles.center}>
          <Animated.View
            {...pan.panHandlers}
            style={{ transform: [{ translateY: packY }, { translateX: packShake.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] }) }] }}
          >
            <PackArt
              width={packW}
              theme={params?.theme || 'sea'}
              title={t(`fruit_cards.sets.${setId}`, { defaultValue: set?.names?.en || '' })}
              subtitle={t('fruit_cards.three_cards')}
              topOffset={sealY}
              topRotate={sealR.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-28deg'] })}
              glow={theme.accent}
            />
            {phase === 'sealed' ? (
              <View style={[styles.tearTrack, { width: packW * 0.8, left: packW * 0.1, top: packW * 0.18 }]}>
                <Animated.View style={[styles.tearFill, { width: tear.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }), backgroundColor: theme.accent }]} />
              </View>
            ) : null}
          </Animated.View>
          {phase === 'sealed' ? (
            <>
              <Text style={styles.hint}>{t('fruit_cards.swipe_to_open')}</Text>
              <TouchableOpacity style={[styles.cta, { backgroundColor: theme.accent }]} onPress={doOpen}>
                <Text style={styles.ctaText}>{source === 'stars' ? t('fruit_cards.open_for_stars', { cost: STAR_PACK_COST }) : t('fruit_cards.open_now')}</Text>
              </TouchableOpacity>
            </>
          ) : <Text style={styles.hint}>{t('fruit_cards.opening')}</Text>}
        </View>
      ) : null}

      {phase === 'reveal' && card ? (
        <View style={styles.center}>
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            <Rays color={glow} size={W * 1.5} visible={flipped && fx >= 2} />
            <Animated.View style={enter}>
              <TouchableOpacity activeOpacity={1} onPress={flipped ? next : doFlip}>
                <View style={{ width: cw, height: cw * 1.4 }}>
                  {/* back */}
                  <Animated.View style={{ position: 'absolute', transform: [{ perspective: 1000 }, { rotateY: backRotate }, { scale: charging ? 1.04 : 1 }] }}>
                    {tier >= 1 ? (
                      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: -cw * 0.25, top: -cw * 0.25, width: cw * 1.5, height: cw * 1.9, opacity: tease, backgroundImage: `radial-gradient(ellipse 50% 50% at 50% 50%, ${glow} 0%, rgba(0,0,0,0) 70%)` }} />
                    ) : null}
                    <CardBack width={cw} theme={params?.theme === 'skins' ? 'skins' : 'sea'} glow={tier >= 1 ? glow : null} />
                  </Animated.View>
                  {/* front */}
                  <Animated.View style={{ position: 'absolute', transform: [{ perspective: 1000 }, { rotateY: frontRotate }] }}>
                    {flipped ? (
                      <CardShine width={cw} height={cw * 1.4} interactive={false} idle={FINISH_STYLE[card.finish]?.mult > 1 || tier >= 1} spin={card.finish === 'aura'}>
                        {(shine) => (
                          <FruitCard card={card} finish={card.finish} serial={card.serial} width={cw} total={total} shine={shine} />
                        )}
                      </CardShine>
                    ) : null}
                  </Animated.View>
                </View>
              </TouchableOpacity>
            </Animated.View>
            <Sparkles run={flipped && fx >= 3} color={glow} />
          </View>
          <View style={{ height: 70, alignItems: 'center', justifyContent: 'center' }}>
            {flipped ? (
              <>
                <Text style={[styles.rarityLine, { color: glow }]}>
                  {t(`fruit_cards.rarity.${card.rarity}`)}{card.finish !== 'classic' ? ` · ${t(`fruit_cards.finish.${card.finish}`)}` : ''}
                </Text>
                {badges(card)}
              </>
            ) : (
              <Text style={styles.hint}>{charging ? t('fruit_cards.something_rare') : t('fruit_cards.tap_to_flip')}</Text>
            )}
          </View>
          {flipped ? <Text style={styles.hintSmall}>{index < cards.length - 1 ? t('fruit_cards.tap_next') : t('fruit_cards.tap_finish')}</Text> : null}
        </View>
      ) : null}

      {phase === 'summary' ? (
        <View style={[styles.center, { paddingHorizontal: 16 }]}>
          {result?.completed?.length ? (
            <View style={[styles.banner, { borderColor: theme.accent }]}>
              <Text style={styles.bannerTitle}>🎉 {t('fruit_cards.set_done', { set: t(`fruit_cards.sets.${result.completed[0]}`, { defaultValue: result.completed[0] }) })}</Text>
              {result.rewardShards ? <Text style={styles.bannerSub}>+{result.rewardShards} 💠</Text> : null}
              <TouchableOpacity style={[styles.ctaSmall, { backgroundColor: theme.accent }]} onPress={() => navigation.navigate('CardWallpaper', { setId: result.completed[0] })}>
                <Text style={styles.ctaText}>{t('fruit_cards.make_wallpaper')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {result?.streakBonus ? (
            <View style={[styles.banner, { borderColor: '#22C55E' }]}>
              <Text style={styles.bannerTitle}>🎁 {t('fruit_cards.streak_bonus')}</Text>
            </View>
          ) : null}
          <View style={styles.summaryRow}>
            {cards.map((c) => (
              <View key={`${c.key}${c.finish}`} style={{ alignItems: 'center' }}>
                <FruitCard card={c} finish={c.finish} serial={c.serial} width={(W - 56) / 3} size="thumb" total={total} />
                {badges(c)}
              </View>
            ))}
          </View>
          {best ? (
            <TouchableOpacity style={[styles.cta, { backgroundColor: theme.accent }]} onPress={() => { setShare(best); trackGrowthEvent('card_share', { kind: 'pull' }); }}>
              <CardIcon name="share" size={18} />
              <Text style={styles.ctaText}>{t('fruit_cards.share_best')}</Text>
            </TouchableOpacity>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
            {again ? (
              <TouchableOpacity style={[styles.ghost, { flex: 1 }]} onPress={() => navigation.replace('PackOpening', { setId, source: again, theme: params?.theme })}>
                <Text style={styles.ghostText}>{again === 'stars' ? t('fruit_cards.again_stars', { cost: STAR_PACK_COST }) : t('fruit_cards.again')}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={[styles.ghost, { flex: 1 }]} onPress={() => navigation.replace('CardAlbum', { setId })}>
              <Text style={styles.ghostText}>{t('fruit_cards.view_album')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {phase === 'error' ? (
        <View style={[styles.center, { paddingHorizontal: 32 }]}>
          <Text style={styles.errText}>{errKey && errKey.startsWith('fruit_cards.') ? t(errKey) : errKey}</Text>
          <TouchableOpacity style={[styles.cta, { backgroundColor: theme.accent }]} onPress={() => navigation.goBack()}>
            <Text style={styles.ctaText}>{t('fruit_cards.back')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF', opacity: flash }]} />
      <CardShareSheet card={share} total={total} onClose={() => setShare(null)} />
    </View>
  );
}

function Badge({ text, color }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.badgeText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#07040F' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, zIndex: 5 },
  counter: { color: INK, fontWeight: '900', fontSize: 15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { color: MUTED, fontSize: 15, fontWeight: '800', marginTop: 22, textAlign: 'center' },
  hintSmall: { color: MUTED, fontSize: 12, fontWeight: '700', marginTop: 8 },
  tearTrack: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  tearFill: { height: 4, borderRadius: 2 },
  cta: { alignSelf: 'stretch', marginHorizontal: 32, marginTop: 18, height: 52, borderRadius: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaSmall: { marginTop: 10, height: 40, paddingHorizontal: 20, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#1A0E00', fontWeight: '900', fontSize: 16 },
  ghost: { marginTop: 10, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  ghostText: { color: INK, fontWeight: '800', fontSize: 14 },
  rarityLine: { fontSize: 17, fontWeight: '900', letterSpacing: 0.5, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { color: '#FFFFFF', fontWeight: '900', fontSize: 11 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', marginTop: 16, marginBottom: 6 },
  banner: { alignSelf: 'stretch', borderWidth: 1.5, borderRadius: 18, padding: 14, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 8 },
  bannerTitle: { color: INK, fontSize: 16, fontWeight: '900', textAlign: 'center' },
  bannerSub: { color: '#BAE6FD', fontSize: 14, fontWeight: '800', marginTop: 4 },
  errText: { color: INK, fontSize: 16, fontWeight: '800', textAlign: 'center' },
});
