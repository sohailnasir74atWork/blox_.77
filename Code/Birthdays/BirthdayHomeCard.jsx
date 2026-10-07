/**
 * BirthdayHomeCard — the Home entry to Birthdays (ported from Adopt Me,
 * adoptme-jan7/Code/Birthdays, 2026-10-07). One of, in this order:
 *   1. It is your birthday: the celebration (claim your stars, wishes).
 *   2. Your birthday is within a week: a countdown. Birthdays are shown by
 *      default; "Hide my birthday" lives on the Birthdays screen.
 *   3. Other players (opted in) have a birthday today: "Send a wish".
 * Otherwise nothing. Reads birthday_home only (a few KB, kept on the phone
 * for the day and refreshed at most every 2 hours; see birthdayApi).
 */

import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import SafeLottieView from '../Helper/SafeLottieView';
import { showErrorMessage, showSuccessMessage } from '../Helper/MessageHelper';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import { useGlobalState } from '../GlobelStats';
import {
  setBirthdayUser, getBirthdayHome, todayBirthdayCount, claimBirthdayGift, birthdayErrorKey, BIRTHDAY_GIFT_STARS,
} from './birthdayApi';
import { daysUntilBirthday } from './birthdayDate';
import { BIRTHDAY_GRADIENT, BIRTHDAY_PINK } from './BirthdayBits';

const COUNTDOWN_DAYS = 7;

export default function BirthdayHomeCard({ userId, userName }) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { appdatabase } = useGlobalState();
  const [mine, setMine] = useState(null);
  const [todayCount, setTodayCount] = useState(0);
  const [claiming, setClaiming] = useState(false);

  useFocusEffect(useCallback(() => {
    if (!userId && !__DEV__) { setMine(null); setTodayCount(0); return undefined; }
    let live = true;
    setBirthdayUser(userId);
    getBirthdayHome()
      .then((h) => {
        if (!live) return;
        setMine(h);
        setTodayCount(todayBirthdayCount(userId));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [userId]));

  const open = useCallback(() => navigation.navigate('Birthdays'), [navigation]);

  const claim = useCallback(async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      const { stars } = await claimBirthdayGift(appdatabase, userId);
      setMine((m) => (m ? { ...m, giftReady: false, giftOpened: true } : m));
      trackGrowthEvent('birthday_gift_claim', { stars, where: 'home' });
      showSuccessMessage(t('birthdays.stars_added', { stars }), '');
    } catch (e) {
      showErrorMessage(t('home.alert.error'), t(`birthdays.err.${birthdayErrorKey(e)}`));
      // The server said no: show what it says now.
      getBirthdayHome({ force: true }).then(setMine).catch(() => {});
    } finally {
      setClaiming(false);
    }
  }, [claiming, appdatabase, userId, t]);

  const days = mine?.month ? daysUntilBirthday(mine.month, mine.day) : null;

  // 1. Your birthday.
  if (days === 0) {
    return (
      // Each variant has its own key: a view that gains a gradient in place
      // crashes Android (RN 0.87 BackgroundImageDrawable); a fresh one is fine.
      <TouchableOpacity key="party" activeOpacity={0.9} onPress={open} style={[styles.card, styles.party, { backgroundImage: BIRTHDAY_GRADIENT }]}>
        <SafeLottieView
          source={require('../../assets/lottie/confetti.json')}
          autoPlay
          loop={false}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <Text style={styles.bigEmoji}>🎂</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{t('birthdays.home_happy', { name: userName || t('birthdays.you') })}</Text>
          <Text style={styles.sub} numberOfLines={2}>
            {mine.giftReady
              ? t('birthdays.home_gift_stars', { stars: BIRTHDAY_GIFT_STARS })
              : t('birthdays.home_wishes', { count: mine.wishCount || 0 })}
          </Text>
        </View>
        {mine.giftReady ? (
          <TouchableOpacity style={styles.claimBtn} onPress={claim} disabled={claiming} activeOpacity={0.85}>
            {claiming
              ? <ActivityIndicator size="small" color={BIRTHDAY_PINK} />
              : <Text style={styles.claimText}>{t('birthdays.claim_stars', { stars: BIRTHDAY_GIFT_STARS })}</Text>}
          </TouchableOpacity>
        ) : (
          <FontAwesome name="chevron-right" size={14} color="#fff" />
        )}
      </TouchableOpacity>
    );
  }

  // 2. Coming up: a countdown.
  if (days != null && days <= COUNTDOWN_DAYS) {
    return (
      <TouchableOpacity key="soon" activeOpacity={0.9} onPress={open} style={[styles.card, { backgroundImage: BIRTHDAY_GRADIENT }]}>
        <Text style={styles.bigEmoji}>🎈</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {days === 1 ? t('birthdays.home_soon_tomorrow') : t('birthdays.home_soon', { count: days })}
          </Text>
          <Text style={styles.sub} numberOfLines={2}>
            {mine.show ? t('birthdays.home_soon_shown') : t('birthdays.home_soon_hidden')}
          </Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color="#fff" />
      </TouchableOpacity>
    );
  }

  // 3. Other players' birthdays today.
  if (todayCount > 0) {
    return (
      <TouchableOpacity key="others" activeOpacity={0.9} onPress={open} style={[styles.card, { backgroundImage: BIRTHDAY_GRADIENT }]}>
        <Text style={styles.bigEmoji}>🎉</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{t('birthdays.home_others', { count: todayCount })}</Text>
          <Text style={styles.sub} numberOfLines={1}>{t('birthdays.home_send_wish')}</Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color="#fff" />
      </TouchableOpacity>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16,
    marginHorizontal: 16, marginBottom: 8, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  party: { paddingVertical: 16 },
  bigEmoji: { fontSize: 30 },
  title: { color: '#fff', fontSize: 16, fontWeight: '900' },
  sub: { color: 'rgba(255,255,255,0.92)', fontSize: 12, marginTop: 2, lineHeight: 16, fontWeight: '600' },
  claimBtn: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, minWidth: 74, alignItems: 'center' },
  claimText: { color: BIRTHDAY_PINK, fontWeight: '900', fontSize: 13 },
});
