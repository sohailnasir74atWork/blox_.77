/**
 * BirthdaysScreen — your birthday, and other players' birthdays today and
 * tomorrow.
 * Ported from Adopt Me (adoptme-jan7/Code/Birthdays, 2026-10-07; paging,
 * skeleton and one-tap wishes 2026-10-08). Root-stack route `Birthdays`.
 *
 * Only month and day are ever shown (never a year or an age), and only for
 * players who left "Show my birthday" on and are 13 or older; the server
 * enforces both (supabase/036–037). On your own birthday this is the
 * celebration: the once-a-year stars gift and the wishes you got.
 *
 * Short by design (owner, 2026-10-12; ~60 birthdays a day made the full
 * list a chore; port of Adopt Me's 056 screen): today's top 6, the people
 * you know first (041), a "Wish everyone" button that wishes the rest in one
 * call, "See all" for the full list (20 at a time, "Load more"), and
 * tomorrow as a single line. On your own birthday, "Thank everyone" sends
 * one thank-you push to each wisher.
 *
 * A wish is one tap: the button spins while the request is in flight, and
 * other buttons can be tapped meanwhile; each wish is sent on its own.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, Switch, ActivityIndicator, RefreshControl, Animated,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import { showErrorMessage, showSuccessMessage } from '../Helper/MessageHelper';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import { useHaptic } from '../Helper/HepticFeedBack';
import SafeLottieView from '../Helper/SafeLottieView';
import {
  setBirthdayUser, getMyBirthday, peekMyBirthday, peekBirthdayList, setBirthdayVisibility, listBirthdays,
  loadMoreBirthdays, sendBirthdayWish, markWished, birthdayErrorKey, invalidateBirthdays, isBirthdayMockActive,
  getBirthdayMock, enableBirthdayPreview, claimBirthdayGift, flushBirthdayStars, getKnownDob, loadKnownDob,
  BIRTHDAY_GIFT_STARS, listBirthdaysTop, peekBirthdayTop, wishAllBirthdays, thankBirthdayWishers,
} from './birthdayApi';
import { daysUntilBirthday, formatMonthDay, formatUpcoming } from './birthdayDate';
import { BirthdayAvatar, wishLine, BIRTHDAY_PINK, BIRTHDAY_GRADIENT } from './BirthdayBits';
import EditBirthdaySheet from './EditBirthdaySheet';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';

// A wish from a row uses the plain "Happy birthday!" message; "Wish
// everyone" sends "Have an awesome day!" so the two read differently.
const WISH_TEMPLATE = 'hbd';
const WISH_ALL_TEMPLATE = 'party';

// Why a player is near the top of the short list (041 `reason`).
const REASON_ICON = { dm: '💬', group: '👥', wished_you: '🎂' };

// A soft pulse for the loading placeholders (native driver, stops on unmount).
const usePulse = () => {
  const value = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(value, { toValue: 0.45, duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [value]);
  return value;
};

/** Placeholder for "Your birthday" or for a few list rows while they load. */
const Placeholder = ({ c, isDark, rows = 0 }) => {
  const opacity = usePulse();
  const bone = { backgroundColor: isDark ? '#334155' : '#E5E7EB' };
  if (!rows) {
    return (
      <Animated.View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border, opacity }]}>
        <View style={[styles.bone, bone, { width: 90, height: 10 }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <View style={[bone, { width: 34, height: 34, borderRadius: 17 }]} />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <View style={[styles.bone, bone, { width: '45%', height: 16 }]} />
            <View style={[styles.bone, bone, { width: '30%', height: 10, marginTop: 8 }]} />
          </View>
        </View>
      </Animated.View>
    );
  }
  return (
    <Animated.View style={[styles.listCard, { backgroundColor: c.bgAlt, borderColor: c.border, opacity }]}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.row, i < rows - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}>
          <View style={[bone, { width: 42, height: 42, borderRadius: 21 }]} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={[styles.bone, bone, { width: `${50 - (i % 3) * 8}%`, height: 13 }]} />
            <View style={[styles.bone, bone, { width: '28%', height: 10, marginTop: 7 }]} />
          </View>
          <View style={[bone, { width: 76, height: 32, borderRadius: 16 }]} />
        </View>
      ))}
    </Animated.View>
  );
};

