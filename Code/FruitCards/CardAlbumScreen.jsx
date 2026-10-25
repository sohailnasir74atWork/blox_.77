/**
 * CardAlbumScreen — binder pages of 3×3 pockets (adoptme PET_CARDS_PLAN.md §2.2; Blox: FRUIT_CARDS_PLAN.md).
 * Owned cards show their fanciest finish; missing ones show the fruit's
 * silhouette and collector number, so players know what to hunt for.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import { showErrorMessage, showSuccessMessage } from '../Helper/MessageHelper';
import useFruitCards from './useFruitCards';
import FruitCard from './FruitCard';
import CardViewerModal from './CardViewerModal';
import {
  setProgress, cardsInSet, bestOwned, totalCopies, byNumber, toggleShowcase, isShowcased, applyFusion,
} from './cardMath';
import { themeOf } from './cardConfig';
import { craftCard, fuseCard, setShowcase, errorKey } from './cardsApi';
import { setName } from './FruitCardsScreen';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';
import useDarkSystemBars from '../Helper/useDarkSystemBars';

const INK = '#F4ECFF';
const MUTED = 'rgba(244,236,255,0.62)';
const GAP = 10;
const PAD = 16;

export default function CardAlbumScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const { sets, catalog, byKey, owned, values, wallet, loading, reload, setCollection, collection } = useFruitCards();
  const [setId, setSetId] = useState(route.params?.setId || 'all');
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const [crafting, setCrafting] = useState(false);
  // Until the first touch, build the rows below the screen one row per 100 ms
  // instead of nine cards every 50 ms, so the slide-in and the first look
  // stay smooth (2026-10-08: the full-speed fill stalled the UI thread for
  // ~0.5 s per frame on the emulator). The first drag switches to full speed,
  // so a fast fling never outruns the list.
  const [warm, setWarm] = useState(false);
  // The profile showcase as the server holds it (get_card_collection.showcase).
  const showcase = useMemo(() => collection?.showcase || [], [collection?.showcase]);

  useEffect(() => {
    const k = route.params?.openKey;
    if (k && byKey.get(k)) setOpen(byKey.get(k));
  }, [route.params?.openKey, byKey]);

  const albumSets = useMemo(() => sets.filter((s) => s.total > 0).sort((a, b) => a.sort - b.sort), [sets]);
  const set = albumSets.find((s) => s.id === setId) || albumSets[0];
  const theme = themeOf(set?.theme);
  useDarkSystemBars(theme.stage[0]);
  const p = set ? setProgress(catalog, owned, set.id) : { have: 0, total: 0 };
  const cw = (W - PAD * 2 - GAP * 2) / 3;
  const ch = cw * 1.4;
  const total = catalog.length || null;

  const data = useMemo(() => {
    if (!set) return [];
    const list = cardsInSet(catalog, set.id).sort(byNumber);
    if (filter === 'owned') return list.filter((c) => owned[c.key]);
    if (filter === 'missing') return list.filter((c) => !owned[c.key]);
    return list;
  }, [catalog, set, owned, filter]);

  const onCraft = useCallback(async (card) => {
    setCrafting(true);
    try {
      const r = await craftCard(card.key);
      trackGrowthEvent('card_craft', { rarity: card.rarity });
      setCollection((prev) => {
        const cards = { ...(prev?.cards || {}) };
        cards[card.key] = [['classic', 1, null]];
        return { ...(prev || {}), cards };
      });
      showSuccessMessage(t('fruit_cards.crafted', { pet: card.name }));
      if (r?.completed?.length) showSuccessMessage(t('fruit_cards.set_done', { set: t(`fruit_cards.sets.${r.completed[0]}`, { defaultValue: r.completed[0] }) }));
      reload();
    } catch (e) {
      showErrorMessage(t(`fruit_cards.err.${errorKey(e)}`));
    } finally {
      setCrafting(false);
    }
  }, [t, reload, setCollection]);

  // 4 copies -> 1 of the next finish. Returns the new finish for the viewer to show.
  const onFuse = useCallback(async (card, from) => {
    try {
      const r = await fuseCard(card.key, from);
      const to = r?.card?.finish;
      trackGrowthEvent('card_fuse', { rarity: card.rarity, from, to });
      setCollection((prev) => {
        const cards = { ...(prev?.cards || {}) };
        cards[card.key] = applyFusion(cards[card.key], from, to);
        return { ...(prev || {}), cards };
      });
      showSuccessMessage(t('fruit_cards.fused', { pet: card.name, finish: t(`fruit_cards.finish.${to}`) }));
      reload();   // score, and a showcase the fusion moved
      return to;
    } catch (e) {
      showErrorMessage(t(`fruit_cards.err.${errorKey(e)}`));
      return null;
    }
  }, [t, reload, setCollection]);

  // Pin (or unpin) one card+finish on the profile; the server returns the stored list.
  const onShowcase = useCallback(async (card, finish) => {
    const pinned = isShowcased(showcase, card.key, finish);
    try {
      const next = await setShowcase(toggleShowcase(showcase, card.key, finish));
      setCollection((prev) => ({ ...(prev || {}), showcase: Array.isArray(next) ? next : [] }));
      showSuccessMessage(t(pinned ? 'fruit_cards.showcase_removed' : 'fruit_cards.showcased', { pet: card.name }));
    } catch (e) {
      showErrorMessage(t(`fruit_cards.err.${errorKey(e)}`));
    }
  }, [showcase, t, setCollection]);

  const renderItem = useCallback(({ item }) => {
    const entries = owned[item.key];
    const b = bestOwned(entries);
    const copies = totalCopies(entries);
    return (
      <TouchableOpacity activeOpacity={0.85} onPress={() => setOpen(item)} style={{ width: cw, marginBottom: GAP }}>
        <FruitCard card={item} finish={b?.finish || 'classic'} serial={b?.serial} owned={!!b} width={cw} size="thumb" total={total} />
        {copies > 1 ? (
          <View style={styles.copies}><Text style={styles.copiesText}>×{copies}</Text></View>
        ) : null}
      </TouchableOpacity>
    );
  }, [owned, cw, total]);

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.stage[0] }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Icon name="chevron-back" size={24} color={INK} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{set ? setName(t, set) : t('fruit_cards.albums')}</Text>
        <Text style={styles.count}>{p.have}/{p.total}</Text>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {albumSets.map((s) => (
            <TouchableOpacity key={s.id} onPress={() => setSetId(s.id)} style={[styles.chip, s.id === set?.id && { backgroundColor: themeOf(s.theme).accent }]}>
              <Text style={[styles.chipText, s.id === set?.id && { color: '#1A0E00' }]}>{setName(t, s)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.progressBox}>
        <View style={styles.bar}><View style={[styles.fill, { width: `${Math.round((p.have / Math.max(1, p.total)) * 100)}%`, backgroundColor: theme.accent }]} /></View>
        {set?.reward ? (
          <Text style={styles.reward}>
            {(collection?.completed || []).includes(set.id) ? t('fruit_cards.reward_done') : t('fruit_cards.reward_hint', { shards: set.reward.shards || 0 })}
          </Text>
        ) : null}
        <View style={styles.filters}>
          {['all', 'owned', 'missing'].map((f) => (
            <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[styles.filter, filter === f && styles.filterOn]}>
              <Text style={[styles.filterText, filter === f && { color: '#1A0E00' }]}>{t(`fruit_cards.filter_${f}`)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading && !catalog.length ? <View style={{ flex: 1 }}><ActivityIndicator color="#fff" style={{ marginTop: 40 }} /></View> : (
        <FlatList
          data={data}
          keyExtractor={(c) => c.key}
          numColumns={3}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 24 }}
          renderItem={renderItem}
          initialNumToRender={12}
          maxToRenderPerBatch={warm ? 9 : 3}
          updateCellsBatchingPeriod={warm ? 50 : 100}
          onScrollBeginDrag={warm ? undefined : () => setWarm(true)}
          windowSize={7}
          removeClippedSubviews={false}
          getItemLayout={(_, i) => ({ length: ch + GAP, offset: (ch + GAP) * Math.floor(i / 3), index: i })}
          ListEmptyComponent={<Text style={styles.empty}>{t(filter === 'owned' ? 'fruit_cards.empty_owned' : 'fruit_cards.empty_missing')}</Text>}
        />
      )}
      <ScreenBottomBanner background={theme.stage[0]} />

      <CardViewerModal
        card={open}
        entries={open ? owned[open.key] : null}
        values={open ? values.get(open.key) : null}
        total={total}
        shards={wallet?.shards || 0}
        showcase={showcase}
        crafting={crafting}
        onClose={() => setOpen(null)}
        onCraft={onCraft}
        onShowcase={onShowcase}
        onFuse={onFuse}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10 },
  title: { flex: 1, color: INK, fontSize: 18, fontWeight: '900' },
  count: { color: INK, fontSize: 15, fontWeight: '900' },
  chips: { gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)' },
  chipText: { color: INK, fontWeight: '800', fontSize: 13 },
  progressBox: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 },
  bar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  reward: { color: MUTED, fontSize: 12, fontWeight: '700', marginTop: 6 },
  filters: { flexDirection: 'row', gap: 8, marginTop: 10 },
  filter: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  filterOn: { backgroundColor: '#F4ECFF', borderColor: '#F4ECFF' },
  filterText: { color: INK, fontWeight: '800', fontSize: 12 },
  copies: { position: 'absolute', top: 6, right: 6, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.65)' },
  copiesText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  empty: { color: MUTED, textAlign: 'center', marginTop: 40, fontWeight: '700' },
});
