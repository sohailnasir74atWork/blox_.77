import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useLocalState } from '../../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import { isUserOnline } from '../utils';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { mixpanel } from '../../AppHelper/MixPenel';
import { useGlobalState } from '../../GlobelStats';
import { ref, get } from '@react-native-firebase/database';

const PrivateChatHeader = React.memo(({ selectedUser, selectedTheme, bannedUsers, isDrawerVisible, setIsDrawerVisible }) => {
  const { updateLocalState } = useLocalState();
  const { t } = useTranslation();
  const [isOnline, setIsOnline] = useState(false); // ✅ Add state to store online status
  const { triggerHapticFeedback } = useHaptic();
  const { appdatabase } = useGlobalState();
  
  // ✅ State for fetched user data (roblox username, etc.)
  const [userData, setUserData] = useState(null);

  // ✅ Memoize copyToClipboard
  const copyToClipboard = useCallback((code) => {
    if (!code || typeof code !== 'string') return;
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code);
    showSuccessMessage(t("value.copy"), "Copied to Clipboard");
    mixpanel.track("Code UserName", { UserName: code });
  }, [triggerHapticFeedback, t]);

  // ✅ Fetch user data from Firebase if roblox data is missing
  useEffect(() => {
    const selectedUserId = selectedUser?.senderId || selectedUser?.id;
    if (!selectedUserId || !appdatabase) return;
    
    // Only fetch if robloxUsername is not already in selectedUser
    if (selectedUser?.robloxUsername || selectedUser?.robloxUserId) {
      setUserData(null); // Clear fetched data if already in selectedUser
      return;
    }

    let isMounted = true;

    const fetchUserData = async () => {
      try {
        // ✅ OPTIMIZED: Fetch only specific fields instead of full user object
        const [robloxUsernameSnap, robloxUserIdSnap, robloxUsernameVerifiedSnap, 
               isProSnap, lastGameWinAtSnap] = await Promise.all([
          get(ref(appdatabase, `users/${selectedUserId}/robloxUsername`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/robloxUserId`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/robloxUsernameVerified`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/isPro`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/lastGameWinAt`)).catch(() => null),
        ]);
        
        if (!isMounted) return;
        
        // ✅ Extract values only if they exist
        setUserData({
          robloxUsername: robloxUsernameSnap?.exists() ? robloxUsernameSnap.val() : null,
          robloxUserId: robloxUserIdSnap?.exists() ? robloxUserIdSnap.val() : null,
          robloxUsernameVerified: robloxUsernameVerifiedSnap?.exists() ? robloxUsernameVerifiedSnap.val() : false,
          isPro: isProSnap?.exists() ? isProSnap.val() : false,
          lastGameWinAt: lastGameWinAtSnap?.exists() ? lastGameWinAtSnap.val() : null,
        });
      } catch (error) {
        console.error('Error fetching user data in PrivateChatHeader:', error);
        if (isMounted) setUserData(null);
      }
    };

    fetchUserData();

    return () => {
      isMounted = false;
    };
  }, [selectedUser?.senderId, selectedUser?.id, selectedUser?.robloxUsername, selectedUser?.robloxUserId, appdatabase]);

  // ✅ Merge selectedUser with fetched userData
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
        : userData.lastGameWinAt, // ✅ Game win timestamp
    };
  }, [selectedUser, userData]);

  // ✅ Memoize avatarUri and userName
  const avatarUri = useMemo(() => 
    mergedUser?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
    [mergedUser?.avatar]
  );
  
  const userName = useMemo(() => 
    mergedUser?.sender || 'User',
    [mergedUser?.sender]
  );

useEffect(() => {
  if (selectedUser?.senderId) {
    isUserOnline(selectedUser.senderId).then(setIsOnline).catch(() => setIsOnline(false));
  }
}, [selectedUser?.id]);
  // ✅ Check if user is banned
  const isBanned = useMemo(() => {
    if (!selectedUser?.senderId) return false;
    const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
    return banned.includes(selectedUser.senderId);
  }, [bannedUsers, selectedUser?.senderId]);

  const handleBanToggle = async () => {
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
              let updatedBannedUsers;
              if (isBanned) {
                // 🔹 Unban: Remove from bannedUsers
                updatedBannedUsers = bannedUsers.filter(id => id !== selectedUser?.senderId);
              } else {
                // 🔹 Ban: Add to bannedUsers
                updatedBannedUsers = [...bannedUsers, selectedUser?.senderId];
              }

              // ✅ Update local storage & state
              await updateLocalState('bannedUsers', updatedBannedUsers);
            } catch (error) {
              console.error('❌ Error toggling ban status:', error);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
    <TouchableOpacity onPress={() => setIsDrawerVisible(true)}>
  <Image source={{ uri: avatarUri }} style={styles.avatar} />
</TouchableOpacity>

      <TouchableOpacity style={styles.infoContainer} onPress={() => setIsDrawerVisible(true)}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[styles.userName, { color: selectedTheme.colors.text }]}>
            {userName} 
          </Text>
          {mergedUser?.isPro && (
            <Image
              source={require('../../../assets/pro.png')} 
              style={{ width: 12, height: 12, marginLeft: 4 }} 
            />
          )}
          {mergedUser?.robloxUsernameVerified && (
            <Image
              source={require('../../../assets/verification.png')} 
              style={{ width: 12, height: 12, marginLeft: 4 }} 
            />
          )}
          {(() => {
            const hasRecentWin =
              !!mergedUser?.hasRecentGameWin ||
              (typeof mergedUser?.lastGameWinAt === 'number' &&
                Date.now() - mergedUser.lastGameWinAt <= 24 * 60 * 60 * 1000);
            return hasRecentWin ? (
              <Image
                source={require('../../../assets/trophy.webp')}
                style={{ width: 10, height: 10, marginLeft: 4 }}
              />
            ) : null;
          })()}
          {'  '}
          <Icon 
            name="copy-outline" 
            size={16} 
            color="#007BFF" 
            onPress={() => copyToClipboard(userName)}
          />
        </View>
        <Text style={[
                    styles.drawerSubtitleUser,
                    {
                      color: isOnline
                        ? config.colors.hasBlockGreen
                        : config.colors.wantBlockRed,
                      fontSize: 10,
                      marginTop: 2,
                    },
                  ]}
                >
          {isOnline ? 'Online' : 'Offline'}
        </Text>
        
      </TouchableOpacity>
      <TouchableOpacity onPress={handleBanToggle}>
        <Icon
          name={isBanned ? 'shield-checkmark-outline' : 'ban-outline'}
          size={24}
          color={isBanned ? config.colors.hasBlockGreen : config.colors.wantBlockRed}
          style={styles.banIcon}
        />
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: 'white',
  },
  infoContainer: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  banIcon: {
    marginLeft: 10,
  },
});

export default PrivateChatHeader;
