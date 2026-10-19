// Admin Dashboard → "Mod Log" tab (2026-10).
//
// Read view of the moderation audit log (supabase/031_mod_actions.sql), which
// Cloud Functions write for every ban, strike, mute and unban from any app
// build, plus automatic bans of alt accounts (functions/banEnforcement.js).
//   Recent      — newest actions, filterable by action, 7 or 30 days
//   Moderators  — per-mod totals for the same window
// Tapping a row copies the target's user ID; screenshot thumbnails open the
// evidence viewer. Also lists non-sanction staff actions (message deletes,
// pins, role changes, review/profile deletes) logged via logModAction.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { fetchRecentModActions, fetchModLeaderboard } from '../Supabase/modLogBackend';
import { showSuccessMessage } from '../Helper/MessageHelper';
import { describeModAction, actionOf, MOD_ACTION_COLOR, evidenceOf, EvidenceThumbs } from './ModHistoryList';
import EvidenceViewer from './EvidenceViewer';

dayjs.extend(relativeTime);

const SOURCE_LABEL = {
  app: '', uid: 'by user ID', linked: 'linked account', device: 'same device', email: 're-registered email', email_hash: 're-registered email',
};
const ACTION_FILTERS = [null, 'strike', 'mute', 'unban', 'unmute', 'message_delete', 'post_delete', 'perm_confirm', 'perm_reject', 'role_change'];
const FILTER_LABEL = { message_delete: 'Deletes', post_delete: 'Post deletes', perm_confirm: 'Perm confirmed', perm_reject: 'Perm rejected', role_change: 'Roles' };
const PAGE = 30;

const Pill = ({ label, active, onPress, isDark }) => (
  <TouchableOpacity
    onPress={onPress}
    style={{
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginRight: 8,
      backgroundColor: active ? '#007AFF' : (isDark ? '#2C2C2E' : '#E5E5EA'),
    }}
  >
    <Text style={{ fontSize: 12, fontWeight: '700', color: active ? '#FFF' : (isDark ? '#CCC' : '#333') }}>{label}</Text>
  </TouchableOpacity>
);

