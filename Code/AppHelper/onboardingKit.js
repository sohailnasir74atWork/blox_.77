// onboardingKit.js — the pieces the three first-run steps share (Blox Fruits).
// Same file in the MM2, Adopt Me and Blox Fruit apps apart from the items,
// the colours and how a live value is read.
//
//   step 1  what the app does      three items and what they are worth
//   step 2  your trade             a trade feed, yours third in the list
//   step 3  the offer (OfferWall)  the same trade on top, with Pro
//
// One story, one skeleton: a progress bar, a title, one picture, one button.
// Only the picture changes between steps, so the offer reads as the last page
// of the introduction, not as a shop that appeared from nowhere.
//
// The pictures are BUNDLED (assets/onboarding, 128 px): six of the most in-demand fruits (Blox feed, demand column,
// 2026-11-10; pictures from bloxfruitscalc.com, our own site).
// Nothing here waits on the network, so the first screen is complete on the
// first frame. The value next to each is the live one from the catalogue as
// soon as it has loaded; until then (first launch, slow network) step 1 shows
// the `snapshot` taken when the pictures were bundled, so "know what every
// item is worth" never appears with no worth on it. REFRESH THE SNAPSHOTS
// WITH EVERY RELEASE (physical fruit values).
import React, { useMemo } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';


// ── Sizing ──
// Everything is drawn in units of the screen width, clamped, so a 320-wide
// phone and a 430-wide one get the same proportions, and a tablet gets a
// centred column instead of a stretched phone layout.
export const BASE_WIDTH = 390;
export const MAX_COLUMN = 520;
export const unitFor = (w) => Math.max(0.84, Math.min(1.28, Math.min(w, MAX_COLUMN) / BASE_WIDTH));
// Text never grows past this with the system font-size setting: a screen that
// wraps or clips at "Largest" sells nothing.
export const FONT_CAP = 1.15;
// A short screen (iPhone SE, small Androids): drop the optional pieces.
export const isCompact = (h) => h < 700;

// No custom font here: weights are plain fontWeight.
const BRAND = '#29AB87'; // onboarding's Continue button (the wall's BRAND)
const GOLD = '#FFC93C'; // the Pro badge (assets/pro.png)
const PRO_BADGE = require('../../assets/pro.png');

export const kitColors = (isDark) => (isDark
  ? {
    TEXT: '#FFFFFF', TEXT_SUB: '#CCCCCC', TEXT_MUTE: 'rgba(255,255,255,0.5)',
    CARD: 'rgba(255,255,255,0.06)', CARD_LINE: 'rgba(255,255,255,0.10)',
    TILE: 'rgba(255,255,255,0.08)', BRAND_TEXT: '#3CCB9F', PIN: '#F2C14E',
    TRACK: 'rgba(255,255,255,0.16)',
  }
  : {
    TEXT: '#000000', TEXT_SUB: '#666666', TEXT_MUTE: '#8E8E93',
    CARD: '#FFFFFF', CARD_LINE: '#E5E5EA',
    TILE: '#EAF7F3', BRAND_TEXT: '#1E8A6C', PIN: '#946200',
    TRACK: '#DCDCE3',
  });

// ── The bundled items ──
export const SAMPLE_ITEMS = [
  // snapshot: fruit value on 2026-11-10, formatted like the calculator
  { name: 'Kitsune', image: require('../../assets/onboarding/kitsune.png'), snapshot: '450.0M' },
  { name: 'West Dragon', image: require('../../assets/onboarding/west_dragon.png'), snapshot: '2.8B' },
  { name: 'Dough', image: require('../../assets/onboarding/dough.png'), snapshot: '30.0M' },
  { name: 'Venom', image: require('../../assets/onboarding/venom.png') },
  { name: 'Gas', image: require('../../assets/onboarding/gas.png') },
  { name: 'Buddha', image: require('../../assets/onboarding/buddha.png') },
];
const pick = (...idx) => idx.map((i) => SAMPLE_ITEMS[i].image);

