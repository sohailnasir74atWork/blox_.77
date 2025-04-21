import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Image,
  Platform,
} from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';
import Icon from 'react-native-vector-icons/Ionicons';
import { getStyles } from '../../SettingScreen/settingstyle';
import { useLocalState } from '../../LocalGlobelStats';
import { Alert } from 'react-native';  // ✅ Ensure Alert is imported
import { useTranslation } from 'react-i18next';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import { mixpanel } from '../../AppHelper/MixPenel';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';


const ProfileBottomDrawer = ({ isVisible, toggleModal, startChat, selectedUser,
  isOnline, 
  bannedUsers }) => {
  const { theme, analytics } = useGlobalState();
  const { updateLocalState } = useLocalState()
  // console.log(isVisible)
  const userName = selectedUser?.sender || null;
  const avatar = selectedUser?.avatar || null;
  const { t } = useTranslation();
  const platform = Platform.OS.toLowerCase();
  const { triggerHapticFeedback } = useHaptic();



  // console.log(selectedUser)

  const isDarkMode = theme === 'dark';
  const styles = getStyles(isDarkMode);

  // Determine if the user is currently banned
  const isBlock = bannedUsers?.includes(selectedUser?.senderId);

  // Handle Ban/Unban Toggle
  const copyToClipboard = (code) => {
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code); // Copies the code to the clipboard
    showSuccessMessage(t("value.copy"), "Copied to Clipboard");
    mixpanel.track("Code UserName", {UserName:code});
  };
  const handleBanToggle = async () => {
    const action = isBlock ? t("chat.unblock") : t("chat.block");

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

              if (isBlock) {
                // ✅ Remove from bannedUsers (Unban)
                updatedBannedUsers = bannedUsers.filter(id => id !== selectedUser?.senderId);
              } else {
                // ✅ Add to bannedUsers (Ban)
                updatedBannedUsers = [...bannedUsers, selectedUser?.senderId];
              }

              // ✅ Update local storage & state
              await updateLocalState('bannedUsers', updatedBannedUsers);

              // ✅ Wait a bit before showing the confirmation (Fix MMKV Delay)
              setTimeout(() => {
                showSuccessMessage(
                  t("home.alert.success"),
                  isBlock ? `${userName} ${t("chat.user_unblocked")}` : `${userName} ${t("chat.user_blocked")}`
                );
              }, 100); // Small delay to ensure UI updates correctly
            } catch (error) {
              console.error('❌ Error toggling ban status:', error);
            }
          },
        },
      ]
    );
  };




  // Handle Start Chat
  const handleStartChat = () => {
    if (startChat) {
      startChat(); // Call the function passed as a prop
    }
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isVisible}
      onRequestClose={toggleModal}
    >
      {/* Overlay */}
      <Pressable style={styles.overlay} onPress={toggleModal} />

      {/* Drawer Content */}
      <View style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View style={styles.drawer}>
          {/* User Info */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <View style={{ flexDirection: 'row' }}>
              <Image
                source={{
                  uri: avatar
                    ? avatar
                    : 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                }}
                style={styles.profileImage2}
              />
              <View style={{ justifyContent: 'center' }}>
                <Text style={styles.drawerSubtitleUser}>{userName} {selectedUser?.isPro && <Icon
                  name="checkmark-done-circle"
                  size={16}
                  color={config.colors.hasBlockGreen}
                />}{'  '}<Icon name="copy-outline" size={16} color="#007BFF" onPress={()=>copyToClipboard(userName)}/></Text>
                
                <Text
                  style={[
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
            </View>

            {/* Ban/Unban Icon */}
            <TouchableOpacity onPress={handleBanToggle}>
              <Icon
                name={isBlock ? "shield-checkmark-outline" : "ban-outline"}
                size={30}
                color={
                  isBlock
                    ? config.colors.hasBlockGreen // Banned color
                    : config.colors.wantBlockRed // Not banned color
                }
              />
            </TouchableOpacity>
          </View>

          {/* Start Chat Button */}
          <TouchableOpacity style={styles.saveButton} onPress={handleStartChat}>
            <Text style={styles.saveButtonText}>{t("chat.start_chat")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

export default ProfileBottomDrawer;