const ModLogTab = ({ isDark }) => {
  const [view, setView] = useState('recent'); // 'recent' | 'mods'
  const [days, setDays] = useState(7);
  const [action, setAction] = useState(null);
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [mods, setMods] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [viewer, setViewer] = useState(null); // { urls, index }

  const text = isDark ? '#FFF' : '#000';
  const sub = isDark ? '#999' : '#666';
  const card = isDark ? '#1C1C1E' : '#FFF';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (view === 'recent') {
        const r = await fetchRecentModActions({ action, days, limit: PAGE });
        setItems(r.items);
        setCursor(r.cursor);
        setHasMore(r.hasMore);
        setSchemaMissing(r.schemaMissing);
      } else {
        const r = await fetchModLeaderboard({ days, limit: 50 });
        setMods(r.rows);
        setSchemaMissing(r.schemaMissing);
      }
    } finally {
      setLoading(false);
    }
  }, [view, action, days]);

  useEffect(() => { load(); }, [load]);

  const loadMore = useCallback(async () => {
    if (view !== 'recent' || !hasMore || loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const r = await fetchRecentModActions({ action, days, cursor, limit: PAGE });
      setItems((prev) => [...prev, ...r.items.filter((x) => !prev.some((p) => p.id === x.id))]);
      setCursor(r.cursor);
      setHasMore(r.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [view, hasMore, loadingMore, cursor, action, days]);

  const copyUid = (uid) => {
    if (!uid) return;
    Clipboard.setString(uid);
    showSuccessMessage('Copied', 'User ID copied');
  };

  const renderAction = ({ item: a }) => (
    <TouchableOpacity
      onPress={() => copyUid(a.targetUid)}
      activeOpacity={0.8}
      style={{ backgroundColor: card, borderRadius: 12, padding: 12, marginHorizontal: 12, marginBottom: 8 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: MOD_ACTION_COLOR[actionOf(a)] || text, fontWeight: '800', fontSize: 13 }}>{describeModAction(a)}</Text>
        <Text style={{ color: sub, fontSize: 11 }}>{a.createdAt ? dayjs(a.createdAt).fromNow() : ''}</Text>
      </View>
      <Text style={{ color: text, fontSize: 14, fontWeight: '600', marginTop: 4 }} numberOfLines={1}>
        {a.targetName || a.targetEmail || 'Unknown user'}
      </Text>
      {!!a.targetUid && <Text style={{ color: sub, fontSize: 10, fontFamily: 'monospace' }} numberOfLines={1}>{a.targetUid}</Text>}
      {!!a.reason && <Text style={{ color: sub, fontSize: 12, marginTop: 4 }} numberOfLines={2}>{a.reason}</Text>}
      <Text style={{ color: sub, fontSize: 11, marginTop: 4 }}>
        {a.actorUid ? `by ${a.actorName || a.actorUid}${a.actorRole ? ` (${a.actorRole.replace('_', ' ')})` : ''}` : 'automatic'}
        {SOURCE_LABEL[a.source] ? ` · ${SOURCE_LABEL[a.source]}` : ''}
      </Text>
      <EvidenceThumbs urls={evidenceOf(a)} onOpen={(index) => setViewer({ urls: evidenceOf(a), index })} />
    </TouchableOpacity>
  );

  const renderMod = ({ item: m, index }) => (
    <TouchableOpacity
      onPress={() => { setAction(null); setView('recent'); }}
      activeOpacity={0.8}
      style={{ backgroundColor: card, borderRadius: 12, padding: 12, marginHorizontal: 12, marginBottom: 8 }}
    >
      <Text style={{ color: text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>
        {index + 1}. {m.actorName}{m.actorRole ? `  ·  ${m.actorRole.replace('_', ' ')}` : ''}
      </Text>
      <Text style={{ color: sub, fontSize: 12, marginTop: 4 }}>
        {m.totalCount} actions on {m.distinctTargets} users · {m.strikeCount} strikes · {m.muteCount} mutes · {m.unbanCount} unbans
      </Text>
      {!!m.lastActionAt && <Text style={{ color: sub, fontSize: 11, marginTop: 2 }}>last {dayjs(m.lastActionAt).fromNow()}</Text>}
    </TouchableOpacity>
  );

  const empty = (
    <View style={{ padding: 32, alignItems: 'center' }}>
      {loading
        ? <ActivityIndicator />
        : <Text style={{ color: sub, textAlign: 'center' }}>
            {schemaMissing
              ? 'The mod log is not set up yet (supabase/031_mod_actions.sql has not been run).'
              : `No moderation in the last ${days} days.`}
          </Text>}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8 }}>
        <Pill label="Recent" active={view === 'recent'} onPress={() => setView('recent')} isDark={isDark} />
        <Pill label="Moderators" active={view === 'mods'} onPress={() => setView('mods')} isDark={isDark} />
        <View style={{ flex: 1 }} />
        <Pill label="7d" active={days === 7} onPress={() => setDays(7)} isDark={isDark} />
        <Pill label="30d" active={days === 30} onPress={() => setDays(30)} isDark={isDark} />
      </View>
      {view === 'recent' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }}>
          {ACTION_FILTERS.map((f) => (
            <Pill key={f || 'all'} label={f ? (FILTER_LABEL[f] || f[0].toUpperCase() + f.slice(1)) : 'All'} active={action === f} onPress={() => setAction(f)} isDark={isDark} />
          ))}
        </ScrollView>
      )}
      {view === 'recent' ? (
        <FlatList
          data={items}
          keyExtractor={(a) => a.id}
          renderItem={renderAction}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={empty}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: 12 }} /> : null}
          refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={load} />}
        />
      ) : (
        <FlatList
          data={mods}
          keyExtractor={(m) => m.actorUid}
          renderItem={renderMod}
          ListEmptyComponent={empty}
          refreshControl={<RefreshControl refreshing={loading && mods.length > 0} onRefresh={load} />}
        />
      )}
      <EvidenceViewer
        visible={!!viewer}
        urls={viewer?.urls || []}
        startIndex={viewer?.index || 0}
        onClose={() => setViewer(null)}
      />
    </View>
  );
};

export default ModLogTab;
