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
  StyleSheet,
  TouchableOpacity,  
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
import ScamSafetyBox from './Scamwarning';
import { useNavigation } from '@react-navigation/native';
import config from '../../Helper/Environment';

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
  loading,
  canRate,
  hasRated,
  setShowRatingModal,
}) => {
  const { theme, isAdmin, api, freeTranslation, proGranted } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = getStyles(isDarkMode);
  const fruitColors = useMemo(
    () => ({
      wrapperBg: isDarkMode ? '#0f172a55' : '#e5e7eb55',
      name:      isDarkMode ? '#f9fafb' : '#111827',
      value:     isDarkMode ? '#e5e7eb' : '#4b5563',
      divider:   isDarkMode ? '#ffffff22' : '#00000011',
      totalLabel:isDarkMode ? '#e5e7eb' : '#4b5563',
      totalValue:isDarkMode ? '#f97373' : '#b91c1c',
    }),
    [isDarkMode],
  );
  const { t } = useTranslation();
  const deviceLanguage = useMemo(() => getDeviceLanguage(), []);


  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showReportPopup, setShowReportPopup] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const { canTranslate, incrementTranslationCount, getRemainingTranslationTries, localState } = useLocalState();

  const navigation = useNavigation()

  const handleCopy = (message) => {
    Clipboard.setString(message?.text ?? '');
    triggerHapticFeedback('impactLight');
    showSuccessMessage('Success', 'Message Copied');
  };

  // Filter messages: Keep only user's messages if `isBanned` is true
  // const filteredMessages = isBanned
  //   ? messages.filter((message) => message.senderId === userId)
  //   : messages;

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
    const isUnlimited = freeTranslation || (!localState.isPro && proGranted);
  
    if (!isUnlimited && !canTranslate()) {
      Alert.alert('Limit Reached', 'You can only translate 5 messages per day.');
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
      ? selectedUser?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'
      : user?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
      const fruits = Array.isArray(item.fruits) ? item.fruits : [];
      const hasFruits = fruits.length > 0;
      const totalFruitValue = hasFruits
        ? fruits.reduce((sum, f) => sum + (Number(f.value) || 0), 0)
        : 0;

        const formatName = (name) => name.replace(/^\+/, '').replace(/\s+/g, '-');

    
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
        {item.imageUrl && (
  <View style={{ marginBottom: 4 }}>
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() =>
        navigation.navigate('ImageViewerScreenChat', {
          // if your viewer expects an array of images:
          images: [item.imageUrl],
          initialIndex: 0, // only one image here
        })
      }
    >
      <Image
        source={{ uri: item.imageUrl }}
        style={styles.chatImage}
      />
    </TouchableOpacity>
  </View>
)}
          <MenuTrigger
            onLongPress={() => Vibration.vibrate(50)}
            customStyles={{ triggerTouchable: { activeOpacity: 1 } }}
          >
          {hasFruits && (
  <View
    style={[
      fruitStyles.fruitsWrapper,
      { backgroundColor: fruitColors.wrapperBg },
    ]}
  >
    {fruits.map((fruit, index )=> {
      const valueType = (fruit.valueType || 'd').toLowerCase(); // 'd' | 'n' | 'm'

      let valueBadgeStyle = fruitStyles.badgeDefault;
      if (valueType === 'n') valueBadgeStyle = fruitStyles.badgeNeon;
      if (valueType === 'm') valueBadgeStyle = fruitStyles.badgeMega;

      return (
        <View
          key={`${fruit.id || fruit.name}-${index}`}
          style={fruitStyles.fruitCard}
        >
          <Image
            source={{ uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/${fruit.type === 'n' ? '09' : '08'}/${formatName(fruit.name)}_Icon.webp` }}
            style={fruitStyles.fruitImage}
          />

          <View style={fruitStyles.fruitInfo}>
            <Text
              style={[fruitStyles.fruitName, { color: fruitColors.name }]}
              numberOfLines={1}
            >
              {`${fruit.name || fruit.Name}  `}
            </Text>

            <Text
              style={[fruitStyles.fruitValue, { color: fruitColors.value }]}
            >
              · Value: {Number(fruit.value || 0).toLocaleString()}
              {/* {fruit.category
                ? `  ·  ${String(fruit.category).toUpperCase()}  `
                : ''} */}{' '}
            </Text>

          
          </View>
        </View>
      );
    })}

    {/* ✅ Total row – only if more than one fruit */}
    {fruits.length > 1 && (
      <View
        style={[
          fruitStyles.totalRow,
          { borderTopColor: fruitColors.divider },
        ]}
      >
        <Text
          style={[fruitStyles.totalLabel, { color: fruitColors.totalLabel }]}
        >
          Total:
        </Text>
        <Text
          style={[fruitStyles.totalValue, { color: fruitColors.totalValue }]}
        >
          {totalFruitValue.toLocaleString()}
        </Text>
      </View>
    )}
  </View>
)}

  
            {/* Normal text (can be empty if only fruits) */}
            {!!item.text && (
              <Text
                style={isMyMessage ? styles.myMessageText : styles.otherMessageText}
              >
                {item.text}
              </Text>
            )}

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
    <View style={styles.container}>
      {loading && messages.length === 0 ? (
        <ActivityIndicator size="large" color="#1E88E5" style={styles.loader} />
      ) : (
        <View style={{paddingBottom:140}}>  
        <>   
        <ScamSafetyBox/>
        {canRate && 
         (
                  <View style={{ alignItems: 'center', marginTop: 1, paddingBottom:10 }}>
                    <TouchableOpacity
                      style={{
                        backgroundColor: config.colors.primary,
                        borderRadius: 4,
                        paddingHorizontal: 5,
                        paddingVertical: 4,
                      }}
                      onPress={() => setShowRatingModal(true)}
                    >
                      <Text style={{ color: 'white', fontSize: 12 }}>
                        {!hasRated ? `Rate Trader and Get 100 points` : `Update your review`}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
        <FlatList
          data={messages}
          removeClippedSubviews={false} 
          keyExtractor={(item) => item.id}
          renderItem={renderMessage} // Pass the render function directly
          inverted // Ensure list starts from the bottom
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          onScroll={() => Keyboard.dismiss()}
          onTouchStart={() => Keyboard.dismiss()}
          keyboardShouldPersistTaps="handled" // Ensures taps o
          // onTouchStart={() => Keyboard.dismiss()}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
        </>     
        </View>
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

export const fruitStyles = StyleSheet.create({
  fruitsWrapper: {
    marginTop: 1,
    // gap: 1,
    backgroundColor: '#1E293B15', // subtle blue-ish bg
    padding: 4,
    borderRadius: 8,

  },
  fruitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:'flex-start',
    marginBottom:3,

    flex:1,


  },
  fruitImage: {
    width: 20,
    height: 20,
    borderRadius: 2,
    marginRight: 2,
    backgroundColor: '#0002',
  },
  fruitInfo: {
    // flex: 1,
    flexDirection:'row',
    justifyContent:'flex-start',
    // backgroundColor:'red',
    alignItems:'center',
  },
  fruitName: {
    fontSize: 12,
    fontWeight: '500',
    // color: '#fff',
  },
  fruitValue: {
    fontSize: 11,
    // color: '#e5e5e5',
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    // marginTop: 4,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    // minWidth: 16,
    // justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#fff',
  },
  badgeDefault: {
    backgroundColor: '#FF6666', // D
  },
  badgeNeon: {
    backgroundColor: '#2ecc71', // N
  },
  badgeMega: {
    backgroundColor: '#9b59b6', // M
  },
  badgeFly: {
    backgroundColor: '#3498db', // F
  },
  badgeRide: {
    backgroundColor: '#e74c3c', // R
  },
  totalRow: {
    flexDirection: 'row',
    // justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#ffffff22',
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#888',
  },
  totalValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FF6666',
  },
});

export default memo(PrivateMessageList);
