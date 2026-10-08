/**
 * ReportScreen — Values ▸ More ▸ Complaints & ideas (ported from Adopt Me). A player picks Complaint (with a
 * category: false review, moderation, scam, app problem, other) or
 * Suggestion, writes the details and may attach up to three screenshots.
 * Their user ID goes with it; admins read everything in More ▸ Admin
 * (ValuesScreen/AdminReport.js, the More hub's Admin card). "Your reports" below shows whether an admin
 * has looked at each one. Data rules: Code/Reports/reportsApi.js.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image, ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import { showErrorMessage, showSuccessMessage } from '../Helper/MessageHelper';
import { pickReportImages } from '../Helper/reportImageUpload';
import {
  sendReport, fetchMyReports, COMPLAINT_CATEGORIES, REPORT_TEXT_MAX, MAX_REPORT_IMAGES,
} from './reportsApi';

const ACCENT = '#7C3AED';
const TYPES = [
  { key: 'complaint', icon: 'alert-circle' },
  { key: 'suggestion', icon: 'bulb' },
];

export default function ReportScreen() {
  const { t, i18n } = useTranslation();
  const { user, appdatabase, theme } = useGlobalState();
  const c = getThemeColors(theme === 'dark');
  const uid = user?.id || null;

  const [type, setType] = useState('complaint');
  const [category, setCategory] = useState(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState([]);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false); // render state lags a fast double tap
  const [progress, setProgress] = useState(null);
  const [mine, setMine] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadMine = useCallback(async () => {
    if (!uid || !appdatabase) return;
    try { setMine(await fetchMyReports(appdatabase, uid)); } catch (e) { setMine((m) => m || []); }
  }, [uid, appdatabase]);

  useEffect(() => { loadMine(); }, [loadMine]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMine();
    setRefreshing(false);
  }, [loadMine]);

  const addImages = async () => {
    try {
      const picked = await pickReportImages(images.length);
      if (picked.length) setImages((prev) => [...prev, ...picked].slice(0, MAX_REPORT_IMAGES));
    } catch (e) {
      showErrorMessage(t('reports.err_picker'));
    }
  };

  const submit = async () => {
    if (sendingRef.current) return;
    if (type === 'complaint' && !category) { showErrorMessage(t('reports.err_category')); return; }
    if (!text.trim()) { showErrorMessage(t('reports.err_text')); return; }
    sendingRef.current = true;
    setSending(true);
    try {
      await sendReport(appdatabase, user, { type, category, text, imageUris: images }, (done, total) => setProgress({ done, total }));
      showSuccessMessage(t('reports.sent_title'), t('reports.sent_body'));
      setText(''); setImages([]); setCategory(null);
      loadMine();
    } catch (e) {
      const key = e?.code === 'too_soon' ? 'err_too_soon'
        : /Bunny upload|readFile|ENOENT/i.test(String(e?.message)) ? 'err_images'
        : 'err_generic';
      showErrorMessage(t(`reports.${key}`));
    } finally {
      sendingRef.current = false;
      setSending(false);
      setProgress(null);
    }
  };

  if (!uid) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 40 }}>📝</Text>
        <Text style={[styles.signIn, { color: c.text }]}>{t('reports.sign_in')}</Text>
      </View>
    );
  }

  const chip = (on) => [styles.chip, { borderColor: on ? ACCENT : c.border, backgroundColor: on ? ACCENT : c.bgAlt }];

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
    >
      {/* Complaint | Suggestion */}
      <View style={[styles.segment, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
        {TYPES.map((o) => {
          const on = type === o.key;
          return (
            <TouchableOpacity key={o.key} onPress={() => setType(o.key)} style={[styles.segBtn, on && { backgroundColor: ACCENT }]} activeOpacity={0.85}>
              <Icon name={on ? o.icon : `${o.icon}-outline`} size={17} color={on ? '#FFF' : c.textSecondary} />
              <Text style={[styles.segText, { color: on ? '#FFF' : c.textSecondary }]}>{t(`reports.type_${o.key}`)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[styles.hint, { color: c.textSecondary }]}>{t(`reports.${type}_hint`)}</Text>

      {type === 'complaint' ? (
        <>
          <Text style={[styles.label, { color: c.textSecondary }]}>{t('reports.category')}</Text>
          <View style={styles.chips}>
            {COMPLAINT_CATEGORIES.map((k) => (
              <TouchableOpacity key={k} onPress={() => setCategory(k)} style={chip(category === k)}>
                <Text style={[styles.chipText, { color: category === k ? '#FFF' : c.text }]}>{t(`reports.cat.${k}`)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : null}

      <Text style={[styles.label, { color: c.textSecondary }]}>{t('reports.details')}</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        maxLength={REPORT_TEXT_MAX}
        textAlignVertical="top"
        placeholder={t(`reports.placeholder_${type}`)}
        placeholderTextColor={c.textMuted}
        style={[styles.input, { backgroundColor: c.bgAlt, borderColor: c.border, color: c.text }]}
      />
      <Text style={[styles.counter, { color: c.textMuted }]}>{text.length}/{REPORT_TEXT_MAX}</Text>

      <Text style={[styles.label, { color: c.textSecondary }]}>{t('reports.images', { max: MAX_REPORT_IMAGES })}</Text>
      <View style={styles.thumbs}>
        {images.map((uri) => (
          <View key={uri}>
            <Image source={{ uri }} style={styles.thumb} />
            <TouchableOpacity onPress={() => setImages((p) => p.filter((u) => u !== uri))} style={styles.thumbX} hitSlop={8}>
              <Icon name="close" size={14} color="#FFF" />
            </TouchableOpacity>
          </View>
        ))}
        {images.length < MAX_REPORT_IMAGES ? (
          <TouchableOpacity onPress={addImages} style={[styles.thumb, styles.addTile, { borderColor: c.border, backgroundColor: c.bgAlt }]}>
            <Icon name="image-outline" size={22} color={c.textSecondary} />
            <Text style={{ color: c.textSecondary, fontSize: 11, fontWeight: '700', marginTop: 2 }}>{t('reports.add_image')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <TouchableOpacity onPress={submit} disabled={sending} style={[styles.send, { opacity: sending ? 0.7 : 1 }]} activeOpacity={0.85}>
        {sending ? (
          <>
            <ActivityIndicator color="#FFF" />
            {progress ? <Text style={styles.sendText}>{t('reports.uploading', { done: progress.done, total: progress.total })}</Text> : null}
          </>
        ) : (
          <>
            <Icon name="send" size={16} color="#FFF" />
            <Text style={styles.sendText}>{t('reports.send')}</Text>
          </>
        )}
      </TouchableOpacity>
      <Text style={[styles.note, { color: c.textMuted }]}>{t('reports.id_note')}</Text>

      {mine && mine.length ? (
        <>
          <Text style={[styles.mineTitle, { color: c.text }]}>{t('reports.mine_title')}</Text>
          {mine.map((r) => {
            const done = r.status === 'done';
            return (
              <View key={r.id} style={[styles.mineRow, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
                <Icon name={r.type === 'suggestion' ? 'bulb-outline' : 'alert-circle-outline'} size={18} color={ACCENT} />
                <View style={{ flex: 1, marginHorizontal: 10 }}>
                  <Text style={{ color: c.text, fontSize: 13.5, fontWeight: '700' }} numberOfLines={1}>
                    {r.type === 'suggestion' ? t('reports.type_suggestion') : t(`reports.cat.${r.category || 'other'}`)}
                  </Text>
                  <Text style={{ color: c.textSecondary, fontSize: 12 }} numberOfLines={1}>{r.text}</Text>
                  {r.createdAt ? (
                    <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 2 }}>
                      {new Date(r.createdAt).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.status, { backgroundColor: done ? 'rgba(34,197,94,0.15)' : 'rgba(124,58,237,0.12)' }]}>
                  <Text style={{ color: done ? '#16A34A' : ACCENT, fontSize: 11, fontWeight: '800' }}>
                    {t(done ? 'reports.status_done' : 'reports.status_open')}
                  </Text>
                </View>
              </View>
            );
          })}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 8, paddingTop: 12, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  signIn: { fontSize: 15, fontWeight: '700', textAlign: 'center', marginTop: 10 },
  segment: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, padding: 4 },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  segText: { fontSize: 14, fontWeight: '800' },
  hint: { fontSize: 13, marginTop: 10, lineHeight: 18 },
  label: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 13, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 130, maxHeight: 260, padding: 12, fontSize: 14.5, lineHeight: 20 },
  counter: { fontSize: 11, textAlign: 'right', marginTop: 4 },
  thumbs: { flexDirection: 'row', gap: 10 },
  thumb: { width: 76, height: 76, borderRadius: 12 },
  thumbX: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  addTile: { borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  send: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ACCENT, borderRadius: 999, paddingVertical: 14, marginTop: 22 },
  sendText: { color: '#FFF', fontSize: 15, fontWeight: '900' },
  note: { fontSize: 11.5, textAlign: 'center', marginTop: 8, lineHeight: 16 },
  mineTitle: { fontSize: 15, fontWeight: '800', marginTop: 26, marginBottom: 8 },
  mineRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 },
  status: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
});
