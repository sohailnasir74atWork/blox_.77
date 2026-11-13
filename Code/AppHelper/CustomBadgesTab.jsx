/**
 * CustomBadgesTab — Admin Dashboard ▸ Content ▸ Custom badges (Mods and up, 2026-10-31; ported from Adopt Me).
 *
 * The registry of MOD-made badges (RTDB custom_badges, Code/Helper/customBadges.js):
 * create, rename / re-icon / recolour, and delete. Giving a badge to a player
 * happens on the player's profile (Mod Tools ▸ Badges, BadgeManager.jsx); the
 * holders are listed on the leaderboard's Custom tab. Deleting a badge also
 * takes it off everyone wearing it.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import CustomBadgeChip from '../Helper/CustomBadgeChip';
import CustomBadgeEditor from '../Helper/CustomBadgeEditor';
import { useFreshCustomBadges, deleteCustomBadge, CUSTOM_ICONS, MAX_WORN_BADGES, NAME_MAX_WORDS } from '../Helper/customBadges';

export default function CustomBadgesTab({ db, uid, isAdmin = false, isDark = false, C, accent, danger, bottomInset = 0 }) {
  const badges = useFreshCustomBadges();
  const [editing, setEditing] = useState(null); // null = closed, {} = new, {id,...} = edit

  const handleDelete = (b) => {
    Alert.alert(
      'Delete badge',
      `Delete "${b.name}"? It is removed from every player wearing it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try { await deleteCustomBadge(db, b.id); } catch (e) { Alert.alert('Error', e?.message || 'Could not delete'); }
          },
        },
      ],
    );
  };

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset + 24 }}>
      <Text style={{ fontSize: 12.5, lineHeight: 18, color: C.textMuted, marginBottom: 12 }}>
        Badges Mods can give players, next to Trusted, Grinder, Raider and Helper. Short name (up to {NAME_MAX_WORDS} words),
        one icon, one colour. A player wears at most {MAX_WORN_BADGES} badges in total. Give one from a player's
        profile ▸ Mod Tools ▸ Badges; holders show on the leaderboard's Custom tab.
      </Text>

      <TouchableOpacity
        onPress={() => setEditing({})}
        activeOpacity={0.8}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, backgroundColor: accent, marginBottom: 14 }}
      >
        <Ionicons name="add" size={16} color="#fff" />
        <Text style={{ fontSize: 13, fontWeight: '800', color: '#fff' }}>New custom badge</Text>
      </TouchableOpacity>

      {badges.length === 0 ? (
        <Text style={{ fontSize: 12.5, color: C.textFaint, textAlign: 'center', paddingVertical: 24 }}>No custom badges yet.</Text>
      ) : badges.map((b) => {
        const canDelete = isAdmin || (uid && b.createdBy === uid);
        return (
          <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <CustomBadgeChip name={b.name} image={CUSTOM_ICONS[b.icon]} color={b.color} size="md" style={{ alignSelf: 'flex-start' }} />
              <Text style={{ fontSize: 11, color: C.textFaint, marginTop: 6 }}>
                {b.icon} · {b.color}{b.createdAt ? ` · ${new Date(b.createdAt).toLocaleDateString()}` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setEditing(b)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: C.border }}>
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: C.text }}>Edit</Text>
            </TouchableOpacity>
            {canDelete && (
              <TouchableOpacity onPress={() => handleDelete(b)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: danger + '55', backgroundColor: danger + '12' }}>
                <Text style={{ fontSize: 11.5, fontWeight: '700', color: danger }}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      <CustomBadgeEditor
        visible={editing !== null}
        initial={editing && editing.id ? editing : null}
        onClose={() => setEditing(null)}
        appdatabase={db}
        byUid={uid}
        isDarkMode={isDark}
      />
    </ScrollView>
  );
}
