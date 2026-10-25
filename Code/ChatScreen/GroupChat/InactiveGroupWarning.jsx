// Inactive-group countdown on the group list (owner request 2026-10-25).
// The server deletes a group after 15 days with no message (cleanupInactiveGroups,
// daily 03:30 UTC) and keeps groups/{id}.lastActivityAt current; the message
// push bumps it on every message (at most hourly), so the line goes away as
// soon as someone texts. From day 7 of quiet the row shows
// "Inactive · deleted in N days", down to "deleted today".
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { doc, getDoc } from '@react-native-firebase/firestore';

const DAY_MS = 24 * 60 * 60 * 1000;
const WARN_AFTER_DAYS = 7;
const DELETE_AFTER_DAYS = 15;
const FETCH_TTL_MS = 10 * 60 * 1000;

// Whole days left before the server deletes the group (0 = today), or null
// when no warning is due. No lastActivityAt → no warning (never guess).
export const inactiveDaysLeft = (lastActivityAt, now = Date.now()) => {
  const at = Number(lastActivityAt);
  if (!Number.isFinite(at) || at <= 0) return null;
  const quietDays = Math.floor((now - at) / DAY_MS);
  if (quietDays < WARN_AFTER_DAYS) return null;
  return Math.max(0, DELETE_AFTER_DAYS - 1 - quietDays);
};

// groupId → { at, fetchedAt }. Module-level so tab switches don't re-read.
const activityCache = new Map();

// lastActivityAt of each group in My Groups (rows come from the inbox meta,
// which doesn't carry it): one doc read per group, at most every 10 minutes.
export const useGroupsLastActivity = (firestoreDB, groupIds) => {
  const [activity, setActivity] = useState({});
  const key = (groupIds || []).filter(Boolean).join(',');

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(',') : [];
    const fill = () => {
      if (cancelled) return;
      const next = {};
      ids.forEach((id) => {
        const at = activityCache.get(id)?.at;
        if (at) next[id] = at;
      });
      setActivity(next);
    };
    fill();

    const now = Date.now();
    const stale = ids.filter((id) => !(activityCache.get(id)?.fetchedAt > now - FETCH_TTL_MS));
    if (!firestoreDB || stale.length === 0) return () => { cancelled = true; };
    Promise.all(stale.map((id) => getDoc(doc(firestoreDB, 'groups', id))
      .then((snap) => {
        activityCache.set(id, { at: Number(snap.data()?.lastActivityAt) || 0, fetchedAt: Date.now() });
      })
      .catch(() => {}))).then(fill);
    return () => { cancelled = true; };
  }, [firestoreDB, key]);

  return activity;
};

const InactiveGroupWarning = ({ lastActivityAt, isDarkMode, style }) => {
  const { t } = useTranslation();
  const left = inactiveDaysLeft(lastActivityAt);
  if (left == null) return null;

  const urgent = left <= 3;
  const color = urgent ? (isDarkMode ? '#F87171' : '#B91C1C') : (isDarkMode ? '#FBBF24' : '#B45309');
  const backgroundColor = urgent
    ? (isDarkMode ? 'rgba(248,113,113,0.12)' : '#FEE2E2')
    : (isDarkMode ? 'rgba(251,191,36,0.12)' : '#FEF3C7');

  return (
    <View style={[{
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      marginTop: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 5,
      backgroundColor,
    }, style]}>
      <Icon name="hourglass-outline" size={11} color={color} />
      <Text style={{ fontSize: 10, fontWeight: '600', color, marginLeft: 4 }} numberOfLines={1}>
        {left === 0
          ? t('chat.groups_screen.inactive_delete_today')
          : t('chat.groups_screen.inactive_delete_in', { count: left })}
      </Text>
    </View>
  );
};

export default InactiveGroupWarning;