/** One player. Re-renders only when its own row, wish state or theme changes. */
const BirthdayRow = memo(({ b, kind, first, last, self, pending, c, lang, t, onWish }) => (
  <View
    style={[
      styles.rowWrap, { backgroundColor: c.bgAlt, borderColor: c.border },
      first && styles.rowFirst, last && styles.rowLast,
    ]}
  >
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}>
      <BirthdayAvatar uri={b.avatar} name={b.name} size={42} ring={kind === 'today'} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[styles.rowName, { color: c.text }]} numberOfLines={1}>{b.name}</Text>
        <Text style={[styles.rowSub, { color: c.textSecondary }]} numberOfLines={1}>
          {kind === 'today'
            ? [b.reason && REASON_ICON[b.reason] ? `${REASON_ICON[b.reason]} ${t(`birthdays.reason.${b.reason}`)}` : null,
              t('birthdays.wish_count', { count: b.wishes || 0 })].filter(Boolean).join('  ·  ')
            : formatUpcoming(b.month, b.day, lang)}
        </Text>
      </View>
      {kind !== 'today' ? null : self ? (
        <Text style={[styles.youTag, { color: BIRTHDAY_PINK }]}>{t('birthdays.you')}</Text>
      ) : b.wished ? (
        <View style={[styles.wishedPill, { borderColor: c.border }]}>
          <Icon name="checkmark" size={14} color={c.textSecondary} />
          <Text style={[styles.wishedText, { color: c.textSecondary }]}>{t('birthdays.wished')}</Text>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.wishBtn}
          onPress={() => onWish(b)}
          disabled={pending}
          activeOpacity={0.85}
        >
          {pending
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.wishBtnText}>🎉 {t('birthdays.wish')}</Text>}
        </TouchableOpacity>
      )}
    </View>
  </View>
));

