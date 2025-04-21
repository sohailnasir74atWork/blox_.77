import React, { memo, useMemo, useState } from 'react';
import {
  FlatList,
  View,
  Text,
  RefreshControl,
  Image,
  ActivityIndicator,
  Vibration,
  Keyboard,
  Alert,
} from 'react-native';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import { useGlobalState } from '../../GlobelStats';
import { getStyles } from '../Style';
import ReportPopup from '../ReportPopUp';
import { useTranslation } from 'react-i18next';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import { useLocalState } from '../../LocalGlobelStats';
import axios from 'axios';
import { getDeviceLanguage } from '../../../i18n';
import { mixpanel } from '../../AppHelper/MixPenel';

const FRUIT_KEYWORDS = [
  'rocket', 'spin', 'chop', 'spring', 'bomb', 'spike', 'blade',
  'smoke', 'flame', 'ice', 'sand', 'dark', 'diamond', 'falcon',
  'rubber', 'barrier', 'ghost', 'light', 'magma', 'quake', 'love',
  'spider', 'sound', 'portal', 'pain', 'rumble', 'blizzard', 'buddha',
  'phoenix', 'gravity', 'shadow', 'venom', 'control', 'spirit', 'dough',
  'gas', 'dragon', 'leopard', 'kitsune', 'mammoth', 't-rex', 'yeti', 'perm', 'west', 'east', 'gamepass', 'skin', 'chromatic', 'permanent', 'Fruit Storage', 'game pass', 'Eagle', 'Creation',  'gamepass'
];

const PrivateMessageList = ({
  messages,
  userId,
  user,
  selectedUser,
  handleLoadMore,
  refreshing,
  onRefresh,
  isBanned,
  onReply,
  onReportSubmit,
  loading
}) => {
  const { theme, isAdmin, api, freeTranslation } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = getStyles(isDarkMode);
  const { t } = useTranslation();
  const deviceLanguage = useMemo(() => getDeviceLanguage(), []);


  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showReportPopup, setShowReportPopup] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const { canTranslate, incrementTranslationCount, getRemainingTranslationTries, localState } = useLocalState();


  const handleCopy = (message) => {
    Clipboard.setString(message?.text ?? '');
    triggerHapticFeedback('impactLight');
    showSuccessMessage('Success', 'Message Copied');
  };

  // Filter messages: Keep only user's messages if `isBanned` is true
  const filteredMessages = isBanned
    ? messages.filter((message) => message.senderId === userId)
    : messages;

  // Open the report popup
  const handleReport = (message) => {
    setSelectedMessage(message);
    setShowReportPopup(true);
  };
  // console.log(messages)
  // Submit the report
  const handleSubmitReport = (message, reason) => {
    onReportSubmit(message, reason);
    setShowReportPopup(false);
  };
  // console.log(selectedUserId === userId)
 


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
      mixpanel.track("Translation", {lang:targetLang});

      return translated;
    } catch (err) {
      console.error('Translation Error:', err);
      return null;
    }
  };

  const handleTranslate = async (item) => {
    const isUnlimited = freeTranslation || localState.isPro;
  
    if (!isUnlimited && !canTranslate()) {
      Alert.alert('Limit Reached', 'You can only translate 20 messages per day.');
      return;
    }
  
    const translated = await translateText(item.text, deviceLanguage);
  
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
  
  // Render a single message
  const renderMessage = ({ item }) => {
    const isMyMessage = item.senderId === userId;

    // console.log(isMyMessage)
    // console.log(item, isMyMessage);
    // console.log('Selected User Avatar:', selectedUser?.avatar);
    const avatarUri = item.senderId !== userId
      ? selectedUser?.avatar || (console.warn('Missing senderAvatar, using default'), 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png')
      : user?.avatar || (console.warn('Missing receiverAvatar, using default'), 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png');

    return (
      <View
        style={
          isMyMessage
            ? [styles.mymessageBubble, styles.myMessage, { width: '80%' }]
            : [styles.othermessageBubble, styles.otherMessage, { width: '80%' }]
        }
      >
        {/* Avatar */}
        <Image
          source={{ uri: avatarUri }}
          style={styles.profileImagePvtChat}
        />
        {/* Message Content */}
        <Menu>
          <MenuTrigger
            onLongPress={() => Vibration.vibrate(50)}
            customStyles={{ triggerTouchable: { activeOpacity: 1 } }}
          >
            <Text style={isMyMessage ? styles.myMessageText : styles.otherMessageText}>
              {item.text}
            </Text>
          </MenuTrigger>
          <MenuOptions customStyles={{
            optionsContainer: styles.menuoptions,
            optionWrapper: styles.menuOption,
            optionText: styles.menuOptionText,
          }}>
            <MenuOption onSelect={() => handleCopy(item)}>
              <Text style={styles.menuOptionText}>Copy</Text>
            </MenuOption>
            <MenuOption onSelect={() => handleTranslate(item)}>
              <Text style={styles.menuOptionText}>Translate</Text>
            </MenuOption>
            {!isMyMessage && (
              <MenuOption onSelect={() => handleReport(item)}>
                <Text style={styles.menuOptionText}>{t("chat.report")}</Text>
              </MenuOption>
            )}
          </MenuOptions>
        </Menu>
        <Text style={styles.timestamp}>
          {new Date(item.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.container]}>
      {loading && messages.length === 0 ? (
        <ActivityIndicator size="large" color="#1E88E5" style={styles.loader} />
      ) : (
        <FlatList
          data={filteredMessages}
          removeClippedSubviews={false} 
          keyExtractor={(item) => item.id}
          renderItem={renderMessage} // Pass the render function directly
          inverted // Ensure list starts from the bottom
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          onScroll={() => Keyboard.dismiss()}
          onTouchStart={() => Keyboard.dismiss()}
          keyboardShouldPersistTaps="handled" // Ensures taps o
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
      <ReportPopup
        visible={showReportPopup}
        message={selectedMessage}
        onClose={() => setShowReportPopup(false)}
        onSubmit={handleSubmitReport}
      />
    </View>
  );
};

export default memo(PrivateMessageList);
