/**
 * CardWallpaper — "Wallpaper Studio" (adoptme PET_CARDS_PLAN.md §2.7; Blox: FRUIT_CARDS_PLAN.md).
 *
 * 8 designs (wallpaperStyles.jsx) built from the player's own pets: their HD
 * card art, live values and weekly trends. Pick a style, pets, a background
 * (colour themes, painted scenes, a motif pattern) and extras, then save a
 * phone (1290×2796) or 4K desktop (3840×2160) wallpaper.
 *
 * The wallpaper is laid out at its real size in points (430×932 / 1280×720)
 * and only SHOWN scaled down; view-shot captures the unscaled view, so the
 * saved file is sharp. The clock overlay is a preview aid and never saved.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform, PermissionsAndroid, useWindowDimensions, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import ViewShot from 'react-native-view-shot';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import { showErrorMessage, showSuccessMessage } from '../Helper/MessageHelper';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import { fetchAnalyticsData } from '../Helper/analyticsDataHelper';
import useFruitCards from './useFruitCards';
import FruitCard from './FruitCard';
import { bestOwned, matchPalette } from './cardMath';
import { FINISHES, RARITIES, RARITY_STYLE, bgIdFor } from './cardConfig';
import { paintFor } from './cardArt';
import {
  WallpaperArt, WP_STYLES, WP_MAX_PETS, WP_STYLE_ICON, WP_GRADIENTS, WP_LIGHT, WP_DARK, WP_SCENES, WP_MOTIFS, WP_MOTIF_ICON,
} from './wallpaperStyles';
import FRUIT_COLORS from './fruitColors.json';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';
import useDarkSystemBars from '../Helper/useDarkSystemBars';

const INK = '#F4ECFF';
const MUTED = 'rgba(244,236,255,0.62)';
const ACCENT = '#FFB020';
const FORMATS = {
  phone: { w: 430, h: 932, out: [1290, 2796] },
  desktop: { w: 1280, h: 720, out: [3840, 2160] },
};
const TABS = ['style', 'pets', 'background', 'extras'];
const EXTRAS = [['sparkles', '✨'], ['glow', '💡'], ['title', '🔤'], ['values', '💰'], ['watermark', '🏷️'], ['clock', '🕘']];


// A fruit's [main, second, accent] colours (scripts/fruit-cards/palette.py, via art.py --palette);
// fruits without an entry fall back to their rarity colours.
const colorsFor = (pet) => {
  if (FRUIT_COLORS[pet?.key]) return FRUIT_COLORS[pet.key];
  const rs = RARITY_STYLE[pet?.rarity] || RARITY_STYLE.common;
  return [rs.base, rs.light, rs.dark];
};

const keyOf = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Latest value change per fruit, physical value only (the same diff.json feed
 * as the calculator's hot/drop badges; analyticsDataHelper keeps it 4 h and
 * drops diffs older than 7 days).
 */
function useValueTrends() {
  const [map, setMap] = useState(() => new Map());
  useEffect(() => {
    let live = true;
    fetchAnalyticsData().then((maps) => {
      const m = new Map();
      [maps?.hotMap, maps?.dropMap].forEach((src) => Object.entries(src || {}).forEach(([k, v]) => {
        if (!k.endsWith('_n') || !Number.isFinite(v?.pct) || v.pct === 0) return;
        m.set(keyOf(k.slice(0, -2)), v.pct);
      }));
      if (live) setMap(m);
    }).catch(() => { /* no trends */ });
    return () => { live = false; };
  }, []);
  return map;
}

