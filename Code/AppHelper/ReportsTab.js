// Admin Dashboard → "Reports" tab: one review queue for every report source
// (contract §9). All staff who can open the dashboard see it — except
// reports about a Senior Mod or an Admin, which only Admins and the owner see
// (2026-10-19; Admin counts as owner level). The server decides: Firestore
// `audience` (functions/reportAudience.js + firestore.rules) and Supabase
// list_message_reports (supabase/046). This tab just asks for its own tier.
//
//   Firestore user_reports   trade / post / status / scam / user reports
//                            written by current builds (status 'open')
//   Firestore chat_reports   private-chat reports with chat consent
//                            (Scamwarning.js) — "View chat" opens them in the
//                            Chat Viewer
//   RTDB tradeReports        trade reports from older builds
//   Supabase message reports public / group / private chat messages
//                            (fetchMessageReports, supabase/034); "Hide"
//                            is session-only — no reviewed flag server-side
//
// Actions: View reported / View reporter (profile drawer, so a mod can hear
// both sides), Sanction (dashboard user detail, which has
// strike / mute / ban with the reason prompt), Dismiss (marks it reviewed).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Alert,
} from 'react-native';
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
  query as firestoreQuery,
  where,
  orderBy,
  limit,
  updateDoc,
  serverTimestamp,
} from '@react-native-firebase/firestore';
import { getDatabase, ref, get, update, query, limitToLast } from '@react-native-firebase/database';
import { getAuth } from '@react-native-firebase/auth';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import * as chatBackend from '../Supabase/chatBackend';
import { getIdentityBatch } from '../Supabase/userBackend';
import { useGlobalState } from '../GlobelStats';
import { getCurrentUserOwner } from '../Helper/ownerFlag';

dayjs.extend(relativeTime);

const PAGE = 50;

const SOURCE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'trade', label: 'Trades' },
  { key: 'post', label: 'Posts' },
  { key: 'chat', label: 'Private chats' },
  { key: 'message', label: 'Messages' },
  { key: 'user', label: 'Users / scam' },
];

const KIND_LABEL = {
  trade: 'Trade', post: 'Feed post', status: 'Status', scam: 'Scam report', user: 'User',
  chat: 'Private chat', message: 'Chat message',
};

const toMs = (v) => {
  if (!v) return 0;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v === 'number') return v;
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
};

// Supabase rows (Code/Supabase/messageReports.js fetchMessageReports): one
// item per reported message with its individual reports.
const TABLE_LABEL = { messages: 'Public chat', private_messages: 'Private chat', group_messages: 'Group chat' };
const normalizeMessageReport = (r) => {
  const reports = Array.isArray(r.reports) ? r.reports : [];
  // 'legacy_client' = a report from an app build that couldn't send a reason.
  const reasons = [...new Set(reports.map((x) => (x?.reason === 'legacy_client' ? 'No reason given (older app)' : x?.reason)).filter(Boolean))];
  return {
    key: `msg:${r.table}:${r.messageId}`,
    source: 'message',
    kind: 'message',
    id: r.messageId,
    targetUid: r.senderUid || null,
    reporterUid: reports.length === 1 ? reports[0]?.reporterUid || null : null,
    reason: reasons.length ? reasons.slice(0, 3).join(' · ') : null,
    text: r.text || (r.imageUrl ? '[image]' : r.gif ? '[gif]' : null),
    extra: `${TABLE_LABEL[r.table] || r.table || ''}${r.locationId ? ` · ${r.locationId}` : ''}${r.deleted ? ' · message deleted' : ''}`,
    count: r.reportCount || r.reportsRecorded || null,
    createdAt: toMs(r.lastReportedAt),
    status: 'open',
    raw: r,
  };
};

