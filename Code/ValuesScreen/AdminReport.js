/**
 * AdminReport.js — the More hub's Admin card (staff): the inbox for
 * Values ▸ More ▸ Complaints & ideas
 * (Code/Reports). Complaints and Suggestions each filter Open / Done / All;
 * every card shows who sent it (name, user ID to copy, tap for their full
 * profile and Mod Tools), the category, the text, the screenshots (tap to
 * enlarge) and the app version, with Mark done / Reopen and Delete.
 *
 * "Old app" is the feedback older builds still send from their News screen
 * (/news_feedback). The poll summary that used to be here went with the polls
 * (2026-10-07). Reads are paged (40 at a time) instead of the old onValue on
 * the whole feedback node. Staff tool: English only, like the dashboard.
 *
 * A report sent from a review's flag carries reviewId/reviewedUserId: the card
 * shows the review as it is now and offers "Remove review", which deletes it,
 * recounts the rating (Helper/reviewModeration.js; same rule as the dashboard:
 * staff may only remove a review left by someone strictly
 * below them), logs review_delete to the mod action feed and marks the report done
 * (2026-10-18).
 * Ported from Adopt Me; in Blox, mods and up see it (as the old Admin tab).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, Image, Modal, Alert, RefreshControl,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Icon from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';
import {
  fetchReportsPage, setReportStatus, deleteReport, fetchLegacyFeedbackPage, deleteLegacyFeedback,
} from '../Reports/reportsApi';
import { fetchReview, canRemoveReview, canDeleteReviews, deleteReviewAndSummary } from '../Helper/reviewModeration';
import { isCurrentUserOwner } from '../ChatScreen/utils';
import { logModAction } from '../Helper/modSanction';

const PAGE = 40;
const ACCENT = '#7C3AED';
const DONE = '#16A34A';
const DANGER = '#DC2626';
const CATEGORY_LABEL = {
  false_review: 'False review',
  moderation: 'Moderation',
  ban_appeal: 'Ban appeal',
  scam: 'Scam / trade',
  bug: 'App problem',
  other: 'Other',
};
const SEGMENTS = [
  { key: 'complaint', label: 'Complaints' },
  { key: 'suggestion', label: 'Suggestions' },
  { key: 'legacy', label: 'Old app' },
];

const fmt = (ms) => (ms ? new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const NO_BANNED_USERS = [];

// Merge a page into what's loaded: endAt() is inclusive, so the boundary row
// arrives twice.
const mergeById = (prev, next) => {
  const seen = new Map(prev.map((r) => [r.id, r]));
  next.forEach((r) => seen.set(r.id, r));
  return [...seen.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
};

// Cards are memoized with stable callbacks, so a state change elsewhere (a
// filter tap, the viewer, the profile drawer) doesn't re-render every card.
const Sender = ({ r, c, onOpenProfile, onCopy }) => {
  const known = r.userId && r.userId !== 'anonymous';
  return (
    <View style={styles.senderRow}>
      <TouchableOpacity onPress={() => onOpenProfile(r)} disabled={!known} style={styles.sender} activeOpacity={0.7}>
        {r.avatar ? (
          <Image resizeMethod="resize" source={{ uri: r.avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: '#FFF', fontWeight: '800' }}>{String(r.userName || '?').charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {r.userName || 'Anonymous'}{known ? <Text style={{ color: ACCENT, fontWeight: '700', fontSize: 12 }}>  · Profile ›</Text> : null}
          </Text>
          <Text style={{ color: c.textMuted, fontSize: 11 }}>{fmt(r.createdAt)}</Text>
        </View>
      </TouchableOpacity>
      {known ? (
        <TouchableOpacity onPress={() => onCopy(r.userId)} style={[styles.idPill, { borderColor: c.border }]} hitSlop={6}>
          <Icon name="copy-outline" size={12} color={c.textSecondary} />
          <Text style={{ color: c.textSecondary, fontSize: 11, fontWeight: '700', marginLeft: 4 }} numberOfLines={1}>
            {r.userId.slice(0, 8)}…
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const stars = (n) => '★★★★★'.slice(0, Math.max(0, Math.min(5, Math.round(n) || 0))).padEnd(5, '☆');

// The reported review as stored now: undefined while loading, null once gone.
const ReportedReview = ({ r, c, firestoreDB, onRemove }) => {
  const [review, setReview] = useState(undefined);
  useEffect(() => {
    let live = true;
    if (r.reviewRemoved) { setReview(null); return undefined; }
    fetchReview(firestoreDB, r.reviewId).then((v) => live && setReview(v)).catch(() => live && setReview(null));
    return () => { live = false; };
  }, [firestoreDB, r.reviewId, r.reviewRemoved]);
  return (
    <View style={[styles.reviewBox, { backgroundColor: c.bg, borderColor: c.border }]}>
      {review === undefined ? (
        <ActivityIndicator color={ACCENT} />
      ) : review === null ? (
        <Text style={[styles.reviewMeta, { color: c.textMuted }]}>Reported review · already removed</Text>
      ) : (
        <>
          <Text style={[styles.reviewMeta, { color: c.textMuted }]} numberOfLines={1}>
            Reported review · by {review.userName || review.fromUserId?.slice(0, 8) || '?'} · <Text style={styles.reviewStars}>{stars(Number(review.rating))}</Text>
          </Text>
          {review.review ? <Text style={[styles.body, styles.reviewBody, { color: c.text }]} selectable>{review.review}</Text> : null}
          {onRemove ? (
            <TouchableOpacity onPress={() => onRemove(r, review)} style={[styles.btn, styles.removeBtn]}>
              <Icon name="trash" size={15} color="#FFF" />
              <Text style={[styles.btnText, styles.white]}>Remove review</Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}
    </View>
  );
};

const ReportCard = React.memo(function ReportCard({ r, c, firestoreDB, onOpenProfile, onCopy, onView, onToggleDone, onDelete, onRemoveReview }) {
  const done = r.status === 'done';
  return (
    <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border, opacity: done ? 0.75 : 1 }]}>
      <Sender r={r} c={c} onOpenProfile={onOpenProfile} onCopy={onCopy} />
      <View style={styles.chips}>
        {r.type === 'complaint' ? (
          <View style={[styles.chip, { backgroundColor: 'rgba(220,38,38,0.12)' }]}>
            <Text style={[styles.chipText, { color: DANGER }]}>{CATEGORY_LABEL[r.category] || 'Complaint'}</Text>
          </View>
        ) : null}
        <View style={[styles.chip, { backgroundColor: done ? 'rgba(22,163,74,0.14)' : 'rgba(124,58,237,0.12)' }]}>
          <Text style={[styles.chipText, { color: done ? DONE : ACCENT }]}>{done ? 'Done' : 'Open'}</Text>
        </View>
      </View>
      <Text style={[styles.body, { color: c.text }]} selectable>{r.text}</Text>
      {r.reviewId ? <ReportedReview r={r} c={c} firestoreDB={firestoreDB} onRemove={onRemoveReview} /> : null}
      {r.images?.length ? (
        <View style={styles.thumbs}>
          {r.images.map((u) => (
            <TouchableOpacity key={u} onPress={() => onView(u)} activeOpacity={0.85}>
              <Image resizeMethod="resize" source={{ uri: u }} style={styles.thumb} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {r.app ? <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 8 }}>App: {r.app}</Text> : null}
      <View style={styles.actions}>
        <TouchableOpacity onPress={() => onToggleDone(r)} style={[styles.btn, { backgroundColor: done ? c.bg : DONE, borderColor: done ? c.border : DONE }]}>
          <Icon name={done ? 'refresh' : 'checkmark'} size={15} color={done ? c.text : '#FFF'} />
          <Text style={[styles.btnText, { color: done ? c.text : '#FFF' }]}>{done ? 'Reopen' : 'Mark done'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onDelete(r, false)} style={[styles.btn, { borderColor: 'rgba(220,38,38,0.4)' }]}>
          <Icon name="trash-outline" size={15} color={DANGER} />
          <Text style={[styles.btnText, { color: DANGER }]}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

const LegacyCard = React.memo(function LegacyCard({ r, c, onOpenProfile, onCopy, onDelete }) {
  return (
    <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
      <Sender r={r} c={c} onOpenProfile={onOpenProfile} onCopy={onCopy} />
      <View style={styles.chips}>
        <View style={[styles.chip, { backgroundColor: c.bg }]}>
          <Text style={[styles.chipText, { color: c.textSecondary }]}>{r.type === 'quick_suggestion' ? 'Quick suggestion' : 'Feedback'}</Text>
        </View>
      </View>
      <Text style={[styles.body, { color: c.text }]} selectable>{r.text}</Text>
      <View style={styles.actions}>
        <TouchableOpacity onPress={() => onDelete(r, true)} style={[styles.btn, { borderColor: 'rgba(220,38,38,0.4)' }]}>
          <Icon name="trash-outline" size={15} color={DANGER} />
          <Text style={[styles.btnText, { color: DANGER }]}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

const AdminReportsInbox = () => {
  const { appdatabase, firestoreDB, theme, isAdmin, isSeniorMod, isModerator, isBabyMod, user } = useGlobalState();
  const c = getThemeColors(theme === 'dark');
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [segment, setSegment] = useState('complaint');
  const [statusFilter, setStatusFilter] = useState('open');
  const [reports, setReports] = useState(null);
  const [reportsEnd, setReportsEnd] = useState(false);
  const [legacy, setLegacy] = useState(null);
  const [legacyEnd, setLegacyEnd] = useState(false);
  const [legacyCursor, setLegacyCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [profile, setProfile] = useState(null);

  const loadReports = useCallback(async () => {
    try {
      const page = await fetchReportsPage(appdatabase, PAGE);
      setReports(page);
      setReportsEnd(page.length < PAGE);
    } catch (e) {
      setReports((r) => r || []);
      showErrorMessage('Could not load reports', e?.message);
    }
  }, [appdatabase]);

  const loadLegacy = useCallback(async () => {
    try {
      const page = await fetchLegacyFeedbackPage(appdatabase, PAGE);
      setLegacy(page.rows);
      setLegacyCursor(page.cursor);
      setLegacyEnd(page.end);
    } catch (e) {
      setLegacy((r) => r || []);
      showErrorMessage('Could not load old feedback', e?.message);
    }
  }, [appdatabase]);

  useEffect(() => { if (appdatabase) loadReports(); }, [appdatabase, loadReports]);
  useEffect(() => { if (appdatabase && segment === 'legacy' && legacy === null) loadLegacy(); }, [appdatabase, segment, legacy, loadLegacy]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await (segment === 'legacy' ? loadLegacy() : loadReports());
    setRefreshing(false);
  }, [segment, loadLegacy, loadReports]);

  const loadOlder = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      if (segment === 'legacy') {
        const page = await fetchLegacyFeedbackPage(appdatabase, PAGE, legacyCursor);
        setLegacy(mergeById(legacy || [], page.rows));
        setLegacyCursor(page.cursor);
        setLegacyEnd(page.end || page.cursor === legacyCursor);
      } else {
        const oldest = reports?.[reports.length - 1]?.createdAt;
        const page = await fetchReportsPage(appdatabase, PAGE, oldest ?? null);
        setReports(mergeById(reports || [], page));
        setReportsEnd(page.length < PAGE + 1);
      }
    } catch (e) {
      showErrorMessage('Could not load more', e?.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const counts = useMemo(() => {
    const out = { complaint: 0, suggestion: 0 };
    (reports || []).forEach((r) => { if (r.status !== 'done' && out[r.type] != null) out[r.type] += 1; });
    return out;
  }, [reports]);

  const rows = useMemo(() => {
    if (segment === 'legacy') return legacy || [];
    return (reports || []).filter((r) => r.type === segment && (statusFilter === 'all' || (statusFilter === 'done' ? r.status === 'done' : r.status !== 'done')));
  }, [segment, statusFilter, reports, legacy]);

  const copy = useCallback((value) => {
    Clipboard.setString(String(value));
    showSuccessMessage('User ID copied', String(value));
  }, []);

  const openProfile = useCallback((r) => {
    if (!r.userId || r.userId === 'anonymous') return;
    setProfile({ senderId: r.userId, sender: r.userName || 'Player', avatar: r.avatar || null });
  }, []);

  const closeProfile = useCallback(() => setProfile(null), []);

  const startChat = () => {
    const p = profile;
    setProfile(null);
    if (!p) return;
    setTimeout(() => {
      try {
        navigation.navigate('PrivateChatRoot', { selectedUser: { senderId: p.senderId, sender: p.sender, avatar: p.avatar } });
      } catch (e) { /* not reachable from here */ }
    }, 300);
  };

  const toggleDone = useCallback(async (r) => {
    const next = r.status === 'done' ? 'open' : 'done';
    setReports((list) => list.map((x) => (x.id === r.id ? { ...x, status: next } : x)));
    try {
      await setReportStatus(appdatabase, r.id, next);
    } catch (e) {
      setReports((list) => list.map((x) => (x.id === r.id ? { ...x, status: r.status } : x)));
      showErrorMessage('Not saved', e?.message);
    }
  }, [appdatabase]);

  const confirmDelete = useCallback((r, isLegacy) => {
    Alert.alert('Delete this?', 'It is removed for good.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            if (isLegacy) {
              await deleteLegacyFeedback(appdatabase, r.id);
              setLegacy((l) => l.filter((x) => x.id !== r.id));
            } else {
              await deleteReport(appdatabase, r.id);
              setReports((l) => l.filter((x) => x.id !== r.id));
            }
          } catch (e) {
            showErrorMessage('Not deleted', e?.message);
          }
        },
      },
    ]);
  }, [appdatabase]);

  // Same rule as the Admin Dashboard: staff may only remove a review left by
  // someone strictly below them (fresh RTDB roles).
  const removeReview = useCallback(async (r, review) => {
    const callerRoles = { isAdmin: !!isAdmin, isSeniorMod: !!isSeniorMod, isModerator: !!isModerator, isBabyMod: !!isBabyMod, isOwner: isCurrentUserOwner() };
    if (!(await canRemoveReview(review.fromUserId, callerRoles, user?.id))) {
      Alert.alert('Restricted', 'Only admins can delete reviews, and not reviews left by staff at or above your rank.');
      return;
    }
    Alert.alert('Remove review', `Remove this ${Number(review.rating) || 0}-star review${review.userName ? ` by ${review.userName}` : ''}? Their rating is recounted and the report is marked done.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteReviewAndSummary(firestoreDB, { id: review.id, toUserId: review.toUserId || r.reviewedUserId, rating: review.rating });
          } catch (e) {
            showErrorMessage('Could not remove the review', e?.message);
            return;
          }
          logModAction('review_delete', review.toUserId || r.reviewedUserId, {
            reviewId: review.id,
            reviewerUid: review.fromUserId || null,
            rating: Number(review.rating) || 0,
            reportId: r.id,
          });
          setReports((list) => list.map((x) => (x.id === r.id ? { ...x, status: 'done', reviewRemoved: true } : x)));
          setReportStatus(appdatabase, r.id, 'done').catch(() => {});
          showSuccessMessage('Review removed', 'The rating has been recounted.');
        },
      },
    ]);
  }, [appdatabase, firestoreDB, isAdmin, isSeniorMod, isModerator, isBabyMod, user?.id]);

  const renderReport = useCallback(({ item }) => (
    <ReportCard r={item} c={c} firestoreDB={firestoreDB} onOpenProfile={openProfile} onCopy={copy} onView={setViewer} onToggleDone={toggleDone} onDelete={confirmDelete} onRemoveReview={canDeleteReviews({ isAdmin: !!isAdmin, isSeniorMod: !!isSeniorMod, isModerator: !!isModerator, isBabyMod: !!isBabyMod, isOwner: isCurrentUserOwner() }) ? removeReview : undefined} />
  ), [c, firestoreDB, openProfile, copy, toggleDone, confirmDelete, removeReview, isAdmin, isSeniorMod, isModerator, isBabyMod]);

  const renderLegacy = useCallback(({ item }) => (
    <LegacyCard r={item} c={c} onOpenProfile={openProfile} onCopy={copy} onDelete={confirmDelete} />
  ), [c, openProfile, copy, confirmDelete]);

  const loaded = segment === 'legacy' ? legacy : reports;
  const atEnd = segment === 'legacy' ? legacyEnd : reportsEnd;

  return (
    <View style={styles.flex1}>
      <View style={[styles.segment, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
        {SEGMENTS.map((s) => {
          const on = segment === s.key;
          const n = counts[s.key];
          return (
            <TouchableOpacity key={s.key} onPress={() => setSegment(s.key)} style={[styles.segBtn, on && { backgroundColor: ACCENT }]}>
              <Text style={[styles.segText, { color: on ? '#FFF' : c.textSecondary }]}>
                {s.label}{n ? ` (${n})` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {segment !== 'legacy' ? (
        <View style={styles.filters}>
          {['open', 'done', 'all'].map((f) => (
            <TouchableOpacity key={f} onPress={() => setStatusFilter(f)} style={[styles.filter, { borderColor: statusFilter === f ? ACCENT : c.border, backgroundColor: statusFilter === f ? 'rgba(124,58,237,0.12)' : 'transparent' }]}>
              <Text style={{ color: statusFilter === f ? ACCENT : c.textSecondary, fontSize: 12, fontWeight: '800' }}>
                {f === 'open' ? 'Open' : f === 'done' ? 'Done' : 'All'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {loaded === null ? (
        <ActivityIndicator color={ACCENT} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={segment === 'legacy' ? renderLegacy : renderReport}
          removeClippedSubviews={false}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
          ListEmptyComponent={
            <Text style={{ color: c.textMuted, textAlign: 'center', marginTop: 40 }}>
              {segment === 'legacy' ? 'No old feedback.' : statusFilter === 'open' ? 'Nothing open. All caught up.' : 'Nothing here yet.'}
            </Text>
          }
          ListFooterComponent={
            loaded.length && !atEnd ? (
              <TouchableOpacity onPress={loadOlder} disabled={loadingMore} style={[styles.more, { borderColor: c.border }]}>
                {loadingMore ? <ActivityIndicator color={ACCENT} /> : <Text style={{ color: ACCENT, fontWeight: '800' }}>Load older</Text>}
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={[styles.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <TouchableOpacity onPress={() => setViewer(null)} style={[styles.viewerClose, { top: insets.top + 10 }]} hitSlop={12}>
            <Icon name="close" size={28} color="#FFF" />
          </TouchableOpacity>
          {viewer ? <Image resizeMethod="resize" source={{ uri: viewer }} style={styles.flex1} resizeMode="contain" /> : null}
        </View>
      </Modal>

      {/* Mounted only while open: it is a ~3,200-line component. */}
      {profile ? (
        <ProfileBottomDrawer
          isVisible
          toggleModal={closeProfile}
          startChat={startChat}
          selectedUser={profile}
          isOnline={false}
          bannedUsers={NO_BANNED_USERS}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  segment: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 3, marginTop: 10 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9 },
  segText: { fontSize: 12.5, fontWeight: '800' },
  filters: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 4 },
  filter: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 10 },
  senderRow: { flexDirection: 'row', alignItems: 'center' },
  sender: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  name: { fontSize: 14, fontWeight: '800' },
  idPill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginLeft: 8, maxWidth: 110 },
  chips: { flexDirection: 'row', gap: 6, marginTop: 10 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { fontSize: 11, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  thumbs: { flexDirection: 'row', gap: 8, marginTop: 10 },
  thumb: { width: 84, height: 84, borderRadius: 10, backgroundColor: '#0002' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, height: 34 },
  btnText: { fontSize: 13, fontWeight: '800' },
  reviewBox: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 10 },
  removeBtn: { alignSelf: 'flex-start', marginTop: 10, backgroundColor: DANGER, borderColor: DANGER },
  reviewMeta: { fontSize: 12 },
  reviewStars: { color: '#F59E0B' },
  reviewBody: { marginTop: 4 },
  white: { color: '#FFF' },
  more: { alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingVertical: 12, marginTop: 12 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  viewerClose: { position: 'absolute', right: 18, zIndex: 2 },
});

export default AdminReportsInbox;
