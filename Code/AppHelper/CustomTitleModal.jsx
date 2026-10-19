/**
 * CustomTitleModal.jsx — staff prompt to give a user a custom title
 * (Senior Mod, Admin, owner; 2026-10-19). Staff-only, so English like the
 * other mod tools.
 *
 * Opened from the profile drawer's Manage Roles section after the drawer
 * closes (same pattern as ModActionModal). `onSave(title)` saves, or removes
 * when title is null; it returns true to close, false to stay open.
 * The rules (utils.normalizeCustomTitle + database.rules.json) cap a title
 * at CUSTOM_TITLE_MAX characters.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { CUSTOM_TITLE_MAX, normalizeCustomTitle } from '../ChatScreen/utils';

const CustomTitleModal = ({ visible, isDark = false, targetName, currentTitle = null, onCancel, onSave }) => {
  const [text, setText] = useState(currentTitle || '');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setText(currentTitle || '');
    setBusy(false);
    busyRef.current = false;
  }, [visible, currentTitle]);

  const C = {
    card: isDark ? '#1e293b' : '#ffffff',
    border: isDark ? '#334155' : '#e2e8f0',
    text: isDark ? '#f1f5f9' : '#0f172a',
    muted: isDark ? '#94a3b8' : '#64748b',
    input: isDark ? '#0f172a' : '#f8fafc',
  };

  const check = normalizeCustomTitle(text);
  const canSave = !busy && !check.error && check.title !== (currentTitle || null);

  const run = useCallback(async (value) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    let close = false;
    try {
      close = (await onSave?.(value)) !== false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    if (close) onCancel?.();
  }, [onSave, onCancel]);

  const close = useCallback(() => {
    if (busyRef.current) return;
    onCancel?.();
  }, [onCancel]);

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable
          onPress={close}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{ width: '100%', backgroundColor: C.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: C.border }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 6 }}>Custom title</Text>
            <Text style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
              Shown next to {targetName || 'this user'}'s name everywhere role badges show. Up to {CUSTOM_TITLE_MAX} characters.
            </Text>
            <TextInput
              style={{
                backgroundColor: C.input, color: C.text, borderRadius: 10, padding: 12,
                borderWidth: 1, borderColor: C.border, fontSize: 14,
              }}
              placeholder="e.g. Event Host"
              placeholderTextColor={isDark ? '#475569' : '#94a3b8'}
              maxLength={CUSTOM_TITLE_MAX}
              value={text}
              onChangeText={setText}
              editable={!busy}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => canSave && run(check.title)}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
              <Text style={{ fontSize: 11, color: text.trim() && check.error ? '#ef4444' : C.muted, flex: 1 }} numberOfLines={2}>
                {text.trim() && check.error ? check.error : ' '}
              </Text>
              <Text style={{ fontSize: 11, color: C.muted }}>{text.length}/{CUSTOM_TITLE_MAX}</Text>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              {!!currentTitle && (
                <TouchableOpacity
                  onPress={() => run(null)}
                  disabled={busy}
                  style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, marginRight: 'auto' }}
                >
                  <Text style={{ color: '#ef4444', fontWeight: '600' }}>Remove</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={close}
                disabled={busy}
                style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: C.border, opacity: busy ? 0.5 : 1 }}
              >
                <Text style={{ color: C.text, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => run(check.title)}
                disabled={!canSave}
                style={{
                  paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, minWidth: 80, alignItems: 'center',
                  backgroundColor: '#DB2777', opacity: canSave ? 1 : 0.5,
                }}
              >
                {busy
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ color: '#fff', fontWeight: '700' }}>Save</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default CustomTitleModal;
