/**
 * BadgeManager — the Badges block of Mod Tools on a player's profile drawer
 * (BottomDrawer.jsx "Manage Roles"; 2026-10-31, ported from Adopt Me).
 *
 * One place for everything a Mod+ does to a player's badges:
 *   - the badges the player wears now (Trusted / Grinder / Raider / Helper
 *     from users/{uid} flags + custom badges from worn_badges/{uid}), each
 *     with a colour swatch,
 *   - recolour any of them (BADGE_COLORS; "Default" clears a role override),
 *   - remove one,
 *   - add one — a role badge or a custom badge from the registry, or create a
 *     new custom badge first — while the player wears fewer than
 *     MAX_WORN_BADGES.
 *
 * Writes: role flags go to users/{uid} exactly as the old Make/Remove chips
 * did (flag + rolesUpdatedAt in one update, so the Supabase mirror runs; the
 * RTDB rules re-check rank); colours and custom badges go to
 * worn_badges/{uid} (customBadges.js). Every change is logged through
 * `onLog(role, value)` (logModAction 'role_change') and patched into the
 * profile cache so RoleBadges redraws at once.
 *
 * Who may use it is the caller's decision (canManageBadges + canModerate in
 * BottomDrawer); the panel itself only hides nothing.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView, Alert, ActivityIndicator, Image } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { ref, update } from '@react-native-firebase/database';
import CustomBadgeChip from './CustomBadgeChip';
import CustomBadgeEditor, { ColorPalette } from './CustomBadgeEditor';
import { getThemeColors } from './themeColors';
import { patchCachedProfile } from './profileCache';
import { useLocalState } from '../LocalGlobelStats';
import {
  MAX_WORN_BADGES, ROLE_BADGE_KEYS, ROLE_FLAG, ROLE_LABEL, ROLE_DEFAULT_COLOR, ROLE_ICON,
  CUSTOM_ICONS, customIdsOf, fetchWornBadges, setRoleBadgeColor,
  grantCustomBadge, revokeCustomBadge, useCustomBadges, getCustomBadge,
} from './customBadges';

const HELPER_ICON = require('../Assets/badges/badge_helper.webp');
const ROSTER_CACHE = { trusted: 'trustedRoster', grinder: 'grinderRoster', raider: 'raiderRoster', helper: 'helperRoster' };

// The role chip as RoleBadges.jsx draws it, in the (possibly overridden) colour.
const RoleChip = ({ k, color, size = 'md' }) => {
  const big = size === 'lg';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: big ? 5 : 4, backgroundColor: color, paddingHorizontal: big ? 12 : 8, paddingVertical: big ? 5 : 3, borderRadius: big ? 10 : 8 }}>
      {k === 'helper'
        ? <Image source={HELPER_ICON} style={{ width: big ? 16 : 12, height: big ? 16 : 12 }} />
        : <Icon name={ROLE_ICON[k]} size={big ? 14 : 11} color="#fff" />}
      <Text style={{ color: '#fff', fontSize: big ? 12 : 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 }}>{ROLE_LABEL[k]}</Text>
    </View>
  );
};

const confirm = (title, message, okText = 'Confirm', destructive = false) => new Promise((resolve) => {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: okText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
  ]);
});

const BadgeManager = ({
  appdatabase, targetUid, userName = 'this player', target, viewerUid,
  onTargetChange, onLog, isDarkMode = false,
}) => {
  const c = getThemeColors(isDarkMode);
  const { updateLocalState } = useLocalState();
  const allCustom = useCustomBadges();

  const [worn, setWorn] = useState({ styles: target?.badgeStyles || {}, custom: target?.customBadges || {} });
  const [busy, setBusy] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!appdatabase || !targetUid) return undefined;
    fetchWornBadges(appdatabase, targetUid).then((w) => { if (alive) setWorn(w); });
    return () => { alive = false; };
  }, [appdatabase, targetUid]);

  const items = useMemo(() => {
    const out = [];
    for (const k of ROLE_BADGE_KEYS) {
      if (target?.[ROLE_FLAG[k]]) out.push({ key: k, kind: 'role', label: ROLE_LABEL[k], color: worn.styles[k] || null });
    }
    for (const id of customIdsOf(worn.custom)) {
      const def = getCustomBadge(id);
      out.push({ key: `custom:${id}`, kind: 'custom', id, label: def?.name || 'Custom badge', def, color: worn.custom[id]?.color || null });
    }
    return out;
  }, [target, worn, allCustom]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = items.length;
  const full = count >= MAX_WORN_BADGES;

  const commitWorn = useCallback((w) => {
    setWorn(w);
    patchCachedProfile(targetUid, { badgeStyles: w.styles, customBadges: w.custom });
    updateLocalState('customBadgeRoster', null);
    onTargetChange && onTargetChange({ badgeStyles: w.styles, customBadges: w.custom });
  }, [targetUid, updateLocalState, onTargetChange]);

  const setRoleFlag = useCallback(async (k, value) => {
    const flag = ROLE_FLAG[k];
    await update(ref(appdatabase, `users/${targetUid}`), { [flag]: value ? true : null, rolesUpdatedAt: Date.now() });
    onLog && onLog(flag, !!value);
    patchCachedProfile(targetUid, { [flag]: !!value });
    updateLocalState(ROSTER_CACHE[k], null);
    onTargetChange && onTargetChange({ [flag]: !!value });
  }, [appdatabase, targetUid, updateLocalState, onTargetChange, onLog]);

  const run = async (fn, failText) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { Alert.alert('Error', e?.message || failText); } finally { setBusy(false); }
  };

  const handleColor = (item, hex) => run(async () => {
    if (item.kind === 'role') commitWorn(await setRoleBadgeColor(appdatabase, targetUid, item.key, hex));
    else commitWorn(await grantCustomBadge(appdatabase, targetUid, item.id, hex, viewerUid));
  }, 'Could not change the colour');

  const handleRemove = async (item) => {
    const ok = await confirm(`Remove ${item.label}`, `Remove the ${item.label} badge from ${userName}?`, 'Remove', true);
    if (!ok) return;
    run(async () => {
      if (item.kind === 'role') {
        await setRoleFlag(item.key, false);
        if (worn.styles[item.key]) commitWorn(await setRoleBadgeColor(appdatabase, targetUid, item.key, null));
      } else {
        commitWorn(await revokeCustomBadge(appdatabase, targetUid, item.id));
        onLog && onLog(`customBadge:${item.id}`, false);
      }
      setEditingKey(null);
    }, 'Could not remove the badge');
  };

  const handleAddRole = async (k) => {
    setAddOpen(false);
    const ok = await confirm(`Give ${ROLE_LABEL[k]}`, `Give ${userName} the ${ROLE_LABEL[k]} badge?`);
    if (!ok) return;
    run(() => setRoleFlag(k, true), 'Could not give the badge');
  };

  const giveCustom = (def) => run(async () => {
    commitWorn(await grantCustomBadge(appdatabase, targetUid, def.id, null, viewerUid));
    onLog && onLog(`customBadge:${def.id}`, true);
  }, 'Could not give the badge');

  const handleAddCustom = async (def) => {
    setAddOpen(false);
    const ok = await confirm(`Give ${def.name}`, `Give ${userName} the "${def.name}" badge?`);
    if (ok) giveCustom(def);
  };

  const availableRoles = ROLE_BADGE_KEYS.filter((k) => !target?.[ROLE_FLAG[k]]);
  const availableCustom = allCustom.filter((d) => !worn.custom[d.id]);

  const Chip = ({ label, color = '#6366f1', onPress, icon, disabled }) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} disabled={disabled}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6,
        backgroundColor: color + '18', borderWidth: 1, borderColor: color + '40', opacity: disabled ? 0.45 : 1 }}>
      {icon ? <Icon name={icon} size={12} color={color} /> : null}
      <Text style={{ fontSize: 11, fontWeight: '600', color }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontSize: 10, color: c.textMuted, fontWeight: '600' }}>Badges · {count}/{MAX_WORN_BADGES}</Text>
        {busy ? <ActivityIndicator size="small" color={c.textMuted} /> : null}
      </View>

      {items.length === 0 && <Text style={{ fontSize: 11, color: c.textMuted, marginBottom: 8 }}>No badges yet.</Text>}

      {items.map((item) => {
        const open = editingKey === item.key;
        const swatch = item.color || (item.kind === 'role' ? ROLE_DEFAULT_COLOR[item.key] : item.def?.color) || '#64748B';
        return (
          <View key={item.key} style={{ borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 8, marginBottom: 6, backgroundColor: c.bgAlt }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
                {item.kind === 'role'
                  ? <RoleChip k={item.key} color={swatch} />
                  : <CustomBadgeChip name={item.label} image={CUSTOM_ICONS[item.def?.icon]} color={swatch} size="md" />}
              </View>
              <TouchableOpacity onPress={() => setEditingKey(open ? null : item.key)} activeOpacity={0.7}
                accessibilityLabel={`Colour of ${item.label}`}
                style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: swatch, borderWidth: 2, borderColor: open ? c.text : c.border }} />
              <Chip label="Remove" color="#f59e0b" onPress={() => handleRemove(item)} disabled={busy} />
            </View>
            {open && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 10, color: c.textMuted, marginBottom: 6 }}>
                  {item.kind === 'role' ? 'Badge colour (icon stays the same)' : 'Colour for this player (Default = the badge’s own colour)'}
                </Text>
                <ColorPalette value={item.color} onChange={(hex) => handleColor(item, hex)} allowDefault isDarkMode={isDarkMode} />
              </View>
            )}
          </View>
        );
      })}

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
        <Chip label={full ? `Limit ${MAX_WORN_BADGES} reached` : 'Add badge'} icon="add" color="#10b981" onPress={() => setAddOpen(true)} disabled={busy || full} />
        <Chip label="New custom badge" icon="color-wand-outline" color="#6366f1" onPress={() => setEditorOpen(true)} disabled={busy} />
      </View>

      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <Pressable onPress={() => setAddOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 20 }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: c.bg, borderRadius: 16, borderWidth: 1, borderColor: c.border, maxHeight: '80%' }}>
            <ScrollView contentContainerStyle={{ padding: 18 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: c.text }}>Add a badge</Text>
              <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 4, marginBottom: 12 }}>
                {userName} wears {count} of {MAX_WORN_BADGES}. You can change the colour after adding.
              </Text>
              {availableRoles.length > 0 && (
                <>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>Role badges</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                    {availableRoles.map((k) => (
                      <TouchableOpacity key={k} onPress={() => handleAddRole(k)} activeOpacity={0.7}>
                        <RoleChip k={k} color={ROLE_DEFAULT_COLOR[k]} size="lg" />
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>Custom badges</Text>
              {availableCustom.length === 0 ? (
                <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 10 }}>No custom badges yet. Create one below.</Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {availableCustom.map((d) => (
                    <TouchableOpacity key={d.id} onPress={() => handleAddCustom(d)} activeOpacity={0.7}>
                      <CustomBadgeChip name={d.name} image={CUSTOM_ICONS[d.icon]} color={d.color} size="lg" />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <TouchableOpacity onPress={() => { setAddOpen(false); setEditorOpen(true); }} activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.border, marginTop: 4 }}>
                <Icon name="color-wand-outline" size={14} color={c.textSecondary} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: c.textSecondary }}>Create a new custom badge</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <CustomBadgeEditor
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        appdatabase={appdatabase}
        byUid={viewerUid}
        isDarkMode={isDarkMode}
        onSaved={(def) => {
          if (full) return;
          setTimeout(() => {
            Alert.alert('Badge created', `Give "${def.name}" to ${userName} now?`, [
              { text: 'Not now', style: 'cancel' },
              { text: 'Give it', onPress: () => giveCustom(def) },
            ]);
          }, 350);
        }}
      />
    </View>
  );
};

export default React.memo(BadgeManager);
