/**
 * BirthdayBits.jsx — small shared pieces of the Birthdays feature:
 *   BirthdayAvatar        photo or coloured initial
 *   BirthdayCake          the 🎂 next to a name in chat (opted-in birthdays today)
 *   BirthdayProfileLine   "🎂 12 Oct" on a profile (opted-in, 13+ only)
 *   WishSheet             the four one-tap wishes
 * Ported from Adopt Me (adoptme-jan7/Code/Birthdays, 2026-10-07).
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Image, Modal, Pressable, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  WISH_TEMPLATES, WISH_EMOJI, WISH_TEXT_KEY, isBirthdayTodayUid, onBirthdaysChange,
  ensureBirthdaysTodayLoaded, getPublicBirthday,
} from './birthdayApi';
import { formatMonthDay } from './birthdayDate';

export const BIRTHDAY_PINK = '#EC4899';
export const BIRTHDAY_GRADIENT = 'linear-gradient(120deg, #F472B6 0%, #EC4899 45%, #F59E0B 100%)';

const INITIAL_COLORS = ['#EC4899', '#8B5CF6', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444'];
const colorFor = (name) => INITIAL_COLORS[[...String(name || '?')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % INITIAL_COLORS.length];

export const BirthdayAvatar = ({ uri, name, size = 40, ring = false }) => {
  const box = { width: size, height: size, borderRadius: size / 2 };
  const ringStyle = ring ? { borderWidth: 2, borderColor: BIRTHDAY_PINK } : null;
  if (uri) return <Image source={{ uri }} style={[box, ringStyle]} />;
  return (
    <View style={[box, ringStyle, { backgroundColor: colorFor(name), alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: size * 0.42 }}>
        {String(name || '?').trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
};

// Re-render when the "birthdays today" set changes.
const useBirthdayStoreVersion = () => {
  const [version, setVersion] = useState(0);
  useEffect(() => onBirthdaysChange(() => setVersion((v) => v + 1)), []);
  return version;
};

/** 🎂 after a name in chat when that player (opted in) has a birthday today. */
export const BirthdayCake = React.memo(({ uid, size = 12 }) => {
  useBirthdayStoreVersion();
  useEffect(() => { ensureBirthdaysTodayLoaded(); }, []);
  if (!isBirthdayTodayUid(uid)) return null;
  return <Text style={{ fontSize: size, marginLeft: 3 }} accessibilityLabel="Birthday today">🎂</Text>;
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

/** Bottom sheet with the four wishes; calls onPick(template). */
export const WishSheet = ({ visible, name, c, busy, onPick, onClose }) => {
  const { t } = useTranslation();
  // Edge-to-edge: the panel runs under the navigation bar unless it pads for it.
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={sheet.backdrop} onPress={busy ? undefined : onClose} />
      <View style={[sheet.panel, { backgroundColor: c.bgElevated, borderColor: c.border, paddingBottom: insets.bottom + 18 }]}>
        <View style={[sheet.grabber, { backgroundColor: c.border }]} />
        <Text style={[sheet.title, { color: c.text }]}>{t('birthdays.wish_title', { name })}</Text>
        <Text style={[sheet.sub, { color: c.textSecondary }]}>{t('birthdays.wish_sub')}</Text>
        {WISH_TEMPLATES.map((key) => (
          <TouchableOpacity
            key={key}
            disabled={busy}
            onPress={() => onPick(key)}
            style={[sheet.option, { borderColor: c.border, backgroundColor: c.bgAlt, opacity: busy ? 0.5 : 1 }]}
            activeOpacity={0.8}
          >
            <Text style={sheet.optionEmoji}>{WISH_EMOJI[key]}</Text>
            <Text style={[sheet.optionText, { color: c.text }]}>{t(`birthdays.wishes.${WISH_TEXT_KEY[key]}`)}</Text>
          </TouchableOpacity>
        ))}
        {busy ? <ActivityIndicator color={BIRTHDAY_PINK} style={{ marginTop: 8 }} /> : null}
      </View>
    </Modal>
  );
};

/** Label for a received wish: "🎉 Have an awesome day!" */
export const wishLine = (t, template) => `${WISH_EMOJI[template] || '🎂'} ${t(`birthdays.wishes.${WISH_TEXT_KEY[template] || 'hbd'}`, { defaultValue: t('birthdays.wishes.hbd') })}`;

const sheet = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 18 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '900', textAlign: 'center' },
  sub: { fontSize: 12, textAlign: 'center', marginTop: 4, marginBottom: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, marginTop: 8 },
  optionEmoji: { fontSize: 22 },
  optionText: { fontSize: 15, fontWeight: '700', flex: 1 },
});
