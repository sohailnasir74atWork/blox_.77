/**
 * ProGrantPanel — "Pro access" card in the Admin Dashboard user details.
 *
 * Shows the admin-given Pro on pro_grants/{uid} and gives or removes it in one
 * tap (Code/Helper/proGrant.js). Store subscriptions are separate: this card
 * never shows or changes them. Admins only — the dashboard decides whether to
 * render it, database.rules.json enforces it.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { getDatabase, ref, onValue } from '@react-native-firebase/database';
import { grantPro, revokePro, LIFETIME_UNTIL } from '../Helper/proGrant';

const GOLD = '#F5A623';
const DANGER = '#FF3B30';

const OPTIONS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '1 year', days: 365 },
  { label: 'Lifetime', days: 0 },
];

const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

export default function ProGrantPanel({ uid, name, adminUid, colors }) {
  const C = colors;
  const [grant, setGrant] = useState(undefined); // undefined = loading, null = none
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid) return undefined;
    setGrant(undefined);
    return onValue(
      ref(getDatabase(), `pro_grants/${uid}`),
      (snap) => setGrant(snap.val() || null),
      () => setGrant(null),
    );
  }, [uid]);

  const until = Number(grant?.until) || 0;
  const active = until > Date.now();
  const lifetime = until >= LIFETIME_UNTIL;
  const who = name || 'this player';

  const run = async (fn, doneMsg) => {
    setBusy(true);
    try {
      await fn();
      Alert.alert('Done', doneMsg);
    } catch (e) {
      Alert.alert('Failed', e?.message || 'Could not save. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const onGrant = (opt) => {
    const what = opt.days ? `${opt.label} of Pro` : 'lifetime Pro';
    const extra = active && !lifetime && opt.days ? `\n\nAdded on top of the Pro already running (until ${fmtDate(until)}).` : '';
    Alert.alert('Give Pro', `Give ${who} ${what}?${extra}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Give Pro', onPress: () => run(() => grantPro(uid, opt.days, active ? until : 0, adminUid), `${who} now has ${what}.`) },
    ]);
  };

  const onRemove = () => {
    Alert.alert('Remove Pro', `Remove the Pro you gave ${who}? A store subscription they bought is not affected.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => run(() => revokePro(uid), 'Admin Pro removed.') },
    ]);
  };

  let status;
  if (grant === undefined) status = 'Loading…';
  else if (lifetime) status = 'Lifetime Pro (given by an admin)';
  else if (active) status = `Pro until ${fmtDate(until)} (given by an admin)`;
  else if (until) status = `Admin Pro ended ${fmtDate(until)}`;
  else status = 'No admin Pro';

  return (
    <View style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Ionicons name="star" size={14} color={GOLD} />
        <Text style={{ color: C.textMuted, fontSize: 12, fontWeight: '700', marginLeft: 6, flex: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Pro access
        </Text>
        {busy && <ActivityIndicator size="small" color={GOLD} />}
      </View>

      <Text style={{ color: active ? GOLD : C.text, fontSize: 14, fontWeight: '600', marginBottom: 10 }}>{status}</Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.label}
            disabled={busy || grant === undefined || (lifetime && active)}
            onPress={() => onGrant(opt)}
            style={{
              paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8,
              backgroundColor: GOLD, opacity: busy || grant === undefined || (lifetime && active) ? 0.4 : 1,
            }}
          >
            <Text style={{ color: '#000', fontWeight: '700', fontSize: 13 }}>{opt.days ? `+ ${opt.label}` : opt.label}</Text>
          </TouchableOpacity>
        ))}
        {active && (
          <TouchableOpacity
            disabled={busy}
            onPress={onRemove}
            style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: DANGER, opacity: busy ? 0.4 : 1 }}
          >
            <Text style={{ color: DANGER, fontWeight: '700', fontSize: 13 }}>Remove</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={{ color: C.textMuted, fontSize: 11, marginTop: 10 }}>
        Turns on as soon as the player opens an app version that has this card. Store subscriptions are separate.
      </Text>
    </View>
  );
}
