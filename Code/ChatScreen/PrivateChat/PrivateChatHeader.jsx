import React, { useEffect, useMemo, useState } from 'react';
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

const PrivateChatHeader = React.memo(({ selectedUser, selectedTheme, bannedUsers }) => {
  const { updateLocalState } = useLocalState();
  const { t } = useTranslation();
  const [isOnline, setIsOnline] = useState(false); // ✅ Add state to store online status
  const { triggerHapticFeedback } = useHaptic();

  const copyToClipboard = (code) => {
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code); // Copies the code to the clipboard
    showSuccessMessage(t("value.copy"), "Copied to Clipboard");
    mixpanel.track("Code UserName", {UserName:code});
  };

  const avatarUri = selectedUser?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
  const userName = selectedUser?.sender || 'User';
// console.log(bannedUsers)

useEffect(() => {
  if (selectedUser?.senderId) {
    isUserOnline(selectedUser.senderId).then(setIsOnline).catch(() => setIsOnline(false));
  }
}, [selectedUser?.id]);
  // ✅ Check if user is banned
  const isBanned = useMemo(() => {
    return bannedUsers.includes(selectedUser?.senderId);
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
      <Image source={{ uri: avatarUri }} style={styles.avatar} />
      <View style={styles.infoContainer}>
        <Text style={[styles.userName, { color: selectedTheme.colors.text }]}>
          {userName} 
          {selectedUser.isPro && (
            <Icon name="checkmark-done-circle" size={16} color={config.colors.hasBlockGreen} />
          )}
             {'  '}   <Icon name="copy-outline" size={16} color="#007BFF" onPress={()=>copyToClipboard(userName)}/>

        </Text>
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
        
      </View>
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
    fontFamily: 'Lato-Bold',
  },
  banIcon: {
    marginLeft: 10,
  },
});

export default PrivateChatHeader;
