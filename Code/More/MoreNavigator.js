/**
 * MoreNavigator.js — what the Home "Values" tile opens (root route
 * FruitValuesStack). Replaces the old top tabs (Code/ValuesScreen/TopTabs.js),
 * owner decision 2026-10-07:
 *
 *   ValuesHome   the values list, as fast as before, with a "More" button in
 *                its header that opens…
 *   MoreHub      the card hub (MoreHubScreen) and the pages it opens: Codes,
 *                Scammer DB, HD Wallpapers, News, Complaints & ideas and the
 *                staff-only reports inbox. Analytics and Birthdays live in the
 *                root stack and are navigated to by name.
 *
 * Every page is full-screen (no tab bar), so each ends with ScreenBottomBanner
 * (banner + nav-bar spacer). The values list keeps the collapsible banner the
 * owner chose for main screens; the rest are plain.
 */

import React from 'react';
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

export const MoreStack = ({ selectedTheme }) => {
  const { t } = useTranslation();
  const { isAdmin, isModerator } = useGlobalState();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="ValuesHome">
        {({ navigation }) => (
          <Page
            title={t('more_hub.values_title')}
            collapsible
            headerRight={<MoreButton label={t('more_hub.more_button')} onPress={() => navigation.navigate('MoreHub')} />}
          >
            <MemoValueScreen selectedTheme={selectedTheme} />
          </Page>
        )}
      </Stack.Screen>
      <Stack.Screen name="MoreHub" component={MoreHubScreen} />
      <Stack.Screen name="MoreCodes">
        {() => <Page title={t('more_hub.codes_title')}><CodesScreen /></Page>}
      </Stack.Screen>
      <Stack.Screen name="MoreScammers">
        {() => <Page title={t('more_hub.scammer_title')}><ScammerDatabaseScreen /></Page>}
      </Stack.Screen>
      <Stack.Screen name="MoreWallpapers">
        {() => <Page title={t('more_hub.wallpaper_title')}><HDWallpaperScreen /></Page>}
      </Stack.Screen>
      <Stack.Screen name="MoreNews">
        {() => <Page title={t('more_hub.news_title')}><NewsScreen /></Page>}
      </Stack.Screen>
      {/* A form with a send button: no banner next to it. */}
      <Stack.Screen name="MoreReport">
        {() => <Page title={t('reports.title')} ad={false}><ReportScreen /></Page>}
      </Stack.Screen>
      {(isAdmin || isModerator) && (
        <Stack.Screen name="MoreAdmin">
          {() => <Page title="Reports inbox" ad={false}><AdminReportsInbox /></Page>}
        </Stack.Screen>
      )}
    </Stack.Navigator>
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