// Firestore report lists by tier. Admins and the owner read every report;
// rules refuse lower staff an unfiltered list, so they ask for 'staff' only.
const reportsQuery = (fdb, col, tier, n) => {
  const base = collection(fdb, col);
  if (tier === 'admin') return firestoreQuery(base, orderBy('createdAt', 'desc'), limit(n));
  return firestoreQuery(base, where('audience', '==', 'staff'), orderBy('createdAt', 'desc'), limit(n));
};
// If this device thinks it ranks higher than the server does (a stale flag),
// fall back to the staff list instead of showing nothing.
const getReports = async (fdb, col, tier, n) => {
  try {
    return await getDocs(reportsQuery(fdb, col, tier, n));
  } catch (e) {
    if (tier === 'admin' && /permission/i.test(`${e?.code || ''} ${e?.message || ''}`)) {
      return getDocs(reportsQuery(fdb, col, 'staff', n));
    }
    throw e;
  }
};

const ReportsTab = ({ isDark, onViewUser, onSanctionUser, onViewChat }) => {
  const { isAdmin } = useGlobalState();
  const tier = isAdmin || getCurrentUserOwner(getAuth().currentUser?.uid) ? 'admin' : 'staff';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [showReviewed, setShowReviewed] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const [busyKey, setBusyKey] = useState(null);

  const text = isDark ? '#FFF' : '#000';
  const sub = isDark ? '#999' : '#666';
  const card = isDark ? '#1C1C1E' : '#FFF';
  const border = isDark ? '#2C2C2E' : '#E5E5EA';

  const load = useCallback(async () => {
    setLoading(true);
    const fdb = getFirestore();
    const rdb = getDatabase();
    const warn = [];
    const out = [];

    // Staff: audience + createdAt (composite index); status is filtered here.
    const userReports = getReports(fdb, 'user_reports', tier, PAGE)
      .then((snap) => snap.docs.forEach((d) => {
        const r = d.data() || {};
        out.push({
          key: `ur:${d.id}`, source: 'user_reports', kind: r.type || 'user', id: d.id,
          targetUid: r.targetUid || null, targetId: r.targetId || null, reporterUid: r.reporterUid || null,
          reason: r.reason || null, text: r.text || null, status: r.status || 'open', createdAt: toMs(r.createdAt),
        });
      }))
      .catch((e) => warn.push(`User reports: ${e?.message || 'failed'}`));

    const chatReports = getReports(fdb, 'chat_reports', tier, 30)
      .then((snap) => snap.docs.forEach((d) => {
        const r = d.data() || {};
        if (r.chatConsent !== true) return;
        out.push({
          key: `cr:${d.id}`, source: 'chat_reports', kind: 'chat', id: d.id,
          targetUid: r.reportedUser || null, targetName: r.reportedUserName || null,
          reporterUid: r.reportedBy || null, reporterName: r.reporterName || null,
          reason: r.reason || null, status: r.status || 'open', createdAt: toMs(r.createdAt), raw: { id: d.id, ...r },
        });
      }))
      .catch((e) => warn.push(`Chat reports: ${e?.message || 'failed'}`));

    // Push keys sort chronologically, so the key order needs no index.
    const tradeReports = get(query(ref(rdb, 'tradeReports'), limitToLast(PAGE)))
      .then((snap) => {
        snap.forEach((child) => {
          const r = child.val() || {};
          out.push({
            key: `tr:${child.key}`, source: 'tradeReports', kind: 'trade', id: child.key,
            targetUid: r.targetUid || null, targetId: r.tradeId || null, reporterUid: r.reportedBy || null,
            reason: r.reason || null, status: r.status || 'open', createdAt: toMs(r.timestamp),
          });
          return undefined;
        });
      })
      .catch((e) => warn.push(`Old trade reports: ${e?.message || 'failed'}`));

    // Never throws; schemaMissing = supabase 034 not applied yet.
    const fetchMessageReports = chatBackend.fetchMessageReports;
    const messageReports = typeof fetchMessageReports === 'function'
      ? Promise.resolve(fetchMessageReports({ limit: PAGE }))
        .then((res) => {
          if (res?.schemaMissing) warn.push('Chat-message reports: not set up on the server yet.');
          (Array.isArray(res) ? res : res?.items || []).forEach((r) => out.push(normalizeMessageReport(r)));
        })
        .catch((e) => warn.push(`Chat-message reports: ${e?.message || 'failed'}`))
      : Promise.resolve(warn.push('Chat-message reports: not available in this build.'));

    await Promise.all([userReports, chatReports, tradeReports, messageReports]);
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // Chat-message and user reports carry only uids: look the names up so
    // cards read "Against: Name" instead of a raw uid. Best effort.
    const missing = new Set();
    out.forEach((x) => {
      if (x.targetUid && !x.targetName) missing.add(x.targetUid);
      if (x.reporterUid && !x.reporterName) missing.add(x.reporterUid);
    });
    if (missing.size > 0) {
      try {
        const ids = await getIdentityBatch([...missing]);
        out.forEach((x) => {
          if (x.targetUid && !x.targetName) x.targetName = ids.get(x.targetUid)?.displayName || null;
          if (x.reporterUid && !x.reporterName) x.reporterName = ids.get(x.reporterUid)?.displayName || null;
        });
      } catch (_) { /* uids still show */ }
    }
    setItems(out);
    setWarnings(warn);
    setLoading(false);
  }, [tier]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => items.filter((r) => {
    if (!showReviewed && r.status === 'reviewed') return false;
    if (filter === 'all') return true;
    if (filter === 'user') return ['user', 'scam', 'status'].includes(r.kind);
    return r.kind === filter;
  }), [items, filter, showReviewed]);

  // Trade reports from old builds carry only the trade id.
  const resolveTarget = useCallback(async (r) => {
    if (r.targetUid) return r.targetUid;
    if (r.kind === 'trade' && r.targetId) {
      try {
        const snap = await getDoc(doc(getFirestore(), 'trades_new_upgrade', r.targetId));
        const uid = snap.exists() ? snap.data()?.userId : null;
        if (uid) {
          setItems((prev) => prev.map((x) => (x.key === r.key ? { ...x, targetUid: uid } : x)));
          return uid;
        }
      } catch (_) { /* fall through */ }
    }
    Alert.alert('Not found', 'The reported user could not be found (the trade or account may be deleted).');
    return null;
  }, []);

  const dismiss = useCallback(async (r) => {
    setBusyKey(r.key);
    const me = getAuth().currentUser?.uid || null;
    try {
      if (r.source === 'user_reports') {
        await updateDoc(doc(getFirestore(), 'user_reports', r.id), { status: 'reviewed', reviewedBy: me, reviewedAt: serverTimestamp() });
      } else if (r.source === 'chat_reports') {
        await updateDoc(doc(getFirestore(), 'chat_reports', r.id), { status: 'reviewed' });
      } else if (r.source === 'tradeReports') {
        await update(ref(getDatabase(), `tradeReports/${r.id}`), { status: 'reviewed', reviewedBy: me, reviewedAt: Date.now() });
      } else if (r.source === 'message') {
        // No server-side "reviewed" flag for message reports yet: hide it
        // for this session only.
      }
      setItems((prev) => prev.map((x) => (x.key === r.key ? { ...x, status: 'reviewed' } : x)));
    } catch (e) {
      Alert.alert('Could not dismiss', e?.message || 'Try again.');
    } finally {
      setBusyKey(null);
    }
  }, []);

  const openUser = useCallback(async (r, sanction) => {
    const uid = await resolveTarget(r);
    if (!uid) return;
    const target = { id: uid, senderId: uid, displayName: r.targetName || null, sender: r.targetName || null };
    if (sanction) onSanctionUser?.(target);
    else onViewUser?.(target);
  }, [resolveTarget, onSanctionUser, onViewUser]);

  const openReporter = useCallback((r) => {
    if (!r.reporterUid) return;
    onViewUser?.({ id: r.reporterUid, senderId: r.reporterUid, displayName: r.reporterName || null, sender: r.reporterName || null });
  }, [onViewUser]);

  const Btn = ({ label, color, onPress, disabled }) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: `${color}20`, marginRight: 8, opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </TouchableOpacity>
  );

  const renderItem = ({ item: r }) => {
    const reviewed = r.status === 'reviewed';
    return (
      <View style={{
        backgroundColor: card, borderRadius: 12, padding: 12, marginHorizontal: 12, marginBottom: 8,
        borderWidth: 1, borderColor: reviewed ? border : (isDark ? 'rgba(255,59,48,0.3)' : 'rgba(255,59,48,0.2)'),
        opacity: reviewed ? 0.6 : 1,
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: reviewed ? sub : '#FF3B30', fontWeight: '800', fontSize: 12 }}>
            {KIND_LABEL[r.kind] || r.kind}{r.count > 1 ? ` · ${r.count} reports` : ''}
          </Text>
          <Text style={{ color: sub, fontSize: 11 }}>{r.createdAt ? dayjs(r.createdAt).fromNow() : ''}</Text>
        </View>
        {!!r.reason && <Text style={{ color: text, fontSize: 13, fontWeight: '600', marginTop: 4 }}>{r.reason}</Text>}
        {!!r.text && <Text style={{ color: sub, fontSize: 12, marginTop: 2 }} numberOfLines={3}>{r.text}</Text>}
        <Text style={{ color: sub, fontSize: 11, marginTop: 4 }} numberOfLines={1}>
          Against: {r.targetName || r.targetUid || (r.targetId ? `${KIND_LABEL[r.kind] || 'item'} ${r.targetId}` : 'unknown')}
        </Text>
        {!!(r.reporterName || r.reporterUid) && (
          <Text style={{ color: sub, fontSize: 11 }} numberOfLines={1}>By: {r.reporterName || r.reporterUid}</Text>
        )}
        {!!r.extra && <Text style={{ color: sub, fontSize: 10 }} numberOfLines={1}>{r.extra}</Text>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
          {r.kind === 'chat' && onViewChat && <Btn label="View chat" color="#5856D6" onPress={() => onViewChat(r.raw)} />}
          <Btn label="View reported" color="#007AFF" onPress={() => openUser(r, false)} />
          {!!r.reporterUid && <Btn label="View reporter" color="#0A84FF" onPress={() => openReporter(r)} />}
          <Btn label="Sanction" color="#FF3B30" onPress={() => openUser(r, true)} />
          {!reviewed && (
            <Btn
              label={busyKey === r.key ? '…' : r.source === 'message' ? 'Hide' : 'Dismiss'}
              color="#34C759"
              disabled={busyKey === r.key}
              onPress={() => dismiss(r)}
            />
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }}>
        {SOURCE_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={{
              paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginRight: 8,
              backgroundColor: filter === f.key ? '#007AFF' : (isDark ? '#2C2C2E' : '#E5E5EA'),
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: filter === f.key ? '#FFF' : (isDark ? '#CCC' : '#333') }}>{f.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          onPress={() => setShowReviewed((v) => !v)}
          style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: showReviewed ? '#34C759' : (isDark ? '#2C2C2E' : '#E5E5EA') }}
        >
          <Text style={{ fontSize: 12, fontWeight: '700', color: showReviewed ? '#FFF' : (isDark ? '#CCC' : '#333') }}>
            {showReviewed ? 'Showing reviewed' : 'Open only'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
      {warnings.length > 0 && (
        <Text style={{ color: sub, fontSize: 10, paddingHorizontal: 12, marginBottom: 6 }}>{warnings.join('  ·  ')}</Text>
      )}
      <FlatList
        data={visible}
        keyExtractor={(r) => r.key}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={load} />}
        ListEmptyComponent={
          loading
            ? <ActivityIndicator style={{ marginTop: 30 }} />
            : <Text style={{ color: sub, textAlign: 'center', marginTop: 30 }}>No open reports.</Text>
        }
      />
    </View>
  );
};

export default ReportsTab;