// The trade the story follows (yours), and two other traders' trades around
// it. Illustrations, not listings — the names are sample traders.
export const MY_TRADE_ITEMS = pick(0, 2, 1, 4);
export const OTHER_TRADES = [
  { name: 'Mia', items: pick(3, 5, 2, 1) },
  { name: 'Leo', items: pick(4, 0, 5, 3) },
];
// Step 1 shows these three with their live value.
export const VALUE_ROW_ITEMS = [SAMPLE_ITEMS[0], SAMPLE_ITEMS[1], SAMPLE_ITEMS[2]];

// ── Live values for the bundled items ──
const norm = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// The calculator's own number format (HomeScreen formatValue).
const formatValue = (value) => {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
};
let valueCache = { data: null, map: {} };

// → { [fruit name]: "450.0M" } for the bundled fruits the catalogue prices;
// {} until the catalogue has loaded.
export const liveSampleValues = (localState) => {
  const data = localState?.data;
  if (!data) return {};
  if (valueCache.data === data) return valueCache.map;
  const map = {};
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    const rows = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    const wanted = new Map(SAMPLE_ITEMS.map((it) => [norm(it.name), it.name]));
    for (const row of rows) {
      const name = wanted.get(norm(row?.name));
      if (!name || map[name]) continue;
      const value = Number(row.value);
      if (Number.isFinite(value) && value > 0) map[name] = formatValue(value);
    }
  } catch (e) {
    // no live values: the rows show the bundled snapshot
  }
  valueCache = { data, map };
  return map;
};

// ── Progress: where you are in the three steps ──
export const ProgressBar = ({ step, total = 3, u, isDark }) => {
  const C = kitColors(isDark);
  const z = (n) => Math.round(n * u * 2) / 2;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: z(6) }}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{ width: z(30), height: z(4), borderRadius: z(2), backgroundColor: i < step ? BRAND : C.TRACK }}
        />
      ))}
    </View>
  );
};

