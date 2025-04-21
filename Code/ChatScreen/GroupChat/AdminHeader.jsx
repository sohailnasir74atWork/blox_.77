import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
   Modal,
  Linking,
  Platform
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { ScrollView } from 'react-native-gesture-handler';
import config from '../../Helper/Environment';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { rulesde, rulesen, rulesfil, rulesfr, rulesid, rulespt, rulesru, rulesvi } from '../utils';
import i18n from '../../../i18n';

const AdminHeader = ({
  selectedTheme,
  modalVisibleChatinfo,
  setModalVisibleChatinfo, triggerHapticFeedback, unreadcount, setunreadcount

}) => {
  const [expanded, setExpanded] = useState(false);
  const [randomBase, setRandomBase] = useState(0); // Random base for online count
  const animatedHeight = useRef(new Animated.Value(60)).current;
  const [contentHeight, setContentHeight] = useState(0);
  const { theme, analytics } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const { user } = useGlobalState()
  const navigation = useNavigation()
  const [onlineUsers, setOnlineUsers] = useState(0);
  const { t } = useTranslation();
  const platform = Platform.OS.toLowerCase();

  const getLocalizedRules = (lang) => {
    switch (lang) {
      case 'de':
        return rulesde;
      case 'vi':
        return rulesvi;
      case 'id':
        return rulesid;
      case 'fr':
        return rulesfr;
      case 'fil':
        return rulesfil;
      case 'ru':
        return rulesru;
      case 'pt':
        return rulespt;
      default:
        return rulesen; // Default to English
    }
  };
  const rules = getLocalizedRules(i18n.language);
  useEffect(() => {
    // Generate a random number between 30 and 50
    const randomOnlineCount = Math.floor(Math.random() * (50 - 30 + 1)) + 30;
    setOnlineUsers(randomOnlineCount);
  }, []);


  const styles = getStyles(isDarkMode)
  return (
    <View>
      <View style={{ height: 50 }}>
        <View style={styles.stackContainer}>
          <View><Text style={styles.stackHeader}>{t("chat.community_chat")}</Text></View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {user?.id && <View style={styles.iconContainer}>
              <Icon
                name="chatbox-outline"
                size={24}
                color={selectedTheme.colors.text}
                style={styles.icon2}
                onPress={() => {
                  navigation.navigate('Inbox'); triggerHapticFeedback('impactLight'); setunreadcount(0); 
                }}
              />
              {unreadcount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadcount > 9 ? '9+' : unreadcount}</Text>
                </View>
              )}
            </View>}

            {user.id && <Menu>
              <MenuTrigger>
                <Icon
                  name="ellipsis-vertical-outline"
                  size={24}
                  color={config.colors.primary}

                />
              </MenuTrigger>
              <MenuOptions
                customStyles={{
                  optionsContainer: {
                    marginTop: 8, // Space between menu trigger and options
                    borderRadius: 8,
                    width: 220, // Adjust width as needed
                    padding: 5,
                    // margin:120,
                    backgroundColor: config.colors.background || '#fff', // Adjust for theme
                  },
                }}
              >
                <MenuOption onSelect={() => { setModalVisibleChatinfo((prev) => !prev); triggerHapticFeedback('impactLight'); }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
                    <Icon
                      name="information-circle-outline"
                      size={20}
                      color={config.colors.primary}
                      style={{ marginRight: 10 }}
                    />
                    <Text style={{ fontSize: 16, color: config.colors.text || '#000' }}>
                      {t("chat.chat_rules")}
                    </Text>
                  </View>
                </MenuOption>
                <View
                  style={{
                    height: 1,
                    backgroundColor: '#ccc',
                    marginHorizontal: 10,
                  }}
                />
                <MenuOption onSelect={() => navigation?.navigate('BlockedUsers')}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
                    <Icon
                      name="ban-outline"
                      size={20}
                      color={config.colors.primary}
                      style={{ marginRight: 10 }}
                    />
                    <Text style={{ fontSize: 16, color: config.colors.text || '#000' }}>
                      {t("chat.blocked_users")}
                    </Text>
                  </View>
                </MenuOption>
              </MenuOptions>
            </Menu>}
          </View>

        </View>



      </View>
      <View
        style={[
          styles.headerContainer,
          {
            backgroundColor: selectedTheme.colors.background,
            // height: animatedHeight,
            borderColor: isDarkMode ? '#333333' : '#cccccc',
          },
        ]}
        // {...panResponder.panHandlers}
      >
        <TouchableOpacity
        style={styles.button}
        onPress={() => setModalVisibleChatinfo(true)}
      >
        </TouchableOpacity>
       


        <Modal
          animationType="slide"
          transparent={true}
          visible={modalVisibleChatinfo}
          onRequestClose={() => setModalVisibleChatinfo(false)}
        >
          <View style={styles.modalContainer}>
            <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Chat Rules</Text>

                {rules.map((rule, index) => {
                  if (rule.includes("Terms of Service and Privacy Policy")) {
                    const beforeText = rule.split("Terms of Service and Privacy Policy")[0];
                    return (
                      <Text key={index} style={styles.ruleText}>
                        {index + 1}. {beforeText}
                        <Text
                          style={{ color: config.colors.hasBlockGreen, textDecorationLine: 'underline' }}
                          onPress={() => Linking.openURL("https://bloxfruitscalc.com/privacy-policy/")}
                        >
                          Terms of Service and Privacy Policy
                        </Text>
                      </Text>
                    );
                  }

                  return (
                    <Text key={index} style={styles.ruleText}>
                      {index + 1}. {rule} <View style={{ height: 8 }} />
                    </Text>
                  );
                })}

                {/* Close button */}
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => setModalVisibleChatinfo(false)}
                >
                  <Text style={styles.closeButtonText}>{t("chat.got_it")}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </Modal>

      </View></View>
  );
};

