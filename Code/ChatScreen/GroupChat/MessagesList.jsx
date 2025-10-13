import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  View,
  Text,
  TouchableOpacity,
  RefreshControl,
  Vibration,
  Image,
  Alert,
  Keyboard,
} from 'react-native';
import { getStyles } from './../Style';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import ReportPopup from './../ReportPopUp';
import { parseMessageText } from '../ChatHelper';
import { useHaptic } from '../../Helper/HepticFeedBack';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../../GlobelStats';
import Clipboard from '@react-native-clipboard/clipboard';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import axios from 'axios';
import { useLocalState } from '../../LocalGlobelStats';
import { getDeviceLanguage } from '../../../i18n';
import { mixpanel } from '../../AppHelper/MixPenel';
import StyledUsernamePreview from '../../SettingScreen/Store/StyledName';
import { banUserwithEmail, unbanUserWithEmail } from '../utils';
const FRUIT_KEYWORDS = [
  'rocket', 'spin', 'chop', 'spring', 'bomb', 'spike', 'blade',
  'smoke', 'flame', 'ice', 'sand', 'dark', 'diamond', 'falcon',
  'rubber', 'barrier', 'ghost', 'light', 'magma', 'quake', 'love',
  'spider', 'sound', 'portal', 'pain', 'rumble', 'blizzard', 'buddha',
  'phoenix', 'gravity', 'shadow', 'venom', 'control', 'spirit', 'dough',
  'gas', 'dragon', 'leopard', 'kitsune', 'mammoth', 't-rex', 'yeti', 'perm', 'west', 'east', 'gamepass', 'skin', 'chromatic', 'permanent', 'Fruit Storage', 'game pass', 'Eagle', 'Creation', 'gamepass'
];


const iconMap = {
  camping: require('../../../assets/Icons/camping.png'),
  dinamite: require('../../../assets/Icons/dinamite.png'),
  fire: require('../../../assets/Icons/fire.png'),
  grenade: require('../../../assets/Icons/grenade.png'),
  'handheld-game': require('../../../assets/Icons/handheld-game.png'),
  'paw-print': require('../../../assets/Icons/paw-print.png'),
  play: require('../../../assets/Icons/play.png'),
  'shooting-star': require('../../../assets/Icons/shooting-star.png'),
  smile: require('../../../assets/Icons/smile.png'),
  symbol: require('../../../assets/Icons/symbol.png'),
  'treasure-map': require('../../../assets/Icons/treasure-map.png'),
};


const MessagesList = ({
  messages,
  isAtBottom, setIsAtBottom,
  handleLoadMore,
  user,
  isDarkMode,
  onPinMessage,
  onDeleteMessage,
  onReply,
  // isAdmin,
  refreshing,
  flatListRef,
  onRefresh,
  banUser,
  makeadmin,
  removeAdmin,
  unbanUser,
  // isOwner,
  toggleDrawer,
  onDeleteAllMessage,

  setMessages
}) => {
  const styles = getStyles(isDarkMode);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showReportPopup, setShowReportPopup] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  // const [isAtBottom, setIsAtBottom] = useState(true);
  const { t } = useTranslation();
  // const { language, changeLanguage } = useLanguage();
  const { isAdmin, api, freeTranslation , proGranted} = useGlobalState()
  const { canTranslate, incrementTranslationCount, getRemainingTranslationTries, localState } = useLocalState();
  const deviceLanguage = useMemo(() => getDeviceLanguage(), []);

  const handleCopy = (message) => {
    Clipboard.setString(message?.text);
    triggerHapticFeedback('impactLight');
    showSuccessMessage('Success', 'Message Copied');
  };

