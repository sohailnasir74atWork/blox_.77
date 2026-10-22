/**
 * ModHistoryList.jsx — one user's moderation timeline (strikes, mutes, bans,
 * lifts, deleted messages, role changes…), newest first, from the audit log
 * (supabase/031 mod_actions via fetchUserModHistory). Evidence screenshots
 * show as thumbnails and open in EvidenceViewer.
 *
 * Staff only: the rpc is staff-gated server-side. Used in the profile
 * drawer's Mod Tools and the Admin Dashboard's user detail.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { fetchUserModHistory } from '../Supabase/modLogBackend';
import EvidenceViewer from './EvidenceViewer';

dayjs.extend(relativeTime);

export const MOD_ACTION_COLOR = {
  strike: '#EF4444',
  ban: '#B91C1C',
  mute: '#7C3AED',
  unban: '#10B981',
  unmute: '#10B981',
  message_delete: '#F97316',
  delete_all: '#F97316',
  pin: '#0EA5E9',
  unpin: '#0EA5E9',
  role_change: '#6366F1',
  review_delete: '#F59E0B',
  profile_delete: '#DC2626',
  post_delete: '#F97316',
  perm_confirm: '#B91C1C',
  perm_reject: '#64748B',
};

const LOG_LABEL = {
  message_delete: 'Message deleted',
  delete_all: 'Messages deleted (all recent)',
  pin: 'Message pinned',
  unpin: 'Message unpinned',
  review_delete: 'Review deleted',
  profile_delete: 'Profile data deleted',
  post_delete: 'Post deleted',
  perm_confirm: 'Permanent ban confirmed',
  perm_reject: 'Permanent ban rejected (stays temporary)',
};
// Logged under an older action until supabase/047 is applied (details.action).
const NEWER_ACTIONS = new Set(['perm_confirm', 'perm_reject', 'post_delete']);

/** The row's real action (047 fallback rows carry it in details.action). */
export const actionOf = (a) => (NEWER_ACTIONS.has(a?.details?.action) ? a.details.action : a?.action);

const roleName = (key) => ({
  isSeniorMod: 'Senior Mod', isModerator: 'Mod', isBabyMod: 'JMD', isTrusted: 'Trusted',
  isGrinder: 'Grinder', isRaider: 'Raider', isAdmin: 'Admin', isHelper: 'Helper',
}[key] || key || 'role');

/** One-line label for a mod_actions row (also used by the Mod Log tab). */
export const describeModAction = (raw) => {
  if (!raw) return '';
  const a = { ...raw, action: actionOf(raw) };
  if (a.action === 'mute') return `Muted ${a.durationMinutes ? `${a.durationMinutes} min` : ''}`.trim();
  if (a.action === 'unban') return 'Unbanned';
  if (a.action === 'unmute') return 'Unmuted';
  if (a.action === 'role_change') {
    const d = a.details || {};
    return d.role ? `${d.value ? 'Made' : 'Removed'} ${roleName(d.role)}` : 'Role changed';
  }
  if (a.action === 'title_change') return a.details?.title ? `Title set: ${a.details.title}` : 'Title removed';
  if (LOG_LABEL[a.action]) return LOG_LABEL[a.action];
  if (a.action === 'strike' || a.action === 'ban') {
    if (a.isPermanent) return `Strike ${a.strikeCount || 3} · permanent`;
    if (a.details?.pending_permanent) return `Strike ${a.strikeCount || 3} · temporary, waiting for a Senior Mod or Admin`;
    return `Strike ${a.strikeCount || '?'}`;
  }
  return a.action || 'Action';
};

/** Screenshot URLs on a row, whatever the backend mapper calls them. */
export const evidenceOf = (a) => {
  const v = a?.evidence || a?.evidenceUrls || a?.evidence_urls || null;
  return Array.isArray(v) ? v.filter((u) => typeof u === 'string' && u) : [];
};