export const getStyles = (isDarkMode) =>
  StyleSheet.create({
    headerContainer: {
      overflow: 'hidden',
      borderBottomWidth: 1,
      // borderTopWidth: 1,
      marginBottom: 10,
    },
    topRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      paddingHorizontal: 10,
    },
    bottomRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      paddingHorizontal: 10,
    },
    onlineText: {
      fontSize: 10,
      fontFamily: 'Lato-Regular',
      paddingBottom:5
    },
    pinnedContainer: {
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    singlePinnedMessage: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 5,
      lineHeight: 24
    },
    pinnedText: {
      fontSize: 14,
      paddingRight: 20,
      lineHeight: 24,
      fontFamily: 'Lato-Regular',
      flex: 1,
      marginBottom: 10,

    },
    noPinnedContainer: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    noPinnedText: {
      fontSize: 14,
      fontStyle: 'italic',
    },
    clearIcon: {
      marginLeft: 10,
    },
    clearAllButton: {
      marginTop: 10,
      alignSelf: 'flex-start',
    },
    clearAllText: {
      fontSize: 12,
      fontFamily: 'Lato-Bold',
      color: config.colors.hasBlockGreen,
    },
    arrowButton: {
      alignSelf: 'center',
      position: 'absolute',
      bottom: -5,
    },
    icon: {
      alignSelf: 'left',
      position: 'absolute',
      marginLeft: 5
      // bottom: -5,
    },
    modalContainer: {
      flex: 1,
      justifyContent: 'center', // Centers vertically
      alignItems: 'center', // Centers horizontally
      backgroundColor: 'rgba(0, 0, 0, 0.5)', // Darkened background
    },
    modalContent: {
      width: '90%', // Width of the modal content
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
      borderRadius: 10,
      padding: 20,
      // maxHeight: '85%', // To prevent overflow
      margin: 'auto'
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
    ruleText: {
      fontFamily: 'Lato-Regular',
      color: isDarkMode ? 'white' : 'black',
      lineHeight: 16,
      fontSize: 12,
      marginBottom: 10,
    },
    stackContainer: {
      justifyContent: 'space-between', flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10
    },
    stackHeader: {
      fontFamily: 'Lato-Bold', fontSize: 24, lineHeight: 24, color: isDarkMode ? 'white' : 'black',
    },
    icon: {
      marginRight: 15,
    },
    icon2: {
      marginRight: 15,
      marginTop: 3,
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
