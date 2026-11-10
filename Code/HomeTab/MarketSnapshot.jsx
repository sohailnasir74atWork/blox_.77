import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import { fetchAnalyticsData, analyticsCache, CHANGES_CACHE_KEY } from '../Helper/analyticsDataHelper';

// Home "Market" card (replaces the old Hot/Dropping TrendingFruits card).
// Only data the app already downloads, through fetchAnalyticsData's cache:
//   - https://blox-api.b-cdn.net/diff.json (latest value update): meta.generatedAt
//     for "Updated X ago", changed[].value / .permValue {oldVal,newVal} for
//     rising/falling. Normal and Permanent are separate items, as in the calculator.
//   - https://analytics-blox.b-cdn.net: tradeVolume.last24h, only while its
//     computedAt is under 24 h old.
// Hidden when the diff is missing or nothing moved. Tap → Analytics screen
// (there is no per-item detail screen in this app).

const GREEN = '#10B981';
const RED = '#EF4444';
const DAY_MS = 24 * 60 * 60 * 1000;

const pctChange = (v) => {
  if (!v || typeof v !== 'object') return null;
  const oldVal = Number(v.oldVal);
  const newVal = Number(v.newVal);
  if (!Number.isFinite(oldVal) || !Number.isFinite(newVal) || oldVal <= 0) return null;
  return Math.round(((newVal - oldVal) / oldVal) * 100);
};

const compact = (n) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const parse = (raw) => {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

const buildSnapshot = () => {
  const diff = parse(analyticsCache?.getString(CHANGES_CACHE_KEY));
  const changed = Array.isArray(diff?.changed) ? diff.changed : [];
  const rising = [];
  const falling = [];
  changed.forEach((item) => {
    if (!item?.name) return;
    [['value', 'n'], ['permValue', 'p']].forEach(([field, type]) => {
      const pct = pctChange(item[field]);
      if (pct == null) return;
      const entry = { key: `${item.name}_${type}`, name: item.name, type, pct };
      if (pct >= 1) rising.push(entry);
      else if (pct <= -1) falling.push(entry);
    });
  });
  if (rising.length === 0 && falling.length === 0) return null;
  rising.sort((a, b) => b.pct - a.pct);
  falling.sort((a, b) => a.pct - b.pct);

  const generatedAt = Date.parse(diff?.meta?.generatedAt || '');

  const analytics = parse(analyticsCache?.getString('analytics'));
  const computedAt = Date.parse(analytics?.computedAt || '');
  const trades = Number(analytics?.tradeVolume?.last24h);
  const tradesFresh = Number.isFinite(computedAt) && Date.now() - computedAt < DAY_MS && trades > 0;

  return {
    updatedAt: Number.isFinite(generatedAt) ? generatedAt : null,
    risingCount: rising.length,
    fallingCount: falling.length,
    topRising: rising.slice(0, 3),
    topFalling: falling.slice(0, 3),
    trades24h: tradesFresh ? trades : null,
  };
};

const MarketSnapshot = ({ isDarkMode, navigation }) => {
  const { t } = useTranslation();
  const [snap, setSnap] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchAnalyticsData()
      .catch(() => null)
      .then(() => { if (alive) setSnap(buildSnapshot()); });
    return () => { alive = false; };
  }, []);

  const updatedText = useMemo(() => {
    if (!snap?.updatedAt) return null;
    const mins = Math.max(0, Math.floor((Date.now() - snap.updatedAt) / 60000));
    let ago;
    if (mins < 1) ago = t('chat.just_now');
    else if (mins < 60) ago = t('chat.mins_ago', { count: mins });
    else if (mins < 1440) ago = t('chat.hours_ago', { count: Math.floor(mins / 60) });
    else ago = t('chat.days_ago', { count: Math.floor(mins / 1440) });
    return t('home.home_screen.updated', { time: ago });
  }, [snap?.updatedAt, t]);

  if (!snap) return null;

  const text = isDarkMode ? '#f1f5f9' : '#0f172a';
  const sub = isDarkMode ? config.darkColors.textSecondary : '#64748b';
  const chipBg = isDarkMode ? '#334155' : '#f1f5f9';
  const surface = isDarkMode ? config.colors.surfaceDark : '#fff';
  const perm = t('home.home_screen.perm');

  const tiles = [
    { key: 'up', label: t('trending.rising', { defaultValue: 'Rising' }), value: snap.risingCount, color: GREEN },
    { key: 'down', label: t('trending.falling', { defaultValue: 'Falling' }), value: snap.fallingCount, color: RED },
    snap.trades24h != null && { key: 'trades', label: t('trending.trades_24h', { defaultValue: 'Trades (24h)' }), value: compact(snap.trades24h), color: text },
  ].filter(Boolean);

  const renderColumn = (list, color) => (
    <View style={styles.column}>
      {list.map((m) => (
        <View key={m.key} style={styles.moverRow}>
          <Text style={[styles.moverName, { color: text }]} numberOfLines={1}>
            {m.type === 'p' ? `${perm} ${m.name}` : m.name}
          </Text>
          <Text style={[styles.moverPct, { color }]}>{m.pct > 0 ? `+${m.pct}` : m.pct}%</Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={styles.section}>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => navigation.navigate('Analytics')}
        style={[styles.card, { backgroundColor: surface }]}
        accessibilityRole="button"
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: text }]}>{t('trending.market', { defaultValue: 'Market' })}</Text>
          {!!updatedText && <Text style={[styles.updated, { color: sub }]} numberOfLines={1}>{updatedText}</Text>}
          <FontAwesome name="chevron-right" size={10} color={sub} style={styles.chevron} />
        </View>

        <View style={styles.tilesRow}>
          {tiles.map((tile) => (
            <View key={tile.key} style={[styles.tile, { backgroundColor: chipBg }]}>
              <Text style={[styles.tileValue, { color: tile.color }]} numberOfLines={1}>{tile.value}</Text>
              <Text style={[styles.tileLabel, { color: sub }]} numberOfLines={1}>{tile.label}</Text>
            </View>
          ))}
        </View>

        {(snap.topRising.length > 0 || snap.topFalling.length > 0) && (
          <View style={styles.columns}>
            {renderColumn(snap.topRising, GREEN)}
            {renderColumn(snap.topFalling, RED)}
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, marginTop: 8 },
  card: { borderRadius: 14, padding: 12 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 15, fontWeight: '700' },
  updated: { fontSize: 11, marginLeft: 8, flexShrink: 1 },
  chevron: { marginLeft: 'auto' },
  tilesRow: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 8, alignItems: 'center' },
  tileValue: { fontSize: 15, fontWeight: '700' },
  tileLabel: { fontSize: 11, marginTop: 2 },
  columns: { flexDirection: 'row', gap: 12, marginTop: 10 },
  column: { flex: 1 },
  moverRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  moverName: { fontSize: 12, flex: 1, marginRight: 6 },
  moverPct: { fontSize: 12, fontWeight: '700' },
});

export default MarketSnapshot;
