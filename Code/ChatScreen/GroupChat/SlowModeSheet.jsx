// Staff sheet: public-chat slow mode for all rooms and for the open room
// (supabase/046). Senior Mod, Admin and owner only — the set_chat_slowmode rpc
// checks the rank; the chat header only shows the entry to them. Staff-only
// screen, so English like the other mod tools.
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ALL_ROOMS,
  SLOW_MODE_CHOICES,
  fetchSlowMode,
  setSlowMode,
  slowModeShortLabel,
} from '../../Supabase/chatSlowMode';
import { isMissingSchemaError } from '../../Supabase/modLogBackend';

// One scope (all rooms / this room): Off, 5s … 5m chips.
const ScopeRow = ({ title, scope, value, busy, disabled, isDark, text, onChoose }) => (
  <View style={styles.row}>
    <Text style={[styles.rowTitle, { color: text }]} numberOfLines={1}>{title}</Text>
    <View style={styles.chips}>
      {SLOW_MODE_CHOICES.map((secs) => {
        const active = value === secs;
        const saving = busy === `${scope}:${secs}`;
        return (
          <TouchableOpacity
            key={secs}
            disabled={disabled}
            onPress={() => onChoose(scope, secs)}
            style={[styles.chip, { backgroundColor: active ? '#4F46E5' : (isDark ? '#2C2C2E' : '#E5E5EA') }]}
          >
            {saving
              ? <ActivityIndicator size="small" color={active ? '#FFF' : '#4F46E5'} />
              : <Text style={[styles.chipText, { color: active ? '#FFF' : text }]}>{slowModeShortLabel(secs)}</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
  </View>
);

const SlowModeSheet = ({ visible, onClose, room, isDark }) => {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState({ global: 0, room: 0, available: true });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null); // `${scope}:${seconds}` being saved

  const load = useCallback(async () => {
    setLoading(true);
    // Any room id answers the '*' row; fall back to the main room.
    const res = await fetchSlowMode(room?.id || 'chat_new_upgrade', { force: true });
    setState(res);
    setLoading(false);
  }, [room?.id]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const choose = async (scope, seconds) => {
    setBusy(`${scope}:${seconds}`);
    try {
      const stored = await setSlowMode(scope, seconds);
      setState((s) => (scope === ALL_ROOMS ? { ...s, global: stored } : { ...s, room: stored }));
    } catch (e) {
      const msg = isMissingSchemaError(e)
        ? 'Slow mode is not set up on the server yet (supabase/046).'
        : e?.code === '42501'
          ? 'Only Senior Mods, Admins and the owner can set slow mode.'
          : e?.message || 'Try again.';
      Alert.alert('Could not set slow mode', msg);
    } finally {
      setBusy(null);
    }
  };

  const text = isDark ? '#FFF' : '#111';
  const sub = isDark ? '#AAA' : '#666';
  const rowProps = { busy, disabled: !!busy || loading || !state.available, isDark, text, onChoose: choose };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity
          activeOpacity={1}
          style={[styles.sheet, { backgroundColor: isDark ? '#1C1C1E' : '#FFF', paddingBottom: Math.max(insets.bottom, 16) }]}
        >
          <Text style={[styles.title, { color: text }]}>Slow mode</Text>
          <Text style={[styles.note, { color: sub }]}>
            Minimum time between one player&apos;s messages. The stricter of the two settings applies in a room. Staff (JMD and up) are exempt.
          </Text>
          {loading && <ActivityIndicator style={{ marginVertical: 8 }} />}
          {!state.available && (
            <Text style={[styles.note, { color: '#FF3B30' }]}>Not set up on the server yet (supabase/046).</Text>
          )}
          <ScopeRow title="All public rooms" scope={ALL_ROOMS} value={state.global} {...rowProps} />
          {room?.id ? (
            <ScopeRow title={`This room: ${room.label}`} scope={room.id} value={state.room} {...rowProps} />
          ) : (
            <Text style={[styles.note, { color: sub }]}>Open a public chat room to set it for one room.</Text>
          )}
          <TouchableOpacity onPress={onClose} style={styles.done}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  title: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  note: { fontSize: 12, marginBottom: 10 },
  row: { marginTop: 10 },
  rowTitle: { fontSize: 14, fontWeight: '700', marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { minWidth: 48, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, marginRight: 8, marginBottom: 8, alignItems: 'center' },
  chipText: { fontSize: 13, fontWeight: '700' },
  done: { marginTop: 14, alignSelf: 'stretch', backgroundColor: '#4F46E5', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  doneText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
});

export default SlowModeSheet;
