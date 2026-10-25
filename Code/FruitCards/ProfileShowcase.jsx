/**
 * ProfileShowcase — the Fruit Cards strip on a player's profile drawer
 * (adoptme PET_CARDS_PLAN.md §2.1; Blox: FRUIT_CARDS_PLAN.md): up to 3 showcased cards and the collector score.
 *
 * Data rides on the cosmetics row every profile already loads
 * (user_cosmetics.card_showcase / card_score, see userBackend.fromCosmeticsRow),
 * so it costs no extra read. Renders nothing for players without cards.
 *
 *   <ProfileShowcase cards={user.cardShowcase} score={user.cardScore} isDarkMode />
 */

import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import FruitCard from './FruitCard';
import CardIcon from './cardIcons';
import { parseShowcase } from './cardMath';
import { loadArtManifest } from './cardArt';

const GAP = 10;
const PAD = 12;

export default function ProfileShowcase({ cards, score = 0, isDarkMode = false, style }) {
  const { t } = useTranslation();
  const { width: W } = useWindowDimensions();
  const items = useMemo(() => parseShowcase(cards), [cards]);
  const points = Number(score) || 0;

  useEffect(() => {
    if (items.length) loadArtManifest();
  }, [items.length]);

  if (!items.length && points <= 0) return null;

  // The drawer gives its sections 12 px side margins; the strip pads 12 more.
  const cw = Math.min(104, Math.floor((W - 24 - PAD * 2 - GAP * 2) / 3));
  const c = isDarkMode
    ? { bg: 'rgba(255,255,255,0.05)', line: 'rgba(255,255,255,0.1)', ink: '#F4ECFF', pill: 'rgba(245,179,1,0.16)', pillLine: 'rgba(245,179,1,0.4)', pillInk: '#FFD98A' }
    : { bg: '#F8F5FF', line: '#E9E2F7', ink: '#2B2116', pill: 'rgba(245,179,1,0.14)', pillLine: 'rgba(180,95,6,0.3)', pillInk: '#8A4B00' };

  return (
    <View style={[styles.box, { backgroundColor: c.bg, borderColor: c.line }, style]}>
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <CardIcon name="cards" size={18} />
          <Text style={[styles.title, { color: c.ink }]}>{t('fruit_cards.title')}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: c.pill, borderColor: c.pillLine }]}>
          <CardIcon name="score" size={14} />
          <Text style={[styles.pillText, { color: c.pillInk }]}>{points.toLocaleString()}</Text>
          <Text style={[styles.pillLabel, { color: c.pillInk }]}>{t('fruit_cards.collector_score')}</Text>
        </View>
      </View>
      {items.length ? (
        <View style={styles.row}>
          {items.map(({ card, finish, serial }) => (
            <FruitCard key={`${card.key}:${finish}`} card={card} finish={finish} serial={serial} width={cw} size="thumb" />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: 12, marginTop: 12, padding: PAD, borderRadius: 14, borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  title: { fontSize: 13, fontWeight: '800' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 13, fontWeight: '900' },
  pillLabel: { fontSize: 10, fontWeight: '700', opacity: 0.85 },
  row: { flexDirection: 'row', gap: GAP, marginTop: 10 },
});
