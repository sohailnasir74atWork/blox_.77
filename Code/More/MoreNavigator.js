/**
 * MoreNavigator.js — one stack, mounted in two places:
 *
 *   root route FruitValuesStack (App.js), what the Home "Values" tile opens:
 *   starts on ValuesHome. Replaces the old top tabs (Code/ValuesScreen/TopTabs.js),
 *   owner decision 2026-10-07.
 *
 *   the More bottom tab (MainTabs.js, `inTab`), which replaced the Stock tab
 *   (owner decision 2026-10-08): starts on MoreHub with no back button, and
 *   every hub card pushes inside the tab, so the tab bar stays visible (same
 *   as adoptme-jan7's More tab). ValuesHome is not registered there.
 *
 * Screens:
 *
 *   ValuesHome   the values list, as fast as before, with a "More" button in
 *                its header that opens…
 *   MoreHub      the card hub (MoreHubScreen) and the pages it opens: Stock,
 *                Codes, Scammer DB, HD Wallpapers, News, Complaints & ideas and
 *                the staff-only reports inbox. Analytics and Birthdays live in
 *                the root stack and are navigated to by name.
 *
 * Every page ends with ScreenBottomBanner (banner + nav-bar spacer; the spacer
 * is skipped by itself inside the tab, where the tab bar already clears the nav
 * bar). The values list and Stock keep the collapsible banner the owner chose
 * for main screens; the rest are plain.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import ThemeHeader from '../Design/componenets/ThemeHeader';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';
import MoreHubScreen from './MoreHubScreen';
import ValueScreen from '../ValuesScreen/ValueScreen';
import CodesScreen from '../ValuesScreen/CodesScreen';
import HDWallpaperScreen from '../ValuesScreen/HDwallpaper';
import ScammerDatabaseScreen from '../ValuesScreen/ScammerDatabaseScreen';
import NewsScreen from '../ValuesScreen/News';
import AdminReportsInbox from '../ValuesScreen/AdminReport';
import ReportScreen from '../Reports/ReportScreen';
import TopLevelStockComponent from '../StockScreen/StockNavigator';

const Stack = createNativeStackNavigator();
const MemoValueScreen = React.memo(ValueScreen);

// Same page colours the old top tabs used.
const pageBg = (isDark) => (isDark ? '#111827' : '#f8fafc');

// Header + content (with the old tabs' 8 pt side margin) + bottom banner.
const Page = ({ title, children, ad = true, collapsible = false, headerRight = null }) => {
  const { theme } = useGlobalState();
  const background = pageBg(theme === 'dark');
  return (
    <View style={[styles.flex1, { backgroundColor: background }]}>
      <ThemeHeader title={title} showBack rightContent={headerRight} />
      <View style={styles.body}>{children}</View>
      <ScreenBottomBanner background={background} ad={ad} collapsible={collapsible} />
    </View>
  );
};

const MoreButton = ({ onPress, label }) => (
  <TouchableOpacity onPress={onPress} style={styles.moreBtn} activeOpacity={0.8} hitSlop={8}>
    <Icon name="grid" size={14} color="#fff" />
    <Text style={styles.moreText}>{label}</Text>
  </TouchableOpacity>
);

// selectedTheme for the screens below. They are module-level `component`s
// reading it from context, not `{() => …}` render callbacks: a callback skips
// React Navigation's StaticContainer, so every MoreStack render (isAdmin,
// language, theme) re-rendered every mounted screen and its banner.
const MoreThemeContext = createContext({ selectedTheme: undefined, inTab: false });

// The hub is the tab's first screen: nothing to go back to there.
const HubPage = (props) => {
  const { inTab } = useContext(MoreThemeContext);
  return <MoreHubScreen {...props} showBack={!inTab} />;
};

// The Stock page is the same component the old Stock tab rendered, with the
// same props, plus a back button.
const StockPage = () => {
  const { selectedTheme } = useContext(MoreThemeContext);
  return <TopLevelStockComponent selectedTheme={selectedTheme} showBack />;
};

const ValuesHomeScreen = ({ navigation }) => {
  const { t } = useTranslation();
  const { selectedTheme } = useContext(MoreThemeContext);
  return (
    <Page
      title={t('more_hub.values_title')}
      collapsible
      headerRight={<MoreButton label={t('more_hub.more_button')} onPress={() => navigation.navigate('MoreHub')} />}
    >
      <MemoValueScreen selectedTheme={selectedTheme} />
    </Page>
  );
};

const CodesPage = () => {
  const { t } = useTranslation();
  return <Page title={t('more_hub.codes_title')}><CodesScreen /></Page>;
};
const ScammersPage = () => {
  const { t } = useTranslation();
  return <Page title={t('more_hub.scammer_title')}><ScammerDatabaseScreen /></Page>;
};
const WallpapersPage = () => {
  const { t } = useTranslation();
  return <Page title={t('more_hub.wallpaper_title')}><HDWallpaperScreen /></Page>;
};
const NewsPage = () => {
  const { t } = useTranslation();
  return <Page title={t('more_hub.news_title')}><NewsScreen /></Page>;
};
// A form with a send button: no banner next to it.
const ReportPage = () => {
  const { t } = useTranslation();
  return <Page title={t('reports.title')} ad={false}><ReportScreen /></Page>;
};
const AdminPage = () => <Page title="Reports inbox" ad={false}><AdminReportsInbox /></Page>;

const SCREEN_OPTIONS = { headerShown: false, animation: 'slide_from_right' };

export const MoreStack = ({ selectedTheme, inTab = false }) => {
  const { isAdmin, isModerator } = useGlobalState();
  const themeValue = useMemo(() => ({ selectedTheme, inTab }), [selectedTheme, inTab]);

  return (
    <MoreThemeContext.Provider value={themeValue}>
      <Stack.Navigator screenOptions={SCREEN_OPTIONS} initialRouteName={inTab ? 'MoreHub' : 'ValuesHome'}>
        {!inTab && <Stack.Screen name="ValuesHome" component={ValuesHomeScreen} />}
        <Stack.Screen name="MoreHub" component={HubPage} />
        <Stack.Screen name="MoreStock" component={StockPage} />
        <Stack.Screen name="MoreCodes" component={CodesPage} />
        <Stack.Screen name="MoreScammers" component={ScammersPage} />
        <Stack.Screen name="MoreWallpapers" component={WallpapersPage} />
        <Stack.Screen name="MoreNews" component={NewsPage} />
        <Stack.Screen name="MoreReport" component={ReportPage} />
        {(isAdmin || isModerator) && (
          <Stack.Screen name="MoreAdmin" component={AdminPage} />
        )}
      </Stack.Navigator>
    </MoreThemeContext.Provider>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 8 },
  moreBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  moreText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
});

export default MoreStack;
