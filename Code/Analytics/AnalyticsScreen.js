import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, RefreshControl, Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import config from '../Helper/Environment';
import { MMKV } from 'react-native-mmkv';
import BannerAdComponent from '../Ads/bannerAds';
import SubscriptionScreen from '../SettingScreen/OfferWall';
// translations removed — plain English used throughout

const analyticsCache = new MMKV({ id: 'analytics-cache' });

// Cache duration
const ANALYTICS_CACHE_MS = 3 * 60 * 60 * 1000; // 3 hours

// CDN URL — push RTDB /analytics data here after cloud function runs
const ANALYTICS_CDN_URL = 'https://analytics-blox.b-cdn.net';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Visual multiplier — cosmetic boost for displayed counts only
// Does NOT affect ratios, percentages, confidence, or prediction logic
const VM = 2;

// Color palettes
const FUN_COLORS = {
  blue: '#4F8CFF', green: '#34D399', pink: '#F472B6', purple: '#A78BFA',
  orange: '#FB923C', red: '#F87171', yellow: '#FBBF24', cyan: '#22D3EE',
};
const BAR_COLORS = [
  '#4F8CFF','#A78BFA','#F472B6','#FB923C','#34D399','#FBBF24',
  '#22D3EE','#F87171','#4F8CFF','#A78BFA','#F472B6','#FB923C',
  '#34D399','#FBBF24','#22D3EE','#F87171','#4F8CFF','#A78BFA',
  '#F472B6','#FB923C','#34D399','#FBBF24','#22D3EE','#F87171',
];

