import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useLocalState } from '../../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '../utils';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { mixpanel } from '../../AppHelper/MixPenel';
import { useGlobalState } from '../../GlobelStats';
import { ref, get, set } from '@react-native-firebase/database';
import { getThemeColors } from '../../Helper/themeColors';
import FramedAvatar from '../GroupChat/FramedAvatar';
import { getActiveCosmetics } from '../../Engagement/shopUtils';
import RoleBadges from '../../Design/componenets/RoleBadges';
import { getCachedProfile } from '../../Helper/profileCache';

const PrivateChatHeader = React.memo(({ selectedUser, selectedTheme, bannedUsers, isDrawerVisible, setIsDrawerVisible }) => {
  const { updateLocalState } = useLocalState();
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();
  const { appdatabase, user, theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);

  const selectedUserId = selectedUser?.senderId || selectedUser?.id || null;

  // State for fetched user data
  const [userData, setUserData] = useState(null);
  const [activeCosmetics, setActiveCosmetics] = useState(null);

  // Memoize copyToClipboard
  const copyToClipboard = useCallback((code) => {
    if (!code || typeof code !== 'string') return;
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code);
    showSuccessMessage(t("value.copy"), "Copied to Clipboard");
    mixpanel.track("Code UserName", { UserName: code });
  }, [triggerHapticFeedback, t]);

  // Fetch user data from Firebase if roblox data is missing
  useEffect(() => {
    if (!selectedUserId || !appdatabase) return;

    // Only fetch if robloxUsername is not already in selectedUser
    if (selectedUser?.robloxUsername || selectedUser?.robloxUserId) {
      setUserData(null);
      return;
    }

    let isMounted = true;

    const fetchUserData = async () => {
      try {
        const [robloxUsernameSnap, robloxUserIdSnap, robloxUsernameVerifiedSnap,
          isProSnap, lastGameWinAtSnap, isAdminSnap, isModeratorSnap, isTrustedSnap, isCMSRSnap, isGrinderSnap, isRaiderSnap, profileFrameSnap] = await Promise.all([
            get(ref(appdatabase, `users/${selectedUserId}/robloxUsername`)).catch(() => null),
            get(ref(appdatabase, `users/${selectedUserId}/robloxUserId`)).catch(() => null),
            get(ref(appdatabase, `users/${selectedUserId}/robloxUsernameVerified`)).catch(() => null),
            get(ref(appdatabase, `users/${selectedUserId}/isPro`)).catch(() => null),
            get(ref(appdatabase, `users/${selectedUserId}/lastGameWinAt`)).catch(() => null),
            get(ref(appdatabase, `users/${selectedUserId}/isAdmin`)).catch(() => null),
            get(ref(appdatabase, `users/${selectedUserId}/isModerator`)).catch(() => null),
            get(ref(appdatabase, `users/${selectedUserId}/isTrusted`)).catch(() => null),
            get(ref(appdatabase, `users/${selectedUserId}/isCMSR`)).catch(() => null),
            get(ref(appdatabase, `users/${selectedUserId}/isGrinder`)).catch(() => null),
            get(ref(appdatabase, `users/${selectedUserId}/isRaider`)).catch(() => null),
            get(ref(appdatabase, `users/${selectedUserId}/profileFrame`)).catch(() => null),
          ]);

        if (!isMounted) return;

        setUserData({
          robloxUsername: robloxUsernameSnap?.exists() ? robloxUsernameSnap.val() : null,
          robloxUserId: robloxUserIdSnap?.exists() ? robloxUserIdSnap.val() : null,
          robloxUsernameVerified: robloxUsernameVerifiedSnap?.exists() ? robloxUsernameVerifiedSnap.val() : false,
          isPro: isProSnap?.exists() ? isProSnap.val() : false,
          lastGameWinAt: lastGameWinAtSnap?.exists() ? lastGameWinAtSnap.val() : null,
          isAdmin: isAdminSnap?.exists() ? isAdminSnap.val() : false,
          isModerator: isModeratorSnap?.exists() ? isModeratorSnap.val() : false,
          isTrusted: isTrustedSnap?.exists() ? isTrustedSnap.val() : false,
          isCMSR: isCMSRSnap?.exists() ? isCMSRSnap.val() : false,
          isGrinder: isGrinderSnap?.exists() ? isGrinderSnap.val() : false,
          isRaider: isRaiderSnap?.exists() ? isRaiderSnap.val() : false,
          profileFrame: profileFrameSnap?.exists() ? profileFrameSnap.val() : null,
        });
      } catch (error) {
        console.error('Error fetching user data in PrivateChatHeader:', error);
        if (isMounted) setUserData(null);
      }
    };

    fetchUserData();

    // Fetch active cosmetics (full frame object with borderColors etc.)
    const fetchCosmetics = async () => {
      try {
        const cosmetics = await getActiveCosmetics(appdatabase, selectedUserId);
        if (isMounted) setActiveCosmetics(cosmetics);
      } catch { /* graceful fallback */ }
    };
    fetchCosmetics();

    return () => {
      isMounted = false;
    };
  }, [selectedUser?.senderId, selectedUser?.id, selectedUser?.robloxUsername, selectedUser?.robloxUserId, appdatabase]);

  // Merge selectedUser with fetched userData
  const mergedUser = useMemo(() => {
    if (!userData) return selectedUser;
    return {
      ...selectedUser,
      robloxUsername: selectedUser?.robloxUsername || userData.robloxUsername,
      robloxUserId: selectedUser?.robloxUserId || userData.robloxUserId,
      robloxUsernameVerified: selectedUser?.robloxUsernameVerified !== undefined
        ? selectedUser.robloxUsernameVerified
        : userData.robloxUsernameVerified,
      isPro: selectedUser?.isPro !== undefined ? selectedUser.isPro : userData.isPro,
      lastGameWinAt: selectedUser?.lastGameWinAt !== undefined
        ? selectedUser.lastGameWinAt
        : userData.lastGameWinAt,
      isAdmin: selectedUser?.isAdmin !== undefined ? selectedUser.isAdmin : userData.isAdmin,
      isModerator: selectedUser?.isModerator !== undefined ? selectedUser.isModerator : userData.isModerator,
      isTrusted: userData.isTrusted ?? selectedUser?.isTrusted ?? false,
      isCMSR: userData.isCMSR ?? selectedUser?.isCMSR ?? false,
      isGrinder: userData.isGrinder ?? selectedUser?.isGrinder ?? false,
      isRaider: userData.isRaider ?? selectedUser?.isRaider ?? false,
      profileFrame: selectedUser?.profileFrame || userData.profileFrame || null,
    };
  }, [selectedUser, userData]);

  // ✅ Resolve from message → profileCache → default (supports slim messages)
  const cachedProfile = getCachedProfile(selectedUserId);

  const avatarUri = useMemo(() =>
    mergedUser?.avatar || cachedProfile?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
    [mergedUser?.avatar, cachedProfile?.avatar]
  );

  const userName = useMemo(() =>
    mergedUser?.sender || cachedProfile?.displayName || 'User',
    [mergedUser?.sender, cachedProfile?.displayName]
  );

  const isOnline = useOnlineStatus(selectedUserId);

  const hasRecentWin = useMemo(() =>
    !!mergedUser?.hasRecentGameWin ||
    (typeof mergedUser?.lastGameWinAt === 'number' &&
      Date.now() - mergedUser.lastGameWinAt <= 24 * 60 * 60 * 1000),
    [mergedUser?.hasRecentGameWin, mergedUser?.lastGameWinAt]
  );

  // Check if user is banned
  const isBanned = useMemo(() => {
    if (!selectedUserId) return false;
    const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
    return banned.includes(selectedUserId);
  }, [bannedUsers, selectedUserId]);

  // Memoize handleBanToggle
  const handleBanToggle = useCallback(async () => {
    if (!selectedUserId) return;

    const action = !isBanned ? 'Block' : 'Unblock';
    Alert.alert(
      `${action}`,
      `${t("chat.are_you_sure")} ${action.toLowerCase()} ${userName}?`,
      [
        { text: t("chat.cancel"), style: 'cancel' },
        {
          text: action,
          style: 'destructive',
          onPress: async () => {
            try {
              const currentBanned = Array.isArray(bannedUsers) ? bannedUsers : [];
              let updatedBannedUsers;

              if (isBanned) {
                updatedBannedUsers = currentBanned.filter(id => id !== selectedUserId);
              } else {
                updatedBannedUsers = [...currentBanned, selectedUserId];
              }

              await updateLocalState('bannedUsers', updatedBannedUsers);

              if (user?.id && appdatabase) {
                const blockedRef = ref(appdatabase, `users/${user.id}/blocked_users/${selectedUserId}`);
                if (isBanned) {
                  await set(blockedRef, null);
                } else {
                  await set(blockedRef, true);
                }
              }
            } catch (error) {
              console.error('Error toggling ban status:', error);
            }
          },
        },
      ]
    );
  }, [isBanned, bannedUsers, selectedUserId, userName, t, updateLocalState, user?.id, appdatabase]);

  // Memoize drawer open handler
  const handleOpenDrawer = useCallback(() => {
    if (setIsDrawerVisible && typeof setIsDrawerVisible === 'function') {
      setIsDrawerVisible(true);
    }
  }, [setIsDrawerVisible]);

  return (
    <View style={styles.container}>
      {/* Avatar with online indicator */}
      <TouchableOpacity onPress={handleOpenDrawer} activeOpacity={0.7}>
        <FramedAvatar
          avatarUri={avatarUri}
          frame={activeCosmetics?.profileFrame || null}
          isDarkMode={isDarkMode}
          avatarSize={32}
          isOnline={isOnline}
        />
      </TouchableOpacity>

      {/* Name + badges + status */}
      <TouchableOpacity style={styles.infoContainer} onPress={handleOpenDrawer} activeOpacity={0.7}>
        {/* Top row: name + inline icons */}
        <View style={styles.nameRow}>
          <Text style={[styles.userName, { color: c.text }]} numberOfLines={1}>
            {userName}
          </Text>
          <RoleBadges userItem={mergedUser} />

          {(mergedUser?.isPro || cachedProfile?.isPro) && (
            <Image source={require('../../../assets/pro.png')} style={styles.inlineIcon} />
          )}
          {(mergedUser?.robloxUsernameVerified || cachedProfile?.robloxUsernameVerified) && (
            <Image source={require('../../../assets/verification.png')} style={styles.inlineIcon} />
          )}
          {hasRecentWin && (
            <Image source={require('../../../assets/trophy.webp')} style={styles.inlineIcon} />
          )}

          <TouchableOpacity
            onPress={() => copyToClipboard(userName)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.copyBtn}
          >
            <Icon name="copy-outline" size={13} color={c.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Bottom row: status + role badges */}
        <View style={styles.metaRow}>
          <Text style={[styles.statusText, { color: isOnline ? '#22c55e' : c.textMuted }]}>
            {isOnline ? 'Online' : 'Offline'}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Block/Unblock button */}
      <TouchableOpacity
        onPress={handleBanToggle}
        activeOpacity={0.6}
        style={[
          styles.actionBtn,
          { backgroundColor: isBanned ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.08)' },
        ]}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Icon
          name={isBanned ? 'shield-checkmark-outline' : 'ban-outline'}
          size={18}
          color={isBanned ? '#22c55e' : '#ef4444'}
        />
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    gap: 8,
  },
  infoContainer: {
    flex: 1,
    justifyContent: 'center',
    gap: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
    letterSpacing: -0.2,
  },
  inlineIcon: {
    width: 11,
    height: 11,
  },
  copyBtn: {
    padding: 2,
    marginLeft: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
  },
  actionBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default PrivateChatHeader;
