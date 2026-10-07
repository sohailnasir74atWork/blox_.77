/**
 * EditBirthdaySheet — correct your birthday (day, month and year), once.
 * The server (functions/updateBirthday.js) is the authority; the checks here
 * only give a friendly message before the request. One rule beyond a valid
 * date: the change may not put you in an OLDER age group (under 13 / 13-15 /
 * 16-17 / 18+), so a one-time edit can't switch off a protection.
 * Ported from Adopt Me (adoptme-jan7/Code/Birthdays, 2026-10-07); month names
 * come from Intl (Blox has no dob.months translation keys).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Modal, Pressable, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BIRTHDAY_PINK } from './BirthdayBits';
import { updateMyBirthday, birthdayErrorKey } from './birthdayApi';
import { monthShortName } from './birthdayDate';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DOB_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

const parse = (dob) => {
  const m = typeof dob === 'string' ? DOB_RE.exec(dob.trim()) : null;
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
};
const ageGroup = (age) => (age < 13 ? 0 : age < 16 ? 1 : age < 18 ? 2 : 3);
const ageOn = ({ y, m, d }, today) => {
  let age = today.getFullYear() - y;
  const mo = today.getMonth() + 1;
  if (mo < m || (mo === m && today.getDate() < d)) age -= 1;
  return age;
};

export default function EditBirthdaySheet({ visible, dob, c, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const cur = useMemo(() => parse(dob), [dob]);
  const [year, setYear] = useState(cur?.y || null);
  const [month, setMonth] = useState(cur?.m || null);
  const [day, setDay] = useState(cur?.d || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (visible) { setYear(cur?.y || null); setMonth(cur?.m || null); setDay(cur?.d || null); setErr(null); }
  }, [visible, cur]);

  const thisYear = new Date().getFullYear();
  const daysInMonth = year && month ? new Date(year, month, 0).getDate() : 31;
  useEffect(() => { if (day && day > daysInMonth) setDay(null); }, [daysInMonth, day]);

  const save = async () => {
    if (!cur || !year || !month || !day || busy) return;
    setErr(null);
    if (year === cur.y && month === cur.m && day === cur.d) { onClose(); return; }
    const today = new Date();
    const next = { y: year, m: month, d: day };
    if (new Date(year, month - 1, day) > today || ageOn(next, today) < 4) { setErr('birthdays.err.bad_date'); return; }
    if (ageGroup(ageOn(next, today)) > ageGroup(ageOn(cur, today))) { setErr('birthdays.err.age_change'); return; }
    setBusy(true);
    try {
      const res = await updateMyBirthday(year, month, day);
      onSaved(res?.dateOfBirth);
    } catch (e) {
      setErr(`birthdays.err.${birthdayErrorKey(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={busy ? undefined : onClose}>
      <Pressable style={s.backdrop} onPress={busy ? undefined : onClose} />
      <View style={[s.panel, { backgroundColor: c.bgElevated, borderColor: c.border, paddingBottom: insets.bottom + 18 }]}>
        <View style={[s.grabber, { backgroundColor: c.border }]} />
        <Text style={[s.title, { color: c.text }]}>🎂 {t('birthdays.edit_title')}</Text>
        <Text style={[s.sub, { color: c.textSecondary }]}>{t('birthdays.edit_sub')}</Text>

        <Text style={[s.label, { color: c.textSecondary }]}>{t('birthdays.edit_year')}</Text>
        <View style={s.yearRow}>
          <TouchableOpacity
            onPress={() => { setYear((y) => Math.max(1940, (y || thisYear) - 1)); setErr(null); }}
            style={[s.yearBtn, { borderColor: c.border, backgroundColor: c.bgAlt }]}
            hitSlop={8}
          >
            <Icon name="chevron-back" size={20} color={c.text} />
          </TouchableOpacity>
          <Text style={[s.yearText, { color: c.text }]}>{year || '—'}</Text>
          <TouchableOpacity
            onPress={() => { setYear((y) => Math.min(thisYear - 4, (y || thisYear) + 1)); setErr(null); }}
            style={[s.yearBtn, { borderColor: c.border, backgroundColor: c.bgAlt }]}
            hitSlop={8}
          >
            <Icon name="chevron-forward" size={20} color={c.text} />
          </TouchableOpacity>
        </View>

        <Text style={[s.label, { color: c.textSecondary }]}>{t('birthdays.edit_month')}</Text>
        <View style={s.grid}>
          {MONTHS.map((m) => {
            const on = month === m;
            return (
              <TouchableOpacity
                key={m}
                onPress={() => { setMonth(m); setErr(null); }}
                style={[s.chip, s.monthChip, { borderColor: on ? BIRTHDAY_PINK : c.border, backgroundColor: on ? BIRTHDAY_PINK : c.bgAlt }]}
              >
                <Text style={[s.chipText, { color: on ? '#fff' : c.text }]} numberOfLines={1}>{monthShortName(m, i18n.language)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[s.label, { color: c.textSecondary }]}>{t('birthdays.edit_day')}</Text>
        <ScrollView style={{ maxHeight: 190 }} contentContainerStyle={s.grid}>
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
            const on = day === d;
            return (
              <TouchableOpacity
                key={d}
                onPress={() => { setDay(d); setErr(null); }}
                style={[s.chip, s.dayChip, { borderColor: on ? BIRTHDAY_PINK : c.border, backgroundColor: on ? BIRTHDAY_PINK : c.bgAlt }]}
              >
                <Text style={[s.chipText, { color: on ? '#fff' : c.text }]}>{d}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {err ? <Text style={s.err}>{t(err)}</Text> : null}

        <TouchableOpacity
          disabled={!year || !month || !day || busy}
          onPress={save}
          style={[s.save, { opacity: !year || !month || !day || busy ? 0.5 : 1 }]}
          activeOpacity={0.85}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>{t('birthdays.edit_save')}</Text>}
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 18 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '900', textAlign: 'center' },
  sub: { fontSize: 12, textAlign: 'center', marginTop: 4, lineHeight: 17 },
  label: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 },
  yearBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  yearText: { fontSize: 22, fontWeight: '900', minWidth: 80, textAlign: 'center' },
  chip: { borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  monthChip: { width: '23.5%' },
  dayChip: { width: '12.9%' },
  chipText: { fontSize: 13, fontWeight: '700' },
  err: { color: '#EF4444', fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 10 },
  save: { marginTop: 14, backgroundColor: BIRTHDAY_PINK, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '900', fontSize: 15 },
});
