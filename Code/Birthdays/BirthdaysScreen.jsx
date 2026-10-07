/**
 * BirthdaysScreen — your birthday, and other players' birthdays this week.
 * Ported from Adopt Me (adoptme-jan7/Code/Birthdays, 2026-10-07). Root-stack
 * route `Birthdays` (headerShown false).
 *
 * Only month and day are ever shown (never a year or an age), and only for
 * players who left "Show my birthday" on and are 13 or older; the server
 * enforces both (supabase/036_birthdays.sql). On your own birthday this is
 * the celebration: the once-a-year stars gift and the wishes you got.
 * Wishes are four fixed messages, so they are safe-chat friendly.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import { showErrorMessage, showSuccessMessage } from '../Helper/MessageHelper';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import SafeLottieView from '../Helper/SafeLottieView';
import {
  setBirthdayUser, getMyBirthday, peekMyBirthday, peekBirthdayList, setBirthdayVisibility, listBirthdays,
  sendBirthdayWish, birthdayErrorKey, invalidateBirthdays, isBirthdayMockActive, getBirthdayMock,
  enableBirthdayPreview, claimBirthdayGift, flushBirthdayStars, getKnownDob, loadKnownDob, BIRTHDAY_GIFT_STARS,
} from './birthdayApi';
import { daysUntilBirthday, formatMonthDay, formatUpcoming } from './birthdayDate';
import { BirthdayAvatar, WishSheet, wishLine, BIRTHDAY_PINK, BIRTHDAY_GRADIENT } from './BirthdayBits';
import EditBirthdaySheet from './EditBirthdaySheet';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';

export default function BirthdaysScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user, theme, appdatabase } = useGlobalState();
  const isDark = theme === 'dark';
  const c = getThemeColors(isDark);
  const uid = user?.id || null;
  const lang = i18n.language;

  const [mine, setMine] = useState(peekMyBirthday());
  // Instant first paint from the phone's saved copy; load() refreshes it.
  const [list, setList] = useState(peekBirthdayList());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [wishFor, setWishFor] = useState(null);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [knownDob, setKnownDob] = useState(() => getKnownDob(uid));

  const load = useCallback(async (force = false) => {
    setBirthdayUser(uid);
    // Stars granted earlier that never reached RTDB (an MMKV read; usually nothing).
    flushBirthdayStars(appdatabase, uid).catch(() => {});
    const [m, l] = await Promise.allSettled([getMyBirthday({ force }), listBirthdays({ days: 7, force })]);
    if (m.status === 'fulfilled') setMine(m.value);
    if (l.status === 'fulfilled') setList(l.value);
    if (isBirthdayMockActive()) setPreview(getBirthdayMock().getPreview());
    setLoading(false);
  }, [uid, appdatabase]);

  useFocusEffect(useCallback(() => {
    if (!uid && !__DEV__) { setLoading(false); return; }
    load(false);
  }, [uid, load]));

  // The full date (year included) only for the one-time edit, while unused.
  const canEditMine = !!mine?.canEdit;
  useEffect(() => {
    if (!uid) { setKnownDob(null); return undefined; }
    const local = getKnownDob(uid);
    setKnownDob(local);
    if (local || !canEditMine) return undefined;
    let alive = true;
    loadKnownDob(appdatabase, uid).then((d) => { if (alive && d) setKnownDob(d); }).catch(() => {});
    return () => { alive = false; };
  }, [uid, canEditMine, appdatabase]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const toggleShow = useCallback(async (next) => {
    if (toggling) return;
    setToggling(true);
    setMine((m) => (m ? { ...m, show: next, asked: true } : m));
    try {
      await setBirthdayVisibility(next);
      trackGrowthEvent('birthday_visibility', { show: next ? 1 : 0, where: 'screen' });
    } catch (e) {
      setMine((m) => (m ? { ...m, show: !next } : m));
      showErrorMessage(t('home.alert.error'), t('birthdays.err.generic'));
    } finally {
      setToggling(false);
    }
  }, [toggling, t]);

  // Blox's gift: stars into the RTDB balance (no Pet Cards here).
  const claimGift = useCallback(async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      const { stars } = await claimBirthdayGift(appdatabase, uid);
      setMine((m) => (m ? { ...m, giftReady: false, giftOpened: true } : m));
      trackGrowthEvent('birthday_gift_claim', { stars, where: 'screen' });
      showSuccessMessage(t('birthdays.stars_added', { stars }), '');
    } catch (e) {
      showErrorMessage(t('home.alert.error'), t(`birthdays.err.${birthdayErrorKey(e)}`));
      load(true);
    } finally {
      setClaiming(false);
    }
  }, [claiming, appdatabase, uid, t, load]);

  const sendWish = useCallback(async (template) => {
    if (!wishFor || sending) return;
    setSending(true);
    try {
      const res = await sendBirthdayWish(wishFor.uid, template);
      setList((l) => (l || []).map((b) => (b.uid === wishFor.uid ? { ...b, wished: true, wishes: res?.wishes ?? b.wishes + 1 } : b)));
      trackGrowthEvent('birthday_wish', { template });
      showSuccessMessage(t('birthdays.wish_sent_title'), t('birthdays.wish_sent', { name: wishFor.name }));
      setWishFor(null);
    } catch (e) {
      showErrorMessage(t('home.alert.error'), t(`birthdays.err.${birthdayErrorKey(e)}`));
    } finally {
      setSending(false);
    }
  }, [wishFor, sending, t]);

  const onBirthdaySaved = useCallback((dob) => {
    setEditing(false);
    // The sample data (debug preview) never touches the signed-in profile;
    // a real edit is remembered on the phone by updateMyBirthday.
    if (dob && uid && !isBirthdayMockActive()) setKnownDob(dob);
    trackGrowthEvent('birthday_edit', {});
    showSuccessMessage(t('birthdays.edit_saved'), '');
    load(true);
  }, [uid, t, load]);

  const switchPreview = useCallback((which) => {
    getBirthdayMock()?.setPreview(which);
    invalidateBirthdays();
    load(true);
  }, [load]);

  const myDays = mine?.month ? daysUntilBirthday(mine.month, mine.day) : null;
  const myToday = myDays === 0;
  const today = (list || []).filter((b) => b.daysUntil === 0);
  const week = (list || []).filter((b) => b.daysUntil > 0);
  const name = user?.displayName || t('birthdays.you');
  const pad2 = (n) => String(n).padStart(2, '0');
  const editDob = (!isBirthdayMockActive() && knownDob)
    || (__DEV__ && mine?.month ? `${new Date().getFullYear() - 20}-${pad2(mine.month)}-${pad2(mine.day)}` : null);

  const header = (
    <View style={[styles.header, { borderBottomColor: c.border }]}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
        <Icon name="arrow-back" size={22} color={c.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('birthdays.title')}</Text>
        <Text style={[styles.headerSub, { color: c.textSecondary }]} numberOfLines={1}>{t('birthdays.subtitle')}</Text>
      </View>
      {/* Debug builds: long-press for the sample data (every state, no real account changes). */}
      <TouchableOpacity
        disabled={!__DEV__}
        onLongPress={() => { enableBirthdayPreview(); load(true); }}
        style={{ marginRight: 10 }}
      >
        <Text style={{ fontSize: 24 }}>🎂</Text>
      </TouchableOpacity>
    </View>
  );

  if (!uid && !__DEV__) {
    return (
      <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top }]}>
        {header}
        <View style={styles.center}>
          <Text style={{ fontSize: 40 }}>🎂</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t('birthdays.sign_in')}</Text>
        </View>
      </View>
    );
  }

  const row = (b, kind) => {
    const self = b.uid === uid;
    return (
      <View key={b.uid} style={[styles.row, { borderBottomColor: c.border }]}>
        <BirthdayAvatar uri={b.avatar} name={b.name} size={42} ring={kind === 'today'} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[styles.rowName, { color: c.text }]} numberOfLines={1}>{b.name}</Text>
          <Text style={[styles.rowSub, { color: c.textSecondary }]} numberOfLines={1}>
            {kind === 'today'
              ? t('birthdays.wish_count', { count: b.wishes || 0 })
              : formatUpcoming(b.month, b.day, lang)}
          </Text>
        </View>
        {kind === 'today' ? (
          self ? (
            <Text style={[styles.youTag, { color: BIRTHDAY_PINK }]}>{t('birthdays.you')}</Text>
          ) : b.wished ? (
            <View style={[styles.wishedPill, { borderColor: c.border }]}>
              <Icon name="checkmark" size={14} color={c.textSecondary} />
              <Text style={[styles.wishedText, { color: c.textSecondary }]}>{t('birthdays.wished')}</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.wishBtn} onPress={() => setWishFor(b)} activeOpacity={0.85}>
              <Text style={styles.wishBtnText}>🎉 {t('birthdays.wish')}</Text>
            </TouchableOpacity>
          )
        ) : (
          <View style={[styles.daysPill, { backgroundColor: isDark ? 'rgba(236,72,153,0.18)' : 'rgba(236,72,153,0.10)' }]}>
            <Text style={[styles.daysText, { color: BIRTHDAY_PINK }]}>
              {b.daysUntil === 1 ? t('birthdays.tomorrow') : t('birthdays.in_days', { count: b.daysUntil })}
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      {header}
      {loading && !mine && !list ? (
        <View style={styles.center}><ActivityIndicator color={BIRTHDAY_PINK} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BIRTHDAY_PINK} />}
        >
          {/* ═══ YOUR BIRTHDAY ═══ */}
          {mine?.month ? (
            myToday ? (
              // Own keys: turning an existing card into a gradient one in
              // place crashes Android's LinearGradient (RN 0.87
              // BackgroundImageDrawable); a fresh view draws fine.
              <View key="hero" style={[styles.hero, { backgroundImage: BIRTHDAY_GRADIENT }]}>
                <SafeLottieView
                  source={require('../../assets/lottie/confetti.json')}
                  autoPlay
                  loop={false}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                <Text style={styles.heroCake}>🎂</Text>
                <Text style={styles.heroTitle}>{t('birthdays.hero_title', { name })}</Text>
                <Text style={styles.heroSub}>
                  {mine.giftReady
                    ? t('birthdays.hero_gift_stars', { stars: BIRTHDAY_GIFT_STARS })
                    : mine.giftOpened ? t('birthdays.hero_claimed', { stars: BIRTHDAY_GIFT_STARS }) : t('birthdays.hero_sub')}
                </Text>
                {mine.giftReady ? (
                  <TouchableOpacity style={[styles.heroBtn, claiming && { opacity: 0.7 }]} onPress={claimGift} disabled={claiming} activeOpacity={0.9}>
                    {claiming
                      ? <ActivityIndicator color={BIRTHDAY_PINK} />
                      : <Text style={styles.heroBtnText}>🎁 {t('birthdays.claim_stars', { stars: BIRTHDAY_GIFT_STARS })}</Text>}
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              <View key="mine" style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
                <Text style={[styles.cardLabel, { color: c.textSecondary }]}>{t('birthdays.your_birthday')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                  <Text style={{ fontSize: 30 }}>🎂</Text>
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={[styles.bigDate, { color: c.text }]}>{formatMonthDay(mine.month, mine.day, lang)}</Text>
                    <Text style={[styles.rowSub, { color: c.textSecondary }]}>
                      {myDays === 1 ? t('birthdays.tomorrow') : t('birthdays.in_days', { count: myDays })}
                    </Text>
                  </View>
                </View>
              </View>
            )
          ) : null}

          {/* Wishes you got today */}
          {myToday && mine?.wishes?.length ? (
            <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
              <Text style={[styles.cardTitle, { color: c.text }]}>{t('birthdays.wishes_for_you', { count: mine.wishCount || mine.wishes.length })}</Text>
              {mine.wishes.map((w, i) => (
                <View key={`${w.name}-${i}`} style={[styles.wishRow, { borderTopColor: c.border, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }]}>
                  <BirthdayAvatar uri={w.avatar} name={w.name} size={30} />
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={[styles.wishFrom, { color: c.text }]} numberOfLines={1}>{w.name}</Text>
                    <Text style={[styles.rowSub, { color: c.textSecondary }]} numberOfLines={1}>{wishLine(t, w.template)}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {/* Show my birthday */}
          {mine?.month ? (
            <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
              {mine.minor ? (
                <Text style={[styles.help, { color: c.textSecondary, marginTop: 0 }]}>🔒 {t('birthdays.minor_private_stars')}</Text>
              ) : (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={[styles.toggleText, { color: c.text }]}>{t('birthdays.show_toggle')}</Text>
                    <Switch
                      value={!!mine.show}
                      disabled={toggling}
                      onValueChange={toggleShow}
                      trackColor={{ true: BIRTHDAY_PINK }}
                      thumbColor="#fff"
                    />
                  </View>
                  <Text style={[styles.help, { color: c.textSecondary }]}>{t('birthdays.show_help')}</Text>
                </>
              )}
              {mine.canEdit && editDob ? (
                <TouchableOpacity onPress={() => setEditing(true)} style={[styles.editRow, { borderTopColor: c.border }]} activeOpacity={0.7}>
                  <Icon name="create-outline" size={16} color={BIRTHDAY_PINK} />
                  <Text style={[styles.editText, { color: BIRTHDAY_PINK }]}>{t('birthdays.edit_row')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {/* ═══ TODAY ═══ */}
          <Text style={[styles.section, { color: c.text }]}>🎉 {t('birthdays.today')}</Text>
          {today.length ? (
            <View style={[styles.listCard, { backgroundColor: c.bgAlt, borderColor: c.border }]}>{today.map((b) => row(b, 'today'))}</View>
          ) : (
            <Text style={[styles.empty, { color: c.textSecondary }]}>{t('birthdays.none_today')}</Text>
          )}

          {/* ═══ THIS WEEK ═══ */}
          <Text style={[styles.section, { color: c.text }]}>📅 {t('birthdays.this_week')}</Text>
          {week.length ? (
            <View style={[styles.listCard, { backgroundColor: c.bgAlt, borderColor: c.border }]}>{week.map((b) => row(b, 'week'))}</View>
          ) : (
            <Text style={[styles.empty, { color: c.textSecondary }]}>{t('birthdays.none_week')}</Text>
          )}

          {/* Dev-only: move "your" birthday to preview every state. */}
          {__DEV__ && preview ? (
            <View style={[styles.devPanel, { borderColor: c.border }]}>
              <Text style={[styles.devTitle, { color: c.textSecondary }]}>Preview (debug builds only): my birthday is</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                {[['today', 'Today'], ['soon', 'In 3 days'], ['later', 'In 2 months']].map(([k, label]) => (
                  <TouchableOpacity
                    key={k}
                    onPress={() => switchPreview(k)}
                    style={[styles.devChip, { borderColor: BIRTHDAY_PINK, backgroundColor: preview === k ? BIRTHDAY_PINK : 'transparent' }]}
                  >
                    <Text style={{ color: preview === k ? '#fff' : BIRTHDAY_PINK, fontWeight: '800', fontSize: 12 }}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
      <ScreenBottomBanner background={c.bg} />

      <EditBirthdaySheet
        visible={editing}
        dob={editDob}
        c={c}
        onClose={() => setEditing(false)}
        onSaved={onBirthdaySaved}
      />

      <WishSheet
        visible={!!wishFor}
        name={wishFor?.name}
        c={c}
        busy={sending}
        onPick={sendWish}
        onClose={() => setWishFor(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  headerSub: { fontSize: 12, marginTop: 1 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  hero: { borderRadius: 20, paddingVertical: 22, paddingHorizontal: 18, alignItems: 'center', overflow: 'hidden' },
  heroCake: { fontSize: 54 },
  heroTitle: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'center', marginTop: 6 },
  heroSub: { color: 'rgba(255,255,255,0.92)', fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 6, lineHeight: 18 },
  heroBtn: { marginTop: 14, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 22, paddingVertical: 11 },
  heroBtnText: { color: BIRTHDAY_PINK, fontWeight: '900', fontSize: 15 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 12 },
  cardLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  cardTitle: { fontSize: 15, fontWeight: '800', marginBottom: 6 },
  bigDate: { fontSize: 22, fontWeight: '900' },
  toggleText: { flex: 1, fontSize: 15, fontWeight: '700', marginRight: 10 },
  help: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  editText: { fontSize: 13, fontWeight: '800' },
  section: { fontSize: 16, fontWeight: '900', marginTop: 22, marginBottom: 8 },
  listCard: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  rowName: { fontSize: 15, fontWeight: '800' },
  rowSub: { fontSize: 12, marginTop: 2 },
  wishBtn: { backgroundColor: BIRTHDAY_PINK, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  wishBtnText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  wishedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  wishedText: { fontSize: 12, fontWeight: '700' },
  youTag: { fontSize: 12, fontWeight: '900' },
  daysPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  daysText: { fontSize: 12, fontWeight: '800' },
  empty: { fontSize: 13, paddingVertical: 6 },
  wishRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  wishFrom: { fontSize: 14, fontWeight: '800' },
  devPanel: { marginTop: 28, borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, padding: 12 },
  devTitle: { fontSize: 11, fontWeight: '700' },
  devChip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
});