// console.log(messages)

  const translateText = async (text, targetLang = deviceLanguage) => {
    const placeholders = {};
    let maskedText = text;

    // Step 1: Replace fruit names with placeholders
    FRUIT_KEYWORDS.forEach((word, index) => {
      const placeholder = `__FRUIT_${index}__`;
      const regex = new RegExp(`\\b${word}\\b`, 'gi'); // match full word, case-insensitive
      maskedText = maskedText.replace(regex, placeholder);
      placeholders[placeholder] = word;
    });

    try {
      // Step 2: Send masked text for translation
      const response = await axios.post(
        `https://translation.googleapis.com/language/translate/v2`,
        {},
        {
          params: {
            q: maskedText,
            target: targetLang,
            key: api,
          },
        }
      );

      let translated = response.data.data.translations[0].translatedText;

      // Step 3: Replace placeholders back with original fruit names
      Object.entries(placeholders).forEach(([placeholder, word]) => {
        translated = translated.replace(new RegExp(placeholder, 'g'), word);
      });
      mixpanel.track("Translation", { lang: targetLang });
      // console.log('translated', translated)

      return translated;
    } catch (err) {
      console.error('Translation Error:', err);
      return null;
    }
  };

  const handleTranslate = async (item) => {
    const isUnlimited = freeTranslation || (!localState.isPro && !proGranted);

    if (!isUnlimited && !canTranslate()) {
      Alert.alert('Limit Reached', 'You can only translate 20 messages per day.');
      return;
    }

    const translated = await translateText(item?.text, deviceLanguage);

    if (translated) {
      if (!isUnlimited) incrementTranslationCount();

      const remaining = isUnlimited ? 'Unlimited' : `${getRemainingTranslationTries()} remaining`;

      Alert.alert(
        'Translated Message',
        `${translated}\n\n🧠 Daily Limit: ${remaining}${isUnlimited
          ? ''
          : '\n\n🔓 Want more? Upgrade to Pro for unlimited translations.'
        }`
      );
    } else {
      Alert.alert('Error', 'Translation failed. Please try again later.');
    }
  };


  const handleLongPress = (item) => {
    if (!user?.id) return;
    Vibration.vibrate(20); // Vibrate for feedback
    setSelectedMessage(item);
  };

  const handleReport = (message) => {
    triggerHapticFeedback('impactLight');
    setSelectedMessage(message);
    setShowReportPopup(true);
  };

  const handleReportSuccess = (reportedMessageId) => {
    triggerHapticFeedback('impactLight');
    setMessages(prevMessages => {
      const updated = prevMessages.map(msg =>
        msg?.id === reportedMessageId
          ? { ...msg, isReportedByUser: true }
          : msg
      );
      return updated;
    });
  };

  const handleProfileClick = (item) => {
    // console.log(item)
    if (user.id) { toggleDrawer(item); triggerHapticFeedback('impactLight'); }
    else return

  };
  // console.log(user)
  const renderMessage = useCallback(({ item, index }) => {
    const previousMessage = messages[index + 1];
    const currentDate = new Date(item.timestamp).toDateString();
    const previousDate = previousMessage
      ? new Date(previousMessage.timestamp).toDateString()
      : null;
    const shouldShowDateHeader = currentDate !== previousDate;
    // console.log(user.id)

    return (
      <View>
        {/* Display the date header if it's a new day */}
        {shouldShowDateHeader && (
          <View>
            <Text style={styles.dateSeparator}>{currentDate}</Text>
          </View>
        )}

        {/* Render the message */}
        <View
          style={[
            item.senderId === user?.id ? styles.mymessageBubble : styles.othermessageBubble,
            (item.senderId === user?.id || item.isAdmin) ? styles.myMessage : styles.otherMessage, item.isReportedByUser && styles.reportedMessage,
          ]}
        >
          <View
            style={[
              styles.senderName,
            ]}
          >

            <TouchableOpacity onPress={() => handleProfileClick(item)} style={styles.profileImagecontainer}>
              <Image
                source={{
                  uri: item.avatar
                    ? item.avatar
                    : 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                }}
                style={styles.profileImage}
              />
            </TouchableOpacity>

          </View>

          <View style={styles.messageTextBox}>
            {item.replyTo && (
              <View style={styles.replyContainer}>
                <Text style={styles.replyText}>
                  Replying to: {'\n'}{item?.replyTo?.text || '[Deleted message]'}
                </Text>
              </View>
            )}


            <Menu>
              <MenuTrigger
                onLongPress={() => handleLongPress(item)}
                customStyles={{ triggerTouchable: { activeOpacity: 1 } }}
              >
                <View style={[
                  item.senderId === (user?.id || item.isAdmin) ? styles.mymessageBubble : styles.othermessageBubble,
                  item.senderId === user?.id ? styles.myMessage : styles.otherMessage,
                  item.isReportedByUser && styles.reportedMessage,
                ]}>
                  <View style={[item.senderId === user?.id ? styles.myMessageText : styles.otherMessageText, isAdmin && item.strikeCount === 1
                    ? { backgroundColor: 'pink' }
                    : item.strikeCount >= 2
                      ? { backgroundColor: 'red' }
                      : null,]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                      {item?.style ? (
                        <StyledUsernamePreview
                          text={item.sender}
                          variant={item.style.variant}
                          options={item.style}
                          fontSize={14}
                          lineHeight={18}
                          marginVertical={0}
                        />
                      ) : (
                        <Text style={styles.userName}>{item.sender}</Text>
                      )}
                      {item?.isPro && (
                        <Image
                          source={require('../../../assets/pro.png')}
                          style={{ width: 16, height: 16, marginLeft: 2 }}
                        />
                      )}
                      {item?.proGranted && (
                        <Image
                          source={require('../../../assets/progranted.png')}
                          style={{ width: 16, height: 16, marginLeft: 2 }}
                        />
                      )}
                      {Array.isArray(item.icons) && item.icons.slice(0, 4).map(iconKey => (
                        <Image
                          key={iconKey}
                          source={iconMap[iconKey]}
                          style={{ width: 16, height: 16, marginLeft: 2, resizeMode: 'contain' }}
                        />
                      ))}


                    </View>


                    {(!!item.isAdmin) &&
                      <View style={styles.adminContainer}>
                        <Text style={styles.admin}>{t("chat.admin")}</Text>
                      </View>}
                    {/* {'\n'} */}

                    {item.gif && <View><Image src={item.gif} style={{ height: 50, width: 50, resizeMode: 'contain' }} /></View>}
                    {/* {'\n'} */}
                    <Text style={item.senderId === user?.id ? styles.myMessageTextOnly : styles.otherMessageTextOnly}>{parseMessageText(item?.text)}</Text>




                  </View>
                </View>
              </MenuTrigger>
              <MenuOptions customStyles={{
                optionsContainer: styles.menuoptions,
                optionWrapper: styles.menuOption,
                optionText: styles.menuOptionText,
              }}>
                <MenuOption onSelect={() => handleCopy(item)}>
                  <Text style={styles.menuOptionText}>Copy</Text>
                </MenuOption>
                {user.id && (
                  <MenuOption onSelect={() => onReply(item)}>
                    <Text style={styles.menuOptionText}>{t("chat.reply")}</Text>
                  </MenuOption>
                )}
                <MenuOption onSelect={() => handleTranslate(item)}>
                  <Text style={styles.menuOptionText}>Translate</Text>
                </MenuOption>
                <MenuOption onSelect={() => handleReport(item)}>
                  <Text style={styles.menuOptionText}>{t("chat.report")}</Text>
                </MenuOption>
              </MenuOptions>
            </Menu>

            {/* {(item.reportCount > 0 || item.isReportedByUser) && (
              <Text style={styles.reportIcon}>Reported</Text>
            )} */}


          </View>




          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <Text style={styles.timestamp}>
              {new Date(item.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>

          </View>
          {(isAdmin) && (
            <Menu>
              <MenuTrigger>
                <Icon
                  name="ellipsis-vertical-outline"
                  size={16}
                  color={config.colors.hasBlockGreen}
                />
              </MenuTrigger>
              <MenuOptions>
                <View style={styles.adminActions}>
                  {/* <MenuOption onSelect={() => onPinMessage(item)} style={styles.pinButton}>
                    <Text style={styles.adminTextAction}>Pin</Text>
                  </MenuOption> */}
                  <MenuOption onSelect={() => onDeleteMessage(item.id)} style={styles.deleteButton}>
                    <Text style={styles.adminTextAction}>Delete</Text>
                  </MenuOption>
                  <MenuOption onSelect={() => onDeleteAllMessage(item?.senderId)} style={styles.deleteButton}>
                    <Text style={styles.adminTextAction}>Delete All</Text>
                  </MenuOption>
                  <MenuOption onSelect={() => banUserwithEmail(item.currentUserEmail)} style={styles.deleteButton}>
                    <Text style={styles.adminTextAction}>Block</Text>
                  </MenuOption>
                  <MenuOption onSelect={() => unbanUserWithEmail(item.currentUserEmail)} style={styles.deleteButton}>
                    <Text style={styles.adminTextAction}>Unblock</Text>
                  </MenuOption>
                  <MenuOption onSelect={() => onPinMessage(item)} style={styles.deleteButton}>
                    <Text style={styles.adminTextAction}>Pin Message</Text>
                  </MenuOption>
                  {/* {isAdmin && (
                    <MenuOption onSelect={() => makeadmin(item.senderId)} style={styles.deleteButton}>
                      <Text style={styles.adminTextAction}>Make Admin</Text>
                    </MenuOption>
                  )} */}
                  {/* {isAdmin && (
                    <MenuOption onSelect={() => removeAdmin(item.senderId)} style={styles.deleteButton}>
                      <Text style={styles.adminTextAction}>Remove Admin</Text>
                    </MenuOption>
                  )} */}
                </View>
              </MenuOptions>
            </Menu>
          )}


        </View>

      </View>
    );
  }, [messages]);

  return (
    <>
      <FlatList
        data={[...new Map(messages?.map(msg => [msg.id, msg])).values()]}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={({ item, index }) => renderMessage({ item, index })}
        contentContainerStyle={styles.chatList}
        inverted
        ref={flatListRef}
        scrollEventThrottle={16}
        removeClippedSubviews={false}
        onScroll={({ nativeEvent }) => {
          const { contentOffset } = nativeEvent;
          const atBottom = contentOffset.y <= 40;
          // console.log("✅ isAtBottom (detected):", atBottom);
          setIsAtBottom(atBottom);
        }}
        onEndReachedThreshold={0.1}
        onEndReached={handleLoadMore}
        initialNumToRender={20} // Render the first 20 messages upfront
        maxToRenderPerBatch={10} // Render 10 items per batch for smoother performance
        windowSize={5} // Adjust the window size for rendering nearby items
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={isDarkMode ? '#FFF' : '#000'}
          />
        }
        // onScroll={() => Keyboard.dismiss()}
        onTouchStart={() => Keyboard.dismiss()}
        keyboardShouldPersistTaps="handled" // Ensures taps o
      />
      <ReportPopup
        visible={showReportPopup}
        message={selectedMessage}
        onClose={(success) => {
          if (success) {
            handleReportSuccess(selectedMessage.id);
          }
          setSelectedMessage(null);
          setShowReportPopup(false);
        }}
      />
    </>
  );
};

export default MessagesList;