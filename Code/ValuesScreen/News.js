/**
 * News.js — More ▸ News: the posts admins write in the Admin Dashboard's News
 * tab, newest first. Each is a heading, a body and the date it was last
 * updated. Read once per visit (plus pull to refresh) rather than kept on a
 * live listener: posts change a few times a month at most.
 *
 * The polls, quick suggestions and feedback box that used to live here are
 * gone (owner decision, 2026-10-07). Old builds still show them, and still
 * write /news_feedback, so that rule stays.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import config from '../Helper/Environment';
import { fetchNews } from './newsApi';

// "Updated" only when the post was edited after it went up (a minute's slack
// covers the server stamping both fields a moment apart).
export const newsDateLabel = (item, t, lang) => {
  const ms = item.updatedAt || item.createdAt;
  if (!ms) return null;
  const date = new Date(ms).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' });
  const edited = item.createdAt && item.updatedAt && item.updatedAt - item.createdAt > 60000;
  return edited ? t('news.updated_on', { date }) : date;
};

const NewsScreen = () => {
  const { appdatabase, theme } = useGlobalState();
  const { t, i18n } = useTranslation();
  const c = getThemeColors(theme === 'dark');
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!appdatabase) return;
    try {
      setItems(await fetchNews(appdatabase));
      setFailed(false);
    } catch (e) {
      setFailed(true);
      setItems((prev) => prev || []);
    }
  }, [appdatabase]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (items === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={config.colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      removeClippedSubviews={false}
      contentContainerStyle={[styles.list, items.length === 0 && { flexGrow: 1 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={config.colors.primary} />}
      renderItem={({ item }) => {
        const date = newsDateLabel(item, t, i18n.language);
        return (
          <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
            {date ? (
              <View style={styles.dateRow}>
                <Icon name="calendar-outline" size={13} color={c.textSecondary} />
                <Text style={[styles.date, { color: c.textSecondary }]}>{date}</Text>
              </View>
            ) : null}
            <Text style={[styles.title, { color: c.text }]} selectable>{item.title}</Text>
            {item.body ? <Text style={[styles.body, { color: c.text }]} selectable>{item.body}</Text> : null}
          </View>
        );
      }}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📰</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>
            {failed ? t('news.load_failed') : t('news.nothing_new_title')}
          </Text>
          {!failed ? (
            <Text style={[styles.emptyBody, { color: c.textSecondary }]}>{t('news.nothing_new_body')}</Text>
          ) : null}
        </View>
      }
    />
  );
};

const styles = StyleSheet.create({
  list: { paddingTop: 10, paddingBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 12,
  },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  date: { fontSize: 12, fontWeight: '600' },
  title: { fontSize: 17, fontWeight: '800', lineHeight: 23 },
  body: { fontSize: 14.5, lineHeight: 21, marginTop: 6 },
  emptyIcon: { fontSize: 40, marginBottom: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  emptyBody: { fontSize: 13.5, marginTop: 6, textAlign: 'center', lineHeight: 19 },
});

export default NewsScreen;
