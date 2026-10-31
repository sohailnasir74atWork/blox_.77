/**
 * CustomBadgeEditor — create or edit a custom badge (Code/Helper/customBadges.js).
 *
 * Opened from the Mod Tools badge panel (BadgeManager) and from Admin
 * Dashboard → Content → Custom badges. Ported from Adopt Me (same file there). Name (NAME_MAX_WORDS words / NAME_MAX_CHARS
 * chars), one icon from CUSTOM_ICONS, one colour from BADGE_COLORS, with a
 * live pill preview. Saving writes RTDB custom_badges/{id}; the rules only
 * let admins and MODs do that.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView, Pressable,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import CustomBadgeChip, { CustomGlyph } from './CustomBadgeChip';
import { getThemeColors } from './themeColors';
import {
  BADGE_COLORS, CUSTOM_ICONS, CUSTOM_ICON_NAMES, DEFAULT_ICON,
  NAME_MAX_CHARS, NAME_MAX_WORDS, validateBadgeName, saveCustomBadge,
} from './customBadges';

export const ColorPalette = ({ value, onChange, allowDefault = false, defaultLabel = 'Default', isDarkMode }) => {
  const c = getThemeColors(isDarkMode);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      {allowDefault && (
        <TouchableOpacity
          onPress={() => onChange(null)}
          activeOpacity={0.7}
          style={{
            paddingHorizontal: 10, height: 28, borderRadius: 14, justifyContent: 'center',
            borderWidth: value ? 1 : 2, borderColor: value ? c.border : c.text, backgroundColor: c.bgAlt,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: '700', color: c.text }}>{defaultLabel}</Text>
        </TouchableOpacity>
      )}
      {BADGE_COLORS.map((col) => {
        const on = value && value.toUpperCase() === col.hex;
        return (
          <TouchableOpacity
            key={col.key}
            onPress={() => onChange(col.hex)}
            activeOpacity={0.7}
            accessibilityLabel={col.label}
            style={{
              width: 28, height: 28, borderRadius: 14, backgroundColor: col.hex,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: on ? 3 : 0, borderColor: isDarkMode ? '#fff' : '#0f172a',
            }}
          >
            {on ? <Icon name="checkmark" size={14} color="#fff" /> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const CustomBadgeEditor = ({ visible, onClose, onSaved, initial = null, appdatabase, byUid, isDarkMode = false }) => {
  const c = getThemeColors(isDarkMode);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(DEFAULT_ICON);
  const [color, setColor] = useState(BADGE_COLORS[0].hex);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(initial?.name || '');
    setIcon(initial?.icon && CUSTOM_ICONS[initial.icon] ? initial.icon : DEFAULT_ICON);
    setColor(initial?.color || BADGE_COLORS[0].hex);
    setSaving(false);
  }, [visible, initial]);

  const check = useMemo(() => validateBadgeName(name), [name]);
  const words = check.value ? check.value.split(' ').length : 0;

  const handleSave = async () => {
    if (!check.ok) { Alert.alert('Badge name', check.reason); return; }
    if (!appdatabase) return;
    setSaving(true);
    try {
      const id = await saveCustomBadge(appdatabase, { id: initial?.id, name: check.value, icon, color }, byUid);
      onSaved && onSaved({ id, name: check.value, icon, color });
      onClose && onClose();
    } catch (e) {
      Alert.alert('Could not save', e?.message || 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" enabled={Platform.OS === 'ios'} style={{ flex: 1 }}>
        <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 16 }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: c.bg, borderRadius: 16, borderWidth: 1, borderColor: c.border, maxHeight: '88%' }}>
            <ScrollView contentContainerStyle={{ padding: 18 }} keyboardShouldPersistTaps="handled">
              <Text style={{ fontSize: 16, fontWeight: '800', color: c.text }}>
                {initial?.id ? 'Edit custom badge' : 'New custom badge'}
              </Text>
              <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 4, lineHeight: 17 }}>
                A short name (up to {NAME_MAX_WORDS} words), an icon and a colour. Players see it next to their name in chat and on their profile.
              </Text>

              {/* Preview */}
              <View style={{ alignItems: 'center', marginVertical: 14 }}>
                <CustomBadgeChip name={check.value || 'Badge name'} image={CUSTOM_ICONS[icon]} color={color} size="lg" />
              </View>

              <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Event Winner"
                placeholderTextColor={c.placeholder}
                maxLength={NAME_MAX_CHARS + 6}
                autoCapitalize="words"
                style={{ backgroundColor: c.inputBg, borderWidth: 1, borderColor: check.ok || !name ? c.inputBorder : '#ef4444', color: c.inputText, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 }}
              />
              <Text style={{ fontSize: 11, color: !name || check.ok ? c.textMuted : '#ef4444', marginTop: 4 }}>
                {!name ? `${NAME_MAX_WORDS} words, ${NAME_MAX_CHARS} characters max` : check.ok ? `${words}/${NAME_MAX_WORDS} words · ${check.value.length}/${NAME_MAX_CHARS}` : check.reason}
              </Text>

              <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 14, marginBottom: 8 }}>Icon</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {CUSTOM_ICON_NAMES.map((n) => {
                  const on = n === icon;
                  return (
                    <TouchableOpacity
                      key={n}
                      onPress={() => setIcon(n)}
                      activeOpacity={0.7}
                      accessibilityLabel={n}
                      style={{ padding: 3, borderRadius: 20, borderWidth: 2, borderColor: on ? color : 'transparent' }}
                    >
                      <CustomGlyph image={CUSTOM_ICONS[n]} color={on ? color : (isDarkMode ? '#475569' : '#94a3b8')} size={30} />
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 14, marginBottom: 8 }}>Colour</Text>
              <ColorPalette value={color} onChange={(hex) => setColor(hex || BADGE_COLORS[0].hex)} isDarkMode={isDarkMode} />

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={{ flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: c.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: c.textSecondary }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={saving || !check.ok}
                  activeOpacity={0.7}
                  style={{ flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: color, alignItems: 'center', opacity: saving || !check.ok ? 0.5 : 1 }}
                >
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : (
                    <Text style={{ fontSize: 13, fontWeight: '800', color: '#fff' }}>{initial?.id ? 'Save' : 'Create badge'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default CustomBadgeEditor;