async function canSave() {
  if (Platform.OS !== 'android' || Platform.Version >= 29) return true;
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

export default function CardWallpaper() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  useDarkSystemBars('#0B0816');
  const { width: W } = useWindowDimensions();
  const { catalog, owned, values } = useFruitCards();
  const trends = useValueTrends();
  const shot = useRef(null);

  const [format, setFormat] = useState('phone');
  const [style, setStyle] = useState(route.params?.style || 'peek');
  const [tab, setTab] = useState('style');
  const [picked, setPicked] = useState(null);
  const [boardSource, setBoardSource] = useState('mine');
  const [background, setBackground] = useState(
    route.params?.setId === 'skins' ? { type: 'gradient', id: 'vault' } : { type: 'gradient', id: 'ocean' },
  );
  // Values are opt-in: a saved wallpaper is a still picture and values move weekly.
  const [opts, setOpts] = useState({ sparkles: true, glow: true, title: true, values: false, watermark: true, clock: true, motif: 'stars' });
  const [saving, setSaving] = useState(false);

  const enrich = (c, b) => ({
    ...c, finish: b?.finish || 'classic', serial: b?.serial ?? null,
    values: values.get(c.key) || null, trend: trends.get(c.key) ?? null, bgId: bgIdFor(c, 'classic'),
  });

  // The player's pets: owned cards, fanciest first.
  const mine = useMemo(() => catalog
    .map((c) => ({ c, b: bestOwned(owned[c.key]) }))
    .filter((x) => x.b)
    .sort((a, b) => FINISHES.indexOf(b.b.finish) - FINISHES.indexOf(a.b.finish)
      || RARITIES.indexOf(b.c.rarity) - RARITIES.indexOf(a.c.rarity)
      || (values.get(b.c.key)?.r || 0) - (values.get(a.c.key)?.r || 0)),
  [catalog, owned, values]);

  const max = WP_MAX_PETS[style] || 1;
  const pets = useMemo(() => {
    if (style === 'board') {
      const pool = boardSource === 'top'
        ? catalog.map((c) => ({ c, b: bestOwned(owned[c.key]) }))
        : mine;
      return pool
        .filter((x) => values.get(x.c.key)?.r != null)
        .sort((a, b) => values.get(b.c.key).r - values.get(a.c.key).r)
        .slice(0, max)
        .map((x) => enrich(x.c, x.b));
    }
    const keys = (picked || mine.map((x) => x.c.key)).slice(0, max);
    return keys.map((k) => mine.find((x) => x.c.key === k)).filter(Boolean).map((x) => enrich(x.c, x.b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, boardSource, picked, mine, catalog, owned, values, trends, max]);

  const toggle = (key) => {
    const cur = (picked || mine.map((x) => x.c.key)).slice(0, max);
    if (max === 1) { setPicked([key, ...cur.filter((k) => k !== key)]); return; }
    setPicked(cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key].slice(-max));
  };

  // "Match my pet" follows the lead pet: change the pet and the colours follow.
  const lead = pets[0] || null;
  const leadColors = useMemo(() => colorsFor(lead), [lead]);
  const bg = background.type === 'match' ? { ...background, colors: leadColors } : background;

  const F = FORMATS[format];
  const previewW = format === 'phone' ? Math.min(W * 0.62, 260) : Math.min(W - 32, 420);
  const scale = previewW / F.w;
  const today = new Date();
  const labels = {
    rarity: (r) => t(`fruit_cards.rarity.${r}`),
    stat: (k) => t(`fruit_cards.stat_${k}`),
    squad: t('fruit_cards.wp_title_squad'),
    squadSub: t('fruit_cards.wp_count', { count: pets.length }),
    neon: t('fruit_cards.wp_title_neon'),
    boardTitle: t('fruit_cards.wp_board_title'),
    boardSub: boardSource === 'top' ? t('fruit_cards.wp_board_top') : t('fruit_cards.wp_board_mine'),
    asOf: t('fruit_cards.wp_as_of', { date: today.toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }) }),
    total: catalog.length || null,
    watermark: `${config.appName} · ${t('fruit_cards.title')}`,
  };

  const save = async () => {
    if (!shot.current || saving || !pets.length) return;
    setSaving(true);
    try {
      if (!(await canSave())) {
        showErrorMessage(t('fruit_cards.wallpaper_permission'));
        return;
      }
      const uri = await shot.current.capture();
      await CameraRoll.save(uri, { type: 'photo' });
      trackGrowthEvent('card_wallpaper_save', { style, format, pets: pets.length });
      showSuccessMessage(t('fruit_cards.wallpaper_saved'));
    } catch (e) {
      showErrorMessage(t('fruit_cards.err.generic'));
    } finally {
      setSaving(false);
    }
  };

  const chip = (on, label, onPress, key) => (
    <TouchableOpacity key={key || label} onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && { color: '#1A0E00' }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Icon name="chevron-back" size={24} color={INK} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('fruit_cards.wallpaper_title')}</Text>
        <View style={styles.segment}>
          {Object.keys(FORMATS).map((f) => (
            <TouchableOpacity key={f} onPress={() => setFormat(f)} style={[styles.seg, format === f && { backgroundColor: ACCENT }]}>
              <Icon name={f === 'phone' ? 'phone-portrait-outline' : 'desktop-outline'} size={16} color={format === f ? '#1A0E00' : INK} />
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        {/* Preview: the real-size wallpaper, shown scaled */}
        <View style={{ alignItems: 'center', marginTop: 6 }}>
          <View style={{ width: F.w * scale, height: F.h * scale, borderRadius: format === 'phone' ? 26 : 10, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: '#000' }}>
            <View style={{ position: 'absolute', left: (F.w * scale - F.w) / 2, top: (F.h * scale - F.h) / 2, width: F.w, height: F.h, transform: [{ scale }] }}>
              <ViewShot ref={shot} options={{ format: 'jpg', quality: 0.95, width: F.out[0], height: F.out[1] }} style={{ width: F.w, height: F.h, overflow: 'hidden', backgroundColor: '#000' }}>
                <WallpaperArt style={style} F={F} pets={pets} background={bg} options={opts} labels={labels} />
              </ViewShot>
              {format === 'phone' && opts.clock ? (
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, width: F.w, top: F.h * 0.07, alignItems: 'center' }}>
                  <Text style={styles.clockDate}>{today.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
                  <Text style={styles.clockTime}>9:41</Text>
                </View>
              ) : null}
            </View>
          </View>
          {!pets.length ? (
            <View style={styles.emptyBox}>
              <Text style={styles.empty}>{t('fruit_cards.wallpaper_empty')}</Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('FruitCards')}>
                <Text style={styles.emptyBtnText}>{t('fruit_cards.title')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          {TABS.map((k) => (
            <TouchableOpacity key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabOn]}>
              <Text style={[styles.tabText, tab === k && { color: INK }]}>{t(`fruit_cards.wp_tab_${k}`)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'style' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {WP_STYLES.map((s) => (
              <TouchableOpacity key={s} onPress={() => setStyle(s)} style={[styles.styleTile, style === s && styles.styleTileOn]}>
                <Text style={styles.styleIcon}>{WP_STYLE_ICON[s]}</Text>
                <Text numberOfLines={1} style={[styles.styleName, style === s && { color: '#1A0E00' }]}>{t(`fruit_cards.wp_style_${s}`)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {tab === 'pets' ? (
          style === 'board' ? (
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              {chip(boardSource === 'mine', t('fruit_cards.wp_board_mine'), () => setBoardSource('mine'))}
              {chip(boardSource === 'top', t('fruit_cards.wp_board_top'), () => setBoardSource('top'))}
              <Text style={styles.hint}>{t('fruit_cards.wp_board_hint')}</Text>
            </View>
          ) : (
            <>
              <Text style={styles.hint}>{t('fruit_cards.wallpaper_pick', { max })}</Text>
              {mine.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                  {mine.slice(0, 80).map(({ c, b }) => {
                    const idx = pets.findIndex((x) => x.key === c.key);
                    return (
                      <TouchableOpacity key={c.key} onPress={() => toggle(c.key)} style={{ opacity: idx >= 0 ? 1 : 0.5 }}>
                        <FruitCard card={c} finish={b.finish} width={72} size="thumb" />
                        {idx >= 0 ? <View style={styles.tick}><Text style={styles.tickText}>{idx + 1}</Text></View> : null}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              ) : <Text style={styles.hint}>{t('fruit_cards.wallpaper_empty')}</Text>}
            </>
          )
        ) : null}

        {tab === 'background' ? (
          <>
            {lead ? (
              <>
                <Text style={styles.sub}>{t('fruit_cards.wp_match')}</Text>
                <View style={[styles.row, { flexDirection: 'row' }]}>
                  {['light', 'dark'].map((tone) => {
                    const on = background.type === 'match' && background.tone === tone;
                    return (
                      <TouchableOpacity key={tone} onPress={() => setBackground({ type: 'match', tone })} style={{ alignItems: 'center', width: 64 }}>
                        <View style={[styles.swatch, { backgroundImage: matchPalette(leadColors, tone).css }, on && styles.swatchOn]} />
                        <Text numberOfLines={1} style={[styles.swatchName, on && { color: ACCENT }]}>{t(`fruit_cards.wp_${tone}`)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  <Text style={[styles.hint, { flex: 1, marginTop: 0, paddingHorizontal: 0 }]}>{t('fruit_cards.wp_match_hint', { pet: lead.name })}</Text>
                </View>
              </>
            ) : null}
            {[['light', WP_LIGHT], ['dark', WP_DARK]].map(([tone, ids]) => (
              <React.Fragment key={tone}>
                <Text style={styles.sub}>{t(`fruit_cards.wp_${tone}`)}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                  {ids.map((id) => {
                    const on = background.type === 'gradient' && background.id === id;
                    return (
                      <TouchableOpacity key={id} onPress={() => setBackground({ type: 'gradient', id })} style={{ alignItems: 'center', width: 64 }}>
                        <View style={[styles.swatch, { backgroundImage: WP_GRADIENTS[id].css }, on && styles.swatchOn]} />
                        <Text numberOfLines={1} style={[styles.swatchName, on && { color: ACCENT }]}>{t(`fruit_cards.wp_bg.${id}`)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </React.Fragment>
            ))}
            <Text style={styles.sub}>{t('fruit_cards.wp_scenes')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {WP_SCENES.map((id) => {
                const on = background.type === 'scene' && background.id === id;
                return <TouchableOpacity key={id} onPress={() => setBackground({ type: 'scene', id })} style={[styles.scene, { backgroundImage: paintFor(id) }, on && styles.swatchOn]} />;
              })}
            </ScrollView>
            <Text style={styles.sub}>{t('fruit_cards.wp_pattern')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {WP_MOTIFS.map((m) => (
                <TouchableOpacity key={m} onPress={() => setOpts({ ...opts, motif: m })} style={[styles.motif, opts.motif === m && styles.swatchOn]}>
                  <Text style={{ fontSize: 22 }}>{WP_MOTIF_ICON[m]}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        ) : null}

        {tab === 'extras' ? (
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            {EXTRAS.map(([k, icon]) => chip(!!opts[k], `${icon} ${t(`fruit_cards.wp_opt_${k}`)}`, () => setOpts({ ...opts, [k]: !opts[k] }), k))}
          </View>
        ) : null}

        <TouchableOpacity disabled={!pets.length || saving} onPress={save} style={[styles.save, { opacity: pets.length ? 1 : 0.4 }]}>
          {saving ? <ActivityIndicator color="#1A0E00" /> : <Text style={styles.saveText}>{t('fruit_cards.wallpaper_save')}</Text>}
        </TouchableOpacity>
        <Text style={styles.note}>{t(`fruit_cards.wallpaper_note_${format}`)}</Text>
      </ScrollView>
      <ScreenBottomBanner background="#0B0816" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0816' },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  title: { color: INK, fontSize: 18, fontWeight: '900' },
  segment: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 3 },
  seg: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 13 },
  clockDate: { color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 4 },
  clockTime: { color: 'rgba(255,255,255,0.92)', fontSize: 92, fontWeight: '300', marginTop: -4, textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 6 },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginTop: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 14, padding: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 11 },
  tabOn: { backgroundColor: 'rgba(255,255,255,0.14)' },
  tabText: { color: MUTED, fontWeight: '800', fontSize: 13 },
  row: { gap: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center' },
  sub: { color: INK, fontWeight: '900', fontSize: 13, marginTop: 10, paddingHorizontal: 16 },
  hint: { color: MUTED, fontWeight: '700', fontSize: 12, paddingHorizontal: 16, marginTop: 10 },
  styleTile: { width: 82, height: 82, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  styleTileOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  styleIcon: { fontSize: 28 },
  styleName: { color: INK, fontWeight: '800', fontSize: 11, marginTop: 4, paddingHorizontal: 4 },
  swatch: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' },
  swatchName: { color: MUTED, fontSize: 10, fontWeight: '800', marginTop: 5, textAlign: 'center' },
  scene: { width: 52, height: 72, borderRadius: 10, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' },
  motif: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.12)' },
  swatchOn: { borderColor: ACCENT, borderWidth: 3 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  chipOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { color: INK, fontWeight: '800', fontSize: 13 },
  tick: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  tickText: { color: '#1A0E00', fontWeight: '900', fontSize: 12 },
  emptyBox: { alignItems: 'center', marginTop: 12, paddingHorizontal: 32 },
  empty: { color: MUTED, fontWeight: '700', textAlign: 'center' },
  emptyBtn: { marginTop: 10, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 18, backgroundColor: ACCENT },
  emptyBtnText: { color: '#1A0E00', fontWeight: '900' },
  save: { marginHorizontal: 16, marginTop: 18, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: ACCENT },
  saveText: { color: '#1A0E00', fontWeight: '900', fontSize: 16 },
  note: { color: MUTED, fontSize: 12, textAlign: 'center', marginTop: 10, paddingHorizontal: 24 },
});
