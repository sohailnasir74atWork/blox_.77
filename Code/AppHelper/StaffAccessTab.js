// Admin Dashboard → "Staff Access" tab (admin / owner only).
//
// Two lists (pills at the top):
//   RTDB /jmd_granters/{uid} = true — may appoint and remove JMDs;
//   RTDB /mod_granters/{uid} = true — may appoint and remove Mods (2026-10-22);
//   Supabase private_chat_readers (supabase/053) — a Mod / Senior Mod who may
//   read any player's private chats (Reports ▸ User chats), 2026-10-22.
// None gives any sanction power (contract §1/§10). Only admins/owners may
// write them (database.rules.json; 053's rpcs), value `true` or null. The app shows a
// granter the matching Make / Remove chip on profiles (GlobelStats canGrant*). Pattern from adoptme-jan7
// (ddae135 "Staff Access"), adapted: Blox stores plain `true`, so names are
// looked up from users/{uid}/displayName.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Keyboard,
  RefreshControl,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { getDatabase, ref, get, set } from '@react-native-firebase/database';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { logModAction } from '../Helper/modSanction';
import { supabase } from '../Supabase/client';

const UID_RE = /^[A-Za-z0-9]{10,128}$/;

const LISTS = {
  jmd: {
    path: 'jmd_granters', role: 'jmd_granter', pill: 'JMDs', who: 'Junior Mods',
    intro: "People listed here can appoint and remove Junior Mods from a profile. It grants no other staff power.",
  },
  mod: {
    path: 'mod_granters', role: 'mod_granter', pill: 'Mods', who: 'Mods',
    intro: "People listed here can appoint and remove Mods (on anyone below Senior Mod) from a profile. It grants no other staff power.",
  },
  chats: {
    supabase: true, role: 'chat_reader', pill: 'Private chats', who: 'private chats', verb: 'read',
    intro: "Mods and Senior Mods listed here can read any player's private chats (Reports ▸ User chats), like an Admin. Only a Mod or Senior Mod can be added.",
  },
};

// One store per list: RTDB leaf (`path`) or the supabase/053 rpcs.
const readUids = async (db, list) => {
  if (list.supabase) {
    const { data, error } = await supabase.rpc('chat_readers_list');
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map((r) => r.uid).filter((uid) => UID_RE.test(uid));
  }
  const snap = await get(ref(db, list.path));
  return Object.entries(snap.val() || {})
    .filter(([uid, v]) => UID_RE.test(uid) && v !== false && v != null)
    .map(([uid]) => uid);
};
const writeGrant = async (db, list, uid, on) => {
  if (list.supabase) {
    const { error } = await supabase.rpc('chat_reader_set', { p_uid: uid, p_on: on });
    if (error) throw error;
    return;
  }
  await set(ref(db, `${list.path}/${uid}`), on ? true : null);
};
const grantError = (e) => (/NOT_MOD/.test(String(e?.message || ''))
  ? 'Only a Mod or Senior Mod can be given this access.'
  : 'Could not save. Only admins and owners can change Staff Access.');