// ── A trade card ──
// variant 'other' — someone else's trade, faded: the rest of the feed
//         'mine'  — your trade, where it sits today
//         'pro'   — your trade with Pro: gold frame, Pro badge, "on top"
// dense = one compact row (the feed around the trade that matters).
export const TradeCard = ({ u, isDark, compact, name, avatar, items = [], variant = 'other', dense, pinLabel }) => {
  const s = useMemo(() => cardStyles(u, isDark, compact), [u, isDark, compact]);
  const C = kitColors(isDark);
  const isPro = variant === 'pro';
  const itemStyle = dense ? s.itemDense : s.item;
  const slot = (i) => (
    items[i]
      ? <Image key={i} resizeMethod="resize" source={items[i]} style={itemStyle} resizeMode="contain" />
      : <View key={i} style={itemStyle} />
  );
  const avatarStyle = dense ? s.avatarDense : s.avatar;
  const who = (
    <>
      {avatar
        ? <Image resizeMethod="resize" source={{ uri: avatar }} style={avatarStyle} />
        : (
          <View style={[avatarStyle, s.avatarBlank]}>
            <Text style={dense ? s.avatarLetterDense : s.avatarLetter} maxFontSizeMultiplier={1}>
              {String(name || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
      <Text style={dense ? s.nameDense : s.name} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP}>{name}</Text>
      {isPro && <Image resizeMethod="resize" source={PRO_BADGE} style={s.pro} resizeMode="contain" />}
    </>
  );
  const sides = (
    <>
      <View style={s.side}>{slot(0)}{slot(1)}</View>
      <Icon name="swap-horizontal" size={dense ? s.nameDense.fontSize + 3 : s.name.fontSize + 6} color={C.TEXT_MUTE} />
      <View style={s.side}>{slot(2)}{slot(3)}</View>
    </>
  );
  const frame = [
    s.card,
    dense && s.cardDense,
    variant === 'other' && s.cardOther,
    variant === 'mine' && s.cardMine,
    isPro && s.cardPro,
  ];

  if (dense) {
    return (
      <View style={[frame, s.denseRow]}>
        <View style={s.denseWho}>{who}</View>
        <View style={s.denseSides}>{sides}</View>
      </View>
    );
  }
  return (
    <View style={frame}>
      <View style={s.head}>
        {who}
        {isPro && !!pinLabel && (
          <View style={s.pin}>
            <Icon name="arrow-up-circle" size={s.pinText.fontSize + 2} color={C.PIN} />
            <Text style={s.pinText} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP}>{pinLabel}</Text>
          </View>
        )}
      </View>
      <View style={s.row}>{sides}</View>
    </View>
  );
};

const cardStyles = (u, isDark, compact) => {
  const C = kitColors(isDark);
  const z = (n) => Math.round(n * u * 2) / 2;
  const item = z(compact ? 50 : 60);
  return StyleSheet.create({
    card: {
      backgroundColor: C.CARD,
      borderRadius: z(18),
      borderWidth: 1,
      borderColor: C.CARD_LINE,
      padding: z(14),
    },
    cardDense: { borderRadius: z(14), paddingVertical: z(8), paddingHorizontal: z(10) },
    cardOther: { opacity: 0.55 },
    cardMine: { borderWidth: 2, borderColor: BRAND },
    cardPro: { borderWidth: 2, borderColor: GOLD },

    head: { flexDirection: 'row', alignItems: 'center' },
    avatar: { width: z(34), height: z(34), borderRadius: z(17) },
    avatarDense: { width: z(26), height: z(26), borderRadius: z(13) },
    avatarBlank: { backgroundColor: C.TILE, alignItems: 'center', justifyContent: 'center' },
    avatarLetter: { color: C.BRAND_TEXT, fontSize: z(15), fontWeight: '800' },
    avatarLetterDense: { color: C.BRAND_TEXT, fontSize: z(12), fontWeight: '800' },
    name: { color: C.TEXT, fontSize: z(15.5), fontWeight: '800', marginLeft: z(9), flexShrink: 1 },
    nameDense: { color: C.TEXT, fontSize: z(13), fontWeight: '800', marginLeft: z(7), flexShrink: 1 },
    pro: { width: z(15), height: z(15), marginLeft: z(6) },
    pin: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto', paddingLeft: z(8) },
    pinText: { color: C.PIN, fontSize: z(13), fontWeight: '800', marginLeft: z(4) },

    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: z(12) },
    side: { flexDirection: 'row', gap: z(6) },
    item: { width: item, height: item, borderRadius: z(12), backgroundColor: C.TILE },
    itemDense: { width: z(30), height: z(30), borderRadius: z(8), backgroundColor: C.TILE },

    denseRow: { flexDirection: 'row', alignItems: 'center' },
    denseWho: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, paddingRight: z(8) },
    denseSides: { flexDirection: 'row', alignItems: 'center', gap: z(6) },
  });
};

// ── Step 1: an item and what it is worth ──
export const ValueRow = ({ u, isDark, item, value }) => {
  const C = kitColors(isDark);
  const z = (n) => Math.round(n * u * 2) / 2;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: C.CARD,
        borderRadius: z(16),
        borderWidth: 1,
        borderColor: C.CARD_LINE,
        paddingVertical: z(9),
        paddingHorizontal: z(12),
      }}
    >
      <Image
        resizeMethod="resize"
        source={item.image}
        resizeMode="contain"
        style={{ width: z(46), height: z(46), borderRadius: z(10), backgroundColor: C.TILE }}
      />
      <Text
        style={{ flex: 1, color: C.TEXT, fontSize: z(15.5), fontWeight: '800', marginLeft: z(12) }}
        numberOfLines={1}
        maxFontSizeMultiplier={FONT_CAP}
      >
        {item.name}
      </Text>
      {!!value && (
        <Text
          style={{ color: C.BRAND_TEXT, fontSize: z(17), fontWeight: '800', marginLeft: z(8) }}
          numberOfLines={1}
          maxFontSizeMultiplier={FONT_CAP}
        >
          {value}
        </Text>
      )}
    </View>
  );
};