export const EvidenceThumbs = ({ urls, onOpen, size = 44 }) => {
  if (!urls?.length) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
      {urls.map((u, i) => (
        <TouchableOpacity key={`${u}-${i}`} onPress={() => onOpen(i)} activeOpacity={0.8}>
          <Image resizeMethod="resize" source={{ uri: u }} style={{ width: size, height: size, borderRadius: 6, backgroundColor: '#3334' }} />
        </TouchableOpacity>
      ))}
    </View>
  );
};

const ModHistoryList = ({ uid, email = null, isDark = false, pageSize = 10, title = 'Moderation history' }) => {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [viewer, setViewer] = useState(null); // { urls, index }

  const text = isDark ? '#f1f5f9' : '#0f172a';
  const sub = isDark ? '#94a3b8' : '#64748b';
  const card = isDark ? '#0f172a' : '#f8fafc';
  const border = isDark ? '#334155' : '#e2e8f0';

  const load = useCallback(async (more = false) => {
    if (!uid && !email) return;
    setLoading(true);
    try {
      const r = await fetchUserModHistory({ uid, email, cursor: more ? cursor : null, limit: pageSize });
      setItems((prev) => (more ? [...prev, ...r.items.filter((x) => !prev.some((p) => p.id === x.id))] : r.items));
      setCursor(r.cursor);
      setHasMore(r.hasMore);
      setSchemaMissing(r.schemaMissing);
    } finally {
      setLoading(false);
    }
  }, [uid, email, cursor, pageSize]);

  // Reload when the target changes (not when the cursor moves).
  useEffect(() => {
    setItems([]);
    setCursor(null);
    setHasMore(false);
    if (!uid && !email) return;
    let alive = true;
    setLoading(true);
    fetchUserModHistory({ uid, email, limit: pageSize })
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setCursor(r.cursor);
        setHasMore(r.hasMore);
        setSchemaMissing(r.schemaMissing);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [uid, email, pageSize]);

  return (
    <View>
      {!!title && <Text style={{ fontSize: 13, fontWeight: '700', color: text, marginBottom: 8 }}>{title}</Text>}
      {items.length === 0 && !loading && (
        <Text style={{ color: sub, fontSize: 12, paddingVertical: 6 }}>
          {schemaMissing ? 'The moderation log is not set up on the server yet.' : 'No moderation on record.'}
        </Text>
      )}
      {items.map((a) => {
        const urls = evidenceOf(a);
        return (
          <View key={a.id} style={{ backgroundColor: card, borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: MOD_ACTION_COLOR[actionOf(a)] || text, fontWeight: '800', fontSize: 12 }}>{describeModAction(a)}</Text>
              <Text style={{ color: sub, fontSize: 10 }}>{a.createdAt ? dayjs(a.createdAt).fromNow() : ''}</Text>
            </View>
            {!!a.reason && <Text style={{ color: text, fontSize: 12, marginTop: 4 }}>{a.reason}</Text>}
            <Text style={{ color: sub, fontSize: 10, marginTop: 4 }}>
              {a.actorUid ? `by ${a.actorName || a.actorUid}${a.actorRole ? ` (${String(a.actorRole).replace('_', ' ')})` : ''}` : 'automatic'}
              {a.createdAt ? ` · ${dayjs(a.createdAt).format('MMM D, YYYY HH:mm')}` : ''}
            </Text>
            <EvidenceThumbs urls={urls} onOpen={(index) => setViewer({ urls, index })} />
          </View>
        );
      })}
      {loading && <ActivityIndicator size="small" style={{ marginVertical: 6 }} />}
      {hasMore && !loading && (
        <TouchableOpacity onPress={() => load(true)} style={{ paddingVertical: 8, alignItems: 'center' }}>
          <Text style={{ color: '#3b82f6', fontWeight: '600', fontSize: 12 }}>Load more</Text>
        </TouchableOpacity>
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

export default ModHistoryList;