const StaffAccessTab = ({ isDark }) => {
  const db = useMemo(() => getDatabase(), []);
  const [listKey, setListKey] = useState('jmd');
  const list = LISTS[listKey];
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uidInput, setUidInput] = useState('');
  const [preview, setPreview] = useState(null); // { uid, displayName, exists }
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(null); // uid being written

  const text = isDark ? '#FFF' : '#000';
  const sub = isDark ? '#999' : '#666';
  const card = isDark ? '#1C1C1E' : '#FFF';
  const border = isDark ? '#2C2C2E' : '#E5E5EA';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const uids = await readUids(db, list);
      const names = await Promise.all(uids.map((uid) =>
        get(ref(db, `users/${uid}/displayName`)).then((s) => s.val()).catch(() => null)
      ));
      setRows(uids.map((uid, i) => ({ uid, displayName: names[i] || null })));
    } catch (e) {
      Alert.alert('Error', 'Could not load Staff Access. Only admins can read this list.');
    } finally {
      setLoading(false);
    }
  }, [db, list]);

  useEffect(() => { setRows([]); load(); }, [load]);

  const lookUp = useCallback(async () => {
    const uid = uidInput.trim();
    Keyboard.dismiss();
    if (!UID_RE.test(uid)) {
      Alert.alert('Invalid ID', 'Paste a user ID (letters and numbers only).');
      return;
    }
    setLooking(true);
    try {
      const nameSnap = await get(ref(db, `users/${uid}/displayName`));
      setPreview({ uid, displayName: nameSnap.val() || null, exists: nameSnap.exists() });
    } catch (_) {
      setPreview({ uid, displayName: null, exists: false });
    } finally {
      setLooking(false);
    }
  }, [db, uidInput]);

  const grant = useCallback((p) => {
    if (!p?.uid) return;
    if (rows.some((r) => r.uid === p.uid)) {
      Alert.alert('Already listed', `${p.displayName || p.uid} can already ${list.verb || 'appoint'} ${list.who}.`);
      return;
    }
    Alert.alert(
      'Grant Staff Access',
      list.supabase
        ? `Allow ${p.displayName || p.uid} to read any player's private chats?\n\nOnly do this for staff you trust. It gives no other power.`
        : `Allow ${p.displayName || p.uid} to appoint and remove ${list.who}?\n\nThis gives them no other staff power (no bans, mutes or strikes).`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Grant',
          onPress: async () => {
            setSaving(p.uid);
            try {
              await writeGrant(db, list, p.uid, true);
              logModAction('role_change', p.uid, { role: list.role, value: true });
              setRows((prev) => [{ uid: p.uid, displayName: p.displayName }, ...prev]);
              setPreview(null);
              setUidInput('');
            } catch (e) {
              Alert.alert('Error', grantError(e));
            } finally {
              setSaving(null);
            }
          },
        },
      ]
    );
  }, [db, rows, list]);

  const revoke = useCallback((row) => {
    Alert.alert(
      'Remove Staff Access',
      `${row.displayName || row.uid} will no longer be able to ${list.verb || 'appoint'} ${list.who}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setSaving(row.uid);
            try {
              await writeGrant(db, list, row.uid, false);
              logModAction('role_change', row.uid, { role: list.role, value: false });
              setRows((prev) => prev.filter((r) => r.uid !== row.uid));
            } catch (e) {
              Alert.alert('Error', 'Could not remove. Only admins and owners can change Staff Access.');
            } finally {
              setSaving(null);
            }
          },
        },
      ]
    );
  }, [db, list]);

  const header = (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, marginBottom: 10 }}>
        {Object.entries(LISTS).map(([k, l]) => (
          <TouchableOpacity
            key={k}
            onPress={() => { setListKey(k); setPreview(null); }}
            style={{
              paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, marginRight: 8,
              backgroundColor: listKey === k ? '#007AFF' : (isDark ? '#2C2C2E' : '#E5E5EA'),
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: listKey === k ? '#FFF' : (isDark ? '#CCC' : '#333') }}>
              {l.verb === 'read' ? `Can read ${l.pill.toLowerCase()}` : `Can appoint ${l.pill}`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={{ color: sub, fontSize: 12, marginBottom: 10 }}>
        {list.intro} Add someone by pasting their user ID (copy it from their profile).
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <TextInput
          value={uidInput}
          onChangeText={(v) => { setUidInput(v); setPreview(null); }}
          placeholder="User ID"
          placeholderTextColor={isDark ? '#666' : '#999'}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={lookUp}
          style={{ flex: 1, height: 44, borderRadius: 10, paddingHorizontal: 12, fontSize: 15, backgroundColor: card, color: text }}
        />
        <TouchableOpacity
          onPress={lookUp}
          disabled={looking}
          style={{ width: 44, height: 44, marginLeft: 8, borderRadius: 10, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center' }}
        >
          {looking ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="search" size={20} color="#FFF" />}
        </TouchableOpacity>
      </View>
      {preview && (
        <View style={{ marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: card, borderWidth: 1, borderColor: border }}>
          <Text style={{ color: text, fontWeight: '700' }}>{preview.displayName || 'No profile found'}</Text>
          <Text style={{ color: sub, fontSize: 11 }} numberOfLines={1}>{preview.uid}</Text>
          <TouchableOpacity
            onPress={() => grant(preview)}
            disabled={!preview.exists || saving === preview.uid}
            style={{
              marginTop: 10, paddingVertical: 9, borderRadius: 10, alignItems: 'center',
              backgroundColor: preview.exists ? '#34C759' : (isDark ? '#2C2C2E' : '#E5E5EA'),
            }}
          >
            {saving === preview.uid
              ? <ActivityIndicator color="#FFF" size="small" />
              : <Text style={{ color: preview.exists ? '#FFF' : sub, fontWeight: '700' }}>
                  {preview.exists ? 'Grant Staff Access' : 'User not found'}
                </Text>}
          </TouchableOpacity>
        </View>
      )}
      <Text style={{ color: text, fontSize: 15, fontWeight: '700', marginTop: 16 }}>
        Can {list.verb || 'appoint'} {list.who} ({rows.length})
      </Text>
    </View>
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.uid}
      ListHeaderComponent={header}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading && rows.length > 0} onRefresh={load} />}
      contentContainerStyle={{ paddingBottom: 60 }}
      ListEmptyComponent={
        loading
          ? <ActivityIndicator style={{ marginTop: 20 }} />
          : <Text style={{ color: sub, textAlign: 'center', marginTop: 20 }}>Nobody has Staff Access.</Text>
      }
      renderItem={({ item }) => (
        <View style={{
          flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8,
          padding: 12, borderRadius: 12, backgroundColor: card, borderWidth: 1, borderColor: border,
        }}>
          <TouchableOpacity
            style={{ flex: 1 }}
            onPress={() => { Clipboard.setString(item.uid); Alert.alert('Copied', 'User ID copied.'); }}
          >
            <Text style={{ color: text, fontWeight: '600' }} numberOfLines={1}>{item.displayName || 'Unknown'}</Text>
            <Text style={{ color: sub, fontSize: 11 }} numberOfLines={1}>{item.uid}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => revoke(item)}
            disabled={saving === item.uid}
            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#FF3B3020' }}
          >
            {saving === item.uid
              ? <ActivityIndicator size="small" color="#FF3B30" />
              : <Text style={{ color: '#FF3B30', fontWeight: '700', fontSize: 12 }}>Remove</Text>}
          </TouchableOpacity>
        </View>
      )}
    />
  );
};

export default StaffAccessTab;
