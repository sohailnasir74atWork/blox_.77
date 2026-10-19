// Admin Dashboard → Reports ▸ "Perm-ban requests" (Admins and the owner).
//
// Permanent bans need an Admin (owner decision 2026-10-19). A Senior Mod's or
// Mod's 3rd strike is a 30-day ban that waits here, oldest first
// (functions/banEnforcement.js, modSanction 'perm_requests'):
//   Confirm → permanent: devices, Auth account and the linked accounts banned
//             with it. Only an Admin can lift it afterwards.
//   Reject  → stays the 30-day ban.
// Requests whose ban was lifted or ran out drop off by themselves. An
// email-only strike (old builds, no account yet) is listed by its email.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { fetchPermRequests, decidePermRequest, sanctionErrorText, PENDING_PERM_DAYS } from '../Helper/modSanction';
import { showSuccessMessage } from '../Helper/MessageHelper';
import { EvidenceThumbs } from './ModHistoryList';
import EvidenceViewer from './EvidenceViewer';
import ModActionModal from './ModActionModal';

dayjs.extend(relativeTime);

const ROLE_LABEL = { senior_mod: 'Sr Mod', moderator: 'Mod', baby_mod: 'JMD', admin: 'Admin' };

const PermBanRequestsTab = ({ isDark, onOpenUser }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [decision, setDecision] = useState(null); // { kind: 'confirm' | 'reject', item }
  const [viewer, setViewer] = useState(null); // { urls, index }

  const text = isDark ? '#FFF' : '#000';
  const sub = isDark ? '#999' : '#666';
  const card = isDark ? '#1C1C1E' : '#FFF';

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchPermRequests();
    setLoading(false);
    if (!r.ok) {
      setError(sanctionErrorText(r.error));
      return;
    }
    setError(null);
    setItems(Array.isArray(r.requests) ? r.requests : []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const nameOf = (item) => item?.targetName || item?.uid || item?.email || 'this user';
  const keyOf = (item) => item?.key || item?.uid;

  const confirmDecision = async ({ reason }) => {
    const d = decision;
    if (!d) return true;
    const r = await decidePermRequest(d.item, d.kind, reason);
    if (!r.ok) {
      Alert.alert('Error', sanctionErrorText(r.error));
      if (r.error !== 'not_pending') return false; // keep the prompt open
      load();
      return true;
    }
    setItems((prev) => prev.filter((x) => keyOf(x) !== keyOf(d.item)));
    Alert.alert(
      d.kind === 'confirm' ? 'Permanently banned' : 'Request rejected',
      d.kind === 'confirm'
        ? `${nameOf(d.item)} is permanently banned.${r.linkedUpdated ? ` ${r.linkedUpdated} linked account(s) too.` : ''}`
        : `${nameOf(d.item)} keeps the ${PENDING_PERM_DAYS}-day ban.`,
    );
    return true;
  };

  const renderItem = ({ item }) => (
    <View style={{ backgroundColor: card, borderRadius: 12, padding: 12, marginHorizontal: 12, marginBottom: 8 }}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => {
          Clipboard.setString(item.uid || item.email || '');
          showSuccessMessage('Copied', item.uid ? 'User ID copied' : 'Email copied');
        }}
      >
        <Text style={{ color: text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{nameOf(item)}</Text>
        <Text style={{ color: sub, fontSize: 10, fontFamily: 'monospace' }} numberOfLines={1}>
          {item.uid || `${item.email} · no account yet`}
        </Text>
      </TouchableOpacity>
      <Text style={{ color: sub, fontSize: 12, marginTop: 4 }}>
        Strike {item.strikeCount || 3} by {item.requestedByName || item.requestedByUid || 'unknown'}
        {ROLE_LABEL[item.requestedByRole] ? ` (${ROLE_LABEL[item.requestedByRole]})` : ''}
        {item.requestedAt ? ` · ${dayjs(item.requestedAt).fromNow()}` : ''}
      </Text>
      <Text style={{ color: sub, fontSize: 12, marginTop: 2 }}>
        Banned until {typeof item.bannedUntil === 'number' ? dayjs(item.bannedUntil).format('MMM D, HH:mm') : '—'}
        {item.includeLinked ? ' · linked accounts banned too' : ''}
      </Text>
      {!!item.reason && <Text style={{ color: text, fontSize: 13, marginTop: 6 }}>{item.reason}</Text>}
      <EvidenceThumbs urls={item.evidence || []} onOpen={(index) => setViewer({ urls: item.evidence, index })} />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {onOpenUser && !!item.uid && (
          <TouchableOpacity
            onPress={() => onOpenUser({ id: item.uid, displayName: item.targetName || null })}
            style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }}
          >
            <Text style={{ color: text, fontSize: 12, fontWeight: '700' }}>Profile</Text>
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={() => setDecision({ kind: 'reject', item })}
          style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }}
        >
          <Text style={{ color: text, fontSize: 12, fontWeight: '700' }}>Reject</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setDecision({ kind: 'confirm', item })}
          style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#FF3B30' }}
        >
          <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>Confirm permanent</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: sub, fontSize: 12, paddingHorizontal: 16, paddingVertical: 8 }}>
        A 3rd strike from a Senior Mod or Mod bans for {PENDING_PERM_DAYS} days. Confirm to make it permanent, or reject to keep {PENDING_PERM_DAYS} days.
      </Text>
      <FlatList
        data={items}
        keyExtractor={keyOf}
        renderItem={renderItem}
        ListEmptyComponent={
          <View style={{ padding: 32, alignItems: 'center' }}>
            {loading
              ? <ActivityIndicator />
              : <Text style={{ color: sub, textAlign: 'center' }}>{error || 'No permanent-ban requests.'}</Text>}
          </View>
        }
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={load} />}
      />
      <ModActionModal
        visible={!!decision}
        isDark={isDark}
        title={decision?.kind === 'confirm' ? `Permanently ban ${nameOf(decision?.item)}` : `Reject: keep ${nameOf(decision?.item)} at ${PENDING_PERM_DAYS} days`}
        subtitle={decision?.kind === 'confirm'
          ? 'Bans the account, its devices and the linked accounts banned with it, for good. Only an Admin can lift it.'
          : `The ${PENDING_PERM_DAYS}-day ban stays; it is not made permanent.`}
        confirmLabel={decision?.kind === 'confirm' ? 'Confirm permanent' : 'Reject'}
        confirmColor={decision?.kind === 'confirm' ? '#ef4444' : '#64748b'}
        requireReason={false}
        initialReason=""
        onCancel={() => setDecision(null)}
        onConfirm={confirmDecision}
      />
      <EvidenceViewer
        visible={!!viewer}
        urls={viewer?.urls || []}
        startIndex={viewer?.index || 0}
        onClose={() => setViewer(null)}
      />
    </View>
  );
};

export default PermBanRequestsTab;
