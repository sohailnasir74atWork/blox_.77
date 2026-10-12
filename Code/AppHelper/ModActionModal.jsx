/**
 * ModActionModal.jsx — the reason prompt every moderation action goes
 * through (strike, ban, mute, unban, unmute, perm-ban of linked accounts).
 *
 * Used by the profile drawer's Mod Tools (BottomDrawer.jsx) and the Admin
 * Dashboard. One-tap common reasons fill the box; the mod can edit or type
 * their own. With `linkedAccounts` it also shows the linked-account list with
 * checkboxes (staff rows disabled — the server skips them anyway).
 *
 * Confirm is guarded against double taps: it is disabled while `onConfirm`
 * runs, and a ref blocks a second call that lands before the re-render.
 * `onConfirm({ reason, linkedUids })` returns true to close, false to stay
 * open (e.g. the server refused and the mod may want to change the reason).
 * `secondaryLabel` / `onSecondary` add a plain left-hand button (e.g. "Copy IDs").
 *
 * With `allowEvidence` the mod can attach up to 3 screenshots (adoptme
 * 19b6cde). They upload on Confirm, BEFORE the sanction (through the server,
 * which holds the storage key): a failed upload leaves nothing applied and
 * the prompt open. `onConfirm` then also gets `evidence` (the URLs).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { launchImageLibrary } from 'react-native-image-picker';
import {
  MOD_QUICK_REASONS, MOD_REASON_MAX, EVIDENCE_MAX, uploadEvidence, evidenceErrorText,
} from '../Helper/modSanction';

const ModActionModal = ({
  visible,
  isDark = false,
  title,
  subtitle,
  confirmLabel = 'Confirm',
  confirmColor = '#ef4444',
  requireReason = true,
  initialReason = '',
  linkedAccounts = null,
  linkedSelectable = true,
  secondaryLabel = null,
  onSecondary = null,
  allowEvidence = false,
  onCancel,
  onConfirm,
}) => {
  const [reason, setReason] = useState(initialReason);
  const [shots, setShots] = useState([]); // local image URIs
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef(null);

  // Fresh state every time the prompt opens.
  useEffect(() => {
    if (!visible) return;
    setReason(initialReason || '');
    setShots([]);
    setUploading(false);
    setBusy(false);
    busyRef.current = false;
    const initial = {};
    (linkedAccounts || []).forEach((a) => {
      if (a?.uid && !a.isStaff && (!a.banned || !linkedSelectable)) initial[a.uid] = true;
    });
    setSelected(initial);
  }, [visible, initialReason, linkedAccounts, linkedSelectable]);

  const C = {
    card: isDark ? '#1e293b' : '#ffffff',
    border: isDark ? '#334155' : '#e2e8f0',
    text: isDark ? '#f1f5f9' : '#0f172a',
    muted: isDark ? '#94a3b8' : '#64748b',
    input: isDark ? '#0f172a' : '#f8fafc',
    chip: isDark ? '#0f172a' : '#f1f5f9',
  };

  const trimmed = reason.trim();
  const linkedUids = Object.keys(selected).filter((k) => selected[k]);
  const canConfirm = !busy && (!requireReason || trimmed.length > 0);

  const pickReason = useCallback((r) => {
    if (r === 'Other') {
      setReason('');
      inputRef.current?.focus?.();
      return;
    }
    setReason(r);
  }, []);

  const toggle = useCallback((uid) => {
    setSelected((prev) => ({ ...prev, [uid]: !prev[uid] }));
  }, []);

  const pickShots = useCallback(async () => {
    const room = EVIDENCE_MAX - shots.length;
    if (room <= 0) return;
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo', selectionLimit: room, quality: 0.8, maxWidth: 1600, maxHeight: 1600,
      });
      if (result?.didCancel || result?.errorCode) return;
      const uris = (result?.assets || []).map((a) => a?.uri).filter(Boolean);
      setShots((prev) => [...prev, ...uris].slice(0, EVIDENCE_MAX));
    } catch (e) {
      console.warn('[ModActionModal] image picker failed:', e?.message);
    }
  }, [shots.length]);

  const removeShot = useCallback((uri) => {
    setShots((prev) => prev.filter((u) => u !== uri));
  }, []);

  const handleConfirm = useCallback(async () => {
    if (busyRef.current || !canConfirm) return;
    busyRef.current = true;
    setBusy(true);
    let close = true;
    try {
      const evidence = [];
      if (allowEvidence && shots.length) {
        setUploading(true);
        for (const uri of shots) {
          const up = await uploadEvidence(uri);
          if (!up.ok) {
            Alert.alert('Upload failed', `${evidenceErrorText(up.error)} Nothing was applied.`);
            close = false;
            return;
          }
          evidence.push(up.url);
        }
        setUploading(false);
      }
      close = (await onConfirm?.({ reason: trimmed, linkedUids, evidence })) !== false;
    } catch (e) {
      console.warn('[ModActionModal] confirm failed:', e?.message);
      close = false;
    } finally {
      busyRef.current = false;
      setUploading(false);
      setBusy(false);
    }
    if (close) onCancel?.();
  }, [canConfirm, onConfirm, onCancel, trimmed, linkedUids, allowEvidence, shots]);

  const close = useCallback(() => {
    if (busyRef.current) return; // don't drop an action mid-flight
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
            style={{ width: '100%', maxHeight: '90%', backgroundColor: C.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: C.border }}
          >
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 6 }}>{title}</Text>
              {!!subtitle && (
                <Text style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>{subtitle}</Text>
              )}

              {Array.isArray(linkedAccounts) && linkedAccounts.length > 0 && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: C.muted, marginBottom: 6 }}>
                    {linkedSelectable ? `Linked accounts (${linkedUids.length} selected)` : 'Linked accounts'}
                  </Text>
                  {!linkedSelectable && (
                    <Text style={{ fontSize: 11, color: '#f59e0b', marginBottom: 6 }}>
                      The server in use can't ban a selection: confirming bans EVERY linked account
                      below that you outrank.
                    </Text>
                  )}
                  {linkedAccounts.map((a) => {
                    const disabled = !!a.isStaff || !linkedSelectable;
                    const on = !!selected[a.uid];
                    return (
                      <TouchableOpacity
                        key={a.uid}
                        disabled={disabled}
                        onPress={() => toggle(a.uid)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', paddingVertical: 7,
                          borderBottomWidth: 1, borderBottomColor: C.border, opacity: disabled ? 0.45 : 1,
                        }}
                      >
                        <Icon
                          name={disabled ? 'lock-closed-outline' : on ? 'checkbox' : 'square-outline'}
                          size={18}
                          color={on && !disabled ? '#ef4444' : C.muted}
                        />
                        <View style={{ flex: 1, marginLeft: 8 }}>
                          <Text style={{ color: C.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
                            {a.displayName || 'Unknown'}
                            {a.exists === false ? ' (deleted)' : ''}
                            {a.banned ? ' · banned' : ''}
                            {a.isStaff ? ' · staff' : ''}
                          </Text>
                          <Text style={{ color: C.muted, fontSize: 10 }} numberOfLines={1}>{a.uid}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              <Text style={{ fontSize: 11, fontWeight: '700', color: C.muted, marginBottom: 6 }}>
                Reason{requireReason ? '' : ' (optional)'} — visible to staff in the moderation history
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {MOD_QUICK_REASONS.map((r) => {
                  const on = r !== 'Other' && trimmed === r;
                  return (
                    <TouchableOpacity
                      key={r}
                      onPress={() => pickReason(r)}
                      disabled={busy}
                      style={{
                        paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8,
                        backgroundColor: on ? '#ef444422' : C.chip,
                        borderWidth: 1, borderColor: on ? '#ef4444' : C.border,
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '600', color: on ? '#ef4444' : C.text }}>{r}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput
                ref={inputRef}
                style={{
                  backgroundColor: C.input, color: C.text, borderRadius: 10, padding: 12, minHeight: 72,
                  borderWidth: 1, borderColor: C.border, textAlignVertical: 'top', fontSize: 14,
                }}
                placeholder="Add details (what happened, where)…"
                placeholderTextColor={isDark ? '#475569' : '#94a3b8'}
                multiline
                maxLength={MOD_REASON_MAX}
                value={reason}
                onChangeText={setReason}
                editable={!busy}
              />

              {allowEvidence && (
                <View style={{ marginTop: 12 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: C.muted, marginBottom: 6 }}>
                    Evidence screenshots (optional, up to {EVIDENCE_MAX})
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {shots.map((uri) => (
                      <View key={uri}>
                        <Image resizeMethod="resize" source={{ uri }} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: C.chip }} />
                        {!busy && (
                          <TouchableOpacity
                            onPress={() => removeShot(uri)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={{ position: 'absolute', top: -6, right: -6, backgroundColor: C.card, borderRadius: 10 }}
                          >
                            <Icon name="close-circle" size={20} color="#ef4444" />
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                    {shots.length < EVIDENCE_MAX && (
                      <TouchableOpacity
                        onPress={pickShots}
                        disabled={busy}
                        style={{
                          width: 64, height: 64, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed',
                          borderColor: C.border, alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Icon name="image-outline" size={22} color={C.muted} />
                      </TouchableOpacity>
                    )}
                  </View>
                  {uploading && (
                    <Text style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Uploading screenshots…</Text>
                  )}
                </View>
              )}

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
                {!!secondaryLabel && typeof onSecondary === 'function' && (
                  <TouchableOpacity
                    onPress={onSecondary}
                    disabled={busy}
                    style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, marginRight: 'auto' }}
                  >
                    <Text style={{ color: '#0ea5e9', fontWeight: '600' }}>{secondaryLabel}</Text>
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
                  onPress={handleConfirm}
                  disabled={!canConfirm}
                  style={{
                    paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, minWidth: 96, alignItems: 'center',
                    backgroundColor: confirmColor, opacity: canConfirm ? 1 : 0.5,
                  }}
                >
                  {busy
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={{ color: '#fff', fontWeight: '700' }}>{confirmLabel}</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default ModActionModal;
