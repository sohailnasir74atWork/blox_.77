/**
 * MoreHubScreen.jsx — the card hub (Values ▸ More). Ported from Adopt Me's
 * More tab (adoptme-jan7/Code/More/MoreHubScreen.jsx, 2026-10-07). In Blox it
 * replaces the old top tabs (Code/ValuesScreen/TopTabs.js): the Values tile
 * opens the values list straight away, and its header's More button opens
 * this hub (owner decision, 2026-10-07).
 *
 * Since 2026-10-08 it is also the More bottom tab (it replaced the Stock tab),
 * so Stock leads with the first full-width card (it is why most players open
 * the app), then Codes; the rest share a two-column grid. Icons come from
 * scripts/more-hub/make-icons.mjs. `showBack` is false when the hub is the
 * tab's first screen.
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
  stock: require('../../assets/more-hub/stock.png'),
  codes: require('../../assets/more-hub/codes.png'),
  wallpaper: require('../../assets/more-hub/wallpaper.png'),
  scammer: require('../../assets/more-hub/scammer.png'),
  news: require('../../assets/more-hub/news.png'),
  analytics: require('../../assets/more-hub/analytics.png'),
  birthdays: require('../../assets/more-hub/birthdays.png'),
  reports: require('../../assets/more-hub/reports.png'),
  admin: require('../../assets/more-hub/admin.png'),
  dashboard: require('../../assets/more-hub/dashboard.png'),
};

const chunkPairs = (items) => {
  const rows = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
};

// A full-width gradient card. `tone` picks the palette (styles.hero_<tone>).
const HeroCard = ({ tone, title, sub, button, icon, onPress }) => (
  <TouchableOpacity style={[styles.hero, styles[`hero_${tone}`]]} onPress={onPress} activeOpacity={0.88}>
    <View style={styles.heroGlow} />
    <View style={styles.flex1}>
      <Text style={styles.heroTitle}>{title}</Text>
      <Text style={styles.heroSub} numberOfLines={2}>{sub}</Text>
      <View style={styles.heroBtn}>
        <Text style={[styles.heroBtnText, styles[`heroInk_${tone}`]]}>{button}</Text>
        <Icon name="arrow-forward" size={13} color={HERO_INK[tone]} />
      </View>
    </View>
    <Image resizeMethod="resize" source={icon} style={styles.heroIcon} resizeMode="contain" />
  </TouchableOpacity>
);

const HERO_INK = { stock: '#6D28D9', codes: '#B45309' };

const MoreHubScreen = ({ navigation, showBack = true }) => {
  const { t } = useTranslation();
  const { theme, isAdmin, isSeniorMod, isModerator, isUserBlocked } = useGlobalState();
  const isStaff = !!(isAdmin || isSeniorMod || isModerator);
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
    // Staff-only cards (Mod, Senior Mod, Admin), left in English like the rest
    // of the staff tools. The Admin Dashboard moved here from the public chat
    // header (2026-10-22); like that button it is hidden while banned.
    if (isStaff && !isUserBlocked) list.push({ key: 'dashboard', screen: 'MoreAdminDashboard', title: 'Admin Dashboard', desc: 'Reports, bans, users and staff tools', color: '#4F46E5' });
    // Complaints & ideas inbox: Senior Mods and Admins only (owner, 2026-10-22).
    if (isAdmin || isSeniorMod) list.push({ key: 'admin', screen: 'MoreAdmin', title: 'Admin', desc: 'Complaints, ideas and old feedback', color: '#0D9488' });
    return list;
  }, [t, isStaff, isAdmin, isSeniorMod, isUserBlocked]);

  const open = (screen) => {
    triggerHapticFeedback('impactLight');
    navigation.navigate(screen);
  };

  return (
    <View style={[styles.flex1, { backgroundColor: c.bg }]}>
      <ThemeHeader title={t('more_hub.title')} showBack={showBack} />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <HeroCard
          tone="stock"
          title={t('tabs.stock', { defaultValue: 'Stock' })}
          sub={t('more_hub.stock_desc')}
          button={t('more_hub.stock_button')}
          icon={MORE_ICONS.stock}
          onPress={() => open('MoreStock')}
        />
        <HeroCard
          tone="codes"
          title={t('more_hub.codes_title')}
          sub={t('more_hub.codes_desc')}
          button={t('more_hub.browse')}
          icon={MORE_ICONS.codes}
          onPress={() => open('MoreCodes')}
        />

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
                  <Image resizeMethod="resize" source={MORE_ICONS[card.key]} style={styles.cardIcon} resizeMode="contain" />
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
  },
  hero_stock: {
    backgroundColor: '#7C3AED',
    backgroundImage: 'linear-gradient(135deg, #A855F7 0%, #7C3AED 45%, #4338CA 100%)',
  },
  hero_codes: {
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
  heroBtnText: { fontSize: 12.5, fontWeight: '800' },
  heroInk_stock: { color: HERO_INK.stock },
  heroInk_codes: { color: HERO_INK.codes },
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
