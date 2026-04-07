import React, { useEffect, useState, useMemo, memo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
} from 'react-native';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../LocalGlobelStats';
import config from '../Helper/Environment';
import { fetchAnalyticsData, analyticsCache, CHANGES_CACHE_KEY } from '../Helper/analyticsDataHelper';

const SKIP_KEYS = new Set(['name', 'rarity', 'type', 'image', 'id']);

const formatName = (name) => name?.replace(/^\+/, '').replace(/\s+/g, '-') || '';

const getImageUrl = (name) => {
  if (!name) return '';
  return `https://bloxfruitscalc.com/wp-content/uploads/2024/09/${formatName(name)}_Icon.webp`;
};

// Extract primary value change from a diff item
const getPrimaryChange = (item) => {
  // Check 'value' field first (most common)
  if (item.value && typeof item.value === 'object' && 'oldVal' in item.value && 'newVal' in item.value) {
    const diff = item.value.newVal - item.value.oldVal;
    const pct = item.value.oldVal > 0 ? Math.round((diff / item.value.oldVal) * 100) : 0;
    return { pct, oldVal: item.value.oldVal, newVal: item.value.newVal };
  }

  // Check permValue
  if (item.permValue && typeof item.permValue === 'object' && 'oldVal' in item.permValue && 'newVal' in item.permValue) {
    const diff = item.permValue.newVal - item.permValue.oldVal;
    const pct = item.permValue.oldVal > 0 ? Math.round((diff / item.permValue.oldVal) * 100) : 0;
    return { pct, oldVal: item.permValue.oldVal, newVal: item.permValue.newVal };
  }

  // Check any other value fields
  for (const k of Object.keys(item)) {
    if (SKIP_KEYS.has(k)) continue;
    const v = item[k];
    if (v && typeof v === 'object' && 'oldVal' in v && 'newVal' in v) {
      const diff = v.newVal - v.oldVal;
      const pct = v.oldVal > 0 ? Math.round((diff / v.oldVal) * 100) : 0;
      return { pct, oldVal: v.oldVal, newVal: v.newVal };
    }
  }
  return null;
};

const MiniRow = memo(({ fruit, isDark, isGainer }) => (
  <View style={[styles.miniRow, { backgroundColor: isDark ? '#1C1C1E' : '#fff' }]}>
    <Image
      source={{ uri: fruit.imageUrl }}
      style={styles.miniImage}
      resizeMode="contain"
      defaultSource={require('../../assets/logo.png')}
    />
    <Text style={[styles.miniName, { color: isDark ? '#fff' : '#111' }]} numberOfLines={1}>
      {fruit.displayName}
    </Text>
    <Text style={[styles.miniPct, { color: isGainer ? '#10B981' : '#EF4444' }]}>
      {isGainer ? '+' : ''}{fruit.pct}%
    </Text>
  </View>
));

