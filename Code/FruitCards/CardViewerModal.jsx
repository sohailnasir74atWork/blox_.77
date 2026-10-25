/**
 * CardViewerModal — one card, big. Drag to tilt; tap to turn it over for the
 * details (origin, every finish owned with counts and serials, and today's
 * values: the back is the only place on a card where live numbers appear).
 * Owned: switch finish, share, pin to the profile showcase, fuse 4 copies
 * into the next finish (Classic -> Awakened -> Mythic Aura, fuse_card).
 * Missing: the silhouette, where it drops, and Craft for shards.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Easing, ScrollView, useWindowDimensions, BackHandler,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import FruitCard from './FruitCard';
import CardShine from './CardShine';
import CardShareSheet from './CardShareSheet';
import CardIcon from './cardIcons';
import { FINISHES, CRAFT_COST, RARITY_STYLE, FIRST_EDITION_MAX } from './cardConfig';
import { bestOwned, formatCompact, isShowcased, fusionOf } from './cardMath';
import { useHaptic } from '../Helper/HepticFeedBack';

const INK = '#F4ECFF';
const MUTED = 'rgba(244,236,255,0.65)';
const FUSE_AWAKENED = 'linear-gradient(100deg, #22E4FF 0%, #B455F6 55%, #FF2BD6 100%)';
const FUSE_AURA = 'linear-gradient(100deg, #FF5FA2 0%, #FFD45E 25%, #5EFFB4 50%, #5EC8FF 75%, #B45EFF 100%)';

export default function CardViewerModal({
  card, entries, values, total, shards = 0, showcase = null, onClose, onCraft, onShowcase, onFuse, crafting = false,
}) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const visible = !!card;
  const owned = Array.isArray(entries) && entries.length > 0;
  const best = useMemo(() => bestOwned(entries), [entries]);
  const [finish, setFinish] = useState(best?.finish || 'classic');
  const [details, setDetails] = useState(false);
  const [share, setShare] = useState(null);
  const [fusing, setFusing] = useState(false);
  const turn = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const { triggerHapticFeedback } = useHaptic();

  useEffect(() => {
    setFinish(best?.finish || 'classic');
    setDetails(false);
    turn.setValue(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.key, turn]);

  // A finish that is no longer owned (used up by a fusion) falls back to the best one.
  useEffect(() => {
    if (best && !(entries || []).some((e) => e[0] === finish)) setFinish(best.finish);
  }, [entries, best, finish]);

  // Drawn inside the album's own window, not a <Modal>: a Modal is a
  // separate Android window that takes the app's light nav bar (or, drawn
  // edge-to-edge, the system theme's), so every card opened put a pale strip
  // under this dark page (2026-10-08). Here the album's dark bars stay put.
  // Same fade-in as the Modal had; Back closes it, as onRequestClose did.
  const fade = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!visible) { fade.setValue(0); return undefined; }
    Animated.timing(fade, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCloseRef.current?.();
      return true;
    });
    return () => sub.remove();
  }, [visible, fade]);

  if (!card) return null;
  const cw = Math.min(W - 64, 340);
  const entry = (entries || []).find((e) => e[0] === finish);
  const serial = entry ? entry[2] : null;
  const rs = RARITY_STYLE[card.rarity] || RARITY_STYLE.common;
  const cost = CRAFT_COST[card.rarity];
  const v = values || {};

  const flipTo = (toDetails) => {
    Animated.timing(turn, { toValue: toDetails ? 1 : 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    setTimeout(() => setDetails(toDetails), 190);
  };
  const frontRot = turn.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '90deg', '90deg'] });
  const backRot = turn.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-90deg', '-90deg', '0deg'] });

  const ownedFinishes = FINISHES.filter((f) => (entries || []).some((e) => e[0] === f));
  const fuse = owned && onFuse ? fusionOf(entries, finish) : null;

  const doFuse = async () => {
    if (!fuse?.ready || fusing) return;
    setFusing(true);
    try {
      const to = await onFuse(card, finish);
      if (to) {
        setFinish(to);
        triggerHapticFeedback('impactHeavy');
        Animated.sequence([
          Animated.timing(flash, { toValue: 1, duration: 120, useNativeDriver: true }),
          Animated.timing(flash, { toValue: 0, duration: 650, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]).start();
      }
    } finally {
      setFusing(false);
    }
  };
  const pinned = isShowcased(showcase, card.key, finish);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.layer, { opacity: fade }]} accessibilityViewIsModal>
      <View style={[styles.backdrop, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <TouchableOpacity style={[styles.close, { top: insets.top + 12 }]} onPress={onClose} hitSlop={14}>
          <Icon name="close" size={28} color={INK} />
        </TouchableOpacity>

        <View style={{ width: cw, height: cw * 1.4 }}>
          <Animated.View style={{ position: 'absolute', transform: [{ perspective: 1000 }, { rotateY: frontRot }] }}>
            <CardShine width={cw} height={cw * 1.4} idle={owned} spin={owned && finish === 'aura'} onTap={() => flipTo(true)}>
              {(shine) => (
                <FruitCard card={card} finish={finish} serial={serial} width={cw} owned={owned} total={total} shine={shine} />
              )}
            </CardShine>
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: cw * 0.046, opacity: flash, backgroundImage: `radial-gradient(circle at 50% 45%, #FFFFFF 0%, ${rs.glow} 45%, rgba(255,255,255,0) 80%)` }]} />
          </Animated.View>
          <Animated.View style={{ position: 'absolute', transform: [{ perspective: 1000 }, { rotateY: backRot }] }} pointerEvents={details ? 'auto' : 'none'}>
            <TouchableOpacity activeOpacity={0.95} onPress={() => flipTo(false)}>
              <View style={[styles.detail, { width: cw, height: cw * 1.4, borderColor: rs.base }]}>
                <ScrollView contentContainerStyle={{ padding: 18 }}>
                  <Text style={styles.dName}>{card.name}</Text>
                  <Text style={[styles.dRarity, { color: rs.glow }]}>{t(`fruit_cards.rarity.${card.rarity}`)} · #{card.no}</Text>
                  <View style={styles.dRow}><Text style={styles.dLabel}>{t('fruit_cards.stat_value')}</Text><Text style={styles.dVal}>{v.r != null ? formatCompact(v.r) : '—'}</Text></View>
                  <View style={styles.dRow}><Text style={styles.dLabel}>{t('fruit_cards.stat_perm')}</Text><Text style={styles.dVal}>{v.p != null ? formatCompact(v.p) : '—'}</Text></View>
                  <View style={styles.dRow}><Text style={styles.dLabel}>{t('fruit_cards.stat_demand')}</Text><Text style={styles.dVal}>{v.d || '—'}</Text></View>
                  <Text style={styles.dAsOf}>{t('fruit_cards.wp_as_of', { date: new Date().toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }) })}</Text>
                  <View style={styles.dRow}>
                    <Text style={styles.dLabel}>{t('fruit_cards.origin')}</Text>
                    <Text style={styles.dVal}>
                      {card.family ? t(`fruit_cards.family.${card.family}`, { defaultValue: card.family }) : '—'}
                    </Text>
                  </View>
                  <Text style={styles.dHead}>{t('fruit_cards.your_copies')}</Text>
                  {owned ? FINISHES.filter((f) => (entries || []).some((e) => e[0] === f)).map((f) => {
                    const e = entries.find((x) => x[0] === f);
                    return (
                      <View key={f} style={styles.dRow}>
                        <Text style={styles.dLabel}>{t(`fruit_cards.finish.${f}`)} ×{e[1]}</Text>
                        <Text style={styles.dVal}>
                          {e[2] != null ? `#${String(e[2]).padStart(4, '0')}${e[2] <= FIRST_EDITION_MAX ? ` · ${t('fruit_cards.first_edition')}` : ''}` : ''}
                        </Text>
                      </View>
                    );
                  }) : <Text style={styles.dMuted}>{t('fruit_cards.not_collected')}</Text>}
                  <Text style={styles.dFan}>{t('fruit_cards.disclaimer')}</Text>
                </ScrollView>
              </View>
            </TouchableOpacity>
          </Animated.View>
        </View>

        <Text style={styles.tip}>{details ? t('fruit_cards.tap_front') : t('fruit_cards.tap_details')}</Text>

        {ownedFinishes.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.finishes}>
            {ownedFinishes.map((f) => (
              <TouchableOpacity key={f} onPress={() => setFinish(f)} style={[styles.fChip, f === finish && styles.fChipOn]}>
                <Text style={[styles.fChipText, f === finish && { color: '#1A0E00' }]}>{t(`fruit_cards.finish.${f}`)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.actions}>
          {owned ? (
            <>
              <TouchableOpacity style={[styles.btn, { backgroundColor: rs.base }]} onPress={() => setShare({ ...card, finish, serial })}>
                <CardIcon name="share" size={16} />
                <Text style={styles.btnText}>{t('fruit_cards.share')}</Text>
              </TouchableOpacity>
              {onShowcase ? (
                <TouchableOpacity style={[styles.btn, styles.ghost, pinned && styles.ghostOn]} onPress={() => onShowcase(card, finish)}>
                  <CardIcon name={pinned ? 'pinOff' : 'pin'} size={16} />
                  <Text style={[styles.btnText, { color: INK }]}>{t(pinned ? 'fruit_cards.showcase_remove' : 'fruit_cards.showcase')}</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
            <TouchableOpacity
              disabled={shards < cost || crafting}
              style={[styles.btn, { backgroundColor: '#38BDF8', opacity: shards < cost || crafting ? 0.45 : 1 }]}
              onPress={() => onCraft && onCraft(card)}
            >
              <Text style={styles.btnText}>{t('fruit_cards.craft', { cost })}</Text>
            </TouchableOpacity>
          )}
        </View>
        {fuse && fuse.have > 0 ? (
          <TouchableOpacity
            disabled={!fuse.ready || fusing}
            onPress={doFuse}
            style={[styles.fuse, fuse.ready && { borderWidth: 0, backgroundImage: fuse.to === 'aura' ? FUSE_AURA : FUSE_AWAKENED, boxShadow: '0 0 14px rgba(180,85,246,0.6)' }]}
          >
            {fuse.ready ? (
              <Text style={styles.btnText}>{t('fruit_cards.fuse', { finish: t(`fruit_cards.finish.${fuse.to}`) })}</Text>
            ) : (
              <>
                <View style={styles.pips}>
                  {Array.from({ length: fuse.need }, (_, i) => <View key={i} style={[styles.pip, i < fuse.have && styles.pipOn]} />)}
                </View>
                <Text style={[styles.btnText, { color: MUTED, fontSize: 12 }]}>
                  {t('fruit_cards.fuse_progress', { have: fuse.have, need: fuse.need, finish: t(`fruit_cards.finish.${fuse.to}`) })}
                </Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}
        {!owned ? <Text style={styles.tip}>{t('fruit_cards.craft_hint', { have: shards })}</Text> : null}
        {owned && onShowcase ? <Text style={styles.tip}>{t('fruit_cards.showcase_hint')}</Text> : null}
      </View>
      <CardShareSheet card={share} total={total} onClose={() => setShare(null)} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 50, elevation: 50 },
  backdrop: { flex: 1, backgroundColor: 'rgba(5,3,12,0.94)', alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', top: 54, right: 20, zIndex: 3 },
  detail: { borderRadius: 16, borderWidth: 2, backgroundColor: '#140F24', overflow: 'hidden' },
  dName: { color: INK, fontSize: 22, fontWeight: '900' },
  dRarity: { fontSize: 14, fontWeight: '900', marginTop: 4, marginBottom: 10 },
  dHead: { color: INK, fontSize: 14, fontWeight: '900', marginTop: 16, marginBottom: 4 },
  dRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)' },
  dLabel: { color: MUTED, fontSize: 13, fontWeight: '700' },
  dVal: { color: INK, fontSize: 13, fontWeight: '900' },
  dMuted: { color: MUTED, fontSize: 13, marginTop: 4 },
  dAsOf: { color: 'rgba(244,236,255,0.45)', fontSize: 10, fontWeight: '600', marginTop: 5 },
  dFan: { color: 'rgba(244,236,255,0.4)', fontSize: 10, marginTop: 16 },
  tip: { color: MUTED, fontSize: 12, fontWeight: '700', marginTop: 14 },
  finishes: { gap: 8, paddingHorizontal: 20, marginTop: 12 },
  fChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  fChipOn: { backgroundColor: '#FFD23F', borderColor: '#FFD23F' },
  fChipText: { color: INK, fontWeight: '800', fontSize: 12 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btn: { height: 46, paddingHorizontal: 20, borderRadius: 23, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  ghost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  ghostOn: { borderColor: 'rgba(255,210,63,0.7)', backgroundColor: 'rgba(255,210,63,0.12)' },
  btnText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
  fuse: { marginTop: 12, minHeight: 42, paddingHorizontal: 18, borderRadius: 21, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  pips: { flexDirection: 'row', gap: 4 },
  pip: { width: 9, height: 9, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)' },
  pipOn: { backgroundColor: '#22E4FF', borderColor: '#22E4FF' },
});
