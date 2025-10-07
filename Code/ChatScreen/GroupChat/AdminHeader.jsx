import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Linking,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { ScrollView } from 'react-native-gesture-handler';
import config from '../../Helper/Environment';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
<<<<<<< HEAD
import ChatRulesModal from './ChatRuleModal';
import LinearGradient from 'react-native-linear-gradient';
=======
import ChatRulesModal from './ChatRuleModel';
>>>>>>> 7d3c677 (updated to api level 35 before)

// Regular expression to detect URLs in the message
const URL_REGEX = /(https?:\/\/[^\s]+)/g;

const AdminHeader = ({
  selectedTheme,
  modalVisibleChatinfo,
<<<<<<< HEAD
  setModalVisibleChatinfo, 
  triggerHapticFeedback, 
  unreadcount, 
  setunreadcount, 
  pinnedMessages, 
=======
  setModalVisibleChatinfo,
  triggerHapticFeedback,
  unreadcount,
  setunreadcount,
  pinnedMessages,
>>>>>>> 7d3c677 (updated to api level 35 before)
  onUnpinMessage
}) => {
  const { theme, user, isAdmin } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [pinMessageOpen, setPinMessageOpen] = useState(false)

  const styles = getStyles(isDarkMode);

  // Function to detect and wrap URLs with clickable text
  const renderMessageWithLinks = (message) => {
    const parts = message.split(URL_REGEX);
    return parts.map((part, index) => {
      if (URL_REGEX.test(part)) {
        // This part is a URL, make it clickable and underlined
        return (
          <Text
            key={index}
            style={[styles.pinnedText, { textDecorationLine: 'underline', color: 'blue' }]}
            onPress={() => Linking.openURL(part)}
          >
            {part}
          </Text>
        );
      }
      return <Text key={index} style={styles.pinnedText}>{part}</Text>;
    });
  };

  // Filter out duplicate pinned messages based on firebaseKey
  const uniquePinnedMessages = Array.from(
    new Map(pinnedMessages.map((msg) => [msg.firebaseKey, msg])).values()
  );

<<<<<<< HEAD
  const GradientContainer = ({ isNoman, children, style }) => {
    if (!isNoman) {
      return (
        <LinearGradient
          colors={['#4c669f', '#3b5998', '#192f51']} // Gradient colors
          style={style}
        >
          {children}
        </LinearGradient>
      );
    } else {
      return <View style={style}>{children}</View>;
=======
  const unbanUserWithEmailPost = async (email) => {
    const encodeEmail = (email) => email.replace(/\./g, '(dot)');
    try {
      const db = getDatabase();
      const banRef = ref(db, `banned_users_by_email_post/${encodeEmail(email)}`);
      await set(banRef, null); // Clear the ban entry
  
      Alert.alert('User Unbanned', 'Ban has been lifted.');
    } catch (err) {
      console.error('Unban error:', err);
      Alert.alert('Error', 'Could not unban user.');
>>>>>>> 7d3c677 (updated to api level 35 before)
    }
  };

  return (
<<<<<<< HEAD
    <GradientContainer isNoman={config.isNoman}>
      <View style={styles.stackContainer}>
        <View style={{paddingVertical:10}}><Text style={styles.stackHeader}>Community Chat</Text></View>
=======
    <View>
      <View style={styles.stackContainer}>
        <View style={{ paddingVertical: 10 }}><Text style={styles.stackHeader}>Community Chat</Text></View>
>>>>>>> 7d3c677 (updated to api level 35 before)
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {user?.id && (
            <View style={styles.iconContainer}>
              <Icon
                name="chatbox-outline"
                size={24}
                color={selectedTheme.colors.text}
                style={styles.icon2}
                onPress={() => {
                  navigation.navigate('Inbox');
                  triggerHapticFeedback('impactLight');
                  setunreadcount(0);
                }}
              />
              {unreadcount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadcount > 9 ? '9+' : unreadcount}</Text>
                </View>
              )}
            </View>
          )}
          {user.id && (
            <Menu>
              <MenuTrigger>
                <Icon name="ellipsis-vertical-outline" size={24} color={config.colors.primary} />
              </MenuTrigger>
              <MenuOptions
                customStyles={{
                  optionsContainer: {
                    marginTop: 8,
                    borderRadius: 8,
                    width: 220,
                    padding: 5,
                    backgroundColor: config.colors.background || '#fff',
                  },
                }}
              >
<<<<<<< HEAD
                <MenuOption onSelect={() => { setModalVisibleChatinfo(true); triggerHapticFeedback('impactLight'); }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
                    <Icon name="information-circle-outline" size={20} color={config.colors.primary} style={{ marginRight: 10 }} />
                    <Text style={{ fontSize: 16, color: config.colors.text || '#000' }}>
                      {t("chat.chat_rules")}
                    </Text>
                  </View>
                </MenuOption>
=======

>>>>>>> 7d3c677 (updated to api level 35 before)
                <MenuOption onSelect={() => navigation?.navigate('BlockedUsers')}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
                    <Icon name="ban-outline" size={20} color={config.colors.primary} style={{ marginRight: 10 }} />
                    <Text style={{ fontSize: 16, color: config.colors.text || '#000' }}>
                      {t("chat.blocked_users")}
                    </Text>
                  </View>
                </MenuOption>
              </MenuOptions>
            </Menu>
          )}
        </View>
      </View>
      <View style={{
        flexDirection: 'row', justifyContent: 'space-between', padding: 10, alignItems: 'center', borderBottomWidth: .3, borderBottomColor: 'lightgrey',
      }}>
        <Text style={{ fontSize: 12, color: isDarkMode ? 'white' : 'black' }}>🚫 No Spamming ❌ No Abuse 🛑 Be Civil & Polite 😊
        </Text>
        <TouchableOpacity onPress={() => { setModalVisibleChatinfo(true); triggerHapticFeedback('impactLight'); }}>

          <Icon name="information-circle-outline" size={20} color={config.colors.primary} style={{ marginRight: 10 }} />
          {/* <Text style={{ fontSize: 16, color: config.colors.text || '#000' }}>
                      {t("chat.chat_rules")}
                    </Text> */}
        </TouchableOpacity>
      </View>
<<<<<<< HEAD
      {/* Displaying truncated pinned messages */}
      {uniquePinnedMessages.length > 0 && (
        <View style={styles.pinnedContainer}>
          {uniquePinnedMessages.slice(0, 1).map((msg) => (
            <View key={msg.firebaseKey} style={styles.singlePinnedMessage}>
              <View>
                <Text style={styles.pinnedTextheader}>Pin Message</Text>
                <Text style={styles.pinnedText}>
  {msg.text.replace(/\n/g, ' ').length > 40 ? 
    msg.text.replace(/\n/g, ' ').substring(0, 40) + '...' : 
    msg.text.replace(/\n/g, ' ')}
</Text>

              </View>
              <TouchableOpacity onPress={() => setPinMessageOpen(true)} style={{ justifyContent:'center'}}>
=======

      {/* Displaying truncated pinned messages */}
      {uniquePinnedMessages.length > 0 && (
        <View style={styles.pinnedContainer}>
          {uniquePinnedMessages.slice(0, 1).map((msg) => (
            <View key={msg.firebaseKey} style={styles.singlePinnedMessage}>
              <View>
                <Text style={styles.pinnedTextheader}>Pin Message</Text>
                <Text style={styles.pinnedText}>
                  {msg.text.replace(/\n/g, ' ').length > 40 ?
                    msg.text.replace(/\n/g, ' ').substring(0, 40) + '...' :
                    msg.text.replace(/\n/g, ' ')}
                </Text>

              </View>
              <TouchableOpacity onPress={() => setPinMessageOpen(true)} style={{ justifyContent: 'center' }}>
>>>>>>> 7d3c677 (updated to api level 35 before)
                <Icon name="chevron-forward-outline" size={20} color={config.colors.primary} style={styles.pinIcon} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Modal for showing all pinned messages */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={pinMessageOpen}
        onRequestClose={() => setPinMessageOpen(false)}
      >
        <View style={styles.modalContainer}>
<<<<<<< HEAD
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' , minWidth:320}}>
=======
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', minWidth: 320 }}>
>>>>>>> 7d3c677 (updated to api level 35 before)
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Pin Messages</Text>
              {uniquePinnedMessages.map((msg) => (
                <View key={msg.firebaseKey} style={styles.singlePinnedMessageModal}>
<<<<<<< HEAD
                  {renderMessageWithLinks(msg.text)} 
=======
                  {renderMessageWithLinks(msg.text)}
>>>>>>> 7d3c677 (updated to api level 35 before)
                  {isAdmin && (
                    <TouchableOpacity onPress={() => onUnpinMessage(msg.firebaseKey)} style={{ backgroundColor: config.colors.primary, marginVertical: 3 }}>
                      <Text style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 5, color: 'white' }}>Delete</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setPinMessageOpen(false)}
              >
                <Text style={styles.closeButtonText}>{t("chat.got_it")}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
      <ChatRulesModal
<<<<<<< HEAD
  visible={modalVisibleChatinfo}
  onClose={() => setModalVisibleChatinfo(false)}
  isDarkMode={isDarkMode}
/>
    </GradientContainer>
=======
        visible={modalVisibleChatinfo}
        onClose={() => setModalVisibleChatinfo(false)}
        isDarkMode={isDarkMode}
      />
    </View>
>>>>>>> 7d3c677 (updated to api level 35 before)
  );
};

export const getStyles = (isDarkMode) =>
  StyleSheet.create({
    stackContainer: {
      justifyContent: 'space-between',
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
<<<<<<< HEAD
<<<<<<< HEAD
      paddingTop: Platform.OS === 'android' ? 60 : 0,
=======
      // paddingTop: Platform.OS === 'android' ? 60 : 0,
=======
      paddingTop: Platform.OS === 'android' ? 60 : 0,
>>>>>>> 6ff4a10 (commit)

>>>>>>> 7d3c677 (updated to api level 35 before)

      // paddingVertical: 10,


<<<<<<< HEAD
      borderBottomWidth: 0.5,
=======
      borderBottomWidth: 0.3,
>>>>>>> 7d3c677 (updated to api level 35 before)
      borderBottomColor: 'lightgrey',
    },
    stackHeader: {
      fontFamily: 'Lato-Bold',
      fontSize: 24,
      lineHeight: 24,
      color: isDarkMode ? 'white' : 'black',
      
    },
    pinnedContainer: {
<<<<<<< HEAD
      paddingHorizontal: 10,
      // paddingVertical: 1,
      borderBottomWidth: 0.5,
=======
      // paddingHorizontal: 10,
      // paddingVertical: 1,
      borderBottomWidth: 0.3,
>>>>>>> 7d3c677 (updated to api level 35 before)
      borderBottomColor: 'lightgrey',
    },
    singlePinnedMessage: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 5,
      borderBottomWidth: 0.2,
<<<<<<< HEAD
=======
      paddingHorizontal: 10,

>>>>>>> 7d3c677 (updated to api level 35 before)
    },
    singlePinnedMessageModal: {
      justifyContent: 'space-between',
      lineHeight: 24,
      paddingVertical: 10,
      borderBottomWidth: 0.2,
    },
    pinnedTextheader: {
<<<<<<< HEAD
      fontSize: 12,
      paddingRight: 20,
      fontFamily: 'Lato-Regular',
      color: config.colors.primary,
    },
    pinnedText: {
      fontSize: 12,
      fontFamily: 'Lato-Regular',
      color:isDarkMode ? 'white' : 'black'
    },
=======
      fontSize: 12,
      paddingRight: 20,
      fontFamily: 'Lato-Regular',
      color: config.colors.primary,
    },
    pinnedText: {
      fontSize: 12,
      fontFamily: 'Lato-Regular',
      color: isDarkMode ? 'white' : 'black'
    },
>>>>>>> 7d3c677 (updated to api level 35 before)
    pinIcon: {
      marginLeft: 10,
      // alignItems:'center',
      // backgroundColor:'red'
    },
    modalContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      width: '100%',
    },
    modalContent: {
      width: '95%',
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
      borderRadius: 10,
      padding: 20,
    },
    modalTitle: {
      fontSize: 20,
      fontFamily: 'Lato-Bold',
      marginBottom: 20,
      color: isDarkMode ? 'white' : 'black',
    },
    closeButton: {
      backgroundColor: config.colors.hasBlockGreen,
      padding: 10,
      borderRadius: 5,
      alignItems: 'center',
      marginTop: 20,
    },
    closeButtonText: {
      color: '#fff',
      fontSize: 16,
      fontFamily: 'Lato-Bold',
    },
    badge: {
      position: 'absolute',
      top: -4,
      left: -10,
      backgroundColor: 'red',
      borderRadius: 8,
      minWidth: 16,
      height: 16,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 4,
    },
    badgeText: {
      color: '#fff',
      fontSize: 10,
      fontFamily: 'Lato-Bold',
    },
  });

export default AdminHeader;
