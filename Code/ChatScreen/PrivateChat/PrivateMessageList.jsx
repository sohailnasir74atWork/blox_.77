import React, { memo, useMemo, useState, useCallback, useRef } from 'react';
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
} from 'react-native'; // Image kept for fruit icons and chat images
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
import Icon from 'react-native-vector-icons/Ionicons';
import { resolveProfile, seedFromMessage } from '../../Helper/profileCache';
import { getSafeTextColor, RainbowText, isMultiColorText, getMultiColorPalette } from '../../Helper/contrastHelper';
import { StickerImage } from '../Stickers/StickerPicker';

const FRUIT_KEYWORDS = [
  'rocket', 'spin', 'chop', 'spring', 'bomb', 'spike', 'blade',
  'smoke', 'flame', 'ice', 'sand', 'dark', 'diamond', 'falcon',
  'rubber', 'barrier', 'ghost', 'light', 'magma', 'quake', 'love',
  'spider', 'sound', 'portal', 'pain', 'rumble', 'blizzard', 'buddha',
  'phoenix', 'gravity', 'shadow', 'venom', 'control', 'spirit', 'dough',
  'gas', 'dragon', 'leopard', 'kitsune', 'mammoth', 't-rex', 'yeti', 'perm', 'west', 'east', 'gamepass', 'skin', 'chromatic', 'permanent', 'Fruit Storage', 'game pass', 'Eagle', 'Creation', 'gamepass'
];
import ScamSafetyBox from './Scamwarning';
import { useNavigation } from '@react-navigation/native';
import config from '../../Helper/Environment';
import { parseMessageText } from '../ChatHelper';
import { hideTranslateTip } from '../TranslateTip';

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
  chatKey,
  isAdmin,
  otherLastRead,
  onDeleteAllChat,
}) => {
  const { theme, isAdmin: globalIsAdmin, api, freeTranslation, proGranted } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = getStyles(isDarkMode);
  const fruitColors = useMemo(
    () => ({
      wrapperBg: isDarkMode ? '#0f172a55' : '#e5e7eb55',
      name: isDarkMode ? '#f9fafb' : '#111827',
      valueColor: isDarkMode ? '#e5e7eb' : '#4b5563',
      divider: isDarkMode ? '#ffffff22' : '#00000011',
      totalLabel: isDarkMode ? '#e5e7eb' : '#4b5563',
      totalValue: isDarkMode ? '#f97373' : '#b91c1c',
    }),
    [isDarkMode],
  );
  const { t } = useTranslation();
  const deviceLanguage = useMemo(() => getDeviceLanguage(), []);


  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showReportPopup, setShowReportPopup] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const { canTranslate, incrementTranslationCount, getRemainingTranslationTries, localState, updateLocalState } = useLocalState();

  const navigation = useNavigation()

  const handleCopy = (message) => {
    Clipboard.setString(message?.text ?? '');
    triggerHapticFeedback('impactLight');
    showSuccessMessage(t('chat.message_common.success'), t('chat.message_common.message_copied'));
  };

  // Get reply preview text (matching adoptme/group chat pattern)
  const getReplyPreview = useCallback((replyTo) => {
    if (!replyTo || typeof replyTo !== 'object') return t('chat.message_common.reply_deleted');
    if (replyTo.text && typeof replyTo.text === 'string' && replyTo.text.trim().length > 0) {
      return replyTo.text;
    }
    if (replyTo.imageUrl || (Array.isArray(replyTo.imageUrls) && replyTo.imageUrls.length > 0)) {
      return t('chat.message_common.reply_image');
    }
    if (replyTo.gif) {
      return t('chat.stickers.reply_preview');
    }
    if (replyTo.hasFruits || (Array.isArray(replyTo.fruits) && replyTo.fruits.length > 0)) {
      const count = replyTo.fruitsCount || (Array.isArray(replyTo.fruits) ? replyTo.fruits.length : 0);
      return count > 0 ? t('chat.message_common.reply_pets_count', { count }) : t('chat.message_common.reply_pets');
    }
    return t('chat.message_common.reply_deleted');
  }, [t]);

  // Scroll-to-message for reply tap
  const flatListRef = useRef(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const scrollToMessageTimerRef = useRef(null);

  const scrollToMessage = useCallback((messageId) => {
    if (!flatListRef.current || !messages || messages.length === 0) return;

    const index = messages.findIndex(msg => String(msg?.id) === String(messageId));

    if (index !== -1) {
      setHighlightedMessageId(messageId);
      flatListRef.current.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.5,
      });

      if (scrollToMessageTimerRef.current) clearTimeout(scrollToMessageTimerRef.current);
      scrollToMessageTimerRef.current = setTimeout(() => {
        setHighlightedMessageId(null);
      }, 2000);
    } else {
      Alert.alert(t('chat.private_message_list.not_found_title'), t('chat.private_message_list.not_found_body'));
    }
  }, [messages, t]);

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

      return translated;
    } catch (err) {
      // ✅ HANDLED: Catch network/API errors gracefully (no crash)
      // Only log in development, suppress in production to avoid red banner
      if (__DEV__) {
        console.error('Translation Error:', err?.message || err);
      }
      return null; // Return null to trigger user-friendly error message
    }
  };

  const handleTranslate = async (item) => {
    // They found Translate: the one-time tip (ChatScreen/TranslateTip) is done.
    hideTranslateTip();
    if (localState.showTranslateTip) updateLocalState('showTranslateTip', false);

    // ✅ FIXED: Correct unlimited check (Pro users OR proGranted users have unlimited)
    const isUnlimited = freeTranslation || localState.isPro || proGranted;

    // ✅ Check limit BEFORE translation (reads from storage for real-time accuracy)
    if (!isUnlimited && !canTranslate()) {
      Alert.alert(t('chat.message_common.limit_reached'), t('chat.message_common.translate_limit'));
      return;
    }

    // ✅ Only increment AFTER successful translation
    const translated = await translateText(item.text, deviceLanguage);

    if (translated) {
      // ✅ Increment count (reads from storage first, then updates)
      if (!isUnlimited) incrementTranslationCount();

      // ✅ Get remaining tries (reads from storage for real-time accuracy)
      const remaining = isUnlimited ? t('chat.message_common.unlimited') : t('chat.message_common.remaining', { count: getRemainingTranslationTries() });

      Alert.alert(
        t('chat.message_common.translated_title'),
        `${translated}\n\n${t('chat.message_common.daily_limit', { remaining })}${isUnlimited
          ? ''
          : `\n\n${t('chat.message_common.upgrade_more')}`
        }`
      );
    } else {
      Alert.alert(t('chat.error'), t('chat.message_common.translate_failed'));
    }
  };

  // ✅ Date separator helper
  const getDateLabel = (timestamp) => {
    if (!timestamp) return '';
    const msgDate = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (msgDate.toDateString() === today.toDateString()) return t('chat.private_message_list.today');
    if (msgDate.toDateString() === yesterday.toDateString()) return t('chat.private_message_list.yesterday');
    return msgDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Render a single message
  const renderMessage = ({ item, index }) => {
    // ✅ Safety check
    if (!item || typeof item !== 'object') return null;

    // ✅ Resolve profile: message fields → cache → defaults (backwards compatible)
    const profile = resolveProfile(item);
    seedFromMessage(item);

    const isMyMessage = item.senderId === userId;

    // console.log(isMyMessage)
    // console.log(item, isMyMessage);
    // console.log('Selected User Avatar:', selectedUser?.avatar);

    const fruits = Array.isArray(item.fruits) ? item.fruits : [];
    const hasFruits = fruits.length > 0;
    const totalFruitValue = hasFruits
      ? fruits.reduce((sum, f) => sum + (Number(f.value) || 0), 0)
      : 0;

    const formatName = (name) => {
      if (!name || typeof name !== 'string') return '';
      return name.replace(/^\+/, '').replace(/\s+/g, '-');
    };



    const bubble = (
      <View
        style={[
          isMyMessage
            ? styles.pvtMyBubbleRow
            : styles.pvtOtherBubbleRow,
          highlightedMessageId === item.id && {
            backgroundColor: isDarkMode ? '#ffffff15' : '#1E88E520',
            borderRadius: 10,
          },
        ]}
      >
        {/* Bubble wrapper — contains message + timestamp */}
        <View style={[
          isMyMessage ? styles.pvtMyBubble : styles.pvtOtherBubble,
          profile.chatBubbleBg
            ? { backgroundColor: isDarkMode ? profile.chatBubbleBg.darkColor : profile.chatBubbleBg.color }
            : null,
        ]}>

          {/* Reply Preview */}
          {item.replyTo && (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => scrollToMessage(item.replyTo.id)}
              style={{
                backgroundColor: isDarkMode ? '#ffffff15' : '#00000008',
                borderLeftWidth: 2,
                borderLeftColor: '#1E88E5',
                borderRadius: 4,
                paddingHorizontal: 6,
                paddingVertical: 3,
                marginBottom: 3,
              }}
            >
              <Text style={{ fontSize: 12, color: isDarkMode ? '#ffffffaa' : '#00000066' }} numberOfLines={1}>
                {t('chat.replying_to', { defaultValue: 'Replying to' })}: {getReplyPreview(item.replyTo)}
              </Text>
            </TouchableOpacity>
          )}

          <Menu>
            {item.imageUrl && (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() =>
                  navigation.navigate('ImageViewerScreenChat', {
                    images: [item.imageUrl],
                    initialIndex: 0,
                  })
                }
                style={{ marginBottom: 6 }}
              >
                <Image resizeMethod="resize"
                  source={{ uri: item.imageUrl }}
                  style={styles.chatImage}
                />
              </TouchableOpacity>
            )}
            <MenuTrigger
              onLongPress={() => Vibration.vibrate(50)}
              customStyles={{ triggerTouchable: { activeOpacity: 1 } }}
            >
              {/* Sticker: inside the trigger so a long-press still offers reply / report */}
              {!!item.gif && <StickerImage url={item.gif} label={t('chat.stickers.sent_sticker')} />}
              {hasFruits && (
                <View
                  style={[
                    fruitStyles.fruitsWrapper,
                    { backgroundColor: fruitColors.wrapperBg },
                  ]}
                >
                  {fruits.map((fruit, index) => {
                    const valueType = (fruit.valueType || 'd').toLowerCase();
                    let valueBadgeStyle = fruitStyles.badgeDefault;
                    if (valueType === 'n') valueBadgeStyle = fruitStyles.badgeNeon;
                    if (valueType === 'm') valueBadgeStyle = fruitStyles.badgeMega;
                    return (
                      <View
                        key={`${fruit.id || fruit.name}-${index}`}
                        style={fruitStyles.fruitCard}
                      >
                        <Image resizeMethod="resize"
                          source={{ uri: `https://bloxfruitscalc.com/wp-content/uploads/2024/${fruit.type === 'n' ? '09' : '08'}/${formatName(fruit.name)}_Icon.webp` }}
                          style={fruitStyles.fruitImage}
                        />
                        <View style={fruitStyles.fruitInfo}>
                          <Text
                            style={[fruitStyles.fruitName, { color: fruitColors.name }]}
                            numberOfLines={1}
                          >
                            {`${fruit.name || fruit.Name || ''}  `}
                          </Text>
                          <Text style={[fruitStyles.fruitValue, { color: fruitColors.valueColor }]}>
                            {t('chat.message_common.fruit_value', { value: Number(fruit.value || 0).toLocaleString() })}{' '}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                  {fruits.length > 1 && (
                    <View style={[fruitStyles.totalRow, { borderTopColor: fruitColors.divider }]}>
                      <Text style={[fruitStyles.totalLabel, { color: fruitColors.totalLabel }]}>{t('chat.message_common.total')}</Text>
                      <Text style={[fruitStyles.totalValue, { color: fruitColors.totalValue }]}>{totalFruitValue.toLocaleString()}</Text>
                    </View>
                  )}
                </View>
              )}

              {!!item.text && (
                <View>
                  {/* No role tags here: the DM header already shows the other
                      user's roles. Group chat bubbles keep theirs. */}
                  {isMultiColorText(profile.chatTextColor)
                    ? <RainbowText
                        colors={getMultiColorPalette(profile.chatTextColor)}
                        style={[isMyMessage ? styles.pvtMyText : styles.pvtOtherText]}
                      >{parseMessageText(item.text)}</RainbowText>
                    : <Text
                        style={[
                          isMyMessage ? styles.pvtMyText : styles.pvtOtherText,
                          profile.chatTextColor
                            ? { color: getSafeTextColor(profile.chatTextColor, profile.chatBubbleBg ? (isDarkMode ? profile.chatBubbleBg.darkColor : profile.chatBubbleBg.color) : null) }
                            : null,
                        ]}
                      >{parseMessageText(item.text)}</Text>
                  }
                </View>
              )}
            </MenuTrigger>
            <MenuOptions customStyles={{
              optionsContainer: styles.menuoptions,
              optionWrapper: styles.menuOption,
              optionText: styles.menuOptionText,
            }}>
              <MenuOption onSelect={() => handleCopy(item)}>
                <Text style={styles.menuOptionText}>{t('chat.copy')}</Text>
              </MenuOption>
              <MenuOption onSelect={() => handleTranslate(item)}>
                <Text style={styles.menuOptionText}>{t('chat.translate')}</Text>
              </MenuOption>
              <MenuOption onSelect={() => {
                if (onReply) {
                  triggerHapticFeedback('impactLight');
                  onReply(item);
                }
              }}>
                <Text style={styles.menuOptionText}>{t('chat.reply', { defaultValue: 'Reply' })}</Text>
              </MenuOption>
              {!isMyMessage && (
                <MenuOption onSelect={() => handleReport(item)}>
                  <Text style={styles.menuOptionText}>{t("chat.report")}</Text>
                </MenuOption>
              )}
              {(isAdmin || globalIsAdmin) && onDeleteAllChat && (
                <MenuOption onSelect={() => onDeleteAllChat()}>
                  <Text style={[styles.menuOptionText, { color: '#EF4444' }]}>Delete All Chat</Text>
                </MenuOption>
              )}
            </MenuOptions>
          </Menu>

          {/* Timestamp + Read receipts inside bubble */}
          <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 2, gap: 3 }}>
            <Text style={isMyMessage ? styles.pvtTimestampMy : styles.pvtTimestampOther}>
              {item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }) : ''}
            </Text>
            {/* ✅ WhatsApp-style read receipts for own messages */}
            {isMyMessage && (localState?.showReadReceipts ?? true) && (
              <Icon
                name="checkmark-done"
                size={16}
                color={otherLastRead && item.timestamp && Number(item.timestamp) <= Number(otherLastRead)
                  ? (isDarkMode ? '#7FDBFF' : '#1E88E5')         // blue = read (brighter in dark)
                  : (isDarkMode ? '#ffffff77' : '#00000044')}    // grey = unread
                style={{ marginLeft: 2 }}
              />
            )}
          </View>
        </View>
      </View>
    );

    // Date separator: in inverted list, next item in data array is older
    const nextMsg = messages[index + 1];
    const showDateSep = !nextMsg || getDateLabel(item.timestamp) !== getDateLabel(nextMsg.timestamp);

    return (
      <>
        {bubble}
        {showDateSep && (
          <View style={{ alignItems: 'center', marginVertical: 8 }}>
            <View style={{
              backgroundColor: isDarkMode ? '#334155' : '#e2e8f0',
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 4,
            }}>
              <Text style={{ fontSize: 11, color: isDarkMode ? '#94a3b8' : '#64748b', fontWeight: '600' }}>
                {getDateLabel(item.timestamp)}
              </Text>
            </View>
          </View>
        )}
      </>
    );
  };

  return (
    <View style={styles.container}>
      {loading && messages.length === 0 ? (
        <ActivityIndicator size="large" color="#1E88E5" style={styles.loader} />
      ) : (
        <View style={{ flex: 1 }}>
          <>
            <ScamSafetyBox setShowRatingModal={setShowRatingModal} canRate={canRate} hasRated={hasRated} chatKey={chatKey} userId={userId} selectedUser={selectedUser} />
            <FlatList
              ref={flatListRef}
              data={messages}
              removeClippedSubviews={false}
              keyExtractor={(item, index) => item?.id || `msg-${index}`}
              renderItem={renderMessage}
              inverted
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.3}
              onScroll={() => Keyboard.dismiss()}
              onTouchStart={() => Keyboard.dismiss()}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={15}
              maxToRenderPerBatch={8}
              windowSize={5}
              updateCellsBatchingPeriod={100}
              onScrollToIndexFailed={(info) => {
                flatListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
              }}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
            />
          </>
        </View>
      )}
      {selectedMessage && chatKey && (
        <ReportPopup
          visible={showReportPopup}
          message={selectedMessage}
          onClose={() => setShowReportPopup(false)}
          onSubmit={handleSubmitReport}
          chatId={chatKey}
          isPrivateChat={true}
        />
      )}
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
    justifyContent: 'flex-start',
    marginBottom: 3,

    // flex: 1,


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
    flexDirection: 'row',
    justifyContent: 'flex-start',
    // backgroundColor:'red',
    alignItems: 'center',
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
