import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { getUserData } from '../../Helper/UserDataCache';
import { getCachedProfile } from '../../Helper/profileCache';
import { useGlobalState } from '../../GlobelStats';
import { useTranslation } from 'react-i18next';

const HELPER_ICON = require('../../Assets/badges/badge_helper.webp');

// `serverRoles`: role data a screen fetched itself from Supabase/RTDB (the
// profile drawer, the private-chat header). `cacheVersion`: bump it to
// re-render after the profile cache was warmed.
// eslint-disable-next-line no-unused-vars
const RoleBadges = ({ userItem, style, cacheVersion, serverRoles = null }) => {
  const globalState = useGlobalState() || {};
  const { t } = useTranslation();
  const {
    user: currentUser, isAdmin: isGlobalAdmin, isSeniorMod: isGlobalSeniorMod, isModerator: isGlobalModerator,
    isBabyMod: isGlobalBabyMod, isTrusted: isGlobalTrusted, isGrinder: isGlobalGrinder, isRaider: isGlobalRaider,
    isHelper: isGlobalHelper,
  } = globalState;

  if (!userItem) return null;

  const userId = userItem.userId || userItem.senderId || userItem.id;
  const isCurrentUser = currentUser?.id && userId === currentUser.id;

  const cachedUser = getUserData(userId) || {};
  const cachedProfile = getCachedProfile(userId) || {};

  // Every badge here comes ONLY from server data (2026-10-19): your own roles
  // (GlobelStats, from your RTDB record), `serverRoles`, or the two caches,
  // which are filled from Supabase/RTDB. Never from userItem: posts, comments
  // and messages are written by their author, so a flag or title stamped there
  // could be forged. Lists warm the profile cache for the people on screen
  // (chat, feed, trades). The first source that carries a field wins, even
  // with false/null ("not a mod", "no title").
  const self = isCurrentUser ? {
    isAdmin: !!isGlobalAdmin, isSeniorMod: !!isGlobalSeniorMod, isModerator: !!isGlobalModerator,
    isBabyMod: !!isGlobalBabyMod, isTrusted: !!isGlobalTrusted, isGrinder: !!isGlobalGrinder,
    isRaider: !!isGlobalRaider, isHelper: !!isGlobalHelper, customTitle: currentUser?.customTitle,
  } : null;
  const sources = [self, serverRoles, cachedUser, cachedProfile];
  const firstKnown = (key) => sources.find((o) => o && o[key] !== undefined)?.[key];

  const isAdmin = !!(firstKnown('isAdmin') || firstKnown('admin'));
  const isSeniorMod = !!firstKnown('isSeniorMod');
  const isModerator = !!firstKnown('isModerator');
  const isJMD = !!firstKnown('isBabyMod');
  const isTrusted = !!firstKnown('isTrusted');
  const isGrinder = !!firstKnown('isGrinder');
  const isRaider = !!firstKnown('isRaider');
  const isHelper = !!firstKnown('isHelper');
  const rawTitle = firstKnown('customTitle');
  const customTitle = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : null;

  if (!isAdmin && !isSeniorMod && !isModerator && !isJMD && !isTrusted && !isGrinder && !isRaider && !isHelper && !customTitle) {
    return null;
  }

  return (
    <View style={[styles.container, style]}>
      {isAdmin && (
        <View style={styles.roleBadge_admin}>
          <Ionicons name="shield" size={8} color="#fff" />
          <Text style={styles.roleBadgeText}>{t('feed.role_badges.admin')}</Text>
        </View>
      )}
      {/* Senior Mod ranks above Mod — show it instead of the Mod badge. */}
      {!isAdmin && isSeniorMod && (
        <View style={styles.roleBadge_seniorMod}>
          <Ionicons name="shield-half" size={8} color="#fff" />
          <Text style={styles.roleBadgeText}>{t('feed.role_badges.sr_mod')}</Text>
        </View>
      )}
      {!isAdmin && !isSeniorMod && isModerator && (
        <View style={styles.roleBadge_mod}>
          <Ionicons name="shield-checkmark" size={8} color="#fff" />
          <Text style={styles.roleBadgeText}>{t('feed.role_badges.mod')}</Text>
        </View>
      )}
      {!isAdmin && !isSeniorMod && !isModerator && isJMD && (
        <View style={styles.roleBadge_jmd}>
          <Ionicons name="paw" size={8} color="#fff" />
          <Text style={styles.roleBadgeText}>{t('feed.role_badges.jmd')}</Text>
        </View>
      )}
      {customTitle && (
        <View style={styles.roleBadge_title}>
          <Ionicons name="ribbon" size={8} color="#fff" />
          <Text style={styles.titleText} numberOfLines={1}>{customTitle}</Text>
        </View>
      )}
      {isTrusted && (
        <View style={styles.roleBadge_trusted}>
          <Ionicons name="checkmark-circle" size={8} color="#fff" />
          <Text style={styles.roleBadgeText}>{t('feed.role_badges.trusted')}</Text>
        </View>
      )}
      {isGrinder && (
        <View style={styles.roleBadge_grinder}>
          <Ionicons name="barbell" size={8} color="#fff" />
          <Text style={styles.roleBadgeText}>{t('feed.role_badges.grinder')}</Text>
        </View>
      )}
      {isRaider && (
        <View style={styles.roleBadge_raider}>
          <Ionicons name="flash" size={8} color="#fff" />
          <Text style={styles.roleBadgeText}>{t('feed.role_badges.raider')}</Text>
        </View>
      )}
      {isHelper && (
        <View style={styles.roleBadge_helper}>
          <Image source={HELPER_ICON} style={styles.helperIcon} />
          <Text style={styles.roleBadgeText}>{t('feed.role_badges.helper')}</Text>
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
  roleBadge_seniorMod: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#4F46E5',
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
  roleBadge_helper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#14B8A6',
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: 5, gap: 2,
  },
  helperIcon: { width: 10, height: 10 },
  roleBadge_title: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#DB2777',
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: 5, gap: 2, maxWidth: 130,
  },
  titleText: {
    color: '#fff', fontSize: 8, fontWeight: '700', paddingVertical: 1, flexShrink: 1,
  },
  roleBadgeText: {
    color: '#fff', fontSize: 7, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.3,
    paddingVertical: 2,
  },
});

export default React.memo(RoleBadges);