const AnalyticsScreen = ({ navigation }) => {
  const { theme, single_offer_wall } = useGlobalState();
  const { localState } = useLocalState();
  // no translations — plain English
  const isDarkMode = theme === 'dark';
  const isPro = localState.isPro;

  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [showOfferwall, setShowOfferwall] = useState(false);

  // ── Fetch from Bunny CDN with MMKV caching ──
  const fetchFromCDN = useCallback(async (url, cacheKey, cacheDuration) => {
    try {
      const cachedRaw = analyticsCache.getString(cacheKey);
      const cachedTimeRaw = analyticsCache.getString(cacheKey + '_time');

      if (cachedRaw && cachedTimeRaw) {
        const cachedTime = parseInt(cachedTimeRaw, 10);
        const age = Date.now() - cachedTime;
        if (age < cacheDuration) {
          return JSON.parse(cachedRaw);
        }
      }

      const res = await fetch(url + '?cb=' + Date.now());
      const data = await res.json();

      analyticsCache.set(cacheKey, JSON.stringify(data));
      analyticsCache.set(cacheKey + '_time', Date.now().toString());

      return data;
    } catch (error) {
      const cachedRaw = analyticsCache.getString(cacheKey);
      if (cachedRaw) return JSON.parse(cachedRaw);
      return null;
    }
  }, []);

  const fetchAnalytics = useCallback(async (isRefresh) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
        analyticsCache.delete('analytics');
        analyticsCache.delete('analytics_time');
      } else {
        setLoading(true);
      }

      const data = await fetchFromCDN(ANALYTICS_CDN_URL, 'analytics', ANALYTICS_CACHE_MS);
      if (data) setAnalytics(data);
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchFromCDN]);

  useEffect(() => {
    fetchAnalytics(false);
  }, [fetchAnalytics]);

  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const formatNumber = (num) => {
    if (!num && num !== 0) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const getTypeLabel = (type) => {
    if (type === 'p') return 'Permanent';
    if (type === 'n') return 'Normal';
    return type || 'Normal';
  };

  const getSignalColor = (signal) => {
    switch (signal) {
      case 'rising': case 'strong_rise': case 'likely_rise': return FUN_COLORS.green;
      case 'falling': case 'strong_fall': case 'likely_fall': return FUN_COLORS.red;
      default: return FUN_COLORS.yellow;
    }
  };

  const getSignalEmoji = (signal) => {
    switch (signal) {
      case 'rising': case 'strong_rise': case 'likely_rise': return 'trending-up';
      case 'falling': case 'strong_fall': case 'likely_fall': return 'trending-down';
      default: return 'remove-outline';
    }
  };

  const getPredictionLabel = (prediction) => {
    switch (prediction) {
      case 'strong_rise': return 'Strong Rise';
      case 'likely_rise': return 'Likely Rise';
      case 'stable': return 'Stable';
      case 'likely_fall': return 'Likely Fall';
      case 'strong_fall': return 'Strong Fall';
      default: return 'Unknown';
    }
  };

  const getPredictionEmoji = (prediction) => {
    switch (prediction) {
      case 'strong_rise': return '\u{1F525}';
      case 'likely_rise': return '\u{2B06}\u{FE0F}';
      case 'stable': return '\u{1F7F0}';
      case 'likely_fall': return '\u{2B07}\u{FE0F}';
      case 'strong_fall': return '\u{1F4A8}';
      default: return '\u{2753}';
    }
  };

  // ── Locked Feature Overlay ──
  const LockedOverlay = ({ message }) => (
    <TouchableOpacity
      style={styles.lockedOverlay}
      activeOpacity={0.9}
      onPress={() => setShowOfferwall(true)}
    >
      <View style={styles.lockedContent}>
        <Text style={{ fontSize: 24 }}>{'\u{1F512}'}</Text>
        <Text style={styles.lockedText}>{message || 'Unlock with Pro'}</Text>
        <View style={styles.unlockButton}>
          <Text style={styles.unlockButtonText}>{'\u{2B50}'} {'Upgrade'}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  // ── Item Row Component ──
  const ItemRow = ({ item, index, showSignal, showChange, showValue }) => {
    const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
    const rankDisplay = index < 3 ? medals[index] : '#' + (index + 1);
    return (
      <View style={[styles.itemRow, index % 2 === 0 && styles.itemRowAlt]}>
        <Text style={[styles.itemRank, index < 3 && { fontSize: 18 }]}>{rankDisplay}</Text>
        <View style={styles.itemImageWrap}>
          {item.image ? (
            <Image source={{ uri: item.image }} style={styles.itemImage} />
          ) : (
            <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
              <Icon name="cube-outline" size={18} color={isDarkMode ? '#666' : '#bbb'} />
            </View>
          )}
        </View>
        <View style={styles.itemInfo}>
          <Text style={styles.itemName} numberOfLines={1}>{item.name || '???'}</Text>
          <Text style={styles.itemType}>{getTypeLabel(item.type)}</Text>
        </View>
        {showSignal && item.signal && (
          <View style={[styles.signalBadge, { backgroundColor: getSignalColor(item.signal) + '25' }]}>
            <Icon name={getSignalEmoji(item.signal)} size={16} color={getSignalColor(item.signal)} />
            <Text style={[styles.signalText, { color: getSignalColor(item.signal) }]}>
              {item.ratio ? item.ratio.toFixed(1) + 'x' : ''}
            </Text>
          </View>
        )}
        {showChange && item.changePercent !== undefined && (
          <View style={[styles.changeBadge, {
            backgroundColor: item.changePercent > 0 ? FUN_COLORS.green + '25' : FUN_COLORS.red + '25'
          }]}>
            <Text style={{ fontSize: 12 }}>{item.changePercent > 0 ? '\u{1F4C8}' : '\u{1F4C9}'}</Text>
            <Text style={[styles.changeText, {
              color: item.changePercent > 0 ? FUN_COLORS.green : FUN_COLORS.red
            }]}>
              {Math.abs(item.changePercent)}%
            </Text>
          </View>
        )}
        {showValue && item.totalValue !== undefined && (
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{formatNumber(item.totalValue)}</Text>
          </View>
        )}
        {!showSignal && !showChange && !showValue && (
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{(item.count || 0) * VM}x</Text>
          </View>
        )}
      </View>
    );
  };

  // ── Fun Colorful Bar Chart ──
  const MiniBarChart = ({ data, label }) => {
    const maxVal = Math.max.apply(null, data.concat([1]));
    return (
      <View style={styles.chartContainer}>
        <Text style={styles.chartLabel}>{label}</Text>
        <View style={styles.chartBars}>
          {data.map((val, i) => {
            const isPeak = i === (analytics ? analytics.peakHour : -1);
            return (
              <View key={i} style={styles.chartBarWrap}>
                <View
                  style={[
                    styles.chartBar,
                    {
                      height: Math.max(4, (val / maxVal) * 70),
                      backgroundColor: isPeak ? FUN_COLORS.orange : BAR_COLORS[i],
                      opacity: isPeak ? 1 : 0.7,
                    },
                  ]}
                />
                {i % 4 === 0 && (
                  <Text style={styles.chartBarLabel}>{i}h</Text>
                )}
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  // ── Section Header ──
  const SectionHeader = ({ icon, title, subtitle, locked, emoji }) => (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderLeft}>
        {emoji ? (
          <Text style={{ fontSize: 20 }}>{emoji}</Text>
        ) : (
          <FontAwesome name={icon} size={18} color={config.colors.primary} solid />
        )}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {locked && (
        <View style={styles.proBadge}>
          <Text style={{ fontSize: 12 }}>{'\u{1F451}'}</Text>
          <Text style={styles.proBadgeText}>PRO</Text>
        </View>
      )}
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
    </View>
  );

  // ── Tab Bar ──
  const tabs = [
    { key: 'overview', label: 'Overview', emoji: '\u{1F3E0}' },
    { key: 'movers', label: 'Movers', emoji: '\u{1F680}' },
    { key: 'demand', label: 'Demand', emoji: '\u{1F525}' },
    { key: 'predict', label: 'Predict', emoji: '\u{1F52E}' },
  ];

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={{ fontSize: 40, marginBottom: 8 }}>{'\u{1F50D}'}</Text>
        <ActivityIndicator size="large" color={FUN_COLORS.purple} />
        <Text style={styles.loadingText}>Loading analytics...</Text>
      </View>
    );
  }

  if (!analytics) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={{ fontSize: 48 }}>{'\u{1F914}'}</Text>
        <Text style={styles.emptyTitle}>No Analytics Yet</Text>
        <Text style={styles.emptySubtitle}>Check back later when more trades have been made.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => fetchAnalytics(false)}>
          <Text style={styles.retryButtonText}>{'\u{1F504}'} {'Retry'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Tab Bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBarScroll}
        contentContainerStyle={styles.tabBar}
      >
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={{ fontSize: 16 }}>{tab.emoji}</Text>
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]} numberOfLines={1}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => fetchAnalytics(true)} tintColor={FUN_COLORS.purple} />
        }
      >
        {/* ═══════════════ OVERVIEW TAB ═══════════════ */}
        {activeTab === 'overview' && (
          <>
            {/* Trade Volume Cards */}
            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: isDarkMode ? '#1a2540' : '#EBF5FF', borderColor: FUN_COLORS.blue + '40' }]}>
                <Text style={styles.statEmoji}>{'\u{1F91D}'}</Text>
                <Text style={[styles.statNumber, { color: FUN_COLORS.blue }]}>{formatNumber((analytics.tradeVolume?.today || 0) * VM)}</Text>
                <Text style={styles.statLabel}>Today</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: isDarkMode ? '#1a2a1a' : '#ECFDF5', borderColor: FUN_COLORS.green + '40' }]}>
                <Text style={styles.statEmoji}>{'\u{23F0}'}</Text>
                <Text style={[styles.statNumber, { color: FUN_COLORS.green }]}>{formatNumber((analytics.tradeVolume?.last24h || 0) * VM)}</Text>
                <Text style={styles.statLabel}>24h</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: isDarkMode ? '#2a1a2e' : '#FDF2F8', borderColor: FUN_COLORS.pink + '40' }]}>
                <Text style={styles.statEmoji}>{'\u{1F4C5}'}</Text>
                <Text style={[styles.statNumber, { color: FUN_COLORS.pink }]}>{formatNumber((analytics.tradeVolume?.thisWeek || 0) * VM)}</Text>
                <Text style={styles.statLabel}>This Week</Text>
              </View>
            </View>

            {/* Win/Lose/Fair Distribution */}
            {analytics.statusDistribution && (
              <View style={styles.card}>
                <SectionHeader icon="chart-pie" title={'Trade Outcomes'} emoji={'\u{1F3AF}'} />
                <View style={styles.distributionRow}>
                  <View style={styles.distributionItem}>
                    <Text style={styles.distributionEmoji}>{'\u{1F389}'}</Text>
                    <Text style={[styles.distributionLabel, { color: FUN_COLORS.green }]}>Win</Text>
                    <Text style={[styles.distributionValue, { color: FUN_COLORS.green }]}>{(analytics.statusDistribution.win || 0) * VM}</Text>
                  </View>
                  <View style={styles.distributionItem}>
                    <Text style={styles.distributionEmoji}>{'\u{1F91D}'}</Text>
                    <Text style={[styles.distributionLabel, { color: FUN_COLORS.yellow }]}>Fair</Text>
                    <Text style={[styles.distributionValue, { color: FUN_COLORS.yellow }]}>{(analytics.statusDistribution.fair || 0) * VM}</Text>
                  </View>
                  <View style={styles.distributionItem}>
                    <Text style={styles.distributionEmoji}>{'\u{1F614}'}</Text>
                    <Text style={[styles.distributionLabel, { color: FUN_COLORS.red }]}>Lose</Text>
                    <Text style={[styles.distributionValue, { color: FUN_COLORS.red }]}>{(analytics.statusDistribution.lose || 0) * VM}</Text>
                  </View>
                </View>
                {/* Rounded bar */}
                <View style={styles.distributionBar}>
                  {(() => {
                    const total = (analytics.statusDistribution.win || 0) +
                      (analytics.statusDistribution.fair || 0) +
                      (analytics.statusDistribution.lose || 0);
                    if (total === 0) return null;
                    const winPct = ((analytics.statusDistribution.win || 0) / total) * 100;
                    const fairPct = ((analytics.statusDistribution.fair || 0) / total) * 100;
                    const losePct = ((analytics.statusDistribution.lose || 0) / total) * 100;
                    return (
                      <>
                        <View style={[styles.distributionBarSegment, { width: winPct + '%', backgroundColor: FUN_COLORS.green }]} />
                        <View style={[styles.distributionBarSegment, { width: fairPct + '%', backgroundColor: FUN_COLORS.yellow }]} />
                        <View style={[styles.distributionBarSegment, { width: losePct + '%', backgroundColor: FUN_COLORS.red }]} />
                      </>
                    );
                  })()}
                </View>
              </View>
            )}

            {/* Hourly Activity */}
            {analytics.hourlyActivity && (
              <View style={styles.card}>
                <SectionHeader icon="chart-bar" title={'Hourly Activity'} subtitle={'Peak: ' + analytics.peakHour + 'h'} emoji={'\u{1F552}'} />
                <MiniBarChart data={analytics.hourlyActivity} label={'Trades per hour'} />
              </View>
            )}

            {/* Top 5 Most Traded */}
            <View style={styles.card}>
              <SectionHeader icon="fire" title={'Most Traded Fruits'} emoji={'\u{1F525}'} />
              {(analytics.topTraded || []).slice(0, 5).map((item, i) => (
                <ItemRow key={'traded-' + i} item={item} index={i} />
              ))}
            </View>

            {/* Top 5 By Value */}
            {analytics.topByValue && analytics.topByValue.length > 0 && (
              <View style={styles.card}>
                <SectionHeader icon="gem" title={'Highest Value Traded'} emoji={'\u{1F48E}'} />
                {(analytics.topByValue || []).slice(0, 5).map((item, i) => (
                  <ItemRow key={'value-' + i} item={item} index={i} showValue />
                ))}
              </View>
            )}
          </>
        )}

        {/* ═══════════════ MOVERS TAB ═══════════════ */}
        {activeTab === 'movers' && (
          <>
            {/* Top Movers (Rising) */}
            <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: FUN_COLORS.green }]}>
              <SectionHeader icon="arrow-trend-up" title={'Top Movers'} subtitle={'Rising demand this week'} emoji={'\u{1F680}'} />
              {(analytics.topMovers || []).slice(0, isPro ? 10 : 3).map((item, i) => (
                <ItemRow key={'mover-' + i} item={item} index={i} showChange />
              ))}
              {!isPro && (analytics.topMovers || []).length > 3 && (
                <LockedOverlay message={'See all movers'} />
              )}
            </View>

            {/* Top Losers (Falling) */}
            <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: FUN_COLORS.red }]}>
              <SectionHeader icon="arrow-trend-down" title={'Top Losers'} subtitle={'Falling demand this week'} emoji={'\u{1F4C9}'} />
              {(analytics.topLosers || []).slice(0, isPro ? 10 : 3).map((item, i) => (
                <ItemRow key={'loser-' + i} item={item} index={i} showChange />
              ))}
              {!isPro && (analytics.topLosers || []).length > 3 && (
                <LockedOverlay message={'See all losers'} />
              )}
            </View>
          </>
        )}

        {/* ═══════════════ DEMAND TAB ═══════════════ */}
        {activeTab === 'demand' && (
          <>
            {/* Most Wanted */}
            <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: FUN_COLORS.pink }]}>
              <SectionHeader icon="heart" title={'Most Wanted'} subtitle={'Highest demand fruits'} emoji={'\u{2764}\u{FE0F}'} />
              {(analytics.topWanted || []).slice(0, isPro ? 15 : 5).map((item, i) => (
                <ItemRow key={'wanted-' + i} item={item} index={i} />
              ))}
              {!isPro && (analytics.topWanted || []).length > 5 && (
                <LockedOverlay message={'See full demand list'} />
              )}
            </View>

            {/* Most Offered */}
            <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: FUN_COLORS.blue }]}>
              <SectionHeader icon="box-open" title={'Most Offered'} subtitle={'Highest supply fruits'} emoji={'\u{1F4E6}'} />
              {(analytics.topOffered || []).slice(0, isPro ? 15 : 5).map((item, i) => (
                <ItemRow key={'offered-' + i} item={item} index={i} />
              ))}
              {!isPro && (analytics.topOffered || []).length > 5 && (
                <LockedOverlay message={'See full supply list'} />
              )}
            </View>

            {/* Demand/Supply Ratios */}
            {isPro ? (
              <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: FUN_COLORS.purple }]}>
                <SectionHeader icon="scale-balanced" title={'Demand vs Supply'} subtitle={'Items with highest demand-to-supply ratio'} locked={false} emoji={'\u{2696}\u{FE0F}'} />
                {(analytics.demandSupplyRatios || []).slice(0, 15).map((item, i) => (
                  <ItemRow key={'ds-' + i} item={item} index={i} showSignal />
                ))}
              </View>
            ) : (
              <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: FUN_COLORS.purple }]}>
                <SectionHeader icon="scale-balanced" title={'Demand vs Supply'} locked emoji={'\u{2696}\u{FE0F}'} />
                <View style={{ height: 120, justifyContent: 'center' }}>
                  <LockedOverlay message={'Unlock demand/supply ratios'} />
                </View>
              </View>
            )}
          </>
        )}

        {/* ═══════════════ PREDICT TAB ═══════════════ */}
        {activeTab === 'predict' && (
          <>
            {/* Prediction Header */}
            <View style={[styles.card, { backgroundColor: isDarkMode ? '#1a1a2e' : '#F5F3FF', borderWidth: 1, borderColor: FUN_COLORS.purple + '30' }]}>
              <View style={styles.predictionHeader}>
                <Text style={{ fontSize: 32 }}>{'\u{1F52E}'}</Text>
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={[styles.sectionTitle, { color: FUN_COLORS.purple, fontSize: 18 }]}>Value Predictions</Text>
                  <Text style={styles.predictionSubtext}>
                    {'Based on ' + formatNumber((analytics.tradeVolume?.thisWeek || 0) * VM) + ' trades this week'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Predictions List */}
            {isPro ? (
              <View style={styles.card}>
                <SectionHeader icon="crystal-ball" title={'Predicted Movements'} subtitle={'7-day forecast'} emoji={'\u{1F3B1}'} />
                {(analytics.predictions || []).map((item, i) => (
                  <View key={'pred-' + i} style={[styles.predictionRow, i % 2 === 0 && styles.itemRowAlt]}>
                    <View style={styles.predictionLeft}>
                      <View style={styles.itemImageWrap}>
                        {item.image ? (
                          <Image source={{ uri: item.image }} style={styles.itemImage} />
                        ) : (
                          <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                            <Icon name="cube-outline" size={18} color={isDarkMode ? '#666' : '#bbb'} />
                          </View>
                        )}
                      </View>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.itemType}>
                          {'Wants: ' + (item.demand || 0) * VM + ' | Has: ' + (item.supply || 0) * VM}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.predictionRight}>
                      <View style={[styles.predictionBadge, { backgroundColor: getSignalColor(item.prediction) + '25' }]}>
                        <Text style={{ fontSize: 14 }}>{getPredictionEmoji(item.prediction)}</Text>
                        <Text style={[styles.predictionBadgeText, { color: getSignalColor(item.prediction) }]}>
                          {getPredictionLabel(item.prediction)}
                        </Text>
                      </View>
                      <View style={styles.confidenceBar}>
                        <View style={[styles.confidenceFill, {
                          width: item.confidence + '%',
                          backgroundColor: getSignalColor(item.prediction),
                        }]} />
                      </View>
                      <Text style={styles.confidenceText}>{item.confidence + '% confidence'}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <>
                {/* Show 2 predictions free, lock the rest */}
                <View style={styles.card}>
                  <SectionHeader icon="bolt" title={'Predicted Movements'} subtitle={'7-day forecast'} locked emoji={'\u{1F3B1}'} />
                  {(analytics.predictions || []).slice(0, 2).map((item, i) => (
                    <View key={'pred-free-' + i} style={[styles.predictionRow, i % 2 === 0 && styles.itemRowAlt]}>
                      <View style={styles.predictionLeft}>
                        <View style={styles.itemImageWrap}>
                          {item.image ? (
                            <Image source={{ uri: item.image }} style={styles.itemImage} />
                          ) : (
                            <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                              <Icon name="cube-outline" size={18} color={isDarkMode ? '#666' : '#bbb'} />
                            </View>
                          )}
                        </View>
                        <View style={styles.itemInfo}>
                          <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                          <Text style={styles.itemType}>
                            {'Wants: ' + (item.demand || 0) * VM + ' | Has: ' + (item.supply || 0) * VM}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.predictionRight}>
                        <View style={[styles.predictionBadge, { backgroundColor: getSignalColor(item.prediction) + '25' }]}>
                          <Text style={{ fontSize: 14 }}>{getPredictionEmoji(item.prediction)}</Text>
                          <Text style={[styles.predictionBadgeText, { color: getSignalColor(item.prediction) }]}>
                            {getPredictionLabel(item.prediction)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))}
                  <LockedOverlay message={'Unlock all predictions'} />
                </View>
              </>
            )}

            {/* Disclaimer */}
            <View style={styles.disclaimerCard}>
              <Text style={{ fontSize: 14 }}>{'\u{1F4A1}'}</Text>
              <Text style={styles.disclaimerText}>
                {'Predictions are based on trade activity trends and are not financial advice. Actual values may vary.'}
              </Text>
            </View>
          </>
        )}

        {/* Last Updated */}
        {analytics.computedAt && (
          <View style={styles.updatedRow}>
            <Icon name="time-outline" size={12} color={isDarkMode ? '#666' : '#999'} />
            <Text style={styles.updatedText}>
              {'Updated: ' + new Date(analytics.computedAt).toLocaleString()}
            </Text>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {!isPro && <BannerAdComponent />}
      <SubscriptionScreen
        visible={showOfferwall}
        onClose={() => setShowOfferwall(false)}
        track='Analytics'
        showoffer={!single_offer_wall}
        oneWallOnly={single_offer_wall}
      />
    </View>
  );
};

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#0f0f1a' : '#F0F4FF',
    },
    centered: {
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
    },
    loadingText: {
      marginTop: 12,
      color: isDarkMode ? '#bbb' : '#666',
      fontSize: 15,
      fontWeight: '600',
    },
    emptyTitle: {
      fontSize: 22,
      fontWeight: 'bold',
      color: isDarkMode ? '#fff' : '#333',
      marginTop: 12,
    },
    emptySubtitle: {
      fontSize: 15,
      color: isDarkMode ? '#999' : '#666',
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 22,
    },
    retryButton: {
      marginTop: 20,
      paddingHorizontal: 28,
      paddingVertical: 12,
      backgroundColor: config.colors.primary,
      borderRadius: 24,
    },
    retryButtonText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 15,
    },

    // Tab Bar
    tabBarScroll: {
      flexGrow: 0,
      flexShrink: 0,
      backgroundColor: isDarkMode ? '#1a1a2e' : '#fff',
      borderBottomWidth: 1,
      borderBottomColor: isDarkMode ? '#2a2a3e' : '#e8e8f0',
    },
    tabBar: {
      flexDirection: 'row',
      paddingHorizontal: 8,
      paddingVertical: 6,
      gap: 4,
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 20,
      gap: 6,
    },
    tabActive: {
      backgroundColor: config.colors.primary + '20',
    },
    tabText: {
      fontSize: 13,
      fontWeight: '700',
      color: isDarkMode ? '#888' : '#999',
    },
    tabTextActive: {
      color: config.colors.primary,
    },

    scrollContent: {
      paddingHorizontal: 12,
      paddingTop: 12,
    },

    // Stats Row
    statsRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 12,
    },
    statCard: {
      flex: 1,
      borderRadius: 16,
      padding: 14,
      alignItems: 'center',
      gap: 4,
      borderWidth: 1.5,
    },
    statEmoji: {
      fontSize: 22,
    },
    statNumber: {
      fontSize: 22,
      fontWeight: '900',
    },
    statLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: isDarkMode ? '#bbb' : '#666',
    },

    // Card
    card: {
      backgroundColor: isDarkMode ? '#1a1a2e' : '#fff',
      borderRadius: 16,
      padding: 14,
      marginBottom: 12,
      overflow: 'hidden',
    },

    // Section Header
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      marginBottom: 12,
    },
    sectionHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: isDarkMode ? '#fff' : '#222',
    },
    sectionSubtitle: {
      fontSize: 12,
      color: isDarkMode ? '#999' : '#888',
      width: '100%',
      marginTop: 2,
      marginLeft: 30,
    },
    proBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: '#FFD70025',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 14,
    },
    proBadgeText: {
      fontSize: 11,
      fontWeight: 'bold',
      color: '#FFD700',
    },

    // Item Row
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 6,
      borderRadius: 10,
    },
    itemRowAlt: {
      backgroundColor: isDarkMode ? '#22223a' : '#F5F7FF',
    },
    itemRank: {
      width: 32,
      fontSize: 13,
      fontWeight: 'bold',
      color: isDarkMode ? '#888' : '#999',
      textAlign: 'center',
    },
    itemImageWrap: {
      marginRight: 10,
    },
    itemImage: {
      width: 38,
      height: 38,
      borderRadius: 10,
    },
    itemImagePlaceholder: {
      backgroundColor: isDarkMode ? '#2a2a3e' : '#eef0f8',
      justifyContent: 'center',
      alignItems: 'center',
    },
    itemInfo: {
      flex: 1,
    },
    itemName: {
      fontSize: 14,
      fontWeight: '700',
      color: isDarkMode ? '#fff' : '#222',
    },
    itemType: {
      fontSize: 11,
      color: isDarkMode ? '#999' : '#888',
      textTransform: 'capitalize',
    },
    countBadge: {
      backgroundColor: isDarkMode ? '#2a2a3e' : '#EEF0FF',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
    },
    countText: {
      fontSize: 13,
      fontWeight: '800',
      color: isDarkMode ? '#bbb' : '#555',
    },
    signalBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
    },
    signalText: {
      fontSize: 12,
      fontWeight: '800',
    },
    changeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
    },
    changeText: {
      fontSize: 12,
      fontWeight: '800',
    },

    // Distribution
    distributionRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      marginBottom: 14,
    },
    distributionItem: {
      alignItems: 'center',
      gap: 4,
    },
    distributionEmoji: {
      fontSize: 24,
    },
    distributionLabel: {
      fontSize: 13,
      fontWeight: '700',
    },
    distributionValue: {
      fontSize: 20,
      fontWeight: '900',
    },
    distributionBar: {
      flexDirection: 'row',
      height: 10,
      borderRadius: 5,
      overflow: 'hidden',
      backgroundColor: isDarkMode ? '#2a2a3e' : '#e8e8f0',
    },
    distributionBarSegment: {
      height: '100%',
    },

    // Chart
    chartContainer: {
      marginTop: 4,
    },
    chartLabel: {
      fontSize: 12,
      color: isDarkMode ? '#999' : '#888',
      marginBottom: 8,
      fontWeight: '600',
    },
    chartBars: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      height: 80,
      gap: 2,
    },
    chartBarWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    chartBar: {
      width: '85%',
      borderRadius: 4,
      minHeight: 4,
    },
    chartBarLabel: {
      fontSize: 9,
      color: isDarkMode ? '#777' : '#999',
      marginTop: 3,
      fontWeight: '600',
    },

    // Prediction
    predictionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    predictionSubtext: {
      fontSize: 12,
      color: isDarkMode ? '#999' : '#888',
      marginTop: 2,
    },
    predictionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 6,
      borderRadius: 10,
    },
    predictionLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    predictionRight: {
      alignItems: 'flex-end',
      minWidth: 120,
    },
    predictionBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
    },
    predictionBadgeText: {
      fontSize: 11,
      fontWeight: '800',
    },
    confidenceBar: {
      width: 90,
      height: 5,
      backgroundColor: isDarkMode ? '#2a2a3e' : '#e8e8f0',
      borderRadius: 3,
      marginTop: 5,
      overflow: 'hidden',
    },
    confidenceFill: {
      height: '100%',
      borderRadius: 3,
    },
    confidenceText: {
      fontSize: 10,
      color: isDarkMode ? '#777' : '#999',
      marginTop: 3,
      fontWeight: '600',
    },

    // Locked Overlay
    lockedOverlay: {
      backgroundColor: isDarkMode ? 'rgba(15,15,26,0.85)' : 'rgba(240,244,255,0.92)',
      borderRadius: 14,
      padding: 20,
      marginTop: 8,
      alignItems: 'center',
    },
    lockedContent: {
      alignItems: 'center',
      gap: 10,
    },
    lockedText: {
      fontSize: 14,
      fontWeight: '700',
      color: isDarkMode ? '#ddd' : '#333',
      textAlign: 'center',
    },
    unlockButton: {
      backgroundColor: config.colors.primary,
      paddingHorizontal: 24,
      paddingVertical: 10,
      borderRadius: 24,
    },
    unlockButtonText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 14,
    },

    // Disclaimer
    disclaimerCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      padding: 14,
      backgroundColor: isDarkMode ? '#1a1a2e' : '#FFF8E1',
      borderRadius: 12,
      marginBottom: 12,
    },
    disclaimerText: {
      flex: 1,
      fontSize: 12,
      color: isDarkMode ? '#999' : '#8B6914',
      lineHeight: 18,
    },

    // Updated Row
    updatedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 10,
    },
    updatedText: {
      fontSize: 11,
      color: isDarkMode ? '#777' : '#999',
    },
  });

export default AnalyticsScreen;
