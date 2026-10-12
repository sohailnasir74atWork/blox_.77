/**
 * BirthdayBits.jsx — small shared pieces of the Birthdays feature:
 *   BirthdayAvatar        photo or coloured initial
 *   BirthdayCake          the 🎂 next to a name in chat (opted-in birthdays today)
 *   BirthdayProfileLine   "🎂 12 Oct" on a profile (opted-in, 13+ only)
 *   wishLine              how a received wish reads
 * Ported from Adopt Me (adoptme-jan7/Code/Birthdays, 2026-10-07).
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  WISH_EMOJI, WISH_TEXT_KEY, isBirthdayTodayUid, onBirthdaysChange, ensureBirthdaysTodayLoaded, getPublicBirthday,
} from './birthdayApi';
import { formatMonthDay } from './birthdayDate';

export const BIRTHDAY_PINK = '#EC4899';
export const BIRTHDAY_GRADIENT = 'linear-gradient(120deg, #F472B6 0%, #EC4899 45%, #F59E0B 100%)';

const INITIAL_COLORS = ['#EC4899', '#8B5CF6', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444'];
const colorFor = (name) => INITIAL_COLORS[[...String(name || '?')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % INITIAL_COLORS.length];

export const BirthdayAvatar = ({ uri, name, size = 40, ring = false }) => {
  const box = { width: size, height: size, borderRadius: size / 2 };
  const ringStyle = ring ? { borderWidth: 2, borderColor: BIRTHDAY_PINK } : null;
  if (uri) return <Image resizeMethod="resize" source={{ uri }} style={[box, ringStyle]} />;
  return (
    <View style={[box, ringStyle, { backgroundColor: colorFor(name), alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: size * 0.42 }}>
        {String(name || '?').trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
};

/** 🎂 after a name in chat when that player (opted in) has a birthday today. */
export const BirthdayCake = React.memo(({ uid, size = 12 }) => {
  const { t } = useTranslation();
  const [today, setToday] = useState(() => isBirthdayTodayUid(uid));
  useEffect(() => {
    ensureBirthdaysTodayLoaded();
    setToday(isBirthdayTodayUid(uid));
    // Only this player's own answer re-renders the row (an unchanged boolean
    // is a no-op), not every chat row on every birthday refresh.
    return onBirthdaysChange(() => setToday(isBirthdayTodayUid(uid)));
  }, [uid]);
  if (!today) return null;
  return <Text style={{ fontSize: size, marginLeft: 3 }} accessibilityLabel={t('birthdays.bits.birthday_today')}>🎂</Text>;
});

/** "🎂 12 Oct" on a profile, when the player shows their birthday. */
export const BirthdayProfileLine = ({ uid, color }) => {
  const { i18n } = useTranslation();
  const [md, setMd] = useState(null);
  useEffect(() => {
    let alive = true;
    setMd(null);
    getPublicBirthday(uid).then((d) => { if (alive) setMd(d); }).catch(() => {});
    return () => { alive = false; };
  }, [uid]);
  if (!md?.month) return null;
  return (
    <View style={{ alignItems: 'center', marginTop: 4 }}>
      <Text style={{ fontSize: 10, color, fontWeight: '600' }}>🎂 {formatMonthDay(md.month, md.day, i18n.language)}</Text>
    </View>
  );
};

/** Label for a received wish: "🎉 Have an awesome day!" */
export const wishLine = (t, template) => `${WISH_EMOJI[template] || '🎂'} ${t(`birthdays.wishes.${WISH_TEXT_KEY[template] || 'hbd'}`, { defaultValue: t('birthdays.wishes.hbd') })}`;