const TrendingFruits = ({ isDarkMode, navigation }) => {
  const { localState } = useLocalState();
  const { t } = useTranslation();
  const [gainers, setGainers] = useState([]);
  const [losers, setLosers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchGen, setFetchGen] = useState(0);

  useEffect(() => {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const cached = analyticsCache?.getString(CHANGES_CACHE_KEY);
    const cachedTs = analyticsCache?.getNumber('value_changes_ts');
    const isFresh = cached && cachedTs && (Date.now() - cachedTs < FOUR_HOURS_MS);
    if (isFresh) {
      setFetchGen(g => g + 1);
    } else {
      fetchAnalyticsData()
        .then(() => setFetchGen(g => g + 1))
        .catch(() => setLoading(false));
    }
  }, []);

  // Parse all fruits from local data for image lookup
  const fruitMap = useMemo(() => {
    try {
      const rawData = localState.data;
      if (!rawData) return {};
      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      const items = typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
      const map = {};
      items.forEach(item => {
        if (item?.Name) map[(item.Name || '').toLowerCase().trim()] = item;
      });
      return map;
    } catch {
      return {};
    }
  }, [localState.data]);

  useEffect(() => {
    if (fetchGen === 0) return;

    try {
      const cachedChanges = analyticsCache?.getString(CHANGES_CACHE_KEY);
      if (!cachedChanges) { setLoading(false); return; }

      const changesData = JSON.parse(cachedChanges);
      const rawList = Array.isArray(changesData?.changed) ? changesData.changed
        : Array.isArray(changesData?.changes) ? changesData.changes
          : [];

      const gainersList = [];
      const losersList = [];

      rawList.forEach((item) => {
        const name = String(item.name || '').toLowerCase().trim();
        if (!name) return;

        const change = getPrimaryChange(item);
        if (!change || change.pct === 0) return;

        const fruit = fruitMap[name];
        const displayName = fruit?.Name || item.name || name;
        const entry = {
          id: name,
          displayName,
          imageUrl: getImageUrl(item.name || displayName),
          pct: change.pct,
        };

        if (change.pct > 0) {
          gainersList.push(entry);
        } else {
          losersList.push(entry);
        }
      });

      gainersList.sort((a, b) => b.pct - a.pct);
      losersList.sort((a, b) => a.pct - b.pct);

      setGainers(gainersList.slice(0, 3));
      setLosers(losersList.slice(0, 3));
    } catch (err) {
      console.warn('[TrendingFruits] Error:', err.message);
    } finally {
      setLoading(false);
    }
  }, [fruitMap, fetchGen]);

  if (!loading && gainers.length === 0 && losers.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <FontAwesome name="chart-simple" size={18} color={isDarkMode ? '#fff' : '#111'} solid />
          <Text style={[styles.title, { color: isDarkMode ? '#fff' : '#111' }]}>
            {t('trending.market_overview', { defaultValue: 'Market Overview' })}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('Analytics')}
          activeOpacity={0.7}
          style={styles.seeAll}
        >
          <Text style={styles.seeAllText}>{t('trending.full_analytics', { defaultValue: 'Full Analytics' })}</Text>
          <FontAwesome name="chevron-right" size={10} color={config.colors.primary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.listsRow}>
          {[0, 1].map((col) => (
            <View key={col} style={[styles.listCard, { backgroundColor: isDarkMode ? '#1a2332' : col === 0 ? '#F0FDF4' : '#FEF2F2' }]}>
              <View style={styles.listHeader}>
                <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: isDarkMode ? '#333' : '#ddd' }} />
                <View style={{ width: 40, height: 12, borderRadius: 3, backgroundColor: isDarkMode ? '#333' : '#ddd' }} />
              </View>
              {[0, 1, 2].map((row) => (
                <View key={row} style={[styles.miniRow, { backgroundColor: isDarkMode ? '#1C1C1E' : '#fff' }]}>
                  <View style={[styles.miniImage, { backgroundColor: isDarkMode ? '#333' : '#f0f0f0' }]} />
                  <View style={{ flex: 1, height: 10, borderRadius: 3, backgroundColor: isDarkMode ? '#333' : '#e5e5e5' }} />
                  <View style={{ width: 30, height: 10, borderRadius: 3, marginLeft: 4, backgroundColor: isDarkMode ? '#333' : '#e5e5e5' }} />
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : (
      <View style={styles.listsRow}>
        {gainers.length > 0 && (
          <View style={[styles.listCard, { backgroundColor: isDarkMode ? '#1a2332' : '#F0FDF4' }]}>
            <View style={styles.listHeader}>
              <FontAwesome name="fire-flame-curved" size={12} color="#10B981" solid />
              <Text style={[styles.listTitle, { color: '#10B981' }]}>{t('trending.hot', { defaultValue: 'Hot' })}</Text>
            </View>
            {gainers.map((fruit) => (
              <MiniRow key={fruit.id} fruit={fruit} isDark={isDarkMode} isGainer />
            ))}
          </View>
        )}

        {losers.length > 0 && (
          <View style={[styles.listCard, { backgroundColor: isDarkMode ? '#2a1a1a' : '#FEF2F2' }]}>
            <View style={styles.listHeader}>
              <FontAwesome name="arrow-trend-down" size={12} color="#EF4444" solid />
              <Text style={[styles.listTitle, { color: '#EF4444' }]}>{t('trending.dropping', { defaultValue: 'Dropping' })}</Text>
            </View>
            {losers.map((fruit) => (
              <MiniRow key={fruit.id} fruit={fruit} isDark={isDarkMode} isGainer={false} />
            ))}
          </View>
        )}
      </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: config.colors.primary,
  },
  listsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  listCard: {
    flex: 1,
    borderRadius: 14,
    padding: 10,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  listTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 8,
    marginBottom: 4,
  },
  miniImage: {
    width: 26,
    height: 26,
    borderRadius: 6,
    marginRight: 6,
  },
  miniName: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
  },
  miniPct: {
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 4,
  },
});

export default TrendingFruits;
