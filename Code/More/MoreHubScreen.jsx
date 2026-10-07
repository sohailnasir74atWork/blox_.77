/**
 * MoreHubScreen.jsx — the card hub (Values ▸ More). Ported from Adopt Me's
 * More tab (adoptme-jan7/Code/More/MoreHubScreen.jsx, 2026-10-07). In Blox it
 * replaces the old top tabs (Code/ValuesScreen/TopTabs.js): the Values tile
 * opens the values list straight away, and its header's More button opens
 * this hub (owner decision, 2026-10-07).
 *
 * Codes gets the full-width card; the rest share a two-column grid. Icons
 * come from scripts/more-hub/make-icons.mjs.
 */

import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import { useHaptic } from '../Helper/HepticFeedBack';
import config from '../Helper/Environment';
import ThemeHeader from '../Design/componenets/ThemeHeader';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';

export const MORE_ICONS = {
  more: require('../../assets/more-hub/more.png'),
  codes: require('../../assets/more-hub/codes.png'),
  wallpaper: require('../../assets/more-hub/wallpaper.png'),
  scammer: require('../../assets/more-hub/scammer.png'),
  news: require('../../assets/more-hub/news.png'),
  analytics: require('../../assets/more-hub/analytics.png'),
  birthdays: require('../../assets/more-hub/birthdays.png'),
  reports: require('../../assets/more-hub/reports.png'),
  admin: require('../../assets/more-hub/admin.png'),
};

const chunkPairs = (items) => {
  const rows = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
};

const MoreHubScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme, isAdmin, isModerator } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);

  const cards = useMemo(() => {
    const list = [
      { key: 'scammer', screen: 'MoreScammers', title: t('more_hub.scammer_title'), desc: t('more_hub.scammer_desc'), color: '#DC2626' },
      { key: 'wallpaper', screen: 'MoreWallpapers', title: t('more_hub.wallpaper_title'), desc: t('more_hub.wallpaper_desc'), color: '#7C3AED' },
      { key: 'news', screen: 'MoreNews', title: t('more_hub.news_title'), desc: t('more_hub.news_desc'), color: '#EA580C' },
      ...(config.isNoman ? [] : [{ key: 'analytics', screen: 'Analytics', title: t('more_hub.analytics_title'), desc: t('more_hub.analytics_desc'), color: '#2563EB' }]),
      { key: 'birthdays', screen: 'Birthdays', title: t('birthdays.title'), desc: t('more_hub.birthdays_desc'), color: '#EC4899' },
      { key: 'reports', screen: 'MoreReport', title: t('reports.title'), desc: t('more_hub.reports_desc'), color: '#7C3AED' },
    ];
    // Staff-only card, left in English like the rest of the staff tools.
    if (isAdmin || isModerator) list.push({ key: 'admin', screen: 'MoreAdmin', title: 'Admin', desc: 'Complaints, ideas and old feedback', color: '#0D9488' });
    return list;
  }, [t, isAdmin, isModerator]);

  const open = (screen) => {
    triggerHapticFeedback('impactLight');
    navigation.navigate(screen);
  };

  return (
    <View style={[styles.flex1, { backgroundColor: c.bg }]}>
      <ThemeHeader title={t('more_hub.title')} showBack />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.hero} onPress={() => open('MoreCodes')} activeOpacity={0.88}>
          <View style={styles.heroGlow} />
          <View style={styles.flex1}>
            <Text style={styles.heroTitle}>{t('more_hub.codes_title')}</Text>
            <Text style={styles.heroSub} numberOfLines={2}>{t('more_hub.codes_desc')}</Text>
            <View style={styles.heroBtn}>
              <Text style={styles.heroBtnText}>{t('more_hub.browse')}</Text>
              <Icon name="arrow-forward" size={13} color="#B45309" />
            </View>
          </View>
          <Image source={MORE_ICONS.codes} style={styles.heroIcon} resizeMode="contain" />
        </TouchableOpacity>

        {chunkPairs(cards).map((row) => (
          <View key={row[0].key} style={styles.row}>
            {row.map((card) => (
              <TouchableOpacity
                key={card.key}
                style={[styles.card, { backgroundColor: c.cardBg, borderColor: c.cardBorder }]}
                onPress={() => open(card.screen)}
                activeOpacity={0.85}
              >
                <View style={[styles.cardWash, { backgroundColor: card.color + (isDarkMode ? '24' : '14') }]} />
                <View style={styles.cardTop}>
                  <Image source={MORE_ICONS[card.key]} style={styles.cardIcon} resizeMode="contain" />
                  <View style={[styles.chevron, { backgroundColor: card.color }]}>
                    <Icon name="chevron-forward" size={14} color="#fff" />
                  </View>
                </View>
                <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={1}>{card.title}</Text>
                <Text style={[styles.cardDesc, { color: c.textSecondary }]} numberOfLines={2}>{card.desc}</Text>
              </TouchableOpacity>
            ))}
            {row.length === 1 && <View style={styles.cardSpacer} />}
          </View>
        ))}
      </ScrollView>
      <ScreenBottomBanner background={c.bg} />
    </View>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },

  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 18, paddingRight: 10, borderRadius: 22, marginBottom: 12, overflow: 'hidden',
    backgroundColor: '#F59E0B',
    backgroundImage: 'linear-gradient(135deg, #FBBF24 0%, #F59E0B 45%, #EA580C 100%)',
  },
  heroGlow: {
    position: 'absolute', right: -30, top: -40, width: 170, height: 170, borderRadius: 85,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  heroTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  heroSub: { color: 'rgba(255,255,255,0.92)', fontSize: 12.5, lineHeight: 17, marginTop: 4 },
  heroBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    marginTop: 12, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff',
  },
  heroBtnText: { color: '#B45309', fontSize: 12.5, fontWeight: '800' },
  heroIcon: { width: 96, height: 96 },

  row: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  card: {
    flex: 1, minHeight: 148, padding: 14, borderRadius: 20, borderWidth: 1, overflow: 'hidden',
  },
  cardSpacer: { flex: 1 },
  cardWash: { position: 'absolute', left: 0, right: 0, top: 0, height: 74 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
  cardIcon: { width: 52, height: 52 },
  chevron: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardDesc: { fontSize: 11.5, lineHeight: 15, marginTop: 3 },
});

export default MoreHubScreen;
