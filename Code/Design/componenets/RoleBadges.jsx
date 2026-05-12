import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { getUserData } from '../../Helper/UserDataCache';
import { getCachedProfile } from '../../Helper/profileCache';
import { useGlobalState } from '../../GlobelStats';

// eslint-disable-next-line no-unused-vars
const RoleBadges = ({ userItem, style, cacheVersion }) => {
  const globalState = useGlobalState() || {};
  const { user: currentUser, isAdmin: isGlobalAdmin, isModerator: isGlobalModerator } = globalState;

  if (!userItem) return null;

  // Hybrid Approach: Check UserDataCache → profileCache → message payload
  const userId = userItem.userId || userItem.senderId || userItem.id;
  const isCurrentUser = currentUser?.id && userId === currentUser.id;

  const cachedUser = getUserData(userId) || {};
  const cachedProfile = getCachedProfile(userId) || {};

  const isAdmin = (isCurrentUser && isGlobalAdmin) || (cachedUser.admin ?? cachedUser.isAdmin ?? cachedProfile.isAdmin ?? userItem.admin ?? userItem.isAdmin ?? false);
  const isModerator = (isCurrentUser && isGlobalModerator) || (cachedUser.isModerator ?? cachedProfile.isModerator ?? userItem.isModerator ?? false);
  const isJMD = cachedUser.isBabyMod ?? cachedProfile.isBabyMod ?? userItem.isBabyMod ?? false;
  const isTrusted = cachedUser.isTrusted ?? cachedProfile.isTrusted ?? userItem.isTrusted ?? false;
  const isGrinder = cachedUser.isGrinder ?? cachedProfile.isGrinder ?? userItem.isGrinder ?? false;
  const isRaider = cachedUser.isRaider ?? cachedProfile.isRaider ?? userItem.isRaider ?? false;

  if (!isAdmin && !isModerator && !isJMD && !isTrusted && !isGrinder && !isRaider) {
    return null;
  }

  return (
    <View style={[styles.container, style]}>
      {isAdmin && (
        <View style={styles.roleBadge_admin}>
          <Ionicons name="shield" size={8} color="#fff" />
          <Text style={styles.roleBadgeText}>Admin</Text>
        </View>
      )}
      {!isAdmin && isModerator && (
        <View style={styles.roleBadge_mod}>
          <Ionicons name="shield-checkmark" size={8} color="#fff" />
          <Text style={styles.roleBadgeText}>Mod</Text>
        </View>
      )}
      {!isAdmin && !isModerator && isJMD && (
        <View style={styles.roleBadge_jmd}>
          <Ionicons name="paw" size={8} color="#fff" />
          <Text style={styles.roleBadgeText}>JMD</Text>
        </View>
      )}
      {isTrusted && (
        <View style={styles.roleBadge_trusted}>
          <Ionicons name="checkmark-circle" size={8} color="#fff" />
          <Text style={styles.roleBadgeText}>Trusted</Text>
        </View>
      )}
      {isGrinder && (
        <View style={styles.roleBadge_grinder}>
          <Ionicons name="barbell" size={8} color="#fff" />
          <Text style={styles.roleBadgeText}>Grinder</Text>
        </View>
      )}
      {isRaider && (
        <View style={styles.roleBadge_raider}>
          <Ionicons name="flash" size={8} color="#fff" />
          <Text style={styles.roleBadgeText}>Raider</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 3,
    marginLeft: 3,
  },
  roleBadge_admin: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#EF4444',
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: 5, gap: 2,
  },
  roleBadge_mod: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#8B5CF6',
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: 5, gap: 2,
  },
  roleBadge_jmd: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F59E0B',
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: 5, gap: 2,
  },
  roleBadge_trusted: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#10B981',
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: 5, gap: 2,
  },
  roleBadge_grinder: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#06B6D4',
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: 5, gap: 2,
  },
  roleBadge_raider: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#DC2626',
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: 5, gap: 2,
  },
  roleBadgeText: {
    color: '#fff', fontSize: 7, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.3,
    paddingVertical: 2,
  },
});

export default React.memo(RoleBadges);