export default function BirthdaysScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user, theme, appdatabase } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDark = theme === 'dark';
  const c = getThemeColors(isDark);
  const uid = user?.id || null;
  const lang = i18n.language;

  // Instant first paint from the phone's saved copy; load() refreshes it.
  const [mine, setMine] = useState(peekMyBirthday());
  const [top, setTop] = useState(peekBirthdayTop());
  // "See all": the full paged list (037), loaded only when asked for.
  const [showAll, setShowAll] = useState(false);
  const [list, setList] = useState(null);
  const [wishingAll, setWishingAll] = useState(false);
  const [thanking, setThanking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listFailed, setListFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [knownDob, setKnownDob] = useState(() => getKnownDob(uid));
  // uids whose wish is in flight. The ref answers taps at once; the state draws the spinners.
  const pendingRef = useRef(new Set());
  const [pending, setPending] = useState(pendingRef.current);
  const loadingMoreRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const showAllRef = useRef(false);
  const load = useCallback(async (force = false) => {
    setBirthdayUser(uid);
    // Stars granted earlier that never reached RTDB (an MMKV read; usually nothing).
    flushBirthdayStars(appdatabase, uid).catch(() => {});
    const [m, tp, l] = await Promise.allSettled([
      getMyBirthday({ force }),
      listBirthdaysTop({ force }),
      showAllRef.current ? listBirthdays({ force }) : Promise.resolve(null),
    ]);
    if (!alive.current) return;
    if (m.status === 'fulfilled') setMine(m.value);
    if (tp.status === 'fulfilled') { setTop(tp.value); setListFailed(false); } else setListFailed(true);
    if (showAllRef.current && l.status === 'fulfilled') setList(l.value);
    if (isBirthdayMockActive()) setPreview(getBirthdayMock().getPreview());
    setLoading(false);
  }, [uid, appdatabase]);

  const openAll = useCallback(async () => {
    showAllRef.current = true;
    setShowAll(true);
    trackGrowthEvent('birthday_see_all', {});
    const cached = peekBirthdayList();
    if (cached) { setList(cached); return; }
    try {
      const l = await listBirthdays();
      if (alive.current) setList(l);
    } catch (e) {
      showErrorMessage(t('home.alert.error'), t('birthdays.err.generic'));
    }
  }, [t]);

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
    let live = true;
    loadKnownDob(appdatabase, uid).then((d) => { if (live && d) setKnownDob(d); }).catch(() => {});
    return () => { live = false; };
  }, [uid, canEditMine, appdatabase]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    if (alive.current) setRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const l = await loadMoreBirthdays();
      if (alive.current && l) setList(l);
    } catch (e) {
      showErrorMessage(t('home.alert.error'), t('birthdays.err.generic'));
    } finally {
      loadingMoreRef.current = false;
      if (alive.current) setLoadingMore(false);
    }
  }, [t]);

  const setPendingFor = useCallback((who, on) => {
    const next = new Set(pendingRef.current);
    if (on) next.add(who); else next.delete(who);
    pendingRef.current = next;
    if (alive.current) setPending(next);
  }, []);

  const showWished = useCallback((who, wishes) => {
    if (!alive.current) return;
    setList((l) => (l ? {
      ...l,
      rows: l.rows.map((b) => (b.uid === who ? { ...b, wished: true, wishes: wishes ?? (b.wished ? b.wishes : (b.wishes || 0) + 1) } : b)),
    } : l));
    // birthdayApi already patched the saved top list (rows and unwished).
    setTop(peekBirthdayTop());
  }, []);

  const wishAll = useCallback(async () => {
    if (wishingAll) return;
    setWishingAll(true);
    triggerHapticFeedback('impactMedium');
    try {
      const res = await wishAllBirthdays(WISH_ALL_TEMPLATE);
      trackGrowthEvent('birthday_wish_all', { sent: res?.sent || 0, left: res?.left || 0 });
      if (!alive.current) return;
      setTop(peekBirthdayTop());
      if (res?.sent) showSuccessMessage(t('birthdays.wish_all_sent', { count: res.sent }), '');
      if (res?.limited) showErrorMessage(t('home.alert.error'), t('birthdays.err.limit'));
      // Exact wish states for every row (and the full list, if open).
      load(true);
    } catch (e) {
      showErrorMessage(t('home.alert.error'), t(`birthdays.err.${birthdayErrorKey(e)}`));
    } finally {
      if (alive.current) setWishingAll(false);
    }
  }, [wishingAll, triggerHapticFeedback, t, load]);

  const thankAll = useCallback(async () => {
    if (thanking) return;
    setThanking(true);
    triggerHapticFeedback('impactLight');
    try {
      const res = await thankBirthdayWishers();
      trackGrowthEvent('birthday_thank', { count: res?.thanked || 0 });
      if (!alive.current) return;
      setMine((m) => (m ? { ...m, thankPending: 0 } : m));
      showSuccessMessage(t('birthdays.thank_sent'), '');
    } catch (e) {
      showErrorMessage(t('home.alert.error'), t(`birthdays.err.${birthdayErrorKey(e)}`));
    } finally {
      if (alive.current) setThanking(false);
    }
  }, [thanking, triggerHapticFeedback, t]);

  const wish = useCallback(async (b) => {
    if (pendingRef.current.has(b.uid)) return;
    setPendingFor(b.uid, true);
    triggerHapticFeedback('impactLight');
    try {
      const res = await sendBirthdayWish(b.uid, WISH_TEMPLATE);
      showWished(b.uid, res?.wishes);
      trackGrowthEvent('birthday_wish', { template: WISH_TEMPLATE });
    } catch (e) {
      const key = birthdayErrorKey(e);
      if (key === 'already_wished') {
        markWished(b.uid);
        showWished(b.uid);
      } else {
        showErrorMessage(t('home.alert.error'), t(`birthdays.err.${key}`));
        // The list outlived the day it was loaded for (screen left open past
        // midnight): reload so the row moves to where the server puts it.
        if (key === 'not_today') load(true);
      }
    } finally {
      setPendingFor(b.uid, false);
    }
  }, [setPendingFor, showWished, triggerHapticFeedback, t, load]);

  const toggleShow = useCallback(async (next) => {
    if (toggling) return;
    setToggling(true);
    setMine((m) => (m ? { ...m, show: next, asked: true } : m));
    try {
      await setBirthdayVisibility(next);
      trackGrowthEvent('birthday_visibility', { show: next ? 1 : 0, where: 'screen' });
      // Your own row joins or leaves the list when your birthday is today or tomorrow.
      if (mine?.month && daysUntilBirthday(mine.month, mine.day) <= 1) load(true);
    } catch (e) {
      setMine((m) => (m ? { ...m, show: !next } : m));
      showErrorMessage(t('home.alert.error'), t('birthdays.err.generic'));
    } finally {
      if (alive.current) setToggling(false);
    }
  }, [toggling, mine, load, t]);

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
      if (alive.current) setClaiming(false);
    }
  }, [claiming, appdatabase, uid, t, load]);

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
    setTop(null);
    setList(null);
    load(true);
  }, [load]);

  const retryList = useCallback(() => {
    setListFailed(false);
    load(true);
  }, [load]);

  const myDays = mine?.month ? daysUntilBirthday(mine.month, mine.day) : null;
  const myToday = myDays === 0;
  const name = user?.displayName;
  const pad2 = (n) => String(n).padStart(2, '0');
  const editDob = (!isBirthdayMockActive() && knownDob)
    || (__DEV__ && mine?.month ? `${new Date().getFullYear() - 20}-${pad2(mine.month)}-${pad2(mine.day)}` : null);

  // Title, Wish everyone, rows, See all and tomorrow's line, flattened for one FlatList.
  const items = useMemo(() => {
    if (!top) return [];
    const out = [{ type: 'title', key: 't-today', title: `🎉 ${t('birthdays.today')}`, count: top.total }];
    if (!top.total) {
      out.push({ type: 'empty', key: 'e-today', text: t('birthdays.none_today') });
    } else if (!top.legacy) {
      out.push({ type: 'wishAll', key: 'wish-all' });
    }
    const rows = showAll && list
      ? (list.rows || []).filter((b) => b.daysUntil === 0 && b.uid !== uid)
      : top.rows || [];
    rows.forEach((b, i) => out.push({ type: 'row', key: `today-${b.uid}`, b, kind: 'today', first: i === 0, last: i === rows.length - 1 }));
    if (!showAll && top.total > rows.length) out.push({ type: 'seeAll', key: 'see-all' });
    // In "See all", tomorrow's line waits for the last page (it sits above "Load more" otherwise).
    if (top.tomorrow && !(showAll && list?.next)) out.push({ type: 'tomorrow', key: 'tomorrow' });
    return out;
  }, [top, list, showAll, uid, t]);

  const renderItem = useCallback(({ item }) => {
    if (item.type === 'title') {
      return (
        <Text style={[styles.section, { color: c.text }]}>
          {item.title}
          {item.count ? <Text style={[styles.sectionCount, { color: c.textSecondary }]}>{`  ·  ${item.count}`}</Text> : null}
        </Text>
      );
    }
    if (item.type === 'empty') return <Text style={[styles.empty, { color: c.textSecondary }]}>{item.text}</Text>;
    if (item.type === 'wishAll') {
      return top?.unwished ? (
        <TouchableOpacity style={styles.wishAllBtn} onPress={wishAll} disabled={wishingAll} activeOpacity={0.9}>
          {wishingAll
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.wishAllText}>🎉 {t('birthdays.wish_all', { count: top.unwished })}</Text>}
        </TouchableOpacity>
      ) : (
        <View style={[styles.wishAllDone, { borderColor: c.border, backgroundColor: c.bgAlt }]}>
          <Icon name="checkmark-circle" size={18} color={BIRTHDAY_PINK} />
          <Text style={[styles.wishAllDoneText, { color: c.text }]}>{t('birthdays.wished_all')}</Text>
        </View>
      );
    }
    if (item.type === 'seeAll') {
      return (
        <TouchableOpacity onPress={openAll} style={styles.seeAll} activeOpacity={0.7}>
          <Text style={[styles.seeAllText, { color: BIRTHDAY_PINK }]}>{t('birthdays.see_all', { count: top.total })}</Text>
          <Icon name="chevron-forward" size={16} color={BIRTHDAY_PINK} />
        </TouchableOpacity>
      );
    }
    if (item.type === 'tomorrow') {
      return (
        <Text style={[styles.tomorrowLine, { color: c.textSecondary }]}>
          📅 {t('birthdays.tomorrow_line', { count: top.tomorrow })}
        </Text>
      );
    }
    return (
      <BirthdayRow
        b={item.b}
        kind={item.kind}
        first={item.first}
        last={item.last}
        self={item.b.uid === uid}
        pending={pending.has(item.b.uid)}
        c={c}
        lang={lang}
        t={t}
        onWish={wish}
      />
    );
  }, [c, uid, pending, lang, t, wish, top, wishAll, wishingAll, openAll]);

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
        onLongPress={() => { enableBirthdayPreview(); setTop(null); setList(null); load(true); }}
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

  const topSection = (
    <View>
      {/* ═══ YOUR BIRTHDAY ═══ */}
      {!mine && loading ? <Placeholder c={c} isDark={isDark} /> : null}
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
            <Text style={styles.heroTitle}>{name ? t('birthdays.hero_title', { name }) : t('birthdays.hero_title_noname')}</Text>
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
          {mine.thankPending > 0 ? (
            <TouchableOpacity style={styles.thankBtn} onPress={thankAll} disabled={thanking} activeOpacity={0.9}>
              {thanking
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.thankText}>💖 {t('birthdays.thank_all', { count: mine.thankPending })}</Text>}
            </TouchableOpacity>
          ) : mine.thankPending === 0 ? (
            <Text style={[styles.thankedLine, { color: c.textSecondary }]}>💖 {t('birthdays.thanked_all')}</Text>
          ) : null}
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
    </View>
  );

  const waiting = !top && (listFailed ? (
    <View style={styles.failBox}>
      <Text style={[styles.empty, { color: c.textSecondary, textAlign: 'center' }]}>{t('birthdays.err.generic')}</Text>
      <TouchableOpacity onPress={retryList} style={[styles.moreBtn, { borderColor: c.border, backgroundColor: c.bgAlt }]} activeOpacity={0.8}>
        <Text style={[styles.moreText, { color: BIRTHDAY_PINK }]}>{t('birthdays.retry')}</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <>
      <Text style={[styles.section, { color: c.text }]}>🎉 {t('birthdays.today')}</Text>
      <Placeholder c={c} isDark={isDark} rows={5} />
    </>
  ));

  const footer = (
    <>
      {showAll && list?.next ? (
        <TouchableOpacity
          onPress={loadMore}
          disabled={loadingMore}
          style={[styles.moreBtn, { borderColor: c.border, backgroundColor: c.bgAlt }]}
          activeOpacity={0.8}
        >
          {loadingMore
            ? <ActivityIndicator size="small" color={BIRTHDAY_PINK} />
            : <Text style={[styles.moreText, { color: BIRTHDAY_PINK }]}>{t('birthdays.load_more')}</Text>}
        </TouchableOpacity>
      ) : null}

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
    </>
  );

  return (
    <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      {header}
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        ListHeaderComponent={topSection}
        ListEmptyComponent={waiting || null}
        ListFooterComponent={footer}
        contentContainerStyle={styles.listContent}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        // RN 0.87 Fabric: clipping crashes in addViewAt (see adoptme-167).
        removeClippedSubviews={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BIRTHDAY_PINK} colors={[BIRTHDAY_PINK]} />}
      />
      <ScreenBottomBanner background={c.bg} />

      <EditBirthdaySheet
        visible={editing}
        dob={editDob}
        c={c}
        onClose={() => setEditing(false)}
        onSaved={onBirthdaySaved}
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
  listContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 },
  center: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  hero: { borderRadius: 20, paddingVertical: 22, paddingHorizontal: 18, alignItems: 'center', overflow: 'hidden', marginTop: 12 },
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
  sectionCount: { fontSize: 13, fontWeight: '700' },
  listCard: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 12 },
  // A list row is one slice of a rounded card: sides always, top/bottom on the ends.
  rowWrap: { borderLeftWidth: 1, borderRightWidth: 1, paddingHorizontal: 12 },
  rowFirst: { borderTopWidth: 1, borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  rowLast: { borderBottomWidth: 1, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  rowName: { fontSize: 15, fontWeight: '800' },
  rowSub: { fontSize: 12, marginTop: 2 },
  wishBtn: {
    backgroundColor: BIRTHDAY_PINK, borderRadius: 999, minWidth: 84, height: 34,
    paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center',
  },
  wishBtnText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  wishedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  wishedText: { fontSize: 12, fontWeight: '700' },
  youTag: { fontSize: 12, fontWeight: '900' },
  empty: { fontSize: 13, paddingVertical: 6 },
  bone: { borderRadius: 6 },
  moreBtn: {
    marginTop: 14, height: 44, borderWidth: 1, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch',
  },
  moreText: { fontSize: 14, fontWeight: '800' },
  failBox: { paddingTop: 28, alignItems: 'stretch' },
  wishAllBtn: {
    backgroundColor: BIRTHDAY_PINK, borderRadius: 14, height: 50, marginBottom: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  wishAllText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  wishAllDone: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: 14, height: 46, marginBottom: 12,
  },
  wishAllDoneText: { fontSize: 14, fontWeight: '800' },
  seeAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 14 },
  seeAllText: { fontSize: 14, fontWeight: '800' },
  tomorrowLine: { fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 6 },
  thankBtn: {
    backgroundColor: BIRTHDAY_PINK, borderRadius: 999, height: 40, marginTop: 4, marginBottom: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  thankText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  thankedLine: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  wishRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  wishFrom: { fontSize: 14, fontWeight: '800' },
  devPanel: { marginTop: 28, borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, padding: 12 },
  devTitle: { fontSize: 11, fontWeight: '700' },
  devChip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
});
